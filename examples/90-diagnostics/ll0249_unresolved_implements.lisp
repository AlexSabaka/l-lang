;; `:implements` naming nothing reachable -> LL0249, in BOTH declaration spellings.
;;
;; The struct arm is the one that matters. `checkDeclaredInterfaces` is typed `ClassNode |
;; StructNode` -- written for both -- and was called from `visitClass` alone, so a struct's
;; `:implements` was never verified at all: LL0209 included. Six of the seven `:implements
;; Iterator/Iterable` sites in the corpus are structs, as are `RangeCursor` and `Range` in
;; `lib/std/iter`, so the iteration protocol was the least-checked thing in the language.
;;
;; LL0231 accompanies each: an unresolved name is not a type either, and that is the diagnostic
;; saying an unknown annotation turns checking OFF rather than merely losing information.
(
    (defclass K :implements Bogusable<Int>
        (let :ctor v <- Int))

    (defstruct S :implements Bogusable<Int>
        (mut :ctor v <- Int))
)
