// HIR path on/off resolution. Kept dependency-free (no imports) so Context and getCompilerOptions
// can both read it without any module cycle.

/**
 * The compiled-in default for the HIR lowering path.
 *
 * `false` through the prototype (S1-S4); flipped to `true` at S5 once the destination-driven lowering
 * covers the conditional cluster (if/when/cond/match) and every acceptance case is green. The
 * `--no-hir` / `LL_HIR=0` escape survives until R2 retires the legacy control-flow path entirely.
 */
export const HIR_DEFAULT = false;

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
