;; A CENSUS, TURNED INTO A GUARD: every form below IS typed, and this file goes red if one stops.
;;
;; This session found TEN forms whose value the checker never looked at, one at a time, each by
;; accident while asking about something else -- `try` (D110), `when`/`cond` (D112), `quote` (D113),
;; then a bound loop, a user-operator result, an enum member, a `catch e :of T` binding, and four of
;; the D47 condition forms. Every one of them was SILENT: a deliberately wrong annotation over the
;; form produced no diagnostic at all.
;;
;; That failure mode is invisible by construction. An untyped form does not fail, it simply stops
;; being checked, so no golden moves and no test goes red -- which is why ten of them accumulated
;; under a green gate. The only thing that catches it is asking the question directly, and asking it
;; of the forms that currently PASS.
;;
;; So: every row is a deliberately WRONG annotation over a form whose type the checker does know
;; today. `f` returns Int, so `<- String` is wrong everywhere it appears. If a row ever stops
;; reporting, that form has joined the untyped family and this file is the notice.
;;
;; THE FORMS KNOWN TO BE UNTYPED ARE DELIBERATELY ABSENT -- they are mapped in docs/roadmap.md with
;; their causes, and six of them share one. Adding them here would make the file red today rather
;; than on a regression.
(
    (import "std/protocols")
    (defclass Plain (let :ctor label <- String))
    (fn f [] -> Int (return 5))
    (fn ident [x <- Int] -> Int (return x))
    (defsyntax mac [e] `(+ ~e 0))

    ;; the CONTROL: an ordinary call. If this row ever goes silent the whole file means nothing.
    (let a <- String (f))

    ;; the branching forms -- `if`'s value, and the three that were each found untyped in turn
    (let b <- String (if true (f) (f)))
    (let c <- String (when true (f)))
    (let d <- String (cond (true (f)) (:else (f))))
    (let e <- String (match 1 { 1 => (f)  _ => (f) }))

    ;; `try` as an expression (D110/D114), and a plain block
    (let g <- String (try (f) catch err (f)))
    (let h <- String ((f)))

    ;; the access forms
    (let i <- String ([1 2 3])[0])
    (let j <- String (new Plain "x").label)
    (let k <- Int ((new Plain "x") :of Plain))

    ;; construction and literals
    (let l <- String (new Plain "x"))
    (let m <- String [1 2 3])
    (let n <- String {"a" 1})
    (let o <- Int f"v={(f)}")
    (let p <- String (fn [x <- Int] -> Int (return x)))

    ;; the fold forms, a written cast, and a macro EXPANSION's result
    (let q <- String (5 |> ident))
    (let r <- String (cast<Int> 5))
    (let s <- String (mac 5))

    ;; a quoted datum (D113), and a generator's own value
    (let t <- String '(a b))
    (let u <- String ((fn :gen gg [] -> Iterator<Int> ((yield 1)))))

    ;; a `for :each` ELEMENT binding, which is typed from the collection
    (for :each elem :from [1 2 3] :then ((let v <- String elem) v))
)
