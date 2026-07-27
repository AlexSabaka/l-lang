;; std/text/builder -- a mutable string accumulator.
;;
;; Chunks in, one join out. The reason to have it rather than `(s := (+ s chunk))` is complexity, not
;; taste: `+` in a loop copies the whole accumulated prefix on every append, so building n chunks
;; copies the text n times. Here each append is a vector push and `to-string` is a single native join.
;;
;; That claim is not directly observable in a golden -- both spellings print the same string -- so
;; `chunk-count` is exposed and asserted below. It is the one visible consequence of not concatenating.
(
    (import "std/text/builder")

    ;; -- appending and chaining --------------------------------------------------------------------
    ;;
    ;; `append` answers the builder, so calls chain. That is why it is `-> StringBuilder` rather than
    ;; `-> Void`, and it is the shape the POC in ../l-lang-codewars was written against.

    (let b (StringBuilder))
    (b.append "Hello")
    (b.append ", ")
    (b.append "l-lang!")
    (console.log (b.to-string))

    ;; Three appends, three chunks -- the text was never concatenated along the way.
    (console.log "chunks:" (b.chunk-count))

    ;; And the length is the CODEPOINT length of the eventual string (D52), not the chunk count.
    (console.log "length:" (b.length))

    ;; -- chaining, written as one expression -------------------------------------------------------

    (let c (StringBuilder))
    (let chained (((c.append "a").append "b").append "c"))
    (console.log (chained.to-string))

    ;; The chain answers the SAME builder, not a copy -- a class is a reference type (D11), so `c` and
    ;; `chained` are one object. A value-semantics builder would have thrown two of the three appends
    ;; away here, silently.
    (console.log "same object:" (== (c.to-string) (chained.to-string)) (c.chunk-count))

    ;; -- reuse -------------------------------------------------------------------------------------
    ;;
    ;; `clear` is what makes a builder worth binding to a name instead of building a local each time.

    (b.clear)
    (console.log "after clear:" (b.chunk-count) (b.is-empty))

    (b.append-line "one")
    (b.append-line "two")
    (console.log (b.to-string))

    ;; `append-line` pushes the text and the newline SEPARATELY -- two chunks per line, because
    ;; `(+ text "\n")` would do exactly the copy this class avoids.
    (console.log "chunks for 2 lines:" (b.chunk-count))

    ;; -- repetition --------------------------------------------------------------------------------

    (let r (StringBuilder))
    (r.append-repeat "-" 10)
    (console.log (r.to-string))
    (console.log "repeat length:" (r.length))

    ;; A non-positive count appends nothing rather than trapping: a repeat count is routinely computed
    ;; (a padding width, an indent depth) and zero is the ordinary answer, not an error.
    (let z (StringBuilder))
    (z.append-repeat "x" 0)
    (z.append-repeat "y" -3)
    (console.log "non-positive repeat:" (z.is-empty) (z.chunk-count))

    ;; -- unicode -----------------------------------------------------------------------------------
    ;;
    ;; `length` is in codepoints on both backends, which is the whole reason it is not `.length` on the
    ;; joined string: that answers UTF-16 code units on JS and BYTES on C, and those disagree here.

    (let u (StringBuilder))
    (u.append "héllo")
    (u.append " wörld")
    (console.log (u.to-string))
    (console.log "codepoints:" (u.length))

    ;; -- the empty builder -------------------------------------------------------------------------

    (let e (StringBuilder))
    (console.log "empty renders:" (== (e.to-string) "") (e.length) (e.is-empty))
)
