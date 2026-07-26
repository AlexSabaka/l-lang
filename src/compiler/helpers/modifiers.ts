import * as ast from "../frontend/ast";

/**
 * Centralized modifier constants and utilities
 * Supports both built-in modifiers and arbitrary custom modifiers
 */

// No `protected` (Phase M / Mc). It was a no-op -- written to reflection metadata and enforced by
// NOTHING, exactly as `:nullable` was before D9 removed it. It is also the tool of implementation
// inheritance, the part of classical OOP that modern design (Go, Rust, "composition over inheritance")
// deliberately dropped: a second, hidden contract that subclasses couple to. The three levels that
// remain are the package-scoped ones -- `public` (exported, crosses the package), `internal` (the
// default: visible within the package), `private` (file-, or for a member, type-scoped). D4/LL0015
// refuses `:protected` by name now; the corpus never used it.
export const VISIBILITY_MODIFIERS = ["public", "private", "internal"] as const;
export const PARAMETER_MODIFIERS = ["in", "out", "ref"] as const;
export const CLASS_MODIFIERS = ["static", "override", "extern"] as const;
// No `nullable` (D9). It was accepted as a modifier name and read by NOTHING -- so `(let :nullable x
// <- String)` compiled clean and meant exactly as much as writing nothing. Optionality is spelled
// `T?`, in the type, where the checker can see it. D4/LL0015 refuses `:nullable` by name now; the
// corpus never used it.
export const TYPE_MODIFIERS = ["explicit-cast", "implicit-cast", "readonly"] as const;
export const FUNCTION_MODIFIERS = ["extension", "operator", "comptime", "async", "gen"] as const;
export const MEMBER_MODIFIERS = ["ctor"] as const;
// D46/B-3: the two forms a `defcast` conversion can take. `:implicit` fires at coercion sites, chosen
// by the compiler; `:explicit` only ever fires at a written `(cast<T> x)`. Distinct from the older
// `implicit-cast`/`explicit-cast` names in TYPE_MODIFIERS, which sit on the VARIABLE construct and
// have never had a consumer -- these are the ratified spelling and they ride the function a defcast
// rewrites into.
export const CAST_MODIFIERS = ["implicit", "explicit"] as const;

export const BUILTIN_MODIFIERS = [
  ...VISIBILITY_MODIFIERS,
  ...PARAMETER_MODIFIERS,
  ...CLASS_MODIFIERS,
  ...TYPE_MODIFIERS,
  ...FUNCTION_MODIFIERS,
  ...MEMBER_MODIFIERS,
  ...CAST_MODIFIERS,
] as const;

/**
 * D15: claimed for the eventual native backend. These PARSE, but are a hard error on a JS
 * target -- never silently ignored, which is what they are today.
 */
export const RESERVED_NATIVE_MODIFIERS = ["gc", "stack", "manual", "destructor"] as const;

export type SymbolVisibility = typeof VISIBILITY_MODIFIERS[number];
export type BuiltinModifier = typeof BUILTIN_MODIFIERS[number];

/**
 * D4: which builtin modifiers may appear on which construct.
 *
 * The sets are derived from what the corpus actually uses, widened to the documented groups --
 * deliberately not narrower. The point of D4 is to reject modifier names that mean NOTHING
 * (`:inline`, `:bogus`), not to relitigate which construct may carry `:static`. Tightening the
 * per-construct split is a separate, evidence-led change.
 *
 * Note `comptime` and `ctor` legitimately appear on BOTH functions and variables in the corpus
 * (`(let :comptime x ...)`, `(let :ctor x <- Real 0)`), which is why they are in both sets.
 */
const FUNCTION_CONSTRUCT = [
  ...CAST_MODIFIERS,
  ...FUNCTION_MODIFIERS,
  ...VISIBILITY_MODIFIERS,
  ...CLASS_MODIFIERS,
  ...MEMBER_MODIFIERS,
];

const VARIABLE_CONSTRUCT = [
  ...VISIBILITY_MODIFIERS,
  ...TYPE_MODIFIERS,
  ...CLASS_MODIFIERS,
  ...MEMBER_MODIFIERS,
  "comptime",
];

const TYPE_CONSTRUCT = [...VISIBILITY_MODIFIERS, ...CLASS_MODIFIERS];

const BY_CONSTRUCT: Record<string, readonly string[]> = {
  function: FUNCTION_CONSTRUCT,
  variable: VARIABLE_CONSTRUCT,
  parameter: PARAMETER_MODIFIERS,
  class: TYPE_CONSTRUCT,
  struct: TYPE_CONSTRUCT,
  enum: TYPE_CONSTRUCT,
  interface: TYPE_CONSTRUCT,
  "type-def": TYPE_CONSTRUCT,
};

/**
 * The builtin modifiers legal on `constructType`. An unknown construct returns the full builtin
 * set: we refuse to invent errors for constructs nobody has studied.
 */
export function builtinModifiersFor(constructType: string | undefined): readonly string[] {
  if (!constructType) return BUILTIN_MODIFIERS;
  return BY_CONSTRUCT[constructType] ?? BUILTIN_MODIFIERS;
}

/**
 * Every modifier name defined IN SOURCE by `(defmodifier name ...)`.
 *
 * This is the whole reason the D4 whitelist cannot be a constant. `examples/06-modifiers/`
 * defines `:identity`, `:logged`, `:timed` and `:retry` in l-lang itself, and those four
 * examples pass today. A static list would hard-error on all of them.
 *
 * Collected per-module, from the AST: `defmodifier` is not exported across module boundaries
 * today (InlineImportsAstVisitor is disabled), so a modifier used in a file that does not define
 * it is genuinely unresolved -- which is exactly what `modifiers_test.lisp` does with `:cached`
 * and `:memoized`, and why it is xfail'd against D4.
 */
export function collectDefinedModifiers(root: ast.ASTNode): Set<string> {
  return new Set(collectDeclaredAnnotations(root).keys());
}

/**
 * Every `:name` a MODULE declares, with which of D68's roles it is and how many arguments it takes.
 *
 * One registry, not two, because the three roles share ONE namespace: a `:foo` is a builtin modifier,
 * a decorator or an attribute, and never two of them at once. Collecting them separately would let a
 * `defmodifier retry` and a `defattribute retry` coexist, and then every consumer would have to pick a
 * winner -- each in its own way.
 *
 * Module-local, and that is inherited rather than chosen: `defmodifier` is not exported across module
 * boundaries today (see the note on `collectDefinedModifiers` above), and `defattribute` gets the same
 * limit for the same unsolved reason.
 */
export function collectDeclaredAnnotations(
  root: ast.ASTNode
): Map<string, { kind: "decorator" | "attribute"; arity: number }> {
  const found = new Map<string, { kind: "decorator" | "attribute"; arity: number }>();
  for (const d of collectAnnotationDeclarations(root)) {
    found.set(d.name, { kind: d.kind, arity: d.arity });
  }
  return found;
}

/**
 * Every `defmodifier` / `defattribute` DECLARATION in the tree, in source order and WITHOUT
 * deduplication.
 *
 * The map above is the convenient form and it is lossy exactly where it matters: two declarations of
 * one name collapse to whichever came last, so `(defmodifier tag …)` followed by `(defattribute tag
 * …)` silently made `:tag` an attribute and the decorator quietly stopped firing. That is the failure
 * the collision check needs to see, so the list is the primitive and the map is derived from it --
 * one traversal, two views, no chance of them disagreeing about what a module declares.
 */
export function collectAnnotationDeclarations(
  root: ast.ASTNode
): { name: string; kind: "decorator" | "attribute"; arity: number; node: ast.ASTNode }[] {
  const found: { name: string; kind: "decorator" | "attribute"; arity: number; node: ast.ASTNode }[] = [];

  const walk = (n: any): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if ((n._type === "modifier-def" || n._type === "attribute-def") && typeof n.name === "string") {
      found.push({
        name: n.name.toLowerCase(),
        kind: n._type === "attribute-def" ? "attribute" : "decorator",
        arity: (n.params ?? []).length,
        node: n,
      });
    }
    for (const key of Object.keys(n)) {
      if (key === "_parent" || key === "_location") continue;
      walk(n[key]);
    }
  };

  walk(root);
  return found;
}

/** Levenshtein distance, for the did-you-mean D4 asks for. */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return d[a.length][b.length];
}

/**
 * The closest valid modifier to `name`, or undefined if nothing is close enough to be worth
 * suggesting. The threshold scales with length so `:pubic` -> `:public` is offered but
 * `:xyz` -> `:gc` is not.
 */
export function suggestModifier(name: string, valid: readonly string[]): string | undefined {
  const limit = Math.max(2, Math.floor(name.length / 3));
  let best: string | undefined;
  let bestDistance = Infinity;

  for (const candidate of valid) {
    const distance = editDistance(name, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return bestDistance <= limit ? best : undefined;
}

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
 * A declaration's modifiers as REFLECTION sees them (D68) -- name plus which of D68's roles it is.
 *
 * The kind is `isBuiltinModifier`, not a fresh classification, and that is the point: it is the same
 * predicate `applyModifiersToClass` and `applyModifiersToDeclaration` filter on to decide what gets a
 * `__ll_modifier_<name>` wrapper. A second notion of "custom" here could describe a modifier as a
 * transformer that codegen treats as a compiler fact, or the reverse -- exactly the kind of two-sources
 * drift D54 forced the metadata graph into one builder to prevent.
 *
 * Returns undefined rather than `[]` when there are none, so callers can omit the key entirely and a
 * declaration with no modifiers reflects the same as it did before D68.
 */
export function describeModifiers(
  modifiers: ast.ModifierNode[] | undefined
): { name: string; kind: "builtin" | "custom" }[] | undefined {
  if (!modifiers || modifiers.length === 0) return undefined;
  return modifiers.map((m) => {
    const name = m.modifier.replace(/^:/, "");
    return { name, kind: isBuiltinModifier(name) ? ("builtin" as const) : ("custom" as const) };
  });
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