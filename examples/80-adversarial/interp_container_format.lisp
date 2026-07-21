;; ADVERSARIAL (parity guard -- JS-correct, C-divergent): container formatting in string interpolation
;; (parity §5.2 cluster 2, c-backend-gap-ledger).
;;
;; A `'"...{(expr)}"` formatted-string wraps each interpolated expr in `__ll_format_object` on the JS
;; backend -- node's `util.inspect` -- so a container renders with brackets and spaces (`[ 1, 2, 3 ]`,
;; `{ a: 1 }`). The C backend lowers interpolation through `ll_str_concat_n` -> `ll_to_string_sb`, the
;; ToString path (JS `Array.prototype.toString`, a bare comma-join), so the SAME array renders `1,2,3`
;; and a map loses its shape. (The C runtime HAS the inspect path, `ll_inspect_sb`; interpolation just
;; doesn't reach it.) EXPECTED == golden (JS inspect form). ACTUAL under C: comma-joined / stringified.
;; A guard for the day C interpolation upgrades to the inspect path the goldens bake in.
(
    (let nums [1 2 3])
    (let nested [[1 2] [3 4]])
    (let words ["a" "b" "c"])
    (let empty [])
    (let m { :a 1 :b 2 })

    (console.log '"ints:   {(nums)}")     ;; JS: [ 1, 2, 3 ]        | C: 1,2,3
    (console.log '"nested: {(nested)}")   ;; JS: [ [ 1, 2 ], [ 3, 4 ] ] | C: 1,2,3,4
    (console.log '"words:  {(words)}")    ;; JS: [ 'a', 'b', 'c' ]  | C: a,b,c
    (console.log '"empty:  {(empty)}")    ;; JS: []                 | C: (empty)
    (console.log '"map:    {(m)}")        ;; JS: { a: 1, b: 2 }     | C: [object]/shapeless
)
