// A3: the SHARED, channel-based call-dispatch classifier.
//
// ONE decision, consulted by BOTH the lowering (to model the resolved call kinds) and the legacy
// emitter -- so codegen and the HIR pass cannot diverge on what a call IS. That divergence is the TY8
// seam (checker and codegen deciding dispatch independently); a single classifier closes it.
//
// It reads only the TYPE CHANNEL + symbol table + static facts -- never emitter state (`this.functions`,
// the emitted callee string) -- which is what makes it callable at lowering time, before the emitter
// exists. It mirrors `JSTransformer.visitList`'s decision ORDER for the kinds modeled so far; every
// other shape returns `opaque`, and the emitter's existing branches handle those unchanged.
//
// Modeled now: FREE-CALL (simple-identifier head). ext / virtual / operator / construct stay `opaque`
// until their kinds are modeled.

import * as ast from "../frontend/ast";
import { classifyList, isDottedMemberIndexer } from "../analysis/listForm";
import { RuntimeProvider } from "../runtime";

/** The minimal channel the classifier reads (a structural subset of Context, to avoid an import cycle). */
export interface CallClassCtx {
  symbolTable?: { resolveSymbol?: (name: any, at: any) => any } | undefined;
  nodeTypes?: ReadonlyMap<ast.ASTNode, any>;
}

export type CallDispatch =
  | { kind: "free"; callee: ast.ASTNode; args: ast.ASTNode[] }
  | { kind: "opaque" };

// -- the same channel-based predicates JSTransformer uses, re-expressed against a bare Context --------

function declarationKindOf(head: ast.ASTNode, ctx: CallClassCtx): string | undefined {
  if (head._type !== "simple-identifier" && head._type !== "composite-identifier") return undefined;
  try {
    return ctx.symbolTable?.resolveSymbol?.(head as any, head)?.nodeType;
  } catch {
    return undefined;
  }
}

function isConstructor(head: ast.ASTNode, ctx: CallClassCtx): boolean {
  const k = declarationKindOf(head, ctx);
  return k === "class" || k === "struct";
}

/** D1: a `fn` declaration, or a variable whose inferred type is a function. */
function isFunction(head: ast.ASTNode, ctx: CallClassCtx): boolean {
  if (declarationKindOf(head, ctx) === "function") return true;
  try {
    return ctx.symbolTable?.resolveSymbol?.(head as any, head)?.inferredType?.kind === "function";
  } catch {
    return false;
  }
}

/** `(type x)` on a primitive folds at compile time (foldPrimitiveType) -- not a call. */
function isPrimitiveTypeFold(node: ast.ListNode, head: ast.ASTNode, args: ast.ASTNode[], ctx: CallClassCtx): boolean {
  if (head._type !== "simple-identifier" || (head as ast.SimpleIdentifierNode).id !== "type" || args.length !== 1) return false;
  try {
    if (ctx.symbolTable?.resolveSymbol?.("type" as any, node as any)) return false; // user `type` shadows the builtin
  } catch {
    return false;
  }
  const t = ctx.nodeTypes?.get(args[0]);
  return !!t && t.kind === "primitive" && typeof t.name === "string";
}

/**
 * Classify a list as a call-dispatch KIND from the type channel alone. Mirrors `visitList`'s order for
 * the modeled kinds; everything else -> `opaque`.
 */
export function classifyCall(node: ast.ListNode, ctx: CallClassCtx): CallDispatch {
  if (classifyList(node).kind !== "call") return { kind: "opaque" }; // special / apply / block / grouping / empty
  const nodes = Array.isArray(node.nodes) ? node.nodes : [node.nodes];
  const head = nodes[0];
  const args = nodes.slice(1);

  if (isDottedMemberIndexer(head)) return { kind: "opaque" };        // (gs[0].hi ...) -- a call, not yet modeled
  if (head?._type !== "simple-identifier") return { kind: "opaque" }; // composite head -> ext-call (later)

  const id = (head as ast.SimpleIdentifierNode).id;
  if (id === "||" || id === "&&") return { kind: "opaque" };         // short-circuit LogicalExpression
  if (RuntimeProvider.isOperatorSymbol(id)) return { kind: "opaque" }; // operator shim
  if (isPrimitiveTypeFold(node, head, args, ctx)) return { kind: "opaque" };
  if (isConstructor(head, ctx)) return { kind: "opaque" };           // NewExpression

  // The general free-call: `(f a ...)` with args, or a zero-arg `(f)` where f names a function (D1).
  if (args.length > 0 || isFunction(head, ctx)) return { kind: "free", callee: head, args };
  return { kind: "opaque" };
}
