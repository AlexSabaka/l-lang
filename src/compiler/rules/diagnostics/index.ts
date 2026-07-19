import type { DiagnosticDef } from "./Diagnostic";
import { TypeDiagnostics } from "./TypeDiagnostics";
import { SyntaxDiagnostics } from "./SyntaxDiagnostics";
import { CodegenDiagnostics } from "./CodegenDiagnostics";
import { CBackendDiagnostics } from "./CBackendDiagnostics";
import { ModuleDiagnostics } from "./ModuleDiagnostics";
import { ComptimeDiagnostics } from "./ComptimeDiagnostics";

export { def, report } from "./Diagnostic";
export type { DiagnosticDef } from "./Diagnostic";
export { TypeDiagnostics } from "./TypeDiagnostics";
export { SyntaxDiagnostics } from "./SyntaxDiagnostics";
export { CodegenDiagnostics } from "./CodegenDiagnostics";
export { CBackendDiagnostics } from "./CBackendDiagnostics";
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
  cCodegen: CBackendDiagnostics,
  module: ModuleDiagnostics,
  comptime: ComptimeDiagnostics,
};

/**
 * `EXTERNAL_CODES` USED TO LIVE HERE, and is DELETED (Vc).
 *
 * It was a hand-written array of the codes owned by the declarative structural rules
 * (`NodeValidationRules`), kept so the allocator's "taken" set was complete. Those rules are a
 * different mechanism -- self-checking `test` predicates, not call-site-decided -- and are still not
 * migrated; only the LIST is gone.
 *
 * It drifted within one phase of its own creation. Qe added a declarative rule wearing LL0029 and did
 * not update the array, so the allocator went on offering LL0029 as "next free" and the next rule
 * would have collided with it -- which is the exact failure D38 built this registry to prevent
 * (LL0015-LL0019, five codes overloaded because two mechanisms numbered themselves independently).
 *
 * A hand-maintained list of codes, sitting inside a registry whose entire purpose is that codes are
 * not hand-maintained, is that bug wearing a different hat. `test/diagnostics.ts` now DERIVES the set
 * from `Rules` itself, so a declarative rule is counted because it exists rather than because someone
 * remembered it.
 */
