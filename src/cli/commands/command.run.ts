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

  const { code } = context.process(file, "codegen");

  if (context.results.hasErrors) {
    process.exitCode = 1;
    return;
  }

  // Output performance report if enabled
  if (options.perf) {
    console.log(context.getPerformanceReport());
  }

  if (code) {
    if (options.stdout) {
      context.log(LogLevel.Info, chalk.strikethrough.dim(" ".repeat(stdout.columns)));
      console.log(highlight(code, { language: "javascript" }));
      context.log(LogLevel.Info, chalk.strikethrough.dim(" ".repeat(stdout.columns)));
    }
    evalInScope(code);
  }
}
