import path from "path";
import { formatWithOptions } from "util";

import { AstVisitorConstructor, DependencyGraph } from "./visitors";
import { SymbolTable } from "./SymbolTable";
import { AstProvider } from "./AstProvider";

export enum LogLevel { 
  Verbose,
  Debug,
  Info,
  Warning,
  Error,
};

const coloredLogLevel: Record<LogLevel, string> = {
  [0]: "\x1b[90mVerbose\x1b[0m",
  [1]: "\x1b[36mDebug\x1b[0m",
  [2]: "\x1b[96mInfo\x1b[0m",
  [3]: "\x1b[93mWarning\x1b[0m",
  [4]: "\x1b[91mError\x1b[0m",
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
  public passes: AstVisitorConstructor[] = [];
  public results: Map<AstVisitorConstructor, any> = new Map<AstVisitorConstructor, any>();

  constructor(file: string, options: CompilerOptions) {
    this.dependencyGraph = new DependencyGraph(file);
    this.mainModule = path.basename(file, ".lisp");
    this.options = options;
  }

  log(level: LogLevel, msg: any, ...args: any[]) {
    if (level >= this.options.logger.level) {
      const caller = Error().stack?.split('\n')[2].replace(/\s*at\s/gi, '').replace(/\s+\(.*?\)/gi, "");
      const datetime = `\x1b[32m${new Date().toISOString()}\x1b[0m`;
      if (typeof msg === "string") {
        this.options.logger.log!(`${datetime}:${coloredLogLevel[level]}:${caller}: ${msg}`, args);
      } else {
        this.options.logger.log!(`${datetime}:${coloredLogLevel[level]}:${caller}: ${formatWithOptions({ depth: null, colors: true }, msg, args)}`);
      }
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


