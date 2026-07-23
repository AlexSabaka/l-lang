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

Every count below is reproducible with:

```bash
npm run test:c -- --gap-ledger /tmp/ledger.json     # dumps the full census + a summary table
```

Status: **living** (Phase E + dev-sync). Two things have happened since the first census: (1) a
breadth sweep (field mutation, enums, `:extension` devirtualization, a native, a global-store
correctness fix) drained the *mechanical* refusal frontier into evidence, so the residual frontier in
§6 is the genuinely hard remainder; (2) **dev caught up on the two biggest holes** — `HRef` and
`HFreeCall` — and the C backend chased them, draining ~680 dips. §5.1 records that drain as a measured
before→after, and §5.2 adds a 1-to-1 JS↔C parity audit. The counts below are the current (post-chase)
census.

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

## 2. Scoreboard (corpus-wide)

| Outcome | Count | Meaning |
|---|--:|---|
| ✅ Pass | 60 | C output == golden, byte-for-byte |
| ❌ Fail / 💥 Error | 0 | no regressions, no emitter crashes on the green set |
| 🚧 Not-yet | 21 | unlisted-failing (cc error, output mismatch, or runtime trap) — the frontier (§6) |
| 🚫 Refused | 12 | honest LL0105/06/07 diagnostics (coroutine / no-lowering / host-global) |
| 📚 Library / 🧪 Fixture / ⏳ XFail / ⚠️ Skip | 37 | not executable as standalone `node` programs by design |
| **Total** | **130** | |

**Total recorded dips: 8 051.** The count is not monotone, and that is a feature: dev's `HRef`/
`HFreeCall` *drained* it 8 209 → 7 530 (§5.1), then cross-module class registration (§5.3) *raised* it
7 530 → 8 051 by resolving imported classes' method/operator bodies that previously never lowered at
all. The ledger measures *resolved-code surface*, not just unmet need — draining a construct lowers
the count, reaching new code raises it. The per-assumption table below is the post-`HRef`/`HFreeCall`
baseline; cross-module registration added ~520 dips of newly-reachable imported-body evidence (mostly
A2/A3/A4 inside the imported methods, plus the new `A9-extern:imported-class` row). Distribution:

| Assumption | Dips | One-line |
|---|--:|---|
| A3 — calls modeled | 2 510 | still the biggest hole; `HFreeCall` drained the free-call slice, method/operator/construct calls remain |
| A2 — atoms modeled | 1 924 | `HRef` drained a third of variable reads; decl-structure / composite reads remain |
| A5 — copy/coerce decided | 810 | the D11 value-copy decision lives nowhere in the HIR |
| A1 — types on every node | 753 | `nodeTypes` misses identifier *uses*; fall back to symbols |
| A9-extern — the extern boundary | 642 | **new**: unmodeled by the spec; every program preludes `std/js` |
| A4 — construction modeled | 457 | constructors, field layout, **enums** reconstructed off the HIR |
| A6 — coercions inserted | 175 | the P2 pass's own traffic (backend pipeline, not a core cut) |
| A7 — pattern tests modeled | 144 | match decomposed from the raw `PatternNode` |
| "new" bucket | 91 | findings with no A-row: see §4 |
| A8 — coroutines / native machinery | 24 | refused (coroutines) or lowered to native (try/throw) |

The shape is still the headline: **A3 + A2 = 59% of all dips** (was 63% before the drain). The HIR's
two largest holes are the two most fundamental things a backend does — *name a value* and *call
something* — and dev is now closing them incrementally, exactly the order the ledger argued for.
Everything else is a rounding error against those two.

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
| `ref-type-via-symbols` | 396 | 62 | symbols | identifier use missing from the channel; type from the binding |
| `param-untyped` | 160 | 41 | symbols | parameter type unavailable → boxed |
| `mut-decl-narrowed` | 109 | 28 | symbols | a `mut` decl's channel type is the initializer's *narrowing*, not the declared type |
| `index-boxed-base` | 51 | 7 | — | index base has no static container type → boxed element |
| `foreach-elem` | 21 | 10 | — | collection element type unknown → boxed loop var |
| `vector` / `ref-untyped` | 16 | 7 | — | no channel *or* symbol type; boxed |

**Workaround:** resolve the binding through `SymbolTable.resolveSymbol().inferredType` when
`nodeTypes` misses. **The `mut-decl-narrowed` row is the sharpest A1 finding**: the channel stores the
*narrowed* initializer type, so `(mut x 0)` later assigned a `Real` reads back as `Int` from the
channel — a backend that trusted it would mis-lay-out the slot. This same channel-vs-declared mismatch
bit a store site during the sweep (§5, the global-store fix). "The channel type is not the layout type"
is not a subtlety; it is a bug the moment a target believes it.

### A2 — Atoms are modeled, not opaque

| construct | dips | files | via | note |
|---|--:|--:|---|---|
| `atom-ref` | 1 003 | 76 | AST | a variable read still lowered opaquely (was 1 465; `HRef` drained −462, §5.1) |
| `decl-structure` | 447 | 75 | AST | binding name/mutability read from the raw `VariableNode` |
| `assign-target` | 169 | 38 | AST | assignment target from raw AST (the `emitAssign` legacy seam) |
| `formatted-string` | 146 | 47 | AST | interpolation segments from raw AST |
| `decl-type` / `binding-type` | 115 | 30 | symbols | declaration/binding type through the symbol table |
| `foreach-variable` | 44 | 21 | AST | loop binding from the raw `ForEachNode` (`emitForEach` seam) |

**Workaround:** `resolveAstExpr`/`resolveAstStmt` re-drive off `h.src`. `atom-ref` *was* the single
most-hit construct in the corpus (1 465 dips / 86 files — every program reads a variable); **`HRef`
landed on `dev` and drained it to 1 003 (−32%)**, the chase measured in §5.1. The residual 1 003 are
reads in positions dev hasn't modeled yet — composite/dotted heads, `for-each` variables, assignment
targets, and reads inside subtrees that still bail to opaque. `decl-structure` (447) is now the
largest A2 row: the *declaration* half of the atom story (name + mutability), still read from the raw
`VariableNode`.

### A3 — Calls are modeled (kind + callee identity on the node)

| construct | dips | files | via | note |
|---|--:|--:|---|---|
| `call-dispatch` | 1 742 | 91 | AST | non-free calls still opaque (was 1 960; `HFreeCall` drained −218, §5.1) |
| `function-signature` | 239 | 61 | symbols | signature through the symbol table |
| `callee-identity` | 121 | 38 | symbols | callee resolved through symbols (spec wants it *on* the call node) |
| `member-dyn` / `method-dyn` | 182 | 34 | — | boxed receiver → runtime member/method dispatch |
| `on-demand-lower` | 55 | 9 | — | imported body not pre-lowered; lowered on demand |
| `method-devirt` / `operator-*` / `extension-devirt` | 99 | 25 | symbols | method / operator / extension overload devirtualized to a direct call |
| `closure-call` / `closure-lift` / `function-as-value` | 53 | 21 | symbols | first-class function → boxed calling convention |

**Workaround:** `resolveConstruct`/`resolveObjMethod`/`binopMode` reconstruct the call shape from the
raw call AST plus symbol lookups. `call-dispatch` *was* the largest single number in the ledger (1 960
/ 95 files); **`HFreeCall` landed on `dev` and drained the free-call slice to 1 742 (§5.1)**. It is
still the largest — because `HFreeCall` models only the *free* call kind; every method / operator /
constructor / dotted call remains opaque. The sub-rows are the taxonomy for the rest of the `HCall`
kind field: `method-devirt`/`operator-*`/`extension-devirt` (the statically-resolved kinds — the
sweep added `extension-devirt`, Dove's easy Q4 case), `member-dyn`/`method-dyn` (the boxed-receiver
dynamic kinds), `closure-call` (call through a value). `callee-identity` (121) survived the drain
intact — `HFreeCall` carries the callee *name* but not yet *which declaration*, so imported-ness is
still a symbol lookup (dev's node comment flags this as a follow-up increment).

### A4 — Construction is modeled (constructors, field layout, `super`, enums)

| construct | dips | files | via | note |
|---|--:|--:|---|---|
| `field-get` | 190 | 20 | symbols | struct field access → slot index from the descriptor |
| `construct` | 91 | 24 | symbols | construction resolved from the symbol table (no HIR node) |
| `field-store` | 51 | 12 | symbols | struct field *store* → static slot **or** runtime member write (see §5) |
| `enum-ref` | 50 | 5 | — | an enum member reference folded to its constant |
| `defclass` / `defstruct` | 44 | 25 | symbols | field layout reconstructed from the symbol table |
| `enum-member` | 25 | 5 | — | an enum member is a compile-time constant (enums aren't even symbols) |
| `inherit` | 6 | 4 | symbols | parent field/method flattening walked below the HIR |

**Workaround:** a `registerClass`/`registerEnum` pass reads the symbol table (and the raw `EnumNode`)
to build `ll_class` descriptors and an enum-constant table; every field access, construction, store,
and enum reference resolves against those. **The HIR carries none of this** — as the spec says, "every
emitted constructor is an A4 entry." The sweep added two evidence rows here: **enums are the sharpest
new A4 finding** — `(defenum HttpMethod :GET ...)` produces no HIR node *and no symbol at all*, so the
member `HttpMethod:GET` is a bare identifier-with-a-colon whose value (ordinal or explicit) is
reconstructed entirely below the HIR, and a match arm `HttpMethod:GET =>` has to be re-classified from
a *binding* into an *equality test*. The `field-store` row now also covers the boxed-receiver case
(`(cell.mine := v)` on an array element → a runtime `ll_member_slot` write). This is Step 5
(`HConstruct`/`HFieldInit`), and enums argue for an `HEnum`/const-fold companion.

### A5 — The copy/coerce decision is a node, not a flag

| construct | dips | files | via | note |
|---|--:|--:|---|---|
| `return-store` | 408 | 69 | synth | the `isStore` flag stands in for an explicit copy node |
| `param-copy` | 159 | 44 | synth | callee-side D11 copy-on-entry (struct/boxed param by value) |
| `copy:let-decl` | 121 | 36 | synth | explicit CP3 value-copy at a `let` store site |
| `foreach-copy` | 42 | 21 | synth | per-iteration element copy |
| `copy:user-assign` / `copy:collection-elem` / `copy:field-init` | 55 | 25 | synth | copy at other store sites |
| `mut-capture-cell` | 16 | 7 | synth | `mut` captured by a closure → shared heap cell |
| `index-store` | 8 | 5 | — | index-assignment lvalue (partial write) |

**Workaround:** the CP3 value-copy decision (D11) is *synthesized* by the backend at each of the six
store sites, because the HIR only records an `isStore` boolean, not *where a copy must be inserted*.
`return-store` at 408 dips shows the reach: two-thirds of executable files return a value and each
return is a place the backend had to decide "copy or share." This is Step 6's `HCopyStore` — and A5's
reversibility (decision-as-node, materialization-as-backend-code) is exactly what let the C backend
pick shallow-at-reference without the HIR committing to it.

### A6 — Coercions inserted at typed↔`Unknown` edges

| construct | dips | files | note |
|---|--:|--:|---|
| `coercions-inserted` | 75 | 1 | box/unbox/cast nodes the P2 pass actually minted (self-report) |
| `boxed-arith` | 72 | 24 | boxed operand in arithmetic → runtime tag dispatch (**cannot narrow an Unknown to a guessed native**) |
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
`HHoist` into boxed variable declarations — the A7 decomposition, executed. Enum patterns extend the
same seam: an enum member arm is folded into an equality test here rather than a binder. The spec's
`HMatchTest` would move this structure onto the HIR; today the arms are reconstructed from the raw
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
| `host-intrinsic` | 525 | 85 | `console.log`/`Math.*`/etc. resolved against the C runtime, not `std/js` |
| `imported-body` | 58 | 10 | imported l-lang function lowered on demand (C analog of `ensureSymbolInlined`) |
| `imported-class` | 5 | 3 | **imported class registered + methods lowered on demand** (the class analog; §5.3) |
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

## 4. "New" findings — dips with no A-row (91 total)

These are things the C backend had to decide that the spec's A1–A8 frame doesn't name. The
`unhandled:*` rows are the residual refusal frontier (§6); the rest are genuine semantic findings:

| finding | dips | files | what it means for the spec |
|---|--:|--:|---|
| `void-fn-boxed` | 19 | 8 | **RULED (D49a).** `-> Void` BINDS: it suppresses the implicit-return desugar, as `:gen` already does. Every dip came from source that explicitly wrote `-> Void`, so this was never sloppy annotation -- it was an annotation nothing enforced. C can emit a real `void` return; the row drains. |
| `void-in-value-position` | 13 | 9 | **RULED (D49b).** A `Void` expression in value position is **nil** -- which follows from D9 (one bottom value, `nil` its spelling, `undefined` deleted). So C is right and this is a **JS bug report** wearing a C ledger row: JS yields `undefined` and must yield nil. Refiled against JS. |
| `module-global` | 11 | 11 | **RETIRED (D49c) -- never a contract question.** The row fires ONCE PER MODULE with any module state (keyed on the first top-level node), so the count measures corpus shape, not decisions. The semantics are settled three ways (P6 top-level-only resolution, D6 import scope-merge, D20 module-private). Both backends agree. (Also: the emitted global is `static`, i.e. INTERNAL linkage -- "external" here was wrong.) The real finding inside it is the A1 channel-vs-layout type bug. |
| `raw-structural:assign` | 10 | 2 | an assignment reached codegen raw inside a subtree that bailed to opaque. |
| `raw-structural:for` | 9 | 2 | **`HFor` cannot carry a statement-bearing `:step`** — when the step is not a simple expression, the whole `for` arrives raw. A concrete HIR node-shape deficiency. |
| `int-division` | 2 | 2 | **RULED (D49d).** `Int / Int` IS integer division -- D43 applied literally (static type decides), now that D43's premise ("JS has one number type") is known false natively. Both corpus sites already wrap in `Math.floor`, i.e. they asked for this by hand; no golden changes. JS must truncate. The backend had been contradicting D43 in a `binopMode` `if`. |

The two bolded rows (`void-fn-boxed`, `int-division`) are the kind of finding only a typed backend can
produce: places where the *type the checker assigned* is not the type the *value actually has*. On JS
they're invisible (untyped, `typeof`-dispatched). On a native target they're either a miscompile or a
forced box. **These deserve to be tracked as first-class HIR-contract questions**, not folded into A1.

---

## 5. What the probe proved

### 5.0 The breadth sweep (Phase E)

The sweep implemented five things. Each was chosen because it converts a *refusal* into either a green
(proving what construct the backend needed) or a sharper dip — turning "the backend can't do X" into
"here is exactly what X costs off the HIR." Net: **+4 green (49→53), refusals 25→16.**

1. **Field mutation on a boxed receiver (`dyn-field` / `ll_member_slot`).** `(cell.mine := v)` where
   `cell` is an array element (`(let c cells[i])`, boxed) has no static slot to write. Modeled as a
   runtime member write by name — the store-side analog of A3's boxed member *read*. Greened
   `04_flood_fill`. *Evidence:* A4 `field-store` is a real cut in both the typed and boxed cases.

2. **Enums (`defenum`).** Members fold to compile-time constants (ordinal or explicit); a reference is
   an identifier-with-a-colon; a match arm is an equality test, not a binder. Greened `04_enums`.
   *Evidence:* the new A4 `enum-ref`/`enum-member` rows — enums produce *neither a HIR node nor a
   symbol*, the most-erased construct measured.

3. **`:extension` devirtualization.** A free fn callable as a method on its first-param type,
   statically rewritten to a direct call, wired into every dispatch path (typed / native / member-read
   / computed-member callee, so `((s.reversewords).titlecase)` chains). Greened `01_vec2_operators`.
   *Evidence:* the new A3 `extension-devirt` row (Dove's easy Q4 case, confirmed static).

4. **A missing native (`str.trimEnd`).** With enum match, greened `06_tetromino_rotation`.

5. **A correctness fix: a module global's store site uses its *declared* ctype.** A captured-mut
   global is boxed even though the channel still types it `Int`; the store side was re-inferring the
   native type and unboxing the RHS into a boxed slot (a cc type error). Fixed at the store and
   receiver sites. *Evidence:* a second, independent instance of A1's "channel type ≠ layout type"
   — this time causing a miscompile, not just a box.

The sweep did **not** chase the genuinely hard remainder (§6). Where a construct turned out to be deep
— cross-module class registration, a captured-mut that is *also* a module global, field-chain index
assignment — it was left refused/not-yet and root-caused here. That is the probe working as intended:
a refusal that resists a breadth sweep *is itself* a high-value finding.

### 5.1 Dev sync: the drain, measured

The point of this probe was always the feedback loop — measure the holes, hand `dev` an ordered cut
list, watch the dips drain as the HIR models them. That loop closed, on the exact two items §7 ranked
first. `dev` landed `HRef` (a modeled reference atom — Step 3) and `HFreeCall` (a resolved free call —
A3). The C backend's exhaustive CIR switch flagged both at compile time; the chase consumes them off
the HIR node instead of dipping to raw AST, and **records no dip for the modeled construct**:

| dip | before | after | drain | why it didn't go to zero |
|---|--:|--:|--:|---|
| `atom-ref` (A2) | 1 465 | 1 003 | **−462 (−32%)** | `HRef` is produced only in operand positions dev has modeled; composite/dotted heads, `for-each` vars, assign targets still lower opaquely |
| `call-dispatch` (A3) | 1 960 | 1 742 | **−218 (−11%)** | `HFreeCall` models only the *free* call kind; method / operator / constructor / dotted calls stay opaque |
| **total** | **8 209** | **7 530** | **−679** | the drain is ~entirely these two — nothing else moved |

Two details make this a *clean* measurement rather than a vibe. First, the drain equals the modeled
amount to within a rounding error (462 + 218 = 680 ≈ 679 total) — the chase didn't perturb anything
else. Second, the **satellites held steady exactly as dev's node comments predicted**:
`ref-type-via-symbols` (A1, 396) and `callee-identity` (A3, 121) did *not* drain, because `HRef`/
`HFreeCall` carry the *name* but not yet the resolved *type* or *which-declaration* — those move onto
the node in a follow-up increment. So the ledger now reads as a burn-down chart: it says precisely
which sub-problem `dev` solved, and which adjacent ones it deferred. All of this with **53 green / 0
regressions / JS baseline 108 intact** — the chase changed how the answer is *derived*, never the
answer.

### 5.2 The 1-to-1 JS↔C parity audit

The goldens were generated from the JS backend, so "C matches golden" is *usually* "C matches JS" —
but not provably, and a stale golden would hide a real JS↔C divergence. So this pass compares all
three outputs live: `golden` (the `.expect` sidecar), `js` (`ts-node index.ts run`, the current JS
backend), and `c` (transform → `cc` → run), over all **93 executable examples** (those with a golden).

| category | count | reading |
|---|--:|---|
| **parity** (`js == c == golden`) | 53 | the entire C-green set is *true* byte-for-byte JS parity — not just golden-matching |
| **golden-stale** (`js != golden`) | **0** | every golden still tracks live JS; the oracle is sound, the whole corpus over |
| **C-behind, but ran** (`js == golden`, `c` ran and differs) | 7 | C compiles and runs but prints a *wrong* answer — §5.2's payload |
| C could not produce output (cc error / refused / trap) | 33 | the §6 frontier; no comparable output |
| JS failed to run | 0 | every executable example runs under JS |

The 7 "C ran but diverged" files are the most valuable finding of the audit — the **silent
wrong-answer** class, where C output looks plausible but disagrees with JS. All 7 have `js == golden`,
so JS is the correct reference and the divergence is a pure C bug. They cluster into four precise root
causes (each now also a §6c row):

1. **Reflection metadata depth** — `07-types/01_type_reflection`, `08-generics/00_generics_basic`.
   JS `type`/`type-by-name` return a *full* metadata object (`{name, kind, params:[{name,type}],
   returns, nullable}` for a function; `properties`/`methods` for a class); the C runtime returns a
   shallow stub. An A9-extern reflection-depth gap.
2. **Modifier decorators drop their side effects** — `10-modifiers/02_logging`, `03_timing`,
   `05_multiple`. The wrapped function's *result* is correct, but the decorator's `[log]`/`[timed]`
   output never appears: C runs the raw function, not the wrapper. `defmodifier` is being treated as
   pass-through where it is actually a real runtime decorator.
3. **`print` positional format** — `16-stdlib/01_main`. `(print "Hello, {0}!" "World")` → JS
   `Hello, World!`, C `Hello, {0}! World`: the C `print` intrinsic maps to `console.log`
   (space-join) instead of `std/io`'s `{0}` substitution. A semantic A9 divergence, not a crash.
4. **Array-in-interpolation format** — `20-algorithms/03_functional`. An array spliced into a string
   (`{squares}`) renders as node's `[ 1, 4, 9 ]` under JS but a bare `1,4,9` under C — the C
   string-interp path doesn't reproduce `util.inspect` for a nested container.

None of these is on the HIR-contract axis — they are runtime/stdlib fidelity gaps — which is itself
the finding: **the 53 green files establish that the HIR-consumption story is sound to parity; the
remaining divergences are all below the HIR, in the runtime and stdlib the probe stubbed.** That is a
clean separation of concerns for whoever picks up the C backend as a real target.

### 5.3 Cross-module class registration

The `special:new` frontier (§6a) was construction of a class defined in an *imported* module —
`(new Vector3 …)` where `Vector3` lives in `std/math`. The C backend only registered *this* module's
classes; the fix is the class-level analog of the on-demand `imported-body` function lowering already
in place. `SymbolEntry.value` carries the imported class's AST node, so a lazy `ensureClassRegistered`,
routed through the three class-name gates (`new`, plain-name construction, and type annotations),
registers the descriptor and lowers the methods/operators on first reference. Greened
`16-stdlib/complex_math_test/main` and `30-applications/08_vector_toolkit` (53 → 55); the new
`A9-extern:imported-class` row records it.

The sharper finding is the **bug it surfaced**: `SymbolEntry.value` is the *pre-desugar* parse tree
(the symbol table is built before the desugar stage), so an imported `(fn sqr [x] (* x x))` reached the
backend with **no implicit return** — it lowered to `(* x x); return nil`, `sqr` returned nil, `mag`
returned garbage, and `ll_as_num` trapped. This is a general defect in *all* imported-body lowering,
not just classes; the JS backend documents the identical bug and fix (`desugaredCopyOf` — clone the
node and run the implicit-return desugar). The C backend now does the same in both import paths. It is
a clean example of the probe's value even *inside* a feature: reaching imported code for the first time
exposed a latent soundness bug that the golden corpus had never exercised.

Two `special:new` files stayed off the ratchet initially (neither a cross-module gap): `02_packages/
main` needed non-ctor field defaults, and `00_generic_inventory`'s `new` class-argument arrives as a
lowering temp — both closed out in §5.4.

### 5.4 Closing the deferred construction gaps

The deferred items from §5.3 were construction-layout gaps the HIR models nowhere (A4); closing them
greened two more files (55 → 57):

- **Non-ctor field defaults + `:ctor` initializer methods** (greened `09-oop/02_classes`).
  `(new Rect 3 4)` left the non-ctor `(let :private tag "rect")` field nil (`ll_obj_new` zero-fills);
  construction now fills *every* slot from a positional arg, else the field's declared default, else
  nil — which also fixes an omitted ctor arg like `(new Vector3)`. And `:ctor` methods
  (`(fn :ctor initialize-age [] (this.age := …))`) that derive fields at construction now run: the
  descriptor tracks them in order and a construct with any emits a statement-expression
  `({ o = make; init1(o); …; o; })`.
- **Generic construction** (greened `00_generic_inventory`). ANF hoists the `new` class *head* into a
  temp (`__ll_hir_N = Inventory`); since a class is not a runtime value, a class-name-valued temp is
  now recorded (no decl emitted) and `new` reads the name back. It also surfaced that a `-> Void`
  *method* whose body returns a value (the implicit-return desugar wraps every tail) needs the same
  never-downgrade-to-`void` treatment free functions get — a Void method stays boxed `ll_value`.

### 5.5 Dynamic method dispatch — the witness/vtable machinery

The one construct the C backend genuinely could not devirtualize: a method call on a statically
**unknown** receiver — an interface value, or an `Any`/untyped param like `(fn area-of [s] (s.area))`.
The JS backend gets this free (it dispatches on the JS object at runtime); a typed target must carry a
runtime vtable. This is Dove's real Q4 answer — the part the settled design said *does* need witness
tables, as opposed to the extension/operator cases that devirtualize statically (§5.0).

The implementation is a per-class method table on the runtime `ll_class`: each class emits a
boxed-convention adapter per own method (unbox self + args → call the typed method → box the result)
and a `__ll_methods_X[]` table; `ll_dyn_method` walks the receiver's class + `:extends` chain for the
name, so an override wins. It's a *general* vtable, not per-interface witness structs — it covers the
interface case and the boxed-`Unknown` case with one mechanism.

Greened `20-algorithms/07_tokenizer`, `08_state_machine`, and (with the higher-order vec methods
below) `15-modules/02_packages/main` — 57 → 60. It also needed **higher-order vector methods**
(`reduce`/`map`/`filter`/`forEach`): the corpus reaches them through `std/seq` as `(coll.reduce op
init)`, a native the JS runtime gets from `Array.prototype` — each drives a boxed closure per element.
Same runtime/stdlib-fidelity axis as §5.2, not an HIR-contract gap.

Two files that this unblocked at the *dispatch* layer stay not-yet on a *different* gap, both from the
§5.2 parity audit: `09-oop/01_interfaces` (reflection metadata depth — `type` returns a shallow stub)
and `09-oop/03_dispatch_and_type_patterns` (`print`'s `{0}` positional format). Dispatch is no longer
the blocker for either.

---

## 6. The frontier — every non-green file, root-caused

The remaining 16 refusals and 24 not-yets split three ways. This is the exhaustive "what's left and
why" — the raw material for prioritizing HIR work.

### 6a. Honest refusals (16) — the backend said so on purpose

| construct | files | disposition |
|---|--:|---|
| LL0105 coroutine | 5 | `00_async`, `01_async_pipeline`, `00_generators`, `02_linq_pipeline`, `07_line_clear` — correct refusal, kept by design (A8) |
| `special:new` | 0 | **FULLY RESOLVED (§5.3 + §5.4).** All four construction sites now lower: `08_vector_toolkit` + `complex_math_test/main` (cross-module registration), `00_generic_inventory` (ANF class-name temp), and `02_packages/main` compiles (now a §6c dynamic-dispatch trap, not a `new` refusal). |
| `export` | 4 | `00_lib`, `01_lib_a/b/c` — bare library files whose top-level `export` P1 doesn't model (they lower fine *on demand* when imported by a main). |
| interface `passable` | 1 | `02_interface_conformance` — a method dispatched through an *interface*, not a concrete class: the statically-**unknown** receiver, i.e. the witness-table case (Dove's genuine Q4 answer, deferred). |
| `spread` + host global | 1 | `spread_in_literals` — spread in collection literals + a `std/js` global. |
| host global | 1 | `hex_string_escape` — `JSON.stringify`, no C representation (A9 `unresolvable`). |

> **Added 2026-07-22 — a FLOOR FUNCTION used as a VALUE has no C representation. Logged, not fixed.**
>
> `(call sys-args)`, `(map some-floor-fn xs)`, or any other place a floor name appears where a value is
> expected, emits a reference to a `u_`-prefixed user symbol that no C declaration produces:
>
> ```
> u_args = ll_call_dyn(1, (ll_value[]){u_sys_2dargs});
>                                      ^ use of undeclared identifier 'u_sys_2dargs'
> ```
>
> The floor lowers a **call** to its `runtimeFn` (`ll_sys_args(...)`), and there is no path that wraps
> that C function in an `ll_closure` so it can be passed. This is the same shape as the standing
> "operators are not first-class values on C" gap: both are names the backend can only *invoke*, never
> *reference*.
>
> It is not what blocks `call` — that landed (`8020882`), and nullary user functions and lambdas work
> on both backends. This is the remaining half, and it is why `std/sys/process` exposes `sys-arg` as a
> unary indexed accessor rather than a nullary `sys-args`: the workaround for D1's zero-arg read rule
> requires exactly the capability this row is missing.
>
> The fix has a known shape — emit an adapter closure per referenced floor entry, the way
> `__ll_adapter_u_label` already does for imported l-lang functions — but it is a new emission path
> and wants its own commit. Deferred deliberately, at Sabaka's call.

### 6b. cc errors (8) — the emitter produced C, cc rejected it

Each is root-caused; several are the same underlying HIR/backend gap.

| file | cc error | root cause |
|---|---|---|
| `10-modifiers/04_retry_modifier` | deref of non-pointer | **a captured-mut that is ALSO a module global** — wants both an `ll_value*` heap cell and a static `ll_value` slot; the two lowerings collide. |
| `30-applications/03_undoable_modifier` | undeclared `u_world_2eboxes` | **field-chain index assignment** `world.boxes[i] := v` — the indexer lowers the composite head `world.boxes` as one mangled identifier instead of head-object + field read. |
| `03-loops/01_for` | undeclared loop var | a nested/`raw-structural:for` scoping gap (`HFor` can't carry the statement-bearing step, §4). |
| `04-pattern-matching/02_map_patterns` | call arity | a map-pattern whose value sub-pattern is itself a method call is decomposed with the wrong arity. |
| `08-generics/05_covariance` | non-constant global init | a global initialized with a non-compile-time-constant (the `staticZero` net misses a case). |
| `08-generics/06_multiple_interfaces` | undeclared `u_Any` | the `Any` *type name* leaks into value position. |
| `15-modules/01_main` | undeclared `u_secret_2dnumber_2da` | a cross-module hyphenated binding referenced but not declared (cross-module scope). |
| `30-applications/05_snake_tick` | `ll_value` vs `ll_map*` | a map op receives a boxed value where the runtime wants a concrete `ll_map*`. |

### 6c. Runtime divergences (13) — compiled, ran, diverged

| kind | files | note |
|---|---|---|
| trap (exit 70) | `20-algorithms/09_memoization_intro` | a map-key stringification path. (`07_tokenizer`, `08_state_machine`, `02_packages/main` left this list — greened by the §5.5 vtable; `09-oop/02_classes` by §5.4.) |
| output mismatch (dispatch no longer the blocker) | `09-oop/01_interfaces` (reflection metadata depth), `09-oop/03_dispatch_and_type_patterns` (`print` `{0}` format) | now run correctly *through* dynamic dispatch (§5.5); the residual diff is the §5.2 runtime/stdlib axis. |
| output mismatch (7, the §5.2 silent-wrong-answer set — exact JS↔C diffs captured) | `07-types/01_type_reflection` + `08-generics/00_generics_basic` (reflection metadata depth); `10-modifiers/02_logging`/`03_timing`/`05_multiple` (modifier decorator side-effects dropped); `16-stdlib/01_main` (`print` `{0}` format vs `console.log`); `20-algorithms/03_functional` (array-in-interpolation `[ 1, 4 ]` vs `1,4`) | all four causes are runtime/stdlib fidelity, **below** the HIR axis (§5.2) — the C-green set proves HIR-consumption parity; these are the stubbed runtime showing through. |
| segfault (exit null) | `18-error-handling/02_rpn_error_paths`, `10-modifiers/06_extension_methods` | stdlib bodies lowered on-demand (`filter`/`map`/`join`/`split`) that the C runtime doesn't fully support. |
| P1 crash | `16-stdlib/test_stdlib` | a null `_type` during resolution — a lowering path only ever exercised behind the JS legacy emitter. |

The `10-modifiers/*` cluster (logging/timing/retry/multiple modifiers) is one theme: a `defmodifier`
that is a *real runtime decorator* stresses closure capture + `std/io` formatting simultaneously.

---

## 7. Prioritized cut list for `dev` (mapped to spec Steps 3–8)

Ordered by measured dip weight — this is the empirical argument for sequencing the HIR modeling work:

1. **`HRef` + `HCall` family first (Steps 3–4) — IN PROGRESS.** This was the #1 recommendation and
   `dev` acted on it: `HRef` and `HFreeCall` (the free-call slice) landed and drained −680 dips (§5.1).
   The work remaining is the rest of `HRef`'s positions (`atom-ref` residual 1 003, plus the
   `decl-structure` 447 declaration half) and the rest of the `HCall` kinds (`call-dispatch` residual
   1 742). The A3 sub-rows (`method-devirt`, `closure-call`, `operator-call`, `extension-devirt`,
   `member-dyn`) are the ready-made taxonomy for the remaining `HCall` kind variants. Then move
   `HRef`'s *type* and *which-declaration* onto the node to drain the `ref-type-via-symbols` (396) and
   `callee-identity` (121) satellites that §5.1 measured surviving the first increment.

2. **Types on every node, drain `nodeTypes` (Step 3, A1).** 753 dips, and **two independent bugs**
   now cite the same root cause — `mut-decl-narrowed` (109) reads the narrowed type where the layout
   type is wanted, and the sweep's global-store fix hit the identical channel-vs-declared mismatch at
   a *store*. This is not just missing types; it is a channel that is actively wrong at reassignment.
   Fixing it is a precondition for A3 devirtualization being trustworthy.

3. **`HConstruct`/`HFieldInit` + an enum companion (Step 5, A4).** 457 dips. The whole class/struct
   layout is reconstructed from the symbol table, and **enums have neither a node nor a symbol** — the
   most-erased construct measured (75 dips across ref+member). Lower-volume than A2/A3 but
   architecturally central: the difference between the HIR describing the program's data and not.

4. **`HCopyStore` (Step 6, A5).** 809 dips, all synthesized from an `isStore` flag. Cheap to model
   (the decision is already boolean-ish), high coverage. Turning the flag into an explicit node is the
   A5 reversibility the spec wants.

5. **`HMatchTest` (Step 7, A7).** 144 dips. Self-contained; the decomposition is already worked out
   (bind-then-test, with the enum-arm equality-test variant) — this is lifting known structure onto
   the node.

6. **Add A9-extern to the spec (new).** ~650 dips. Not a node cut — a *boundary* the spec must name.
   The resolutions (intrinsic / on-demand stdlib body / **on-demand imported class** / refuse) are
   all implemented now — including cross-module class registration (§5.3, `A9-extern:imported-class`),
   which was the natural next increment and is done. Lift the whole boundary into the contract.

7. **DONE -- `void-fn-boxed`, `int-division` and `HFor`-with-statement-step were tracked as contract
   questions and are now ruled (D49) or fixed.** `HFor` gained a statement-bearing `:step`, which drained
   the `raw-structural` family to zero. The original note follows, for the record.
   **Track `void-fn-boxed`, `int-division`, and `HFor`-with-statement-step as contract questions.**
   Low volume, high signal: the checker's type is not always the value's type, and `HFor` structurally
   cannot carry a statement-bearing `:step` (every C-style `for` in the corpus bails to raw because of
   it — §4, `raw-structural:for`). A native backend needs rulings on all three.

8. **Witness tables — DONE (§5.5); coroutines (Step 8, A8) last.** The statically-unknown-receiver
   dispatch that genuinely needs a vtable is now implemented as a general runtime method table (it
   covers interface *and* boxed-`Unknown` receivers with one mechanism), greening three files. What
   remains here is coroutines: 15 dips, correctly refused — backend pipeline / new-machinery work the
   neutral core owes nothing until someone wants native generators.

---

## 8. Reproducibility

```bash
npm run test:c                                   # ratchet: 53 green, frontier dim, refusals informational
npm run test:c -- --gap-ledger /tmp/ledger.json  # full census + summary; every count above is in here
npm test                                          # JS baseline — 108 green, unchanged by the entire probe
npm run test:diagnostics                          # LL0105/07 negatives pinned; band next-free == LL0108
```

Every A1–A9 count in §3 is an aggregation of `GapEntry` rows from `--gap-ledger`. The C backend never
guesses: where it cannot resolve a construct it refuses (LL0106/07) rather than emit wrong code, so a
green file is a *true* positive and the frontier in §6 is exhaustive.

---

## 9. Latent inheritance bugs, surfaced by the error tower (2026-07-23)

`std/core/errors` is the first DEEP class hierarchy the language has carried (`Error -> ValueError ->
KeyError`, three levels). The corpus's own hierarchies were all one level deep — almost all
`:extends Error`, where `Error` was a *host global* that absorbed whatever l-lang did or did not
forward — so a whole class of multi-level inheritance bug was untested on both backends. Building the
tower surfaced them. One is fixed; one is open and lives here.

### 9.1 FIXED — JS forwarded no `super` args past depth one

A `:ctor` field inherited through two-plus `:extends` levels arrived **nil on JS**. The lowering
forwarded to `super(...)` only what the DIRECT parent declared in its own body, so an empty
intermediate broke the chain (`constructor() { super(); }`). C flattened the whole chain and was
correct. Fixed in `LowerAstToHirVisitor.inheritedCtorParamsOf` (and its dead mirror in
`JSClassBuilder`); pinned by `80-adversarial/inherited_ctor_fields.lisp`.

### 9.2 OPEN — C field-layout trap: inherited plain-default field + inherited ctor field + local ctor field, ≥2 levels

The C backend traps (`TypeError: expected an Int`, exit 70) on this exact shape:

```
(defclass A (mut :ctor tag <- String) (mut seen <- Int 0))   ; ctor field AND a plain default field
(defclass B :extends A)                                       ; empty intermediate
(defclass C :extends B (mut :ctor extra <- Int))              ; a LOCAL ctor field, two levels down
(let c (C "c" 7))                                             ; -> TypeError: expected an Int on C; fine on JS
```

Minimal triggers, all three required: the plain-default field (`seen`) on the ancestor, the local
ctor field (`extra`) on the descendant, and at least one empty intermediate level (`B`). Remove any
one and C is correct:

- drop `seen` (the plain field) → both correct;
- drop the intermediate `B`, make `C :extends A` → both correct;
- drop `extra` (the local ctor field) → both correct.

So it is the *interaction* of an inherited plain-default field with a mixed inherited/local ctor
parameter list across a level boundary — a C field-slot ordering or plain-field-init offset that goes
wrong only when the flattened ctor params and the flattened field list disagree in a particular way.
JS is correct on this shape. Not yet fixed; it blocks giving `std/core/errors` classes plain fields
(e.g. `Error`'s `cause`) while the hierarchy is deep. The error module can dodge it for now by keeping
plain fields off the deep nodes, but the C layout is the real fix.

## 10. JS-backend gap, surfaced by std/math/stats (2026-07-23)

**`cond` in a lowered library module fails on the JS leaf path.** `std/math/stats`'s `sorted-copy`
(a bottom-up mergesort) originally wrote its merge step as a four-clause `(cond ...)`. It parses,
compiles on **C**, and runs correctly there; a top-level `(cond ...)` in an example file also compiles
on JS. But routed through the library-import lowering, the JS backend dies with `ELL0100 visitCond is
not implemented in the JS backend` — `JSTransformerAstVisitor.visitCondCase` is an explicit
`onUnhandled` (`compiler/codegen/js-estree/visitors/JSTransformerAstVisitor.ts:1886`). The HIR path
desugars `cond` to an `if`-chain (`LowerAstToHirVisitor:443`), so the two JS emission paths disagree:
one lowers `cond` away, the leaf one never learned to.

Worked around, not fixed: `stats.lisp`'s merge is spelled as nested `if`, which lowers identically on
both paths. The real fix is either to implement `visitCondCase` on the leaf visitor or to route library
bodies through the HIR desugar that already handles it. A minimal guard would be any `library` module
that uses `cond` and an example that imports and runs it — none exists today, which is why this sat
latent until a stdlib module reached for `cond`.

---

## 11. Generator gaps, surfaced by G2's probes (2026-07-23)

Three pre-existing defects found while adversarially probing `HYield` (Phase G2). **All three were
confirmed identical before and after G2** — none is a regression. They share a cause: the corpus's only
generators live in `13-generators/00` and `std/iter/linq`, and they all have the *same shape* — a
top-level `:gen` whose body is a `while` loop. Every shape outside that is untested, and all three
defects are outside it.

### 11.1 A `:gen` whose body TAIL is a `(yield x)` is rejected — LL0223 **[CLOSED 2026-07-23]**

```lisp
(fn :gen tailyield [] -> Iterator<Int> ((yield 1)))
;; ELL0223 a ':gen' function stops with a valueless '(return)'; it cannot '(return x)'.
```

**This contradicts D31 directly.** That ruling's own table says *"implicit return of the tail —
**suppressed.** A generator's tail value is not a sequence element."* The implicit-return desugar wraps
the tail anyway, so `checkGeneratorRules` then sees a `(return <yield-expr>)` and fires LL0223 at a
program that never wrote a value-`return`. Both backends, since it is a checker/desugar defect.

D49a made `-> Void` bind by suppressing the same desugar, and the note there says `:gen` "already"
does — the measurement says otherwise, at least for a tail yield. The fix belongs with whatever
suppression D49a added. Latent because every corpus generator ends in a `while`, whose value is not a
yield.

> **Closed in Phase G5.** The fix is exactly where this entry predicted — `DesugarAstVisitor`'s
> implicit-return injection, whose own comment had claimed the `:gen` exemption since D49a landed while
> the condition did not implement it: `!isVoidReturn(node)` became
> `!isVoidReturn(node) && !node.generator`.
>
> It was found from the other side. G5 needed `take` to end with `(dispose coll)`, and that tail —
> being `Void` rather than a yield — drew **LL0213** "declares Iterator<T>, but returns Void" instead
> of LL0223. Same defect, second symptom.
>
> **The snapshot had been blessing it in four places.** `test:diagnostics` probes for LL0224, LL0225,
> LL0237 and LL0238 each recorded a spurious LL0223 alongside the code they actually test; all four now
> report only their own diagnostic. That the fix removed exactly four identical entries and nothing
> else is the strongest evidence available that it was one bug.

### 11.2 An anonymous `(fn :gen [] ...)` does not parse

```lisp
(let g (fn :gen [] ((yield 1))))
;; Expecting token of type --> LBracket <-- but found --> '(' <--
```

A plain anonymous lambda parses; a **named** `:gen` parses in every position. Only the anonymous
generator is unreachable, and it is a grammar defect rather than a ruling — nothing in D31 says a
generator must be named. Low priority (no corpus site wants one), recorded so the next person to try it
does not assume it is a deliberate restriction.

### 11.3 A nested `:gen` bound with `let` crashes the JS backend

```lisp
(fn outer [] -> Int (
  (let g (fn :gen inner [] -> Iterator<Int> ...))
  (for :each v :from (g) :then (console.log v))
  (return 0)))
;; Error: asExpression: 'VariableDeclaration' in expression position -- control flow must be HIR-lowered
```

An uncaught **exception**, not a diagnostic — the LL0100 totality net does not cover it. So nested
generators are unusable on both backends today: JS crashes, and C refuses.

**C's half is fixed here.** `lift` did not gate coroutines, so a nested `:gen`'s body was resolved and
its `yield` surfaced as `LL0106 Cannot generate C for 'yield': no CIR lowering exists` — which files a
**modeled, deliberately-deferred** construct as an *unmodeled* one, mislabelling the refusal frontier
this ledger exists to measure. `lift` now calls `refuseCoroutine` like every other body-resolving path,
so the answer is `LL0105 'inner' is a generator (:gen)` — the honest one, and it names the function
rather than pointing at an expression. The JS crash is untouched and stays open.

## 12. Phase G4 prerequisites: one gap that was not there, one that was (2026-07-23)

Two non-coroutine C gaps were predicted to sit between the state-machine transform and the three
`:gen`-refusing corpus files. **Measurement retired the first and confirmed the second.**

### 12.1 Interface-typed slots — NOT a gap (prediction wrong)

The prediction: `mapType` shares one arm across `class | struct | interface` (`ctype.ts`), so an
interface-typed slot claims `{k:"obj"}` — a layout — and an array reaching `to-list<T> [coll <-
Iterable<T>]` would make P2 mint a `c-cast vec -> obj` the emitter cannot write. Since *every*
`std/iter/linq` terminal takes `coll <- Iterable<T>`, that would have blocked all three files.

It does not happen. The arm is unreachable for these annotations: `typeNodeToCType` cannot resolve
`Iterable` (interfaces are erased per D24, so `classes.has` is false and `ensureClassRegistered`
handles only structs and classes), and the symbol table does not report `kind:"interface"` here
either. Both channels return nothing and `declareParam` falls through to boxed —
`u_count_2dall(ll_value u_coll)`.

So the correct CType arrives **by two lookups failing rather than by a decision**, which is why
`80-adversarial/interface_typed_slot.lisp` now pins it. Teaching `ensureClassRegistered` about
interfaces, or making the checker report a real interface type here, would silently re-type every
interface-typed slot as an `ll_obj*` claim and break arrays, strings and generators at once.

### 12.2 `for :each` destructuring — a real gap, now closed

`ELL0106 foreach-destructuring` refused D16's `(for :each [key val] :from ...)` outright, which made
three files unreachable for reasons unrelated to what they are about: `16-stdlib/02_linq_pipeline`
(`[i e]` over `enumerate`), `13-generators/00` (`[up down]` over `zip`), and
`05-data-structures/02_maps` (`[key val]` over map entries — an xfail for its own unrelated reasons,
so it stays one). Both `:gen` files now refuse for **LL0105 alone**.

Two details are load-bearing and are guarded by `80-adversarial/foreach_destructuring.lisp`:

- **The element read is bounds-guarded** (`i < len ? elem[i] : nil`). `ll_index_vec` traps out of
  range — a process exit — while JS's `let [a, b, c] = [1, 2]` leaves `c` undefined, which D9 makes
  nil. An unguarded index would have turned a short element into a crash on one backend and a quiet
  nil on the other, inside the construct whose whole appeal is that it reads like a pattern match.
- **The names are declared beside the element variable, not in the loop body.** `:else` runs after
  the loop and may read the final binding (`03-loops/04_foreach.lisp` does exactly that), so a
  body-scoped declaration would not compile in C. This is the same shape the JS emitter reaches for,
  for the same reason: `let [x, y];` is not legal JavaScript either.

Nested patterns, `...rest` and MAP patterns still refuse, each under its own reason string
(`foreach-destructuring:map-pattern`, `foreach-destructuring-element:<kind>`) so a closed gap is not
reported as an open one. No corpus site wants any of them.

### 12.3 A divergence found in passing, not fixed

The two backends render the bottom value differently in string interpolation: C's ToString says
`null` (`ll_to_string_sb`'s `LL_NIL` arm), JS's `${undefined}` says `undefined`. Surfaced while
choosing how to assert the arity-mismatch case above, which is why that guard asserts `(== r nil)`
rather than printing `r`. Unrelated to destructuring; recorded so it is not re-derived.

## 13. `:extension` method-surface dispatch is not resolved on C (2026-07-23)

Found by G4c: with the state machine landed, `16-stdlib/02_linq_pipeline.lisp` gets **14 of its 18
golden lines right** and then dies with `TypeError: no such method on this value` at section 5 — the
METHOD SURFACE.

```lisp
(let chained ((((seq employees).filter is-eng).map name-of).to-list))
```

JS resolves that chain **statically**, into direct calls:

```js
const chained = __ll_inlined_to2dlist_1(__ll_inlined_map_1(__ll_inlined_filter_1(__ll_inlined_seq_1(employees), is2deng), name2dof));
```

C leaves it **dynamic**, and there is nothing at the other end to find:

```c
ll_dyn_method(2, (ll_value[]){ll_dyn_method(3, (ll_value[]){ll_dyn_method(3, (ll_value[]){u_seq(...), ll_str_lit("filter"), ...
```

`(x.filter f)` where `x` is an `:extension` receiver has to become `filter(x, f)` — a call to a free
function — and on C it stays a method lookup on the receiver's class. A generator's synthesized frame
class has no method table (D58: `ll_iter`/`ll_next` read `gen_step` off the descriptor instead), so
the lookup traps; but the gap is **not about generators**. It would trap the same way on any
`:extension` receiver whose class does not happen to define a method of that name. It was invisible
because `02_linq_pipeline` is the corpus's only method-surface site and it was refused for `:gen`.

The pieces to do it with already exist: the HIR has an `ext-call` node and
`hir/extensionResolution.ts` is explicitly "the SAME logic JSTransformer's extensionFor /
memberKindOn / receiverConformsTo use, re-expressed against a bare Context". What is missing is the C
resolver consulting it on a dotted call, rather than falling through to `ll_dyn_method`.

**Consequence for the ratchet.** `13-generators/00_generators_and_iteration.lisp` and
`30-applications/07_line_clear.lisp` are C-green and listed. `16-stdlib/02_linq_pipeline.lisp` is
**not** — it is blocked on this and nothing else, and it is the one file that would prove the method
surface. Its pipe-surface half already works.

### 13.1 Closed (2026-07-23) — and it was two gaps, not one

The method surface works on C. `16-stdlib/02_linq_pipeline.lisp` matches its golden byte-for-byte and
joins the ratchet, completing the three files Phase G4 set out to green.

Measuring it split the gap in two, because the two receiver shapes **parse differently**:

```
(s.filter keep)          list[ composite-identifier{id:"s.filter", parts:["s","filter"]}, keep ]
((seq xs).filter keep)   list[ list{(seq xs)}, composite-identifier{parts:[null,"filter"]}, keep ]
```

- **Bound receiver.** `classifyCall` models this one and mints an `ext-call` carrying the resolved
  `fnName` — and the C backend was throwing that answer away, routing through the generic method
  dispatch on the theory that "the extension dispatch already lives inside the method resolver". It
  does, but only for a receiver with a CONCRETE C type. A boxed one fell through to `ll_dyn_method`.
  Fixed by consuming `h.fnName` directly, exactly as `EmitHirToEstree` does.
- **Chained receiver.** A different list shape, which `classifyCall` explicitly leaves opaque ("3+-part
  chains stay opaque for now; the receiver-of-a-chain resolution differs"). Resolved instead from the
  receiver's inferred type through the same shared `buildExtensionTable`/`conformingExtensionFn` pair,
  so the dispatch DECISION still has one home and the two backends cannot disagree about it.

Two things the fix had to get right, both guarded by `80-adversarial/extension_method_surface.lisp`:

- **A type's OWN method beats a same-named extension.** `classifyCall` checks member-kind first and
  only then looks for a conforming extension; the C path applies the same order via `memberKindIn`.
  Without it, a boxed receiver whose type genuinely declares the member would have been silently
  redirected to the extension — a divergence invented while closing one.
- **The receiver's type must come from the channel that describes IT.** A bound receiver's `c-ref`
  carries `src: <the whole obj.method node>`, so the type channel there answers about the CALL. That
  shape resolves by source name through `receiverType`; a chained one resolves off its own node.

**The ratchet found a file nobody aimed at:** `30-applications/02_interface_conformance.lisp`, whose
entire subject is `:extension` dispatch over an interface, went from failing to passing and reported
itself as "newly passing -- add it". That is the unlisted-and-passing rule paying for itself.

## 14. Interface conformance is not observable at run time (2026-07-23)

Surfaced by G5, which needed to answer "is this value disposable?" and found that the mechanism D58
named for it does not exist. Both defects are **pre-existing, on BOTH backends, and unrelated to
disposal** — G5 was designed to route around them (see D58's amendment) rather than absorb them.

### 14.1 `(x :of SomeInterface)` answers false, always **[CLOSED 2026-07-23]**

```lisp
(defstruct Res :implements Iterable<Int> ... )
(let r (Res 0))
(console.log (r :of Iterable))     ;; false   -- on BOTH backends
(console.log (r :of Disposable))   ;; false
```

The type-test operator answers false for an interface even when the receiver's type declares
`:implements` and the checker has verified the claim (LL0209 fires if a member is missing). The two
backends agree, so this is not a divergence — it is a capability the language does not have.

Whether that is a *bug* or an unwritten ruling is genuinely open: `:of` may have been intended for
concrete types only, with conformance left to `:extension` dispatch (which is nominal and does work —
`30-applications/02_interface_conformance.lisp` is built on exactly that distinction). Nothing states
either. **D58 assumed it worked**, which is how the gap surfaced.

> **Closed 2026-07-23.** Ruled a bug, not a restriction: the language verifies `:implements` at
> compile time (LL0209), so having no way to ask about it at run time is a hole rather than a design.
>
> The cause was structural. D24 erases interfaces — no class, no prototype, no descriptor — and both
> type tests walk the INHERITANCE chain (`__ll_name` up the prototypes on JS, `cls->name` up
> `:extends` on C). An interface is not on that chain, so there was nothing to find; the tests were
> not wrong, they were asking a question the runtime could not represent.
>
> Conformance is now CARRIED. The transitive closure — own `:implements`, each interface's own
> supers, everything inherited through `:extends` — is resolved once at lowering onto
> `HClass.interfaces` (A-0: both backends need the same answer, so it is decided once) and emitted as
> `static __ll_interfaces` on JS and `ll_class.interfaces` on C. Both tests then do a flat string
> scan, which is the only form available to them. Guarded by
> `80-adversarial/interface_conformance_runtime.lisp`, negative half included — a `:of` that failed
> OPEN would silently widen every `match` type-pattern and every operator overload dispatching on it.

### 14.2 `:implements A B` records only the first interface **[CLOSED 2026-07-23]**

```lisp
(defclass Both :implements A B ...)
(console.log (type x))    ;; :implements ["A"]      -- B is dropped
```

Confirmed on `defclass` and `defstruct`, on both backends, in the D54 metadata graph. So a type
cannot even *claim* to be both `Iterable` and `Disposable` — which is precisely what a disposable
sequence source is, and why 14.1 could not have been worked around by fixing only the type test.

**`08-generics/06_multiple_interfaces.lisp` is currently green while dropping an interface**: its
golden does not print the `:implements` list, so nothing catches it. Recorded here explicitly because
a green golden over a wrong answer is the exact shape this ledger exists to make visible.

> **Closed 2026-07-23, and the diagnosis above was WRONG in a way worth recording.** Nothing
> "recorded only the first" — the checker's own loop walks `node.implements` in full and the D54
> metadata maps over all of them. Every layer downstream was ready for a list that only ever had one
> element, because the defect was in the GRAMMAR: `classDecl`/`structDecl`/`interfaceDecl` each took
> exactly ONE `typeRef` per inheritance keyword. So in `:implements A B`, the name `B` fell through
> into the class BODY (`MANY3(expression)`) and was silently parsed as a bare expression — and
> `:implements A B :extends Base` did not parse at all, because `:extends` is not an expression.
>
> Fixed by letting a keyword own every type ref up to the next one (`AT_LEAST_ONE(typeRef)`),
> unambiguous because a type ref is a bare identifier and a body form always starts with `(`. This is
> what 14.1 needed first: a type could not otherwise claim to be both `Iterable` and `Disposable`.

### 14.3 `iter` does not agree on what a cursor IS **[CLOSED 2026-07-23, S2b]**

```
C    ll_iter(obj)  ->  obj->iterator()  ->  the OBJECT itself
JS   iter(x)       ->  { next() { ... } }   -- a fresh anonymous wrapper, always
```

`RuntimeProvider.ts`'s `iter` shim builds a wrapper unconditionally, so on JS a cursor has no
`dispose`, no `__ll_name`, and no identity — `(type (iter r))` answers `Map` on JS and `Res` on C.
A real divergence, and the reason D58's "dispose the source cursor" was amended to "dispose the
collection": the cursor is not the same object on the two backends, so disposing it would have worked
on C and silently done nothing on JS.

Not fixed in G5 because the shim is on every iteration path in the corpus; the blast radius belonged to
its own gated commit, not to disposal.

**CLOSED in S2b, and it was TWO defects, both JS-only.**

*(a) The `[Symbol.iterator]` bridge was not transitive.* `JSClassBuilder.buildIterableBridge` tested
the literally-written `:implements` list for the name `Iterable`, so a type declaring the MORE PRECISE
`:implements Iterator<T>` got no bridge at all — `for :each` over it emitted `for (x of c)` and threw
"is not iterable", while C drove it happily through `iterator()`. **Declaring the better interface was
the thing that broke**, which is why D30's `Iterator<T> :implements Iterable<T>` ruling was not
actually true on JS. The corpus never caught it: its one hand-written cursor
(`13-generators/00`'s `Countdown`) declares `:implements Iterable` directly. Now uses
`conformedInterfaces()` — the same transitive closure `__ll_interfaces` uses, so the bridge and the
runtime type-test can no longer disagree.

*(b) `iter` wrapped unconditionally.* Now identity-preserving, mirroring `ll_iter`, narrowest test
first: an l-lang Iterable answers `iterator()` and that result is returned untouched; a generator is
already its own cursor on both backends and is returned unwrapped (which keeps `.return()`, the route
`dispose` takes to a JS generator, reachable); everything else — arrays, strings, maps — gets the
wrapper, which is the arm that always agreed because C builds a cursor there too (`LL_H_CURSOR`).

`(== (iter c) c)` is now true on both backends for a hand-written cursor, and `(type (iter c))`
answers the type's own name rather than `Map`. Guarded by
`examples/80-adversarial/iterator_identity.lisp` on the C ratchet, which pins identity, the *strong*
form of it (pulling through the returned value must advance the ORIGINAL — a clone would restart),
and the container arm, so the file says which arm is which rather than implying every `iter` is
identity.

### 14.4 Not built: `for :each` disposal at exit edges **[RULED 2026-07-23 — deferred]**

D58 also specifies the compiler half — "dispose on statically known exit edges — exhaustion and an
early `return` crossing the loop". **G5 does not build it**, and the reason is a consequence of 14.3
rather than effort.

With disposal keyed on the COLLECTION (forced by 14.3), a `for :each` that disposed its source would
release a collection the program may still hold and loop over again. C# avoids this by disposing the
*enumerator*, of which each `foreach` makes a fresh one — but in l-lang `iterator()` returns `this`,
so cursor and collection are the same object and there is no per-loop enumerator to dispose. Every
available form therefore either diverges across backends (dispose the cursor) or breaks source reuse
(dispose the collection).

The library half — which D58 itself calls "where the real leak lives" — is unaffected and is built:
`take`, `take-while` and `zip` own their `coll` parameter and are abandoning it by construction.

**S2b changed the situation, and it is now a decision rather than an obstacle.** 14.3 is closed, so a
cursor is the SAME OBJECT on both backends and disposing it would mean the same thing in both places.
The mechanism D58 originally specified — dispose the cursor, not the collection — is available again.

What is left is a semantics call with real breakage potential, and it is not the compiler's to make:

**Should `for :each` dispose the cursor it obtained?**

- **For a generator** — clearly yes. It is single-use, the loop is what exhausted or abandoned it, and
  `.return()` / `ll_dispose` is exactly the hook.
- **For an `Iterable` whose `iterator()` returns a FRESH cursor** — yes, and this is the C# `foreach`
  semantics the split was modelled on.
- **For a type whose `iterator()` returns `this`** — this is the hazard. Cursor and collection are one
  object, so an ordinary loop would dispose the SOURCE, and a second loop over the same value would
  find it spent. Note C# has exactly this hazard and accepts it: a class that implements both
  interfaces and hands back `this` *does* get disposed by `foreach`. The counter-argument is that
  l-lang's corpus writes `(fn iterator [] -> Iterator<T> (return this))` as the idiom, so the hazard
  would be the common case here rather than the exotic one.

Three defensible answers: dispose always (C# semantics, accept the hazard); dispose only what the loop
itself created (a generator, or a cursor not identical to the source — narrow and safe, but a rule with
an `if` in it); or leave `for :each` alone and keep disposal purely in the library, where `take` /
`take-while` / `zip` already do it by construction.

**RULED (Sabaka, 2026-07-23): dispose always — C# semantics, accept the price loudly.** A `for :each`
disposes the cursor it obtained, including when `iterator()` returned `this`, so a self-cursoring
source walked by an ordinary loop IS spent afterwards. The hazard is real and is documented rather than
designed around — a program that needs to re-walk such a source rebinds a fresh one, exactly as it
would in C#. **Deferred, not built:** the problem has library-level workarounds today (`take` /
`take-while` / `zip` dispose by construction) and no corpus consumer is blocked, so this waits until it
actually bites. When built, it lands with an adversarial guard that pins the self-cursoring source
being spent, on both backends.

## 15. The module boundary, root-caused (Phase S1, 2026-07-23)

Phase S1 exists because two independent audits converged: Dove's stdlib roadmap wanted to roughly
double the module count, and `../l-lang-games` — the project's first multi-file programs — measured
nine distinct failures crossing a file boundary. See `docs/inbox/stdlib-games-recon.md`.

### 15.1 N14 — an imported body lost its static types **[CLOSED 2026-07-23, JS]**

The most expensive finding the games corpus produced: `(/ Int Int)` in an IMPORTED body silently
became REAL division, so a function declared `-> Int` returned `3.5` on JS with no diagnostic from
either backend. It produced a correct minesweeper board on C and a wrong one on JS from one source
file.

**Two root causes, in series. Both had to go.**

*(a) The compiler has TWO trees per module and the symbol table indexed the wrong one.* The stage
order is `symbols -> desugar -> types`, deliberately — `Context`'s desugar comment explains it cannot
move, because the scope index is built over the pre-desugar tree and `scopeOf` climbs `_parent` back
into it. But `DesugarAstVisitor` REBUILDS nodes, so afterwards `SymbolEntry.value` still pointed at
pre-desugar objects while type inference — and therefore `Context.nodeTypes` — worked on the new ones.
Measured on the two-file repro: the two trees carry the SAME source spans (`33..49`, `41..48`,
`44..45`, `46..47`) and share **no object identity at all**. Fixed by
`SymbolTable.repointAfterDesugar`, matching on kind + exact span, root entries only.

*(b) `Context.nodeTypes` was REPLACED per module rather than accumulated.* Imports are processed in
the symbols stage (`BuildDependencyGraphAstVisitor` recurses into `process(..., "types")`), which
published the imported module's node types — and the importer's own types stage then overwrote them.
The map is identity-keyed and modules own distinct nodes, so accumulating is sound and cannot
overwrite an answer.

*(c) and the inliner then discarded what (a) and (b) restored.* `desugaredCopyOf` is
`DesugarAstVisitor.visit(cloneNode(node))` — a fresh tree by construction, with no identity in the
channel. `carryTypesInto` now transfers the original's types onto the copy through
`recordSynthesizedNodeType`, the seam built for exactly this ("a fresh node object has no entry and
the decisions would silently degrade").

Guard: `test/imports.ts`, "S1a: an imported body keeps its static types". Red before, green after,
goldens derived from D49d rather than captured.

### 15.2 OPEN (Lane B) — `field := (/ Int Int)` in an IMPORTED METHOD traps on C

Found while removing the games repo's `int-div` workaround to prove 15.1 — which is what the
workaround-removal test is for. **Pre-existing and NOT caused by S1a**: verified against a clean
`git worktree` at `02a33d0`, where the emitted C is byte-identical.

```
(defclass C1 (mut lines <- Int 25) (mut lvl <- Int 0)
    (fn calc [] -> Void (this.lvl := (/ this.lines 10))))     ;; in lib.lisp, IMPORTED
```
```c
ll_value __ll_st0 = ll_box_real(((double)(ll_unbox_int((__self)->fields[0])) / (double)(INT64_C(10))));
(__self)->fields[1] = __ll_st0;      /* a Real into an Int field -> TypeError: expected an Int */
```

|                       | HEAD (02a33d0) | after S1a |
|---|---|---|
| JS | `2.5` — N14's wrong answer | **`2`** — fixed |
| C  | `TypeError: expected an Int` | `TypeError` — unchanged |

**This refines N14's write-up.** The games report says C "re-coerces at the next typed parameter and
lands on the right answer by accident". That holds for a free function; in the field-assignment shape
it is a hard trap instead. Narrowed by bisection — a free function is fine, returning the quotient is
fine, and it is specifically ASSIGNING an int quotient to a field inside an imported method. Same
shape in a single file is correct on both backends.

### 15.3 OPEN (Lane B) — N12 survives S1a

`.length` on an imported module-level vector still emits `ll_dyn_length(u_GLYPHS)` against an
`ll_vec*`. Re-measured after 15.1 on the hypothesis that it shared the missing-type root; it does not.
A missed box on the hoisted-global path, and a C-side fix.

### 15.4 N1 + N15 + N2 — one bug, not three **[CLOSED 2026-07-23]**

Three games-corpus findings with one root cause: `SymbolTable.resolveSymbol`'s fall-through is a flat
FIRST-WINS union over every loaded module root, iterated in module-JOIN order. So which `write-line` /
`iabs` / `rect` a file got was decided by which module happened to be processed first — and a stdlib
module always wins, because the prelude and package co-processing get there earlier.

- **N1** — a one-parameter `write-line` defined ONE FILE AWAY lost to `std/io/stream`'s two-parameter
  one, reached only transitively. Reported as "expects 2 arguments, got 1".
- **N15** — `std/math/rational.lisp`'s PRIVATE `iabs` beat a program's own exported `iabs`, and the
  LL0215 that fired named a stdlib file the program never mentioned. 26 modules leak 32 private
  top-level names this way.
- **N2** — `std/math/complex`'s `rect` beat a local five-parameter `rect`. Loud only because the
  arities differed; silent whenever they agree.

**The fence was never wrong.** `checkSymbolVisible` asks the right two questions and `isVisibleFrom`
is a single correct rule. Resolution handed them the wrong symbol, and the diagnostics faithfully
described it.

**Fix:** `resolveByImportPriority` — on a lexical miss, prefer a module the asking file DIRECTLY
imports (exported entry first, then merely-declared, so package siblings still resolve) before the
flat union. The graph is `Context.importBindings`, already populated by the dependency-graph pass and
already read by `importBinds`; the table gets a reader, not a copy.

Deliberately narrow, because the note on `isVisibleFrom` warns that filtering here "only LOOKED
airtight" when most callers cannot say who is asking — still true, 63 call sites and 13 pass `from`.
So this runs ONLY on the `from` path, and it is a REORDERING rather than a filter: a name reachable
only transitively still resolves through the unchanged union. Nothing that resolved before stops
resolving.

**RESIDUAL, stated rather than discovered later:** type references, `:extends`, `new` and most of
codegen call `resolveSymbol` bare, so a cross-module TYPE-name collision keeps the old first-wins
behaviour. Fixing that is the `from`-passing migration the `resolveSymbolLexical` note describes, and
it is a separate phase.

Verified by removing a workaround rather than by a green suite: `../l-lang-games` renamed `iabs` to
`int-abs` *because of N15*; renaming it back in a scratchpad copy keeps the corpus 15/15 on both
backends.

### 15.5 LL0240 — the duplicate cross-module symbol gate **[BUILT 2026-07-23]**

Dove's stdlib roadmap asks for this "before the module count doubles", and names the warning shot
already fired (`Number` defined twice). Note the code: the roadmap says LL0218, but **LL0218 is
occupied** (`TypeOfStringLiteral`, a Warning). Next free in the band was LL0240.

S1b made resolution deterministic, but determinism is not the same as unambiguous: when two directly
imported packages each export the name, the priority pass takes whichever root comes first in the
forest, and that order is an accident of module processing. LL0240 is the question that notices.

**Compared by PACKAGE, not by file, and that distinction is what makes it usable.** 25 exported names
in the current stdlib are already owned by more than one module — but most are same-package
re-exports (`std/math/math` republishes `std/math/constants`' `PI`), which is Mb working as designed.
Firing on those would put a warning on every math program.

**WARNING, not Error.** What is left after the package test is real and legal: `map`/`filter`/`zip`/
`reduce` across `std/iter/linq` and `std/seq`, which the corpus does on purpose under D33's two
conventions. Erroring would break working programs to warn about a hazard. Reported once per name per
file, at the use site.

Both halves are guarded in `test/imports.ts`: the positive (linq + seq both offering `map` warns AND
still compiles) and the negative control (a same-package re-export must stay silent) — a diagnostic
that cannot stay quiet gets ignored, which is a worse failure than one that never fires.

### 15.6 N11 — an imported `defenum`'s members were undefined identifiers **[CLOSED 2026-07-23]**

`(defenum Dir :up :down)` emits one binding per member, named from the ENUM's source spelling
(`Dir3aup` on JS, `u_Dir_3aup` on C). **The symbol table registers the enum and never its members**,
so across an import `Dir:up` resolved to *nothing at all* — and each backend then failed its own way,
with zero diagnostics from either:

- **JS** — `visitIdentifier` never reached the inliner (that branch needs a resolved symbol) and fell
  through to the bare mangled name: `ReferenceError: Dir3aup is not defined`.
- **C** — `registerEnum` is driven off `topLevelStmtNodes(body)`, the ROOT module's declarations, so an
  imported enum was never scanned: `use of undeclared identifier 'u_Dir_3aup'`, caught by cc.

Same finding, two pipelines, two fixes.

**JS — `ensureEnumInlined`, and deliberately NOT renamed.** Every other inlined symbol becomes
`__ll_inlined_X_1` because only its own references must agree. An enum's members are referenced by a
name derived from the SOURCE at every site, including sites inside other inlined bodies, so renaming
the declaration would mean rewriting reference sites the inliner does not own. Emitting the
declaration verbatim makes every existing reference correct at once. Visiting the node also refills
`enumKeys`, so an imported enum works in a `match` for the same reason a local one does.

*Residual, named:* two modules exporting a same-named enum would emit colliding `const` bindings.
That is exactly the shape LL0240 (15.5) warns about.

**C — `lookupEnumMember`, resolved lazily on first reference.** The same route imported CLASSES
already take here (`registerClass`'s "no HClass — imported/desugared copy" fallback also reads the
symbol table). The head of `Dir:up` is enough to find the declaration and fold the member to its
constant. Nothing is emitted on this backend — an enum member is a compile-time constant — so there
is no collision and no rename question.

Guarded on BOTH backends in `test/imports.ts` (the suite gained a `buildC` helper for exactly this:
a JS-only guard would leave half the finding unprotected), across all four use sites the games report
names — argument position, an imported function body, a class field default, and the importer's top
level.

Verified by removing a workaround: `snake/core.lisp` uses `let` constants and its header says why
("DIRECTIONS ARE Int CONSTANTS, NOT A `defenum`, AND THAT IS FORCED"). Converting them back to the
`defenum` it wanted keeps snake green on both backends against its authored golden.

### 15.7 OPEN (Lane B) — an imported body's `Int / Int` with a LOCAL operand is REAL division on C

Found while building `parse-int` (Tier-0). The C-side residual of N14: S1a fixed the JS inliner's type
channel for imported bodies, but the C backend's imported-body lowering does not get a LOCAL's Int
type into the `isIntDivision` (D49d) decision, so `(/ Int Int)` degrades to double division.

Precise trigger, bisected:

- imported function, division of **parameters** → integer division, correct (`idiv [a <- Int b <- Int]`).
- imported function, division involving a **local** (even `(let d <- Int (- x 48))`) → **double**:
  emitted `(int64_t)(((double)((INT64_C(100) + u_d)) / (double)(INT64_C(10))))`.

**Silent, and only wrong past 2^53**, where a double can no longer represent the integer exactly. For
small values the double round-trips and the answer is right, which is why it hid — the failure surfaces
only at a near-INT64 boundary. It is the same family as 15.2 (the field-assignment trap), narrowed: a
parameter carries its type through the C signature, a local does not.

**Worked around, not blocking:** `try-parse-int`'s overflow check is written DIVISION-FREE
(precomputed `Q = INT64_MIN / 10`, comparisons only) precisely so it is robust regardless of this gap.
The real fix is to carry local-node types into the C imported-body lowering, the C analog of what S1a
did for JS.

## 16. Codegen findings surfaced by the Tier-0 stdlib build (2026-07-23)

### 16.1 OPEN — a value-position `match` with a THROWING arm emits invalid JS

`parse-int` was first written as `(match (try-parse-int s) { nil => (throw ...) v => v })` — a match in
VALUE position (its result is the function's return value) with one arm that throws and one that yields.
On C this compiles and runs correctly; on JS it is **ELL0101** ("the JS backend emitted code that is
not valid JavaScript"), so no file is written. A guard-`if` that throws on nil and returns on the
fall-through works on both backends and is what `parse-int` uses instead.

Minimal: a value-position match where one arm is a bare `(throw ...)` and another yields a value. The
throwing arm produces a statement where the JS emitter expects an expression. Its own commit; not
chased inside the Tier-0 build.

## 17. Cross-module class-hierarchy bugs, closed by Phase E (2026-07-23)

Errors were the first code with a DEEP hierarchy defined in one module and used across an import, and
they uncovered three cross-module class bugs — the same "the machinery was never load-bearing until
now" pattern as the S1/games findings. All three closed as E1/E2, each with a both-backends guard in
`examples/18-error-handling/`.

- **§17.1 [CLOSED] — JS `catch :of ImportedClass` emitted `instanceof <bareName>`.** The import inliner
  renames a class (`__ll_inlined_ValueError_1`), so `instanceof ValueError` was a ReferenceError. The
  boolean `(x :of T)` guard was unaffected — it uses `__ll_is_type(v, "T")`, a test by name against
  `static __ll_name`. The catch filter now uses the same (`EmitHirToEstree`), which also handles
  interfaces and the `:extends` chain, so it is strictly more capable than `instanceof`.
- **§17.2 [CLOSED] — JS inlined subclass emitted `extends <bareParent>`.** `JSClassBuilder.processExtends`
  now routes an imported parent through `ensureSymbolInlined`, which both defines the parent and yields
  its inlined name — the class analog of S1d's enum-member inlining.
- **§17.3 [CLOSED] — C `ensureClassRegistered` never registered the `:extends` parent.** Registering an
  imported `IndexError` left `ValueError` absent from the class registry (`ll_is_type` chain walk found
  nothing; field flattening had no parent). It now recurses the parent chain, terminating at the
  ambient builtin `Error`.

Note §9.2 (the C field-layout trap) remains OPEN — Phase E's ctor-only rule dodges it rather than
fixing it.

## 18. Cross-module TYPE-name resolution + a class extending an imported parent (Phase T)

### 18.1 [CLOSED, T1] — the S1b type-name residual

S1b made a cross-module VALUE name prefer the directly-imported module; TYPE references took a bare
path, so a cross-module type-name collision resolved by first-wins processing order (two modules
exporting `Widget` of different shape → the wrong one bound to `<- Widget` / `(new Widget)`, a spurious
`ELL0203`). Checker-level, both backends identical. Closed by routing four bare-by-name resolution
sites through S1b's import priority: `TypeChecker.unwrapType` (the deferred `type-ref`, which now
carries an `askingSource` stamped at `convertAstTypeCore`), `constructorParams` (the `:extends` parent,
via a stamped `parentSource`), and `inferNewExpression` (resolve the class FROM the `new` site). The
bare `resolveSymbol` stays the fallback, so a transitively-reachable type is unchanged.

**Residual of the residual:** the ~44 bare `resolveSymbol` callers were NOT swept blind; only the three
sites the guard exposed were fixed. The `TypeChecker.ts` by-name conformance/assignability lookups
(334/377/382/388) were audited and left — they operate on already-disambiguated types and no guard case
reached them. This connects to the `TYPE_NAMED_GLOBALS` note (the `Number` story), which names the same
root and the same eventual fix ("prefer a type-kind symbol when resolving a type name").

### 18.2 [CLOSED, T1b] — a module's OWN class extending an IMPORTED parent

Surfaced once T1 stopped the checker refusing a cross-module `:extends`. Pre-existing, independent of
any collision, absent from the corpus, broken on BOTH backends: JS took the super name from
`HClass.superName` verbatim (the HIR class-shell emitter), so `class Sub extends Base` referenced the
bare name the inliner renamed → undefined; C's `registerClass` never registered an imported parent, so
the inherited field layout was empty → `value has no such member`. The E2 fixes covered the INLINED
subclass path; this is the same gap on the non-inlined (root-module class) path. JS: a
`superBindingName` legacy hook resolves the parent through the inliner (mirrors `JSClassBuilder.
processExtends`). C: `registerClass` now `ensureClassRegistered`s an imported parent before reading its
descriptor. Guard also catches `:of Base` (subtype catch by the imported parent), composing with E1.
