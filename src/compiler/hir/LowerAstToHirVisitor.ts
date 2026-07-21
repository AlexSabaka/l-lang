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
import { classifyCall } from "./classifyCall";
import { shouldCopyOnStore, shouldCopyParam } from "./valueCopy";
import { HirModule } from "./HirModule";
import { TempAllocator } from "./TempAllocator";
import {
  HBase,
  HBlock,
  HCalleeBinding,
  HCatch,
  HCtor,
  HExpr,
  HFieldDecl,
  HFormatSegment,
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
  private readonly temps: TempAllocator;

  // `tempPrefix` lets the on-demand instance (used by the emitter for an imported/inlined function body
  // not pre-lowered here) name its temps `__ll_hir_i_*`, distinct from the pre-lowering's `__ll_hir_*`.
  constructor(private readonly context: Context, tempPrefix: string = "__ll_hir") {
    this.temps = new TempAllocator(tempPrefix);
  }

  /** Lower one function/program body (a statement sequence, effect dest) -- the on-demand entry point. */
  lowerBody(body: ast.ASTNode[]): HBlock {
    return { stmts: this.lowerSeq(body ?? [], EFFECT).stmts };
  }

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
      // The per-param D11 copy-on-entry decision, resolved ONCE (A5) so both backends consume it.
      module.setParamCopies(fn, (fn.params ?? []).map((p) => shouldCopyParam(p.type, this.context)));
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

  /** A modeled literal atom (A2) -- value on the node, emitted directly, typed from the channel. */
  private literal(src: ast.ASTNode): HExpr {
    return { ...this.base(src), kind: "literal", value: (src as any).value };
  }

  /** A modeled reference atom (A2) -- source name on the node; JS materialization stays a per-backend hook. */
  private ref(src: ast.ASTNode): HExpr {
    return { ...this.base(src), kind: "ref", name: ast.symbolName(src as ast.IdentifierNode) };
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
    // The D11 copy decision for the returned value, resolved ONCE (A5) so both backends consume it, not
    // re-derive it. `isStore` marked a value return; the fine decision is `shouldCopyOnStore` on its node.
    const copies = isStore && value !== null ? shouldCopyOnStore(src, this.context) : false;
    return { ...this.base(src), kind: "return", value, copies };
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
      case "restart-case":
        return this.lowerRestartCase(node as ast.RestartCaseNode, dest);
      case "handle":
        return this.lowerHandle(node as ast.HandleNode, dest);
      case "signal":
        return this.lowerSignal(node as ast.SignalNode, dest);
      case "invoke-restart":
        return this.lowerInvokeRestart(node as ast.InvokeRestartNode, dest);
      case "while":
        return this.lowerWhile(node as ast.WhileNode, dest);
      case "for":
        return this.lowerFor(node as ast.ForNode, dest);
      case "for-each":
        return this.lowerForEach(node as ast.ForEachNode, dest);
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
      case "integer-number":
      case "float-number":
      case "string":
      case "boolean":
        // Modeled literal atoms (A2). The numeric tower, char, and formatted-string stay opaque.
        return this.placeValue(this.literal(node), [], dest);
      case "simple-identifier":
      case "composite-identifier":
        // Modeled reference atoms (A2). Value-position identifiers only -- a callee stays legacy.
        return this.placeValue(this.ref(node), [], dest);
      case "class":
      case "struct":
        return this.lowerClassLike(node, dest);
      default:
        return this.leaf(node, dest);
    }
  }

  /**
   * A class / struct declaration -> `HClass` (A4, class-def step 1). In statement position (which is the
   * only position a declaration ever occupies -- the program and every body lower in effect dest) this
   * is the dedicated `HClass` seam; the emitter re-visits `src` exactly as it did for the opaque leaf, so
   * this is byte-identical. Any other dest keeps the legacy leaf path unchanged (a class never reaches
   * value/assign/return, but the fallback stays honest rather than fabricating an `HClass` expression).
   */
  private lowerClassLike(node: ast.ASTNode, dest: Dest): Lowered {
    if (dest.kind === "effect") {
      // The shell, captured the way JSClassBuilder reads it: the class id is `node.name.name` raw (a
      // class name is not encoded), and the single parent is `extends[0].type.name` (a struct shares the
      // shape -- visitStruct delegates to visitClass). Both stable here (rename ran in transformation).
      const cls = node as ast.ClassNode;
      const name = cls.name.name;
      const superName = cls.extends && cls.extends.length > 0 ? cls.extends[0].type.name : null;
      // The `__ll_name` marker's value: the SOURCE name, which survives the inliner's rename of `name`.
      const sourceName = (cls as any).__ll_source_name ?? cls.name?.name ?? null;
      const isStruct = node._type === "struct";
      const fields = this.classFields(cls);
      const ctor = this.lowerCtor(cls);
      return { stmts: [{ ...this.base(node), kind: "class", name, superName, sourceName, isStruct, fields, ctor }], value: null };
    }
    return this.leaf(node, dest);
  }

  /**
   * The class-body FIELDS: member variables WITHOUT the `:ctor` modifier (a `:ctor` variable is a
   * constructor parameter, not a field). Mirrors JSClassBuilder.processBody exactly -- the body is
   * flattened (a grouped form carries its children in `.nodes`) and scanned in source order, so the
   * emitted PropertyDefinition order is unchanged.
   */
  private classFields(cls: ast.ClassNode): HFieldDecl[] {
    const bodyNodes = (cls.body ?? [])
      .map((x: any) => (x.nodes ? x.nodes : [x]))
      .flat(2);
    const fields: HFieldDecl[] = [];
    for (const b of bodyNodes) {
      if (!b || b._type !== "variable") continue;
      const v = b as ast.VariableNode;
      const mods = (v.modifiers ?? []).map((m) => m.modifier);
      if (mods.includes("ctor")) continue;
      fields.push({
        src: v,
        name: v.name,
        valueSrc: (v as any).value ?? null,
        isStatic: mods.includes("static"),
      });
    }
    return fields;
  }

  /** The flattened body nodes of a class/struct (a grouped form carries its children in `.nodes`). */
  private classBodyNodes(cls: ast.ClassNode): ast.ASTNode[] {
    return (cls.body ?? []).map((x: any) => (x.nodes ? x.nodes : [x])).flat(2);
  }

  /** The `:ctor` VARIABLE nodes of a class (the field stores + the local constructor parameters). Mirrors
   *  JSClassBuilder.processBody's `ctorVars`. */
  private ctorVarsOf(cls: ast.ClassNode): ast.VariableNode[] {
    return this.classBodyNodes(cls).filter(
      (b): b is ast.VariableNode =>
        !!b && b._type === "variable" && ((b as ast.VariableNode).modifiers ?? []).some((m) => m.modifier === "ctor")
    );
  }

  /** A class's `:ctor` parameters as {name, default, type}. Mirrors getCtorParamsFromClassNode /
   *  localCtorParams (they are the same computation) -- used for both this class and a resolved parent. */
  private ctorParamsOf(cls: ast.ClassNode): Array<{ name: string; defaultValue: ast.ASTNode | undefined; type: ast.TypeNode | undefined }> {
    return this.ctorVarsOf(cls).map((v) => ({
      name: (v.name as any).id ?? (v.name as any).name,
      defaultValue: (v as any).value ?? undefined,
      type: v.type,
    }));
  }

  /**
   * The resolved constructor (A4, step 5) -- a faithful mirror of JSClassBuilder.buildConstructor's
   * structural half, done here so the SHAPE lives on the HIR and the emitter merely assembles it. The
   * inheritance pass-through (parent required params first, in the parent's order, deduped against the
   * local names) and the default-before-required diagnostic payload are computed exactly as there.
   */
  private lowerCtor(cls: ast.ClassNode): HCtor | null {
    // 1. Parent class + its ctor params (via the symbol table), for pass-through.
    let parentClassName: string | null = null;
    let parentArgs: Array<{ name: string; defaultValue: ast.ASTNode | undefined; type: ast.TypeNode | undefined }> = [];
    if (cls.extends && cls.extends.length > 0) {
      const parentTypeNode = cls.extends[0];
      parentClassName = parentTypeNode.type.name;
      const parentSymbol = this.context.symbolTable.resolveSymbol(parentTypeNode.type);
      if (parentSymbol && parentSymbol.value && (parentSymbol.value as ast.ASTNode)._type === "class") {
        parentArgs = this.ctorParamsOf(parentSymbol.value as ast.ClassNode);
      }
    }

    // 2/3. Local params + final param list & super args (parent pass-through, then local).
    const localCtorParams = this.ctorParamsOf(cls);
    const localCtorArgNames = localCtorParams.map((p) => p.name);
    const finalConstructorParams: typeof localCtorParams = [];
    const superCallArgs: string[] = [];
    for (const pArg of parentArgs) {
      if (localCtorArgNames.includes(pArg.name)) {
        superCallArgs.push(pArg.name);
      } else {
        finalConstructorParams.push(pArg);
        superCallArgs.push(pArg.name);
      }
    }
    for (const localParam of localCtorParams) finalConstructorParams.push(localParam);

    const ctorVars = this.ctorVarsOf(cls);

    // 4. No constructor needed.
    if (finalConstructorParams.length === 0 && !parentClassName && ctorVars.length === 0) return null;

    // 5. Default-before-required: a defaulted param ahead of a required one (legal JS, a trap). Carry the
    //    diagnostic payload; the emitter reports it (the order is the source's and is not reshuffled).
    let defaultBeforeRequired: HCtor["defaultBeforeRequired"] = null;
    const firstDefaulted = finalConstructorParams.findIndex((p) => p.defaultValue != null);
    if (firstDefaulted !== -1) {
      const required = finalConstructorParams.slice(firstDefaulted + 1).filter((p) => p.defaultValue == null);
      if (required.length > 0) {
        defaultBeforeRequired = {
          param: finalConstructorParams[firstDefaulted].name,
          plural: required.length > 1,
          required: required.map((p) => `'${p.name}'`).join(", "),
        };
      }
    }

    const ctorMethods = this.classBodyNodes(cls)
      .filter((b): b is ast.FunctionNode => !!b && b._type === "function" && ((b as ast.FunctionNode).modifiers ?? []).some((m) => m.modifier === "ctor"))
      .map((m) => m.name);

    return {
      params: finalConstructorParams.map((p) => ({ name: p.name, defaultSrc: p.defaultValue ?? null, type: p.type })),
      hasSuper: !!parentClassName,
      superArgs: superCallArgs,
      fieldInits: ctorVars.map((v) => ({ src: v, field: v.name, paramName: (v.name as any).id ?? (v.name as any).name })),
      ctorMethods,
      defaultBeforeRequired,
    };
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
      case "call": {
        // `||`/`&&` short-circuit, so a prelude-bearing right operand can't be hoisted eagerly.
        if (this.isLogicalHead(node)) return this.lowerLogical(node, dest);
        const dispatch = classifyCall(node, this.context);
        if (dispatch.kind === "free") return this.lowerFreeCall(node, dispatch.callee, dispatch.args, dest);
        if (dispatch.kind === "ext") return this.lowerExtCall(node, dispatch.head, dispatch.fnName, dispatch.args, dest);
        if (dispatch.kind === "method") return this.lowerMethodCall(node, dispatch.head, dispatch.args, dest);
        if (dispatch.kind === "virtual") return this.lowerVirtualCall(node, dispatch.head, dispatch.args, dest);
        if (dispatch.kind === "operator") return this.lowerOperator(node, dispatch.op, dispatch.head, dispatch.args, dest);
        if (dispatch.kind === "construct") return this.lowerConstruct(node, dispatch.callee, dispatch.args, dest);
        if (dispatch.kind === "member-read") return this.lowerMemberRead(node, dispatch.head, dest);
        return this.lowerCallLike(node, dest);
      }
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
    const ops = this.lowerOperands(children);
    if (ops.diverged) return { stmts: ops.prelude, value: null }; // a child diverged (return in operand)
    if (ops.prelude.length === 0) return this.leaf(node, dest); // all children plain leaves -> unchanged
    const rebuilt = rebuild(ops.children);
    const t = this.context.nodeTypes.get(node);
    if (t) this.context.recordSynthesizedNodeType(rebuilt, t);
    const inner = this.leaf(rebuilt, dest);
    return { stmts: [...ops.prelude, ...inner.stmts], value: inner.value };
  }

  /**
   * Lower a list of value-position operands, hoisting the ones that need statements into a shared
   * prelude and rebinding earlier impure siblings so left-to-right evaluation order survives. Returns
   * the prelude and the AST operands (temps substituted for the hoisted ones) for the legacy emitter.
   *
   * The UNNEST rule: an operand that emits a PRELUDE STATEMENT is an evaluation-ordering point, so every
   * earlier non-immovable operand is bound to a temp ahead of it. An operand emits a prelude statement
   * when it lowered to statements, diverged, OR is a COMPOUND HExpr (a ternary / inverted collection) --
   * the compound is force-bound to a temp below, and omitting it from `last` let an earlier impure
   * operand run after a later compound's prelude.
   */
  /**
   * Lower operands to ATOMS (HExprs), hoisting the ones that need statements into a shared prelude and
   * binding compounds / earlier impure siblings to temps so left-to-right order survives. The core of
   * both the legacy operand path (`lowerOperands`, which converts these to AST) and the modeled call
   * (`lowerFreeCall`, which keeps them as HExprs) -- so both bind operands identically.
   */
  private lowerCallArgs(children: ast.ASTNode[]): { prelude: HStmt[]; atoms: HExpr[]; diverged: boolean } {
    const lowered = children.map((c) => this.lowerNode(c, VALUE));
    let last = -1;
    for (let i = 0; i < lowered.length; i++) {
      const l = lowered[i];
      if (l.value === null || l.stmts.length > 0 || !this.isSubstitutable(l.value)) last = i;
    }
    const prelude: HStmt[] = [];
    const atoms: HExpr[] = [];
    for (let i = 0; i < lowered.length; i++) {
      const l = lowered[i];
      prelude.push(...l.stmts);
      if (l.value === null) return { prelude, atoms, diverged: true };
      const mustBind = !this.isSubstitutable(l.value) || (i < last && !this.isImmovable(l.value));
      if (mustBind) {
        const t = this.temps.fresh() as string;
        prelude.push(this.declTempInit(t, l.value, children[i]));
        atoms.push(this.temp(t, children[i]));
      } else {
        atoms.push(l.value);
      }
    }
    return { prelude, atoms, diverged: false };
  }

  /** As `lowerCallArgs`, but hands the atoms back as AST for the LEGACY emitter (temps substituted in). */
  private lowerOperands(children: ast.ASTNode[]): { prelude: HStmt[]; children: ast.ASTNode[]; diverged: boolean } {
    const r = this.lowerCallArgs(children);
    return {
      prelude: r.prelude,
      children: r.atoms.map((a, i) => this.hexprToAst(a, children[i])),
      diverged: r.diverged,
    };
  }

  /**
   * The `src` for a modeled call node (ext/method/operator) whose operands HOISTED. The JS emitter reads
   * the modeled `head` + `args` and never looks at `src`'s operands, but a backend that RE-DRIVES `src`
   * from raw AST -- the C backend's `resolveAstExpr` -- would otherwise see the un-lowered originals (a
   * hoisted `(match ...)` operand still raw, which it can't resolve in value position). So rebuild `src`
   * with the lowered operands substituted (temps for the hoisted ones), exactly as `lowerCallLike` does
   * for the opaque path -- keeping any `src`-re-driver byte-identical to that path. Only when something
   * hoisted (`prelude.length > 0`); otherwise the original node's operands are already re-drivable.
   */
  private callSrcWithLoweredOperands(node: ast.ListNode, headNode: ast.ASTNode, atoms: HExpr[], origArgs: ast.ASTNode[]): ast.ListNode {
    const children = atoms.map((a, i) => this.hexprToAst(a, origArgs[i]));
    const rebuilt = { ...node, nodes: [headNode, ...children] } as ast.ListNode;
    const t = this.context.nodeTypes.get(node);
    if (t) this.context.recordSynthesizedNodeType(rebuilt, t);
    return rebuilt;
  }

  /**
   * A resolved free call (`classifyCall` said `free`). Lower the args as HExprs (same binding as the
   * opaque path), model the callee as a reference, and let the emitter build the `CallExpression` --
   * the call is no longer an opaque leaf re-dispatched by `visitList`. (A3.)
   */
  private lowerFreeCall(node: ast.ListNode, callee: ast.ASTNode, args: ast.ASTNode[], dest: Dest): Lowered {
    const { prelude, atoms, diverged } = this.lowerCallArgs(args);
    if (diverged) return { stmts: prelude, value: null };
    const call: HExpr = { ...this.base(node), kind: "free-call", callee: this.ref(callee), args: atoms, calleeBinding: this.calleeBinding(callee, node) };
    return this.placeValue(call, prelude, dest);
  }

  /**
   * Resolve the callee IDENTITY off the symbol table ONCE (A3, D48/Q3), so the native backend consumes
   * it instead of re-resolving (the `callee-identity` dip). Mirrors the C backend's `resolveFreeCall`
   * reads: resolved-ness, extern-ness, function-type, and the FunctionNode value (for on-demand import
   * lowering). Resolved with the CALL node as the scope anchor -- the same `at` the C dip used.
   */
  private calleeBinding(callee: ast.ASTNode, at: ast.ASTNode): HCalleeBinding | null {
    if (callee._type !== "simple-identifier" && callee._type !== "composite-identifier") return null;
    const name = ast.symbolName(callee as ast.IdentifierNode);
    let entry: any;
    try {
      entry = this.context.symbolTable?.resolveSymbol?.(name as any, at);
    } catch {
      entry = undefined;
    }
    return {
      resolved: entry !== undefined,
      extern: (entry?.value as any)?.extern === true,
      isFunctionType: (entry?.inferredType as any)?.kind === "function",
      fnNode: (entry?.value as any)?._type === "function" ? (entry.value as ast.FunctionNode) : null,
    };
  }

  /**
   * A resolved `:extension` call (`classifyCall` said `ext`). Lower the args as HExprs (same binding as
   * the opaque path); the receiver + the emitted extension name stay a JS materialization hook off
   * `head`/`fnName` (`emitExtCall`) -- so `obj.method(a)` becomes `extFn(obj, a)` without the emitter
   * re-dispatching. (A3 / TY8.)
   */
  private lowerExtCall(node: ast.ListNode, head: ast.ASTNode, fnName: string, args: ast.ASTNode[], dest: Dest): Lowered {
    const { prelude, atoms, diverged } = this.lowerCallArgs(args);
    if (diverged) return { stmts: prelude, value: null };
    const src = prelude.length > 0 ? this.callSrcWithLoweredOperands(node, head, atoms, args) : node;
    const call: HExpr = { ...this.base(src), kind: "ext-call", head, fnName, args: atoms };
    return this.placeValue(call, prelude, dest);
  }

  /**
   * A resolved method call (`classifyCall` said `method`). Lower the args as HExprs (same binding as the
   * opaque path); the member callee stays the `leafExpr(head)` hook -- so `obj.method(a)` is emitted as
   * the direct `obj.method(a)` without the emitter re-dispatching. (A3 / TY8.)
   */
  private lowerMethodCall(node: ast.ListNode, head: ast.ASTNode, args: ast.ASTNode[], dest: Dest): Lowered {
    const { prelude, atoms, diverged } = this.lowerCallArgs(args);
    if (diverged) return { stmts: prelude, value: null };
    const src = prelude.length > 0 ? this.callSrcWithLoweredOperands(node, head, atoms, args) : node;
    const call: HExpr = { ...this.base(src), kind: "method-call", head, args: atoms };
    return this.placeValue(call, prelude, dest);
  }

  /**
   * A resolved virtual call (`classifyCall` said `virtual`). Identical lowering to a method call -- the
   * member callee stays the `leafExpr(head)` hook, so `obj.method(a)` emits the direct `obj.method(a)`
   * the runtime dispatches. Distinct only in kind: the receiver is UNTYPED, so a native backend
   * vtable-dispatches rather than devirtualizing. (A3 / TY8.)
   */
  private lowerVirtualCall(node: ast.ListNode, head: ast.ASTNode, args: ast.ASTNode[], dest: Dest): Lowered {
    const { prelude, atoms, diverged } = this.lowerCallArgs(args);
    if (diverged) return { stmts: prelude, value: null };
    const src = prelude.length > 0 ? this.callSrcWithLoweredOperands(node, head, atoms, args) : node;
    const call: HExpr = { ...this.base(src), kind: "virtual-call", head, args: atoms };
    return this.placeValue(call, prelude, dest);
  }

  /**
   * A resolved operator call (`classifyCall` said `operator`). Lower the operands as HExprs (same binding
   * as the opaque path); the callee stays the `leafExpr(head)` hook -- so `(op a b)` emits the JS shim
   * call `_op(a, b)` -- and `op` is carried for the native backend. (A3 / TY8.)
   */
  private lowerOperator(node: ast.ListNode, op: string, head: ast.ASTNode, args: ast.ASTNode[], dest: Dest): Lowered {
    const { prelude, atoms, diverged } = this.lowerCallArgs(args);
    if (diverged) return { stmts: prelude, value: null };
    const src = prelude.length > 0 ? this.callSrcWithLoweredOperands(node, head, atoms, args) : node;
    const call: HExpr = { ...this.base(src), kind: "operator", op, head, args: atoms };
    return this.placeValue(call, prelude, dest);
  }

  /**
   * A resolved construction (`classifyCall` said `construct`). Lower the args as HExprs (same binding as
   * a free call -- construction args are never copied at the call site), model the class name as a
   * reference, and let the emitter build the `NewExpression`. (A3 / A4.)
   */
  private lowerConstruct(node: ast.ListNode, callee: ast.ASTNode, args: ast.ASTNode[], dest: Dest): Lowered {
    const { prelude, atoms, diverged } = this.lowerCallArgs(args);
    if (diverged) return { stmts: prelude, value: null };
    const src = prelude.length > 0 ? this.callSrcWithLoweredOperands(node, callee, atoms, args) : node;
    const call: HExpr = { ...this.base(src), kind: "construct", callee: this.ref(callee), args: atoms };
    return this.placeValue(call, prelude, dest);
  }

  /**
   * A field READ `(obj.field)` (`classifyCall` said `member-read`). A 0-arg access has no operands to
   * hoist, so the node just carries `head`; the JS emitter re-visits `src` (its field-vs-`__ll_member`
   * branch), a native backend resolves the slot. No longer an opaque leaf re-dispatched as a call.
   */
  private lowerMemberRead(node: ast.ListNode, head: ast.ASTNode, dest: Dest): Lowered {
    const mr: HExpr = { ...this.base(node), kind: "member-read", head };
    return this.placeValue(mr, [], dest);
  }

  private lowerCallLike(node: ast.ListNode, dest: Dest): Lowered {
    const ops = this.lowerOperands(node.nodes.slice(1));
    if (ops.diverged) return { stmts: ops.prelude, value: null };
    // Nothing hoisted -> the callee stays inline exactly as written; no reorder is possible.
    if (ops.prelude.length === 0) return this.leaf(node, dest);
    // An argument hoisted ahead of the call. The callee (nodes[0]) is rebuilt verbatim and emitted
    // INLINE, so a side-effecting sub-expression inside it would run after the argument prelude. Bind
    // that sub-expression to a temp ahead of the prelude, preserving the callee's syntactic shape so
    // constructor/method/index dispatch detection is unaffected. (blocker 8)
    const callee = this.hoistCalleeImpurities(node.nodes[0]);
    const rebuilt = { ...node, nodes: [callee.node, ...ops.children] } as ast.ListNode;
    const t = this.context.nodeTypes.get(node);
    if (t) this.context.recordSynthesizedNodeType(rebuilt, t);
    const inner = this.leaf(rebuilt, dest);
    return { stmts: [...callee.prelude, ...ops.prelude, ...inner.stmts], value: inner.value };
  }

  /**
   * Bind a callee's effectful sub-expressions to temps, returning them as a prelude plus a callee node
   * of the SAME shape (temps substituted). Only a dotted-indexer callee can hold an effect: its base
   * `id` is an identifier and dotted-member steps are bare names, so the effect can live only in an
   * `[expr]` index. Every other callee -- a plain name, a member of names, a `new`/special keyword, an
   * applied lambda literal -- is pure and returned untouched.
   */
  private hoistCalleeImpurities(callee: ast.ASTNode): { prelude: HStmt[]; node: ast.ASTNode } {
    if (callee._type !== "indexer") return { prelude: [], node: callee };
    const idx = callee as ast.IndexerNode;
    const prelude: HStmt[] = [];
    const indices = idx.indices.map((group, g) => {
      if (idx.members?.[g]) return group; // a `.name` step is a bare name -- nothing to evaluate
      return group.map((ix) => {
        const l = this.lowerNode(ix, VALUE);
        if (l.value === null) return ix; // a diverging index is malformed; leave it to the legacy emitter
        prelude.push(...l.stmts);
        if (this.isImmovable(l.value)) return this.hexprToAst(l.value, ix);
        const t = this.temps.fresh() as string;
        prelude.push(this.declTempInit(t, l.value, ix));
        return this.hexprToAst(this.temp(t, ix), ix);
      });
    });
    if (prelude.length === 0) return { prelude: [], node: callee };
    const rebuilt = { ...idx, indices } as ast.IndexerNode;
    const t = this.context.nodeTypes.get(callee);
    if (t) this.context.recordSynthesizedNodeType(rebuilt, t);
    return { prelude, node: rebuilt };
  }

  private isSubstitutable(h: HExpr): boolean {
    // "free-call"/"ext-call"/"method-call" are substitutable like the opaque call they replace
    // (inline-able, and rebuilt with their lowered args when handed to a legacy-parent -- see
    // hexprToAst), so a nested resolved call stays inline.
    return (
      h.kind === "temp" ||
      h.kind === "opaque-expr" ||
      h.kind === "literal" ||
      h.kind === "ref" ||
      h.kind === "free-call" ||
      h.kind === "ext-call" ||
      h.kind === "method-call" ||
      h.kind === "virtual-call" ||
      h.kind === "operator" ||
      h.kind === "construct"
    );
  }

  private lowerFormattedString(node: ast.FormattedStringNode, dest: Dest): Lowered {
    // Model the whole string (A2): a `string` segment is a literal chunk; every other segment is an
    // interpolation, whose expression is lowered like a call's operand (same unnest / temp binding, so
    // evaluation order is unchanged) and rides the node as an HExpr. `visitFormatExpression` emits
    // `visitExpr(v.expression)`, so lowering `v.expression` is byte-identical to the legacy interpolation.
    const values = node.value ?? [];
    const exprNodes: ast.ASTNode[] = [];
    for (const v of values) {
      if (v._type !== "string") {
        exprNodes.push(v._type === "format-expression" ? (v as ast.FormatExpressionNode).expression : v);
      }
    }
    const { prelude, atoms, diverged } = this.lowerCallArgs(exprNodes);
    if (diverged) return { stmts: prelude, value: null };
    let e = 0;
    const segments: HFormatSegment[] = values.map((v) =>
      v._type === "string" ? { str: (v as ast.StringNode).value } : { expr: atoms[e++] }
    );
    const hfstr: HExpr = { ...this.base(node), kind: "formatted-string", segments };
    return this.placeValue(hfstr, prelude, dest);
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
    if (h.kind === "temp" || h.kind === "nil" || h.kind === "literal") return true;
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

  // -- loops ----------------------------------------------------------------------------------------

  /** A loop is a statement; place it (loops-as-values are rare, so the value is D9 nil). */
  private loopResult(hloop: HStmt, node: ast.ASTNode, dest: Dest, prelude: HStmt[] = []): Lowered {
    if (dest.kind === "effect") return { stmts: [...prelude, hloop], value: null };
    return this.placeValue(this.nil(node), [...prelude, hloop], dest);
  }

  private lowerWhile(node: ast.WhileNode, dest: Dest): Lowered {
    const cond = this.lowerNode(node.condition, VALUE);
    // The test re-evaluates each iteration, so it cannot carry a hoisted prelude -- a statement-bearing
    // condition (rare) falls back to the legacy emitter.
    if (cond.stmts.length > 0 || cond.value === null) return this.leaf(node, dest);
    const hw: HStmt = {
      ...this.base(node),
      kind: "while",
      test: cond.value,
      body: { stmts: this.lowerNode(node.then, EFFECT).stmts },
    };
    return this.loopResult(hw, node, dest);
  }

  private lowerFor(node: ast.ForNode, dest: Dest): Lowered {
    const test = node.condition ? this.lowerNode(node.condition, VALUE) : null;
    const update = node.step ? this.lowerNode(node.step, VALUE) : null;
    if ((test && (test.stmts.length > 0 || test.value === null)) || (update && (update.stmts.length > 0 || update.value === null))) {
      return this.leaf(node, dest); // re-evaluated test/step can't hoist -> legacy (rare)
    }
    const hf: HStmt = {
      ...this.base(node),
      kind: "for",
      init: { stmts: node.initial ? this.lowerNode(node.initial, EFFECT).stmts : [] },
      test: test ? test.value : null,
      update: update ? update.value : null,
      body: { stmts: this.lowerNode(node.then, EFFECT).stmts },
      elseBlock: node.else ? { stmts: this.lowerNode(node.else, EFFECT).stmts } : null,
    };
    return this.loopResult(hf, node, dest);
  }

  private lowerForEach(node: ast.ForEachNode, dest: Dest): Lowered {
    // The collection is evaluated ONCE, so it MAY carry a prelude (hoisted before the loop).
    const coll = this.lowerNode(node.collection, VALUE);
    if (coll.value === null) return { stmts: coll.stmts, value: null }; // collection diverged
    const hfe: HStmt = {
      ...this.base(node),
      kind: "for-each",
      collection: coll.value,
      body: { stmts: this.lowerNode(node.then, EFFECT).stmts },
      elseBlock: node.else ? { stmts: this.lowerNode(node.else, EFFECT).stmts } : null,
    };
    return this.loopResult(hfe, node, dest, coll.stmts);
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

  // -- D47 conditions / restarts --------------------------------------------------------------------
  //
  // These lower to their dedicated HIR nodes (NOT the opaque `throw`-style leaf, which would route JS to
  // the generic LL0100 instead of the honest LL0108). The C backend lowers all four (Cr-1); the JS backend
  // refuses with LL0108. The destination-driven result temp mirrors lowerTry: a value-position form binds
  // a temp and each body/arm assigns into it. A full type-inference layer for `resultTemp`'s join is
  // future work (the temps stay boxed today).

  private lowerRestartCase(node: ast.RestartCaseNode, dest: Dest): Lowered {
    if (dest.kind === "value") {
      const result = this.temps.fresh();
      const h = this.buildRestartCase(node, { kind: "assign", temp: result });
      return { stmts: [this.declTemp(result, node), h], value: this.temp(result, node) };
    }
    return { stmts: [this.buildRestartCase(node, dest)], value: null };
  }

  private buildRestartCase(node: ast.RestartCaseNode, bodyDest: Dest): HStmt {
    const body: HBlock = { stmts: node.body ? this.lowerNode(node.body, bodyDest).stmts : [] };
    const arms = (node.arms ?? []).map((a) => ({
      name: a.name,
      // Params are simple-identifier binders; carry their source names (the C arm unpacks the packed args).
      params: (a.params ?? []).map((p) => (p as any).id ?? ast.symbolName(p as any)),
      body: { stmts: this.lowerSeq(a.body ?? [], bodyDest).stmts },
    }));
    return { ...this.base(node), kind: "restart-case", body, arms };
  }

  private lowerHandle(node: ast.HandleNode, dest: Dest): Lowered {
    if (dest.kind === "value") {
      const result = this.temps.fresh();
      const h = this.buildHandle(node, { kind: "assign", temp: result });
      return { stmts: [this.declTemp(result, node), h], value: this.temp(result, node) };
    }
    return { stmts: [this.buildHandle(node, dest)], value: null };
  }

  private buildHandle(node: ast.HandleNode, bodyDest: Dest): HStmt {
    const body: HBlock = { stmts: node.body ? this.lowerNode(node.body, bodyDest).stmts : [] };
    // Clauses stay in SOURCE order (first-written matching `:on` wins). The clause body lowers in EFFECT
    // position for the scaffold (a clause typically declines / invokes a restart / exits non-locally).
    const clauses = (node.clauses ?? []).map((c) => ({
      condType: c.condType,
      binder: c.binder ? ((c.binder as any).id ?? ast.symbolName(c.binder as any)) : undefined,
      body: { stmts: this.lowerSeq(c.body ?? [], EFFECT).stmts },
    }));
    return { ...this.base(node), kind: "handle", body, clauses };
  }

  private lowerSignal(node: ast.SignalNode, dest: Dest): Lowered {
    const cond = this.lowerNode(node.condition, VALUE);
    if (cond.value === null) return { stmts: cond.stmts, value: null }; // condition diverged
    const sig: HExpr = { ...this.base(node), kind: "signal", condition: cond.value };
    return this.placeValue(sig, cond.stmts, dest);
  }

  private lowerInvokeRestart(node: ast.InvokeRestartNode, dest: Dest): Lowered {
    // invoke-restart DIVERGES. It MUST be materialized into the statement stream in EVERY dest (mustFix
    // #5.1): a bare {stmts, value:null} that dropped the node would erase the transfer -- and the LL0108
    // refusal -- when it sits in argument/value position. So we always emit it as an expr-stmt and report
    // divergence (value:null); any dead code after the transfer is correctly dropped by callers.
    const { prelude, atoms, diverged } = this.lowerCallArgs(node.args ?? []);
    if (diverged) return { stmts: prelude, value: null };
    const inv: HExpr = { ...this.base(node), kind: "invoke-restart", name: node.name, args: atoms };
    return { stmts: [...prelude, this.exprStmt(inv, node)], value: null };
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
    // A bodyless declaration -- an `:extern` `let` (an ambient global, Sd) -- has no initializer;
    // legacy emitVarDecl turns it into an EmptyStatement.
    if (!node.value) return this.leaf(node, dest);
    const init = this.lowerNode(node.value, VALUE);
    if (init.value === null) return { stmts: init.stmts, value: null }; // RHS diverged -> the binding is dead
    // The init is emitted INLINE by the HIR (a ternary / temp / array), so no value-position init ever
    // reaches legacy asExpression. The JS declaration structure (const-vs-let, destructuring, D11) stays a
    // legacy emit hook (emitVarDecl); the binding name/mutability/declared-type ride the node for the
    // native backend (A2/A1).
    const nm = node.name;
    const name = nm._type === "simple-identifier" || nm._type === "composite-identifier"
      ? ast.symbolName(nm as ast.IdentifierNode)
      : null;
    const declaredType = this.declaredTypeOf(node, name);
    // The D11 copy decision, resolved ONCE here (A5) so both backends consume it, not re-derive it.
    const copies = shouldCopyOnStore(node.value, this.context);
    const hvar: HStmt = { ...this.base(node), kind: "var-decl", init: init.value, name, mutable: !!node.mutable, declaredType, copies };
    return { stmts: [...init.stmts, hvar], value: dest.kind === "value" ? this.nil(node) : null };
  }

  /**
   * The DECLARED type of a binding (A1), resolved once here so the native backend reads it off the node.
   * Mirrors the C backend's prior resolution EXACTLY: a `mut` takes the symbol table's declared type over
   * the channel (the channel holds the initializer's narrowing, which a mut can be re-assigned past); a
   * `let` takes the channel, else the symbol table. Null-name (destructuring) has no single declared type.
   */
  private declaredTypeOf(node: ast.VariableNode, name: string | null): InferredType | undefined {
    const fromSymbols = (): InferredType | undefined => {
      if (name === null) return undefined;
      try { return this.context.symbolTable.resolveSymbol(name, node)?.inferredType; } catch { return undefined; }
    };
    const channel = this.context.nodeTypes.get(node);
    return node.mutable ? (fromSymbols() ?? channel) : (channel ?? fromSymbols());
  }

  private lowerAssignment(node: ast.SimpleAssignmentNode | ast.CompoundAssignmentNode, dest: Dest): Lowered {
    const rhs = this.lowerNode(node.value, VALUE);
    if (rhs.value === null) return { stmts: rhs.stmts, value: null }; // RHS diverged -> the assignment is dead
    const isSimpleForm =
      node._type === "simple-assignment" || (node as ast.CompoundAssignmentNode).operator === ":=";
    if (isSimpleForm) {
      // `x := rhs`: emit the RHS INLINE via the HIR (no value-position init reaches legacy asExpression).
      const ha: HStmt = { ...this.base(node), kind: "user-assign", rhs: rhs.value };
      return { stmts: [...rhs.stmts, ha], value: dest.kind === "value" ? this.nil(node) : null };
    }
    // Compound `x += rhs`: the RHS sits inside `op(read, rhs)` (legacy). Route a COMPOUND rhs through a
    // temp so it doesn't reach asExpression; a plain-leaf rhs stays inline (unchanged).
    if (rhs.stmts.length === 0 && this.isSubstitutable(rhs.value)) return this.leaf(node, dest);
    const prelude: HStmt[] = [...rhs.stmts];
    const valueAst = this.atomizeForSubstitution(rhs.value, prelude, node.value);
    const tail: HStmt = { ...this.base({ ...node, value: valueAst } as any), kind: "opaque-stmt" };
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
    if (h.kind === "free-call" || h.kind === "ext-call" || h.kind === "method-call" || h.kind === "virtual-call" || h.kind === "operator" || h.kind === "construct") {
      // Rebuild the call AST with the LOWERED args (temps substituted) so a resolved call handed to a
      // legacy-parent operand re-emits with its hoisted operands, not its originals. The head is the
      // free|construct callee's src / the ext|method|virtual|operator head -- the legacy emitter
      // re-classifies it (and re-takes the matching branch), byte-identical to the direct HIR emission.
      const head = h.kind === "free-call" || h.kind === "construct" ? h.callee.src : h.head;
      const rebuilt = {
        ...(h.src as ast.ListNode),
        nodes: [head, ...h.args.map((a) => this.hexprToAst(a, a.src))],
      } as ast.ListNode;
      if (h.type) this.context.recordSynthesizedNodeType(rebuilt, h.type);
      return rebuilt;
    }
    if (h.kind === "opaque-expr" || h.kind === "literal" || h.kind === "ref") return h.src;
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
