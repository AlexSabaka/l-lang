#! /usr/bin/env node

import { Command } from "commander";
import { VERSION as COMPILER_VERSION } from "./compiler";
import { repl, compile, parse, evalFile } from "./compiler/tools";

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
  .version(COMPILER_VERSION);

program
  .command("compile")
  .description("compile a l-lang file")
  .argument("<file>", "l-lang file to compile")
  .action((file) => compile(file, program));

program
  .command("parse")
  .description("parse a l-lang file to an AST")
  .argument("<file>", "l-lang file to parse")
  .action((file) => parse(file, program));

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
