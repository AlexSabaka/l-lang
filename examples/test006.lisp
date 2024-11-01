(
  ; brainfuck interpreter example
  (let progs "++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++.+++++++++++++++++++++++++++++.+++++++..+++.-------------------------------------------------------------------------------.+++++++++++++++++++++++++++++++++++++++++++++++++++++++.++++++++++++++++++++++++.+++.------.--------.-------------------------------------------------------------------.-----------------------.") ;; Hello World! without loops
  (let proga (progs.split ""))
  (mut pointer 0)
  (let memory (Array 512))
  (memory.fill 0)

  (fn dump-memory [] (memory.forEach (fn [x] (std.console.print (String.fromCharCode x)))))

  (fn find-matching-bracket [prog pos direction]
      ( (mut depth 1)
        (std.console.log "Finding matching bracket at {pos} with direction {direction}")
        (while (!= depth 0) (
          (pos := (+ pos direction))
          (match (elem prog pos) {
            "[" => (if (== direction 1)
                       (depth := (+ depth 1))
                       (depth := (- depth 1)))
            "]" => (if (== direction 1)
                       (depth := (- depth 1))
                       (depth := (+ depth 1)))
          }))
          )


        (return pos)
    ))
  

  (fn run [prog <- string[] pos <- Number]
    (if (empty prog)
      (return)
      (
        (let char (head prog))
        (match char
           {
            "+" => (set! memory pointer (+ (elem memory pointer) 1))
            "-" => (set! memory pointer (- (elem memory pointer) 1))
            ">" => (pointer := (+ pointer 1))
            "<" => (pointer := (- pointer 1))
            "." => (std.console.print (String.fromCharCode (elem memory pointer)))
            "," => (set! memory pointer (call std.console.read))
            "[" => (if (== (elem memory pointer) 0)
                    (pos := (find-matching-bracket prog pos 1))
                    (pos := (+ pos 1)))
            "]" => (if (!= (elem memory pointer) 0)
                    (pos := (find-matching-bracket prog pos -1))
                    (pos := (+ pos 1)))
            _   => (std.console.log '"{(char)} at {(pos)}: Unknown character")})
        (run (tail prog) (+ pos 1)))))



  (run proga 0)
  (dump-memory)
  (std.console.log "\nDone"))
