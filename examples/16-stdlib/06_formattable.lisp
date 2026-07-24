;; Formattable (std/core/protocols): a type that :implements it renders through its own `format`
;; method everywhere the display path reaches -- console.log, string interpolation, and nested inside a
;; container. A type that does NOT implement it keeps the default `Name{:field …}` dump, so the rewire
;; is invisible to every existing type. Nominal (gated on `:of Formattable`), identical on both backends.
(
    (import "std/core/protocols")

    (defclass Point :implements Formattable
        (let :ctor x <- Int)
        (let :ctor y <- Int)
        (fn format [] -> String '"({this.x}, {this.y})"))

    ;; a plain class -- NOT Formattable -- keeps the default field dump
    (defclass Plain (let :ctor n <- Int))

    (let p (Point 3 4))
    (console.log "log:" p)                     ;; the console.log path
    (console.log '"interp: {p}")               ;; the string-interpolation path
    (console.log "nested:" [p (Point 5 6)])    ;; nested inside a container
    (console.log "plain:" (Plain 7))           ;; the non-Formattable control
)
