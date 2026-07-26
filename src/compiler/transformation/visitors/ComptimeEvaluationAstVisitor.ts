import * as ast from "../../frontend/ast";
import { BaseAstTreeWalker } from "../../BaseAstTreeWalker";
import { Context, LogLevel } from "../../Context";
import { ComptimeDiagnostics as CO } from "../../rules/diagnostics";
import { hasModifier } from "../../helpers/modifiers";
import { ComptimeInterpreter } from "../../comptime/Interpreter";

/**
 * NO JAVASCRIPT REACHES THIS FILE ANY MORE (D73).
 *
 * It used to import `JSTransformerAstVisitor`, `astring`, `node:vm` and `RuntimeProvider`: a fold was
 * performed by lowering the expression to JS, prepending the runtime shim, and running the result in
 * a vm sandbox. That is what made the JS backend the compiler's own EVALUATOR rather than merely a
 * target, and D69 named it as the reason the backend could not be deleted.
 *
 * `compiler/comptime/Interpreter.ts` evaluates the AST directly instead. Everything else here -- the
 * two fold sites, the deletion of a folded declaration, the diagnostics -- is unchanged.
 */
export class ComptimeEvaluationAstVisitor extends BaseAstTreeWalker {
  constructor(context: Context) {
    super(context);
  }

  visit(node: ast.ASTNode): any {
    if (!node) return node;

    const methodName = `visit${node._type
      .split("-")
      .map((s) => s[0].toUpperCase() + s.slice(1))
      .join("")}`;

    // `overridesVisitor`, NOT `(this as any)[methodName]`. The latter is always truthy -- every node
    // type has an inherited no-op visitor -- so this dispatched to the no-op for every type it does
    // not handle, returned the node unchanged, and the recursion below was DEAD CODE.
    //
    // The consequence was not cosmetic: this pass never entered an `if` / `while` / `for` / `match`
    // body, so a `:comptime` fold inside one never happened. The tree-shaker then deleted the
    // function -- correctly, since a `:comptime` function is supposed to be folded away -- and the
    // program threw `ReferenceError` at run time. Zero diagnostics.
    if (this.overridesVisitor(methodName)) {
      return (this as any)[methodName](node);
    }

    // Default shallow copy and recursion for non-specific nodes
    if (this.isLiteral(node)) return node;

    const result = { ...node } as any;
    for (const key of ast.getNodeIterableKeys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        // Drop only the nodes a FOLD deleted -- not every null in the array.
        //
        // `.filter(item => item !== null)` was destructive: a headless composite-identifier (`.apply`
        // in a pipeline stage) has `parts: [null, "apply"]`, where the leading `null` IS the absent
        // head and carries meaning. Filtering it away left `["apply"]`, codegen read `parts[1]` as
        // undefined, and both pipeline files died with "Cannot read properties of undefined".
        //
        // It only surfaced when this pass started recursing at all -- before that it never reached a
        // composite-identifier, so a latently destructive filter looked harmless for years.
        result[key] = value
          .map((item: any) => (ast.isAstNode(item) ? this.visit(item) : item))
          .filter((item: any, i: number) => !(ast.isAstNode(value[i]) && item === null));
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

  visitVariable(node: ast.VariableNode): ast.VariableNode {
    const isComptime = hasModifier(node.modifiers, "comptime");
    
    // Visit value first in case it has nested comptime calls
    const visitedValue = this.visit(node.value) as ast.ASTNode;

    if (isComptime) {
      const varName = (node.name as any).id ?? (node.name as any).name;

      // A literal is already the value it folds to -- nothing to evaluate, and nothing to report.
      if (this.isLiteral(visitedValue)) {
        return { ...node, value: visitedValue };
      }

      const result = this.evaluateExpression(visitedValue);
      if (result.ok) {
        return {
          ...node,
          value: this.createLiteralNode(result.value, visitedValue),
        };
      }

      // The diagnostic now says WHY. It used to be "Failed to evaluate comptime variable: x", full
      // stop -- the sandbox's actual complaint went to a logger the test harness discards.
      this.report(CO.ComptimeVariable, node, {
        name: varName,
        error: result.error,
      });
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
        const isComptime = hasModifier(funcNode.modifiers, "comptime");
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
          // A call to a `:comptime` function MUST fold. It is not optional, and failing to fold is
          // not a graceful downgrade to run time -- it is a guaranteed crash.
          //
          // The declaration is DELETED from the output unconditionally (see the top of this method),
          // while the call was only replaced when the fold succeeded. So an unfoldable call left the
          // callee gone and the call standing, and the program shipped
          //
          //     ReferenceError: twice is not defined
          //
          // with ZERO diagnostics. Every failure path here used to `return newNode` and say nothing.
          const args = visitedNodes.slice(1);
          const nonLiteral = args.find((arg) => !this.isLiteral(arg));

          if (nonLiteral) {
            this.report(CO.ComptimeArgNotLiteral, nonLiteral, {
              name: symbolName,
              type: nonLiteral._type,
            });
            return newNode;
          }

          const result = this.evaluateExpression(newNode);
          if (!result.ok) {
            this.report(CO.ComptimeEval, newNode, {
              name: symbolName,
              error: result.error,
            });
            return newNode;
          }

          return this.createLiteralNode(result.value, newNode);
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

  /**
   * The outcome of a fold. Explicitly a RESULT, not a bare value.
   *
   * This used to return `any`, with `undefined` meaning "it failed" -- and it swallowed the reason
   * into a logger the test harness discards. So a caller could not tell a genuine failure from an
   * expression that legitimately evaluated to `undefined`, and could not say WHY anything failed.
   * Both callers now get the reason and put it in the diagnostic.
   */
  /**
   * Evaluate a comptime expression. The engine is `ComptimeInterpreter` -- an AST walker -- where this
   * used to build a JS program, prepend the runtime shim, and run it in `node:vm`.
   *
   * Still a RESULT rather than a bare value, for the reason recorded when it became one: `undefined`
   * as "it failed" cannot be told apart from an expression that legitimately evaluated to nothing, and
   * both callers put the reason in their diagnostic.
   */
  private evaluateExpression(
    expr: ast.ASTNode
  ): { ok: true; value: any } | { ok: false; error: string } {
    try {
      const value = new ComptimeInterpreter(this.context.symbolTable).evaluate(expr);
      this.context.log(LogLevel.Info, "[comptime] Evaluated -> " + String(value));
      return { ok: true, value };
    } catch (e: any) {
      const message = String(e?.message ?? e);
      this.context.log(LogLevel.Error, `Comptime evaluation error: ${message}`);
      return { ok: false, error: message };
    }
  }

  private createLiteralNode(value: any, original: ast.ASTNode): ast.ASTNode {
    // An Int arrives as a BIGINT and keeps its exact decimal text. `match` is the lossless copy every
    // downstream reader wants -- `ResolveHirToCir` reads it precisely because `value` as a JS number
    // has already rounded past 2^53, which is the bug the vm path shipped: `(inc 9007199254740992)`
    // folded to ...992, losing the `+ 1`, while the same call at run time was exact.
    if (typeof value === "bigint") {
      return {
        _type: "integer-number",
        value: Number(value),
        match: value.toString(),
        _location: original._location,
        _parent: original._parent,
      } as any;
    }
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
    } else if (value == null) {
      // A fold whose ANSWER is nil (D9). `"null"` was already in this visitor's `isLiteral` set, so
      // it would happily fold INTO a nil -- and then fall through to `return original`, silently
      // handing back the UNFOLDED expression. The fold reported success and changed nothing.
      //
      // `== null` on purpose: it catches both bottoms. `node:vm` is a real JS sandbox and hands back
      // a real `undefined` for, say, an out-of-range lookup; the language has one bottom, so both
      // become `nil` on the way back in.
      return {
        _type: "null",
        keyword: "nil",
        _location: original._location,
        _parent: original._parent
      } as ast.NullNode;
    }
    return original;
  }
}
