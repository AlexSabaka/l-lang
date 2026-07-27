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
// Modeled now: FREE-CALL (simple-identifier head), EXT-CALL (`obj.method` -> conforming `:extension`),
// METHOD-CALL (`obj.method` on a native/user method), OPERATOR (`(+ a b)`), VIRTUAL (`obj.method` on an
// untyped receiver, args -> runtime dispatch), and CONSTRUCT (`(Dog ...)` -> `new Dog(...)`). Every
// call SHAPE is now classified; only 0-arg dynamic member access + dotted chains stay `opaque`.

import * as ast from "../frontend/ast";
import { classifyList, isDottedMemberIndexer, listNodes } from "../analysis/listForm";
import { RuntimeProvider } from "../runtime";
import { buildExtensionTable, conformingExtensionFn, memberKindOn, receiverType } from "./extensionResolution";

/** The minimal channel the classifier reads (a structural subset of Context, to avoid an import cycle). */
export interface CallClassCtx {
  symbolTable?: { resolveSymbol?: (name: any, at: any) => any } | undefined;
  nodeTypes?: ReadonlyMap<ast.ASTNode, any>;
}

export type CallDispatch =
  | { kind: "free"; callee: ast.ASTNode; args: ast.ASTNode[] }
  | { kind: "method"; head: ast.ASTNode; objectName: string; member: string; args: ast.ASTNode[] }
  | { kind: "virtual"; head: ast.ASTNode; objectName: string; member: string; args: ast.ASTNode[] }
  | { kind: "ext"; head: ast.ASTNode; objectName: string; member: string; fnName: string; args: ast.ASTNode[] }
  | { kind: "operator"; op: string; head: ast.ASTNode; args: ast.ASTNode[] }
  | { kind: "construct"; callee: ast.ASTNode; args: ast.ASTNode[] }
  | { kind: "member-read"; head: ast.ASTNode; objectName: string; member: string }
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
  // `listNodes`, not the raw array: a comment occupies no slot (D25). It counts here twice over --
  // `args.length > 0` below is what separates a VIRTUAL call from a member READ, so a stray `;;` in
  // `(obj.m ;; note)` turned a read into a call.
  const nodes = listNodes(node);
  const head = nodes[0];
  const args = nodes.slice(1);

  if (isDottedMemberIndexer(head)) return { kind: "opaque" };        // (gs[0].hi ...) -- a call, not yet modeled

  // A 2-part `obj.method` call. Its dispatch is decided by the receiver TYPE:
  //  - a native/user METHOD  -> `method-call` (emits `obj.method(args)` -- the direct member call);
  //  - a native FIELD        -> opaque (a field is a READ, handled by the emitter's field branch);
  //  - neither, but an `:extension` conforms -> `ext-call` (devirtualized to `method(obj, ...)`).
  // (3+-part chains stay opaque for now; the receiver-of-a-chain resolution differs.)
  if (head?._type === "composite-identifier") {
    const parts = String((head as ast.IdentifierNode).id ?? "").split(".").filter(Boolean);
    if (parts.length !== 2) return { kind: "opaque" };
    const [objectName, member] = parts;
    const mk = memberKindOn(ctx, objectName, member, head);
    if (mk === "method") {
      // The storing mutators take a D11 struct arg-copy in the emitter (asValue) BEFORE the call is
      // built (CP2 / A5) -- that copy is not modeled on the HIR yet, so leave them opaque to keep it.
      if (member === "push" || member === "unshift") return { kind: "opaque" };
      return { kind: "method", head, objectName, member, args };
    }
    // A native/known FIELD -- `(obj.field)` is a READ, not a call. Modeled so the backend resolves it as
    // a field access off the node instead of re-dispatching the opaque leaf through the call machinery.
    if (mk !== undefined) return { kind: "member-read", head, objectName, member };
    // mk === undefined: the receiver TYPE is unknown here. Prefer a conforming `:extension`; else it is a
    // DYNAMIC method call.
    const rtype = receiverType(ctx, objectName, head);
    if (rtype) {
      const fnName = conformingExtensionFn(ctx, buildExtensionTable(ctx), rtype, member);
      if (fnName) return { kind: "ext", head, objectName, member, fnName, args };
    }
    // No native member, no conforming extension -> a call on an untyped receiver dispatched at RUNTIME.
    // With args it is a virtual method call `obj.method(args)` (the emitter's general member-call branch;
    // JS lets the runtime resolve, a native backend needs a vtable). A 0-arg access is a `__ll_member` /
    // field READ -- a member-read (the emission stays the legacy branch; the backend resolves it off the
    // node instead of re-dispatching the opaque leaf as a call).
    if (args.length > 0) return { kind: "virtual", head, objectName, member, args };
    return { kind: "member-read", head, objectName, member };
  }

  if (head?._type !== "simple-identifier") return { kind: "opaque" };

  const id = (head as ast.SimpleIdentifierNode).id;
  if (id === "||" || id === "&&") return { kind: "opaque" };         // short-circuit LogicalExpression
  if (RuntimeProvider.isOperatorSymbol(id)) {
    // An operator CALL `(+ a b)`. On JS it routes through the runtime shim (`_2b(a, b)`, the callee is
    // the encoded operator identifier + the shim gets registered); a native backend reads `op` + the
    // operands and emits a machine op (static, D43) or boxed dispatch (an `Unknown` operand). ||/&& are
    // excluded above (LogicalExpression, not a shim call). A bare `(+)` with no operands is the operator
    // AS A VALUE (emits the bare shim ref, not a call) -> opaque.
    if (args.length === 0) return { kind: "opaque" };
    return { kind: "operator", op: id, head, args };
  }
  if (isPrimitiveTypeFold(node, head, args, ctx)) return { kind: "opaque" };
  // `(Dog "rex")` where `Dog` is a class/struct -> a CONSTRUCTION (`new Dog("rex")`). The callee is the
  // class name; a native backend allocates + runs the constructor (A4). Args are never copied at the
  // call site (the emitter's constructor branch returns before the push/unshift copy).
  if (isConstructor(head, ctx)) return { kind: "construct", callee: head, args };

  // The general free-call: `(f a ...)` with args, or a zero-arg `(f)` where f names a function (D1).
  if (args.length > 0 || isFunction(head, ctx)) return { kind: "free", callee: head, args };
  return { kind: "opaque" };
}
