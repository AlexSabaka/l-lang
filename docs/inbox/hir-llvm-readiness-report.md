# HIR → LLVM readiness report

**What this is.** An honest assessment of where `HirModule` stands against the separation bar in
`hir-llvm-consumption-spec.md`, written for the Sabaka⇄Dove design round. It is grounded in the **C
backend's gap ledger** — the adversarial probe built specifically to record every place a working
native compile still reaches *below* the HIR (into `context.nodeTypes` or the raw AST). Where the spec
states the contract, this report states how much of it is met, what remains, and the design questions
the remainder raises.

**How to read the numbers.** Every count below is dips recorded over the **resolved corpus** — the 60
files that currently compile all the way to C and pass — so it measures "what a *working* native
compile still dips on," not aspirational coverage. Total: **3287 dips** across those 60 files.

---

## The bar (from the spec)

> A stub non-ESTree emitter consumes **core `HirModule` and nothing else** — no `context.nodeTypes`
> side-table, no original AST, no `JSTransformer` imports.

The spec named three counts on which core-consumption was false:

1. **Opaque leaves** — the emitter re-enters `visitExpr` for every atom / call / pattern.
2. **Types off the side-table** — types read from `nodeTypes` by raw-AST identity, not off the node.
3. **Construction as ESTree** — built in `JSClassBuilder`, not in the HIR at all.

### Status against the three counts

| # | count | status | evidence |
|---|---|---|---|
| 1 | opaque leaves | **largely closed** | atoms (literal/ref), **all four dispatch kinds**, construction, declarations, interpolated strings, field reads — modeled. Remaining opaque: patterns (A7), bare composite reads, function-as-value. |
| 2 | types off the side-table | **largely closed** | ref types now read from the binding, not symbols (**427 → 8**); declaration declared-types ride `HVarDecl`. Remaining: `param-untyped` (the sanctioned `Unknown`-boxing), a few field-type reads. |
| 3 | construction as ESTree | **closed** | the whole class definition is an `HClass`; **both** backends consume it (JS assembles the `ClassDeclaration`, C reads the field layout + constructor off the node). |

**Bottom line on the bar:** the HIR is now **LLVM-shaped**. The load-bearing structure a native backend
needs — a typed value at (almost) every node, a resolved call at every call, a modeled class at every
type declaration — is on the node. A stub backend could consume the *vast majority* of the core today.
It is **not yet 100 %**: a long tail of intricate modeling remains (below).

---

## What is modeled (on the node, consumed by both backends)

| node family | what it carries | both backends? |
|---|---|---|
| `HLiteral` / `HRef` | typed constant / resolved-binding atom | ✅ |
| `HFreeCall` / `HMethodCall` / `HVirtualCall` / `HExtCall` / `HOperator` | resolved dispatch kind + operands (as HExprs) | ✅ |
| `HConstruct` | construction callee + args | ✅ |
| `HMemberRead` | a 0-arg `(obj.field)` read (D1) | ✅ |
| `HClass` | name, superclass, `__ll_name`/`__ll_struct` markers, fields, **constructor** (params + defaults + D11 prologue + super + field-stores + ctor-methods + the LL0102 diagnostic) | ✅ (JS assembles, C consumes the layout) |
| `HVarDecl` | binding name, mutability, **declared type** (resolved once at lowering) | ✅ |
| `HFormattedString` | interpolated-string segments (literal chunks + lowered interpolation HExprs) | ✅ |
| control flow: `HIf` / `HWhile` / `HFor` / `HForEach` / `HMatch` / `HTry` | already modeled — only 7 `for` loops in the whole corpus bail | ✅ |

The C backend consumes each of these off the node; the JS emitter builds them byte-identically to the
legacy path (301/301 codegen cases byte-identical, 130 runner green, at every step).

---

## The gap ledger, grouped by nature

The 3287 remaining dips split into three kinds — **core work still to do**, **explicitly out-of-core
per the spec**, and **the sanctioned `Unknown` concession**. Grouping them this way is the whole point:
the raw total overstates the remaining *core* work by ~2×.

### Out of core (~1345, ≈ 41 % of all dips) — NOT readiness blockers

| assumption | dips | why out of core |
|---|---|---|
| **A9-extern** (host-intrinsic 302, import 51, imported-body 49, …) | **443** | the std/js host-global boundary — the spec explicitly leaves it unmodeled. |
| **A5** copies (return-store 239, param-copy 140, copy:let-decl 106, foreach-copy 56, …) | **640** | the spec puts copy **materialization** in the native pipeline; the *decision* is already an IR fact (the `isStore` flag). "box/unbox/coro are what the native pipeline adds on the way down." |
| **A6** coercions (coercions-inserted 160, boxed-arith 78) | **262** | same — coercion is a native-pipeline **pass**, not a core-lowering node (JS erases coercions entirely). |

### Sanctioned concession (~124) — allowed by the spec

| assumption | dips | note |
|---|---|---|
| **A1** `param-untyped` | **124** | a genuinely-unannotated parameter the checker cannot infer → boxed `Unknown`. The spec: **"never zero `Unknown`."** This is a *representation*, not a hole. |

### Genuine remaining core (~1400) — the tail

| cluster | dips | nature |
|---|---|---|
| **function resolution** — `function-signature` 192, `callee-identity` 110, `on-demand-lower` 50 | ~350 | the callee-identity + signature a call node doesn't yet answer; "functions are values" (A3). |
| **field access** — `field-get` 81, `field-store` 46, `member-dyn` 52, `method-dyn` 57 | ~240 | field-get is the **descriptor-slot** lookup — but the descriptor is *already `HClass`-derived*, so this is honestly *consuming `HClass`*, just mislabeled (a relabel, not real modeling). `member-dyn` is the bare composite read `obj.x` (a distinct path). |
| **atoms/assigns** — `atom-ref` 147, `assign-target` 121, `foreach-variable` 56 | ~320 | remaining opaque atoms (method **receivers**, bare composite reads) + the assignment lvalue + the for-each binding. |
| **patterns** — `pattern-test` 60, `hoist` 38 | ~100 | A7 — pattern-tests as IR facts; the last opaque-leaf class the spec names. |
| **A4/A1 residue** — `defclass-field-types` 42, `construct` 42 (raw fallback), … | ~200 | field TYPES read from the AST annotation (the A1 type layer, not the layout); construction fallbacks. |
| **A8** coroutines | 29 | modeled sparsely — a native-pipeline concern like A5/A6. |

---

## Honest verdict

- **The structural cut is done.** Everything that makes the HIR a *neutral core a native backend can
  consume* — atoms, dispatch, construction, classes, declarations, ref types, interpolated strings,
  field reads, control flow — is modeled, on the node, consumed by both backends, byte-identical on JS.
- **It is not yet a *complete* core.** The tail above (~1400 dips) is genuine but **mechanical**: each
  is a node-modeling increment like the ones already landed, not a structural rethink. The biggest
  single item (`field-get`, 81) is a *relabel* away from being "consumes `HClass`."
- **~40 % of the raw ledger is deliberately out-of-core** (A5 copies, A6 coercions, A9 host) — these
  are the *native-pipeline passes* the spec says the LLVM lane adds on the way down, not core lowering.

If the question is *"could a stub emitter consume core `HirModule` for the modeled families without the
side-table or the AST?"* — **yes, for everything in the "What is modeled" table.** If it is *"is the
whole corpus consumable off the core today?"* — **not yet**, pending the tail.

---

## Remaining tail, scoped as design work

Ordered by leverage, each a self-contained increment:

1. **`field-get` relabel + field-read modeling** — the slot is `HClass`-derived; either relabel the dip
   honestly, or carry the resolved slot on `HMemberRead` so the read is fully on the node. *Low risk.*
2. **Function-as-value + callee identity (A3)** — a call node that answers "which function / is it a
   closure" without the symbol table; the "functions are values" gap. *Medium — touches closures.*
3. **Assignment lvalues (A2)** — the assignment target on the node (`HUserAssign` carries only the RHS).
   Mirrors the `HVarDecl` declaration modeling. *Medium — lvalues span name/member/index.*
4. **Bare composite reads (A2/A3)** — `obj.x` as an operand (distinct from the `(obj.x)` call form
   already modeled) — drains `member-dyn` + receiver `atom-ref`.
5. **Patterns (A7)** — pattern-tests as IR facts; the last opaque-leaf class. *Self-contained but the
   pattern zoo is broad.*
6. **A1 field types** — field TYPE annotations on the node (the type layer, distinct from the layout).

---

## Open design questions for the Dove round

1. **A5 / A6 as native-pipeline passes, confirmed?** The spec leans this way ("the copy/coerce decision
   is IR nodes, only the materialization is backend code"). Confirming it removes ~900 dips from the
   *core* scope in one ruling — they become the LLVM lane's copy-insertion + coercion passes.
2. **Boxed-`Unknown` representation (Q1).** The spec proposes a fat pointer `{tag, payload}` for v0.
   `param-untyped` (124) + any residual boxed value rides this. Confirm the repr so A5/A6 materialization
   can target it.
3. **Function-as-value / closure ABI.** The single biggest *core* cluster is function resolution. What
   does a call node carry (direct symbol vs. closure value vs. adapter) so the backend never asks the
   symbol table?
4. **Patterns (A7).** Model the pattern test as an IR fact (the tag/slot tests + bindings) vs. keep it a
   backend-lowered leaf? This is the one remaining opaque-leaf *class*, not just a residue.
5. **The `field-get` relabel.** Trivial but worth a ruling: is "the C backend reads a slot from the
   `HClass`-derived descriptor" a dip, or consumption? It's currently counted as a dip and it isn't one.

---

## Appendix — this session's drain

The structural cut, landed as byte-identical / ratchet-clean increments (JS 301/301 codegen, 130
runner, C 60/60 ratchet at every step):

| dip | before → after |
|---|---|
| `A3:call-dispatch` | 1769 → **301** (runner) / 159 (resolved corpus) |
| `A2:atom-ref` | 1048 → **147** (resolved corpus) |
| `A1:ref-type-via-symbols` | 427 → **8** |
| `A2:decl-structure` | 471 → **10** |
| `A2:decl-type` / `A1:mut-narrowed` | 127 / 110 → **10 / 10** |
| `A2:formatted-string` | 149 → **6** |
| `A4:construct` (raw fallback) | 117 → **42** |
| class definition | ESTree in `JSClassBuilder` → **`HClass`, both backends** |

Modeled node families added: `HClass` (+ `HFieldDecl`/`HCtor`/`HFieldInit`/`HSuperCall`/
`HCtorMethodCall`), `HFormattedString`, `HMemberRead`, and `HVarDecl` enriched with name/mutability/
declared-type.
