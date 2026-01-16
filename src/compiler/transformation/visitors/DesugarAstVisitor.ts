import * as ast from "../../frontend/ast";
import { LogLevel } from "../../Context";
import { BaseAstTreeWalker } from "../../BaseAstTreeWalker";
import { formatWithOptions } from "util";

/**
 * DesugarAstVisitor - Transform complex syntax into simpler forms
 *
 * This visitor performs AST desugaring operations:
 * 1. Pipeline Transformation: (a |> b |> c) → (c (b a))
 * 2. Implicit Return Injection: Wraps last expressions in explicit (return ...)
 * 3. List/Matrix Unrolling: [1 | 2] → [[1], [2]]
 *
 * These transformations simplify the code generation phase, allowing JSTransformer
 * to focus purely on mapping desugared AST to JavaScript.
 */
export class DesugarAstVisitor extends BaseAstTreeWalker {
  /**
   * Override visit to control recursion manually.
   * This prevents BaseAstTreeWalker from auto-recursing and overwriting
   * our desugared transformations.
   */
  visitProgram(node: ast.ProgramNode): ast.ProgramNode {
    (node as any).program = (node as any).program.map((n: any, i: number) => {
      return this.visit(n);
    });
    return node;
  }

  visit(node: ast.ASTNode): any {
    if (!node) return node;
    // this.context.log(LogLevel.Info, `[DESUGAR] visit: ${node._type} (parent: ${node._parent?._type})`);

    const type = node._type;
    const methodName = `visit${type
      .split("-")
      .map((s) => s[0].toUpperCase() + s.slice(1))
      .join("")}`;

    if ((this as any)[methodName]) {
      return (this as any)[methodName](node);
    }

    // Manual fallbacks for container nodes
    if (type === "program") {
      return this.visitProgram(node as any);
    }

    return node;
  }

  /**
   * Desugar a list node - check if it's a pipeline and transform.
   */
  visitList(node: ast.ListNode): ast.ASTNode {
    // 0. Unwrap trivial lists: (expression) -> expression
    // Only if it's not an identifier (to avoid ambiguous calls like (func))
    if (
      node.nodes.length === 1 &&
      node.nodes[0]._type !== "simple-identifier" &&
      node.nodes[0]._type !== "composite-identifier"
    ) {
      return this.visit(node.nodes[0]);
    }

    const hasPipelineOp = node.nodes.some(
      (n) =>
        n._type === "simple-identifier" && ["|>", "<|"].includes((n as any).id)
    );

    if (hasPipelineOp && node.nodes.length > 2) {
      const result = this.transformPipelineList(node);
      if (result) {
        // this.context.log(LogLevel.Debug, `Ended desugaring with: ${this.dump(result!)}`);
        return result;
      }
    }

    return {
      _type: "list",
      _location: { ...node._location },
      _parent: node._parent,
      nodes: node.nodes.map((n) => this.visit(n) as ast.ASTNode),
    } as ast.ListNode;
  }

  private transformPipelineList(node: ast.ListNode): ast.ListNode {
    this.context.log(LogLevel.Debug, "!!!--- Hit pipeline in the desugar");

    let processingNodes: ast.ASTNode[] = node.nodes;

    const seed = this.visit(processingNodes[0]) as ast.ASTNode;
    let current: ast.ListNode;

    for (let i = 1; i < processingNodes.length; i += 2) {
      const id = (processingNodes[i] as ast.SimpleIdentifierNode).id;
      const left = id === "|>";
      const right = id === "<|";
      if (!left && !right) {
        // TODO: Log
        return node;
      }

      const funcNode = processingNodes[i + 1];
      this.context.log(LogLevel.Debug, `!!!--- Dir = ${id} !!!--- funcType = ${funcNode._type}`);

      let functionNode: ast.ASTNode;
      let args: ast.ASTNode[] = [];
      let member = false;

      if (funcNode._type === "list") {
        const listNodes = (funcNode as ast.ListNode).nodes;
        if (listNodes.length > 0) {
          functionNode = listNodes[0];
          args = listNodes.slice(1);

          this.context.log(LogLevel.Debug, `--- Desugaring function node: ${this.dump(functionNode)}`);

          if (
            functionNode._type === "composite-identifier" &&
            (functionNode as ast.CompositeIdentifierNode).headless
          ) {
            member = true;
            const rawId = (functionNode as any).id;
            functionNode = { ...functionNode, id: rawId } as any;
          }
        } else {
          // TODO: Log
          this.context.log(LogLevel.Debug, `--- Hit early return from desugar for node: ${this.dump(node)}`);
          return node;
        }
      } else if (
        funcNode._type === "simple-identifier" ||
        funcNode._type === "composite-identifier"
      ) {
        functionNode = funcNode;

        this.context.log(LogLevel.Debug, `!!!--- ${(funcNode as ast.CompositeIdentifierNode).id}`);
        if ((funcNode as ast.CompositeIdentifierNode).headless) {
          member = true;
          const rawId = (funcNode as any).id;
          functionNode = { ...funcNode, id: rawId } as any;
        }
      } else {
        functionNode = funcNode;
      }

      const fn = this.visit(functionNode) as ast.ASTNode;
      const argExprs = args.map((a) => this.visit(a) as ast.ASTNode);

      this.context.log(LogLevel.Debug, `!!!--- FN: ${(fn as any).name} ARGS: ${argExprs.map(a => (a as any).name).join(", ")}`);

      if (member) {
        current = {
          nodes: [
            {
              _type: "simple-identifier",
              _location: { ...funcNode._location },
              _parent: funcNode._parent,
              id: "get",
            } as ast.SimpleIdentifierNode,
            funcNode,
            seed,
            fn,
          ],
          _location: { ...node._location },
          _parent: node._parent,
          _type: "list",
        };
      } else {
        const calleeArgs = left
          ? [seed, ...argExprs]
          : right
          ? [...argExprs, seed]
          : [];
        current = {
          nodes: [funcNode, fn, ...calleeArgs],
          _location: { ...node._location },
          _parent: node._parent,
          _type: "list",
        } as ast.ListNode;
      }
    }

    this.context.log(LogLevel.Debug, "complete desugar");
    return current!;
  }

  /**
   * Desugar a function node - inject implicit returns.
   * Desugars the function body only.
   */
  visitFunction(node: ast.FunctionNode): ast.FunctionNode {
    this.context.log(LogLevel.Info, `Desugaring function: ${node.name?.id || node.name?.value || "anonymous"}`);
    // Transform body: inject implicit returns
    if (node.body.length === 0) return node;

    // Desugar all nodes (pipelines, etc.)
    const transformedBody = node.body.map((x) => this.visit(x) as ast.ASTNode);

    // Apply implicit return ONLY to the last node if appropriate
    const lastIndex = transformedBody.length - 1;
    let lastNode = transformedBody[lastIndex];

    // Check if we should wrap the last node in a return
    if (this.shouldWrapInReturn(lastNode)) {
      this.context.log(LogLevel.Info, `Wrapping last node of type ${lastNode._type} in return`);
      transformedBody[lastIndex] = this.wrapInReturn(lastNode);
    }

    node.body = transformedBody;
    return node;
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
          _parent: undefined,
        } as ast.SimpleIdentifierNode,
        node,
      ],
    } as ast.ListNode;
  }
}
