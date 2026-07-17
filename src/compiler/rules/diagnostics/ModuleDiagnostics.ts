import { def } from "./Diagnostic";
import { RuleSeverity } from "../RuleBuilder";

const { Error, Warning } = RuleSeverity;

/**
 * The module-graph diagnostics: import resolution (LL0217, from
 * `BuildDependencyGraphAstVisitor`) and the import-cycle warning (LL0300, from `Context`). The old
 * `reportImportError` helper baked LL0217 into itself; here each def carries the code explicitly.
 *
 * Categorized by EMITTING PASS, not by code band: LL0215/LL0216 (module visibility) are emitted by
 * the type pass and so live in TypeDiagnostics; LL0217 is emitted by the dependency-graph builder and
 * lives here.
 */
export const ModuleDiagnostics = {
  // LL0217 -- an import path that cannot be resolved
  UnresolvedImport: def<{ source: string }>(
    "LL0217",
    Error,
    (p) =>
      `Cannot resolve import '${p.source}'. Looked next to the importing file, then on the library search path.`
  ),

  // LL0217 -- a namespace import (unsupported on the JS target)
  NamespaceImportUnsupported: def<{ namespace: string; path: string }>(
    "LL0217",
    Error,
    (p) =>
      `Namespace import '${p.namespace}' is not supported. Import the file instead: (import "${p.path}").`
  ),

  // LL0300 -- an import cycle: a warning, the program still compiles
  ImportCycle: def<{ name: string }>(
    "LL0300",
    Warning,
    (p) =>
      `Import cycle: '${p.name}' is imported while it is still being loaded. ` +
      `This compiles -- an import brings in definitions, not execution -- but a cycle is ` +
      `usually a sign the modules want splitting.`
  ),

  // LL0232
  CannotExportUndefined: def<{ name: string }>(
    "LL0232",
    Error,
    (p) =>
      `Cannot export '${p.name}': nothing by that name is defined in this module. Export names a ` +
      `symbol this module DEFINES -- re-exporting an imported name is not supported, and a consumer ` +
      `can import it from its own module directly. Define it, or drop the export.`
  ),
};
