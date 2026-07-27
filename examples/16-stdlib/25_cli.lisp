;; std/cli -- a command-line argument grammar.
;;
;; `std/sys/process` gives a program its `args` and stops there, so every program that wanted a command
;; and some options hand-rolled the loop -- which `cli_poc.lisp`, `a_scratchpad.lisp` and
;; `b_scratchpad.lisp` in ../l-lang-codewars each did differently.
;;
;; PARSE ANSWERS A VALUE; DISPATCH IS A SEPARATE, OPTIONAL LAYER. `parse` produces a `ParseResult` and
;; nothing else happens -- which is what makes it testable without a process, a terminal or an exit
;; code. Everything below runs on literal argv vectors for exactly that reason.
(
    (import "std/cli")

    ;; -- the spec is DATA --------------------------------------------------------------------------
    ;;
    ;; The help screen is DERIVED from it, so the two cannot drift: there is only one description of
    ;; the grammar. That is the argument for a spec object over a pile of handler registrations.

    (let spec (Cli "ll" "Compile and run l-lang programs"))
    (spec.add-option (Opt ["-v" "--verbose"] "Show compiler diagnostics"))
    (spec.add-option ((Opt ["-I" "--lib"] "Add a library root").valued "<path>"))
    (spec.add-command ((Command "compile" "Compile a source file").takes ["<file>"]))
    (spec.add-command ((Command "run" "Compile and execute a source file").takes ["<file>"]))

    (console.log (help-text spec))

    ;; -- the grammar -------------------------------------------------------------------------------

    ;; A command, a boolean flag, an attached value, and an operand.
    (let a (parse spec ["compile" "-v" "--lib=/opt/l" "a.lisp"]))
    (console.log "ok:" (a.ok) "command:" a.command "positionals:" a.positionals)
    (console.log "verbose:" (a.opt "verbose") "lib:" (a.opt "lib"))

    ;; A value in the NEXT token reads the same as an attached one.
    (let b (parse spec ["run" "--lib" "/opt/l" "b.lisp"]))
    (console.log "separate value:" (b.opt "lib") "positionals:" b.positionals)

    ;; Short and long spellings land under the SAME key -- the first long flag with its dashes
    ;; stripped -- so a program reads `verbose` regardless of what the user typed.
    (let c (parse spec ["compile" "-I" "/x" "c.lisp"]))
    (console.log "short form:" (c.opt "lib"))

    ;; An option that was not given answers nil, which is the presence test.
    (console.log "absent:" (c.opt "verbose") "has:" (c.has "verbose") (c.has "lib"))

    ;; -- the terminator ----------------------------------------------------------------------------
    ;;
    ;; Everything after `--` is an operand, dashes and all. It is how you pass a file literally named
    ;; `--verbose`, and it is the reason the loop tracks a mode rather than testing each token.

    (let d (parse spec ["compile" "--" "-v" "--lib"]))
    (console.log "after --:" d.positionals "verbose still:" (d.opt "verbose"))

    ;; -- errors are VALUES, not throws -------------------------------------------------------------
    ;;
    ;; A CLI parse failure is the single most likely thing a user does; the answer is a help screen and
    ;; exit 2, which the caller produces. A throw would make the most common path the exceptional one.

    (let e1 (parse spec ["compile" "--nope"]))
    (console.log "unknown option:" (e1.ok) (e1.error))

    (let e2 (parse spec ["deploy"]))
    (console.log "unknown command:" (e2.ok) (e2.error))

    ;; A valued option at the END of argv is a TYPO, not an empty value -- silently binding "" is how a
    ;; program writes to a file called nothing.
    (let e3 (parse spec ["compile" "--lib"]))
    (console.log "missing value:" (e3.error))

    ;; And a boolean given a value is named rather than ignored, because quietly dropping it is how
    ;; `--verbose=false` turns verbosity ON.
    (let e4 (parse spec ["compile" "--verbose=false"]))
    (console.log "value on a flag:" (e4.error))

    ;; The FIRST error wins -- it is the one the user should fix.
    (let e5 (parse spec ["deploy" "--nope"]))
    (console.log "first error wins:" (e5.error))

    ;; -- a spec with no commands -------------------------------------------------------------------
    ;;
    ;; A single-purpose tool has no verb, so every non-flag token is an operand rather than the first
    ;; one being swallowed as a command name.

    (let cat (Cli "wc" "Count things"))
    (cat.add-option (Opt ["-l" "--lines"] "Count lines"))
    (let f (parse cat ["-l" "x.txt" "y.txt"]))
    (console.log "no commands:" f.command f.positionals (f.opt "lines"))

    ;; -- the dispatch layer ------------------------------------------------------------------------
    ;;
    ;; `run` is optional and fifteen lines. A handler is invoked through `call`, which passes the
    ;; result AS WRITTEN -- one argument, typed, arity checked (D25, pinned by
    ;; `80-adversarial/call_spread_args`). It answers an exit code and does NOT call `exit`: a library
    ;; that terminates the process cannot be tested or embedded.

    (fn on-compile [r <- ParseResult] -> Int (
        (console.log "  compiling" (r.arg 0) "with lib" (r.opt "lib"))
        (return 0)
    ))
    (fn on-run [r <- ParseResult] -> Int (
        (console.log "  running" (r.arg 0))
        (return 0)
    ))

    (let handlers {})
    (map-set handlers "compile" on-compile)
    (map-set handlers "run" on-run)

    (console.log "exit:" (run spec ["compile" "--lib=/opt/l" "main.lisp"] handlers))
    (console.log "exit:" (run spec ["run" "main.lisp"] handlers))

    ;; A usage error answers 2, which is what a shell expects.
    (console.log "exit on bad usage:" (run spec ["compile" "--nope"] handlers))
)
