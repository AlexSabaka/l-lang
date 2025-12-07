import * as ast from "../../frontend/ast";
import { BaseAstTreeWalker } from "../../BaseAstTreeWalker";

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
   * Visit a list and check if it's a pipeline.
   * If so, transform it to nested function calls.
   * Otherwise, continue normal traversal.
   */
  visitList(node: ast.ListNode) {
    // First, check if this is a pipeline list
    const pipelineResult = this.transformPipelineList(node.nodes);
    if (pipelineResult !== null) {
      // This was a pipeline - return the transformed result
      return pipelineResult;
    }

    // Not a pipeline - visit normally
    return super.visitList(node);
  }

  /**
   * Visit a function and inject implicit returns.
   * Also visit all children normally.
   */
  visitFunction(node: ast.FunctionNode) {
    // Transform body: inject implicit returns
    const transformedBody = this.transformFunctionBody(node.body);
    
    // Create new function node with transformed body
    const transformedNode = {
      ...node,
      body: transformedBody
    };

    // Continue normal visitor traversal on the transformed node
    return super.visitFunction(transformedNode);
  }

  /**
   * Private helper: Transform a pipeline list into nested function calls.
   * Returns the transformed node, or null if not a pipeline.
   */
  private transformPipelineList(nodes: ast.ASTNode[]): ast.ASTNode | null {
    if (nodes.length < 3) return null;

    // 1. Detect Direction
    // Check the first operator to decide flow.
    // [A, <|, B] -> Backward
    // [A, |>, B] -> Forward
    const firstOpNode = nodes[1];
    let isBackward = false;

    if (firstOpNode._type === 'simple-identifier') {
      const id = (firstOpNode as ast.SimpleIdentifierNode).id;
      if (id === '<|') isBackward = true;
      else if (id !== '|>') return null; // Not a pipeline
    } else {
      return null; // Not a pipeline
    }

    // 2. Normalize to Forward Pipeline List: [Seed, |>, Step1, |>, Step2...]
    let processingNodes: ast.ASTNode[] = [];

    if (isBackward) {
      // Reverse the flow!
      // Original: [FuncA, <|, FuncB, <|, Seed]
      // Target:   [Seed, |>, FuncB, |>, FuncA]

      // Seed is the last element
      const seed = nodes[nodes.length - 1];
      processingNodes.push(seed);

      // Iterate backwards, skipping the operators
      // i points to the Function/Step
      for (let i = nodes.length - 2; i >= 0; i -= 2) {
        const func = nodes[i - 1];
        // We inject the forward operator
        processingNodes.push({
          _type: 'simple-identifier',
          id: '|>',
          _location: firstOpNode._location,
          _parent: undefined
        } as any);
        processingNodes.push(func);
      }
    } else {
      // Already forward, just use as is
      processingNodes = nodes;
    }

    // 3. Build the Sequence
    const seed = processingNodes[0];
    const sequence: any[] = [];

    // Iterate in pairs: [ |>, Func ]
    for (let i = 1; i < processingNodes.length; i += 2) {
      // const opNode = processingNodes[i]; // We know it's |> now
      const funcNode = processingNodes[i + 1];

      if (!funcNode) return null;

      let functionNode: ast.ASTNode;
      let args: ast.ASTNode[] = [];
      let member = false;

      // Extract Function and Arguments
      if (funcNode._type === 'list') {
        // Case: (add 10)
        const listNodes = (funcNode as ast.ListNode).nodes;
        if (listNodes.length > 0) {
          functionNode = listNodes[0];
          args = listNodes.slice(1);

          // Member check: (.toString 16)
          if (
            functionNode._type === 'simple-identifier' &&
            (functionNode as any).id.startsWith('.')
          ) {
            member = true;
            const rawId = (functionNode as any).id.substring(1);
            functionNode = { ...functionNode, id: rawId } as any;
          }
        } else {
          return null; // Empty list
        }
      } else if (
        funcNode._type === 'simple-identifier' ||
        funcNode._type === 'composite-identifier'
      ) {
        // Case: square
        functionNode = funcNode;

        // Member check: .length
        if (
          funcNode._type === 'simple-identifier' &&
          (funcNode as any).id.startsWith('.')
        ) {
          member = true;
          const rawId = (funcNode as any).id.substring(1);
          functionNode = { ...funcNode, id: rawId } as any;
        }
      } else {
        // Case: Literal/Expression (e.g. 5, "hello", etc.)
        functionNode = funcNode;
      }

      sequence.push({
        operator: 'carrying-left', // Always forward now
        function: functionNode,
        memberFunction: member,
        arguments: args
      });
    }

    // 4. Create Synthetic AST Node
    const syntheticNode: ast.FunctionCarryingNode = {
      _type: 'function-carrying',
      _location: seed._location,
      _parent: undefined,
      identifier: seed as any,
      sequence: sequence
    };

    // Return the synthetic node (will be visited separately)
    return syntheticNode;
  }

  /**
   * Private helper: Transform function body to inject implicit returns.
   * Wraps the last expression in an explicit (return ...) node,
   * unless it's already a return, control statement, or variable declaration.
   */
  private transformFunctionBody(body: ast.ASTNode[]): ast.ASTNode[] {
    if (body.length === 0) return body;

    // Transform all nodes in the body
    const transformed = body.map((node, index) => {
      // Check if this is the last node
      if (index === body.length - 1) {
        // Apply implicit return logic
        return this.maybeWrapInReturn(node);
      }
      return node;
    });

    return transformed;
  }

  /**
   * Private helper: Wrap a node in an explicit return, unless it should be excluded.
   * Returns are represented as (return value) lists.
   */
  private maybeWrapInReturn(node: ast.ASTNode): ast.ASTNode {
    // Exclude conditions:
    // 1. Already a return statement (list starting with 'return')
    // 2. Control statements (if, while, try-catch, for, for-each)
    // 3. Variable declarations
    // 4. Function definitions
    // 5. Class definitions
    // 6. Import/Export statements

    const excludedTypes: Set<ast.NodeType> = new Set([
      'if',
      'while',
      'try-catch',
      'for',
      'for-each',
      'variable',
      'function',
      'class',
      'interface',
      'import',
      'export'
    ]);

    // Check if it's a return statement (list with head = 'return')
    if (node._type === 'list') {
      const listNode = node as ast.ListNode;
      const nodes = Array.isArray(listNode.nodes) ? listNode.nodes : [listNode.nodes];
      if (nodes.length > 0) {
        const head = nodes[0];
        if (
          head._type === 'simple-identifier' &&
          (head as ast.SimpleIdentifierNode).id === 'return'
        ) {
          // Already a return, don't wrap again
          return node;
        }
      }
    }

    if (excludedTypes.has(node._type)) {
      return node;
    }

    // Wrap in return: (return node)
    const returnNode: ast.ListNode = {
      _type: 'list',
      _location: node._location,
      _parent: node._parent,
      nodes: [
        {
          _type: 'simple-identifier',
          id: 'return',
          _location: node._location,
          _parent: undefined
        } as ast.SimpleIdentifierNode,
        node
      ]
    };

    return returnNode;
  }

  /**
   * Visit and continue traversal.
   */
  visit(node: ast.ASTNode, defaultVisitor?: (node?: ast.ASTNode) => any): any {
    if (!node) return node;

    // First apply desugaring logic
    let result: any;

    if (node._type === 'list') {
      result = this.visitList(node as ast.ListNode);
    } else if (node._type === 'function') {
      result = this.visitFunction(node as ast.FunctionNode);
    } else {
      // Default visitor behavior
      result = super.visit(node, defaultVisitor);
    }

    // If the result is a node, continue walking it
    if (result && typeof result === 'object' && '_type' in result) {
      return super.visit(result);
    }

    return result;
  }
}
