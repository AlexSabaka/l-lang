;; std/iter -- the ITERATION PROTOCOL (D30).
;;
;; `for :each`, generators (`:gen`), and the lazy sequence operators are all DEFINED by these two
;; interfaces and LOWERED per backend (D29). Nothing here is JS-specific: on the JS backend an
;; `Iterable`'s `iterator` lowers to `[Symbol.iterator]` and `for :each` to `for...of`; on a future
;; LLVM backend the same two methods lower to vtable calls and a loop. The protocol is the contract;
;; the lowering is the backend's business.
;;
;; The shape is deliberately Rust/C#-ish and deliberately small:
;;
;;   Iterable<T> -- "you can get a fresh cursor over my Ts"
;;   Iterator<T> -- "I am that cursor; ask me for the next T until there is none"
;;
;; `next` returns `T?`, not a `{value, done}` record -- `nil` MEANS done. That folds onto D9: the same
;; optional, the same forced-unwrap, the same flow-narrowing the rest of the language already has. A
;; consumer writes `(let v (next it))` and D9's narrowing gives it a `T` after the nil-check, with no
;; new machinery.
(
  ;; The cursor. One method, and it is the whole protocol: hand back the next element, or `nil` when
  ;; the sequence is exhausted. Calling `next` again after `nil` keeps returning `nil`.
  (definterface Iterator<T>
    (fn next [] -> T?))

  ;; The source. `iterator` produces a FRESH cursor each call, so a collection can be walked more than
  ;; once (`for :each` over the same array twice must start over both times).
  (definterface Iterable<T>
    (fn iterator [] -> Iterator<T>))

  (export Iterator Iterable)
)
