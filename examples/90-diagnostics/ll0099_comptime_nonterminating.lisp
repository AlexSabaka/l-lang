;; NEGATIVE: a `:comptime` computation that does not terminate -> LL0099 (D73).
;;
;; This used to HANG THE COMPILER. `vm.runInContext` was called with no timeout, so the build simply
;; never returned -- no diagnostic, no location, no output, nothing to interrupt but the process.
;;
;; The interpreter carries a step and depth budget, so a runaway fold is a failed compile with a
;; location instead of a hung one. The location is the recursive CALL inside `spin`, not the
;; `(console.log …)` that triggered the fold: a JS exception carried a JS stack, so the vm could only
;; ever have pointed at the outermost expression even if it had been able to stop.
(
  (fn :comptime spin [n <- Int] -> Int (spin (+ n 1)))

  (console.log (spin 0))
)
