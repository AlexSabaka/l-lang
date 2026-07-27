;; std/log -- structured logging.
;;
;; Adapted from `logger_poc.lisp` in ../l-lang-codewars, which sampled three API shapes and reached its
;; own conclusion: all three normalise to a `LogEvent`. So that is the type, and the three spellings
;; are three ways to build one.
;;
;; ------------------------------------------------------------------------------------------------
;; A LOGGER TAKES A CLOCK, AND THAT IS WHAT MAKES LOGGING TESTABLE.
;;
;; Every log line carries a timestamp, and a timestamp read from the wall clock differs every run --
;; so a logging module measured against the real clock can assert that output was PRODUCED and nothing
;; about what it said. That is not a test, it is a smoke check.
;;
;; `Logger` takes a `Clock` (std/sys/timers), exactly as `Ticker` and `Scheduler` do, so under a
;; `ManualClock` the timestamps are exact and a log transcript is a golden. Combined with `MemorySink`,
;; which keeps events instead of printing them, the whole module is assertable rather than eyeballed.
;; This is the same philosophy `std/math/random` states as "seeded determinism IS the API" (D65).
;;
;; ------------------------------------------------------------------------------------------------
;; AN EVENT IS A NAME PLUS PROPERTIES. NO MESSAGE TEMPLATES.
;;
;; Serilog's `"User {Name} logged in"` is a second string language: a parser, an escaping rule, and a
;; mismatch between holes and arguments that can only be caught at run time. l-lang already has string
;; interpolation (`'"{x}"`), which is checked at COMPILE time, so a template parser here would be a
;; worse duplicate of a thing the language does better.
;;
;; So an event is `(log.info "cache.miss" { :key "product:42" })` -- a dotted EVENT NAME that is stable
;; enough to grep and alert on, and a property map that stays structured all the way to the sink. That
;; is the half of Serilog worth having: the rendered sentence is a presentation choice a sink makes,
;; not something baked into the call site.
;;
;; ------------------------------------------------------------------------------------------------
;; LEVELS ARE A `defenum` WITH NO EXPLICIT VALUES, which is deliberate. Members fold to their ORDINALS
;; (0..5), so `>=` filtering is ordinary integer comparison with nothing to get wrong, and D70 makes
;; the names readable through `std/llang/reflect`. Giving one member an explicit value would be a trap:
;; a member FOLLOWING an explicit one takes its ordinal rather than predecessor+1 (pinned by
;; `07-types/07_enum_reflection`), so a hand-numbered tower would silently renumber itself.
(
    (import "std/core/builder")
    (import "std/core/string")
    (import "std/text/json")
    (import "std/time/calendar")
    (import "std/sys/timers")

    (defenum Level :trace :debug :info :warn :error :fatal)

    (fn level-name [level <- Int] -> String (
        (let names ["TRACE" "DEBUG" "INFO" "WARN" "ERROR" "FATAL"])
        (if (or (< level 0) (> level 5)) (return "?"))
        (return names[level])
    ))

    ;; One event. `timestamp` is epoch NANOSECONDS -- the floor's unit, so nothing is lost between the
    ;; clock and the sink, and rendering it is `std/time/calendar`'s job rather than this module's.
    (defclass LogEvent
        (let :ctor level <- Int)
        (let :ctor timestamp <- Int)
        (let :ctor name <- String)
        (let :ctor properties <- Any)
    )

    ;; Where events go. A sink RECEIVES the event, so it owns rendering -- which is why the event
    ;; keeps its property map structured instead of formatting at the call site.
    (definterface Sink
        (fn write [event <- LogEvent] -> Void))

    ;; Render an event as a line: `2026-01-27T00:00:00Z [INFO ] name key=value`.
    ;;
    ;; The level is padded to five columns so the names line up; `WARN` and `INFO` are four characters
    ;; and `TRACE` is five, and a log you cannot scan vertically is a log nobody reads.
    (fn render-line [event <- LogEvent] -> String (
        (let sb (StringBuilder))
        (sb.append ((from-epoch-ns event.timestamp).to-iso))
        (sb.append " [")
        (sb.append (pad-end (level-name event.level) 5 " "))
        (sb.append "] ")
        (sb.append event.name)
        (let ks (map-keys event.properties))
        (mut i <- Int 0)
        (while (< i ks.length) (
            (sb.append " ")
            (sb.append ks[i])
            (sb.append "=")
            ;; Through `to-json`, so a String is quoted and a container keeps its shape. `display`
            ;; would render `hello` and `"hello"` identically, which is the ambiguity that makes a log
            ;; line unparseable exactly when you need to parse it.
            (sb.append (to-json (map-get event.properties ks[i])))
            (i := (+ i 1))
        ))
        (return (sb.to-string))
    ))

    ;; The whole event as one JSON object, for anything that ingests logs rather than reads them.
    (fn render-json [event <- LogEvent] -> String (
        (let m {})
        (map-set m "timestamp" ((from-epoch-ns event.timestamp).to-iso))
        (map-set m "level" (level-name event.level))
        (map-set m "event" event.name)
        (map-set m "properties" event.properties)
        (return (to-json m))
    ))

    (defclass ConsoleSink :implements Sink
        (fn write [event <- LogEvent] -> Void (console.log (render-line event))))

    (defclass JsonSink :implements Sink
        (fn write [event <- LogEvent] -> Void (console.log (render-json event))))

    ;; Keeps events instead of printing them. THE REASON THIS MODULE IS TESTABLE: a test asserts on the
    ;; events themselves -- their count, their levels, their properties -- rather than on scraped
    ;; stdout, and it does so without a clock or a terminal.
    (defclass MemorySink :implements Sink
        (mut events <- LogEvent[] [])
        (fn write [event <- LogEvent] -> Void (this.events.push event))
        (fn count [] -> Int (return this.events.length))
        (fn clear [] -> Void (this.events := []))
        ;; The rendered lines, for a golden.
        (fn lines [] -> String[] (
            (mut out <- String[] [])
            (for :each e :from this.events :then (out.push (render-line e)))
            (return out)
        ))
    )

    ;; A logger. `context` is merged into every event's properties -- Serilog's `ForContext`, and the
    ;; reason correlation data (a request id, a service name) belongs to the logger rather than being
    ;; repeated at every call site and forgotten at one of them.
    (defclass Logger
        (let :ctor clock <- Any)
        (let :ctor sink <- Sink)
        (mut min-level <- Int 0)
        ;; Initialised in a ctor initializer rather than as a field DEFAULT, because a map-literal
        ;; default has no CIR lowering on C -- `(mut context <- Any {})` is `ELL0106 no CIR lowering
        ;; for 'map'`. A VECTOR-literal default is fine (`MemorySink`'s `events` uses one), so it is
        ;; specifically the map literal. Logged rather than worked around silently.
        (mut context <- Any nil)

        (fn :ctor init-context [] -> Void (this.context := {}))

        (fn set-min-level [level <- Int] -> Logger ((this.min-level := level) (return this)))

        ;; A NEW logger sharing this one's clock and sink, with one more context field. It does not
        ;; mutate the receiver -- a child logger adding a request id must not add it to the parent,
        ;; which is the bug every hand-rolled version of this has.
        (fn with [key <- String value <- Any] -> Logger (
            (let child (Logger this.clock this.sink))
            (child.min-level := this.min-level)
            (let merged {})
            (let ks (map-keys this.context))
            (mut i <- Int 0)
            (while (< i ks.length) (
                (map-set merged ks[i] (map-get this.context ks[i]))
                (i := (+ i 1))
            ))
            (map-set merged key value)
            (child.context := merged)
            (return child)
        ))

        (fn is-enabled [level <- Int] -> Boolean (return (>= level this.min-level)))

        (fn log [level <- Int name <- String properties <- Any] -> Void (
            ;; The filter is checked FIRST, so a suppressed event costs a comparison rather than a
            ;; merge and a render. That is the whole reason `is-enabled` is public too.
            (if (< level this.min-level) (return))
            (let c this.clock)
            (let merged {})
            (let ck (map-keys this.context))
            (mut i <- Int 0)
            (while (< i ck.length) (
                (map-set merged ck[i] (map-get this.context ck[i]))
                (i := (+ i 1))
            ))
            (let pk (map-keys properties))
            (mut j <- Int 0)
            (while (< j pk.length) (
                ;; Event properties WIN over context on a collision -- the specific beats the general,
                ;; and the alternative would let a logger-wide field silently mask a call site's own.
                (map-set merged pk[j] (map-get properties pk[j]))
                (j := (+ j 1))
            ))
            (let s this.sink)
            (s.write (LogEvent level (c.now) name merged))
        ))

        (fn trace [name <- String properties <- Any] -> Void (this.log Level:trace name properties))
        (fn debug [name <- String properties <- Any] -> Void (this.log Level:debug name properties))
        (fn info  [name <- String properties <- Any] -> Void (this.log Level:info  name properties))
        (fn warn  [name <- String properties <- Any] -> Void (this.log Level:warn  name properties))
        (fn error [name <- String properties <- Any] -> Void (this.log Level:error name properties))
        (fn fatal [name <- String properties <- Any] -> Void (this.log Level:fatal name properties))
    )

    ;; A logger on the real wall clock, writing lines to stdout. The one non-reproducible surface, and
    ;; named so that reaching for it is a choice: everything else in this module is deterministic.
    (fn console-logger [] -> Logger (return (Logger (WallClock) (ConsoleSink))))

    (export
        Level level-name LogEvent Sink ConsoleSink JsonSink MemorySink Logger
        render-line render-json console-logger)
)
