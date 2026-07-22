;; CONFORMANCE guard: every native member the CHECKER declares actually works on BOTH backends.
;;
;; `types/nativeMembers.ts` (what the checker knows) and `codegen/c/intrinsics.ts` (what C can lower)
;; were two hand-mirrored tables -- the same duplication D50 closed one layer up for CALLS, still open
;; for MEMBERS, and named in FLOOR.md's Fa bullet as "the next thing the floor should absorb".
;;
;; MEASURED BEFORE CHANGING ANYTHING, because the interesting result was not the one expected:
;;
;;   27 members  BYTE-IDENTICAL on JS and C. The mirror had NOT drifted in behaviour at all.
;;    7 members  declared by the checker, REFUSED by C (ELL0106) -- drift in COVERAGE, fail-closed.
;;
;; So the tables never lied about what a member MEANS; they disagreed about which members EXIST. That
;; is a much better failure than the alternative, and it is why this guard is a conformance pin rather
;; than a bug report: the 27 needed no fixing, only protecting.
;;
;; THE INVERSION, which is the part worth remembering. `ll_dyn_method` -- the boxed-receiver arm --
;; already implemented `map`, `filter` and `reduce` on a vec. They were unreachable only because
;; `resolveNativeMethod` looked up the static table for a typed receiver, missed, and refused. So
;; TYPING THE RECEIVER LOST CAPABILITY: `(xs.map f)` compiled or not depending on whether inference
;; had reached `xs`. That is the same failure shape as `native_search_numeric.lisp` -- an answer that
;; depends on which nodes inference visited rather than on the program -- and it is now the third time
;; this phase that shape has turned up.
;;
;; Four members needed WRITING, not routing, and one of those four was found only by running it:
;; `ll_dyn_method` has a `lastIndexOf` arm in its STRING branch and none in its vec branch, so reading
;; the table said "routable" and executing it said "trap". Measured, not assumed.
(
    (let s "Hello World")
    (let xs [3 1 2])

    ;; -- the four that had no C implementation anywhere --------------------------------------------
    (console.log "trimStart:  " ("  pad  ".trimStart))
    (console.log "charCodeAt: " (s.charCodeAt 0))
    (console.log "flat:       " ([[1] [2]].flat))
    (console.log "lastIndexOf:" (xs.lastIndexOf 2))

    ;; -- the three that C could already do DYNAMICALLY but refused STATICALLY -----------------------
    (console.log "map:        " (xs.map (fn [e] -> Int (* e 2))))
    (console.log "filter:     " (xs.filter (fn [e] -> Boolean (> e 1))))
    (console.log "reduce:     " (xs.reduce (fn [a b] -> Int (+ a b)) 0))

    ;; -- a sample of the 27 that already agreed, so a regression in the DERIVATION is visible -------
    (console.log "padStart:   " ("7".padStart 3 "0"))
    (console.log "split:      " (s.split " "))
    (console.log "slice:      " (xs.slice 0 2))
    (console.log "join:       " (xs.join "-"))
)
