;; The provider for `main.lisp`'s LL0235 negative test. Two names, deliberately differing in ONE way:
;; `offered` is exported and `withheld` is not, so the two arms of the diagnostic are distinguishable.
(
    (fn offered [] -> Int ((return 1)))
    (fn withheld [] -> Int ((return 2)))
    (export offered)
)
