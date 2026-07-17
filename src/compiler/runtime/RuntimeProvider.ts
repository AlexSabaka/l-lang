import { VERSION } from "../Context";
import { encodeIdentifier } from "../utils/encodeIdentifier";

type SymbolName = string;

export class RuntimeProvider {

  // Global type metadata storage
  public static readonly TYPES_METADATA_VAR = '__ll_type_metadata';

  /**
   * The shim, spliced into every compiled program.
   *
   * ## `__ll_match_list` and `__ll_match_struct` were deleted from it
   *
   * They were emitted into every program and called by NOTHING. Not merely unreferenced --
   * unreachable **by construction**. They speak a protocol in which a pattern is a runtime VALUE
   * carrying sentinels: `null` = wildcard, `{type, __is_type_check}` = a type test, a nested
   * array/object = recursive descent. `__is_type_check` appeared exactly twice in the entire compiler:
   * on the two lines inside those functions that READ it. Nothing has ever constructed one. Their only
   * callers were each other.
   *
   * And they could never have BEEN the matcher, because they return a boolean and cannot **bind a
   * name** -- while every non-trivial l-lang pattern binds (`[a b]`, `{:name n}`). Codegen compiles
   * patterns inline instead (`generateCondition`), emitting `(n = tmp["name"], true)` -- a comma
   * expression that binds AND tests -- and it already recurses through nested maps and vectors. The
   * helpers were not more capable; they were strictly less.
   *
   * The one thing they added was a type test, and that wants a `case "type-pattern"` in
   * `generateCondition` calling `__ll_is_type`, not a reflective matcher.
   *
   * `__ll_is_type` STAYS. It is live: `__ll_op_registry.lookup` calls it to resolve operator overloads.
   */
  private static readonly LL_RUNTIME: string = `let ${RuntimeProvider.TYPES_METADATA_VAR} = {};
let _readline = null;
try { _readline = require("readline-sync"); } catch (e) { /* optional */ }
let _util = null;
try { _util = require("util"); } catch (e) { console.log("util module unavailable"); _util = { formatWithOptions: (opts, obj) => obj.toString() }; }
function __ll_deep_eq(a, b) {
  if (a === b) return true;
  // D9: ONE bottom value in the language, TWO representations at the JS boundary.
  //
  // l-lang emits only \`null\` for nil -- but JavaScript hands you \`undefined\` constantly (a missing
  // property, \`arr.find\` with no hit, a library that never heard of us). Since \`undefined\` is not a
  // spelling any more, a program CANNOT ask which one it got, so the two must not be distinguishable.
  // \`a == null\` is exactly "is it either bottom", and it is the only loose \`==\` in this runtime.
  //
  // Without this, \`(== (when false 1) nil)\` was FALSE: the language could not detect the bottom value
  // it produced itself. It is also what makes the memoization rewrite CORRECT rather than merely
  // compiling -- \`(!= (get memo n) nil)\` on an absent key must read "not cached", not "cached".
  //
  // It stays TIGHT on everything else: 0, "", false and NaN are not nil.
  if (a == null && b == null) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!__ll_deep_eq(a[i], b[i])) return false;
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) if (!keysB.includes(k) || !__ll_deep_eq(a[k], b[k])) return false;
  return true;
}
// The INDEXER is PARTIAL (D9). \`c[k]\` asks for something that is THERE; absence is a bug, not a
// value, and a bug must be loud. \`(get c k)\` is the total form and answers nil.
//
// This is what closes the last hole in "non-nullable by default": \`xs[i]\` is typed \`Int\` and used to
// hand back \`undefined\` for an out-of-range index -- a bottom value straight through a type that
// promises there isn't one. The type system cannot be honest while the most common expression in the
// language lies.
//
// Arrays and maps answer differently ON PURPOSE, and it is the distinction that makes a second bottom
// value unnecessary: an out-of-range INDEX is a defect (you computed it), while an absent KEY is
// ordinary control flow ("is this configured?"). The first throws; the second is what \`get\` is for.
// A STRUCT IS A VALUE TYPE (D11). This is the copy.
//
// MEMBERWISE, recursing into struct-typed fields; reference types are SHARED. That is the C# rule and
// it is what a native struct lowers to: the struct's own storage is copied, and a field that holds a
// POINTER copies the pointer.
//
//   (defstruct Outer (let :ctor i <- Inner) (let :ctor xs <- Int[]))
//   (mut b a)  (b.i.n := 99)  (b.xs[0] := 99)
//     a.i.n   unchanged   -- the nested STRUCT was copied
//     a.xs[0] IS 99       -- the ARRAY was shared
//
// The recursion is the whole point, and it is invisible to the corpus: every passing struct golden has
// all-primitive fields, so a SHALLOW copy would pass every one of them while silently aliasing any
// struct that contained another struct. A green suite would have proved nothing.
//
// \`Object.create(proto, getOwnPropertyDescriptors)\` rather than \`Object.assign\`: assign uses [[Set]],
// which is correct for the plain data fields the class builder emits today and breaks silently the day
// anyone adds a getter. The descriptor form costs nothing and cannot.
//
// The null guard is not defensive padding -- \`Object.getPrototypeOf(null)\` throws, and this is called
// on every binding in the program.
function __ll_copy(v) {
  if (v === null || typeof v !== 'object') return v;
  if (!v.constructor || v.constructor.__ll_struct !== true) return v;

  const out = Object.create(Object.getPrototypeOf(v), Object.getOwnPropertyDescriptors(v));
  for (const k of Object.keys(out)) {
    out[k] = __ll_copy(out[k]);
  }
  return out;
}
// DESTRUCTURING binds by reference, and \`__ll_copy\` alone cannot fix it.
//
// \`(let [a b] structs)\` wraps the INITIALIZER -- which is the ARRAY. An array carries no struct
// marker, so \`__ll_copy\` returns it unchanged and the bound names alias its elements: a no-op that
// LOOKS like a fix. The elements are what need copying, so the container has to be opened first.
//
// A fresh container is returned rather than mutating the original: the original is the caller's array,
// and copy-on-destructure must not write to it. The container itself is transient -- destructuring
// immediately takes it apart -- so the allocation costs nothing that matters.
function __ll_copy_each(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(__ll_copy);

  // An object PATTERN -- \`(let {:x a} p)\`. A struct's own fields are already deep-copied by __ll_copy,
  // so this only fires for a plain map, whose values still need it.
  if (v.constructor && v.constructor.__ll_struct === true) return __ll_copy(v);

  const out = {};
  for (const k of Object.keys(v)) out[k] = __ll_copy(v[k]);
  return out;
}
// \`(for :each [a b] :from pairs)\` -- a DESTRUCTURING loop variable.
//
// The pattern binds each element's MEMBERS, so every element is itself a container to open. Applying
// __ll_copy_each to the collection would copy the elements (which are arrays, not structs, and so come
// back unchanged); it has to be applied TO each element. \`Array.from\` rather than \`.map\` so a Map, a
// string or a generator works too -- \`:from\` is not required to be an array.
function __ll_map_copy_each(coll) {
  if (coll == null) return coll;
  return Array.from(coll, __ll_copy_each);
}
/**
 * \`(obj.m)\` where the compiler DOES NOT KNOW obj's type.
 *
 * D1 says a parenthesised member is a call; a field read says otherwise; and which one \`(v3.x)\` is
 * depends entirely on what \`v3\` turns out to be. Codegen used to guess from a hardcoded list of 30
 * property names -- so \`(this.breed)\` read and \`(this.nickname)\` CALLED and threw, purely because
 * someone had added \`breed\` to an array in the compiler while debugging the inheritance example.
 *
 * Where the type IS known, codegen now asks it (Xe) and never reaches here. Where it is not -- an
 * untyped JS receiver, or one of the expressions the checker still cannot infer -- the answer exists
 * anyway, at run time, and it is exact. So ask then, instead of guessing now.
 *
 * A method is called with its receiver bound; anything else is a read.
 */
function __ll_member(obj, key) {
  if (obj == null) throw new TypeError('cannot read ' + String(key) + ' of nil');
  const v = obj[key];
  return typeof v === 'function' ? v.call(obj) : v;
}

/**
 * Bridge an l-lang \`Iterator<T>\` to the JS iteration protocol (D30/Gc).
 *
 * l-lang's \`next\` returns \`T?\` -- a value, or nil when done (D30, folding D9). JS \`for...of\` expects
 * \`next()\` to return \`{ value, done }\`. This wraps the former as the latter, so a hand-written
 * \`:implements Iterable\` type becomes a real JS iterable: a \`[Symbol.iterator]\` method on the type
 * delegates here. A generator needs none of this -- \`function*\` is already a JS iterable.
 */
function __ll_js_iter(it) {
  return {
    next() {
      const v = it.next();
      return (v === null || v === undefined)
        ? { value: undefined, done: true }
        : { value: v, done: false };
    },
  };
}

function __ll_index(obj, key) {
  if (obj == null) throw new TypeError('cannot index into nil');
  if (Array.isArray(obj) || typeof obj === 'string') {
    const i = typeof key === 'number' ? key : Number(key);
    if (!Number.isInteger(i) || i < 0 || i >= obj.length) {
      throw new RangeError('IndexOutOfRange: ' + String(key) + ' (length ' + obj.length + ')');
    }
    return obj[i];
  }
  if (typeof obj === 'object' || typeof obj === 'function') {
    // \`in\`, not \`hasOwnProperty\`: a method lives on the prototype, and a class instance must be able
    // to reach its own methods and its inherited fields.
    if (!(key in obj)) throw new Error('KeyError: ' + String(key));
    return obj[key];
  }
  return obj[key];
}
function __ll_format_object(obj) { return _util.formatWithOptions({ depth: null, colors: false }, obj !== undefined && obj !== null ? obj : ""); }
const __ll_op_registry = {
  operators: {},
  register: function(symbol, params, fn) {
    if (!this.operators[symbol]) this.operators[symbol] = [];
    this.operators[symbol].push({ params, fn });
  },
  lookup: function(symbol, args) {
    const list = this.operators[symbol];
    if (!list) return null;
    for (const entry of list) {
      if (entry.params.length !== args.length) continue;
      let match = true;
      for (let i = 0; i < args.length; i++) {
        const val = args[i];
        const expectedType = entry.params[i];
        if (!__ll_is_type(val, expectedType)) {
          match = false;
          break;
        }
      }
      if (match) return entry.fn;
    }
    return null;
  }
};
function __ll_is_type(val, type) {
  const t = type.toLowerCase();
  switch (t) {
    case 'number': return typeof val === 'number';
    // 'int' and 'real' ARE THE SAME TEST, and cannot be otherwise: JavaScript has one number type
    // and \`5.0 === 5\`. A primitive cannot carry a tag (property assign, defineProperty, WeakMap and
    // Symbol all throw), BigInt breaks arithmetic/JSON/Math, and boxing unboxes at the first operator.
    // There is no runtime answer to buy here.
    //
    // So \`:of Int\` / \`:of Real\` DO NOT COME HERE. D43 decides them from the static type
    // (\`context.nodeTypes\`), and refuses the one case that is undecidable even in principle -- an
    // \`Int | Real\` union. See \`visitTypeGuard\`.
    //
    // These arms remain for OPERATOR DISPATCH, which is runtime by definition:
    // \`__ll_op_registry.lookup\` resolves an overload by testing each argument, and it has no static
    // type to consult. So dispatch cannot tell an \`[a <- Int]\` overload from an \`[a <- Real]\` one and
    // takes the first registered. That collapse is pre-existing, inherent, and now the ONLY place it
    // survives -- \`case 'float'\` used to sit here too, and was pure dead code: \`Float\` is not an
    // l-lang type (the six are Int/Real/String/Char/Boolean/Void).
    case 'int': return typeof val === 'number';
    case 'real': return typeof val === 'number';
    case 'string': return typeof val === 'string';
    // A Char IS a one-character string -- there is no separate representation, and unlike Int-vs-Real
    // that makes it genuinely TESTABLE rather than merely indistinguishable. It was absent, so
    // \`("c" :of Char)\` was FALSE: the arm was silently unreachable and no test covered it.
    case 'char': return typeof val === 'string' && val.length === 1;
    case 'boolean': return typeof val === 'boolean';
    case 'bool': return typeof val === 'boolean';
    // D9: ONE bottom value, two representations at the JS boundary. \`Void\` is the type of "no value",
    // and \`== null\` is exactly "is it either bottom" -- the same loose equality, for the same reason,
    // as \`__ll_deep_eq\` above.
    case 'void': return val == null;
    case 'function': return typeof val === 'function';
    case 'array': return Array.isArray(val);
    case 'object': return typeof val === 'object' && val !== null && !Array.isArray(val);
    case 'null': return val === null;
    case 'undefined': return val === undefined;
    // \`case 'any': return true\` USED TO BE HERE, and it existed only to answer a lie.
    //
    // \`getTypeName\` could not name a union/tuple/map/intersection, so it returned 'Any' rather than
    // admit it -- and this arm then answered TRUE for every value in the language, including the
    // \`null\` and \`undefined\` the nominal branch below explicitly rejects. \`(d :of Int | String)\`
    // matched a Dog. It is gone with the lie: getTypeName returns undefined now, and the callers
    // refuse (LL0104).
    //
    // \`Any\` as a DECLARED type is not affected -- nothing ever tests \`:of Any\`, and if it did, the
    // honest answer is that a test which cannot fail is not a test.
    default:
      if (val === null || val === undefined) return false;
      let current = val;
      while (current) {
        // __ll_name FIRST; constructor.name only as a fallback.
        //
        // The import inliner RENAMES a class -- \`class __ll_inlined_Money_1\` -- to keep two modules'
        // \`Point\` apart. Right for the BINDING, wrong for the TYPE: this function, and
        // __ll_op_registry through it, both ask "is this a Money?". Keyed on constructor.name, the
        // answer for an IMPORTED Money was always no -- so an overload registered on ["Money","Money"]
        // could never match one, and \`(x of Money)\` never matched one either. __ll_name is the SOURCE
        // name, stamped on the class, and immune to the rename.
        if (current.constructor && current.constructor.__ll_name === type) return true;
        if (current.constructor && current.constructor.name === type) return true;
        current = Object.getPrototypeOf(current);
        if (current === Object.prototype || !current) break;
      }
      return false;
  }
}`;

  /**
   * Map of individual runtime symbols and their implementations
   */
  private static readonly SYMBOL_MAP: Record<SymbolName, string> = {
    // Core Operators
    "!": `const ${encodeIdentifier('!')} = (a) => !a;`,
    "==": `const ${encodeIdentifier('==')} = (a, b) => {
      const overload = __ll_op_registry.lookup('==', [a, b]);
      if (overload) return overload(a, b);
      if (a && typeof a['${encodeIdentifier('==')}_1'] === 'function') return a['${encodeIdentifier('==')}_1'](b);
      return __ll_deep_eq(a, b);
    };`,
    "!=": `const ${encodeIdentifier('!=')} = (a, b) => {
      const eq = ${encodeIdentifier('==')};
      return !eq(a, b);
    };`,
    "≠": `const ${encodeIdentifier('≠')}  = (a, b) => {
      const eq = ${encodeIdentifier('==')};
      return !eq(a, b);
    };`,
    "+": `const ${encodeIdentifier('+')} = (...args) => {
      if (args.length === 0) return 0;
      let res = args[0];
      for (let i = 1; i < args.length; i++) {
        const next = args[i];
        const overload = __ll_op_registry.lookup('+', [res, next]);
        if (overload) {
          res = overload(res, next);
        } else if (res && typeof res['${encodeIdentifier('+')}_1'] === 'function') {
          res = res['${encodeIdentifier('+')}_1'](next);
        } else {
          res = res + next;
        }
      }
      return res;
    };`,
    "-": `const ${encodeIdentifier('-')} = (...args) => {
      if (args.length === 0) return 0;
      if (args.length === 1) {
        const val = args[0];
        const overload = __ll_op_registry.lookup('-', [val]);
        if (overload) return overload(val);
        if (val && typeof val['${encodeIdentifier('-')}_0'] === 'function') return val['${encodeIdentifier('-')}_0']();
        return -val;
      }
      let res = args[0];
      for (let i = 1; i < args.length; i++) {
        const next = args[i];
        const overload = __ll_op_registry.lookup('-', [res, next]);
        if (overload) {
          res = overload(res, next);
        } else if (res && typeof res['${encodeIdentifier('-')}_1'] === 'function') {
          res = res['${encodeIdentifier('-')}_1'](next);
        } else {
          res = res - next;
        }
      }
      return res;
    };`,
    "*": `const ${encodeIdentifier('*')} = (...args) => {
      if (args.length === 0) return 1;
      let res = args[0];
      for (let i = 1; i < args.length; i++) {
        const next = args[i];
        const overload = __ll_op_registry.lookup('*', [res, next]);
        if (overload) {
          res = overload(res, next);
        } else if (res && typeof res['${encodeIdentifier('*')}_1'] === 'function') {
          res = res['${encodeIdentifier('*')}_1'](next);
        } else {
          res = res * next;
        }
      }
      return res;
    };`,
    "/": `const ${encodeIdentifier('/')} = (...args) => {
      if (args.length === 0) return 1;
      let res = args[0];
      for (let i = 1; i < args.length; i++) {
        const next = args[i];
        const overload = __ll_op_registry.lookup('/', [res, next]);
        if (overload) {
          res = overload(res, next);
        } else if (res && typeof res['${encodeIdentifier('/')}_1'] === 'function') {
          res = res['${encodeIdentifier('/')}_1'](next);
        } else {
          res = res / next;
        }
      }
      return res;
    };`,
    "||": `const ${encodeIdentifier('||')} = (...args) => args.reduce((a, b) => a || b);`,
    "&&": `const ${encodeIdentifier('&&')} = (...args) => args.reduce((a, b) => a && b);`,
    "<": `const ${encodeIdentifier('<')}  = (a, b) => a < b;`,
    ">": `const ${encodeIdentifier('>')}  = (a, b) => a > b;`,
    "<=": `const ${encodeIdentifier('<=')} = (a, b) => a <= b;`,
    ">=": `const ${encodeIdentifier('>=')} = (a, b) => a >= b;`,
    "%": `const ${encodeIdentifier('%')}  = (a, b) => a % b;`,
    
    // List/Vector Ops
    //
    // `set!` and `set?` were DELETED here (Se). Zero uses in the entire repo -- corpus, lib, and the
    // test suites' inline sources -- and D21 rejects them BY NAME: "Scheme spellings (`nil?`, `set!`)
    // are rejected, including the ones the runtime shim itself uses". A builtin nobody calls, spelled
    // a way the language has ruled against, is not a stdlib worklist item. It is dead code with a
    // reservation on a name.
    //
    // `cons` went with them: also zero uses. `list` stays -- it has two.

    // TOTAL, and the counterpart to the partial `c[k]` (D9). This is the ONLY way to ask "is it
    // there?", and it is what gives `T?` a PRODUCER: without it an optional would only ever arise
    // where someone typed a `?`, and the forced unwrap would have nothing to catch.
    //
    // `?? null`, not `|| null`: a stored `0`, `""` or `false` is a VALUE and must come back as itself.
    "get": `const get = (obj, key) => obj?.[key] ?? null;`,
    // D9: `head []` returned THE ARRAY ITSELF -- so `(head [])` was `[]`, and asking "did I get
    // anything?" was unanswerable. It is nil. DECISIONS.md:84 cites exactly this ("optionals, so
    // `first`/`last` can be typed honestly") as why D9 must precede a typed stdlib: `head` is the
    // canonical `T?` producer, and it could not be typed while it lied about the empty case.
    // `tail []` is `[]`, which is the true answer, and is left alone.
    "head": `const head = (a) => (Array.isArray(a) && a.length > 0) ? a[0] : null;`,
    "tail": `const tail = (a) => (Array.isArray(a) && a.length > 0) ? a.slice(1) : a;`,
    // `=== undefined` was blind to null -- so `(empty nil)` was FALSE, and once nil is `null` (D9c)
    // it would have been blind to every bottom value the language emits.
    "empty": `const empty = (a) => a == null || (Array.isArray(a) && a.length === 0);`,
    // Total, like `get`. It was `a[i]`, which hands back `undefined` for a miss -- and `undefined` is
    // no longer a value this language has.
    "elem": `const elem = (a, i) => a?.[i] ?? null;`,
    "list": `const list = (...args) => [...args];`,

    // Phase L / La: the UNIFORM CURSOR. `iter` turns ANY iterable into an l-lang `Iterator<T>` --
    // `next() -> T?`, nil = done (D9/D30). It cannot be written in l-lang: it reaches through
    // `[Symbol.iterator]`, which is JS interop with no surface syntax -- the same reason `head`/`elem`
    // cannot leave SYMBOL_MAP. After Gc, EVERY iterable carries `[Symbol.iterator]` (arrays and
    // generators natively, `:implements Iterable` structs via the injected bridge), so one primitive
    // spans all three. This is the exact inverse of `__ll_js_iter`: that adapts our `T?` to JS's
    // `{value,done}`; this adapts `{value,done}` back to `T?`. The lazy LINQ operators stand on it, and
    // the early-exit ones (`take`, `take-while`) need this raw pull because `for :each` has no `break`.
    "iter": `const iter = (x) => {
  if (x == null || typeof x[Symbol.iterator] !== 'function') throw new TypeError('value is not iterable');
  const _cur = x[Symbol.iterator]();
  return { next() { const _r = _cur.next(); return _r.done ? null : _r.value; } };
};`,
    // Advance a cursor. Its `next()` already speaks `T?` (nil = done), so this just forwards it. An
    // ordinary, shadowable name like `head`/`list` -- a local or import of `next` wins, as it should.
    "next": `const next = (it) => (it != null && typeof it.next === 'function') ? it.next() : null;`,

    // Call wrapper
    "call": `const call = (f, args) => !!args && Array.isArray(args) ? f(...args) : f();`,
    "eval": ``,
    // The type-metadata lookup, BY NAME -- the half of the old `type` that took a string (Zia).
    //
    // NOTE THE TWO NAMES. The KEY is the SOURCE name: \`isRuntimeReference\` tests \`node.id in
    // SYMBOL_MAP\` against what the user wrote, and that is also what buys the LL0210 exemption. The
    // DEFINED name is \`encodeIdentifier("type-by-name")\` -- a call site emits the encoded form. Every
    // other symbol here is one word and encodes to itself, so this is the first entry where the two
    // differ, and they must both be right or the shim defines a function nothing calls.
    //
    // By-name has to exist. The metadata graph's \`extends\` and \`implements\` edges are STRINGS, so
    // walking from a type to its parent is a name lookup by construction -- \`(type-by-name
    // my-pet-type["extends"])\`. Without it the graph is unwalkable.
    "type-by-name": `const type2dby2dname = (typeName) => {
  return __ll_type_metadata[typeName] || { name: typeName, kind: 'unknown', properties: [], methods: [], generics: [] };
};`,
    // \`type\` REFLECTS A VALUE. One question, one answer (Zia).
    //
    // It used to dispatch on the JS runtime tag of its argument: a string looked itself up as a type
    // NAME, anything else reflected. So \`(type s)\` where \`s\` held "Money" answered with MONEY's
    // metadata, and a String value's own type was structurally unaskable. \`(type "hello")\` invented a
    // type CALLED "hello". The author's own \`(== (type tree) Number)\` expected reflection and got an
    // object that compares equal to nothing -- silently, and pinned by a golden (15_recursion).
    "type": `const type = (typeNameOrObj) => {
  // If it's an object (instance), try to get its type.
  //
  // __ll_name FIRST, constructor.name only as a fallback -- the same order __ll_is_type uses, and for
  // the same reason (Zh). An import is INLINED under a mangled JS name, so \`constructor.name\` is the
  // MANGLER's name: \`(type m)\` on an imported Money reported \`__ll_inlined_Money_1\`, a name that
  // appears nowhere in the user's source. It also missed the metadata lookup -- which is keyed on the
  // SOURCE name -- so it silently fell through to the reflected fallback, losing every method and
  // generic. \`__ll_name\` is the source of truth; the JS binding's name is not.
  if (typeof typeNameOrObj === 'object' && typeNameOrObj !== null) {
    const typeName = typeNameOrObj.constructor?.__ll_name || typeNameOrObj.constructor?.name || 'Object';
    return __ll_type_metadata[typeName] || { name: typeName, kind: 'object', properties: Object.keys(typeNameOrObj), methods: [], generics: [] };
  }
  // If it's a function (class), get its type -- same rename, same reason.
  if (typeof typeNameOrObj === 'function') {
    const typeName = typeNameOrObj.__ll_name || typeNameOrObj.name;
    return __ll_type_metadata[typeName] || { name: typeName, kind: 'class', properties: [], methods: [], generics: [] };
  }
  // A PRIMITIVE whose static type the checker did not know (Zi/D43).
  //
  // \`(type x)\` on a primitive is folded at COMPILE time -- see \`foldPrimitiveType\`. Reaching here
  // means the channel was empty, and the runtime genuinely cannot finish the job: \`typeof\` says
  // "number" but never Int-vs-Real, "string" but never String-vs-Char. So it does not guess. Guessing
  // (\`Number.isInteger\`) would contradict the static type, and two answers to one question is the bug
  // class this audit exists to kill.
  //
  // \`name\` is present and says so. It used to be ABSENT here, and \`(type 5)["name"]\` therefore threw
  // a D9 KeyError rather than answering -- every OTHER arm returns a named object, so the one arm
  // meaning "I do not know" was also the one arm shaped differently.
  return { name: 'Unknown', kind: 'unknown', properties: [], methods: [], generics: [] };
};`,
  };


  /**
   * Gets the full runtime shim with all symbols
   */
  public static getRuntimeShim(): string {

    return this.getRuntimeShimForSymbols(Object.keys(this.SYMBOL_MAP));
  }

  /**
   * Gets a runtime shim containing only the specified symbols
   * @param symbols - Array of symbol names to include
   * @param typesMetadata - Optional compiled types metadata to include
   * @returns Generated runtime preamble string
   */
  public static getRuntimeShimForSymbols(symbols: SymbolName[], typesMetadata?: Record<string, any>): string {
    // Always include the type function for runtime type introspection
    const symbolSet = new Set([...symbols, 'type']);

    // Handle operator dependencies
    if (symbolSet.has('!=') || symbolSet.has('≠')) {
       symbolSet.add('==');
    }
    
    const symbolDefinitions = Array.from(symbolSet)
      .filter(symbol => symbol in this.SYMBOL_MAP)
      .map(symbol => this.SYMBOL_MAP[symbol])
      .join('\n');

    const metadataInit = typesMetadata && Object.keys(typesMetadata).length > 0
      ? `${this.TYPES_METADATA_VAR} = ${JSON.stringify(typesMetadata, null, 2)};`
      : `// No type metadata`;

    return `
/**
 * 🦥 l-lang Runtime Preamble
 * Auto-generated by l-lang ${VERSION} compiler
 */
"use strict";
${this.LL_RUNTIME}
${symbolDefinitions}
${metadataInit}
`;
  }

  /**
   * The LANGUAGE OPERATORS. Not library functions -- language.
   *
   * SYMBOL_MAP is two different things wearing one coat, and that conflation is a live bug. It holds
   * these, AND it holds `get` / `head` / `tail` / `empty` / `elem` / `cons` / `list` / `call` / `eval`
   * / `type` / `set!` / `set?` -- which are ordinary, user-definable, IMPORTABLE names. The two halves
   * need opposite treatment, and nothing could tell them apart:
   *
   *   an OPERATOR  is not a name. It cannot be shadowed, imported or redefined -- only OVERLOADED,
   *                via `:operator`. `+` at a call site must ALWAYS mean the operator.
   *   a FUNCTION   is an ordinary name. An imported `head` SHOULD shadow the builtin `head`, and the
   *                import-before-runtime precedence in visitIdentifier gives exactly that.
   *
   * So `visitIdentifier`'s ordering is CORRECT for the library half and nonsense for the operator half
   * -- and because it could not distinguish them, an imported `(fn :operator + ...)` was inlined like
   * an ordinary function and ended up calling itself. Guarding on `isRuntimeReference` would have
   * "fixed" that by silently shadowing an imported user `head` with the runtime one: one silent wrong
   * answer traded for another. Hence a narrow set.
   *
   * These names can never be user identifiers -- the lexer cannot produce them as one -- so guarding
   * on them cannot capture anything a program meant to be its own.
   *
   * The other half is the worklist for D7: everything a real stdlib has to replace, so that JS interop
   * lives behind a library boundary rather than inside the code generator. `isRuntimeFunction` names it
   * explicitly for that purpose.
   */
  private static readonly OPERATOR_SYMBOLS: ReadonlySet<string> = new Set([
    "!", "==", "!=", "≠", "+", "-", "*", "/", "%", "<", ">", "<=", ">=", "&&", "||",
  ]);

  /** An operator: language, not library. See OPERATOR_SYMBOLS. */
  public static isOperatorSymbol(symbol: SymbolName): boolean {
    return this.OPERATOR_SYMBOLS.has(symbol);
  }

  /**
   * A runtime FUNCTION -- the proto-stdlib half of SYMBOL_MAP.
   *
   * `get`, `head`, `tail`, `empty`, `elem`, `list`, `call`, `eval`, `type`. (`cons`, `set!` and `set?`
   * were deleted in Se: zero uses anywhere, and D21 rejects the last two by name.)
   *
   * This was filed as D7's worklist -- "a real stdlib replaces them, at which point they leave the code
   * generator entirely". **Se established that most of them CANNOT leave, and the reason is worth
   * keeping here rather than in a document nobody opens:**
   *
   *   get / head / elem   are the language's ONLY producers of `T?` (inferTotalAccessorType). Their
   *                       type is `T[] -> T?`, which is INEXPRESSIBLE: a declared generic `-> T?`
   *                       produces no optional at the call site, because call-site generic inference
   *                       does not exist (Phase 5). Worse, inferTotalAccessorType DISABLES ITSELF the
   *                       moment the name resolves to a symbol -- so merely DECLARING them in a
   *                       library silently deletes every optional check in the language.
   *   tail/empty/list/call  the comptime sandbox and the REPL load this shim through getRuntimeShim()
   *                       and have NO import pipeline. Whatever leaves SYMBOL_MAP leaves them, silently.
   *   type                reads `__ll_type_metadata`, a JSON blob the COMPILER emits. Not writable in
   *                       l-lang at all.
   *   eval                is the empty string. It needs a runtime AST interpreter.
   *
   * The gate that unblocks this is in test:type-errors: *a generic `-> T?` return must produce an
   * optional at the call site.* The day it goes green is the day `std/core` becomes possible.
   *
   * This predicate itself has ZERO callers, and always has -- it is a marker, not a mechanism. Kept,
   * because the note is the useful part. An import of the same name legitimately shadows a runtime
   * function, and must keep doing so.
   */
  public static isRuntimeFunction(symbol: SymbolName): boolean {
    return symbol in this.SYMBOL_MAP && !this.isOperatorSymbol(symbol);
  }

  public static isRuntimeReference(symbol: SymbolName): boolean {
    return symbol in this.SYMBOL_MAP;
  }
}