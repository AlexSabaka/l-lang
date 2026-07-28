;; std/debug -- the developer toolkit. `dbg`/`dbg-at` print to STDERR and RETURN their value (so they
;; drop inline); `inspect` type-tags a value; `assert`/`unreachable`/`todo`/`unimplemented` END THE
;; PROCESS.
;;
;; The panic family used to `throw (FatalError …)` and this example used to CATCH it -- which is what
;; made the old behaviour visibly wrong: `catch :of Error` swallowed "this cannot happen", so a broad
;; handler turned a program defect into a handled condition (D87). They panic now, so the file
;; demonstrates the surface and then ends on one, with a `.panic` golden.
;;
;; (The [dbg] lines go to stderr, so they are not part of this program's stdout golden -- what is
;; checked here is that dbg RETURNS its argument and that inspect behaves.)
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

    ;; An assertion that HOLDS is silent and costs nothing observable -- the common case.
    (assert (== (+ 2 2) 4) "arithmetic holds")
    (console.log "assert passed")

    ;; And the panic itself, last, because there is nothing after it: the process ends here and the
    ;; message is pinned by `09_debug.panic`. No `try` around it -- there is no longer anything a
    ;; handler could do, which is the whole point of the D87 ruling.
    (unreachable "bad branch")
)
