(
  (fn range [start <- Int end <- Int step <- Int] -> Int[]
    (let result [])
    (for :init (mut i start) :cond (< i end) :step (i := (+ i step)) :then (
      (result.push i)
    ))
    (return result)
  )

  (fn zip [list <- Any[] other <- Any[]] -> Any[]
    (let result [])
    (let len (if (< list.length other.length) list.length other.length))
    (for :init (mut i 0) :cond (< i len) :step (i := (+ i 1)) :then (
      (result.push [list[i] other[i]])
    ))
    (return result)
  )

  ;; Functional Operations
  (fn map [op coll] 
    (coll.map op))

  (fn filter [pred coll] 
    (coll.filter pred))

  (fn reduce [op init coll] 
    (coll.reduce op init))

  (fn flatten [coll] 
    (coll.flat 1))

  (fn reverse [coll] 
    (coll.reverse))

  (fn sort [coll] 
    (coll.sort))
    
  (fn sort-by [key-fn coll]
    (coll.sort (fn [a b] (- (key-fn a) (key-fn b)))))

  (export range zip map filter reduce flatten reverse sort sort-by)
)