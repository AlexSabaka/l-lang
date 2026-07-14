(
  (fn identity [x] x)
  (fn constantly [x] (fn [] x))
  
  (fn partial [func ...fixed-args] 
    (fn [...more-args] 
      (func.apply null (fixed-args.concat more-args))))

  ;; NOT EXPORTED (Sf). `apply` collides with D17: `(x |> (.m a))` is a METHOD call, so `.apply` is
  ;; method dispatch on the receiver -- and `05_matching.lisp` had to hand-roll a workaround for
  ;; exactly this name. A stdlib export that shadows a method dispatch is a trap with no upside;
  ;; nothing in the corpus calls it. It stays module-private, which is what D20's boundary is FOR.
  (fn apply [func args] (func.apply null args))

  (fn compose [...funcs]
    (fn [x]
      (funcs.reduceRight (fn [acc f] (f acc)) x)))

  (export identity constantly partial compose)
)