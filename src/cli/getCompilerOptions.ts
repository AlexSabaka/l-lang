import fs from "node:fs";
import { Command } from "commander";
import {
  CompilerOptions,
  CompilationLanguage,
  LogLevel,
} from "../compiler/Context";
import { ModuleResolver } from "../compiler/analysis/ModuleResolver";

const VALID_LANGUAGES: CompilationLanguage[] = ["js", "llang", "c"];

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

  // `--backend` is the preferred spelling; `--language` is kept as the historical alias. Commander
  // stores them under separate keys, so both must be read or the newer flag silently does nothing.
  const requested = opts.backend || opts.language;
  const language: CompilationLanguage = requested || "js";
  if (!VALID_LANGUAGES.includes(language)) {
    throw new Error(
      `Invalid --backend '${requested}'. Valid values are: ${VALID_LANGUAGES.join(", ")}`
    );
  }

  // `-I` APPENDS to the shipped lib/, it does not replace it. Passing `libPaths: []` would silently
  // switch the stdlib off, so an absent flag must stay `undefined` and let Context take the default.
  const extraLibs: string[] = Array.isArray(opts.lib) ? opts.lib : [];
  const libPaths = extraLibs.length
    ? [...ModuleResolver.defaultLibPaths(), ...extraLibs]
    : undefined;

  return {
    minimumLogLevel: logLevel,
    logger: opts.logFile ? createFileLogger(opts.logFile) : console.log,
    language,
    libPaths,
    stage: opts.stage || "codegen",
    includeRuntimeShim: opts.runtimeShim !== undefined ? !!opts.runtimeShim : true, // default to true
    stdout: !!opts.stdout,
    stdin: !!opts.stdin,
    perf: !!opts.perf,
    // commander stores `--no-map` as `opts.map === false` (the negated `map` key), not `opts.noMap`.
    noMap: opts.map === false,
    strictPhases: !!opts.strictPhases,
    validateMetadata: !!opts.validateMetadata,
  };
}
