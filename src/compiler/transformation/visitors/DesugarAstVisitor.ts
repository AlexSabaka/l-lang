import * as ast from "../../frontend/ast";
import { classifyList, listNodes, valueIsTail } from "../../analysis/listForm";
import { Context, LogLevel } from "../../Context";
import { BaseAstTreeWalker } from "../../BaseAstTreeWalker";
import { formatWithOptions } from "util";
import { RefineInfo, buildRefineCall, toRefineInfo } from "../../hir/coerceInto";

/**
 * DesugarAstVisitor — one tree, for the type checker and codegen alike.
 *
 * Rewrites sugar into the core forms both back-ends already understand:
 *   1. Pipelines:       (a |> (f x))  ->  (f a x)
 *   2. Implicit return: a function's tail expression becomes an explicit `(return …)`
 *
 * ## Why this is not a `BaseAstTreeWalker`, despite extending one
 *
 * `BaseAstTreeWalker.visit` dispatches and then **re-walks the ORIGINAL node's children and
 * overwrites the result** — so any rewrite a `visitX` performs is clobbered. A REWRITING visitor
 * cannot use that walk. It must own its recursion, which is what `visit` below does.
 *
 * ## The bug that made this whole class inert
 *
 * The dispatch used to be `if ((this as any)[methodName])`, which is **always true**: `BaseAstVisitor`
 * declares a `visitX` for every node type in the language, each an `onUnhandled` no-op. So every type
 * without an explicit rule here dispatched to that no-op, came back unchanged, and **was never
 * recursed into**. In practice this visitor reached exactly three node types — `program`, `list`,
 * `function` — and nothing else. A pipeline inside a `let`, which is how the entire corpus writes
 * them, was never even seen.
 *
 * It is asked properly now: `overridesVisitor` tells a real rule from the inherited no-op.
 *
 * ## `_parent` is load-bearing. Do not "fix" it.
 *
 * The symbol table indexes the PRE-desugar tree, and `SymbolTable.scopeOf` finds a node's scope by
 * climbing `_parent`. That works across a rewrite only because every rebuilt node keeps the
 * **original** parent OBJECT, so one step up lands back in the indexed tree. Re-parenting the
 * desugared tree — the obvious "tidy-up" — repoints every node at objects the scope index has never
 * seen: `scopeOf` misses, resolution silently falls back to the flat root search, and P6 is undone.
 * Measured: 0 lexical misses when the original parent is kept, 1056 when the chain is rebuilt.
 */
/**
 * Is this function declared `-> Void`? (D49a -- the annotation suppresses the implicit return.)
 * Unwraps the `type` wrapper the way every other consumer of a TypeNode does.
 */
function isVoidReturn(node: ast.FunctionNode): boolean {
  const nameOf = (t: any): string | undefined => {
    if (!t || typeof t !== "object") return undefined;
    if (t._type === "type") return nameOf(t.type);
    const nm = typeof t.name === "string" ? t.name : t.name?.name;
    return typeof nm === "string" ? nm : undefined;
  };
  return nameOf(node.returns) === "Void";
}

export class DesugarAstVisitor extends BaseAstTreeWalker {
  /** `and`/`or`/`not` -> the operators they alias (D39). See `transformLogicalAlias`. */
  private static readonly LOGICAL_ALIASES: ReadonlyMap<string, string> = new Map([
    ["and", "&&"],
    ["or", "||"],
    ["not", "!"],
  ]);

  /**
   * Operators whose n-ary form CHAINS instead of folding (D92): `(< a b c)` means `a<b && b<c`, not
   * `((a<b)<c)`. NOT rewritten here -- chaining duplicates every interior operand, so it needs
   * temporaries to stay safe against an impure one, and that is its own round. Listed so the fold
   * below can exclude them by name rather than by accident.
   */
  private static readonly CHAIN_OPS: ReadonlySet<string> = new Set([
    "<", ">", "<=", ">=", "==", "!=", "≠",
  ]);

  /**
   * Inject the implicit return (a function's tail expression becomes an explicit `(return e)`)?
   *
   * A FLAG, not a deletion, because `ComptimeEvaluationAstVisitor` depends on it: it desugars a
   * `:comptime` function before handing it to the sandbox, purely so the sandboxed function RETURNS
   * something. Switch it off there and `(let fact5 (factorial 5))` folds to `null` instead of `120`.
   *
   * It is OFF for the pipeline stage while the transform is being moved (Tc) and ON once the
   * implicit return moves too (Te) -- so that each move's diff is attributable to it alone.
   */
  constructor(context: Context, private readonly injectImplicitReturns = false) {
    super(context);
  }

  /**
   * Int-based refined newtypes seen this module: name -> its boundary check (D46 amend, P3c-1b-ii).
   * This pass now owns only the two BINDING GUARDS -- a function PARAMETER and a `:ctor` FIELD, where
   * the value arrives already bound and there is no expression slot to wrap. Every COERCION site
   * (let-init, return, assignment, cast) lives at the one HIR coercion point instead; `hir/coerceInto.ts`
   * says why the two are not the same thing. Empty for a program with no `:satisfies` newtype.
   */
  private refinedInt = new Map<string, RefineInfo>();

  visitProgram(node: ast.ProgramNode): ast.ProgramNode {
    this.collectRefinedInt(node);
    return {
      ...node,
      program: node.program.map((n) => this.visit(n) as ast.ASTNode),
    } as ast.ProgramNode;
  }


  /** Extract a type node's name (unwrapping the `type` wrapper), for matching a `<- T` annotation. */
  private typeNameOf(t: any): string | undefined {
    if (!t || typeof t !== "object") return undefined;
    if (t._type === "type") return this.typeNameOf(t.type);
    const nm = typeof t.name === "string" ? t.name : t.name?.name;
    return typeof nm === "string" ? nm : undefined;
  }

  /** Scan the whole tree for `deftype … :satisfies (lo? .. hi?)` over an `Int` base, and record its bounds. */
  private collectRefinedInt(root: ast.ASTNode): void {
    const walk = (n: any) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      const base = n._type === "type-def" && n.refinement ? this.typeNameOf(n.type) : undefined;
      if (base === "Int" || base === "Real") {
        const bound = (b: any): number | null =>
          b && typeof b.value === "number" ? b.value : null;
        const info = toRefineInfo(bound(n.refinement.lo), bound(n.refinement.hi), base);
        const name = n.name ? ast.symbolName(n.name) : undefined;
        if (name && info) this.refinedInt.set(name, info);
      }
      for (const k of ast.getNodeIterableKeys(n)) walk((n as any)[k]);
    };
    walk(root);
  }

  /** Copy a node, recursing into its children -- the generic rebuild the overriding visitors share. */
  private rebuild(node: ast.ASTNode): ast.ASTNode {
    const out = { ...node } as any;
    for (const k of ast.getNodeIterableKeys(node)) {
      const v = (node as any)[k];
      out[k] = Array.isArray(v)
        ? ast.mapChildArray(v, (x) => this.visit(x))
        : ast.isAstNode(v) ? this.visit(v) : v;
    }
    return out as ast.ASTNode;
  }

  /**
   * `(__refine_check_int subject lo hi clo chi)`. `parent` is the ORIGINAL (pre-desugar) node the
   * synthesized call hangs under, and it matters exactly when `subject` NAMES something: the symbol
   * table indexes the pre-desugar tree and `scopeOf` walks `_parent` until it hits an indexed node, so
   * a synthesized reference with `_parent: undefined` resolves to no scope at all. The value-wrap
   * cases pass `undefined` because they reference only a floor builtin, the existing subject node and
   * literals; the PARAMETER prologue passes the enclosing function node, whose scope holds the params.
   */
  private refineCall(
    subject: ast.ASTNode,
    info: RefineInfo,
    loc: any,
    parent: ast.ASTNode | undefined
  ): ast.ASTNode {
    return buildRefineCall(subject, info, parent);
  }

  /**
   * The PARAMETER boundary (P3c-1c-ii): one `(__refine_check_int p …)` per refined parameter, at the
   * top of the body.
   *
   * A PROLOGUE rather than a call-site wrap, because one check per function covers every caller --
   * including the ones a desugar-time signature lookup could never see (indirect calls, higher-order
   * use, cross-module imports). The call's result is DISCARDED: the floor fn returns the value or
   * panics, and discarding it sidesteps the question of whether a parameter is assignable.
   *
   * This is the one synthesized node in this file that NAMES something, so it is the one that has to
   * carry `_parent` -- see `refineCall`.
   */
  private refineParamPrologue(node: ast.FunctionNode): ast.ASTNode[] {
    const out: ast.ASTNode[] = [];
    for (const p of node.params ?? []) {
      const info = this.refinedInt.get(this.typeNameOf(p.type) ?? "");
      if (!info || p.spread || !p.name || !ast.isAstNode(p.name)) continue;
      if (p.name._type !== "simple-identifier" && p.name._type !== "composite-identifier") continue;
      const name = ast.symbolName(p.name as ast.IdentifierNode);
      const loc = (p as any)._location;
      // `_parent` is the PARAMETER, not the function node -- and the difference is the whole trick.
      // By the time this pass runs, the FunctionNode in hand is already a copy (ComptimeEvaluation
      // rebuilt the tree), so it is absent from the scope index and `scopeOf` climbs straight past it
      // to `program`, where no parameter lives. The parameter node is a copy too, but its `_parent`
      // still points at the ORIGINAL function node -- the one the index was built from. So hanging
      // the check off the parameter costs one extra hop and lands in the scope that binds it.
      const ref = { _type: "simple-identifier", id: name, _location: loc, _parent: p } as any;
      out.push(this.refineCall(ref, info, loc, p));
    }
    return out;
  }

  /**
   * The FIELD-INIT boundary (P3c-1c-iii), for a `:ctor` field: `(defclass Box (let :ctor v <- uint8))`
   * takes its value from a constructor argument, so there is no annotated initializer to wrap and
   * nothing here was checking it.
   *
   * A `:ctor` field's value arrives inside a constructor that does not EXIST at this stage -- HIR
   * synthesizes it, flattening the `:extends` chain to build the real parameter list. Rather than
   * replicate that flattening (and get inheritance order subtly wrong), this appends a synthesized
   * `:ctor` METHOD, which HIR already collects into `ctorMethods` and both backends already invoke
   * after the field stores. Inheritance then falls out for free: every class checks its OWN fields,
   * and a parent's are checked by the parent's own method, reached through `super`.
   *
   * A field with a written initializer -- `(mut v <- uint8 300)` -- needs none of this; it is an
   * ordinary `variable` node with a value, so `visitVariable` has always covered it.
   */
  private refineCtorFieldCheck(cls: ast.ClassNode | ast.StructNode): ast.ASTNode | undefined {
    // A class member may be WRAPPED IN A LIST -- `(let :ctor v <- uint8)` parses as a list whose
    // first node is the variable -- so flatten the way HIR's `classBodyNodes` does. Reading
    // `cls.body` directly finds a single `list` and no fields at all.
    const members = ((cls.body ?? []) as any[]).map((x: any) => (x?.nodes ? x.nodes : [x])).flat(2);
    const checks: ast.ASTNode[] = [];
    for (const m of members) {
      const v = m && m._type === "variable" ? m : undefined;
      if (!v || !(v.modifiers ?? []).some((mod: any) => mod.modifier === "ctor")) continue;
      const info = this.refinedInt.get(this.typeNameOf(v.type) ?? "");
      if (!info || !v.name || !ast.isAstNode(v.name)) continue;
      if (v.name._type !== "simple-identifier" && v.name._type !== "composite-identifier") continue;
      const field = ast.symbolName(v.name as ast.IdentifierNode);
      const loc = v._location;
      // `this.<field>` -- a member read, so only its HEAD (`this`) is a reference, and `_parent` on
      // the field's own declaration node puts that head in the class's scope.
      const target = {
        _type: "composite-identifier",
        id: `this.${field}`,
        headless: false,
        parts: ["this", field],
        _location: loc,
        _parent: v,
      } as any;
      checks.push(this.refineCall(target, info, loc, v));
    }
    if (checks.length === 0) return undefined;

    const loc = (cls as any)._location;
    const mk = (type: string, fields: any): any => ({ ...fields, _type: type, _location: loc, _parent: cls });
    return mk("function", {
      name: mk("simple-identifier", { id: "__refine_ctor_check" }),
      async: false,
      generator: false,
      extern: false,
      modifiers: [mk("modifier", { modifier: "ctor" })],
      params: [],
      // `-> Void` BINDS (D49a): it suppresses the implicit return, so the last check's value is not
      // handed back as a construction result.
      returns: mk("type", { type: mk("type-name", { name: "Void" }), array: false }),
      body: checks,
    });
  }

  visitClass(node: ast.ClassNode): ast.ClassNode {
    const recursed = this.rebuild(node) as any;
    const check = this.refineCtorFieldCheck(node);
    if (check) recursed.body = [...(recursed.body ?? []), check];
    return recursed as ast.ClassNode;
  }

  visitStruct(node: ast.StructNode): ast.StructNode {
    const recursed = this.rebuild(node) as any;
    const check = this.refineCtorFieldCheck(node);
    if (check) recursed.body = [...(recursed.body ?? []), check];
    return recursed as ast.StructNode;
  }

  visit(node: ast.ASTNode): any {
    if (!node) return node;

    const methodName = `visit${node._type
      .split("-")
      .map((s) => s[0].toUpperCase() + s.slice(1))
      .join("")}`;

    // A REAL rule, not the inherited no-op. See the class comment: `(this as any)[methodName]` is
    // always truthy, and dispatching on it is what stopped this visitor recursing at all.
    if (this.overridesVisitor(methodName)) {
      return (this as any)[methodName](node);
    }

    // Everything else: rebuild the node, recursing into its children. Shallow copy, so the input tree
    // is never mutated -- the symbol table holds references INTO it (`symbol.value`), and this pass
    // used to rewrite those nodes in place. A literal simply has no child keys, so it falls through
    // this loop untouched.
    const result = { ...node } as any;
    for (const key of ast.getNodeIterableKeys(node)) {
      const value = (node as any)[key];
      if (Array.isArray(value)) {
        // NESTED arrays too -- `MatrixNode.rows` is `ASTNode[][]`, and a one-level map handed every
        // row back untouched, so no desugar in this file ever reached a matrix cell (see mapChildArray).
        result[key] = ast.mapChildArray(value, (item) => this.visit(item));
      } else if (ast.isAstNode(value)) {
        result[key] = this.visit(value);
      }
    }
    return result;
  }

  visitList(node: ast.ListNode): ast.ASTNode {
    // NO trivial-list unwrap here.
    //
    // This used to collapse `(expr)` -> `expr` for any non-identifier head. Codegen already does that,
    // and correctly: its version also refuses to unwrap a dotted-member indexer, because D1 rules that
    // `(gs[0].hi)` is a CALL while `gs[0]` is a read. This copy predated D1 and would have destroyed
    // the call. Two implementations of one rule is how the compiler ends up with two answers -- and
    // this one was the wrong answer.
    const aliased = this.transformLogicalAlias(node);
    if (aliased) return aliased;

    // BEFORE every other rewrite below: those read `nodes[1]`/`nodes[2]` as THE operands, and an
    // n-ary form has more. Folding first means everything downstream only ever sees a binary one.
    const chained = this.transformComparisonChain(node);
    if (chained) return chained;

    const folded = this.transformNaryOperator(node);
    if (folded) return folded;

    if (this.isPipeline(node)) {
      const piped = this.transformPipeline(node);
      if (piped) return piped;
    }

    const applied = this.transformCall(node);
    if (applied) return applied;

    const computedMember = this.transformComputedMember(node);
    if (computedMember) return computedMember;

    return {
      ...node,
      nodes: node.nodes.map((n) => this.visit(n) as ast.ASTNode),
    } as ast.ListNode;
  }

  /**
   * `and` / `or` / `not` -> `&&` / `||` / `!` (D39).
   *
   * They did not exist at all: `(and a b)` was `LL0210 'and' is not defined`. Omitting them from a
   * Lisp-syntax language was a miss, and plenty of modern languages carry both spellings.
   *
   * WHY HERE. The desugarer runs after symbols and before types, which is the only point where ONE
   * rewrite is read by both halves of the compiler. The checker has no rule for a function named
   * `and` -- it types `(&& a b)` -- and codegen's short-circuit path keys on `&&`/`||` as well.
   * Teaching either one alone would mean stating the alias twice, and two implementations of one
   * rule is how this compiler has previously ended up with two answers (see visitList's own note
   * about the trivial-list unwrap, right above).
   *
   * HEAD POSITION ONLY. `(and a b)` is the operator; a value that happens to be named `and` is left
   * alone. The consequence, stated rather than discovered later: the aliases are not usable AS
   * values -- `(map not xs)` still reports `not` undefined, where `(map ! xs)` works. Aliasing a
   * bare identifier would mean reserving the words outright, which is a bigger ruling than D39 made.
   */
  private transformLogicalAlias(node: ast.ListNode): ast.ASTNode | undefined {
    const nodes = Array.isArray(node.nodes) ? node.nodes : [node.nodes];
    const head = nodes[0];
    if (!head || head._type !== "simple-identifier") return undefined;

    const symbol = DesugarAstVisitor.LOGICAL_ALIASES.get((head as any).id);
    if (!symbol) return undefined;

    // `...head` / `...node` deliberately: the rebuilt nodes keep `_parent`, which SymbolTable.scopeOf
    // climbs to find a node's scope. A freshly-constructed node would be invisible to the scope index
    // (see Context's desugar-stage note -- 0 lexical misses preserved, 1056 when the chain is rebuilt).
    return {
      ...node,
      nodes: [
        { ...head, id: symbol },
        ...nodes.slice(1).map((n) => this.visit(n) as ast.ASTNode),
      ],
    } as ast.ListNode;
  }

  /** Counter for the temporaries a comparison chain needs. Per-compilation, so names cannot collide. */
  private chainTemps = 0;

  /**
   * May this operand be written into the tree TWICE without changing what the program does?
   *
   * A chain reads every interior operand from both sides (`a<b && b<c`), so duplicating one is only
   * safe if evaluating it twice is indistinguishable from evaluating it once. A name and a literal
   * qualify; anything with a call, an index or an operator in it does not -- `(< 1 (next!) 9)` would
   * advance the iterator twice, which is the evaluation-order class this corpus has shipped green
   * before.
   */
  private isDuplicable(n: ast.ASTNode): boolean {
    switch (n._type) {
      case "simple-identifier":
      case "integer-number":
      case "float-number":
      case "hex-number":
      case "octal-number":
      case "binary-number":
      case "fraction-number":
      case "complex-number":
      case "string":
      case "boolean":
      case "null":
        return true;
      default:
        return false;
    }
  }

  /**
   * `(< a b c)` -> `(&& (< a b) (< b c))` -- a comparison CHAINS rather than folds (D92).
   *
   * Folding a comparison is nonsense: `((a<b)<c)` compares a Boolean to whatever `c` is, so under a
   * uniform fold the three-operand form is a type error and simply never writable. Chaining is what
   * Scheme, Common Lisp and Python all mean by it. Arithmetic accumulates a VALUE; a comparison
   * accumulates a JUDGEMENT, and that is the whole reason this is a second rule rather than a special
   * case of the fold.
   *
   * ## The interior operand is read twice, and that is the hazard
   *
   * `b` appears on both sides of the `&&`. Written naively, `(< 1 (next!) 9)` calls `next!` twice --
   * an evaluation-order bug of exactly the kind that has shipped green here before, because nothing
   * in a happy-path corpus exercises an impure operand.
   *
   * So an interior operand is bound to a temporary FIRST, and the chain reads the temporary:
   *
   *     (< 1 (f x) 9)   ->   ( (let __ll_chain_0 (f x))
   *                            (&& (< 1 __ll_chain_0) (< __ll_chain_0 9)) )
   *
   * A block's value is its last item, so the whole thing stays an expression.
   *
   * ## …but only when one is actually needed
   *
   * A name or a literal is duplicable — reading it twice is indistinguishable from reading it once —
   * and `(< 1 2 3)` / `(< lo x hi)` are what people actually write. Those emit a bare `&&` chain with
   * NO binding at all, which is not merely tidier: the symbol table indexes the PRE-desugar tree, so
   * a synthesized name is one it has never seen. Introducing bindings only where the alternative is a
   * wrong answer keeps that risk off the common path entirely.
   */
  private transformComparisonChain(node: ast.ListNode): ast.ASTNode | undefined {
    const nodes = listNodes(node);
    const head = nodes[0];
    if (!head || head._type !== "simple-identifier") return undefined;

    const op = (head as any).id;
    if (typeof op !== "string" || !DesugarAstVisitor.CHAIN_OPS.has(op)) return undefined;

    const operands = nodes.slice(1);
    if (operands.length < 3) return undefined; // a binary comparison is already the core form
    if (operands.some((o) => o._type === "spread")) return undefined;

    const visited = operands.map((o) => this.visit(o) as ast.ASTNode);
    const bindings: ast.ASTNode[] = [];

    // Interior operands -- every one except the first and the last -- are the ones read twice.
    const terms = visited.map((o, i) => {
      const interior = i > 0 && i < visited.length - 1;
      if (!interior || this.isDuplicable(o)) return o;

      const name = `__ll_chain_${this.chainTemps++}`;
      const ref = { ...head, id: name } as ast.ASTNode;
      bindings.push({
        ...node,
        _type: "variable",
        mutable: false,
        extern: false,
        name: { ...head, id: name },
        value: o,
      } as unknown as ast.ASTNode);
      return ref;
    });

    const cmp = (l: ast.ASTNode, r: ast.ASTNode): ast.ASTNode =>
      ({ ...node, nodes: [{ ...head }, l, r] } as ast.ListNode);
    const and = (l: ast.ASTNode, r: ast.ASTNode): ast.ASTNode =>
      ({ ...node, nodes: [{ ...head, id: "&&" }, l, r] } as ast.ListNode);

    let chain = cmp(terms[0], terms[1]);
    for (let i = 2; i < terms.length; i++) chain = and(chain, cmp(terms[i - 1], terms[i]));

    // No temporary needed -> no block, no synthesized binding, nothing for scope resolution to miss.
    if (bindings.length === 0) return chain;

    return { ...node, nodes: [...bindings, chain] } as ast.ListNode;
  }

  /**
   * `(- 4 3 2 1)` -> `(- (- (- 4 3) 2) 1)` -- an n-ary operator LEFT-FOLDS into binary ones (D92).
   *
   * WHY THIS EXISTS. Nothing below the desugarer had a coherent answer for three operands, and the two
   * backends had DIFFERENT incoherent ones:
   *
   *   - the JS shim defines `+ - * /` variadically and `% < > <= >= == !=` as `(a, b) => …`, so the
   *     latter SILENTLY DISCARD every operand past the second. `(% 17 10 3)` answered 7 -- which is
   *     `17 % 10` -- where a fold is 1, and nothing warned;
   *   - the C backend folds, and then refuses whatever the fold produces (`(< 1 2 3)` becomes
   *     `((1<2)<3)`, a bool against an int, `ELL0106 compare-on-bool/int`);
   *   - `inferOperatorType` branches on arity 1 and 2 and falls through to `unknown()`, so an n-ary
   *     form was typed by NOTHING. Both D88's promotion and D90's dimension rule live in the
   *     two-operand branch, which is why `(+ metres seconds metres)` printed a number instead of
   *     LL0247 while `(+ metres seconds)` was refused.
   *
   * Folding here fixes all three at once and by construction rather than by three separate patches:
   * after this pass an operator application has exactly two operands, so every rule written for the
   * binary case applies at every arity, and neither backend needs to know n-ary exists.
   *
   * LEFT, not right: `(- 10 1 2)` is 7 on both backends today and stays 7. The fold is chosen to
   * preserve the answer the corpus already depends on -- 54 sites, overwhelmingly `(+ a ": " b)`
   * string building -- not to impose a new one.
   *
   * NOT comparisons (`CHAIN_OPS`): `(< a b c)` means `a<b && b<c` (D92), which duplicates `b` and so
   * needs a temporary to stay correct against an impure operand. Its own round.
   *
   * NOT a spread operand: `(+ ... xs)` is a variadic application, not an n-ary operator, and the C
   * backend already refuses it by name. Folding it would quietly turn a refusal into wrong code.
   *
   * NOT dimensions: `(/ (* Kg Meter Meter) (* Second Second Second))` in a `:satisfies` never reaches
   * here -- `dimensionOperand` yields plain STRINGS (D90), which is the reason it is its own rule.
   */
  private transformNaryOperator(node: ast.ListNode): ast.ASTNode | undefined {
    const nodes = listNodes(node); // comment-filtered: a comment occupies no slot (D83)
    const head = nodes[0];
    if (!head || head._type !== "simple-identifier") return undefined;

    const op = (head as any).id;
    // `isOperatorName`: punctuation only. Inlined rather than imported -- it is a pure string
    // predicate, and reaching into the type checker from the desugarer would invert the layering.
    if (typeof op !== "string" || op.length === 0 || /\w/.test(op)) return undefined;
    if (DesugarAstVisitor.CHAIN_OPS.has(op)) return undefined;

    const operands = nodes.slice(1);
    if (operands.length < 3) return undefined; // unary and binary are already the core form
    if (operands.some((o) => o._type === "spread")) return undefined;

    // `...node` / `...head` deliberately: the rebuilt nodes keep `_parent`, which `SymbolTable.scopeOf`
    // climbs to find a node's scope -- the same reason `transformLogicalAlias` spreads rather than
    // constructs. Every intermediate keeps the whole form's location, so a diagnostic on any of them
    // points at the source the author actually wrote.
    let acc = this.visit(operands[0]) as ast.ASTNode;
    for (let i = 1; i < operands.length; i++) {
      acc = {
        ...node,
        nodes: [{ ...head }, acc, this.visit(operands[i]) as ast.ASTNode],
      } as ast.ListNode;
    }
    return acc;
  }

  /**
   * `((Vault).reveal)` / `((mk).method a b)` -- a member access or method call on a COMPUTED (parenthesised)
   * object, into a `CallNode(MemberNode(...))`. Phase Xg.
   *
   * A `.member` suffix attaches only to a NAME (an `IndexerNode`'s base is an `IdentifierNode`), so when the
   * object is a `(...)` group the `.member` has nothing to attach to and parses as a SEPARATE headless
   * `composite-identifier`. The 2-node list then reads as a block and codegen emits `{ new Vault(); reveal; }`
   * -- invalid JS (LL0101), or a bare `reveal` ReferenceError. The desugar-only `member`/`call` nodes exist
   * for exactly "member/call of a computed value" (the pipeline `(x |> .length)` already produces them); this
   * lifts the surface `(expr).member` form into them. Mirrors `transformPipeline`'s member/call construction.
   *
   * D1/D25: a parenthesised member-list is a CALL, so `((Vault).reveal)` -> `new Vault().reveal()`. The narrow
   * residual is a bare FIELD read on a computed object, which keeps the pipeline `|> .field` / name-binding form.
   */
  private transformComputedMember(node: ast.ListNode): ast.CallNode | undefined {
    const [obj, member, ...args] = node.nodes;
    if (!obj || !member) return undefined;
    // A NAME head is an ordinary call/read (D1) -- untouched. Only a COMPUTED object reaches here.
    if (obj._type === "simple-identifier" || obj._type === "composite-identifier") return undefined;
    // The member is the `.name` that fell out as its own headless composite-identifier.
    if (member._type !== "composite-identifier" || !(member as any).headless) return undefined;

    const loc = { ...node._location };
    const memberNode: ast.MemberNode = {
      _type: "member",
      _location: loc,
      _parent: node._parent,
      object: this.visit(obj) as ast.ASTNode,
      property: this.visit(member) as ast.ASTNode,
      computed: false,
    } as ast.MemberNode;

    return {
      _type: "call",
      _location: loc,
      _parent: node._parent,
      callee: memberNode,
      arguments: args.map((a) => this.visit(a) as ast.ASTNode),
    } as ast.CallNode;
  }

  /**
   * `(call f a b)` -> a real `call` node -- D25's application form, for a callee that is not a name.
   *
   * `call` was NOT missing. It was a RUNTIME SHIM, and a bad one:
   *
   *     const call = (f, args) => !!args && Array.isArray(args) ? f(...args) : f();
   *
   * Its second parameter is an ARGUMENT ARRAY, so `(call g [2])` works and `(call g 2)` -- the way
   * anyone would actually write it -- passes `2`, fails `Array.isArray`, and calls `g()` **with no
   * arguments at all**. The argument is SILENTLY DROPPED. `(call g 2)` on `(fn [x] (+ x 1))` returns
   * NaN, and nothing anywhere reports a thing. Meanwhile `CallNode` and codegen's `visitCall` have
   * existed all along, are correct, and NO SOURCE SYNTAX HAS EVER BUILT ONE: the only producer is the
   * pipeline desugaring, twenty lines up.
   *
   * So this is not "wiring in dead code" -- it is replacing a live shim that quietly loses arguments
   * with the node the compiler already knew how to emit. All six uses in the corpus are zero-arg
   * (`(call check-j)`, `(call noFill)`, `(call Math.random)`), and they emit exactly what they did
   * before; what changes is that the variadic form now means what it says.
   *
   * Desugared rather than parsed, deliberately: both frontends hand over the identical list, so
   * neither grammar has to learn a new form, and the type checker sees the same tree codegen does.
   */
  private transformCall(node: ast.ListNode): ast.CallNode | undefined {
    const [head, ...rest] = node.nodes;

    if (
      head?._type !== "simple-identifier" ||
      (head as ast.SimpleIdentifierNode).id !== "call" ||
      rest.length === 0
    ) {
      return undefined;
    }

    const [callee, ...args] = rest;
    return {
      _type: "call",
      _location: node._location,
      _parent: node._parent,
      callee: this.visit(callee) as ast.ASTNode,
      arguments: args.map((a) => this.visit(a) as ast.ASTNode),
    } as ast.CallNode;
  }

  /** `(seed |> stage |> stage)` -- the separators sit at every odd index. */
  private isPipeline(node: ast.ListNode): boolean {
    return (
      node.nodes.length >= 3 &&
      node.nodes.some(
        (n, i) =>
          i % 2 === 1 &&
          n._type === "simple-identifier" &&
          ["|>", "<|"].includes((n as ast.SimpleIdentifierNode).id)
      )
    );
  }

  /**
   * `(a |> (f x) |> g)`  ->  `g(f(a, x))`, as `call` / `member` nodes.
   *
   * This is a faithful port of the transform that has been living in CODEGEN
   * (`JSTransformerAstVisitor.transformPipelineList`) and is exercised by the whole corpus. It is the
   * reference implementation, and the version that used to be here was not merely unwired -- it was
   * WRONG in two independent ways, and had never run, so nobody found out:
   *
   *   - it folded `[seed, ...args]` at every stage instead of threading `current`, so a three-stage
   *     pipeline silently dropped the middle stage;
   *   - it emitted `[funcNode, fn, ...args]` -- the callee twice, with the whole un-desugared stage
   *     spliced in as the head.
   *
   * Three stage shapes:
   *
   *   `(x |> .length)`     a bare headless identifier  ->  member READ:   x.length
   *   `(x |> (.m a))`      a list with a headless head ->  METHOD CALL:   x.m(a)      [D17]
   *   `(x |> (f a))`       anything else               ->  free call:     f(x, a)
   *
   * D17 is the one that changed. `(.m a)` used to compile to a FREE call `m(x, a)`: codegen's member
   * test was `simple-identifier && id.startsWith(".")`, and the parser produces a
   * `composite-identifier` whose `id` has no leading dot -- so the branch was doubly dead and had
   * never once fired. `05_matching.lisp` only worked because it defines `(fn apply [acc e] (acc.apply
   * e))` BY HAND, a free function whose entire job is to undo the mis-desugaring.
   *
   * Once the checker could finally see the desugared pipeline (Tc), it said so plainly: `LL0210 --
   * 'add' is not defined`, on a method that plainly exists. The receiver is the piped value, so it is
   * the RECEIVER and not also the first argument.
   */
  private transformPipeline(node: ast.ListNode): ast.ASTNode | undefined {
    const nodes = node.nodes;
    let current = this.visit(nodes[0]) as ast.ASTNode;

    for (let i = 1; i < nodes.length; i += 2) {
      const sep = nodes[i];
      if (sep._type !== "simple-identifier") return undefined;
      const op = (sep as ast.SimpleIdentifierNode).id;
      const left = op === "|>";
      const right = op === "<|";
      if (!left && !right) return undefined;

      const stage = nodes[i + 1];
      if (!stage) return undefined;

      let calleeNode: ast.ASTNode;
      let args: ast.ASTNode[] = [];
      // A bare `.m` stage: a member READ, no call.       `(x |> .length)`  ->  x.length
      let memberRead = false;
      // A `(.m a)` stage: a METHOD CALL on the piped value.  `(x |> (.m a))`  ->  x.m(a)   [D17]
      let methodCall = false;

      if (ast.isListNode(stage)) {
        const stageNodes = (stage as ast.ListNode).nodes;
        if (stageNodes.length === 0) return undefined;
        calleeNode = stageNodes[0];
        args = stageNodes.slice(1);
        methodCall =
          calleeNode._type === "composite-identifier" &&
          (calleeNode as ast.CompositeIdentifierNode).headless === true;
      } else if (
        stage._type === "simple-identifier" ||
        stage._type === "composite-identifier"
      ) {
        calleeNode = stage;
        memberRead = (stage as ast.CompositeIdentifierNode).headless === true;
      } else {
        calleeNode = stage;
      }

      const callee = this.visit(calleeNode) as ast.ASTNode;
      const argNodes = args.map((a) => this.visit(a) as ast.ASTNode);

      // `_parent` is the ORIGINAL parent object, never rebuilt -- the scope index was built on the
      // pre-desugar tree and `scopeOf` climbs `_parent` to reach it. See the class comment.
      const loc = { ...stage._location };
      const memberOf = (object: ast.ASTNode): ast.MemberNode => ({
        _type: "member",
        _location: loc,
        _parent: node._parent,
        object,
        property: callee,
        computed: false,
      } as ast.MemberNode);

      if (memberRead) {
        current = memberOf(current);
      } else if (methodCall) {
        // D17. The receiver IS the piped value, so it is NOT also an argument.
        current = {
          _type: "call",
          _location: loc,
          _parent: node._parent,
          callee: memberOf(current),
          arguments: argNodes,
        } as ast.CallNode;
      } else {
        current = {
          _type: "call",
          _location: loc,
          _parent: node._parent,
          callee,
          arguments: left ? [current, ...argNodes] : [...argNodes, current],
        } as ast.CallNode;
      }
    }

    return current;
  }

  visitFunction(node: ast.FunctionNode): ast.FunctionNode {
    // P3c-1c-ii. Computed from the ORIGINAL node (its parameters and declared return type), before
    // the body is rebuilt, because the parameter prologue has to hang off the pre-desugar function
    // node for `scopeOf` to find the scope its names live in.
    const prologue = this.refineParamPrologue(node);
    if (node.body.length === 0) {
      return prologue.length ? ({ ...node, body: prologue } as ast.FunctionNode) : node;
    }

    // A COPY, not `node.body = ...`. That was an in-place mutation of the very FunctionNode the
    // symbol table holds as `symbol.value` -- the parse tree the scope index was built from. A
    // desugar pass must not reach backwards into the tree an earlier pass indexed.
    const body = node.body.map((x) => this.visit(x) as ast.ASTNode);

    return {
      ...node,
      // D49a: `-> Void` BINDS -- it suppresses the implicit return. Without it the annotation
      // asserted something nothing enforced: D9 makes Void == Nil, so `checkReturns` bails on a
      // `-> Void` declaration, and the tail got returned anyway -- which is how
      // `(fn add [x] -> Void (this.items.push x))` came to return an Int.
      //
      // A `:gen` takes THE SAME EXEMPTION, which this comment has claimed since D49a landed while the
      // condition did not implement it (gap ledger §11.1). D31 is explicit -- "implicit return of the
      // tail: SUPPRESSED. A generator's tail value is not a sequence element." Wrapping it anyway
      // produced diagnostics at programs nobody wrote: a body ending in `(yield x)` became
      // `(return (yield x))` and drew LL0223 "a ':gen' stops with a valueless '(return)'", and a body
      // ending in any Void call drew LL0213 "declares Iterator<T>, but returns Void". Latent until
      // now only because every corpus generator happened to end in a `while` loop.
      //
      // The refinement checks run AFTER the implicit return is (optionally) injected, so that on the
      // comptime path -- the only one where the flag is on -- an injected `(return e)` is seen as the
      // explicit form it now is, and the tail is not wrapped twice.
      body: [
        ...prologue,
        ...(this.injectImplicitReturns && !isVoidReturn(node) && !node.generator ? this.wrapTail(body) : body),
      ],
    } as ast.FunctionNode;
  }

  /**
   * The IMPLICIT RETURN: a function's tail expression becomes an explicit `(return e)`.
   *
   * This replicates codegen's rule EXACTLY -- codegen is the reference implementation, exercised by
   * the whole corpus. The point is not to improve it here; it is to move it, so the TYPE CHECKER sees
   * the return. Today `checkReturns` walks the body looking for `(return e)` lists, and an implicit
   * return has none, so a declared return type is enforced only if you happened to write `return`
   * yourself:
   *
   *     (fn f [] -> Int (return "str"))   ->  LL0213
   *     (fn f [] -> Int "str")            ->  CLEAN
   *
   */
  private wrapTail(items: ast.ASTNode[]): ast.ASTNode[] {
    if (items.length === 0) return items;

    // The tail is the last FORM, not the last node. A comment occupies no slot (D25), so a body
    // ending `99  ;; the value` wrapped the COMMENT in the implicit return and the function answered
    // whatever `return /* … */` lowers to -- nil on JS, an uninitialized read on C.
    //
    // SKIPPED here, not filtered: Zb already ruled that a comment in a BLOCK still reaches the output
    // and only a POSITIONAL one is dropped. Filtering the list would have quietly widened that trade.
    let i = items.length - 1;
    while (i >= 0 && items[i]?._type === "comment") i--;
    if (i < 0) return items;

    const last = items[i];
    const wrapped = this.wrapIfValue(last);
    if (wrapped === last) return items;

    return [...items.slice(0, i), wrapped, ...items.slice(i + 1)];
  }

  private wrapIfValue(node: ast.ASTNode): ast.ASTNode {
    // A BODY WRITTEN AS ONE PARENTHESIZED BLOCK. Its value is its own tail:
    //
    //     (fn f [n] ((console.log "side") (* n 2)))
    //
    // The block is a `list` whose head is not a name -- so it is not a call -- and the return belongs
    // INSIDE it, on its last statement. Wrapping the block itself would emit `return { ... }`.
    if (valueIsTail(node)) {
      const block = node as ast.ListNode;
      return { ...block, nodes: this.wrapTail(block.nodes) } as ast.ListNode;
    }

    // A trailing `if`: the return goes on each BRANCH, not around the `if`.
    if (node._type === "if") {
      const ifNode = node as ast.IfNode;
      return {
        ...ifNode,
        then: this.wrapIfValue(ifNode.then),
        else: ifNode.else ? this.wrapIfValue(ifNode.else) : undefined,
      } as ast.IfNode;
    }

    // A trailing `cond`: the return goes on each CLAUSE BODY. Same shape as the `if` above -- a cond
    // IS a dispatch chain of ifs, and codegen emits it as one.
    //
    // It was excluded (via `isValueTail`) while `if` was special-cased here, so
    // `(fn f [x <- Int] -> String (cond ((> x 0) "pos") (true "neg")))` handed back UNDEFINED against
    // a declared `-> String`, silently. Not a ruling: `if` and `match` already yield their value, so
    // the language had decided; cond and when were the two nobody came back for.
    //
    // A clause whose body is ALREADY `(return e)` is left alone -- `isValueTail` refuses it, which is
    // what keeps D25/Xb's `(cond ((>= score 90) (return "A")))` from becoming `return (return "A")`.
    if (node._type === "cond") {
      const condNode = node as ast.CondNode;
      return {
        ...condNode,
        cases: condNode.cases.map((c) => ({
          ...c,
          body: this.wrapIfValue(c.body),
        })),
      } as ast.CondNode;
    }

    // A trailing `when`: the return goes on the LAST statement of the body, which is what `wrapTail`
    // does for a function body -- a `when`'s `:then` is a statement LIST, not a single node.
    //
    // `when` is `if` without an else, so it is partial in exactly the way `(if c 1)` already is: no
    // match, no value. That is D9's business, not this fix's.
    if (node._type === "when") {
      const whenNode = node as ast.WhenNode;
      return {
        ...whenNode,
        then: this.wrapTail(whenNode.then),
      } as ast.WhenNode;
    }

    return this.isValueTail(node) ? this.wrapInReturn(node) : node;
  }


  /**
   * Does this tail node YIELD a value that should be returned?
   *
   * The exclusions mirror codegen's `isControlStatement` + its `x._type !== "variable"` guard.
   *
   * `if` / `when` / `cond` are listed below, and NONE of them reaches this method any more -- all
   * three are handled by `wrapIfValue` above, which puts the return on each branch / clause / body.
   * The entries are kept as the fallback for a tail this method is asked about out of that context.
   *
   * THE COMMENT THAT USED TO BE HERE said all three were "EXCLUDED, and that is deliberate", because
   * "whether a trailing `if` should be an expression is a RULING, not a detail to slip into a
   * refactor". The ruling was made -- `if` was special-cased in `wrapIfValue`, and `match` was never
   * excluded -- and this comment was not updated. So it described a language with one rule while the
   * code implemented two, and `cond`/`when` sat in the gap: a function declared `-> String` whose tail
   * was a `cond` returned UNDEFINED, silently, for as long as that took to notice (Yb).
   *
   * The rule, stated once: a trailing control form YIELDS ITS VALUE. `if` yields its branch, `cond`
   * its clause, `when` its body, `match` its arm. All four are partial in the same way and for the
   * same reason -- no branch taken, no value -- which is D9's problem, not this method's.
   *
   * `match` is not excluded and never was: codegen emits it as an IIFE -- an expression -- and returns it.
   */
  private isValueTail(node: ast.ASTNode): boolean {
    const notAValue: Set<ast.NodeType> = new Set([
      // control flow -- statements in a tail, by codegen's rule
      "when",
      "cond",
      "while",
      "for",
      "for-each",
      "try-catch",
      // declarations -- nothing to return
      "variable",
      "class",
      "struct",
      "interface",
      "enum",
      "type-def",
      "modifier-def",
      "attribute-def",
      "macro-def",
      "import",
      "export",
      "comment",
    ]);

    if (notAValue.has(node._type)) return false;

    // A LAMBDA is a value; a named `fn` DECLARATION is not.
    //
    // Codegen draws exactly this line, and it draws it on the EMITTED node: an anonymous function
    // becomes an ArrowFunctionExpression (an expression -- wrapped in a return) while a named one
    // becomes a FunctionDeclaration (a statement -- left alone). Excluding `function` outright, as the
    // unwired desugarer did, silently swallowed the return of every `defmodifier` -- whose whole body
    // IS a trailing lambda, the wrapper it hands back. `TypeError: add is not a function`.
    if (node._type === "function") {
      return !(node as ast.FunctionNode).name;
    }

    // Already a `(return e)` or `(throw e)`.
    if (ast.isListNode(node)) {
      const head = (node as ast.ListNode).nodes[0];
      if (
        head?._type === "simple-identifier" &&
        ["return", "throw"].includes((head as ast.SimpleIdentifierNode).id)
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * D88 -- a numeric-tower LITERAL becomes an ordinary CONSTRUCTION.
   *
   *     1/2      ->  (Rational 1 2)
   *     3+4i     ->  (Complex 3.0 4.0)
   *
   * Exactly the shape `AstBuilder` already uses for `(lo .. hi)` -> `(Range lo hi nil true)`: pure
   * desugar, no dedicated node and no new lowering, so type inference and BOTH backends treat these as
   * the constructions they are. It is what lets the frozen JS backend gain the feature for free.
   *
   * HERE AND NOT IN `AstBuilder`, and the ordering is the whole reason. `Context.injectPrelude` runs
   * AFTER parse and BEFORE the symbols stage, and it decides whether to pull in `std/math` by looking
   * for these literal node types. Rewriting them at parse time would erase the very evidence the
   * injector reads, and `Rational` would then be an undefined name.
   *
   * A user who defines their own `Rational` captures the name, exactly as they would for `Range`. That
   * is the existing precedent's behaviour, not a new hazard.
   */
  visitFractionNumber(node: ast.FractionNumberNode): ast.ASTNode {
    return this.construct(node, "Rational", [
      this.intLit(node, node.numerator),
      this.intLit(node, node.denominator),
    ]);
  }

  visitComplexNumber(node: ast.ComplexNumberNode): ast.ASTNode {
    return this.construct(node, "Complex", [
      this.realLit(node, node.real),
      this.realLit(node, node.imaginary),
    ]);
  }

  /** `(Name a b)` -- a construction carrying the literal's own location and parent. */
  private construct(src: ast.ASTNode, name: string, args: ast.ASTNode[]): ast.ListNode {
    const head: ast.SimpleIdentifierNode = {
      _type: "simple-identifier",
      id: name,
      _location: { ...src._location },
      _parent: src._parent,
    } as ast.SimpleIdentifierNode;
    return {
      _type: "list",
      _location: { ...src._location },
      _parent: src._parent,
      nodes: [head, ...args],
    } as ast.ListNode;
  }

  private intLit(src: ast.ASTNode, value: number): ast.ASTNode {
    // `match` is the lossless copy `ResolveHirToCir` prefers over `value` (a JS f64 has already
    // rounded past 2^53). A fraction's parts come from `parseInt`, so this is the honest spelling.
    return {
      _type: "integer-number",
      value,
      match: String(value),
      _location: { ...src._location },
      _parent: src._parent,
    } as any;
  }

  private realLit(src: ast.ASTNode, value: number): ast.ASTNode {
    return {
      _type: "float-number",
      value,
      match: Number.isInteger(value) ? `${value}.0` : String(value),
      _location: { ...src._location },
      _parent: src._parent,
    } as any;
  }

  /**
   * `e`  ->  `(return e)`.
   *
   * The synthesized nodes keep the ORIGINAL `_parent` object -- never `undefined`, never rebuilt. A
   * node with no parent cannot reach a scope: `scopeOf` returns undefined and resolution falls back
   * silently to the flat root search, which is the exact failure P6 exists to prevent.
   */
  private wrapInReturn(node: ast.ASTNode): ast.ASTNode {
    return {
      _type: "list",
      _location: { ...node._location },
      _parent: node._parent,
      nodes: [
        {
          _type: "simple-identifier",
          id: "return",
          _location: { ...node._location },
          _parent: node._parent,
        } as ast.SimpleIdentifierNode,
        node,
      ],
    } as ast.ListNode;
  }

}
