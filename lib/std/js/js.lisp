;; ==================================================================================================
;; std/js -- THE JAVASCRIPT AMBIENT ENVIRONMENT
;;
;; Every name the host runtime provides, DECLARED (`:extern`) and never defined. This module is
;; imported IMPLICITLY into every compiled module -- it is the prelude -- so `(console.log x)` needs
;; no ceremony.
;;
;; It replaces `InferTypesAstVisitor.JS_GLOBALS`: a hardcoded 37-name allowlist that lived INSIDE THE
;; TYPE CHECKER and waved these names through untyped. That was not a standard library; it was a hole
;; in the type system, and `console` alone went through it 579 times. Moving the list here is the
;; point of D7 -- JS interop belongs behind a library boundary, not inside the compiler -- and it makes
;; the set extensible: a browser target, a node target, a worker target can each ship their own.
;;
;; UNTYPED, deliberately. An untyped extern resolves and stays Unknown, so gradual typing leaves every
;; downstream check exactly as it was: zero behaviour change. Giving `Math` a real interface -- so that
;; `Math.sqrt` is checked as `Real -> Real` -- is a separate, measured pass. The machinery already
;; exists (TypeEnvironment.resolveIdentifier resolves a dotted name against a class/struct/interface),
;; so it is a matter of writing the declarations, not of building anything.
;;
;; NOT DECLARED HERE: `String`, `Boolean`, `Number` -- the three names that are BOTH an l-lang TYPE
;; and a JS VALUE. l-lang keeps types and values in ONE namespace, so declaring them here is not
;; possible, and that is a measured fact rather than a caution:
;;
;;   Declaring `(let :extern Number)` produced ELEVEN new LL0203s -- `expected Number, got Int`.
;;   Inside std/math, `<- Number` resolves LEXICALLY to that file's own `deftype Number Int | Real`.
;;   But when another module checks a CALL to one of math's functions, the parameter's type-ref is
;;   resolved in the CALLER's scope, the lexical walk misses, and the flat cross-module fallback finds
;;   this extern -- a variable, not a union. `Int` stops being assignable to `Number`.
;;
;; So the three of them stay in a residual set inside checkIdentifierResolves, which is documented
;; there. The real fix is to stop resolving types and values from one namespace; until then, a
;; three-name shim is the honest answer and a 37-name allowlist was not.
;; ==================================================================================================
(
  ;; --- Core objects ---
  (let :extern console)
  (let :extern Math)
  (let :extern JSON)
  (let :extern Object)
  (let :extern Array)
  (let :extern Symbol)
  (let :extern Reflect)
  (let :extern Proxy)
  (let :extern BigInt)


  ;; --- Errors ---
  (let :extern Error)
  (let :extern TypeError)
  (let :extern RangeError)

  ;; --- Built-in constructors ---
  (let :extern Date)
  (let :extern RegExp)
  (let :extern Map)
  (let :extern Set)
  (let :extern WeakMap)
  (let :extern WeakSet)
  (let :extern Promise)

  ;; --- Global values ---
  (let :extern NaN)
  (let :extern Infinity)
  (let :extern globalThis)

  ;; --- Global functions ---
  (fn :extern parseInt [...args])
  (fn :extern parseFloat [...args])
  (fn :extern isNaN [...args])
  (fn :extern isFinite [...args])

  ;; --- Host environment ---
  ;; A browser has `window`/`document`; node has `process`. Declaring both is what the allowlist did,
  ;; and splitting them per target is exactly the kind of thing a library can do and a hardcoded set
  ;; inside the compiler could not.
  (let :extern window)
  (let :extern document)
  (let :extern navigator)
  (let :extern process)

  ;; --- Timers & I/O ---
  (fn :extern setTimeout [...args])
  (fn :extern setInterval [...args])
  (fn :extern clearTimeout [...args])
  (fn :extern clearInterval [...args])
  (fn :extern fetch [...args])

  (export console Math JSON Object Array Symbol Reflect Proxy BigInt
          Error TypeError RangeError
          Date RegExp Map Set WeakMap WeakSet Promise
          NaN Infinity globalThis
          parseInt parseFloat isNaN isFinite
          window document navigator process
          setTimeout setInterval clearTimeout clearInterval fetch)
)
