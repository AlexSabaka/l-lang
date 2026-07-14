import * as ESTree from "estree";
import { generate } from "astring";

import * as ast from "../../../frontend/ast";
import { BaseAstVisitor } from "../../../BaseAstVisitor";
import { Context, LogLevel, VERSION } from "../../../Context";
import { ScopeType, SymbolEntry } from "../../../analysis/SymbolTable";
import { RuntimeProvider } from "../../../runtime";
import {
  uniqueIdentifier,
  encodeIdentifier,
} from "../../../utils";
import { createRule, RuleSeverity } from "../../../rules/RuleBuilder";
import { TypeChecker } from "../../../types/TypeChecker";
import { isBuiltinModifier, hasModifier } from "../../../helpers/modifiers";
import * as acorn from "acorn";
import { ClassBuilder } from "../JSClassBuilder";
import { SourceMapGenerator } from "source-map";
import path from "path";
import { formatWithOptions } from "util";

/**
 * Helper to extract variable names declared within a pattern match
 */
function findIdentifiersToDefine(node: ast.MatchNode): string[] {
  const predefinedVariables: string[] = [];
  const walkPattern = (p: ast.PatternNode): boolean => {
    switch (p._type) {
      case "identifier-pattern":
        const id = p.id.id;
        // Skip enum references (e.g., HttpMethod:GET) and runtime references
        if (!id.includes(":") && !RuntimeProvider.isRuntimeReference(id)) {
          predefinedVariables.push(encodeIdentifier(id));
        }
        return true;
      case "map-pattern":
        return (p as ast.MapPatternNode).pairs.every((x) =>
          walkPattern(x.pattern)
        );
      case "list-pattern":
      case "vector-pattern":
        return (p as ast.ListPatternNode).elements.every((x) => walkPattern(x));
      default:
        return true;
    }
  };
  node.cases.every((x) => walkPattern(x.pattern));
  return Array.from(new Set(predefinedVariables));
}

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
    this.reportCodegenError(
      node,
      "LL0100",
      `Cannot generate JavaScript for '${node._type}': ${method} is not implemented in the ` +
        `JS backend. The construct parses, but there is no code generator for it.`
    );
    return ESTreeBuilder.identifier(node, "undefined");
  }

  /**
   * Same mechanism the rest of the compiler uses (createRule -> results.add -> hasErrors ->
   * codegen blocked -> CLI exit 1). Deliberately not a new error path.
   *
   * Public because ClassBuilder needs it (LL0102): it is the only other thing that emits ESTree.
   */
  public reportCodegenError(node: ast.ASTNode, code: string, message: string): void {
    const rule = createRule<ast.ASTNode>()
      .addSeverity(RuleSeverity.Error)
      .addCode(code)
      .addMessage(message)
      .addTest(() => true)
      .build();

    this.context.results.add(node, rule, this.context);
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
        this.reportCodegenError(
          node,
          "LL0101",
          `The JS backend emitted code that is not valid JavaScript${at}. ` +
            `${scriptErr?.message ?? scriptErr}. This is a bug in the code generator, not in the source.`
        );
      }
    }
  }

  private scope: ScopeType[] = [ScopeType.program];

  public functions: string[] = [];
  public classes: string[] = [];
  public variables: string[] = [];

  private enumKeys: Record<string, string> = {};
  private inlineStandardSymbols: string[] = [];
  private inlinedSymbols: Record<string, string> = {};
  private inlinedDefinitions: Record<string, ESTree.Statement> = {};
  private rootSource?: string;
  private typesMetadata: Record<string, any> = {};
  private overloadCounter = 0;
  private operatorRegistrations: ESTree.Statement[] = [];
  private modifierDefinitions: Map<string, ast.ModifierDefNode> = new Map();

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

  private populateTypesMetadata(): void {
    // Populate types metadata from pre-computed symbol table metadata
    const classMetadata = this.context.symbolTable.getAllClassMetadata();
    const functionMetadata = this.context.symbolTable.getAllFunctionMetadata();
    
    for (const [name, metadata] of classMetadata.entries()) {
      this.typesMetadata[name] = this.convertCodegenMetadataToRuntimeFormat(metadata);
    }
    
    for (const [name, metadata] of functionMetadata.entries()) {
      this.typesMetadata[name] = this.convertCodegenMetadataToRuntimeFormat(metadata);
    }
    
    this.context.log(LogLevel.Debug, `Loaded ${Object.keys(this.typesMetadata).length} pre-computed type entries`);
  }
  
  private convertCodegenMetadataToRuntimeFormat(metadata: any): Record<string, any> {
    const result: any = {
      name: metadata.typeName,
      kind: metadata.kind,
    };
    
    if (metadata.kind === 'class' || metadata.kind === 'struct') {
      result.properties = metadata.detailedMembers?.filter((m: any) => !m.isOperator).map((m: any) => ({
        name: m.name,
        type: m.type.name || 'Any',
        isPublic: m.visibility === 'public',
        isPrivate: m.visibility === 'private',
        isStatic: m.isStatic || false
      })) || [];
      
      result.methods = Array.from(metadata.methodSignatures?.values() || []).map((method: any) => ({
        name: method.name,
        params: method.parameters.map((p: any) => ({
          name: p.name,
          type: p.type.name || 'Any'
        })),
        returns: method.returnType.name || 'Any'
      }));
      
      if (metadata.constructorSignature) {
        result.constructor = {
          params: metadata.constructorSignature.parameters.map((p: any) => ({
            name: p.name,
            type: p.type.name || 'Any',
            hasDefault: p.hasDefault
          })),
          requiredCount: metadata.constructorSignature.requiredCount
        };
      }
      
      if (metadata.parentClass) {
        result.extends = metadata.parentClass;
      }
      
      // `generics` before `implements`: a class is `Container<T> :implements GenericContainer<T>`,
      // and the metadata is printed by `(type x)` through console.log, which walks insertion order.
      // The golden reads in declaration order; so does this.
      if (metadata.typeParameters?.length > 0) {
        result.generics = metadata.typeParameters.map((tp: any) => tp.name);
      }

      if (metadata.implementedInterfaces?.length > 0) {
        result.implements = metadata.implementedInterfaces.map((iface: any) => iface.interfaceName);
      }
    }
    
    if (metadata.kind === 'function') {
      const methodSig = Array.from(metadata.methodSignatures?.values() || [])[0] as any;
      if (methodSig && methodSig.parameters && methodSig.returnType) {
        // formatType, not `.name`. An array type's `name` is the bare string "Array" -- it drops
        // the element type entirely -- whereas formatType already renders it as `Int[]`. (Until
        // the type converter was fixed, `Int[]` degraded to `Int` before it ever got here, so this
        // reported a scalar and the golden recorded it.)
        result.paramsList = methodSig.parameters.map((p: any) => ({
          name: p.name,
          type: p.type ? TypeChecker.formatType(p.type) : 'Any'
        }));
        result.returns = methodSig.returnType
          ? TypeChecker.formatType(methodSig.returnType)
          : 'Any';
      }
    }
    
    // Reflection reported `nullable: false` UNCONDITIONALLY -- for every type, including one that had
    // just been annotated `?`. It could hardly do otherwise: until D9 nothing ever set the flag, so
    // the constant was as true as anything else available. It reads the real thing now.
    //
    // The metadata KEY keeps its name. `nullable: false` is printed by a passing golden
    // (02_fn_types.expect), the value is unchanged for every non-optional type, and renaming a
    // public reflection field is a separate call from making it honest.
    result.nullable = !!metadata.optional;

    return result;
  }
  
  private getTypeName(t: any): string {
     if (!t) return 'Any';
     
     // Recursive handling of wrapper nodes
     if (t._type === 'type') {
         return t.type ? this.getTypeName(t.type) : 'Any';
     }
     
     if (t._type === 'simple-type') {
         return t.name ? this.getTypeName(t.name) : 'Any';
     }

     // Base cases
     if (t._type === 'type-name') {
         return typeof t.name === 'string' ? t.name : 'Any';
     }
     
     if (t._type === 'function-type') return 'Function';
     
     // Fallback for direct string or object with name
     if (typeof t.name === 'string') return t.name;
     if (t.type && typeof t.type.name === 'string') return t.type.name;
     
     return 'Any';
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

  private isExpressionContext(): boolean {
    return this.scope.some(
      (s) => s === ScopeType.variable || s === ScopeType.match
    );
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
    this.rootSource = root && root._location && root._location.source ? root._location.source : 'bundle.lisp';
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

  visitClass(node: ast.ClassNode): ESTree.ClassDeclaration {
    // Store the original symbol name (before any encoding) for metadata lookup
    const originalName = node.name.name;
    this.classes.push(originalName);

    return this.runInScope(ScopeType.class, () => {
      const classBuilder = new ClassBuilder(node, this.context, this);
      return classBuilder.build();
    });
  }

  visitStruct(node: ast.StructNode): ESTree.ClassDeclaration {
    return this.visitClass(node as unknown as ast.ClassNode);
  }

  visitEnum(node: ast.EnumNode): ESTree.VariableDeclaration {
    const enumName = node.name.name;
    const declarations: ESTree.VariableDeclarator[] = [];

    node.body.forEach((keyNode, keyIndex) => {
      const key = `${enumName}:${ast.keyName(keyNode.key)}`;
      const value =
        keyNode.value !== null
          ? (this.visit(keyNode.value) as ESTree.Expression)
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
    | ESTree.ArrowFunctionExpression {
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
          const paramTypes = node.params.map(p => this.getTypeName(p.type));

          this.operatorRegistrations.push({
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

      node.body.forEach((x, index) => {
        const visited = this.visit(x);
        const isLast = index === node.body.length - 1;

        if (
          isLast &&
          !this.isReturnStatement(visited) &&
          !this.isControlStatement(visited) &&
          x._type !== "variable"
        ) {
          if (this.isExpression(visited)) {
            bodyStatements.push(
              ESTreeBuilder.returnStatement(x, visited as ESTree.Expression)
            );
          } else if ((visited as ESTree.Node).type === "BlockStatement") {
            // A body written as ONE PARENTHESIZED BLOCK emits a BlockStatement, and its value was
            // simply dropped -- the implicit return above only fired on an EXPRESSION. So:
            //
            //     (fn f [n] ((console.log "side") (* n 2)))   ->  undefined
            //     (fn f [n]  (console.log "side") (* n 2))    ->  8
            //
            // The same program, two spellings, two different answers. The corpus works around it by
            // writing an explicit `(return ...)` inside such blocks -- every function in
            // 01-basics/01_function_types.lisp does.
            //
            // `withTrailingReturn` is the same helper visitWhen and visitMatch already use to give a
            // multi-statement body a value. The block's statements are SPLICED into the function
            // body rather than left nested, so the two spellings emit the same JavaScript, which is
            // the whole point: they are the same program.
            //
            // Note it returns the statements untouched when the tail is not an expression (an `if`,
            // a loop, a `return`), so this adds a value where one was written and nowhere else.
            bodyStatements.push(
              ...this.withTrailingReturn(
                (visited as ESTree.BlockStatement).body as ESTree.Statement[],
                x
              )
            );
          } else {
            bodyStatements.push(visited as ESTree.Statement);
          }
        } else {
          if (this.isStatement(visited)) {
            bodyStatements.push(visited as ESTree.Statement);
          } else {
            bodyStatements.push(
              ESTreeBuilder.expressionStatement(x, visited as ESTree.Expression)
            );
          }
        }
      });

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
            generator: false,
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
      } else if (this.scope[1] === ScopeType.program) {
        let declaration = {
          type: "FunctionDeclaration",
          id: name,
          params,
          body,
          generator: false,
          async: node.async,
          loc: ESTreeBuilder.loc(node),
        } as ESTree.FunctionDeclaration;

        // Apply custom modifiers if present
        result = this.applyModifiersToDeclaration(node, declaration, originalName);
      } else {
        const funcExpr: ESTree.ArrowFunctionExpression = {
          type: "ArrowFunctionExpression",
          expression: false,
          params,
          body,
          generator: false,
          async: node.async,
          loc: ESTreeBuilder.loc(node),
        };

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
        (a) => this.visit(a) as ESTree.Expression
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

  private transformPipelineList(
    nodes: ast.ASTNode[]
  ): ESTree.Expression | null {
    if (nodes.length < 3) return null;

    this.context.log(LogLevel.Debug, "Hit the pipeline in the transpiler");

    let processingNodes: ast.ASTNode[] = nodes;

    const seed = processingNodes[0];
    let current = this.visit(seed) as ESTree.Expression;

    for (let i = 1; i < processingNodes.length; i += 2) {
      const id = (processingNodes[i] as ast.SimpleIdentifierNode).id;
      const left = id === "|>";
      const right = id === "<|";
      if (!left && !right) {
        // TODO: Throw
      }

      const funcNode = processingNodes[i + 1];
      this.context.log(LogLevel.Debug, `!!! Dir = ${id} !!! funcType = ${funcNode._type}`);
      if (!funcNode) return null;

      let functionNode: ast.ASTNode;
      let args: ast.ASTNode[] = [];
      let member = false;

      if (funcNode._type === "list") {
        const listNodes = (funcNode as ast.ListNode).nodes;
        if (listNodes.length > 0) {
          functionNode = listNodes[0];
          args = listNodes.slice(1);

          if (
            functionNode._type === "simple-identifier" &&
            (functionNode as any).id.startsWith(".")
          ) {
            member = true;
            const rawId = (functionNode as any).id.substring(1);
            functionNode = { ...functionNode, id: rawId } as any;
          }
        } else {
          return null;
        }
      } else if (
        funcNode._type === "simple-identifier" ||
        funcNode._type === "composite-identifier"
      ) {
        functionNode = funcNode;
        
        this.context.log(LogLevel.Debug, `!!! ${(funcNode as ast.CompositeIdentifierNode).id}`);
        if ((funcNode as ast.CompositeIdentifierNode).headless) {
          member = true;
          const rawId = (funcNode as any).id;
          functionNode = { ...funcNode, id: rawId } as any;
        }
      } else {
        functionNode = funcNode;
      }

      const fn = this.visit(functionNode) as ESTree.Expression;
      const argExprs = args.map((a) => this.visit(a) as ESTree.Expression);

      if (member) {
        current = ESTreeBuilder.memberExpression(
          funcNode,
          current,
          fn as ESTree.Identifier
        );
      } else {
        const calleeArgs =
          left ? [current, ...argExprs] :
          right ? [...argExprs, current] : [];
        current = ESTreeBuilder.callExpression(funcNode, fn, calleeArgs);
      }
    }

    return current;
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
        this.reportCodegenError(
          target,
          "LL0102",
          `'${target._type}' cannot appear in a binding position. A destructuring binding may ` +
            `only contain names, nested [..] / {..} patterns, '...rest', or '_'.`
        );
        return ESTreeBuilder.identifier(target, "undefined");
    }
  }

  visitVariable(node: ast.VariableNode): ESTree.VariableDeclaration {
    this.pushScope(ScopeType.variable);
    const destructuring = ast.isBindingPattern(node.name);
    const id: ESTree.Pattern = destructuring
      ? this.bindingPatternToESTree(node.name as ast.ASTNode)
      : (this.visit(node.name) as ESTree.Identifier);
    // `(mut b a)` COPIES the struct (D11). This is the binding that made value semantics a lie.
    //
    // A DESTRUCTURING binding needs the other helper. `asValue` wraps the initializer -- which here is
    // the CONTAINER, and a container carries no struct marker, so `__ll_copy` would hand it straight
    // back and the bound names would alias its elements. `__ll_copy_each` opens it first.
    const value = node.value
      ? destructuring
        ? this.asValueEach(this.visit(node.value) as ESTree.Expression, node.value)
        : this.asValue(this.visit(node.value) as ESTree.Expression, node.value)
      : null;
    this.popScope();

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
    // A `return`, an `if`, a loop -- nothing to convert. Leave it; the block's value is undefined.
    return statements;
  }

  /**
   * Force an emitted node into EXPRESSION position.
   *
   * A body of more than one statement emits a `BlockStatement`, and a BlockStatement cannot stand
   * where JavaScript wants an expression -- `cond ? { a(); b(); } : undefined` is not valid JS at
   * all. `visitIf` and `visitWhen` both simply CAST to Expression and hoped; astring serialised the
   * result happily, and only the acorn re-parse (LL0101) noticed.
   *
   * Wrap it in an IIFE whose tail is returned, so the block's value is its last expression:
   *
   *     (() => { a(); return b(); })()
   *
   * This is precisely what visitMatch already does for a multi-statement match arm. Nothing new is
   * invented here; the pattern is simply shared.
   */
  private asExpression(emitted: ESTree.Node, node: ast.ASTNode): ESTree.Expression {
    if (this.isExpression(emitted)) {
      return emitted as ESTree.Expression;
    }

    const statements =
      emitted.type === "BlockStatement"
        ? ((emitted as ESTree.BlockStatement).body as ESTree.Statement[])
        : [emitted as ESTree.Statement];

    return {
      type: "CallExpression",
      callee: {
        type: "ArrowFunctionExpression",
        params: [],
        body: ESTreeBuilder.blockStatement(
          node,
          this.withTrailingReturn(statements, node)
        ),
        expression: false,
        async: false,
      } as ESTree.ArrowFunctionExpression,
      arguments: [],
      optional: false,
      loc: ESTreeBuilder.loc(node),
    } as ESTree.CallExpression;
  }

  /** Force an emitted node into STATEMENT position. */
  private asStatement(emitted: ESTree.Node, node: ast.ASTNode): ESTree.Statement {
    return this.isStatement(emitted)
      ? (emitted as ESTree.Statement)
      : ESTreeBuilder.expressionStatement(node, emitted as ESTree.Expression);
  }

  visitIf(node: ast.IfNode): ESTree.IfStatement | ESTree.ConditionalExpression {
    return this.runInScope(ScopeType.if, () => {
      const condition = this.visit(node.condition!) as ESTree.Expression;
      const thenBranch = this.visit(node.then!);
      const elseBranch = node.else ? this.visit(node.else) : null;

      if (this.isExpressionContext()) {
        // asExpression, not a cast: a multi-statement branch is a BlockStatement, and
        // `c ? { log(); "v"; } : "z"` is not JavaScript. It emitted LL0101.
        return {
          type: "ConditionalExpression",
          test: condition,
          consequent: this.asExpression(thenBranch, node.then!),
          alternate: elseBranch
            ? this.asExpression(elseBranch, node.else!)
            : this.nilLiteral(node),
          loc: ESTreeBuilder.loc(node),
        } as ESTree.ConditionalExpression;
      }

      const consequent = this.isStatement(thenBranch)
        ? (thenBranch as ESTree.Statement)
        : ESTreeBuilder.blockStatement(node.then!, [
            ESTreeBuilder.expressionStatement(
              node.then!,
              thenBranch as ESTree.Expression
            ),
          ]);

      const alternate = elseBranch
        ? this.isStatement(elseBranch)
          ? (elseBranch as ESTree.Statement)
          : ESTreeBuilder.blockStatement(node.else!, [
              ESTreeBuilder.expressionStatement(
                node.else!,
                elseBranch as ESTree.Expression
              ),
            ])
        : null;

      return {
        type: "IfStatement",
        test: condition,
        consequent,
        alternate,
        loc: ESTreeBuilder.loc(node),
      } as ESTree.IfStatement;
    });
  }

  /**
   * `when` is an `if` WITHOUT an else -- `WhenNode { condition, then[] }`, and the reference calls it
   * "a simple if without else". A false condition therefore yields `undefined`.
   *
   * It used to emit a ConditionalExpression unconditionally, in every context, and cast each body
   * element to an Expression. Two consequences:
   *
   *   - In STATEMENT position, a multi-statement body emitted `cond ? { log(); n = 1; } : undefined`
   *     -- a BlockStatement inside a ternary, which is not JavaScript (LL0101). `visitIf` has always
   *     consulted `isExpressionContext()`; `when` never did, and that asymmetry was the whole bug.
   *   - In EXPRESSION position, a multi-statement body has to become a value, which needs an IIFE.
   *
   * A multi-EXPRESSION body (`:then "a" "b"`) still emits a sequence expression. That was never
   * broken: `("a", "b")` evaluates both and yields the last, which is exactly the semantics wanted,
   * and it is cheaper than an IIFE.
   */
  visitWhen(node: ast.WhenNode): ESTree.IfStatement | ESTree.ConditionalExpression {
    return this.runInScope(ScopeType.when, () => {
      const condition = this.visit(node.condition!) as ESTree.Expression;
      const body = (node.then ?? []).map((x) => this.visit(x));

      if (!this.isExpressionContext()) {
        return {
          type: "IfStatement",
          test: condition,
          consequent: ESTreeBuilder.blockStatement(
            node,
            body.map((b, i) => this.asStatement(b, node.then![i]))
          ),
          alternate: null,
          loc: ESTreeBuilder.loc(node),
        } as ESTree.IfStatement;
      }

      let consequent: ESTree.Expression;
      if (body.length === 0) {
        consequent = this.nilLiteral(node);
      } else if (body.length === 1) {
        consequent = this.asExpression(body[0], node.then![0]);
      } else if (body.every((b) => this.isExpression(b))) {
        consequent = ESTreeBuilder.sequenceExpression(node, body as ESTree.Expression[]);
      } else {
        consequent = this.asExpression(
          ESTreeBuilder.blockStatement(
            node,
            body.map((b, i) => this.asStatement(b, node.then![i]))
          ),
          node
        );
      }

      return {
        type: "ConditionalExpression",
        test: condition,
        consequent,
        alternate: this.nilLiteral(node),
        loc: ESTreeBuilder.loc(node),
      } as ESTree.ConditionalExpression;
    });
  }

  visitCond(node: ast.CondNode): ESTree.Expression | ESTree.SwitchStatement {
    const cases = node.cases.map((c) => this.visit(c));

    if (this.isExpressionContext()) {
      // Build nested ternary
      let result: ESTree.Expression = this.nilLiteral(node);
      for (let i = cases.length - 1; i >= 0; i--) {
        result = cases[i] as ESTree.ConditionalExpression;
        if (i > 0) {
          (cases[i - 1] as any).alternate = result;
        }
      }
      return result;
    }

    return {
      type: "SwitchStatement",
      discriminant: ESTreeBuilder.literal(node, true),
      cases: cases as ESTree.SwitchCase[],
      loc: ESTreeBuilder.loc(node),
    };
  }

  /**
   * The catch-all case of a `cond`: `(cond ((> n 0) ...) (else ...))`.
   *
   * Both frontends hand `else` through as an ordinary identifier -- `{_type:"simple-identifier",
   * id:"else"}` -- so visiting it as a condition ran it through `encodeIdentifier`, which encodes it
   * (`else` is a JS reserved word) and produced
   *
   *     case _else:
   *
   * `_else` is bound to nothing. The switch evaluates its case expressions in order, so the moment
   * no earlier case matched, `_else` was evaluated and threw `ReferenceError: _else is not defined`.
   * Valid JavaScript, so the acorn guard passed it; the only reason it was never seen is that not
   * one example in the corpus uses `(else ...)`.
   */
  private isElseCase(node: ast.CondCaseNode): boolean {
    const cond = node.condition as any;
    return cond?._type === "simple-identifier" && cond.id === "else";
  }

  visitCondCase(
    node: ast.CondCaseNode
  ): ESTree.ConditionalExpression | ESTree.SwitchCase | ESTree.Expression {
    const isElse = this.isElseCase(node);
    const body = this.visit(node.body);

    if (this.isExpressionContext()) {
      // The `else` IS the alternate. Returning it bare lets visitCond's chain terminate on it --
      // a ternary whose test is `_else` would have thrown before it could choose anything.
      if (isElse) {
        return body as ESTree.Expression;
      }
      return {
        type: "ConditionalExpression",
        test: this.visit(node.condition) as ESTree.Expression,
        consequent: body as ESTree.Expression,
        alternate: this.nilLiteral(node),
        loc: ESTreeBuilder.loc(node),
      };
    }

    const bodyStmt = this.isStatement(body)
      ? [body as ESTree.Statement, { type: "BreakStatement", label: null }]
      : [
          ESTreeBuilder.expressionStatement(
            node.body,
            body as ESTree.Expression
          ),
          { type: "BreakStatement", label: null },
        ];

    return {
      type: "SwitchCase",
      // `test: null` IS `default:` in ESTree. Taken only when no case matched -- exactly `else`.
      test: isElse ? null : (this.visit(node.condition) as ESTree.Expression),
      consequent: bodyStmt,
      loc: ESTreeBuilder.loc(node),
    } as ESTree.SwitchCase;
  }

  visitWhile(node: ast.WhileNode): ESTree.WhileStatement {
    const condition = this.visit(node.condition) as ESTree.Expression;
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
      ? (this.visit(node.condition) as ESTree.Expression)
      : null;
      
    const update = node.step
      ? (this.visit(node.step) as ESTree.Expression)
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
    // D16: `(for :each [key val] :from settings.entries ...)` destructures the loop variable.
    const variable = (
      ast.isBindingPattern(node.variable)
        ? this.bindingPatternToESTree(node.variable as ast.ASTNode)
        : this.visit(node.variable)
    ) as ESTree.Identifier;
    const collection = this.visit(node.collection) as ESTree.Expression;
    const body = this.visit(node.then);
    const elseFor =
      node.else !== null ? (this.visit(node.else) as ESTree.Statement) : null;

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

    const bodyStmt = this.isStatement(body)
      ? (body as ESTree.Statement)
      : ESTreeBuilder.blockStatement(node.then, [
          ESTreeBuilder.expressionStatement(
            node.then,
            body as ESTree.Expression
          ),
        ]);

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
    const tryBlock = ESTreeBuilder.blockStatement(node.try, [
      this.visit(node.try) as ESTree.Statement,
    ]);

    // 2. Generate a unique temp variable for the error object
    const catchVar = uniqueIdentifier("tmp_catch_id");
    const catchVarId = ESTreeBuilder.identifier(node, catchVar);

    let catchClause: ESTree.CatchClause | null = null;

    if (node.catch && node.catch.length > 0) {
      
      // --- STEP A: Determine the "Bottom" of the chain (The final 'else') ---
      const defaultCatch = node.catch.find((x) => !x.filter);
      let chainTail: ESTree.Statement;

      if (defaultCatch) {
        // If we have a generic catch, that's our final 'else' block
        // Wrap in BlockStatement to be safe if visit returns a single expression
        const visitedBody = this.visit(defaultCatch.body) as ESTree.Statement;
        chainTail = visitedBody.type === "BlockStatement" 
          ? visitedBody 
          : ESTreeBuilder.blockStatement(defaultCatch.body, [visitedBody]);
      } else {
        // If no generic catch, we MUST re-throw the error if no types matched
        chainTail = {
          type: "ThrowStatement",
          argument: catchVarId,
        } as ESTree.ThrowStatement;
      }

      // --- STEP B: Build the chain upwards (Reverse Loop) ---
      const filteredCatches = node.catch.filter((x) => !!x.filter);

      for (let i = filteredCatches.length - 1; i >= 0; i--) {
        const c = filteredCatches[i];
        
        const filterVar = this.visit(c.filter.name) as ESTree.Identifier;
        const filterType = {
          type: "Identifier",
          name: c.filter.type.name,
        } as ESTree.Identifier;

        const visitedCatchBody = this.visit(c.body) as ESTree.Statement;
        
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

  visitMatch(node: ast.MatchNode): ESTree.CallExpression {
    return this.runInScope(ScopeType.match, () => {
      const matchVar = uniqueIdentifier("tmp_match_id");
      const matchVarId = ESTreeBuilder.identifier(node, matchVar);
      const matchVal = this.visit(node.expression) as ESTree.Expression;

      const predefinedVariables = findIdentifiersToDefine(node);
      const declarations: ESTree.VariableDeclaration | null =
        predefinedVariables.length > 0
          ? {
              type: "VariableDeclaration",
              kind: "let",
              declarations: predefinedVariables.map((v) => ({
                type: "VariableDeclarator",
                id: ESTreeBuilder.identifier(node, v),
                init: null,
              })),
            }
          : null;

      const funcBody: ESTree.Statement[] = [];
      if (declarations) funcBody.push(declarations);

      const ensureReturns = (stmt: ESTree.Node): ESTree.Statement[] => {
        if (this.isExpression(stmt)) {
          return [ESTreeBuilder.returnStatement(node, stmt as ESTree.Expression)];
        }
        if (stmt.type === "ExpressionStatement") {
          return [
            ESTreeBuilder.returnStatement(
              node,
              (stmt as ESTree.ExpressionStatement).expression
            ),
          ];
        }
        if (stmt.type === "BlockStatement") {
          const b = stmt as ESTree.BlockStatement;
          if (b.body.length === 0) return [b];
          const last = b.body[b.body.length - 1];
          const rest = b.body.slice(0, -1);
          return [...rest, ...ensureReturns(last)];
        }
        return [stmt as ESTree.Statement];
      };

      for (const c of node.cases) {
        const condition = this.generateCondition(c.pattern, matchVar);
        const body = this.visit(c.body) as ESTree.Node;
        const bodyStatements = ensureReturns(body);

        funcBody.push({
          type: "IfStatement",
          test: condition,
          consequent: ESTreeBuilder.blockStatement(c.body, bodyStatements),
          alternate: null,
        } as ESTree.IfStatement);
      }
      
      funcBody.push(ESTreeBuilder.returnStatement(node, this.nilLiteral(node)));

      return ESTreeBuilder.callExpression(
        node,
        {
          type: "ArrowFunctionExpression",
          params: [matchVarId],
          body: ESTreeBuilder.blockStatement(node, funcBody),
          expression: false,
          generator: false,
          async: false,
        } as ESTree.ArrowFunctionExpression,
        [matchVal]
      );
    });
  }

  private generateCondition(
    pattern: ast.PatternNode,
    matchVar: string
  ): ESTree.Expression {
    const matchVarId = ESTreeBuilder.identifier(pattern, matchVar);

    switch (pattern._type) {
      case "any-pattern":
        return ESTreeBuilder.literal(pattern, true);

      case "identifier-pattern":
        if (pattern.id.id in this.enumKeys) {
          return {
            type: "BinaryExpression",
            operator: "===",
            left: matchVarId,
            right: ESTreeBuilder.literal(pattern, this.enumKeys[pattern.id.id]),
          } as ESTree.BinaryExpression;
        }
        return ESTreeBuilder.sequenceExpression(pattern, [
          {
            type: "AssignmentExpression",
            operator: "=",
            left: this.visit(pattern.id) as ESTree.Identifier,
            right: matchVarId,
          } as ESTree.AssignmentExpression,
          ESTreeBuilder.literal(pattern, true),
        ]);

      case "constant-pattern":
        return {
          type: "BinaryExpression",
          operator: "===",
          left: matchVarId,
          right: this.visit(pattern.constant) as ESTree.Expression,
        } as ESTree.BinaryExpression;

      case "list-pattern":
      case "vector-pattern":
        return this.generateArrayPatternCondition(
          pattern as ast.ListPatternNode,
          matchVar
        );

      case "map-pattern":
        return this.generateMapPatternCondition(
          pattern as ast.MapPatternNode,
          matchVar
        );

      default:
        return ESTreeBuilder.literal(pattern, false);
    }
  }

  private generateArrayPatternCondition(
    pattern: ast.ListPatternNode | ast.VectorPatternNode,
    matchVar: string
  ): ESTree.Expression {
    const matchVarId = ESTreeBuilder.identifier(pattern, matchVar);
    const conditions: ESTree.Expression[] = [];

    conditions.push(
      ESTreeBuilder.callExpression(
        pattern,
        ESTreeBuilder.memberExpression(
          pattern,
          ESTreeBuilder.identifier(pattern, "Array"),
          ESTreeBuilder.identifier(pattern, "isArray")
        ),
        [matchVarId]
      )
    );

    conditions.push({
      type: "BinaryExpression",
      operator: "===",
      left: ESTreeBuilder.memberExpression(
        pattern,
        matchVarId,
        ESTreeBuilder.identifier(pattern, "length")
      ),
      right: ESTreeBuilder.literal(pattern, pattern.elements.length),
    } as ESTree.BinaryExpression);

    pattern.elements.forEach((elem, idx) => {
      const elemAccess = ESTreeBuilder.memberExpression(
        elem,
        matchVarId,
        ESTreeBuilder.literal(elem, idx),
        true
      );
      conditions.push(this.generateCondition(elem, `${matchVar}[${idx}]`));
    });

    return conditions.reduce(
      (acc, cond) =>
        ({
          type: "LogicalExpression",
          operator: "&&",
          left: acc,
          right: cond,
        } as ESTree.LogicalExpression)
    );
  }

  private generateMapPatternCondition(
    pattern: ast.MapPatternNode,
    matchVar: string
  ): ESTree.Expression {
    const matchVarId = ESTreeBuilder.identifier(pattern, matchVar);
    const conditions: ESTree.Expression[] = [];

    conditions.push({
      type: "LogicalExpression",
      operator: "&&",
      left: {
        type: "BinaryExpression",
        operator: "===",
        left: {
          type: "UnaryExpression",
          operator: "typeof",
          argument: matchVarId,
          prefix: true,
        },
        right: ESTreeBuilder.literal(pattern, "object"),
      } as ESTree.BinaryExpression,
      right: {
        type: "BinaryExpression",
        operator: "!==",
        left: matchVarId,
        right: ESTreeBuilder.literal(pattern, null),
      } as ESTree.BinaryExpression,
    } as ESTree.LogicalExpression);

    pattern.pairs.forEach((pair) => {
      let keyStr: string;
      if (pair.key._type === "simple-identifier") {
        keyStr = (pair.key as ast.SimpleIdentifierNode).id;
      } else if (pair.key._type === "string") {
        keyStr = (pair.key as ast.StringNode).value;
      } else {
        keyStr = this.visit(pair.key).toString();
      }

      conditions.push(
        this.generateCondition(pair.pattern, `${matchVar}["${keyStr}"]`)
      );
    });

    return conditions.reduce(
      (acc, cond) =>
        ({
          type: "LogicalExpression",
          operator: "&&",
          left: acc,
          right: cond,
        } as ESTree.LogicalExpression)
    );
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
  private isImportedSymbol(resolved: any): boolean {
    if (!resolved?.value?._location || !this.rootSource) return false;
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

        const expr = this.visit(v) as ESTree.Expression;
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
    return this.visit(node.expression) as ESTree.Expression;
  }

  // =========================================================================
  // Lists
  // =========================================================================

  /**
   * An indexer whose LAST suffix was written `.name` -- `gs[0].hi`, but not `gs[0]` and not
   * `gs["hi"]`. See D1, and IndexerNode.members.
   */
  private isDottedMemberIndexer(node: ast.ASTNode): boolean {
    if (node._type !== "indexer") return false;
    const members = (node as ast.IndexerNode).members;
    return !!members?.length && members[members.length - 1] === true;
  }

  visitList(node: ast.ListNode): ESTree.Expression | ESTree.Statement {
    const nodes = Array.isArray(node.nodes) ? node.nodes : [node.nodes];
    if (nodes.length === 0) return ESTreeBuilder.literal(node, null);
    
    // Special case: single element that's NOT an identifier is just wrapped in parens (return it as-is)
    //
    // ...unless it is a MEMBER access written with a dot. D1: `(obj.m)` is ALWAYS a call, and that
    // does not stop being true because the object was reached through an index:
    //
    //     (gs[0].hi)      a call        -- exactly as `(g.hi)` is
    //     (gs[0])         a read        -- there is no member
    //     (gs["hi"])      a read        -- a string INDEX is not a member; D1 is about the `.m` form
    //
    // The `members` flag is what keeps those last two apart: they emit identical JavaScript, so the
    // AST is the only place the distinction can live.
    if (
      nodes.length === 1 &&
      nodes[0]._type !== "simple-identifier" &&
      nodes[0]._type !== "composite-identifier" &&
      !this.isDottedMemberIndexer(nodes[0])
    ) {
      return this.visit(nodes[0]);
    }

    const hasPipelineOp = nodes.some(
      (n) =>
        n._type === "simple-identifier" && ["|>", "<|"].includes((n as any).id)
    );

    if (hasPipelineOp) {
      const result = this.transformPipelineList(nodes);
      if (result) return result;
    }

    const [head, ...rest] = nodes;

    // D1, for an indexer head. Stated, not guessed: the heuristic below (`isKnownFunction ||
    // isMethodCall`) exists because D1 had not landed, and D1's own note says it should be deleted
    // rather than migrated. There is nothing to guess here -- the source said `.hi`, so it is a call.
    if (this.isDottedMemberIndexer(head)) {
      const callee = this.visit(head) as ESTree.Expression;
      const args = rest.map((a) => this.visit(a) as ESTree.Expression);
      return ESTreeBuilder.callExpression(node, callee, args);
    }

    const isHeadIdentifier =
      head._type === "simple-identifier" ||
      head._type === "composite-identifier";

    if (isHeadIdentifier) {
      const headId = (head as any).id;

      if (head._type === "simple-identifier" && headId === "return") {
        if (rest.length === 0) {
          return ESTreeBuilder.returnStatement(node, null);
        }
        const returnValue = this.runInScope(
          ScopeType.variable,
          () => this.visit(rest[0]) as ESTree.Expression
        );
        // `(return this)` hands the RECEIVER out of the function. Without a copy here, the caller
        // would hold the callee's own struct and could mutate it through the back door -- and a
        // returned LOCAL is the corpus's whole construct-mutate-return idiom, which must not hand out
        // an alias either (D11).
        return ESTreeBuilder.returnStatement(node, this.asValue(returnValue, rest[0]));
      }

      // Handle (new ClassName args...) -> new ClassName(args...)
      if (head._type === "simple-identifier" && headId === "new") {
        if (rest.length === 0) {
          // `(new)` with no class name. Bottom, for now -- but it is really a malformed form and
          // deserves a diagnostic rather than a value. Surfaced, not absorbed.
          return this.nilLiteral(node);
        }
        const classNameNode = rest[0];
        const constructorArgs = rest.slice(1).map((x) => this.visit(x) as ESTree.Expression);
        const callee = this.visit(classNameNode) as ESTree.Expression;
        return {
          type: "NewExpression",
          callee,
          arguments: constructorArgs,
          loc: ESTreeBuilder.loc(node),
        } as ESTree.NewExpression;
      }

      const callee = this.visit(head) as ESTree.Expression;
      const args = rest.map((x) => this.visit(x) as ESTree.Expression);
      const calleeStr = this.expressionToString(callee);

      if (this.classes.includes(calleeStr)) {
        return {
          type: "NewExpression",
          callee,
          arguments: args,
          loc: ESTreeBuilder.loc(node),
        } as ESTree.NewExpression;
      }

      let memberName = calleeStr;
      let objectName: string | null = null;
      if (head._type === "composite-identifier") {
        const parts = calleeStr.split(".");
        memberName = parts[parts.length - 1];
        if (parts.length >= 2) {
          objectName = parts[0];  // For type lookup
        }
      }

      const isKnownFunction =
        this.functions.includes((head as any).id) ||
        this.functions.includes(memberName);

      // D1 (docs/spec/DECISIONS.md#d1) rules that (obj.m) is ALWAYS a call — once that
      // lands (Phase 3), this heuristic and the knownPropertyNames blacklist below both
      // become dead code and should be deleted, not migrated.
      // Check if this is a method call using type information from symbol table
      let isMethodCall = false;
      if (head._type === "composite-identifier" && objectName) {
        isMethodCall = this.isMethodOnType(objectName, memberName, head);
      }

      // L-lang semantics: (expr) is a call, expr is a reference
      // - (func) = call func with zero args
      // - (obj.method) = call method with zero args
      // - (obj.prop) = also a call in strict interpretation, but often means access
      //
      // Use type info when available, fall back to heuristics
      if (args.length > 0 || isKnownFunction || isMethodCall) {
        return ESTreeBuilder.callExpression(node, callee, args);
      }

      // For composite identifiers with no args:
      // Per l-lang semantics, (obj.member) should typically be a call.
      // However, some JS properties like 'length', 'name' should NOT be called.
      // Use a blacklist of known property names that shouldn't be invoked.
      if (head._type === "composite-identifier") {
        // Known JS properties that are NOT methods
        const knownPropertyNames = [
          // Array/String properties
          'length',
          // Object identity properties
          'name', 'constructor', 'prototype', '__proto__',
          // Common data fields
          'value', 'key', 'index', 'id', 'type', 'kind',
          'x', 'y', 'z', 'w', 'r', 'g', 'b', 'a',
          'width', 'height', 'size', 'count',
          'data', 'result', 'error', 'message',
          'first', 'last', 'next', 'prev', 'parent', 'children',
          // Balance and other state properties
          'balance', 'age', 'score', 'status', 'state',
          // Math/complex number properties
          'real', 'imag', 'magnitude', 'angle',
          // Animal/entity properties
          'breed', 'species', 'color', 'weight'
        ];

        if (!knownPropertyNames.includes(memberName)) {
          return ESTreeBuilder.callExpression(node, callee, args);
        }
      }

      return callee;
    }

    // Implicit block
    const registrationsBefore = this.operatorRegistrations.length;
    const statements = nodes.map((x) => {
      const result = this.visit(x);
      return this.isStatement(result)
        ? (result as ESTree.Statement)
        : ESTreeBuilder.expressionStatement(x, result as ESTree.Expression);
    });

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
      elements: node.values.map((x) => this.asValue(this.visit(x) as ESTree.Expression, x)),
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
            elements: row.map((x) => this.asValue(this.visit(x) as ESTree.Expression, x)),
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
        : (this.visit(node.key) as ESTree.Expression);

    // The map's VALUE is visited here, not in visitMap -- so this, not visitMap, is where a struct
    // stored under a key gets its copy (D11).
    const value = this.asValue(this.visit(node.value) as ESTree.Expression, node.value);

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
    return {
      type: "AssignmentExpression",
      operator: "=",
      left: this.visitAssignmentTarget(node.assignable),
      // `(b := a)` COPIES a struct, exactly as `(mut b a)` does.
      right: this.asValue(this.visit(node.value) as ESTree.Expression, node.value),
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
      return {
        type: "AssignmentExpression",
        operator: "=",
        left: this.visitAssignmentTarget(node.assignable),
        right: this.asValue(this.visit(node.value) as ESTree.Expression, node.value),
        loc: ESTreeBuilder.loc(node),
      };
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
          this.visit(node.assignable) as ESTree.Expression,
          this.visit(node.value) as ESTree.Expression,
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
    let expr = this.visit(node.id) as ESTree.Expression;
    for (const indices of node.indices) {
      for (const idx of indices) {
        expr = ESTreeBuilder.memberExpression(
          node,
          expr,
          this.visit(idx) as ESTree.Expression,
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
    return ESTreeBuilder.callExpression(
      node,
      this.visit(node.callee) as ESTree.Expression,
      node.arguments.map((a) => this.visit(a) as ESTree.Expression)
    );
  }

  visitMember(node: ast.MemberNode): ESTree.Expression {
    return ESTreeBuilder.memberExpression(
      node,
      this.visit(node.object) as ESTree.Expression,
      this.visit(node.property) as ESTree.Expression,
      node.computed
    );
  }

  visitIndexer(node: ast.IndexerNode): ESTree.Expression {
    let expr = this.visit(node.id) as ESTree.Expression;

    for (const indices of node.indices) {
      for (const idx of indices) {
        expr = ESTreeBuilder.callExpression(
          node,
          ESTreeBuilder.identifier(node, "__ll_index"),
          [expr, this.visit(idx) as ESTree.Expression]
        ) as ESTree.Expression;
      }
    }

    return expr;
  }

  visitSpread(node: ast.SpreadNode): ESTree.SpreadElement {
    return {
      type: "SpreadElement",
      argument: this.visit(node.expression) as ESTree.Expression,
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
      argument: this.visit(node.expression) as ESTree.Expression,
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
   * Node types that can NEVER evaluate to a struct.
   *
   * A DENY-list, on purpose. The alternative -- listing what CAN be a struct -- fails unsafely: a node
   * type I forget would be left unwrapped, which is an aliasing bug. Forgetting one here merely leaves
   * a redundant `__ll_copy()` around a literal, which is noise. Correctness is not symmetric with
   * tidiness, so the asymmetry decides the direction.
   */
  private static readonly NEVER_A_STRUCT = new Set([
    "integer-number", "float-number", "hex-number", "octal-number", "binary-number",
    "fraction-number", "complex-number", "string", "formatted-string", "boolean", "null",
    "vector", "matrix", "map", "function", "quote", "comment",
  ]);

  /**
   * Does this expression need a copy on the way into a binding, a parameter, or a collection slot?
   *
   * Codegen has no type information (there is no per-node type channel; `typeEnv` is a dead local in
   * Context.ts), so this cannot ask "is it a struct?" -- only "could it possibly be?". The runtime
   * `__ll_copy` makes the real decision by looking for the marker; this is purely about not emitting a
   * call that provably cannot do anything.
   */
  private needsValueCopy(node: ast.ASTNode | undefined | null): boolean {
    if (!node) return false;
    if (JSTransformerAstVisitor.NEVER_A_STRUCT.has(node._type)) return false;

    // A FRESH construction is already a brand-new object -- `(let result (Complex))`. Copying it would
    // duplicate an object nobody else can reach. This is not just an optimisation: the corpus's whole
    // idiom is construct-mutate-return, so without it every struct in std/math and 09_operators would
    // be cloned once for no reason at all.
    if (ast.isListNode(node)) {
      const head = (node as ast.ListNode).nodes[0];
      if (head && head._type === "simple-identifier") {
        const id = ast.symbolName(head as ast.IdentifierNode);
        if (id === "new" || this.classes.includes(id)) return false;
      }
    }

    return true;
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
      if (this.isDeclaredPrimitive(types?.[i])) return;

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

  /** The primitives. A value of one of these can never be a struct. */
  private static readonly PRIMITIVE_TYPE_NAMES = new Set([
    "Int", "Real", "String", "Char", "Boolean", "Bool", "Void",
  ]);

  /** Is this annotation a known primitive -- and NOT an array of one? `Int[]` is an array. */
  private isDeclaredPrimitive(type: ast.TypeNode | undefined): boolean {
    if (!type) return false;

    const inner: any = (type as any).type;
    // The array flag can sit on either node -- the same shape bug the type converter has to handle.
    if ((type as any).array || inner?.array) return false;
    // An optional `T?` is still a T (or nil), and nil is not a struct either -- but keep it simple and
    // let the runtime decide; the marker check is a single property read.
    if ((type as any).optional || inner?.optional) return false;

    const name = typeof inner?.name === "string" ? inner.name : inner?.name?.name;
    return typeof name === "string" && JSTransformerAstVisitor.PRIMITIVE_TYPE_NAMES.has(name);
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
   * Check if a member name is a method on the given object type.
   * Uses symbol table type metadata for accurate detection.
   */
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

  private cloneNode<T extends ast.ASTNode>(n: T): T {
    const cache = new Set<any>();
    return JSON.parse(
      JSON.stringify(n, (key, value) => {
        if (typeof value === "object" && value !== null) {
          if (cache.has(value)) return;
          cache.add(value);
        }
        return value;
      })
    ) as T;
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
        const fn = this.cloneNode(
          symbol.value as ast.FunctionNode
        ) as ast.FunctionNode;

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
        const cls = this.cloneNode(
          symbol.value as ast.ClassNode
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
          ? (this.visit(v.value) as ESTree.Expression)
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
      return uniq;
    } catch (ex) {
      console.error("ensureSymbolInlined error for", symName, ex);
      return encodeIdentifier(symName);
    }
  }
}
