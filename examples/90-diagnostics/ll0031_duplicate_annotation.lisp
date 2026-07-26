;; NEGATIVE: one `:name` declared twice -> LL0031 (D72).
;;
;; D68's three roles share ONE namespace on purpose, so that reading `:tag` at a use site tells you
;; whether it transforms the declaration or merely describes it.
;;
;; Nothing enforced that before, and the failure was silent rather than loud: the registry both
;; backends consult is keyed by name, so the second declaration simply won. `:tag` became an
;; attribute, the decorator stopped wrapping, and the program kept compiling and running -- with the
;; retry that no longer retried, which is the exact failure mode the C backend's own
;; `refuseCustomModifier` was written to prevent.
(
  (defmodifier tag [] (fn [original ...args] (original ...args)))
  (defattribute tag [text <- String])

  (fn :tag["x"] f [] -> Int (return 1))
  (console.log (f))
)
