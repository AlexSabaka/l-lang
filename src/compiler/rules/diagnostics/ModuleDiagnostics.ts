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

  // LL0301 -- two modules in one package offer the same name.
  //
  // A package's modules are INJECTED into every importer of any one of them, so a duplicate is not
  // shadowing-by-choice: which definition a program gets is decided by module processing order, and
  // nothing said so. Measured before this existed, all with zero diagnostics:
  //
  //   * `is-class` asked two different questions -- `std/llang/ast` tests an AST node's `_type`,
  //     `std/llang/reflect` a type descriptor's `kind`. The SAME descriptor answered `true` under one
  //     import and `false` under the other, and flipped on import ORDER when both were present.
  //   * `min`/`max` in `std/math/math` were `Math.min`/`Math.max`, whose C arm does not propagate
  //     NaN, while `std/math/elementary`'s were the portable ones -- `(min NAN 5)` answered 5 or NaN
  //     depending on which module came first. A D50 divergence that `elementary.lisp`'s own header
  //     exists to forbid.
  //   * `read-lines` differed in ARITY between `std/io/console` and `std/io/files`, and arity does
  //     NOT disambiguate: one of them was simply unreachable, `LL0211` if you called it.
  //
  // ERROR rather than a warning, because it is the only severity that cannot produce a silent wrong
  // answer -- and the set is small and closed (10 names across two packages when this landed).
  //
  // LL0240 is the neighbour that could not see this: it reports the same hazard for two DIRECTLY
  // IMPORTED modules, and a sibling arrives by injection rather than by import, so it is not in the
  // set that diagnostic examines.
  DuplicatePackageExport: def<{ name: string; pkg: string; a: string; b: string }>(
    "LL0301",
    Error,
    (p) =>
      `'${p.name}' is offered by two modules in the package '${p.pkg}': ${p.a} and ${p.b}. A ` +
      `package's modules are injected together, so which definition a program gets would be decided ` +
      `by module order. Rename one, or delete the duplicate -- a module cannot re-export a sibling's ` +
      `symbol, so an "umbrella" module has to redefine it, which is how the two drift apart.`
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

  // LL0235 -- an import list naming something the module does not offer.
  //
  // The symmetric twin of LL0232, and it was the missing half of the boundary. LL0216 already asks
  // "did this file bind the name it USED?" -- but the import list itself was never checked against
  // the module, so `(import { typo } from "m")` was accepted in full silence. A misspelled import
  // therefore reported nothing at the import, and the only symptom was an LL0210 at each USE, naming
  // the use rather than the typo -- or, if the name was never used, nothing at all.
  ImportNameNotFound: def<{ name: string; source: string; defined: boolean }>(
    "LL0235",
    Error,
    (p) =>
      p.defined
        ? `'${p.name}' is defined in '${p.source}' but not exported from it, so this import cannot ` +
          `bind it. Add it to that module's exports.`
        : `'${p.name}' is not defined in '${p.source}'. Check the spelling, or import it from the ` +
          `module that defines it.`
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
