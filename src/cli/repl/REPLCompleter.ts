/**
 * Intelligent autocomplete for l-lang REPL
 * Provides context-aware completion for keywords, symbols, and member access
 */

import { SymbolTable } from "../../compiler/analysis/SymbolTable";
import { Context } from "../../compiler/Context";

// L-lang keywords for completion
const KEYWORDS = [
  'defclass', 'definterface', 'deftype', 'defenum', 'defstruct',
  'fn', 'let', 'mut', 'const',
  'if', 'when', 'cond', 'match', 'case',
  'for', 'while', 'do', 'loop',
  'try', 'catch', 'finally', 'throw',
  'return', 'break', 'continue',
  'import', 'export', 'from', 'as',
  'namespace', 'module',
  'async', 'await',
  'new', 'this', 'super',
];

const MODIFIERS = [
  ':implements', ':extends', ':where',
  ':cond', ':then', ':else',
  ':init', ':step', ':each', ':from',
  ':public', ':private', ':protected', ':internal',
  ':static', ':readonly', ':extern', ':ctor'
];

const BUILT_INS = [
  'console', 'console.log', 'console.error', 'console.warn',
  'Math', 'Math.sqrt', 'Math.random', 'Math.floor', 'Math.ceil',
  'Array', 'Object', 'String', 'Number',
  'head', 'tail', 'get', 'set!', 'list', 'cons',
  'map', 'filter', 'reduce', 'fold',
  'type', 'typeof', 'instanceof',
  'nil', 'null', 'undefined', '#t', '#f'
];

const COMMON_METHODS = [
  'toString', 'valueOf', 'length', 'push', 'pop', 'shift', 'unshift',
  'slice', 'splice', 'concat', 'join', 'reverse', 'sort',
  'keys', 'values', 'entries', 'hasOwnProperty'
];

export class REPLCompleter {
  private context: Context | null = null;
  private symbolTable: SymbolTable | null = null;

  constructor(context?: Context) {
    if (context) {
      this.updateContext(context);
    }
  }

  /**
   * Update the context and symbol table for completion
   */
  updateContext(context: Context): void {
    this.context = context;
    this.symbolTable = context.symbolTable;
  }

  /**
   * Get completions for the current line
   * Returns [completions[], originalString]
   */
  getCompletions(line: string): [string[], string] {
    const trimmed = line.trim();
    
    // Empty line - show all available options
    if (!trimmed) {
      return [this.getAllCompletions(), line];
    }

    // Get the last token to complete
    const lastToken = this.getLastToken(trimmed);
    
    // Check for member access (obj.prop)
    if (lastToken.includes('.')) {
      return [this.getMemberCompletions(lastToken), lastToken];
    }

    // Check if we're inside a list (after opening paren)
    if (this.isInsideList(trimmed)) {
      const token = this.getLastToken(trimmed);
      return [this.getKeywordCompletions(token), token];
    }

    // General completion (keywords + symbols + built-ins)
    return [this.getAllMatchingCompletions(lastToken), lastToken];
  }

  /**
   * Get all available completions (for empty input)
   */
  private getAllCompletions(): string[] {
    const all = [
      ...KEYWORDS,
      ...MODIFIERS,
      ...BUILT_INS,
      ...this.getSymbolNames()
    ];
    return [...new Set(all)].sort();
  }

  /**
   * Get completions matching a prefix
   */
  private getAllMatchingCompletions(prefix: string): string[] {
    const all = this.getAllCompletions();
    return all.filter(item => item.startsWith(prefix));
  }

  /**
   * Get keyword completions (for use after opening paren)
   */
  private getKeywordCompletions(prefix: string): string[] {
    const keywords = [...KEYWORDS, ...BUILT_INS];
    return keywords.filter(kw => kw.startsWith(prefix));
  }

  /**
   * Get member access completions (obj.prop)
   */
  private getMemberCompletions(expr: string): string[] {
    const parts = expr.split('.');
    const prefix = parts[parts.length - 1];
    const objectPath = parts.slice(0, -1).join('.');

    // Try to resolve the object type from symbol table
    if (this.symbolTable && objectPath) {
      const symbol = this.symbolTable.resolveSymbol(objectPath);
      if (symbol?.inferredType) {
        const members = this.getTypeMembers(symbol.inferredType);
        return members.filter(m => m.startsWith(prefix));
      }
    }

    // Fallback to common JavaScript methods
    return COMMON_METHODS.filter(m => m.startsWith(prefix));
  }

  /**
   * Get member names from a type
   */
  private getTypeMembers(type: any): string[] {
    // If it's a class type, get its methods and properties
    if (type.kind === 'class' && type.members) {
      return Object.keys(type.members);
    }

    // If it's a known built-in type, return common methods
    if (type.kind === 'primitive') {
      const typeName = type.name;
      if (typeName === 'String') {
        return ['length', 'charAt', 'concat', 'indexOf', 'slice', 'split', 'toLowerCase', 'toUpperCase', 'trim'];
      }
      if (typeName === 'Array' || typeName === 'List') {
        return ['length', 'push', 'pop', 'shift', 'unshift', 'slice', 'map', 'filter', 'reduce'];
      }
      if (typeName === 'Number' || typeName === 'Int' || typeName === 'Float') {
        return ['toString', 'toFixed', 'toPrecision'];
      }
    }

    return COMMON_METHODS;
  }

  /**
   * Get all symbol names from the symbol table
   */
  private getSymbolNames(): string[] {
    if (!this.symbolTable) {
      return [];
    }

    const allSymbols = this.symbolTable.getAllSymbols();
    return Array.from(allSymbols.keys());
  }

  /**
   * Extract the last token from a line
   */
  private getLastToken(line: string): string {
    // Remove content inside strings and comments
    const cleaned = line.replace(/"[^"]*"/g, '').replace(/;.*/g, '');
    
    // Match the last word-like sequence (including dots and hyphens)
    const match = cleaned.match(/[a-zA-Z0-9._:-]+$/);
    return match ? match[0] : '';
  }

  /**
   * Check if we're inside a list (after opening paren)
   */
  private isInsideList(line: string): boolean {
    let parenCount = 0;
    let inString = false;
    
    for (const char of line) {
      if (char === '"' || char === "'") {
        inString = !inString;
      }
      if (!inString) {
        if (char === '(') parenCount++;
        if (char === ')') parenCount--;
      }
    }
    
    return parenCount > 0;
  }
}
