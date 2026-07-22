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
  // Fg (D53) -- a map is INSERTION-ORDERED. C's ll_map is an assoc list appended at `len`, so it is;
  // a plain JS Object is not, because integer-like keys enumerate first in ascending numeric order.
  //
  // Deliberately unfixed, on proportionality rather than difficulty. Making a map a real JS Map
  // breaks DOT ACCESS -- `config.host` compiles to a direct property chain, and the backend often
  // cannot tell a map receiver from a class instance statically; the corpus has ~1600 dot-access
  // sites against 70 map literals. The alternative, a parallel insertion-order key list, means
  // instrumenting every map write. Nothing in the corpus iterates an integer-keyed map, so both cost
  // far more than the case is worth -- but it is D53's ruling, so it is pinned rather than hidden.
  "80-adversarial/map_insertion_order.lisp",
];
