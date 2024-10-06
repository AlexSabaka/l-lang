import {
  JSCompilerAstVisitorGptVer,
  AstVisitorConstructor,
  BuildDependencyGraphAstVisitor,
  SanitizeAstVisitor,
  BuildSymbolTableAstVisitor,
  InferTypesAstVisitor,
  SemanticValidatorAstVisitor,
} from "./visitors";

import { CompilationContext, CompilerOptions } from "./CompilationContext";
import { ASTNode } from "./ast";

export default function compile(file: string, options: CompilerOptions) {
  const context = new CompilationContext(file, options);

  const ast = context.astProvider.get(file);

  const compiler = new JSCompilerAstVisitorGptVer(context);

  // context.passes = [
  //   BuildDependencyGraphAstVisitor,
  //   SanitizeAstVisitor,
  //   BuildSymbolTableAstVisitor,
  //   InferTypesAstVisitor,
  //   SemanticValidatorAstVisitor,
  //   JSCompilerAstVisitorGptVer,
  // ];
  // context.process();

  return compiler.compile(ast as ASTNode);
}
