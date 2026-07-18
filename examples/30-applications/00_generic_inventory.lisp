;; ============================================================
;; 00_generic_inventory.lisp -- a generic container, Inventory<T>.
;; ============================================================
;; Extracted from the `dungeon` game (dungeon/inventory.lisp).
;;
;; A generic class with CALL-SITE type inference: `(new Inventory [seed])`
;; infers T from the seed element -- here T = String. The documented
;; constraint is that an inventory must be SEEDED: `(new Inventory [])`
;; leaves T unbound and every later `add` is rejected (LL0203).
;;
;; It also exercises `T?` optional returns (`at`/`take` yield nil when the
;; index is out of range) and the generic free fn `without<T>`.
;; ============================================================
(
    (defclass Inventory<T>
        (mut :ctor items <- T[])

        (fn count [] -> Int (return this.items.length))

        (fn add [x <- T] -> Void (this.items.push x))

        (fn at [i <- Int] -> T? (return (get this.items i)))

        ;; Remove and return the element at i, or nil if out of range.
        (fn take [i <- Int] -> T?
            (if (|| (< i 0) (>= i this.items.length)) (return nil))
            (let out this.items[i])
            (this.items := (without this.items i))
            (return out)))

    ;; A fresh array with index i dropped -- `.splice` mutates, and we want
    ;; the caller's array left alone until we reassign it.
    (fn without<T> [xs <- T[] i <- Int] -> T[]
        (let out [])
        (mut k 0)
        (while (< k xs.length) (
            (if (!= k i) (out.push xs[k]))
            (k := (+ k 1))))
        (return out))

    ;; Render a T? for printing: an out-of-range lookup comes back nil.
    (fn show-opt [x <- String?] -> String
        (if (== x nil) (return "(nil)"))
        (return x))

    ;; T is inferred as String from the seed element. A `(new Inventory [])`
    ;; would leave T unbound, so we start the pack armed.
    (mut pack (new Inventory ["rusty dagger"]))
    (console.log '"seeded, count = {(pack.count)}")

    (pack.add "short sword")
    (pack.add "healing potion")
    (console.log '"after 2 adds, count = {(pack.count)}")

    (console.log '"at 0 = {(show-opt (pack.at 0))}")
    (console.log '"at 2 = {(show-opt (pack.at 2))}")
    (console.log '"at 5 = {(show-opt (pack.at 5))}")

    ;; take removes and returns; the array closes up behind it.
    (let taken (pack.take 1))
    (console.log '"take 1 -> {(show-opt taken)}")
    (console.log '"after take, count = {(pack.count)}")
    (console.log '"at 1 now = {(show-opt (pack.at 1))}")

    (let oob (pack.take 9))
    (console.log '"take 9 -> {(show-opt oob)}")
)
