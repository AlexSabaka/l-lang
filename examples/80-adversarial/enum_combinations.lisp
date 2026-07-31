;; defenum, crossed with the other forms -- and pinning ONLY what is unambiguously correct.
;;
;; `05-data-structures/04_enums.lisp` declares an enum and matches on two of its members. Nothing
;; anywhere puts an enum through a generator frame, a catch arm, or a declared parameter, and nothing
;; pins that a non-exhaustive match yields nil.
;;
;; WHAT THIS FILE DELIBERATELY DOES NOT PIN, because it would freeze a defect: an enum MEMBER ACCESS
;; IS UNTYPED. `(let s <- String Color:RED)` is silent, which is one root cause with several
;; symptoms -- a member of one enum is accepted where a DIFFERENT enum is declared, `(x :of Color)`
;; answers false, and two enums' members compare equal by ordinal. All of it is measured in
;; docs/roadmap.md. The rows below are the ones that hold regardless of how that is ruled.
;;
;; THE NON-EXHAUSTIVE MATCH ROW IS A D112 CONSEQUENCE, NOT A BUG. D112 rules that a `match` with no
;; clause matching yields nil, so an enum match that omits a member and has no catch-all yields nil
;; rather than reporting. Whether an enum match should be checked for EXHAUSTIVENESS is a separate
;; open question -- the checker would have to know the member set, and `visitEnum` does record it in
;; `codegenMetadata` -- but until that is ruled, nil is the ruled answer and is pinned as such.
(
    (import "std/protocols")

    (defenum Color :RED :GREEN :BLUE)

    ;; 1. A FULL match over every member, no catch-all.
    (fn name-of [c] (match c { Color:RED => "r"  Color:GREEN => "g"  Color:BLUE => "b" }))
    (console.log "full match:" (name-of Color:GREEN))
    (console.log "full match, last member:" (name-of Color:BLUE))

    ;; 2. A PARTIAL match, no catch-all, given the omitted member. D112: nil.
    (fn partial [c] (match c { Color:RED => "r"  Color:GREEN => "g" }))
    (console.log "partial match, omitted member:" (partial Color:BLUE))

    ;; 3. IDENTITY within one enum -- a member equals itself and no sibling.
    (let c Color:GREEN)
    (console.log "same member:" (== c Color:GREEN))
    (console.log "sibling member:" (== c Color:RED))

    ;; 4. A DECLARED ANNOTATION accepts its own enum's member.
    (let annotated <- Color Color:BLUE)
    (console.log "annotated holds:" (== annotated Color:BLUE))

    ;; 5. THROUGH A GENERATOR FRAME -- an enum crosses a suspension and stays itself.
    (fn :gen g [] -> Iterator<Any> ((yield Color:RED) (yield Color:BLUE)))
    (mut saw-blue false)
    (mut count 0)
    (for :each x :from (g) :then ((count := (+ count 1)) (if (== x Color:BLUE) (saw-blue := true))))
    (console.log "through a generator:" count saw-blue)

    ;; 6. ACROSS A LONGJMP LANDING -- assigned in a catch arm, read after.
    (mut after Color:RED)
    (try ((throw (new ValueError "boom"))) catch e ((after := Color:BLUE)))
    (console.log "assigned in a catch arm:" (== after Color:BLUE))

    ;; 7. AS A DECLARED PARAMETER, and through a pipeline into one.
    (fn is-red [c <- Color] -> Boolean (return (== c Color:RED)))
    (console.log "as a parameter:" (is-red Color:RED) (is-red Color:GREEN))
    (console.log "piped into a parameter:" (Color:RED |> is-red))
)
