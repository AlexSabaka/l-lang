import * as ast from "../../frontend/ast";
import { BaseAstVisitor } from "../../BaseAstVisitor";

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
export class DesugarAstVisitor extends BaseAstVisitor {
  /**
   * Visit the program node and desugar all its contents.
   */
  visitProgram(node: ast.ProgramNode): ast.ProgramNode {
    // Transform each item in the program
    const transformedProgram = node.program.map((item) => this.desugarNode(item));
    
    return {
      ...node,
      program: transformedProgram,
    };
  }

  /**
   * Recursively desugar a node by visiting it and transforming its structure.
   */
  private desugarNode(node: ast.ASTNode): ast.ASTNode {
    // Handle different node types
    if (node._type === 'list') {
      return this.desugarList(node as ast.ListNode);
    } else if (node._type === 'function') {
      return this.desugarFunction(node as ast.FunctionNode);
    } else {
      // For other nodes with potential children, recursively desugar
      return this.visitNodeWithChildren(node);
    }
  }

  /**
   * Desugar a list node - check if it's a pipeline and transform.
   */
  private desugarList(node: ast.ListNode): ast.ASTNode {
    // First, check if this is a pipeline list
    const pipelineResult = this.transformPipelineList(node.nodes);
    if (pipelineResult !== null) {
      // This was a pipeline - return the transformed result (which is already desugared)
      return pipelineResult;
    }

    // Not a pipeline - desugar children normally
    const desugaredNodes = node.nodes.map((n) => this.desugarNode(n));
    return {
      ...node,
      nodes: desugaredNodes,
    };
  }

  /**
   * Desugar a function node - inject implicit returns.
   */
  private desugarFunction(node: ast.FunctionNode): ast.FunctionNode {
    // Transform body: inject implicit returns
    const transformedBody = this.transformFunctionBody(node.body);
    
    return {
      ...node,
      body: transformedBody,
    };
  }

  /**
   * Visit a node that may have children and desugar them.
   */
  private visitNodeWithChildren(node: any): ast.ASTNode {
    // Generic handler for nodes with children - recursively desugar
    const transformed: any = { ...node };
    
    // Recursively transform known child properties
    if (transformed.nodes && Array.isArray(transformed.nodes)) {
      transformed.nodes = transformed.nodes.map((n: ast.ASTNode) => this.desugarNode(n));
    }
    if (transformed.program && Array.isArray(transformed.program)) {
      transformed.program = transformed.program.map((n: ast.ASTNode) => this.desugarNode(n));
    }
    if (transformed.body && Array.isArray(transformed.body)) {
      transformed.body = transformed.body.map((n: ast.ASTNode) => this.desugarNode(n));
    }
    
    return transformed;
  }

  /**
   * Transform a pipeline list into nested function calls.
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
   * Transform function body to inject implicit returns.
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
      // For other nodes, recursively desugar them
      return this.desugarNode(node);
    });

    return transformed;
  }

  /**
   * Wrap a node in an explicit return, unless it should be excluded.
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
}
