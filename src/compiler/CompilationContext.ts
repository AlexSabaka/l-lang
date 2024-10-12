import chalk from "chalk";
import path from "path";
import { formatWithOptions } from "util";

import { AstVisitorConstructor, DependencyGraph } from "./visitors";
import { SymbolTable } from "./SymbolTable";
import { AstProvider } from "./AstProvider";


export function caller(): string {
  return Error().stack?.split('\n')[2].replace(/\s*at\s/gi, '').replace(/\s+\(.*?\)/gi, "") ?? "";
}

function formatLogMessage(level: LogLevel, msg: any)  {

  const coloredLogLevel: Record<LogLevel, string> = {
    [LogLevel.Verbose]: chalk.gray("Verbose"),
    [LogLevel.Debug]: chalk.cyan("Debug"),
    [LogLevel.Info]: chalk.green("Info"),
    [LogLevel.Warning]: chalk.yellow("Warning"),
    [LogLevel.Error]: chalk.red("Error"),
  }

  const datetime = ""; // chalk.green(new Date().toISOString());

  return typeof msg === "string"
    ? `${datetime}${coloredLogLevel[level]}: ${msg}`
    : `${datetime}${coloredLogLevel[level]}: ${formatWithOptions({ depth: null, colors: true }, msg)}`;
}

export const VERSION = "0.0.1";


export enum LogLevel { 
  Verbose,
  Debug,
  Info,
  Warning,
  Error,
};

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
  public passes: AstVisitorConstructor[] = [];
  public results: Map<AstVisitorConstructor, any> = new Map<AstVisitorConstructor, any>();

  constructor(file: string, options: CompilerOptions) {
    this.dependencyGraph = new DependencyGraph(file);
    this.mainModule = path.basename(file, ".lisp");
    this.options = options;
  }

  log(level: LogLevel, msg: any) {
    if (level >= this.options.logger.level) {
      this.options.logger.log!(formatLogMessage(level, msg));
    }
  }

  process() {
    for (let pass of this.passes) {
      const visitor = new pass(this.mainModule, this);
      const ast = this.astProvider.get("");
      const passResult = visitor.visit(ast!);
      this.results.set(pass, passResult);
    }
  }

  // Returns last compilation pass result 
  result() {
    return Array(this.results.values()).at(-1);
  }
}


