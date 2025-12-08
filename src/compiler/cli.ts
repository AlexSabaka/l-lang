import fs from "node:fs";
import { CompilerOptions, Context, LogLevel } from "./Context";
import { Command } from "commander";


export interface CLICompilerOptions {
  output?: string;
  watch?: boolean;
  debug?: boolean;
  silent?: boolean;
  verbose?: boolean;
  version?: boolean;
  logLevel?: LogLevel;
  logFile?: string;
}

export function createFileLogger(file: string) {
  const stream = fs.createWriteStream(file, { flags: "a" });
  return (...data: any[]) => stream.write(`${data.join(" ")}\n`);
}

export function getCompilerOptions(
  command: Command,
  input?: string,
  ext?: string
): CompilerOptions {
  const opts = command.opts() as CLICompilerOptions;
  const logLevel = LogLevel.Debug;
    // opts.logLevel ?? opts.verbose
    //   ? LogLevel.Verbose
    //   : opts.debug
    //   ? LogLevel.Debug
    //   : opts.silent
    //   ? LogLevel.Error
    // : LogLevel.Warning;
  return {
    minimumLogLevel: logLevel,
    logger: opts.logFile ? createFileLogger(opts.logFile) : console.log,
    includeRuntimeShim: false,
    outputFile: opts.output ?? input?.replace(/\.\w+$/, ext ?? ".js"),
  };
}
