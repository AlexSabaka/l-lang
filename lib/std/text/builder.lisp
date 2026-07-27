;; std/text/builder -- a mutable string accumulator.
;;
;; Text is kept as CHUNKS and joined only when a String is asked for. That is the whole idea, and it
;; is worth stating why it is not merely a nicer spelling of `+`.
;;
;; Repeated `(s := (+ s chunk))` copies the ENTIRE prefix on every append: appending n chunks copies
;; the accumulated text n times, so building a table row by row is quadratic in the output size. It is
;; the classic accidentally-O(n^2) loop, and it is invisible until the output gets big -- which for a
;; help screen or a JSON document is exactly when it starts to matter.
;;
;; Here every `append` is one vector push, and `to-string` is ONE join. The join is the native
;; `.join`, which is a single pass on both backends (`ll_vec_join` on C, `Array.prototype.join` on JS)
;; rather than a fold of `+` -- so the total work is linear in the output, and the copy happens once.
;;
;; NO IMPORTS, deliberately. `.join` is a native member and `codepoint-length` is a floor entry (D50),
;; both ambient on both backends, so an accumulator that every other text module will want to sit on
;; top of carries no dependency of its own. `std/core/string`'s `join` is the same operation wrapped;
;; this reaches the primitive directly rather than adding an edge to the module graph for one call.
;;
;; `length` IS IN CODEPOINTS, not chunks and not bytes -- D52's unit, the same one `strlen` answers in.
;; That is the only length a caller can act on: `chunk-count` is an artefact of how the text happened
;; to be appended, and byte length is a host detail that differs between the backends. It is computed
;; on demand rather than tracked incrementally, because a running counter is a second source of truth
;; that `clear` and a future `remove` would both have to remember to maintain.
;;
;; `to-string` is NOT `format`. `format` is the `Formattable` protocol's method (D63) and means "render
;; this VALUE for display"; a builder is not a value being rendered, it is the thing doing the
;; rendering. The module also does not declare `:implements`, because `(x :of SomeInterface)` answers
;; false on both backends today (the D58 amendment records this), so the declaration would buy nothing
;; a plain method does not.
(
    (defclass StringBuilder
        ;; PRIVATE, and that is what lets the representation stay a promise rather than a contract:
        ;; nothing outside can hold a reference to the chunk vector and mutate it behind the builder.
        (mut :private parts <- String[] [])

        ;; Append text. Answers the builder, so appends chain.
        (fn append [text <- String] -> StringBuilder (
            (this.parts.push text)
            (return this)
        ))

        ;; Append text followed by a newline. Two chunks rather than `(+ text "\n")` -- concatenating
        ;; here would do the copy this class exists to avoid, once per line.
        (fn append-line [text <- String] -> StringBuilder (
            (this.parts.push text)
            (this.parts.push "\n")
            (return this)
        ))

        ;; Append a bare newline.
        (fn line-break [] -> StringBuilder (
            (this.parts.push "\n")
            (return this)
        ))

        ;; Append `text` `n` times. `n <= 0` appends nothing rather than trapping -- a repeat count is
        ;; routinely computed (a padding width, an indent depth), and zero is the ordinary answer.
        (fn append-repeat [text <- String n <- Int] -> StringBuilder (
            (mut i <- Int 0)
            (while (< i n) (
                (this.parts.push text)
                (i := (+ i 1))
            ))
            (return this)
        ))

        ;; Drop everything. The builder is reusable, which is the point of having it over a local.
        (fn clear [] -> Void (this.parts := []))

        ;; The length of the string this WOULD produce, in codepoints (D52).
        (fn length [] -> Int (
            (mut total <- Int 0)
            (for :each p :from this.parts :then (total := (+ total (codepoint-length p))))
            (return total)
        ))

        ;; How many chunks are pending. A representation detail, exposed because it is the only way to
        ;; observe that appending does not concatenate -- which is the class's entire claim.
        (fn chunk-count [] -> Int (return this.parts.length))

        (fn is-empty [] -> Boolean (return (== (this.length) 0)))

        ;; Render. One join, one pass, one allocation.
        (fn to-string [] -> String (return (this.parts.join "")))
    )

    (export StringBuilder)
)
