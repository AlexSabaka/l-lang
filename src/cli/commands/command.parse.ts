import chalk from "chalk";
import fs from "node:fs";

import { Command } from "commander";

import { Context, LogLevel } from "../../compiler/Context";

import { getCompilerOptions } from "../getCompilerOptions";
import { logCompilationMessages } from "../logCompilationMessages";
import { ASTNode } from "../../compiler/frontend/ast";
import { DesugarAstVisitor, InlineImportsAstVisitor } from "../../compiler/transformation";

export function parse(file: string, command: Command) {
  const options = getCompilerOptions(command);
  const context = new Context(file, options);

  let { ast } = context.process(file);

  const { errors } = logCompilationMessages(context);
  
  if (errors > 0) {
    return;
  }

  const inlineImportsVisitor = new InlineImportsAstVisitor(context);
  ast = inlineImportsVisitor.visitProgram(ast as any) as ASTNode;

  const desugarVisitor = new DesugarAstVisitor(context);
  ast = desugarVisitor.visitProgram(ast as any) as ASTNode;

  if (options.stdout) {
    const trimmedAst = JSON.parse(
      JSON.stringify(
        ast,
        (k, v) => (k === "_location" || k === "_parent" ? undefined : v)
      ));
    context.log(LogLevel.Info, trimmedAst);
  }

  fs.writeFileSync(
    file.replace(".lisp", ".ast.json"),
    JSON.stringify(
      ast,
      (k, v) => (k === "_location" || k === "_parent" ? undefined : v),
      2
    )
  );
}
