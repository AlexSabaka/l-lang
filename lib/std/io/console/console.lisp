;; std/io/console -- reading from standard input.
;;
;; `read-line` COST ALMOST NOTHING, and that is worth recording because it was estimated as the
;; hardest thing in the whole i/o stack. Two earlier decisions collapsed it:
;;
;;   * the file handle is an INT FILE DESCRIPTOR, and stdin is fd 0. So `file-read` already reads the
;;     console, on both backends, with no new floor entry.
;;   * `LineReader` in `std/io/stream` buffers and splits in l-lang, so "read up to n bytes" is the
;;     only irreducible part and it already existed.
;;
;; The evidence that it was expected to be hard is still in the tree: `RuntimeProvider` carries a
;; `require("readline-sync")` that NOTHING USES -- someone started down the "vendor a line reader"
;; road and stopped. That dependency can go.
;;
;; ONE REAL LIMITATION, named rather than hidden. On JS this is `fs.readSync(0, ...)`, and reading an
;; INTERACTIVE TTY that way can raise EAGAIN when no input is buffered. Piped or redirected input --
;; `echo x | prog`, `prog < file`, which is how a program in a pipeline is actually run -- works on
;; both backends. A REPL-style prompt loop against a live terminal is not what this is yet.
(
    (import { LineReader } from "std/io/stream")

    ;; Standard input, line-buffered. A binding rather than a function for the same reason `args` is:
    ;; there is exactly one stdin, and it holds READ STATE -- a function returning a fresh LineReader
    ;; each call would drop whatever the previous one had buffered past a newline.
    (let stdin (LineReader 0))

    ;; The next line from standard input, without its terminator, or nil at end of input.
    (fn read-line [] -> String?
        (return (stdin.read-line)))

    ;; Every remaining line. Useful for the `prog < file` shape, where the whole input is available.
    (fn read-lines [] -> String[] (
        (mut out [])
        (mut line (stdin.read-line))
        (while (!= line nil) (
            ;; Bound to a local first, and not for readability. Narrowing from the `if` does not reach
            ;; inside a METHOD-CALL ARGUMENT -- `(out.push (+ "" line))` is an LL0205 on the `+` -- but
            ;; the same expression as a `let` initializer is accepted. Third time this has bitten in
            ;; this phase; the argument position is the one that does not narrow.
            (if (!= line nil) (
                (let text (+ "" line))
                (out.push text)
            ))
            (line := (stdin.read-line))
        ))
        (return out)
    ))

    (export stdin read-line read-lines)
)
