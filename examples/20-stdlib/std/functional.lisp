(
  (fn identity [x] x)
  (fn constantly [x] (fn [] x))
  
  (fn partial [func ...fixed-args] 
    (fn [...more-args] 
      (func.apply null (fixed-args.concat more-args))))

  (fn apply [func args] (func.apply null args))

  (fn compose [...funcs]
    (fn [x] 
      (funcs.reduceRight (fn [acc f] (f acc)) x)))
      
  (export identity constantly partial apply compose)
)