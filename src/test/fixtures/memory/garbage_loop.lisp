;; The bounded-RSS ACCEPTANCE WORKLOAD for D59's collector.
;;
;; Not a corpus example: it has no interesting output and its whole content is a shape, so grading it
;; against a golden would say nothing. What is measured is the PEAK RSS of the process, by
;; `test/memory.ts`, at two loop counts.
;;
;; THE SHAPE. Each iteration allocates a container and then drops it: nothing from a previous
;; iteration is reachable when the next one starts, so the live set at any instant is one vector plus
;; one map. A collector -- any collector -- therefore makes peak RSS a FLAT function of the iteration
;; count. Without one, `ll_alloc` is malloc-and-never-free and RSS is a straight line through the
;; origin.
;;
;; That is the whole assertion, and it is why the test is a RATIO rather than a byte budget:
;; `RSS(2N) / RSS(N)` is ~2 with no collector and ~1 with one, and neither number depends on the
;; machine, the allocator's page behaviour, or the size of the runtime's fixed overhead.
;;
;; The iteration count arrives in the ENVIRONMENT (`LL_GC_N`) so ONE binary serves both measurements.
;; Compiling twice with different literals would put two different programs on the two sides of the
;; ratio -- the same objection that makes this a ratio in the first place. Not `sys-arg`, because on
;; the JS side the program runs under the interpreter and argv[0] is a path, not the count.
;;
;; Deliberately BORING l-lang: a while loop, a vector literal, a map literal, and an accumulator so
;; nothing can be dropped as dead. Every construct has been C-green since Phase A, so a failure here
;; is about memory and cannot be about codegen.
(
    (mut n 200000)
    (let arg (sys-env "LL_GC_N"))
    (if (!= arg nil)
        (n := (parseInt arg)))

    (mut i 0)
    (mut sink 0)
    (while (< i n) (
        ;; A vector and a map per iteration, both dead the moment the iteration ends.
        (let v [i (+ i 1) (+ i 2)])
        (let m {:a i :b (+ i 1)})
        ;; Touch both, so neither backend can drop the allocation as unused.
        (sink := (+ sink (+ v[0] m.a)))
        (i := (+ i 1))
    ))
    (console.log sink)
)
