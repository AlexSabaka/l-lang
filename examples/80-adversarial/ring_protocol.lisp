;; ADVERSARIAL: a PRIMITIVE can answer a protocol, and `Ring` is the fourth one (D89).
;;
;; D88 named `Ring` "the natural fourth protocol beside D63's Comparable/Hashable/Formattable" and
;; recorded it without building it. Building it turned out to be mostly a MEASUREMENT, and the
;; measurement is what this file pins.
;;
;; WHAT ALREADY WORKED. `definterface Ring<T>` with `(fn :operator + [other <- T] -> T)` parses, and
;; `TypeChecker.conformsStructurally` (D42/Zg -- the Go model) has always answered it for a CLASS,
;; declared or not: a class carrying `+` and `*` is a Ring without ever writing `:implements`. Operator
;; members are recorded by their operator name on both sides of that comparison, so nothing had to be
;; taught what `+` is.
;;
;; WHAT DID NOT. `conformsStructurally` bailed on `source.kind !== "class" && !== "struct"`, so NO
;; PRIMITIVE CONFORMED TO ANY INTERFACE AT ALL -- measured, `[x <- Ring]` refused `3`, and so did
;; `[x <- Comparable]`. A numeric protocol that refuses `Int` is not a protocol, it is a decoration;
;; and a matrix of `Int` is the common case, so the hole sat directly on the critical path.
;;
;; THE FIX IS SCOPED BY CONSTRUCTION, NOT BY A LIST. A primitive has no member list, so the checker
;; SYNTHESIZES the member from its operator tables -- `getBinaryOpType("*", Int, Int)` is `Int`, so
;; `Int` answers `*`. `isOperatorName` (the existing "is this punctuation" test, the one that tells
;; `Math.log` from `*`) is the gate, so a NAMED member finds nothing there. That is why `Comparable`
;; still refuses `3`: `Int` has no `compare-to`, and inventing one would be a far larger claim than
;; "Int can be multiplied". Comparisons are excluded too -- `getBinaryOpType` answers Boolean for every
;; `<` whatever the operands, so synthesizing one would make EVERY type conform to any interface naming
;; it. An operator that cannot say no is not evidence.
;;
;; THE RULE IS NOT "MUST BE NUMERIC". That would exclude `Rational` and `Complex`, which are exactly
;; the types D88 built. It is "closed under `+` and `*`", which is what a ring is -- and it is why
;; `String` fails: it has `+` (concatenation) and no `*`.
(
    (import "std/core/protocols")

    ;; -- two classes, and only one of them says so -------------------------------------------------
    ;;
    ;; `Coin` DECLARES `:implements Ring<Coin>`; `Money` declares nothing and merely has the operators.
    ;; Statically they are the same answer -- which is the Go model working. At RUN TIME they are not,
    ;; and that divergence is printed below rather than hidden.

    (defclass Coin :implements Ring<Coin>
        (mut :ctor value <- Int)
        (fn :operator + [o <- Coin] -> Coin (return (Coin (+ this.value o.value))))
        (fn :operator * [o <- Coin] -> Coin (return (Coin (* this.value o.value)))))

    (defclass Money
        (mut :ctor cents <- Int)
        (fn :operator + [o <- Money] -> Money (return (Money (+ this.cents o.cents))))
        (fn :operator * [o <- Money] -> Money (return (Money (* this.cents o.cents)))))

    ;; The whole test surface: a parameter typed by the protocol. If the argument does not conform this
    ;; is `LL0203` at COMPILE time, so every line that prints is a conformance that held.
    (fn accepts [x <- Ring] -> String (return "yes"))

    ;; -- the primitives, which is the half that did not work at all --------------------------------

    (console.log "Int:      " (accepts 3))
    (console.log "Real:     " (accepts 2.5))

    ;; -- D88's own types, which conform through their DECLARED overloads ---------------------------
    ;;
    ;; These go through the class path, not the synthesized one -- `Rational` and `Complex` each declare
    ;; `:operator +` and `:operator *` returning themselves. Pinned here because "the rule is not
    ;; numeric" is only true if these pass, and they are the reason it is phrased that way.

    (console.log "Rational: " (accepts 1/2))
    (console.log "Complex:  " (accepts 3+4i))

    ;; -- the two classes -- both accepted, declaration or not --------------------------------------

    (console.log "Coin:     " (accepts (Coin 5)))
    (console.log "Money:    " (accepts (Money 250)))

    ;; -- STATIC conformance and RUNTIME `:of` do not agree, and that is measured, not designed ------
    ;;
    ;; `:of` is NOMINAL: it answers true only for a DECLARED `:implements`. So `Coin` is a Ring at run
    ;; time and `Money` -- accepted by the very same parameter one line above -- is not. Reported, not
    ;; fixed: making `:of` structural is a runtime-metadata change of its own, and D89 is a checker
    ;; ruling. The pin exists so the day they are reconciled, this file moves.

    (console.log "Coin  :of Ring (runtime):" ((Coin 5) :of Ring))
    (console.log "Money :of Ring (runtime):" ((Money 250) :of Ring))

    ;; -- the operators the protocol names actually run on the CONCRETE types ------------------------
    ;;
    ;; Conformance is a static claim about a type, and arithmetic still happens on the concrete value.
    ;; `(+ x x)` through a `<- Ring` PARAMETER does not dispatch -- measured, it unboxes as a number and
    ;; traps `expected a number`, exactly as `<- Any` does. That is a pre-existing gap in operator
    ;; dispatch over boxed values, not something the protocol introduces, and it is why this file
    ;; constrains parameters rather than computing through them.

    ;; BOUND FIRST, not `((+ a b).value)`. A field read on a COMPUTED receiver emits `.value()` -- a
    ;; method call on a field -- and dies on the frozen JS backend (D66). Binding makes the receiver a
    ;; plain name and the file stays portable, which is worth more here than a second divergence pin.
    (let coins (+ (Coin 5) (Coin 7)))
    (let cash (+ (Money 250) (Money 125)))
    (console.log "coins:    " coins.value)
    (console.log "money:    " cash.cents)
)
