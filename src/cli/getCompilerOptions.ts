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
  const opts = command.opts();

  // Determine minimum log level. If --log-level is provided, parse it (case-insensitive).
  // Otherwise, fall back to flags (--verbose, --debug, --silent) and then to Warning.
  let logLevel: LogLevel = LogLevel.Warning;

  if (opts.logLevel) {
    const val = String(opts.logLevel).toLowerCase();
    switch (val) {
      case "verbose":
      case "v":
        logLevel = LogLevel.Verbose;
        break;
      case "debug":
      case "d":
        logLevel = LogLevel.Debug;
        break;
      case "info":
      case "i":
        logLevel = LogLevel.Info;
        break;
      case "warning":
      case "warn":
      case "w":
        logLevel = LogLevel.Warning;
        break;
      case "error":
      case "e":
      case "silent":
        logLevel = LogLevel.Error;
        break;
      default:
        // Unknown value: warn and default to Warning
        // Note: Using console.warn directly because logger may not yet be configured.
        console.warn(`Unknown log level '${opts.logLevel}', defaulting to 'Warning'`);
        logLevel = LogLevel.Warning;
    }
  } else if (opts.verbose) {
    logLevel = LogLevel.Verbose;
  } else if (opts.debug) {
    logLevel = LogLevel.Debug;
  } else if (opts.silent) {
    logLevel = LogLevel.Error;
  }

  return {
    minimumLogLevel: logLevel,
    logger: opts.logFile ? createFileLogger(opts.logFile) : console.log,
    language: opts.language || "js",
    stage: opts.stage || "codegen",
    includeRuntimeShim: opts.runtimeShim !== undefined ? !!opts.runtimeShim : true, // default to true
    stdout: !!opts.stdout,
  };
}
