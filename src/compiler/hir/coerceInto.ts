import * as ast from "../frontend/ast";
import { InferredType, SymbolTable } from "../analysis/SymbolTable";

/**
 * COERCION INTO A REFINED NEWTYPE -- one place, one wrapper shape.
 *
 * D46's refined newtypes (`(deftype uint8 <- Int :satisfies (0 .. 255))`) are checked wherever a value
 * enters one. Those sites split into two kinds, and the split is the reason this module exists:
 *
 *   - COERCION sites, where a value flows through an expression slot into a typed destination:
 *     let-init, return, assignment, and (once D46/B-3 lands) an explicit cast. They are handled HERE,
 *     during HIR lowering, because the destination's type is only known after the TYPES stage --
 *     an assignment target carries no annotation at all, so `DesugarAstVisitor` (which runs BEFORE
 *     types and matches on the type NAME written next to the value) structurally cannot see it.
 *
 *   - BINDING GUARDS, where the value arrives already bound and there is no slot to wrap: a function
 *     PARAMETER and a `:ctor` FIELD. Those stay in `DesugarAstVisitor`, deliberately. They are not
 *     coercions -- D46/B-3 itself lists the coercion sites as "assignment/arg/return" -- and they are
 *     callee-side guarantees that hold for callers this compiler cannot see, which no caller-side
 *     coercion could provide.
 *
 * Both ends build the check through `buildRefineCall`, so there is exactly one wrapper shape rather
 * than two that drift apart.
 *
 * The wrapper is an AST node, not HIR, and that is on purpose. HIR never synthesizes floor calls --
 * every `free-call` carries a `calleeBinding` derived from the symbol table -- but the AST list
 * `(__refine_check_int v lo hi clo chi)` handed back to `lowerNode` reuses the path five landed
 * boundaries already prove byte-identical on both backends.
 */

/** An Int refined newtype's boundary check: inclusive bounds, plus a flag per side (0 = open). */
export type RefineInfo = { lo: number; hi: number; clo: number; chi: number };

/** Pack a pair of possibly-open bounds. Returns undefined when neither side is bounded. */
export function toRefineInfo(lo: number | null, hi: number | null): RefineInfo | undefined {
  if (lo === null && hi === null) return undefined;
  return { lo: lo ?? 0, hi: hi ?? 0, clo: lo !== null ? 1 : 0, chi: hi !== null ? 1 : 0 };
}

/**
 * The bounds of an Int-based refined newtype, resolving a `type-ref` through the symbol table the way
 * `TypeChecker.nominalOf` does. Anything else -- a plain alias, a class, a Real-based refinement --
 * yields undefined, so every non-refined program pays one map lookup and nothing else.
 */
export function refinementOfType(
  type: InferredType | undefined,
  symbolTable: SymbolTable | undefined
): RefineInfo | undefined {
  if (!type) return undefined;
  let resolved: InferredType | undefined = type;
  if (type.kind === "type-ref" && (type as any).refName && symbolTable) {
    try {
      resolved = symbolTable.resolveSymbol((type as any).refName)?.inferredType ?? type;
    } catch {
      return undefined;
    }
  }
  if (!resolved || resolved.kind !== "type-alias" || !resolved.nominal || !resolved.refinement) {
    return undefined;
  }
  // Int only for now: the check is `ll_refine_check_int`. A Real-based refined newtype keeps its
  // nominal distinctness and is simply not range-checked yet.
  const base: any = resolved.aliasedType;
  if (!base || base.name !== "Int") return undefined;
  return toRefineInfo(resolved.refinement.lo, resolved.refinement.hi);
}

/** The bounds of a refined newtype named by a declared annotation (`<- uint8`). */
export function refinementOfTypeName(
  name: string | undefined,
  symbolTable: SymbolTable | undefined
): RefineInfo | undefined {
  if (!name || !symbolTable) return undefined;
  try {
    return refinementOfType(symbolTable.resolveSymbol(name)?.inferredType, symbolTable);
  } catch {
    return undefined;
  }
}

/** A type annotation's name, unwrapping the `type` wrapper every consumer of a TypeNode unwraps. */
export function typeNameOf(t: any): string | undefined {
  if (!t || typeof t !== "object") return undefined;
  if (t._type === "type") return typeNameOf(t.type);
  const nm = typeof t.name === "string" ? t.name : t.name?.name;
  return typeof nm === "string" ? nm : undefined;
}

/**
 * `(__refine_check_int value lo hi clo chi)` -- the floor builtin returns the value or PANICS, so it
 * drops straight into the value position it wraps.
 *
 * `parent` matters only when `value` NAMES something: the symbol table indexes the pre-desugar tree
 * and `scopeOf` climbs `_parent` until it hits an indexed node, so a synthesized reference with
 * `_parent: undefined` resolves to no scope at all. Value-position callers pass nothing, because they
 * wrap an EXISTING node and reference only a floor builtin and literals.
 */
export function buildRefineCall(
  value: ast.ASTNode,
  info: RefineInfo,
  parent?: ast.ASTNode
): ast.ASTNode {
  const loc = (value as any)._location;
  const mk = (type: string, fields: any): any => ({ ...fields, _type: type, _location: loc, _parent: parent });
  const id = (s: string) => mk("simple-identifier", { id: s });
  const num = (v: number) => mk("integer-number", { match: String(v), value: v });
  return mk("list", {
    nodes: [id("__refine_check_int"), value, num(info.lo), num(info.hi), num(info.clo), num(info.chi)],
  });
}
