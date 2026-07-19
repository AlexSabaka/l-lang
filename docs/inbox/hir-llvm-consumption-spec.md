# HIR → LLVM consumption spec (draft v0)

**What this is.** The contract a native (LLVM) backend would consume from `HirModule` — written
*before* the modeling cuts, as the forcing function Dove asked for (gaps-and-seams Step 1). Its job
is not to describe an LLVM backend; it is to state, per construct, **what the emitter must be handed**
so the cuts aim at a real target instead of inferred negative space. Each assumption names the
sequence step that makes it true and whether that cut pays off on JS *now* (most do).

**Grounded in** `src/compiler/hir/nodes.ts` (the node family), `EmitHirToEstree.ts`
(`LegacyLeafEmitter` — the JS coupling surface), and `LowerAstToHirVisitor.ts` (how `type` is
populated). Draft for the Sabaka⇄Dove lane to refine; **not** ratified.

---

## The bar for "separated" (SIL's standard)

> A stub non-ESTree emitter compiles against **`HirModule` and nothing else** — no `context.nodeTypes`
> side-table, no original AST, and it imports **no** `JSTransformer` code.

Today that is false on three counts, which the assumptions below enumerate: the emitter re-enters
`visitExpr` for every atom/call/pattern (the 2 opaque leaves), it reads types out of `nodeTypes` by
raw-AST identity (not off the node), and construction is built directly as ESTree in `JSClassBuilder`
(not in the HIR at all). "Separated" = all three closed.

---

## Assumptions the backend makes (each = one cut)

### A1 — Every value node carries its own non-`undefined` type. `Unknown` is boxed, not rejected.
`HBase.type` exists but is **write-only today** — the JS emitter never reads it, so a wrong/absent
type passes 100% of tests, and the type lives in `context.nodeTypes` keyed by *raw-AST identity*, not
on a synthesized node. LLVM needs a layout for every value.
- `type === undefined` on a value node is a **bug** (it should have gotten a type) → fix at the source.
- `type === Unknown` is **box-me** — the gradual concession, a *representation* not a hole. LLVM
  readiness needs **zero `undefined`, never zero `Unknown`.** (Grift/Siek: `Dyn` is a uniformly boxed
  64-bit value with coercions at the boundary, not a rejection.)
- *Open:* what is l-lang's boxed-`Unknown` runtime repr on native (tagged 64-bit à la Grift's `Dyn`?),
  and does `type` ride **every** `HExpr` or only the atoms (with combinators inferring from children)?
- **Steps 2 (measure the split) + 3 (put types on atom nodes, drain `nodeTypes`).** JS benefit: none
  directly, but Step 3's atom modeling is the vehicle and pays off on its own (below).
- *Measured (Step 2, see below): `Unknown` is dominated by unresolved **call results** (70% of it),
  not identifiers — so the boxing question is mostly downstream of dispatch (A3). Literals are already
  well-typed; the numeric-tower hole is real but tiny.*

### A2 — Atoms are modeled, not opaque.
A variable read and a literal — the two hottest constructs — are `HOpaqueExpr` today (emitted by
`leafExpr` → `visitExpr`). The backend needs `HLiteral` (a typed constant, carrying the numeric-tower
distinction Int/Real/hex/oct/bin — several of which type as `Unknown` today and are really `Int`) and
`HRef` (a *resolved* binding: which declaration, which scope, is it a copy site). **Step 3.** JS
benefit: makes the module type-self-contained; empties most of `leafExpr`.

### A3 — Dispatch is resolved to concrete call kinds carrying callee identity.
There is **no call/apply node in the HIR** — a call is an `HOpaqueExpr` whose `src` is re-dispatched
by `visitExpr` (`computedExtensionCall` / `receiverConformsTo`), and the checker separately decides the
same thing (the TY8 seam: two independent answers). The backend must be handed the *resolved* kind:
`free-call(fn, args)` · `method-call(recv, sel, args)` · `extension-call(ext_total, recv, args)` ·
`index-call` · `construct(type, args)` — with the callee/selector/extension identity recorded, not
re-derived. **Step 4, a distinct AST→HIR lowering pass that reads the type channel** (SIL
devirtualization is a pass *on* the IR; must not re-infer, R5). JS benefit: closes TY8 regardless of
LLVM.

### A4 — Construction is in the HIR.
`new`, `super(…)`, per-field `this.x = param`, field-initializer expressions, and copy-on-entry are
built **directly as ESTree in `JSClassBuilder`** (`buildConstructor`/`buildFields`) — not even an
opaque leaf. LLVM gets nothing for instantiation: no field layout, init order, copy-on-construct, or
super dispatch. Needs `HConstruct` / `HFieldInit` + typed field stores; `JSClassBuilder` becomes a
thin emitter of them. **Step 5.** JS benefit: a real gap today (construction is un-modeled).

### A5 — Stores and copies are explicit nodes.
D11 value-copy is a JS hook (`storeValue` = `asValue`/`__ll_copy`) plus an `isStore` flag on
`HAssignTemp`/`HReturn`, plus copies buried in `emitVarDecl`/`emitAssign`/`emitForEach` and applied
unconditionally to collection elements. The **copy *decision*** (does this store copy? shallow per
CP3?) is backend-neutral; only the **materialization** differs (`__ll_copy` vs `memcpy`/move). Needs an
explicit copy node at every store site; retire `storeValue` + `isStore`. **Step 6.** Note l-lang's
*shallow* value semantics make the elision proof different from the deep-MVS papers — elision is a
later LLVM-era optimization, not part of this cut. JS benefit: uniformity; little runtime win.

### A6 — Coercions are explicit nodes. *(the family neither the code nor the first review named)*
Where a typed value flows into an `Unknown` slot or back out, JS **erases** the coercion (which is
why the HIR has no place for it and nobody noticed). On LLVM the box/unbox/cast is **load-bearing**.
Needs a `box` / `unbox` / `cast` node family inserted at static↔dynamic boundaries (Grift's
"explicit-cast IR"). **Step 7 — falls out of *this spec*; invisible from JS; probably a bigger cut
than coroutines.** *Open:* inserted by a dedicated pass, or at lowering time off the type channel?

### A7 — Pattern tests are IR facts, not a fused boolean.
`HPatternTest` carries a raw `PatternNode` + `scrutName`; the actual test is built at emit by
`generateCondition`, which **fuses binding into the boolean** as side-effecting commas
(`(x = v, true) && __ll_is_type(…)`). A naïve LLVM consumer reading it as a pure boolean gets the
semantics wrong (this bind-then-test ordering is *why* arms need an else-chain). Needs the test
decomposition, binding set, and bind-then-test ordering modeled; retire `patternTest`/`patternVars`.
**Step 8 (R2 pattern half).**

### A8 — Coroutines are modeled.
`yield` is an opaque leaf → `YieldExpression`; generator/async-ness rides on `FunctionNode.generator`
read at emit; `await` is opaque. The HIR carries **no** suspend/resume node and never marks a body as
generator/async, so LLVM cannot even distinguish a generator body, let alone find suspend points for
`llvm.coro.*`. Needs `HYield`/`HAwait` + generator/async marking in `HirModule`. **Step 8.** JS
benefit: none (JS gets the protocol free, D29) — genuinely LLVM-only, gate behind the spec.

---

## What already holds (no cut — state it so it isn't re-litigated)

The control-flow core is backend-neutral and maps 1:1 onto LLVM: `HIf`/`HBlock` → basic blocks +
branches; `HDeclTemp`/`HAssignTemp`/`HTemp` → SSA locals; `HTernary` → `select`; `HReturn` → `ret`;
`HWhile`/`HFor`/`HForEach` → loop block structure; `HTry` → landing pads. The inverted collections
(`HVector`/`HMatrix`/`HMap`/`HMember`/`HIndex`) model their structure directly (their *element copy*
is A5's business, their *element types* A1's). R1 (ANF/position, tail return) and R6 (mechanical emit)
are done.

## The node family the standalone emitter consumes (target)

```
value:  HTemp  HLiteral*  HRef*  HNil  HTernary  HSeq
        HVector  HMatrix  HMap  HMember  HIndex
        HConstruct*  HCall-kinds*(free|method|extension|index)
        HBox* HUnbox* HCast*        HYield* HAwait*
        HMatchTest* (decomposition + binding-set)         (* = added by a cut)
stmt:   HExprStmt  HDeclTemp  HAssignTemp  HIf  HBlockStmt  HReturn
        HWhile  HFor  HForEach  HTry
        HVarDecl  HUserAssign  HCopyStore*  HFieldInit*
        (HOpaqueExpr / HOpaqueStmt / HHoist / HPatternTest retired)
every node: { type: InferredType (non-undefined; Unknown => boxed) }   ← off the node, not nodeTypes
```

## Gap table

| # | Assumption | Today | Closed by | Pays on JS now? |
|---|---|---|---|---|
| A1 | value nodes typed; `Unknown` boxed | `type` write-only, in `nodeTypes` | Step 2+3 | via A2 |
| A2 | atoms modeled | `HOpaqueExpr` + `leafExpr` | Step 3 | yes (self-contained) |
| A3 | dispatch resolved | opaque + TY8 double-decide | Step 4 | yes (TY8) |
| A4 | construction in HIR | `JSClassBuilder` ESTree | Step 5 | yes (real gap) |
| A5 | stores/copies explicit | `storeValue`/`isStore` | Step 6 | uniformity only |
| A6 | coercions explicit | **erased / absent** | Step 7 | no (LLVM-only) |
| A7 | pattern tests as facts | `generateCondition` fuses | Step 8 | modest |
| A8 | coroutines modeled | opaque + `FunctionNode.generator` | Step 8 | no (LLVM-only) |

Through-line: A2–A5 are justified on JS merits *now* and happen to serve LLVM (lose nothing doing
them first); A6/A8 are LLVM-only and wait until this spec — or a real prototype — makes their shape
concrete.

## Measurement (Step 2, first pass — classify, don't count)

A probe over 113 corpus files walked value-position AST nodes and classified each against
`context.nodeTypes`: **concrete** / **`Unknown`** (box) / **missing** (no channel entry). Rough tool
(a re-usable *verify pass* is a later build); read the caveats, not just the totals.

- **`Unknown` is a dispatch story, not an identifier story.** Of ~2,030 `Unknown` value nodes,
  **70% (~1,428) are `list`s — calls/forms whose return type the checker could not determine** — vs
  ~516 identifiers. Among *typed* calls, **~58% are `Unknown`.** This reframes A1: the box-me
  population is created mostly by unresolved dispatch (A3/Step 4), so **resolving dispatch and deciding
  the boxed-`Unknown` repr are the same conversation.** (Corrects the brief's "~178 `Unknown`
  identifiers" framing: identifiers are the minority of `Unknown`; the estimate also undercounts.)
- **Literals are already well-typed** — integer→`Int` (1105), string→`String` (912), real→`Real`,
  boolean→`Boolean`. The numeric-tower-→`Unknown` hole is **real but tiny** (1 hex node in the whole
  corpus): a cheap correctness fix, not a volume driver. So the A1 `undefined`-vs-`Unknown` split, in
  practice, is *"a few genuinely-missing literal kinds to fix"* + *"a large, legitimately-dynamic
  call-result population to box."*
- **The channel is sparse for references.** Most identifier *uses* have no `nodeTypes` entry — the
  checker resolves them through the symbol table without writing the type back. Consequence for Step 3:
  **`HRef` cannot get its type by copying `nodeTypes`; it must resolve the binding's type** (symbol
  table / declaration). This is a concrete design constraint the spec did not have before the measure.
- *Caveat:* the raw "missing" fraction (~57% of walked nodes) **overstates** the true value-node gap —
  the walk cannot cleanly exclude structural lists (blocks, special forms) and non-value identifiers
  (declaration names, heads, property names), which legitimately carry no type. Trust the *`Unknown`
  distribution* and the *literal typing* (both are over typed nodes); treat *missing* as directional.

## Open questions this spec surfaces (for the strategy lane)

1. **Boxed-`Unknown` repr** on native — tagged 64-bit (Grift `Dyn`), or a fat pointer? Decides A6.
2. **Where types live** — on every `HExpr`, or only atoms with combinators typed from children? Decides A1/A3 mechanics.
3. **Coercion insertion** — a dedicated pass over the typed HIR, or emitted at lowering off the channel?
4. **Extension dispatch** — devirtualized to a direct `ext_total` symbol at lowering (SIL-style), or left as a runtime vtable/registry lookup the native runtime provides?
5. **Is A6 (coercions) really bigger than A8 (coroutines)?** — the spec claims so; the type-channel measurement (Step 2) is the first datapoint.
