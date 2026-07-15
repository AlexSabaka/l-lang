;; std/async -- the AWAITABLE protocol (D32).
;;
;; `:async` / `await` are defined by these interfaces and lowered per backend (D29). On JS the lowering
;; is native and nearly free: `:async` -> `async function`, `(await e)` -> `await e`, and a `Task<T>`
;; IS a `Promise<T>`. On a future LLVM backend the same `Awaitable<T>` lowers to a coroutine handle and
;; a state machine -- which is what C#'s `Task<T>` is under the hood; the JS runtime just gives it to us.
;;
;; The protocol is a TYPE-LEVEL contract. Its job is to let the checker reason -- `await` UNWRAPS an
;; `Awaitable<T>` to `T`, and an `:async` function's `(return x)` produces the payload `T`, not the
;; wrapper -- and to survive the backend swap. The runtime machine is the backend's business.
(
  ;; Something `await` produces a `T` from. On JS this is a thenable (a Promise); `then` is the hook
  ;; the JS runtime awaits through. A user type implementing this becomes awaitable.
  (definterface Awaitable<T>
    (fn then [on-fulfilled] -> Any))

  ;; The standard awaitable, and the declared return type of a `(fn :async ... -> Task<T>)`. On the JS
  ;; backend a `Task<T>` is a `Promise<T>` -- the two names are the same handle to an eventual `T`.
  (definterface Task<T> :implements Awaitable<T>)

  (export Awaitable Task)
)
