import * as ast from "../../frontend/ast";
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
export class DesugarAstVisitor extends BaseAstTreeWalker {
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

  visitProgram(node: ast.ProgramNode): ast.ProgramNode {
    return {
      ...node,
      program: node.program.map((n) => this.visit(n) as ast.ASTNode),
    } as ast.ProgramNode;
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
    if (this.isPipeline(node)) {
      const piped = this.transformPipeline(node);
      if (piped) return piped;
    }

    return {
      ...node,
      nodes: node.nodes.map((n) => this.visit(n) as ast.ASTNode),
    } as ast.ListNode;
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
   * A stage is a MEMBER only when it is a bare headless identifier (`|> .length`). A LIST stage whose
   * head is headless -- `(.apply evt)` -- is NOT treated as a member here, because codegen does not
   * treat it as one either: its test is `simple-identifier && id.startsWith(".")`, and the parser
   * produces a `composite-identifier` whose `id` has no leading dot, so that branch is doubly dead.
   * `(.apply evt)` therefore compiles to a FREE call `apply(seed, evt)` -- which is why
   * `05_matching.lisp` has to define `(fn apply [acc e] (acc.apply e))` by hand.
   *
   * That is a bug, and it is D17's (Td). It is replicated EXACTLY here so that moving the transform
   * changes nothing: one thing at a time, and the diff is the proof.
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
      let member = false;

      if (ast.isListNode(stage)) {
        const stageNodes = (stage as ast.ListNode).nodes;
        if (stageNodes.length === 0) return undefined;
        calleeNode = stageNodes[0];
        args = stageNodes.slice(1);
      } else if (
        stage._type === "simple-identifier" ||
        stage._type === "composite-identifier"
      ) {
        calleeNode = stage;
        member = (stage as ast.CompositeIdentifierNode).headless === true;
      } else {
        calleeNode = stage;
      }

      const callee = this.visit(calleeNode) as ast.ASTNode;
      const argNodes = args.map((a) => this.visit(a) as ast.ASTNode);

      // `_parent` is the ORIGINAL parent object, never rebuilt -- the scope index was built on the
      // pre-desugar tree and `scopeOf` climbs `_parent` to reach it. See the class comment.
      const loc = { ...stage._location };

      current = member
        ? ({
            _type: "member",
            _location: loc,
            _parent: node._parent,
            object: current,
            property: callee,
            computed: false,
          } as ast.MemberNode)
        : ({
            _type: "call",
            _location: loc,
            _parent: node._parent,
            callee,
            arguments: left ? [current, ...argNodes] : [...argNodes, current],
          } as ast.CallNode);
    }

    return current;
  }

  visitFunction(node: ast.FunctionNode): ast.FunctionNode {
    if (node.body.length === 0) return node;

    // A COPY, not `node.body = ...`. That was an in-place mutation of the very FunctionNode the
    // symbol table holds as `symbol.value` -- the parse tree the scope index was built from. A
    // desugar pass must not reach backwards into the tree an earlier pass indexed.
    const body = node.body.map((x) => this.visit(x) as ast.ASTNode);

    if (this.injectImplicitReturns) {
      const last = body.length - 1;
      if (this.shouldWrapInReturn(body[last])) {
        body[last] = this.wrapInReturn(body[last]);
      }
    }

    return { ...node, body } as ast.FunctionNode;
  }

  /**
   * Check if a node should be wrapped in an implicit return.
   */
  private shouldWrapInReturn(node: ast.ASTNode): boolean {
    // Never wrap control structures or explicit definitions
    const excludedTypes: Set<ast.NodeType> = new Set([
      "while",
      "try-catch",
      "for",
      "for-each",
      "variable",
      "function",
      "class",
      "interface",
      "import",
      "export",
    ]);

    if (excludedTypes.has(node._type)) {
      return false;
    }

    if (node._type === "if") {
      return true; // We'll handle this recursively in wrapInReturn
    }

    // Check if it's already a return statement
    if (node._type === "list") {
      const listNode = node as ast.ListNode;
      const nodes = Array.isArray(listNode.nodes)
        ? listNode.nodes
        : [listNode.nodes];
      if (nodes.length > 0) {
        const head = nodes[0];
        if (
          head._type === "simple-identifier" &&
          ((head as ast.SimpleIdentifierNode).id === "return" ||
            (head as ast.SimpleIdentifierNode).id === "throw")
        ) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Wrap a node in an explicit return.
   * Returns are represented as (return value) lists.
   */
  private wrapInReturn(node: ast.ASTNode): ast.ASTNode {
    if (!this.shouldWrapInReturn(node)) {
      return node;
    }

    if (node._type === "if") {
      const ifNode = node as ast.IfNode;
      return {
        ...ifNode,
        then: this.wrapInReturn(ifNode.then),
        else: ifNode.else ? this.wrapInReturn(ifNode.else) : undefined,
      } as ast.IfNode;
    }

    return {
      _type: "list",
      _location: { ...node._location },
      _parent: node._parent,
      nodes: [
        {
          _type: "simple-identifier",
          id: "return",
          _location: { ...node._location },
          // The ORIGINAL parent, never `undefined`. A node with no parent cannot reach a scope --
          // `scopeOf` returns undefined and resolution falls back to the flat search. Harmless for
          // `return` itself (a special form, never resolved), but the invariant is the point.
          _parent: node._parent,
        } as ast.SimpleIdentifierNode,
        node,
      ],
    } as ast.ListNode;
  }
}
