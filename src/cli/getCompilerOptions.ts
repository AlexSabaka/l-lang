import fs from "node:fs";
import { Command } from "commander";
import { CompilerOptions, LogLevel } from "../compiler/Context";

function createFileLogger(file: string) {
  const stream = fs.createWriteStream(file, { flags: "a" });
  return (...data: any[]) => stream.write(`${data.join(" ")}\n`);
}

export function getCompilerOptions(
  command: Command
): CompilerOptions {
  const opts = command.opts()
  const logLevel = opts.logLevel ?? opts.verbose
      ? LogLevel.Verbose
      : opts.debug
      ? LogLevel.Debug
      : opts.silent
      ? LogLevel.Error
    : LogLevel.Warning;
  return {
    minimumLogLevel: logLevel,
    logger: opts.logFile ? createFileLogger(opts.logFile) : console.log,
    legacy: !!opts.legacyJs,
    includeRuntimeShim: false,
    stdout: false,
  };
}
