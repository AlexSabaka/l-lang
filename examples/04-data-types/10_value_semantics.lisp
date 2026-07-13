;; Value semantics: a struct is a VALUE, a class is a REFERENCE   (D11)
;;
;; This is the whole difference between `defstruct` and `defclass`, and it is the only difference
;; that matters:
;;
;;   a STRUCT is COPIED when it moves      -- assignment, a parameter, a collection slot
;;   a CLASS  is SHARED                    -- two names, one object
;;
;; This example demonstrates:
;; - assignment copies a struct and aliases a class
;; - a struct is passed to a function BY VALUE
;; - what a copy copies: struct fields recursively, reference fields NOT
;; - a struct in a collection, and in a `for :each`

(
    (defstruct Point (mut :ctor x <- Int 0) (mut :ctor y <- Int 0))
    (defclass  Node  (mut :ctor label <- String ""))

    ;; ---------------------------------------------------------------------------------------------
    ;; 1. A struct is copied. A class is not.
    ;; ---------------------------------------------------------------------------------------------
    (console.log "--- struct copies, class aliases ---")

    (mut p1 (Point 1 2))
    (mut p2 p1)              ;; a COPY
    (p2.x := 99)
    (console.log "struct  p1.x:" p1.x " p2.x:" p2.x)

    (let n1 (Node "first"))
    (let n2 n1)              ;; the SAME object
    (n2.label := "changed")
    (console.log "class   n1:" n1.label " n2:" n2.label)

    ;; ---------------------------------------------------------------------------------------------
    ;; 2. A struct is passed BY VALUE. A function cannot reach back into its caller.
    ;; ---------------------------------------------------------------------------------------------
    (console.log "--- passed by value ---")

    (fn move-right [p <- Point] -> Int (
        (p.x := (+ p.x 100))     ;; mutates OUR copy, not the caller's
        (return p.x)
    ))

    (mut here (Point 5 5))
    (console.log "returned:" (move-right here) " caller's x is still:" here.x)

    ;; ---------------------------------------------------------------------------------------------
    ;; 3. What a copy COPIES.
    ;;
    ;; Memberwise, recursing into struct-typed fields. A field that holds a REFERENCE type -- an
    ;; array, a map, a class instance -- copies the reference, exactly as it would in C#, and exactly
    ;; as a native struct holding a pointer would. The struct's own storage is copied; what it points
    ;; at is not.
    ;; ---------------------------------------------------------------------------------------------
    (console.log "--- what a copy copies ---")

    (defstruct Line (let :ctor start <- Point) (let :ctor tags <- String[]))

    (mut a (Line (Point 0 0) ["red"]))
    (mut b a)

    (b.start.x := 77)         ;; `start` is a STRUCT     -> copied. `a` does not see this.
    (b.tags.push "blue")     ;; `tags` is an ARRAY     -> shared. `a` DOES see this.

    (console.log "struct field a.start.x:" a.start.x "  (b's change did not reach it)")
    (console.log "array  field a.tags:  " a.tags "  (b's push DID reach it -- a reference is shared)")

    ;; ---------------------------------------------------------------------------------------------
    ;; 4. A collection slot is a new home, so it holds a copy.
    ;; ---------------------------------------------------------------------------------------------
    (console.log "--- collections hold copies ---")

    (mut origin (Point 0 0))
    (let saved [origin])
    (origin.x := 42)
    (console.log "saved[0].x:" saved[0].x " origin.x:" origin.x)

    ;; ...and `for :each` binds a copy, so a loop cannot rewrite the collection under itself.
    (let points [(Point 1 1) (Point 2 2)])
    (for :each pt :from points :then (pt.x := 0))
    (console.log "after the loop:" points[0].x points[1].x)

    ;; ---------------------------------------------------------------------------------------------
    ;; 5. An operator on a struct must be PURE.
    ;;
    ;; It receives its operands BY VALUE, so it cannot mutate them -- and the compiler says so
    ;; (LL0207) rather than letting the mutation escape. Build a new value and return it:
    ;; ---------------------------------------------------------------------------------------------
    (console.log "--- a pure operator ---")

    (defstruct Vec (let :ctor x <- Int 0) (let :ctor y <- Int 0))

    ;; Declared at TOP LEVEL, taking both operands -- the same shape 06_structs and 09_operators use.
    ;; It builds a NEW Vec; it does not touch `u` or `v`, and it could not: they arrived by value.
    (fn :operator + [u <- Vec v <- Vec] -> Vec
        (return (Vec (+ u.x v.x) (+ u.y v.y))))

    (let v1 (Vec 1 2))
    (let v2 (Vec 10 20))
    (let v3 (+ v1 v2))
    (console.log "v1 + v2 =" v3.x v3.y "   (v1 is untouched:" v1.x v1.y ")")
)
