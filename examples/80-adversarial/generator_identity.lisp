;; CONFORMANCE guard: what a GENERATOR VALUE looks like (D58/G3, FLOOR.md 3.5, D54).
;;
;; A `:gen` produces a value, and until G3 neither backend had an answer for what that value IS.
;; On JS it was a native generator object, which meant:
;;
;;     (console.log (fibs))  ->  {}                                       an EMPTY MAP
;;     (type (fibs))         ->  {:name "Map" :kind "container" ...}      a MAP
;;
;; Both wrong, and wrong in the way that matters most: a generator was indistinguishable from an
;; empty map, in BOTH the formatter and the reflection graph. C has no answer at all yet (it refuses
;; `:gen` with LL0105 until the state-machine pass lands), so this file is JS-graded now and joins
;; the C ratchet at G4 -- against THIS golden, which is the point of writing it first.
;;
;; The ruling (D58): a generator renders as an unreadable-object marker carrying its SOURCE name,
;; exactly parallel to `#<fn name>` / `#<fn>`, and reflects as kind "generator". Its synthesized
;; class -- the state-machine type a native backend emits -- deliberately never appears, in either.
;; The reason is that the alternative leaks: a generator's members ARE the suspended frame (a state
;; number, plus whatever locals live across the yield), so printing it as `ClassName{...}` would put
;; a compiler-generated class name and a program counter into user-facing output. FLOOR.md's own
;; F.7/F.8 amendment already rejected exactly that shape for lambdas -- "a generated placeholder name
;; was considered and rejected: `#<fn __ll_lam_3>` is the very class of leak the paragraph above
;; removes."
;;
;; WHAT EACH LINE IS FOR:
;;
;;   1. the base rendering, and that it is NOT an empty map.
;;   2. KEBAB-CASE. `count-up` encodes to the JS binding `count2dup`; the brand must carry the source
;;      spelling, not the host's. Same bug F.7/F.8 fixed for functions and class fields.
;;   3. AN IMPORTED GENERATOR -- the sharpest one, and it was live when this file was written.
;;      `std/iter/linq`'s eleven lazy operators are ALL generators and ALL imported, and an import is
;;      inlined under a mangled name, so `(map ...)` displayed as `#<generator __ll_inlined_map_1>`:
;;      the mangler's symbol in user-facing output, reintroduced by the feature built to prevent it.
;;      This is the `display_imported_class_tag` bug (Zh), one type-constructor along.
;;   4. reflection agrees with display -- same source name, kind "generator", and the seeded
;;      `{name, kind, nullable}` shape rather than a class's.
;;   5. nesting: a generator inside a container renders through the same arm, and does not break the
;;      container's own layout.
;;   6. the NEGATIVE half. An empty map must still be an empty map -- the brand must not be so broad
;;      that it captures plain objects, which is the failure mode a `typeof`-based test would have.
;;   7. a generator is still ITERABLE after branding. The brand rides the prototype precisely so the
;;      native iteration protocol is untouched; if it were not, every linq operator would break.

(
    (import "std/iter")
    (import "std/iter/linq")

    ;; A plain named generator.
    (fn :gen fibs [] -> Iterator<Int> (
        (mut a 0)
        (mut b 1)
        (while true (
            (yield a)
            (let nxt (+ a b))
            (a := b)
            (b := nxt)
        ))
    ))

    ;; A KEBAB-CASE generator: the JS binding is `count2dup`, the source name is not.
    (fn :gen count-up [n <- Int] -> Iterator<Int> (
        (mut i 1)
        (while (<= i n) (
            (yield i)
            (i := (+ i 1))
        ))
    ))

    ;; 1 + 2 -- the marker carries the SOURCE name.
    (console.log (fibs))
    (console.log (count-up 3))

    ;; 3 -- an IMPORTED generator, inlined under a mangled binding.
    (console.log ((count-up 3) |> (map (fn [x] x))))
    (console.log ((count-up 3) |> (filter (fn [x] true))))

    ;; 4 -- reflection agrees with display.
    (console.log (type (fibs)))
    (console.log (type ((count-up 3) |> (map (fn [x] x)))))

    ;; 5 -- inside containers.
    (console.log [(count-up 1) (fibs)])
    (console.log {:g (fibs)})

    ;; 6 -- the negative half: a plain empty map is still a map, in both channels.
    (console.log {})
    (console.log (type {}))

    ;; 7 -- branding does not disturb iteration.
    (console.log ((count-up 4) |> to-list))
)
