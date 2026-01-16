import * as ast from "../../frontend/ast";
import { BaseAstTreeWalker } from "../../BaseAstTreeWalker";
import { Context, LogLevel } from "../../Context";
import { RuleSeverity } from "../../rules";
import { SymbolEntry } from "../../analysis/SymbolTable";
import { JSTransformerAstVisitor } from "../../codegen/js-estree/visitors/JSTransformerAstVisitor";
import { DesugarAstVisitor } from "./DesugarAstVisitor";
import * as vm from "node:vm";
import { generate } from "astring";
import { encodeIdentifier } from "../../utils/encodeIdentifier";

export class ComptimeEvaluationAstVisitor extends BaseAstTreeWalker {
  private runtimeCode = "";

  constructor(context: Context) {
    super(context);
    this.prepareRuntime();
  }

  visit(node: ast.ASTNode): any {
    if (!node) return node;

    const methodName = `visit${node._type
      .split("-")
      .map((s) => s[0].toUpperCase() + s.slice(1))
      .join("")}`;

    if ((this as any)[methodName]) {
      return (this as any)[methodName](node);
    }

    // Default shallow copy and recursion for non-specific nodes
    if (this.isLiteral(node)) return node;

    const result = { ...node } as any;
    for (const key of ast.getNodeIterableKeys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        result[key] = value
          .map((item) => (ast.isAstNode(item) ? this.visit(item) : item))
          .filter((item) => item !== null); // Filter out nulls
      } else if (ast.isAstNode(value)) {
        result[key] = this.visit(value);
      }
    }
    return result;
  }

  visitProgram(node: ast.ProgramNode) {
    const visitedProgram = node.program.map((x) => this.visit(x)).filter((x) => x !== null);
    return {
      ...node,
      program: visitedProgram,
    };
  }

  private prepareRuntime() {
    this.runtimeCode = `
      const __ll_op_registry = {
        operators: {},
        register: function(symbol, params, fn) {
          if (!this.operators[symbol]) this.operators[symbol] = [];
          this.operators[symbol].push({ params, fn });
        },
        lookup: function(symbol, args) {
          const list = this.operators[symbol];
          if (!list) return null;
          return null; // Simplified
        }
      };
      const ${encodeIdentifier("+")} = (a, b) => a + b;
      const ${encodeIdentifier("-")} = (a, b) => a - b;
      const ${encodeIdentifier("*")} = (a, b) => a * b;
      const ${encodeIdentifier("/")} = (a, b) => a / b;
      const ${encodeIdentifier("<=")} = (a, b) => a <= b;
      const ${encodeIdentifier(">=")} = (a, b) => a >= b;
      const ${encodeIdentifier("<")} = (a, b) => a < b;
      const ${encodeIdentifier(">")} = (a, b) => a > b;
      const ${encodeIdentifier("==")} = (a, b) => a === b;
      const ${encodeIdentifier("!=")} = (a, b) => a !== b;
    `;
  }

  visitVariable(node: ast.VariableNode): ast.VariableNode {
    const isComptime = node.modifiers.some(m => m.modifier === "comptime");
    
    // Visit value first in case it has nested comptime calls
    const visitedValue = this.visit(node.value) as ast.ASTNode;

    if (isComptime) {
      // Check if value is already a literal or if it's an expression we can evaluate
      const result = this.evaluateExpression(visitedValue);
      if (result !== undefined) {
        return {
          ...node,
          value: this.createLiteralNode(result, visitedValue),
        };
      } else if (!this.isLiteral(visitedValue)) {
        this.context.results.add(
          node,
          {
            code: "LL0099",
            severity: RuleSeverity.Error,
            message: `Failed to evaluate comptime variable: ${
              (node.name as any).id ?? (node.name as any).name
            }`,
            test: () => true,
          },
          this.context
        );
      }
    }

    return {
      ...node,
      value: visitedValue
    };
  }

  visitList(node: ast.ListNode): ast.ASTNode | null {
    // Check if this list contains a comptime function as first node
    if (node.nodes && node.nodes.length > 0) {
      const firstNode = node.nodes[0];
      if (firstNode._type === "function") {
        const funcNode = firstNode as ast.FunctionNode;
        const isComptime = funcNode.modifiers?.some((m) => m.modifier === "comptime");
        if (isComptime) {
          this.context.log(
            LogLevel.Info,
            `Removing comptime function: ${(funcNode.name as any)?.id || "anonymous"}`,
            "ComptimeEvaluationAstVisitor.visitList"
          );
          return null; // Mark for removal
        }
      }
    }

    // 1. Visit children first to resolve nested comptime calls
    const visitedNodes = node.nodes
      .map(n => this.visit(n))
      .filter(n => n !== null); // Filter out removed nodes
    const newNode = { ...node, nodes: visitedNodes };

    // 2. Check if it's a call to a comptime function
    if (visitedNodes.length > 0 && (visitedNodes[0]._type === "simple-identifier" || visitedNodes[0]._type === "composite-identifier")) {
      const first = visitedNodes[0];
      const symbolName = first._type === "simple-identifier" ? (first as ast.SimpleIdentifierNode).id : "";
      
      if (symbolName) {
        const symbol = this.context.symbolTable?.resolveSymbol(symbolName);
        if (symbol && symbol.isComptime && symbol.nodeType === "function") {
          // ONLY evaluate if all arguments are literals (resolved)
          const args = visitedNodes.slice(1);
          const allLiterals = args.every(arg => this.isLiteral(arg));
          
          if (allLiterals) {
            const result = this.evaluateExpression(newNode);
            if (result !== undefined) {
              return this.createLiteralNode(result, newNode);
            }
          }
        }
      }
    }

    return newNode;
  }

  private isLiteral(node: ast.ASTNode): boolean {
    return [
      "integer-number", "float-number", "string", "boolean", "null", 
      "hex-number", "octal-number", "binary-number"
    ].includes(node._type);
  }

  private evaluateExpression(expr: ast.ASTNode): any {
    let fullCode = "";
    try {
      const transformer = new JSTransformerAstVisitor(this.context);
      const esNode = transformer.visit(expr);
      const code = generate(esNode);

      const sandbox = {
        console: {
          log: (...args: any[]) => this.context.log(LogLevel.Info, "[comptime] " + args.join(" ")),
          error: (...args: any[]) => this.context.log(LogLevel.Error, "[comptime] " + args.join(" "))
        }
      };
      vm.createContext(sandbox);

      fullCode = this.runtimeCode + "\n";
      const deps = this.collectComptimeDependencies(expr);
      fullCode += deps + "\n";
      fullCode += code;

      const result = vm.runInContext(fullCode, sandbox);
      this.context.log(LogLevel.Info, "[comptime] Evaluated: " + code + " -> " + result);
      return result;
    } catch (e: any) {
      this.context.log(LogLevel.Error, `Comptime evaluation error: ${e.message}`);
      // Log the code if error
      if (fullCode) {
        this.context.log(LogLevel.Error, "Full code was: \n" + fullCode);
      }
      return undefined;
    }
  }

  private collectComptimeDependencies(node: ast.ASTNode): string {
    let code = "";
    const transformer = new JSTransformerAstVisitor(this.context);
    const visited = new Set<string>();

    const findDeps = (n: ast.ASTNode) => {
      if (!n) return;
      if (n._type === "simple-identifier") {
        const id = (n as ast.SimpleIdentifierNode).id;
        if (!visited.has(id)) {
          visited.add(id);
          const symbol = this.context.symbolTable?.resolveSymbol(id);
          if (symbol && symbol.isComptime && symbol.nodeType === "function") {
            let fnNode = symbol.value as ast.FunctionNode;
            
            // Desugar the function node to ensure implicit returns are injected
            const desugarer = new DesugarAstVisitor(this.context);
            fnNode = desugarer.visit(fnNode) as ast.FunctionNode;
            
            const esFn = transformer.visit(fnNode);
            code += generate(esFn) + "\n";
            fnNode.body.forEach(findDeps);
          }
        }
      }
      
      const iterableKeys = ast.getNodeIterableKeys(n);
      for (const key of iterableKeys) {
        const value = (n as any)[key];
        if (Array.isArray(value)) {
          value.forEach(findDeps);
        } else if (value && typeof value === 'object' && '_type' in value) {
          findDeps(value);
        }
      }
    };

    findDeps(node);
    return code;
  }

  private createLiteralNode(value: any, original: ast.ASTNode): ast.ASTNode {
    if (typeof value === "number") {
      const isInt = Number.isInteger(value);
      return {
        _type: isInt ? "integer-number" : "float-number",
        value: value,
        match: String(value),
        _location: original._location,
        _parent: original._parent
      } as any;
    } else if (typeof value === "string") {
      return {
        _type: "string",
        value: value,
        _location: original._location,
        _parent: original._parent
      } as ast.StringNode;
    } else if (typeof value === "boolean") {
      return {
        _type: "boolean",
        value: value,
        _location: original._location,
        _parent: original._parent
      } as ast.BooleanNode;
    }
    return original;
  }
}
