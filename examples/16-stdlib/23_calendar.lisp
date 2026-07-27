;; std/time/calendar -- proleptic Gregorian civil time, UTC.
;;
;; `std/sys/timers` can tell you it is 1769472000000000000, and until now nothing in the language could
;; turn that into a date -- which is why `10-modifiers/03_timing_modifier` reached for `Date.now`.
;;
;; ZERO FLOOR ENTRIES. Every line is integer arithmetic over `clock-ns`, which the floor already
;; provides, so the calendar is portable by construction. The alternative -- binding `localtime_r` --
;; is the divergence risk D50 exists to refuse: machine-dependent output, and not goldenable.
;;
;; UTC ONLY. There is no time-zone type here, because a zone database is DATA that changes several
;; times a year, and a stale copy inside a compiler is worse than none.
(
    (import "std/time/calendar")
    (import "std/sys/timers")

    ;; -- the kernel --------------------------------------------------------------------------------
    ;;
    ;; Howard Hinnant's `days_from_civil` / `civil_from_days`: exact integer algorithms, no floating
    ;; point, correct for negative years. Day 0 is 1970-01-01, matching `clock-ns "wall"`.

    (console.log "epoch day:" (days-from-civil 1970 1 1))
    (console.log "2026-07-27:" (days-from-civil 2026 7 27))

    ;; -- leap years --------------------------------------------------------------------------------
    ;;
    ;; The century rule is the one everybody's hand-rolled version gets wrong: 2000 IS a leap year and
    ;; 1900 is NOT, because divisible-by-400 overrides divisible-by-100.

    (console.log "2000:" (is-leap-year 2000) "1900:" (is-leap-year 1900) "2024:" (is-leap-year 2024))
    (console.log "Feb 2024:" (days-in-month 2024 2) "Feb 2100:" (days-in-month 2100 2))

    ;; -- a date ------------------------------------------------------------------------------------
    ;;
    ;; `CivilDate`, not `Date` -- the ambient prelude already declares a JS host extern called `Date`,
    ;; and the compiler said so (WLL0240): resolution would have taken the HOST's, silently, depending
    ;; on module processing order. "Civil" is Hinnant's own word for a y/m/d with no zone attached.

    (let d (CivilDate 2026 7 27))
    (console.log "iso:" (d.to-iso))
    (console.log "weekday:" (d.weekday) (weekday-name (d.weekday)))
    (console.log "month:" (month-name d.month) "day of year:" (d.day-of-year))

    ;; -- THE BIJECTION -----------------------------------------------------------------------------
    ;;
    ;; `civil-from-days` is the exact inverse of `days-from-civil`, not an approximation. This asserts
    ;; it across a span that includes BOTH SIGNS, which is the part that matters: the algorithms lean
    ;; on integer division TRUNCATING toward zero (C99 and JS BigInt both do), and the `- 399` / `-
    ;; 146096` terms exist to make a truncating division behave like a flooring one on negatives.
    ;;
    ;; A shared wrong assumption about rounding is exactly what two agreeing backends cannot catch by
    ;; agreeing, so it is asserted rather than assumed.

    (mut ok <- Boolean #t)
    (mut z <- Int -800000)
    (while (< z 800000) (
        (let c (civil-from-days z))
        (if (!= (days-from-civil c[0] c[1] c[2]) z) (ok := #f))
        (z := (+ z 7919))
    ))
    (console.log "bijection over 202 sampled days, both signs:" ok)

    ;; -- pre-epoch and negative years --------------------------------------------------------------

    (console.log "day -1:" ((date-from-epoch-day -1).to-iso))
    (console.log "era base:" ((date-from-epoch-day -719468).to-iso))
    (console.log "year -1:" ((date-from-epoch-day (days-from-civil -1 12 31)).to-iso))

    ;; A negative year keeps its sign OUTSIDE the zero padding: `-0001`, not `000-1`.
    (console.log "negative year pads:" ((CivilDate -44 3 15).to-iso))

    ;; -- arithmetic --------------------------------------------------------------------------------

    (console.log "add 100 days:" ((d.add-days 100).to-iso))
    (console.log "back 100 days:" (((d.add-days 100).add-days -100).to-iso))

    ;; END-OF-MONTH CLAMPING, stated rather than discovered. 2026-01-31 plus one month is 2026-02-28,
    ;; because 2026-02-31 does not exist. The cost is that adding a month is NOT invertible, which is
    ;; true of every date library and worth seeing once.
    (console.log "Jan 31 + 1 month:" (((CivilDate 2026 1 31).add-months 1).to-iso))
    (console.log "and back again:  " ((((CivilDate 2026 1 31).add-months 1).add-months -1).to-iso))

    ;; Into a leap February, and out of one.
    (console.log "Jan 31 2024 + 1m:" (((CivilDate 2024 1 31).add-months 1).to-iso))
    (console.log "Feb 29 + 1 year: " (((CivilDate 2024 2 29).add-years 1).to-iso))

    (console.log "days between:" (days-between (CivilDate 2026 1 1) (CivilDate 2026 12 31)))

    ;; -- time of day -------------------------------------------------------------------------------
    ;;
    ;; Nanosecond resolution, the floor's own unit, so a round trip through `clock-ns` loses nothing.
    ;; The fraction is printed only when there is one -- a trailing `.000` on every timestamp is noise.

    (console.log "time:" ((CivilTime 12 34 56 0).to-iso))
    (console.log "with millis:" ((CivilTime 12 34 56 789000000).to-iso))

    ;; -- instants ----------------------------------------------------------------------------------
    ;;
    ;; The `Z` is not decoration: it asserts UTC. A bare ISO timestamp with no offset is the ambiguity
    ;; that makes date bugs immortal.

    (console.log "from ns:" ((from-epoch-ns 1769472000000000000).to-iso))

    ;; The round trip is EXACT past 2^53 -- nanoseconds since 1970 passed that in 1970 plus about four
    ;; months, so every real timestamp is above it and a calendar that went through a double would be
    ;; wrong for all of them.
    ;;
    ;; It is written through a `let` rather than chained, and that is not style. Chaining the method
    ;; directly onto the call -- `((from-epoch-ns N).to-epoch-ns)` -- answers ...788992 on the JS
    ;; backend and ...789000 on C: the JS emitter loses the Int type across that shape and rounds
    ;; through a double. C is the correct one. Recorded in D78; JS is oracle-only (D66) and is not
    ;; being fixed, so the corpus writes the form that is right on both.
    (let stamp (from-epoch-ns 1769472123456789000))
    (console.log "round trip ns:" (stamp.to-epoch-ns))

    ;; PRE-EPOCH INSTANTS need FLOORING division, and `/` truncates toward zero on both backends. Done
    ;; naively, a negative nanosecond count lands on the wrong day AND gets a negative time of day.
    (console.log "before epoch:" ((from-epoch-ns -1).to-iso))
    (console.log "one day before:" ((from-epoch-ns -86400000000000).to-iso))

    ;; -- reading the clock -------------------------------------------------------------------------
    ;;
    ;; `utc-now` takes a CLOCK rather than reading the wall clock itself, and that is what makes a
    ;; timestamp goldenable: under a `ManualClock` every stamped line is exactly reproducible. It is
    ;; the same argument `Ticker` and `Scheduler` are built on.

    (let clock (ManualClock))
    (clock.set-to 1769472000000000000)
    (console.log "manual clock:" ((utc-now clock).to-iso))
    (clock.advance (s 3661))
    (console.log "after 1h1m1s:" ((utc-now clock).to-iso))
    (console.log "today:" ((today clock).to-iso))

    ;; -- parsing -----------------------------------------------------------------------------------
    ;;
    ;; ISO-8601 extended, and only that. A permissive parser is how `01/02/03` becomes three different
    ;; dates in three countries.

    (console.log "parse date:" ((parse-iso-date "2026-07-27").to-iso))
    (console.log "parse negative:" ((parse-iso-date "-0044-03-15").to-iso))
    (console.log "parse instant:" ((parse-iso "2026-07-27T12:34:56Z").to-iso))
    (console.log "parse fraction:" ((parse-iso "2026-07-27T12:34:56.789Z").to-iso))

    ;; -- what is refused ---------------------------------------------------------------------------
    ;;
    ;; An impossible date is refused AT CONSTRUCTION. `days-from-civil` answers a number for month 13 --
    ;; the wrong one -- so a `CivilDate` that cannot exist would otherwise propagate silently through
    ;; arithmetic that happily accepts it.

    (try (CivilDate 2026 2 30) catch e (console.log "refused:" (e.message)))
    (try (CivilDate 2026 13 1) catch e (console.log "refused:" (e.message)))

    ;; An OFFSET is refused rather than ignored, because ignoring it silently shifts the instant.
    (try (parse-iso "2026-07-27T12:34:56+02:00") catch e (console.log "refused:" (e.message)))
)
