// Which locals of one emitted C function must be declared `volatile`.
//
// C11 7.13.2.1p3: after a `longjmp`, the locals of the function containing the corresponding `setjmp`
// that are NOT volatile-qualified and WERE modified between the setjmp and the longjmp have
// INDETERMINATE values. The C backend lowers try/catch/finally (Cr-0) and restart-case (Cr-1a) to
// setjmp pads, so a plain local written inside a protected body and read after a landing silently
// reverts -- observed as a wrong answer at -O1 and above (18-error-handling/11 printed 0/0 for 5/5).
//
// The pass is deliberately CONSERVATIVE about what counts as a protected region: the body (and, for a
// try, the catch chain) of EVERY c-try and c-restart-case, whether or not that particular shape ends
// up emitting a pad. A bare `try` emits no setjmp, so marking inside it costs a pessimized variable and
// nothing else -- much cheaper than keeping this file in lockstep with the emitter's pad decisions.
//
// What it does NOT mark, and why:
//   - `finally` blocks and restart arms -- they run AFTER their own landing. (An ENCLOSING region still
//     counts; the depth counter handles that.)
//   - `c-handle` bodies -- an LL_HANDLER frame is never a longjmp target, so a handle emits no setjmp.
//   - cells (`cell: true`) -- `(*p) = v` writes the HEAP pointee; the pointer local is written once at
//     its declaration, before any pad.
//   - field / index / dyn-field stores -- all write through a pointer into the heap.
//   - ll_frame locals -- see the note in runtime.c: they are modified between setjmp and longjmp, but
//     their address escapes to an external function, which forces them to memory anyway.

import type { CBlock, CStmt, CExpr, CLValue } from "./cir";

/**
 * The C names that must be `volatile` in the function whose body this is. Walks statements AND
 * expressions -- `c-bind` assigns a local from inside an arbitrary expression, frequently wrapped in a
 * P2-inserted c-box, so an expression-blind walk would miss it.
 */
export function computeVolatileLocals(body: CBlock): Set<string> {
  const out = new Set<string>();
  walkBlock(body, 0, out);
  return out;
}

function walkBlock(b: CBlock, depth: number, out: Set<string>): void {
  for (const s of b.stmts) walkStmt(s, depth, out);
}

function walkStmt(s: CStmt, depth: number, out: Set<string>): void {
  switch (s.kind) {
    case "c-expr-stmt":
      walkExpr(s.expr, depth, out);
      return;

    case "c-decl":
      // The declaration itself is not a clobber: a local declared INSIDE a region is out of scope at
      // the landing, and one declared outside is initialized before the pad is armed.
      if (s.init) walkExpr(s.init, depth, out);
      return;

    case "c-assign":
      markLValue(s.target, depth, out);
      walkLValueChildren(s.target, depth, out);
      walkExpr(s.value, depth, out);
      return;

    case "c-if":
      walkExpr(s.test, depth, out);
      walkBlock(s.then, depth, out);
      if (s.else) walkBlock(s.else, depth, out);
      return;

    case "c-block":
      walkBlock(s.body, depth, out);
      return;

    case "c-return":
      if (s.value) walkExpr(s.value, depth, out);
      return;

    case "c-while":
      walkExpr(s.test, depth, out);
      walkBlock(s.body, depth, out);
      return;

    case "c-for":
      walkBlock(s.init, depth, out);
      if (s.test) walkExpr(s.test, depth, out);
      if (s.update) walkStmt(s.update, depth, out);
      walkBlock(s.body, depth, out);
      return;

    case "c-foreach":
      // The loop variable is re-assigned per iteration by direct emission (not a c-assign node).
      if (depth > 0) out.add(s.varCName);
      walkExpr(s.collection, depth, out);
      walkBlock(s.body, depth, out);
      if (s.elseBlock) walkBlock(s.elseBlock, depth, out);
      return;

    case "c-try":
      // PROTECTED: the body, and the catch chain too -- when a `finally` exists its CLEANUP pad spans
      // both, so a local written in a catch arm and read in the finalizer is equally at risk.
      walkBlock(s.tryBlock, depth + 1, out);
      for (const c of s.catches) walkBlock(c.body, depth + 1, out);
      // The finalizer runs after the landing; only an enclosing region can clobber through it.
      if (s.finalizer) walkBlock(s.finalizer, depth, out);
      return;

    case "c-restart-case":
      walkBlock(s.body, depth + 1, out); // PROTECTED
      for (const a of s.arms) walkBlock(a.body, depth, out); // arms run after the landing
      return;

    case "c-handle":
      // No setjmp (ll_signal walks an LL_HANDLER frame in place). Clause bodies are separate lifted
      // functions with their own regions, analysed when those CLifteds are emitted.
      walkBlock(s.body, depth, out);
      return;

    default: {
      const never: never = s;
      throw new Error(`volatiles: unhandled statement kind '${(never as any).kind}'`);
    }
  }
}

/** A write to a plain local variable -- the ONLY lvalue shape that can be clobbered. */
function markLValue(l: CLValue, depth: number, out: Set<string>): void {
  if (depth > 0 && l.kind === "name" && !l.cell) out.add(l.cName);
}

/** The expressions an lvalue evaluates on its way to the storage location. */
function walkLValueChildren(l: CLValue, depth: number, out: Set<string>): void {
  if (l.kind === "index") {
    walkExpr(l.base, depth, out);
    walkExpr(l.index, depth, out);
  } else if (l.kind === "field" || l.kind === "dyn-field") {
    walkExpr(l.object, depth, out);
  }
}

function walkExpr(e: CExpr, depth: number, out: Set<string>): void {
  switch (e.kind) {
    case "c-lit":
    case "c-ref":
    case "c-temp":
    case "c-nil":
      return;

    case "c-bind":
      // An ASSIGNMENT in expression position (hoisted match-pattern binder).
      if (depth > 0) out.add(e.cName);
      walkExpr(e.value, depth, out);
      return;

    case "c-interp":
      for (const p of e.parts) if (typeof p !== "string") walkExpr(p, depth, out);
      return;

    case "c-call":
      if (e.callee.kind === "closure") walkExpr(e.callee.fn, depth, out);
      for (const a of e.args) walkExpr(a, depth, out);
      return;

    case "c-binop":
      walkExpr(e.lhs, depth, out);
      walkExpr(e.rhs, depth, out);
      return;

    case "c-unop":
      walkExpr(e.operand, depth, out);
      return;

    case "c-ternary":
      walkExpr(e.test, depth, out);
      walkExpr(e.then, depth, out);
      walkExpr(e.else, depth, out);
      return;

    case "c-seq":
      for (const x of e.exprs) walkExpr(x, depth, out);
      return;

    case "c-vector":
      for (const el of e.elements) walkExpr(el, depth, out);
      return;

    case "c-map":
      for (const en of e.entries) {
        if (typeof en.key !== "string") walkExpr(en.key, depth, out);
        walkExpr(en.value, depth, out);
      }
      return;

    case "c-index":
      walkExpr(e.base, depth, out);
      walkExpr(e.index, depth, out);
      return;

    case "c-member":
      walkExpr(e.object, depth, out);
      return;

    case "c-construct":
      for (const a of e.args) walkExpr(a, depth, out);
      return;

    case "c-field-get":
      walkExpr(e.object, depth, out);
      return;

    case "c-closure-make":
      // Capture VALUES are expressions evaluated here (InsertCoercions skips these -- we must not).
      for (const c of e.captures) walkExpr(c.value, depth, out);
      return;

    case "c-type-test":
      walkExpr(e.operand, depth, out);
      return;

    case "c-box":
    case "c-unbox":
    case "c-cast":
    case "c-copy":
      walkExpr(e.inner, depth, out);
      return;

    case "c-invoke-restart":
      walkExpr(e.packedArgs, depth, out);
      return;

    case "c-signal":
      walkExpr(e.condition, depth, out);
      return;

    default: {
      const never: never = e;
      throw new Error(`volatiles: unhandled expression kind '${(never as any).kind}'`);
    }
  }
}
