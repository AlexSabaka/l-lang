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
  // ---------------------------------------------------------------------------------------------
  // Fe (D51) -- `Int` is a wrapping 64-bit integer. JS still uses f64, so these four are C-correct
  // and JS-wrong. They are the discriminating signal the migration is verified against: the corpus's
  // largest integer is 3628800, so without them a successful Fe would look exactly like no Fe.
  "80-adversarial/int64_exact.lisp",   // 2^53+1 survives; f64 rounds it
  "80-adversarial/int64_wrap.lisp",    // asIntN(64) wraparound at INT64_MAX
  "80-adversarial/int_real_runtime_tag.lisp", // `:of Int` on an untyped value; Int-keyed operator dispatch
];
