#! /usr/bin/env node

import { Command } from "commander";
import { VERSION as COMPILER_VERSION } from "../compiler";
import { parse } from "./commands/command.parse";
import { compile } from "./commands/command.compile";
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
  .option("--legacy-js", "use legacy JS transpiler")
  .option("--output-js", "output compiled JavaScript to stdout")
  .option("--runtime-shim", "include runtime shim in compiled output")
  .version(COMPILER_VERSION);

program
  .command("clean")
  .description("Cleans l-lang build files")
  .argument("<folder>", "Folder path to clean up")
  .action((folder) => clean(folder, program));

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
