;; CONFORMANCE: `std/sys/process` -- and the OFFSET its own header calls a silent-wrong hazard.
;;
;; The module says it plainly: "The two hosts disagree about what leads the list: node's
;; `process.argv` starts with the interpreter and the script, C's `argv[0]` is the program. Both are
;; 'how this process was invoked' rather than 'what was asked for', so both runtimes drop their own
;; prefix and this list means the same thing on either backend. Getting that offset wrong would put
;; every index into `args` off by one on exactly one backend -- the silent-wrong class the floor
;; exists for."
;;
;; NOTHING TESTED IT. This module had no corpus file at all -- found by asking which stdlib modules no
;; example imports, the module-level version of the "what does nobody call?" audit that found
;; `std/math/random`.
;;
;; The harness runs a compiled program with NO user arguments -- `spawnSync(binPath, [])` on C,
;; `spawnSync("node", [jsPath])` on JS -- so `args` must be EMPTY on both. That is the offset
;; assertion: a backend that leaked its own prefix would answer 1 (C's program name) or 2 (node's
;; interpreter and script) instead of 0.
;;
;; NO POSITIVE ENV CASE IS ASSERTED, deliberately. `CHILD_ENV` is `{...process.env, FORCE_COLOR: "0"}`,
;; so every real variable is INHERITED from whatever machine runs the suite -- and `childEnv.ts`'s own
;; doctrine is that "a test's result must depend on the code under test and nothing else". Asserting
;; `PATH` would import the machine into the golden. The unset direction needs no such luck.
(
    (import "std/sys/process")

    ;; The offset. Zero on both backends, or one of them is leaking its own invocation.
    (console.log "user args      :" args.length)

    ;; UNSET is nil, never "" -- the module's D9 ruling, since `FOO=` genuinely sets an empty value and
    ;; absent is a different question. The name is deliberately absurd so no environment can hold it.
    (console.log "unset is nil   :" (== (env "LLANG_NO_SUCH_VAR_XYZ") nil))

    ;; The predicate spelling of the same question (D21's `is-x`), which must agree with it.
    (console.log "is-env-set     :" (is-env-set "LLANG_NO_SUCH_VAR_XYZ"))

    ;; And the fallback shape, which exists so callers do not each re-write the nil test -- so it must
    ;; take the fallback on exactly the inputs `env` answers nil for.
    (console.log "env-or fallback:" (env-or "LLANG_NO_SUCH_VAR_XYZ" "fallback"))
    (console.log "done")
)
