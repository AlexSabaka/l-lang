import * as ast from "../ast";
import { LogLevel } from "../CompilationContext";
import { BaseAstTreeWalker } from "./BaseAstTreeWalker";

export class BuildDependencyGraphAstVisitor extends BaseAstTreeWalker {

  visitExport(node: ast.ExportNode) {
    const currentUnit = this.context.dependencyGraph.find(node._location.source ?? "");
    
  }

  visitImport(node: ast.ImportNode) {
    node.imports.forEach((i) => this.processImport(i, node._location.source ?? ""));
  }

  private processImport(import_: ast.ImportDefinition, currentFile: string) {
    if (import_.source.file) {
      this.processFileImport(import_.source.file.value, currentFile);
    } else if (import_.source.namespace) {
      this.processNamespaceImport(import_.source.namespace.id, currentFile);
    } else {
      throw new Error("Somehow we ended up here ¯\\_(ツ)_/¯");
    }
  }

  private processFileImport(file: string, currentFile: string) {
    const currentUnit = this.context.dependencyGraph.find(currentFile);
    this.context.process(file, currentUnit?.name.baseDir);
    this.context.dependencyGraph.add(file, currentFile);
  }

  private processNamespaceImport(ns: string, currentFile: string) {
    this.context.log!(LogLevel.Error, `Namespace import ${ns} is not supported yet`);
  }
};
