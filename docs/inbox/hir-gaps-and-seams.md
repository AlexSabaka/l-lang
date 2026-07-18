# HIR gaps & seams — the road to a clean JS/LLVM split

**Purpose:** measure how close the HIR is to *cleanly separating* the JS lowering flow
(`HIR → ESTree`) from a future LLVM flow (`HIR → LLVM IR`), and lay out the shortest sequence to
get there. Input to the next Sabaka⇄Dove sequencing round.

**Provenance:** adversarial multi-agent review (104 agents, 5 map readers → 5 attack dimensions →
3-skeptic verify per finding → synthesis). 31 findings surfaced, **22 confirmed** (≥2/3 skeptics).
Cheetah independently re-verified the load-bearing claims against the code (see *Verification* at
the end) before writing this up.

---

## Verdict: PARTLY SEPARATED — set up, not yet splittable

The **skeleton is genuinely backend-neutral**, and that retires the majority of the structural
risk. But an LLVM backend **cannot consume the `HirModule` alone today** — it would have to:

1. re-enter `JSTransformerAstVisitor.visitExpr` for every **atom, call, constructor, and pattern**
   (the two opaque leaves + the named leaf hooks),
2. carry `context.nodeTypes` as a **companion input keyed by raw-AST identity** to type anything
   inside an opaque leaf (the HIR is not type-self-contained), and
3. find **object construction entirely outside the HIR**, in `JSClassBuilder`.

The distance is dominated by **five IR-modeling cuts** — model atoms, R4 (dispatch), construction
(`HConstruct`/`HFieldInit`), R3 (stores/copies), and a **coercion / box / unbox node family** at the
static↔dynamic boundary that neither the code nor the first review named (see blocker 3) — with
coroutine nodes a sixth, smaller cut. The type channel is **not** a "complete it" job: it's a
*measure-and-split* — separate should-have-a-type-but-doesn't (a bug, fix it) from
legitimately-dynamic (box it; that is what *gradual* means). Everything else (the ESTree-typed hook
signatures, pattern re-derivation, under-modeled var-decl/assign/for-each/catch) is smaller and
*follows* from those. The bar for "separated" is Swift SIL's: a backend consumes `HirModule` and
**nothing else** — no `nodeTypes` side-table, no original AST.

## What's already done (real, and worth stating)

- **`nodes.ts` is ESTree-free** — imports only `ast` and `InferredType` (verified). No node holds
  a JS type or a runtime-helper name as a field.
- **The control-flow core maps cleanly onto LLVM** — `HTemp / HDeclTemp / HAssignTemp / HIf /
  HBlock / HTernary / HSeq / HReturn / HWhile / HFor / HTry`, plus the inverted `HVector / HMatrix /
  HMap / HMember / HIndex`, are basic-blocks / SSA / `select` in disguise.
- **R1 (ANF/position, tail-return, value-position conditionals) and R6 (mechanical 1:1 emit) are
  done** on the (now only) path. The emitter already programs against an *interface*
  (`LegacyLeafEmitter`), so all JS coupling funnels through **2 opaque leaves + 9 named hooks** —
  a small, enumerable surface. `nilLiteral` is the one hook already at its neutral floor; it's the
  template every other hook should collapse toward.

---

## The gaps & seams (8 ranked blockers; #8 now resolved)

**1 — The opaque-expr frontier: atoms + all dispatch (R4).** The two hottest constructs in any
program — a variable read and a literal — plus every call/operator/extension/constructor are
`HOpaqueExpr` / rebuilt-AST leaves handed to `visitExpr`. The IR doesn't model its own leaves, and
the resolved callee (`ext_total(recv,…)` vs `recv.method(…)`) is never recorded, so dispatch is
double-decided by checker and codegen (the TY8 seam). *Fix:* model atoms (`HLiteral` typed value,
`HRef` resolved binding) **first** (small, unblocks the type work), then R4 (resolve dispatch at
lowering into concrete call nodes). Together these empty most of `leafExpr`. *(Q3, resolved:* R4 is a
**dedicated AST→HIR lowering pass that reads the type channel**, not a fold into the typed-AST walk —
dispatch resolution *changes shape* (`(obj.m args)` → `ext_total(obj,args)` vs `obj.m(args)`), and
mixing shape-changing lowering into the checking/annotating walk rebuilds the exact ad-hoc
entanglement the HIR exists to kill; it must not re-infer (R5). Swift SIL settled this —
devirtualization is a pass *on* the IR, turning `witness_method`/`class_method` into resolved
vtable/type-witness lookups. TY8 was checker and codegen deciding independently; the fix is decide
once, on the HIR side of the AST→HIR boundary, downstream of the diagnostic.)*

**2 — Object construction bypasses the HIR entirely.** Copy-on-entry prologue, `super(…)`,
per-field `this.x = param`, every field-initializer expression, and `new` allocation are hand-built
as ESTree in `JSClassBuilder.buildConstructor/buildFields` (verified) — **not even an opaque leaf**.
LLVM gets *nothing* for instantiation: no field layout, init order, copy-on-construct, or super
dispatch. *Fix:* an `HConstruct / HFieldInit` family + typed field stores; route field inits and
constructor assignments through `lower(node, dest)`; `JSClassBuilder` becomes a thin emitter of it.

**3 — The type channel is write-only — but its gate is a BOXING problem, not a completeness one
(reframed).** JS erases types, so `undefined` is free; LLVM cannot. Verified: **`h.type` is read by
no backend** — the emitter never consumes it, so a wrong/absent type still passes 100% of JS tests.
The trap the first pass fell into was collapsing two very different states into "holes to eliminate."
Split them, because l-lang is **gradually typed by design**:
- **`type` = `undefined` on a value node is a BUG** — it should have gotten a type and didn't. The
  non-decimal numeric literals (hex/oct/bin) typing as `Unknown` are actually *this*: they should be
  `Int`. A genuine inference hole; cheap to close.
- **`type` = `Unknown` is NOT a hole — it's box-me.** The ~178 `Unknown` param/local identifiers are
  mostly *irreducibly dynamic, correctly so*. If the LLVM boundary **rejects** `Unknown`, l-lang stops
  being gradually typed on native. It is a *representation* question, not a checker project.

Prior art is decisive (Grift, Siek): AOT-compile gradual code to native by translating first to an IR
with **explicit casts**, giving `Dyn` (their `Unknown`) a uniform 64-bit boxed/tagged representation
with space-efficient coercions at the static↔dynamic boundary — OCaml-class performance on typed code,
Gambit/Racket range on untyped. So **box `Unknown`, don't reject it; LLVM readiness needs zero
`undefined`, not zero `Unknown`.** This forces out a node family neither the code nor the review
named: **coercion / box / unbox nodes** at every boundary where a typed value flows into an `Unknown`
slot or back out. On JS these coercions are *erased* (free), which is why the current HIR has no place
for them and nobody noticed; on LLVM they are load-bearing — probably a **bigger modeling cut than
coroutines**, and invisible from the JS side (writing the LLVM consumption spec forces it out first).
Inside opaque leaves, sub-part types live only in `context.nodeTypes` by raw-AST identity, so the
`HirModule` isn't type-self-contained. *Fix:* a verify pass **now** that classifies each
value-position node as *has-a-concrete-type* / *`undefined` (bug → fix)* / *`Unknown` (dynamic → will
box)* — **measuring the split, not counting holes**; type the integer-literal kinds as `Int`. Never
make "zero `Unknown`" a gate; "zero `undefined`" is the gate. Runs in parallel with 1–2.

**4 — R3: stores/copies are a JS emit hook, not IR nodes.** D11 copy-on-store lives in `storeValue`
(`__ll_copy`/`needsValueCopy`/`provablyNotAStruct`) + `parameterCopyPrologue` + copies embedded in
`emitVarDecl/emitAssign/assembleForEach` and applied unconditionally to collection elements. For
`HAssignTemp/HReturn` the *where* is at least an `isStore` flag; for collection literals and param
copy-on-entry there's **no IR footprint at all**. *Fix:* insert explicit copy nodes at every store
site during lowering; retire the hook + predicate family. The copy **decision** is backend-neutral;
only the materialization (`__ll_copy` vs `memcpy`) differs. *(Q4, resolved:* copy-at-every-store does
**not** change the shallow-at-reference default — it makes it *uniform* and unlocks elision. Standard
mutable-value-semantics implementation (Val/Hylo): copy everywhere naively, then remove the waste in
later passes — move when the source is dead, skip when neither side mutates. But the nuance that
matters here: **l-lang chose SHALLOW (C# value-type) semantics; Hylo is DEEP (full MVS).** Per CP3,
`__ll_copy` recurses a struct's own fields but returns arrays *unchanged*; `deep-copy` is opt-in. In
Hylo aliasing is never observable, so eliding a copy when the source dies is trivially safe; in
l-lang aliasing **is** observable (a copied struct shares its array fields — the whole reason
`deep-copy` exists), so eliding a struct copy requires proving the struct's *own* fields aren't
observed after the store. Shared arrays are aliased by design either way; move-when-dead is still
clean; but the elision headroom is narrower than the MVS papers make it look, and the proof
obligation differs. Practical read: keep shallow-at-reference as the ruled default, make stores
explicit so the rule is uniform, treat elision as a **future optimization the model unlocks, not a
semantic change** — and be honest it may not pay on JS (`__ll_copy` is cheap-ish); it earns its keep
on LLVM, where copies are real memory traffic. The most "defer until the backend exists" of the
cuts.)*

**5 — Coroutines have no HIR representation.** `yield` is an opaque leaf → JS `YieldExpression`;
generator-ness rides on `FunctionNode.generator` read at emit; `await` is opaque. The HIR carries no
suspend/resume node and never marks a body as generator/async — so LLVM can't even *distinguish* a
generator body, let alone find suspend points for `llvm.coro.*`. (Per D29, JS gets the protocol
free.) *Fix:* explicit `HYield/HAwait` + generator/async marking in `HirModule`; lower per-backend.

**6 — R2 pattern half: match tests + binding sets re-derived from raw AST.** `HPatternTest` holds a
raw `PatternNode` + guard; `HHoist` carries no names. `generateCondition` **fuses binding into the
boolean** as side-effecting comma sequences (`(x = v, true) && __ll_is_type(…)`) — the HIR models
pattern-test as a *pure boolean* but it actually mutates, so a naïve LLVM consumer gets the
semantics wrong (this bind-then-test ordering is *why* arms need an else-chain). *Fix:* model the
test decomposition, binding set, and bind-then-test ordering as IR facts; retire
`patternTest/patternVars`.

**7 — Under-modeled binding/iteration/catch forms.** `HVarDecl/HUserAssign/HForEach` model only the
inverted sub-expression; declaration shape, mutability, `:extern`, destructuring, write target, and
per-iteration copy are re-derived from raw AST at emit; the `HTry` catch error-binding rides
`leafExpr`. *Fix:* lift binding form, write target (an lvalue node), catch error-name, and residual
per-iteration copy onto the nodes; the `const/let/var` + `ForOf` skeleton stays a trivial hook. Much
folds into R2/R3.

**8 — [RESOLVED at 01a31d8] Two eval-order bugs on the shared lowering path — and the lesson they
carry.** Fixed: a shared `lowerOperands` now counts compound force-binds in the `last` boundary, and
`lowerCallLike` hoists a dotted-indexer callee's impure index ahead of the arg prelude; two RED
behavioural regression cases landed. The bugs were:
- `lowerViaLegacy`'s `last` boundary (`LowerAstToHirVisitor.ts:308`) counted only children that
  *lowered to statements*, but a **compound-but-statementless** child (a peepholed ternary, or an
  inverted `HVector/HMap/HMember/…`) is *also* force-bound to a temp prelude (`:321`, via
  `isSubstitutable` = temp|opaque only, `:349`). So an earlier impure operand stayed inline and ran
  **after** the compound child's prelude. `(f (side 1) [(side 2)])` → `const t = [side(2)]; f(side(1), t)`
  — `side(2)` before `side(1)`.
- `lowerCallLike` (`:339`) passed only `nodes.slice(1)`; the callee/receiver `nodes[0]` was rebuilt
  verbatim and emitted inline, but arg preludes emit before the call — so a side-effecting
  callee/receiver ran **after** the arguments. `((get-obj).method (if c a b))` ran the `if`'s effects
  before `getObj()`.

**Keep the lesson, it outlives the fix.** These were not a design question — they were live
silent-correctness bugs on the *shipping* backend, introduced **by** the full-inversion unnest (the
migration whose whole justification was killing silent-failure bugs shipped two new ones — ANF
unnesting is exactly where eval-order bugs breed; Scala.js and Siek's `remove-complex-operands` are
meticulous about left-to-right binding order). And they indict the gates: **the
behavioural-equivalence corpus is a REGRESSION guard, not a correctness guard — it demonstrates
features, it doesn't attack them.** These bugs were corpus-green. The RED-first discipline is the real
correctness mechanism; the corpus diff is just regression — don't conflate them. Remedy (Rust hit this
exact problem validating its exact same multi-backend split): rustc feeds one typed MIR to
LLVM/Cranelift/GCC through a backend-agnostic interface (`rustc_codegen_ssa` — literally the step-8
"backend-parametric emitter" move) and validates with **Rustlantis**, a MIR fuzzer generating
terminating/UB-free/deterministic programs and difftesting across backends (any discrepancy is a bug).
That is the parallel-run gate turned adversarial: generate programs designed to stress
unnest/eval-order/dispatch, difftest old-vs-new (eventually JS-vs-LLVM). Even a crude generator over
"nested calls with side-effecting operands at every position" earns its keep — it is the missing half
of the validation story and would have caught this before it shipped.

---

## Recommended sequence — Dove's endorsed 0–8 (renumbered from the prior 0–10)

Each step atomic + gated, JS output preserved/diff-reviewed. *Through-line:* cuts that fix JS seams
(atoms, dispatch, construction, stores) are justified **now** on their own merits and *happen* to
serve LLVM — we lose nothing doing them first; cuts that only serve LLVM (coercion nodes, coroutines,
a hard type-completeness gate, a backend-parametric emitter) wait until the spec or an actual LLVM
prototype makes their shape concrete. This avoids the one failure mode: modeling elaborate machinery
for a backend that doesn't exist, aimed at negative space inferred wrong.

0. **Blocker 8, immediately — [DONE at 01a31d8].** Shipping correctness bug. Impure-operand
   regressions landed; **stand up a crude differential generator (Rustlantis-lite)** next — wanted
   for every cut after this one, not just for blocker 8.
1. **Write the one-page LLVM consumption spec — BEFORE the modeling cuts, as the forcing function.**
   "HIR→LLVM assumes: every value node has a non-`undefined` type; `Unknown` boxes to <repr>;
   coercions appear as <these nodes>; dispatch is resolved to <these call kinds>; construction is
   <these nodes>; here's the node family the emitter consumes." Let *it*, not the aspiration, decide
   which of the steps below are load-bearing — it likely surfaces the coercion-node family as real
   and demotes a couple of others.
2. **Measure the type channel — classify, don't count.** Split `undefined` (bug → fix) from `Unknown`
   (box → keep) with the verify pass; close the cheap `undefined` cases (integer literals → `Int`).
   Never gate on zero `Unknown`.
3. **Model atoms + move types onto the HIR nodes.** The central cut: `HLiteral` (typed, carrying the
   numeric-tower distinction) / `HRef` (resolved binding) with the `type` field **on the node**,
   starting to **drain `context.nodeTypes`** so the module becomes type-self-contained. Justified on
   JS merits alone.
4. **R4 — dispatch as a distinct lowering pass reading the channel.** Resolve
   extension/operator/member/constructor dispatch into concrete call nodes carrying callee identity;
   retire `computedExtensionCall/extensionFor/receiverConformsTo` and the checker/codegen
   double-decision. Fixes TY8 on JS regardless of LLVM; **not** folded into the type walk (Q3).
   Incremental: free calls → method/ext → operators → `new`.
5. **Construction — `HConstruct`/`HFieldInit`** + typed field stores; reroute `JSClassBuilder` and
   field inits through lowering; `new`/`typeof`/`instanceof`/`in` become typed HIR test nodes. The
   bypass is a real JS gap today.
6. **R3 — explicit stores/copies.** Copy nodes at every store site (let/mut init, by-value arg,
   field/element assign, native-mutator arg, per-iteration for-each bind, collection elements, param
   copy-on-entry); retire `isStore`/`storeValue`/`asValue…`/`parameterCopyPrologue`. Uniform on JS;
   elision **deferred** as an LLVM-era optimization (and remember: the shallow default makes the
   elision proof *different* from the MVS papers — Q4).
7. **Coercion nodes.** The box/unbox family at the static↔dynamic boundary. Falls out of the step-1
   spec; probably belongs around here; invisible from the JS side.
8. **Patterns / binding forms / coroutines — gated.** R2 pattern half (tests + bound-variable sets as
   IR operand shapes), lifting under-modeled binding forms (blocker 7), and `HYield/HAwait` +
   generator/async marking. Genuinely LLVM-only or cleanup; do each only once the spec is actually
   asking for it. This is also where the *hard* acceptance gate lives: reinstate type-completeness as
   **zero `undefined`** (never zero `Unknown`) and make `LegacyLeafEmitter` backend-parametric (it's
   ESTree-typed end-to-end today). **Definition of done (SIL's bar):** a stub non-ESTree emitter
   compiles against `HirModule` and **nothing else** — no `nodeTypes` side-table, no original AST, no
   JS-emitter imports.

## Prior art (what grounds each call)

- **Kotlin IR** — shared lowerings, per-backend emit. Confirms the chosen shape (one IR, thin
  per-backend emitters).
- **Swift SIL** — devirtualization as a pass *on* the IR (Q3, R4); explicit copy instructions (R3);
  target-independent / standalone format usable for code distribution as the bar for "separated"
  (verdict, step-8 done-definition).
- **Grift (Siek)** — AOT gradual-to-native via an explicit-cast IR with a uniformly boxed `Dyn` (Q5 /
  blocker 3 boxing + the coercion-node family).
- **Val/Hylo** — mutable value semantics, copy-everywhere-then-elide (Q4, R3) — with the caveat that
  l-lang's *shallow* default narrows the elision proof relative to Hylo's *deep* MVS.
- **MIR + `rustc_codegen_ssa` + Rustlantis** — the one-IR-many-backends bet (step-8 backend-parametric
  emitter) validated by a differential MIR fuzzer (blocker 8 remedy → the Rustlantis-lite generator).

## Open questions — now answered (Dove)

- **Q4 (R3 default) — ANSWERED: no, it doesn't change the shallow default; it makes it uniform and
  unlocks elision.** Elision is deferred (LLVM-era), and l-lang's shallow semantics make its safety
  proof *different* from the deep-MVS papers. Grounded in Val/Hylo. → blocker 4.
- **Q3 (R4 pass placement) — ANSWERED: a dedicated AST→HIR lowering pass that reads the type channel,
  not a fold into the typed-AST walk; must not re-infer (R5).** Dispatch resolution is shape-changing
  lowering; keep it off the checking/annotating walk. Grounded in Swift SIL devirtualization. →
  blocker 1.
- **Name-encoding boundary — ANSWERED: it lives in the emitter, per-backend; the IR carries SOURCE
  names.** The `player-pos → player2dpos` leak is a category error — code-mangling applied to *data*
  (D13 already rules that map/data keys are never mangled; the rule just doesn't reach members: a
  class member runs through the identifier mangler and the mangled name escapes into `JSON.stringify`
  output). Both backends inherit the same **rule** (data keys never mangled, only code identifiers)
  but **not** the same mangling (LLVM has no reserved-word/hyphen problem; it mangles *symbols* for
  the linker on different grounds). So: IR is source-named, each emitter owns its identifier policy,
  and R2's member model needs a **serialization-name field** distinguishing "member-as-access"
  (mangles on JS) from "member-name-as-data" (source name always) — cheap once the member model is
  uniform.
- **`functional-pattern` on LLVM — ANSWERED: keep it dead** (and push back on "LLVM carries types so
  it's free"). LLVM carries **static** types; matching a closure by its parameter types *at runtime*
  needs **reified** type info on every closure — a descriptor LLVM erases at codegen unless you carry
  one explicitly. Not free; *possible at a per-closure runtime cost*, for a feature already ruled
  dead. Keep dead, or make it explicit opt-in where a signature-matched closure carries a descriptor.
  General watch-item: several places lean on "LLVM has types so this gets easier," and it is sometimes
  **backwards** — native targets make you pay explicitly for things JS's dynamic runtime gave for
  free.
- **Residual `undefined`/`Unknown` policy (Q5) — ANSWERED: box `Unknown`, don't reject it.** The
  reject-or-run-a-completeness-pass dichotomy is a trap: rejecting `Unknown` ends gradual typing on
  native. Box it (Grift's `Dyn`); only `undefined` (a genuine inference bug) must go to zero. LLVM
  readiness is a *representation* gate, not a checker project. → blocker 3.
- **LLVM consumption spec — ANSWERED: write it, SOON,** as a forcing function (step 1), not because
  we're building LLVM yet. Without it the modeling cuts aim at inferred negative space; with it, the
  coercion-node family falls out as a real cut and a couple of speculative steps get demoted. Pure
  "measure before building."
- **On-demand lowering parity — ANSWERED: DEFER; not a separation blocker at all.** `__ll_hir_i`
  on-demand lowering exists because comptime runs at DESUGAR, before the lowering pass — but comptime
  **produces values folded back as literals**; it is a host-side pre-pass. A second backend doesn't
  replicate comptime's lowering; it needs comptime to have **already run** so LLVM sees only post-fold
  literals. On-demand lowering is a JS-interpreter-path concern LLVM inherits nothing from, as long as
  comptime evaluation always targets the host path. (Changes only if comptime should someday execute
  *native* code for speed — a much later, different project.)

---

## Verification (Cheetah, against the code — not just agent claims)

Confirmed independently before publishing:
- `nodes.ts` imports **only** `ast` + `InferredType` — datatype is ESTree-free. ✓
- The emitter **never reads `h.type`** (the sole `.type` read in the HIR dir is
  `LowerAstToHirVisitor.ts:872`, a loc/type-lookup fallback — not backend consumption). Write-only
  confirmed. ✓
- `JSClassBuilder` builds ESTree directly (`buildConstructor:161`, `buildFields:379`,
  `parameterCopyPrologue:268`, field inits via `this.visitor.visit(v.value)`) — **no** HIR/lower/
  emitHir call. Construction bypasses the HIR. ✓
- Both eval-order bugs (blocker 8) traced through `lowerViaLegacy` (`:307–336`) and `lowerCallLike`
  (`:339–347`) — real, and corpus-green (edge cases: impure operand before a compound operand;
  side-effecting callee with a hoisting arg). **Now fixed at 01a31d8** — and the corpus-green status
  is exactly why the fix needed RED-first cases, not the corpus. ✓

**Not independently re-measured** (the typing agent's instrumentation, and *step 2 exists to measure
it*): the "~178 `Unknown` identifiers" and "non-decimal literals type as `Unknown`" counts. Treat as
the audit's own numbers, to be reproduced by the step-2 verify pass — which reports the **split**
(`undefined` = bug → fix vs `Unknown` = dynamic → box), not a single hole count.
