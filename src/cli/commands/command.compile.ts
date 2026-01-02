import fs from "node:fs";
import chalk from "chalk";
import highlight from "cli-highlight";

import { Command } from "commander";

import { getCompilerOptions } from "../getCompilerOptions";
import { Context, LogLevel } from "../../compiler/Context";

const { stdout } = process;

export function compile(file: string, command: Command) {
  const options = getCompilerOptions(command);
  const context = new Context(file, options);

  context.process(file);

  if (context.results.hasErrors) {
    return;
  }

  const js = context.compile(file);

  if (js) {
    if (options.stdout) {
      context.log(LogLevel.Info, chalk.strikethrough.dim(" ".repeat(stdout.columns)));
      context.log(LogLevel.Info, highlight(js.code, { language: "javascript" }));
      context.log(LogLevel.Info, chalk.strikethrough.dim(" ".repeat(stdout.columns)));
    }
    fs.writeFileSync(file.replace(".lisp", ".js"), js.code);
    fs.writeFileSync(file.replace(".lisp", ".lisp.map"), js.map.toString());
  }
}

