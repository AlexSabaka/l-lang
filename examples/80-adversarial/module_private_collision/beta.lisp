;; Library half B -- same two private names as alpha.lisp, different values and different behaviour,
;; so a backend that collapses them by bare name prints A's answer for B.
(
  (let TAG "beta")

  (fn decorate [s <- String] -> String (return (+ "<" s ">")))

  (fn beta-label [] -> String (return (decorate (+ "from " TAG))))

  (export beta-label)
)
