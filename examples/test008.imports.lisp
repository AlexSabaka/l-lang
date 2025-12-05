(
  (let a 1)
  (let b 2)
  (let c 3)
  (let d 4)
  (let e 5)
  (let f 6)

  (export (std.console.log "Hello, from import file"))

  (fn answer-to-the-question-of-universe [] (
    (std.console.log "Anyway")
    (return 42))
  )

  (export answer-to-the-question-of-universe)
  (export a b c d e f)
)