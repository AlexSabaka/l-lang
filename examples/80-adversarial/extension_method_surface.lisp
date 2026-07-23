;; CONFORMANCE guard: the `:extension` METHOD SURFACE on both backends (D33's second surface).
;;
;; An `:extension` function's receiver IS its first parameter, so one definition serves two surfaces:
;;
;;     PIPE     (coll |> (filter p))     ->  filter(coll, p)
;;     METHOD   (coll.filter p)          ->  filter(coll, p)     -- same call, written C#-style
;;
;; The pipe surface worked on C. The METHOD surface did not, and the failure was total rather than
;; partial: `(coll.filter p)` on a BOXED receiver went to `ll_dyn_method`, which searches the
;; receiver class's method table -- and an extension is a FREE FUNCTION that by construction is not in
;; it. So every method-surface call trapped with "no such method on this value" at run time.
;;
;; It stayed invisible because `16-stdlib/02_linq_pipeline.lisp` is the corpus's only method-surface
;; site, and that file was refused for `:gen` until Phase G4c. The instant the generators compiled, it
;; got 14 of its 18 golden lines and died on line 15.
;;
;; WHY BOXED IS THE INTERESTING CASE. The C backend already devirtualized extensions on a CONCRETELY
;; typed receiver (`(s.words)` on a String), keyed by C type name. But every `Iterable<T>` is boxed --
;; an interface is a contract, not a layout (see `interface_typed_slot.lisp`) -- so the entire lazy
;; sequence library sat in the one case that had no path.
;;
;; WHAT EACH LINE IS FOR:
;;
;;   1. A BOUND receiver: `(s.filter keep)` where `s` is a variable. This shape is what `classifyCall`
;;      models as an `ext-call`, and the HIR node already carries the resolved `fnName` -- the fix
;;      consumes it instead of recomputing dispatch by a weaker rule and losing the answer.
;;   2. A CHAINED receiver: `((expr).filter keep)`. A DIFFERENT list shape -- the head is the receiver
;;      expression and the member arrives as a separate `.filter` node -- which `classifyCall` leaves
;;      opaque, so it is resolved from the receiver's inferred type instead. Both shapes must work or
;;      the surface is only half there; this is the one the corpus actually writes.
;;   3. A USER extension over a user interface, to show this is not a std/iter special case.
;;   4. THE PRECEDENCE CONTROL, and the reason this file is not three lines. A type's OWN method must
;;      win over an extension of the same name. `classifyCall` checks member-kind first and only then
;;      looks for a conforming extension; the C path has to apply the same order, or a receiver whose
;;      type genuinely declares `describe` would be silently redirected to the extension -- a
;;      divergence invented while closing one. Both backends must print the METHOD's answer here.
(
    (import "std/iter")
    (import "std/iter/linq")

    (fn keep [x] (> x 1))

    ;; 1. a BOUND receiver.
    (let s (seq [1 2 3]))
    (let a ((s.filter keep).to-list))
    (console.log (a.join " "))

    ;; 2. a CHAINED receiver -- the shape `02_linq_pipeline` writes.
    (let b ((((seq [1 2 3 4]).filter keep).map (fn [x] (* x 10))).to-list))
    (console.log (b.join " "))

    ;; 3. a USER extension over a user interface.
    (definterface Named
        (fn label [] -> String)
    )
    (defstruct Tag :implements Named
        (let :ctor text <- String)
        (fn label [] -> String (return this.text))
    )
    (fn :extension shout [n <- Named] -> String (return '"{(n.label)}!"))
    (fn hail [n <- Named] -> String (return (n.shout)))
    (console.log (hail (Tag "hi")))

    ;; 4. THE CONTROL: an own method beats a same-named extension.
    (definterface Speaker
        (fn describe [] -> String)
    )
    (defstruct Parrot :implements Speaker
        (let :ctor word <- String)
        (fn describe [] -> String (return '"method:{(this.word)}"))
    )
    (fn :extension describe [s <- Speaker] -> String (return "extension"))
    (fn ask [s <- Speaker] -> String (return (s.describe)))
    (console.log (ask (Parrot "hello")))
)
