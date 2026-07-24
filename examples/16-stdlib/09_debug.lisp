;; std/debug -- the developer toolkit. `dbg`/`dbg-at` print to STDERR and RETURN their value (so they
;; drop inline); `inspect` type-tags a value; `unreachable`/`todo`/`unimplemented` throw a FatalError.
;; (The [dbg] lines go to stderr, so they are not part of this program's stdout golden -- what is
;; checked here is that dbg RETURNS its argument and that inspect / the panics behave.)
(
    (import "std/debug")

    ;; dbg returns its argument unchanged -- the print is a stderr side effect
    (let x (dbg 42))
    (console.log "return:" x)
    (console.log "inline:" (+ 1 (dbg 10)))

    ;; inspect tags a value with its type name
    (console.log "inspect:" (inspect 42))
    (console.log "inspect:" (inspect [1 2 3]))
    (console.log "inspect:" (inspect "hi"))

    ;; the panic trio throws FatalError
    (try (unreachable "bad branch")
         catch e :of FatalError (console.log "caught:" e.message))
    (try (todo)
         catch e :of Error (console.log "todo:" e.message))
)
