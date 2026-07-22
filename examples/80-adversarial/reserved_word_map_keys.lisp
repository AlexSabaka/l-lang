;; ADVERSARIAL (parity guard): a member named with a JS RESERVED WORD -- `class`, `default`, `new`,
;; `in`, `static`, `extends`. l-lang has no reserved-word list of its own, so all of these are
;; ordinary names, and `{:class "warrior"}` is the obvious spelling in the very game samples this
;; stdlib work is aimed at.
;;
;; `visitCompositeIdentifier` built `a.b.c` by running EVERY part through `encodeIdentifier`, the
;; function that makes a source name safe as a JS BINDING. Two things happen in there and only one of
;; them belongs on a member name:
;;
;;   - the hex escape (`my-field` -> `my2dfield`) is REQUIRED, because a member is DEFINED under the
;;     encoded name and a read has to spell it the same way;
;;   - the reserved-word prefix (`class` -> `_class`) is WRONG, because a property key is not a
;;     binding. `obj.class` has been legal JavaScript since ES5.
;;
;; The two halves of the language then disagreed with THEMSELVES, in opposite directions, which is why
;; neither looked like the same bug:
;;
;;   {:class "warrior"}    key emitted RAW      -> `hero.class` read `hero._class` -> nil
;;   (mut :ctor class ...) field emitted ENCODED -> `h["class"]` raised a D9 KeyError
;;
;; Half of it SILENT: D9 makes the dotted read the TOTAL accessor, absent key answers nil by design,
;; so a mangled key is indistinguishable from a key that was never set -- and the same map read two
;; ways gave two answers. C was correct throughout; it reads the key it was given.
;;
;; Fixed by splitting the encoder: `encodeMemberName` keeps the hex escape and the leading-digit guard
;; (`obj.0` is a syntax error) and drops the reserved-word prefix, and the member DEFINITION sites --
;; field, method, `this.<field>` store -- take the same spelling so both accessors agree. A ctor
;; PARAMETER keeps the binding escape, because `constructor(class)` genuinely is illegal.
;;
;; Found through reflection: `extends` is the edge D54's metadata graph uses to name a parent type, so
;; the graph was unwalkable through the total accessor on JS.
(defclass Hero
    (mut :ctor class <- String)
    (mut :ctor default <- Int))

(
    (let hero {:class "warrior" :default 10 :name "Ada" :in 1 :new 2 :static #t})
    (let h (Hero "paladin" 3))

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

    ;; A genuinely absent key, so the golden shows what the mangled reads were being CONFUSED with.
    (console.log "absent: " hero.missing)

    ;; The OTHER direction, and the reason the fix had to be symmetric. A class field named `class`
    ;; was DEFINED as `_class`, so the dotted read worked (both sides were mangled alike) and the
    ;; indexer was the one that failed -- the exact mirror of the map above.
    ;;
    ;; Only the dotted read is exercised here: `h["class"]` on a class INSTANCE does not compile on
    ;; the C backend at all (`ll_index_dyn` is handed an `ll_obj*` where an `ll_value` is expected),
    ;; which is a separate, pre-existing gap and not this one.
    (console.log "hero class:  " h.class)
    (console.log "hero default:" h.default))
