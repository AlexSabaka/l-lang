# RTTI and cast — a brief for ruling

> **Update (2026-07 design round):** Q4/Q5 are resolved — a cast form **does** exist, but narrowly:
> `(cast<T> x)` invokes a **user-defined `defcast :explicit` conversion** (`DECISIONS.md` **D46** / B-3),
> *distinct* from RTTI type-**narrowing** (which `:of` / D41 still owns). The "no cast" recommendation
> held for *narrowing*; *conversion* is the case that earns the form. RTTI-first still stands — `defcast`
> rides the same type machinery. See `../_archive/hir-design-round-brief.md` §B-3.

Five research lenses, all measured against the tree at `7f12c39`. Citations are `file:line`. Anything
I could not verify is marked UNVERIFIED.

---

## 1. THE DECISION LIST

**Q1. Does `5.5 :of Int` return true?**
Today it does (`RuntimeProvider.ts:226`, VM-probed). Every compile-to-JS language that answers this at
runtime says TRUE: Dart *specifies* it ("a type check on the web of the form `x is int` returns true if
`x` is a number with a zero-valued fractional part"); Elm's decoder accepts `1.0` via `!(value % 1)`.
Zero of six surveyed languages tag floats.
Options: (a) spec the collapse, Dart-style — free, honest, documented; (b) `Number.isInteger` split — one
line, diverges from Dart's web model and from a future LLVM backend's native model in *opposite*
directions; (c) delete `Real` or delete `Int`.
**Recommend (a) + spell it in a D-number.** The code is one line either way; the cost is the ruling.

**Q2. Is `__ll_type_metadata` the source of truth for type TESTS, or only for REFLECTION?**
Today: reflection-only, and the two halves are disjoint — `__ll_is_type` is a hardcoded switch that
*cannot see the table* (`RuntimeProvider.ts:222-255`). `kind`, `implements`, `extends`, `generics` are
all recorded and all invisible to `:of`. Unifying them is the single change that makes `:of Iterable`
possible.
**Recommend: keep them split for now, and rule `:of Interface` a COMPILE ERROR (Q3).** Unification is a
metadata pipeline, not a patch.

**Q3. `:of` against an interface is permanently false (DECISIONS.md:3204-3207). Silent false, or LL02xx?**
Kotlin/JS hit this exact wall and made it a compile error. A permanently-false runtime test is the worst
of both.
**Recommend: LL02xx compile error.** Cheap; matches the `functional-pattern` precedent (below).

**Q4. Does a `cast` form exist at all?**
The repo already argues no, in a shipped test comment: *"that is exactly when a language grows an `as`, to
lie its way past a check it just performed. Narrowing is why l-lang does not need one"* (`test/codegen.ts:3667-3670`,
3 passing tests). D27 rejected a second value-level spelling once already (`:is Int` → corrected to `:of`,
DECISIONS.md:2826-2827).
**Recommend: no cast. Record "no cast, see D27/D41" as the ruling.** See §3 for why the D9 form is worse
than `:of`, not better.

**Q5. If a cast IS wanted: bare names only, or compound types?**
This single question picks the implementation and is the whole cost curve. See §4.

**Q6. Which D5 is binding?** DECISIONS.md:105 says "Full structural typing"; `TypeChecker.ts:183-184`
says "Nominal, not structural"; P7d (DECISIONS.md:600) says nominal. Structural comparison exists only for
records (`TypeChecker.ts:433-436`).
**This must be ruled BEFORE anything else here** — it decides whether `cast<{:name String}>` is even a
coherent request. **Recommend: correct D5's headline to match P7d and the code.**

---

## 2. RTTI IS THE PREREQUISITE. CAST IS ONE CONSUMER.

RTTI is the capability: "can the runtime answer *is this value a T*?" `:of` (D27/D41) is a consumer.
`:operator` dispatch is a consumer (`RuntimeProvider.ts:212`). A cast would be a third. Every defect below
is an RTTI defect that `:of` already suffers today — a cast would inherit all of them and add nothing.

**Fix RTTI first. It has live bugs, and they are cheap.** A cast built on top of today's RTTI would be
built on a switch that can't see the table it ships next to.

---

## 3. WHAT RTTI CAN HONESTLY PROMISE

**CAN, today, soundly:** class/struct identity by nominal prototype-chain walk comparing
`constructor.__ll_name` (`RuntimeProvider.ts:239-253`) — rename-immune, survives the import inliner.
This is C++'s RTTI shape, and it is genuinely available. `dynamic_cast`'s job is already done by `:of`,
and done *better*: `:of` tests AND binds/narrows in one step.

**CAN NEVER, on this backend:**
- **Int vs Real.** `typeof val === 'number'` for both. Dart and Kotlin/JS both shipped full RTTI and
  *still* could not fix this. Kotlin documents 5 collapsed numeric types; KT-33358 open ~5 years. RTTI does
  not buy numeric discrimination.
- **Generic arguments (AF-026).** `__ll_is_type(val, type)` takes a *string*; there is no argument channel.
  `:of Box<Dog>` compiles to `__ll_is_type(v, "Box")` and cannot tell a `Box<Dog>` from a `Box<Cat>`
  (`JSTransformerAstVisitor.ts:481-486`). A `cast<Box<Dog>> x -> Box<Dog>?` would **hand back a `Box<Cat>`
  typed `Box<Dog>`**. That is the blanket amnesty P7 just spent a phase deleting (DECISIONS.md:2377).
- **Structural types (D5).** No runtime name. Nothing to match.
- **Function signatures.** Already ruled dead: `functional-pattern` compiles to `false` because
  *"a closure does not carry its parameter types at run time, so there is nothing to test against. Left dead"*
  (DECISIONS.md:2867-2870). **This is the governing precedent: where the runtime carries no evidence, the
  established ruling is leave it dead and SAY SO.**

**WHERE A FORM WOULD HAVE TO LIE — name them:**
1. `cast<Box<Dog>>` — silently unchecked in its argument. Unsound, not merely incomplete.
2. `cast<SomeStructuralType>` / `cast<Interface>` — checks nothing; returns false or true by accident.
3. **LIVE BUG, independent of cast:** `getTypeName` handles 5 of 11 type-node kinds and falls through to
   `return 'Any'` (`JSTransformerAstVisitor.ts:464-494`); `__ll_is_type` has `case 'any': return true`.
   So `:of` against a union/map/tuple/intersection node emits `__ll_is_type(v, "Any")` and **matches every
   value**. Mechanism verified by reading; *reachability* UNVERIFIED (does `(x :of Int | String)` parse?).
   Worth a probe before anything builds on `:of`.

---

## 4. COST

| Option | What it is | Cost |
|---|---|---|
| Spec the Int/Real collapse (Q1a) | a paragraph | ~0. One D-number. |
| `Number.isInteger` split (Q1b) | 1 line | ~0 code; a semantics divergence forever. |
| Add `real`/`char`/`void` to the switch | 3 cases | trivial. **`5.5 :of Real` is FALSE today** — the arm is silently unreachable, zero corpus tests (`grep ':of Real'` = 0 hits). |
| `:of Interface` → LL02xx | checker branch | small. |
| Unify `__ll_is_type` with the metadata table | metadata pipeline | **large.** Dart needed a multi-year subsystem rewrite ("new rti", dart-lang/sdk#37715). |
| **(c) `(cast T x)` as a head-name special form** | listForm.ts + InferTypes + JSTransformer, **3 files, no grammar** | small — **but bare names ONLY.** MEASURED: `(cast Int x)` parses today (arity 3). `(cast Int[] x)` **hard-errors**. `(cast Int? x)` silently parses as **4** args. `(cast Box<Int> x)` as **6**. No diagnostic. |
| **(b) general `(f<T> args)` call-site generics** | new parser gate + rule | medium. MEASURED viable: adjacency discriminates cleanly (`identity<Int>` adjacent=true; `(reduce < xs)`, `(sort xs <)` adjacent=false). Same discriminator the grammar uses 4× already (`Parser.ts:1505/1524/1545/1553`). Precedent for the lookahead: `isFunctionalPattern` (`Parser.ts:1584-1605`). |
| **(a) `CastKw` token + rule** | new token in 3 lexer modes, rule, AstBuilder visitor, new ast.ts node, checker/codegen/desugar/TreeShake | **largest.** The "declared and never wired in" pattern DECISIONS flags repeatedly. |
| RTTI shipping cost, already paid | preamble | **12,036 bytes emitted for ZERO requested symbols** (5,169 of it comments), 15,700 for all. `type` is force-added regardless of use (`RuntimeProvider.ts:444`); `populateTypesMetadata()` runs unconditionally (`JSTransformerAstVisitor.ts:638`). None of the RTTI machinery is tree-shakeable — `LL_RUNTIME` is one template literal spliced whole. |

**(c)'s hidden bill:** `cast` is not a JS reserved word, so a half-wired codegen emits a bare `cast(Int, x)`
— *more* silent than AF-006, whose leading underscore (`_typeof`) was described in-tree as "the tell"
(`JSTransformerAstVisitor.ts:3097-3100`). And adding `cast` to SPECIAL_FORMS *suppresses* the
unresolved-identifier diagnostic (`InferTypesAstVisitor.ts:3751-3758`). That is exactly the AF-006 mechanism,
with the breadcrumb removed.

---

## 5. PRIOR ART

- **Dart** — shipped RTTI, could not fix int/double on JS, **specified the collapse instead**. Then shipped
  `-O3`/`-O4` to *omit* type checks, and runs all of Google's own apps with `--omit-implicit-checks`
  (dart-lang/sdk#33615). **Shipped RTTI, then built the off-switch, then turned it on.** Re-adding `as`
  checks is acknowledged to cost "worse size & performance" (#55516).
- **Kotlin/JS** — 5 numeric types indistinguishable; `1.0 as Any === 1 as Any` is `true`. Documented as a
  standing bug, ~5 years open. Ships `as` (throws) *and* `unsafeCast<T>()` (checks nothing). Made
  external-interface-on-right-of-`is` a **compile error** — the fix I recommend in Q3.
- **PureScript** — **shipped runtime type checks and then DELETED them** (`--runtime-type-checks` removed in
  0.6.0; maintainer: *"I've wanted to remove this for a while"*). Users redirected to a decoder library.
  Keeps Int-ness via *closed operations*, not tags. **This is your "shipped RTTI and regretted it".**
- **TypeScript (erasure control)** — charter forbids it by name: *"Do not add or rely on run-time type
  information in programs."* No int/float problem because **it declined to have two numeric types**. `as` is
  pure erasure; `x is T` predicates are *trusted, never verified*.
- **ReScript, Elm** — full erasure. ReScript separates int/float with *syntax* (`+` vs `+.`).
- **Scoreboard: RTTI shippers 2, erasers 4. Both RTTI shippers hit the collapse anyway. Zero of six use a tag.**

---

## 6. WHERE RESEARCH DISAGREES WITH THE MAIN AGENT

**The main agent's D9 landing — `(cast<Dog> x) -> Dog?` — is measurably WORSE than `:of`, not the one form
that needs language support.**
- `:of` already tests *and binds/narrows* in one step (D27 match position; D41 expression position,
  `ast.ts:738`). `cast<Dog> -> Dog?` produces an optional that D9 then forbids you to unwrap
  (`T? -> T` refused, LL0205). **Two steps to reach what `:of` gives in one.**
- Worse: narrowing is **syntactic only, two hardcoded shapes**, no flow analysis (DECISIONS.md:1150-1157).
  `(let d (cast<Dog> x))` works only through `(if (!= d nil) ...)`. Any other idiom hits LL0205 with no
  escape hatch (DECISIONS.md:1158). The cast *creates* the awkwardness it was meant to relieve.
- `dynamic_cast` is not the C++ form that needs language support **because l-lang already has it, better.**

**Agreements confirmed, with sharper evidence:**
- Conversions-as-functions is right, and the evidence is stronger than stated: `static_cast<int>(3.7)`
  silently picks truncation — one of three defensible rounding modes, chosen by the *language*. `floor`/
  `ceil`/`round` make it a visible choice at the call site (STDLIB.md:182). **A cast form LOSES information.**
- `(f<T> x)` does not parse: CONFIRMED by measurement — `(identity<Int> 5)` parses cleanly into 5 elements,
  `classifyList` → `kind=call args=4`. Not a checker bug; the grammar genuinely produced 4 args
  (`Parser.ts:398-399, 432-438`).
- **Correction on Int/Real:** `Float` is not an l-lang type at all — `case 'float'` is DEAD CODE. The six
  primitives are Int/Real/String/Char/Boolean/Void (`TypeEnvironment.ts:40-48`). `'real'` and `'char'` are
  *absent from the switch*: probed, `5.5 :of Real -> false`, `"c" :of Char -> false`. The conflation is real
  but arrives by a different route.

**Also against the main agent's framing:** D34/Phase E is a *live, recent* ruling that when the static type
is known, lower at compile time and do not build runtime machinery — it explicitly overturned its own
"mirror runtime dispatch" sketch (DECISIONS.md:3202-3211). That argues against a runtime cast, not for one.

---

## 7. BUGS FOUND EN ROUTE (independent of any ruling)

1. `(type x)` on any **imported class** silently degrades — `type` uses `constructor.name`
   (`RuntimeProvider.ts:415`), `__ll_is_type` uses `__ll_name` (:249). The `__ll_name` fix landed in *one of
   two* consumers. Probed: `__ll_is_type(m,"Money") -> true` but `type(m) -> {"name":"__ll_inlined_Money_1"}`.
   DECISIONS.md:1267-1268 records this as FIXED. It is half-fixed. No test covers it.
2. **`type`'s overload is unfixable in place.** String arg = name-lookup, else = value-reflect
   (`RuntimeProvider.ts:408-424`). So "what is the type of this String *value*?" is **structurally
   unaskable**, and `(type s)` where `s` holds `"Money"` returns **Money's full class metadata**. Requires
   splitting into two functions; goldens will absorb it.
3. `(type 5)` / `(type true)` return `{kind:'unknown'}` with **no `name` key** (:423). The four scalars the
   language is built on are the four it cannot describe.
4. **One `:of` syntax, TWO lowerings.** match → `__ll_is_type` (name-string); `catch e :of Error` → raw JS
   `instanceof` (`JSTransformerAstVisitor.ts:2313-2320`). Different semantics. They agree today by accident.
   Nothing documents the split.
5. `__ll_type_metadata` is **flat and name-keyed**, first-win on collision (`SymbolTable.ts:661-667`). It
   cannot represent two same-named types — which is precisely what the inliner exists to create. D11 already
   rejected this table as the struct marker for exactly this reason (DECISIONS.md:987-991).
6. Metadata says `Int[]`, `:of` says `Array` — `formatType` exists and is called on one path, not the other
   (`JSTransformerAstVisitor.ts:438-447` vs :2503).
7. Roadmap ticks RTTI DONE (roadmap.md:59). Untrustworthy — same file annotates its own false ticks three
   lines up (:47-49).
8. Roadmap "Phase 7" (LLVM) and DECISIONS "P7" (generics, :547) are different things under near-identical
   names.
9. **UNVERIFIED, flagged not to be mistaken for intent:** `__ll_is_type(v, null)` throws at :223 (no guard).
   I could not construct l-lang source reaching it. Do not spend budget.

---

## 8. SEQUENCING

**BUILD FIRST (all cheap, all RTTI, none need a cast):**
1. Rule Q6 — D5's headline vs P7d. Everything else depends on it.
2. Probe `(x :of Int | String)`. If it parses, the `'Any'` → `return true` hole is a live soundness bug.
3. Rule Q1 and add `real`/`char`/`void` to the switch. `:of Real` is unreachable *today*.
4. `:of Interface` → LL02xx (Kotlin's answer).
5. Fix `type`'s `__ll_name` half-fix; split the `type` overload.

**DEFER:**
- Unifying `__ll_is_type` with the metadata table. Real, wanted (it's what makes `:of Iterable` possible),
  and it is Dart's multi-year rti project in miniature. Not now.
- `(f<T> x)` call-site generics (option b). Measured-viable, and the scratchpad shows authorial intent
  (`sql<Product>`, `builder.UseStartup<Startup>` — `W99_L_sloth_design_v1.lisp:231,273`, manifest status
  `fixture`, never compiled). **If this is built, `cast` falls out of it for free — which is a strictly better
  reason to build it than `cast` is.**
- `reinterpret_cast` — meaningless on JS. Under Phase 7 it becomes expressible *and* D9's niche-packed `T?`
  supplies the refusal. D15 is the template if a spelling is ever reserved (DECISIONS.md:229-236).

**REFUSE OUTRIGHT:**
- `cast<Box<Dog>>` and any cast accepting type arguments it cannot check. Unsound; it is the amnesty P7 deleted.
- `cast<StructuralType>` / `cast<Interface>` — the `functional-pattern` precedent governs: leave it dead, say so.
- `static_cast`: both its jobs are already implicit — upcast via nominal subtyping (`TypeChecker.ts:167-175`),
  numeric widening via `promotionRules` (:379-390). Zero things in l-lang. Its downcast half is UB; it has no
  honest translation.
- `const_cast`: **category error.** D10 is *binding*-immutable, shallow (DECISIONS.md:160-163) — l-lang never
  makes an object const, so there is nothing to remove. And a cast is an expression; it cannot manufacture a
  binding. The real demand is met by D11 by-copy struct semantics (:963-970).

**Every C++ cast's legitimate use already has an l-lang feature covering it. That is the finding.**
