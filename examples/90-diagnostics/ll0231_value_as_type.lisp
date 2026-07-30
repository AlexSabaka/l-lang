;; LL0231 -- TYPES AND VALUES ARE SEPARATE NAMESPACES (D111).
;;
;; A type annotation used to accept any symbol carrying an `inferredType`, which is every VALUE in the
;; program. The consequence was not a lost check but a WRONG ANSWER, measured:
;;
;;     (fn ident [x <- Any] -> Any (return x))
;;     (let T (ident 0))                        ;; T is a VARIABLE whose type is Any
;;     (fn add1 [n <- T] -> Int (return (+ n 1)))
;;     (add1 "7")
;;
;;       with `n <- Int`  ->  ELL0203 expected Int, got String   on BOTH backends
;;       with `n <- T`    ->  C traps at run time; JS PRINTS 71
;;
;; A compile-time type error became a silently wrong printed value -- exactly what LL0231's own
;; message text promises to prevent: "it turns CHECKING OFF for the declaration".
;;
;; Every line below names something real that is NOT a type. `Zorg` is deliberately absent: a name
;; that resolves to nothing was ALREADY caught, and it is the shape that made this look handled.
(
    ;; a VALUE
    (let v 42)
    (let a <- v 1)

    ;; a FUNCTION
    (fn g [] -> Int (return 1))
    (let b <- g 1)

    ;; an ambient `std/js` extern -- a `(let :extern Map)` VARIABLE, not a type. 26 of these read as
    ;; annotations and every one was assignable from nothing: `(let m <- Map {"a" 1})` reported
    ;; "cannot assign Map to Map".
    (let c <- Map {"a" 1})
)
