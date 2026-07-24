# Side-quest recon — Dove's stdlib roadmap × the games findings, sorted

**What this is.** Two intel sources landed at once: `dove-stdlib-roadmap.md` (an audit of `lib/std`
and a 10-module build plan) and `../l-lang-games/FINDINGS.md` (a second-pass rewrite of seven games
against l-lang, 11 new findings). This document merges them into one work map.

**Method — nothing here is taken on trust.** Both source documents were written against `96789ba`;
HEAD is five commits past it (G4c/G4d/G5/G6a/G6b). So every claim that could be measured was
re-measured: **14 probes on both backends**, the games suite re-run, and the stdlib tree counted
rather than described. Where a source document is wrong, §2 says so with the measurement. The
compiler was rebuilt first — `dist/` was stale by five commits, so probing it unbuilt would have
measured this morning's compiler.

---

## 0. Update (2026-07-24) — committed as the stream lands

This document is being committed now (§6's open question #4, resolved: yes). Landed since it was written,
so the lanes below read partly as history:

- **Lane A — DONE** (S1a–S1d). **N12 (the one item routed to Lane B) is now CLOSED too** — it was a
  missed *hoist* on the C dotted-read path, not a missed box (gap ledger §15.3, commit `864ccee`).
- **Lane B — mostly DONE.** §9.2 (C field-layout trap) was never a layout bug — C construction mapped
  args to slots by raw index; fixed (`89cf9c7`). §15.2/§15.7 (the imported-body type channel) closed by
  porting `carryTypesInto` to C (`48c4c2c`). **N18-b** (imported/concretely-typed `:extension` receiver →
  ELL0106) closed by routing C's typed-receiver dispatch through the forest-wide resolver — surfaced by
  making `caused-by` an `:extension` (`b50a95a`, ledger §19). N19 (boxed container-element operand to an
  overloaded operator) remains open.
- **Lane G — DONE.** The errors foundation is complete: `Error` is l-lang-owned + ambient (F1), the typed
  tower + `cause` field ship, the C message-only builtin is retired. See `errors-foundation-blockers`.
- **Lane E — bit operators DONE** (D61). `random`/`fft`/hash all unblocked. Now the protocol family's
  `hash-of` dogfoods them.

**Now landing (Phase S3, first tranche):** the protocol family (`Comparable`/`Hashable`/`Formattable`) +
`std/test` + `std/debug`. Lane F's remaining Tier-0/1 content (`std/cli`, `std/log`, `json`, `random`,
`collections`, …) follows in its own sessions.

---

## 1. The headline: both documents found the same blocker, from opposite ends

Dove's roadmap, ruling #9 in its shopping list:

> **LL0218 (duplicate cross-module symbol) lands *before* the module count doubles.**

The games rollup, its own headline:

> **Nine of the eleven new findings are about crossing a module boundary.** [...] the single
> highest-leverage fix is not a feature, but a seam.

These are one finding. Dove inferred it from the library side — *"I am about to add ten modules to a
package system and something feels thin"* — and named the one gate it knew about. The games proved it
from the program side, with repros, by being the first multi-file programs the project ever had. The
games corpus stopped being seven single files and **nine distinct things broke on the way across a
file boundary**, one of them silently changing arithmetic.

**The consequence for sequencing is direct.** Dove's build order (§9 of the roadmap) starts with
`parse-int` and adds roughly ten modules — every one of them *imported code*, which is precisely the
category the games measured as broken. Executing that order as written means building ten new modules
on the seam that just failed nine times, and the failures are the silent kind.

This is the recon's single load-bearing conclusion. Everything in §5 follows from it.

---

## 2. Corrections to the source documents

Six, all measured at HEAD. Listed because both documents will otherwise be read as current.

### 2.1 The games' refusal table is stale in its biggest row — `:gen` on C is DONE

The games document says:

| construct | code | consequence |
|---|---|---|
| `:gen` generators | ELL0105 | takes **all of `std/iter/linq`** with it |

That was true at `96789ba` and is false at HEAD. G4c landed the coroutine state machine, G4d the
`:extension` method surface, G5 disposal. Measured, one file, both backends:

```
JS:  30 40 50 60 / gen 1 gen 2 gen 3 gen 4
C :  30 40 50 60 / gen 1 gen 2 gen 3 gen 4     <- byte-identical
```

— a `:gen` function driven by `for :each`, *and* a chained `(((seq […]).filter f).map g).to-list`
pipeline. **Dove's Tier-3 item #3**, which the roadmap calls *"the single biggest
is-the-stdlib-real-on-C multiplier"*, is retired. `:async` stays refused, correctly (D60).

### 2.2 N18 is two independent defects, not one four-shape table

The dungeon report presents `:extension` dispatch as a 4×2 table of receiver shapes. That table
conflates *shape* with *import*, and the two axes turn out to be separate bugs. Measured at HEAD:

| receiver shape | same file, JS | same file, C | imported, JS | imported, C |
|---|---|---|---|---|
| simple local `(a.manhattan b)` | ✅ | ✅ | ✅ | ✅ |
| prefix `(manhattan a b)` | ✅ | ✅ | ✅ | ✅ |
| constructed `((V 0 0).manhattan b)` | ✅ | ✅ | ✅ | ❌ ELL0106 |
| member chain `(h.v.manhattan b)` | ❌ TypeError | ✅ | ❌ TypeError | ❌ ELL0106 |

Read down the columns instead of across the rows and it separates cleanly:

- **N18-a (JS)** — a *member-chain receiver* lowers to a genuine property access instead of the
  emitted free function. Independent of import; fails in a single file. JS only.
- **N18-b (C)** — an *imported* extension over a **concretely-typed** receiver has no entry in the C
  extension table. Independent of shape beyond the simple/prefix pair; same-file works for every
  shape. C only.

G4d closed the *boxed*-receiver method surface (every `Iterable<T>`, which is what the whole lazy
library rides). N18-b is the concretely-typed sibling of the same gap and is the natural follow-on;
N18-a is unrelated and lives in the JS emitter.

### 2.3 `std/core/errors` is absent from the tree, not just from the merge

Dove flags this as *"known to exist and absent from the merge — its row is inferred from the ledger,
not read."* It is absent from `lib/std/core/` altogether (`async`, `string`, `types`, `package.yaml`).
It was started and **deliberately deferred mid-phase**: it excavated a chain of latent inheritance
bugs, being the first class hierarchy in l-lang more than one level deep. Four rulings are already
taken and the blocker chain is measured — see the `errors-foundation-blockers` note. Dove's two
travelling notes (the §9.2 C field-layout trap, and the duplicate-symbol gate) are both correct and
both still open; §9.2 re-verified at HEAD below.

### 2.4 LL0218 is already occupied

Dove's ruling #9 names **LL0218** for the duplicate-cross-module-symbol gate. That code is taken:

```
LL0218  TypeOfStringLiteral  (Warning)
        'type' reflects a VALUE, and a string literal's type is always String …
```

Highest allocated in the band is **LL0239** (G1's generator refusals), so the gate wants **LL0240**.
A small correction, but the kind that costs an hour if it is discovered during implementation.

### 2.5 All eleven games findings reproduce at HEAD — and the corpus is green anyway

Every one re-probed; not one was incidentally fixed by the G-phase work. The games suite still reports
**15 passed, 0 failed** against HEAD, which is the important subtlety:

> The games corpus is green **because it routes around every finding**, not because they are absent.

`int-div` exists because of N14. `core.lisp` uses `let` constants because `defenum` (N11) cannot cross
a file. Boids abandoned extension sugar because of N18. Sokoban's `Game` carries a vestigial `start`
field purely to have a ctor parameter (N16). Every workaround is a finding wearing a disguise, and a
green suite does not report any of them.

### 2.6 N14 is currently dodged by an unwritten convention in the stdlib

N14 — an imported body loses its static types, so `(/ Int Int)` silently becomes **Real** division —
reproduces exactly (`3.5` on JS, `3` on C, from a function declared `-> Int`, no diagnostic from
either backend). The obvious next question is whether it is *already* corrupting the stdlib, since the
stdlib is imported code by definition. It is not, and the reason is worth recording:

**Every division site in `lib/std` is already written defensively.** 120 sites, and each one either
forces the operands Real (`(/ (sum-n xs n) (* 1.0 n))`, `(/ … 2.0)`, `(/ p 100.0)`) or wraps the
result (`(Math.trunc (/ coll.length 2))`, `(truncate …)`). Nowhere does the current stdlib divide two
`Int`s and keep the result as an `Int`.

So the stdlib is correct today by a discipline **that is nowhere written down** — the same workaround
the games repo eventually formalized as `common/num.lisp`'s `int-div`. Every new module written by
someone who has not read this paragraph is silently exposed. That makes N14 a *precondition* for
Dove's build order rather than a parallel concern.

---

## 3. The sorted map — seven lanes

Everything from both documents, plus the open ledger items, sorted by **what kind of fix it is**
(which is what determines who can work on it and what it can be batched with) rather than by which
document it came from.

### Lane A — the module boundary (the seam) — **CLOSED 2026-07-23, Phase S1**

The convergence lane. Two mechanisms, six findings, one Dove ruling. All landed as S1a–S1d
(`2fb45b9`, `6392a46`, `02c0965`, `2eaaa24`); root causes in gap-ledger §15.

| item | mechanism | status |
|---|---|---|
| **N1** imports re-export transitively and outrank the module's own exports | names cross out that shouldn't | ✅ S1b |
| **N15** a package's *private* siblings leak into importers and shadow them | names cross out that shouldn't | ✅ S1b |
| **N2** a leaked sibling is then re-exported under the importer's name | names cross out that shouldn't | ✅ S1b |
| Dove #9 duplicate cross-module symbol gate (**LL0240**, not LL0218) | the same fence, from the other side | ✅ S1c |
| **N14** an imported body loses its static types → `Int/Int` becomes Real | information doesn't cross in | ✅ S1a (JS; see below) |
| **N11** an imported `defenum`'s members lower to undefined identifiers | information doesn't cross in | ✅ S1d (both backends) |
| **N12** `.length` on an imported module-level vector misses a box | information doesn't cross in | ⬜ survived → Lane B |

**N1/N15/N2 turned out to be ONE bug**, not three: `resolveSymbol`'s fall-through is a flat
first-wins union over every loaded module root in join order, so a stdlib module always won. The
fence was never wrong — `checkSymbolVisible` asks the right questions and was handed the wrong symbol.

**N14 needed three fixes in series**, each found by measuring after the previous one failed to close
it: the symbol table indexed the pre-desugar tree, the type channel was replaced per module rather
than accumulated, and the inliner then cloned away what both restored.

**Two things S1 did not close, both routed to Lane B and both measured rather than assumed:** N12
survived (§15.3), and `field := (/ Int Int)` in an imported method traps on C — pre-existing, verified
byte-identical against a clean worktree at `02a33d0` (§15.2). The second also *corrects* N14's
write-up: C is "right by accident" for a free function, but a hard trap in the field-assignment shape.

**Residual inside S1b, stated:** ~50 of 63 `resolveSymbol` call sites pass no `from` (type refs,
`:extends`, `new`, most of codegen), so a cross-module TYPE-name collision keeps the old behaviour.
That is the `from`-passing migration, and it is its own phase.

**Leak surface, counted:** 26 modules declare **244 top-level names**, of which **32 are private** and
leak into every importer (`iabs`, `gcd-int`, `itrunc`, `ifloor`, `rabs`, `digit-of`, `sorted-copy`,
`simpson1`, `adapt`, `min-int`, `sum-n`, `mean-n`, …). The games measured 7 of those 32 actually
colliding. Dove's roadmap adds ~10 modules, which grows the set the only defence — *"never reuse a
name the stdlib uses, exported or not"* — has to be checked against by hand, against `lib/`.

### Lane B — C emitter gaps (boxing and dispatch)

| item | shape |
|---|---|
| **N19** a container element's member handed to an overloaded operator | element arrives boxed → member read yields `ll_value` → devirtualized operator wants `ll_obj*`. Missed unbox, caught by `cc` |
| **N12** (C half) `.length` on an imported hoisted global | `ll_dyn_length(u_GLYPHS)` with `u_GLYPHS` declared `ll_vec*`. Missed box |
| **N18-b** imported extension, concretely-typed receiver | ELL0106 `no CIR lowering exists (resolveObjMethod)` |
| **ledger §9.2** C field-layout trap | re-verified at HEAD: `TypeError: expected an Int`, JS correct. Blocks plain fields on deep error nodes |

Same family as the whole G-phase: `ResolveHirToCir` / `InsertCoercions`. N19's sting is that
`(+ acc o.v)` in a loop over a flock *is* the canonical reason to have operator overloading.

### Lane C — JS emitter and checker gaps

| item | shape |
|---|---|
| **N16** `(fn :ctor init …)` silently skipped when the class has no ctor params | emitted JS has no `constructor` at all; `init()` is a never-called method. C runs it |
| **N18-a** member-chain `:extension` receiver | lowers to a property access; clean compile, runtime `TypeError` |
| **N9** `ELL0102` is JS-only | C accepts and runs the same source — *"does this compile?"* has two answers |
| **ledger §10** `cond` in a lowered library module | `ELL0100 visitCond is not implemented` on the JS leaf path; HIR path desugars it, the leaf one never learned to |
| **ledger §11.3** nested `:gen` bound with `let` crashes JS | open |
| **ledger §11.2** anonymous `(fn :gen [] …)` does not parse | open |

### Lane D — value-semantics divergence

**N10** — `(arr.push struct)`: **JS copies, C aliases.** D11 says a struct is copied wherever it moves
into a new home and a collection slot is a listed home. Half-fixing a value-semantics rule is worse
than not fixing it, because the same source now means two different things on the two backends.

(**N17** — read-modify-write through a bound element: `defstruct` loses the write, record keeps it —
is *documented and correct on both backends*. A hazard, not a bug. It belongs in a teaching document,
not a fix list. Recorded so nobody "fixes" it.)

### Lane E — language items with a stdlib consumer waiting

Dove's Tier 3, re-verified:

| item | consumer waiting | status |
|---|---|---|
| **bit operators** (`band bor bxor bnot shl shr`) | `std/math/random`, `std/math/fft`, any hash protocol | genuinely absent from the floor. Both backends trivial; semantics ruling is small |
| **spread call** `(call f ...args)` | `std/fn`'s portability, `std/sys/timers` callbacks-with-args | confirmed absent: `ELL0211 'add3' expects 3 arguments, got 1` |
| **lambda return-type inference** | the type-quality of the whole lazy library (`map` answers `Iterator<Any>`) | open |
| **hash/equality protocol** | `std/collections` Set/Map stage 2, `distinct` at O(n) | needs a design round, not a patch |
| **function argument defaults** | pressure accumulating; stdlib compensates by multiplying names | deferred by standing ruling |
| ~~`:gen` on C~~ | ~~the entire lazy library~~ | **DONE** (§2.1) |

### Lane F — stdlib content (Dove Tiers 0/1/2)

Unchanged from the roadmap and not re-litigated here. Tier 0: `parse-int` (Dove calls it *"the single
highest-value function in this document"* — confirmed absent, nothing in `lib/` mentions it),
`replace`/`find`, char classes, `StringBuilder`, `(split s "")`; linq's missing shelf
(`first`/`last`/`any`/`all`/`find`/`min`/`max`/`sum`/`distinct`/`chunk`/`group-by`/`sort-by` — the
15 present operators confirmed by export list); `std/seq`'s mirror holes; map ergonomics. Tier 1:
`std/test`, `std/cli`, `std/log`, `std/data/json`, `std/collections`, `std/os/path`,
`std/math/random`, `std/time/date`, `std/text/regex`. Tier 2: `parse-real` + five fs floor entries.

### Lane G — the errors foundation

Mid-phase, four rulings taken, blocker chain measured (`errors-foundation-blockers`). Its remaining
blockers are **Lane B** (§9.2 field layout), the `:extern Error` removal, the checker's ctor-arity
count on redeclared inherited fields, and a 33-file corpus migration. Named as its own lane because
its blockers span three others.

---

## 4. The dependency edges that actually matter

Most of the above is independent. Four edges are not, and they are what the ordering has to respect.

1. **Lane A blocks Lane F, entirely.** Every Tier-0/1 module is imported code. N14 silently changes
   arithmetic in it, N15 leaks its privates, N1 re-exports its imports. Ten new modules multiply all
   three. Dove's own ruling #9 says the gate lands before the module count doubles; the games say the
   same thing louder.

2. **Lane B (§9.2) blocks Lane G.** The error tower cannot give deep nodes plain fields on C —
   `Error.cause` is the named casualty — until the field-layout trap is fixed.

3. **Lane E (bit operators) blocks two Tier-1 modules** (`random`, `fft`) and the hash protocol
   behind `collections` stage 2. It is the cheapest item in Lane E and unblocks the most.

4. **The iterator/iterable round is inside this side quest, not beside it.** This is the edge worth
   flagging, because it changes what "park G6, pick up the iter stream" means. Dove's Tier-0 linq
   completion (`first`, `any`, `all`, `find`, `distinct`, `chunk`, …) is a set of `:extension`s over
   `Iterable<T>` — so the `Iterable<T>` / `Iterator<T>` split decides their signatures before they
   are written. And ledger **§14.3** (the backends disagree on what `iter()` returns) and **§14.4**
   (`for :each` disposal, unbuilt) are both waiting on the same split. Doing linq completion first
   means writing a dozen operators against a protocol that is about to change.

---

## 5. Proposed order

Three phases. The argument is: **fix the seam, then build on it** — and take the two cheap unblockers
along the way because they cost hours and unblock days.

**Phase S1 — make the module boundary load-bearing (Lane A). ✅ DONE 2026-07-23.**
The export list becomes a fence in both directions (N1, N15, N2 + the LL0240 gate — one mechanism,
four symptoms), and an imported body keeps what the checker knew about it (N14, N11, N12). N14 first
within the phase: it is the only *silent wrong answer* in the set, and §2.6 shows the whole stdlib is
currently dodging it by an unwritten convention. Every fix here is guardable by an adversarial corpus
file plus a two-file import fixture, and `test:imports` already exists as the home for them.

**Phase S2 — the two cheap unblockers, then the iterator round. ✅ DONE 2026-07-23.**
Bit operators landed as **D61** (`1661571`): `band bor bxor bnot shl shr`, Int-only, 64-bit wrap,
shift counts masked to 0–63, arithmetic `shr`. `std/math/random`, `std/math/fft` and any hash protocol
are unblocked.

The iterator round landed as `47c0488`, and the split turned out to be *already there* nominally —
D30 has declared `Iterator<T> :implements Iterable<T>` all along. What was missing was that the ruling
**was not true on JS**, for two reasons: the `[Symbol.iterator]` bridge tested the literally-written
`:implements` list (so declaring the *more precise* interface got no bridge and `for :each` threw),
and `iter` wrapped unconditionally (so a cursor had no identity, no `dispose`, no type). Both fixed;
ledger §14.3 closed; `(== (iter c) c)` is now true on both backends.

**§14.4 is unblocked but NOT built, and deliberately so** — it is now a semantics ruling rather than
an obstacle. See the ledger: the corpus idiom `(fn iterator [] (return this))` makes cursor and source
one object, so a disposing `for :each` would spend the source. Three defensible answers written up,
none taken.

**Phase S3 — Dove's build order, as written.**
`parse-int` → linq/seq completion → `std/test`/`std/cli`/`std/log` → `random` → `json` → fs → …
By then it is being built on a boundary that holds, with the operator signatures settled.

**Lanes B, C, D stay opportunistic.** They are real defects but none of them blocks a phase: N19 and
N18-b are C emitter follow-ons in exactly the area the G phase has been living in, N16 and N18-a are
JS emitter bugs, N10 is a D11 conformance fix. Each is a well-scoped commit that can be taken
whenever one is wanted; none should be allowed to gate S1.

**What this order costs.** It puts roughly a week of seam work in front of a roadmap whose first step
Dove costed at *hours*. That is the trade being proposed, and it is worth stating plainly rather than
burying: the alternative is ten new modules whose bugs look exactly like bugs in the caller's own
logic.

---

## 6. Decisions

### Taken (2026-07-23, Sabaka — do not re-litigate)

- **The order stands as proposed: S1 → S2 → S3.** The seam goes before the roadmap. The
  `parse-int`-as-a-one-off variant was offered and not taken, so Phase S1 opens the stream.
- **Bit operators — Dove's §6/#1 ruling accepted in full.** Names `band` `bor` `bxor` `bnot` `shl`
  `shr` (the word spellings, not operator symbols — a D21 naming call, now made). Defined on **Int
  only**; wrap at **64 bits** (the `-fwrapv` + BigInt-masking regime D51 already established); shift
  counts **masked to 0–63**; `shr` is **arithmetic** (sign-propagating), with `ushr` if a consumer
  ever appears. Both backends have native operators, so the cost is the ruling, not the lowering.
  Lands in Phase S2 and unblocks `std/math/random`, `std/math/fft`, and any future hash protocol.
  Gets its D-number and its DECISIONS.md entry in the commit that implements it.

### Still open — none blocking S1

1. **How wide is the Lane A fix?** Enforcing the export list in both directions is a module-resolution
   change with the whole corpus and all 26 stdlib modules downstream of it. Default: **S1 opens with
   its own plan round** rather than being executed from this document.
2. **Lane D / N10** — confirm D11's reading that a collection slot is a copying home, then fix C to
   match JS. One-line ruling, then a C-side change. Opportunistic; does not gate a phase.
3. **LL0240** for the duplicate-symbol gate (LL0218 is taken). Taken as the default unless objected to.
4. **Does this document get committed?** `dove-stdlib-roadmap.md` is being held local until the
   current stream lands; this one is currently held with it.

---

*Everything in §2 was measured at HEAD (`02a33d0`) with a freshly built compiler. The probe fixtures
are in the session scratchpad; each is 4–15 lines and reproduces standalone.*
