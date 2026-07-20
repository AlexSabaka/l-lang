// A5: the SHARED store-copy decision -- "does a value need a D11 copy on the way into a store?"
//
// ONE predicate, consulted by BOTH the JS store path (`JSTransformer.needsValueCopy`, via `asValue`)
// and the HIR lowering (which caches it on `HVarDecl.copies` for the native backend). A single source
// so codegen and the native backend cannot decide the copy differently -- the A5 divergence the C
// backend's `copyStore` and JS's `needsValueCopy` synthesised independently (D48/Q1).
//
// The DECISION only: whether to emit a copy. The MATERIALIZATION (deep-vs-shared) is the runtime's
// `__ll_copy` / `ll_copy`, dispatching on the value's struct marker at run time.
//
// It reads only the type CHANNEL + symbol table + static node shape -- never emitter state -- which is
// what makes it callable at lowering time. The asymmetry is the design: a type proving NOT-a-struct
// elides the copy; NO type (or an ambiguous one) keeps it, because a missing copy is an aliasing bug
// (the class D11 exists to kill) while a redundant copy is a runtime no-op.

import * as ast from "../frontend/ast";
import { InferredType } from "../analysis/SymbolTable";
import { TypeChecker } from "../types/TypeChecker";

/** The minimal channel the predicate reads (a structural subset of Context, to avoid an import cycle). */
export interface CopyDecisionCtx {
  symbolTable?: { resolveSymbol?: (name: any, at?: any) => any } | undefined;
  nodeTypes?: ReadonlyMap<ast.ASTNode, InferredType> | undefined;
}

// A literal of one of these SYNTACTIC shapes is never a struct -- the cheap answer no type is needed for.
const NEVER_A_STRUCT = new Set([
  "integer-number", "float-number", "hex-number", "octal-number", "binary-number",
  "fraction-number", "complex-number", "string", "formatted-string", "boolean", "null",
  "vector", "matrix", "map", "function", "quote", "comment",
]);

function declarationKindOf(head: ast.ASTNode, ctx: CopyDecisionCtx): string | undefined {
  if (head._type !== "simple-identifier" && head._type !== "composite-identifier") return undefined;
  try {
    return ctx.symbolTable?.resolveSymbol?.(head as any, head)?.nodeType;
  } catch {
    return undefined;
  }
}

/** `(Dog "rex")` / `(new Dog)` -- a fresh construction is already a new value, so it is never copied. */
function isConstructorHead(head: ast.ASTNode, ctx: CopyDecisionCtx): boolean {
  const k = declarationKindOf(head, ctx);
  return k === "class" || k === "struct";
}

/**
 * Does this inferred type PROVE the value is not a value-semantic struct?
 *
 * Only `true` when we are certain. `Unknown` proves nothing. A `type-ref` is resolved through the
 * symbol table (that is where "what is the SHAPE of `Complex`?" lives).
 *
 * NOTE (D48/Q1 -- the A5 soundness fix): an `interface` type is NOT proof. A struct held behind an
 * interface is still a value, so eliding its copy silently aliases it -- the exact divergence the C
 * backend (which copies on the concrete `obj` ctype) did not share. `class` STAYS proof: a struct is
 * never a subtype of a class, so a class-typed slot cannot hold one.
 */
function provablyNotAStruct(type: InferredType, ctx: CopyDecisionCtx): boolean {
  if (TypeChecker.isUnknown(type)) return false;

  let t: InferredType = type;
  if (t.kind === "type-ref" && (t as any).refName) {
    const resolved = ctx.symbolTable?.resolveSymbol?.((t as any).refName)?.inferredType;
    if (!resolved) return false;
    t = resolved;
  }

  return (
    t.kind === "primitive" ||
    t.kind === "function" ||
    t.kind === "class" ||
    t.kind === "map" ||
    t.kind === "array" ||
    (t.kind === "generic" && (t as any).isArray === true)
  );
}

/** Does the value stored by `node` need a D11 copy? (A missing copy aliases; a redundant one is a no-op.) */
export function shouldCopyOnStore(node: ast.ASTNode | undefined | null, ctx: CopyDecisionCtx): boolean {
  if (!node) return false;
  if (NEVER_A_STRUCT.has(node._type)) return false;

  const known = ctx.nodeTypes?.get(node);
  if (known && provablyNotAStruct(known, ctx)) return false;

  // A fresh construction is a brand-new object nobody else can reach -- copying it duplicates for nothing.
  if (ast.isListNode(node)) {
    const head = (node as ast.ListNode).nodes[0];
    if (head && head._type === "simple-identifier") {
      const id = ast.symbolName(head as ast.IdentifierNode);
      if (id === "new" || isConstructorHead(head, ctx)) return false;
    }
  }

  return true;
}
