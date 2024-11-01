import path from "node:path";

import { RuleValidationResultsCollection } from "./rules";

import {
  BuildDependencyGraphAstVisitor,
  BuildSymbolTableAstVisitor,
  SyntaxRulesAstVisitor,
  JSCompilerAstVisitor,
  AstVisitorConstructor,
  TreeShakeAstVisitor,
  InferTypesAstVisitor,
  SemanticValidatorAstVisitor,
  RecastAstVisitor,
} from "./visitors";

import { ASTNode } from "./ast";
import { SymbolTable } from "./SymbolTable";
import { AstProvider } from "./AstProvider";
import { DependencyGraph } from "./DependencyGraph";
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
  outputFile?: string;
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
  public symbolTable: SymbolTable = new SymbolTable();
  public performanceMetrics: PerformanceMetrics =
    new PerformanceMetrics();
  public results: RuleValidationResultsCollection =
    new RuleValidationResultsCollection();

  constructor(file: string, options: CompilerOptions) {
    this.dependencyGraph = new DependencyGraph(file);
    this.mainModule = path.basename(file, ".lisp");
    this.options = options;
  }

  log(level: LogLevel, msg: any, caller?: string) {
    if (level >= this.options.minimumLogLevel) {
      this.options.logger?.call(null, formatLogMessage(level, msg, caller));
    }
  }

  process(file: string, basedir?: string) {
    const ast = this.astProvider.getAst(file, basedir);
    return this.processAst(ast as ASTNode);
  }

  private processAst(ast: ASTNode) {
    const syntaxRulesVisitor = new SyntaxRulesAstVisitor(this);
    syntaxRulesVisitor.visit(ast as ASTNode);

    if (this.results.hasErrors) {
      return;
    }

    const buildDependencyGraphVisitor = new BuildDependencyGraphAstVisitor(this);
    buildDependencyGraphVisitor.visit(ast as ASTNode);

    const buildSymbolTableVisitor = new BuildSymbolTableAstVisitor(this);
    buildSymbolTableVisitor.visit(ast as ASTNode);

    return this;
  }
}
