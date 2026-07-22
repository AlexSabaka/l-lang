;; std/io/files -- reading and writing files, whole-file layered on handles.
;;
;; THE LAYERING IS THE RULING. The floor provides five TOTAL primitives -- `file-open` answers -1,
;; `file-read` answers nil at EOF, `file-write` answers -1 -- and everything in this file is l-lang
;; written on them. So the whole-file API is portable by construction rather than implemented twice,
;; and the only thing either backend had to supply is the syscall.
;;
;; THE HANDLE IS AN INT FILE DESCRIPTOR, on both backends, because that is what both hosts already
;; hand out: node's `fs.openSync` returns an integer fd and POSIX `open(2)` returns one. No new tag,
;; no boxed resource, no translation -- the same Int means the same open file on either side.
;;
;; TWO FLAVOURS OF FAILURE, and the pairing is D9's, one layer up. D9 gives the language a partial
;; indexer that THROWS and total accessors that answer nil; this file gives it the same choice:
;;
;;     (read-file p)       throws if the file cannot be read     -- the default, because a missing
;;                                                                  input file is usually a defect
;;     (try-read-file p)   answers nil instead                   -- for "is this configured?"
;;
;; `try-` rather than a `?` suffix: D21 rejects `?`-suffixed names BY NAME (`nil?`, `set!`) in favour
;; of `is-x` predicates, so `read-file?` would read as "is this a file?". `try-` is C#'s `TryParse`
;; shape, and l-lang thinks it's C#.
;;
;; The throwing half is an ORDINARY exception, not a D47 condition. D47's conditions are C-native and
;; JS-refused, so routing i/o through them would widen a divergence the language already has; plain
;; try/catch is green on both backends (18-error-handling, 12 examples).
(
    ;; How much to pull per `file-read`. The floor completes a trailing multi-byte UTF-8 sequence, so
    ;; a chunk boundary never splits a codepoint whatever this is set to.
    (let CHUNK 65536)

    (fn exists [path <- String] -> Boolean
        (return (file-exists path)))

    ;; -- handles ---------------------------------------------------------------------------------

    ;; Open a file. Mode is "r", "w" (truncate) or "a" (append). THROWS if it cannot be opened; the
    ;; total spelling is `try-open`.
    (fn open [path <- String mode <- String] -> Int (
        (let fd (file-open path mode))
        (if (< fd 0) (throw (Error (+ "cannot open file: " path))))
        (return fd)
    ))

    ;; Open a file, or nil if it cannot be opened.
    (fn try-open [path <- String mode <- String] -> Int? (
        (let fd (file-open path mode))
        (if (< fd 0) (return nil))
        (return fd)
    ))

    (fn close [fd <- Int] -> Void
        (file-close fd))

    ;; Up to `n` bytes, or nil at end of file. Never splits a codepoint.
    (fn read-chunk [fd <- Int n <- Int] -> String?
        (return (file-read fd n)))

    ;; Bytes written, or -1 on failure.
    (fn write-chunk [fd <- Int text <- String] -> Int
        (return (file-write fd text)))

    ;; -- whole file ------------------------------------------------------------------------------

    ;; The whole file as a String. THROWS if it cannot be read.
    (fn read-file [path <- String] -> String (
        (let fd (open path "r"))
        (mut out "")
        (mut chunk (read-chunk fd CHUNK))
        ;; The inner `if` is not redundant. `read-chunk` answers `String?`, and the narrowing from the
        ;; WHILE condition does not reach the body -- so `(+ out chunk)` is an LL0205 without it. That
        ;; is the checker being right: nothing stops the body reassigning `chunk` to nil.
        (while (!= chunk nil) (
            (if (!= chunk nil) (out := (+ out chunk)))
            (chunk := (read-chunk fd CHUNK))
        ))
        (close fd)
        (return out)
    ))

    ;; The whole file, or nil if it cannot be read. The total twin of `read-file`.
    (fn try-read-file [path <- String] -> String? (
        (if (== (file-exists path) false) (return nil))
        (let fd (file-open path "r"))
        (if (< fd 0) (return nil))
        (mut out "")
        (mut chunk (read-chunk fd CHUNK))
        ;; The inner `if` is not redundant. `read-chunk` answers `String?`, and the narrowing from the
        ;; WHILE condition does not reach the body -- so `(+ out chunk)` is an LL0205 without it. That
        ;; is the checker being right: nothing stops the body reassigning `chunk` to nil.
        (while (!= chunk nil) (
            (if (!= chunk nil) (out := (+ out chunk)))
            (chunk := (read-chunk fd CHUNK))
        ))
        (close fd)
        (return out)
    ))

    ;; Replace a file's contents. THROWS if it cannot be written.
    (fn write-file [path <- String text <- String] -> Void (
        (let fd (open path "w"))
        (let put (write-chunk fd text))
        (close fd)
        (if (< put 0) (throw (Error (+ "cannot write file: " path))))
    ))

    ;; Add to the end of a file, creating it if absent. THROWS if it cannot be written.
    (fn append-file [path <- String text <- String] -> Void (
        (let fd (open path "a"))
        (let put (write-chunk fd text))
        (close fd)
        (if (< put 0) (throw (Error (+ "cannot append to file: " path))))
    ))

    ;; The file's lines, without their terminators. A trailing newline does NOT produce a final empty
    ;; line -- `"a\nb\n"` is two lines, which is what every line-oriented tool means by it.
    (fn read-lines [path <- String] -> String[] (
        (let text (read-file path))
        (if (== text "") (return []))
        (let parts (text.split "\n"))
        (let last (elem parts (- parts.length 1)))
        (if (== last "") (return (parts.slice 0 (- parts.length 1))))
        (return parts)
    ))

    (export CHUNK exists open try-open close read-chunk write-chunk
            read-file try-read-file write-file append-file read-lines)
)
