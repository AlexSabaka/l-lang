;; ADVERSARIAL: `for :each` over a BOXED container stops at the first `nil` element on C.
;;
;; FIXED. This file was written as a record of a live defect -- it FAILED on C -- and is now the guard
;; that keeps it fixed. Found by `std/text/json`: rendering `[1 nil 2]` gave `[1,null,2]` on JS and
;; `[1]` on C, with no diagnostic anywhere.
;;
;; THE CAUSE is the iteration protocol's sentinel. The floor rules that `next` answering nil means the
;; sequence is EXHAUSTED (D30/D50) -- so a nil ELEMENT and the end of the sequence are the same value,
;; and a container is truncated at its first nil. That is exactly the in-band lie D9 objects to,
;; sitting inside the protocol that D50 exists to make identical on both backends. The floor's own
;; neighbours already avoid it: `codepoint-at` answers -1 and `file-open` answers -1 rather than nil,
;; each with a written note that a negative is out of band. `next` had no such value available.
;;
;; IT ONLY BITES WHEN BOXED, which is why nothing caught it before. A parameter typed `Any[]` lowers to
;; an index walk over a vector and is correct; a parameter typed `Any` -- the shape any code handling
;; dynamic data has, JSON being the obvious one -- goes through `iter`/`next` and is not. So the two
;; spellings of "walk this container" disagree only for containers holding nil, and only on C.
;;
;; THE FIX (ruled by Sabaka): the cursor carries a `done <- Boolean` flag -- C#'s
;; `MoveNext()`/`Current` split, where advancing reports WHETHER there was an element and the element
;; is read separately. That takes "exhausted" out of the value space, so no value can end a walk.
;;
;; A sentinel could not have worked, and the floor's neighbours show why they are not a precedent:
;; `codepoint-at` and `file-open` answer -1 because a codepoint and a file descriptor are non-negative
;; BY DEFINITION. `next` answers a `T?` for a `T` the floor cannot name -- there is no value left over
;; to spend on "done".
;;
;; A USER `Iterator<T>` keeps the nil rule, and that is correct rather than a fallback: D30's protocol
;; is `(fn next [] -> T?)`, so nil is the only signal it offers. Changing that shape is a language
;; decision, and this was not one.
(
    (let xs <- Any[] [1 nil 2])

    ;; The container itself is fine on both backends -- three elements, and `.length` says so. Nothing
    ;; is lost in construction; only the WALK disagrees.
    (console.log "length:" xs.length)

    ;; A TYPED parameter: an index walk over a vector. Correct on both.
    (fn count-typed [ys <- Any[]] -> Int (
        (mut n <- Int 0)
        (for :each y :from ys :then (n := (+ n 1)))
        (return n)
    ))
    (console.log "typed Any[]:" (count-typed xs))

    ;; A BOXED parameter: the iteration protocol. Answers 1 on C, because element 2 is nil and nil is
    ;; how the protocol spells "done".
    (fn count-boxed [ys <- Any] -> Int (
        (mut n <- Int 0)
        (for :each y :from ys :then (n := (+ n 1)))
        (return n)
    ))
    (console.log "boxed Any:" (count-boxed xs))

    ;; The same boxed parameter walked BY INDEX through the floor's total accessor. Correct on both,
    ;; and the reason `std/text/json` renders `null` inside an array at all.
    (fn count-by-index [ys <- Any] -> Int (
        (mut n <- Int 0)
        (mut i <- Int 0)
        (while (< i ys.length) (
            (get ys i)
            (n := (+ n 1))
            (i := (+ i 1))
        ))
        (return n)
    ))
    (console.log "boxed by index:" (count-by-index xs))

    ;; A container with NO nil takes the same protocol path and is correct -- which is why every other
    ;; boxed iteration in the corpus passes and this went unnoticed.
    (let clean <- Any[] [1 2 3])
    (console.log "boxed, no nil:" (count-boxed clean))

    ;; A LEADING nil loses everything, so the failure is not "off by one at the end".
    (let leading <- Any[] [nil 1 2])
    (console.log "leading nil:" (count-boxed leading))
)
