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
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
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
      // Check constructor name (handles classes/structs even in IIFE)
      let current = val;
      while (current) {
        if (current.constructor && current.constructor.name === type) return true;
        // Also check l-lang specific type metadata if available
        if (current.__ll_type === type) return true;
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
    "get": `const get = (obj, key) => obj[key];`,
    "head": `const head = (a) => (Array.isArray(a) && a.length > 0) ? a[0] : a;`,
    "tail": `const tail = (a) => (Array.isArray(a) && a.length > 0) ? a.slice(1) : a;`,
    "empty": `const empty = (a) => a === undefined || (Array.isArray(a) && a.length === 0);`,
    "elem": `const elem = (a, i) => a[i];`,
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

  public static isRuntimeReference(symbol: SymbolName): boolean {
    return symbol in this.SYMBOL_MAP;
  } 
}