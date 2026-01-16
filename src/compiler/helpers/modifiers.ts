import * as ast from "../frontend/ast";

/**
 * Centralized modifier constants and utilities
 * Supports both built-in modifiers and arbitrary custom modifiers
 */

export const VISIBILITY_MODIFIERS = ["public", "private", "protected", "internal"] as const;
export const PARAMETER_MODIFIERS = ["in", "out", "ref"] as const;
export const CLASS_MODIFIERS = ["static", "override", "extern"] as const;
export const TYPE_MODIFIERS = ["explicit-cast", "implicit-cast", "nullable", "readonly"] as const;
export const FUNCTION_MODIFIERS = ["extension", "operator", "comptime", "async"] as const;
export const MEMBER_MODIFIERS = ["ctor"] as const;

export const BUILTIN_MODIFIERS = [
  ...VISIBILITY_MODIFIERS,
  ...PARAMETER_MODIFIERS,
  ...CLASS_MODIFIERS,
  ...TYPE_MODIFIERS,
  ...FUNCTION_MODIFIERS,
  ...MEMBER_MODIFIERS,
] as const;

export type SymbolVisibility = typeof VISIBILITY_MODIFIERS[number];
export type BuiltinModifier = typeof BUILTIN_MODIFIERS[number];

/**
 * Check if a modifier is present in a list of modifiers
 * Handles both `:modifier` and `modifier` formats for backward compatibility
 */
export function hasModifier(modifiers: ast.ModifierNode[], name: string): boolean {
  return modifiers.some(m => 
    m.modifier === name || 
    m.modifier === `:${name}` ||
    m.modifier.replace(/^:/, '') === name
  );
}

/**
 * Get all modifier names from a list, normalized (without colon prefix)
 */
export function getModifierNames(modifiers: ast.ModifierNode[]): string[] {
  return modifiers.map(m => m.modifier.replace(/^:/, ''));
}

/**
 * Get the visibility modifier from a list of modifiers
 * Returns 'internal' as default if no visibility modifier is found
 */
export function getVisibility(modifiers: ast.ModifierNode[]): SymbolVisibility {
  const found = modifiers.find(m => {
    const normalized = m.modifier.replace(/^:/, '');
    return VISIBILITY_MODIFIERS.includes(normalized as any);
  });
  
  if (found) {
    return found.modifier.replace(/^:/, '') as SymbolVisibility;
  }
  
  return "internal";
}

/**
 * Check if a modifier string is a visibility modifier
 */
export function isVisibilityModifier(modifier: string): modifier is SymbolVisibility {
  const normalized = modifier.replace(/^:/, '');
  return VISIBILITY_MODIFIERS.includes(normalized as any);
}

/**
 * Check if a modifier string is a built-in modifier
 */
export function isBuiltinModifier(modifier: string): modifier is BuiltinModifier {
  const normalized = modifier.replace(/^:/, '');
  return BUILTIN_MODIFIERS.includes(normalized as any);
}

/**
 * Get modifier arguments if the modifier supports them
 * For future use when we implement parameterized modifiers like :memoized[cache-size 100]
 */
export function getModifierArgs(modifiers: ast.ModifierNode[], name: string): ast.ASTNode[] | undefined {
  const found = modifiers.find(m => 
    m.modifier === name || 
    m.modifier === `:${name}` ||
    m.modifier.replace(/^:/, '') === name
  );
  
  // Note: args property will be added to ModifierNode in AST update
  return (found as any)?.args;
}

/**
 * Create a new modifier node (for programmatic AST generation)
 */
export function createModifier(name: string, args?: ast.ASTNode[]): ast.ModifierNode {
  return {
    _type: "modifier",
    modifier: name,
    args,
    _location: { source: undefined, start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 } },
    _parent: undefined
  } as any;
}

/**
 * Filter modifiers by type
 */
export function getModifiersByType(modifiers: ast.ModifierNode[]) {
  const names = getModifierNames(modifiers);
  
  return {
    visibility: names.filter(name => VISIBILITY_MODIFIERS.includes(name as any)),
    parameters: names.filter(name => PARAMETER_MODIFIERS.includes(name as any)),
    class: names.filter(name => CLASS_MODIFIERS.includes(name as any)),
    type: names.filter(name => TYPE_MODIFIERS.includes(name as any)),
    function: names.filter(name => FUNCTION_MODIFIERS.includes(name as any)),
    member: names.filter(name => MEMBER_MODIFIERS.includes(name as any)),
    custom: names.filter(name => !BUILTIN_MODIFIERS.includes(name as any)),
  };
}