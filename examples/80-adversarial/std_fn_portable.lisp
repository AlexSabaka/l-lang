;; ADVERSARIAL: `std/fn`'s `partial` was a HOST call, and nothing in the corpus ever called it.
;;
;; The module read as portable l-lang and was not: `partial` and the module-private `apply` were
;; `func.apply null args`, a JavaScript method on a JavaScript function object. On the reference
;; backend that is `TypeError: no such method on this value`.
;;
;; IT SURVIVED BECAUSE NOBODY CALLED IT. `16-stdlib/test_stdlib.lisp` exercises `identity`,
;; `constantly` and `compose` -- and `compose` uses `reduceRight`, a real native method, so it worked.
;; `partial` had no call site anywhere in `examples/` or `lib/`, so the one export that could not run
;; on C was the one nothing asked to. The project's own question, inverted: not "who calls it?" but
;; "what does nobody call?"
;;
;; `(func ...args)` is D93's spread call -- the argument count is not static, so it goes through the
;; boxed convention. That is precisely what `func.apply` was imitating, and it needs no host. The
;; blocker that justified the host version was removed in `dc4df1a`/`c1bccb9`/`ff95b4f`; the module
;; was simply never rewritten.
(
  (import "std/fn")

  (fn add3 [a <- Int b <- Int c <- Int] -> Int (+ a (+ b c)))

  ;; One fixed argument, two more at the call -- the shape that was broken.
  (let add1 (partial add3 1))
  (console.log "partial 1 :" (add1 2 3))

  ;; TWO fixed, one more. The concat is `fixed-args.concat more-args`, so a lowering that reversed it
  ;; would still answer 6 for a commutative operator -- which is why the check below is not `+`.
  (let sub-from (partial (fn [a <- Int b <- Int] -> Int (- a b)) 10))
  (console.log "order     :" (sub-from 3))

  ;; ZERO fixed arguments: the degenerate case, where `fixed-args` is an empty rest vector and the
  ;; concat must still produce a callable spread rather than an empty call.
  (let plain (partial add3))
  (console.log "no fixed  :" (plain 1 2 3))

  ;; A partial OF a partial -- two nested spread calls, so the inner one's packed vector becomes the
  ;; outer one's arguments.
  (let add1and2 (partial (partial add3 1) 2))
  (console.log "nested    :" (add1and2 3))

  ;; The exports that already worked, kept as the control: this file must fail for `partial`'s reason
  ;; if it fails at all.
  (fn inc [n <- Int] -> Int (+ n 1))
  (fn sqr [n <- Int] -> Int (* n n))
  (let sqr-inc (compose sqr inc))
  (console.log "compose   :" (sqr-inc 3))
  (console.log "identity  :" (identity 42))
  (console.log "done")
)
