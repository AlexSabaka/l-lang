;; D47 conditions/restarts are refused on the JavaScript backend (LL0108): JS has no native
;; handler/restart stack (setjmp/longjmp on C). Compile with --language c to use them. Negative
;; test -- must fail with LL0108.
((restart-case 1 (:r [] 2)))
