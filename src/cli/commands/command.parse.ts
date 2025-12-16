import chalk from "chalk";
import fs from "node:fs";

import { Command } from "commander";

import { Context, LogLevel } from "../../compiler/Context";

import { getCompilerOptions } from "../getCompilerOptions";
import { LlangTransformerAstVisitor } from "../../compiler";

export function parse(file: string, command: Command) {
  const options = getCompilerOptions(command);
  const context = new Context(file, options);

  let { ast } = context.process(file);

  if (context.results.hasErrors) {
    return;
  }

  // const llangTranspiler = new LlangTransformerAstVisitor(context);
  // const output =llangTranspiler.visit(ast);
  const output = JSON.stringify(
    ast,
    (k, v) => (k === "_location" || k === "_parent" ? undefined : v),
    2
  );

  if (options.stdout) {
    const trimmedAst = JSON.parse(output);
    context.log(LogLevel.Info, trimmedAst);
  }

  fs.writeFileSync(
    file.replace(".lisp", ".ast.json"),
    output
  );
}
