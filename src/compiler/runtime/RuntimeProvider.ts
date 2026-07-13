import { VERSION } from "../Context";
import { encodeIdentifier } from "../utils/encodeIdentifier";

type SymbolName = string;

export class RuntimeProvider {

  // Global type metadata storage
  public static readonly TYPES_METADATA_VAR = '__ll_type_metadata';

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
function __ll_match_list(val, patterns) {
  if (!Array.isArray(val)) return false;
  if (val.length !== patterns.length) return false;
  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i];
    const value = val[i];
    if (pattern === null || pattern === undefined) continue; // Wildcard
    // Handle Type Pattern: { type: 'string' }
    // Note: The transformer generates these objects for typed patterns
    if (typeof pattern === 'object' && pattern.type && pattern.__is_type_check) {
       if (!__ll_is_type(value, pattern.type)) return false;
    }
    // Handle Recursive List Pattern
    else if (Array.isArray(pattern)) {
       if (!__ll_match_list(value, pattern)) return false;
    }
    // Handle Object Pattern (Deep match)
    else if (typeof pattern === 'object') {
       // Deep equality for objects in list patterns? Or recursive struct match?
       // For now, let's assume recursive struct match
       if (!__ll_match_struct(value, pattern)) return false;
    }
    // Constant
    else {
       if (value !== pattern) return false;
    }
  }
  return true;
}
function __ll_match_struct(val, patterns) {
  if (typeof val !== 'object' || val === null) return false;

  for (const key in patterns) {
    if (!(key in val)) return false; // Key existence check

    const pattern = patterns[key];
    const value = val[key];

    if (pattern === null || pattern === undefined) continue;

    if (typeof pattern === 'object' && pattern.type && pattern.__is_type_check) {
       if (!__ll_is_type(value, pattern.type)) return false;
    } 
    else if (Array.isArray(pattern)) {
       if (!__ll_match_list(value, pattern)) return false;
    }
    else if (typeof pattern === 'object') {
       if (!__ll_match_struct(value, pattern)) return false;
    } 
    else {
       if (value !== pattern) return false;
    }
  }
  return true;
}
function __ll_is_type(val, type) {
  const t = type.toLowerCase();
  switch (t) {
    case 'number': return typeof val === 'number';
    case 'int': return typeof val === 'number';
    case 'float': return typeof val === 'number';
    case 'string': return typeof val === 'string';
    case 'boolean': return typeof val === 'boolean';
    case 'bool': return typeof val === 'boolean';
    case 'function': return typeof val === 'function';
    case 'array': return Array.isArray(val);
    case 'object': return typeof val === 'object' && val !== null && !Array.isArray(val);
    case 'null': return val === null;
    case 'undefined': return val === undefined;
    case 'any': return true;
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
    "set!": `const ${encodeIdentifier('set!')} = (obj, key, val) => { obj[key] = val; return val; };`,
    "set?": `const ${encodeIdentifier('set?')} = (obj, key) => { return obj[key] !== undefined && obj[key] !== null; };`,
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
    "cons": `const cons = (...args) => args.reduce((acc, curr) => Array.isArray(curr) ? [...acc, ...curr] : [...acc, curr], []);`,
    "list": `const list = (...args) => [...args];`,

    // Call wrapper
    "call": `const call = (f, args) => !!args && Array.isArray(args) ? f(...args) : f();`,
    "eval": ``,
    "type": `const type = (typeNameOrObj) => {
  // If it's a string, look up the type metadata
  if (typeof typeNameOrObj === 'string') {
    return __ll_type_metadata[typeNameOrObj] || { name: typeNameOrObj, kind: 'unknown', properties: [], methods: [], generics: [] };
  }
  // If it's an object (instance), try to get its type
  if (typeof typeNameOrObj === 'object' && typeNameOrObj !== null) {
    const typeName = typeNameOrObj.constructor?.name || 'Object';
    return __ll_type_metadata[typeName] || { name: typeName, kind: 'object', properties: Object.keys(typeNameOrObj), methods: [], generics: [] };
  }
  // If it's a function (class), get its type
  if (typeof typeNameOrObj === 'function') {
    const typeName = typeNameOrObj.name;
    return __ll_type_metadata[typeName] || { name: typeName, kind: 'class', properties: [], methods: [], generics: [] };
  }
  return { kind: 'unknown', properties: [], methods: [], generics: [] };
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
   * `get`, `head`, `tail`, `empty`, `elem`, `cons`, `list`, `call`, `eval`, `type`, `set!`, `set?`.
   * These are what a real stdlib (D7) must provide, at which point they leave the code generator
   * entirely. An import of the same name legitimately shadows them, and must keep doing so.
   */
  public static isRuntimeFunction(symbol: SymbolName): boolean {
    return symbol in this.SYMBOL_MAP && !this.isOperatorSymbol(symbol);
  }

  public static isRuntimeReference(symbol: SymbolName): boolean {
    return symbol in this.SYMBOL_MAP;
  }
}