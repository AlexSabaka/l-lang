(
  (import "std/io")
  (import "std/math")
  (import "std/seq")
  (import "std/types")
  (import "std/string")
  (import "std/fn")

  ;; NOTE: no `\n` in these strings, and that is not a style choice.
  ;;
  ;; String escapes ARE NOT DECODED -- `"\n"` lexes as a backslash and an `n`, and prints as one. It is
  ;; a standing Known Gap (`examples/06-modifiers/05_multiple_modifiers.lisp` carries a comment about
  ;; the same thing), and writing a golden full of literal `\n` would BAKE THE BUG IN as the expected
  ;; answer -- which is the one thing this suite exists not to do. Blank lines come from `(print "")`.
  (print "=== STD LIB TESTING ===")
  (print "")

  (print "--- Math ---")
  (print "sqr(4) = {0}" (sqr 4))
  (print "abs(-5) = {0}" (abs -5))
  (print "min(1, 2) = {0}" (min 1 2))
  (print "max(1, 2) = {0}" (max 1 2))
  (print "pow(2, 3) = {0}" (pow 2 3))
  (print "ceil(3.2) = {0}" (ceil 3.2))
  (print "floor(3.7) = {0}" (floor 3.7))
  (print "round(3.5) = {0}" (round 3.5))

  (print "")
  (print "--- Collections ---")
  (let nums [1 2 3 4 5])
  (prn nums)
  (print "length: {0}" (length nums))
  (print "first: {0}" (first nums))
  (print "last: {0}" (last nums))
  (print "at 2: {0}" (at nums 2))
  
  (let mapped (map inc nums))
  (print "map inc: {0}" mapped)
  
  (let filtered (filter (fn [x] (> x 3)) nums))
  (print "filter > 3: {0}" filtered)
  
  (let sum (reduce (fn [acc x] (+ acc x)) 0 nums))
  (print "reduce +: {0}" sum)
  
  (let reversed (reverse [1 2 3]))
  (print "reverse [1 2 3]: {0}" reversed)
  
  (let flattened (flatten [[1 2] [3 4]]))
  (print "flatten [[1 2] [3 4]]: {0}" flattened)

  (print "")
  (print "--- Strings ---")
  (print "strlen('hello') = {0}" (strlen "hello"))
  (print "upcase('hello') = {0}" (upcase "hello"))
  (print "downcase('HELLO') = {0}" (downcase "HELLO"))
  (print "trim('  hi  ') = '{0}'" (trim "  hi  "))
  (print "split('a,b,c', ',') = {0}" (split "a,b,c" ","))
  (print "join(['a', 'b'], '-') = {0}" (join ["a" "b"] "-"))
  (print "contains('hello', 'ell') = {0}" (contains "hello" "ell"))
  (print "starts-with('hello', 'he') = {0}" (starts-with "hello" "he"))

  (print "")
  (print "--- Types ---")
  (print "is-int(5) = {0}" (is-int 5))
  (print "is-int(5.5) = {0}" (is-int 5.5))
  (print "is-string('s') = {0}" (is-string "s"))
  (print "is-array([]) = {0}" (is-array []))
  (print "is-nil(nil) = {0}" (is-nil nil))
  (print "type-name(5) = {0}" (type-name 5))
  (print "type-name([]) = {0}" (type-name []))
  (print "type-name('s') = {0}" (type-name "s"))
  (print "type-name(true) = {0}" (type-name true))

  (print "")
  (print "--- Functional ---")
  (print "identity(42) = {0}" (identity 42))
  (let c5 (constantly 5))
  ;; `(call c5)`, not `(c5)`. A zero-arg call to a LOCAL holding a function value emits a bare
  ;; REFERENCE, not a call: codegen decides "is this a call?" from `this.functions`, a source-order
  ;; list of DECLARED functions, and a local lambda is not in it. So `(c5)` printed the function.
  ;; `call` is the language's sanctioned zero-arg invocation and the corpus already uses it this way
  ;; (`(call noFill)` in p5-bindings). Gated in test:type-errors; D1 says `(f)` should be a call.
  (print "constantly() = {0}" (call c5))
  
  (let f (compose sqr inc)) ;; (x+1)^2
  (print "compose(sqr, inc)(3) = (3+1)^2 = {0}" (f 3))
  
  (print "")
  (print "=== DONE ===")
)
