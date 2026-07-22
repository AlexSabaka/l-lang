/**
 * The JS backend's ratchet allowlist -- the mirror of `c-status.ts`, and new with Fe.
 *
 * For the whole life of this project the JS backend has been the reference and C the one catching up,
 * so `c-status.ts` was the only ratchet needed: a C-behind file sits `not-yet` until it passes, then
 * turns red demanding promotion. Fe inverts that for the first time. `Int` is a wrapping int64 by D51,
 * C has had that since it existed, and JS is the backend that is wrong -- `(+ 9007199254740992 1)` is
 * exact on `int64_t` and lossy on an f64.
 *
 * So this file lists the files JS is KNOWN to fail, with the same four-way semantics:
 *   - listed and failing        -> `not-yet` (dim; expected -- the migration is phased)
 *   - listed and PASSING        -> red, "RATCHET" (remove it here; a ratchet without teeth decays)
 *   - unlisted and failing      -> red (an ordinary regression)
 *   - unlisted and passing      -> pass
 *
 * Note the polarity is the OPPOSITE of C_PASSING, and deliberately so. C's list is an allowlist that
 * grows as the backend advances; this is a shrinking list of known gaps, because JS starts complete
 * and Fe temporarily makes it incomplete. When this array is empty, Fe is done and the file can go.
 */
export const JS_NOT_YET: readonly string[] = [
  // Empty, and that is the goal state: every known JS gap is closed. Fe's three guards
  // (int64_exact, int64_wrap, int_real_runtime_tag) were listed here and are now green on BOTH
  // backends, so they were removed -- which is exactly what the RATCHET demanded the moment they
  // started passing. When the next phased migration needs the same instrument, list its files here.
];
