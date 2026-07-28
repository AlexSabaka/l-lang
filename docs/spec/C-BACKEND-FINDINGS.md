# C backend — the dated findings log (§9–§21)

**What this is.** Every defect the C backend surfaced from 2026-07-23 onward, root-caused, with the
reproduction and the fix. Split out of the C-backend gap ledger on 2026-07-28 — whose surviving half
is at [`docs/_archive/c-backend-gap-ledger.md`](../_archive/c-backend-gap-ledger.md) — and promoted
here because it is still cited: **22 references across `src/` and the corpus point at these
sections by bare number** (`gap ledger §14.1`, `§9.2`, `§15.7`, `§11.1`, `§5.2`), so the numbering is
load-bearing and is preserved exactly — this file starts at §9 and nothing is renumbered.

**What it is not.** The ledger's first half (§1–§8) was the *probe record*: the method, the
per-assumption dip counts, and the frontier of a C backend that was then an experiment measured
against the JavaScript oracle. **D86 reversed that polarity** — C is now the reference and JS is the
frozen second implementation — so §1–§8 describes a relationship the project no longer has. It is
kept as history at `docs/_archive/c-backend-gap-ledger.md`.

Sections carry their original dates. An entry marked CLOSED stayed in place rather than being
deleted, because the shape of the bug is the useful part.

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

### 9.2 CLOSED (2026-07-24) — C construction mapped positional args to slots by RAW INDEX

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
parameter list across a level boundary. **The layout was never wrong — the *construction* was.**
`buildConstruct` filled field slots by RAW INDEX (`argVals[i] → fields[i]`), but positional
construction args correspond to the flattened **ctor-parameter** list, not the field-slot list. They
line up 1:1 only when no plain (non-ctor) field sits at a slot below a ctor field — and inheritance is
exactly what interleaves them. For `C`, slots are `[tag(0), seen(1), extra(2)]` but the args `["c", 7]`
belong to ctor params `[tag, extra]`: `seen` (slot 1) grabbed `7` and `extra` (slot 2) fell to nil, so
`ll_unbox_int(nil)` trapped. JS was always correct (its constructor assigns each ctor param to its
named field; plain fields take their own initializer).

**Fixed** by giving each `ClassDesc` field an `isCtor` flag (set in `registerClass` from
`hc.ctor.fieldInits` / `t.ctorInfo.params`) and rewriting `buildConstruct` to map the k-th positional
arg to the k-th CTOR field *in slot order*; every other slot (a plain field, or a ctor field whose arg
was omitted) takes its declared default, else nil. Byte-identical wherever the old index map already
agreed with ctor order (all pre-existing green files); only the interleaved shape changes. This
**unblocks giving `std/core/errors` classes plain fields** (e.g. `Error`'s `cause`) at any depth.
Pinned by `examples/80-adversarial/inherited_plain_field_layout.lisp` (the complement of
`inherited_ctor_fields.lisp`, which had deliberately dodged this shape).

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

### 15.2 CLOSED (2026-07-24) — `field := (/ Int Int)` in an IMPORTED METHOD traps on C

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

**FIXED together with §15.7 by one change** — see there. The C backend re-lowers every imported body
from a `desugaredCopyOf` clone that carried NO node types, so `isIntDivision` (D49d) saw undefined
operand types and divided as `real`. Porting the JS backend's `carryTypesInto` into the C
`desugaredCopyOf` (the imported-class clone path is `collectClassMembers`) restores the types, so the
division is Int, the quotient stays an `int64_t`, and the store into the `Int` field no longer traps.
Pinned by `test/imports.ts` "S15.2: an imported method's `field := (/ Int Int)` does not trap on C".

### 15.3 CLOSED (2026-07-24) — N12 was a missed HOIST on the dotted-read path

`.length` on an imported module-level vector emitted `ll_dyn_length(u_GLYPHS)` against a name **no C
scope declared** (cc: `use of undeclared identifier 'u_GLYPHS'`) -- not just a missed box: the head was
never hoisted at all. `resolveCompositeRead` built a `c-ref{cName: mangleC(headName)}` assuming the name
was declared, but an imported module-level binding is only declared once `ensureImportedValue` hoists it
to a C global. The simple-read path (`resolveIdentifier`) and the dotted-CALL path (`resolveDottedCall`)
already hoisted; the dotted-READ path was the one seam that never did. **Fixed** by trying
`ensureImportedValue(headName, node)` there and, when it hoists, using the returned C name and the
global's DECLARED ctype -- which is a `vec` for an `Int[]`, so `.length` now resolves to `ll_vec_len`
(the ledger's "missed box" facet) rather than the dynamic accessor. Same-module and local heads are
unaffected (`ensureImportedValue` returns undefined for our own global). Pinned by `test/imports.ts`
"S15.3: `.length` on an imported module-level vector resolves on C" (checks `.length` AND `[i]`, since
the element read went through a different seam and always worked).

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

### 15.7 CLOSED (2026-07-24) — an imported body's `Int / Int` was REAL division on C

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

**FIXED (2026-07-24).** The real root cause was broader than the param-vs-local framing above: re-measured
at HEAD, an imported free function dividing its own PARAMETERS emitted `(double)(u_a) / (double)(u_b)`
too — so *every* imported `Int/Int` degraded, not only the local-operand ones. The unified cause: the C
backend re-lowers each imported body from a `desugaredCopyOf` clone (`hirBodyFor` →
`LowerAstToHirVisitor.lowerBody`), and that clone carried NO node types, so `isIntDivision` (D49d) read
`undefined` for both operands and returned false. The C `desugaredCopyOf` was clone + desugar and simply
never carried the types across; the JS backend had solved the identical thing in S1a with
`carryTypesInto` (kind@span index, walk the clone, stamp, never overwrite). Porting that method verbatim
into the C `desugaredCopyOf` fixes both §15.2 and §15.7 at once — the emitted body switches from
`(int64_t)((double)(u_m) / (double)(2))` to `(u_m / INT64_C(2))`. Pinned by `test/imports.ts` "S15.7:
an imported body's `Int / Int` stays integer division on C (past 2^53)", whose dividend
(`9007199254740995`) makes int-division and double-then-truncate land on provably different integers, so
output parity is proof rather than luck. §15.3 (N12) is a SEPARATE hoisted-global boxing bug and stays
open.

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

## 19. `:extension` dispatch on a CLASS receiver was root-module-only + exact-type (2026-07-24)

Surfaced making `std/core/errors`' `caused-by` an `:extension` (so it reads both `(caused-by e c)` and
`(e.caused-by c)`). The **typed**-receiver dispatch `ResolveHirToCir.tryExtensionCall` looked the
extension up in `this.extensions` — a map `registerExtension` fills from the **ROOT module's** top-level
items only, keyed on the **exact** receiver-type name. Two failures fell out at once, both `ELL0106
resolveObjMethod` (refuse):

- an extension defined in an **imported/ambient** module was never in the map (`caused-by` lives in a
  prelude, not the root);
- even for a local extension, a **base-class** extension never dispatched for a **subclass** receiver
  (`(indexError.caused-by …)` where `caused-by`'s receiver is `Error`).

Neither had ever been exercised: no corpus `:extension` targeted a plain `defclass` — only structs,
primitives, and interfaces — and none was imported-then-method-called on a typed receiver. The
`stdlib-as-fuzzer` pattern again.

**Closed** by routing `tryExtensionCall` through the SAME forest-wide resolver the BOXED path
(`dynExtensionCall`) and the JS backend already use: `buildExtensionTable` (walks the whole symbol-table
forest) + `conformingExtensionFn`/`receiverConformsTo` (walks the `:extends`/`:implements` chain), with
`ensureFreeFn` lowering the imported extension body on demand. A strict superset of the old exact-map
lookup, so every pre-existing typed extension (Vec2 operators, the String method surface) is unchanged —
the C ratchet + `-O2` stayed green. Pinned by `examples/18-error-handling/24_error_cause.lisp` (both
surfaces, both backends; the throw-site chain uses a subclass receiver resolving to the base extension).

## 20. CLOSED (2026-07-24) — an operator overload with a UNION / Any operand missed a box on C

**Fixed** (`b1d0278`): `maybeRegisterOperator` now stores the operator's DECLARED operand CType
(`fn.params[0]` for a method op, `fn.params[1]` for a free op; a union/Any → `C_VALUE`), and `mkBinop`
declares it at the call site instead of guessing `rhs.ctype`. InsertCoercions already coerces each
c-call arg to the callee's param type, so it boxes the argument automatically — byte-identical for every
concrete-operand operator (Vec2/Complex/Rational). `std/sys/path`'s `/` was restored to its intended
`PathLike = Path | String` (`(/ p1 p2)` now works), and the union operator is guarded by
`examples/80-adversarial/union_operator.lisp` (both arms). Original write-up below.



Surfaced modeling `std/sys/path`. Sabaka's scratchpad typed the `/` join operator's operand as a union
`PathLike = Path | String`, so the same `(/ p x)` could join a Path or a String. On JS it works; on C
`cc` rejects the emitted call:

```
(defstruct Path (fn :operator / [other <- PathLike] -> Path ...))
(/ (Path "a") "b")
```
```c
static ll_obj* __ll_method_Path_op_2f(ll_obj* __self, ll_value u_other) { ... }   /* union operand -> boxed param */
... __ll_method_Path_op_2f(<Path>, ll_str_lit("b"))     /* passes ll_str* UNBOXED -> incompatible with ll_value */
```

A union (or `Any`) operand lowers the operator method's parameter to a boxed `ll_value`, but the operator
**call site** passes the operand in its concrete C type (`ll_str*` / `ll_obj*`) without the `ll_box_*`
coercion — so the argument type does not match the parameter type. A CONCRETELY-typed operand
(`[other <- String]`) boxes correctly (both sides are `ll_str*`), which is why the same operator with a
String param compiles and runs byte-identically on both backends. Same family as N19 (a boxing coercion
missed at an overloaded-operator boundary): the P2 coercion pass is not inserting the box on the operator
call's argument when the callee parameter is boxed-Unknown.

**Worked around, not fixed:** `std/sys/path`'s `/` takes a `String` segment (the common case); joining a
Path is `(/ p (q.to-string))`. Fixing it — box an operator-call argument whose callee parameter is
boxed — is a self-contained C-emitter commit (InsertCoercions / the operator-dispatch path), deferred.

## 21. Two JS-backend gaps surfaced by std/math/random (2026-07-24)

The RNG's core (state, `next`, `real`, `int-in` with literal ranges, `bool`) matched byte-for-byte on
both backends immediately. Two JS-only silent divergences turned up in the array helpers -- the
stdlib-as-fuzzer pattern, this time pointing at the JS emitter rather than C.

> **Status: WONTFIX (D66, 2026-07-24).** The JS backend is deprecated -- oracle-only, no new fixes on the
> JS path. Both 21.1 and 21.2 are JS-only emitter bugs; per D66, JS may degrade and these stay
> worked-around-in-`random`, not fixed. Kept on record as characterised divergences (the workarounds are
> the guard), not as open work. Should JS ever be un-deprecated, the fixes are described below.

### 21.1 `.length` is a host Number, not lifted to a BigInt Int

`(let n <- Int arr.length)` emits `const n = __ll_copy(arr.length)` -- and `arr.length` is a host
**Number**, not a BigInt. On its own that survives (comparisons coerce), but the moment it meets a BigInt
Int in arithmetic it goes wrong SILENTLY: `int-in`'s `(- hi lo)` / `(% next range)` with `hi` = a
`.length` Number and `next` a BigInt produced a different `int-in` value on JS than on C (int64_t
throughout), so a Fisher-Yates `shuffle` diverged. The `<- Int` annotation did not coerce it, and neither
did `(+ 0 arr.length)`. **Worked around** in random by COUNTING the length in a loop (`(mut n 0) … (n :=
(+ n 1))`), which yields a genuine BigInt. The real fix is the JS emitter lifting a host-Number Int (a
`.length`, any host-member Int) to BigInt where the type says Int -- the same `__ll_hostint` it already
wraps `next()` results in. Potentially wide (any Int math over an array length), so worth its own commit.

### 21.2 An array index whose index expression has a side effect evaluates out of order

`arr[(this.int-in 0 n)]` -- where the index expression calls `next` (mutating state) -- gave a different
element on JS than the identical `(let idx (this.int-in 0 n)) arr[idx]`, which C matched. So the JS
`__ll_index(arr, sideEffectingExpr)` evaluates its operands in an order that disagrees with binding the
index first. **Worked around** in `choice` by binding `idx` before indexing. Narrower than 21.1 (needs a
mutating index expression), but the same class -- an evaluation-order/CSE hazard in the JS emitter.
