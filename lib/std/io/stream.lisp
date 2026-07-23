;; std/io/stream -- `Writer` and `Reader`, and the three standard streams.
;;
;; WRITTEN AFTER `std/io/files`, ON PURPOSE. An interface with one implementor is anticipation, not
;; design: before files existed the only candidates were the standard streams, all three of which wrap
;; the same two floor entries, so the abstraction would have been justified by nothing. Files gave it
;; a genuine second implementor, and only then was it worth writing.
;;
;; -----------------------------------------------------------------------------------------------
;; WHY `stdout` IS NOT A FILE WRITER OVER FD 1, WHICH IS THE OBVIOUS DESIGN.
;;
;; It would have worked on JS and silently reordered output on C. `write-string` reaches stdout
;; through `fwrite`, which is BUFFERED; `file-write` is `write(2)`, which is not. Mixing them on the
;; same descriptor makes the raw write jump ahead of everything still sitting in the buffer. Measured,
;; not assumed:
;;
;;     (console.log "one")  (file-write 1 "two\n")  (console.log "three")
;;
;;     JS:  one / two / three          C:  two / one / three
;;
;; Nothing about that is visible from the l-lang side, and every `print` in the language goes through
;; the buffered path. So the standard writers use the floor's STREAM SINK -- the same path
;; `console.log` uses -- and only files use the descriptor surface. The interface is what lets those
;; be two different implementations of one idea, which is the entire reason it exists.
;;
;; A SINK'S `write` RETURNS Void AND FAILS BY THROWING. Returning a byte count would be a lie for
;; `write-string`, which has none to report, and the throwing half matches `std/io/files`: a failed
;; write is a defect, not a value to inspect.
(
    (import "std/core/errors")

    ;; No import: `file-open`/`file-read`/`file-write`/`file-close` are FLOOR names, ambient on both
    ;; backends like `write-string`. Importing them from `std/io/files` is an LL0235 -- that module
    ;; exports its own `open`/`read-chunk`/`write-chunk` layer, not the primitives underneath it.
    ;; A place bytes can go.
    (definterface Writer
        (fn write [text <- String] -> Void))

    ;; A place bytes come from. `read` answers nil at end of input -- the same "nil means done" the
    ;; iteration protocol uses (D9: one bottom value, so absent and exhausted are one answer).
    (definterface Reader
        (fn read [n <- Int] -> String?))

    ;; -- the standard streams ----------------------------------------------------------------------
    ;;
    ;; Through the floor's stream sink, NOT through fd 1/2. See the note above.

    (defclass StdOut :implements Writer
        (fn write [text <- String] -> Void (write-string text)))

    (defclass StdErr :implements Writer
        (fn write [text <- String] -> Void (write-string-err text)))

    (let stdout (StdOut))
    (let stderr (StdErr))

    ;; -- files as streams --------------------------------------------------------------------------

    (defclass FileWriter :implements Writer
        (let :ctor fd <- Int 0)
        (fn write [text <- String] -> Void (
            (let put (file-write this.fd text))
            (if (< put 0) (throw (new IOError "write failed")))
        ))
        (fn close [] -> Void (file-close this.fd))
    )

    (defclass FileReader :implements Reader
        (let :ctor fd <- Int 0)
        (fn read [n <- Int] -> String? (return (file-read this.fd n)))
        (fn close [] -> Void (file-close this.fd))
    )

    ;; Open a file for writing. Mode is "w" (truncate) or "a" (append). THROWS if it cannot be opened.
    (fn open-writer [path <- String mode <- String] -> FileWriter (
        (let fd (file-open path mode))
        (if (< fd 0) (throw (new FileError (+ "cannot open for writing: " path) path)))
        (return (FileWriter fd))
    ))

    ;; Open a file for reading. THROWS if it cannot be opened.
    (fn open-reader [path <- String] -> FileReader (
        (let fd (file-open path "r"))
        (if (< fd 0) (throw (new FileError (+ "cannot open for reading: " path) path)))
        (return (FileReader fd))
    ))

    ;; -- a LINE-BUFFERED reader --------------------------------------------------------------------
    ;;
    ;; NO NEW FLOOR ENTRIES, which is the point. `file-read` answers "up to n bytes", and a reader can
    ;; over-read past a newline -- so line splitting needs somewhere to keep the remainder. That
    ;; somewhere is a field, and the splitting itself is ordinary string work, which makes the whole
    ;; thing l-lang written on the floor rather than a primitive implemented twice.
    ;;
    ;; It is also what makes `read-line` from STDIN nearly free: stdin is fd 0, so a LineReader over 0
    ;; is a console reader, and one over an open file is a line-oriented file reader. Same code.
    ;;
    ;; `.indexOf`/`.slice` are the HOST's string members, so they count codepoints on C and UTF-16
    ;; units on JS (D50's native-member boundary). That is safe HERE because both indices are produced
    ;; and consumed by the same backend on the same string -- the split lands in the same logical place
    ;; either way. It would not be safe to compare one against a length computed by l-lang's own
    ;; `strlen`, which is why nothing below does.
    (defclass LineReader :implements Reader
        (let :ctor fd <- Int 0)
        (mut pending <- String "")
        (mut drained <- Boolean false)

        ;; The raw `Reader` surface, so a LineReader is still a Reader.
        (fn read [n <- Int] -> String? (return (file-read this.fd n)))

        ;; The next line WITHOUT its terminator, or nil once input is exhausted.
        ;;
        ;; A trailing newline does not produce a final empty line, and a last line with no terminator
        ;; is still a line -- the two rules every line-oriented tool follows.
        (fn read-line [] -> String? (
            (mut idx (this.pending.indexOf "\n"))
            (while (< idx 0) (
                (if this.drained (
                    (if (== this.pending "") (return nil))
                    (let rest this.pending)
                    (this.pending := "")
                    (return (strip-cr rest))
                ))
                (let chunk (file-read this.fd 65536))
                ;; Two positive tests rather than an if/else. The ELSE branch of `(== chunk nil)` does
                ;; not narrow `chunk` to non-optional, so appending there is a type error -- and that
                ;; error then suppresses narrowing in OTHER functions in this module, which is how it
                ;; was originally mistaken for a narrowing bug in `copy`.
                (if (== chunk nil) (this.drained := true))
                (if (!= chunk nil) (this.pending := (+ this.pending chunk)))
                (idx := (this.pending.indexOf "\n"))
            ))
            (let line (this.pending.slice 0 idx))
            (this.pending := (this.pending.slice (+ idx 1)))
            (return (strip-cr line))
        ))

        (fn close [] -> Void (file-close this.fd))
    )

    ;; `\r\n` line endings: drop the carriage return so a file written on Windows reads the same.
    (fn strip-cr [line <- String] -> String (
        (if (== line "") (return line))
        (if (== (line.slice (- line.length 1)) "\r") (return (line.slice 0 (- line.length 1))))
        (return line)
    ))

    ;; -- operations over the interfaces ------------------------------------------------------------
    ;;
    ;; These take `Writer`/`Reader`, so they work on a file and on a standard stream without knowing
    ;; which -- which is the whole point, and the reason the interface earns its place.

    (fn write-line [w <- Writer text <- String] -> Void (
        (w.write text)
        (w.write "\n")
    ))

    ;; Pump everything from `r` into `w`, `chunk` bytes at a time. Answers how many chunks moved.
    (fn copy [r <- Reader w <- Writer chunk <- Int] -> Int (
        (mut n 0)
        (mut going true)
        ;; `piece` is a fresh `let` PER ITERATION rather than a `mut` reassigned at the bottom, and
        ;; that is not a style choice. Reassigning a `mut` anywhere in a loop body makes the checker
        ;; discard its narrowing for the WHOLE body -- an inner `(if (!= piece nil) ...)` does not
        ;; re-establish it -- so `(w.write piece)` becomes "expected String, got String?" even though
        ;; it is plainly guarded. A binding that is never reassigned narrows normally.
        ;; See DECISIONS.md, D41's 2026-07-22 amendment.
        (while going (
            (let piece (r.read chunk))
            (if (== piece nil) (going := false))
            (if (!= piece nil) (
                (w.write piece)
                (n := (+ n 1))
            ))
        ))
        (return n)
    ))

    (export Writer Reader StdOut StdErr FileWriter FileReader LineReader
            stdout stderr open-writer open-reader write-line copy strip-cr)
)
