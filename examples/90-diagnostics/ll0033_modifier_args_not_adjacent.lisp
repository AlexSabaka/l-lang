;; NEGATIVE: a modifier's arguments written SPACED -> LL0034 (D68-a's debt, paid).
;;
;; D68-a gated a modifier's argument bracket on adjacency, which made three previously-unreachable
;; forms parse -- `(fn :public [x <- Int] …)` among them -- at the cost of one spelling that had been
;; working by accident. `:retry [4]` with a space is now a bare `:retry` followed by a separate vector,
;; and that vector collides with whatever the construct expects next, so the author got a parse error
;; some distance from the actual mistake.
;;
;; The DECLARED ARITY is what makes it legible, and it is why this diagnostic had to wait for D72's
;; registry: `:retry` takes one argument and was given none, and in practice there is exactly one
;; reason that happens.
(
  (defmodifier retry [times <- Int]
      (fn [original]
          (fn [...args] (original ...args))))

  (fn :retry task [] -> Int (return 1))

  (console.log (task))
)
