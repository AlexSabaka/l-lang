;; A `try` IN TAIL POSITION YIELDS ITS VALUE (D114), and the loops beside it still do not.
;;
;; D110 ruled a `try` is an EXPRESSION whose value comes from the try block or a catch arm, with no
;; carve-out for statement position. The desugarer's `isValueTail` disagreed: it listed `try-catch`
;; among the forms that are "statements in a tail", so the implicit return skipped it and the value
;; was dropped. Measured on both backends, the same form in two positions:
;;
;;     (let x (try 9))        ->  9
;;     (fn f [] (try 9))      ->  nil
;;
;; THE LOOPS ARE THE OTHER HALF OF THIS FILE, and they are NOT a bug. D100 rules that "a loop in
;; statement position is untouched and still yields nil" -- only a loop BOUND to a name becomes a
;; lazy sequence, because 364 of the corpus's 367 loops are in statement position and rewriting them
;; all into coroutines would allocate frames nobody asked for. So a loop in a tail must keep yielding
;; nil, and pinning that here is what stops this fix being over-applied to them later.
;;
;; `if`, `match`, `when` and `cond` already returned their tail value and are the controls.
(
    (fn risky [] -> Int (throw (new ValueError "x")))

    ;; -- the four `try` shapes, in TAIL position ----------------------------------------------------
    (fn bare [] -> Any (try 9))
    (fn with-catch [] -> Any (try 9 catch e 0))
    (fn catch-taken [] -> Any (try ((risky) 9) catch e 42))
    (fn with-finally [] -> Any (try 9 catch e 0 finally 99))

    (console.log "bare:" (bare))
    (console.log "with-catch:" (with-catch))
    (console.log "catch-taken:" (catch-taken))
    (console.log "with-finally:" (with-finally))

    ;; -- the same shapes BOUND, which always worked. Both columns must agree. -----------------------
    (fn l-bare [] -> Any ((let v (try 9)) (return v)))
    (fn l-catch-taken [] -> Any ((let v (try ((risky) 9) catch e 42)) (return v)))
    (console.log "bound bare:" (l-bare))
    (console.log "bound catch-taken:" (l-catch-taken))

    ;; -- CONTROLS that already worked ---------------------------------------------------------------
    (fn t-if [] -> Any (if true 1 2))
    (fn t-match [] -> Any (match 1 { 1 => 11  _ => 12 }))
    (fn t-when [] -> Any (when true 5))
    (fn t-cond [] -> Any (cond (true 7)))
    (console.log "if:" (t-if) " match:" (t-match) " when:" (t-when) " cond:" (t-cond))

    ;; -- THE OTHER HALF: a loop in a tail still yields nil, by D100. If these ever print a value,
    ;;    the tail fix has been over-applied and 364 statement loops have grown coroutine frames.
    (fn t-while [] -> Any ((mut i 0) (while (< i 3) (i := (+ i 1)))))
    (fn t-foreach [] -> Any (for :each x :from [1 2 3] :then x))
    (fn t-for [] -> Any (for :init (mut i 0) :cond (< i 2) :step (i := (+ i 1)) :then i))
    (console.log "while:" (t-while) " for-each:" (t-foreach) " for:" (t-for))
)
