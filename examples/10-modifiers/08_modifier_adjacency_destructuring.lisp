;; The nastiest case the D68 adjacency gate fixes: a modifier on a DESTRUCTURING let.
;;
;; Split out of 07 for one reason only -- a destructuring declaration has no C lowering (ELL0106), so
;; this file cannot be C-pinned and 07 can. The grammar question is identical.
;;
;; Before the gate this did not fail loudly. The modifier's greedy argument bracket ate the `[a b]`
;; pattern, which left `pt` alone in the name slot with nothing after it, and the compiler reported
;;
;;     ELL0006 Constant variable must have an initializer
;;
;; -- a correctly-formatted, confidently-located diagnostic about a problem the program does not have.
;; That is the failure mode worth a regression guard: the parse error in 07 at least pointed at the
;; right form.
(
    (let pt [1 2])

    (let :private [a b] pt)
    (console.log "destructured:" a b)

    ;; A map pattern takes the same slot and was broken the same way.
    (let person { :name "Sabaka" :city "Sarny" })
    (let :private {:name :city} person)
    (console.log "map pattern:" name city)
)
