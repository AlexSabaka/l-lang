#! /usr/bin/env node

import { Command } from "commander";
import { VERSION as COMPILER_VERSION } from "../compiler";
import { transform } from "./commands/command.transform";
import { evalFile } from "./commands/command.run";
import { repl } from "./commands/command.repl";
import { clean } from "./commands/command.clean";

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
  .option("--language <lang>", "target backend: js (default) or legacy-js")
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
  .command("repl")
  .description("run a l-lang REPL")
  .action(() => repl(program));

program.parse();
