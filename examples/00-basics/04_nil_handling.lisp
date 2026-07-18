;; nil, and the optional type `T?`   (D9)
;;
;; l-lang has exactly ONE bottom value, spelled `nil`. There is no `undefined`, no `none`, no `void`.
;; A type is NON-NULLABLE by default -- `String` can never be nil -- and `String?` is how you say a
;; value might be. The compiler then makes you check it before you use it.
;;
;; This example demonstrates:
;; - nil vs false vs empty vs zero
;; - `T?` declarations, and why `T` refuses nil
;; - the forced unwrap (LL0205), and the two nil-checks that discharge it
;; - the PARTIAL indexer `c[k]` vs the TOTAL `(get c k)`
;; - nil in collections, and nil in patterns

(
    ;; ------------------------------------------------------------------------------------------
    ;; 1. nil is not false, and it is not zero, and it is not empty.
    ;; ------------------------------------------------------------------------------------------
    (console.log "--- nil vs the falsy values ---")

    (console.log "nil is:" nil)
    (console.log "nil == nil    " (== nil nil))
    (console.log "nil == false  " (== nil false))
    (console.log "nil == 0      " (== nil 0))
    (console.log "nil == empty  " (== nil ""))

    ;; Note there is no `(if nil ...)` here: an `if` condition must be a Boolean, so nil is not a
    ;; truthiness test you can write. Ask the question you mean -- `(== x nil)`.

    ;; ------------------------------------------------------------------------------------------
    ;; 2. `T` cannot be nil. `T?` can.
    ;; ------------------------------------------------------------------------------------------
    (console.log "--- declaring an optional ---")

    ;; (let bad <- String nil)     ;; LL0200: cannot assign Nil to String
    (let maybe-name <- String? nil)
    (let real-name  <- String? "Alice")

    (console.log "maybe-name:" maybe-name)
    (console.log "real-name: " real-name)

    ;; ------------------------------------------------------------------------------------------
    ;; 3. The unwrap is FORCED.
    ;;
    ;;    (console.log real-name.length)   ;; LL0205: 'real-name' is possibly nil (String?)
    ;;
    ;; The compiler will not let an optional be dereferenced. Checking it against nil is what
    ;; discharges the obligation -- inside the branch you proved, the value is a plain `String`.
    ;; ------------------------------------------------------------------------------------------
    (console.log "--- the forced unwrap ---")

    (if (!= real-name nil)
        (console.log "real-name has" real-name.length "characters")
        (console.log "real-name is nil"))

    (if (== maybe-name nil)
        (console.log "maybe-name is nil")
        (console.log "maybe-name has" maybe-name.length "characters"))

    ;; ------------------------------------------------------------------------------------------
    ;; 4. A function that may answer with nothing says so in its return type.
    ;; ------------------------------------------------------------------------------------------
    (console.log "--- functions that may return nothing ---")

    (fn get-value-or-nil [has-value <- Boolean] -> String? (
        (if has-value
            (return "has value")
            (return nil))
    ))

    (let val1 (get-value-or-nil true))
    (let val2 (get-value-or-nil false))

    (console.log "val1:" val1)
    (console.log "val2:" val2)

    ;; ------------------------------------------------------------------------------------------
    ;; 5. The PARTIAL indexer, and the TOTAL `get`.
    ;;
    ;; `data[key]` ASSERTS the key is there -- an absent one is a KeyError, because indexing
    ;; something that is not there is a bug, not a value. Asking WHETHER it is there is a different
    ;; question, and `(get data key)` is how you ask it. It answers `V?`.
    ;; ------------------------------------------------------------------------------------------
    (console.log "--- absence is asked with get, not by indexing ---")

    (fn get-config [key <- String] -> String? (
        (let data {:host "localhost" :port "8080"})
        (return (get data key))
    ))

    (let host    (get-config "host"))
    (let timeout (get-config "timeout"))

    ;; Coalescing, by hand: `(if (== x nil) default x)`.
    (let host-val    (if (== host nil) "default-host" host))
    (let timeout-val (if (== timeout nil) "5000" timeout))

    (console.log "Host:   " host-val)
    (console.log "Timeout:" timeout-val)

    ;; ------------------------------------------------------------------------------------------
    ;; 6. A guard-and-return narrows the REST of the function.
    ;;
    ;; This is the shape you reach for most: bail out early on nil, and everything below the guard
    ;; is a plain `String` -- the compiler has followed the reasoning and no longer asks.
    ;; ------------------------------------------------------------------------------------------
    (console.log "--- the guard-and-return ---")

    (fn shout [text <- String?] -> String (
        (if (== text nil)
            (return "(nothing to say)"))
        ;; From here down `text` is a String, not a String?.
        (return (+ (text.toUpperCase) "!"))
    ))

    (console.log (shout "hello"))
    (console.log (shout nil))

    ;; ------------------------------------------------------------------------------------------
    ;; 7. nil propagates: an optional in, an optional out.
    ;; ------------------------------------------------------------------------------------------
    (console.log "--- nil propagation ---")

    (fn chain [initial <- Int?] -> Int? (
        (if (== initial nil)
            (return nil))

        (let doubled (* initial 2))
        (if (> doubled 100)
            (return nil))

        (return (+ doubled 10))
    ))

    (console.log "chain 20: " (chain 20))
    (console.log "chain 100:" (chain 100))
    (console.log "chain nil:" (chain nil))

    ;; ------------------------------------------------------------------------------------------
    ;; 8. nil in collections.
    ;; ------------------------------------------------------------------------------------------
    (console.log "--- nil in collections ---")

    (let items [1 nil 3 nil 5])
    (console.log "with nils:" items)

    (mut kept [])
    (for :each item :from items :then (
        (if (!= item nil)
            (kept.push item))
    ))
    (console.log "without:  " kept)

    ;; `head` of an EMPTY array is nil -- not the array, and not a crash. That is why it is `T?`.
    (let empty-list <- Int[] [])
    (console.log "head of []:      " (head empty-list))
    (console.log "head of [1 2 3]: " (head [1 2 3]))

    ;; ------------------------------------------------------------------------------------------
    ;; 9. nil is a pattern, not a name.
    ;; ------------------------------------------------------------------------------------------
    (console.log "--- nil in patterns ---")

    (fn describe [val] -> String (
        (return (match val {
            nil => "nothing"
            0   => "zero"
            _   => "something"
        }))
    ))

    (console.log (describe nil))
    (console.log (describe 0))
    (console.log (describe "hi"))

    ;; ------------------------------------------------------------------------------------------
    ;; 10. A mutable optional: set it, clear it, set it again.
    ;; ------------------------------------------------------------------------------------------
    (console.log "--- a mutable optional ---")

    (mut cache <- String? nil)
    (console.log "empty?  " (== cache nil))

    (cache := "cached-data")
    (console.log "filled: " cache)

    (cache := nil)
    (console.log "cleared?" (== cache nil))
)
