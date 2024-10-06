import path from "path";
import * as ast from "../ast";
import { BaseAstVisitor } from "./BaseAstVisitor";
import { LogLevel } from "../CompilationContext";

export interface ImportUnit {
  path: string;
  moduleName: string;
  dependencies: ImportUnit[];
}

export class DependencyGraph {
  public rootUnit: ImportUnit;
  constructor(public rootFile: string) {
    this.rootUnit = {
      path: path.resolve(rootFile),
      moduleName: path.basename(rootFile).split(".")[0],
      dependencies: [],
    };
  }
}

export class BuildDependencyGraphAstVisitor extends BaseAstVisitor {
  visitProgram(node: ast.ProgramNode) {
    node.program.map(x => this.visit(x));
  }

  visitImport(node: ast.ImportNode) {
    this.context.log(LogLevel.Warning, "Warning log message...");
    this.context.log(LogLevel.Error, "Error log message...");
    this.context.log(LogLevel.Info, "Info log message...");
    this.context.log(LogLevel.Debug, "Debug log message...");
    this.context.log(LogLevel.Verbose, "Verbose log message...");
  }

  visitList(node: ast.ListNode): void {
    node.nodes.map(x => this.visit(x));
  }
};