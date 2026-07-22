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
            (if (< put 0) (throw (Error "write failed")))
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
        (if (< fd 0) (throw (Error (+ "cannot open for writing: " path))))
        (return (FileWriter fd))
    ))

    ;; Open a file for reading. THROWS if it cannot be opened.
    (fn open-reader [path <- String] -> FileReader (
        (let fd (file-open path "r"))
        (if (< fd 0) (throw (Error (+ "cannot open for reading: " path))))
        (return (FileReader fd))
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
        (mut piece (r.read chunk))
        ;; The narrowing from the `while` condition does not reach the body -- nothing stops the body
        ;; reassigning `piece` -- so the inner test is load-bearing, not defensive.
        (while (!= piece nil) (
            (if (!= piece nil) (
                ;; `(+ "" piece)` is not decoration. Narrowing from the `if` reaches an OPERATOR
                ;; operand but not a METHOD ARGUMENT -- `(w.write piece)` is an LL0203, "expected
                ;; String, got String?" -- so the concat is what produces a non-optional to pass on.
                ;; Worth knowing: the two positions do not narrow alike.
                (let text (+ "" piece))
                (w.write text)
                (n := (+ n 1))
            ))
            (piece := (r.read chunk))
        ))
        (return n)
    ))

    (export Writer Reader StdOut StdErr FileWriter FileReader
            stdout stderr open-writer open-reader write-line copy)
)
