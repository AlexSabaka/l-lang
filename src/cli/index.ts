#! /usr/bin/env node

import { Command } from "commander";
import { VERSION as COMPILER_VERSION } from "../compiler";
import { transform } from "./commands/command.transform";
import { run } from "./commands/command.run";
import { repl } from "./commands/command.repl";
import { clean } from "./commands/command.clean";

const program = new Command();

program
  .name("l-lang compiler")
  .description("A l-lang compiler")
  // Honoured by `transform` only; `run` builds its C artifacts in a private temp directory and
  // removes them, so it has nothing to place and nothing to clobber (D104).
  .option("-o, --output <dir>", "output directory (default: the input file's directory)")
  .option("-L, --log-level <level>", "log level")
  .option("-l, --log-file <file>", "log file")
  // TODO: watch mode is not working
  .option("-w, --watch", "watch for changes and recompile")
  // TODO: CollectTypesPass and InferTypesAstVisitor dominate the debug log. No other contributors.
  .option("-d, --debug", "debug mode")
  .option("-s, --silent", "silent mode")
  .option("--backend <lang>", "target backend: c (default), js (deprecated oracle), llang")
  .option("--language <lang>", "alias for --backend")
  .option(
    "-I, --lib <dir>",
    "add a library search root for `(import \"std/...\")` (repeatable). The shipped lib/ is always searched.",
    (dir: string, acc: string[]) => acc.concat(dir),
    [] as string[]
  )
  .option("--no-map", "disable source map generation (--backend js only; C emits no map)")
  .option("--stdin", "read input from stdin (or pipe) instead of a file")
  .option("--stdout", "print the compiled output to stdout")
  .option("--runtime-shim", "include runtime shim in compiled output (--backend js only)")
  .option("--stage <stage>", "compilation stage to stop at (parse, syntax, symbols, desugar, types, codegen)")
  .option("--perf", "enable performance metrics and reporting")
  .option("--strict-phases", "enforce strict separation between compilation phases")
  .option("--short-errors", "shorten error messages to a single line")
  .option("--validate-metadata", "validate completeness of type metadata before codegen")
  .version(COMPILER_VERSION);

program
  .command("clean")
  .description("Cleans l-lang build files")
  .argument("<folder>", "Folder path to clean up")
  .action((folder) => clean(folder, program));

program
  .command("transform")
  .description("transform a l-lang file (parse, compile, or intermediate stages)")
  .argument("[file]", "l-lang file to transform")
  .action((file) => transform(file, program));

program
  .command("parse")
  .description("parse a l-lang file to an AST (alias for 'transform --stage parse')")
  .argument("<file>", "l-lang file to parse")
  .option("--stage <stage>", "override stage")
  .action((file, opts) => {
    program.opts().stage = opts.stage || "parse";
    transform(file, program);
  });

program
  .command("run")
  .description("run a l-lang file")
  .argument("[file]", "the l-lang file to run")
  .action((file) => run(file, program));

program
  .command("repl")
  .description("run a l-lang REPL")
  .action(() => repl(program));

program.parse();
