import path from "node:path";

import { RuleValidationResultsCollection } from "./rules";

import {
  BuildDependencyGraphAstVisitor,
  BuildSymbolTableAstVisitor,
  SyntaxRulesAstVisitor,
} from "./index";

import {
  JSTransformerAstVisitorLegacy,
  JSTransformerAstVisitorEstree
} from "./codegen";

import { ASTNode } from "./frontend/ast";
import { SymbolTable } from "./analysis/SymbolTable";
import { AstProvider } from "./frontend/AstProvider";
import { DependencyGraph } from "./analysis/DependencyGraph";
import { formatLogMessage } from "./utils";

export const VERSION = "0.0.1";

export enum LogLevel {
  Verbose,
  Debug,
  Info,
  Warning,
  Error,
}

export interface CompilerOptions {
  logger?: (msg: any, ...args: any[]) => void;
  minimumLogLevel: LogLevel;
  includeRuntimeShim: boolean;
  stdout: boolean;
  legacy: boolean;
}

export interface PassPerformanceMetrics {
  time: number;
  memory: number;
  additional?: Record<string, object>;
}

export class PerformanceMetrics {
  private metrics: Map<string, PassPerformanceMetrics> = new Map();

  add(name: string, time: number, memory: number, additional?: Record<string, object>) {
    this.metrics.set(name, { time, memory, additional });
  }

  get totalTime(): number {
    return Array.from(this.metrics.values())
      .reduce((acc, curr) => acc + curr.time, 0);
  }

  get totalMemory(): number {
    return Array.from(this.metrics.values())
      .reduce((acc, curr) => acc + curr.memory, 0);
  }
}

export class Context {
  public mainModule: string;
  public options: CompilerOptions;
  public dependencyGraph: DependencyGraph;
  public astProvider: AstProvider = new AstProvider();
  public symbolTable: SymbolTable = new SymbolTable(undefined);
  public performanceMetrics: PerformanceMetrics =
    new PerformanceMetrics();
  public results: RuleValidationResultsCollection =
    new RuleValidationResultsCollection();
  
  // Module cache: prevents loading the same module multiple times
  // Map<AbsolutePath, ModuleData>
  private moduleCache: Map<string, { ast: ASTNode; symbols: SymbolTable }> = new Map();

  constructor(mainFile: string, options: CompilerOptions) {
    this.dependencyGraph = new DependencyGraph(mainFile);
    this.mainModule = path.basename(mainFile, ".lisp");
    this.options = options;
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
   * Get cache hit count (for optimization metrics)
   */
  getModuleCacheSize(): number {
    return this.moduleCache.size;
  }

  log(level: LogLevel, msg: any, caller?: string) {
    if (level >= this.options.minimumLogLevel) {
      this.options.logger?.call(null, formatLogMessage(level, msg, caller));
    }
  }

  process(file: string): { ast: ASTNode; symbols?: SymbolTable } {
    const fullPath = path.resolve(file);

    // If module already processed and cached, reuse its symbol table
    const cached = this.getModule(fullPath);
    if (cached) {
      // Merge cached symbols into the global symbol table without duplication
      this.symbolTable.joinWithoutDuplication(cached.symbols!);
      return cached;
    }

    const ast = this.astProvider.getAst(fullPath) as ASTNode;

    const syntaxRulesVisitor = new SyntaxRulesAstVisitor(this);
    syntaxRulesVisitor.visit(ast as ASTNode);

    if (this.results.hasErrors) {
      return { ast: ast as ASTNode };
    }

    const buildDependencyGraphVisitor = new BuildDependencyGraphAstVisitor(this);
    buildDependencyGraphVisitor.visit(ast as ASTNode);

    const buildSymbolTableVisitor = new BuildSymbolTableAstVisitor(this);
    buildSymbolTableVisitor.scanAndResolve(ast as ASTNode);

    const moduleSymbols = buildSymbolTableVisitor.buildSymbolTable();
    this.symbolTable.join(moduleSymbols);

    this.cacheModule(fullPath, ast as ASTNode, moduleSymbols);
  
    return  { ast: ast as ASTNode, symbols: moduleSymbols };
  }

  compile(file: string) {
    const fullPath = path.resolve(file);

    // If module already processed and cached, reuse its symbol table
    let cached = this.getModule(fullPath);
    if (!cached) {
      cached = this.process(file);
    }

    let ast = cached.ast as ASTNode;

    let transformer: JSTransformerAstVisitorEstree | JSTransformerAstVisitorLegacy | undefined = undefined;
    if (this.options.legacy) {
      // Use legacy transformer
      transformer = new JSTransformerAstVisitorLegacy(this);
    } else {
      // Use new ESTree-based transformer (default)
      transformer = new JSTransformerAstVisitorEstree(this);
    }

    const result = transformer.compile(ast);

    return result;
  }
}
