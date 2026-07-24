;; std/sys/path -- a Path value type: `/` joins (String segments, absolute resets), POSIX accessors,
;; and (via std/core/protocols) Formattable display + Comparable ordering.
(
    (import "std/sys/path")
    (import "std/seq")

    ;; the `/` join operator, chained; an absolute segment resets the path
    (console.log "join:" (/ (Path "/usr") "local" "bin"))
    (console.log "reset:" (/ (Path "/usr/local") "/etc/hosts"))

    ;; component accessors
    (let f (Path "/usr/local/lib/archive.tar.gz"))
    (console.log "dirname:" (f.dirname))
    (console.log "basename:" (f.basename))
    (console.log "extension:" (f.extension))
    (console.log "stem:" (f.stem))
    (console.log "parent:" (f.parent))
    (console.log "segments:" (f.segments))
    (let rel (Path "rel/x"))
    (console.log "absolute:" (f.is-absolute) (rel.is-absolute))

    ;; normalize resolves . / .. / //
    (let messy (Path "/a/./b/../c//d"))
    (console.log "normalize:" (messy.normalize))

    ;; Comparable: sort a vector of Paths by compare-to (dogfoods D63)
    (let paths [(Path "/b") (Path "/a") (Path "/c")])
    (console.log "sorted:" (sort paths))
)
