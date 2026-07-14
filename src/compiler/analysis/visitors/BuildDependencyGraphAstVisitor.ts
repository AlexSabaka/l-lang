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
      this.processFileImport(import_, import_.source.file, node, currentFile);
    } else {
      this.processNamespaceImport(import_.source.namespace, node);
    }
  }

  /**
   * WHICH names did this import ask for? `null` means "the whole module".
   *
   * `undefined` and `[]` BOTH mean the whole module, and getting that wrong is not a subtle bug --
   * it breaks every import in existence. The frontends disagree about how a plain
   * `(import "x.lisp")` records "the importer named nothing":
   *
   *     grammar_v2 -> symbols: []          PEG -> no `symbols` key at all
   *
   * Read `[]` as "an empty set of bindings" and every grammar_v2 import in the corpus binds NOTHING.
   * A whole-module import names no symbols precisely because it wants all of them.
   */
  private importedNames(import_: ast.ImportDefinition): Set<string> | null {
    const symbols = import_.symbols;
    if (!symbols || symbols.length === 0) return null;
    return new Set(
      symbols
        .map((s) => (s.symbol as any)?.name ?? (s.symbol as any)?.id)
        .filter((n): n is string => typeof n === "string")
    );
  }

  private processFileImport(
    import_: ast.ImportDefinition,
    fileNode: ast.StringNode,
    node: ast.ImportNode,
    currentFile: string
  ) {
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

    // D20, the IMPORT side: record what this file actually ASKED FOR. `ImportDefinition.symbols` is
    // built by both AST builders and, until now, read by nobody -- so `(import { a } from "x")`
    // behaved identically to importing the whole module.
    this.context.recordImport(currentFile, resolvedFile, this.importedNames(import_));

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
