;; CONFORMANCE guard: the typed errors are AMBIENT (F1). This program NEVER imports std/core/errors,
;; yet `Error` and the whole tower resolve -- because `Error` is now an l-lang class in a second
;; prelude, not a host `:extern`. The un-extern is behind this: removing `(let :extern Error)` and
;; defining `Error` in `std/core/errors`, made ambient like `std/js`.
;;
;;   1. the ROOT: `(throw (Error ...))` with no import, caught `:of Error`.
;;   2. a typed error, ambient, caught precisely and as the root.
;;   3. subtype: a KeyError caught as its base ValueError, structured field intact.
;;   4. TypeError -- formerly a host extern, now an l-lang class -- still catches by name.
(
    (try (throw (Error "root"))
         catch e :of Error (console.log "1" e.message))

    (try (throw (ValueError "bad value"))
         catch e :of ValueError (console.log "2a" e.message))
    (try (throw (ValueError "as root"))
         catch e :of Error (console.log "2b" e.message))

    (try (throw (KeyError "absent" "user_id"))
         catch e :of ValueError (console.log "3" e.message))

    (try (throw (TypeError "wrong type"))
         catch e :of TypeError (console.log "4" e.message))
)
