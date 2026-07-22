;; ADVERSARIAL (parity guard -- C-correct, JS-divergent): a map key that is a JS RESERVED WORD is
;; unreadable through the dotted accessor on the JS backend, and answers nil instead of trapping.
;;
;; `visitCompositeIdentifier` builds `a.b.c` by running EVERY part through `encodeIdentifier`, the
;; function that makes a source name safe to use as a JS BINDING. Two things happen there, and only
;; one of them belongs on a member name:
;;
;;   - the hex escape (`my-field` -> `my2dfield`) is REQUIRED, because a field is DEFINED under the
;;     encoded name, so a read has to spell it the same way;
;;   - the reserved-word prefix (`class` -> `_class`) is WRONG, because a property key is not a
;;     binding. `obj.class` has been legal JavaScript since ES5. The read is rewritten to `hero._class`
;;     and finds nothing.
;;
;; The failure is SILENT, which is what makes it worth a guard. D9 makes the dotted read the TOTAL
;; accessor -- absent key answers nil, by design -- so a mangled key is indistinguishable from a key
;; that was never set. `hero["class"]` (the partial accessor) is unaffected and correct on both
;; backends, so a program can read the same key two ways and get two answers.
;;
;; l-lang has no reserved-word list of its own; `:class`, `:default`, `:new`, `:in`, `:public` and
;; `:static` are ordinary map keys, and `{:class "warrior"}` is the obvious spelling in the very game
;; samples this stdlib work is aimed at. `extends` is the one that surfaced it: it is the edge D54's
;; own metadata graph uses to name a parent type, so the reflection graph is unwalkable through the
;; total accessor on JS (`reflection_value_type.lisp` walks it with the indexer for this reason).
;;
;; EXPECTED == golden == C, which reads the key it was given. NOT FIXED YET, and listed in
;; `js-status.ts` rather than quietly worked around: the fix has to be SYMMETRIC -- a class field
;; named `class` is currently DEFINED as `_class` too, so changing only the read side breaks it -- and
;; it reaches ctor params (where `class` genuinely is an illegal binding and must stay escaped) and
;; `{:class}` destructuring. That is a sizing, not a difficulty; it is a separate change from the
;; reflection convergence that found it.
(
    (let hero {:class "warrior" :default 10 :name "Ada" :in 1 :new 2 :static #t})

    ;; The dotted TOTAL accessor (D9).
    (console.log "class:  " hero.class)
    (console.log "default:" hero.default)
    (console.log "in:     " hero.in)
    (console.log "new:    " hero.new)
    (console.log "static: " hero.static)

    ;; The control: an ordinary key, and the same keys through the PARTIAL accessor, which never
    ;; touches the identifier encoder. Both are correct on both backends today -- so a green line here
    ;; against a red line above is the whole finding.
    (console.log "name:   " hero.name)
    (console.log "[class]:" hero["class"])
    (console.log "[new]:  " hero["new"])

    ;; A genuinely absent key, so the golden shows what the mangled reads are being CONFUSED with.
    (console.log "absent: " hero.missing))
