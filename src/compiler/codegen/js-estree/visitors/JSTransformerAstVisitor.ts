import * as ESTree from "estree";
import { generate } from "astring";

import * as ast from "../../../frontend/ast";
import { classifyList, isDottedMemberIndexer } from "../../../analysis/listForm";
import { BaseAstVisitor } from "../../../BaseAstVisitor";
import { Context, LogLevel, VERSION } from "../../../Context";
import { ScopeType, SymbolEntry, InferredType } from "../../../analysis/SymbolTable";
import { RuntimeProvider } from "../../../runtime";
import {
  uniqueIdentifier,
  encodeIdentifier,
} from "../../../utils";
import { CodegenDiagnostics as CD } from "../../../rules/diagnostics";
import { TypeChecker } from "../../../types/TypeChecker";
import { shouldCopyOnStore, shouldCopyParam } from "../../../hir/valueCopy";
import { isBuiltinModifier, hasModifier } from "../../../helpers/modifiers";
import * as acorn from "acorn";
import { ClassBuilder } from "../JSClassBuilder";
import { EmitHirToEstree, LegacyLeafEmitter, LowerAstToHirVisitor } from "../../../hir";
import {
  getTypeName as resolveTypeName,
  receiverType as resolveReceiverType,
  memberKindOn as resolveMemberKindOn,
  buildExtensionTable,
  conformingExtensionFn,
} from "../../../hir/extensionResolution";
import type { HBlock } from "../../../hir";
import { SourceMapGenerator } from "source-map";
import path from "path";
import { formatWithOptions } from "util";
import { DesugarAstVisitor } from "../../../transformation/visitors/DesugarAstVisitor";
import { buildTypesMetadata } from "../../../reflection/metadata";

/**
 * ESTree node creation helpers with location tracking
 */
class ESTreeBuilder {
  static loc(node: ast.ASTNode): ESTree.SourceLocation | null {
    if (!node._location) return null;
    return {
      source: node._location.source,
      start: {
        line: node._location.start.line,
        column: node._location.start.column,
      },
      end: {
        line: node._location.end.line,
        column: node._location.end.column,
      },
    };
  }

  static identifier(node: ast.ASTNode, name: string): ESTree.Identifier {
    return {
      type: "Identifier",
      name,
      loc: this.loc(node),
    };
  }

  static literal(node: ast.ASTNode, value: any): ESTree.Literal {
    return {
      type: "Literal",
      value,
      loc: this.loc(node),
    };
  }

  static memberExpression(
    node: ast.ASTNode,
    object: ESTree.Expression,
    property: ESTree.Expression | ESTree.Identifier,
    computed: boolean = false
  ): ESTree.MemberExpression {
    return {
      type: "MemberExpression",
      object,
      property,
      computed,
      optional: false,
      loc: this.loc(node),
    };
  }

  static callExpression(
    node: ast.ASTNode,
    callee: ESTree.Expression,
    args: ESTree.Expression[]
  ): ESTree.CallExpression {
    return {
      type: "CallExpression",
      callee,
      arguments: args,
      optional: false,
      loc: this.loc(node),
    };
  }

  static blockStatement(
    node: ast.ASTNode,
    body: ESTree.Statement[]
  ): ESTree.BlockStatement {
    return {
      type: "BlockStatement",
      body,
      loc: this.loc(node),
    };
  }

  static expressionStatement(
    node: ast.ASTNode,
    expression: ESTree.Expression
  ): ESTree.ExpressionStatement {
    return {
      type: "ExpressionStatement",
      expression,
      loc: this.loc(node),
    };
  }

  static returnStatement(
    node: ast.ASTNode,
    argument: ESTree.Expression | null
  ): ESTree.ReturnStatement {
    return {
      type: "ReturnStatement",
      argument,
      loc: this.loc(node),
    };
  }

  static sequenceExpression(
    node: ast.ASTNode,
    expressions: ESTree.Expression[]
  ): ESTree.SequenceExpression {
    return {
      type: "SequenceExpression",
      expressions,
      loc: this.loc(node),
    };
  }
}

export class JSTransformerAstVisitor extends BaseAstVisitor {
  /**
   * Codegen is the one pass that must be TOTAL: every node type it is handed either has a
   * `visitX` that emits ESTree, or it is a compiler bug we have to say out loud.
   *
   * The inherited default returns the node unchanged -- correct for the analysis and type passes,
   * which legitimately ignore most node types, but poison here: an l-lang AST node gets spliced
   * into the ESTree and the failure surfaces frames later inside astring as
   * `this[node.init.type] is not a function`, blaming a third-party library for a construct this
   * compiler simply cannot emit. (Live example before this existed: `examples/07-async/00.lisp`,
   * whose only real problem is that `await` has no codegen.)
   *
   * We report and CONTINUE rather than throw: `hasErrors` already blocks codegen and exits 1, so
   * nothing invalid is ever written, and finishing the pass means one run reports EVERY unhandled
   * construct instead of dying on the first.
   */
  protected onUnhandled(node: ast.ASTNode, method: string): any {
    this.report(CD.Unhandled, node, {
      type: node._type,
      method,
    });
    return ESTreeBuilder.identifier(node, "undefined");
  }

  /**
   * The backend must never emit JavaScript that JavaScript cannot parse.
   *
   * astring will happily serialise a malformed ESTree into a string; nothing downstream checks it,
   * so the first thing that notices is `node` at runtime -- or, worse, nothing does. Parsing our
   * own output closes that gap at the single point where code leaves the compiler.
   *
   * Tried as a script first, then as a module: the emitted bundle is normally an IIFE (a script),
   * but accepting either is what "JavaScript can parse this" actually means, and avoids
   * false-positives from module-only or script-only syntax.
   */
  private validateEmittedJs(code: string, node: ast.ASTNode): void {
    const opts = { ecmaVersion: "latest" as const, allowReturnOutsideFunction: true };
    try {
      acorn.parse(code, { ...opts, sourceType: "script" });
      return;
    } catch (scriptErr: any) {
      try {
        acorn.parse(code, { ...opts, sourceType: "module" });
        return;
      } catch {
        // Report the script-mode error: that is the mode the output actually runs in.
        // Quote the offending line -- without it the reader gets a line number into a file that
        // was never written to disk, which is close to useless.
        const line = scriptErr?.loc?.line;
        const offending =
          typeof line === "number" ? (code.split("\n")[line - 1] ?? "").trim() : "";
        const at = typeof line === "number"
          ? ` at emitted line ${line}:${scriptErr.loc.column}` +
            (offending ? ` -> ${JSON.stringify(offending.slice(0, 80))}` : "")
          : "";
        this.report(CD.InvalidEmittedJs, node, {
          at,
          error: String(scriptErr?.message ?? scriptErr),
        });
      }
    }
  }

  private scope: ScopeType[] = [ScopeType.program];

  /**
   * SOURCE-ORDER ACCUMULATORS. They are a RECORD of what has been visited -- never a DECISION input.
   *
   * They used to be both, and that was the standing "codegen is source-order dependent" gap. The same
   * expression compiled differently depending on where it sat in the file:
   *
   *     (f)                 ->  f            // f not visited YET  -> a bare reference
   *     (fn f [] 7)
   *     (f)                 ->  f()          // f visited          -> a call
   *
   * So `(f)` before its declaration printed `[Function: f]` instead of calling it. A silent wrong
   * answer -- and it made "a function may be forward-referenced" a LIE, which is what blocked the
   * forward-reference ruling (D24).
   *
   * The call/construct decision now asks the SYMBOL TABLE, which is built in a prior pass and knows
   * every declaration in the module regardless of order. See `declarationKindOf`.
   */
  public functions: string[] = [];
  public classes: string[] = [];
  public variables: string[] = [];

  private enumKeys: Record<string, string> = {};
  private inlineStandardSymbols: string[] = [];
  private inlinedSymbols: Record<string, string> = {};
  private inlinedDefinitions: Record<string, ESTree.Statement> = {};
  /**
   * The file being compiled. Set by `beginProgram()` -- which `compile()` calls, and which an external
   * driver must call itself.
   *
   * Defaulted rather than optional: it is read unconditionally by the source-map builder, and
   * `isImportedSymbol` compares against it on every identifier. An `undefined` here does not fail --
   * it makes the inliner quietly decide that NOTHING is imported, which is exactly how `(import
   * "std/math")` came to type-check clean and then die at run time inside the REPL.
   */
  private rootSource: string = "bundle.lisp";
  private typesMetadata: Record<string, any> = {};
  private overloadCounter = 0;
  private operatorRegistrations: ESTree.Statement[] = [];
  /**
   * `f.__ll_name = "my-kebab-fn";` for every top-level function whose JS binding name is not its
   * source name -- because it was encoded (D21's kebab-case -> `my2dkebab2dfn`) or because the import
   * inliner renamed it (`__ll_inlined__double_1`).
   *
   * The display formatter printed `Function.name`, i.e. the JS binding, so `(console.log my-kebab-fn)`
   * answered `#<fn my2dkebab2dfn>` against C's `#<fn my-kebab-fn>`, and an imported function answered
   * with a mangler symbol that appears nowhere in the user's source. That is the same class of bug
   * `display_imported_class_tag/` was written to forbid for CLASSES, in the sibling arm of the same
   * switch -- classes had `__ll_name` and functions had no name channel at all.
   *
   * Collected as binding -> source name and emitted at the FRONT of the program body, but ONLY for
   * bindings that provably exist there: a top-level FunctionDeclaration (which hoists) or an inlined
   * definition. A nested `fn` inside top-level control flow, and a `defmodifier`-wrapped function
   * (which becomes a non-hoisting `const`), are both skipped -- stamping those raised
   * "ReferenceError: Cannot access '_double' before initialization" and a plain undefined-identifier
   * throw before the program ran a line. Emitting beside each declaration instead would mean changing
   * the declaration FORM of every function in the language.
   */
  private functionSourceNames = new Map<string, string>();
  /**
   * Is this source name one the READER would lex as an identifier? The same rule the display
   * formatter applies to map keys (the tokenizer's Identifier pattern).
   *
   * Operators are the reason it exists. An imported `+` is claimed in `inlinedDefinitions` under
   * `__ll_inlined__2b_1` but that binding is never EMITTED -- the operator becomes an
   * `__ll_overload_*` function plus a registry call -- so stamping it produced a reference to a
   * name that does not exist. `#<fn +>` would not have been a useful rendering anyway: an operator
   * is dispatched through `__ll_op_registry`, not displayed as a function value.
   */
  private static isDisplayableName(n: string): boolean {
    return /^[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\-\u0080-\uFFFF]*$/.test(n);
  }


  private modifierDefinitions: Map<string, ast.ModifierDefNode> = new Map();

  // ===========================================================================================
  // THE EXTERNAL-DRIVER SEAM.
  //
  // The REPL drives this visitor from outside: it walks the program's top-level forms itself, so it
  // can emit only the NEW cell while still visiting the history (which is what registers the symbols
  // the new cell depends on). It therefore never calls `compile()` or `visitProgram()` -- and those
  // are what normally set up and drain this visitor's state.
  //
  // Before this seam existed, that cost four `as any` casts into private fields (see
  // docs/inbox/compiler-notes-from-repl.md #9) -- AND A REAL BUG THAT NOTHING CAUGHT:
  //
  //     `rootSource` is set on the first line of compile(). The REPL does not call compile(). So
  //     `isImportedSymbol` -- which is `resolved.value._location.source !== this.rootSource` -- bailed
  //     out on every symbol, nothing was ever INLINED, and `(import "std/math")` type-checked CLEAN
  //     and then died at run time with `sqr is not defined`. An import in the REPL simply did not
  //     work, and the type checker was happy about it.
  //
  // A second entry point is a design choice, not an accident: an embedder that wants per-form control
  // needs one, and the alternative is that it reaches into private state and silently misses a step.
  // ===========================================================================================

  /**
   * Begin a program WITHOUT emitting one. For an external driver that visits the forms itself.
   *
   * `compile()` = `beginProgram()` + visit + drain. An embedder that wants to interleave -- to visit
   * history but emit only the tail -- calls these three in its own order.
   */
  public beginProgram(root: ast.ASTNode): void {
    this.rootSource =
      root && root._location && root._location.source ? root._location.source : "bundle.lisp";
  }

  /** The definitions the inliner pulled in from imported modules, in topological order. */
  public getInlinedDefinitions(): ESTree.Statement[] {
    return Object.values(this.inlinedDefinitions);
  }

  /** `__ll_op_registry.register(...)` calls for every imported operator overload. */
  public getOperatorRegistrations(): ESTree.Statement[] {
    return this.operatorRegistrations;
  }

  /** The runtime symbols this program actually reached for -- what the shim must contain. */
  public getInlineStandardSymbols(): string[] {
    return this.inlineStandardSymbols;
  }

  getTypesMetadata(): Record<string, any> {
    return this.typesMetadata;
  }

  constructor(context: Context) {
    super(context);
    this.collectTypesMetadata();
  }

  // =========================================================================

  // =========================================================================
  // Types Metadata Collection
  // =========================================================================

  private collectTypesMetadata(): void {
    // Extract type information from symbol table and compile to metadata
    const symbolTable = this.context.symbolTable;
    if (!symbolTable) {
      return;
    }

    // Get all symbols by resolving known names or traversing cache
    // For now, we'll collect types as we process declarations
    // This will be populated as classes, functions, and variables are visited
  }

  /**
   * Fill the types-metadata table from the symbol table. `compile()` calls this for you; an external
   * driver (the REPL) has to call it itself. Public for that reason -- see the external-driver seam.
   */
  /**
   * Fill the types-metadata table. The BUILDER now lives in `compiler/reflection/metadata.ts` so the
   * C backend emits the same graph from the same source -- D54 rules that the accessor SHAPE is the
   * spec, not per-backend, and two builders would have been two shapes waiting to drift.
   */
  public populateTypesMetadata(): void {
    this.typesMetadata = buildTypesMetadata(this.context);
    this.context.log(LogLevel.Debug, `Loaded ${Object.keys(this.typesMetadata).length} pre-computed type entries`);
  }


  
  /**
   * How a type is written in `__ll_type_metadata` -- the ONE renderer, for every kind (Zjc).
   *
   * There were two. The class/struct path read `.name || 'Any'`; the function path called
   * `formatType`. An array type's `.name` is the bare string "Array" -- it drops the element type --
   * so a class method returning `Int[]` reported "Array" while the identical free function reported
   * "Int[]". One type, two renderings, chosen by which KIND of thing you happened to ask about.
   *
   * `formatType` is the survivor because it is the one that was right, but it is a DIAGNOSTIC
   * formatter and this is not a diagnostic. It renders a struct as `struct vec2` -- which reads well
   * in "cannot assign X to struct vec2" and is not a NAME: feed it back to `type-by-name` and it finds
   * nothing. Here a type must round-trip. Annotations reach us as `type-ref`, which formatType already
   * renders as the bare `refName`, so the struct arm fires only on an INFERRED type -- measured:
   * 09_operators' `Complex` params, a defstruct, already render "Complex" through the function path.
   * The unwrap below makes that structural rather than lucky.
   */



  
  /**
   * The name `__ll_is_type` should be asked for this type -- or UNDEFINED, when the runtime cannot
   * answer the question at all.
   *
   * IT USED TO RETURN 'Any' RATHER THAN ADMIT DEFEAT, and `__ll_is_type` had `case 'any': return
   * true`. So a type this helper could not name -- a union, a tuple, a map, an intersection -- emitted
   * `__ll_is_type(v, "Any")` and matched EVERY value in the language, including the `null` and
   * `undefined` its nominal branch explicitly rejects:
   *
   *     (d :of Int | String)  ->  TRUE, for a Dog
   *
   * It failed OPEN, in three positions: both `:of` sites and operator registration, where
   * `[a <- Int | String]` registered the param as "Any" and the overload matched every argument.
   * Za's narrowing then believed it and bound a Dog as `Int | String`.
   *
   * Undefined means REFUSE (LL0104). The precedent is in-tree and explicit -- `functional-pattern`
   * (DECISIONS.md): "a closure does not carry its parameter types at run time, so there is nothing to
   * test against." Where the runtime carries no evidence, leave it dead and SAY SO.
   *
   * ERASING ARGUMENTS IS NOT THE LIE. `Iterable<Int>` -> "Iterable" is deliberate and load-bearing
   * (Ea's `:extension` dispatch on a generic protocol needs it), and `Int[]` -> "Array" is the same
   * bargain: array-ness is answerable, the element type is not. Inventing a name for a type that HAS
   * none is what this stops doing.
   *
   * Implementation single-sourced onto hir/extensionResolution.ts (`getTypeName`) -- the dispatch
   * classifier reads the same names, so `:of` tests and extension resolution cannot diverge.
   */
  private getTypeName(t: any): string | undefined {
    return resolveTypeName(t);
  }



  // =========================================================================
  // Scope Helpers
  // =========================================================================

  private pushScope(nextScope: ScopeType) {
    this.scope.unshift(nextScope);
  }

  private popScope() {
    return this.scope.shift();
  }

  private currentScope(): ScopeType {
    return this.scope.at(0)!;
  }

  private inScope(...scopes: ScopeType[]) {
    return scopes.includes(this.currentScope());
  }

  /**
   * Visit a node that is being placed into an EXPRESSION slot, and guarantee an expression back.
   *
   * This replaces `isExpressionContext()`, which asked *"is there a `variable` or `match` scope
   * anywhere above me on the stack"* -- a POSITIONAL property answered by an AMBIENT-STATE query. It
   * is the same disease Phase F cured in the call decision (`this.functions`, a source-order list),
   * and it had the same symptom: **the identical node compiled two different ways depending on what
   * enclosed it.** `(let x (if true 1 2))` printed 1; `(console.log (if true 1 2))` emitted
   * `console.log(if (true) {` -- not JavaScript at all.
   *
   * The fix is not a better query. A visitor CANNOT know its own position -- that is the whole bug.
   * So each construct emits ONE canonical form, and the CONSUMER -- who is building the ESTree node
   * and therefore knows the slot it is filling is an expression -- coerces. `asExpression` is
   * idempotent, so this is safe to funnel every expression slot through, and it is: all 69 of them.
   */
  private visitExpr(node: ast.ASTNode): ESTree.Expression {
    return this.asExpression(this.visit(node), node);
  }

  private runInScope<T>(scope: ScopeType, action: () => T): T {
    this.pushScope(scope);
    try {
      return action();
    } finally {
      this.popScope();
    }
  }

  // =========================================================================
  // Core Compilation
  // =========================================================================

  public compile(root: ast.ASTNode) {
    // Through the same seam the REPL uses. Two ways to set up this visitor is one way for them to
    // drift, and the drift is invisible: the REPL simply never inlined an import.
    this.beginProgram(root);
    const program = this.visit(root) as ESTree.Program;

    // Load pre-computed types metadata from symbol table
    this.populateTypesMetadata();

    this.context.log(LogLevel.Debug, `Loaded ${Object.keys(this.typesMetadata).length} pre-computed type entries`);

    // Generate runtime shim if needed (we'll prepend it as string later)
    const includeShim = this.context.options.includeRuntimeShim;
    const runtimeShim = includeShim 
      ? RuntimeProvider.getRuntimeShimForSymbols(
          this.inlineStandardSymbols,
          this.typesMetadata
        )
      : '';

    // Add header comment
    const headerBody: ESTree.Statement[] = [
      {
        type: "ExpressionStatement",
        expression: {
          type: "Literal",
          value: "use strict",
        },
        directive: "use strict",
      } as ESTree.Directive,
    ];

    const header: ESTree.Program = {
      type: "Program",
      sourceType: "script",
      body: headerBody,
    };

    // Prepend inlined definitions
    const inlinedDefs = (Object.values(this.inlinedDefinitions) as unknown) as ESTree.Statement[];

    let finalBody: (ESTree.Statement | ESTree.ModuleDeclaration)[];

    if (this.context.options.noIIFE) {
      // Just put statements at top level
      finalBody = [...header.body as any, ...inlinedDefs, ...program.body];
    } else {
      // Wrap everything in IIFE
      const wrappedBody: ESTree.ExpressionStatement = {
        type: "ExpressionStatement",
        expression: {
          type: "CallExpression",
          callee: {
            type: "FunctionExpression",
            id: null,
            params: [],
            body: {
              type: "BlockStatement",
              // @ts-expect-error
              body: [...inlinedDefs, ...program.body],
            },
            generator: false,
            async: false,
          },
          arguments: [],
          optional: false,
        },
      };
      finalBody = [...header.body as any, wrappedBody];
    }

    const finalProgram: ESTree.Program = {
      type: "Program",
      sourceType: "script",
      body: finalBody,
    };

    // Create source map generator
    // Note: The 'file' property is the generated file name, not the source
    const sourceMap = new SourceMapGenerator({ 
      file: path.basename(this.rootSource, path.extname(this.rootSource)) + '.js'
    });

    // Read and set the original source file content for source map
    try {
      const fs = require('fs');
      if (fs.existsSync(this.rootSource)) {
        const sourceContent = fs.readFileSync(this.rootSource, 'utf-8');
        sourceMap.setSourceContent(this.rootSource, sourceContent);
      }
    } catch (err) {
      // Source file not available, continue without source content
      this.context.log(LogLevel.Debug, `Could not read source file ${this.rootSource} for source map: ${err}`);
    }

    // Generate code with astring - it will automatically populate the source map
    // based on the .loc properties in our ESTree nodes
    const generatedCode = generate(finalProgram, {
      comments: true,
      indent: "  ",
      sourceMap: sourceMap,  // astring will add mappings automatically
    });
    
    // WORKAROUND: astring uses the 'file' property as the source instead of .loc.source
    // We need to manually fix the sources array to use relative paths (just the filename)
    const mapObj = JSON.parse(sourceMap.toString());
    if (mapObj.sources && mapObj.sources.length > 0 && this.rootSource) {
      // Replace .js extensions with just the .lisp filename (no path)
      const rootSource = this.rootSource; // Capture for closure
      mapObj.sources = mapObj.sources.map((src: string) => {
        // If the source is just a basename with .js, replace it with the .lisp filename
        const expectedJsName = path.basename(rootSource, path.extname(rootSource)) + '.js';
        if (src === expectedJsName) {
          return path.basename(rootSource);  // Just the filename, e.g., "modifiers_demo.lisp"
        }
        return src;
      });
    }
    
    // Recreate the source map with fixed sources
    const fixedSourceMap = new SourceMapGenerator({ file: mapObj.file || 'output.js' });
    if (mapObj.sources && mapObj.sourcesContent) {
      mapObj.sources.forEach((src: string, i: number) => {
        const content = mapObj.sourcesContent[i];
        if (content !== undefined) {
          fixedSourceMap.setSourceContent(src, content);
        }
      });
    }
    
    // Copy mappings - we need to parse and recreate them with the correct source
    // For now, let's just update the JSON and stringify it back
    const correctedMapStr = JSON.stringify(mapObj);

    // Calculate runtime shim offset
    const shimLines = (includeShim && runtimeShim) ? runtimeShim.split('\n').length : 0;
    
    let finalCode = generatedCode;
    let finalMap = correctedMapStr;
    
    // If we have a runtime shim, we need to adjust the source map line numbers
    if (shimLines > 0) {
      // Parse the source map
      const mapObj = JSON.parse(finalMap);
      
      // Adjust the mappings by offsetting line numbers
      // The mappings string is VLQ encoded, but we can reconstruct it
      const { SourceMapGenerator } = require('source-map');
      const adjustedGenerator = new SourceMapGenerator({
        file: mapObj.file
      });
      
      // Copy source content
      if (mapObj.sources && mapObj.sourcesContent) {
        mapObj.sources.forEach((source: string, i: number) => {
          adjustedGenerator.setSourceContent(source, mapObj.sourcesContent[i]);
        });
      }
      
      // Manually decode and re-encode mappings with offset
      // Simple approach: decode mappings using a basic VLQ parser
      const base64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      const mappingLines = mapObj.mappings.split(';');
      
      const newMappings: string[] = [];
      
      // Add empty lines for the shim
      for (let i = 0; i < shimLines; i++) {
        newMappings.push('');
      }
      
      // Copy existing mappings
      newMappings.push(...mappingLines);
      
      // Reconstruct the map with adjusted mappings
      const newMapObj = {
        ...mapObj,
        mappings: newMappings.join(';')
      };
      
      finalMap = JSON.stringify(newMapObj);
      finalCode = (runtimeShim + '\n' + generatedCode);
    } else if (includeShim && runtimeShim) {
      finalCode = runtimeShim + '\n' + generatedCode;
    }

    // Add source map URL comment
    finalCode += `\n\n//# sourceMappingURL=${path.basename(this.rootSource, path.extname(this.rootSource))}.js.map`;

    // Parse what we are about to hand back. This is the last point at which code leaves the
    // compiler, so it is the only place a "never emit unparseable JS" invariant can be enforced.
    // Checks finalCode, not generatedCode: the runtime shim is prepended by then, so this is
    // exactly the text that gets written to disk and run.
    this.validateEmittedJs(finalCode, root);

    return {
      code: finalCode,
      map: finalMap
    };
  }

  /**
   * Force every IMPORTED operator overload into the output.
   *
   * The import system inlines a symbol ON DEMAND -- when something references it by name. An operator
   * overload is NEVER referenced by name: `(+ a b)` means the runtime shim, and the shim finds the
   * overload by DISPATCH, through the registry. So an imported operator has nothing to trigger its
   * inlining, and simply does not exist in the output.
   *
   * That was invisible until the operator guard landed. Before it, `+` at the call site resolved to the
   * imported symbol and dragged the definition in -- while also compiling the operator into a call to
   * itself, and suppressing the `+` shim entirely. The definition was present and the program was
   * wrong. Now the program is right and the definition has to be fetched deliberately.
   */
  private inlineImportedOperators(): void {
    const all = (this.context?.symbolTable as any)?.getAllSymbols?.();
    if (!all) return;

    for (const symbol of all.values()) {
      if (symbol?.nodeType !== "function") continue;
      if (!this.isImportedSymbol(symbol)) continue;

      const modifiers = (symbol.value as ast.FunctionNode)?.modifiers ?? [];
      const isOperator = modifiers.some(
        (m: any) => m.modifier === "operator" || m.modifier === ":operator"
      );
      if (isOperator) this.ensureSymbolInlined(symbol);
    }
  }

  visitProgram(node: ast.ProgramNode): ESTree.Program {
    const statements: ESTree.Statement[] = [];

    this.inlineImportedOperators();

    const hirBody = this.context.hir?.bodyFor(node);
    if (hirBody) {
      // HIR PATH. Top-level value-position control flow is lowered like any body; the surrounding
      // operator-registration dance is unchanged (opaque items still `visit` in order, so their
      // registrations accumulate the same way). Taken whenever the lowering stage ran for this module
      // -- the normal JS pipeline always lowers the program node, so this is the live path. The `else`
      // is a fallback for a driver that built a transformer WITHOUT the lowering stage (context.hir
      // unset); visitFunction lowers such bodies on demand, but a BARE top-level control-flow form here
      // would fall to the base visitor. No corpus/REPL/comptime path exercises that today.
      statements.push(...this.emitHir(hirBody));
    } else {
      for (const n of node.program) {
        const result = this.visit(n);
        if (result) {
          if (this.isStatement(result)) {
            statements.push(result as ESTree.Statement);
          } else {
            statements.push(
              ESTreeBuilder.expressionStatement(n, result as ESTree.Expression)
            );
          }
        }
      }
    }

    // The source-name stamps, at the FRONT, and only for bindings that provably exist there: a
    // top-level FunctionDeclaration hoists, and an inlined definition is spliced in ahead of this
    // body. Anything else -- a nested `fn`, a modifier-wrapped `const` -- is skipped rather than
    // stamped into a ReferenceError.
    if (this.functionSourceNames.size > 0) {
      const reachable = new Set<string>(Object.keys(this.inlinedDefinitions));
      for (const st of statements as any[]) {
        if (st && st.type === "FunctionDeclaration" && st.id && st.id.name) reachable.add(st.id.name);
      }
      const stamps: ESTree.Statement[] = [];
      for (const [binding, source] of this.functionSourceNames) {
        if (!reachable.has(binding)) continue;
        stamps.push({
          type: "ExpressionStatement",
          expression: {
            type: "AssignmentExpression",
            operator: "=",
            left: {
              type: "MemberExpression",
              object: { type: "Identifier", name: binding },
              property: { type: "Identifier", name: "__ll_name" },
              computed: false,
              optional: false,
            },
            right: { type: "Literal", value: source },
          },
        } as unknown as ESTree.Statement);
      }
      statements.unshift(...stamps as any);
      this.functionSourceNames.clear();
    }

    // Add operator registrations at the beginning of the program scope
    if (this.operatorRegistrations.length > 0) {
      statements.unshift(...this.operatorRegistrations as any);
      this.operatorRegistrations = []; // Clear
    }

    return {
      type: "Program",
      sourceType: "script",
      body: statements,
    };
  }

  // =========================================================================
  // Classes
  // =========================================================================

  // A4 step 2: the HIR `class` emit no longer routes through here -- it drives `emitClassBody` (members,
  // in scope) + the emitter-assembled shell + `finishClass` (modifier wrap). `visitClass` is now the
  // legacy fallback for a direct `visit(classNode)` and produces the byte-identical declaration.
  visitClass(
    node: ast.ClassNode
  ): ESTree.ClassDeclaration | ESTree.VariableDeclaration {
    // Store the original symbol name (before any encoding) for metadata lookup
    const originalName = node.name.name;
    this.classes.push(originalName);

    const built = this.runInScope(ScopeType.class, () => {
      const classBuilder = new ClassBuilder(node, this.context, this);
      return classBuilder.build();
    });

    return this.applyModifiersToClass(node, built);
  }

  /**
   * `(defclass :traced Base ...)` -> `const Base = __ll_modifier_traced()(class Base { ... })`.
   *
   * D3b makes a `defmodifier` body a RUNTIME DECORATOR applied at the use site, and the fn path has
   * done exactly that all along (`applyModifiersToDeclaration`). A class got nothing: the decorator
   * was emitted and never invoked, silently, at exit 0 (AF-019).
   *
   * The reason that is a bug and not a gap is LL0015. Put an unknown modifier on a class and the
   * compiler answers "Declare it with (defmodifier ...) if it is meant to be a custom modifier" --
   * so the diagnostic's own remedy promises this works. It did not.
   *
   * Same builtin filter as the fn path, and for the same reason recorded there: a builtin modifier
   * is a FACT for the compiler, not a transformer, and wrapping one emits a call to an
   * `__ll_modifier_<name>` that does not exist.
   *
   * The ClassExpression keeps its `id`, so `Base.name` still reads "Base" and the class can still
   * refer to itself from its own body.
   */
  private applyModifiersToClass(
    node: ast.ClassNode,
    declaration: ESTree.ClassDeclaration
  ): ESTree.ClassDeclaration | ESTree.VariableDeclaration {
    const customModifiers =
      node.modifiers?.filter((m) => !isBuiltinModifier(m.modifier)) || [];

    // An unmodified class stays a bare declaration -- no wrap, no hoisting change, no noise.
    if (customModifiers.length === 0) return declaration;

    let init: ESTree.Expression = {
      type: "ClassExpression",
      id: declaration.id,
      superClass: declaration.superClass,
      body: declaration.body,
    } as unknown as ESTree.Expression;

    for (const modifierRef of customModifiers) {
      // `:tagged["A"]` -- the modifier's own arguments, exactly as the fn path passes them.
      const modifierArgs = (modifierRef.args ?? []).map((a) => this.visitExpr(a));
      init = {
        type: "CallExpression",
        callee: {
          type: "CallExpression",
          callee: {
            type: "Identifier",
            name: `__ll_modifier_${modifierRef.modifier}`,
          },
          arguments: modifierArgs,
          optional: false,
        },
        arguments: [init],
        optional: false,
      } as unknown as ESTree.Expression;
    }

    return {
      type: "VariableDeclaration",
      kind: "const",
      declarations: [
        {
          type: "VariableDeclarator",
          id: declaration.id!,
          init,
        },
      ],
      loc: declaration.loc,
    } as ESTree.VariableDeclaration;
  }

  visitStruct(
    node: ast.StructNode
  ): ESTree.ClassDeclaration | ESTree.VariableDeclaration {
    return this.visitClass(node as unknown as ast.ClassNode);
  }

  visitEnum(node: ast.EnumNode): ESTree.VariableDeclaration {
    const enumName = node.name.name;
    const declarations: ESTree.VariableDeclarator[] = [];

    node.body.forEach((keyNode, keyIndex) => {
      const key = `${enumName}:${ast.keyName(keyNode.key)}`;
      const value =
        keyNode.value !== null
          ? (this.visitExpr(keyNode.value))
          : ESTreeBuilder.literal(keyNode, keyIndex);

      // Store the actual value for pattern matching, not the stringified ESTree node
      const enumValue = (value as any).value !== undefined ? (value as any).value : value;
      this.enumKeys[key] = enumValue;

      declarations.push({
        type: "VariableDeclarator",
        id: ESTreeBuilder.identifier(keyNode, encodeIdentifier(key)),
        init: value,
      });
    });

    return {
      type: "VariableDeclaration",
      kind: "const",
      declarations,
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitInterface(node: ast.InterfaceNode): ESTree.EmptyStatement {
    return this.runInScope(ScopeType.interface, () => ({
      type: "EmptyStatement",
      loc: ESTreeBuilder.loc(node),
    }));
  }

  /**
   * Is this type-def an alias for something that EXISTS AT RUNTIME?
   *
   * `(deftype Vector Vector3)` aliases a class, and a class is a value -- `const Vector = Vector3;`
   * is real and useful. `(deftype Number Int | Real)` aliases a TYPE: a union of primitives, which
   * has no runtime existence whatsoever.
   */
  private typeDefTarget(node: ast.TypeDefNode): string | undefined {
    const targetName = (node.type as any)?.type?.name?.name;
    if (typeof targetName !== "string") return undefined;

    const symbol = this.context.symbolTable.resolveSymbol(targetName);
    const isRuntimeValue =
      symbol?.nodeType === "class" || symbol?.nodeType === "struct";

    return isRuntimeValue ? targetName : undefined;
  }

  /**
   * A TYPE IS ERASED. It emits nothing -- unless it aliases a value.
   *
   * This used to emit `const <alias> = <target>;` unconditionally, and when the target was not a
   * plain type NAME -- a union, an array, a generic -- the extraction fell through to the literal
   * string "undefined" and it emitted
   *
   *     const Number = undefined;
   *
   * for `(deftype Number Int | Real)`. That is worse than useless: it SHADOWS the JS global
   * `Number`, and `std/types.lisp` calls `(Number.isInteger x)` seventeen lines further down -- on
   * `undefined`. It also gave the import inliner a Statement to splice into an initializer slot,
   * which is where `const __ll_inlined_Number_1 = const Number = undefined;` came from (LL0101).
   */
  visitTypeDef(node: ast.TypeDefNode): ESTree.Statement {
    const target = this.typeDefTarget(node);

    if (!target) {
      return { type: "EmptyStatement", loc: ESTreeBuilder.loc(node) } as ESTree.EmptyStatement;
    }

    return {
      type: "VariableDeclaration",
      kind: "const",
      declarations: [
        {
          type: "VariableDeclarator",
          id: { type: "Identifier", name: encodeIdentifier(node.name.id) },
          init: { type: "Identifier", name: encodeIdentifier(target) },
        },
      ],
      loc: ESTreeBuilder.loc(node),
    } as ESTree.VariableDeclaration;
  }

  visitExport(node: ast.ExportNode): ESTree.EmptyStatement {
    // Export statements are handled at the module system level and don't generate code
    return {
      type: "EmptyStatement",
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitImport(node: ast.ImportNode): ESTree.EmptyStatement {
    // Import statements are handled during compilation and inlined; they don't generate code
    return {
      type: "EmptyStatement",
      loc: ESTreeBuilder.loc(node),
    };
  }

  // =========================================================================
  // Functions & Variables
  // =========================================================================

  visitFunction(
    node: ast.FunctionNode
  ):
    | ESTree.FunctionDeclaration
    | ESTree.VariableDeclaration
    | ESTree.MethodDefinition
    | ESTree.ArrowFunctionExpression
    | ESTree.EmptyStatement {
    // `:extern` -- DECLARED, never DEFINED (Sd).
    //
    // A declaration is a promise about the HOST. Emitting anything for it is worse than not having
    // `:extern` at all: `(fn :extern createCanvas [w h] -> Void)` would become
    // `function createCanvas(w, h) {}` -- an empty stub that SHADOWS the real p5 global and turns
    // every call into a silent no-op returning undefined.
    //
    // Nothing else is needed. An identifier that resolves to no emitted binding already falls
    // through to a bare JS reference in visitIdentifier, which is the mechanism ambient globals have
    // always relied on. Same shape as visitInterface: a declaration, not a definition.
    if (node.extern) {
      return { type: "EmptyStatement", loc: ESTreeBuilder.loc(node) } as ESTree.EmptyStatement;
    }

    const nextScope = this.inScope(ScopeType.class)
      ? ScopeType.method
      : ScopeType.function;

    return this.runInScope(nextScope, () => {
      // No local-name bookkeeping here any more. Parameters used to be registered into a shadow
      // symbol table (localIdentifiersStack) "BEFORE processing - this prevents them from being
      // resolved to inlined symbols from imports" -- a workaround for a symbol table that could not
      // see nested scopes. visitIdentifier now resolves LEXICALLY, so a parameter (or any local)
      // simply resolves to itself.
      let name = node.name
        ? (this.visit(node.name) as ESTree.Identifier)
        : null;
      let originalName = '';
      if (name && node.name) {
        // Store the original symbol name (before encoding) for metadata lookup
        originalName = typeof node.name === 'object' && 'id' in node.name
          ? (node.name as any).id
          : (typeof node.name === 'object' && 'name' in node.name
              ? (node.name as any).name
              : name.name);
        this.functions.push(originalName);
      }

      const isOperator = node.modifiers?.some(m => m.modifier === 'operator');
      if (isOperator && name) {
        // A FREE operator -- anything that is not a method -- registers with __ll_op_registry.
        //
        // This used to read `this.scope.length === 2 && this.scope[1] === ScopeType.program`, which is
        // not "is this a top-level operator" but "is the VISITOR's scope stack one frame deep RIGHT
        // NOW" -- a property of where the visitor happens to be, not of the node it is looking at. An
        // IMPORTED operator is visited from wherever the call site was (inside a `(let ...)`, so two
        // frames deep), the test failed, and the `:operator` modifier was silently ignored: no
        // registration, no anything. That is the whole of the imported-operator bug.
        //
        // The distinction that actually matters is method-or-not: a method's receiver IS the left
        // operand and it dispatches through `_1`; a free operator takes both operands and dispatches
        // through the registry.
        if (this.currentScope() !== ScopeType.method) {
          const overloadName = `__ll_overload_${name.name}_${this.overloadCounter++}`;
          // An overload is registered BY PARAM NAME and `__ll_op_registry.lookup` resolves it with
          // `__ll_is_type`. So a param the runtime cannot test cannot be dispatched on -- and it used
          // to register as "Any", which `__ll_is_type` answered `true` to, making the overload match
          // EVERY argument. A silent wrong dispatch rather than a failed test (LL0104).
          const paramTypes: string[] = [];
          let dispatchable = true;
          for (const p of node.params) {
            const pt = this.getTypeName(p.type);
            if (pt === undefined) {
              this.report(CD.UntestableType, p, {
                type: this.describeTypeNode(p.type),
                position: `as the type of operator parameter '${(p.name as any)?.id ?? "?"}'`,
              });
              dispatchable = false;
              break;
            }
            paramTypes.push(pt);
          }

          // The overload is still EMITTED -- only its registration is skipped. The diagnostic is an
          // error, so nothing runs; emitting the function anyway keeps this path free of a second
          // control-flow shape for the error case.
          if (dispatchable) this.operatorRegistrations.push({
            type: 'ExpressionStatement',
            expression: {
              type: 'CallExpression',
              callee: {
                type: 'MemberExpression',
                object: { type: 'Identifier', name: '__ll_op_registry' },
                property: { type: 'Identifier', name: 'register' },
                computed: false,
                optional: false
              },
              arguments: [
                { type: 'Literal', value: originalName },
                {
                  type: 'ArrayExpression',
                  elements: paramTypes.map(pt => ({ type: 'Literal', value: pt }))
                },
                { type: 'Identifier', name: overloadName }
              ],
              optional: false
            }
          } as ESTree.Statement);

          name = { ...name, name: overloadName } as ESTree.Identifier;
        } else {
          // A METHOD. The arity suffix is not decoration: 08_operators declares both `- [other]` and
          // `- []`, which without it collide on one JS key. The runtime probes `_1` (binary, receiver +
          // one operand) and `_0` (unary).
          name = { ...name, name: `${name.name}_${node.params.length}` } as ESTree.Identifier;
        }
      }

      const params = node.params.map((x) => this.visit(x) as ESTree.Pattern);

      // Process function body with implicit return
      const bodyStatements: ESTree.Statement[] = [];

      // A struct is passed BY VALUE (D11). One `p = __ll_copy(p)` per parameter, before anything else
      // in the body -- so the function cannot mutate its caller's struct, and cannot observe a later
      // mutation of it either. See parameterCopyPrologue for why this is the callee's job.
      bodyStatements.push(
        ...this.parameterCopyPrologue(params, node.params.map((p) => p.type))
      );

      // NO implicit-return injection here any more. The DESUGARER does it, on the AST, so the type
      // checker sees the `(return e)` and can check it against the declared return type -- which is
      // the entire point: an implicit return used to be enforced by nobody.
      //
      // The BlockStatement splice below stays. It is not the implicit return: it flattens a body
      // written as ONE parenthesized block into the function body, so the two spellings emit the same
      // JavaScript. The desugarer puts the `(return e)` INSIDE that block; this is what unwraps it.
      let hirBody = this.context.hir?.bodyFor(node);
      if (!hirBody) {
        // Any function body the root-module lowering never walked: an IMPORTED/INLINED function, a
        // modifier-internal one, or ANY function reached by the comptime evaluator (which drives a
        // fresh transformer at DESUGAR stage, before the lowering pass runs, so context.hir is unset).
        // Lower it on demand -- a whole body is self-contained (its own statement sink), so this is
        // safe (unlike per-node control-flow delegation). Distinct temp prefix, no collision.
        if (!this.onDemandLower) this.onDemandLower = new LowerAstToHirVisitor(this.context, "__ll_hir_i");
        hirBody = this.onDemandLower.lowerBody(node.body ?? []);
      }
      {
        // HIR PATH -- the only path now. The lowering already resolved implicit-return, value-position
        // control flow, and the dangling-else guard; emit is mechanical (hir-brief.md R6).
        // parameterCopyPrologue above still runs.
        bodyStatements.push(...this.emitHir(hirBody));
      }

      const body = ESTreeBuilder.blockStatement(node, bodyStatements);

      // Determine function form based on scope
      let result: ESTree.FunctionDeclaration | ESTree.VariableDeclaration | ESTree.MethodDefinition | ESTree.ArrowFunctionExpression;

      if (this.currentScope() === ScopeType.method) {
        result = {
          type: "MethodDefinition",
          key: name!,
          value: {
            type: "FunctionExpression",
            id: null,
            params,
            body,
            generator: node.generator,  // `:gen` (D31) -- a generator method `*m() {}`
            async: node.async,
          },
          kind: "method",
          computed: false,
          // `:static` (D11e). This was a hardcoded `false`, and nothing in codegen ever read the
          // modifier -- so `(fn :static twice [...])` was emitted as an INSTANCE method and
          // `(MathUtil.twice 21)` was a TypeError. Reflection agreed with the emission, for the wrong
          // reason: MethodSignature has no isStatic field at all, so `m.isStatic || false` was
          // `undefined || false`. Both halves were wrong together, which is why neither looked wrong.
          static: hasModifier(node.modifiers ?? [], "static"),
          loc: ESTreeBuilder.loc(node),
        } as ESTree.MethodDefinition;
        // `name &&`, and it is not a nicety. The form was chosen from AMBIENT SCOPE alone -- the same
        // disease as `isExpressionContext()` and as Phase F's source-order call list, a third time --
        // so a LAMBDA at top level took this branch and emitted a FunctionDeclaration with `id: null`:
        //
        //     function (x) { return x * 2; }
        //
        // which is not a declaration (it declares nothing) and not an expression either. That is what
        // `((fn [x] (* x 2)) 21)` actually died of, once its head was correctly read as a callee.
        //
        // An ANONYMOUS function is never a declaration. It has no name to declare. That is a fact
        // about the node, not about where the node happens to sit, and it belongs in the test.
        //
        // TOP-LEVEL stays `this.scope[1] === program`, deliberately, even under HIR top-level lowering.
        // A node-based test (climb `_parent` to the program) is WRONG for an INLINED imported function:
        // it is emitted as `const __ll_inlined_x = <arrow>` at the point of use for dependency ordering
        // (ensureSymbolInlined), NOT hoisted as a declaration -- and it is visited at a DEEP scope, so
        // the scope test correctly gives it the arrow. A real top-level function's own function-scope
        // still makes scope[1] === program here, so top-level HIR lowering keeps producing declarations;
        // the only divergence (a named function nested inside top-level control flow) is a discarded
        // definition -- behaviourally inert, and absent from the corpus.
      } else if (name && this.scope[1] === ScopeType.program) {
        let declaration = {
          type: "FunctionDeclaration",
          id: name,
          params,
          body,
          generator: node.generator,  // `:gen` (D31) -- `function* f() {}`
          async: node.async,
          loc: ESTreeBuilder.loc(node),
        } as ESTree.FunctionDeclaration;

        // Apply custom modifiers if present
        result = this.applyModifiersToDeclaration(node, declaration, originalName);

        // The source name, when the JS binding is not it (encoded, or renamed by the inliner).
        //
        // Only when the result is STILL a FunctionDeclaration. `applyModifiersToDeclaration` can turn
        // it into a `const f = <wrapped>`, which does NOT hoist -- and these stamps are emitted at the
        // front of the program body, so stamping one of those raised
        // "ReferenceError: Cannot access '_double' before initialization" before the program ran a
        // single line. A modifier-wrapped function keeps the host name for now.
        if (
          (result as any)?.type === "FunctionDeclaration" &&
          typeof originalName === "string" && originalName && originalName !== name.name &&
          JSTransformerAstVisitor.isDisplayableName(originalName)
        ) {
          this.functionSourceNames.set(name.name, originalName);
        }
      } else {
        // A nested/anonymous function is normally an arrow -- but a generator CANNOT be an arrow
        // (`() => {}` has no `function*` form). A `:gen` here emits a `function*` EXPRESSION instead,
        // which is a legal value and still a closure. `this` differs between an arrow and a function
        // expression, but a generator that needs an enclosing `this` is a method, which took form 1.
        const funcExpr: ESTree.ArrowFunctionExpression | ESTree.FunctionExpression = node.generator
          ? ({
              type: "FunctionExpression",
              id: null,
              params,
              body,
              generator: true,
              async: node.async,
              loc: ESTreeBuilder.loc(node),
            } as ESTree.FunctionExpression)
          : ({
          type: "ArrowFunctionExpression",
          expression: false,
          params,
          body,
          generator: false,
          async: node.async,
          loc: ESTreeBuilder.loc(node),
        } as ESTree.ArrowFunctionExpression);

        if (name) {
          let variableDecl: ESTree.VariableDeclaration = {
            type: "VariableDeclaration",
            kind: "const",
            declarations: [
              {
                type: "VariableDeclarator",
                id: name,
                init: funcExpr,
              },
            ],
            loc: ESTreeBuilder.loc(node),
          };

          // Apply custom modifiers if present
          result = this.applyModifiersToDeclaration(node, variableDecl, originalName);
        } else {
          this.context.log(LogLevel.Debug, this.context.astProvider.getSource(node._location));
          result = funcExpr as any;
        }
      }

      return result;
    });
  }

  private applyModifiersToDeclaration(
    node: ast.FunctionNode, 
    declaration: ESTree.FunctionDeclaration | ESTree.VariableDeclaration, 
    originalName: string
  ): ESTree.FunctionDeclaration | ESTree.VariableDeclaration {
    // A CUSTOM modifier is one declared with `defmodifier` -- something that has a runtime
    // `__ll_modifier_<name>` transformer to apply. A BUILT-IN modifier has no such thing: it is a
    // fact about the declaration, consumed by the compiler.
    //
    // This filter excluded only `operator`, so every other builtin was wrapped as a call to a
    // transformer that does not exist. `(fn :async main [] ...)` emitted
    //
    //     const main = __ll_modifier_async()(...)
    //
    // -> ReferenceError. `async` was already handled properly (visitFunction propagates node.async
    // to all three emission forms); applying it a SECOND time, as if it were user-defined, is what
    // broke. `isBuiltinModifier` has existed in helpers/modifiers.ts all along -- codegen simply
    // never asked it.
    const customModifiers =
      node.modifiers?.filter((m) => !isBuiltinModifier(m.modifier)) || [];

    if (customModifiers.length === 0) {
      return declaration;
    }

    // For each custom modifier, wrap the function
    for (const modifierRef of customModifiers) {
      const modifierName = modifierRef.modifier;

      // `:tagged["A"]` -- the modifier's ARGUMENTS become the arguments of the modifier function:
      // `__ll_modifier_tagged("A")(originalFn)`. Both frontends have always parsed these and handed
      // codegen a `modifier` node carrying `args`; the call site passed `arguments: []` regardless,
      // so every modifier argument in the language was silently discarded.
      const modifierArgs = (modifierRef.args ?? []).map(
        (a) => this.visitExpr(a)
      );
      
      if (declaration.type === "FunctionDeclaration") {
        // Transform function declaration to variable declaration with modifier application
        const funcDecl = declaration as ESTree.FunctionDeclaration;
        declaration = {
          type: "VariableDeclaration",
          kind: "const", 
          declarations: [
            {
              type: "VariableDeclarator",
              id: funcDecl.id!,
              init: {
                type: "CallExpression",
                callee: {
                  type: "CallExpression",
                  callee: {
                    type: "Identifier",
                    name: `__ll_modifier_${modifierName}`
                  },
                  arguments: modifierArgs,
                  optional: false
                },
                arguments: [
                  {
                    type: "FunctionExpression",
                    id: null,
                    params: funcDecl.params,
                    body: funcDecl.body,
                    generator: false,
                    async: funcDecl.async
                  }
                ],
                optional: false
              }
            }
          ],
          loc: declaration.loc
        } as ESTree.VariableDeclaration;
      } else if (declaration.type === "VariableDeclaration") {
        // Wrap the existing initializer with modifier application
        const varDecl = declaration as ESTree.VariableDeclaration;
        const declarator = varDecl.declarations[0] as ESTree.VariableDeclarator;
        
        declarator.init = {
          type: "CallExpression",
          callee: {
            type: "CallExpression", 
            callee: {
              type: "Identifier",
              name: `__ll_modifier_${modifierName}`
            },
            arguments: modifierArgs,
            optional: false
          },
          arguments: [declarator.init as ESTree.Expression],
          optional: false
        };
      }
    }

    return declaration;
  }

  /**
   * A destructuring binding target -> a real ESTree Pattern.
   *
   * JavaScript already has all of this natively, so the mapping is direct and no lowering or
   * temporaries are needed:
   *   [x y]                  -> ArrayPattern  [x, y]
   *   [a ...rest]            -> ArrayPattern  [a, ...rest]
   *   {:name :age}           -> ObjectPattern { name, age }          (shorthand)
   *   {:firstName first}     -> ObjectPattern { firstName: first }   (renamed)
   *   {:user {:name :id}}    -> ObjectPattern { user: { name, id } } (nested)
   */
  private bindingPatternToESTree(target: ast.ASTNode): ESTree.Pattern {
    switch (target._type) {
      case "simple-identifier":
      case "composite-identifier": {
        const raw = (target as any).id ?? (target as any).name;
        return ESTreeBuilder.identifier(target, encodeIdentifier(raw));
      }

      case "identifier-pattern":
        return this.bindingPatternToESTree((target as ast.IdentifierPatternNode).id);

      case "rest-pattern":
        return {
          type: "RestElement",
          argument: this.bindingPatternToESTree((target as ast.RestPatternNode).id),
          loc: ESTreeBuilder.loc(target),
        };

      case "any-pattern":
        // `_` binds nothing -- an elision, i.e. a hole in the ArrayPattern.
        return null as unknown as ESTree.Pattern;

      case "list-pattern":
      case "vector-pattern":
        return {
          type: "ArrayPattern",
          elements: (target as ast.VectorPatternNode).elements.map((e) =>
            this.bindingPatternToESTree(e)
          ),
          loc: ESTreeBuilder.loc(target),
        };

      case "map-pattern":
        return {
          type: "ObjectPattern",
          properties: (target as ast.MapPatternNode).pairs.map((pair) => {
            const keyRaw = (pair.key as any).id ?? (pair.key as any).value;
            const value = this.bindingPatternToESTree(pair.pattern);
            // D13 keeps map keys as written; the KEY is not encoded, only the bound NAME is.
            const key = ESTreeBuilder.identifier(pair.key, keyRaw);
            return {
              type: "Property",
              key,
              value,
              kind: "init",
              method: false,
              computed: false,
              // `{ name }` rather than `{ name: name }` when the binding keeps the key's name.
              shorthand:
                value.type === "Identifier" &&
                (value as ESTree.Identifier).name === encodeIdentifier(keyRaw),
              loc: ESTreeBuilder.loc(pair),
            } as ESTree.AssignmentProperty;
          }),
          loc: ESTreeBuilder.loc(target),
        };

      default:
        this.report(CD.BindingPositionInvalid, target, {
          type: target._type,
        });
        return ESTreeBuilder.identifier(target, "undefined");
    }
  }

  visitVariable(node: ast.VariableNode): ESTree.VariableDeclaration | ESTree.EmptyStatement {
    if (node.extern) {
      return { type: "EmptyStatement", loc: ESTreeBuilder.loc(node) } as ESTree.EmptyStatement;
    }
    const initES = node.value
      ? this.runInScope(ScopeType.variable, () => this.visitExpr(node.value))
      : null;
    return this.emitVarDecl(node, initES);
  }

  /**
   * The `let`/`mut` DECLARATION over an ALREADY-EMITTED initializer -- shared by legacy visitVariable
   * and the HIR emitter (which supplies the init via emitExpr, so a value-position `if` init is a real
   * ternary/temp, not a legacy asExpression ternary). Applies the D11 copy (asValue / asValueEach).
   */
  public emitVarDecl(
    node: ast.VariableNode,
    initES: ESTree.Expression | null
  ): ESTree.VariableDeclaration | ESTree.EmptyStatement {
    // `:extern` -- an ambient VALUE. `(let :extern mouseX <- Int)` declares that the host provides
    // `mouseX`; emitting `const mouseX = undefined` would shadow it with the bottom value.
    if (node.extern) {
      return { type: "EmptyStatement", loc: ESTreeBuilder.loc(node) } as ESTree.EmptyStatement;
    }

    const destructuring = ast.isBindingPattern(node.name);
    const id: ESTree.Pattern = destructuring
      ? this.bindingPatternToESTree(node.name as ast.ASTNode)
      : (this.visit(node.name) as ESTree.Identifier);
    // `(mut b a)` COPIES the struct (D11). A DESTRUCTURING binding needs `__ll_copy_each`: `asValue`
    // wraps the CONTAINER, which carries no struct marker, so the bound names would alias its elements.
    const value =
      initES !== null
        ? destructuring
          ? this.asValueEach(initES, node.value)
          : this.asValue(initES, node.value)
        : null;

    if (destructuring) {
      // A destructuring binding introduces N names, not one.
      for (const bound of ast.bindingNames(node.name)) {
        this.variables.push(encodeIdentifier(bound));
      }
    } else {
      // Unchanged path: visit() may resolve/inline the symbol, so take the name it produced.
      this.variables.push((id as ESTree.Identifier).name);
    }

    return {
      type: "VariableDeclaration",
      kind: this.context.options.noIIFE ? "var" : (node.mutable ? "let" : "const"),
      declarations: [
        {
          type: "VariableDeclarator",
          id,
          init: value,
        },
      ],
      loc: ESTreeBuilder.loc(node),
    };
  }

  /**
   * `(defmodifier tagged [tag] (fn [original] (fn [...args] ... )))`
   *
   * A modifier is a FUNCTION OF ITS PARAMETERS THAT RETURNS A DECORATOR:
   *
   *     function __ll_modifier_tagged(tag) {
   *       return original => (...args) => { ...; return original(...args); };
   *     }
   *
   * which is exactly the shape `applyModifiersToDeclaration` already calls --
   * `__ll_modifier_tagged("A")(originalFn)`. The body simply supplies the decorator, instead of
   * codegen inventing one.
   *
   * IT USED TO INVENT ONE. `node.body` and `node.params` were never read, and this emitted the SAME
   * HARDCODED MEMOIZER for every modifier in the language, under a comment that admitted it ("For
   * now, implement a simple memoization transformer"). `(defmodifier identity [])` -- an explicitly
   * do-nothing modifier -- emitted a Map-backed cache. `this.modifierDefinitions` was written and
   * read nowhere.
   *
   * Nobody noticed because every defmodifier in the corpus has an EMPTY body -- the only shape that
   * did not crash the compiler (see the enterScope/exitScope fix) -- and memoizing a pure function
   * is observationally identical to leaving it alone. Four goldens certified the bug:
   * 02_logging_modifier.expect contains no log lines.
   */
  visitModifierDef(node: ast.ModifierDefNode): ESTree.FunctionDeclaration {
    this.modifierDefinitions.set(node.name, node);

    return this.runInScope(ScopeType.function, () => {
      const params = node.params.map((p) => this.visit(p) as ESTree.Pattern);

      let body: ESTree.Statement[];
      if (node.body.length === 0) {
        // An empty body is a PASS-THROUGH -- `original => original` -- not a memoizer.
        body = [
          ESTreeBuilder.returnStatement(node, {
            type: "ArrowFunctionExpression",
            params: [ESTreeBuilder.identifier(node, "original")],
            body: ESTreeBuilder.identifier(node, "original"),
            expression: true,
            async: false,
          } as ESTree.ArrowFunctionExpression),
        ];
      } else {
        // The body's VALUE is the decorator, so its last expression is returned -- the same implicit
        // return every function body in the language has.
        const statements = node.body.map((x) => this.asStatement(this.visit(x), x));
        body = this.withTrailingReturn(statements, node);
      }

      return {
        type: "FunctionDeclaration",
        id: ESTreeBuilder.identifier(node, `__ll_modifier_${node.name}`),
        params,
        body: ESTreeBuilder.blockStatement(node, body),
        generator: false,
        async: false,
        loc: ESTreeBuilder.loc(node),
      } as ESTree.FunctionDeclaration;
    });
  }

  visitParameter(node: ast.ParameterNode): ESTree.Pattern {
    // A destructuring parameter: (fn print-point [[x y]] ...) -> function (_p([x, y])) {}
    if (ast.isBindingPattern(node.name)) {
      const pattern = this.bindingPatternToESTree(node.name as ast.ASTNode);
      return node.spread
        ? ({ type: "RestElement", argument: pattern, loc: ESTreeBuilder.loc(node) } as ESTree.RestElement)
        : pattern;
    }

    // Parameters are declarations, not references to potentially inlined symbols.
    // Directly encode the name to avoid cache pollution from inlined imports.
    const paramName = (node.name as any).id ?? (node.name as any).name;
    const encodedName = encodeIdentifier(paramName);
    const identifier = ESTreeBuilder.identifier(node.name, encodedName);

    // If this is a spread parameter, create a RestElement
    if (node.spread) {
      return {
        type: "RestElement",
        argument: identifier,
        loc: ESTreeBuilder.loc(node),
      };
    }

    return identifier;
  }


  // =========================================================================
  // Control Flow
  // =========================================================================

  /**
   * The last statement of a block becomes its VALUE -- the block's tail is turned into a `return`.
   *
   * Lifted out of visitMatch's local `ensureReturns`, unchanged in behaviour, so `if` and `when` can
   * use it too. Recursive, because the tail may itself be a block.
   */
  private withTrailingReturn(
    statements: ESTree.Statement[],
    node: ast.ASTNode
  ): ESTree.Statement[] {
    if (statements.length === 0) return statements;

    const last = statements[statements.length - 1];
    const rest = statements.slice(0, -1);

    if (last.type === "ExpressionStatement") {
      return [...rest, ESTreeBuilder.returnStatement(node, last.expression)];
    }
    if (last.type === "BlockStatement") {
      return [...rest, ...this.withTrailingReturn(last.body as ESTree.Statement[], node)];
    }

    // A TRY's value is whichever block actually RAN -- the try body, or the catch handler that
    // matched. Both get a trailing return.
    //
    // The FINALIZER deliberately does not, and that asymmetry is load-bearing: JavaScript gives a
    // `return` inside `finally` priority over the try/catch's own return, so converting its tail
    // would silently REWRITE the answer instead of supplying one. `finally` is for effects; it is
    // never the value.
    if (last.type === "TryStatement") {
      const t = last as ESTree.TryStatement;
      return [
        ...rest,
        {
          ...t,
          block: ESTreeBuilder.blockStatement(
            node,
            this.withTrailingReturn(t.block.body as ESTree.Statement[], node)
          ),
          handler: t.handler
            ? {
                ...t.handler,
                body: ESTreeBuilder.blockStatement(
                  node,
                  this.withTrailingReturn(t.handler.body.body as ESTree.Statement[], node)
                ),
              }
            : t.handler,
        } as ESTree.TryStatement,
      ];
    }

    // An IF's value is whichever ARM ran. `asExpression` already turns a BARE `if` into a ternary;
    // this is the case it cannot reach -- an `if` at the TAIL of a multi-statement block. Every
    // `:of`-filtered catch handler is one, because visitTryCatch builds the filters as an if/else
    // chain, so a `try` expression cannot be fixed without this.
    //
    // An arm that throws (the chain's `else throw tmp` tail) converts to nothing and stays a throw,
    // which is exactly right: it has no value to give.
    if (last.type === "IfStatement") {
      const i = last as ESTree.IfStatement;
      return [
        ...rest,
        {
          ...i,
          consequent: this.withTrailingReturnIn(i.consequent, node),
          alternate: i.alternate ? this.withTrailingReturnIn(i.alternate, node) : i.alternate,
        } as ESTree.IfStatement,
      ];
    }

    // A `return`, a loop -- nothing to convert. Leave it; the block's value is undefined.
    return statements;
  }

  /**
   * `withTrailingReturn` for a slot that holds ONE statement (an `if` arm), not a list.
   *
   * The list form FLATTENS a BlockStatement into its converted body, which is right when splicing
   * into an enclosing block and wrong here: `if (c) a; return b;` is not `if (c) { a; return b; }`.
   * So whatever comes back is re-wrapped when it is more than a single statement.
   */
  private withTrailingReturnIn(
    stmt: ESTree.Statement,
    node: ast.ASTNode
  ): ESTree.Statement {
    const converted = this.withTrailingReturn([stmt], node);
    return converted.length === 1
      ? converted[0]
      : ESTreeBuilder.blockStatement(node, converted);
  }

  /**
   * The LEAF COERCER. Under the HIR (D45) every value-position control-flow construct is lowered
   * before it reaches codegen, so the only nodes handed here are already expressions (or a
   * `SpreadElement`, legal in the argument/element slots an expression fills). This just returns
   * them.
   *
   * It used to also FORCE a statement into expression position -- a multi-statement body emits a
   * `BlockStatement`, which cannot stand where JavaScript wants an expression (`cond ? { a(); b(); }
   * : undefined` does not parse), so it wrapped the block in an IIFE whose tail is returned. That
   * branch, and the LL0103 refusal it raised, are gone: control flow is always HIR-lowered, so a
   * statement arriving here is now an internal invariant violation, and the method throws.
   */
  private asExpression(emitted: ESTree.Node, node: ast.ASTNode): ESTree.Expression {
    if (this.isExpression(emitted)) {
      return emitted as ESTree.Expression;
    }

    // A SpreadElement is NOT an `Expression` in ESTree -- its type does not end in "Expression", so
    // `isExpression` says no -- but it is legal in exactly the slots an expression goes in: call
    // arguments and array elements. There is nothing here to coerce. Wrapping it would emit
    // `(() => { ...args })()`, which is not a value but a syntax error, and that is precisely what
    // this did to `(original ...args)` the moment the slots started funnelling through here.
    if (emitted.type === "SpreadElement") {
      return emitted as unknown as ESTree.Expression;
    }

    // Under the HIR, EVERY value-position control-flow construct (an `if`/`when`/`cond`/`match` used as
    // a value, a `||`/`&&` operand, a value-position `try`) is lowered before it reaches here -- to a
    // ternary or a temp assigned in each branch, never an IIFE (D45). So a statement in expression
    // position is now an internal invariant violation, not a user-reachable state: the ternary / IIFE /
    // sequence coercions and the LL0103 refusal this method used to do are retired. `asExpression`
    // stays only as the leaf coercer (the fast-path + SpreadElement pass-through above).
    throw new Error(
      `asExpression: '${emitted.type}' in expression position -- control flow must be HIR-lowered`
    );
  }

  /** Force an emitted node into STATEMENT position. */
  private asStatement(emitted: ESTree.Node, node: ast.ASTNode): ESTree.Statement {
    return this.isStatement(emitted)
      ? (emitted as ESTree.Statement)
      : ESTreeBuilder.expressionStatement(node, emitted as ESTree.Expression);
  }

  private hirEmitter?: EmitHirToEstree;
  private onDemandLower?: LowerAstToHirVisitor;

  /**
   * Emit a lowered HIR body (see hir/). The HIR resolved position/tail/value-conditionals already, so
   * this is a mechanical map; the leaf hooks below are the ONLY judgment left, and they defer to the
   * legacy visitor (an opaque leaf), to `asValue` for a D11 store, and to `nilLiteral` for D9 bottom.
   */
  private ensureHirEmitter(): EmitHirToEstree {
    if (!this.hirEmitter) {
      const legacy: LegacyLeafEmitter = {
        leafExpr: (n) => this.visitExpr(n),
        emitRef: (n) => this.visitExpr(n),
        emitExtCall: (head, fnName) => {
          // The emitter's ext branch takes `callee.object` off the visited member head as the receiver,
          // and `emittedExtensionName` (import-inlining) as the callee. Same two, here as the HIR hook.
          const callee = this.visitExpr(head);
          return { name: this.emittedExtensionName(fnName, head), receiver: (callee as any).object };
        },
        leafStmt: (n) => this.asStatement(this.visit(n) as ESTree.Node, n),
        storeValue: (e, src) => this.asValue(e, src),
        nilLiteral: (src) => this.nilLiteral(src),
        patternTypeTest: (type, operand, src) => {
          const test = this.typeTest(src, type, operand);
          // The untestable-type report lived inside generateCondition; it has to survive the move, and
          // the TYPE node is a better location for it than the arm.
          if (test === undefined) {
            this.report(CD.UntestableType, (type as any) ?? src, {
              type: this.describeTypeNode(type as any),
              position: "in a `:of` match pattern",
            });
          }
          return test;
        },
        enumMemberValue: (member) => this.enumKeys[member],
        emitForEach: (node, collection, bodyStmt, elseFor) =>
          this.assembleForEach(node as ast.ForEachNode, collection, bodyStmt, elseFor),
        emitVarDecl: (node, initES) => this.emitVarDecl(node as ast.VariableNode, initES),
        emitAssign: (node, rhsES) => this.emitAssign(node as ast.SimpleAssignmentNode, rhsES),
        encodeName: (n) => encodeIdentifier(n),
        emitClassBody: (n) => this.emitClassBody(n as ast.ClassNode),
        finishClass: (n, decl) => this.finishClass(n as ast.ClassNode, decl),
        paramCopyPrologue: (params, types) => this.parameterCopyPrologue(params, types),
        reportDefaultBeforeRequired: (src, className, param, plural, required) =>
          this.report(CD.DefaultBeforeRequired, src, { className, param, plural, required }),
        reportRestartsRefused: (src, form) =>
          this.report(CD.RestartsRefused, src, { form }),
      };
      this.hirEmitter = new EmitHirToEstree(legacy);
    }
    return this.hirEmitter;
  }

  private emitHir(block: HBlock): ESTree.Statement[] {
    return this.ensureHirEmitter().emitBlock(block);
  }

  /**
   * A4: a constructor field store `this.<field> = <param>`, emitted through the ONE HIR-emit path (as an
   * HFieldInit) rather than synthesized as raw ESTree in JSClassBuilder. The class is not yet lowered, so
   * JSClassBuilder still BUILDS the node (passing the field node + source param name); this single-sources
   * the store shape and is the first modeled piece of the class definition (A4).
   */
  public buildFieldInit(field: ast.ASTNode, paramName: string, src: ast.ASTNode): ESTree.Statement {
    return this.ensureHirEmitter().emitStatement({ src, type: undefined, kind: "field-init", field, paramName } as any);
  }

  /** A4: the constructor's `super(<param> ...)` call, emitted through the HIR path (an HSuperCall). */
  public buildSuperCall(args: string[], src: ast.ASTNode): ESTree.Statement {
    return this.ensureHirEmitter().emitStatement({ src, type: undefined, kind: "super-call", args } as any);
  }

  /** A4: a constructor's `this.<method>()` call to a `:ctor` initializer method (an HCtorMethodCall). */
  public buildCtorMethodCall(method: ast.ASTNode, src: ast.ASTNode): ESTree.Statement {
    return this.ensureHirEmitter().emitStatement({ src, type: undefined, kind: "ctor-method-call", method } as any);
  }

  /**
   * A4 step 2: the class-body MEMBERS for the HIR `class` emit. Mirrors `visitClass`'s body build exactly
   * -- records the source name (metadata lookup) and builds the members in the class scope -- but returns
   * only the members. The HIR emitter assembles the `ClassDeclaration` shell (id / superClass) around them
   * from the modeled `HClass.name` / `superName`, and `finishClass` applies the modifier wrap. `visitClass`
   * remains the legacy fallback for a direct `visit(classNode)` and produces the identical declaration.
   */
  private emitClassBody(node: ast.ClassNode): (ESTree.MethodDefinition | ESTree.PropertyDefinition)[] {
    this.classes.push(node.name.name);
    return this.runInScope(ScopeType.class, () =>
      new ClassBuilder(node, this.context, this).buildBodyMembers()
    );
  }

  /**
   * A4 step 2: finish the HIR-assembled class shell -- the custom-modifier wrap (`applyModifiersToClass`,
   * which turns a `defmodifier`-decorated class into a `const` binding) and coercion to a statement. The
   * legacy post-pass that stays outside the modeled node; identical to step 1's `asStatement(visitClass)`.
   */
  private finishClass(node: ast.ClassNode, decl: ESTree.ClassDeclaration): ESTree.Statement {
    return this.asStatement(this.applyModifiersToClass(node, decl), node);
  }

  /**
   * A cond-case has no meaning on its own -- it is a (test, body) pair, and only the CHAIN decides
   * what its alternate is. `visitCond` therefore builds the whole chain from `node.cases` directly,
   * and nothing dispatches here any more.
   */
  visitCondCase(node: ast.CondCaseNode): any {
    return this.onUnhandled(node, "visitCondCase");
  }

  visitWhile(node: ast.WhileNode): ESTree.WhileStatement {
    const condition = this.visitExpr(node.condition);
    const body = this.visit(node.then);

    const bodyStmt = this.isStatement(body)
      ? (body as ESTree.Statement)
      : ESTreeBuilder.blockStatement(node.then, [
          ESTreeBuilder.expressionStatement(
            node.then,
            body as ESTree.Expression
          ),
        ]);

    return {
      type: "WhileStatement",
      test: condition,
      body: bodyStmt,
      loc: ESTreeBuilder.loc(node),
    };
  }
  
  visitFor(node: ast.ForNode): ESTree.BlockStatement {
    const containerStatements: ESTree.Statement[] = [];

    if (node.initial) {
      const initResult = this.visit(node.initial);

      if (initResult.type === "BlockStatement") {
        containerStatements.push(...(initResult as ESTree.BlockStatement).body);
      } else {
        containerStatements.push(initResult as ESTree.Statement);
      }
    }

    const test = node.condition
      ? (this.visitExpr(node.condition))
      : null;
      
    const update = node.step
      ? (this.visitExpr(node.step))
      : null;

    const visitedBody = this.visit(node.then);

    const bodyStmt = this.isStatement(visitedBody)
      ? (visitedBody as ESTree.Statement)
      : ESTreeBuilder.blockStatement(node.then, [
          ESTreeBuilder.expressionStatement(
            node.then,
            visitedBody as ESTree.Expression
          ),
        ]);

    const forStmt: ESTree.ForStatement = {
      type: "ForStatement",
      init: null,
      test,
      update,
      body: bodyStmt,
      loc: ESTreeBuilder.loc(node),
    };

    containerStatements.push(forStmt);

    if (node.else) {
      const elseResult = this.visit(node.else);
      containerStatements.push(elseResult as ESTree.Statement);
    }

    return ESTreeBuilder.blockStatement(node, containerStatements);
  }

  visitForEach(node: ast.ForEachNode): ESTree.BlockStatement {
    const collection = this.visitExpr(node.collection);
    const body = this.visit(node.then);
    const bodyStmt = this.isStatement(body)
      ? (body as ESTree.Statement)
      : ESTreeBuilder.blockStatement(node.then, [
          ESTreeBuilder.expressionStatement(node.then, body as ESTree.Expression),
        ]);
    const elseFor =
      node.else !== null ? (this.visit(node.else) as ESTree.Statement) : null;
    return this.assembleForEach(node, collection, bodyStmt, elseFor);
  }

  /**
   * The for-each STRUCTURE (D16 destructuring, D11 per-iteration copy, `__ll_map_copy_each`) over
   * ALREADY-EMITTED collection / body / else. Shared by the legacy `visitForEach` and the HIR emitter
   * (which supplies HIR-emitted pieces, so control flow in the loop body is lowered, not IIFE'd).
   */
  public assembleForEach(
    node: ast.ForEachNode,
    collection: ESTree.Expression,
    bodyStmt: ESTree.Statement,
    elseFor: ESTree.Statement | null
  ): ESTree.BlockStatement {
    // D16: `(for :each [key val] :from settings.entries ...)` destructures the loop variable.
    const variable = (
      ast.isBindingPattern(node.variable)
        ? this.bindingPatternToESTree(node.variable as ast.ASTNode)
        : this.visit(node.variable)
    ) as ESTree.Identifier;

    // The loop variable is declared OUTSIDE the for-of, not in its head, and deliberately so:
    // the `:else` clause runs after the loop and may reference the final value (11_foreach.lisp
    // does exactly that). That means an uninitialised declaration -- fine for a name, but
    // `let [x, y];` is not legal JavaScript: a destructuring declarator requires an initialiser.
    // (The acorn check added in 3a caught this, rather than shipping invalid JS.)
    //
    // So for a destructuring :each, declare the bound NAMES and let the for-of head use the
    // pattern as a plain assignment target -- `let x, y; for ([x, y] of pts)` -- which is valid
    // and keeps the names live for :else.
    const destructuring = ast.isBindingPattern(node.variable);
    const declaredNames = destructuring
      ? ast.bindingNames(node.variable)
      : [(variable as ESTree.Identifier).name];

    const varDeclaration: ESTree.VariableDeclaration = {
      type: "VariableDeclaration",
      kind: "let",
      declarations: declaredNames.map((n) => ({
        type: "VariableDeclarator" as const,
        id: ESTreeBuilder.identifier(
          node.variable as ast.ASTNode,
          destructuring ? encodeIdentifier(n) : n
        ),
        init: null,
      })),
      loc: ESTreeBuilder.loc(node.variable as ast.ASTNode),
    };

    // `for :each` BINDS BY REFERENCE, and a struct must be a copy (D11).
    //
    // This is the site that is easiest to miss entirely, because it is not a let, not an assignment,
    // not an argument and not a literal -- it is a ForOfStatement whose `left` is a bare identifier
    // that the loop re-assigns each iteration. `(for :each p :from ps :then (p.x := 99))` reaches
    // straight through into the array's elements.
    //
    // The copy goes in the BODY, per iteration -- wrapping `right` would copy the ARRAY, which carries
    // no marker and would therefore be a no-op that looks like a fix.
    //
    // A DESTRUCTURING loop variable (`:each [a b]`) cannot use the prologue -- the names are bound
    // through a pattern, not a single identifier there is anything to re-assign. It is handled on the
    // COLLECTION side instead: see the `right` below.
    const perIterationCopy: ESTree.Statement[] = destructuring
      ? []
      : this.parameterCopyPrologue([variable]);

    const loopBody: ESTree.Statement =
      perIterationCopy.length === 0
        ? bodyStmt
        : bodyStmt.type === "BlockStatement"
          ? ({ ...bodyStmt, body: [...perIterationCopy, ...bodyStmt.body] } as ESTree.BlockStatement)
          : ESTreeBuilder.blockStatement(node.then, [...perIterationCopy, bodyStmt]);

    const forOfStmt: ESTree.ForOfStatement = {
      type: "ForOfStatement",
      left: variable,
      // A destructuring loop variable binds each element's MEMBERS, so each element is a container to
      // open -- `__ll_map_copy_each` applies the copy TO each element rather than to the collection.
      // (Copying the collection would copy the ELEMENTS, which are arrays, not structs, and would come
      // back unchanged: another no-op that looks like a fix.)
      right: destructuring
        ? (ESTreeBuilder.callExpression(
            node,
            ESTreeBuilder.identifier(node, "__ll_map_copy_each"),
            [collection]
          ) as ESTree.Expression)
        : collection,
      body: loopBody,
      await: false,
      loc: ESTreeBuilder.loc(node),
    };

    const statements: ESTree.Statement[] = [varDeclaration, forOfStmt];
    if (elseFor) statements.push(elseFor);

    return ESTreeBuilder.blockStatement(node, statements);
  }

  visitTryCatch(node: ast.TryCatchNode): ESTree.TryStatement {
    // 1. Build the Try Block
    // `asStatement`, not a cast. A single-expression body -- `(try (42) ...)` -- visits to an
    // EXPRESSION, and casting it to Statement put a bare `Literal` in the block where every consumer
    // expects an ExpressionStatement. `withTrailingReturn` then correctly declined to convert it, so
    // the try's value vanished (AF-043) and nothing downstream could see why. visitMatch already does
    // this properly; this is the same call.
    const tryBlock = ESTreeBuilder.blockStatement(node.try, [
      this.asStatement(this.visit(node.try), node.try),
    ]);

    // 2. Generate a unique temp variable for the error object
    const catchVar = uniqueIdentifier("tmp_catch_id");
    const catchVarId = ESTreeBuilder.identifier(node, catchVar);

    let catchClause: ESTree.CatchClause | null = null;

    if (node.catch && node.catch.length > 0) {
      
      // --- STEP A: Determine the "Bottom" of the chain (The final 'else') ---
      //
      // A DEFAULT catch is one with no TYPE, not one with no filter OBJECT. `catchFilter` builds
      // `{name, type}` and sets `type: null` when there is no `:of T`, so `catch e` still has a
      // filter -- it carries the NAME to bind. Asking `!x.filter` therefore answered FALSE for every
      // filterless catch in the language, which sent `catch e` down the TYPED path and into
      // `c.filter.type.name` -> null.name -> a raw backend TypeError (AF-007).
      //
      // `isDefaultCatch` is the single answer to that question, shared with the filtered partition
      // below so the two cannot disagree -- the way they did when one read `!x.filter` and the other
      // `!!x.filter` and both were wrong in the same direction. LL0008 asks it too.
      const isDefaultCatch = (x: ast.TryCatchFilter) => !x.filter || !x.filter.type;

      const defaultCatch = node.catch.find(isDefaultCatch);
      let chainTail: ESTree.Statement;

      if (defaultCatch) {
        // If we have a generic catch, that's our final 'else' block
        // Wrap in BlockStatement to be safe if visit returns a single expression
        const visitedBody = this.asStatement(
          this.visit(defaultCatch.body),
          defaultCatch.body
        );
        const defaultBody: ESTree.Statement[] =
          visitedBody.type === "BlockStatement"
            ? ((visitedBody as ESTree.BlockStatement).body as ESTree.Statement[])
            : [visitedBody];

        // BIND THE NAME. `catch e` names the error, and this path never bound it -- it emitted the
        // body alone, so `e` was a free variable. That nothing ever noticed is the tell that this
        // branch had never run: it was unreachable behind the `!x.filter` test above.
        const defaultName = defaultCatch.filter?.name;
        chainTail = ESTreeBuilder.blockStatement(defaultCatch.body, [
          ...(defaultName
            ? [
                {
                  type: "VariableDeclaration",
                  kind: "const",
                  declarations: [
                    {
                      type: "VariableDeclarator",
                      id: this.visit(defaultName) as ESTree.Identifier,
                      init: catchVarId,
                    },
                  ],
                } as unknown as ESTree.Statement,
              ]
            : []),
          ...defaultBody,
        ]);
      } else {
        // If no generic catch, we MUST re-throw the error if no types matched
        chainTail = {
          type: "ThrowStatement",
          argument: catchVarId,
        } as ESTree.ThrowStatement;
      }

      // --- STEP B: Build the chain upwards (Reverse Loop) ---
      // The exact complement of `isDefaultCatch`, so a catch is in one partition or the other and
      // never in both. This used to read `!!x.filter`, which put every `catch e` in BOTH.
      const filteredCatches = node.catch.filter((x) => !isDefaultCatch(x));

      for (let i = filteredCatches.length - 1; i >= 0; i--) {
        const c = filteredCatches[i];
        
        const filterVar = this.visit(c.filter.name) as ESTree.Identifier;
        const filterType = {
          type: "Identifier",
          name: c.filter.type.name,
        } as ESTree.Identifier;

        const visitedCatchBody = this.asStatement(this.visit(c.body), c.body);
        
        // Build the block that runs if this error matches:
        // { const err = tmp_id; ...user_code... }
        const consequentBlock = ESTreeBuilder.blockStatement(c.body, [
          {
            type: "VariableDeclaration",
            kind: "const",
            declarations: [
              {
                type: "VariableDeclarator",
                id: filterVar,
                init: catchVarId,
              },
            ],
          },
          visitedCatchBody,
        ]);

        // Wrap the previous tail in a new IF statement
        chainTail = {
          type: "IfStatement",
          test: {
            type: "BinaryExpression",
            operator: "instanceof",
            left: catchVarId,
            right: filterType,
          },
          consequent: consequentBlock,
          alternate: chainTail, // <--- This links the chain!
        } as ESTree.IfStatement;
      }

      // --- STEP C: Assign the head of the chain to the catch clause ---
      catchClause = {
        type: "CatchClause",
        param: catchVarId,
        body: ESTreeBuilder.blockStatement(node, [chainTail]),
      };
    }

    // 3. Finally Block
    const finallyBlock = node.finally
      ? ESTreeBuilder.blockStatement(node.finally, [
          this.visit(node.finally) as ESTree.Statement,
        ])
      : null;

    return {
      type: "TryStatement",
      block: tryBlock,
      handler: catchClause,
      finalizer: finallyBlock,
      loc: ESTreeBuilder.loc(node),
    };
  }

  // =========================================================================
  // Pattern Matching
  // =========================================================================

  /**
   * `(x :of String)` -> `__ll_is_type(x, "String")` (D41).
   *
   * THE SAME CALL the `type-pattern` arm makes, deliberately: `(x :of T)` and
   * `(match x { _ :of T => ... })` ask one question and must not be able to answer it differently.
   * `getTypeName` is the same helper too.
   */
  /**
   * The runtime test for `value :of typeNode` -- or UNDEFINED when the runtime cannot answer.
   *
   * `getTypeName` answers with a NAME, and a compound type does not have one. That is the whole
   * reason `:of Int | String` used to be a lie: the only shape on offer was a string, so a type that
   * is not a string became `"Any"`. A union is not a name; it is an `||`.
   *
   *     Int | String   ->  __ll_is_type(v,"Int") || __ll_is_type(v,"String")
   *     A & B          ->  __ll_is_type(v,"A")   && __ll_is_type(v,"B")
   *     String?        ->  __ll_is_type(v,"String") || v == null      (D9: T? is T-or-nil)
   *
   * DECIDABILITY COMPOSES: a union is testable exactly when EVERY member is. One untestable member and
   * the whole thing refuses -- testing only the members we happen to like would answer a different
   * question than the one written.
   *
   * `value` is referenced ONCE PER MEMBER, so callers must pass something free of side effects. Both
   * do: the match position tests a temp, and `visitTypeGuard` binds one when it needs to.
   */
  private typeTest(
    at: ast.ASTNode,
    typeNode: any,
    value: ESTree.Expression
  ): ESTree.Expression | undefined {
    const isTypeCall = (name: string): ESTree.Expression =>
      ESTreeBuilder.callExpression(
        at,
        ESTreeBuilder.identifier(at, "__ll_is_type"),
        [value, ESTreeBuilder.literal(at, name)]
      ) as ESTree.Expression;

    const fold = (
      parts: ESTree.Expression[],
      operator: "||" | "&&"
    ): ESTree.Expression =>
      parts.reduce((left, right) => ({
        type: "LogicalExpression",
        operator,
        left,
        right,
        loc: ESTreeBuilder.loc(at),
      })) as unknown as ESTree.Expression;

    // `v == null` -- the ONE loose equality the runtime allows, and for D9's reason: l-lang emits only
    // `null` for nil, but JavaScript hands back `undefined` constantly, and a program cannot ask which
    // one it got. `== null` is exactly "is it either bottom".
    const isNil = (): ESTree.Expression =>
      ({
        type: "BinaryExpression",
        operator: "==",
        left: value,
        right: ESTreeBuilder.literal(at, null),
        loc: ESTreeBuilder.loc(at),
      } as unknown as ESTree.Expression);

    const withOptional = (test: ESTree.Expression, optional: boolean) =>
      optional ? fold([test, isNil()], "||") : test;

    let n = typeNode;
    if (!n) return undefined;

    // The `type` wrapper carries `array`/`optional` for the parenthesised forms -- `(A | B)[]`,
    // `(A | B)?` -- while a plain `String?` carries its own on the inner node. Both positions are
    // read, exactly as convertAstType already does.
    if (n._type === "type") {
      if (n.array === true) return withOptional(isTypeCall("Array"), n.optional === true);
      const inner = this.typeTest(at, n.type, value);
      return inner === undefined ? undefined : withOptional(inner, n.optional === true);
    }

    if (n.array === true) return withOptional(isTypeCall("Array"), n.optional === true);

    if (n._type === "union-type" || n._type === "intersection-type") {
      const parts: ESTree.Expression[] = [];
      for (const member of n.types ?? []) {
        const p = this.typeTest(at, member, value);
        if (p === undefined) return undefined; // decidability composes
        parts.push(p);
      }
      if (parts.length === 0) return undefined;
      return withOptional(
        fold(parts, n._type === "union-type" ? "||" : "&&"),
        n.optional === true
      );
    }

    const name = this.getTypeName(n);
    if (name === undefined) return undefined;
    return withOptional(isTypeCall(name), n.optional === true);
  }

  /**
   * `Int` and `Real` are the same value at run time, so `:of` decides them from the STATIC type (D43).
   *
   * JavaScript has one number and `5.0 === 5`. A primitive cannot carry a tag, BigInt breaks
   * arithmetic/JSON/Math, and boxing unboxes at the first operator -- so there is nothing to buy. The
   * CHECKER, though, knows perfectly well that `(let x <- Real 5.0)` is a Real. D34/Phase E already
   * rules this shape: when the static type is known, lower at compile time.
   *
   * Returns `true`/`false` to fold, or undefined to mean "not my case -- carry on".
   *
   *     x : Int          ->  true          x : Int | String ->  undefined (typeof is exact here)
   *     x : Real         ->  false         x : Int | Real   ->  undefined, and refused by the caller
   *     x : Unknown      ->  undefined (gradual: never report on an Unknown)
   */
  private foldNumericGuard(node: ast.TypeGuardNode): boolean | undefined {
    const target = this.getTypeName(node.type);
    if (target !== "Int" && target !== "Real") return undefined;

    const known: any = this.context.nodeTypes?.get(node.value);
    // An EMPTY channel says nothing, and must not read as "false" -- the same asymmetry
    // `needsValueCopy` documents. Gradual typing means this is often empty, and a value we could not
    // type is not a value we can call wrong.
    if (!known || known.kind !== "primitive") return undefined;
    if (known.name !== "Int" && known.name !== "Real") return undefined;

    return known.name === target;
  }

  /** Does this type mention BOTH Int and Real? Then no test and no static answer exists (D43). */
  private isNumericallyAmbiguous(node: ast.TypeGuardNode): boolean {
    const target = this.getTypeName(node.type);
    if (target !== "Int" && target !== "Real") return false;

    const names = new Set<string>();
    const walk = (t: any): void => {
      if (!t || typeof t !== "object") return;
      if (t.kind === "primitive" && typeof t.name === "string") names.add(t.name);
      for (const sub of t.types ?? t.alternatives ?? []) walk(sub);
    };
    walk(this.context.nodeTypes?.get(node.value));
    return names.has("Int") && names.has("Real");
  }

  visitTypeGuard(node: ast.TypeGuardNode): ESTree.Expression {
    // D43: Int-vs-Real is a STATIC question. Decided here, never handed to __ll_is_type -- where the
    // two are the identical `typeof === 'number'` and always will be.
    const folded = this.foldNumericGuard(node);
    if (folded !== undefined) {
      // The value is still EMITTED, for its side effects: `((bump) :of Int)` must still bump.
      const v = this.visitExpr(node.value);
      const lit = ESTreeBuilder.literal(node, folded) as ESTree.Expression;
      return (v as any).type === "Identifier"
        ? lit
        : (ESTreeBuilder.sequenceExpression(node, [v, lit]) as ESTree.Expression);
    }
    if (this.isNumericallyAmbiguous(node)) {
      this.report(CD.UntestableType, node, {
        type: `'${this.getTypeName(node.type)}' against a value that may be either Int or Real`,
        position: "in a `:of` type guard",
      });
      return ESTreeBuilder.literal(node, false) as ESTree.Expression;
    }

    const value = this.visitExpr(node.value);

    // A compound test names the value once per member, so a value with side effects must be bound
    // first: `((f x) :of Int | String)` would otherwise call `f` twice. An Identifier is free to
    // repeat, which is the overwhelmingly common case and the only one Za's narrowing looks at.
    const needsTemp =
      (value as any).type !== "Identifier" && this.getTypeName(node.type) === undefined;
    const ref: ESTree.Expression = needsTemp
      ? (ESTreeBuilder.identifier(node, uniqueIdentifier("tmp_of_id")) as ESTree.Expression)
      : value;

    const test = this.typeTest(node, node.type, ref);
    if (test === undefined) {
      // The runtime has no test for this type. Refuse rather than emit the "Any" that answered `true`
      // to everything (LL0104).
      this.report(CD.UntestableType, node, {
        type: this.describeTypeNode(node.type),
        position: "in a `:of` type guard",
      });
      return ESTreeBuilder.literal(node, false) as ESTree.Expression;
    }

    if (!needsTemp) return test;

    // `((t) => <test on t>)(value)` -- one evaluation, and the arrow carries no `return`, because the
    // test IS the body (so nothing needs to be hoisted out of it).
    return {
      type: "CallExpression",
      callee: {
        type: "ArrowFunctionExpression",
        params: [ref],
        body: test,
        expression: true,
        async: false,
      },
      arguments: [value],
      optional: false,
      loc: ESTreeBuilder.loc(node),
    } as unknown as ESTree.Expression;
  }

  /**
   * A human name for a type node, for LL0104's message.
   *
   * `getTypeName` answers the RUNTIME's question ("what do I hand __ll_is_type?"); this answers the
   * reader's ("what did I write that it cannot test?"). LL0104 is exactly the case where the first
   * has no answer and the second does -- so a diagnostic that could only say "undefined" would be
   * useless precisely where it is needed.
   *
   * Unwraps the `type` wrapper first: the compound node sits under it, so a bare `_type` read finds
   * "type" every time.
   */
  private describeTypeNode(t: any): string {
    let n = t;
    while (n && n._type === "type" && n.type) n = n.type;
    if (!n) return "this type";

    if (n.array === true) return "an array type";

    switch (n._type) {
      case "union-type": {
        const parts = (n.types ?? []).map((x: any) => this.getTypeName(x) ?? "?");
        return parts.length ? `the union ${parts.join(" | ")}` : "a union type";
      }
      case "intersection-type": {
        const parts = (n.types ?? []).map((x: any) => this.getTypeName(x) ?? "?");
        return parts.length ? `the intersection ${parts.join(" & ")}` : "an intersection type";
      }
      case "tuple-type":
        return "a tuple type";
      case "map-type":
        return "a map/record type";
      default:
        return "this type";
    }
  }


  // =========================================================================
  // Identifiers / Literals
  // =========================================================================

  /**
   * Is this resolved symbol an IMPORT -- i.e. a module-level symbol belonging to another file?
   *
   * "Comes from another file" is not the same question, and using it is a bug. When a library
   * function is cloned into this module, its BODY is visited too, and the locals inside it resolve
   * (correctly) to the library's scopes. Those locals are not imports -- they are ordinary locals
   * in code we happen to be copying -- but a source-only test hoists them to the top level as if
   * they were, producing things like
   *
   *     const __ll_inlined_result_1 = new __ll_inlined_Vector3_1();   // used here...
   *     const __ll_inlined_Vector3_1 = class Vector3 { ... };         // ...declared after -> TDZ
   *
   * Before scope-aware resolution this was hidden: a nested local of another module was simply
   * unresolvable, so it fell through untouched. Now that it resolves, the test has to be precise.
   * A symbol is an import only if it is declared at MODULE scope (a root scope, with no parent).
   */
  /**
   * WHAT KIND OF THING DOES THIS NAME DECLARE? Asked of the symbol table, not of source order.
   *
   * This is the whole of the fix. `(x)` -- a list with a single identifier head -- is ambiguous:
   *
   *     (solve-maze)                 a zero-arg CALL
   *     '"Squares: {(squares)}"`     the VALUE of `squares`, in a string interpolation
   *
   * Codegen used to answer from `this.functions`, a list it fills AS IT VISITS -- so the answer
   * depended on where the form sat in the file. D1's answer is neither "always a call" nor "always a
   * grouping". Measured against the corpus, it is:
   *
   *     `(x)` is a CALL iff `x` names a FUNCTION.
   *
   * Every "grouping" use of `(x)` in the corpus is a variable inside a string interpolation; every
   * other zero-arg `(x)` is a genuine call. The symbol table separates them perfectly, and it does so
   * WHEREVER the declaration sits.
   *
   * Returns undefined for a name the table does not know -- a JS global, an `:extern`, a member of a
   * value we cannot type. The caller keeps its old behaviour there, because inventing an answer from
   * missing information is exactly the habit this replaces.
   */
  private declarationKindOf(head: ast.ASTNode): string | undefined {
    if (head._type !== "simple-identifier" && head._type !== "composite-identifier") return undefined;
    try {
      const resolved: any = this.context?.symbolTable?.resolveSymbol?.(head as any, head);
      return resolved?.nodeType;
    } catch {
      return undefined;
    }
  }

  /** A name that CONSTRUCTS: `(Dog "rex")` is `new Dog("rex")`, wherever `Dog` is declared. */
  private isConstructorName(head: ast.ASTNode): boolean {
    const kind = this.declarationKindOf(head);
    return kind === "class" || kind === "struct";
  }

  /**
   * A name that CALLS -- and D1 is now fully settled.
   *
   * Two ways to be callable, and both are needed:
   *
   *   a `fn` DECLARATION        `(solve-maze)`  -> nodeType is "function"
   *   a variable of FUNCTION TYPE  `(c5)`       -> `(let c5 (constantly 5))`
   *
   * The second was impossible until lambdas had types. A lambda inferred `Unknown`, so a variable
   * holding a function was indistinguishable from a variable holding anything else, and `(c5)`
   * compiled to a bare reference -- it printed the function object instead of calling it. That was the
   * last corner of D1, and `test_stdlib` had to write `(call c5)` to get round it.
   *
   * A variable of any OTHER type still reads as a value, which is what keeps the corpus's string
   * interpolation idiom working: `'"Squares: {(squares)}"` reads `squares`, an array.
   */
  private isFunctionName(head: ast.ASTNode): boolean {
    if (this.declarationKindOf(head) === "function") return true;
    try {
      const resolved: any = this.context?.symbolTable?.resolveSymbol?.(head as any, head);
      return resolved?.inferredType?.kind === "function";
    } catch {
      return false;
    }
  }

  private isImportedSymbol(resolved: any): boolean {
    if (!resolved?.value?._location || !this.rootSource) return false;

    // AN EXTERN IS NEVER INLINED (Sd). There is nothing to inline: the declaration has no definition,
    // and the thing it names belongs to the HOST.
    //
    // Without this, the prelude breaks every program in the language. `console` now RESOLVES -- it is
    // an `:extern` in lib/std/js.lisp -- so it looks like an ordinary imported top-level symbol, and
    // the inliner does what it does: renames it. `(console.log x)` compiles to
    // `__ll_inlined_console_1.log(x)`, a ReferenceError, in all 579 places. Measured: 82 of 96 codegen
    // cases, and 7 of 9 import cases, the moment the prelude was wired in.
    //
    // The correct emission for an extern is the bare name, which is exactly what visitIdentifier
    // already falls through to.
    if (resolved.value.extern) return false;

    // NOR IS A TYPE (Sf). A `deftype` has NO RUNTIME VALUE -- it emits nothing at all -- so inlining it
    // renames a name that was never going to be defined.
    //
    // `std/types` has `(deftype Number Int | Real)` and, in the same file, `(fn is-int [x]
    // (Number.isInteger x))`. Within that file `Number` resolves same-source and is left alone. But the
    // moment `is-int` is INLINED INTO ANOTHER MODULE, the inliner walks its body, resolves `Number` to
    // the deftype, sees a top-level symbol from another file, and emits:
    //
    //     return __ll_copy(__ll_inlined_Number_1.isInteger(x));   // ReferenceError
    //
    // Never seen, because nothing ever imported std/types and RAN it. test_stdlib is the first thing
    // to do so -- which is the entire reason Sf exists.
    //
    // This is the type/value namespace collision (Sd's residual) surfacing in codegen rather than in
    // the checker: `Number` is both an l-lang type and a JS value, and only one of them has a runtime
    // representation.
    if (resolved.value._type === "type-def") return false;

    if (resolved.value._location.source === this.rootSource) return false;
    // A root scope has no parent. Anything deeper is a local of the other module, not its export.
    return resolved.scope !== undefined && resolved.scope.parent === undefined;
  }

  visitIdentifier(node: ast.IdentifierNode): ESTree.Identifier {
    // Resolve LEXICALLY -- as seen from this node, not from a flat table of module roots.
    //
    // This replaces two shims that existed only because the symbol table could not answer that
    // question: `localIdentifiersStack` (a shadow symbol table the code generator maintained, which
    // registered ONLY parameters) and `identifiersCache` (a flat, scopeless, never-cleared
    // name -> jsname map). Between them, a local `let` sharing a name with an imported symbol was
    // rewritten to the IMPORT's inlined JS name -- two different symbols collapsed into one, which
    // miscompiled to `ReferenceError: Cannot access '__ll_inlined_counter_1' before initialization`.
    //
    // Now: if the name resolves to something declared in THIS module (or in an enclosing scope --
    // a parameter, a local), it keeps its own encoded name. Only a symbol that genuinely resolves
    // to ANOTHER module gets inlined.
    // AN OPERATOR IS NOT A NAME, so it must be decided BEFORE the symbol table is consulted.
    //
    // The block below resolves an imported symbol and inlines it, and for a library FUNCTION that
    // precedence is exactly right: an imported `head` should shadow the builtin `head`. But an operator
    // cannot be shadowed, imported or redefined -- only OVERLOADED, via `:operator` -- and the code
    // could not tell the two apart, because SYMBOL_MAP conflates them.
    //
    // So an imported `(fn :operator + [a b])` resolved as an ordinary imported symbol and was INLINED.
    // Then, re-visiting the operator's own body, `(+ a.amount b.amount)` -- adding two Ints -- hit the
    // same memo key and compiled to a call to THE FUNCTION CURRENTLY BEING DEFINED. It crashed. Worse,
    // `+` never reached inlineStandardSymbols, so the `+` SHIM WAS NEVER EMITTED AT ALL.
    //
    // `+` at a call site ALWAYS means the operator. The shim then dispatches: registry -> `_1` method
    // -> raw JS. That is where an overload gets found, and it is the only place it can be.
    if (RuntimeProvider.isOperatorSymbol(node.id)) {
      this.inlineStandardSymbols.push(node.id);
      return ESTreeBuilder.identifier(node, encodeIdentifier(node.id));
    }

    try {
      const resolved = this.context?.symbolTable?.resolveSymbol?.(node as any, node);
      if (resolved && this.isImportedSymbol(resolved)) {
        return ESTreeBuilder.identifier(node, this.ensureSymbolInlined(resolved));
      }
    } catch (e) {
      // Fall through
    }

    const id = encodeIdentifier(node.id);

    if (RuntimeProvider.isRuntimeReference(node.id)) {
      if (node._type === "composite-identifier") {
        let aggregate = node.parts[0];
        for (let i = 1; i < node.parts.length; ++i) {
          this.inlineStandardSymbols.push(aggregate);
          aggregate = `${aggregate}.${node.parts[i]}`;
        }
        this.inlineStandardSymbols.push(aggregate);
      } else {
        this.inlineStandardSymbols.push(node.id);
      }
    }

    return ESTreeBuilder.identifier(node, id);
  }

  visitSimpleIdentifier(node: ast.SimpleIdentifierNode): ESTree.Identifier | ESTree.Literal {
    if (node.id.startsWith(':')) {
        // Treat keywords as string literals (runtime atom behavior)
        // Strip colon for cleaner JS values? Or keep?
        // l-lang usage typically implies :key -> "key" or special symbol
        // For named args, treating as string prevents ReferenceError
        return ESTreeBuilder.literal(node, node.id);
    }
    return this.visitIdentifier(node);
  }

  visitCompositeIdentifier(
    node: ast.CompositeIdentifierNode
  ): ESTree.MemberExpression {
    const parts = node.parts;
    const startPartId = node.headless ? 1 : 0;

    // Resolve the HEAD, exactly as visitIdentifier does for a simple identifier.
    //
    // Nothing did this: every part was just encodeIdentifier'd, so member access on an IMPORTED
    // symbol -- `origin.x` where `origin` comes from another module -- emitted a bare `origin`
    // that was never defined anywhere. `this.foo`, `console.log` and `Math.log` are unaffected:
    // their heads resolve to nothing and keep their encoded names.
    let head = encodeIdentifier(parts[startPartId]);
    try {
      const resolved = this.context?.symbolTable?.resolveSymbol?.(parts[startPartId], node);
      if (resolved && this.isImportedSymbol(resolved)) {
        head = this.ensureSymbolInlined(resolved);
      }
    } catch (e) {
      // Fall through to the encoded name.
    }

    let expr: ESTree.Expression = ESTreeBuilder.identifier(node, head);

    for (let i = startPartId + 1; i < parts.length; i++) {
      expr = ESTreeBuilder.memberExpression(
        node,
        expr,
        ESTreeBuilder.identifier(node, encodeIdentifier(parts[i]))
      );
    }

    return expr as ESTree.MemberExpression;
  }

  visitString(node: ast.StringNode): ESTree.Literal {
    return ESTreeBuilder.literal(node, node.value);
  }

  visitBoolean(node: ast.BooleanNode): ESTree.Literal {
    return ESTreeBuilder.literal(node, node.value);
  }

  visitIntegerNumber(node: ast.IntegerNumberNode): ESTree.Literal {
    return ESTreeBuilder.literal(node, node.value);
  }

  visitFloatNumber(node: ast.FloatNumberNode): ESTree.Literal {
    return ESTreeBuilder.literal(node, node.value);
  }

  visitFormattedString(node: ast.FormattedStringNode): ESTree.TemplateLiteral {
    const quasis: ESTree.TemplateElement[] = [];
    const expressions: ESTree.Expression[] = [];

    let currentString = "";

    for (let i = 0; i < node.value.length; i++) {
      const v = node.value[i];
      if (ast.isStringNode(v)) {
        currentString += v.value;
      } else {
        quasis.push({
          type: "TemplateElement",
          value: { raw: currentString, cooked: currentString },
          tail: false,
        });
        currentString = "";

        const expr = this.visitExpr(v);
        expressions.push(
          ESTreeBuilder.callExpression(
            v,
            ESTreeBuilder.identifier(v, "__ll_format_object"),
            [expr]
          )
        );
      }
    }

    quasis.push({
      type: "TemplateElement",
      value: { raw: currentString, cooked: currentString },
      tail: true,
    });

    return {
      type: "TemplateLiteral",
      quasis,
      expressions,
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitFormatExpression(node: ast.FormatExpressionNode): ESTree.Expression {
    return this.visitExpr(node.expression);
  }

  // =========================================================================
  // Lists
  // =========================================================================

  /**
   * An indexer whose LAST suffix was written `.name` -- `gs[0].hi`, but not `gs[0]` and not
   * `gs["hi"]`. See D1, and IndexerNode.members.
   */

  visitList(node: ast.ListNode): ESTree.Expression | ESTree.Statement {
    // D25, asked ONCE. `classifyList` is the single answer to "what is this list", shared with the
    // type checker and the desugarer -- all three used to decide it independently, from the same proxy
    // (`head._type === "simple-identifier"`) with their own subtly different exceptions.
    //
    // What stays HERE is everything that needs the SYMBOL TABLE, because none of it is the same
    // question: whether a `call` actually calls (D1's zero-arg rule), whether it CONSTRUCTS, and
    // whether `(obj.m)` is a method or a property read. Those are refinements OF a call, not
    // alternatives to it.
    const form = classifyList(node);

    switch (form.kind) {
      case "empty":
        return ESTreeBuilder.literal(node, null);

      case "grouping":
        return this.visit(form.inner);

      case "apply":
        return ESTreeBuilder.callExpression(
          node,
          this.visitExpr(form.lambda),
          form.args.map((a) => this.visitExpr(a))
        );

      case "block":
        return this.emitBlock(node, form.items);
    }

    // A NAMED head: `call`, or a `special` whose name is reserved. Only `return` and `new` are given
    // special treatment down here -- every other reserved name (`this`, `throw`, `await`, ...) reaches
    // codegen as its own node type or falls through the call path, exactly as it always has.
    const nodes = Array.isArray(node.nodes) ? node.nodes : [node.nodes];
    const [head, ...rest] = nodes;

    // D1, for an indexer head. Stated, not guessed: the source said `.hi`, so it is a call.
    if (isDottedMemberIndexer(head)) {
      const callee = this.visitExpr(head);
      const args = rest.map((a) => this.visitExpr(a));
      return ESTreeBuilder.callExpression(node, callee, args);
    }

    // Zi/D43: `(type x)` on a PRIMITIVE, decided at compile time. HERE and not only on the core
    // `CallNode`, because `(type x)` as the user writes it is a LIST -- `classifyList` calls it a
    // `call`, but it never becomes a `CallNode`, so a fold hung off `visitCall` alone never fires.
    {
      const folded = this.foldPrimitiveType(node, head, rest);
      if (folded) return folded;
    }

    {
      const headId = (head as any).id;

      if (head._type === "simple-identifier" && headId === "return") {
        if (rest.length === 0) {
          return ESTreeBuilder.returnStatement(node, null);
        }
        const returnValue = this.runInScope(
          ScopeType.variable,
          () => this.visitExpr(rest[0])
        );
        // `(return this)` hands the RECEIVER out of the function. Without a copy here, the caller
        // would hold the callee's own struct and could mutate it through the back door -- and a
        // returned LOCAL is the corpus's whole construct-mutate-return idiom, which must not hand out
        // an alias either (D11).
        return ESTreeBuilder.returnStatement(node, this.asValue(returnValue, rest[0]));
      }

      // `(yield x)` / `(yield)` -> a JS YieldExpression (D31). `yield` is a SPECIAL_FORM, so without
      // this it fell through to the call path and emitted `_yield(x)` -- a call to a function that does
      // not exist. Only legal inside a `:gen` function; the checker enforces that (Gb). An empty
      // `(yield)` yields nil.
      if (head._type === "simple-identifier" && headId === "yield") {
        return {
          type: "YieldExpression",
          argument: rest.length > 0 ? this.visitExpr(rest[0]) : null,
          delegate: false,
          loc: ESTreeBuilder.loc(node),
        } as ESTree.YieldExpression;
      }

      // Handle (new ClassName args...) -> new ClassName(args...)
      if (head._type === "simple-identifier" && headId === "new") {
        if (rest.length === 0) {
          // `(new)` with no class name. Bottom, for now -- but it is really a malformed form and
          // deserves a diagnostic rather than a value. Surfaced, not absorbed.
          return this.nilLiteral(node);
        }
        const classNameNode = rest[0];
        const constructorArgs = rest.slice(1).map((x) => this.visitExpr(x));
        const callee = this.visitExpr(classNameNode);
        return {
          type: "NewExpression",
          callee,
          arguments: constructorArgs,
          loc: ESTreeBuilder.loc(node),
        } as ESTree.NewExpression;
      }

      // `typeof` / `instanceof` / `in` / `delete` are JS OPERATORS, not functions.
      //
      // `SPECIAL_FORMS` (analysis/listForm.ts) already names all four, so the TYPE CHECKER knows they
      // are not calls -- routing them through call inference would type `(typeof x)` as a call to an
      // unknown function named `typeof`. Codegen never got the same list, so they fell through to the
      // call path below and emitted `_typeof(x)`, `_instanceof(d, Date)`, `_in("a", o)`,
      // `_delete(o.a)` -- compile clean, ReferenceError on the first line that runs (AF-006).
      //
      // The leading underscore is the tell: it is `encodeIdentifier` escaping a JS RESERVED WORD. The
      // emitted name could never have resolved to anything, because `typeof` is not a legal JS
      // identifier -- the compiler emitted a call to a function whose name it had itself just proven
      // cannot exist.
      //
      // Arity-gated: a malformed `(typeof)` falls through to the call path and its existing
      // diagnostic rather than emitting `typeof undefined`.
      if (head._type === "simple-identifier") {
        if ((headId === "typeof" || headId === "delete") && rest.length === 1) {
          return {
            type: "UnaryExpression",
            operator: headId,
            argument: this.visitExpr(rest[0]),
            prefix: true,
            loc: ESTreeBuilder.loc(node),
          } as unknown as ESTree.Expression;
        }
        if ((headId === "instanceof" || headId === "in") && rest.length === 2) {
          return {
            type: "BinaryExpression",
            operator: headId,
            left: this.visitExpr(rest[0]),
            right: this.visitExpr(rest[1]),
            loc: ESTreeBuilder.loc(node),
          } as unknown as ESTree.Expression;
        }
      }

      // `||` and `&&` are SHORT-CIRCUITING, and that is not an optimisation -- it is their meaning.
      //
      // Every other operator routes through a runtime shim so an `:operator` overload can be found:
      // `(+ a b)` -> `_2b(a, b)`, which dispatches registry -> `_1` method -> raw JS. The shims fold
      // with JS's own operator, so the VALUES were always right. But a shim is a CALL, and a call
      // evaluates its arguments before it runs -- so `(|| true (expensive))` ran `expensive`, and
      // every `(|| (== x nil) (x.method))` nil-guard dereferenced the nil it was guarding against.
      //
      // These two are the operators that CANNOT be overloaded, for exactly the reason they must
      // short-circuit: an overload is a function, and a function cannot decline to evaluate its
      // argument. So there is nothing for a shim to dispatch to, and no reason to pay for the call.
      //
      // The head is deliberately NOT visited: visiting it is what registers the shim for emission,
      // and a program whose only `||` is in call position should not carry `_7c7c` at all. Using the
      // operator AS a value (`(map || xs)`) still goes through visitIdentifier and still gets it.
      //
      // Value-identical by construction: `(...args) => args.reduce((a, b) => a || b)` is a LEFT fold,
      // and so is `a || b || c`. Only the evaluation order changes.
      if (
        head._type === "simple-identifier" &&
        (headId === "||" || headId === "&&") &&
        rest.length >= 1
      ) {
        const operator = headId as "||" | "&&";
        // A single operand folds to itself -- `(|| a)` is `a`, which is what the shim's reduce did
        // too. Zero operands fall through to the shim path, preserving whatever it already does.
        return rest
          .map((x) => this.visitExpr(x))
          .reduce(
            (left, right) =>
              ({
                type: "LogicalExpression",
                operator,
                left,
                right,
                loc: ESTreeBuilder.loc(node),
              } as ESTree.LogicalExpression as unknown as ESTree.Expression)
          );
      }

      const callee = this.visitExpr(head);
      let args = rest.map((x) => this.visitExpr(x));
      const calleeStr = this.expressionToString(callee);

      // `(Dog "rex")` constructs. Asked of the symbol table, so a class declared LATER in the file
      // still constructs -- it used to emit a bare reference, which the Known Gap recorded as
      // `(Dog)` -> `__ll_copy(Dog)`: a silent wrong answer.
      if (this.isConstructorName(head)) {
        return {
          type: "NewExpression",
          callee,
          arguments: args,
          loc: ESTreeBuilder.loc(node),
        } as ESTree.NewExpression;
      }

      let memberName = calleeStr;
      let objectName: string | null = null;
      // SOURCE names, for the type lookup below. `calleeStr` is the EMITTED callee, so its parts are
      // ENCODED (`get-area` -> `get2darea`), but `methodSignatures` and `members` are keyed on the
      // SOURCE name. Looking up the encoded name found nothing, so every DASHED method -- `get-area`,
      // `to-string`, `get-info` -- fell to the untyped `__ll_member` fallback while its own definition
      // was emitted as `get2darea() {...}`. The composite-identifier's `id` is the source dotted path.
      let sourceMember = calleeStr;
      let sourceObject: string | null = null;
      if (head._type === "composite-identifier") {
        const parts = calleeStr.split(".");
        memberName = parts[parts.length - 1];
        if (parts.length >= 2) {
          objectName = parts[0];  // For type lookup
        }
        const sourceParts = String((head as any).id ?? calleeStr).split(".");
        sourceMember = sourceParts[sourceParts.length - 1];
        // The receiver name is encoded too: `final-account` -> `final2daccount`, which the symbol table
        // (keyed on source names) cannot resolve, so `receiverType` failed even before the member lookup.
        if (sourceParts.length >= 2) sourceObject = sourceParts[0];
      }

      // CP2/D11: a native STORING mutator puts its argument INTO the array, so a struct argument must be
      // COPIED first -- a struct is a value type, and every other store site (a function frame, a `[s]`
      // literal) already copies; the native `.push`/`.unshift` did not, so a pushed struct kept aliasing
      // the original. `asValue` copies only a struct; a non-struct arg passes through unchanged. After
      // the constructor branch above (which returns), so a construction's args are never touched.
      if (sourceMember === "push" || sourceMember === "unshift") {
        args = args.map((emitted, i) => this.asValue(emitted, rest[i]));
      }

      // D1, answered: `(x)` is a CALL iff `x` names a FUNCTION. From the symbol table, not from a
      // source-order list -- so `(f)` before `(fn f ...)` is a call, exactly as `(f)` after it is.
      //
      // `memberName` is consulted through the old flat list ONLY for the DOTTED case (`(obj.m)`),
      // which is what that fallback was kept for: a bare member name is not a symbol the table can
      // resolve, and the isMethodCall branch below handles it properly.
      //
      // THE GATE MATTERS. Without it the fallback also answered for a SIMPLE identifier, where
      // `memberName` is just the name -- and `this.functions` is a flat list of every function NAME
      // in the program, with no scope in it at all. So `'"{(area)}"` inside `(fn show [area <- Int])`
      // emitted `area()` purely because some class had an `area` method, and the JS parameter then
      // shadowed the function it was trying to call: `TypeError: area is not a function` (AF-045).
      //
      // The scope-aware answer was already sitting on the left of the `||`. It lost, every time, to a
      // list that cannot see scope -- which is the same disease D1/Phase F set out to cure here.
      const isKnownFunction =
        this.isFunctionName(head) ||
        (head._type === "composite-identifier" &&
          this.functions.includes(memberName));

      // D1, and Xe: `(obj.m)` is decided by the TYPE, not by a list of names.
      //
      // `memberKindOn` returns "method", "field", or undefined -- and undefined means the compiler
      // genuinely does not know the receiver's type, which is deferred to `__ll_member` at run time
      // rather than guessed at. There is no name list left anywhere in this file.
      //
      // What this replaces: codegen asked "is it a METHOD", and on `false` consulted a hardcoded list
      // of 30 property names. So two fields of the same class, declared identically, behaved
      // differently -- `(this.breed)` read, `(this.nickname)` CALLED and threw -- because `breed` was
      // on the list and `nickname` was not. The list's own comments admit it: "// Animal/entity
      // properties: breed, species, color, weight". Field names lifted out of the examples and
      // hardcoded into the compiler.
      const memberKind =
        head._type === "composite-identifier" && (sourceObject ?? objectName)
          ? this.memberKindOn((sourceObject ?? objectName)!, sourceMember, head)
          : undefined;

      // Phase E / Ea: `:extension` dispatch. `(x.m a)` lowers to the free call `m(x, a)` when x's type is
      // a nominal user type that lacks a native `m` (memberKind undefined) and an `:extension m` conforms
      // to it. BEFORE the native branches: an extension `m` is itself a known free function, so the
      // `isKnownFunction` branch below would otherwise emit `x.m()`.
      if (
        memberKind === undefined &&
        head._type === "composite-identifier" &&
        callee.type === "MemberExpression" &&
        (sourceObject ?? objectName)
      ) {
        const extFn = this.extensionFor((sourceObject ?? objectName)!, sourceMember, head);
        if (extFn) {
          return ESTreeBuilder.callExpression(node, ESTreeBuilder.identifier(node, extFn), [
            callee.object as ESTree.Expression,
            ...args,
          ]);
        }
      }

      // A FIELD is a read. Full stop -- and it does not matter what it is called.
      if (memberKind === "field" && args.length === 0) {
        return callee;
      }

      if (args.length > 0 || isKnownFunction || memberKind === "method") {
        return ESTreeBuilder.callExpression(node, callee, args);
      }

      // The receiver's type is UNKNOWN -- and there is no longer a guess here.
      //
      // Measured, the receivers that land here are not only the untyped JS surface (`s.toUpperCase`,
      // `err.message`). They are also `v3.x`, `user.age`, `final-account.balance` -- ORDINARY USER
      // FIELDS whose type the checker cannot yet infer (the standing "114 list nodes have no entry in
      // the type channel" gap). So a name list can never be right: it would have to contain `x`, `y`,
      // `balance` and `age`, which is precisely how the old one came to contain them.
      //
      // The answer exists anyway -- at RUN TIME, exactly. `__ll_member` calls a method and reads
      // anything else. Guessing at compile time was never necessary; it was only earlier.
      //
      // This shrinks on its own as inference improves: every receiver the checker learns to type stops
      // reaching here and goes back to a direct `.x` or `.m()`.
      if (head._type === "composite-identifier" && callee.type === "MemberExpression") {
        return ESTreeBuilder.callExpression(
          node,
          ESTreeBuilder.identifier(node, "__ll_member"),
          [
            callee.object as ESTree.Expression,
            ESTreeBuilder.literal(node, memberName),
          ]
        );
      }

      return callee;
    }
  }

  /** D25's implicit block: `( (console.log 1) (console.log 2) )`. The file wrapper, and every body. */
  private emitBlock(
    node: ast.ListNode,
    items: ast.ASTNode[]
  ): ESTree.Expression | ESTree.Statement {
    const registrationsBefore = this.operatorRegistrations.length;
    const statements = items.map((x) => this.asStatement(this.visit(x), x));

    // Capture registrations added in this scope
    if (this.operatorRegistrations.length > registrationsBefore) {
      const newRegs = this.operatorRegistrations.slice(registrationsBefore);
      statements.unshift(...newRegs as any);
      this.operatorRegistrations = this.operatorRegistrations.slice(0, registrationsBefore);
    }

    if (statements.length === 1) return statements[0];

    return ESTreeBuilder.blockStatement(node, statements);
  }

  // =========================================================================
  // Misc
  // =========================================================================

  visitVector(node: ast.VectorNode): ESTree.ArrayExpression {
    return {
      type: "ArrayExpression",
      // A collection SLOT is a new home for a value (D11). `(let xs [a])` stores a COPY of the struct,
      // so a later `(a.x := 99)` cannot be seen through `xs[0]`.
      elements: node.values.map((x) => this.asValue(this.visitExpr(x), x)),
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitMatrix(node: ast.MatrixNode): ESTree.ArrayExpression {
    return {
      type: "ArrayExpression",
      elements: node.rows.map(
        (row) =>
          ({
            type: "ArrayExpression",
            elements: row.map((x) => this.asValue(this.visitExpr(x), x)),
          } as ESTree.ArrayExpression)
      ),
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitMap(node: ast.MapNode): ESTree.ObjectExpression {
    return {
      type: "ObjectExpression",
      properties: node.values.map((x) => this.visit(x) as ESTree.Property),
      loc: ESTreeBuilder.loc(node),
    };
  }

  /**
   * D13: map keys are STRINGS, and are never mangled. `{ :my-key 1 }` emits `{ "my-key": 1 }`.
   *
   * The key used to be emitted as an `Identifier` run through `encodeIdentifier`, so `:my-key`
   * became `{ my2dkey: 1 }` -- and then `m["my-key"]`, `(get m "my-key")` and every external JSON
   * consumer saw `undefined`. A map key is data, not a program symbol; encoding it is a category
   * error, and it is the one thing that makes `get`, `[]` and JSON interop cohere at once.
   *
   * The cost, accepted in the ruling: dot-access cannot reach such a key. Use `m["my-key"]`.
   */
  visitKeyValue(node: ast.KeyValueNode): ESTree.Property {
    const key =
      node.key._type === "simple-identifier"
        ? ESTreeBuilder.literal(node.key, (node.key as ast.SimpleIdentifierNode).id)
        : (this.visitExpr(node.key));

    // The map's VALUE is visited here, not in visitMap -- so this, not visitMap, is where a struct
    // stored under a key gets its copy (D11).
    const value = this.asValue(this.visitExpr(node.value), node.value);

    return {
      type: "Property",
      key,
      value,
      kind: "init",
      method: false,
      shorthand: false,
      computed: false,
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitSimpleAssignment(
    node: ast.SimpleAssignmentNode
  ): ESTree.AssignmentExpression {
    return this.emitAssign(node, this.visitExpr(node.value));
  }

  /**
   * A simple assignment `target = <rhs>` over an ALREADY-EMITTED rhs -- shared by legacy
   * visitSimpleAssignment / the `:=` branch of visitCompoundAssignment and the HIR emitter (which
   * supplies the rhs via emitExpr). Applies the D11 copy; the WRITE target routes through
   * visitAssignmentTarget.
   */
  public emitAssign(
    node: ast.SimpleAssignmentNode | ast.CompoundAssignmentNode,
    rhsES: ESTree.Expression
  ): ESTree.AssignmentExpression {
    return {
      type: "AssignmentExpression",
      operator: "=",
      left: this.visitAssignmentTarget(node.assignable),
      // `(b := a)` COPIES a struct, exactly as `(mut b a)` does.
      right: this.asValue(rhsES, node.value),
      loc: ESTreeBuilder.loc(node),
    };
  }

  /**
   * `(x := v)` and `(x += v)`.
   *
   * `+=` DESUGARS to `x = (+ x v)` rather than emitting the raw JS `x += v`, and the difference is the
   * whole point: raw `+=` never touches the `+` runtime shim, so it never reaches the registry or an
   * `_1` method, and a user OVERLOAD is never found. On a struct that is `object + object` --
   * `"[object Object][object Object]"`, or undefined. `x += y` has always MEANT `x = x + y`; it just
   * did not compile to it.
   *
   * The type checker already models it that way (`visitCompoundAssignment` in InferTypesAstVisitor:
   * "x += y means x = x + y"). Codegen was the half that did not.
   *
   * The target is emitted TWICE, and deliberately through DIFFERENT paths: the READ goes through
   * `visit` (so an indexer routes via `__ll_index` and throws on an absent key, per D9f), the WRITE
   * through `visitAssignmentTarget` (a bare member expression -- a write CREATES). The same node
   * cannot serve both.
   *
   * Caveat, surfaced not absorbed: a target with a side-effecting subexpression -- `xs[f()] += 1` --
   * now evaluates `f()` twice. Avoiding that needs a temporary, which needs statement context, which an
   * assignment in expression position does not have. Nothing in the corpus does it (all four compound
   * assignments there target a plain name or a member path, both idempotent to read).
   */
  visitCompoundAssignment(
    node: ast.CompoundAssignmentNode
  ): ESTree.AssignmentExpression {
    // `:=` is a plain assignment and must NOT be desugared through an operator.
    if (node.operator === ":=") {
      return this.emitAssign(node, this.visitExpr(node.value));
    }

    const op = node.operator.replace(/=$/, "");

    // The shim only lands in the output if the symbol is asked for -- the same list visitIdentifier
    // feeds when it sees a bare `+`.
    this.inlineStandardSymbols.push(op);

    return {
      type: "AssignmentExpression",
      operator: "=",
      left: this.visitAssignmentTarget(node.assignable),
      right: ESTreeBuilder.callExpression(
        node,
        ESTreeBuilder.identifier(node, encodeIdentifier(op)),
        [
          this.visitExpr(node.assignable),
          this.visitExpr(node.value),
        ]
      ) as ESTree.Expression,
      loc: ESTreeBuilder.loc(node),
    };
  }

  /**
   * The left-hand side of an assignment.
   *
   * An indexer READ is checked (D9f) and emits a `__ll_index(...)` CALL -- which cannot be assigned
   * to. A WRITE must stay a bare member expression, and it must stay UNCHECKED: `(m["k"] := 1)` on an
   * absent key CREATES it. That asymmetry is not an oversight, it is the point -- a read asks for
   * something that is already there, a write puts it there. A write that refused to create would make
   * building a map impossible, which is exactly what the memoizers do.
   */
  private visitAssignmentTarget(assignable: ast.ASTNode): ESTree.Pattern {
    if (assignable._type === "indexer") {
      return this.indexerMemberChain(assignable as ast.IndexerNode) as unknown as ESTree.Pattern;
    }
    return this.visit(assignable) as ESTree.Pattern;
  }

  /** The raw `a[b][c]` chain, with no bounds check. Shared by the read and write paths. */
  private indexerMemberChain(node: ast.IndexerNode): ESTree.Expression {
    let expr = this.visitExpr(node.id);
    for (const indices of node.indices) {
      for (const idx of indices) {
        expr = ESTreeBuilder.memberExpression(
          node,
          expr,
          this.visitExpr(idx),
          true
        );
      }
    }
    return expr;
  }

  /**
   * `xs[0]`, `m["host"]`, `xs[0].name` -- a READ, and reads are PARTIAL (D9f).
   *
   * Every suffix goes through `__ll_index`, which throws IndexOutOfRange past the end of an array and
   * KeyError on an absent key. It used to be a bare `a[b]`, so `xs[9999]` handed back `undefined`
   * while the expression was typed `Int` -- a bottom value straight through a type that promises there
   * is none. `T` cannot mean `T` while the commonest expression in the language lies about it.
   *
   * A dot suffix is checked identically, because under D1/P8b `xs[0].name` IS a computed index with a
   * string key -- the same node, the same operation. Checking one and not the other would be
   * incoherent.
   *
   * The total form is `(get c k)`, which answers nil.
   */
  /**
   * The CORE nodes. See `ast.CallNode` / `ast.MemberNode`.
   *
   * Nothing produces these yet -- there is no surface syntax and no parser rule. They exist so a
   * DESUGARED pipeline can say what the sugar meant: "call this EXPRESSION" and "take a member of a
   * COMPUTED value", neither of which `list` or `indexer` can express (a list is a call only when its
   * head is a name; an indexer's base must be a name).
   *
   * They are trivial to emit precisely BECAUSE they are already the shape JavaScript wants. That is
   * the point of a core node: the transform decides, and the backend just writes it down.
   */
  visitCall(node: ast.CallNode): ESTree.Expression {
    // Phase Nc: a computed-receiver `:extension` call -- the 2nd+ hop of a method chain,
    // `((gen.map f).filter g)`. The callee is a `MemberNode` whose object is an EXPRESSION, so the
    // name-keyed dispatch in `visitList` cannot reach it; without this it would emit the raw
    // `map(gen,f).filter(g)` and fail at run time. Ask the per-node type channel for the object's type
    // (the checker published it in Nb) and, if it conforms to an `:extension`, lower to `ext(object, ...)`.
    if (node.callee._type === "member") {
      const ext = this.computedExtensionCall(node);
      if (ext) return ext;
    }

    // Zi/D43: `(type x)` on a PRIMITIVE is decided here, at compile time. Reached from the core
    // `CallNode` and from `visitList`'s named-head path both -- `(type x)` written in source is a
    // LIST, so this arm alone would never fire.
    const folded = this.foldPrimitiveType(node, node.callee, node.arguments);
    if (folded) return folded;

    return ESTreeBuilder.callExpression(
      node,
      this.visitExpr(node.callee),
      node.arguments.map((a) => this.visitExpr(a))
    );
  }

  /**
   * `(type x)` where `x`'s STATIC type is a primitive -- lowered to the metadata lookup directly.
   *
   * D43's consequence, and it is not an optimisation: the runtime CANNOT answer this. `Int` and `Real`
   * are one JS number (`5.0 === 5`), and `Char` and `String` are one JS string -- `"c"` is both. A
   * `typeof` can say "number"; it can never say which of the two l-lang types that is. The checker
   * already knows, so the answer is taken from the checker or it is not taken at all.
   *
   * The shape is D34/Phase E's, and `computedExtensionCall` directly above is the same move: ask the
   * per-node channel, lower when it answers, fall through when it does not. Ze's `foldNumericGuard`
   * does the primitive-kind test identically.
   *
   * Falling through is a CONCESSION, matching Ze exactly: gradual typing means the channel is often
   * empty, and the runtime then answers `{kind:'unknown'}` rather than guess. `Number.isInteger` would
   * be a guess that CONTRADICTS the static type -- two answers to one question, which is the bug class
   * this whole audit exists to kill.
   */
  private foldPrimitiveType(
    node: ast.ASTNode,
    head: ast.ASTNode,
    args: ast.ASTNode[]
  ): ESTree.Expression | undefined {
    if (head._type !== "simple-identifier") return undefined;
    if ((head as ast.IdentifierNode).id !== "type") return undefined;
    if (args.length !== 1) return undefined;

    // A user-defined `type` shadows the builtin, and then this is not our call to fold.
    if (this.context.symbolTable?.resolveSymbol?.("type", node as any)) return undefined;

    const known: any = this.context.nodeTypes?.get(args[0]);
    if (!known || known.kind !== "primitive" || typeof known.name !== "string") return undefined;

    const lookup = ESTreeBuilder.memberExpression(
      node,
      ESTreeBuilder.identifier(node, RuntimeProvider.TYPES_METADATA_VAR),
      ESTreeBuilder.literal(node, known.name) as ESTree.Expression,
      true
    ) as ESTree.Expression;

    // The operand is still EMITTED, for its side effects: `(type (bump))` must still bump. Ze's
    // `visitTypeGuard` carries the same sequence, for the same reason.
    const v = this.visitExpr(args[0]);
    return (v as any).type === "Identifier" || (v as any).type === "Literal"
      ? lookup
      : (ESTreeBuilder.sequenceExpression(node, [v, lookup]) as ESTree.Expression);
  }

  /** The extension call for a `CallNode` whose callee is a computed `MemberNode`, or undefined. */
  private computedExtensionCall(node: ast.CallNode): ESTree.Expression | undefined {
    const member = node.callee as ast.MemberNode;
    if (member.computed) return undefined; // `a[b](...)` is an index, not a member name
    const memberName = this.memberNodeName(member.property);
    if (!memberName) return undefined;
    const objectType = this.context.nodeTypes?.get(member.object);
    if (!objectType) return undefined; // gradual: no type -> fall through to the raw member call
    const extFn = this.extensionForType(objectType, memberName, node);
    if (!extFn) return undefined;
    return ESTreeBuilder.callExpression(node, ESTreeBuilder.identifier(node, extFn), [
      this.visitExpr(member.object),
      ...node.arguments.map((a) => this.visitExpr(a)),
    ]);
  }

  /** The member name from a `MemberNode.property`, stripping any leading `.` a headless member carries. */
  private memberNodeName(property: ast.ASTNode): string | undefined {
    const raw = (property as any)?.id ?? (property as any)?.name;
    if (typeof raw !== "string") return undefined;
    const parts = raw.split(".").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : undefined;
  }

  visitMember(node: ast.MemberNode): ESTree.Expression {
    return ESTreeBuilder.memberExpression(
      node,
      this.visitExpr(node.object),
      this.visitExpr(node.property),
      node.computed
    );
  }

  visitIndexer(node: ast.IndexerNode): ESTree.Expression {
    let expr = this.visitExpr(node.id);

    // Honor the `members` flag (parallel to `indices`, one per suffix group). A bracket `[key]` suffix
    // stays on the CHECKED `__ll_index` (D9f: an out-of-bounds index / absent key is a bug and must
    // throw). A `.member` suffix becomes a PLAIN computed member access -- not `__ll_index`, which
    // rejects a non-integer key on an array/string (so `xs[0].length` threw RangeError, the bug), and
    // NOT `__ll_member`, which AUTO-CALLS a method -- and D1 rules `(gs[0].hi)` a call, so
    // `__ll_member`'s auto-call plus the call-position wrap would double-call and crash. A plain
    // `expr[key]` reads without calling, so bare `xs[0].hi` is the method (D1 read) and `(gs[0].hi)`
    // wraps it into a real call. The only observable change is `xs[0].absentField` now yields nil
    // rather than throwing -- agreeing with `obj.absentField`, not a guarantee lost.
    for (let g = 0; g < node.indices.length; g++) {
      const isMember = node.members?.[g] === true;
      for (const idx of node.indices[g]) {
        expr = isMember
          ? (ESTreeBuilder.memberExpression(node, expr, this.visitExpr(idx), true) as ESTree.Expression)
          : (ESTreeBuilder.callExpression(
              node,
              ESTreeBuilder.identifier(node, "__ll_index"),
              [expr, this.visitExpr(idx)]
            ) as ESTree.Expression);
      }
    }

    return expr;
  }

  visitSpread(node: ast.SpreadNode): ESTree.SpreadElement {
    return {
      type: "SpreadElement",
      argument: this.visitExpr(node.expression),
      loc: ESTreeBuilder.loc(node),
    };
  }

  /**
   * `(await (fetch-data 42))`.
   *
   * The only reachable node type in the language with no emitter -- it reported LL0100 ("the
   * construct parses, but there is no code generator for it") and blocked the whole async example.
   *
   * `async` itself was never missing: visitFunction already propagates `node.async` to all three of
   * its emission forms (method, declaration, arrow). The gap was exactly this one node.
   */
  visitAwait(node: ast.AwaitNode): ESTree.AwaitExpression {
    return {
      type: "AwaitExpression",
      argument: this.visitExpr(node.expression),
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitComment(node: ast.CommentNode): ESTree.SimpleLiteral {
    return { type: "Literal", value: null, raw: `/* ${node.comment} */` };
  }

  /**
   * Quote emits DATA. `'(+ 1 2)` becomes an object you can walk:
   *
   *     { _type: "list", nodes: [ { _type: "simple-identifier", id: "+" }, ... ] }
   *
   * It used to emit `JSON.stringify(node)` -- so `'(+ 1 2)` compiled to the STRING
   * `"{\"_type\":\"quote\",\"nodes\":{...}}"`, and `expr.nodes[0]` was a TypeError, because a string
   * has no `.nodes`. Code-as-data was code-as-TEXT, which is code-as-nothing.
   *
   * The value is the quoted DATUM, not the quote wrapper: the `quote` node is a compile-time marker
   * and has no business surviving into the program's data. `'x` is a symbol; `'(a b)` is a list.
   *
   * `_location` and `_parent` are dropped. `_parent` is cyclic and would not serialise at all; and
   * neither is data ABOUT the program -- they are bookkeeping about the compile.
   *
   * This is code as DATA, not code as CODE: there is no `eval`. Executing a quoted form needs a
   * runtime AST interpreter, which is out of scope (see the open findings).
   */
  visitQuote(node: ast.QuoteNode): ESTree.Expression {
    return this.dataToESTree(node.nodes, node);
  }

  // ===========================================================================================
  // STRUCT VALUE SEMANTICS -- a struct is copied on the way into a new home.
  // ===========================================================================================

  /**
   * Does this expression need a D11 copy on the way into a binding, a parameter, or a collection slot?
   * The deny-list + type-channel logic now lives in the shared `shouldCopyOnStore` predicate (the single
   * source the HIR lowering also reads), so this is a thin delegate.
   */
  private needsValueCopy(node: ast.ASTNode | undefined | null): boolean {
    // Delegates to the SHARED store-copy predicate (A5) -- the single source the HIR lowering also reads
    // (caching it on HVarDecl.copies), so JS and the native backend cannot decide the D11 copy
    // differently. This is where the interface-elides-a-struct-copy divergence was fixed (D48/Q1).
    return shouldCopyOnStore(node, this.context);
  }

  /**
   * Wrap an emitted expression in `__ll_copy(...)`, unless it provably cannot be a struct.
   *
   * Public because JSClassBuilder needs it too -- field initializers are emitted there, and the
   * builder reaches the visitor through an `any` to dodge a circular import.
   */
  public asValue(
    emitted: ESTree.Expression,
    source: ast.ASTNode | undefined | null
  ): ESTree.Expression {
    // A SpreadElement is a SPLICE INSTRUCTION, not a value -- and, as `asExpression` documents at
    // its own SpreadElement case, not an ESTree `Expression` either. Wrapping it copies the wrong
    // thing, and destructively: `__ll_copy(...a)` passes a's elements as ARGUMENTS to a
    // single-parameter helper, so it collapses to `__ll_copy(a[0])` and the spread-ness is gone with
    // it -- the element becomes a plain call. That was AF-002: `[0 ...a]` silently yielded [0, a[0]].
    //
    // What lands in the new slots is the OPERAND'S ELEMENTS, so they are what D11 must copy. This is
    // the identical argument `asValueEach` already makes for destructuring, and it is unconditional
    // for the identical reason: `needsValueCopy` cannot help here, because the container carries no
    // struct marker while its elements may. A plain `[...a]` pass-through would alias them instead.
    if ((emitted as unknown as ESTree.Node)?.type === "SpreadElement") {
      const spread = emitted as unknown as ESTree.SpreadElement;
      return {
        ...spread,
        argument: this.asValueEach(spread.argument as ESTree.Expression, source),
      } as unknown as ESTree.Expression;
    }

    if (!this.needsValueCopy(source)) return emitted;
    return ESTreeBuilder.callExpression(
      (source ?? emitted) as any,
      ESTreeBuilder.identifier((source ?? emitted) as any, "__ll_copy"),
      [emitted]
    ) as ESTree.Expression;
  }

  /**
   * Wrap an emitted expression in `__ll_copy_each(...)` -- the DESTRUCTURING form.
   *
   * `(let [a b] structs)` binds the container's ELEMENTS, so it is the elements that must be copied.
   * `asValue` would wrap the container, which carries no struct marker, and `__ll_copy` would return it
   * unchanged -- a no-op that looks exactly like a fix.
   *
   * Unconditional: `needsValueCopy` cannot help here. A vector literal `[a b]` is on its NEVER_A_STRUCT
   * list (a vector is not a struct) and would be skipped -- but its ELEMENTS may well be structs, which
   * is the entire case.
   */
  private asValueEach(
    emitted: ESTree.Expression,
    source: ast.ASTNode | undefined | null
  ): ESTree.Expression {
    return ESTreeBuilder.callExpression(
      (source ?? emitted) as any,
      ESTreeBuilder.identifier((source ?? emitted) as any, "__ll_copy_each"),
      [emitted]
    ) as ESTree.Expression;
  }

  /**
   * `p = __ll_copy(p);` at the top of a function body, one per parameter -- a struct is passed BY
   * VALUE (D11).
   *
   * COPY-ON-ENTRY, not copy-on-call, and the difference is not cosmetic:
   *
   *   - Copying at the CALL SITE means a `__ll_copy` around every argument in the program. `(let c3
   *     (+ c1 c2))` becomes four of them.
   *   - It is one site per FUNCTION here, instead of N per CALL SITE.
   *   - Decisively: the runtime operator shim routes `(+ c1 c2)` through `c1['+_1'](c2)`. The argument
   *     never passes through a call the code generator can see, so a caller-side wrap CANNOT reach it.
   *     The callee's own prologue can.
   *
   * `this` is deliberately NOT copied. It is the receiver, never a parameter -- and it must not be:
   * construct-mutate-return is the corpus's only way to build a struct (~30 sites across std/math and
   * 09_operators). Copy the receiver and every one of them silently returns an unmutated value.
   */
  public parameterCopyPrologue(
    params: ESTree.Pattern[],
    types?: (ast.TypeNode | undefined)[]
  ): ESTree.Statement[] {
    const prologue: ESTree.Statement[] = [];

    params.forEach((p, i) => {
      // An AssignmentPattern is a defaulted parameter; the name is on its left.
      const target =
        p.type === "Identifier"
          ? p
          : p.type === "AssignmentPattern" && p.left.type === "Identifier"
            ? p.left
            : undefined;
      if (!target) return;

      // A parameter DECLARED a known primitive can never hold a struct, so its copy is provably
      // incapable of doing anything. This is the one place codegen has real type information -- the
      // annotation is right there on the AST -- and using it is what keeps `(let :ctor real <- Real 0)`
      // from emitting `real = __ll_copy(real)` in every constructor in the corpus.
      //
      // An UNANNOTATED parameter is still wrapped. Gradual typing cuts the same way here as everywhere
      // else: not knowing the type is not permission to assume it is not a struct.
      if (!shouldCopyParam(types?.[i], this.context)) return;

      prologue.push({
        type: "ExpressionStatement",
        expression: {
          type: "AssignmentExpression",
          operator: "=",
          left: { type: "Identifier", name: target.name },
          right: {
            type: "CallExpression",
            callee: { type: "Identifier", name: "__ll_copy" },
            arguments: [{ type: "Identifier", name: target.name }],
            optional: false,
          },
        },
      } as ESTree.Statement);
    });

    return prologue;
  }


  /** A plain JS value -> the ESTree expression that reconstructs it. */
  private dataToESTree(value: any, at: ast.ASTNode): ESTree.Expression {
    if (value === null || value === undefined) {
      return ESTreeBuilder.literal(at, null);
    }

    if (Array.isArray(value)) {
      return {
        type: "ArrayExpression",
        elements: value.map((v) => this.dataToESTree(v, at)),
        loc: ESTreeBuilder.loc(at),
      } as ESTree.ArrayExpression;
    }

    if (typeof value === "object") {
      const properties = Object.keys(value)
        .filter((key) => key !== "_location" && key !== "_parent")
        .map((key) => ({
          type: "Property",
          key: ESTreeBuilder.literal(at, key),
          value: this.dataToESTree(value[key], at),
          kind: "init",
          method: false,
          shorthand: false,
          computed: false,
        })) as ESTree.Property[];

      return {
        type: "ObjectExpression",
        properties,
        loc: ESTreeBuilder.loc(at),
      } as ESTree.ObjectExpression;
    }

    // string | number | boolean
    return ESTreeBuilder.literal(at, value);
  }

  visitNull(node: ast.NullNode) {
    // ONE bottom value (D9). There is nothing left to branch on.
    //
    // This used to read: `if (keyword === "undefined") return identifier("undefined")`. That single
    // line WAS the second bottom value -- four spellings emitted `null` and one emitted `undefined`,
    // and __ll_deep_eq told them apart, so `(== (when false 1) nil)` was false.
    return ESTreeBuilder.literal(node, null);
  }

  /**
   * The bottom value, as the CODE GENERATOR emits it when a construct produces no value: an `if` with
   * no else, a `when` whose condition is false, a `cond` that falls through, a function that runs off
   * its end.
   *
   * These sites emitted the JS `undefined` identifier while the `nil` literal emitted `null` -- so the
   * language produced a bottom value it could not itself detect. Every one of them is `nil` now, and
   * they route through here rather than each spelling it out, so there is one place to be wrong.
   */
  private nilLiteral(node: ast.ASTNode): ESTree.Expression {
    return ESTreeBuilder.literal(node, null) as ESTree.Expression;
  }

  // =========================================================================
  // Utilities
  // =========================================================================

  private isStatement(node: ESTree.Node): boolean {
    if (!node || typeof node !== "object") return false;
    const type = node.type;
    return (
      type &&
      (type.endsWith("Statement") ||
        type.endsWith("Declaration") ||
        type === "MethodDefinition")
    );
  }

  private isExpression(node: ESTree.Node): boolean {
    if (!node || typeof node !== "object") return false;
    const type = node.type;
    return (
      type &&
      (type.endsWith("Expression") ||
        type === "Identifier" ||
        type === "Literal" ||
        type === "TemplateLiteral")
    );
  }

  private isReturnStatement(node: ESTree.Node): boolean {
    return node && typeof node === "object" && node.type === "ReturnStatement";
  }

  private isControlStatement(node: ESTree.Node): boolean {
    if (!node || typeof node !== "object") return false;
    const type = node.type;
    return (
      type === "IfStatement" ||
      type === "WhileStatement" ||
      type === "ForStatement" ||
      type === "ForOfStatement" ||
      type === "TryStatement"
    );
  }

  /**
   * Is `obj.m` a METHOD, a FIELD, or does the compiler simply not know? Walks the inheritance chain.
   *
   * Single-sourced onto hir/extensionResolution.ts (`memberKindOn`) -- the SAME decision the dispatch
   * classifier reads, so codegen and the HIR pass cannot diverge on what a member IS. The story of what
   * this replaced (the hardcoded 30-name property list, where `(this.breed)` read but `(this.nickname)`
   * was CALLED and threw) lives on the module function. `undefined` = the receiver's type is genuinely
   * unknown (`arr.length`, `err.message`): JS interop, deferred to `__ll_member` at run time.
   */
  private memberKindOn(objectName: string, memberName: string, from?: ast.ASTNode): "method" | "field" | undefined {
    return resolveMemberKindOn(this.context, objectName, memberName, from);
  }

  /** The receiver's type -- following type-refs, bare class names, and `this`'s enclosing class to the
   *  definition. Single-sourced onto hir/extensionResolution.ts (`receiverType`). */
  private receiverType(objectName: string, from?: ast.ASTNode): any | undefined {
    return resolveReceiverType(this.context, objectName, from);
  }

  private _extensionTable?: Map<string, { fnName: string; receiverType: string }[]>;

  /**
   * Phase E / Ea: the `:extension` registry (name -> candidates with their receiver-type source names),
   * COMPILE-TIME and NOMINAL, built once from the symbol-table forest. Single-sourced onto
   * hir/extensionResolution.ts (`buildExtensionTable`); memoized here (the emitter builds it repeatedly).
   */
  private extensionTable(): Map<string, { fnName: string; receiverType: string }[]> {
    return (this._extensionTable ??= buildExtensionTable(this.context));
  }

  /**
   * Does `(objectName.memberName)` resolve to an `:extension`? Only when the receiver's type is a KNOWN
   * nominal user type that lacks a native `memberName` (checked by the caller) and NOMINALLY conforms to
   * some `:extension memberName`'s receiver type. Returns the encoded free-function name, or undefined.
   * An UNKNOWN receiver type returns undefined -- it falls to `__ll_member`, exactly as member access
   * already does, so coverage grows as inference does.
   */
  private extensionFor(objectName: string, memberName: string, from?: ast.ASTNode): string | undefined {
    const typeInfo = this.receiverType(objectName, from);
    if (!typeInfo) return undefined;
    return this.extensionForType(typeInfo, memberName, from);
  }

  /**
   * The TYPE-keyed twin of `extensionFor` (Phase Nc). The receiver of a chain's 2nd+ hop --
   * `((gen.map f).filter g)` -- is an EXPRESSION, not a name, so there is no symbol to resolve; its type
   * comes from the per-node channel (`nodeTypes`) instead. Both paths share the `extensionTable` +
   * `receiverConformsTo` resolution.
   */
  private extensionForType(typeInfo: any, memberName: string, from?: ast.ASTNode): string | undefined {
    // Single-sourced onto hir/extensionResolution.ts: the module resolves the conforming SOURCE fnName
    // (nominal conformance); `emittedExtensionName` (import-inlining / encoding) stays the JS backend's.
    const fnName = conformingExtensionFn(this.context, this.extensionTable(), typeInfo, memberName);
    return fnName ? this.emittedExtensionName(fnName, from) : undefined;
  }

  /**
   * The EMITTED name a dispatched extension resolves to. An IMPORTED extension (`std/linq`'s `map`,
   * `to-list`) must be INLINED first -- otherwise the call names a function that was never emitted (the
   * bug: `(chain.to-list)` lowered to `to2dlist(...)` with no definition, because member syntax is not a
   * by-name reference the inliner sees). This mirrors `visitIdentifier` (:2571): resolve the symbol, and
   * if it is imported, `ensureSymbolInlined` emits its body under a unique name and returns it; a LOCAL
   * extension keeps its plain encoded name.
   */
  private emittedExtensionName(fnName: string, from?: ast.ASTNode): string {
    try {
      const resolved = from
        ? this.context?.symbolTable?.resolveSymbol?.(fnName as any, from)
        : this.context?.symbolTable?.resolveSymbol?.(fnName as any);
      if (resolved && this.isImportedSymbol(resolved)) return this.ensureSymbolInlined(resolved);
    } catch {
      // fall through to the plain encoded name
    }
    return encodeIdentifier(fnName);
  }

  private isMethodOnType(objectName: string, memberName: string, from?: ast.ASTNode): boolean {
    try {
      // The OBJECT is a value -- a local, a parameter -- so it resolves lexically, from the node. The
      // two lookups below it are TYPE names, which are top-level by construction, and stay flat.
      const symbol = from
        ? this.context.symbolTable?.resolveSymbol(objectName, from)
        : this.context.symbolTable?.resolveSymbol(objectName);
      if (!symbol?.inferredType) return false;

      let typeInfo = symbol.inferredType;

      // Follow type-ref to actual class definition
      if (typeInfo.kind === 'type-ref' && typeInfo.refName) {
        const typeSymbol = this.context.symbolTable?.resolveSymbol(typeInfo.refName);
        if (typeSymbol?.inferredType) {
          typeInfo = typeSymbol.inferredType;
        }
      }

      // Also check if this is a class instance by looking up the type name
      if (typeInfo.name && (typeInfo.kind === 'class' || typeInfo.kind === 'struct' || typeInfo.kind === 'unknown')) {
        const classSymbol = this.context.symbolTable?.resolveSymbol(typeInfo.name);
        if (classSymbol?.inferredType) {
          typeInfo = classSymbol.inferredType;
        }
      }

      // Check methodSignatures map (populated by InferTypesAstVisitor)
      if (typeInfo.methodSignatures?.has(memberName)) return true;
      if (typeInfo.codegenMetadata?.methodSignatures?.has(memberName)) return true;

      // Fallback: check members array for function types
      if (typeInfo.members) {
        const member = typeInfo.members.find((m: any) => m.name === memberName);
        if (member?.type?.kind === 'function') return true;
      }

      return false;
    } catch (e) {
      return false;
    }
  }

  private expressionToString(expr: ESTree.Expression): string {
    if (expr.type === "Identifier") {
      return (expr as ESTree.Identifier).name;
    }
    if (expr.type === "MemberExpression") {
      const mem = expr as ESTree.MemberExpression;
      const obj = this.expressionToString(mem.object as ESTree.Expression);
      const prop = mem.computed
        ? `[${this.expressionToString(mem.property as ESTree.Expression)}]`
        : `.${(mem.property as ESTree.Identifier).name}`;
      return obj + prop;
    }
    return generate(expr);
  }

  /**
   * A deep copy that KEEPS `_parent`, by reference, pointing into the ORIGINAL tree.
   *
   * It was a JSON round-trip with a cycle-breaking replacer -- and `_parent` IS the cycle, so the
   * replacer dropped it. Every cloned node came out orphaned, and that silently changed what its
   * identifiers mean:
   *
   *     resolveSymbol(name, node)  ->  scopeOf(node) climbs `_parent`  ->  undefined
   *                                ->  falls through to the FLAT cross-module union
   *                                ->  finds a TOP-LEVEL symbol of the same name
   *
   * So an imported function whose PARAMETER shares a name with a top-level symbol in its own module
   * had that parameter replaced by the symbol. `std/math` has `(fn pow [base exp] (Math.pow base exp))`
   * and, separately, `(fn exp [x] (Math.exp x))`. It emitted:
   *
   *     function __ll_inlined_pow_1(base, exp) {        // <- exp is bound RIGHT HERE
   *       return Math.pow(base, __ll_inlined_exp_1);    // <- and the body used the FUNCTION
   *     }
   *
   * `(pow 2 3)` was NaN. It had never been seen because the stdlib was never RUN -- which is the
   * whole reason Sf exists.
   *
   * Keeping the original parent is the rule One Tree already established for synthesized nodes:
   * `nodeScopeIndex` is keyed on the ORIGINAL nodes, so a clone must climb into the original tree to
   * find its scope. Re-parenting the copy onto itself would be the other way to lose it.
   */
  private cloneNode<T extends ast.ASTNode>(n: T): T {
    const clone = (v: any): any => {
      if (Array.isArray(v)) return v.map(clone);
      if (!v || typeof v !== "object") return v;
      const out: any = {};
      for (const k of Object.keys(v)) {
        // BY REFERENCE, and never recursed into: it points at the original tree, which is what makes
        // the lexical walk work -- and it is also what made the JSON round-trip a cycle.
        out[k] = k === "_parent" ? v[k] : clone(v[k]);
      }
      return out;
    };
    return clone(n) as T;
  }

  /**
   * A DESUGARED copy of a node held by the symbol table.
   *
   * `symbol.value` is the PRE-desugar parse tree -- the symbol table is built before the desugar
   * stage runs -- so anything the inliner emits straight from it has never seen the desugarer, and
   * therefore has no implicit return. An imported `(fn sqrt [x] (Math.sqrt x))` inlined as-is emitted
   *
   *     const __ll_inlined_sqrt_1 = x => { Math.sqrt(x) };     // returns undefined
   *
   * Codegen used to hide this by injecting the implicit return ITSELF, at emit time, so the inlined
   * copy got one for free. Now that the return is injected on the AST -- which is the whole point, so
   * the TYPE CHECKER can see it -- anything emitting from `symbol.value` has to desugar it first.
   * `ComptimeEvaluationAstVisitor` has always done exactly this, for exactly this reason.
   *
   * It applies to CLASSES too, not just functions: an inlined class's methods are function bodies
   * like any other, and their implicit returns went missing the same way.
   */
  private desugaredCopyOf(node: ast.ASTNode): ast.ASTNode {
    return new DesugarAstVisitor(this.context, true).visit(this.cloneNode(node));
  }

  private ensureSymbolInlined(symbol: SymbolEntry): string {
    const src =
      (symbol.value &&
        (symbol.value as any)._location &&
        (symbol.value as any)._location.source) ||
      "";
    const symName =
      (symbol.name as any).id ??
      (symbol.name as any).name ??
      String(Math.random());
    const key = `${src}::${symName}`;

    if (this.inlinedSymbols[key]) return this.inlinedSymbols[key];

    try {
      const uniq = uniqueIdentifier("inlined_" + encodeIdentifier(symName));
      this.inlinedSymbols[key] = uniq;

      let defStmt: ESTree.Statement;

      if (symbol.nodeType === "function") {
        const fn = this.desugaredCopyOf(symbol.value) as ast.FunctionNode;

        // An OPERATOR keeps its own name. Everything else is renamed to a unique inlined name so two
        // modules' `helper` cannot collide -- but an operator is not referenced BY name, it is found by
        // DISPATCH, and `visitFunction` needs to see `+` to register the overload under `"+"`. Rename
        // it and it registers under `"__ll_inlined__2b_1"`, a key nothing will ever look up.
        //
        // No collision risk: visitFunction gives every free operator a counter-unique emitted name
        // (`__ll_overload__2b_0`) regardless of what it was called in source.
        const isOperatorFn = (fn.modifiers ?? []).some(
          (m: any) => m.modifier === "operator" || m.modifier === ":operator"
        );
        if (!isOperatorFn) {
          fn.name = fn.name
            ? ({ ...fn.name, id: uniq } as any)
            : ({ _type: "simple-identifier", id: uniq } as any);
        }

        defStmt = this.visit(fn) as ESTree.Statement;
      } else if (symbol.nodeType === "class" || symbol.nodeType === "struct") {
        // A struct emits through visitClass (visitStruct delegates to it), so it is renamed exactly
        // like a class. It used to fall into the catch-all below and be cast to an Expression, which
        // survived only because `const X = class Vector3 {...}` -- a class EXPRESSION -- is valid JS.
        const cls = this.desugaredCopyOf(symbol.value as ast.ClassNode
        ) as ast.ClassNode;

        // Remember what it was CALLED before the rename.
        //
        // The JS binding must be unique, but the TYPE's identity must not change: `__ll_is_type` and
        // `__ll_op_registry` both ask "is this a Money?", and after inlining `constructor.name` is
        // `__ll_inlined_Money_1`. So a registered overload on `["Money","Money"]` never matched an
        // imported Money -- which is precisely why an imported operator, even once emitted and
        // registered correctly, still returned undefined.
        (cls as any).__ll_source_name = symName;

        cls.name = cls.name
          ? ({ ...cls.name, name: uniq } as any)
          : ({ _type: "identifier", name: uniq } as any);
        defStmt = this.visit(cls) as ESTree.Statement;
      } else if (symbol.nodeType === "variable") {
        const v = this.cloneNode(
          symbol.value as ast.VariableNode
        ) as ast.VariableNode;
        const valueExpr = v.value
          ? (this.visitExpr(v.value))
          : this.nilLiteral(v);
        defStmt = {
          type: "VariableDeclaration",
          kind: "const",
          declarations: [
            {
              type: "VariableDeclarator",
              id: ESTreeBuilder.identifier(v, uniq),
              init: valueExpr,
            },
          ],
        };
      } else {
        // Anything else: a type-def, an interface, an enum. The old code CAST whatever came back to
        // an Expression and dropped it straight into `init`. That survived a ClassDeclaration only
        // by accident (`const X = class Y {}` is a class expression, and valid) -- and produced
        //
        //     const __ll_inlined_Number_1 = const Number = undefined;;
        //
        // for `(deftype Number Int | Real)`: a VariableDeclaration spliced into an initializer slot.
        // Not JavaScript at all (LL0101).
        //
        // Bind by what the emission actually IS, rather than asserting it is an expression.
        const emitted = symbol.value
          ? (this.visit(symbol.value as any) as ESTree.Node)
          : null;

        const bindTo = (init: ESTree.Expression): ESTree.VariableDeclaration => ({
          type: "VariableDeclaration",
          kind: "const",
          declarations: [
            {
              type: "VariableDeclarator",
              id: ESTreeBuilder.identifier(symbol.value as any, uniq),
              init,
            },
          ],
        });

        if (!emitted || emitted.type === "EmptyStatement") {
          // A TYPE -- erased. It has no runtime value, so there is nothing to bind: contribute no
          // code. See visitTypeDef.
          defStmt = { type: "EmptyStatement" } as ESTree.EmptyStatement;
        } else if (this.isExpression(emitted)) {
          defStmt = bindTo(emitted as ESTree.Expression);
        } else if (emitted.type === "VariableDeclaration") {
          // It DECLARES its own name (an enum; a type alias to a class). Re-bind its INITIALISER to
          // our unique name -- emitting its own declaration would collide with the importing
          // module's scope and leave `uniq` unbound.
          const init = (emitted as ESTree.VariableDeclaration).declarations[0]?.init;
          defStmt = bindTo(
            (init as ESTree.Expression) ?? this.nilLiteral(symbol.value as any)
          );
        } else {
          defStmt = emitted as ESTree.Statement;
        }
      }

      // INSERTED AFTER the recursive visit above -- and that ordering is load-bearing, not
      // incidental.
      //
      // `inlinedSymbols[key]` is claimed BEFORE we descend (so a cycle terminates), but the
      // DEFINITION lands here, once every symbol it references has already landed. Insertion into
      // `inlinedDefinitions` is therefore POST-ORDER, and Object.values() preserves insertion
      // order -- so dependencies are always emitted before their dependents. That is exactly a
      // topological sort of the definition DAG, which is why
      //
      //     class __ll_inlined_Holder_1 { ... }
      //     const __ll_inlined_base_1 = new __ll_inlined_Holder_1(42);
      //     const __ll_inlined_h_1 = () => __ll_inlined_base_1.v;
      //
      // comes out in that order even though `h` is what main referenced first.
      //
      // Do NOT "fix" this by collecting definitions eagerly per module and emitting them in
      // DependencyGraph.iterate() order: that would emit unreachable definitions, and it would not
      // order definitions WITHIN a module any better than this already does. The test
      // "inlined definitions are emitted in dependency order" (test/imports.ts) pins this down.
      this.inlinedDefinitions[uniq] = defStmt;

      // An inlined FUNCTION takes the arrow branch of visitFunction (it is emitted as a definition,
      // not hoisted as a declaration), so it never reaches the source-name stamp there. Without one,
      // `(console.log double-it)` on an imported function printed `#<fn __ll_inlined__double_1>` --
      // the mangler's symbol, in user-facing output, which is exactly what
      // `display_imported_class_tag/` forbids for classes. The stamps land at the front of
      // `program.body`, which runs AFTER `inlinedDefs`, so the binding is initialised by then.
      const initType = (defStmt as any)?.declarations?.[0]?.init?.type;
      const isFnDef =
        (defStmt as any)?.type === "FunctionDeclaration" ||
        ((defStmt as any)?.type === "VariableDeclaration" &&
          (initType === "ArrowFunctionExpression" || initType === "FunctionExpression"));
      if (isFnDef && typeof symName === "string" && symName && symName !== uniq &&
          JSTransformerAstVisitor.isDisplayableName(symName)) {
        this.functionSourceNames.set(uniq, symName);
      }
      return uniq;
    } catch (ex) {
      console.error("ensureSymbolInlined error for", symName, ex);
      return encodeIdentifier(symName);
    }
  }
}
