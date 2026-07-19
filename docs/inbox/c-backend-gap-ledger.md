# The C backend as an adversarial probe of the HIR contract — gap ledger

**What this is.** The `hir-llvm-consumption-spec.md` states assumptions A1–A8 as *negative space* —
what a native backend would need that the HIR doesn't yet carry, inferred from what the JS emitter
silently absorbs. This document is the **empirical companion**: the same assumptions, but measured by
building a real typed backend (C11) that consumes the HIR and recording *every place it had to reach
below the HIR* — into the raw AST, the `nodeTypes` channel, or the symbol table — to get a working
program out. Green corpus files were the vehicle; the ledger is the deliverable.

The C pipeline is deliberately **fail-closed and structural**: P1 (`ResolveHirToCir`) may touch
`h.src` children / `nodeTypes` / symbols **only** through three helpers — `dipAst`, `dipNodeTypes`,
`dipSymbols` — each of which requires an `(assumption, construct, note)` triple and records a
`GapEntry` before returning. So the ledger isn't editorializing after the fact; it's a machine-generated
census of contract violations, one per dip, aggregated by `assumption:construct` across the whole corpus.

Everything below cites counts reproducible with:

```bash
npm run test:c -- --gap-ledger /tmp/ledger.json     # dumps the full census + a summary table
```

Status at time of writing: **draft** (Phase E, pre-broad-sweep). Numbers are the pre-sweep census;
the sweep that follows drains the refusal frontier and will move them.

---

## 1. Method

```
typed AST ─(shared LowerAstToHirVisitor)→ HIR
HIR  ─(P1 ResolveHirToCir)→   CIR        opaque leaves resolved; ALL dips recorded here
CIR  ─(P2 InsertCoercions)→   CIR+casts  Grift-style c-box/c-unbox/c-cast at typed↔Unknown edges
CIR  ─(P3 EmitCirToC)→        C11 source  mechanical; consumes ONLY CIR; hard-fails on any gap
```

Two design choices make the counts meaningful:

- **Boxed-`Unknown` is the *only* home of the fat pointer.** Concrete statics stay native C
  (`Int`→`int64_t`, `Real`→`double`, `Bool`→`bool`, `Char`→`uint32_t`, `String`→`ll_str*`, structs→
  `ll_obj*`). Every time a value falls to the boxed `ll_value` because its type was unavailable, that
  is a measured A1 dip — the box is a *representation of a missing type*, exactly the spec's framing.
- **Container elements and object fields are uniformly boxed.** This inflates A6 (box/unbox) counts by
  construction — flagged here so the A6 number is read as "coercion traffic under a maximally-boxed
  element repr," not "irreducible coercion need."

The **ratchet** (`src/test/c-status.ts`, `C_PASSING`) pins the green set: listed-and-failing = red
(regression), unlisted-and-passing = red (RATCHET: add it), refused (LL0105–07) = informational. A
green file is a file whose C output diffs byte-for-byte against the *same* `.expect` golden the JS
backend is checked against — the goldens bake in node's `util.inspect` format, so print parity is
load-bearing, not cosmetic.

---

## 2. Scoreboard (corpus-wide, pre-sweep)

| Outcome | Count | Meaning |
|---|--:|---|
| ✅ Pass | 49 | C output == golden, byte-for-byte |
| ❌ Fail / 💥 Error | 0 | no regressions, no emitter crashes on the green set |
| 🚧 Not-yet | 19 | unlisted-failing (cc error, output mismatch, or runtime trap) — the frontier |
| 🚫 Refused | 25 | honest LL0105/06/07 diagnostics (coroutine / no-lowering / host-global) |
| 📚 Library / 🧪 Fixture / ⏳ XFail | 22 | not executable as standalone `node` programs by design |
| **Total** | **130** | |

**Total recorded dips: 8 240**, distributed:

| Assumption | Dips | One-line |
|---|--:|---|
| A3 — calls modeled | 2 710 | the biggest hole: no call node exists in the HIR at all |
| A2 — atoms modeled | 2 469 | every variable read and decl is an opaque leaf |
| A5 — copy/coerce decided | 807 | the D11 value-copy decision lives nowhere in the HIR |
| A1 — types on every node | 789 | `nodeTypes` misses identifier *uses*; fall back to symbols |
| A9-extern — the extern boundary | 642 | **new**: unmodeled by the spec; every program preludes `std/js` |
| A4 — construction modeled | 363 | constructors/field layout reconstructed from the symbol table |
| A6 — coercions inserted | 166 | the P2 pass's own traffic (backend pipeline, not a core cut) |
| A7 — pattern tests modeled | 144 | match decomposed from the raw `PatternNode` |
| "new" bucket | 126 | findings with no A-row: see §4 |
| A8 — coroutines / native machinery | 24 | refused (coroutines) or lowered to native (try/throw) |

The shape is the headline: **A3 + A2 = 63% of all dips.** The HIR's two largest holes are the two
most fundamental things a backend does — *name a value* and *call something*. Everything else is a
rounding error against those two. That is the empirical case for prioritizing the atom/call node
families (spec Steps 3–4) above all other cuts.

---

## 3. Per-assumption evidence

Each table: `construct` = the specific shape that forced the dip, `dips` = aggregate count, `files` =
distinct corpus files, `via` = which dip-helper (the channel reached into), `exemplar` = one cite.

### A1 — Every value node carries its own non-`undefined` type

The type channel is `nodeTypes` (identity-keyed by raw AST node) plus `SymbolTable.inferredType`. The
recurring failure: **identifier *uses* are frequently absent from `nodeTypes`**, so a ref's type must
be chased through the symbol table's binding — precisely the A1/A2 entanglement the spec predicts.

| construct | dips | files | via | note |
|---|--:|--:|---|---|
| `ref-type-via-symbols` | 415 | 62 | symbols | identifier use missing from the channel; type from the binding |
| `param-untyped` | 160 | 41 | symbols | parameter type unavailable → boxed |
| `mut-decl-narrowed` | 109 | 28 | symbols | a `mut` decl's channel type is the initializer's *narrowing*, not the declared type |
| `index-boxed-base` | 51 | 7 | — | index base has no static container type → boxed element |
| `foreach-elem` | 21 | 10 | — | collection element type unknown → boxed loop var |
| `ref-untyped` / `vector` | 33 | 9 | — | no channel *or* symbol type; boxed |

**Workaround:** resolve the binding through `SymbolTable.resolveSymbol().inferredType` when
`nodeTypes` misses. **The `mut-decl-narrowed` row is the sharpest A1 finding**: the channel stores the
*narrowed* initializer type, so `(mut x 0)` later assigned a `Real` reads back as `Int` from the
channel — a backend that trusted it would mis-lay-out the slot. The declared type has to come from the
symbol table instead. This is a concrete instance of "the channel type is not the layout type."

### A2 — Atoms are modeled, not opaque

| construct | dips | files | via | note |
|---|--:|--:|---|---|
| `atom-ref` | 1 513 | 86 | AST | a variable read is an `HOpaqueExpr` leaf |
| `decl-structure` | 447 | 75 | AST | binding name/mutability read from the raw `VariableNode` |
| `assign-target` | 169 | 38 | AST | assignment target from raw AST (the `emitAssign` legacy seam) |
| `formatted-string` | 146 | 47 | AST | interpolation segments from raw AST |
| `decl-type` / `binding-type` | 150 | 30 | symbols | declaration/binding type through the symbol table |
| `foreach-variable` | 44 | 21 | AST | loop binding from the raw `ForEachNode` (`emitForEach` seam) |

**Workaround:** `resolveAstExpr`/`resolveAstStmt` re-drive off `h.src`. **`atom-ref` at 1 513 dips
across 86 of ~90 executable files is the single most-hit construct in the entire corpus** — literally
every program reads a variable, and every read is opaque. This is Step 3's mandate (`HRef`) stated as
a number. Note `HLiteral` already landed on `dev` mid-probe and was chased here (the exhaustive CIR
switch flagged it at compile time); the ref half is what remains.

### A3 — Calls are modeled (kind + callee identity on the node)

| construct | dips | files | via | note |
|---|--:|--:|---|---|
| `call-dispatch` | 1 960 | 95 | AST | call kind/callee resolved below the HIR — **there is no call node** |
| `function-signature` | 239 | 61 | symbols | signature through the symbol table |
| `callee-identity` | 121 | 38 | symbols | callee resolved through symbols (spec wants it *on* the call node) |
| `member-dyn` / `method-dyn` | 181 | 33 | — | boxed receiver → runtime member/method dispatch |
| `on-demand-lower` | 55 | 9 | — | imported body not pre-lowered; lowered on demand |
| `method-devirt` / `operator-*` | 85 | 23 | symbols | method/operator overload devirtualized to a direct call |
| `closure-call` / `closure-lift` / `function-as-value` | 50 | 20 | symbols | first-class function → boxed calling convention |

**Workaround:** `resolveConstruct`/`resolveObjMethod`/`binopMode` reconstruct the call shape from the
raw call AST plus symbol lookups. **`call-dispatch` at 1 960 dips / 95 files is the largest single
number in the ledger.** The HIR has no `HCall` — every call is an opaque expression whose kind (free
function / method / intrinsic / closure / operator) the backend must re-derive. This is the strongest
evidence in the document for Step 4 (the `HCall`-kinds family), and the sub-rows are a ready-made
taxonomy for that node's variants.

### A4 — Construction is modeled (constructors, field layout, `super`)

| construct | dips | files | via | note |
|---|--:|--:|---|---|
| `field-get` | 190 | 20 | symbols | struct field access → slot index from the descriptor |
| `construct` | 91 | 24 | symbols | construction resolved from the symbol table (no HIR node) |
| `defclass` / `defstruct` | 44 | 25 | symbols | field layout reconstructed from the symbol table |
| `field-store` | 32 | 9 | symbols | struct field *store* → slot (partial: mutable-field frontier, see §5) |
| `inherit` | 6 | 4 | symbols | parent field/method flattening walked below the HIR |

**Workaround:** a `registerClass` pass reads the symbol table to build `ll_class` descriptors (name,
is_struct, ordered field names, parent), and every field access/construction is resolved against those
descriptors. **The HIR carries none of this** — as the spec says, "every emitted constructor is an A4
entry." The field layout, the slot assignment, the inheritance flattening: all reconstructed. This is
Step 5 (`HConstruct`/`HFieldInit`), and the `field-store` row is the live edge the sweep extends.

### A5 — The copy/coerce decision is a node, not a flag

| construct | dips | files | via | note |
|---|--:|--:|---|---|
| `return-store` | 405 | 69 | synth | the `isStore` flag stands in for an explicit copy node |
| `param-copy` | 159 | 44 | synth | callee-side D11 copy-on-entry (struct/boxed param by value) |
| `copy:let-decl` | 122 | 36 | synth | explicit CP3 value-copy at a `let` store site |
| `foreach-copy` | 42 | 21 | synth | per-iteration element copy |
| `copy:collection-elem` / `copy:user-assign` / `copy:field-init` | 55 | 25 | synth | copy at other store sites |
| `mut-capture-cell` | 16 | 7 | synth | `mut` captured by a closure → shared heap cell |
| `index-store` | 8 | 5 | — | index-assignment lvalue (partial write) |

**Workaround:** the CP3 value-copy decision (D11) is *synthesized* by the backend at each of the six
store sites, because the HIR only records an `isStore` boolean, not *where a copy must be inserted*.
`return-store` at 405 dips shows the reach: two-thirds of executable files return a value and each
return is a place the backend had to decide "copy or share." This is Step 6's `HCopyStore` — and A5's
reversibility (decision-as-node, materialization-as-backend-code) is exactly what let the C backend
pick shallow-at-reference without the HIR committing to it.

### A6 — Coercions inserted at typed↔`Unknown` edges

| construct | dips | files | note |
|---|--:|--:|---|
| `boxed-arith` | 72 | 24 | boxed operand in arithmetic → runtime tag dispatch (**cannot narrow an Unknown to a guessed native**) |
| `coercions-inserted` | 67 | 1 | box/unbox/cast nodes the P2 pass actually minted (self-report) |
| `boxed-compare` | 27 | 10 | boxed operand in comparison → runtime tag dispatch |

**This is the assumption the typed target *validated the hardest*, and it surfaced a genuine
soundness bug.** `boxed-arith`/`boxed-compare` record every site where an operand was boxed-`Unknown`
and the operation therefore *had* to dispatch on the runtime tag. The probe found the failure mode
concretely: a pattern-bound `n` holding a `Real` (from `Math.random`) hit `(< n 0)`; an earlier
version unboxed it as `Int` on a guess and trapped. **A boxed-`Unknown` cannot be narrowed to a
guessed native type** — the JS backend never notices because it dispatches on the runtime tag for
*everything*; the C backend must either carry the box through the op or have a real static type. That
bug is invisible on an untyped target and is precisely what an adversarial typed backend exists to
expose. A6 is not a *core* cut (it's the pipeline pass the spec already assigns to the backend); the
count measures coercion traffic, deliberately upper-bounded by the maximally-boxed element repr.

### A7 — Pattern tests are modeled

| construct | dips | files | via | note |
|---|--:|--:|---|---|
| `pattern-test` | 103 | 15 | AST | pattern decomposed from the raw `PatternNode` (`generateCondition` seam) |
| `hoist` | 25 | 15 | AST | pattern variable set computed from the raw `MatchNode` (`patternVars` seam) |
| `pattern-guard` | 14 | 4 | AST | guard expression from raw AST |
| `type-test` | 2 | 1 | — | runtime type test → `ll_is_type` (D41) |

**Workaround:** P1 expands `HPatternTest` into a bind-then-test comma sequence `(v = scrut, test)` and
`HHoist` into boxed variable declarations — the A7 decomposition, executed. The spec's `HMatchTest`
would move this structure onto the HIR; today the match arms are reconstructed from the raw
`MatchNode` on both the test and the variable-hoisting side.

### A8 — Coroutines refused; native machinery lowered in the backend

| construct | dips | files | disposition |
|---|--:|--:|---|
| `generator` | 9 | 3 | **refused** — LL0105 (no suspend/resume model in the HIR) |
| `async` | 6 | 2 | **refused** — LL0105 |
| `throw` | 7 | 2 | lowered to `longjmp` |
| `try-catch` | 2 | 2 | lowered to `setjmp`/`longjmp` handler stack |

**Workaround / refusal:** coroutines are refused with an honest diagnostic, as the strategy lane
settled (state-machine lowering is future work, a backend *pipeline pass*, not a core cut). try/catch/
throw are lowered to `setjmp`/`longjmp` inside the backend — the JS pipeline gets these for free from
the host, so like coercions they are pipeline additions, not holes in the neutral core.

### A9-extern — the extern boundary (**new assumption, unmodeled by the spec**)

| construct | dips | files | note |
|---|--:|--:|---|
| `host-intrinsic` | 523 | 85 | `console.log`/`Math.*`/etc. resolved against the C runtime, not `std/js` |
| `imported-body` | 54 | 9 | imported l-lang function lowered on demand (C analog of `ensureSymbolInlined`) |
| `import` | 33 | 19 | module import skipped (v0 intrinsics stand in for the stdlib) |
| `stdlib-intrinsic` | 21 | 5 | an l-lang stdlib body shadowed by a C intrinsic |
| `unresolvable` | 8 | 3 | e.g. `JSON.stringify` has no C representation → LL0107 |
| `host-constant` | 3 | 3 | `NaN`/`Infinity` mapped to C values |

**This is the probe's biggest structural finding beyond A1–A8.** The spec models the HIR as if the
program were closed, but **every corpus program preludes `std/js` externs, and the very first file
calls `console.log` directly.** `host-intrinsic` at 523 dips / 85 files means the extern boundary is
not an edge case — it is the *ground* every program stands on. A native backend needs an explicit
answer to "what is `console.log`?" that the current HIR punts to the JS host. The C runtime answers it
with a v0 intrinsic table; the 8 `unresolvable` dips (`JSON.stringify` and friends) are where even
that runs out and the backend correctly refuses (LL0107). **A9-extern belongs in the spec as a
first-class assumption**, with intrinsic-vs-stdlib-body-vs-refuse as its three resolutions.

---

## 4. "New" findings — dips with no A-row (126 total)

These are things the C backend had to decide that the spec's A1–A8 frame doesn't name. The
`unhandled:*` rows are the **refusal frontier** (§5); the rest are genuine semantic findings:

| finding | dips | files | what it means for the spec |
|---|--:|--:|---|
| `void-fn-boxed` | 19 | 8 | the checker types a function `-> Void` but its body *returns values*; the backend must keep it boxed rather than emit a C `void` return. **The `Void` type is not a reliable "returns nothing" signal.** |
| `void-in-value-position` | 10 | 7 | a `void` call used as a value; JS yields `undefined`, the C backend sequences with nil. A layout question the HIR doesn't answer. |
| `module-global` | 11 | 11 | a module-level binding referenced by a top-level function; hoisted to a C global with external linkage. The HIR has no module-global concept. |
| `raw-structural:for` | 9 | 2 | **`HFor` cannot carry a statement-bearing `:step`** — when the step is not a simple expression, the whole `for` arrives raw. A concrete HIR node-shape deficiency. |
| `raw-structural:assign` | 10 | 2 | an assignment reached codegen raw inside a subtree that bailed to opaque. |
| `int-division` | 2 | 2 | **the checker types `Int/Int` as `Int`, but the JS runtime yields `Real`** (`5/2 == 2.5`). A real static-vs-runtime *semantic divergence* — the C backend must pick one and diverges from a golden if it picks wrong. |

The two bolded rows (`void-fn-boxed`, `int-division`) are the kind of finding only a typed backend can
produce: places where the *type the checker assigned* is not the type the *value actually has*. On JS
they're invisible (untyped, `typeof`-dispatched). On a native target they're either a miscompile or a
forced box. **These deserve to be tracked as first-class HIR-contract questions**, not folded into A1.

---

## 5. The refusal frontier (the broad-sweep worklist)

The 25 refusals are dominated by **LL0106** ("no CIR lowering exists for construct") — the totality
net. Because every refusal is also a ledger dip (`unhandled:<construct>`), the frontier is a precisely
enumerated worklist, not a vibe:

| construct | files | disposition |
|---|--:|---|
| `special:new` | 4 | the `(new Class …)` construction form — a second construction syntax P1 doesn't yet route to `resolveConstruct` |
| `enum` (`defenum`) | 5 | enum member values + enum match patterns |
| `field-store:*` | 3+ | mutable field assignment `(set obj.field v)` — the A4 store edge |
| `method:str.*` | 2 | `:extension` methods (`words`, `shout`, `titlecase`, …) + a missing native (`trimEnd`) |
| `method:Class.*` | 2 | user methods (`Vec2.manhattan`, `Item/Monster.passable`) not resolving — a `resolveObjMethod` gap |
| `export` | 4 | bare library files whose top-level `export` P1 doesn't model (they lower fine *on demand* when imported) |
| `foreach-destructuring` | 2 | for-each with a destructuring binding |
| `spread` | 1 | spread in collection literals |
| LL0105 (coroutine) | 6 | legitimate refusals — generators/async, kept refused by design |
| LL0107 (host global) | 2 | `JSON.stringify` / other `std/js` globals with no C representation |

Everything above LL0105 is **mechanically implementable** and is what the broad sweep targets next.
Each one converts a refusal into either a green (proving what construct the backend needed) or a
deeper, sharper dip. The LL0105 rows stay refused — that is the correct answer, not a gap.

---

## 6. Prioritized cut list for `dev` (mapped to spec Steps 3–8)

Ordered by measured dip weight — this is the empirical argument for sequencing the HIR modeling work:

1. **`HRef` + `HCall` family first (Steps 3–4).** `atom-ref` (1 513) + `call-dispatch` (1 960) +
   their symbol-table satellites = **~5 000 dips, 63% of the total.** Nothing else moves the needle
   comparably. The A3 sub-rows (`method-devirt`, `closure-call`, `operator-call`, `member-dyn`) are a
   ready-made taxonomy for `HCall`'s kind field. Do these two and the ledger halves.

2. **Types on every node, drain `nodeTypes` (Step 3, A1).** 789 dips, and the `mut-decl-narrowed`
   (109) + `ref-type-via-symbols` (415) rows show the *specific* failure: the channel is keyed by raw
   AST identity and misses identifier uses, and even when present it stores the narrowed type, not the
   layout type. Fixing this is a precondition for A3 devirtualization being trustworthy.

3. **`HConstruct`/`HFieldInit` (Step 5, A4).** 363 dips. The whole class/struct layout is
   reconstructed from the symbol table today. Lower-volume than A2/A3 but *architecturally* central —
   it's the difference between the HIR describing the program's data and not.

4. **`HCopyStore` (Step 6, A5).** 807 dips, all synthesized from an `isStore` flag. Cheap to model
   (the decision is already boolean-ish), high coverage. Turning the flag into an explicit node is the
   A5 reversibility the spec wants.

5. **`HMatchTest` (Step 7, A7).** 144 dips. Self-contained; the decomposition is already worked out
   (bind-then-test) — this is lifting known structure onto the node.

6. **Add A9-extern to the spec (new).** 642 dips. Not a node cut — a *boundary* the spec must name.
   The three resolutions (intrinsic / on-demand stdlib body / refuse) are already implemented and can
   be lifted into the contract.

7. **Track `void-fn-boxed` and `int-division` as contract questions (new, §4).** Low volume, high
   signal: the checker's type is not always the value's type. A native backend needs a ruling.

8. **Coroutines (Step 8, A8) last.** 15 dips, correctly refused. The state-machine lowering is a
   backend pipeline pass; the neutral core owes it nothing until someone wants native generators.

---

## 7. Reproducibility

```bash
npm run test:c                                   # ratchet: 49 green, frontier dim, refusals informational
npm run test:c -- --gap-ledger /tmp/ledger.json  # full census + summary; every count above is in here
npm test                                          # JS baseline — unchanged by the entire probe
npm run test:diagnostics                          # LL0105/07 negatives pinned; band next-free == LL0108
```

Every A1–A9 count in §3 is an aggregation of `GapEntry` rows from `--gap-ledger`. The C backend never
guesses: where it cannot resolve a construct it refuses (LL0106/07) rather than emit wrong code, so a
green file is a *true* positive and the frontier in §5 is exhaustive.
