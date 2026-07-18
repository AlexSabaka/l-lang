;; ADVERSARIAL: multiple trailing forms in a `while` body (finding PR2, l-lang-ex snake).
;;
;; A grid game's two-level loops make paren-grouping mistakes easy: here `(n := (+ n 1))`
;; sits LEXICALLY INSIDE the `(while ...)` form (its `)` closes only the inner body-group),
;; so it runs every iteration and n reaches 3 -- NOT once-after-the-loop (n == 1) as the
;; indentation suggests. The output is the faithful evaluation of the parens as written;
;; the friction is that balance is checked but grouping-vs-intent is not warned. Pinned as
;; a regression guard on how the parser sequences multiple `while` body forms.
(
  (mut row 0)
  (mut n 0)
  (while (< row 3) (
    (row := (+ row 1)))
  (n := (+ n 1)))
  (console.log "row" row "n" n)
)
