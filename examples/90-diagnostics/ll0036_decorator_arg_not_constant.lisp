;; NEGATIVE: a decorator applied with a computed argument -> LL0036 (D75).
;;
;; `:name[args]` is STATIC sugar -- it is unfolded at compile time, so what it is given must be known
;; then. That is not a new kind of rule: `:comptime` requires literal arguments (LL0099) for the
;; identical reason, and this is that reason applied to the other compile-time form.
;;
;; Nor is it merely unimplemented. A decoration whose argument is a runtime value is undecidable by
;; construction -- a modifier body branching on the argument would need every branch to survive, and a
;; decoration inside a function body is a NEW decoration on every call, each needing its own setup
;; state. That is the definition of dynamic.
;;
;; The dynamic form is not lost, it is spelled differently: an explicit wrapper, which works on both
;; backends and is what the diagnostic points at.
(
  (defmodifier retry [times <- Int] (fn [original ...args] (original ...args)))

  (fn make [n <- Int m <- Int] -> Int (
     (fn :retry[(+ n m)] inner [] -> Int (return 1))
     (return (inner))
  ))

  (console.log (make 1 2))
)
