;; Library half B -- the same two private names, a different answer, so a backend that resolves a
;; function VALUE by bare name hands back A's function and prints A's answer twice.
(
  (fn label [s <- String] -> String (return (+ "beta:" s)))

  (fn apply-fn [f s] (return (f s)))

  (fn beta-run [] -> String (return (apply-fn label "x")))

  (export beta-run)
)
