;; MODIFIERS (D75) CROSSED WITH THE OTHER FORMS -- the combinations `10-modifiers/` does not make.
;;
;; That decade's nine files each exercise ONE modifier shape in isolation. None of them puts a
;; decorated function next to a macro, a protected region, or a second decorator, and none pins the
;; ORDER two decorators compose in. This file does, because the decoration machinery is implemented
;; SEPARATELY IN EACH BACKEND -- `JSTransformerAstVisitor` for JS, the resolver/emitter pair for C --
;; which is this project's failure mode #2 waiting to happen: one of the two learns a rule and the
;; other does not, and only a file that runs both notices.
;;
;; STACKING ORDER IS THE LOAD-BEARING ROW. `:dbl :plus1` answers 9, not 10, so the FIRST-LISTED
;; modifier is the INNERMOST wrapper: `(4*2)+1`, not `(4+1)*2`. Nothing stated that anywhere and both
;; orders are defensible, so it is pinned here as measurement rather than argued from a rule.
;;
;; TWO THINGS THIS FILE DELIBERATELY DOES NOT CONTAIN, both recorded in docs/roadmap.md with their
;; measurements rather than pinned here, because pinning them would pin a defect:
;;   * a modifier on a METHOD is SILENTLY IGNORED -- accepted, no diagnostic, and does nothing, on
;;     BOTH backends. Shared wrongness, which the oracle is structurally blind to.
;;   * a decorated SELF-RECURSIVE function emits C that will not compile.
(
    (defmodifier dbl [] (fn [original ...args] (* (original ...args) 2)))
    (defmodifier plus1 [] (fn [original ...args] (+ (original ...args) 1)))
    (defsyntax inc [e] `(+ ~e 1))

    ;; 1. THE CONTROL: a plain decorated free function. 4+1 = 5, doubled.
    (fn :dbl plain [x <- Int] -> Int (+ x 1))
    (console.log "plain:" (plain 4))

    ;; 2. STACKED, and the ORDER is the point. First-listed is innermost: (4*2)+1.
    (fn :dbl :plus1 stacked [x <- Int] -> Int x)
    (console.log "stacked:" (stacked 4))

    ;; 3. THE DECORATED BODY CONTAINS A PROTECTED REGION. The decorator wraps a function whose body
    ;;    establishes and pops a handler frame; the wrapper must not disturb it.
    (fn :dbl has-try [x <- Int] -> Int (
        (try ((if (< x 0) (throw (new ValueError "boom")))) catch e 99)
        (+ x 1)))
    (console.log "fn has try:" (has-try 4))

    ;; 4. THE DECORATOR ITSELF CONTAINS A PROTECTED REGION -- the other direction, and the one that
    ;;    makes a decorator useful: the wrapper catches what the original throws.
    (defmodifier guarded [] (fn [original ...args] (try (original ...args) catch e 99)))
    (fn :guarded risky [x <- Int] -> Int ((if (< x 0) (throw (new ValueError "boom"))) (+ x 1)))
    (console.log "guarded ok:" (risky 4))
    (console.log "guarded caught:" (risky -1))

    ;; 5. THE DECORATOR CONTAINS A LOOP and calls the original MORE THAN ONCE -- three calls of
    ;;    (4+1), so a wrapper that memoised or dropped repeats would show here.
    (defmodifier thrice [] (fn [original ...args]
        ((mut t 0) (mut i 0) (while (< i 3) ((i := (+ i 1)) (t := (+ t (original ...args))))) t)))
    (fn :thrice counted [x <- Int] -> Int (+ x 1))
    (console.log "decorator loops:" (counted 4))

    ;; 6. A MACRO INSIDE A DECORATED BODY. Expansion happens between parse and syntax (D95) and
    ;;    decoration is unfolded at compile time (D75); this says the two stages compose.
    (fn :dbl with-macro [x <- Int] -> Int (inc x))
    (console.log "with macro:" (with-macro 4))

    ;; 7. A DECORATED FUNCTION CALLING ANOTHER DECORATED FUNCTION. Not recursion -- that is the
    ;;    broken case -- but the nearest shape that works, so the boundary is visible: (1+1)*2 = 4
    ;;    from `inner`, then `outer` doubles it.
    (fn :dbl inner [n <- Int] -> Int (+ n 1))
    (fn :dbl outer [n <- Int] -> Int (inner n))
    (console.log "decorated calls decorated:" (outer 1))
)
