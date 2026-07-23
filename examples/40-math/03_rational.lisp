;; std/math/rational -- exact fractions over Int, always in lowest terms.
;;
;; The point of a rational type is that it does NOT drift the way Real does: 1/3 + 1/3 + 1/3 is
;; exactly 1, not 0.9999999999999999, and this example is built to SHOW that rather than assert a
;; float. Almost every line below prints an exact fraction string or an integer comparison, so the
;; golden is derived from arithmetic and cannot be broken by the two backends' libm differing in the
;; last bit. The only Real that escapes -- `to-real` -- is scaled to an integer before printing, for
;; the same reason.
;;
;; A word on the fraction LITERAL this type is meant to back: `3/4` would desugar to `(Rational 3 4)`,
;; and because the constructor is the reducer, the literal `6/8` and the literal `3/4` would denote
;; the identical value. `1/0` is already rejected at parse time (LL0002); at run time the same zero
;; denominator is a thrown Error, demonstrated at the end.

(import "std/math/rational")

(
    ;; -- construction and the canonical-form invariant ---------------------------------------------
    ;; Every Rational is reduced with a positive denominator the instant it is constructed, so there
    ;; is no un-normalised state to observe: 6/-8 IS -3/4, 0/7 IS 0, 8/4 IS 2.
    (console.log "--- construction ---")
    (let a (Rational 6 -8))
    (console.log "6/-8 normalises to" (a.str) "with numer" (a.numer) "denom" (a.denom))
    (console.log "0/7 is the unique zero:" ((Rational 0 7).str))
    (console.log "8/4 reduces to integer:" ((Rational 8 4).str))
    (console.log "from-int 5:" ((from-int 5).str))

    ;; from-real recovers the best rational within a tolerance, via continued fractions. pi's
    ;; convergents are 3, 22/7, 333/106, 355/113, ...; a 1e-6 bound reaches 355/113 (the famous one),
    ;; a 1e-4 bound stops at 333/106.
    (console.log "from-real 0.75:" ((from-real 0.75 1.0e-9).str))
    (console.log "from-real pi (tol 1e-4):" ((from-real 3.141592653589793 1.0e-4).str))
    (console.log "from-real pi (tol 1e-6):" ((from-real 3.141592653589793 1.0e-6).str))

    ;; -- exact field arithmetic --------------------------------------------------------------------
    ;; The results are hand-computed: 1/2+1/3 = 3/6+2/6 = 5/6; 2/3-1/6 = 4/6-1/6 = 1/2;
    ;; 3/4 * 8/9 = 24/36 = 2/3; (3/4)/(9/8) = 24/36 = 2/3.
    (console.log "--- arithmetic ---")
    (let x (Rational 1 2))
    (let y (Rational 1 3))
    (console.log "1/2 + 1/3 =" ((+ x y).str))
    (console.log "2/3 - 1/6 =" ((- (Rational 2 3) (Rational 1 6)).str))
    (console.log "3/4 * 8/9 =" ((* (Rational 3 4) (Rational 8 9)).str))
    (console.log "(3/4) / (9/8) =" ((/ (Rational 3 4) (Rational 9 8)).str))
    (console.log "-(5/6) =" ((- (Rational 5 6)).str))

    ;; Integer powers, negative and zero included: (2/3)^4 = 16/81, (3/5)^-2 = 25/9, (7/9)^0 = 1.
    (console.log "(2/3)^4 =" (((Rational 2 3).ipow 4).str))
    (console.log "(3/5)^-2 =" (((Rational 3 5).ipow -2).str))
    (console.log "(7/9)^0 =" (((Rational 7 9).ipow 0).str))
    (console.log "recip 7/3 =" (((Rational 7 3).recip).str))

    ;; The headline exactness property: 1/2 + 1/3 + 1/6 = 6/6 = 1, to the bit. In Real this sum is
    ;; 0.9999999999999999.
    (let one (+ (+ (Rational 1 2) (Rational 1 3)) (Rational 1 6)))
    (console.log "1/2 + 1/3 + 1/6 =" (one.str) "-- integer?" (one.is-integer))

    ;; -- ordering and equality ---------------------------------------------------------------------
    ;; Equality is exact BECAUSE of the canonical form: 2/4 and 1/2 are the same stored pair, so `eq`
    ;; is field equality with no cross-multiply. Ordering is a genuine total order on the rationals.
    (console.log "--- ordering & equality ---")
    (console.log "2/4 eq 1/2:" ((Rational 2 4).eq x))
    (console.log "1/2 eq 1/3:" (x.eq y))
    (console.log "1/3 lt 1/2:" (y.lt x))
    (console.log "1/2 lt 1/3:" (x.lt y))
    (console.log "cmp 1/2 vs 1/2:" (x.cmp (Rational 1 2)))

    ;; -- to-real, printed as a scaled integer so libm cannot break the golden ----------------------
    ;; 22/7 = 3.142857142857...; scaled by 1e6 and rounded, exactly 3142857. 1/8 = 0.125 exactly;
    ;; scaled by 1000, exactly 125. The fraction is exact; only the rounding of the ratio is asserted.
    (console.log "--- to-real (scaled to integer) ---")
    (console.log "22/7 * 1e6 rounded =" (Math.round (* ((Rational 22 7).to-real) 1000000.0)))
    (console.log "1/8 * 1e3 rounded  =" (Math.round (* ((Rational 1 8).to-real) 1000.0)))

    ;; -- optional glyph synonyms (D57): each delegates one line to its ASCII twin -------------------
    ;; These exist so a call site proves they work on BOTH backends -- a glyph declared and never
    ;; called rots invisibly. `⁻¹` is `recip`, `≈` is `near`.
    (console.log "--- glyph synonyms ---")
    (console.log "(7/3) inverse via glyph:" (((Rational 7 3).⁻¹).str))
    (console.log "1/2 ~= from-real 0.5 via glyph:" (x.≈ (from-real 0.5 1.0e-9) 0.000001))

    ;; -- loud failures: a zero denominator is thrown, not trapped, so it is caught identically ------
    ;; on both backends (a runtime trap would be catchable on JS and fatal on C).
    (console.log "--- loud failures ---")
    (try ((let bad (Rational 1 0)) (console.log "constructed" (bad.str)))
        catch e :of Error (console.log "1/0 rejected at construction"))
    (try ((let bad (/ x (Rational 0 5))) (console.log "divided" (bad.str)))
        catch e :of Error (console.log "division by 0/5 rejected"))
    (try ((let bad ((Rational 0 1).recip)) (console.log "recipped" (bad.str)))
        catch e :of Error (console.log "reciprocal of 0 rejected"))

    ;; -- eager reduction delays Int overflow -------------------------------------------------------
    ;; Because the constructor reduces, a fraction never carries a common factor into the next
    ;; multiply: 1000000/2000000 is stored 1/2, and its square is 1/4, not 10^12/(4x10^12).
    (console.log "--- overflow delay ---")
    (let big (Rational 1000000 2000000))
    (console.log "1000000/2000000 stored as" (big.str) "-- its square is" ((big.ipow 2).str))
)
