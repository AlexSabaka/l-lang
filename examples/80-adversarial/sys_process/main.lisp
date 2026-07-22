;; CONFORMANCE guard: `std/sys/process` -- argv and the environment agree on both backends.
;;
;; The first stdlib module over the PROCESS floor, and the first time an l-lang program could read
;; anything about how it was invoked. Before this the entire i/o surface was four floor entries, all
;; of them WRITES (`console.log`, `console.error`, `write-string`, `write-string-err`), which is why
;; the whole corpus is input-free.
;;
;; WHAT THIS GUARD IS ACTUALLY FOR: the two hosts disagree about what leads the argument list, and the
;; disagreement is silent. node's `process.argv` begins with the interpreter and the script path; C's
;; `argv[0]` is the program name. Both answer "how was this process invoked" rather than "what was
;; asked for", so both runtimes drop their own prefix and index 0 means the same argument on either
;; backend. Get that offset wrong on one side and every index into `args` is off by one, on one
;; backend only, with no crash -- the silent-wrong class the floor exists to prevent.
;;
;; The test runner passes no arguments, so `args` is empty here and the OFFSET is what is really
;; being pinned: an off-by-one on either side would make this non-empty on that side. Run it by hand
;; with arguments to see the other half:
;;
;;     node main.js a b        ->  args: ["a" "b"]
;;     ./main a b              ->  args: ["a" "b"]
;;
;; `nil` for an unset variable rather than "" is the D9 half: absent and empty are different
;; questions, `FOO=` genuinely sets an empty value, and both runtimes preserve the distinction
;; (`getenv`'s NULL, `process.env`'s `undefined`).
(
    (import { args env is-env-set env-or } from "std/sys/process")

    (console.log "args:    " args)
    (console.log "count:   " args.length)

    ;; A variable no environment sets. Both backends must answer nil, not "".
    (console.log "unset:   " (env "LL_NO_SUCH_VARIABLE_XYZZY"))
    (console.log "is-set:  " (is-env-set "LL_NO_SUCH_VARIABLE_XYZZY"))
    (console.log "fallback:" (env-or "LL_NO_SUCH_VARIABLE_XYZZY" "default"))

    ;; PATH is set in every environment either backend runs in, so this discriminates "reads the
    ;; environment at all" from "always answers nil".
    (console.log "has PATH:" (is-env-set "PATH"))
)
