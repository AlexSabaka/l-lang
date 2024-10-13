import {
  JSCompilerAstVisitor,
  SyntaxRulesAstVisitor,
  AstVisitorConstructor,
  BuildDependencyGraphAstVisitor,
  SanitizeAstVisitor,
  BuildSymbolTableAstVisitor,
  InferTypesAstVisitor,
  SemanticValidatorAstVisitor,
  RecastAstVisitor,
} from "./visitors";

import { CompilationContext, CompilerOptions, LogLevel } from "./CompilationContext";
import { ASTNode } from "./ast";
import chalk from "chalk";

export default function compile(file: string, options: CompilerOptions) {
  const context = new CompilationContext(file, options);

  const ast = context.astProvider.getAst(file);

  const syntaxRulesVisitor = new SyntaxRulesAstVisitor(context);
  syntaxRulesVisitor.visit(ast as ASTNode);

  context.log(
    LogLevel.Info,
    chalk.red(`${syntaxRulesVisitor.errors} errors`) +
    ", " +
    chalk.yellow(`${syntaxRulesVisitor.warnings} warnings`)
  );

  if (syntaxRulesVisitor.errors > 0) {
    return;
  }

  const buildDependencyGraphVisitor = new BuildDependencyGraphAstVisitor(context);
  buildDependencyGraphVisitor.visit(ast as ASTNode);

  const buildSymbolTableVisitor = new BuildSymbolTableAstVisitor(context);
  buildSymbolTableVisitor.visit(ast as ASTNode);

  const jsCompilerVisitor = new JSCompilerAstVisitor(context);
  return jsCompilerVisitor.compile(ast as ASTNode);

  // const recastVisitor = new RecastAstVisitor(context);
  // return recastVisitor.compile(ast as ASTNode);
}
