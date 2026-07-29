;; std/sys/timers -- clocks, measurement, fixed-step pacing, and a driven scheduler.
;;
;; Almost every line here runs on a `ManualClock`, and that is the point rather than a convenience. A
;; timers module measured against the real clock can assert `elapsed >= 0` and nothing else -- a
;; duration differs every run, so it cannot be a golden, which is why `10-modifiers/03_timing_modifier`
;; asserts exactly that and no more. Because a `Clock` here owns SLEEPING as well as reading, a fake
;; clock advances when something waits on it, and the scheduler's dispatch order, its repeat
;; arithmetic and its catch-up behaviour all become exactly reproducible.
;;
;; The last two lines use the real clock, and are the only ones that cannot be exact.

(import "std/sys/timers")

(
    ;; -- units ------------------------------------------------------------------------------------
    ;; Nanoseconds is the language's time unit -- it is what both hosts hand back, and D51's int64 Int
    ;; holds it natively. These are the readable way to write one.
    (console.log "--- units ---")
    (console.log "1us =" (us 1))
    (console.log "1ms =" (ms 1))
    (console.log "1s  =" (s 1))

    ;; -- a clock you drive -------------------------------------------------------------------------
    (console.log "--- manual clock ---")
    (let mc (ManualClock))
    (console.log "t0:      " (mc.now))
    (mc.advance (ms 5))
    (console.log "advanced:" (mc.now))
    ;; `sleep` on a manual clock ADVANCES it. That is what makes everything below deterministic.
    (mc.sleep (ms 10))
    (console.log "slept:   " (mc.now))

    ;; -- measuring ---------------------------------------------------------------------------------
    (console.log "--- stopwatch ---")
    (let sw (Stopwatch mc))
    (mc.advance (ms 250))
    (console.log "elapsed ms:" (sw.elapsed-ms))
    (console.log "elapsed us:" (sw.elapsed-us))
    (sw.reset)
    (console.log "after reset:" (sw.elapsed-ms))

    ;; -- fixed-step pacing -------------------------------------------------------------------------
    ;;
    ;; A ticker paces against ABSOLUTE deadlines, so the time the work itself takes does not
    ;; accumulate as drift the way "do the work, then sleep the period" does.
    (console.log "--- ticker at 100ms ---")
    (let tc (ManualClock))
    (let tk (Ticker tc (ms 100)))
    (console.log "dt1:" (/ (tk.tick) 1000000) "at" (/ (tc.now) 1000000) "lag" (tk.lag))
    (console.log "dt2:" (/ (tk.tick) 1000000) "at" (/ (tc.now) 1000000) "lag" (tk.lag))

    ;; A frame that overruns its budget: 250ms of "work" against a 100ms period. The tick does not
    ;; sleep at all -- the deadline is already past -- and reports the real 250ms as `dt` plus the
    ;; lateness as `lag`. Having fallen more than a whole period behind, the next deadline is REBASED
    ;; on now (550) rather than chased (400): chasing is the spiral of death, where the loop runs
    ;; frames back to back without sleeping and falls further behind by doing so.
    (tc.advance (ms 250))
    (console.log "dt3:" (/ (tk.tick) 1000000) "at" (/ (tc.now) 1000000) "lag" (/ (tk.lag) 1000000))
    (console.log "dt4:" (/ (tk.tick) 1000000) "at" (/ (tc.now) 1000000) "lag" (tk.lag))

    ;; -- the driven scheduler ----------------------------------------------------------------------
    ;;
    ;; `every`/`after` register; `run` executes. Nothing fires while other code runs, because nothing
    ;; is running it -- which is the difference from the host's `setInterval`, and the reason the
    ;; primary names do not borrow its spelling.
    (console.log "--- scheduler ---")
    (let sc (ManualClock))
    (let sched (Scheduler sc))
    (mut log <- String[] [])

    (sched.every (ms 100) (fn [] -> Void (log.push f"tick@{(/ (sc.now) 1000000)}")))
    (sched.after (ms 250) (fn [] -> Void (log.push f"once@{(/ (sc.now) 1000000)}")))
    (sched.after (ms 350) (fn [] -> Void (
        (log.push f"stop@{(/ (sc.now) 1000000)}")
        (sched.stop))))
    (sched.run)
    (console.log "fired:  " log)
    (console.log "clock:  " (/ (sc.now) 1000000))
    ;; The repeating task is still live; the two one-shots retired themselves.
    (console.log "pending:" (sched.pending))

    ;; Two callbacks due at the same instant fire in REGISTRATION order -- the tie-break is the
    ;; handle, which is what makes a golden possible at all.
    (console.log "--- same instant ---")
    (let tc2 (ManualClock))
    (let s2 (Scheduler tc2))
    (mut order <- String[] [])
    (s2.after (ms 10) (fn [] -> Void (order.push "first")))
    (s2.after (ms 10) (fn [] -> Void (order.push "second")))
    (s2.after (ms 10) (fn [] -> Void (order.push "third")))
    (s2.run)
    (console.log "order:" order)

    ;; -- cancelling, through both spellings --------------------------------------------------------
    ;;
    ;; `set-interval`/`clear-interval` are aliases: one line each, calling `every`/`cancel`, so the
    ;; two names cannot come apart.
    (console.log "--- cancel ---")
    (let tc3 (ManualClock))
    (let s3 (Scheduler tc3))
    (mut hits <- Int 0)
    (let h (s3.set-interval (ms 10) (fn [] -> Void (hits := (+ hits 1)))))
    (tc3.advance (ms 35))
    (console.log "fired:    " (s3.pump))
    (console.log "cancel:   " (s3.clear-interval h))
    (console.log "again:    " (s3.clear-interval h))
    (tc3.advance (ms 100))
    (console.log "after cut:" (s3.pump))
    (console.log "hits:     " hits)

    ;; -- the real clock ----------------------------------------------------------------------------
    ;;
    ;; The only lines that cannot be exact. A sleep is a MINIMUM on both hosts -- 50ms asked, 55ms
    ;; measured -- so the assertion is a bound, not a value.
    (console.log "--- real clock ---")
    (let real (MonoClock))
    (let rw (Stopwatch real))
    (sleep-ms 20)
    (console.log "slept >= 20ms:  " (>= (rw.elapsed-ms) 20))
    (console.log "monotonic runs: " (> (now-ns) 0))
    (console.log "wall is Unix ms:" (> (epoch-ms) 1577836800000)))
