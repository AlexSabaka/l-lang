import { VERSION } from "../Context";
import { encodeIdentifier } from "../utils/encodeIdentifier";
import { LL_INSPECT_JS } from "./inspectJs";

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
/* 'readline-sync' used to be required here, into a '_readline' that NOTHING EVER READ -- someone
   started down the "vendor a line reader" road and stopped. 'read-line' landed without it: stdin is
   fd 0, so the file floor already reads the console, and std/io/stream's LineReader does the
   buffering in l-lang. The require and the dependency both go. */
/* The FILE floor's host handle. Required LAZILY and cached, so a program that never touches a file
   still runs in a browser or a bare VM -- which is where the corpus's p5js examples live. */
let __ll_fs_mod;
function __ll_fs() {
  if (__ll_fs_mod === undefined) {
    try { __ll_fs_mod = require("fs"); } catch (e) { __ll_fs_mod = null; }
  }
  return __ll_fs_mod;
}
/* How many more bytes complete the UTF-8 sequence this buffer ends in? 0 if it already ends on a
   boundary; at most 3, since the longest scalar-value encoding is four bytes.

   This is what stops a CHUNKED read from splitting a codepoint. Decoding a Buffer that ends
   mid-sequence yields U+FFFD, so without it 'read-file' would corrupt one codepoint per chunk
   boundary on any non-ASCII file -- silently, and only for input the corpus does not contain. C's
   ll_utf8_want is the same function; they must stay in step or the two backends read a file
   differently. */
function __ll_utf8_want(b, n) {
  let i = n, back = 0;
  while (i > 0 && back < 4) {
    const c = b[i - 1];
    back++;
    if ((c & 0xC0) !== 0x80) {
      const len = c < 0x80 ? 1 : (c & 0xE0) === 0xC0 ? 2 : (c & 0xF0) === 0xE0 ? 3 : (c & 0xF8) === 0xF0 ? 4 : 1;
      return len > back ? len - back : 0;
    }
    i--;
  }
  return 0;
}
/* D51 -- the numeric floor. 'Int' is a wrapping 64-bit integer (a BigInt); 'Real' is f64 (a Number).
   JavaScript refuses to mix them in arithmetic ('1n + 1' throws), so these two helpers are what every
   arithmetic shim funnels through.

   '__ll_mix' implements D51's promotion rule and nothing else: mixed Int/Real promotes to REAL. That
   is what makes '(fn inc [n <- Number] -> Number (+ n 1))' work for both arms of the 'Int | Real'
   union with the literal always emitted as a BigInt -- Int + Int stays exact, Real + Int promotes.
   A non-numeric operand is returned untouched, so '+' remains string concat.

   '__ll_wrap' is the "normalised with BigInt.asIntN(64) after each op" half of the ruling. Without it
   an Int would silently become a bignum and stop being 64-bit at the first overflow. */
/* The HOST boundary (D51). A native JS method takes and returns Numbers, not BigInts, so an Int has
   to change representation on the way out and back. Both are conversions at a boundary the compiler
   identified STATICALLY (see NUMERIC_HOST_PARAMS / the Int-returning members in nativeMembers.ts) --
   the runtime check here only asks which of Int|Real actually arrived, which no static type can say
   for a gradual value.

   '__ll_hostnum' is the out-edge: .slice(1n) and Math.sqrt(16n) both throw, so an Int argument
   becomes a Number. '__ll_hostint' is the in-edge: .length is typed Int by nativeMembers but hands
   back a Number, and leaving it one would make the static type a lie -- '(x :of Int)' would answer
   Real for a length. */
/* D49d, in the BigInt era. Int / Int IS integer division, decided from the STATIC types at lowering
   (HOperator.intDiv) -- "the static type decides and the runtime never gets a vote". So when the
   compiler emits this, the operands are integers by construction and the division truncates toward
   zero, whatever representation actually arrived.

   That last clause is the point. A gradually-typed .length hands back a host Number, so an operand
   the checker called Int can turn up as one; promoting to Real there would silently make
   (/ lines 10) yield 0.2 and print level 1.2 where the ruling says 1. Converting instead of
   promoting keeps the decision where D49d put it. */
/* JSON.stringify THROWS on a BigInt ("Do not know how to serialize a BigInt"), so under D51 every
   Int[] became unserialisable -- 80-adversarial/spread_in_literals depends on exactly that. JSON has
   no 64-bit integer anyway, so an Int serialises as a JSON number, which is what it did before D51.
   Above 2^53 that loses precision; JSON cannot express the value at all, so there is nothing better
   to do than what every other JSON producer does.

   Patching the prototype rather than passing a replacer because JSON.stringify is reached as a bare
   host global through the std/js extern -- there is no call site the compiler owns to thread an
   argument through. An emitted module is a whole program, and the runtime already shadows console,
   so a global of our own is in keeping. */
if (typeof BigInt !== "undefined" && !BigInt.prototype.toJSON) {
  BigInt.prototype.toJSON = function () { return Number(this); };
}
function __ll_intdiv(a, b) {
  const x = typeof a === "bigint" ? a : BigInt(Math.trunc(Number(a)));
  const y = typeof b === "bigint" ? b : BigInt(Math.trunc(Number(b)));
  return BigInt.asIntN(64, x / y);
}
function __ll_hostnum(x) { return typeof x === "bigint" ? Number(x) : x; }
function __ll_hostint(x) {
  /* INTEGRAL Numbers only. The in-edge is applied by name when the checker could not type the
     receiver (a .length on a gradually-typed value), and "length" is also an ordinary user method
     name -- 06-value-semantics/00_structs has one returning 2.23606797749979. Truncating that to 2n
     would be a silent wrong answer, so a non-integral Number is left exactly as it is. */
  return typeof x === "number" && Number.isInteger(x) ? BigInt(x) : x;
}
/* A map key is stringified on the way in, on both backends (C does it in ll_map_slot via ll_to_str).
   D53's "String keys" is about the key space, not the argument type -- (m[1] := v) has always
   written the key "1", and map-get with 1 must find it. BigInt needs saying explicitly: String(1n)
   is "1", but the default property-key coercion of a BigInt is the same, so this only matters for
   keeping the two paths visibly identical. */
function __ll_map_key(k) { return typeof k === "string" ? k : String(k); }

/* The TOTAL container accessor behind get and elem (D9/D53, F.5).

   Both used to be a raw host property access -- obj?.[key] ?? null -- and JavaScript stringifies
   every property key, so (get v "1") on a VECTOR answered 20 where C answered nil. A key is an Int
   or a String, and which of those a container accepts is a property of the CONTAINER: a vector and a
   String are indexed by position, a map by name. A key of the wrong kind is ABSENT, not an error --
   these are the total half of D9's pair, so they answer nil rather than throwing.

   An integral Number counts as an Int, matching __ll_is_type's case 'int': a literal only becomes
   a BigInt where the checker typed it, so an untyped 1 must still index. That is D51's documented
   gradual collapse, not a new one; a NON-integral Real is nil here and nil on C.

   A String is indexed by CODEPOINT (D52) -- spread, never [i], which hands back half a surrogate
   pair. get is the language's own accessor and follows the language's rule; the native .charAt is
   host interop and is a different question. */
function __ll_container_get(c, k) {
  if (c === null || c === undefined) return null;
  var idx = typeof k === "bigint" ? Number(k)
          : (typeof k === "number" && Number.isInteger(k)) ? k : null;
  if (Array.isArray(c)) {
    return (idx !== null && idx >= 0 && idx < c.length) ? c[idx] : null;
  }
  if (typeof c === "string") {
    if (idx === null) return null;
    var cps = [...c];
    return (idx >= 0 && idx < cps.length) ? cps[idx] : null;
  }
  if (typeof c === "object") {
    var name = typeof k === "string" ? k : (idx !== null ? String(idx) : null);
    if (name === null) return null;
    return Object.prototype.hasOwnProperty.call(c, name) ? c[name] : null;
  }
  return null;
}

/* KNOWN DIVERGENCE from D53, guarded rather than hidden: a plain JS Object does not iterate in
   insertion order. Integer-like keys come FIRST, in ascending numeric order, so { b, a, "10", "2" }
   enumerates as ["2","10","b","a"] while C's ll_map -- an assoc list appended at len -- gives the
   insertion order D53 specifies.

   Not fixed here because the fix is disproportionate. Making a map a real JS Map breaks DOT ACCESS
   ('config.host', 'sloth-profile.stats.charisma'), which compiles to a direct property chain today;
   the corpus has ~1600 dot-access sites against 70 map literals, and the backend frequently cannot
   tell a map receiver from a class instance statically. The alternative -- a parallel insertion-order
   key list -- means instrumenting every map write. Both cost far more than the case is worth while
   nothing iterates an integer-keyed map. See 80-adversarial/map_insertion_order.lisp. */
function __ll_map_keys(m) { return Object.keys(m).filter(function (k) { return k !== "__ll_name"; }); }
function __ll_mix(a, b) {
  if (typeof a === "bigint" && typeof b === "number") return [Number(a), b];
  if (typeof a === "number" && typeof b === "bigint") return [a, Number(b)];
  return [a, b];
}
function __ll_wrap(x) { return typeof x === "bigint" ? BigInt.asIntN(64, x) : x; }
function __ll_deep_eq(a, b) {
  if (a === b) return true;
  // D51: '==' is NUMERIC, so '1 == 1.0' is true -- and with Int as a BigInt, '1n === 1' is false.
  // Strict equality alone would therefore make an Int and a Real of equal value compare unequal,
  // silently. Loose '==' across BigInt/Number is exactly the numeric comparison wanted; it is
  // gated on BOTH sides being numeric so '1n == "1"' (also true in JS) cannot leak in.
  {
    const an = typeof a === "bigint" || typeof a === "number";
    const bn = typeof b === "bigint" || typeof b === "number";
    if (an && bn) return a == b;
  }
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
    // A BigInt index is fine below 2^53 and a SILENT wrong element above it, because Number()
    // rounds. An out-of-range index is a RangeError either way, so say so rather than guess.
    if (typeof key === 'bigint' && (key > 9007199254740991n || key < -9007199254740991n)) {
      throw new RangeError('IndexOutOfRange: ' + String(key) + ' (exceeds safe index range)');
    }
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
    case 'number': return typeof val === 'number' || typeof val === 'bigint';
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
    // D51 buys MOST of the answer this file's comment above says cannot be bought. A BigInt is
    // definitively an Int, so (5.5 :of Int) is finally false and an Int-keyed operator overload
    // finally dispatches. What it does NOT buy is the gradual case: a literal only becomes a BigInt
    // where the checker typed it Int, so an untyped integer arrives as a host Number and must still
    // answer Int -- (match 5 { n :of Int => ... }) regressed to the fallthrough arm without this.
    //
    // So the collapse survives EXACTLY where it did before -- an INTEGRAL Number, which could be
    // either -- and nowhere else. Strictly narrower than the old "every number is both".
    case 'int': return typeof val === 'bigint' || (typeof val === 'number' && Number.isInteger(val));
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
          const [__la, __lb] = __ll_mix(res, next); res = __ll_wrap(__la + __lb);
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
        return __ll_wrap(-val);
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
          const [__la, __lb] = __ll_mix(res, next); res = __ll_wrap(__la - __lb);
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
          const [__la, __lb] = __ll_mix(res, next); res = __ll_wrap(__la * __lb);
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
          const [__la, __lb] = __ll_mix(res, next); res = __ll_wrap(__la / __lb);
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
    "%": `const ${encodeIdentifier('%')}  = (a, b) => { const [x, y] = __ll_mix(a, b); return __ll_wrap(x % y); };`,
    
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
    // TOTAL, and the key is NOT coerced (D9/D53, F.5). This was `obj?.[key] ?? null`, i.e. a raw
    // host property access -- so `(get v "1")` on a VECTOR answered 20, because JavaScript stringifies
    // every property key and "1" and 1 are the same property. C answered nil. A key is an Int or a
    // String, and which one a container accepts is a property of the CONTAINER: a vector and a String
    // are indexed by position, a map by name. A key of the wrong kind is absent, not an error.
    //
    // An INT key on a MAP still stringifies -- that is D53 (Fg-2), which rules the key space to be
    // String and both runtimes to stringify on the way in.
    //
    // An integral Number counts as an Int here, matching `__ll_is_type`'s `case 'int'`: a literal
    // only becomes a BigInt where the checker typed it, so an untyped 1 must still index. That is
    // D51's documented gradual collapse, not a new one -- and a NON-integral Real is nil on both.
    //
    // A String is indexed by CODEPOINT (D52): spread, never [i], which would hand back half a
    // surrogate pair. `get` is the language's own accessor, so it follows the language's rule; the
    // native `.charAt` is host interop and is not this.
    "get": `const get = (c, k) => __ll_container_get(c, k);`,
    // D9: `head []` returned THE ARRAY ITSELF -- so `(head [])` was `[]`, and asking "did I get
    // anything?" was unanswerable. It is nil. DECISIONS.md:84 cites exactly this ("optionals, so
    // `first`/`last` can be typed honestly") as why D9 must precede a typed stdlib: `head` is the
    // canonical `T?` producer, and it could not be typed while it lied about the empty case.
    // `tail []` is `[]`, which is the true answer, and is left alone.
    "head": `const head = (a) => (Array.isArray(a) && a.length > 0) ? a[0] : null;`,
    // An EMPTY array for a non-array, not the argument. The floor declares `tail : Any -> Array`,
    // and returning the receiver made that false: `(tail {:a 1})` handed back the map, so
    // `(tail x).length` was nil rather than 0.
    "tail": `const tail = (a) => (Array.isArray(a) && a.length > 0) ? a.slice(1) : [];`,
    // `=== undefined` was blind to null -- so `(empty nil)` was FALSE, and once nil is `null` (D9c)
    // it would have been blind to every bottom value the language emits.
    "empty": `const empty = (a) => a == null || (Array.isArray(a) && a.length === 0);`,
    // Total, like `get`. It was `a[i]`, which hands back `undefined` for a miss -- and `undefined` is
    // no longer a value this language has.
    "elem": `const elem = (c, k) => __ll_container_get(c, k);`,
    "list": `const list = (...args) => [...args];`,
    // The i/o SINK (Fb, FLOOR.md 2). Raw bytes, no newline -- `console.log` and `print` are layers
    // over it. This is what makes a PARTIAL line expressible at all: before it, every route out of
    // the language appended a newline.
    // The renderer (FLOOR.md 3.5), so l-lang above the floor renders the spec'd way rather than
    // falling back to `+` concat's ToString shapes.
    "display": `const display = (v) => __ll_display(v);`,
    // The map floor (D53). A map is a plain JS Object -- see the note on __ll_map_keys for why the
    // representation was NOT changed to a Map, and what that costs.
    "map-get": `const map2dget = (m, k) => { const s = __ll_map_key(k); return Object.prototype.hasOwnProperty.call(m, s) ? m[s] : null; };`,
    "map-set": `const map2dset = (m, k, v) => { m[__ll_map_key(k)] = v; return null; };`,
    "map-has": `const map2dhas = (m, k) => Object.prototype.hasOwnProperty.call(m, __ll_map_key(k));`,
    "map-delete": `const map2ddelete = (m, k) => { const s = __ll_map_key(k); const had = Object.prototype.hasOwnProperty.call(m, s); delete m[s]; return had; };`,
    "map-keys": `const map2dkeys = (m) => __ll_map_keys(m);`,
    "write-string": `const write2dstring = (s) => { __ll_write_string(String(s)); };`,
    "write-string-err": `const write2dstring2derr = (s) => { __ll_write_string_err(String(s)); };`,
    // The PROCESS floor. `process` is node-only, so each guards -- a program that never asks for its
    // arguments must still run in a browser or a bare VM, which is where the corpus's p5js examples
    // live. Absent host -> the honest empty answer, never a crash at load.
    //
    // `argv.slice(2)` drops the interpreter and the script path, so `args` is what the USER passed,
    // matching what a C program sees at `argv[1..]` after the same subtraction in `ll_sys_args`. The
    // two backends must agree on that offset or every index into `args` is off by one on one of them.
    //
    // Int in, host Number out: `sys-exit` is typed `[Int] -> Void`, so the argument arrives as a
    // BigInt under D51 and `process.exit` will not take one.
    // The FILE floor. The handle is an INT file descriptor, which is what `fs.openSync` already
    // returns -- so the same Int means the same open file on both backends, with no translation.
    //
    // TOTAL, matching C: -1 for a failed open, null at EOF, -1 for a failed write. The throwing half
    // of the API is l-lang, in `std/io/files`.
    //
    // `__ll_fs` is required LAZILY and guarded: a program that never touches a file must still run in
    // a browser or a bare VM, which is where the corpus's p5js examples live.
    //
    // The read EXTENDS to complete a trailing multi-byte UTF-8 sequence, exactly as C does. Decoding
    // a Buffer that ends mid-sequence yields U+FFFD, so without this a chunked read of a non-ASCII
    // file would corrupt one codepoint per chunk boundary -- silently, and only for input the corpus
    // does not have.
    "file-open": `const file2dopen = (p, m) => { const fs = __ll_fs(); if (!fs) return -1n; try { return BigInt(fs.openSync(String(p), String(m))); } catch (e) { return -1n; } };`,
    "file-close": `const file2dclose = (fd) => { const fs = __ll_fs(); if (!fs) return null; try { fs.closeSync(Number(fd)); } catch (e) { /* already closed */ } return null; };`,
    "file-read": `const file2dread = (fd, n) => {
  const fs = __ll_fs(); if (!fs) return null;
  const want = Number(n); if (Number(fd) < 0 || want <= 0) return null;
  const buf = Buffer.alloc(want + 4);
  let len = 0;
  try { len = fs.readSync(Number(fd), buf, 0, want, null); } catch (e) { return null; }
  if (len <= 0) return null;
  let need = __ll_utf8_want(buf, len);
  while (need > 0 && len < buf.length) {
    let more = 0;
    try { more = fs.readSync(Number(fd), buf, len, need, null); } catch (e) { break; }
    if (more <= 0) break;
    len += more;
    need = __ll_utf8_want(buf, len);
  }
  return buf.slice(0, len).toString('utf8');
};`,
    "file-write": `const file2dwrite = (fd, s) => { const fs = __ll_fs(); if (!fs) return -1n; try { return BigInt(fs.writeSync(Number(fd), String(s))); } catch (e) { return -1n; } };`,
    "file-exists": `const file2dexists = (p) => { const fs = __ll_fs(); if (!fs) return false; try { fs.accessSync(String(p)); return true; } catch (e) { return false; } };`,
    "sys-arg": `const sys2darg = (i) => { const a = (typeof process !== "undefined" && process.argv) ? process.argv.slice(2) : []; const n = Number(i); return (n >= 0 && n < a.length) ? a[n] : null; };`,
    "sys-env": `const sys2denv = (n) => { if (typeof process === "undefined" || !process.env) return null; const v = process.env[String(n)]; return v === undefined ? null : v; };`,
    "sys-exit": `const sys2dexit = (c) => { const n = Number(c); if (typeof process !== "undefined" && process.exit) process.exit(n); throw new Error("exit " + n); };`,
    // The CODEPOINT floor (D52). Every one of these spreads the string -- \`[...s]\` iterates SCALAR
    // VALUES, pairing surrogates -- and NONE of them touches \`.length\`, which counts UTF-16 code
    // units and is the reason \`"a\\u{1F600}b"\` measured 4 here where D52 says 3.
    //
    // BigInt out, explicitly. These are typed \`-> Int\` on the floor, and \`asHostInt\`'s in-edge only
    // fires on member reads -- a floor CALL is not wrapped -- so returning a host Number would leave
    // an Int-typed value that is not one, which \`==\` against a real Int would then answer wrong for
    // (see native_search_numeric.lisp for that exact failure in the other direction).
    //
    // O(n) per call, and knowingly: a codepoint index into UTF-8 is a walk on C too. \`std/string\`
    // above this scans once and indexes by position, so the quadratic shape stays in one place.
    "codepoint-length": `const codepoint2dlength = (s) => BigInt([...String(s)].length);`,
    "codepoint-at": `const codepoint2dat = (s, i) => {
  const a = [...String(s)];
  const k = Number(i);
  return k >= 0 && k < a.length ? BigInt(a[k].codePointAt(0)) : -1n;
};`,
    "string-to-codepoints": `const string2dto2dcodepoints = (s) => [...String(s)].map((c) => BigInt(c.codePointAt(0)));`,
    "string-from-codepoints": `const string2dfrom2dcodepoints = (cps) => {
  let out = "";
  for (const c of cps) {
    const n = Number(c);
    // Mirrors runtime.c's ll_sb_put_cp: a surrogate or an out-of-range value is not a scalar value
    // and has no encoding, so both sides answer U+FFFD rather than throwing on one and not the other.
    out += (n < 0 || n > 0x10FFFF || (n >= 0xD800 && n <= 0xDFFF)) ? "\\uFFFD" : String.fromCodePoint(n);
  }
  return out;
};`,

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
    // Advance a cursor, honouring D30: `next` returns `T?` (the value, or nil when done). A hand-written
    // `:implements Iterator` already returns `T?` and passes straight through. But a `:gen` compiles to a
    // JS `function*`, whose `.next()` returns the ITERATOR-RESULT record `{value, done}` -- forwarding
    // THAT (TY3) made `(next gen)` an object, never nil, so the documented `(while (!= v nil) ...)`
    // exhaustion loop never terminated. Unwrap the record (recognised by a boolean `done`): value, or
    // nil when done.
    "next": `const next = (it) => {
  if (it == null || typeof it.next !== 'function') return null;
  const r = it.next();
  return (r != null && typeof r === 'object' && typeof r.done === 'boolean')
    ? (r.done ? null : r.value)
    : r;
};`,

    // Opt-in DEEP copy (CP3, games). The default struct copy (`__ll_copy`) is shallow-at-reference,
    // C#-style and goldened: it recurses a struct's own fields but returns an ARRAY unchanged, so
    // `(let snap world)` copies the player but SHARES the boxes -- a half-working undo. `deep-copy`
    // recurses through arrays AND nested structs, so an undo snapshot is truly independent. CLASS
    // instances (reference types) and plain values are returned as-is, deliberately: deep-copy honours
    // the value/reference split, it does not erase it. The DEFINED name is `encodeIdentifier` of the
    // source name; the KEY stays the source name (the LL0210 exemption).
    "deep-copy": `const deep2dcopy = (v) => {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(deep2dcopy);
  if (v.constructor && v.constructor.__ll_struct === true) {
    const out = Object.create(Object.getPrototypeOf(v), Object.getOwnPropertyDescriptors(v));
    for (const k of Object.keys(out)) out[k] = deep2dcopy(out[k]);
    return out;
  }
  return v;
};`,

    // Call wrapper
    "call": `const call = (f, args) => !!args && Array.isArray(args) ? f(...args) : f();`,
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
    //
    // SHAPED AFTER C's \`ll_type\`, deliberately (Lb). Both are now the same two steps -- NAME the
    // value from its runtime representation, then look that name up in the shared metadata graph --
    // and \`ll_meta_or\` is \`meta\` below, argument for argument. They diverged for as long as they were
    // two different algorithms: the fallbacks are where two runtimes are least alike, and this used
    // to be almost entirely fallback.
    "type": `const type = (v) => {
  // The exact fallback C's \`ll_meta_or\` builds, for a name the graph does not carry. With Nil,
  // Array, Map and Function now seeded it is reached only by a class whose metadata was suppressed.
  const meta = (n, k) => __ll_type_metadata[n] || { name: n, kind: k, properties: [], methods: [], generics: [] };

  if (v === null || v === undefined) return meta('Nil', 'primitive');   // D9: one bottom value
  if (Array.isArray(v)) return meta('Array', 'container');

  // A function VALUE. Its own declaration wins; a lambda's host-derived name is DISCARDED rather
  // than reported, because C cannot know it and a name only one backend can produce is a divergence
  // wearing a useful answer's clothes. \`(let f (fn [x] ...))\` read \`{name:'f', kind:'class'}\` on JS
  // -- the binding's name, and the wrong kind besides -- against \`Function\` on C.
  if (typeof v === 'function') {
    const declared = v.__ll_name || v.name;
    return (declared && __ll_type_metadata[declared]) || meta('Function', 'function');
  }

  if (typeof v === 'object') {
    // __ll_name FIRST, constructor.name only as a fallback -- the same order __ll_is_type uses, and
    // for the same reason (Zh). An import is INLINED under a mangled JS name, so \`constructor.name\`
    // is the MANGLER's name: \`(type m)\` on an imported Money reported \`__ll_inlined_Money_1\`, a name
    // that appears nowhere in the user's source. It also missed the metadata lookup -- which is keyed
    // on the SOURCE name -- so it silently fell through to the reflected fallback, losing every
    // method and generic. \`__ll_name\` is the source of truth; the JS binding's name is not.
    const cls = v.constructor?.__ll_name || v.constructor?.name;
    // No class, or the host's bare \`Object\`: this is an l-lang MAP, and its name is \`Map\`.
    return !cls || cls === 'Object' ? meta('Map', 'container') : meta(cls, 'object');
  }

  // A PRIMITIVE the static channel could not name -- and the runtime now CAN (Lb).
  //
  // This arm used to answer \`{name:'Unknown'}\` on principle: "typeof says number but never
  // Int-vs-Real, string but never String-vs-Char, so it does not guess." That reasoning was true
  // when it was written and both halves have since expired. D51 made an Int a **BigInt**, so
  // \`typeof\` separates Int from Real exactly -- \`lib/std/types\`' \`is-int\` has been reading it that
  // way ever since. And Char is unconstructible: the reader has no Char literal (FLOOR.md 3.5), so
  // no value here is ever one. Nothing is being guessed; this reads the representation D51 chose,
  // which is the same thing C's tag switch does one line up.
  //
  // The cost of the refusal was a live divergence, not just a vaguer answer: C named these
  // correctly from its tag, so every dynamically-typed \`(type x)\` disagreed across the backends.
  const n = typeof v === 'bigint' ? 'Int' : typeof v === 'number' ? 'Real'
    : typeof v === 'string' ? 'String' : typeof v === 'boolean' ? 'Boolean' : 'Unknown';
  return meta(n, 'unknown');
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
${LL_INSPECT_JS}
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

  /**
   * Every name the JS shim DEFINES. The other half of the floor's conformance question.
   *
   * `intrinsics.ts` derives C's view from the floor, so a floor entry cannot be unknown to the C code
   * generator -- that is what D50 bought. The JS side had no such link: SYMBOL_MAP is the floor's JS
   * BACKEND, exactly as `runtime.c` is its C one, and nothing checked that the two halves cover the
   * same names. A floor entry with no JS implementation was a ReferenceError at run time, found by
   * running the program.
   *
   * Exposed so `test:codegen` can ask. Not used at compile time -- the shim is selected by name as it
   * always was.
   */
  public static definedSymbols(): string[] {
    return Object.keys(this.SYMBOL_MAP);
  }

  public static isRuntimeReference(symbol: SymbolName): boolean {
    return symbol in this.SYMBOL_MAP;
  }
}