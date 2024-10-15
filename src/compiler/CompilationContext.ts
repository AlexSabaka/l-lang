import chalk from "chalk";
import path from "node:path";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { formatWithOptions } from "util";

import {
  RuleSeverity,
  RuleValidationResultsCollection
} from "./rules";

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

import * as lib from "./lib";

import { ASTNode } from "./ast";
import { SymbolTable } from "./SymbolTable";
import { AstProvider } from "./AstProvider";
import { DependencyGraph } from "./DependencyGraph";
import highlight from "cli-highlight";

export const VERSION = "0.0.1";

export function getCaller(offset: number = 1): string {
  return (
    Error()
      .stack?.split("\n")[offset]
      .replace(/\s*at\s/gi, "")
      .replace(/\s+\(.*?\)/gi, "") ?? ""
  );
}

function formatLogMessage(level: LogLevel, msg: any, caller?: string) {
  const coloredLogLevel = {
    [LogLevel.Verbose]: chalk.gray,
    [LogLevel.Debug]: chalk.cyan,
    [LogLevel.Info]: chalk.green,
    [LogLevel.Warning]: chalk.yellow,
    [LogLevel.Error]: chalk.red,
  };

  const datetime = ""; // chalk.green(new Date().toISOString());

  return typeof msg === "string"
    ? `${datetime}${coloredLogLevel[level](`${LogLevel[level].padEnd(7)} from ${caller ?? getCaller(4)}`)}: ${msg}`
    : `${datetime}${coloredLogLevel[level](`${LogLevel[level].padEnd(7)} from ${caller ?? getCaller(4)}`)}: ${formatWithOptions(
        { depth: null, colors: true },
        msg
      )}`;
}

export enum LogLevel {
  Verbose,
  Debug,
  Info,
  Warning,
  Error,
}

export interface CompilerOptions {
  logger: CompilerLogger;
}

export interface CompilerLogger {
  log?: (msg: any, ...args: any[]) => void;
  level: LogLevel;
}

export class CompilationContext {
  public mainModule: string;
  public options: CompilerOptions;
  public dependencyGraph: DependencyGraph;
  public astProvider: AstProvider = new AstProvider();
  public symbolTable: SymbolTable = new SymbolTable();
  public results: RuleValidationResultsCollection =
    new RuleValidationResultsCollection();

  constructor(file: string, options: CompilerOptions) {
    this.dependencyGraph = new DependencyGraph(file);
    this.mainModule = path.basename(file, ".lisp");
    this.options = options;
  }

  log(level: LogLevel, msg: any, caller?: string) {
    if (level >= this.options.logger.level) {
      this.options.logger.log!(formatLogMessage(level, msg, caller));
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


function printMessages(context: CompilationContext) {
  const all = context.results.all.sort((a, b) => a.line - b.line);

  const logLevel = {
    [RuleSeverity.Error]: LogLevel.Error,
    [RuleSeverity.Warning]: LogLevel.Warning,
    [RuleSeverity.Message]: LogLevel.Info,
    [RuleSeverity.None]: LogLevel.Info,
  };

  let errors = 0, warnings = 0, messages = 0;
  all.forEach((error) => {
    context.log(logLevel[error.severity], error.message);

    errors += error.severity === RuleSeverity.Error ? 1 : 0;
    warnings += error.severity === RuleSeverity.Warning ? 1 : 0;
    messages += error.severity === RuleSeverity.Message ? 1 : 0;
  });

  context.log(
    LogLevel.Info,
    chalk.red(`${errors} errors`) +
    ", " +
    chalk.yellow(`${warnings} warnings`) +
    ", " +
    chalk.blueBright(`${messages} messages`),
    getCaller(3)
  );

  return { errors, warnings, messages} as const;
}

export function parse(file: string, options: CompilerOptions) {
  const context = new CompilationContext(file, options);

  context.process(file);

  const { errors } = printMessages(context);

  if (errors > 0) {
    return;
  }

  return context.astProvider.getAst(file) as ASTNode;
}

export function compile(file: string, options: CompilerOptions) {
  const context = new CompilationContext(file, options);

  context.process(file);

  const { errors } = printMessages(context);

  if (errors > 0) {
    return;
  }

  const jsCompilerVisitor = new JSCompilerAstVisitor(context);
  return jsCompilerVisitor.compile(context.astProvider.getAst(file) as ASTNode);

  // const recastVisitor = new RecastAstVisitor(context);
  // return recastVisitor.compile(ast as ASTNode);
}

export function evalFile(file: string, options: CompilerOptions) {
  const js = compile(file, options);

  if (js) {
    console.log(chalk.underline.dim(" ".repeat(process.stdout.columns)));
    console.log(highlight(js!, { language: "javascript" }));
    console.log(chalk.underline.dim(" ".repeat(process.stdout.columns)));

    lib.evalInScope(js, lib.globalScope);
  }

  fs.rmSync(file);
}

export function evalSource(source: string, options: CompilerOptions) {
  const file = path.resolve(tmpdir(), `tmp-llang-${Date.now()}.lisp`);
  fs.writeFileSync(file, source);

  const js = compile(file, options);

  if (js) {
    lib.evalInScope(js, lib.globalScope);
  }

  fs.rmSync(file);
}