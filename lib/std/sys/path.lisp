;; std/sys/path -- filesystem paths as a value type.
;;
;; A `Path` is an immutable value (defstruct, D11 copy) wrapping a string, with `/` as the join operator
;; (pathlib's idea) and the POSIX component accessors. It dogfoods the protocol family (D63): Formattable
;; makes a Path display as its own string everywhere, and Comparable orders paths lexically.
;;
;; RULINGS (D64):
;;   * `/` is the canonical separator on both backends; `\` is normalized to `/` on construction. l-lang
;;     states the rule rather than importing the host's opinion (D52).
;;   * `extension` excludes the dot (`file.txt` -> `txt`), "" when there is none; a leading-dot name
;;     (`.gitignore`) is HIDDEN, not suffixed, so it has no extension. `stem` is the basename minus it.
;;   * `dirname` of a bare relative name is `.` (POSIX); of `/x` is `/`; of `/` is `/`. `basename` of `/`
;;     is "". A trailing slash is not a segment (`/a/b/` -> basename `b`, dirname `/a`).
;;   * The `/` operator joins a String segment; an ABSOLUTE segment (`starts-with "/"`) resets to it.
;;     Joining another Path is `(/ p (other.to-string))` -- the operator takes a String, not a
;;     Path|String union, because a union operand hits a C boxing gap (logged in the C gap ledger).
(
    (import "std/core/string")
    (import "std/core/protocols")

    ;; The non-empty segments of a path -- `/a//b/` -> ["a" "b"]. Trailing/leading/doubled slashes drop.
    (fn path-parts [s <- String] -> String[] (
        (let out [])
        (for :each p :from (split s "/") :then (if (! (== p "")) (out.push p)))
        (return out)))

    (defstruct Path :implements Formattable Comparable
        (mut :ctor s <- String)
        ;; `:ctor` initializer -- normalize `\` to `/` once, so every accessor works on `/` alone.
        (fn :ctor normalize-seps [] (this.s := (join (split this.s "\\") "/")))

        ;; join a String segment; an absolute segment resets, else append with one separator.
        (fn :operator / [seg <- String] -> Path (
            (if (starts-with seg "/") (return (Path seg)))
            (if (== this.s "") (return (Path seg)))
            (if (ends-with this.s "/") (return (Path (+ this.s seg))))
            (return (Path (+ this.s "/" seg)))))

        (fn is-absolute [] -> Boolean (return (starts-with this.s "/")))

        (fn segments [] -> String[] (return (path-parts this.s)))

        ;; the last segment (trailing slash ignored); "" for the root.
        (fn basename [] -> String (
            (let parts (path-parts this.s))
            (if (== parts.length 0) (return ""))
            (return parts[(- parts.length 1)])))

        ;; everything before the last segment: `/` for an absolute one-segment path, `.` for a relative one.
        (fn dirname [] -> String (
            (let parts (path-parts this.s))
            (let abs (this.is-absolute))
            (if (<= parts.length 1) (return (if abs "/" ".")))
            (let head (join (parts.slice 0 (- parts.length 1)) "/"))
            (return (if abs (+ "/" head) head))))

        (fn parent [] -> Path (return (Path (this.dirname))))

        ;; after the last dot in the basename, no dot; "" for none or a hidden (leading-dot) name.
        (fn extension [] -> String (
            (let bn (this.basename))
            (if (starts-with bn ".") (return ""))
            (let dots (split bn "."))
            (if (<= dots.length 1) (return ""))
            (return dots[(- dots.length 1)])))

        ;; the basename minus its extension (and the dot).
        (fn stem [] -> String (
            (let bn (this.basename))
            (if (== (this.extension) "") (return bn))
            (let dots (split bn "."))
            (return (join (dots.slice 0 (- dots.length 1)) "."))))

        ;; resolve `.` (drop), `..` (pop the previous real segment), and `//` (collapse).
        (fn normalize [] -> Path (
            (let abs (this.is-absolute))
            (let out [])
            (for :each p :from (split this.s "/") :then (
                (if (! (|| (== p "") (== p ".")))
                    (if (== p "..")
                        (if (&& (> out.length 0) (! (== out[(- out.length 1)] "..")))
                            (out.pop)
                            (if (! abs) (out.push "..")))
                        (out.push p)))))
            (let joined (join out "/"))
            (return (Path (if abs (+ "/" joined) (if (== joined "") "." joined))))))

        (fn to-string [] -> String (return this.s))
        (fn format [] -> String (return this.s))
        (fn compare-to [o <- Path] -> Int (return (compare this.s o.s))))

    (export Path)
)
