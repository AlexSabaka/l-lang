;; D46's WHOLE SAFETY STORY, and it had no negative file: an `:explicit` defcast fires ONLY at a
;; written `(cast<T> x)` and at NO coercion site.
;;
;; `16-stdlib/17_defcast.lisp` and `18_defcast_implicit.lisp` are both POSITIVES -- they show the
;; written cast working and the implicit one firing at a let-init, a return and an assignment. Nothing
;; anywhere asked the question D46 actually exists to answer, which is whether the explicit one STAYS
;; explicit. `defcast` appears in no manifest entry and there is no negative cast file at all.
;;
;; A REGRESSION HERE WOULD BE SILENT. If `:explicit` ever started firing at a coercion site, every
;; program below would compile and quietly convert -- no diagnostic, no crash, just a conversion the
;; author asked to be asked about. D46 names that outcome directly: "a conversion that fires silently
;; when the author meant it to be asked for is exactly the C++ mistake". The positives cannot catch
;; it, because they only ever check that a conversion DID happen.
;;
;; Every row below is a distinct DESTINATION-TYPE site, and each must report rather than convert. The
;; measured codes are the manifest entry's contract.
(
    (import "std/protocols")

    (defclass Celsius (let :ctor degrees <- Real))
    (defcast :explicit [c <- Celsius] -> Real c.degrees)

    (let temp (Celsius 21.5))

    ;; 1. LET-INIT: the annotation is the destination.
    (let as-real <- Real temp)

    ;; 2. ASSIGNMENT: the target's declared type is the destination.
    (mut slot <- Real 0.0)
    (slot := temp)

    ;; 3. RETURN: the declared return type is the destination, on the way out.
    (fn unwrap [c <- Celsius] -> Real c)

    ;; 4. A CALL ARGUMENT: the parameter's type is the destination.
    (fn take [r <- Real] -> Real r)
    (let passed (take temp))

    ;; 5. A CONSTRUCTOR ARGUMENT, class and struct -- a field's declared type is a destination too,
    ;;    and the two go through different construction paths.
    (defclass Box (let :ctor r <- Real))
    (let boxed (new Box temp))
    (defstruct SBox (mut :ctor r <- Real))
    (let sboxed (SBox temp))

    ;; 6. A GENERATOR'S ELEMENT TYPE. `Iterator<Real>` makes every `yield` a coercion site, and it is
    ;;    reached through the coroutine lowering rather than an ordinary assignment.
    (fn :gen g [] -> Iterator<Real> ((yield temp)))

    ;; 7. A DECLARED ELEMENT TYPE on a vector literal.
    (let v <- Real[] [temp])
)
