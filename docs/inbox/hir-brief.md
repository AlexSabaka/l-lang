> **KEPT, and consumed — this file is cited BY THE COMPILER.** Its requirements **R1–R6** are the
> definition five source comments point at by name: `src/compiler/hir/index.ts:2`,
> `src/compiler/hir/nodes.ts:7` and `:28`, `src/compiler/hir/EmitHirToEstree.ts:3`, and
> `src/compiler/codegen/js-estree/visitors/JSTransformerAstVisitor.ts:1224`. It is not archived for
> that reason: moving it silently would leave five dangling references in the code.
>
> The rulings it produced are **D45** (the HIR) and **D48** (the HIR core tail) in
> [`DECISIONS.md`](../spec/DECISIONS.md), and the HIR has since shipped. One correction to the text
> below: it is written as if the HIR fed ONE backend. It feeds two, and **C is the reference** (D86)
> while the JavaScript path it describes in most detail is the deprecated one.

# HIR implementation brief — the hard requirements

**Status:** brief for a fresh session (Sabaka ⇄ Cheetah). Not a plan; a spec of what the HIR MUST do
and MUST NOT break, grounded in the bugs that motivated it. Design happens in-session from here.

---

## 1. The problem, precisely

l-lang is **expression-oriented**: every form yields a value. `if`, `cond`, `when`, `match`, `for`, a
block — all are expressions. JavaScript/ESTree is **statement-oriented**: `if` is a statement with no
value, `return`/`throw`/`yield` are statements, the ternary is the only expression conditional.

> **`for` was aspirational here, and D94 later had to rule it.** Measured 2026-07-29: `for`,
> `for :each`, `while`, `let`/`mut` and assignment yield `nil` untyped, and a C-style `for` in value
> position emits C that does not compile. The premise this brief opens with is now the rule (D94)
> rather than a description; roadmap *Known gaps* tracks the distance.

The current pipeline is **typed AST → ESTree in one hop**, and that single visitor
(`JSTransformerAstVisitor`) bridges the impedance *ad hoc, per node*. It is simultaneously doing at
least five distinct lowerings at once — position resolution, tail-return injection, value-semantics
copies, dispatch resolution, and structural emission — over a tree that makes none of them explicit.

**The tell, observed repeatedly this session** (phase Z / games):
- **"Work around the emitter."** `braceIfDangling` (CF2, `a20b3a7`) exists only to stop *astring's*
  dangling-else from misparsing. `asExpression` turns `if` into a ternary and wraps `return` in an
  IIFE. These patch the backend's shape; they don't model anything.
- **Divergent copies of one idea.** CF3 (`c3928f8`) was two copies of tail-position return-injection
  (`ensureReturns` vs `withTrailingReturn`) that had drifted apart. That is the canonical sign the
  logic wants to be **one normalization pass**, not scattered helpers.
- **The backend refuses what the language allows.** LL0103 (D40) refuses `return`/`yield` in operand
  position *because* there is no HIR to hoist it; the ruling says building it inline would be "building
  an HIR badly." We have been building it badly, inline, in a dozen places.

D40 already named the fix: "a real HIR / ANF lowering pass ... explicitly deferred to a future phase."
This is that phase.

---

## 2. Hard requirements

The HIR is a **typed, post-typecheck intermediate representation** between the typed AST and ESTree.
It MUST satisfy all of the following. Each is stated as an invariant, with the machinery it retires.

### R1 — Position is explicit (ANF / A-normal form)
Every compound expression is let-bound to a temporary, so **operands are atoms** and control-flow
constructs appear only in statement position. Consequences the HIR MUST deliver:
- **Tail position is a single normalization.** One pass injects the trailing value/return; no
  `withTrailingReturn`, `withTrailingReturnIn`, or the old `ensureReturns`.
- **`if`/`cond`/`match`/`when` in value position** lower uniformly: a ternary when both arms are
  atoms, else a fresh temp assigned in each branch — **never an IIFE**, never a dangling-else. Retires
  CF1/CF2/CF3, `braceIfDangling`, and most of `asExpression`.
- **`return` / `throw` / `yield` / `await` in operand position** become expressible: the enclosing
  expression is hoisted to statement position via the let-binding. **This retires LL0103's refusal**
  (D40 / AF-003) — the backend can finally honour a `return` from anywhere.

### R2 — Operand shapes are uniform
Member access, index, and call apply over **any HIR value**, not identifier-only. The HIR MUST carry
three DISTINCT, already-resolved nodes so codegen never re-decides:
- **field read** (`obj.field` — may be nil, D9),
- **method call** (`obj.method(args)` — D1's `(obj.m)` is always a call),
- **index** (`obj[i]` — checked, throws on absent/out-of-bounds, D9f).

Retires TY2 (`(get xs i).field` / `(expr).member`, deferred from the games phase specifically for
this), and the `member-index` class (`6cc01ab`) where codegen re-deciding `.member` vs `["key"]`
produced the `__ll_member` double-call.

### R3 — Store sites are explicit (value semantics, D11)
Every place a value is **stored** is an explicit HIR node the copy-insertion pass can act on: a
`let`/`mut` init, a by-value argument, a field/element assignment, a native-mutator argument. The copy
rule becomes uniform — "copy every store of a struct value" — instead of the scattered
`asValue` / `needsValueCopy` / `provablyNotAStruct` hunt through emitter branches. Retires CP2
(`100b10e`, found only by probing three call sites) and generalizes it; interacts with CP3's
`deep-copy` and the shallow/deep default.

### R4 — Dispatch is resolved at HIR, not codegen
Extension/operator/member dispatch is lowered into **concrete HIR calls** during AST→HIR
(`ext_total(recv, ...)` vs `recv.method(...)`), so the checker and codegen cannot disagree. The current
split — `typeExtensionCall` (checker) and `receiverConformsTo`/`computedExtensionCall` (codegen) each
deciding nominally, independently — is exactly the seam TY8 (`373c342`) fell through. One resolution,
recorded in the HIR.

### R5 — The HIR is typed
It carries the types the type pass produced (today's `context.nodeTypes` channel becomes HIR node
types), so R3's copy-insert and R4's dispatch consult types without re-inferring. No pass below the
type checker may re-run inference.

### R6 — HIR → ESTree is mechanical (~1:1)
After R1–R5, the final lowering is a structural map with **no position analysis, no return injection,
no copy decisions, no dispatch**. The litmus test: *if HIR→ESTree has to make a judgment call, that
judgment belongs in an HIR pass instead.* This is how we know the factoring is right.

---

## 3. Constraints — what it MUST NOT break

- **Diagnostics and type-checking stay on the typed AST, BEFORE HIR.** The HIR is a codegen-layer
  concern. The `test:type-errors` corpus (diagnostics = 0), `test:diagnostics` snapshot, and every
  LLxxxx must be unaffected in *when and whether* they fire.
- **Behaviour is preserved; emitted TEXT will change.** ANF introduces temps and restructures control
  flow, so **goldens WILL move — many of them.** This is the central risk and it collides with the
  standing rule "a moved golden is a finding, not a test to edit." The resolution is a hard
  requirement of its own, in §5: goldens must be re-validated by **behaviour**, not text.
- **The gates and the discipline hold.** RED-first, atomic commits, corpus-diagnostics-0, explicit
  push confirmation. An HIR migration does not get a pass on any of them.
- **No regression in the 6 primitives / structural interfaces / D-rulings** shipped this session
  (D42, D43, D10, D30 bridge). The HIR must honour every ruling the AST currently does.

---

## 4. Explicit non-goals (scope boundary)

The HIR is the **AST→ESTree lowering layer**. It does NOT absorb:
- **Front-end** — the parser and type-node representation. TY7 (`Int[][]`, `836dc84`) was fixed at the
  front end; deeper array nesting, new syntax, etc. are upstream of the HIR and inherit its limits.
- **Language rulings** — PR2 (`while` variadic body, ruled status-quo) and the like. No IR changes a
  ruling.
- **The type checker / diagnostics** — they run on the typed AST and feed the HIR; they are not part
  of it.
- **The serialization / name-encoding boundary** (`player-pos` → `player2dpos`) — a naming policy,
  largely orthogonal (its own deferred phase), though a uniform HIR member model may make it cheaper.

---

## 5. Migration & validation — a hard requirement, not an afterthought

The single biggest risk is **golden churn**: an HIR rewrite changes emitted JS shape, so text-diffing
goldens will light up en masse, and blindly re-blessing them would silently bake in whatever the HIR
got wrong. So:

- **Behavioural equivalence is the acceptance test.** The golden suite must be validatable by RUNNING
  the emitted program and comparing OUTPUT/behaviour, not source text, across the migration. Where a
  golden's *text* changes but its *behaviour* is identical, that is a pass; where behaviour changes,
  it is a finding. FINDINGS.md already warns of this for the CF family ("the JS is exactly what's
  wrong"); the HIR migration lives or dies on it.
- **Incremental, not big-bang.** The HIR cannot land in one commit. Two viable shapes to decide
  in-session:
  1. **Prototype-first** (recommended starting point): a minimal HIR that does ONLY R1 (position/tail
     ANF) for the conditional cluster; prove it retires CF1/CF2/CF3 and that HIR→ESTree is ~1:1; then
     expand to R2 (operands), R3 (value semantics), R4 (dispatch) one at a time.
  2. **Parallel-run validation:** emit both the current path and the HIR path during migration and
     assert behavioural equality on the whole corpus, retiring the old path construct-by-construct.
- **Each expansion is its own RED-first, atomic, gate-green step**, exactly like every phase this
  session.

---

## 6. Open design questions for the session

Not to answer here — to walk in with:
1. **ANF vs a lighter position-tagging.** Full ANF (let-bind everything) is cleanest and most
   uniform but most churn. A lighter "tag each node with statement/value position + hoist only what
   must hoist" is less churn but keeps some of the ad-hoc feel. Which trade?
2. **HIR datatype shape.** A new node family, or an annotated reuse of the AST? A distinct family is
   cleaner for R6's litmus test; reuse is less code.
3. **Where dispatch resolution lives** — a dedicated AST→HIR pass, or folded into the typed-AST walk
   that already has the types. (R4 says resolved before codegen; it doesn't say which pass.)
4. **The `deep-copy`/shallow default (D11) under explicit store sites** — R3 makes every store a copy
   point; does that change the shallow-at-reference default, or just make it uniform?
5. **Fate of the retired machinery** — delete `asExpression`/`withTrailingReturn`/`braceIfDangling`/
   `asValue`/`needsValueCopy` as each requirement lands, or keep as a fallback during parallel-run?

---

## Appendix — the bug inventory HIR retires (this session's evidence)

| bug | commit | HIR requirement |
|---|---|---|
| CF1 return-in-`\|\|` (refused, LL0103) | Zl (D40) | R1 |
| CF2 dangling-else | `a20b3a7` | R1 |
| CF3 match-arm no return | `c3928f8` | R1 |
| `member-index` `__ll_member` double-call | `6cc01ab` | R2 |
| TY2 `(get xs i).field` detaches | deferred | R2 |
| CP2 native mutator aliases a struct | `100b10e` | R3 |
| TY8 structural/nominal `:extension` seam | `373c342` | R4 |

Machinery to be subsumed (all in `JSTransformerAstVisitor`, except dispatch which spans it and
`InferTypesAstVisitor`): `asExpression`, `withTrailingReturn`/`withTrailingReturnIn`, `braceIfDangling`,
`foldPrimitiveType`, `asValue`/`needsValueCopy`/`provablyNotAStruct`, `computedExtensionCall`/
`typeExtensionCall`/`receiverConformsTo`, and the LL0103 refusal in `CodegenDiagnostics`.
