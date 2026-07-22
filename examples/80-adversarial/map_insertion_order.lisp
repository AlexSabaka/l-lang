;; ADVERSARIAL (parity guard -- C-correct, JS-divergent): D53 says a map is INSERTION-ORDERED.
;;
;; C's `ll_map` is an association list appended at `len`, so insertion order is structural -- it is
;; not maintained, it simply is the order. A plain JS Object is not: integer-like keys enumerate
;; FIRST, in ascending numeric order, so a map built b, a, "10", "2" enumerates ["2","10","b","a"].
;;
;; This is a KNOWN, DELIBERATELY UNFIXED divergence, and the reason is proportionality rather than
;; difficulty:
;;
;;   * Making a map a real JS `Map` breaks DOT ACCESS. `config.host` and `sloth-profile.stats.charisma`
;;     compile to a direct property chain today; under a Map they would need `.get()`, which requires
;;     the backend to know statically that a receiver is a map -- and under gradual typing it often
;;     cannot, since a class instance uses the same syntax. The corpus has ~1600 dot-access sites
;;     against 70 map literals.
;;   * The alternative -- a parallel insertion-order key list -- means instrumenting every map write.
;;
;; Both cost far more than the case is worth while nothing in the corpus iterates an integer-keyed
;; map. So it is named, measured and pinned here instead of hidden, and it is listed in js-status.ts
;; as a known JS gap. The moment JS produces insertion order the ratchet turns red and demands the
;; line be removed.
;;
;; STRING-only keys are correct on both backends today -- that is the first line, and it is the case
;; every existing map golden happens to use. The second line is the one that discriminates.
(
    ;; String keys: insertion order on both. Note z BEFORE a -- alphabetical order would differ, which
    ;; is what the existing `{:a 1 :b 2}` goldens cannot tell apart.
    (let s {})
    (map-set s "z" 1)
    (map-set s "a" 2)
    (map-set s "m" 3)
    (console.log "string keys:" (map-keys s))

    ;; Integer-like keys: insertion order on C, ascending numeric on JS.
    (let n {})
    (map-set n 10 "ten")
    (map-set n 2 "two")
    (map-set n "b" "bee")
    (console.log "int keys:   " (map-keys n))
)
