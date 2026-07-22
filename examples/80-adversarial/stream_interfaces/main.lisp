;; CONFORMANCE guard: `Writer`/`Reader` -- one interface, a file and a standard stream behind it.
;;
;; WRITTEN AFTER `std/io/files`, ON PURPOSE. An interface with one implementor is anticipation rather
;; than design: before files existed the only candidates were the three standard streams, all wrapping
;; the same two floor entries, so the abstraction would have been justified by nothing. Files supplied
;; the second implementor and only then was it worth writing.
;;
;; -----------------------------------------------------------------------------------------------
;; THE LINE THAT MATTERS: "interleaved", and why `stdout` is NOT a file writer over fd 1.
;;
;; That was the obvious design. It would have worked on JS and SILENTLY REORDERED OUTPUT ON C.
;; `write-string` reaches stdout through `fwrite`, which is BUFFERED; `file-write` is `write(2)`,
;; which is not. Mixing them on one descriptor lets the raw write jump the buffer:
;;
;;     (console.log "one")  (file-write 1 "two\n")  (console.log "three")
;;
;;     JS:  one / two / three          C:  TWO / one / three
;;
;; Measured before the module was written, not discovered after. Nothing about it is visible from the
;; l-lang side, and every `print` in the language uses the buffered path -- so a `Writer` that wrapped
;; fd 1 would have corrupted the order of any program that mixed `print` with a stream, on one backend
;; only. The standard writers therefore use the floor's STREAM SINK and only files use the descriptor
;; surface, which is exactly the kind of split an interface exists to hide.
;;
;; ALSO RE-MEASURED HERE: interface-typed dispatch works on C. The gap ledger lists a "witness-table
;; case, deferred" and cites `02_interface_conformance` -- but that file's actual blocker is
;; `method:Monster.passable`, an EXTENSION method on a class receiver, which is a different thing.
;; A receiver typed by an INTERFACE dispatches correctly on both backends today; `write-line` and
;; `copy` below take `Writer`/`Reader` and are the proof.
(
    (import { stdout write-line open-writer open-reader copy } from "std/io/stream")
    (import { read-file } from "std/io/files")

    (let p "/tmp/ll_guard_stream.txt")

    ;; 1. A standard stream THROUGH the interface, interleaved with console.log. This is the ordering
    ;;    that a fd-1 writer would have broken on C.
    (write-line stdout "via Writer")
    (console.log "interleaved")
    (write-line stdout "via Writer again")

    ;; 2. The SAME interface, a completely different implementation underneath.
    (let w (open-writer p "w"))
    (write-line w "alpha")
    (write-line w "beta")
    (w.close)
    (console.log "file:      " (read-file p))

    ;; 3. `copy` knows neither side: a Reader in, a Writer out. Chunked at 4 bytes so it loops.
    (let r (open-reader p))
    (console.log "chunks:    " (copy r stdout 4))
    (r.close)
)
