;; CONFORMANCE guard: the map floor (D53) -- map-new / map-get / map-set / map-has / map-delete /
;; map-keys, insertion-ordered with String keys.
;;
;; `{}` is the constructor -- there is no `map-new`, because a ZERO-ARG floor function is unusable:
;; D1 makes `(map-new)` a READ of the binding, so it returned the function object and every "new map"
;; aliased the same one. The literal is both idiomatic and unambiguous.
;;
;; Before this, l-lang could construct a map and read a known key and nothing else: there was no way
;; to ask what keys a map HAS. `examples/05-data-structures/02_maps.lisp` has been calling `.keys`,
;; `.values` and `.hasKey` since it was written, none of which exist, which is why that file has never
;; had a golden.
;;
;; Named without the bang. D53 spells these `map-set!`/`map-has`, but D21 rejects Scheme spellings BY
;; NAME -- "`nil?`, `set!` are rejected, including the ones the runtime shim itself uses" -- and
;; `set!`/`set?` were deleted from the runtime for exactly that reason. D21 is the naming ruling.
;;
;; The KEY is stringified on the way in, on both backends: D53's "String keys" is about the key space,
;; and `(m[1] := v)` has always written the key "1", so `(map-get m 1)` must find it.
(
    (let m {})
    (map-set m "b" 2)
    (map-set m "a" 1)
    (map-set m "c" 3)

    (console.log "keys:    " (map-keys m))
    (console.log "get b:   " (map-get m "b"))
    (console.log "missing: " (map-get m "zz"))
    (console.log "has a:   " (map-has m "a"))
    (console.log "has zz:  " (map-has m "zz"))

    (console.log "deleted: " (map-delete m "b"))
    (console.log "again:   " (map-delete m "b"))
    (console.log "after:   " (map-keys m))

    ;; A non-String key stringifies, matching what `(m[1] := v)` has always done.
    (map-set m 7 "seven")
    (console.log "int key: " (map-get m 7))
    (console.log "as str:  " (map-get m "7"))
)
