> **ARCHIVED 2026-07-28.** Consumed: its rulings are **D46** (the coercion substrate — refinements,
> `defcast`, `(cast<T> x)`), **D47** (conditions / restarts) and **D48** (the HIR core tail), plus
> amendments to D26/D33/D41, all in [`DECISIONS.md`](../spec/DECISIONS.md). Phases Cv and Cr have
> since SHIPPED; Bg has not.
>
> Read the rulings, not this file. Two of its specifics are now wrong: §B writes the range refinement
> spaced (`(0 .. 255)`), which **D88 made an LL0034 hard error**, and its "LLVM" throughout means
> what the C backend now is. Kept for the long-form reasoning behind rulings that were deliberately
> closed here so they would not be re-opened.

# Design-round brief — readiness answers, the coercion substrate, ideas triage, conditions

> **Triaged 2026-07-20** into `docs/spec/DECISIONS.md` (**D46–D48** + amendments to D26/D33/D41) and
> `docs/roadmap.md` (**Phases Cv / Bg / Cr**); `docs/inbox/language-ideas.md` retriaged. This file
> remains the **long-form source of record** for the reasoning behind those rulings.

**From:** the Sabaka⇄Dove round. **For:** the implementation lane (Cheetah/dev).
**Purpose:** *close* questions so they don't get re-opened or re-stumbled. Answers to the five open
questions in `hir-llvm-readiness-report.md`; the coercion pass reframed as the type system's
checked-conversion layer (refinements + `defcast` + native fixed-width, with grammar); the triaged
verdict on `language-ideas.md`; and the conditions/restarts ("checkpoints") grammar + the one part of
it that's genuinely hard. Rulings here are decisions, not options — where one needs a sub-decision at
implementation time it says so.

**Framing correction that colours everything below:** C is **not a pivot; it is a two-ended probe**.
It stands in for "a typed native target," so its dips *are* the LLVM-readiness signal, and LLVM
inherits every contract the C backend drains. The readiness report's title is therefore correct, and
"is this dip real?" is answered by the machine, not by argument — keep it that way (see A-0).

---

## A. HIR core — answers to the readiness report's five questions

### A-0 (meta, governs Q1 & Q5): reclassify single-backend passes; nodify dual-backend decisions; never relabel a real dip.
The ledger's power is that a dip can't be argued away. Two of the five questions are really "can we
move this out of the remaining-core column by argument?" The rule: a thing leaves core **only** if it
is genuinely a single-backend pass (JS has no version of it). A decision **both** backends make stays
core and must be nodified so they cannot diverge. A computation the backend performs is a dip even if
it's cheap and deterministic — resolve it onto the node, don't relabel it.

### Q1 — A5/A6 as native-pipeline passes: **split them; they are not symmetric.**
- **A6 (coercions, 262): out of core. Confirmed.** Coercions are single-backend — JS *erases* them,
  so only the native pipeline ever decides one. No second backend to disagree with. The P2 pass is a
  legitimate native-pipeline pass.
- **A5 (copies, 640): decision is CORE, materialization is out of core.** D11 value semantics run on
  **both** backends, so the copy *decision* ("struct value, copies shallowly per D11/CP3?") is made
  twice and *can diverge* — the ledger's own words are "synthesized by the backend at each store
  site," and JS has its own `asValue`/`needsValueCopy` synthesis. That is TY8 one level down: drift on
  a boxed-`Unknown`-holding-a-struct and one backend shares while the other copies (silent divergent
  behaviour). `isStore` is **not** the decision — it marks *that* a store happens, not *whether* it
  copies. **Ruling:** make the decision an `HCopyStore` node (both backends read it, cannot disagree);
  leave `__ll_copy`/`memcpy`/move as backend materialization. This **drains the 640** exactly like
  `HRef` drained `atom-ref` — the decision moves onto the node, so it's a cheap cut that also closes a
  divergence hole.
  - *Escape hatch:* if JS and C already route the struct-copy decision through **one shared
    predicate** (verify with a grep), A5 is safe out-of-core and `HCopyStore` is merely tidier. If the
    two synthesis sites are separate code, the node is mandatory-for-soundness. Either way it drains
    the dips; check which case you're in before committing the ruling.
- **Net accounting:** reclassification removes **A6's 262** from core, **not ~900**. A5's 640 stays
  as core work (a cheap draining cut). The tidy 900 was over-counting by the A5 decision.

### Q5 — the `field-get` relabel: **resolve, don't relabel.**
`field-get` (81) is only "consuming `HClass`" if the resolved slot is *on* `HMemberRead`. If the
backend re-walks the `HClass` field list for the index, that's a dip — cheap, but real. **Ruling:**
carry the resolved slot on `HMemberRead` (the `HRef` move — put the resolved thing on the node). Then
it is genuinely consumption. Do not relabel by fiat; that erodes the instrument A-0 protects.

### Q2 — boxed-`Unknown` representation: **fat pointer `{tag, payload}`, confirmed by construction.**
The C backend already runs this (boxed-`Unknown` the sole home of the fat pointer, statics unboxed)
and passes — a working proof, stronger than a design argument. LLVM inherits the same repr; only
materialization changes (C struct → LLVM aggregate/tagged), because the *decision* to box lives in
A5/A6 and targets the repr abstractly. Ratify.

### Q3 — closure ABI: **split. Callee-identity is a cheap drain; the closure value is the one real design commitment left in core.**
- **Callee-identity (110): cheap.** The call carries the *name* but not *which declaration* — "`HRef`
  for calls." Put the resolved binding on the call node; same drain as `HRef`/`HFreeCall`.
- **Function-as-value: a mini-design, and the last non-mechanical core work.** A closure needs a
  representation (code pointer + captured environment) and a real decision under D10/D11:
  capture-by-value vs by-reference, and how a captured `mut` becomes a heap cell (`mut-capture-cell`
  is already flagged). Do the cheap half first; the closure repr is where the actual thinking is —
  everything else in the tail is mechanical.

### Q4 — patterns: **model as an IR fact (`HMatchTest`), not a backend-lowered leaf.**
The fused-boolean form `(v = scrut, test)` is a semantic trap — it mutates while looking pure, and the
bind-then-test ordering is load-bearing (it's *why* arms need an else-chain). A naive consumer reads
it wrong; C only survives because P1 hand-expands it. Model the **shape** (scrutinee tests + binding
set + ordering) once; each pattern kind fills it in. This is the last opaque-leaf *class* — worth
doing properly.

### Sequencing for the core tail
1. **Cheap drains, together:** `HCopyStore` (A5 decision, closes the divergence hole), field-get slot
   onto `HMemberRead`, callee-identity onto call nodes. All `HRef`-style; big dip drops.
2. **`HMatchTest`** (last opaque-leaf class).
3. **Closure representation** (the one real design commitment).
4. A1 field types + the residue as they surface.

---

## B. A6 is the type system's checked-conversion layer — refinements, `defcast`, native fixed-width

Reframe: the coercion pass is **the boundary-conversion layer of the type system**, not "box/unbox for
`Unknown`." Three features insert a check/convert at a typed↔typed (or typed↔`Unknown`) edge — the pass
already does exactly this for boxing. Model the coercion node cleanly (carry the *check/convert kind* +
the *target type*), not as a bespoke box/unbox — it is load-bearing for the type-system future.

### B-0 — grammar surface for the type layer (prerequisite tokens)
- **`deftype` gets the arrow.** `<-` is the universal name-to-type binder everywhere else
  (`let x <- T`, `[param <- T]`, `{:field <- T}`); `deftype` is currently the *only* name-to-type
  construct without it. **Ruling:** `typeDefDecl ::= "deftype" modifier* identifier "<-" type
  refinement? ;` — name and type now **required** (was `identifier? type?`, both optional → an empty
  `deftype` parses today). Read `<-` as "binds to" (generalises over value-has-type and
  type-aliases-type). `(deftype Expr <- (Int | String | Expr)[])`.
- **`..` is a new token** — slots between `<Dot>` (`/\.(?!\.)/`) and `<Spread>` (`/\.\.\./`):
  `<Range> ::= /\.\.(?!\.)/`. `<OperatorIdent>` excludes `.`, so no collision. The lexer already does
  dot-count disambiguation.
- **`:where` is a new modkw** — `<WhereModKw> ::= /:where(?![a-zA-Z0-9_-])/`, same shape as the others.

### B-1 — refinements: a predicate over the value (total), with range sugar (partial)
**The core move:** a refinement is **"a value of the base type for which some boolean holds."** That is
type-agnostic — *zero per-type machinery*. `T :where (pred)` works identically for Int, String, Char,
Bool, record, collection. The check is always "evaluate the boolean at construction and at coercion,
throw if false." **Total, UB-free, backend-identical, because it's just running a bool.** This
dissolves "how do I refine type X" — the predicate form covers everything uniformly.

**What's *not* uniform is the sugar.** `(lo .. hi)` is shorthand that only means something for *ordered*
types, and it **desugars to a predicate** (`(0 .. 255)` → `(& (>= v 0) (<= v 255))`) — desugar-first,
sugar over predicates, not a primitive with its own semantics. Per built-in:
- **Numbers:** range sugar. `(deftype uint8 <- Int :where (0 .. 255))`.
- **Chars:** numeric underneath (`Char` → `uint32_t`), so ranges work directly: `('a' .. 'z')`. No
  special case.
- **Booleans:** the predicate form *works* but degenerates to a **singleton type** (the only
  non-trivial subsets of `{true,false}` are singletons) — technically consistent, practically useless.
  So booleans get the predicate form for free, get **no range sugar** (nothing to order), and we
  **don't chase it.** Refinement is a *partial* feature that earns its keep on rich value domains and
  degenerates gracefully. Do not force meaningful boolean refinement — it's a non-problem.
- **Strings:** length / predicate refinements are fine (`(fn [s] (> (len s) 0))`). **Regex is NOT a
  grammar primitive** — see B-1a.

#### B-1a — regex: a stdlib predicate, never grammar sugar
The `String :where "regex"` idea is off the table *as grammar*. It isn't UB (the match is a total bool)
but it's three concrete hazards: **backend divergence** (`\w` is ASCII in JS, Unicode in PCRE;
anchoring/flags/escapes differ across engines → a value valid on one target, rejected on the other —
the silent-divergence class this project kills), **ReDoS** (a user regex like `(a+)+$` on every
construction/coercion is a native performance landmine), and a **fuzzy surface** (implicit anchoring,
case, escaping). **Ruling:** refinement stays predicate-only; a regex refinement is an ordinary stdlib
call inside the predicate — `(deftype FullName <- String :where (fn [s] (matches? s "\w+ \w+")))`. Now
the regex engine + semantics are pinned in **one place** (`matches?`, with a documented,
backend-identical subset; divergent features refused there), and the type surface stays clean. General
principle: **sugar only for UB-free, backend-identical refinements (ranges, membership, length);
anything with engine/portability semantics goes through an explicit stdlib predicate.**

#### B-1b — record-field refinements: on the field, and no `:is`
Attach the refinement directly to the field's type — the field *is* the subject, no naming needed:
```
(deftype Cell <- { :mine     <- Boolean
                   :revealed <- Boolean
                   :flagged  <- Boolean
                   :count    <- Int :where (0 .. 8) })
```
**Do not** use `:where name :is (0 .. n)`. It's redundant (base type + subject already given), and
**`:is` collides**: `:is`/`:extends`/`:implements` are reserved for generic *type-variable* bounds
(`:where T :extends Shape` — a type-level relation). Reusing `:is` for a *value* predicate overloads
one token across two semantically different jobs. **Ruling:** `:where <predicate>` for value
refinements (subject implicit; name it via a lambda when the predicate needs it); `:is`/`:extends`/
`:implements` strictly for type-variable bounds. Different features, no shared keyword.

#### B-1c — grammar deltas (all clean against the current EBNF)
```
typeDefDecl        ::= "deftype" modifier* identifier "<-" type refinement? ;
keyTypeDefinition  ::= <Colon> mapKeyType "<-" type refinement? ;   (* record fields *)
refinement         ::= <WhereModKw> ( range | expression ) ;        (* expression = a boolean predicate *)
range              ::= <LParen> expression <Range> expression <RParen> ;   (* sugar -> predicate *)
```
Semantics: check runs at construction and at every coercion into the refined type (rides B-3's pass);
throws on violation. The range desugars to a boolean predicate, so everything downstream is uniform.

### B-2 — native fixed-width integer types
`uint8`/`int32`/`uint64`/… as first-class types → `uint8_t` etc. on C. Their "checking" is a
**boundary coercion** (`Int → uint8` narrows/checks; `uint8 → Int` widens), so they ride the same pass
— they are B-1 without a user-written body (a fixed range refinement on `Int`, materialised as a native
width). Matters for native (packing/FFI/layout); a no-op-to-`Int` degrade on JS.

### B-3 — `defcast :implicit` / `:explicit` (user-defined conversions)
A cast is a stripped function keyed by types (like an operator): **no name**, exactly one param (the
source), a return type (the target), a body.
```
castDefDecl ::= "defcast" modifier* <LBracket> parameter <RBracket> "->" type expression* ;
```
Semantic gate: **exactly one** of `:implicit`/`:explicit` among the modifiers (reuse the modifier
machinery — `:implicit` is a modifier like `:async`, not a dedicated keyword).
```
(defcast :implicit [f <- Fahrenheit] -> Celsius
  (Celsius. (/ (* (- f.value 32) 5) 9)))

(defcast :explicit [m <- Money] -> Int
  (floor m.amount))
```
- **Implicit** fires at coercion sites (assignment / arg / return) — the **coercion pass** inserts the
  cast node. **One hop only** (C#'s rule: at most one user cast per coercion), **lossless widening
  only**, and if a subtype relation already exists prefer it (no cast). Nothing lossy ever fires
  silently.
- **Explicit** fires only at an explicit cast site. `(Celsius x)` is *construction* (parens = call), so
  conversion needs its own form: **`(cast<Celsius> x)`** (proposed — distinct from construction;
  `:as`-based `(as Celsius x)` is the alternative, but `:as` is currently import-alias-only). Pick one;
  it must not collide with construction.
- **Resolution** rides the operator path: a registry keyed by (source, target), devirtualised to a
  direct call at the site — same as operators, keyed by a type-pair instead of symbol+operands,
  inserted by the coercion pass. On C, both are direct calls after devirt.

**Bridge to provable refinements (kept separate on purpose).** Runtime-checked (B-1) is the substrate;
the *provable* version (checker discharges `0..255` / a predicate statically) is a distinct
**verification** project (Liquid-Haskell/F*/Dafny-grade), same predicate syntax, retrofitted later as
an optimisation. **Discipline:** a refinement that can't be discharged **runs its check at runtime,
full stop** — the moment the checker starts opportunistically discharging predicates, the SMT project
has begun without a decision to begin it. Keep the line: coercion-pass enforcement now, verification as
a named later thing; the shared syntax must not blur it.

---

## C. `language-ideas.md` triage — so it isn't re-litigated

### Closed / already covered — delete from the wishlist
- **Tuples** — done (Phase U).
- **Type-guard patterns + `typeof`** — done as `:of` (D41) + `typeof`. The `-> Type =>` arm is a
  second spelling; **rejected** (D41 = one spelling for the type question).
- **Pattern zoo** — built. Predicate-lambda patterns are **redundant with `:when` guards (D26)** —
  rejected. Function-signature patterns already ruled dead (Zc). Expression patterns: skip (murky).
- **Unions / intersections as `deftype`** — already expressible (`|`, `&` exist). The
  `(deftype … :extends … :is …)` shape is **rejected** (conflates alias with declaration; `deftype`
  stays pure algebra + the B-0 arrow).
- **Generic fns + union params** — exist. Only **defaults** are new, and already roadmapped (needs
  `:=` marker + LL0211 required-vs-total-arity + D9). No change.
- **Instance/static-by-dot** — superseded by D1 (dispatch by type).

### Greenlit
- **The B bundle:** refinements (B-1), native fixed-width types (B-2), `defcast` (B-3) — all on the
  coercion-pass substrate, with grammar in §B.
- **`:stack`** — the native probe unlocked it (was a reserved native-only hard error; native now
  exists). Real stack allocation, **needs escape analysis** (a `:stack` value can't outlive its
  frame); interacts with D11. No-op hint on JS.
- **Bounded generics — the three `:where` relations** (`:is`/`:extends`/`:implements`, type-variable
  subject only — see B-1b). Cheap: reuse the existing predicates
  (`typesEqual`/`isSubtype`/`conformsStructurally`). The structural `:implements` bound is the
  D42-native one. The `new()`/ctor constraint is a lower-priority extension.
- **Attributes** — via the **`:with Attr args`** modifier form + making the metadata
  **reflection-readable** (wire into `type`). The bracket `[Attr]` form is **rejected** (second syntax).
- **Flags enums** — `:with Flags` modifier (auto powers-of-two + bitwise). Small, native-friendly.
- **`|> .method` selectors** — small desugar over the existing pipe + method model. Desugar-first.
- **`with`-copy (defrecord scoped to it)** — the functional-update expression `(with s :field v)` is
  the only genuinely new bit; defstruct + Phase R records cover the rest.
- **`:readonly` fields** — let-fields vs mut-fields; a clean D10 extension.

### Deferred + reframed (may revisit; do NOT build as originally specified)
- **Mapped types / `keyof` / `T[P]`** — worst fit (TS type-*computation* in a C#-semantics language;
  fights "elegancy is illusion"). If ever wanted, a **restricted** form via **comptime/macros**,
  procedurally — not a declarative type-level sublanguage. Parked, not closed.
- **Quoted-AST DSL / `eval`** — runtime `eval` fights the native endgame (ship an interpreter). The
  l-lang-native path is a **comptime macro** reading the quoted AST at compile time; blocked on the
  metaprogramming tier (defmacro/defsyntax, still zero grammar). Parked, reframed to compile-time.
  (The homoiconicity question — quote = cons-list vs AST datum — needs settling regardless.)
- **Provable refinements** — the verification project (see B-3), same syntax, later.

### Rejected (closed)
- **`infix` escape hatch** — conflicts D33 (`|>` is the only infix form) and the deliberately-Lisp
  surface. Closed.
- Second-spelling items above (`-> Type` guards, predicate-lambda patterns, `deftype :extends :is`,
  bracket `[Attr]`, `:is` for value refinements).

---

## D. Conditions / restarts ("checkpoints") — grammar, use cases, and the one hard part

**What it is:** the Common Lisp condition/restart system — **resumable exceptions**, a *second*
exception mechanism beside `try`/`catch`, not a replacement. `try`/`catch` (handler-case) unwinds *up*
to the handler. Restarts run the handler **without unwinding** — control stays at the signal point —
then transfer to a marked restart point that can be *below* the handler, unwinding only that far.
That "handle in place, then resume below" is the "goto + try-catch" shape, and it expresses things
`try`/`catch` structurally cannot.

**Cost — moderate, not continuation-heavy.** Because CL runs handlers *before* unwinding, no
continuations are needed: a dynamically-scoped **handler stack** (push on handler-bind), a
dynamically-scoped **restart registry** (push on restart-case, each carrying a `setjmp` point),
`signal` = walk the handler list calling handlers *in the current frame*, `invoke-restart` = `longjmp`
to the chosen point. No stack copying, no fibers — that's what separates it from `call/cc` / algebraic
effects (Koka, OCaml 5), which need captured continuations and *are* the heavy thing. Restarts are the
tractable subset, and the C backend already lowers `try`/`catch` to `setjmp`/`longjmp`.

### D-1 — grammar shapes (spellings open to bikeshed; shapes + semantics are the ruling)
```
;; establish restart points around a body; each restart takes params, runs a body,
;; and ITS return value becomes the value of the whole form when it is invoked.
(restart-case <body>
  (:skip       []  nil)
  (:use-value  [v] v)
  (:retry      []  (parse-line line)))

;; bind in-place handlers around a body. a handler runs WITHOUT unwinding, sees the
;; condition, and may: invoke a restart / return (decline -> next handler) / non-locally exit.
(handle <body>
  (:on MalformedLine  [c] (invoke-restart :skip))
  (:on OtherCondition [c] ...))

(signal <condition-value>)          ;; walk the handler stack; run matches in place
(invoke-restart :skip <args>*)      ;; from a handler: transfer to that restart
```
Keep `handle` **distinct** from `try` (opposite mechanisms). Avoid the name `with-handlers` — Racket
uses it for the *unwinding* kind, so it would mislead.

### D-2 — use cases (each is something `try`/`catch` cannot do)
1. **Parse-and-recover** (canonical). A bad line signals `MalformedLine` with `:skip`/`:use-default`
   restarts established *at the loop*. A strict caller `try`/`catch`es (abort); a lenient caller
   `handle`s and invokes `:skip` — continuing the loop **keeping every good line already parsed**.
   `try`/`catch` unwinds the whole loop and loses them.
2. **Refinement fix-up** (composes with B-1 — flag the ordering). A failed refinement check `signal`s a
   `RefinementViolation` carrying `:clamp` / `:use-default` restarts instead of throwing. `uint8` given
   `300`: no handler → throws (default); a handler → `(invoke-restart :clamp)` → `255` and continue.
   Refinements become *recoverable at the handler's discretion*, not unconditionally fatal.
3. **Supervised recovery** — policy up high, mechanism down low. A supervisor handler decides *what*
   (retry / use-cached / abort); the restart near the failure knows *how*; nothing unwound to reach the
   policy, so recovery runs with full local context.

### D-3 — scope and the one genuinely hard part
**Scope:** the **resumable kernel** — `restart-case` / `handle` (handler-bind) / `signal` /
`invoke-restart`. Skip the full CL apparatus (interactive-debugger integration, `compute-restarts`
reflection).

**The known hard part — hand this to the worktree session up front so it isn't a day-3 surprise:** a
restart transfer **must run intervening `finally`/cleanup/`:destructor` blocks.** `longjmp` is a raw
jump — it does *not* run cleanups between the signal point and the restart target, but semantically it
must (a `finally` between the `restart-case` and the `signal` has to fire during the unwind-to-restart,
exactly as it fires during a catch-unwind). So restarts can't just `longjmp`; they walk and run the
pending cleanup stack on the way. The restart registry and the `try`/`finally` cleanup stack must
**interoperate** — a restart-transfer runs the same finallys a catch-unwind would. The C `try`/`catch`
lowering already manages that cleanup stack; restarts hook the **same** stack, not a parallel one.
Naive `setjmp`/`longjmp` is *not* enough, and skipped-cleanup is a silent-wrong bug — that's why this
is the concentrated cost.

Secondary edges: handler **bind/unbind discipline** (the handler runs with itself unbound so a
re-signal doesn't infinitely recurse); **value semantics across the raw jump** (a D11 copy in flight
must be left consistent; `:destructor`s between signal and restart have the same "run during transfer"
obligation as `finally`).

**JS refuses first — inverting coroutines.** JS has no resumable exceptions, so on JS this is CPS /
generator emulation or (cleaner for v1) an **honest refusal with a diagnostic**, exactly as C refuses
coroutines today — the mirror image (JS-free coroutines / C-refused; C-native restarts / JS-refused).
**The worktree session targets C**, refuses on JS.

---

## Sequencing across all of the above

1. **Core cheap drains** (§A seq 1): `HCopyStore`, field-get slot on `HMemberRead`, callee-identity on
   call nodes. Closes the A5 divergence hole; big dip drops.
2. **`HMatchTest`** (§A seq 2).
3. **Closure representation** (§A seq 3) — the one real core design commitment.
4. **The B bundle on the now-solid coercion substrate:** B-0 tokens (`deftype <-`, `..`, `:where`) →
   native fixed-width (B-2) → refinements (B-1, predicate + range sugar + regex-via-stdlib) →
   `defcast` (B-3). Exercises the coercion pass under real load.
5. **Bounded generics + the small ergonomics** (`|> .method`, flags, `with`, `:readonly`,
   attributes→reflection) as low-friction fill-in.
6. **Conditions/restarts** on the native path (parallel worktree, C-targeted) — the resumable kernel,
   with the cleanup-stack interop as the known hard part.

**Standing note:** everything greenlit is JS-safe (degrades, no-ops, or refuses honestly on JS), so
none of it *depends* on native surviving — it pays *extra* if native does. The useful half stays
self-justifying; native is upside, not a prerequisite.
