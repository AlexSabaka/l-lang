// D58's coroutine lowering -- the structural half of the `:gen` state machine.
//
// A generator suspends by RETURNING, and resumes by being called again. So a generator body has to
// survive being re-entered at a point in the middle of itself, which is the one thing a structured
// IR cannot say. This pass makes it sayable: it numbers the suspend points, puts a dispatch prologue
// at the top, and pairs each `yield` with a resume point.
//
// WHAT THIS PASS DELIBERATELY DOES NOT DO -- and the reason the transform is far smaller than the
// literature suggests. It does NOT flatten control flow into basic blocks, and it does NOT compute
// live ranges. C's `goto` can jump into the middle of a loop body, so the body's control structure
// survives VERBATIM: re-entry lands inside the loop, the loop's own condition then re-tests from
// frame state, and nesting composes because every enclosing loop's state is in the frame too.
//
// The price of that is a storage rule -- EVERY local must live in the frame, so no jump can skip an
// initialisation -- and storage is the backend's half of the job (`promoteFrame` on the C side), not
// this one's. Splitting it there is what removes the live-range analysis that makes this an open
// research area in languages whose frames are typed and packed.
//
// The pass is backend-neutral by construction: it only rewrites HIR, and only into nodes a native
// backend reads. JS never calls it -- `function*` is native there -- which is what makes building
// this for C the same as building it for LLVM.

import type * as ast from "../frontend/ast";
import type { HBlock, HExpr, HStmt } from "./nodes";

/** A construct inside a `:gen` body that the state machine cannot lower. Carries its own reason so
 *  the backend can turn it into a refusal that NAMES the shape rather than pointing at a node. */
export class CoroutineRefusal extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

export interface LoweredCoroutine {
  body: HBlock;
  /** The resume states, in source order -- one per suspend point. Empty for a `:gen` with no yield. */
  states: number[];
}

/** Rewrite a `:gen` body into a resumable one. */
export function lowerCoroutine(body: HBlock, fn: ast.FunctionNode): LoweredCoroutine {
  verify(body);
  const states: number[] = [];
  const rewritten = rewriteSuspends(body, states);
  if (states.length === 0) return { body: rewritten, states };
  const at = rewritten.stmts[0]?.src ?? (fn as ast.ASTNode);
  const dispatch: HStmt = { src: at, kind: "dispatch", states } as HStmt;
  return { body: { stmts: [dispatch, ...rewritten.stmts] }, states };
}

// -- 1. verification -------------------------------------------------------------------------------

/**
 * Refuse what the machine cannot see or cannot re-enter, BEFORE rewriting anything.
 *
 * The opaque check is the one that matters. `LowerAstToHirVisitor.leaf` parks whole AST subtrees in
 * `opaque-expr`/`opaque-stmt` when a construct's structure stays legacy, and a `yield` buried inside
 * one would be invisible to this pass and therefore SILENTLY DROPPED -- a generator that compiles and
 * produces the wrong sequence. Every known path lowers its children through the HIR, so this should
 * never fire; it exists because "should never fire" is not a guarantee, and a silent wrong answer is
 * the failure mode this project is built to refuse.
 */
function verify(body: HBlock): void {
  walkStmts(body, (s) => {
    if (s.kind === "opaque-stmt" && astHasYield(s.src)) {
      throw new CoroutineRefusal("yield inside an unlowered (opaque) statement");
    }
    // LL0239 already forbids these at the checker. Re-checked here because this pass is what the
    // restriction PROTECTS: a suspend returns the C activation an enclosing `setjmp` named, and
    // C11 7.13.2.1 makes landing back in it undefined rather than merely wrong.
    if ((s.kind === "try" || s.kind === "restart-case" || s.kind === "handle") && stmtHasYield(s)) {
      throw new CoroutineRefusal(`yield inside a protected region (${s.kind})`);
    }
  });
  walkExprsInBlock(body, (e, inStatementPosition) => {
    if (e.kind === "opaque-expr" && astHasYield(e.src)) {
      throw new CoroutineRefusal("yield inside an unlowered (opaque) expression");
    }
    if (e.kind === "yield" && !inStatementPosition) {
      // A `yield` whose value is CONSUMED would have to split the enclosing expression across a
      // suspend, spilling a partially-evaluated operand stack into the frame. l-lang has no way to
      // send a value back in (`next` takes no argument, D30), so such a yield always evaluates to
      // nil and the shape has no use -- the corpus has none. Refused rather than half-supported.
      throw new CoroutineRefusal("yield in value position (its result is always nil; use it as a statement)");
    }
  });
}

/** Does this raw AST subtree contain a `(yield ...)` form? */
function astHasYield(node: ast.ASTNode | undefined): boolean {
  let found = false;
  const seen = new Set<unknown>();
  const walk = (n: any): void => {
    if (found || !n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      for (const c of n) walk(c);
      return;
    }
    const head = Array.isArray(n.items) ? n.items[0] : undefined;
    if (head && head._type === "simple-identifier" && head.id === "yield") {
      found = true;
      return;
    }
    for (const k of Object.keys(n)) {
      if (k === "parent" || k === "_parent" || k === "scope") continue;
      walk(n[k]);
    }
  };
  walk(node);
  return found;
}

function stmtHasYield(root: HStmt): boolean {
  let found = false;
  walkStmts({ stmts: [root] }, (s) => {
    forEachExpr(s, (e) => {
      if (e.kind === "yield") found = true;
    });
  });
  return found;
}

// -- 2. suspend numbering --------------------------------------------------------------------------

/**
 * Replace each `yield` STATEMENT with a suspend/resume pair, numbering them in source order.
 *
 * State 0 is "not started", so the first suspend is state 1. Falling off the end of the body leaves
 * the machine done and the backend returns nil, which is D30's "nil MEANS DONE".
 */
function rewriteSuspends(body: HBlock, states: number[]): HBlock {
  return mapBlock(body, (s) => {
    if (s.kind !== "expr-stmt" || s.expr.kind !== "yield") return null;
    const y = s.expr;
    if (!y.argument) {
      // LL0237 already rejects `(yield)` at the checker; a valueless one reaching here would
      // TRUNCATE the sequence, because nil means done.
      throw new CoroutineRefusal("valueless `(yield)`");
    }
    const state = states.length + 1;
    states.push(state);
    return [
      { src: s.src, kind: "suspend", state, value: y.argument } as HStmt,
      { src: s.src, kind: "resume-point", state } as HStmt,
    ];
  });
}

// -- traversal helpers -----------------------------------------------------------------------------

/** Every statement block a statement owns. One place to know the shape, so the walkers cannot drift. */
function subBlocks(s: HStmt): HBlock[] {
  switch (s.kind) {
    case "if":
      return s.else ? [s.then, s.else] : [s.then];
    case "block":
      return [s.body];
    case "while":
      return [s.body];
    case "for":
      return [s.init, s.body, ...(s.elseBlock ? [s.elseBlock] : [])];
    case "for-each":
      return [s.body, ...(s.elseBlock ? [s.elseBlock] : [])];
    case "try":
      return [s.tryBlock, ...s.catches.map((c) => c.body), ...(s.finalizer ? [s.finalizer] : [])];
    case "restart-case":
      return [s.body, ...s.arms.map((a) => a.body)];
    case "handle":
      return [s.body, ...s.clauses.map((c) => c.body)];
    default:
      return [];
  }
}

function walkStmts(b: HBlock, visit: (s: HStmt) => void): void {
  for (const s of b.stmts) {
    visit(s);
    for (const sub of subBlocks(s)) walkStmts(sub, visit);
    // A `for`'s update is a STATEMENT, not a block -- easy to miss, and it is where a `:step`
    // assignment lives.
    if (s.kind === "for" && s.update) walkStmts({ stmts: [s.update] }, visit);
  }
}

/** Every expression a statement holds directly (not through a sub-block), transitively. */
function forEachExpr(s: HStmt, visit: (e: HExpr) => void): void {
  const seen = new Set<unknown>();
  const go = (e: HExpr): void => {
    if (seen.has(e)) return;
    seen.add(e);
    visit(e);
    for (const [k, v] of Object.entries(e as any)) {
      if (k === "src" || k === "type") continue;
      if (Array.isArray(v)) for (const x of v) if (isExpr(x)) go(x);
      if (isExpr(v)) go(v);
    }
  };
  for (const [k, v] of Object.entries(s as any)) {
    if (k === "src" || k === "type") continue;
    if (Array.isArray(v)) for (const x of v) if (isExpr(x)) go(x);
    if (isExpr(v)) go(v);
  }
}

function isExpr(v: unknown): v is HExpr {
  return !!v && typeof v === "object" && typeof (v as any).kind === "string" && !("stmts" in (v as any));
}

/**
 * Visit every expression in the block, telling the visitor whether it sits in STATEMENT position --
 * that is, whether it is the whole of an `expr-stmt`. Only that position may hold a `yield`.
 */
function walkExprsInBlock(b: HBlock, visit: (e: HExpr, inStatementPosition: boolean) => void): void {
  walkStmts(b, (s) => {
    const top = s.kind === "expr-stmt" ? s.expr : undefined;
    forEachExpr(s, (e) => visit(e, e === top));
  });
}

/**
 * Rewrite a block. `f` returns the replacement statements for a node, or null to leave it alone and
 * recurse into its sub-blocks.
 */
function mapBlock(b: HBlock, f: (s: HStmt) => HStmt[] | null): HBlock {
  const out: HStmt[] = [];
  for (const s of b.stmts) {
    const replaced = f(s);
    if (replaced) {
      out.push(...replaced);
      continue;
    }
    out.push(mapStmt(s, f));
  }
  return { stmts: out };
}

function mapStmt(s: HStmt, f: (s: HStmt) => HStmt[] | null): HStmt {
  switch (s.kind) {
    case "if":
      return { ...s, then: mapBlock(s.then, f), else: s.else ? mapBlock(s.else, f) : null };
    case "block":
      return { ...s, body: mapBlock(s.body, f) };
    case "while":
      return { ...s, body: mapBlock(s.body, f) };
    case "for": {
      const update = s.update ? (f(s.update)?.[0] ?? mapStmt(s.update, f)) : null;
      return {
        ...s, init: mapBlock(s.init, f), body: mapBlock(s.body, f), update,
        elseBlock: s.elseBlock ? mapBlock(s.elseBlock, f) : null,
      };
    }
    case "for-each":
      return { ...s, body: mapBlock(s.body, f), elseBlock: s.elseBlock ? mapBlock(s.elseBlock, f) : null };
    default:
      return s;
  }
}
