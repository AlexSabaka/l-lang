#! /usr/bin/env node

import { Command } from "commander";
import { VERSION as COMPILER_VERSION } from "../compiler";
import { transform } from "./commands/command.transform";
import { evalFile } from "./commands/command.run";
import { repl } from "./commands/command.repl";
import { clean } from "./commands/command.clean";
import { parseV2 } from "./commands/command.parseV2";

const program = new Command();

program
  .name("l-lang compiler")
  .description("A l-lang (Lisp dialect) JavaScript compiler")
  .option("-o, --output <file>", "output file")
  .option("-L, --log-level <level>", "log level")
  .option("-l, --log-file <file>", "log file")
  .option("-w, --watch", "watch for changes and recompile")
  .option("-d, --debug", "debug mode")
  .option("-s, --silent", "silent mode")
  .option("--language <lang>", "target backend: js (default), llang, c")
  .option(
    "-I, --lib <dir>",
    "add a library search root for `(import \"std/...\")` (repeatable). The shipped lib/ is always searched.",
    (dir: string, acc: string[]) => acc.concat(dir),
    [] as string[]
  )
  .option("--stdout", "output compiled JavaScript to stdout")
  .option("--runtime-shim", "include runtime shim in compiled output")
  .option("--stage <stage>", "compilation stage to stop at (parse, syntax, symbols, desugar, types, codegen)")
  .option("--perf", "enable performance metrics and reporting")
  .option("--strict-phases", "enforce strict separation between compilation phases")
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
  .argument("<file>", "l-lang file to transform")
  .action((file) => transform(file, program));

program
  .command("compile")
  .description("compile a l-lang file to JavaScript (alias for 'transform')")
  .argument("<file>", "l-lang file to compile")
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
  .argument("<file>", "the l-lang file to run")
  .action((file) => evalFile(file, program));

program
  .command("parse-v2")
  .description("parse a l-lang file with the grammar_v2 (Chevrotain) frontend -- not the default parser, for inspection only")
  .argument("<file>", "l-lang file to parse")
  .action((file) => parseV2(file));

program
  .command("repl")
  .description("run a l-lang REPL")
  .action(() => repl(program));

program.parse();
