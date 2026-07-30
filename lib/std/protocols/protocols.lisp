;; std/protocols -- the CROSS-CUTTING CONTRACTS. Types, no behaviour, no imports.
;;
;; A contract belongs here when types in unrelated packages implement it. `Iterable`/`Iterator` are
;; the iteration protocol (D30) and DEFINE a language form -- `for :each`, `:gen`, and every lazy
;; operator are lowered against them per backend (D29). `Disposable` is not about iteration at all,
;; which its own comment below argues at length; it lived in `std/iter` only because that is where
;; the first consumer was.
;;
;; WHY ITS OWN PACKAGE, WITH NO SIBLINGS. A package injects its siblings into every importer, so a
;; contract that shares a package drags its neighbours into everything that depends on it. Measured:
;; putting these in `std/core/protocols` -- where Comparable/Hashable/Formattable/Ring already live,
;; and the obvious home -- gives 302 pass / 1 error on the JS lane, because `std/core/string`'s free
;; `join` becomes reachable from every `std/iter` consumer and shadows the native array `.join`.
;;
;; That is not a quirk of `join`. B0 measured the same machinery as compile time: making `std/sys` a
;; real package added two unrelated modules to every program that wanted `args`, for +186% `cc -O2`.
;; Compile cost and name shadowing are two faces of one unruled decision, recorded in
;; `docs/roadmap.md`. Until it is ruled, a sibling-free package is the shape that cannot be bitten.
;;
;; NOT A PRELUDE, deliberately. The two preludes (`std/js`, `std/core/errors`) export type-ish names
;; only; making a contract ambient would put its free functions in every file's flat resolution
;; union, which is the failure this file is arranged to avoid.
(
  ;; The source. `iterator` produces a FRESH cursor each call, so a collection can be walked more than
  ;; once (`for :each` over the same array twice must start over both times).
  (definterface Iterable<T>
    (fn iterator [] -> Iterator<T>))

  ;; The cursor. One method, and it is the whole protocol: hand back the next element, or `nil` when
  ;; the sequence is exhausted. Calling `next` again after `nil` keeps returning `nil`.
  ;;
  ;; An Iterator IS an Iterable (Phase L / La): a cursor can stand wherever a source is wanted, and it
  ;; iterates AS ITSELF -- true in JS, Rust (`Iterator: IntoIterator`) and Python. This is what lets the
  ;; lazy operators chain: `map` returns an `Iterator<U>`, `filter` takes an `Iterable<T>`, and the pipe
  ;; `(coll |> (map f) |> (filter p))` type-checks because the former satisfies the latter. A
  ;; hand-written iterator satisfies it by returning `this` from `iterator()`, which every one already
  ;; does (the `Countdown` fixture, `std/iter`'s own conformance test).
  ;;
  ;; `next` returns `T?`, and `nil` MEANS done. That folds onto D9 -- the same optional, the same
  ;; forced-unwrap, the same flow-narrowing the rest of the language already has.
  ;;
  ;; IT IS ALSO A MEASURED DEFECT, and B3 is where it gets ruled. A nil ELEMENT is indistinguishable
  ;; from the end, so a user cursor over `[1 nil 2]` walks ONE element on both backends. The runtime
  ;; already moved past this for BUILT-IN cursors -- `ll_iter_done` reads an out-of-band flag off the
  ;; cursor env -- and the ruling that did so says in its own text that "a USER cursor keeps the nil
  ;; rule". This interface is the half that was left behind.
  (definterface Iterator<T> :implements Iterable<T>
    (fn next [] -> T?))

  ;; The DETERMINISTIC edge, and deliberately a SEPARATE interface rather than a member on
  ;; `Iterator<T>` (D58).
  ;;
  ;; A lazy source is routinely abandoned rather than exhausted -- `take`, `take-while`, `first` and
  ;; `any` all stop early, which is what they are FOR -- so "the sequence ended" and "the consumer
  ;; walked away" are different events, and only the second needs a cleanup hook. Prior art agrees on
  ;; the shape: C#'s `IEnumerator<T> : IDisposable` with `foreach` disposing in a finally is the clean
  ;; one; JS's optional `return()` is the same idea as an optional member; Python's GC-coupled
  ;; `close()` is the version PEP 533 exists to apologise for; Java's hookless `Iterator` is the
  ;; cautionary tale.
  ;;
  ;; Separate, though, because bolting `dispose` onto `Iterator<T>` would break every hand-written
  ;; iterator in the corpus at once -- `:implements Iterator` is a PROMISE the checker enforces
  ;; (LL0209), so a new member is a new obligation for code that has no resource to release. A
  ;; consumer type-tests instead: dispose what is `Disposable`, leave everything else alone.
  ;;
  ;; GC is NOT the mechanism (D59: memory-only, no finalizers). That is not a limitation to work
  ;; around -- JS never runs an abandoned generator's `finally` either, so scope-bound disposal is
  ;; the behaviour BOTH backends can actually agree on.
  ;;
  ;; Note that the separateness argument is about the INTERFACE, not the address: nothing in it says
  ;; where the declaration lives, and "not part of the iteration protocol" is an argument for moving
  ;; it out of the iteration module rather than for keeping it there.
  (definterface Disposable
    (fn dispose [] -> Void))

  (export Iterable Iterator Disposable)
)
