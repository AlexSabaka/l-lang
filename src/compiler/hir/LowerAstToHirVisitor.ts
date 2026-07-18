// The AST -> HIR lowering pass. Runs as a Context stage after the type channel is published and
// before codegen (Context.processModule). It reads the typed AST + `context.nodeTypes` and produces a
// HirModule side-table of lowered FUNCTION BODIES; it emits nothing.
//
// Not a BaseAstVisitor subclass: that dispatch is unary `(node) -> any`, but destination-driven
// lowering is inherently `(node, dest) -> {stmts, value}`. Threading the destination down and the
// (statements, value) pair back through instance fields is exactly the ambient-state pattern this
// codebase has spent phases removing, so the pass owns its own recursion (as DesugarAstVisitor does).
//
// The destination `Dest` is the ReScript `continuation` / Dybvig DDCG / rustc `expr_into_dest` idea:
// one mechanism that subsumes tail-return injection (`withTrailingReturn`), value-position control
// flow (`asExpression`'s ternary/IIFE), and dead-code-after-return. A value-position `if` whose arms
// are pure becomes a ternary (the peephole, byte-identical to today); otherwise a fresh temp assigned
// in each arm -- never an IIFE.
//
// Scope of this step (R1, S2): if/when/cond, blocks, function/method bodies and tail returns, plus
// the two RHS-bearing statements a value-position conditional hides inside (`let`/`mut` init and
// assignment). `match` (S3), operand hoisting and lazy `||`/`&&` (S4) are separate. The PROGRAM
// top-level is intentionally NOT lowered here: the function-form check in codegen keys off scope
// DEPTH (`scope[1] === program`), and lowering top-level control flow would drop an intermediate
// scope; a function body always keeps its own function scope on the stack, so the depth invariant
// holds there. Everything not modelled is an OPAQUE LEAF -- the AST subtree carried in `src`, emitted
// by the legacy visitor unchanged. Opaque is the always-correct fallback.

import type { Context } from "../Context";
import * as ast from "../frontend/ast";
import type { InferredType } from "../analysis/SymbolTable";
import { classifyList } from "../analysis/listForm";
import { HirModule } from "./HirModule";
import { TempAllocator } from "./TempAllocator";
import {
  HBase,
  HBlock,
  HCatch,
  HExpr,
  HIf,
  HMapEntry,
  HReturn,
  HStmt,
} from "./nodes";

/** Where the value of the node being lowered must go -- the "continuation". */
type Dest =
  | { kind: "effect" } // statement position; the value is discarded
  | { kind: "value" } // an operand; produce (stmts, atom)
  | { kind: "assign"; temp: string } // write the result into this temp
  | { kind: "return" }; // tail; every path must return from the function

interface Lowered {
  stmts: HStmt[];
  /** The resulting atom, meaningful only for a `value` dest. `null` = the path diverged (a `return`). */
  value: HExpr | null;
}

const EFFECT: Dest = { kind: "effect" };
const VALUE: Dest = { kind: "value" };

/**
 * Node types whose value is IMMOVABLE -- a literal with no side effect and no dependence on mutable
 * state, so it may be evaluated at the call site even after an earlier operand's prelude ran, without
 * changing behaviour. Used by the unnest rule (S4): an operand that is not immovable and sits before a
 * hoisting operand is bound to a temp to preserve left-to-right evaluation order.
 */
const LITERAL_TYPES: ReadonlySet<string> = new Set([
  "integer-number", "float-number", "hex-number", "octal-number", "binary-number",
  "fraction-number", "complex-number", "string", "boolean", "null",
]);

export class LowerAstToHirVisitor {
  private readonly temps = new TempAllocator();

  constructor(private readonly context: Context) {}

  /**
   * Lower the program top level and every function/method body into a HirModule side-table, keyed by
   * node identity. The program body is a statement sequence (effect dest) -- no tail return -- so
   * top-level value-position control flow no longer falls through to the legacy emitter.
   */
  lower(root: ast.ASTNode): HirModule {
    const module = new HirModule();
    if (root._type === "program") {
      module.set(root, { stmts: this.lowerSeq((root as ast.ProgramNode).program ?? [], EFFECT).stmts });
    }
    this.walkFunctions(root, (fn) => {
      module.set(fn, { stmts: this.lowerSeq(fn.body ?? [], EFFECT).stmts });
    });
    return module;
  }

  // -- tree walk: find every FunctionNode (including nested) -----------------------------------------

  private walkFunctions(node: any, onFn: (fn: ast.FunctionNode) => void): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const c of node) this.walkFunctions(c, onFn);
      return;
    }
    if (typeof node._type === "string" && node._type === "function") {
      onFn(node as ast.FunctionNode);
    }
    for (const k of Object.keys(node)) {
      if (k.startsWith("_")) continue; // _type (string), _parent (cycle), _location
      this.walkFunctions((node as any)[k], onFn);
    }
  }

  // -- node constructors ----------------------------------------------------------------------------

  private base(src: ast.ASTNode): HBase {
    return { src, type: this.context.nodeTypes.get(src) };
  }

  private nil(src: ast.ASTNode): HExpr {
    return { ...this.base(src), kind: "nil" };
  }

  private opaqueExpr(src: ast.ASTNode): HExpr {
    return { ...this.base(src), kind: "opaque-expr" };
  }

  private temp(name: string, src: ast.ASTNode): HExpr {
    return { ...this.base(src), kind: "temp", name };
  }

  private declTemp(name: string, src: ast.ASTNode): HStmt {
    return { ...this.base(src), kind: "decl-temp", name, init: null };
  }

  private assignTemp(name: string, value: HExpr, src: ast.ASTNode): HStmt {
    return { ...this.base(src), kind: "assign-temp", name, value, isStore: false };
  }

  private exprStmt(expr: HExpr, src: ast.ASTNode): HStmt {
    return { ...this.base(src), kind: "expr-stmt", expr };
  }

  private hReturn(value: HExpr | null, isStore: boolean, src: ast.ASTNode): HReturn {
    return { ...this.base(src), kind: "return", value, isStore };
  }

  private hIf(test: HExpr, then: HBlock, els: HBlock | null, src: ast.ASTNode): HIf {
    return { ...this.base(src), kind: "if", test, then, else: els };
  }

  private declTempInit(name: string, init: HExpr, src: ast.ASTNode): HStmt {
    return { ...this.base(src), kind: "decl-temp", name, init };
  }

  private blockStmt(stmts: HStmt[], src: ast.ASTNode): HStmt {
    return { ...this.base(src), kind: "block", body: { stmts } };
  }

  private patternTest(pattern: ast.PatternNode, scrutName: string, guard: ast.ASTNode | undefined, src: ast.ASTNode): HExpr {
    return { ...this.base(src), kind: "pattern-test", pattern, scrutName, guard };
  }

  private hoist(src: ast.ASTNode): HStmt {
    return { ...this.base(src), kind: "hoist" };
  }

  // -- the driver -----------------------------------------------------------------------------------

  private lowerNode(node: ast.ASTNode, dest: Dest): Lowered {
    switch (node._type) {
      case "if":
        return this.lowerIf(node as ast.IfNode, dest);
      case "when":
        return this.lowerWhen(node as ast.WhenNode, dest);
      case "cond":
        return this.lowerCond(node as ast.CondNode, dest);
      case "match":
        return this.lowerMatch(node as ast.MatchNode, dest);
      case "vector":
        return this.lowerVector(node as ast.VectorNode, dest);
      case "matrix":
        return this.lowerMatrix(node as ast.MatrixNode, dest);
      case "map":
        return this.lowerMap(node as ast.MapNode, dest);
      case "member":
        return this.lowerMember(node as ast.MemberNode, dest);
      case "indexer":
        return this.lowerIndexer(node as ast.IndexerNode, dest);
      case "try-catch":
        return this.lowerTry(node as ast.TryCatchNode, dest);
      case "await":
        return this.lowerViaLegacy(
          node,
          [(node as ast.AwaitNode).expression],
          ([e]) => ({ ...(node as ast.AwaitNode), expression: e } as ast.ASTNode),
          dest
        );
      case "spread":
        return this.lowerViaLegacy(
          node,
          [(node as ast.SpreadNode).expression],
          ([e]) => ({ ...(node as ast.SpreadNode), expression: e } as ast.ASTNode),
          dest
        );
      case "formatted-string":
        return this.lowerFormattedString(node as ast.FormattedStringNode, dest);
      case "variable":
        return this.lowerVariable(node as ast.VariableNode, dest);
      case "simple-assignment":
      case "compound-assignment":
        return this.lowerAssignment(node as any, dest);
      case "list":
        return this.lowerList(node as ast.ListNode, dest);
      default:
        return this.leaf(node, dest);
    }
  }

  /** A statement sequence (a block, or a function body). Last item takes `dest`; the rest are effects. */
  private lowerSeq(items: ast.ASTNode[], dest: Dest): Lowered {
    const stmts: HStmt[] = [];
    if (items.length === 0) return { stmts, value: null };
    for (let i = 0; i < items.length; i++) {
      const isLast = i === items.length - 1;
      const r = this.lowerNode(items[i], isLast ? dest : EFFECT);
      stmts.push(...r.stmts);
      if (isLast) return { stmts, value: dest.kind === "value" ? r.value : null };
    }
    return { stmts, value: null };
  }

  private lowerList(node: ast.ListNode, dest: Dest): Lowered {
    const form = classifyList(node);
    switch (form.kind) {
      case "block":
        return this.lowerSeq(form.items, dest);
      case "grouping":
        return this.lowerNode(form.inner, dest);
      case "special":
        // `(return e)` transfers control to the function boundary; push it into e's branches so a
        // value-position `return` finally works (D40/LL0103).
        if (form.name === "return") return this.lowerReturn(node, form.args);
        // `quote` is DATA, not evaluated -- never lower its operand.
        if (form.name === "quote") return this.leaf(node, dest);
        // new / yield / throw / typeof / delete / instanceof / in (and operand-less this / super):
        // keep the special form legacy, atomize its operands through the HIR (the class name of a
        // `new` is a plain identifier, so it stays inline and constructor detection is unaffected).
        return this.lowerCallLike(node, dest);
      case "call":
        // `||`/`&&` short-circuit, so a prelude-bearing right operand can't be hoisted eagerly.
        if (this.isLogicalHead(node)) return this.lowerLogical(node, dest);
        return this.lowerCallLike(node, dest);
      case "apply":
        return this.lowerCallLike(node, dest);
      default:
        // empty -- opaque.
        return this.leaf(node, dest);
    }
  }

  private isLogicalHead(node: ast.ListNode): boolean {
    const head = node.nodes[0];
    return head?._type === "simple-identifier" && ((head as ast.SimpleIdentifierNode).id === "||" || (head as ast.SimpleIdentifierNode).id === "&&");
  }

  private lowerReturn(node: ast.ListNode, args: ast.ASTNode[]): Lowered {
    if (args.length === 0) return { stmts: [this.hReturn(null, false, node)], value: null };
    if (args.length > 1) return this.leaf(node, { kind: "return" }); // malformed; keep legacy shape
    // `return` ignores the incoming dest -- it always returns from the function (diverges).
    return this.lowerNode(args[0], { kind: "return" });
  }

  // -- operand hoisting (S4): unnest + lazy logical --------------------------------------------------

  /**
   * A call/apply whose arguments may contain value-position control flow or a diverging `return`. Lower
   * each argument; if any needs statements (or diverges), emit them as a prelude and rebuild the call
   * with the hoisted arguments substituted -- then hand the rebuilt call to the legacy emitter (its
   * dispatch/copy stay legacy; that is R2-R4). The callee is left untouched (hoisting it would break
   * constructor/method detection). The UNNEST rule preserves evaluation order: an earlier non-immovable
   * argument that precedes a hoisting one is bound to a temp so its effects run first.
   */
  /**
   * Lower a node whose STRUCTURE stays legacy (a call and its dispatch, a `new`, an await, a formatted
   * string) but whose value-position CHILDREN must go through the HIR. Each child is lowered; any that
   * is hoisting, diverging, or COMPOUND (a ternary / inverted collection -- not a temp or opaque leaf)
   * is bound to a temp the HIR emits, then substituted into a rebuilt AST node the legacy emitter
   * visits. So a control-flow child never reaches legacy asExpression. Plain-leaf children stay inline;
   * the unnest binds an earlier effectful child before a hoisting one.
   */
  private lowerViaLegacy(
    node: ast.ASTNode,
    children: ast.ASTNode[],
    rebuild: (newChildren: ast.ASTNode[]) => ast.ASTNode,
    dest: Dest
  ): Lowered {
    if (children.length === 0) return this.leaf(node, dest);
    const lowered = children.map((c) => this.lowerNode(c, VALUE));
    let last = -1;
    for (let i = 0; i < lowered.length; i++) {
      if (lowered[i].stmts.length > 0 || lowered[i].value === null) last = i;
    }
    const anyCompound = lowered.some((l) => l.value !== null && !this.isSubstitutable(l.value));
    if (last === -1 && !anyCompound) return this.leaf(node, dest); // all children plain leaves -> unchanged

    const prelude: HStmt[] = [];
    const finalChildren: ast.ASTNode[] = [];
    for (let i = 0; i < lowered.length; i++) {
      const l = lowered[i];
      prelude.push(...l.stmts);
      if (l.value === null) return { stmts: prelude, value: null }; // a child diverged (return in operand)
      const mustBind = !this.isSubstitutable(l.value) || (i < last && !this.isImmovable(l.value));
      const atom = mustBind
        ? (this.temps.fresh() as string)
        : null;
      if (atom !== null) {
        prelude.push(this.declTempInit(atom, l.value, children[i]));
        finalChildren.push(this.hexprToAst(this.temp(atom, children[i]), children[i]));
      } else {
        finalChildren.push(this.hexprToAst(l.value, children[i]));
      }
    }
    const rebuilt = rebuild(finalChildren);
    const t = this.context.nodeTypes.get(node);
    if (t) this.context.recordSynthesizedNodeType(rebuilt, t);
    const inner = this.leaf(rebuilt, dest);
    return { stmts: [...prelude, ...inner.stmts], value: inner.value };
  }

  private lowerCallLike(node: ast.ListNode, dest: Dest): Lowered {
    // Callee (nodes[0]) is left untouched -- hoisting it would break constructor/method detection.
    return this.lowerViaLegacy(
      node,
      node.nodes.slice(1),
      (args) => ({ ...node, nodes: [node.nodes[0], ...args] } as ast.ListNode),
      dest
    );
  }

  private isSubstitutable(h: HExpr): boolean {
    return h.kind === "temp" || h.kind === "opaque-expr";
  }

  private lowerFormattedString(node: ast.FormattedStringNode, dest: Dest): Lowered {
    // The string segments stay; only the `{expr}` interpolations are value-position children.
    const slots: number[] = [];
    const children: ast.ASTNode[] = [];
    (node.value ?? []).forEach((v, i) => {
      if (v._type === "format-expression") {
        slots.push(i);
        children.push((v as ast.FormatExpressionNode).expression);
      }
    });
    if (children.length === 0) return this.leaf(node, dest);
    return this.lowerViaLegacy(
      node,
      children,
      (newExprs) => {
        const newValue = [...node.value];
        slots.forEach((slot, k) => {
          newValue[slot] = { ...(node.value[slot] as ast.FormatExpressionNode), expression: newExprs[k] } as ast.ASTNode;
        });
        return { ...node, value: newValue } as ast.ASTNode;
      },
      dest
    );
  }

  /**
   * `(|| a b ...)` / `(&& a b ...)` where a right operand needs a prelude. A shim call would evaluate
   * that operand eagerly (defeating the short-circuit), so lower to a temp + guarded if-chain instead.
   * When no right operand has a prelude, stay opaque -- the legacy native LogicalExpression, zero churn.
   */
  private lowerLogical(node: ast.ListNode, dest: Dest): Lowered {
    const op = (node.nodes[0] as ast.SimpleIdentifierNode).id as "||" | "&&";
    const args = node.nodes.slice(1);
    if (args.length <= 1) return this.leaf(node, dest);

    const lowered = args.map((a) => this.lowerNode(a, VALUE));
    const rhsNeedsPrelude = lowered.slice(1).some((l) => l.stmts.length > 0 || l.value === null);
    if (!rhsNeedsPrelude) return this.leaf(node, dest); // native LogicalExpression

    const first = lowered[0];
    if (first.value === null) return { stmts: first.stmts, value: null }; // a0 diverges

    const t = this.temps.fresh();
    const stmts: HStmt[] = [...first.stmts, this.declTempInit(t, first.value, args[0])];
    for (let i = 1; i < lowered.length; i++) {
      const l = lowered[i];
      const evalBlock: HStmt[] = [...l.stmts];
      if (l.value !== null) evalBlock.push(this.assignTemp(t, l.value, args[i]));
      // ||: evaluate the next operand only when `t` is still falsy (else branch);
      // &&: only when `t` is still truthy (then branch). A diverged operand ends in its own return/throw.
      const test = this.temp(t, args[i]);
      stmts.push(
        op === "||"
          ? this.hIf(test, { stmts: [] }, { stmts: evalBlock }, args[i])
          : this.hIf(test, { stmts: evalBlock }, null, args[i])
      );
    }
    return this.placeValue(this.temp(t, node), stmts, dest);
  }

  /**
   * Lower a list of value-position children to ATOMS (HExprs), hoisting any that need statements into
   * a shared prelude and applying the unnest rule for evaluation order. Unlike `lowerCallLike` (which
   * substitutes temps back into an AST node for the LEGACY emitter), this keeps the children as HExprs
   * for a FULLY-INVERTED parent the HIR emitter builds itself -- so a pure control-flow child stays a
   * ternary and never reaches legacy `asExpression`.
   */
  private lowerChildrenToAtoms(children: ast.ASTNode[]): { prelude: HStmt[]; atoms: HExpr[]; diverged: boolean } {
    const lowered = children.map((c) => this.lowerNode(c, VALUE));
    let last = -1;
    for (let i = 0; i < lowered.length; i++) {
      if (lowered[i].stmts.length > 0 || lowered[i].value === null) last = i;
    }
    const prelude: HStmt[] = [];
    const atoms: HExpr[] = [];
    for (let i = 0; i < lowered.length; i++) {
      const l = lowered[i];
      prelude.push(...l.stmts);
      if (l.value === null) return { prelude, atoms, diverged: true };
      if (i < last && !this.isImmovable(l.value)) {
        const t = this.temps.fresh();
        prelude.push(this.declTempInit(t, l.value, children[i]));
        atoms.push(this.temp(t, children[i]));
      } else {
        atoms.push(l.value);
      }
    }
    return { prelude, atoms, diverged: false };
  }

  private lowerVector(node: ast.VectorNode, dest: Dest): Lowered {
    const { prelude, atoms, diverged } = this.lowerChildrenToAtoms(node.values ?? []);
    if (diverged) return { stmts: prelude, value: null };
    const vec: HExpr = { ...this.base(node), kind: "vector", elements: atoms };
    return this.placeValue(vec, prelude, dest);
  }

  private lowerMatrix(node: ast.MatrixNode, dest: Dest): Lowered {
    const rows = node.rows ?? [];
    // Flatten cells for one row-major hoist (preserving evaluation order), then re-split into rows.
    const { prelude, atoms, diverged } = this.lowerChildrenToAtoms(rows.flat());
    if (diverged) return { stmts: prelude, value: null };
    const hrows: HExpr[][] = [];
    let idx = 0;
    for (const row of rows) {
      hrows.push(atoms.slice(idx, idx + row.length));
      idx += row.length;
    }
    const mat: HExpr = { ...this.base(node), kind: "matrix", rows: hrows };
    return this.placeValue(mat, prelude, dest);
  }

  private lowerMap(node: ast.MapNode, dest: Dest): Lowered {
    const entries = (node.values ?? []) as ast.KeyValueNode[];
    // Flat child list in evaluation order: a COMPUTED key (a non-`:id` key), then the value, per entry.
    const children: ast.ASTNode[] = [];
    const shape: { i: number; part: "key" | "value" }[] = [];
    entries.forEach((kv, i) => {
      if (kv.key._type !== "simple-identifier") {
        children.push(kv.key);
        shape.push({ i, part: "key" });
      }
      children.push(kv.value);
      shape.push({ i, part: "value" });
    });
    const { prelude, atoms, diverged } = this.lowerChildrenToAtoms(children);
    if (diverged) return { stmts: prelude, value: null };
    const hentries: HMapEntry[] = entries.map((kv) => ({
      src: kv,
      keyLiteral: kv.key._type === "simple-identifier" ? (kv.key as ast.SimpleIdentifierNode).id : undefined,
      value: this.nil(kv), // placeholder, filled below
    }));
    shape.forEach((slot, k) => {
      if (slot.part === "key") hentries[slot.i].key = atoms[k];
      else hentries[slot.i].value = atoms[k];
    });
    const map: HExpr = { ...this.base(node), kind: "map", entries: hentries };
    return this.placeValue(map, prelude, dest);
  }

  private lowerMember(node: ast.MemberNode, dest: Dest): Lowered {
    const { prelude, atoms, diverged } = this.lowerChildrenToAtoms([node.object, node.property]);
    if (diverged) return { stmts: prelude, value: null };
    const mem: HExpr = {
      ...this.base(node),
      kind: "member",
      object: atoms[0],
      property: atoms[1],
      computed: node.computed,
    };
    return this.placeValue(mem, prelude, dest);
  }

  private lowerIndexer(node: ast.IndexerNode, dest: Dest): Lowered {
    const flatIndices: ast.ASTNode[] = [];
    const flags: boolean[] = [];
    (node.indices ?? []).forEach((group, g) => {
      for (const idx of group) {
        flatIndices.push(idx);
        flags.push(node.members?.[g] === true);
      }
    });
    const { prelude, atoms, diverged } = this.lowerChildrenToAtoms([node.id, ...flatIndices]);
    if (diverged) return { stmts: prelude, value: null };
    const steps = atoms.slice(1).map((index, i) => ({ isMember: flags[i], index }));
    const idx: HExpr = { ...this.base(node), kind: "index", base: atoms[0], steps };
    return this.placeValue(idx, prelude, dest);
  }

  private isImmovable(h: HExpr): boolean {
    if (h.kind === "temp" || h.kind === "nil") return true;
    if (h.kind === "opaque-expr") return LITERAL_TYPES.has(h.src._type);
    return false;
  }

  /** Place an already-computed value (with its prelude) into a destination. */
  private placeValue(value: HExpr, prelude: HStmt[], dest: Dest): Lowered {
    switch (dest.kind) {
      case "value":
        return { stmts: prelude, value };
      case "effect":
        // Evaluated for effect: keep the expression as a statement so its own side effects still run
        // (a bare temp is a harmless `t;`).
        return { stmts: [...prelude, this.exprStmt(value, value.src)], value: null };
      case "assign":
        return { stmts: [...prelude, this.assignTemp(dest.temp, value, value.src)], value: null };
      case "return":
        return { stmts: [...prelude, this.hReturn(value, true, value.src)], value: null };
    }
  }

  /** A leaf: the node is an atom as far as HIR is concerned. `src` carries it; the legacy emitter re-visits. */
  private leaf(node: ast.ASTNode, dest: Dest): Lowered {
    switch (dest.kind) {
      case "value":
        return { stmts: [], value: this.opaqueExpr(node) };
      case "effect":
        return { stmts: [{ ...this.base(node), kind: "opaque-stmt" }], value: null };
      case "assign":
        return { stmts: [this.assignTemp(dest.temp, this.opaqueExpr(node), node)], value: null };
      case "return":
        return { stmts: [this.hReturn(this.opaqueExpr(node), true, node)], value: null };
    }
  }

  // -- if / when / cond -----------------------------------------------------------------------------

  private lowerIf(node: ast.IfNode, dest: Dest): Lowered {
    const cond = this.lowerNode(node.condition, VALUE);
    if (cond.value === null) return { stmts: cond.stmts, value: null }; // condition diverged
    const test = cond.value;

    if (dest.kind === "value") {
      const thenL = this.lowerNode(node.then, VALUE);
      const elseL = node.else ? this.lowerNode(node.else, VALUE) : { stmts: [], value: this.nil(node) };
      // Peephole: both arms pure -> ternary (byte-identical to legacy asExpression's ternary).
      if (thenL.stmts.length === 0 && elseL.stmts.length === 0 && thenL.value && elseL.value) {
        return {
          stmts: cond.stmts,
          value: { ...this.base(node), kind: "ternary", test, then: thenL.value, else: elseL.value },
        };
      }
      const t = this.temps.fresh();
      const ifStmt = this.hIf(
        test,
        this.blockAssigning(thenL, t, node.then),
        this.blockAssigning(elseL, t, node.else ?? node),
        node
      );
      return {
        stmts: [...cond.stmts, this.declTemp(t, node), ifStmt],
        value: this.temp(t, node),
      };
    }

    // effect / assign / return: push the dest INTO both arms.
    const thenL = this.lowerNode(node.then, dest);
    const elseL = node.else ? this.lowerNode(node.else, dest) : this.missingElse(dest, node);
    const els: HBlock | null =
      dest.kind === "effect" && !node.else ? null : { stmts: elseL.stmts };
    return { stmts: [...cond.stmts, this.hIf(test, { stmts: thenL.stmts }, els, node)], value: null };
  }

  private lowerWhen(node: ast.WhenNode, dest: Dest): Lowered {
    const cond = this.lowerNode(node.condition, VALUE);
    if (cond.value === null) return { stmts: cond.stmts, value: null }; // condition diverged
    const test = cond.value;
    const then = node.then ?? [];

    if (dest.kind === "value") {
      const thenL = this.lowerSeq(then, VALUE);
      const elseL: Lowered = { stmts: [], value: this.nil(node) };
      if (thenL.stmts.length === 0 && thenL.value) {
        return {
          stmts: cond.stmts,
          value: { ...this.base(node), kind: "ternary", test, then: thenL.value, else: elseL.value! },
        };
      }
      const t = this.temps.fresh();
      const ifStmt = this.hIf(
        test,
        this.blockAssigning(thenL, t, node),
        this.blockAssigning(elseL, t, node),
        node
      );
      return { stmts: [...cond.stmts, this.declTemp(t, node), ifStmt], value: this.temp(t, node) };
    }

    // effect / assign / return: run the body with the dest when true; the false path yields nil (for a
    // value-carrying dest) or nothing (effect).
    const thenL = this.lowerSeq(then, dest);
    const els = dest.kind === "effect" ? null : this.missingElseBlock(dest, node);
    return { stmts: [...cond.stmts, this.hIf(test, { stmts: thenL.stmts }, els, node)], value: null };
  }

  private lowerCond(node: ast.CondNode, dest: Dest): Lowered {
    if (dest.kind === "value") {
      const t = this.temps.fresh();
      const chain = this.buildCondChain(node.cases, { kind: "assign", temp: t }, node);
      if (chain === null) return this.leaf(node, dest); // a test needed prelude -> keep legacy shape
      return { stmts: [this.declTemp(t, node), chain], value: this.temp(t, node) };
    }
    const chain = this.buildCondChain(node.cases, dest, node);
    if (chain === null) return this.leaf(node, dest);
    return { stmts: [chain], value: null };
  }

  /** Right-fold the cond cases into an if/else-if chain. Returns null if a test needs prelude (bail to opaque). */
  private buildCondChain(cases: ast.CondCaseNode[], dest: Dest, node: ast.ASTNode): HStmt | null {
    let chain: HStmt | null = null;
    for (let i = cases.length - 1; i >= 0; i--) {
      const c = cases[i];
      const bodyL = this.lowerNode(c.body, dest);
      const bodyBlock: HBlock = { stmts: bodyL.stmts };

      if (this.isElseCase(c)) {
        // The `(else ...)` catch-all IS the final alternate. Brace it (a block) so a chain that ends
        // in a bare `if` cannot capture it.
        chain = { ...this.base(c), kind: "block", body: bodyBlock };
        continue;
      }

      const test = this.lowerNode(c.condition, VALUE);
      if (test.stmts.length > 0) return null; // value-position control flow in a test -> opaque
      chain = this.hIf(
        test.value!,
        bodyBlock,
        chain ? { stmts: [chain] } : dest.kind === "effect" ? null : this.missingElseBlock(dest, node),
        c
      );
    }
    return chain;
  }

  private isElseCase(c: ast.CondCaseNode): boolean {
    const cond = c.condition as any;
    return cond?._type === "simple-identifier" && cond.id === "else";
  }

  // -- try / catch / finally ------------------------------------------------------------------------

  private lowerTry(node: ast.TryCatchNode, dest: Dest): Lowered {
    const catchVar = this.temps.fresh();
    if (dest.kind === "value") {
      // Value-position try: bind a result temp, each arm assigns it (no IIFE).
      const result = this.temps.fresh();
      const htry = this.buildTry(node, catchVar, { kind: "assign", temp: result });
      return { stmts: [this.declTemp(result, node), htry], value: this.temp(result, node) };
    }
    return { stmts: [this.buildTry(node, catchVar, dest)], value: null };
  }

  private buildTry(node: ast.TryCatchNode, catchVar: string, bodyDest: Dest): HStmt {
    const tryBlock: HBlock = { stmts: this.lowerNode(node.try, bodyDest).stmts };
    const catches: HCatch[] = (node.catch ?? []).map((c) => ({
      errorName: c.filter?.name,
      filterTypeName: c.filter?.type?.name,
      body: { stmts: this.lowerNode(c.body, bodyDest).stmts },
    }));
    const finalizer: HBlock | null = node.finally
      ? { stmts: this.lowerNode(node.finally, EFFECT).stmts }
      : null;
    return { ...this.base(node), kind: "try", tryBlock, catchVar, catches, finalizer };
  }

  // -- match ----------------------------------------------------------------------------------------

  private lowerMatch(node: ast.MatchNode, dest: Dest): Lowered {
    // De-IIFE the one construct that is ALWAYS an arrow today. The scrutinee is bound once to a temp;
    // the pattern variables are hoisted into a fresh block scope (so nested matches with the same
    // binding name don't collide); the arms become an if/ELSE chain (never sequential ifs -- a later
    // arm's pattern test must not run once one matched, and pattern tests bind as a side effect).
    const scrutL = this.lowerNode(node.expression, VALUE);
    if (scrutL.value === null) return { stmts: scrutL.stmts, value: null }; // scrutinee diverged
    const scrut = this.temps.fresh();

    if (dest.kind === "value") {
      const result = this.temps.fresh();
      const chain = this.buildMatchChain(node, scrut, { kind: "assign", temp: result });
      const blockStmts: HStmt[] = [
        ...scrutL.stmts,
        this.declTempInit(scrut, scrutL.value!, node),
        this.hoist(node),
        ...(chain ? [chain] : []),
      ];
      return {
        stmts: [this.declTemp(result, node), this.blockStmt(blockStmts, node)],
        value: this.temp(result, node),
      };
    }

    // effect / assign / return: the arms take the dest directly (a `return` arm returns from the
    // function -- D40, retiring the per-arm LL0103 refusal).
    const chain = this.buildMatchChain(node, scrut, dest);
    const blockStmts: HStmt[] = [
      ...scrutL.stmts,
      this.declTempInit(scrut, scrutL.value!, node),
      this.hoist(node),
      ...(chain ? [chain] : []),
    ];
    return { stmts: [this.blockStmt(blockStmts, node)], value: null };
  }

  /** Fold the match arms into an if/else chain. The final else is the D9 "no arm matched" -> nil tail. */
  private buildMatchChain(node: ast.MatchNode, scrutName: string, dest: Dest): HStmt | null {
    const cases = node.cases ?? [];
    const tail: HBlock | null =
      dest.kind === "assign"
        ? { stmts: [this.assignTemp(dest.temp, this.nil(node), node)] }
        : dest.kind === "return"
        ? { stmts: [this.hReturn(this.nil(node), false, node)] }
        : null; // effect: no arm matched -> nothing

    let elseBlock: HBlock | null = tail;
    let out: HStmt | null = null;
    for (let i = cases.length - 1; i >= 0; i--) {
      const c = cases[i];
      const armL = this.lowerNode(c.body, dest);
      out = this.hIf(this.patternTest(c.pattern, scrutName, c.guard, c), { stmts: armL.stmts }, elseBlock, c);
      elseBlock = { stmts: [out] };
    }
    if (out === null) return tail ? this.blockStmt(tail.stmts, node) : null; // no cases
    return out;
  }

  // -- variable / assignment (a value-position conditional hides in the RHS) -------------------------

  private lowerVariable(node: ast.VariableNode, dest: Dest): Lowered {
    // A bodyless declaration -- an `:extern` `let` (an ambient global, Sd) -- has no initializer.
    // Nothing to lower; emit it unchanged.
    if (!node.value) return this.leaf(node, dest);
    const init = this.lowerNode(node.value, VALUE);
    if (init.value === null) return { stmts: init.stmts, value: null }; // RHS diverged -> the binding is dead
    if (init.stmts.length === 0) {
      // Pure init -> emit the variable unchanged. Legacy visitVariable owns destructuring / D11 copy /
      // const-vs-let, and the pure case stays byte-identical.
      return this.leaf(node, dest);
    }
    // The init needed statements (a value-position conditional, or a hoisted collection element). Emit
    // the prelude, then a REBUILT variable whose init is a substitutable atom; legacy visitVariable
    // still owns the declaration (destructuring / D11 copy / const-vs-let) over that atom.
    const prelude: HStmt[] = [...init.stmts];
    const valueAst = this.atomizeForSubstitution(init.value, prelude, node.value);
    const rebuilt: ast.VariableNode = { ...node, value: valueAst };
    const tail: HStmt = { ...this.base(rebuilt), kind: "opaque-stmt" };
    return { stmts: [...prelude, tail], value: dest.kind === "value" ? this.nil(node) : null };
  }

  private lowerAssignment(node: ast.SimpleAssignmentNode | ast.CompoundAssignmentNode, dest: Dest): Lowered {
    const rhs = this.lowerNode(node.value, VALUE);
    if (rhs.value === null) return { stmts: rhs.stmts, value: null }; // RHS diverged -> the assignment is dead
    if (rhs.stmts.length === 0) return this.leaf(node, dest);
    const prelude: HStmt[] = [...rhs.stmts];
    const valueAst = this.atomizeForSubstitution(rhs.value, prelude, node.value);
    const rebuilt: any = { ...node, value: valueAst };
    const tail: HStmt = { ...this.base(rebuilt), kind: "opaque-stmt" };
    return { stmts: [...prelude, tail], value: dest.kind === "value" ? this.nil(node) : null };
  }

  /**
   * Ensure a lowered value can be SUBSTITUTED into an AST node the legacy emitter will visit. A temp or
   * an opaque leaf goes straight in; a COMPOUND HExpr (a fully-inverted HVector, a ternary) is not an
   * AST node, so bind it to a fresh temp -- emitted by the HIR -- and substitute that. Any binding is
   * appended to `prelude`.
   */
  private atomizeForSubstitution(value: HExpr, prelude: HStmt[], srcForLoc: ast.ASTNode): ast.ASTNode {
    if (value.kind === "temp" || value.kind === "opaque-expr") return this.hexprToAst(value, srcForLoc);
    const t = this.temps.fresh();
    prelude.push(this.declTempInit(t, value, srcForLoc));
    return this.hexprToAst(this.temp(t, srcForLoc), srcForLoc);
  }

  /**
   * Convert a lowered atom back to an AST node, for substitution into a rebuilt parent the legacy
   * emitter will visit. A temp becomes a fresh `simple-identifier` whose type is REGISTERED on the
   * identity-keyed channel (the one mitigation for nodeTypes identity): legacy `needsValueCopy` /
   * dispatch / fold then keep answering correctly for the substituted value.
   */
  private hexprToAst(h: HExpr, srcForLoc: ast.ASTNode): ast.ASTNode {
    if (h.kind === "temp") {
      const id = {
        _type: "simple-identifier",
        id: h.name,
        _location: srcForLoc._location,
        _parent: srcForLoc._parent,
      } as ast.SimpleIdentifierNode;
      const t: InferredType | undefined = h.type ?? this.context.nodeTypes.get(srcForLoc);
      if (t) this.context.recordSynthesizedNodeType(id, t);
      return id;
    }
    if (h.kind === "opaque-expr") return h.src;
    return srcForLoc; // nil/ternary/seq don't reach here (pure -> no prelude -> opaque path)
  }

  // -- helpers --------------------------------------------------------------------------------------

  /** A block whose statements are `l`'s, then (if `l` produced a value) an assignment of it into `temp`. */
  private blockAssigning(l: Lowered, temp: string, src: ast.ASTNode): HBlock {
    const stmts = [...l.stmts];
    if (l.value) stmts.push(this.assignTemp(temp, l.value, src));
    return { stmts };
  }

  /** The lowering of a MISSING `else`/false arm for a value-carrying dest: it yields nil. */
  private missingElse(dest: Dest, node: ast.ASTNode): Lowered {
    if (dest.kind === "assign") return { stmts: [this.assignTemp(dest.temp, this.nil(node), node)], value: null };
    if (dest.kind === "return") return { stmts: [this.hReturn(this.nil(node), false, node)], value: null };
    return { stmts: [], value: null };
  }

  private missingElseBlock(dest: Dest, node: ast.ASTNode): HBlock | null {
    if (dest.kind === "assign") return { stmts: [this.assignTemp(dest.temp, this.nil(node), node)] };
    if (dest.kind === "return") return { stmts: [this.hReturn(this.nil(node), false, node)] };
    return null;
  }
}
