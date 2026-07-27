;; std/time/calendar -- proleptic Gregorian civil time, UTC.
;;
;; `std/sys/timers` can tell you it is 1769472000000000000. Nothing in the language could turn that
;; into a date, which is why `10-modifiers/03_timing_modifier` reached for `Date.now` and why the two
;; CLI scratchpads in ../l-lang-codewars have no timestamps in them at all.
;;
;; ZERO FLOOR ENTRIES. Every line here is integer arithmetic over `clock-ns`, which the floor already
;; provides (D50) -- so this is the shape D50 asks for: the irreducible part is "ask the host what
;; time it is", and the calendar on top of it is portable by construction. A `localtime_r` binding
;; would have been the other design and it is exactly the divergence risk D50 exists to refuse:
;; machine-dependent output, not goldenable, and different on two hosts by definition.
;;
;; ------------------------------------------------------------------------------------------------
;; UTC ONLY, STATED RATHER THAN IMPLIED.
;;
;; There is no local time here and no time-zone type. A zone database is DATA -- tzdata is a few
;; hundred kilobytes that changes several times a year because governments change their minds -- and
;; shipping a stale copy inside a compiler is worse than not having one. Anything needing a local
;; rendering takes an OFFSET from the caller, who knows something this library cannot.
;;
;; The consequence to keep in mind: `(utc-now clock)` is UTC, so it will not agree with the wall clock
;; on the wall unless you are in Britain in winter. That is the honest answer, and a silent
;; almost-right one would be worse.
;;
;; ------------------------------------------------------------------------------------------------
;; THE KERNEL IS HOWARD HINNANT'S `days_from_civil` / `civil_from_days` (public domain,
;; http://howardhinnant.github.io/date_algorithms.html), which are exact integer algorithms over the
;; proleptic Gregorian calendar with no floating point anywhere. Two properties earn them their place:
;;
;;   * They are correct for NEGATIVE years and pre-epoch days, which the naive
;;     "days = 365*y + y/4 - y/100 + y/400" is not. The era arithmetic (`y - 399` before dividing) is
;;     there precisely to make a TRUNCATING division behave like a flooring one on negatives, which is
;;     what both backends give -- C99 truncates toward zero, and so does JS BigInt.
;;   * They are a bijection. `civil-from-days` is the exact inverse of `days-from-civil`, so a date
;;     round-trips rather than approximately round-tripping, and the example asserts that across a
;;     span that includes both signs.
;;
;; That the two backends agree on truncation is ASSERTED, not assumed -- `23_calendar.lisp` pins
;; pre-epoch and negative-year dates specifically. A shared wrong assumption about rounding is exactly
;; the class of bug two agreeing backends cannot catch by agreeing.
;;
;; Day 0 is 1970-01-01, the Unix epoch, matching `clock-ns "wall"`. Weekday 0 is SUNDAY -- the
;; convention `strftime %w` and JS `getDay` both use.
(
    (import "std/core/string")
    (import "std/core/errors")
    (import "std/core/builder")

    ;; ==============================================================================================
    ;; THE KERNEL
    ;; ==============================================================================================

    (fn is-leap-year [y <- Int] -> Boolean (
        (if (!= (% y 4) 0) (return #f))
        (if (!= (% y 100) 0) (return #t))
        (return (== (% y 400) 0))
    ))

    (fn days-in-month [y <- Int m <- Int] -> Int (
        (cond
            ((== m 2) (if (is-leap-year y) (return 29) (return 28)))
            ((== m 4) (return 30))
            ((== m 6) (return 30))
            ((== m 9) (return 30))
            ((== m 11) (return 30))
            (:else (return 31))
        )
    ))

    ;; Days since 1970-01-01 for a proleptic Gregorian y/m/d. Exact for every year, either sign.
    (fn days-from-civil [year <- Int m <- Int d <- Int] -> Int (
        ;; March-based year: putting the leap day LAST removes the special case from every line below.
        (mut y year)
        (if (<= m 2) (y := (- y 1)))
        ;; `- 399` before dividing is what makes a truncating division floor for negative years. Drop
        ;; it and every date before year 0 lands in the wrong era, silently.
        (let era (/ (if (>= y 0) y (- y 399)) 400))
        (let yoe (- y (* era 400)))                                    ;; [0, 399]
        (let doy (+ (/ (+ (* 153 (+ m (if (> m 2) -3 9))) 2) 5) (- d 1)))   ;; [0, 365]
        (let doe (+ (- (+ (* yoe 365) (/ yoe 4)) (/ yoe 100)) doy))    ;; [0, 146096]
        (return (- (+ (* era 146097) doe) 719468))
    ))

    ;; The exact inverse: a day number back to [year month day].
    (fn civil-from-days [day <- Int] -> Int[] (
        (let z (+ day 719468))
        (let era (/ (if (>= z 0) z (- z 146096)) 146097))
        (let doe (- z (* era 146097)))                                 ;; [0, 146096]
        (let yoe (/ (+ (- (- doe (/ doe 1460)) (- (/ doe 36524) (/ doe 146096))) 0) 365))
        (let y (+ yoe (* era 400)))
        (let doy (- doe (- (+ (* 365 yoe) (/ yoe 4)) (/ yoe 100))))    ;; [0, 365]
        (let mp (/ (+ (* 5 doy) 2) 153))                               ;; [0, 11]
        (let d (+ (- doy (/ (+ (* 153 mp) 2) 5)) 1))                   ;; [1, 31]
        (let m (+ mp (if (< mp 10) 3 -9)))                             ;; [1, 12]
        (return [(if (<= m 2) (+ y 1) y) m d])
    ))

    ;; 0 = Sunday. The `+ 4` is because 1970-01-01 was a Thursday; the negative arm keeps the result
    ;; in [0, 6] where a truncating `%` would otherwise answer negative.
    (fn weekday-from-days [z <- Int] -> Int (
        (if (>= z -4) (return (% (+ z 4) 7)))
        (return (+ (% (+ z 5) 7) 6))
    ))

    (fn weekday-name [w <- Int] -> String (
        (let names ["Sunday" "Monday" "Tuesday" "Wednesday" "Thursday" "Friday" "Saturday"])
        (if (or (< w 0) (> w 6)) (throw (ValueError "weekday-name: a weekday is 0..6")))
        (return names[w])
    ))

    (fn month-name [m <- Int] -> String (
        (let names ["January" "February" "March" "April" "May" "June"
                    "July" "August" "September" "October" "November" "December"])
        (if (or (< m 1) (> m 12)) (throw (ValueError "month-name: a month is 1..12")))
        (return names[(- m 1)])
    ))

    ;; ==============================================================================================
    ;; RENDERING HELPERS
    ;; ==============================================================================================

    ;; Zero-padded, and NEGATIVE-AWARE: `pad-start` on "-7" would give "0-7". ISO-8601 writes a
    ;; negative year with the sign in front of the padded digits.
    (fn pad-num [n <- Int width <- Int] -> String (
        (if (< n 0) (return (+ "-" (pad-start (+ "" (- 0 n)) width "0"))))
        (return (pad-start (+ "" n) width "0"))
    ))

    ;; ==============================================================================================
    ;; VALUES
    ;; ==============================================================================================

    ;; A civil date. Validated on construction: an out-of-range field is a bug at the point it is
    ;; written, and a `CivilDate` that cannot exist would otherwise propagate silently through arithmetic
    ;; that happily accepts it (`days-from-civil` answers a number for month 13 -- the wrong one).
    (defclass CivilDate
        (let :ctor year <- Int)
        (let :ctor month <- Int)
        (let :ctor day <- Int)

        (fn :ctor validate [] -> Void (
            (if (or (< this.month 1) (> this.month 12))
                (throw (ValueError (+ "CivilDate: month is 1..12, got " (+ "" this.month)))))
            (if (or (< this.day 1) (> this.day (days-in-month this.year this.month)))
                (throw (ValueError (+ (+ "CivilDate: day is out of range for that month: " (+ "" this.day))
                                      (+ " in month " (+ "" this.month))))))
        ))

        ;; Days since the Unix epoch. The single number every other operation goes through.
        (fn epoch-day [] -> Int (return (days-from-civil this.year this.month this.day)))

        ;; NO `weekday-name`/`month-name` METHODS, and that is forced rather than a trim. A method
        ;; whose body calls the free function of the same name does not resolve to it -- the free name
        ;; is not in method scope, so it emits a call to a symbol that does not exist there and dies at
        ;; run time. The free functions are the API: `(weekday-name (d.weekday))`.
        (fn weekday [] -> Int (return (weekday-from-days (this.epoch-day))))

        ;; 1..366.
        (fn day-of-year [] -> Int (
            (return (+ (- (this.epoch-day) (days-from-civil this.year 1 1)) 1))
        ))

        (fn is-leap [] -> Boolean (return (is-leap-year this.year)))

        ;; ISO-8601 `YYYY-MM-DD`.
        (fn to-iso [] -> String (
            (let sb (StringBuilder))
            (sb.append (pad-num this.year 4))
            (sb.append "-")
            (sb.append (pad-num this.month 2))
            (sb.append "-")
            (sb.append (pad-num this.day 2))
            (return (sb.to-string))
        ))

        (fn add-days [n <- Int] -> CivilDate (return (date-from-epoch-day (+ (this.epoch-day) n))))

        ;; Calendar-month arithmetic, with END-OF-MONTH CLAMPING stated rather than discovered:
        ;; 2026-01-31 plus one month is 2026-02-28, because 2026-02-31 does not exist. Every date
        ;; library has to pick, and clamping is what makes "the last of next month" work; the cost is
        ;; that adding a month is NOT invertible (subtracting one from 2026-02-28 gives 2026-01-28).
        (fn add-months [n <- Int] -> CivilDate (
            (let total (+ (+ (* this.year 12) (- this.month 1)) n))
            ;; Flooring division and modulus, spelled for a TRUNCATING `/` -- `total` goes negative
            ;; for years before 0, and `(/ -1 12)` is 0 here, not -1.
            (mut y (/ total 12))
            (mut m (+ (% total 12) 1))
            (if (< m 1) ((y := (- y 1)) (m := (+ m 12))))
            (let dim (days-in-month y m))
            (return (CivilDate y m (if (> this.day dim) dim this.day)))
        ))

        (fn add-years [n <- Int] -> CivilDate (return (this.add-months (* n 12))))

        ;; Negative if this is earlier. Comparable's shape (D63) as a plain method -- `(x :of Iface)`
        ;; answers false on both backends today, so declaring `:implements` would buy nothing.
        (fn compare-to [other <- CivilDate] -> Int (
            (let a (this.epoch-day))
            (let b (other.epoch-day))
            (if (< a b) (return -1))
            (if (> a b) (return 1))
            (return 0)
        ))

        (fn format [] -> String (return (this.to-iso)))
    )

    ;; A time of day. Nanosecond resolution, matching the floor's unit -- so a `CivilDateTime` loses nothing
    ;; converting to and from `clock-ns`.
    (defclass CivilTime
        (let :ctor hour <- Int)
        (let :ctor minute <- Int)
        (let :ctor second <- Int)
        (let :ctor nanosecond <- Int)

        (fn :ctor validate [] -> Void (
            (if (or (< this.hour 0) (> this.hour 23))
                (throw (ValueError (+ "CivilTime: hour is 0..23, got " (+ "" this.hour)))))
            (if (or (< this.minute 0) (> this.minute 59))
                (throw (ValueError (+ "CivilTime: minute is 0..59, got " (+ "" this.minute)))))
            ;; 60 IS ALLOWED: a leap second is a real value a timestamp can carry. Nothing here
            ;; computes with it -- `nanos-of-day` counts it as second 60 -- and refusing it would make
            ;; the parser reject valid ISO input.
            (if (or (< this.second 0) (> this.second 60))
                (throw (ValueError (+ "CivilTime: second is 0..60, got " (+ "" this.second)))))
            (if (or (< this.nanosecond 0) (> this.nanosecond 999999999))
                (throw (ValueError "CivilTime: nanosecond is 0..999999999")))
        ))

        (fn nanos-of-day [] -> Int (
            (return (+ (* (+ (* (+ (* this.hour 60) this.minute) 60) this.second) 1000000000)
                       this.nanosecond))
        ))

        ;; `HH:MM:SS`, with `.fff` only when there is a fraction to show -- a trailing `.000` on every
        ;; timestamp is noise, and ISO-8601 makes the fraction optional.
        (fn to-iso [] -> String (
            (let sb (StringBuilder))
            (sb.append (pad-num this.hour 2))
            (sb.append ":")
            (sb.append (pad-num this.minute 2))
            (sb.append ":")
            (sb.append (pad-num this.second 2))
            (when (> this.nanosecond 0) :then (
                (sb.append ".")
                (sb.append (pad-num (/ this.nanosecond 1000000) 3))
            ))
            (return (sb.to-string))
        ))

        (fn format [] -> String (return (this.to-iso)))
    )

    (defclass CivilDateTime
        (let :ctor date <- CivilDate)
        (let :ctor time <- CivilTime)

        (fn to-epoch-ns [] -> Int (
            (let d this.date)
            (let t this.time)
            (return (+ (* (d.epoch-day) 86400000000000) (t.nanos-of-day)))
        ))

        ;; `YYYY-MM-DDTHH:MM:SSZ`. The `Z` is not decoration -- it is the assertion that this is UTC,
        ;; and a bare ISO timestamp with no offset is the ambiguity that makes date bugs immortal.
        (fn to-iso [] -> String (
            (let d this.date)
            (let t this.time)
            (return (+ (+ (d.to-iso) (+ "T" (t.to-iso))) "Z"))
        ))

        (fn format [] -> String (return (this.to-iso)))

        (fn compare-to [other <- CivilDateTime] -> Int (
            (let a (this.to-epoch-ns))
            (let b (other.to-epoch-ns))
            (if (< a b) (return -1))
            (if (> a b) (return 1))
            (return 0)
        ))
    )

    ;; ==============================================================================================
    ;; CONSTRUCTION
    ;; ==============================================================================================

    (fn date-from-epoch-day [z <- Int] -> CivilDate (
        (let c (civil-from-days z))
        (return (CivilDate c[0] c[1] c[2]))
    ))

    ;; Nanoseconds since the epoch to a UTC date-time. FLOORING division and modulus, spelled out:
    ;; `/` truncates toward zero on both backends, so a pre-epoch (negative) instant would otherwise
    ;; land on the wrong day and get a negative time of day. Every timestamp before 1970 hits this.
    (fn from-epoch-ns [ns <- Int] -> CivilDateTime (
        (let day-ns 86400000000000)
        (mut day (/ ns day-ns))
        (mut rem (% ns day-ns))
        (if (< rem 0) ((day := (- day 1)) (rem := (+ rem day-ns))))
        (let secs (/ rem 1000000000))
        (return (CivilDateTime (date-from-epoch-day day)
                          (CivilTime (/ secs 3600) (% (/ secs 60) 60) (% secs 60) (% rem 1000000000))))
    ))

    (fn from-epoch-ms [ms <- Int] -> CivilDateTime (return (from-epoch-ns (* ms 1000000))))

    ;; The clock bridge. It takes a `Clock` rather than reading the wall clock itself, which is what
    ;; makes a timestamp GOLDENABLE: under a `ManualClock` (std/sys/timers) every line of a program
    ;; that stamps its output is exactly reproducible. The same argument `Ticker` and `Scheduler` are
    ;; built on, and the reason `std/log` can have an exact golden at all.
    (fn utc-now [clock <- Any] -> CivilDateTime (return (from-epoch-ns (clock.now))))

    (fn today [clock <- Any] -> CivilDate (
        (let dt (utc-now clock))
        (return dt.date)
    ))

    (fn days-between [a <- CivilDate b <- CivilDate] -> Int (return (- (b.epoch-day) (a.epoch-day))))

    ;; ==============================================================================================
    ;; PARSING
    ;; ==============================================================================================

    ;; `YYYY-MM-DD`, and only that. A permissive date parser is how `01/02/03` becomes three different
    ;; dates in three countries; ISO-8601 extended format is unambiguous, so it is the only one taken.
    (fn parse-iso-date [s <- String] -> CivilDate (
        (let parts (split s "-"))
        ;; A leading `-` on a negative year splits into an empty first part.
        (if (== parts.length 4) (
            (let y (parse-int (+ "-" parts[1])))
            (let m (parse-int parts[2]))
            (let d (parse-int parts[3]))
            (if (or (== y nil) (or (== m nil) (== d nil)))
                (throw (ValueError (+ "parse-iso-date: not a date: " s))))
            (return (CivilDate y m d))
        ))
        (if (!= parts.length 3)
            (throw (ValueError (+ "parse-iso-date: expected YYYY-MM-DD, got " s))))
        (let y (parse-int parts[0]))
        (let m (parse-int parts[1]))
        (let d (parse-int parts[2]))
        (if (or (== y nil) (or (== m nil) (== d nil)))
            (throw (ValueError (+ "parse-iso-date: not a date: " s))))
        (return (CivilDate y m d))
    ))

    ;; `HH:MM:SS` or `HH:MM:SS.fff`.
    (fn parse-iso-time [s <- String] -> CivilTime (
        (let parts (split s ":"))
        (if (!= parts.length 3)
            (throw (ValueError (+ "parse-iso-time: expected HH:MM:SS, got " s))))
        (let h (parse-int parts[0]))
        (let mi (parse-int parts[1]))
        (let sec-parts (split parts[2] "."))
        (let sec (parse-int sec-parts[0]))
        (mut nanos <- Int 0)
        (when (> sec-parts.length 1) :then (
            (let frac (parse-int (pad-end sec-parts[1] 9 "0")))
            (if (== frac nil) (throw (ValueError (+ "parse-iso-time: bad fraction in " s))))
            (nanos := frac)
        ))
        (if (or (== h nil) (or (== mi nil) (== sec nil)))
            (throw (ValueError (+ "parse-iso-time: not a time: " s))))
        (return (CivilTime h mi sec nanos))
    ))

    ;; `YYYY-MM-DDTHH:MM:SS[.fff][Z]`. A trailing `Z` is accepted and required to mean UTC; an OFFSET
    ;; (`+02:00`) is refused rather than ignored, because ignoring it silently shifts the instant.
    (fn parse-iso [s <- String] -> CivilDateTime (
        (let parts (split s "T"))
        (if (!= parts.length 2)
            (throw (ValueError (+ "parse-iso: expected YYYY-MM-DDTHH:MM:SS, got " s))))
        (mut tail parts[1])
        (if (ends-with tail "Z") (tail := (substr tail 0 (- (strlen tail) 1))))
        (if (or (contains tail "+") (contains tail "-"))
            (throw (ValueError (+ "parse-iso: a UTC offset is not supported (this calendar is UTC only): " s))))
        (return (CivilDateTime (parse-iso-date parts[0]) (parse-iso-time tail)))
    ))

    (export
        is-leap-year days-in-month days-from-civil civil-from-days weekday-from-days
        weekday-name month-name
        CivilDate CivilTime CivilDateTime
        date-from-epoch-day from-epoch-ns from-epoch-ms utc-now today days-between
        parse-iso-date parse-iso-time parse-iso)
)
