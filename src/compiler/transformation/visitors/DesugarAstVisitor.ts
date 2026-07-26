import * as ast from "../../frontend/ast";
import { valueIsTail } from "../../analysis/listForm";
import { Context, LogLevel } from "../../Context";
import { BaseAstTreeWalker } from "../../BaseAstTreeWalker";
import { formatWithOptions } from "util";

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

/** An Int refined newtype's boundary check: inclusive bounds, plus a flag per side (0 = open). */
type RefineInfo = { lo: number; hi: number; clo: number; chi: number };

/** What to put around a function's tail VALUE. `(return e)` for the implicit return, a refinement
 *  check for P3c-1c-ii -- same placement, different wrapper. */
type TailWrap = (value: ast.ASTNode) => ast.ASTNode;

export class DesugarAstVisitor extends BaseAstTreeWalker {
  /** `and`/`or`/`not` -> the operators they alias (D39). See `transformLogicalAlias`. */
  private static readonly LOGICAL_ALIASES: ReadonlyMap<string, string> = new Map([
    ["and", "&&"],
    ["or", "||"],
    ["not", "!"],
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
   * Populated from `type-def` nodes before the walk, so `visitVariable` can wrap a value coerced into
   * one. Empty for every program that declares no `:satisfies` newtype, so this is a strict no-op there.
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
      if (n._type === "type-def" && n.refinement && this.typeNameOf(n.type) === "Int") {
        const bound = (b: any): number | null =>
          b && typeof b.value === "number" ? b.value : null;
        const lo = bound(n.refinement.lo);
        const hi = bound(n.refinement.hi);
        const name = n.name ? ast.symbolName(n.name) : undefined;
        if (name && (lo !== null || hi !== null)) {
          this.refinedInt.set(name, { lo: lo ?? 0, hi: hi ?? 0, clo: lo !== null ? 1 : 0, chi: hi !== null ? 1 : 0 });
        }
      }
      for (const k of ast.getNodeIterableKeys(n)) walk((n as any)[k]);
    };
    walk(root);
  }

  /**
   * `(let x <- uint8 init)` -> `(let x <- uint8 (__refine_check_int init lo hi clo chi))` when the
   * annotation names an Int refined newtype. The wrapper references only a FLOOR builtin + the existing
   * init node + literals -- no synthesized user-scope names -- so it sidesteps the `_parent` scope
   * index. The floor fn returns the value (or panics), so it drops in at the value position.
   */
  visitVariable(node: ast.VariableNode): ast.VariableNode {
    const recursed = this.rebuild(node) as any;
    const info = this.refinedInt.get(this.typeNameOf(node.type) ?? "");
    if (info && recursed.value && ast.isAstNode(recursed.value)) {
      recursed.value = this.wrapRefineCheck(recursed.value, info);
    }
    return recursed as ast.VariableNode;
  }

  private wrapRefineCheck(value: ast.ASTNode, info: RefineInfo): ast.ASTNode {
    return this.refineCall(value, info, (value as any)._location, undefined);
  }

  /** Copy a node, recursing into its children -- the generic rebuild the overriding visitors share. */
  private rebuild(node: ast.ASTNode): ast.ASTNode {
    const out = { ...node } as any;
    for (const k of ast.getNodeIterableKeys(node)) {
      const v = (node as any)[k];
      out[k] = Array.isArray(v)
        ? v.map((x: any) => (ast.isAstNode(x) ? this.visit(x) : x))
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
    const mk = (type: string, fields: any): any => ({ ...fields, _type: type, _location: loc, _parent: parent });
    const id = (s: string) => mk("simple-identifier", { id: s });
    const num = (v: number) => mk("integer-number", { match: String(v), value: v });
    return mk("list", {
      nodes: [id("__refine_check_int"), subject, num(info.lo), num(info.hi), num(info.clo), num(info.chi)],
    });
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

  /** Is this list node an explicit `(return …)`, and what does it return? */
  private returnValueOf(n: any): { value: ast.ASTNode | undefined } | undefined {
    if (!n || n._type !== "list" || !Array.isArray(n.nodes) || n.nodes.length === 0) return undefined;
    const head = n.nodes[0];
    if (head?._type !== "simple-identifier" || head.id !== "return") return undefined;
    return { value: n.nodes.length > 1 ? n.nodes[1] : undefined };
  }

  /**
   * The RETURN boundary (P3c-1c-ii). Two forms have to be covered because they are materialized in
   * different places: an EXPLICIT `(return e)` is a list form right here, while an IMPLICIT tail
   * return does not become one until HIR lowering.
   *
   * The explicit ones are rewritten by a walk that does NOT descend into a nested function -- its
   * returns are its own. The implicit one reuses `wrapTail`, so the check lands wherever codegen
   * would have put the return (each `if` branch, each `cond` clause, a `when` body, inside a
   * parenthesized block), instead of this pass inventing a second, divergent placement rule.
   * `isValueTail` already refuses a node that IS a `(return e)`, so the two never double-wrap.
   */
  private refineReturnChecks(node: ast.FunctionNode, body: ast.ASTNode[]): ast.ASTNode[] {
    const info = this.refinedInt.get(this.typeNameOf(node.returns) ?? "");
    // A `:gen` yields an Iterator, and a `-> Void` returns nothing -- neither returns the refined type.
    if (!info || node.generator || isVoidReturn(node)) return body;

    const rewriteExplicit = (n: any): any => {
      if (!n || typeof n !== "object") return n;
      if (Array.isArray(n)) return n.map(rewriteExplicit);
      if (n._type === "function") return n;
      const ret = this.returnValueOf(n);
      if (ret?.value) {
        const nodes = [...n.nodes];
        nodes[1] = this.wrapRefineCheck(rewriteExplicit(ret.value), info);
        return { ...n, nodes };
      }
      const out: any = { ...n };
      for (const k of ast.getNodeIterableKeys(n)) out[k] = rewriteExplicit((n as any)[k]);
      return out;
    };

    return this.wrapTail(body.map(rewriteExplicit), (v) => this.wrapRefineCheck(v, info));
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
        result[key] = value.map((item: any) =>
          ast.isAstNode(item) ? this.visit(item) : item
        );
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
        ...this.refineReturnChecks(
          node,
          this.injectImplicitReturns && !isVoidReturn(node) && !node.generator ? this.wrapTail(body) : body
        ),
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
   * `wrap` is WHAT to put around the tail value, defaulting to `(return e)`. It is a parameter
   * because the refinement checks (P3c-1c-ii) need the identical PLACEMENT -- each `if` branch, each
   * `cond` clause, a `when` body, inside a parenthesized block -- while wrapping in
   * `(__refine_check_int e …)` instead. Re-deriving that placement in a second pass is how the two
   * would drift apart; this way there is one rule with two wrappers.
   */
  private wrapTail(items: ast.ASTNode[], wrap: TailWrap = (n) => this.wrapInReturn(n)): ast.ASTNode[] {
    if (items.length === 0) return items;

    const last = items[items.length - 1];
    const wrapped = this.wrapIfValue(last, wrap);
    if (wrapped === last) return items;

    return [...items.slice(0, -1), wrapped];
  }

  private wrapIfValue(node: ast.ASTNode, wrap: TailWrap = (n) => this.wrapInReturn(n)): ast.ASTNode {
    // A BODY WRITTEN AS ONE PARENTHESIZED BLOCK. Its value is its own tail:
    //
    //     (fn f [n] ((console.log "side") (* n 2)))
    //
    // The block is a `list` whose head is not a name -- so it is not a call -- and the return belongs
    // INSIDE it, on its last statement. Wrapping the block itself would emit `return { ... }`.
    if (valueIsTail(node)) {
      const block = node as ast.ListNode;
      return { ...block, nodes: this.wrapTail(block.nodes, wrap) } as ast.ListNode;
    }

    // A trailing `if`: the return goes on each BRANCH, not around the `if`.
    if (node._type === "if") {
      const ifNode = node as ast.IfNode;
      return {
        ...ifNode,
        then: this.wrapIfValue(ifNode.then, wrap),
        else: ifNode.else ? this.wrapIfValue(ifNode.else, wrap) : undefined,
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
          body: this.wrapIfValue(c.body, wrap),
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
        then: this.wrapTail(whenNode.then, wrap),
      } as ast.WhenNode;
    }

    return this.isValueTail(node) ? wrap(node) : node;
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
