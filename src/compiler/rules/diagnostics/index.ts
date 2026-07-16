import type { DiagnosticDef } from "./Diagnostic";
import { TypeDiagnostics } from "./TypeDiagnostics";
import { SyntaxDiagnostics } from "./SyntaxDiagnostics";
import { CodegenDiagnostics } from "./CodegenDiagnostics";
import { ModuleDiagnostics } from "./ModuleDiagnostics";
import { ComptimeDiagnostics } from "./ComptimeDiagnostics";

export { def, report } from "./Diagnostic";
export type { DiagnosticDef } from "./Diagnostic";
export { TypeDiagnostics } from "./TypeDiagnostics";
export { SyntaxDiagnostics } from "./SyntaxDiagnostics";
export { CodegenDiagnostics } from "./CodegenDiagnostics";
export { ModuleDiagnostics } from "./ModuleDiagnostics";
export { ComptimeDiagnostics } from "./ComptimeDiagnostics";

/**
 * The registry: every diagnostic category, keyed by category name, each a map of def-name -> def.
 *
 * This is the aggregate the `test:diagnostics` harness reads to (a) list which LL codes are TAKEN --
 * so the next free number in a band is a lookup, not a `grep "LL0"` -- and (b) guard integrity (a
 * code must carry one severity everywhere it is used).
 *
 * EMPTY until the imperative diagnostics are migrated in category by category (Eb: type, Ec: syntax,
 * Ed: codegen/module/comptime). The declarative structural rules (`NodeValidationRules`, LL0001-0022)
 * are a different animal -- they carry `test` predicates and stay where they are; Ec registers their
 * CODES here so the allocator sees the whole picture without rewriting them.
 */
export const DIAGNOSTIC_CATEGORIES: Record<
  string,
  Record<string, DiagnosticDef<any>>
> = {
  type: TypeDiagnostics,
  syntax: SyntaxDiagnostics,
  codegen: CodegenDiagnostics,
  module: ModuleDiagnostics,
  comptime: ComptimeDiagnostics,
};

/**
 * Codes owned by diagnostics that live OUTSIDE this registry, so the allocator's "taken" set is
 * complete and "next free" never collides with them.
 *
 * These are the LIVE declarative structural rules (`NodeValidationRules`, LL0001-LL0022 minus the
 * commented-out LL0004). They keep their `test`-predicate form and are NOT migrated -- they are a
 * different mechanism (self-checking, not call-site-decided). Listing their codes here lets the
 * allocator see the whole LL00xx band, and lets `test:diagnostics` NOTE where they OVERLAP a migrated
 * diagnostic (LL0015-LL0019 -- see SyntaxDiagnostics's finding).
 */
export const EXTERNAL_CODES: readonly string[] = [
  "LL0001", "LL0002", "LL0003", "LL0005", "LL0006", "LL0007", "LL0008",
  "LL0009", "LL0010", "LL0011", "LL0012", "LL0013", "LL0014", "LL0015",
  "LL0016", "LL0017", "LL0018", "LL0019", "LL0020", "LL0021", "LL0022",
];
