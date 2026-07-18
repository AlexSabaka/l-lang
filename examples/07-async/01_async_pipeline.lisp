;; Async Pipeline -- chaining :async stages, and the error path through them.
;;
;; This example demonstrates:
;; - (fn :async ...) definitions and the (await ...) expression
;; - std/async's Task<T> as the DECLARED return type of an async function, while
;;   the body returns the payload T -- `await` is what unwraps Task<String> to String
;; - chaining async stages: fetch -> parse -> describe
;; - an async function that throws, caught by try/catch at the awaiting site
;; - the sync/async split: an :async call returns a Task immediately, so the
;;   caller keeps running until its first await
;;
;; No timers are used: every stage resolves immediately, so the output order is
;; fully deterministic.

(
    (import "std/io")
    (import "std/async")
    (import "std/seq")
    (import "std/string")

    ;; --- Stage 1: fetch a raw row -----------------------------------------
    ;; Declared `-> Task<String>` (std/async), but `(return ...)` yields the
    ;; PAYLOAD String -- the Task wrapper is the async lowering's business.
    (fn :async fetch-row [id <- Int] -> Task<String>
        (let rows ["ada:1815" "alan:1912" "grace:1906"])
        (when (>= id (length rows)) :then
            (throw (Error '"no row with id {(id)}")))
        (return rows[id]))

    ;; --- Stage 2: parse ----------------------------------------------------
    ;; `await` unwraps stage 1's Task<String> into a String we can split.
    (fn :async parse-row [id <- Int] -> Task<Any[]>
        (let raw (await (fetch-row id)))
        (let parts (split raw ":"))
        (return [(upcase parts[0]) (parseInt parts[1])]))

    ;; --- Stage 3: describe -------------------------------------------------
    ;; Awaiting an async fn that itself awaits: the stages chain.
    (fn :async describe [id <- Int] -> Task<String>
        (let rec (await (parse-row id)))
        (let name rec[0])
        (let year rec[1])
        (return '"{(name)} was born in {(year)}"))

    ;; --- Driver ------------------------------------------------------------
    (fn :async main [] -> Task<Void>
        (print "pipeline: start")

        ;; `for :each` with an await in the body: the loop is sequential -- each
        ;; iteration suspends until its stage resolves before the next begins.
        (for :each id :from [0 1 2] :then (
            (let line (await (describe id)))
            (print "  row {0}: {1}" id line)))

        ;; Error path: stage 1 throws, the rejection propagates back through
        ;; stages 2 and 3 and surfaces at the `await` inside this try.
        (try (
            (let line (await (describe 9)))
            (print "  unreachable: {0}" line))
         catch e :of Error
            (print "  caught: {0}" e.message))

        (print "pipeline: done"))

    ;; An :async call returns a Task immediately: the sync tail below runs
    ;; before any awaited stage resolves -- hence it prints SECOND, not last.
    (main)
    (print "sync tail: main is still in flight")
)
