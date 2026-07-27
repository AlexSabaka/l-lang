;; std/cli -- a command-line argument grammar.
;;
;; `std/sys/process` gives a program its `args`. Nothing turned that vector into a command, a set of
;; options and a list of operands, so every program that wanted to had to hand-roll it -- which is what
;; `cli_poc.lisp`, `a_scratchpad.lisp` and `b_scratchpad.lisp` in ../l-lang-codewars each did
;; differently.
;;
;; ------------------------------------------------------------------------------------------------
;; PARSE ANSWERS A VALUE. DISPATCH IS A SEPARATE, OPTIONAL LAYER.
;;
;; `parse` answers a `ParseResult` -- a command name, positionals, an option map, or an error -- and
;; nothing else happens. The caller `match`es on it. That is the whole core, and it is what makes this
;; testable without a process, a terminal or an exit code: a parser that dispatches cannot be asserted
;; on without running the thing it dispatches to.
;;
;; `run` sits on top for the convenience case, invoking a handler through `call`. It is fifteen lines
;; and it is optional, which is the right proportion -- the scratchpads that started with the dispatch
;; layer ended up with the grammar tangled inside it.
;;
;; AN UNKNOWN FLAG IS AN ERROR IN THE RESULT, NOT A THROW. A CLI parse failure is not exceptional --
;; it is the single most likely thing a user does -- and the answer to it is a help screen and exit 2,
;; which is a value the caller produces, not a stack unwind.
;;
;; ------------------------------------------------------------------------------------------------
;; THE GRAMMAR, stated up front rather than discovered:
;;
;;     --flag              a boolean option, answers #t
;;     --opt=value         a valued option, value attached
;;     --opt value         a valued option, value in the next token
;;     -f                  the short form of either
;;     -f value            the short form of a valued option
;;     --                  everything after this is a positional, even if it starts with a dash
;;
;; What is NOT here, deliberately: BUNDLING (`-abc` for `-a -b -c`). It is ambiguous the moment any
;; short option takes a value -- `-o file` bundled is unreadable -- and every implementation resolves
;; that differently. `--opt=value` is unambiguous and already covers the case bundling is reached for.
;;
;; A valued option at the END of argv with nothing after it is an ERROR, not an empty string. `--out`
;; with no path is a typo, and silently binding "" is how a program writes to a file called nothing.
(
    (import "std/core/builder")
    (import "std/core/string")

    ;; One option. `flags` holds every spelling -- `["-v" "--verbose"]` -- and the FIRST long flag is
    ;; the key it lands under in the result, so a program reads `verbose` regardless of which spelling
    ;; the user typed.
    (defclass Opt
        (let :ctor flags <- String[])
        (let :ctor description <- String)
        (mut takes-value <- Boolean #f)
        (mut value-name <- String "<value>")

        (fn valued [name <- String] -> Opt (
            (this.takes-value := #t)
            (this.value-name := name)
            (return this)
        ))

        (fn matches [token <- String] -> Boolean (
            (for :each f :from this.flags :then (if (== f token) (return #t)))
            (return #f)
        ))

        ;; The name this option's value lands under: the first `--long` spelling with the dashes
        ;; stripped, or the first flag if there is no long form.
        ;;
        ;; `substr` takes (start, END), not (start, LENGTH) -- it is `cps.slice`. Written as a length
        ;; this silently answers `verbo` for `--verbose`, which is not an error anywhere: the option
        ;; simply lands under a key nobody reads.
        (fn key [] -> String (
            (for :each f :from this.flags :then (
                (if (starts-with f "--") (return (substr f 2 (strlen f))))
            ))
            (let first this.flags[0])
            (if (starts-with first "-") (return (substr first 1 (strlen first))))
            (return first)
        ))
    )

    (defclass Command
        (let :ctor name <- String)
        (let :ctor description <- String)
        ;; Operand names, for the help screen only -- this parser does not enforce arity, because a
        ;; command that takes "one or more files" is ordinary and a count cannot express it.
        (mut arguments <- String[] [])

        (fn takes [args <- String[]] -> Command ((this.arguments := args) (return this)))
    )

    ;; What a parse produced. Every field is populated on success; `error` is the only one that means
    ;; the rest should not be trusted.
    (defclass ParseResult
        (mut command <- String? nil)
        (mut positionals <- String[] [])
        (mut options <- Any nil)
        (mut error <- String? nil)

        ;; `options` is a map and starts nil, for two separate reasons that happen to point the same
        ;; way:
        ;;
        ;;   * a map-literal FIELD DEFAULT has no CIR lowering on C (ELL0106, 'map'). A vector-literal
        ;;     default is fine, which is why `positionals` has one.
        ;;   * a `:ctor` INITIALIZER would be the obvious workaround and it DIVERGES: on a class with
        ;;     no `:ctor` PARAMETERS, C runs the initializer and JS does not, so `options` would be a
        ;;     map on one backend and nil on the other. C is the correct one. Recorded in D80.
        ;;
        ;; So the map is created by `new-result` below, which is the only thing that builds one.

        (fn ok [] -> Boolean (return (== this.error nil)))

        ;; A declared option that was never given answers nil, so `(!= (r.opt "x") nil)` is the
        ;; presence test and a boolean flag answers #t when present.
        (fn opt [name <- String] -> Any (return (map-get this.options name)))

        (fn has [name <- String] -> Boolean (return (map-has this.options name)))

        ;; Total: a missing positional answers nil rather than trapping, because "did the user supply
        ;; an argument" is the question the call site is actually asking.
        (fn arg [i <- Int] -> Any (
            (if (or (< i 0) (>= i this.positionals.length)) (return nil))
            (return this.positionals[i])
        ))
    )

    (defclass Cli
        (let :ctor name <- String)
        (let :ctor description <- String)
        (mut options <- Opt[] [])
        (mut commands <- Command[] [])

        (fn add-option [o <- Opt] -> Cli ((this.options.push o) (return this)))
        (fn add-command [c <- Command] -> Cli ((this.commands.push c) (return this)))

        (fn find-option [token <- String] -> Opt? (
            (for :each o :from this.options :then (if (o.matches token) (return o)))
            (return nil)
        ))

        (fn find-command [name <- String] -> Command? (
            (for :each c :from this.commands :then (if (== c.name name) (return c)))
            (return nil)
        ))
    )

    ;; Parse `argv` against `spec`.
    ;;
    ;; The token loop is written with an explicit index rather than `for :each` because a valued option
    ;; CONSUMES the next token, and a foreach cursor cannot skip.
    ;; The only constructor. `ParseResult`'s option map cannot be a field default or a `:ctor`
    ;; initializer (see the class), so exactly one place creates it and every result is well-formed.
    (fn new-result [] -> ParseResult (
        (let r (ParseResult))
        (r.options := {})
        (return r)
    ))

    (fn parse [spec <- Cli argv <- String[]] -> ParseResult (
        (let r (new-result))
        (mut i <- Int 0)
        (mut only-positional <- Boolean #f)

        (while (< i argv.length) (
            (let tok argv[i])
            (cond
                ;; The terminator. Everything after it is an operand, dashes and all -- which is how
                ;; you pass a file literally named `--version`.
                ((and (not only-positional) (== tok "--")) (only-positional := #t))

                ((or only-positional (not (starts-with tok "-"))) (
                    ;; The FIRST non-flag is the command, when any command is declared. With none
                    ;; declared, everything is a positional -- a single-purpose tool has no verb.
                    (if (and (and (== r.command nil) (not only-positional)) (> spec.commands.length 0))
                        (r.command := tok)
                        (r.positionals.push tok))
                ))

                (:else (
                    ;; `--opt=value` splits at the FIRST `=`, so a value may contain one.
                    (mut name tok)
                    (mut attached <- String? nil)
                    (let eq (index-of-char tok "="))
                    (when (>= eq 0) :then (
                        (name := (substr tok 0 eq))
                        (attached := (substr tok (+ eq 1) (strlen tok)))
                    ))
                    ;; THROUGH A `match … :of Opt` BINDING, not `(if (== o nil) … o.takes-value …)`.
                    ;;
                    ;; The `if` form type-checks -- the else branch narrows for the CHECKER -- and then
                    ;; reads the wrong thing: `o.takes-value` answered `true` when passed to
                    ;; `console.log` and `false` in `if` condition position, in the same expression, on
                    ;; both backends. A hyphenated field reached through an optional-typed binding
                    ;; takes a different access path per position and the paths disagree on the mangled
                    ;; name -- the defect `80-adversarial/hyphen_field_encoding.lisp` records as "the
                    ;; three spellings disagree on one field".
                    ;;
                    ;; It cost an hour and produced no diagnostic: a valued option silently behaved
                    ;; like a boolean one. A `:of` binding is typed, takes the static path, and is what
                    ;; D9 wants anyway.
                    ;; FLAT `cond` ARMS, not nested `if`s -- and that is a correctness requirement
                    ;; here, not a style preference.
                    ;;
                    ;; Written as a three-argument `if` nested inside the THEN branch of another
                    ;; three-argument `if`, with a `when` in the leaves, this MISBEHAVED: with
                    ;; `--lib=/opt/l` and `takes-value` observably true (printed `true` from inside the
                    ;; same branch), the parse both consumed the FOLLOWING token as the value and
                    ;; reported "option '--lib' takes no value" -- two mutually exclusive outcomes from
                    ;; one pass. No diagnostic anywhere.
                    ;;
                    ;; The shape did not reduce: plain nested if/else, and a `when` as an if branch,
                    ;; each behave correctly in isolation on both backends, so the trigger is the
                    ;; combination and is NOT characterised. Recorded in D80 as an open question rather
                    ;; than a diagnosed bug. The corpus already keeps `cond_dangling_else.lisp` and
                    ;; `paren_absorption.lisp` because this family has bitten before.
                    ;;
                    ;; `cond` arms are explicit and cannot absorb one another, so the logic is written
                    ;; that way and stays written that way.
                    (match (spec.find-option name) {
                        o :of Opt => (
                            (cond
                                ((and o.takes-value (!= attached nil))
                                    (map-set r.options (o.key) attached))
                                ;; A valued option at the END of argv is a TYPO, not an empty value.
                                ((and o.takes-value (>= (+ i 1) argv.length))
                                    (when (== r.error nil) :then
                                        (r.error := (+ (+ "option '" name) "' needs a value"))))
                                (o.takes-value (
                                    (map-set r.options (o.key) argv[(+ i 1)])
                                    (i := (+ i 1))
                                ))
                                ;; A boolean given `=value` is a mistake worth naming -- silently
                                ;; ignoring it is how `--verbose=false` turns verbosity ON.
                                ((!= attached nil)
                                    (when (== r.error nil) :then
                                        (r.error := (+ (+ "option '" name) "' takes no value"))))
                                (:else (map-set r.options (o.key) #t))
                            )
                        )
                        nil => (
                            (when (== r.error nil) :then
                                (r.error := (+ (+ "unknown option '" name) "'")))
                        )
                    })
                ))
            )
            (i := (+ i 1))
        ))

        ;; A command that was named but not declared. Checked after the loop so that an unknown option
        ;; reported earlier still wins -- the first error is the one the user should fix.
        ;;
        ;; Through `match … :of String` rather than `(!= r.command nil)`, because a nil COMPARISON does
        ;; not narrow the type: reading `r.command` after one is still `String?` and D9 refuses it at
        ;; the use site. A `:of` pattern is the construct that narrows, and it is the same shape
        ;; `std/core/string`'s digit parser already uses.
        (when (== r.error nil) :then (
            (match r.command {
                c :of String => (
                    (if (== (spec.find-command c) nil)
                        (r.error := (+ (+ "unknown command '" c) "'")))
                )
                nil => nil
            })
        ))

        (return r)
    ))

    ;; The index of the first occurrence of a one-character needle, or -1.
    ;;
    ;; Local because `index-of` is a name `std/seq` already exports and `std/core/string` deliberately
    ;; does NOT (its own comment: naming is a decision, left open rather than settled by whichever
    ;; spelling was convenient). This is a different, narrower operation with a different name, so it
    ;; adds no second owner to that argument.
    (fn index-of-char [s <- String needle <- String] -> Int (
        (let cps (string-to-codepoints s))
        (let n (codepoint-at needle 0))
        (mut i <- Int 0)
        (while (< i cps.length) (
            (if (== cps[i] n) (return i))
            (i := (+ i 1))
        ))
        (return -1)
    ))

    ;; The help screen, derived from the spec. This is the argument for keeping the spec as DATA: the
    ;; help text cannot drift from the grammar, because there is only one description of it.
    (fn help-text [spec <- Cli] -> String (
        (let sb (StringBuilder))
        (sb.append spec.name)
        (when (> (strlen spec.description) 0) :then (
            (sb.append " -- ")
            (sb.append spec.description)
        ))
        (sb.append "\n")

        (when (> spec.commands.length 0) :then (
            (sb.append "\nCommands:\n")
            (for :each c :from spec.commands :then (
                (let sig (StringBuilder))
                (sig.append c.name)
                (for :each a :from c.arguments :then ((sig.append " ") (sig.append a)))
                (sb.append "  ")
                (sb.append (pad-end (sig.to-string) 22 " "))
                (sb.append c.description)
                (sb.append "\n")
            ))
        ))

        (when (> spec.options.length 0) :then (
            (sb.append "\nOptions:\n")
            (for :each o :from spec.options :then (
                (let sig (StringBuilder))
                (sig.append (join o.flags ", "))
                (when o.takes-value :then ((sig.append " ") (sig.append o.value-name)))
                (sb.append "  ")
                (sb.append (pad-end (sig.to-string) 22 " "))
                (sb.append o.description)
                (sb.append "\n")
            ))
        ))

        (return (sb.to-string))
    ))

    ;; The optional dispatch layer.
    ;;
    ;; `handlers` maps a command name to a `(fn [ParseResult] -> Int)`. The handler is invoked through
    ;; `call`, which passes the result AS WRITTEN -- one argument, typed, with the arity checked
    ;; (D25/S1b). Answers a process exit code: 0 on success, 2 for a usage error, which is what a
    ;; shell expects.
    ;;
    ;; It does not call `exit` itself. A library that terminates the process cannot be tested and
    ;; cannot be embedded; returning the code leaves that to the caller, who owns `main`.
    (fn run [spec <- Cli argv <- String[] handlers <- Any] -> Int (
        (let r (parse spec argv))
        ;; `r.error` is `String?` and a nil COMPARISON does not narrow it, so the message is built
        ;; inside a `:of` pattern -- the same construct the command check above needs, for the same
        ;; reason. `(r.ok)` is still the readable predicate; it just cannot narrow a field for D9.
        (match r.error {
            e :of String => (
                (console.error (+ (+ spec.name ": ") e))
                (console.error (help-text spec))
                (return 2)
            )
            nil => nil
        })
        (match r.command {
            c :of String => (
                (let h (map-get handlers c))
                (if (== h nil) (
                    (console.error (+ (+ spec.name ": no handler for '") (+ c "'")))
                    (return 2)
                ))
                (return (call h r))
            )
            ;; No command given at all: the help screen IS the answer, and it is a success. A tool
            ;; invoked bare has not failed, it has been asked what it does.
            nil => (
                (console.log (help-text spec))
                (return 0)
            )
        })
        (return 0)
    ))

    (export Opt Command Cli ParseResult new-result parse help-text run index-of-char)
)
