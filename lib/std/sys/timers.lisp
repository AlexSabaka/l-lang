;; std/sys/timers -- clocks, measurement, fixed-step pacing, and a driven scheduler.
;;
;; No import: `clock-ns` and `sleep-ns` are FLOOR names, ambient on both backends (D50), the same way
;; `file-open` and `write-string` are. Everything below is l-lang on top of those two.
;;
;; -----------------------------------------------------------------------------------------------
;; THE CLOCK OWNS SLEEPING, AND THAT IS THE WHOLE DESIGN.
;;
;; The obvious `Clock` is `(fn now [] -> Int)` and nothing else, with `Ticker` and `Scheduler` calling
;; the floor's `sleep-ns` directly. It does not work, and the failure is not subtle: a fake clock that
;; does not advance while a real sleep burns wall time means the next deadline is still in the past,
;; every time, forever. A `Ticker` on a fake clock would spin.
;;
;; So a clock is a pair -- READ THE TIME and WAIT -- because those are the same abstraction: both ask
;; "what does this timeline do next". `MonoClock` reads the OS and blocks on it; `ManualClock` reads a
;; field and advances that field. Every class here takes a `Clock`, so every one of them runs in
;; simulated time with no wall-clock dependency at all.
;;
;; That is what makes this module TESTABLE rather than smoke-tested. A timers module measured against
;; the real clock can assert `elapsed >= 0` and nothing else -- which is literally all
;; `10-modifiers/03_timing_modifier.lisp` asserts today, and it is not the module's fault: a duration
;; differs every run, so it cannot be a golden. Under `ManualClock` the scheduler's DISPATCH ORDER,
;; its repeat arithmetic, and its catch-up behaviour are all exactly reproducible, and only two lines
;; in the whole example need a real clock.
;;
;; -----------------------------------------------------------------------------------------------
;; THE SCHEDULER IS DRIVEN, NOT AMBIENT, AND THE NAMES SAY SO.
;;
;; `every`/`after` register work; `run` and `pump` are what execute it. Nothing fires while your own
;; code is running, because nothing is running it.
;;
;; That is a real difference from the host's `setInterval`, and it is forced rather than chosen: C has
;; no event loop, and giving it one means either POSIX signal timers -- the callback lands on a signal
;; stack, and this runtime is malloc-and-leak with no reentrancy guarantees -- or threads, which
;; require a memory model neither backend has. A driven scheduler needs neither and is the SAME l-lang
;; on both.
;;
;; `set-interval`/`clear-interval` exist beside `every`/`cancel` for anyone porting from JS. They are
;; aliases in the strict sense -- one line each, calling the primary spelling -- and the primary
;; spelling is the one whose name does not promise ambient firing.
;;
;; -----------------------------------------------------------------------------------------------
;; A CALLBACK TAKES NO ARGUMENTS, and that is currently forced too. `(call f args)` does not SPREAD:
;; it compiles to `f(args)`, handing the callback the argument vector as a single value. On JS that
;; can look right by coercion -- `(call double [21])` answers 42, because `[21] * 2` is 42 -- and on C
;; it traps honestly. Zero-argument callbacks are unaffected, which is the shape a timer wants
;; anyway; nothing here may grow an argument until that is fixed.
(
    ;; -- units -------------------------------------------------------------------------------------
    ;;
    ;; Nanoseconds is the language's time unit, because it is what both hosts hand back and what D51's
    ;; int64 Int holds natively (~292 years). These four are the readable way to write one: `(ms 16)`
    ;; rather than 16000000. They are l-lang and not floor entries on purpose -- four primitives that
    ;; differ by a multiplier are four places two backends can drift.

    (fn ns [n <- Int] -> Int (return n))
    (fn us [n <- Int] -> Int (return (* n 1000)))
    (fn ms [n <- Int] -> Int (return (* n 1000000)))
    (fn s [n <- Int] -> Int (return (* n 1000000000)))

    ;; -- reading the clocks ------------------------------------------------------------------------
    ;;
    ;; Two clocks, never one name. MONOTONIC is for durations: it has an arbitrary epoch, never steps
    ;; backwards, and is only ever subtracted. WALL is for timestamps: it is Unix-epoch and can step
    ;; backwards under NTP, so a duration measured with it can come out negative.

    (fn now-ns [] -> Int (return (clock-ns "mono")))
    (fn now-ms [] -> Int (return (/ (clock-ns "mono") 1000000)))
    (fn epoch-ns [] -> Int (return (clock-ns "wall")))
    (fn epoch-ms [] -> Int (return (/ (clock-ns "wall") 1000000)))

    ;; -- sleeping ----------------------------------------------------------------------------------
    ;;
    ;; A MINIMUM, never an interval: the OS decides when it is done, and both hosts overshoot (50ms
    ;; asked, 55ms measured on node). Anything pacing itself must re-read the clock afterwards rather
    ;; than assume the sleep was exact -- which is what `Ticker` does.
    ;;
    ;; `sleep-ns` itself is not redefined here: it is the ambient floor name, and shadowing it with a
    ;; library function of the same name is exactly the trap `std/io/stream` avoids with `file-write`.

    (fn sleep-us [n <- Int] -> Void (sleep-ns (* n 1000)))
    (fn sleep-ms [n <- Int] -> Void (sleep-ns (* n 1000000)))
    (fn sleep-s [n <- Int] -> Void (sleep-ns (* n 1000000000)))

    ;; -- clocks as values --------------------------------------------------------------------------

    ;; A timeline: what time is it, and wait this long. See the header for why those are one thing.
    (definterface Clock
        (fn now [] -> Int)
        (fn sleep [d <- Int] -> Void))

    ;; The real monotonic clock. The one to measure with.
    (defclass MonoClock :implements Clock
        (fn now [] -> Int (return (clock-ns "mono")))
        (fn sleep [d <- Int] -> Void (sleep-ns d)))

    ;; The real wall clock. `sleep` is still a real sleep -- waiting is waiting; only the reading
    ;; differs -- but pacing anything off this is a mistake, because it can step backwards.
    (defclass WallClock :implements Clock
        (fn now [] -> Int (return (clock-ns "wall")))
        (fn sleep [d <- Int] -> Void (sleep-ns d)))

    ;; A clock you drive. `sleep` advances it instead of waiting, so simulated time passes exactly as
    ;; asked and a schedule becomes reproducible.
    (defclass ManualClock :implements Clock
        (mut t <- Int 0)
        (fn now [] -> Int (return this.t))
        (fn sleep [d <- Int] -> Void (if (> d 0) (this.t := (+ this.t d))))
        (fn advance [d <- Int] -> Void (this.t := (+ this.t d)))
        (fn set-to [v <- Int] -> Void (this.t := v)))

    ;; -- measuring ---------------------------------------------------------------------------------

    ;; Elapsed time since `start`. Constructed already running, so the common case is one line.
    (defclass Stopwatch
        (let :ctor clock <- Clock)
        (mut since <- Int 0)
        (fn :ctor init [] -> Void (this.start))
        (fn start [] -> Void (
            (let c this.clock)
            (this.since := (c.now))
        ))
        (fn elapsed-ns [] -> Int (
            (let c this.clock)
            (return (- (c.now) this.since))
        ))
        (fn elapsed-us [] -> Int (return (/ (this.elapsed-ns) 1000)))
        (fn elapsed-ms [] -> Int (return (/ (this.elapsed-ns) 1000000)))
        (fn reset [] -> Void (this.start)))

    ;; -- fixed-step pacing -------------------------------------------------------------------------
    ;;
    ;; A game loop wants "run this at 30Hz", and the naive spelling -- do the work, sleep the period --
    ;; drifts: the period does not include the work, so every frame is late by however long the frame
    ;; took, and the error accumulates. `Ticker` paces against ABSOLUTE deadlines instead, so a slow
    ;; frame is absorbed rather than compounded.
    ;;
    ;; `tick` answers the real elapsed time since the previous tick -- the `dt` a simulation should
    ;; integrate with -- and `lag` reports how late the deadline was met, which is the honest signal
    ;; that the loop cannot keep up.
    ;;
    ;; A deadline missed by more than one whole period is RESET rather than chased. Chasing is the
    ;; classic spiral of death: after a long stall the loop owes N frames, runs them back to back with
    ;; no sleeping, falls further behind doing so, and never recovers.
    (defclass Ticker
        (let :ctor clock <- Clock)
        (let :ctor period <- Int)
        (mut due <- Int 0)
        (mut last <- Int 0)
        (mut lag-ns <- Int 0)
        (fn :ctor init [] -> Void (
            (let c this.clock)
            (let n (c.now))
            (this.last := n)
            (this.due := (+ n this.period))
        ))
        ;; Wait for the next deadline; answer the nanoseconds actually elapsed since the last tick.
        (fn tick [] -> Int (
            (let c this.clock)
            (let before (c.now))
            (if (< before this.due) (c.sleep (- this.due before)))
            (let now (c.now))
            (let dt (- now this.last))
            (this.lag-ns := (- now this.due))
            (this.last := now)
            (this.due := (+ this.due this.period))
            (if (> this.lag-ns this.period) (this.due := (+ now this.period)))
            (return dt)
        ))
        ;; How late the last deadline was met, in nanoseconds. Zero or negative means on time.
        (fn lag [] -> Int (return this.lag-ns)))

    ;; A ticker running at `hz` steps per second.
    (fn ticker-hz [clock <- Clock hz <- Int] -> Ticker
        (return (Ticker clock (/ 1000000000 hz))))

    ;; -- the driven scheduler ----------------------------------------------------------------------

    ;; One registered callback. `period` of 0 is a one-shot.
    (defclass Task
        (mut :ctor id <- Int)
        (mut :ctor due <- Int)
        (mut :ctor period <- Int)
        (mut :ctor action <- Any)
        (mut live <- Boolean #t))

    (defclass Scheduler
        (let :ctor clock <- Clock)
        (mut tasks <- Task[] [])
        (mut seq <- Int 0)
        (mut going <- Boolean #f)

        ;; Run `action` every `period` nanoseconds, starting one period from now. Answers a handle.
        (fn every [period <- Int action <- Any] -> Int (
            (let c this.clock)
            (this.seq := (+ this.seq 1))
            (this.tasks.push (Task this.seq (+ (c.now) period) period action))
            (return this.seq)
        ))

        ;; Run `action` once, `delay` nanoseconds from now. Answers a handle.
        (fn after [delay <- Int action <- Any] -> Int (
            (let c this.clock)
            (this.seq := (+ this.seq 1))
            (this.tasks.push (Task this.seq (+ (c.now) delay) 0 action))
            (return this.seq)
        ))

        ;; Retire a handle. Answers whether it was live.
        (fn cancel [id <- Int] -> Boolean (
            (mut hit <- Boolean #f)
            (for :each t :from this.tasks :then (
                (if (== t.id id) (if t.live ((t.live := #f) (hit := #t))))
            ))
            (return hit)
        ))

        ;; The earliest deadline among live tasks, or -1 when there are none.
        (fn next-due [] -> Int (
            (mut best <- Int -1)
            (for :each t :from this.tasks :then (
                (if t.live (if (or (< best 0) (< t.due best)) (best := t.due)))
            ))
            (return best)
        ))

        (fn pending [] -> Int (
            (mut n <- Int 0)
            (for :each t :from this.tasks :then ((if t.live (n := (+ n 1)))))
            (return n)
        ))

        ;; Fire everything already due, EARLIEST FIRST, and answer how many fired.
        ;;
        ;; Selection rather than a sort, and not for performance: `sort` is not available on the C
        ;; backend. Ties break on `id`, i.e. registration order, so two callbacks due at the same
        ;; instant fire in the order they were registered -- deterministic, which is what makes a
        ;; golden possible.
        ;;
        ;; A repeating task's next deadline is computed from its OWN due time, not from `now`, so a
        ;; late pump does not push the whole schedule later. If it has fallen more than a period
        ;; behind it is re-based on `now` instead -- the same anti-spiral rule as `Ticker`.
        (fn pump [] -> Int (
            (let c this.clock)
            (let now (c.now))
            (mut fired <- Int 0)
            (mut more <- Boolean #t)
            (while more (
                (mut pick <- Task? nil)
                (for :each t :from this.tasks :then (
                    (if (and t.live (<= t.due now)) (
                        (if (== pick nil) (pick := t)
                            (if (< t.due pick.due) (pick := t)))
                    ))
                ))
                (if (== pick nil) (more := #f)
                    (
                        (if (> pick.period 0)
                            (
                                (pick.due := (+ pick.due pick.period))
                                (if (<= pick.due now) (pick.due := (+ now pick.period)))
                            )
                            (pick.live := #f))
                        (fired := (+ fired 1))
                        (let f pick.action)
                        (call f [])
                    ))
            ))
            (this.prune)
            (return fired)
        ))

        ;; Drive until nothing is left or `stop` is called. Sleeps to each deadline through the clock,
        ;; so under a `ManualClock` this runs the whole schedule instantly and deterministically.
        (fn run [] -> Void (
            (let c this.clock)
            (this.going := #t)
            (while this.going (
                (let due (this.next-due))
                (if (< due 0) (this.going := #f)
                    (
                        (let now (c.now))
                        (if (> due now) (c.sleep (- due now)))
                        (this.pump)
                    ))
            ))
        ))

        ;; Stop `run` after the current pass. Registered work is left alone.
        (fn stop [] -> Void (this.going := #f))

        ;; Drop retired tasks, so a long-lived scheduler does not grow without bound.
        (fn prune [] -> Void (
            (mut keep <- Task[] [])
            (for :each t :from this.tasks :then ((if t.live (keep.push t))))
            (this.tasks := keep)
        ))

        ;; -- host-shaped aliases -------------------------------------------------------------------
        ;;
        ;; For porting. One line each, and they call the primary spelling rather than reimplementing
        ;; it, so the two names cannot come apart. The primary spelling stays the one that does not
        ;; promise the callback fires while your own code runs -- it does not; `run` fires it.
        (fn set-interval [period <- Int action <- Any] -> Int (return (this.every period action)))
        (fn set-timeout [delay <- Int action <- Any] -> Int (return (this.after delay action)))
        (fn clear-interval [id <- Int] -> Boolean (return (this.cancel id)))
        (fn clear-timeout [id <- Int] -> Boolean (return (this.cancel id))))

    (export
        ns us ms s
        now-ns now-ms epoch-ns epoch-ms
        sleep-us sleep-ms sleep-s
        Clock MonoClock WallClock ManualClock
        Stopwatch Ticker ticker-hz
        Task Scheduler)
)
