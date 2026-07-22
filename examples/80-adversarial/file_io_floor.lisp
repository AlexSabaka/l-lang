;; CONFORMANCE guard: `std/io/files` -- whole-file I/O layered on handles, identical on both backends.
;;
;; The first stdlib module that TOUCHES THE FILESYSTEM. Before it the entire i/o surface was four
;; floor entries and all four were writes to a stream, which is why the corpus had never opened a file.
;;
;; THE HANDLE IS AN INT FILE DESCRIPTOR on both backends -- not a compromise, but what both hosts
;; already hand out: node's `fs.openSync` returns an integer fd and POSIX `open(2)` returns one. No new
;; runtime tag, no boxed resource, no translation. The same Int means the same open file on either side.
;;
;; THE FLOOR IS TOTAL AND THE POLICY IS L-LANG. `file-open` answers -1, `file-read` answers nil at EOF,
;; `file-write` answers -1 -- and `std/io/files` decides that `read-file` throws while `try-read-file`
;; answers nil. Building it the other way round, with a throwing floor and `try-` wrappers catching,
;; would require exceptions to cross the floor boundary identically on both backends: a much larger
;; promise than nil, and one D47 already tells us is not true (conditions are C-native, JS-refused).
;; The throwing half is therefore an ORDINARY exception, which is green on both.
;;
;; -----------------------------------------------------------------------------------------------
;; THE LINE THAT MATTERS: `chunked` vs `whole`.
;;
;; A chunked read splits a multi-byte codepoint across two chunks unless something stops it. Decoding
;; a buffer that ends mid-sequence yields U+FFFD, so a naive reader corrupts exactly one codepoint per
;; chunk boundary -- silently, only on non-ASCII input, and therefore invisibly to a corpus that holds
;; exactly one non-ASCII string literal. Both runtimes EXTEND a read to complete a trailing sequence
;; (`ll_utf8_want` / `__ll_utf8_want`, which must stay in step or the two backends read files
;; differently).
;;
;; The test is built to fail if that is ever removed: 'ä' is two bytes, and the chunk size is 5, so a
;; codepoint straddles a boundary on every single chunk.
(
    (import { write-file read-file try-read-file append-file read-lines exists
              open close read-chunk } from "std/io/files")
    (import { strlen } from "std/string")

    (let p "/tmp/ll_guard_file_io.txt")

    ;; -- whole file, including a non-ASCII round trip -----------------------------------------------
    (write-file p "hello\nwörld\n")
    (console.log "exists:  " (exists p))
    (console.log "lines:   " (read-lines p))
    (console.log "codepoints:" (strlen (read-file p)))

    ;; A trailing newline does NOT produce a final empty line -- what every line-oriented tool means.
    (append-file p "third\n")
    (console.log "appended:" (read-lines p))

    ;; -- the total half: nil rather than a throw ---------------------------------------------------
    (console.log "missing: " (try-read-file "/tmp/ll_no_such_file_xyzzy"))
    (console.log "exists?: " (exists "/tmp/ll_no_such_file_xyzzy"))

    ;; -- the throwing half -------------------------------------------------------------------------
    (try (read-file "/tmp/ll_no_such_file_xyzzy")
     catch (console.log "threw:   " true))

    ;; -- the chunk-boundary guard ------------------------------------------------------------------
    (write-file p "ääääääääääääääääääää")
    (let fd (open p "r"))
    (mut acc "")
    (mut c (read-chunk fd 5))
    (while (!= c nil) (
        (if (!= c nil) (acc := (+ acc c)))
        (c := (read-chunk fd 5))
    ))
    (close fd)
    (console.log "chunked: " (strlen acc))
    (console.log "whole:   " (strlen (read-file p)))
    (console.log "same:    " (== acc (read-file p)))
)
