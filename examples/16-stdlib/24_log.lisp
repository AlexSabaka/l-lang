;; std/log -- structured logging.
;;
;; Every line here runs on a `ManualClock`, and that is the point rather than a convenience. A log line
;; carries a timestamp, so a logging module measured against the real clock can assert that output was
;; PRODUCED and nothing about what it said. Under a manual clock the timestamps are exact and a
;; transcript is a golden -- the same argument `std/sys/timers` makes for `Ticker`, and the one
;; `std/math/random` states as "seeded determinism IS the API".
;;
;; The second half of that is `MemorySink`, which keeps events instead of printing them, so assertions
;; are about the EVENTS -- their count, their level, their properties -- rather than scraped stdout.
(
    (import "std/log")
    (import "std/sys/timers")

    (let clock (ManualClock))
    (clock.set-to 1769472000000000000)          ;; 2026-01-27T00:00:00Z

    ;; -- levels ------------------------------------------------------------------------------------
    ;;
    ;; A `defenum` with NO explicit values, so members fold to ordinals 0..5 and `>=` filtering is
    ;; ordinary integer comparison. Giving one member an explicit value would be a trap: a member
    ;; FOLLOWING an explicit one takes its ordinal rather than predecessor+1.

    (console.log "levels:" Level:trace Level:debug Level:info Level:warn Level:error Level:fatal)
    (console.log "names:" (level-name Level:info) (level-name Level:fatal))

    ;; -- an event is a NAME plus PROPERTIES ---------------------------------------------------------
    ;;
    ;; No message templates. Serilog's `"User {Name} logged in"` is a second string language -- a
    ;; parser, an escaping rule, and a holes-vs-arguments mismatch catchable only at run time. l-lang
    ;; already has interpolation that is checked at COMPILE time, so a template parser here would be a
    ;; worse duplicate. The event NAME is what you grep and alert on; the properties stay structured
    ;; all the way to the sink.

    (let mem (MemorySink))
    (let log (Logger clock mem))

    (log.info "cache.miss" { :key "product:42" :tier "memory" })
    (clock.advance (ms 250))
    (log.warn "payment.retrying" { :attempt 2 :reason "timeout" })

    (console.log "events:" (mem.count))
    (for :each line :from (mem.lines) :then (console.log line))

    ;; Values render through `to-json`, so a String is QUOTED and a container keeps its shape.
    ;; `display` renders `hello` and `"hello"` identically, which is the ambiguity that makes a log
    ;; line unparseable exactly when you need to parse it.
    (mem.clear)
    (log.info "types" { :s "text" :n 42 :r 1.5 :b #t :nothing nil :xs [1 2] })
    (let typed (mem.lines))
    (console.log typed[0])

    ;; -- context, and why it is not mutation -------------------------------------------------------
    ;;
    ;; `with` answers a NEW logger. A child adding a request id must not add it to its parent, which is
    ;; the bug every hand-rolled version of this has -- and it only shows up once two requests are in
    ;; flight, i.e. never in testing.

    (mem.clear)
    (let base (log.with "service" "checkout"))
    (let req (base.with "request-id" "req-7"))
    (req.info "request.started" { :path "/pay" })
    (base.info "unrelated" {})
    (for :each line :from (mem.lines) :then (console.log line))

    ;; An event property WINS over context on a collision -- the specific beats the general, and the
    ;; alternative would let a logger-wide field silently mask a call site's own.
    (mem.clear)
    (req.info "override" { :service "billing" })
    (let overridden (mem.lines))
    (console.log overridden[0])

    ;; -- filtering ---------------------------------------------------------------------------------
    ;;
    ;; Checked BEFORE the merge and the render, so a suppressed event costs one integer comparison.

    (mem.clear)
    (log.set-min-level Level:warn)
    (log.debug "dropped" {})
    (log.info "also dropped" {})
    (log.error "kept" { :code 500 })
    (console.log "after filtering:" (mem.count))
    (console.log "enabled trace?" (log.is-enabled Level:trace) "error?" (log.is-enabled Level:error))
    (log.set-min-level Level:trace)

    ;; -- the JSON sink -----------------------------------------------------------------------------
    ;;
    ;; The same event, rendered for something that ingests logs rather than reads them. Rendering is
    ;; the SINK's choice, which is why the event keeps its properties structured rather than
    ;; formatting at the call site.

    (mem.clear)
    (let j (Logger clock (JsonSink)))
    (j.info "order.placed" { :id 4210 :total 99.5 })

    ;; -- A LOGGING DECORATOR -----------------------------------------------------------------------
    ;;
    ;; The reason to do this now: `defmodifier` unfolds statically on C since D75-d, so a decorator is
    ;; two ordinary functions rather than a composed value, and this runs on the supported backend.
    ;;
    ;; It is the D75 FLAT contract -- one lambda, `original` first -- and it has no decoration-time
    ;; SETUP, which matters because setup hoisting is still refused on C.
    ;;
    ;; THE WRAPPER CALLS A TOP-LEVEL FUNCTION rather than reaching the logger directly, and that is
    ;; forced. The static unfold lifts the wrapper body into a top-level C function, and a module-level
    ;; `let` is NOT in scope there -- writing `(audit.info ...)` inside the wrapper emits a reference to
    ;; `u_audit`, which no declaration produces, and the C compiler rejects it. A top-level FUNCTION is
    ;; visible from the lifted body and can reach the module global itself, so one level of indirection
    ;; is the whole fix. Worth knowing before writing any decorator that touches module state.

    (mem.clear)
    (let audit (Logger clock mem))

    (fn audit-info [name <- String props <- Any] -> Void (audit.info name props))

    (defmodifier logged []
        (fn [original ...args]
            (audit-info "call.entered" { :args args })
            (let result (original ...args))
            (audit-info "call.returned" { :result result })
            result))

    (fn :logged charge [amount <- Int] -> Int (return (* amount 2)))

    (console.log "result:" (charge 21))
    (for :each line :from (mem.lines) :then (console.log line))
)
