import chalk from "chalk";
import highlight from "cli-highlight";

import { Command } from "commander";

import { Context, LogLevel } from "../../compiler/Context";

import { getCompilerOptions } from "../getCompilerOptions";
import evalInScope from "../../compiler/runtime/evalInScope";

const { stdout } = process;

export function evalFile(
  file: string,
  command: Command) {
  const options = getCompilerOptions(command);
  const context = new Context(file, options);
  const js = context.compile(file);

  if (js) {
    if (options.minimumLogLevel <= LogLevel.Debug) {
      console.log(chalk.strikethrough.dim(" ".repeat(stdout.columns)));
      console.log(highlight(js.code, { language: "javascript" }));
      console.log(chalk.strikethrough.dim(" ".repeat(stdout.columns)));
    }

    evalInScope(js.code);
  }
}
