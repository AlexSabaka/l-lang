;; CONFORMANCE guard: line-buffered reading, identical on both backends.
;;
;; `read-line` WAS ESTIMATED AS THE HARDEST THING IN THE I/O STACK. It cost almost nothing, and the
;; reason is worth recording: two earlier decisions had already dissolved it.
;;
;;   * the file handle is an INT FILE DESCRIPTOR, and stdin is fd 0 -- so `file-read` already read the
;;     console, on both backends, with no new floor entry;
;;   * "read up to n bytes" is the only irreducible part, so the buffering and splitting are ordinary
;;     l-lang written on the floor, not a primitive implemented twice.
;;
;; The evidence that it was expected to be hard was still in the tree: `RuntimeProvider` carried a
;; `require("readline-sync")` into a variable NOTHING EVER READ. Someone started down the "vendor a
;; line reader" road and stopped. The require and the dependency are both gone now.
;;
;; -----------------------------------------------------------------------------------------------
;; WHY THIS GUARD READS A FILE AND NOT STDIN.
;;
;; The test runner spawns each example with `spawnSync` and no `stdio`, so stdin is INHERITED. Run
;; from a terminal, an example that reads fd 0 would face a live TTY -- and `fs.readSync(0, ...)` on
;; an interactive TTY can raise EAGAIN when nothing is buffered. A guard that depended on that would
;; be flaky for reasons having nothing to do with what it tests. `LineReader` over a file exercises
;; every bit of the splitting logic deterministically, and stdin is the same class over fd 0.
;;
;; The stdin half is real and verified by hand -- both backends agree, piped and at EOF:
;;
;;     printf 'one\ntwo\n' | node prog.js      first: one / rest: ["two"] / eof: nil
;;     printf 'one\ntwo\n' | ./prog            the same
;;     echo -n "" | ./prog                     first: nil / rest: [] / eof: nil
;;
;; A REPL-style prompt against a live terminal is NOT what this is yet, and that limitation is named
;; in std/io/console rather than left to be discovered.
(
    (import { LineReader } from "std/io/stream")
    (import { write-file } from "std/io/files")

    (fn lines-of [path <- String] -> String[] (
        (let fd (file-open path "r"))
        (let lr (LineReader fd))
        (mut out [])
        (mut l (lr.read-line))
        (while (!= l nil) (
            (if (!= l nil) (
                (let text (+ "" l))
                (out.push text)
            ))
            (l := (lr.read-line))
        ))
        (lr.close)
        (return out)
    ))

    (let p "/tmp/ll_guard_lines.txt")

    ;; A trailing newline does NOT produce a phantom empty last line.
    (write-file p "alpha\nbeta\n")
    (console.log "terminated:  " (lines-of p))

    ;; A last line with no terminator is still a line.
    (write-file p "alpha\nbeta")
    (console.log "unterminated:" (lines-of p))

    ;; CRLF: the carriage return is dropped, so a file written on Windows reads the same.
    (write-file p "alpha\r\nbeta\r\n")
    (console.log "crlf:        " (lines-of p))

    ;; An empty file has no lines -- not one empty line.
    (write-file p "")
    (console.log "empty:       " (lines-of p))

    ;; A blank line in the middle IS a line, which is what distinguishes it from the two cases above.
    (write-file p "alpha\n\nbeta\n")
    (console.log "blank line:  " (lines-of p))

    ;; Non-ASCII, so the split cannot be assumed to be byte-indexed on either backend.
    (write-file p "wörld\nzwölf\n")
    (console.log "non-ascii:   " (lines-of p))
)
