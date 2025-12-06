import * as ast from "../ast";
import { LogLevel } from "../Context";
import { BaseAstTreeWalker } from "./BaseAstTreeWalker";
import path from "node:path";

export class BuildDependencyGraphAstVisitor extends BaseAstTreeWalker {

  visitImport(node: ast.ImportNode) {
    node.imports.forEach((i) => this.processImport(i, node._location.source ?? ""));
  }

  private processImport(import_: ast.ImportDefinition, currentFile: string) {
    if (ast.isFileImportSource(import_.source)) {
      this.processFileImport(import_.source.file.value, currentFile);
    } else {
      this.processNamespaceImport(import_.source.namespace.id, currentFile);
    }
  }

  private processFileImport(file: string, currentFile: string) {
    const currentUnit = this.context.dependencyGraph.find(currentFile);
    const resolvedFile = path.resolve(path.dirname(currentFile), file);
    this.context.process(resolvedFile);
    this.context.dependencyGraph.add(resolvedFile, currentFile, this.context);
  }

  private processNamespaceImport(ns: string, currentFile: string) {
    this.context.log!(LogLevel.Error, `Namespace import ${ns} is not supported yet`);
  }
};
