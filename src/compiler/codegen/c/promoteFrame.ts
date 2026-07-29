// D58's frame promotion -- the storage half of the `:gen` state machine.
//
// `LowerCoroutines` rewrote the body so it can be RE-ENTERED (a dispatch prologue, a label per
// suspend). That rewrite is only sound if re-entry cannot skip a variable's initialisation, and C is
// explicit about this: `goto` into a block leaves that block's declarations indeterminate. This pass
// removes the hazard by removing the declarations -- every param, every user local and every lowering
// temp becomes a slot in the generator instance, so the step function has no locals for a jump to
// skip past, and nothing needs to be saved or restored across a suspend because nothing was ever in
// a register-allocatable place to begin with.
//
// PROMOTE EVERYTHING, deliberately (Sabaka's ruling). A liveness analysis would elide the slots that
// do not cross a suspend, and that analysis -- plus proving no jump can reach a use before its def --
// is exactly the part that makes coroutine lowering an open research area in Rust. The v1 cost is
// slots that could have been registers; the v1 benefit is that correctness is structural rather than
// argued. Logged as deliberate debt in D58.
//
// The frame is `ll_obj.fields[]` -- boxed slots -- so the rewrite is entirely into node kinds that
// already existed: `c-field-get` for a read, `CLValue{kind:"field"}` for a store. P2 then does the
// rest for free, because its `c-field-get` arm already unboxes a slot to the reader's static type and
// its assign arm already boxes a value into a field. So a promoted `Int` local is stored tagged and
// read back as an `int64_t`, and no coercion code was written for it here.

import type * as ast from "../../frontend/ast";
import { CBlock, CExpr, CLValue, CStmt } from "./cir";
import { C_VALUE, CType } from "./ctype";

/** Slot 0 of every generator frame is the state; user storage starts at 1. */
export const STATE_SLOT = 0;

/**
 * The placeholder name a suspend stores its state through.
 *
 * P1 emits the state store as an ordinary assignment to this name because it does not know the frame
 * layout -- the layout is decided HERE, once every declaration in the body has been seen. The name
 * is seeded into the slot map at slot 0, so the store rewrites into a field store by exactly the
 * same rule as every user binding, with no special case in the rewriter. It is not a legal l-lang
 * identifier, so no user binding can collide with it.
 */
export const GEN_STATE_NAME = "__ll_gen_state";

export interface FrameSlot {
  cName: string;
  ctype: CType;
  slot: number;
  /** C2: this slot holds a CELL object (a mutable capture), so reads and writes deref through it. */
  cell?: boolean;
}

export interface PromotedFrame {
  body: CBlock;
  slots: FrameSlot[];
}

/**
 * Rewrite a resolved generator body so every binding lives in the frame.
 *
 * `params` are promoted first and in order, so the factory can fill them positionally with
 * `ll_obj_new`'s own argument list and no separate store sequence.
 */
/**
 * C2: which promoted slots hold a CELL rather than a plain value.
 *
 * A generator that captures a MUTABLE binding stores the cell object in its frame, so every read and
 * write of that slot has to go through the cell -- otherwise the generator mutates its own copy and
 * the enclosing scope never sees it, which is the by-value failure C1 chased through three places.
 */
export function promoteFrame(body: CBlock, params: { cName: string; ctype: CType; cell?: boolean }[], self: ast.ASTNode): PromotedFrame {
  const slots = new Map<string, FrameSlot>();
  let next = STATE_SLOT + 1;
  const assign = (cName: string, ctype: CType): FrameSlot => {
    const existing = slots.get(cName);
    if (existing) return existing;
    const s: FrameSlot = { cName, ctype, slot: next++ };
    slots.set(cName, s);
    return s;
  };
  // The state occupies slot 0 and is stored as a plain int; every other slot's declared type is the
  // binding's own, which is what makes P2 unbox a promoted `Int` local back to an `int64_t` on read.
  slots.set(GEN_STATE_NAME, { cName: GEN_STATE_NAME, ctype: { k: "int" }, slot: STATE_SLOT });
  for (const p of params) { const sl = assign(p.cName, p.ctype); if (p.cell) sl.cell = true; }
  // Declarations are collected in a first walk so that a read appearing before its declaration in
  // the traversal (a `while` test that mentions a variable declared above it, say) still resolves.
  collectDecls(body, assign);

  const selfRef: CExpr = { src: self, ctype: { k: "obj", className: "__frame" }, kind: "c-ref", cName: "__f" };
  const rewritten = rewriteBlock(body, slots, selfRef);
  return { body: rewritten, slots: [...slots.values()].sort((a, b) => a.slot - b.slot) };
}

function collectDecls(b: CBlock, assign: (cName: string, ctype: CType) => FrameSlot): void {
  for (const s of b.stmts) {
    if (s.kind === "c-decl") {
      if (s.cell) {
        // A mutable binding captured by an inner closure lives in a heap cell shared with that
        // closure. Two homes for one variable is a question this pass has no answer for yet, and
        // guessing would fork the mutation silently. No corpus generator contains a closure.
        throw new FramePromotionRefusal(`local '${s.cName}' is captured mutably by a nested closure`);
      }
      assign(s.cName, s.declCType);
    }
    for (const sub of subBlocks(s)) collectDecls(sub, assign);
    if (s.kind === "c-for" && s.update) collectDecls({ stmts: [s.update] }, assign);
  }
}

export class FramePromotionRefusal extends Error {}

// -- the rewrite -----------------------------------------------------------------------------------

function fieldOf(slot: FrameSlot, selfRef: CExpr, src: ast.ASTNode): CExpr {
  return { src, ctype: slot.ctype, kind: "c-field-get", object: selfRef, slot: slot.slot, fieldName: slot.cName, cell: slot.cell };
}

function rewriteBlock(b: CBlock, slots: Map<string, FrameSlot>, selfRef: CExpr): CBlock {
  const out: CStmt[] = [];
  for (const s of b.stmts) out.push(...rewriteStmt(s, slots, selfRef));
  return { stmts: out };
}

function rewriteStmt(s: CStmt, slots: Map<string, FrameSlot>, selfRef: CExpr): CStmt[] {
  const E = (e: CExpr): CExpr => rewriteExpr(e, slots, selfRef);
  const B = (blk: CBlock): CBlock => rewriteBlock(blk, slots, selfRef);
  switch (s.kind) {
    case "c-decl": {
      const slot = slots.get(s.cName)!;
      // A declaration becomes a STORE. One with no initialiser vanishes entirely -- `ll_obj_new`
      // nil-fills every slot it is not given, so the frame is already in the state the declaration
      // would have put it in.
      if (!s.init) return [];
      const target: CLValue = { kind: "field", object: selfRef, slot: slot.slot, fieldName: s.cName, cell: slot.cell };
      return [{ src: s.src, ctype: s.ctype, kind: "c-assign", target, value: E(s.init) }];
    }
    case "c-assign": {
      let target = s.target;
      if (target.kind === "name" && slots.has(target.cName)) {
        const slot = slots.get(target.cName)!;
        target = { kind: "field", object: selfRef, slot: slot.slot, fieldName: target.cName, cell: slot.cell };
      } else if (target.kind === "index") {
        target = { ...target, base: E(target.base), index: E(target.index) };
      } else if (target.kind === "field" || target.kind === "dyn-field") {
        target = { ...target, object: E(target.object) };
      }
      return [{ ...s, target, value: E(s.value) }];
    }
    case "c-expr-stmt":
      return [{ ...s, expr: E(s.expr) }];
    case "c-if":
      return [{ ...s, test: E(s.test), then: B(s.then), else: s.else ? B(s.else) : null }];
    case "c-block":
      return [{ ...s, body: B(s.body) }];
    case "c-return":
      return [{ ...s, value: s.value ? E(s.value) : null }];
    case "c-while":
      return [{ ...s, test: E(s.test), body: B(s.body) }];
    case "c-for":
      return [{
        ...s, init: B(s.init), test: s.test ? E(s.test) : null,
        update: s.update ? rewriteStmt(s.update, slots, selfRef)[0] ?? null : null,
        body: B(s.body), elseBlock: s.elseBlock ? B(s.elseBlock) : null,
      }];
    case "c-foreach":
      // Unreachable: a `for :each` containing a suspend is desugared to an explicit cursor loop
      // before this pass, and one without a suspend keeps its own locals -- but those locals are
      // emitter-synthesised and invisible here, so a promoted body must not contain one at all.
      throw new FramePromotionRefusal("`for :each` survived into a generator frame");
    case "c-try":
    case "c-restart-case":
    case "c-handle":
      throw new FramePromotionRefusal(`protected region (${s.kind}) inside a generator`);
    case "c-dispatch":
    case "c-label":
      return [s];
  }
}

function rewriteExpr(e: CExpr, slots: Map<string, FrameSlot>, selfRef: CExpr): CExpr {
  const E = (x: CExpr): CExpr => rewriteExpr(x, slots, selfRef);
  switch (e.kind) {
    case "c-ref": {
      const slot = slots.get(e.cName);
      return slot ? fieldOf(slot, selfRef, e.src) : e;
    }
    case "c-temp": {
      const slot = slots.get(e.name);
      return slot ? fieldOf(slot, selfRef, e.src) : e;
    }
    case "c-lit":
    case "c-nil":
      return e;
    case "c-interp":
      return { ...e, parts: e.parts.map((p) => (typeof p === "string" ? p : E(p))) };
    case "c-call":
      return {
        ...e,
        callee: e.callee.kind === "closure" ? { ...e.callee, fn: E(e.callee.fn) } : e.callee,
        args: e.args.map(E),
      };
    case "c-binop":
      return { ...e, lhs: E(e.lhs), rhs: E(e.rhs) };
    case "c-unop":
      return { ...e, operand: E(e.operand) };
    case "c-ternary":
      return { ...e, test: E(e.test), then: E(e.then), else: E(e.else) };
    case "c-seq":
      return { ...e, exprs: e.exprs.map(E) };
    case "c-vector":
      return { ...e, elements: e.elements.map(E) };
    case "c-map":
      return { ...e, entries: e.entries.map((en) => ({ key: typeof en.key === "string" ? en.key : E(en.key), value: E(en.value) })) };
    case "c-index":
      return { ...e, base: E(e.base), index: E(e.index) };
    case "c-member":
      return { ...e, object: E(e.object) };
    case "c-construct":
      return { ...e, args: e.args.map(E) };
    case "c-field-get":
      return { ...e, object: E(e.object) };
    case "c-closure-make":
      return { ...e, captures: e.captures.map((c) => ({ ...c, value: E(c.value) })) };
    case "c-type-test":
      return { ...e, operand: E(e.operand) };
    case "c-bind":
      return { ...e, value: E(e.value) };
    case "c-box":
    case "c-unbox":
    case "c-cast":
    case "c-copy":
      return { ...e, inner: E(e.inner) } as CExpr;
    case "c-invoke-restart":
      return { ...e, packedArgs: E(e.packedArgs) };
    case "c-signal":
      return { ...e, condition: E(e.condition) };
  }
}

function subBlocks(s: CStmt): CBlock[] {
  switch (s.kind) {
    case "c-if":
      return s.else ? [s.then, s.else] : [s.then];
    case "c-block":
      return [s.body];
    case "c-while":
      return [s.body];
    case "c-for":
      return [s.init, s.body, ...(s.elseBlock ? [s.elseBlock] : [])];
    case "c-foreach":
      return [s.body, ...(s.elseBlock ? [s.elseBlock] : [])];
    case "c-try":
      return [s.tryBlock, ...s.catches.map((c) => c.body), ...(s.finalizer ? [s.finalizer] : [])];
    case "c-restart-case":
      return [s.body, ...s.arms.map((a) => a.body)];
    case "c-handle":
      return [s.body];
    default:
      return [];
  }
}
