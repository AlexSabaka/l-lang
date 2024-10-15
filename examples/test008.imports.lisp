(

  ;; (import "")

  (let a 1)
  (let b 2)
  (let c 3)
  (let d 4)
  (let e 5)
  (let f 6)

  (defclass asad)
  (definterface asad
    (fn asad [] (return 0)))

  (defstruct asad)
  (defenum saddf
    :aValue => 1
    :bValue => 2
    :cValue => 3)
  
  (deftype List<T> :is Nil | 
    (T & List<T>))
  (deftype Natural :is Zero | 
    (Succ & Natural))
  (defmacro saddf)

  (export
    (fn answer-to-the-question-of-universe [a <- Number] 
      (return 42)))

  (export a b c d e f)

  (export
    (namespace some-namespace-from-file
      (let a 31)
      (let b 32)
      (let c 33)
      (let d 34)
      (let e 35)
      (let f 36))))
