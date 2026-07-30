;; PORTABLE. `partial`/`apply`/`compose` were `func.apply null args` and `funcs.reduceRight` HOST
;; calls -- a JS module wearing a portable module's clothes, which failed on the reference backend
;; with `TypeError: no such method on this value`. The spread-call blocker that justified them is
;; gone (dc4df1a, c1bccb9, ff95b4f), so they are ordinary l-lang now and run on both backends.
(
  (fn identity [x] x)
  (fn constantly [x] (fn [] x))

  ;; `(func ...args)` is D93's spread call: the argument count is not static, so it goes through the
  ;; boxed convention. That is exactly what `func.apply` was imitating, and it needs no host.
  (fn partial [func ...fixed-args]
    (fn [...more-args]
      (func ...(fixed-args.concat more-args))))

  ;; NOT EXPORTED (Sf). `apply` collides with D17: `(x |> (.m a))` is a METHOD call, so `.apply` is
  ;; method dispatch on the receiver -- and `05_matching.lisp` had to hand-roll a workaround for
  ;; exactly this name. A stdlib export that shadows a method dispatch is a trap with no upside;
  ;; nothing in the corpus calls it. It stays module-private, which is what D20's boundary is FOR.
  (fn apply [func args] (func ...args))

  ;; `reduceRight` is a native vector method on both backends -- it was never the blocker here; the
  ;; receiver being a rest parameter (an ordinary vector) is what makes this portable.
  (fn compose [...funcs]
    (fn [x]
      (funcs.reduceRight (fn [acc f] (f acc)) x)))

  (export identity constantly partial compose)
)
