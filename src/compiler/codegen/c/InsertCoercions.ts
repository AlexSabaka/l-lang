// P2 -- coercion insertion (spec A6, the family JS erases).
//
// A distinct pass over the CIR (the Grift phase-ordering: cast insertion is its own compilation
// step, never fused into emit). Every typed<->Unknown edge gets an explicit c-box/c-unbox; every
// numeric widening gets a c-cast. P1 stored the EXPECTED type at each edge (callee sigs, decl
// types, binop modes), so this pass is a local rewrite with no context threading.
//
// The count of nodes this pass mints is itself a measurement: how much coercion traffic does the
// gradual boundary generate on a typed target? (JS shows none of it -- that is A6's whole point.)

import type { GapLedger } from "./GapLedger";
import { CBlock, CExpr, CStmt, CModule, CFunction, CLifted } from "./cir";
import { CType, C_BOOL, C_INT, C_REAL, C_STR, C_VALUE, ctypeEquals } from "./ctype";

export class InsertCoercions {
  private inserted = 0;

  constructor(private readonly ledger: GapLedger) {}

  run(m: CModule): CModule {
    const functions = m.functions.map((f) => this.runFunction(f));
    // A lifted closure body always returns boxed `ll_value` (the uniform convention).
    const lifted: CLifted[] = m.lifted.map((l) => ({ ...l, body: this.block(l.body, C_VALUE) }));
    const main = this.block(m.main, { k: "void" });
    if (this.inserted > 0) {
      this.ledger.record("A6", "coercions-inserted", undefined as any, `${this.inserted} box/unbox/cast nodes inserted by the coercion pass`);
    }
    return { functions, lifted, classes: m.classes, globals: m.globals, adapters: m.adapters, main };
  }

  private runFunction(f: CFunction): CFunction {
    const body = this.block(f.body, f.ret);
    if (f.ret.k === "value") {
      // A boxed-return function (including checker-Void ones) must not fall off the end of a
      // non-void C function: a trailing `return nil` is appended (unreachable when the body
      // already returned -- legal C, mechanical rule).
      body.stmts.push({ src: f.src, ctype: { k: "void" }, kind: "c-return", value: { src: f.src, ctype: C_VALUE, kind: "c-nil" } });
    }
    return { ...f, body };
  }

  private block(b: CBlock, ret: CType): CBlock {
    return { stmts: b.stmts.map((s) => this.stmt(s, ret)) };
  }

  private stmt(s: CStmt, ret: CType): CStmt {
    switch (s.kind) {
      case "c-expr-stmt":
        return { ...s, expr: this.expr(s.expr) };
      case "c-decl":
        return { ...s, init: s.init ? this.coerce(this.expr(s.init), s.declCType) : null };
      case "c-assign": {
        let target = s.target;
        if (s.target.kind === "index") {
          // The store index is coerced to the container's key type: a map slot takes a boxed value
          // (ll_map_slot stringifies), a vector slot takes an int.
          const idxT: CType = s.target.mode === "vec" ? C_INT : s.target.mode === "str" ? C_INT : C_VALUE;
          target = { ...s.target, base: this.expr(s.target.base), index: this.coerce(this.expr(s.target.index), idxT) };
        } else if (s.target.kind === "field") target = { ...s.target, object: this.expr(s.target.object) };
        else if (s.target.kind === "dyn-field") target = { ...s.target, object: this.coerce(this.expr(s.target.object), C_VALUE) };
        // A name target keeps its native type; a field/index/dyn-field slot stores boxed (ll_value).
        const expected = s.target.kind === "name" ? s.target.ctype : C_VALUE;
        return { ...s, target, value: this.coerce(this.expr(s.value), expected) };
      }
      case "c-if":
        return { ...s, test: this.coerce(this.expr(s.test), C_BOOL), then: this.block(s.then, ret), else: s.else ? this.block(s.else, ret) : null };
      case "c-block":
        return { ...s, body: this.block(s.body, ret) };
      case "c-return": {
        if (!s.value && ret.k === "value") {
          // A bare `return;` in a boxed-return function returns nil.
          return { ...s, value: { src: s.src, ctype: C_VALUE, kind: "c-nil" } };
        }
        return { ...s, value: s.value ? this.coerce(this.expr(s.value), ret) : null };
      }
      case "c-while":
        return { ...s, test: this.coerce(this.expr(s.test), C_BOOL), body: this.block(s.body, ret) };
      case "c-for":
        return {
          ...s,
          init: this.block(s.init, ret),
          test: s.test ? this.coerce(this.expr(s.test), C_BOOL) : null,
          update: s.update ? this.stmt(s.update, ret) : null,
          body: this.block(s.body, ret),
          elseBlock: s.elseBlock ? this.block(s.elseBlock, ret) : null,
        };
      case "c-try":
        return {
          ...s,
          tryBlock: this.block(s.tryBlock, ret),
          catches: s.catches.map((c) => ({ ...c, body: this.block(c.body, ret) })),
          finalizer: s.finalizer ? this.block(s.finalizer, ret) : null,
        };

      case "c-foreach": {
        // The collection must be a runtime vector; a boxed one is unboxed here. The per-element
        // unbox (varCType concrete) is emitted mechanically by P3 from varCType.
        const coll = this.expr(s.collection);
        const collection = coll.ctype.k === "vec" ? coll : this.coerce(coll, { k: "vec", elem: C_VALUE });
        return { ...s, collection, body: this.block(s.body, ret), elseBlock: s.elseBlock ? this.block(s.elseBlock, ret) : null };
      }

      case "c-restart-case":
        // D47 (Cr-1a): recurse into the body + each arm. Values join through the boxed result temp
        // (assign-dests), so there is no arm-value edge to coerce here.
        return { ...s, body: this.block(s.body, ret), arms: s.arms.map((a) => ({ ...a, body: this.block(a.body, ret) })) };

      case "c-handle":
        // D47 (Cr-1b): recurse into the body only. Clause bodies live in lifted handlers (coerced via
        // m.lifted); captures are already-typed reads like c-closure-make's -- no edge to coerce.
        return { ...s, body: this.block(s.body, ret) };
    }
  }

  private expr(e: CExpr): CExpr {
    switch (e.kind) {
      case "c-lit":
      case "c-ref":
      case "c-temp":
      case "c-nil":
        return e;

      case "c-interp":
        // Interpolations are boxed; the runtime applies JS ToString semantics per part.
        return { ...e, parts: e.parts.map((p) => (typeof p === "string" ? p : this.coerce(this.expr(p), C_VALUE))) };

      case "c-call": {
        const callee = e.callee;
        let args = e.args.map((a) => this.expr(a));
        if (callee.kind === "free") {
          args = args.map((a, i) => this.coerce(a, callee.params[i] ?? C_VALUE));
          return { ...e, args };
        }
        if (callee.kind === "intrinsic") {
          args = callee.variadic
            ? args.map((a) => this.coerce(a, C_VALUE))
            : args.map((a, i) => this.coerce(a, callee.params[i] ?? C_VALUE));
          return { ...e, args };
        }
        // closure: the uniform boxed convention -- fn boxed to an ll_value, every arg boxed.
        args = args.map((a) => this.coerce(a, C_VALUE));
        return { ...e, callee: { kind: "closure", fn: this.coerce(this.expr(callee.fn), C_VALUE) }, args };
      }

      case "c-binop": {
        const lhs = this.expr(e.lhs);
        const rhs = this.expr(e.rhs);
        switch (e.mode) {
          case "int":
            return { ...e, lhs: this.coerce(lhs, C_INT), rhs: this.coerce(rhs, C_INT) };
          case "real":
            return { ...e, lhs: this.coerce(lhs, C_REAL), rhs: this.coerce(rhs, C_REAL) };
          case "bool":
            return { ...e, lhs: this.coerce(lhs, C_BOOL), rhs: this.coerce(rhs, C_BOOL) };
          case "str-cmp":
            return { ...e, lhs: this.coerce(lhs, C_STR), rhs: this.coerce(rhs, C_STR) };
          case "str-concat":
          case "eq-deep":
          case "boxed":
            return { ...e, lhs: this.coerce(lhs, C_VALUE), rhs: this.coerce(rhs, C_VALUE) };
        }
      }

      case "c-unop": {
        const operand = this.expr(e.operand);
        const t: CType = e.mode === "int" ? C_INT : e.mode === "real" ? C_REAL : e.mode === "bool" ? C_BOOL : C_VALUE;
        return { ...e, operand: this.coerce(operand, t) };
      }

      case "c-ternary":
        return {
          ...e,
          test: this.coerce(this.expr(e.test), C_BOOL),
          then: this.coerce(this.expr(e.then), e.ctype),
          else: this.coerce(this.expr(e.else), e.ctype),
        };

      case "c-seq":
        return { ...e, exprs: e.exprs.map((x) => this.expr(x)) };

      case "c-vector":
        // Uniform boxed element storage (the documented v0 repr choice; inflates A6 counts, flagged).
        return { ...e, elements: e.elements.map((el) => this.coerce(this.expr(el), C_VALUE)) };

      case "c-invoke-restart":
        // D47 (Cr-1a): the packed args are passed as a single boxed value; coerce the vector -> ll_value.
        return { ...e, packedArgs: this.coerce(this.expr(e.packedArgs), C_VALUE) };

      case "c-signal":
        // D47 (Cr-1b): ll_signal takes a boxed condition value.
        return { ...e, condition: this.coerce(this.expr(e.condition), C_VALUE) };

      case "c-map":
        return {
          ...e,
          entries: e.entries.map((en) => ({
            key: typeof en.key === "string" ? en.key : this.coerce(this.expr(en.key), C_STR),
            value: this.coerce(this.expr(en.value), C_VALUE),
          })),
        };

      case "c-index": {
        const base = this.expr(e.base);
        const idxT: CType = e.mode === "map" ? C_STR : e.mode === "boxed" ? C_VALUE : C_INT;
        const index = this.coerce(this.expr(e.index), idxT);
        if (e.mode === "vec" && e.ctype.k !== "value") {
          // The runtime returns a boxed element; the static elem type gets an explicit unbox.
          const inner: CExpr = { ...e, base, index, ctype: C_VALUE };
          return this.coerce(inner, e.ctype);
        }
        return { ...e, base, index };
      }

      case "c-member": {
        // A dynamic member read (`ll_dyn_member`) takes a boxed receiver; a typed native accessor
        // takes its concrete receiver.
        const object = this.expr(e.object);
        return { ...e, object: e.needsName ? this.coerce(object, C_VALUE) : object };
      }

      case "c-construct":
        // Fields are stored boxed (ll_value); each constructor arg is coerced to value.
        return { ...e, args: e.args.map((a) => this.coerce(this.expr(a), C_VALUE)) };

      case "c-field-get": {
        // The slot holds a boxed ll_value; unbox to the field's static type.
        const object = this.expr(e.object);
        if (e.ctype.k === "value") return { ...e, object };
        const inner: CExpr = { ...e, object, ctype: C_VALUE };
        return this.coerce(inner, e.ctype);
      }

      case "c-closure-make":
        // Capture values are already-typed reads of enclosing bindings; no edge to coerce. The env
        // field types match by construction.
        return e;

      case "c-type-test":
        // The runtime test takes a boxed value.
        return { ...e, operand: this.coerce(this.expr(e.operand), C_VALUE) };

      case "c-bind":
        // A pattern binding stores into a boxed (ll_value) pattern variable.
        return { ...e, value: this.coerce(this.expr(e.value), C_VALUE) };

      case "c-copy":
        return { ...e, inner: this.expr(e.inner) };

      case "c-box":
      case "c-unbox":
      case "c-cast":
        return e; // only this pass mints them; nested ones are already coherent

      default: {
        const never: never = e;
        throw new Error(`InsertCoercions: unhandled expr kind '${(never as any).kind}'`);
      }
    }
  }

  /** The single edge rule: make `e` be of type `to`, minting the explicit coercion JS erases. */
  private coerce(e: CExpr, to: CType): CExpr {
    const from = e.ctype;
    if (ctypeEquals(from, to)) return e;
    if (to.k === "void") return e;
    if (from.k === "void") {
      // A void expression in value position (JS: the call evaluates to undefined). Evaluate for
      // effect, then yield nil -- C's comma operator, made explicit.
      this.ledger.record("new", "void-in-value-position", e.src, "void call used as a value; sequenced with nil (JS yields undefined)");
      const seq: CExpr = { src: e.src, ctype: C_VALUE, kind: "c-seq", exprs: [e, { src: e.src, ctype: C_VALUE, kind: "c-nil" }] };
      return this.coerce(seq, to);
    }

    // vec<T> ~ vec<U>: storage is uniformly boxed, so the static elem type is a compile-time fiction
    // here -- the coercion is a no-op at runtime. (Flagged in the ledger as part of the repr choice.)
    if (from.k === "vec" && to.k === "vec") return { ...e, ctype: to };

    this.inserted++;
    if (to.k === "value") {
      return { src: e.src, ctype: C_VALUE, kind: "c-box", inner: e, from };
    }
    if (from.k === "value") {
      return { src: e.src, ctype: to, kind: "c-unbox", inner: e, to };
    }
    return { src: e.src, ctype: to, kind: "c-cast", inner: e, from, to };
  }
}
