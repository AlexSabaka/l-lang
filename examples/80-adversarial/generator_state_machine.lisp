;; CONFORMANCE guard: the `:gen` STATE MACHINE (D58, Phase G4c) -- the shapes that break it.
;;
;; `generator_identity.lisp` pins what a generator IS (`#<generator fibs>`, kind "generator"). This
;; file pins that it RESUMES correctly, which is a different question and the one the lowering is
;; actually about. A generator suspends by RETURNING, so its body has to survive re-entry at a point
;; in the middle of itself; on C that is a `switch` in the prologue and a `goto` into the middle of
;; whatever loop it stopped in, with every param, local and temp promoted to a slot in the frame.
;;
;; Each line below is a way that goes wrong.
;;
;;   1. NESTED loops. `goto` lands inside the INNER loop; when that loop finishes, control has to fall
;;      out into the outer loop's continuation and re-test the outer condition. That works only
;;      because both loops' state lives in the frame -- an inner cursor kept in a C local would be
;;      indeterminate on resume and the program would walk a garbage pointer. Two levels is the
;;      deepest the corpus goes (`flat-map`), so this is its adversarial twin.
;;   2. A suspend inside an `if` BRANCH rather than straight in a loop body (`take`'s shape), over an
;;      INFINITE source -- which only terminates because the consumer stops pulling.
;;   3. TWO LIVE INSTANCES of one generator, pulled INTERLEAVED. The frame is per-instance; a state
;;      machine that kept anything in a static or in the class descriptor passes every single-
;;      instance test and fails this one.
;;   4. `(return)` ENDS the sequence (D31). It must PARK the machine, not merely return: state is left
;;      at a value the dispatch does not name.
;;   5. PARKING, tested directly -- the failure this guards is vicious. After the body falls off the
;;      end, the state still names the LAST suspend; without parking, the next pull dispatches back to
;;      that label and re-runs the tail. `(count-up 1)` would then yield 1, and 1, and 1, forever.
;;      Two pulls past exhaustion, both nil.
;;
;; NOT tested here, deliberately: a `:gen` with no `yield` at all. D31 makes that a WARNING, so a
;; guard containing one would assert a diagnostic rather than a behaviour.
(
    (import "std/iter")
    (import "std/iter/linq")

    (fn :gen count-up [n <- Int] -> Iterator<Int> (
        (mut i 1)
        (while (<= i n) (
            (yield i)
            (i := (+ i 1))))))

    ;; 1. two levels of loop nesting, through the library's own nested-loop operator.
    (console.log (([[1 2] [3 4]] |> (flat-map (fn [xs] xs)) |> to-list).join " "))

    ;; 2. a suspend inside an `if` branch, over an infinite source.
    (fn :gen nats [] -> Iterator<Int> (
        (mut k 0)
        (while true (
            (yield k)
            (k := (+ k 1))))))
    (console.log (((nats) |> (take 4) |> to-list).join " "))

    ;; 3. two live instances, interleaved -- each carries its own frame.
    (let ia (iter (count-up 3)))
    (let ib (iter (count-up 3)))
    (console.log f"a{(next ia)} b{(next ib)} a{(next ia)} a{(next ia)} b{(next ib)}")

    ;; 4. `(return)` ends the sequence early.
    (fn :gen upto-stop [n <- Int] -> Iterator<Int> (
        (mut i 1)
        (while true (
            (if (> i n) (return))
            (yield i)
            (i := (+ i 1))))))
    (console.log (((upto-stop 3) |> to-list).join " "))

    ;; 5. pulling PAST exhaustion keeps answering nil, rather than restarting the tail.
    (let it (iter (count-up 1)))
    (console.log f"{(next it)} {(== (next it) nil)} {(== (next it) nil)}")
)
