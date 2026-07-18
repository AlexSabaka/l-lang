;; Lookup tables computed by the COMPILER, not by the program.
;;
;; `:comptime` is a real partial evaluator (D3): a `:comptime` function runs during
;; compilation and its calls collapse into the values they produced. The tables below
;; cost nothing at runtime -- the emitted JS holds the NUMBERS, and the multiplication,
;; the recursion and the trigonometry are gone by then. See for yourself:
;;
;;     llc compile 11_comptime_table.lisp --stdout
;;
;; `defmodifier` is the other half of metaprogramming-today: a modifier body evaluates
;; to a decorator that rewrites the function it is attached to.
(
    ;; --- 1. a table of squares -------------------------------------------------
    (fn :comptime sq [n <- Int] -> Int (* n n))

    (let :comptime squares [(sq 1) (sq 2) (sq 3) (sq 4) (sq 5) (sq 6) (sq 7) (sq 8)])

    ;; --- 2. recursion, at compile time -----------------------------------------
    ;; The Nth triangular number, computed the slow way. Still just a literal at runtime.
    (fn :comptime tri [n <- Int] -> Int
        (if (<= n 0)
            0
            (+ n (tri (- n 1)))))

    (let :comptime triangles [(tri 1) (tri 2) (tri 3) (tri 4) (tri 5)])

    ;; --- 3. the host's Math is available to the compiler ------------------------
    ;; A small cosine table over whole-degree angles, rounded to 2 decimals. None of
    ;; this arithmetic survives into the output. It is the host's real floating point,
    ;; not symbolic math: `(cos2 90)` folds to 0 because `Math.cos` answers 6.12e-17
    ;; there, and the rounding flattens it.
    (fn :comptime deg-to-rad [d <- Int] -> Number
        (/ (* d 3.141592653589793) 180))

    (fn :comptime cos2 [d <- Int] -> Number
        (/ (Math.round (* (Math.cos (deg-to-rad d)) 100)) 100))

    (let :comptime cosines [(cos2 0) (cos2 30) (cos2 45) (cos2 60) (cos2 90)])

    ;; --- 4. a modifier over the folded table -----------------------------------
    ;; The indexer is PARTIAL (D9): `squares[99]` THROWS rather than answering nil.
    ;; `:safe` is where this program decides it would rather have a -1 than a crash --
    ;; the policy lives in the modifier instead of being smeared through the function.
    ;; Both arms `return` explicitly: `try` is a statement, so a bare tail expression
    ;; inside it is NOT the lambda's value.
    (defmodifier safe []
        (fn [original]
            (fn [...args]
                (try (return (original ...args))
                 catch e :of Error (return -1)))))

    (fn :safe lookup-square [i <- Int] -> Int
        (return squares[i]))

    (console.log (+ "squares:   " (squares.join " ")))
    (console.log (+ "triangles: " (triangles.join " ")))
    (console.log (+ "cos table: " (cosines.join " ")))
    (console.log (+ "lookup-square 5  -> " (lookup-square 5)))
    (console.log (+ "lookup-square 99 -> " (lookup-square 99)))
)
