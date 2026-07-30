;; EVERY KIND `ll_trap` CAN THROW MUST BE CATCHABLE, in a program that never mentions the class.
;;
;; D87 says trap catchability does not depend on the tower being reachable, and recorded that as
;; "checked and NOT a contradiction". The evidence was measured with `RangeError` -- one of the three
;; classes the C emitter happened to register eagerly -- and generalised to the whole tower. It did
;; not hold: the runtime also traps with `ValueError` and `KeyError`, `ll_trap_as_error` does
;; `ll_class_by_name(kind); if (!cls) return;` and falls through to `exit(70)`, so those two were
;; SILENTLY FATAL. Measured before the fix:
;;
;;     (try m["zz"] catch e :of KeyError ...)                    -> exit 70, handler never ran
;;     the same file plus one unrelated (new KeyError "x" "x")    -> caught, exit 0
;;
;; The same source line, catchable in one program and fatal in another, decided by an unrelated line.
;;
;; THIS FILE CONSTRUCTS NONE OF THESE CLASSES. That is the whole point -- a file that mentions
;; `KeyError` registers it and cannot see the defect, which is exactly why the previous guard
;; (`catchable_data_traps.lisp`, RangeError only) stayed green through it.
(
    (import "std/sys/timers")

    ;; KeyError -- a missing map key. The kind that was fatal.
    (let m {:a 1})
    (try ((let v m["zz"]) (console.log "no trap"))
      catch e :of KeyError (console.log "KeyError: caught"))

    ;; ValueError -- a bad literal argument to a floor entry. Also fatal before; D87's own
    ;; "loose end" paragraph asserts this one is catchable, and it was not.
    (try ((let t (clock-ns "bogus")) (console.log "no trap"))
      catch e :of ValueError (console.log "ValueError: caught"))

    ;; RangeError -- an out-of-range index. THE CONTROL: this is the only kind the previous guard
    ;; covered, and it passed throughout, which is how the other two hid.
    (let xs [1 2 3])
    (try ((let v xs[99]) (console.log "no trap"))
      catch e :of RangeError (console.log "RangeError: caught"))

    ;; Each is also an Error -- the tower's root has to stay reachable up the :extends chain.
    (try ((let v m["nope"]) (console.log "no trap"))
      catch e :of Error (console.log "as Error: caught"))

    (console.log "survived all four")
)
