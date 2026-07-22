import * as path from "node:path";
import * as ast from "../../frontend/ast";
import { BaseAstTreeWalker } from "../../BaseAstTreeWalker";
import { ModuleDiagnostics as MD } from "../../rules/diagnostics";
import { ModuleResolver } from "../ModuleResolver";
import { PackageRegistry } from "../PackageRegistry";

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
   * The LOCAL name an import introduces, and the name it asks the MODULE for.
   *
   * `(import { a } from "m")` binds `a` to `a`; `(import { a :as b } from "m")` binds `b` to `a`.
   * Everything downstream that asks "did this file bind NAME?" means the LOCAL name -- that is what
   * the source will write -- while everything that asks the module a question means the SOURCE name.
   * Keeping the two apart is the whole of alias support; conflating them is why `:as` did nothing.
   */
  private aliasPairs(import_: ast.ImportDefinition): { local: string; source: string }[] {
    const out: { local: string; source: string }[] = [];
    for (const s of import_.symbols ?? []) {
      if (!s?.symbol) continue;
      const source = ast.symbolName(s.symbol);
      if (!source) continue;
      const local = s.as ? ast.symbolName(s.as) : source;
      if (local) out.push({ local, source });
    }
    return out;
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
    // The LOCAL names -- `importBinds` is asked about the name the SOURCE writes, and under `:as`
    // that is the alias. Recording the source name here would report LL0216 on every aliased use.
    return new Set(this.aliasPairs(import_).map((p) => p.local));
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
      this.report(MD.UnresolvedImport, fileNode ?? node, {
        source: fileNode.value,
      });
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

    // AFTER processing, because the module's symbols do not exist until then.
    this.checkImportedNamesExist(import_, resolvedFile, currentFile);

    // The aliases, for Context to bind once THIS module's own scope exists (it does not yet -- the
    // symbol table is built by the pass after this one).
    for (const p of this.aliasPairs(import_)) {
      this.context.recordImportAlias(currentFile, resolvedFile, p.local, p.source);
    }
  }

  /**
   * LL0235 -- does the module actually OFFER each name this import asked for?
   *
   * The missing half of the boundary. LL0216 asks "did this file bind the name it USED?", and LL0215
   * asks "does that module export it?" -- but both are driven from a USE. The import LIST itself was
   * checked against nothing, so `(import { typo } from "m")` was accepted in silence: no diagnostic
   * at the import, and at best an LL0210 at each use naming the use rather than the typo. A name
   * imported and never used reported nothing at all.
   *
   * Every clause below is a way of NOT reporting, the same posture as `isVisibleFrom`: this runs on
   * every import in the program, including the stdlib's, so it must never invent a diagnostic out of
   * missing information.
   */
  private checkImportedNamesExist(
    import_: ast.ImportDefinition,
    resolvedFile: string,
    currentFile: string
  ): void {
    const symbols = import_.symbols;
    if (!symbols || symbols.length === 0) return; // whole-module import names nothing to check

    const table = this.context.getModule(resolvedFile)?.symbols;
    if (!table) return; // the module failed to process -- its own diagnostics are the report

    // Within one package there is no boundary at all (Phase M / Mb): sibling files see each other's
    // names directly, exported or not, so "not exported" is not a defect there. Being DEFINED is
    // still required, so only the export half is relaxed.
    const samePackage = this.samePackage(resolvedFile, currentFile);

    for (const s of symbols) {
      const name = s.symbol ? ast.symbolName(s.symbol) : undefined;
      if (!name) continue;

      // What the module OFFERS, which under `(export a :as b)` is not what it DECLARES. Asking
      // `resolveSymbol` here would report an aliased export as missing and accept its private name.
      const entry = table.moduleOffering(resolvedFile, name);

      if (entry === undefined) {
        // Distinguish "no such name" from "there, but withheld". `moduleOffering` answers undefined
        // for both, so the DECLARED name is what separates them -- and within a package there is no
        // export boundary at all, so a declared name is simply offered.
        const declared = table.resolveSymbol(name);
        const declaredIn = (declared?.value as any)?._location?.source;
        const here =
          declared !== undefined &&
          declaredIn !== undefined &&
          path.resolve(declaredIn) === path.resolve(resolvedFile);

        // An OPERATOR is exempt for the same reason it is exempt from LL0215/LL0216 (W): it is found
        // by dispatch, never by name, so it has no export and cannot appear in an import list.
        if (here && (declared!.isOperator || samePackage)) continue;

        this.report(MD.ImportNameNotFound, (s.symbol as any) ?? import_.source, {
          name,
          source: path.basename(resolvedFile),
          defined: here,
        });
      }
    }
  }

  private samePackage(a: string, b: string): boolean {
    if (path.resolve(a) === path.resolve(b)) return true;
    const registry = PackageRegistry.forPaths(this.context.libPaths);
    const pa = registry.packageOf(a);
    const pb = registry.packageOf(b);
    return pa !== undefined && pa === pb;
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
    this.report(MD.NamespaceImportUnsupported, ns ?? node, {
      namespace: String(ns?.id),
      path: String(ns?.id).replace(/\./g, "/"),
    });
  }

};
