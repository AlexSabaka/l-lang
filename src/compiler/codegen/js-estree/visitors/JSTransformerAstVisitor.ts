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
   */
  private reportCodegenError(node: ast.ASTNode, code: string, message: string): void {
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
  private identifiersCache: Record<string, string> = {};
  private localIdentifiersStack: Set<string>[] = [];  // Stack of local variable names per scope
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
  // Local Identifier Scope Management
  // =========================================================================

  /**
   * Push a new local scope for tracking local variable/parameter names.
   * Local names shadow the global identifiersCache.
   */
  private pushLocalScope(): void {
    this.localIdentifiersStack.push(new Set());
  }

  /**
   * Pop the current local scope.
   */
  private popLocalScope(): void {
    this.localIdentifiersStack.pop();
  }

  /**
   * Register a name as local in the current scope.
   */
  private registerLocalName(name: string): void {
    if (this.localIdentifiersStack.length > 0) {
      this.localIdentifiersStack[this.localIdentifiersStack.length - 1].add(name);
    }
  }

  /**
   * Check if a name is local in any active scope.
   */
  private isLocalName(name: string): boolean {
    for (let i = this.localIdentifiersStack.length - 1; i >= 0; i--) {
      if (this.localIdentifiersStack[i].has(name)) {
        return true;
      }
    }
    return false;
  }

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
      
      if (metadata.implementedInterfaces?.length > 0) {
        result.implements = metadata.implementedInterfaces.map((iface: any) => iface.interfaceName);
      }
      
      if (metadata.typeParameters?.length > 0) {
        result.generics = metadata.typeParameters.map((tp: any) => tp.name);
      }
    }
    
    if (metadata.kind === 'function') {
      const methodSig = Array.from(metadata.methodSignatures?.values() || [])[0] as any;
      if (methodSig && methodSig.parameters && methodSig.returnType) {
        result.paramsList = methodSig.parameters.map((p: any) => ({
          name: p.name,
          type: p.type.name || 'Any'
        }));
        result.returns = methodSig.returnType.name || 'Any';
      }
    }
    
    result.nullable = false;
    
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

  visitProgram(node: ast.ProgramNode): ESTree.Program {
    const statements: ESTree.Statement[] = [];

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
      const key = `${enumName}:${keyNode.key.id ?? keyNode.key.value}`;
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

  visitTypeDef(node: ast.TypeDefNode) {
    // For aliases to classes/structs, generate a const binding at runtime
    // e.g., (deftype Vector Vector3) -> const Vector = Vector3;
    const aliasName = encodeIdentifier(node.name.id);
    
    // Extract the target name from the type node
    let targetName = "undefined";
    if (node.type && (node.type as any).type && (node.type as any).type.name) {
      targetName = encodeIdentifier((node.type as any).type.name.name);
    }
    
    return {
      type: "VariableDeclaration",
      kind: "const",
      declarations: [
        {
          type: "VariableDeclarator",
          id: { type: "Identifier", name: aliasName },
          init: { type: "Identifier", name: targetName },
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
      // Push a local scope for parameters and local variables
      this.pushLocalScope();

      // Register parameter names as local BEFORE processing - this prevents
      // them from being resolved to inlined symbols from imports
      for (const param of node.params) {
        const paramName = (param.name as any)?.id ?? (param.name as any)?.name;
        if (paramName) {
          this.registerLocalName(paramName);
        }
      }

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
        if (this.scope.length === 2 && this.scope[1] === ScopeType.program) {
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
        } else if (this.currentScope() === ScopeType.method) {
          // Append arity for methods to avoid shadowing in JS prototype
          name = { ...name, name: `${name.name}_${node.params.length}` } as ESTree.Identifier;
        }
      }

      const params = node.params.map((x) => this.visit(x) as ESTree.Pattern);

      // Process function body with implicit return
      const bodyStatements: ESTree.Statement[] = [];

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
          static: false,
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

      // Pop local scope before returning
      this.popLocalScope();
      return result;
    });
  }

  private applyModifiersToDeclaration(
    node: ast.FunctionNode, 
    declaration: ESTree.FunctionDeclaration | ESTree.VariableDeclaration, 
    originalName: string
  ): ESTree.FunctionDeclaration | ESTree.VariableDeclaration {
    // Get custom modifiers (non-operator modifiers)
    const customModifiers = node.modifiers?.filter(m => m.modifier !== 'operator') || [];
    
    if (customModifiers.length === 0) {
      return declaration;
    }

    // For each custom modifier, wrap the function
    for (const modifierRef of customModifiers) {
      const modifierName = modifierRef.modifier;
      
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
                  arguments: [],
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
            arguments: [],
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

  visitVariable(node: ast.VariableNode): ESTree.VariableDeclaration {
    this.pushScope(ScopeType.variable);
    const name = this.visit(node.name) as ESTree.Identifier;
    const value = node.value
      ? (this.visit(node.value) as ESTree.Expression)
      : null;
    this.popScope();

    this.variables.push(name.name);

    return {
      type: "VariableDeclaration",
      kind: this.context.options.noIIFE ? "var" : (node.mutable ? "let" : "const"),
      declarations: [
        {
          type: "VariableDeclarator",
          id: name,
          init: value,
        },
      ],
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitModifierDef(node: ast.ModifierDefNode): ESTree.FunctionDeclaration {
    // Store modifier definition for later use
    this.modifierDefinitions.set(node.name, node);
    
    const modifierName = `__ll_modifier_${node.name}`;
    
    // For now, implement a simple memoization transformer
    return {
      type: "FunctionDeclaration",
      id: { type: "Identifier", name: modifierName },
      params: [],
      body: {
        type: "BlockStatement",
        body: [
          {
            type: "ReturnStatement", 
            argument: {
              type: "ArrowFunctionExpression",
              expression: false,
              params: [{ type: "Identifier", name: "originalFunction" }],
              body: {
                type: "BlockStatement",
                body: [
                  {
                    type: "VariableDeclaration",
                    kind: "const",
                    declarations: [{
                      type: "VariableDeclarator",
                      id: { type: "Identifier", name: "cache" },
                      init: {
                        type: "NewExpression",
                        callee: { type: "Identifier", name: "Map" },
                        arguments: []
                      }
                    }]
                  },
                  {
                    type: "ReturnStatement",
                    argument: {
                      type: "ArrowFunctionExpression",
                      expression: false,
                      params: [{ type: "RestElement", argument: { type: "Identifier", name: "args" } }],
                      body: {
                        type: "BlockStatement",
                        body: [
                          {
                            type: "VariableDeclaration",
                            kind: "const",
                            declarations: [{
                              type: "VariableDeclarator",
                              id: { type: "Identifier", name: "key" },
                              init: {
                                type: "CallExpression",
                                callee: {
                                  type: "MemberExpression",
                                  object: { type: "Identifier", name: "JSON" },
                                  property: { type: "Identifier", name: "stringify" },
                                  computed: false,
                                  optional: false
                                },
                                arguments: [{ type: "Identifier", name: "args" }],
                                optional: false
                              }
                            }]
                          },
                          {
                            type: "IfStatement",
                            test: {
                              type: "CallExpression",
                              callee: {
                                type: "MemberExpression",
                                object: { type: "Identifier", name: "cache" },
                                property: { type: "Identifier", name: "has" },
                                computed: false,
                                optional: false
                              },
                              arguments: [{ type: "Identifier", name: "key" }],
                              optional: false
                            },
                            consequent: {
                              type: "ReturnStatement",
                              argument: {
                                type: "CallExpression",
                                callee: {
                                  type: "MemberExpression",
                                  object: { type: "Identifier", name: "cache" },
                                  property: { type: "Identifier", name: "get" },
                                  computed: false,
                                  optional: false
                                },
                                arguments: [{ type: "Identifier", name: "key" }],
                                optional: false
                              }
                            }
                          },
                          {
                            type: "VariableDeclaration",
                            kind: "const", 
                            declarations: [{
                              type: "VariableDeclarator",
                              id: { type: "Identifier", name: "result" },
                              init: {
                                type: "CallExpression",
                                callee: {
                                  type: "MemberExpression",
                                  object: { type: "Identifier", name: "originalFunction" },
                                  property: { type: "Identifier", name: "apply" },
                                  computed: false,
                                  optional: false
                                },
                                arguments: [
                                  { type: "ThisExpression" },
                                  { type: "Identifier", name: "args" }
                                ],
                                optional: false
                              }
                            }]
                          },
                          {
                            type: "ExpressionStatement",
                            expression: {
                              type: "CallExpression",
                              callee: {
                                type: "MemberExpression",
                                object: { type: "Identifier", name: "cache" },
                                property: { type: "Identifier", name: "set" },
                                computed: false,
                                optional: false
                              },
                              arguments: [
                                { type: "Identifier", name: "key" },
                                { type: "Identifier", name: "result" }
                              ],
                              optional: false
                            }
                          },
                          {
                            type: "ReturnStatement",
                            argument: { type: "Identifier", name: "result" }
                          }
                        ]
                      }
                    }
                  }
                ]
              }
            }
          }
        ]
      }
    };
  }

  visitParameter(node: ast.ParameterNode): ESTree.Identifier | ESTree.RestElement {
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

  visitIf(node: ast.IfNode): ESTree.IfStatement | ESTree.ConditionalExpression {
    return this.runInScope(ScopeType.if, () => {
      const condition = this.visit(node.condition!) as ESTree.Expression;
      const thenBranch = this.visit(node.then!);
      const elseBranch = node.else ? this.visit(node.else) : null;

      if (this.isExpressionContext()) {
        return {
          type: "ConditionalExpression",
          test: condition,
          consequent: thenBranch as ESTree.Expression,
          alternate:
            (elseBranch as ESTree.Expression) ||
            ESTreeBuilder.identifier(node, "undefined"),
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

  visitWhen(node: ast.WhenNode): ESTree.ConditionalExpression {
    return this.runInScope(ScopeType.when, () => {
      const condition = this.visit(node.condition!) as ESTree.Expression;
      const whenExprs = node.then!.map(
        (x) => this.visit(x) as ESTree.Expression
      );

      return {
        type: "ConditionalExpression",
        test: condition,
        consequent:
          whenExprs.length === 1
            ? whenExprs[0]
            : ESTreeBuilder.sequenceExpression(node, whenExprs),
        alternate: ESTreeBuilder.identifier(node, "undefined"),
        loc: ESTreeBuilder.loc(node),
      };
    });
  }

  visitCond(node: ast.CondNode): ESTree.Expression | ESTree.SwitchStatement {
    const cases = node.cases.map((c) => this.visit(c));

    if (this.isExpressionContext()) {
      // Build nested ternary
      let result: ESTree.Expression = ESTreeBuilder.identifier(
        node,
        "undefined"
      );
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

  visitCondCase(
    node: ast.CondCaseNode
  ): ESTree.ConditionalExpression | ESTree.SwitchCase {
    const cond = this.visit(node.condition) as ESTree.Expression;
    const body = this.visit(node.body);

    if (this.isExpressionContext()) {
      return {
        type: "ConditionalExpression",
        test: cond,
        consequent: body as ESTree.Expression,
        alternate: ESTreeBuilder.identifier(node, "undefined"),
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
      test: cond,
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
    const variable = this.visit(node.variable) as ESTree.Identifier;
    const collection = this.visit(node.collection) as ESTree.Expression;
    const body = this.visit(node.then);
    const elseFor =
      node.else !== null ? (this.visit(node.else) as ESTree.Statement) : null;

    const varDeclaration: ESTree.VariableDeclaration = {
      type: "VariableDeclaration",
      kind: "let",
      declarations: [
        {
          type: "VariableDeclarator",
          id: variable,
          init: null,
        },
      ],
      loc: ESTreeBuilder.loc(node.variable),
    };

    const bodyStmt = this.isStatement(body)
      ? (body as ESTree.Statement)
      : ESTreeBuilder.blockStatement(node.then, [
          ESTreeBuilder.expressionStatement(
            node.then,
            body as ESTree.Expression
          ),
        ]);

    const forOfStmt: ESTree.ForOfStatement = {
      type: "ForOfStatement",
      left: variable, 
      right: collection,
      body: bodyStmt,
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
      
      funcBody.push(
        ESTreeBuilder.returnStatement(
          node,
          ESTreeBuilder.identifier(node, "undefined")
        )
      );

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

  visitIdentifier(node: ast.IdentifierNode): ESTree.Identifier {
    // Check if this is a local name (parameter or local variable) - these shadow global cache
    if (this.isLocalName(node.id)) {
      return ESTreeBuilder.identifier(node, encodeIdentifier(node.id));
    }

    if (this.identifiersCache[node.id]) {
      return ESTreeBuilder.identifier(node, this.identifiersCache[node.id]);
    }

    try {
      const resolved = this.context?.symbolTable?.resolveSymbol?.(node as any);
      if (
        resolved?.value?._location &&
        this.rootSource &&
        resolved.value._location.source !== this.rootSource
      ) {
        const uniq = this.ensureSymbolInlined(resolved);
        this.identifiersCache[node.id] = uniq;
        return ESTreeBuilder.identifier(node, uniq);
      }
    } catch (e) {
      // Fall through
    }

    const id = encodeIdentifier(node.id);
    this.identifiersCache[node.id] = id;

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
    let expr: ESTree.Expression = ESTreeBuilder.identifier(
      node,
      encodeIdentifier(parts[startPartId])
    );

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
      if (v._type === "string") {
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

  visitList(node: ast.ListNode): ESTree.Expression | ESTree.Statement {
    const nodes = Array.isArray(node.nodes) ? node.nodes : [node.nodes];
    if (nodes.length === 0) return ESTreeBuilder.literal(node, null);
    
    // Special case: single element that's NOT an identifier is just wrapped in parens (return it as-is)
    if (nodes.length === 1 && nodes[0]._type !== "simple-identifier" && nodes[0]._type !== "composite-identifier") {
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
        return ESTreeBuilder.returnStatement(node, returnValue);
      }

      // Handle (new ClassName args...) -> new ClassName(args...)
      if (head._type === "simple-identifier" && headId === "new") {
        if (rest.length === 0) {
          return ESTreeBuilder.identifier(node, "undefined");
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
        isMethodCall = this.isMethodOnType(objectName, memberName);
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
      elements: node.values.map((x) => this.visit(x) as ESTree.Expression),
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
            elements: row.map((x) => this.visit(x) as ESTree.Expression),
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

  visitKeyValue(node: ast.KeyValueNode): ESTree.Property {
    const key =
      node.key._type === "simple-identifier"
        ? ESTreeBuilder.identifier(
            node.key,
            encodeIdentifier((node.key as ast.SimpleIdentifierNode).id)
          )
        : (this.visit(node.key) as ESTree.Expression);

    const value = this.visit(node.value) as ESTree.Expression;

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
      left: this.visit(node.assignable) as ESTree.Pattern,
      right: this.visit(node.value) as ESTree.Expression,
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitCompoundAssignment(
    node: ast.CompoundAssignmentNode
  ): ESTree.AssignmentExpression {
    return {
      type: "AssignmentExpression",
      operator: node.operator.replace(":", "") as ESTree.AssignmentOperator,
      left: this.visit(node.assignable) as ESTree.Pattern,
      right: this.visit(node.value) as ESTree.Expression,
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitIndexer(node: ast.IndexerNode): ESTree.MemberExpression {
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

    return expr as ESTree.MemberExpression;
  }

  visitSpread(node: ast.SpreadNode): ESTree.SpreadElement {
    return {
      type: "SpreadElement",
      argument: this.visit(node.expression) as ESTree.Expression,
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitComment(node: ast.CommentNode): ESTree.SimpleLiteral {
    return { type: "Literal", value: null, raw: `/* ${node.comment} */` };
  }

  visitQuote(node: ast.QuoteNode): ESTree.Literal {
    const serialized = JSON.stringify(node, (key, val) =>
      ["_location", "_parent"].includes(key) ? undefined : val
    );
    return ESTreeBuilder.literal(node, serialized);
  }

  visitNull(node: ast.NullNode) {
    // If the keyword is "undefined", emit undefined identifier instead of null literal
    if (node.keyword && node.keyword.toLowerCase() === "undefined") {
      return ESTreeBuilder.identifier(node, "undefined");
    }
    return ESTreeBuilder.literal(node, null);
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
  private isMethodOnType(objectName: string, memberName: string): boolean {
    try {
      const symbol = this.context.symbolTable?.resolveSymbol(objectName);
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
        fn.name = fn.name
          ? ({ ...fn.name, id: uniq } as any)
          : ({ _type: "simple-identifier", id: uniq } as any);
        defStmt = this.visit(fn) as ESTree.Statement;
      } else if (symbol.nodeType === "class") {
        const cls = this.cloneNode(
          symbol.value as ast.ClassNode
        ) as ast.ClassNode;
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
          : ESTreeBuilder.identifier(v, "undefined");
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
        const val = (symbol.value as any)
          ? (this.visit(symbol.value as any) as ESTree.Expression)
          : ESTreeBuilder.identifier(symbol.value as any, "undefined");
        defStmt = {
          type: "VariableDeclaration",
          kind: "const",
          declarations: [
            {
              type: "VariableDeclarator",
              id: ESTreeBuilder.identifier(symbol.value as any, uniq),
              init: val,
            },
          ],
        };
      }

      this.inlinedDefinitions[uniq] = defStmt;
      return uniq;
    } catch (ex) {
      console.error("ensureSymbolInlined error for", symName, ex);
      return encodeIdentifier(symName);
    }
  }
}
