(
    (deftype uint8 Int :where Int :is (0 .. 255))

    (defstruct :public StringWrapper
        (mut :private :stack bytes <- uint8[256] [0])
        (mut :private :stack length <- uint8 0)

        (fn len [] -> uint8 this.length)
        (fn is_empty [] -> Boolean this.length)

        (fn :operator * [count <- Int] -> StringWrapper
            (when (or (<= count 0) (== this.length 0))
                (return this)
            )
            (for 
                :init (mut i 0)
                :cond (< i this.length)
                :step (i := (+ i 1))
                :then (for 
                    :init (mut j 0)
                    :cond (< j count)
                    :step (j := (+ j 1))
                    :then (this.bytes[(+ (* i count) j)] := this.bytes[i])
                )
            )
            (return this)
        )
    )
)