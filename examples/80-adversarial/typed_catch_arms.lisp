;; TYPE-FILTERED CATCH ARMS -- selection, ORDER, and propagation.
;;
;; `18-error-handling/00_errors.lisp` runs three arms through one helper. What it does not do is ask
;; the questions that only matter when arms OVERLAP: a `Derived` is-a `Base`, so two arms can both
;; match one throw and something has to decide. The answer is FIRST MATCH WINS, and the row that
;; proves it is `base arm first` -- a `Base` arm written before a `Derived` arm takes a `Derived`
;; throw, which makes the later arm unreachable. That is the ordinary semantics (Java, C#, Python),
;; but nothing stated it and an unreachable arm draws no diagnostic.
;;
;; TWO THINGS MEASURED AND DELIBERATELY NOT PINNED HERE, both in docs/roadmap.md:
;;
;;   * A BARE catch-all written FIRST takes the throw on C (first match wins, correct) and the LATER
;;     TYPED arm takes it on JS. A real divergence, and C is the right one. Under D103 a C-correct
;;     feature the frozen backend gets wrong is simply left wrong and no new `oracleDivergent` entry
;;     is owed, so the row is recorded rather than added here -- including it would make this file
;;     ungradeable on the instrument for no gain.
;;
;;   * The `:of` filter does NOT type the binding. `(let n <- Int e.message)` inside
;;     `catch e :of Derived` is SILENT, while the identical annotation over an ordinary binding of the
;;     same class is `LL0200`. The checker knows the filter type and does not apply it.
(
    (import "std/protocols")

    (defclass Base :extends Error (let :ctor message))
    (defclass Derived :extends Base (let :ctor message))
    (defclass Other :extends Error (let :ctor message))

    ;; 1. SELECTION: the most specific arm, written first, takes its own type.
    (try ((throw (new Derived "d")))
      catch e :of Derived (console.log "derived throw ->" "derived arm")
      catch e :of Base (console.log "derived throw ->" "base arm"))

    ;; 2. And a Base throw falls past the Derived arm to the Base arm -- a Base is NOT a Derived.
    (try ((throw (new Base "b")))
      catch e :of Derived (console.log "base throw ->" "derived arm")
      catch e :of Base (console.log "base throw ->" "base arm"))

    ;; 3. ORDER: the Base arm FIRST takes a Derived throw. First match wins, and the Derived arm below
    ;;    it is unreachable -- silently, with no diagnostic.
    (try ((throw (new Derived "d")))
      catch e :of Base (console.log "base arm first ->" "base arm")
      catch e :of Derived (console.log "base arm first ->" "derived arm"))

    ;; 4. PROPAGATION: a type no arm matches leaves the inner try untouched and reaches the outer one.
    (try ((try ((throw (new Other "o"))) catch e :of Derived (console.log "inner took it")))
      catch (console.log "unmatched type ->" "propagated to outer"))

    ;; 5. RETHROW from a typed arm, caught by a BASE arm outside -- the identity survives the relay.
    (try ((try ((throw (new Derived "d"))) catch e :of Derived ((throw e))))
      catch e2 :of Base (console.log "rethrown derived ->" "outer base arm"))

    ;; 6. THE BINDING IS READABLE, whatever its static type turns out to be.
    (try ((throw (new Derived "payload")))
      catch e :of Derived (console.log "binding message:" e.message))

    ;; 7. A NON-ERROR VALUE is throwable and catchable by a bare arm.
    (try ((throw 42)) catch (console.log "threw an Int ->" "caught"))
    (try ((throw "boom")) catch (console.log "threw a String ->" "caught"))

    ;; 8. OUT OF A GENERATOR, caught by a TYPED arm in the consumer: the longjmp crosses the step
    ;;    function and the arm still matches on type.
    (fn :gen g [] -> Iterator<Int> ((yield 1) (throw (new Derived "mid")) (yield 2)))
    (mut seen 0)
    (try ((for :each x :from (g) :then (seen := (+ seen x))))
      catch e :of Derived (console.log "thrown from a generator, seen:" seen))
)
