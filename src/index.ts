import chalk from "chalk";
import fs from "node:fs";
import { highlight } from "cli-highlight";
import { Command } from "commander";

import {
  LogLevel,
  VERSION as COMPILER_VERSION,
  parse,
  compile,
  lib,
  evalSource,
  evalFile,
} from "./compiler";
import { ASTNode } from "./compiler/ast";
import { JSCompilerAstVisitor } from "./compiler/visitors";

const program = new Command();

program
  .name("l-lang compiler")
  .description("A l-lang (Lisp dialect) JavaScript compiler")
  .version(COMPILER_VERSION);

program
  .command("compile")
  .description("compile a l-lang file")
  .argument("<file>", "l-lang file to compile")
  .argument("[log]", "log level", LogLevel.Warning)
  .argument("[output]", "output file")
  .action((file, logLevel, output) => {
    const js = compile(file, {
      logger: {
        level: logLevel,
        log: console.log,
      },
    });

    const outputFile = output ?? file.replace(/\.\w+$/, ".js");
    if (js) {
      fs.writeFileSync(outputFile, js);
    }
  });

program
  .command("parse")
  .description("parse a l-lang file to an AST")
  .argument("<file>", "l-lang file to parse")
  .argument("[log]", "log level", LogLevel.Warning)
  .argument("[output]", "output file")
  .action((file, logLevel, output) => {
    const ast = parse(file, {
      logger: {
        level: logLevel,
        log: console.log,
      },
    });

    const outputFile = output ?? file.replace(/\.\w+$/, ".ast.json");
    fs.writeFileSync(
      outputFile,
      JSON.stringify(
        ast,
        (k, v) => (k === "_location" || k === "_parent" ? undefined : v),
        2
      )
    );
  });

program
  .command("run")
  .description("run a l-lang file")
  .argument("<file>", "the l-lang file to run")
  .argument("[log]", "log level", LogLevel.Warning)
  .action((file, logLevel) => {
    evalFile(file, {
      logger: {
        level: logLevel,
        log: console.log,
      },
    });
  });

program
  .command("repl")
  .description("run a l-lang REPL")
  .action(() => {
    let input = "";
    let indent = 0;
    process.stdout.write("> ");
    process.stdin.on("data", (data) => {
      input = input !== "" ? input + data.toString() : data.toString();
      const balance = checkBracketsBalance(input);
      if (typeof balance === "number") {
        indent = 4 * balance;
      } else {
        indent = 0;
      }

      if (indent > 0) {
        process.stdout.write(chalk.dim(".".repeat(indent)));
        return;
      }

      evalSource(input, {
        logger: {
          level: LogLevel.Warning,
          log: console.log,
        },
      });

      process.stdout.write("> ");
    });
  });

program.parse();


function checkBracketsBalance(code: string): boolean | number {
  const stack = [];
  const brackets = { "(": ")", "[": "]", "{": "}" };
  for (const char of code) {
    if (char === "(" || char === "[" || char === "{") {
      stack.push(brackets[char]);
    } else if (char === ")" || char === "]" || char === "}") {
      if (stack.length === 0) {
        return stack.length;
      }
      if (stack.pop() !== char) {
        return stack.length;
      }
    }
  }
  return !stack.length ? true : stack.length;
}
