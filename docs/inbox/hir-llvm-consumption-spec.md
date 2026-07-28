> **KEPT — a live contract, not a spent brief.** Its **A1–A9** assumption taxonomy is the vocabulary
> the running compiler records dips in: `src/compiler/codegen/c/GapLedger.ts:5`,
> `src/compiler/codegen/c/cir.ts:6` and `src/compiler/rules/diagnostics/CBackendDiagnostics.ts:8` all
> name this file. The dips it defines are measured on every C compile.
>
> **Status, 2026-07-28.** A2/A3/A4/A7 substantially landed. **A8 is BUILT** (D58 / Phase G) with the
> residual refusal narrowed to `:async` by D60, plus nested and lambda generators. `HOpaqueExpr` and
> `HHoist` survive as the modelling residue.
>
> **Read "LLVM" as "native".** This was written before a native backend existed; C now occupies the
> role the document reserves for LLVM, and became the reference implementation at **D86**. The
> separation bar it sets still applies to an eventual LLVM flow unchanged.

# HIR → LLVM consumption spec (v1 — Dove-refined)

**What this is.** The contract a native (LLVM) backend would consume from `HirModule` — the forcing
function written *before* the modeling cuts. v0 stated the assumptions and posed five open questions;
v1 folds in the strategy-lane review, which mostly **dissolved** those questions against l-lang's own
rulings and settled prior art, and reframed the node-family target. Grounded in
`src/compiler/hir/nodes.ts`, `EmitHirToEstree.ts` (`LegacyLeafEmitter`), `LowerAstToHirVisitor.ts`.
Draft for the Sabaka⇄Dove lane; not ratified.

---

## The frame: a neutral core + per-backend pipelines

The shared HIR is a **neutral *core*.** Each backend runs its **own lowering pipeline** over it
(rustc: one typed MIR → `rustc_codegen_ssa` → per-backend passes → LLVM/Cranelift/GCC; Kotlin: shared
lowerings → per-target emit). Once you hold that frame, some of v0's "cuts" stop being *node families
the AST→HIR lowering emits* and become **passes the LLVM pipeline runs that JS skips entirely** — JS
erases coercions and has native generators, so the JS pipeline for those is ~empty.

This is the SIL model precisely: a *target-independent core that can still express target-specific
concepts*, specialized by each target's pass pipeline. **The core HIR is the distributable artifact;
box/unbox/coro are what the native pipeline adds on the way down.**

## The bar for "separated" (updated)

> A stub non-ESTree emitter consumes **core `HirModule` and nothing else** — no `context.nodeTypes`
> side-table, no original AST, no `JSTransformer` imports. The LLVM *pipeline* (coercion pass +
> coroutine pass + eventually copy-elision) produces the annotated form the LLVM emitter then consumes;
> those passes are backend code, not part of the neutral core.

Today core-consumption is false on three counts: the emitter re-enters `visitExpr` for every
atom/call/pattern (2 opaque leaves), reads types out of `nodeTypes` by raw-AST identity (not off the
node), and construction is built as ESTree in `JSClassBuilder` (not in the HIR at all).

---

## Assumptions (each = a cut; ✔ = resolved by the review)

### A1 — Every value node carries its own non-`undefined` type; `Unknown` is boxed.
`HBase.type` is **write-only today** (the JS emitter never reads it) and lives in `nodeTypes` by raw-AST
identity, not on the node. LLVM needs a layout at every node.
- `undefined` on a value node = **bug** (fix at source). `Unknown` = **box-me** (the gradual
  concession, a *representation* not a hole). Native readiness = **zero `undefined`, never zero `Unknown`.**
- ✔ **Types on *every* value node** (Q2 dissolves under ANF): operands are only ever atoms or temps, so
  type the atoms as ground truth and each temp at its definition site with the combinator result — every
  value position is then covered, with no re-inference (R5). "Type every node" and "atoms + combinators"
  are the same thing seen from two ends; the combinator runs **once at lowering, result stored**. This is
  exactly what makes the A1 verify pass checkable.
- ✔ **Boxed-`Unknown` repr = fat pointer for v0** (Q1): two words `{tag, payload}`, payload holds a full
  `i64`/`f64`/pointer inline — no int-range trap, no float-boxing, trivially debuggable. Rejected the
  compact tagged-word / NaN-boxing options *for now* because **D43 decides Int vs Real statically**, so
  in typed code ints/reals are already unboxed natives and tagging never enters; NaN-boxing's whole
  payoff (free dynamic doubles) is muted for a statically-typed language. A5/A6 keep this **reversible**:
  the copy/coerce *decision* is IR nodes, only the *materialization* is backend code, so fat-pointer →
  tagged-word later is a localized swap, not an ABI rewrite.
- **Steps 2 (measure) + 3 (atoms carry types, drain `nodeTypes`).**

### A2 — Atoms are modeled, not opaque.
A variable read and a literal are `HOpaqueExpr` today (`leafExpr` → `visitExpr`). Need `HLiteral` (typed
constant, numeric-tower-aware) and `HRef` (a **resolved** binding). ✔ Measurement constraint (Step 2):
the type channel is **sparse for references**, so `HRef` must **resolve** its type via the symbol
table / declaration — it cannot copy `nodeTypes`, which mostly doesn't have it. **Step 3.** JS benefit:
makes the module type-self-contained; empties most of `leafExpr`.

### A3 — Dispatch resolved — but it is THREE mechanisms, not one (Q4 ✔).
There is no call node in the HIR; a call is an `HOpaqueExpr` re-dispatched by `visitExpr`, and the
checker decides the same thing independently (the TY8 seam). v0 lumped all dispatch as "resolve to a
symbol." The review splits it by kind, because the answer differs:
- **Extension methods (`:extension`, nominal):** *always statically resolvable* — l-lang **forbids** the
  dynamic cases (LL0230 refuses extension on a bare array; LL0234 on a structural-only conformer;
  extension requires nominal `:implements`). → **devirtualize to a direct `ext_total(recv, args)`
  symbol** (SIL static devirt). The *easy* case; there is no dynamic extension dispatch in well-typed
  l-lang.
- **Interface / virtual methods (D42; `:extends` overrides):** the **genuinely dynamic** case v0 missed.
  A value typed as interface `Shape` calling `.area` picks the impl at runtime. → **witness/vtable
  representation + opportunistic devirt** (SIL hybrid: direct call when the concrete type is statically
  known — a known allocation, a final class — indirect through the table otherwise).
- **Operators (`__ll_op_registry`):** the one true runtime-dispatch mechanism today (Ze: the registry
  can't consult static types). Same shape — **static when arg types are known** (D43 says most cases),
  **boxed-dynamic dispatch when an arg is `Unknown`** (which is A1's repr doing its job, not a separate
  mechanism).

So the resolved call kinds are `free-call`, `ext-call(ext_total, recv, args)` [static],
`virtual-call(recv, witness, args)` [table + opportunistic devirt], `operator(...)` [static | boxed],
`construct(...)`. **Step 4, a distinct AST→HIR pass reading the type channel** (must not re-infer, R5).
Closes TY8 on JS regardless of LLVM. *(Ties to A1: Step 2 measured that ~70% of `Unknown` is unresolved
call results — so resolving dispatch and deciding the boxed repr are one conversation.)*

### A4 — Construction is in the HIR.
`new`, `super(…)`, per-field `this.x = param`, field initializers, copy-on-entry are built directly as
ESTree in `JSClassBuilder` — not even an opaque leaf. Need `HConstruct` / `HFieldInit` + typed field
stores; `JSClassBuilder` becomes a thin emitter. **Step 5.** Core node, both backends emit it.

### A5 — Stores and copies are explicit nodes.
D11 copy is a JS hook (`storeValue`/`__ll_copy`) + an `isStore` flag + copies buried in
`emitVarDecl`/`emitAssign`/`emitForEach`. The copy *decision* (does this store copy? shallow per CP3?) is
backend-neutral; only the *materialization* differs (`__ll_copy` vs `memcpy`/move). Explicit copy node at
every store; retire `storeValue`/`isStore`. **Step 6.** Elision is a later LLVM-era pass (shallow
semantics make its proof different from the deep-MVS papers). Core node.

### A6 — Coercions: an **LLVM-pipeline-only pass**, not a lowering-time emission (Q3 ✔).
Where a typed value flows into an `Unknown` slot or back, JS **erases** the coercion; on native the
box/unbox/cast is load-bearing. Grift settles it: cast insertion is a **discrete phase** over the IR
(the blame-calculus translation), not folded into structural emit — inlining it at lowering is the exact
judgment-in-the-emitter R6 exists to kill. And it is native-only, so it does **not** belong on the shared
AST or in the base HIR. → **The base HIR out of AST→HIR is coercion-free.** The JS pipeline's coercion
pass is the **identity**; the LLVM pipeline's *first* pass reads the type channel and produces a
**coercion-annotated HIR** (`HBox`/`HUnbox`/`HCast`) the LLVM emitter consumes. **Step 7 — a pass, not a
node family the lowering emits.** Broad (every static↔dynamic boundary) but mechanical.

### A7 — Pattern tests are IR facts, not a fused boolean.
`HPatternTest` carries a raw `PatternNode`; the test is built at emit by `generateCondition`, which
**fuses binding into the boolean** as side-effecting commas — a naïve consumer reading it as pure gets
the bind-then-test ordering wrong (why arms need an else-chain). Model the test decomposition, binding
set, and ordering; retire `patternTest`/`patternVars`. **Step 8 (R2 pattern half).** Core node.

### A8 — Coroutines: **defer entirely, then do it Rust-style** (Q5 ✔).
`yield`/`await` are opaque; generator/async-ness rides on `FunctionNode.generator` at emit; no
suspend/resume node. The review corrected the framing: A6 is **bigger** (broad + on the critical path —
*mandatory*, no dynamic value runs on native without it), but A8 is **harder per-site** (the
state-machine transform is the known tar-pit: Rust's two-await function is 360 lines of MIR vs 23; the
live-across-suspend + storage-conflict analysis is still an active Rust project; `llvm.coro` carries
sharp edges Swift had to work around). **A8 is optional and cleanly deferrable** — ship the native
backend **refusing `:gen`/async with an honest diagnostic** (this project's LL0230/LL0234 lineage), most
code never notices. When it's eventually built, do it the **Rust way — a state-machine transform at the
HIR level, backend-neutral** (JS skips it via `function*`) — **not** `llvm.coro`, which locks you to
LLVM's passes and edge cases. So: **A6 first (mandatory), A8 last (deferred behind a refusal).** `HYield`/
`HAwait` are core *source* nodes (AST→HIR emits them; JS emits native; the LLVM coroutine pass *consumes*
them → state-machine HIR — exactly how `match` is core-but-always-lowered today).

---

## What already holds (no cut)
Control-flow core maps 1:1 onto LLVM: `HIf`/`HBlock` → blocks+branches; `HDeclTemp`/`HAssignTemp`/`HTemp`
→ SSA locals; `HTernary` → `select`; `HReturn` → `ret`; `HWhile`/`HFor`/`HForEach` → loops; `HTry` →
landing pads. Inverted collections model their structure (element copy is A5, element types A1). R1/R6 done.

## The node-family target — THREE-way (the frame's payoff)

```
1. CORE, emitted AND kept — both backends emit directly:
   HTemp HLiteral* HRef* HNil HTernary HSeq  HVector HMatrix HMap HMember HIndex
   HConstruct* HFieldInit*  HFreeCall* HExtCall* HVirtualCall* HOperator*  HCopyStore*  HMatchTest*
   HIf HBlockStmt HDeclTemp HAssignTemp HReturn HWhile HFor HForEach HTry HVarDecl HUserAssign

2. CORE, emitted but LOWERED-AWAY on LLVM — a source construct one backend rewrites:
   HYield* HAwait*        (JS: native yield/await;  LLVM pipeline: coroutine pass -> state-machine HIR)

3. NON-CORE, introduced only by an LLVM-PIPELINE PASS — no source construct:
   HBox* HUnbox* HCast*   (produced by the LLVM coercion pass; base HIR never contains them)

every core value node: { type: InferredType, non-undefined; Unknown => fat-pointer boxed }
retired: HOpaqueExpr HOpaqueStmt HHoist HPatternTest        (* = added by a cut)
```

## Gap / sequencing table

| # | Assumption | Today | Closed by | kind | JS now? |
|---|---|---|---|---|---|
| A1 | value nodes typed; `Unknown`=fat-ptr | `type` write-only | Step 2+3 | node type field | via A2 |
| A2 | atoms modeled (`HRef` resolves) | `HOpaqueExpr`+`leafExpr` | Step 3 | nodes | yes |
| A3 | dispatch: ext=static, iface=witness | opaque + TY8 | Step 4 | AST→HIR pass | yes (TY8) |
| A4 | construction in HIR | `JSClassBuilder` ESTree | Step 5 | nodes | yes |
| A5 | explicit copies | `storeValue`/`isStore` | Step 6 | nodes | uniformity |
| A6 | coercions | erased/absent | Step 7 | **LLVM-pipeline pass** | no |
| A7 | pattern facts | `generateCondition` fuses | Step 8 | nodes | modest |
| A8 | coroutines (deferred) | opaque + `.generator` | Step 8/later | **core src node + LLVM pass** | no |

Through-line unchanged: A2–A5 pay on JS *now* and happen to serve LLVM; A6/A8 are LLVM-pipeline work,
gated behind this spec / a real prototype. New: A8 is **deferred behind a native-refusal**, not built.

## Measurement (Step 2, first pass — classify, don't count)
Probe over 113 corpus files, value-position nodes classified vs `nodeTypes` (rough tool; a real verify
pass is a later build):
- **`Unknown` is a dispatch story:** ~70% of `Unknown` value nodes are **calls whose return type the
  checker couldn't resolve** (~58% of typed calls); identifiers are the minority. Corrects the brief's
  "~178 `Unknown` identifiers." → boxing is downstream of A3.
- **Literals already well-typed** (Int/String/Real/Boolean); the numeric-tower-→`Unknown` hole is real
  but **tiny (1 hex node)** — cheap fix, not a volume driver.
- **Channel sparse for references** → `HRef` must resolve, not copy (A2).
- *Caveat:* the raw "missing" fraction overstates the gap (can't cleanly exclude structural
  lists/declaration-name identifiers). Trust the `Unknown` distribution + literal typing; treat missing
  as directional.

## Still genuinely open (only one)
The exact `box`/`unbox` instruction sequences — and that is **downstream of picking fat-pointer (Q1)**,
so it resolves itself the moment that's committed. Everything else (Q2 ANF, Q3 Grift phase-order + the
neutral-core frame, Q4 l-lang's own dispatch rulings) is settled above; Q5 is a corrected framing, not
an open choice.
