import * as ast from "../../frontend/ast";
import { BaseAstTreeWalker } from "../../BaseAstTreeWalker";
import { Context, LogLevel } from "../../Context";
import { ComptimeDiagnostics as CO } from "../../rules/diagnostics";
import { SymbolEntry } from "../../analysis/SymbolTable";
import { JSTransformerAstVisitor } from "../../codegen/js-estree/visitors/JSTransformerAstVisitor";
import { DesugarAstVisitor } from "./DesugarAstVisitor";
import { hasModifier } from "../../helpers/modifiers";
import * as vm from "node:vm";
import { generate } from "astring";
import { RuntimeProvider } from "../../runtime";

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

  /**
   * The sandbox runs THE REAL RUNTIME. It must, or folding is not evaluation -- it is a different
   * language that happens to agree most of the time.
   *
   * This used to hand-roll ten operators. Two consequences, and the second is the serious one:
   *
   *   MISSING. `%`, `&&`, `||`, `!` are all real l-lang operators and none of them were here, so a
   *   `:comptime` body using one blew up in the sandbox -- and, before the fix in this same commit,
   *   blew up SILENTLY.
   *
   *   WRONG. The hand-rolled `+` was BINARY -- `(a, b) => a + b` -- while the real runtime's `+` is
   *   VARIADIC. So the identical expression gave two different answers depending on when it ran:
   *
   *       (let :comptime folded (+ 1 2 3))   ->  3        <- the sandbox dropped the third argument
   *       (let ran (+ 1 2 3))                ->  6        <- the real runtime
   *
   *   `:comptime` silently changed the ANSWER. A compile-time evaluator that disagrees with the
   *   run-time one is worse than no compile-time evaluator at all: the bug only appears in the
   *   builds where the fold fires.
   *
   * Taking the shim from RuntimeProvider -- the single source both paths already use -- makes the two
   * impossible to diverge. It is never emitted; it exists only inside the vm sandbox.
   */
  private prepareRuntime() {
    this.runtimeCode = RuntimeProvider.getRuntimeShim();
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
  private evaluateExpression(
    expr: ast.ASTNode
  ): { ok: true; value: any } | { ok: false; error: string } {
    let fullCode = "";
    try {
      const transformer = new JSTransformerAstVisitor(this.context);
      const esNode = transformer.visit(expr);
      const code = generate(esNode);

      // DRAIN THE INLINED DEFINITIONS. Visiting an imported symbol RENAMES it -- `PI` ->
      // `__ll_inlined_PI_1`, so two modules' `PI` cannot collide -- and records its definition to be
      // emitted later. `compile()` / `visitProgram` are what normally drain that, and this evaluator
      // deliberately calls neither: it visits one expression, not a program.
      //
      // So the rename happened and the definition never arrived, and the sandbox was handed code
      // referencing a name nothing in it declared: "__ll_inlined_PI_1 is not defined". `:comptime`
      // could not see ANY imported symbol -- two shipped features that could not appear in one
      // expression (AF-046).
      //
      // The REPL is the other external driver of this visitor and already does exactly this
      // (ReplSession, "`visitProgram`/`compile` -- which we deliberately do not call -- are what
      // normally drain these"). The operator registrations go with them: `(* PI 2)` emits `_2a(PI, 2)`,
      // and an imported `:operator` overload has to be registered before that shim can find it.
      const inlinedCode = transformer
        .getInlinedDefinitions()
        .map((s) => generate(s))
        .join("\n");
      const operatorCode = transformer
        .getOperatorRegistrations()
        .map((s) => generate(s))
        .join("\n");

      const sandbox = {
        console: {
          log: (...args: any[]) => this.context.log(LogLevel.Info, "[comptime] " + args.join(" ")),
          error: (...args: any[]) => this.context.log(LogLevel.Error, "[comptime] " + args.join(" "))
        }
      };
      vm.createContext(sandbox);

      // Order is load-bearing: the runtime shims, then the inlined imports and their operator
      // registrations, then the local comptime deps, and only then the expression that uses them.
      fullCode = this.runtimeCode + "\n";
      fullCode += inlinedCode + "\n";
      fullCode += operatorCode + "\n";
      const deps = this.collectComptimeDependencies(expr);
      fullCode += deps + "\n";
      fullCode += code;

      const result = vm.runInContext(fullCode, sandbox);
      this.context.log(LogLevel.Info, "[comptime] Evaluated: " + code + " -> " + result);
      return { ok: true, value: result };
    } catch (e: any) {
      this.context.log(LogLevel.Error, `Comptime evaluation error: ${e.message}`);
      if (fullCode) {
        this.context.log(LogLevel.Error, "Full code was: \n" + fullCode);
      }
      return { ok: false, error: String(e?.message ?? e) };
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
            // `true`: inject implicit returns. That is the ONLY reason this call exists -- the sandbox
          // needs a function that RETURNS something, and without it `(factorial 5)` folds to `null`.
          const desugarer = new DesugarAstVisitor(this.context, true);
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
