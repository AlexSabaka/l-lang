;; CONFORMANCE guard: `deep-copy` is not the store copy, and both backends agree which is which.
;;
;; The language has TWO copies and they are different operations:
;;
;;   the STORE copy   inserted by the compiler at a binding (D11). Memberwise on a struct; a
;;                    reference field is SHARED. That is the C# rule, and `02_value_semantics.lisp`
;;                    pins it: `b.tags.push "blue"` IS visible through `a`.
;;   `deep-copy`      asked for BY NAME. Recurses through arrays as well, so a vector of structs
;;                    comes back with copied elements.
;;
;; Telling them apart is the entire reason this needed modelling. JS had both -- `__ll_copy` and
;; `deep2dcopy` -- and C had only the first, so the obvious move of pointing the new floor entry at
;; `ll_copy` would have made `(deep-copy [s1 s2])` SHARE its elements on C and COPY them on JS. A
;; divergence created by the act of naming the operation, which is the failure mode D50 warns about
;; from the other direction: modelling a name badly is worse than not modelling it.
;;
;; Line 2 is the discriminating one. A struct holding an ARRAY is where the two copies visibly part:
;; the store copy shares that array, `deep-copy` does not.
(
    (defstruct P (mut :ctor x <- Int 0))
    (mut orig [(P 1) (P 2)])
    (mut copied (deep-copy orig))
    (copied[0].x := 99)
    (console.log "vec of structs: " orig[0].x copied[0].x)

    ;; The discriminator: `tags` is a reference field. The STORE copy would share it -- see
    ;; 06-value-semantics/02_value_semantics.lisp, which pins exactly that -- and `deep-copy` must not.
    (defstruct Holder (mut :ctor tags <- String[]))
    (mut h (Holder ["a"]))
    (mut h2 (deep-copy h))
    (h2.tags.push "b")
    (console.log "struct w/ array:" h.tags.length h2.tags.length)

    ;; A scalar is itself on both -- the base case that keeps the recursion total.
    (console.log "scalar:         " (deep-copy 5))
)
