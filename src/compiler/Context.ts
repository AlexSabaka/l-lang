import path from "node:path";

import { RuleSeverity, RuleValidationResultsCollection } from "./rules";
import { createRule } from "./rules/RuleBuilder";

import {
  BaseAstTreeWalker,
  BuildDependencyGraphAstVisitor,
  BuildSymbolTableAstVisitor,
  ComptimeEvaluationAstVisitor,
  DesugarAstVisitor,
  InlineImportsAstVisitor,
  SyntaxRulesAstVisitor,
  TreeShakeAstVisitor,
  InferTypesAstVisitor,
} from "./index";

import {
  JSTransformerAstVisitorLegacy,
  JSTransformerAstVisitorEstree,
  LlangTransformerAstVisitor
} from "./codegen";

import { ASTNode } from "./frontend/ast";
import { SymbolTable } from "./analysis/SymbolTable";
import { AstProvider } from "./frontend/AstProvider";
import { DependencyGraph } from "./analysis/DependencyGraph";
import { formatLogMessage, getCaller } from "./utils";
import chalk from "chalk";
import { PerformanceMetrics } from "./PerformanceMetrics";

export const VERSION = "0.0.1";

export enum LogLevel {
  Verbose,
  Debug,
  Info,
  Warning,
  Error,
}

export type CompilationStage = "parse" | "syntax" | "symbols" | "desugar" | "types" | "codegen";

export type CompilationLanguage = "llang" | "js" | "legacy-js";

/**
 * Which parser turns .lisp source into an AST.
 *
 * `grammar_v2` (default) is the Chevrotain lexer/parser. `peg` is the original scannerless
 * peggy grammar, kept selectable for one cycle so the cutover is reversible with a single flag.
 * The PEG has no separate lexer, so whitespace alone decides token boundaries -- which is the
 * root cause of the silent misparses grammar_v2 exists to fix (`(let nullable 1)` binding a
 * variable named `able`; `(defclass Pair<T U>)` dropping its generics). See docs/spec/DECISIONS.md D14.
 */
export type CompilationFrontend = "grammar_v2" | "peg";

export interface CompilerOptions {
  logger?: (msg: any, ...args: any[]) => void;
  minimumLogLevel: LogLevel;
  includeRuntimeShim: boolean;
  stdout: boolean;
  stage: CompilationStage;
  language: CompilationLanguage;
  frontend: CompilationFrontend;
  noIIFE?: boolean; // For REPL and other use cases
  perf?: boolean; // Performance tracking flag
  strictPhases?: boolean; // Enforce strict separation between compilation phases
  validateMetadata?: boolean; // Validate completeness of type metadata before codegen
}

export function logCompilationMessages(context: Context) {
  const all = context.results.all.sort((a, b) => a.line - b.line);

  const logLevel = {
    [RuleSeverity.Error]: LogLevel.Error,
    [RuleSeverity.Warning]: LogLevel.Warning,
    [RuleSeverity.Message]: LogLevel.Info,
    [RuleSeverity.None]: LogLevel.Info,
  };

  const { errors, warnings, messages } = all.reduce((p, c) => {
    context.log(logLevel[c.severity], c.message, getCaller(6));
    return {
      errors: p.errors + (c.severity === RuleSeverity.Error ? 1 : 0),
      warnings: p.warnings + (c.severity === RuleSeverity.Warning ? 1 : 0),
      messages: p.messages + (c.severity === RuleSeverity.Message ? 1 : 0),
    };
  }, { errors: 0, warnings: 0, messages: 0 });

  context.log(
    LogLevel.Info,
    `${chalk.red(`${errors} errors`)}, ${chalk.yellow(`${warnings} warnings`)}, ${chalk.blueBright(`${messages} messages`)}`,
    getCaller(3)
  );

  return { errors, warnings, messages } as const;
}


export class Context {
  public mainModule: string;
  public options: CompilerOptions;
  public dependencyGraph: DependencyGraph;
  public astProvider: AstProvider;
  public symbolTable: SymbolTable = new SymbolTable(undefined);
  public performanceMetrics: PerformanceMetrics =
    new PerformanceMetrics();
  public results: RuleValidationResultsCollection =
    new RuleValidationResultsCollection();
  
  private moduleCache: Map<string, { ast: ASTNode; symbols: SymbolTable }> = new Map();

  /**
   * Modules whose `process()` is currently on the stack.
   *
   * The only re-entry guard used to be `moduleCache`, but `cacheModule` runs at the END of
   * process() -- long after the symbols stage, which is where imports recurse
   * (BuildDependencyGraphAstVisitor.processFileImport -> context.process). So for A -> B -> A,
   * A was not yet cached when B re-entered it, and the recursion never terminated:
   * `RangeError: Maximum call stack size exceeded`, on every import cycle.
   */
  private processing: Set<string> = new Set();

  constructor(mainFile: string, options: CompilerOptions) {
    this.dependencyGraph = new DependencyGraph(mainFile);
    this.mainModule = path.basename(mainFile, ".lisp");
    this.options = options;
    this.astProvider = new AstProvider(options.frontend ?? "grammar_v2");
    // Initialize performance metrics with enabled flag from options
    this.performanceMetrics = new PerformanceMetrics(options.perf || false);
  }

  /**
   * Get or load a module
   * Returns cached version if already loaded
   */
  getModule(filePath: string): { ast: ASTNode; symbols?: SymbolTable } | undefined {
    const fullPath = path.resolve(filePath);
    return this.moduleCache.get(fullPath);
  }

  /**
   * Cache a loaded module
   */
  cacheModule(filePath: string, ast: ASTNode, symbols: SymbolTable): void {
    const fullPath = path.resolve(filePath);
    this.moduleCache.set(fullPath, { ast, symbols });
  }

  /**
   * Helper method to count AST nodes
   */
  private countNodes(ast: ASTNode): number {
    let count = 1;
    
    // Count nodes based on AST structure
    if ('nodes' in ast && Array.isArray(ast.nodes)) {
      for (const node of ast.nodes) {
        if (node) count += this.countNodes(node);
      }
    }
    
    if ('body' in ast && Array.isArray(ast.body)) {
      for (const node of ast.body) {
        if (node) count += this.countNodes(node);
      }
    }

    // Handle other node properties that contain child nodes
    const childProps = ['condition', 'then', 'else', 'left', 'right', 'value', 'target', 'args', 'params'];
    for (const prop of childProps) {
      if (prop in ast && ast[prop as keyof ASTNode]) {
        const child = ast[prop as keyof ASTNode];
        if (Array.isArray(child)) {
          for (const node of child) {
            if (node && typeof node === 'object' && '_type' in node) {
              count += this.countNodes(node);
            }
          }
        } else if (typeof child === 'object' && child !== null && '_type' in child) {
          count += this.countNodes(child);
        }
      }
    }

    return count;
  }

  /**
   * Get performance report
   */
  public getPerformanceReport(): string {
    return this.performanceMetrics.generateReport();
  }

  log(level: LogLevel, msg: any, caller?: string) {
    if (level >= this.options.minimumLogLevel) {
      this.options.logger?.call(null, formatLogMessage(level, msg, caller));
    }
  }

  process(file: string, stopAt?: CompilationStage): { ast: ASTNode; symbols?: SymbolTable, code?: string, map?: any } {
    stopAt ??= this.options.stage || "codegen";

    const fullPath = path.resolve(file);

    // If module already processed and cached, reuse its symbol table
    const cached = this.getModule(fullPath);
    if (cached) {
      // Merge cached symbols into the global symbol table without duplication
      this.symbolTable.joinWithoutDuplication(cached.symbols!);
      return cached;
    }

    // An import cycle: this module is already being processed further up the stack. Break the
    // recursion and hand back the parsed AST.
    //
    // A cycle is NOT fatal under the module-init ruling (imports bring in definitions, not
    // execution -- see DECISIONS.md), so there is no initialisation-order hazard to guard against.
    // It is reported as a warning rather than an error: the code compiles and runs correctly, but a
    // cycle is usually a design smell and should be visible rather than silent.
    if (this.processing.has(fullPath)) {
      this.reportImportCycle(fullPath);
      return { ast: this.astProvider.getAst(fullPath) as ASTNode };
    }

    this.processing.add(fullPath);
    try {
      return this.processModule(file, fullPath, stopAt);
    } finally {
      this.processing.delete(fullPath);
    }
  }

  /** Report an import cycle. See the guard in process(). */
  private reportImportCycle(fullPath: string): void {
    const ast = this.astProvider.getAst(fullPath) as ASTNode;
    const rule = createRule<ASTNode>()
      .addSeverity(RuleSeverity.Warning)
      .addCode("LL0300")
      .addMessage(
        `Import cycle: '${path.basename(fullPath)}' is imported while it is still being loaded. ` +
          `This compiles -- an import brings in definitions, not execution -- but a cycle is ` +
          `usually a sign the modules want splitting.`
      )
      .addTest(() => true)
      .build();

    this.results.add(ast, rule, this);
  }

  private processModule(
    file: string,
    fullPath: string,
    stopAt: CompilationStage
  ): { ast: ASTNode; symbols?: SymbolTable, code?: string, map?: any } {

    // PARSE STAGE
    this.performanceMetrics.startTimer("parse");
    let ast = this.astProvider.getAst(fullPath) as ASTNode;
    const nodeCount = this.countNodes(ast);
    this.performanceMetrics.endTimer("parse", nodeCount, undefined, { file: fullPath });

    // Store parse stage AST
    if (stopAt === "parse") {
      return { ast: ast as ASTNode };
    }

    // SYNTAX STAGE
    this.performanceMetrics.startTimer("syntax");
    const syntaxRulesVisitor = new SyntaxRulesAstVisitor(this);
    syntaxRulesVisitor.visit(ast as ASTNode);
    this.performanceMetrics.endTimer("syntax", nodeCount, (syntaxRulesVisitor as any).getVisitCount?.() || 0);

    if (this.results.hasErrors) {
      // Deliberately does NOT log here. The CLI (command.transform / command.run) logs whatever
      // is in `results` before exiting 1, and it does so for EVERY stage -- including codegen,
      // which this method never covered. Logging in both places printed every diagnostic twice.
      return { ast: ast as ASTNode };
    }

    // Store syntax stage AST
    if (stopAt === "syntax") {
      return { ast: ast as ASTNode };
    }

    // SYMBOLS STAGE
    this.performanceMetrics.startTimer("symbols");
    const buildDependencyGraphVisitor = new BuildDependencyGraphAstVisitor(this);
    buildDependencyGraphVisitor.visit(ast as ASTNode);

    const buildSymbolTableVisitor = new BuildSymbolTableAstVisitor(this);
    buildSymbolTableVisitor.scanAndResolve(ast as ASTNode);

    const moduleSymbols = buildSymbolTableVisitor.buildSymbolTable();
    this.symbolTable.join(moduleSymbols);
    
    const symbolsVisitCount = ((buildDependencyGraphVisitor as any).getVisitCount?.() || 0) + 
                             ((buildSymbolTableVisitor as any).getVisitCount?.() || 0);
    this.performanceMetrics.endTimer("symbols", nodeCount, symbolsVisitCount, {
      symbolsCount: moduleSymbols.size,
      dependenciesCount: this.dependencyGraph.size
    });
    
    // Cache HERE, as soon as the symbols exist -- not at the end of the method.
    //
    // The cache is what stops a diamond (A -> B,C -> D) from re-processing D, and what makes the
    // `getModule` early-return work. Caching only at the very end meant any stopAt short of
    // "codegen" left the module uncached, which is why imported modules were compiled all the way
    // through codegen and had their output thrown away: it was the only path that cached them.
    this.cacheModule(fullPath, ast as ASTNode, moduleSymbols);

    // Store symbols stage AST and symbols
    if (stopAt === "symbols") {
      return { ast: ast as ASTNode, symbols: moduleSymbols };
    }

    // const inlineImportsVisitor = new InlineImportsAstVisitor(this);
    // ast = inlineImportsVisitor.visit(ast) as ASTNode;

    // DESUGAR STAGE
    this.performanceMetrics.startTimer("desugar");
    const treeShakerVisitor = new TreeShakeAstVisitor(this);
    ast = treeShakerVisitor.visit(ast) as ASTNode;

    const comptimeVisitor = new ComptimeEvaluationAstVisitor(this);
    ast = comptimeVisitor.visit(ast) as ASTNode;
    
    const desugaredNodeCount = this.countNodes(ast);
    const desugarVisitCount = ((treeShakerVisitor as any).getVisitCount?.() || 0) + 
                             ((comptimeVisitor as any).getVisitCount?.() || 0);
    this.performanceMetrics.endTimer("desugar", desugaredNodeCount, desugarVisitCount, {
      nodesRemoved: nodeCount - desugaredNodeCount
    });
    
    // Store desugar stage AST and symbols
    if (stopAt === "desugar") {
      return { ast: ast as ASTNode, symbols: moduleSymbols };
    }

    // TYPES STAGE - Type Inference and Checking
    this.performanceMetrics.startTimer("types");
    const inferTypesVisitor = new InferTypesAstVisitor(this, moduleSymbols);
    inferTypesVisitor.inferTypes(ast);
    const typeEnv = inferTypesVisitor.getTypeEnvironment();

    // TypeCheckingValidatorAstVisitor used to run here. It was deleted: its dispatch built
    // `visit${node._type}` with no capitalisation at all, so even "variable" resolved to
    // `visitvariable` and matched nothing. It did zero work, and because that visit() override
    // also suppressed the inherited child-walk, it never even recursed. Its four visitors
    // duplicated InferAndCheckPass's, so repairing it would only have double-reported. Its one
    // useful part -- `reportTypeError`, the type system's ONLY results.add path -- now lives in
    // InferAndCheckPass, which has the working dispatch and the real checks.
    const typesVisitCount = (inferTypesVisitor as any).getVisitCount?.() || 0;
    
    this.performanceMetrics.endTimer("types", desugaredNodeCount, typesVisitCount, {
      typesInferred: (moduleSymbols as any).countTypedSymbols?.() || 0
    });
    
    // Store types stage AST and symbols (types are now part of symbol table)
    if (stopAt === "types") {
      return { ast: ast as ASTNode, symbols: moduleSymbols };
    }

    if (this.results.hasErrors) {
      // Deliberately does NOT log here. The CLI (command.transform / command.run) logs whatever
      // is in `results` before exiting 1, and it does so for EVERY stage -- including codegen,
      // which this method never covered. Logging in both places printed every diagnostic twice.
      return { ast: ast as ASTNode };
    }

    // METADATA VALIDATION (if enabled)
    if (this.options.validateMetadata) {
      this.performanceMetrics.startTimer("validate-metadata");
      const missingMetadata = moduleSymbols.validateCodegenMetadata();
      
      if (missingMetadata.length > 0) {
        this.log(LogLevel.Error, `Missing codegen metadata for symbols: ${missingMetadata.join(', ')}`);
        if (this.options.strictPhases) {
          throw new Error(`Codegen metadata validation failed. Missing metadata for ${missingMetadata.length} symbols.`);
        } else {
          this.log(LogLevel.Warning, `Codegen will attempt to proceed without complete metadata (non-strict mode)`);
        }
      } else {
        this.log(LogLevel.Debug, `Codegen metadata validation passed for ${moduleSymbols.size} symbols`);
      }
      
      this.performanceMetrics.endTimer("validate-metadata", 0, 0, {
        symbolsValidated: moduleSymbols.size,
        missingMetadata: missingMetadata.length
      });
    }

    if (stopAt !== "codegen") {
      return { ast: ast as ASTNode, symbols: moduleSymbols };
    }

    // CODEGEN STAGE
    this.performanceMetrics.startTimer("codegen");
    let transformer = undefined;
    if (this.options.language === "legacy-js") {
      // Use legacy transformer
      transformer = new JSTransformerAstVisitorLegacy(this);
    } else if (this.options.language === "js") {
      // Use new ESTree-based transformer (default)
      transformer = new JSTransformerAstVisitorEstree(this);
    } else if (this.options.language === "llang") {
      // Use l-lang to l-lang transformer
      transformer = new LlangTransformerAstVisitor(this);
    } else {
      throw new Error(`Unknown compilation target language: '${this.options.language}'`);
    }

    const result = transformer.compile(ast);
    const codegenVisitCount = (transformer as any).getVisitCount?.() || 0;
    
    this.performanceMetrics.endTimer("codegen", desugaredNodeCount, codegenVisitCount, {
      outputSize: result.code?.length || 0,
      language: this.options.language
    });

    return { ast: ast as ASTNode, symbols: moduleSymbols, code: result.code, map: result.map };
  }
}
