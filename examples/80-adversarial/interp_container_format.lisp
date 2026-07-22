;; ADVERSARIAL (parity guard -- JS-correct, C-divergent): container formatting in string interpolation
;; (parity §5.2 cluster 2, c-backend-gap-ledger).
;;
;; A `'"...{(expr)}"` formatted-string wraps each interpolated expr in `__ll_format_object`, which on
;; the JS backend is now l-lang's OWN formatter (FLOOR.md 3.5, D55) -- so a container renders in
;; l-lang's reader syntax (`[1 2 3]`, `{:a 1 :b 2}`), the notation you would have typed. The C backend
;; lowers interpolation through `ll_str_concat_n` -> `ll_to_string_sb`, the ToString path (a bare
;; comma-join), so the SAME array renders `1,2,3` and a map loses its shape. (The C runtime HAS an
;; inspect path, `ll_inspect_sb`; interpolation does not reach it, and it still speaks node's old
;; notation until Fc lands on the C side.) EXPECTED == golden. ACTUAL under C: comma-joined.
;; A guard for the day C interpolation upgrades to the inspect path the goldens bake in.
(
    (let nums [1 2 3])
    (let nested [[1 2] [3 4]])
    (let words ["a" "b" "c"])
    (let empty [])
    (let m { :a 1 :b 2 })

    (console.log '"ints:   {(nums)}")     ;; [1 2 3]              | C: 1,2,3
    (console.log '"nested: {(nested)}")   ;; [[1 2] [3 4]]        | C: 1,2,3,4
    (console.log '"words:  {(words)}")    ;; ["a" "b" "c"]        | C: a,b,c
    (console.log '"empty:  {(empty)}")    ;; []                   | C: (empty)
    (console.log '"map:    {(m)}")        ;; {:a 1 :b 2}          | C: [object]/shapeless
)
