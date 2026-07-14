import * as ast from "../../frontend/ast";
import { BaseAstTreeWalker } from "../../BaseAstTreeWalker";
import { createRule, RuleSeverity } from "../../rules/RuleBuilder";
import { ModuleResolver } from "../ModuleResolver";

export class BuildDependencyGraphAstVisitor extends BaseAstTreeWalker {

  visitImport(node: ast.ImportNode) {
    node.imports.forEach((i) => this.processImport(i, node, node._location.source ?? ""));
  }

  private processImport(import_: ast.ImportDefinition, node: ast.ImportNode, currentFile: string) {
    if (ast.isFileImportSource(import_.source)) {
      // The STRING NODE, not just its value. `FileImportSource.file` is a real StringNode with a
      // `_location`, so a diagnostic lands on the offending literal rather than on the whole
      // `(import …)` form. (`ImportDefinition` itself is a plain object -- no `_type`, no
      // `_location` -- so it cannot carry one.)
      this.processFileImport(import_.source.file, node, currentFile);
    } else {
      this.processNamespaceImport(import_.source.namespace, node);
    }
  }

  private processFileImport(fileNode: ast.StringNode, node: ast.ImportNode, currentFile: string) {
    const resolvedFile = ModuleResolver.resolve(
      fileNode.value,
      currentFile,
      this.context.libPaths
    );

    if (!resolvedFile) {
      // LL0217. This used to be a raw Node ENOENT out of `fs.readFileSync` -- AstProvider.loadFile
      // has no existsSync guard, and nothing on the import path caught it. A misspelled import
      // produced a stack trace, not a diagnostic.
      this.reportImportError(
        fileNode ?? node,
        `Cannot resolve import '${fileNode.value}'. Looked next to the importing file, then on the library search path.`
      );
      return;
    }

    // Stop at `types`, not `codegen`. An imported module is compiled for its SYMBOLS and their
    // inferred types; its emitted JavaScript was generated in full and then thrown away, because
    // process() defaults stopAt to "codegen".
    this.context.process(resolvedFile, "types");
    this.context.dependencyGraph.add(resolvedFile, currentFile, this.context);
  }

  /**
   * `(import foo.bar)` -- parses in BOTH frontends, and did nothing.
   *
   * It used to be `context.log(LogLevel.Error, "…not supported yet")`, and a LogLevel call is not a
   * diagnostic: it reaches the logger and never touches `results`, so `hasErrors` stayed false and
   * THE BUILD SUCCEEDED WITH THE IMPORT SILENTLY DROPPED. Every name the module was meant to provide
   * then failed to resolve somewhere far downstream, if it was noticed at all.
   *
   * Unsupported is fine. Unsupported and quiet is not.
   */
  private processNamespaceImport(ns: ast.IdentifierNode, node: ast.ImportNode) {
    this.reportImportError(
      ns ?? node,
      `Namespace import '${ns?.id}' is not supported. Import the file instead: (import "${String(ns?.id).replace(/\./g, "/")}").`
    );
  }

  private reportImportError(node: ast.ASTNode, message: string): void {
    const rule = createRule<ast.ASTNode>()
      .addSeverity(RuleSeverity.Error)
      .addCode("LL0217")
      .addMessage(message)
      .addTest(() => true)
      .build();

    this.context.results.add(node, rule, this.context);
  }
};
