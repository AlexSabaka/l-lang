import type { DiagnosticDef } from "./Diagnostic";
import { TypeDiagnostics } from "./TypeDiagnostics";

export { def, report } from "./Diagnostic";
export type { DiagnosticDef } from "./Diagnostic";
export { TypeDiagnostics } from "./TypeDiagnostics";

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
};

/**
 * Codes owned by diagnostics that live OUTSIDE this registry (the declarative structural rules), so
 * the allocator's "taken" set is complete. Populated in Ec.
 */
export const EXTERNAL_CODES: readonly string[] = [];
