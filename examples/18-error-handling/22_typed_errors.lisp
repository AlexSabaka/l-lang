;; CONFORMANCE guard: std/core/errors -- the typed-error tower, imported and used the way a program
;; would, on both backends. Pins the three rulings baked into the module (D62): every class extends
;; the ambient Error, catch is subtype-aware through the chain, and structured errors carry their data.
;;
;;   1. a leaf ValueError caught precisely, and as the root Error.
;;   2. a KeyError (KeyError -> ValueError -> Error) caught as its BASE (ValueError), reading its
;;      structured `key`.
;;   3. an IndexError caught precisely, reading its `index`.
;;   4. an IOError family: FileError caught as IOError, reading its `path`.
;;   5. SIBLING isolation: ArithmeticError is not a ValueError; the Error arm takes it.
;;   6. the whole tower answers `:of Error` -- one broad handler catches everything.
(
    (import "std/core/errors")

    ;; 1.
    (try (throw (new ValueError "bad value"))
         catch e :of ValueError (console.log "1" e.message))
    (try (throw (new ValueError "root too"))
         catch e :of Error (console.log "1b" e.message))

    ;; 2. KeyError caught one level up, structured field read.
    (try (throw (new KeyError "absent" "user_id"))
         catch e :of ValueError (console.log "2" e.message))

    ;; 3. IndexError precise, structured field read.
    (try (throw (new IndexError "out of range" 7))
         catch e :of IndexError (console.log "3" e.message e.index))

    ;; 4. FileError caught as IOError.
    (try (throw (new FileError "cannot open" "/tmp/x"))
         catch e :of IOError (console.log "4" e.message e.path))

    ;; 5. sibling isolation.
    (try (throw (new ArithmeticError "div by zero"))
         catch e :of ValueError (console.log "5 WRONG")
         catch e :of Error (console.log "5" e.message))

    ;; 6. one broad handler.
    (try (throw (new FatalError "boom"))
         catch e :of Error (console.log "6" e.message))
)
