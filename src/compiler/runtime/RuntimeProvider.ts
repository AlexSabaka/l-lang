import { VERSION } from "../Context";
import { encodeIdentifier } from "../utils/encodeIdentifier";

type SymbolName = string;

export class RuntimeProvider {

  private static readonly LL_RUNTIME: string = `const _util = require("util");
let _readline = null;
try { _readline = require("readline-sync"); } catch (e) { /* optional */ }
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
  switch (type) {
    case 'number': return typeof val === 'number';
    case 'string': return typeof val === 'string';
    case 'boolean': return typeof val === 'boolean';
    case 'function': return typeof val === 'function';
    case 'array': return Array.isArray(val);
    case 'object': return typeof val === 'object' && val !== null && !Array.isArray(val);
    case 'null': return val === null;
    case 'undefined': return val === undefined;
    case 'any': return true;
    default:
      try {
        // Check for named classes (globals)
        return val instanceof eval(type); 
      } catch { return false; }
  }
}`;

  /**
   * Map of individual runtime symbols and their implementations
   */
  private static readonly SYMBOL_MAP: Record<SymbolName, string> = {
    // Core Operators
    "!": `const ${encodeIdentifier('!')} = (a) => !a;`,
    "==": `const ${encodeIdentifier('==')} = (a, b) => __ll_deep_eq(a, b);`,
    "!=": `const ${encodeIdentifier('!=')} = (a, b) => !__ll_deep_eq(a, b);`,
    "≠": `const ${encodeIdentifier('≠')}  = (a, b) => !__ll_deep_eq(a, b);`,
    "+": `const ${encodeIdentifier('+')} = (...args) => args.reduce((a, b) => a + b);`,
    "-": `const ${encodeIdentifier('-')} = (...args) => args.reduce((a, b) => a - b);`,
    "*": `const ${encodeIdentifier('*')} = (...args) => args.reduce((a, b) => a * b);`,
    "/": `const ${encodeIdentifier('/')} = (...args) => args.reduce((a, b) => a / b);`,
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
    "call": `const call = (f, args) => f(...args);`,
    "eval": ``,
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
   * @returns Generated runtime preamble string
   */
  public static getRuntimeShimForSymbols(symbols: SymbolName[]): string {
    const symbolDefinitions = symbols
      .filter(symbol => symbol in this.SYMBOL_MAP)
      .map(symbol => this.SYMBOL_MAP[symbol])
      .join('\n');

    return `
/**
 * 🦥 l-lang Runtime Preamble
 * Auto-generated by l-lang ${VERSION} compiler
 */
"use strict";
${this.LL_RUNTIME}
${symbolDefinitions}
`;
  }

  public static isRuntimeReference(symbol: SymbolName): boolean {
    return symbol in this.SYMBOL_MAP;
  } 
}