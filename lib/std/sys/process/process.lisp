;; std/sys/process -- what this process was ASKED to do: its arguments, its environment, its exit.
;;
;; The first stdlib module over the PROCESS floor (`sys-args`, `sys-env`, `sys-exit`). Everything
;; here is a thin, typed layer: the operations themselves are syscalls and cannot be written in
;; l-lang, so the module's job is naming and shape, not implementation.
;;
;; `args` IS A BINDING, NOT A FUNCTION, and that is a ruling rather than a convenience.
;;
;; D1 makes `(x)` a READ of `x` rather than a zero-argument call, so a zero-parameter function is not
;; callable from source at all -- `(args)` would hand back the function object. The floor records the
;; same trap as the reason there is no `map-new`.
;;
;; So the floor exposes `sys-arg`, the INDEXED accessor -- unary, therefore callable -- and this module
;; assembles the vector. See floor.ts for the two routes that were tried and failed: `(call sys-args)`
;; needs a floor function as a value, which C cannot represent, and `(sys.args)` is a call on C but
;; host MEMBER ACCESS on JS, where it threw `ReferenceError: sys is not defined`.
;;
;; That split is D50-shaped anyway: the irreducible part is "ask the host for argument i", and the
;; loop around it is portable by construction rather than implemented twice.
;;
;; A binding is the better API regardless. A command line does not change while a process runs, so it
;; is DATA, and `args` should read as a value rather than as an action performed afresh at each
;; mention.
(
    ;; The arguments the USER passed -- neither backend includes the program name.
    ;;
    ;; The two hosts disagree about what leads the list: node's `process.argv` starts with the
    ;; interpreter and the script, C's `argv[0]` is the program. Both are "how this process was
    ;; invoked" rather than "what was asked for", so both runtimes drop their own prefix and this
    ;; list means the same thing on either backend. Getting that offset wrong would put every index
    ;; into `args` off by one on exactly one backend -- the silent-wrong class the floor exists for.
    ;; `nil` past the end is what terminates this -- an argument COUNT would be a second nullary
    ;; floor entry with exactly the same uncallability problem.
    (fn collect-args [start <- Int] -> String[] (
        (mut out [])
        (mut i start)
        (mut a (sys-arg i))
        (while (!= a nil) (
            (out.push a)
            (i := (+ i 1))
            (a := (sys-arg i))
        ))
        (return out)
    ))

    (let args (collect-args 0))

    ;; An environment variable, or `nil` if it is not set.
    ;;
    ;; `nil` for UNSET, never "" -- absent and empty are different questions, and `FOO=` genuinely
    ;; sets an empty value. D9 has exactly one bottom value to say the first with, and both runtimes
    ;; preserve the distinction (`getenv`'s NULL, `process.env`'s `undefined`).
    (fn env [name <- String] -> String?
        (return (sys-env name)))

    ;; Is a variable set at all? The predicate spelling, per D21's `is-x`.
    (fn is-env-set [name <- String] -> Boolean
        (return (!= (sys-env name) nil)))

    ;; An environment variable, or `fallback` when it is unset. The overwhelmingly common shape, and
    ;; worth having so callers do not each re-write the nil test.
    (fn env-or [name <- String fallback <- String] -> String (
        (let v (sys-env name))
        (if (== v nil) (return fallback))
        (return v)
    ))

    ;; End the process with a status. Does not return -- on either backend.
    (fn exit [code <- Int] -> Void
        (sys-exit code))

    (export args env is-env-set env-or exit)
)
