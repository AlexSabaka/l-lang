/**
 * The JS backend's ratchet allowlist -- the mirror of `c-status.ts`, and new with Fe.
 *
 * For the whole life of this project the JS backend has been the reference and C the one catching up,
 * so `c-status.ts` was the only ratchet needed: a C-behind file sits `not-yet` until it passes, then
 * turns red demanding promotion. Fe inverted that for the first time. `Int` is a wrapping int64 by
 * D51, C has had that since it existed, and JS was the backend that was wrong.
 *
 * So this file lists the files JS is KNOWN to fail, with the same four-way semantics:
 *   - listed and failing        -> `not-yet` (dim; expected)
 *   - listed and PASSING        -> red, "RATCHET" (remove it here; a ratchet without teeth decays)
 *   - unlisted and failing      -> red (an ordinary regression)
 *   - unlisted and passing      -> pass
 *
 * Note the polarity is the OPPOSITE of C_PASSING, and deliberately so: C's list is an allowlist that
 * GROWS as the backend advances, this one SHRINKS as gaps close.
 *
 * -----------------------------------------------------------------------------------------------
 * WHAT THIS FILE IS NOW, which is not what it was written to be.
 *
 * The original header said: "When this array is empty, Fe is done and the file can go." That premise
 * is spent. Fe IS done, the migration entries all closed, and the two survivors are not migration
 * debt at all -- they are RULED divergences that have been costed and declined. Nothing will empty
 * this array, so the file is permanent, and its job changed from tracking a migration to holding the
 * declined cases where the ratchet can see them.
 *
 * That distinction matters for how an entry is read. A `not-yet` here no longer means "someone is
 * getting to this." It means: measured, argued in the guard's own header, and deliberately not paid
 * for. Anything genuinely in flight belongs in a phase worklist, not here.
 *
 * A note on why these cannot instead be graded per-backend: the runner grades BOTH backends against
 * the SAME `.expect`, which is the entire parity instrument -- one golden, two implementations, and a
 * divergence has nowhere to hide. Giving a file two goldens would make every entry below green and
 * measure nothing. Being listed here is the honest form: it stays red-by-declaration.
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
  //
  // Re-measured 2026-07-22, and the second option is worse than "instrumenting every map write"
  // suggests. An integer-like key can only enter a map two ways -- `map-set`, which is a helper and
  // routable, and the indexer `(m[10] := v)`, which is NOT: it emits `m[10] = "ten"` as a direct
  // property assignment. (A dot write cannot produce one, since `m.10` is not spellable.) So order
  // tracking means routing every `x[k] := v` in the language through a helper, ARRAYS INCLUDED,
  // because the backend cannot always tell which receiver it has. The information is destroyed at
  // write time and there is no read-side fix.
  "80-adversarial/map_insertion_order.lisp",
  // Ff-3 (D52) -- native string members past U+FFFF. C's surface counts CHARACTERS as of Ff-3; JS's
  // still counts UTF-16 CODE UNITS, so the two agree below U+10000 and part company on a surrogate
  // pair: `"a😀b".length` is 3 on C and 4 here.
  //
  // Not fixed, because the fix has no good shape. C's members are OUR implementation -- moving them
  // touched runtime.c and nothing else. JS's are the HOST's: `s.length` is a property read, so
  // counting characters means routing every member read through a receiver-aware helper. Doing that
  // only where the checker typed the receiver String would be WORSE than the gap -- a typed receiver
  // would answer 3 and an untyped one 4, i.e. the language disagreeing with itself depending on
  // inference, which is exactly the failure `native_search_numeric` above documents. Doing it
  // unconditionally puts a runtime type test on all 78 `.length` sites in the corpus, most arrays.
  //
  // The language's own spellings are correct on both: `std/string`'s strlen/char-at/substr/pad-start
  // and `std/seq`'s `length`, which dispatches on `(coll :of String)` precisely so this cannot reach
  // it. The guard's `seq-len` line is that control, green on both in the same file.
  //
  // Re-read 2026-07-22 under D50's native-member amendment, which generalises this from a one-off
  // into the standing rule: a native member is an ESCAPE HATCH, the host owns what the operation
  // MEANS, and `.length` meaning UTF-16 code units is the host's meaning. What l-lang owns is the
  // REPRESENTATION crossing the boundary -- which is why `native_search_numeric` was a bug and had to
  // be fixed, while this stays. So this entry is not an unpaid debt; it is the boundary working.
  "80-adversarial/native_string_astral.lisp",
];
