// HIR path on/off resolution. Kept dependency-free (no imports) so Context and getCompilerOptions
// can both read it without any module cycle.

/**
 * The compiled-in default for the HIR lowering path.
 *
 * `true` as of S5: the destination-driven lowering covers the conditional cluster (if/when/cond/match)
 * and operand hoisting, every acceptance case is green, and the whole corpus is behaviourally
 * equivalent under it. The direct AST->ESTree emit remains as the `--no-hir` / `LL_HIR=0` fallback
 * until R2 retires it (and the LL0103 refusal, and the value-position IIFE machinery) entirely.
 */
export const HIR_DEFAULT = true;

/**
 * Whether the HIR path is on when nothing sets it explicitly.
 *
 * `LL_HIR` overrides the compiled default so the whole test matrix can run both ways from one command
 * -- `LL_HIR=1 npm test` vs `npm test` is the behavioural parallel-run the migration is gated on
 * (hir-brief.md ss5). An explicit CLI `--hir`/`--no-hir` still wins over this (see getCompilerOptions).
 */
export function hirDefault(): boolean {
  const env = process.env.LL_HIR;
  if (env === "1") return true;
  if (env === "0") return false;
  return HIR_DEFAULT;
}
