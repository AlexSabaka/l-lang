;; THE CONDITION SYSTEM CROSSED WITH LIFTED FUNCTIONS AND GENERATOR FRAMES.
;;
;; `19-conditions/` is thorough about the condition system against ITSELF -- decline chains, re-entry
;; guards, finally interactions, nested handles, deep recursion. What no file there does is cross it
;; with a LIFTED function or a coroutine frame, and those are the two machineries that moved today.
;;
;; THERE IS NO ORACLE FOR THIS FILE. D47's restarts are C-native; the JS backend refuses the whole
;; construct with LL0108, so the differential that catches C defects elsewhere is structurally absent
;; here. Every value below is hand-derived from D47's rules, and they are DELIBERATELY ALL DIFFERENT
;; so a cross-wired transfer shows up as a wrong number rather than a coincidence.
;;
;; The sharp rows are 3 and 5, and they are sharp for the same reason: `ll_handler_top` is a global
;; pointing at a frame in some C activation, and a lifted lambda is a SEPARATE C function. So
;;   * row 3 signals from inside a lifted activation -- the frame it must find belongs to its caller;
;;   * row 5 invokes the restart from inside a lifted activation -- the transfer target is likewise
;;     two activations up.
;; Neither is reachable by any corpus file today, and both would fail as a wrong transfer rather than
;; a crash, which is exactly the shape that survives a green gate.
;;
;; NO DEFECT WAS FOUND WRITING THIS. Every row already answers correctly; it is a guard for a class
;; that the deprecated backend cannot check and that today's two lambda-lifter fixes could regress
;; silently.
(
    (import "std/protocols")
    (defclass Alert :extends Error (let :ctor message))

    (fn :gen three [] -> Iterator<Int> ((yield 1) (yield 2) (yield 3)))

    ;; 1. A LAMBDA DECLARED AND CALLED inside a restart body, before the signal.
    (fn lambda-in-body [] -> Int (
        (restart-case (
            (let d (fn [x <- Int] -> Int (return (* x 3))))
            (console.log "row1 computed:" (d 7))
            (signal (Alert "x"))
            (return -1))
          (:sub [v] v))))

    ;; 2. A LAMBDA INSIDE THE HANDLER, whose result is what the restart is given.
    (fn lambda-in-handler [] -> Int (
        (restart-case ((signal (Alert "x")) (return -1)) (:sub [v] v))))

    ;; 3. THE SIGNAL IS RAISED FROM INSIDE A LIFTED LAMBDA -- a different C activation from the
    ;;    restart-case that must catch it.
    (fn signal-from-lambda [] -> Int (
        (restart-case (
            (let s (fn [] -> Void ((signal (Alert "x")))))
            (s)
            (return -1))
          (:sub [v] v))))

    ;; 4. A GENERATOR DRIVEN TO COMPLETION inside a restart body: a coroutine frame and a handler
    ;;    frame are live at the same time, and the generator must not disturb `ll_handler_top`.
    (fn gen-in-body [] -> Int (
        (restart-case (
            (mut t 0)
            (for :each x :from (three) :then (t := (+ t x)))
            (console.log "row4 drained:" t)
            (signal (Alert "x"))
            (return -1))
          (:sub [v] v))))

    ;; 5. `invoke-restart` CALLED FROM INSIDE A LIFTED LAMBDA in the handler -- the transfer target is
    ;;    two activations up from where the call is made.
    (fn invoke-from-lambda [] -> Int (
        (restart-case ((signal (Alert "x")) (return -1)) (:sub [v] v))))

    (handle ((console.log "row1:" (lambda-in-body)))
        (:on Alert [] (invoke-restart :sub 10)))

    (handle ((console.log "row2:" (lambda-in-handler)))
        (:on Alert [] ((let q (fn [x <- Int] -> Int (return (+ x 10)))) (invoke-restart :sub (q 10)))))

    (handle ((console.log "row3:" (signal-from-lambda)))
        (:on Alert [] (invoke-restart :sub 30)))

    (handle ((console.log "row4:" (gen-in-body)))
        (:on Alert [] (invoke-restart :sub 40)))

    (handle ((console.log "row5:" (invoke-from-lambda)))
        (:on Alert [] ((let go (fn [] -> Void ((invoke-restart :sub 50)))) (go))))
)
