;; std/linq - LAZY sequence operators over a table of records
;;
;; This example demonstrates:
;; - (import "std/iter/linq"): the LAZY, collection-FIRST counterpart to std/seq (D33).
;;   Both packages export map/filter/reduce - import exactly ONE of them per file.
;; - the PIPE surface (D33's primary surface): (coll |> (filter p) |> (map f) |> to-list)
;; - the METHOD surface (Phase Nd): ((seq coll).filter p) - the same operators, C#-style
;; - early-exit operators (skip/take) and terminals (to-list / reduce / count)
;; - LAZINESS: a chain is a pipeline of generators; no work happens until a terminal pulls

(
    (import "std/iter/linq")

    ;; A tiny table of records. Map keys are plain identifiers, so dot-access reads them back.
    (let employees [
        { :name "Ada"     :dept "eng"      :salary 165 }
        { :name "Grace"   :dept "eng"      :salary 150 }
        { :name "Linus"   :dept "ops"      :salary 120 }
        { :name "Barbara" :dept "eng"      :salary 140 }
        { :name "Alan"    :dept "research" :salary 130 }
        { :name "Edsger"  :dept "eng"      :salary 155 }
    ])

    (fn is-eng [e] (== e.dept "eng"))
    (fn name-of [e] e.name)
    (fn salary-of [e] e.salary)

    ;; 1. THE PIPE. Every operator takes its collection FIRST, so `|>` threads it straight
    ;;    through: (employees |> (filter is-eng) |> (map name-of)) IS map(filter(employees,
    ;;    is-eng), name-of) - written left to right. Each hop is a generator; `to-list` is
    ;;    the terminal that finally drains them into an array.
    (console.log "--- Engineers (pipe) ---")
    (let eng-names (employees |> (filter is-eng) |> (map name-of) |> to-list))
    (console.log (eng-names.join ", "))

    ;; 2. EARLY EXIT. skip/take page through a sequence without materialising it.
    (console.log "--- Page 2: (skip 1) then (take 2) ---")
    (for :each e :from (employees |> (filter is-eng) |> (skip 1) |> (take 2)) :then (
        (console.log '"{(e.name)}: {(e.salary)}")
    ))

    ;; 3. TERMINALS collapse a sequence into a value: `count` tallies, `reduce` folds.
    (console.log "--- Terminals ---")
    (let head-count (employees |> (filter is-eng) |> count))
    (let payroll (employees |> (filter is-eng) |> (map salary-of) |> (reduce (fn [a b] (+ a b)) 0)))
    (let top (employees |> (map salary-of) |> (reduce (fn [a b] (if (> a b) (return a) (return b))) 0)))
    (console.log '"engineers: {(head-count)}")
    (console.log '"eng payroll: {(payroll)}")
    (console.log '"top salary: {(top)}")

    ;; 4. enumerate pairs each element with its index as [i x]; the loop variable destructures it.
    (console.log "--- Ranked (enumerate) ---")
    (for :each [i e] :from (employees |> (filter is-eng) |> (take 3) |> enumerate) :then (
        (console.log '"{(i)}. {(e.name)} ({(e.salary)})")
    ))

    ;; 5. THE METHOD SURFACE. The operators are `:extension` functions whose receiver IS their
    ;;    first parameter, so one definition serves both surfaces. A BARE array keeps its
    ;;    native eager .map/.filter - `(seq arr)` lifts it into a lazy cursor to opt in.
    (console.log "--- Engineers (method chain) ---")
    (let chained ((((seq employees).filter is-eng).map name-of).to-list))
    (console.log (chained.join ", "))

    ;; 6. LAZINESS. `peek` counts the records the pipeline actually touches. `take 2` stops
    ;;    pulling as soon as it has two, so the tail of the table is never visited at all.
    (console.log "--- Laziness ---")
    (mut touched 0)
    (fn peek [e] (
        (touched := (+ touched 1))
        (return e)
    ))
    (let two (employees |> (map peek) |> (take 2) |> (map name-of) |> to-list))
    (console.log (two.join ", "))
    (console.log '"touched all 6 records? {(== touched 6)}")
)
