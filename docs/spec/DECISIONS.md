# l-lang Design Decisions

Rulings on l-lang's language surface, taken 2026-07-12 following a full compiler audit (161 agents,
148 verified findings across grammar, types, codegen, analysis passes, stdlib/runtime, docs
conformance, examples, and hygiene). Every ruling was made with the eventual native/LLVM backend in
front of it — several are not stylistic preferences, they are things that cannot be retrofitted
later without breaking every existing program.

This document is the spec. Where the grammar, the docs, or the example corpus disagree with a
ruling here, **this document wins** — they get brought into line as each phase lands. None of these
rulings are implemented yet; landing them is Phase 3 (form layer) and Phase 8 (type system) of the
stabilization plan. See the audit's `03-stabilization-backlog.md` for the full evidence and blast
radius behind each one.

---

## D1 — Zero-arg member access: `(obj.m)` is call or property read?

**Ruling:** `(obj.m)` is **always** a call. Bare `obj.m` (no parens) is the only property read.

Today this is resolved by a 40-word English blacklist of method names, and it's order-dependent —
the same expression compiles differently depending on what else is in the file. This ruling needs no
type information at codegen time and deletes the blacklist entirely.

## D2 — Assignment operator

**Ruling:** `:=` becomes a real, first-class lexed token. The `SimpleAssignment` (`=`) rule is
deleted — `=` becomes a syntax error as an assignment; `(= a b)` remains the prefix equality
function. The compound-assignment set becomes an explicit enumeration: `+= -= *= /= %= **=`.

Today `:=` is a compound assignment whose leading `:` is stripped by a `.replace(":", "")` hack, and
`CompoundAssignmentOperator` accepts ~19 operator strings via a shared `Control` character class —
about 7 of which are also valid JS operators. `(x <= 5)` currently parses as an assignment and emits
`x <= 5;` — valid JS, silent no-op.

## D3 — `defmacro` / `defsyntax`

**Ruling:** OUT for 1.0, documented as "Planned." The keywords are reserved — `(defmacro ...)`
becomes a hard "not implemented in 0.x" error, never a silent call. Metaprogramming for 1.0 is
`:comptime` + `defmodifier`, both of which are currently broken and must be fixed.

`DefMacroKw` is declared but referenced by zero grammar rules; `defsyntax` isn't even a keyword.
Today `(defmacro ...)` compiles with zero errors into syntactically invalid JavaScript.

## D4 — Unknown modifiers

**Ruling:** An unknown `:modifier` is a hard error, whitelisted per construct, with a did-you-mean
suggestion. An unknown class-body member is also a compile error.

Today `Modifier = ":" [a-zA-Z_][a-zA-Z0-9_-]*` accepts any `:foo`. `(defclass Dog :inherits Animal
...)` silently drops the inheritance with zero diagnostics — and `:inherits` is the syntax used in
README.md and language-reference.md. The enforcement scaffolding already exists as dead code
(`isBuiltinModifier`, zero callers) — this ruling is about wiring it up, not building it.

## D5 — Type system: annotator or checker? Nominal or structural? Generics real or erased?

**Ruling:** Full structural typing with real generics. Type errors become fatal (block codegen).
Real substitution, unification, constraint checking (`:where T :extends ...`), and variance
(`<:out T>`).

Today no type error can fail a build, `isAssignable(Dog, Animal)` returns `false` (inheritance
checking is a stubbed `// TODO`), and there are zero hits for `substitute`/`monomorph` anywhere in
the codebase. This overrides the audit's own recommendation to descope generics — the "statically
typed Lisp" thesis gets delivered, not walked back. → Phase 8.

## D6 — Module model

**Ruling:** Whole-program bundler; `export` becomes a hard visibility boundary. Cross-module
duplicate names are an error, with `:as` as the escape hatch. Circular imports produce a clean
diagnostic. Module bodies do not execute on import.

Today `export` enforces nothing — import merges a file's entire top-level scope, privates included.
Two modules with a same-named private helper silently corrupt each other. The correct filtering
visitor already exists, commented out. → Phase 6.

## D7 — Stdlib boundary

**Ruling:** A full, real stdlib. A first-class `stdlib/` with a real module-resolution root; every
documented function actually implemented, tested, and pure (copy, don't mutate); `sort` takes a
comparator; one naming scheme.

Today only 27 symbols are always available; 10 of 18 documented collection functions don't exist
anywhere. This overrides the audit's own recommendation for a thin prelude shim. Requires D6 (module
system) and D9 (optionals, so `first`/`last` can be typed honestly) first. → Phase 9.

## D8 — Number literals

**Ruling:** Implement all seven literal forms properly: hex/octal/binary (trivial codegen), a
rational type for fractions (`1/3`), and a complex type for `10+2i` (both need runtime boxing and
operator-dispatch integration). Keep the matrix literal, with a real type-system case. Comma becomes
insignificant whitespace inside `[...]` (a matrix requires an explicit `|` separator, 2+ rows). The
`0o` prefix is required for octal; a number literal can never be immediately followed by an
identifier character.

Today `[1, 2, 3]` (with commas) is silently a 1-row matrix, not a vector; five of seven literal forms
crash inside `astring` with no source location; and `08` splits into two separate numbers. This
overrides the audit's own recommendation to cut fractions/complex/matrix. → Phase 10.

## D9 — What is `nil`?

**Ruling:** Non-nullable by default, with explicit `T?` optionals. `Animal` can never be nil;
`Animal?` might be, and the compiler forces the unwrap. One bottom value, one spelling (`nil`; `null`
kept only as a JS-interop alias) — `none`/`void`/`undefined` are deleted as spellings.

Today there are five spellings of nil and two different bottom values baked into different goldens.
This is a memory-layout decision for the eventual native backend (`T` = raw value/pointer, no null
check; `T?` = tagged/niche-packed) and **cannot be retrofitted later** without breaking every
existing program. Feeds directly into D5 (narrowing, `is nil`).

## D10 — Is `let` actually immutable?

**Ruling:** Enforced, binding-immutable (Rust `let` semantics). The *binding* cannot be rebound; the
object it points at may still be mutated through its own methods. `(let d (new Dog)) (d := other)`
is an error; `(d.set-name "x")` is fine.

Today `mutable: false` is written to the AST and symbol table and never read anywhere — the
guarantee is purely an accident of the JS backend mapping it to `const`, and it evaporates entirely
on a native backend. Maps cleanly to LLVM SSA.

## D11 — The class surface

**Ruling:** `:extends` only (`:inherits` is not a synonym — it's a typo/doc error to be corrected).
Closed, builtin modifier set per D4. Visibility (`:private`) is type-check-only and erased at
codegen — no `#private` field emission. `defstruct` becomes a real value type: by-copy semantics,
not an alias for `defclass`.

Today the grammar has `:extends` while README and the reference doc say `:inherits`; `:static` is
hardcoded `false` in codegen while reflection reports `isStatic: true`; `:private` fields are written
as `#x` but read via `this.x`, so they're always `undefined`; and `defstruct` is a literal
`return this.visitClass(node)`. `defstruct`'s value semantics are the foundation of the native memory
layout, and D5 needs a real value-type case anyway.

## D12 — Control forms

**Ruling:** `for` is named-only and order-free; unknown, duplicate, or missing-required clauses are
hard errors. `if`/`when`/`cond` stay positional, and every special form must consume its entire
parent list — leftover args are an arity error, not a leaked sibling statement. `cond`'s default
clause is spelled `:else`.

Today every `for` slot is optional and positional — omitting `:then` silently drops the loop body;
reordering slots compiles clean into something else entirely. `for-each` is currently *implemented
by* this misparse, not despite it.

## D13 — Map keys

**Ruling:** Map keys are strings, never mangled. `{ :my-key 1 }` emits `{ "my-key": 1 }` verbatim.
Cost: dot-access (`m.my-key`) can't reach these keys — use `m["my-key"]` instead.

Today `{ :my-key 1 }` compiles to `{ my2dkey: 1 }`, so `m["my-key"]`, `(get m "my-key")`, and any
external JSON API all see `undefined`. This is the only option where `get`, `[]`, and JSON interop
are all coherent at once.

## D14 — The frontend

**Ruling:** Revive `grammar_v2` — a Chevrotain lexer + parser that was already written and shelved,
recovered from compiled output in `src/dist/`. It already solves D2 (`:=` as a real token), unblocks
D5 (`Box<Int>` lexes instead of collapsing into one identifier), and tokenizes D8's numeric tower. Its
one flaw — all 28 keywords declared `longer_alt: undefined`, which reproduces the exact
keyword-boundary bug it was meant to fix — is a 28-line change (`longer_alt: Identifier`).

The current PEG grammar is scannerless: whitespace alone decides token boundaries, so any construct
the grammar doesn't recognize degrades into an ordinary identifier and silently re-parses as a call.
This is the root cause behind roughly 29 of the audit's critical findings. The PEG parser is also
exponential in nesting depth. → Phase 2, before D5/D8/D9 are representable at all.

## D15 — Native-forward syntax

**Ruling:** `:gc` / `:stack` / `:manual` / `:destructor` are reserved keywords that hard-error with
"reserved for the native backend, not implemented in 0.x." Never silently ignored (D4 makes that
automatic) — the syntax stays claimed for the eventual LLVM backend.

Today these are documented, parsed, and silently ignored — pure fiction on a JS target.

---

## Also settled, by D1/D2/D14 together

- `:` is reserved — a stray `:foo` is always a keyword, modifier, or map key; never a junk
  identifier.
- Identifiers are letters, digits, `_`, `-`, `?`, `!` — nothing else.
- Operators are a closed, enumerated, longest-match token set.
- Keywords get `longer_alt: Identifier` and lose the case-insensitive flag (today `DEFCLASS` and
  `Let` both parse as keywords; they won't after D14).

---

# D14 addendum — what reviving grammar_v2 actually found

D14 predicted the scannerless PEG was the root cause of the silent-misparse class. Executing it
(Phases 2a–2d) confirmed that, but the specifics differed enough from the audit's guesses to be
worth recording. All of the below is measured, not inferred.

## The lexer contradicted its own parser

`Colon`'s pattern was `/:(?![a-zA-Z=])/` — it could never be emitted before a letter. But
`Parser.ts` already implemented generic modifiers (`modifier := Colon Identifier args?`) and map
keys (`keyValue := Colon key`) in exactly the PEG's shape. Both rules were therefore
**structurally unreachable**, and **44 of 95 examples could not even tokenize**.

The 13 hardcoded `*ModKw` tokens were a workaround, and one that cannot work even in principle:
`defmodifier` lets users define modifier names *in l-lang source* (`:identity`, `:logged`,
`:timed`, `:retry` in `examples/06-modifiers/`). A fixed token list can never enumerate them.
Generic `Colon Identifier` is the only design that works — which is presumably why the parser was
written that way in the first place. The `*ModKw` tokens survive only for the names the grammar
genuinely reserves for structural slots.

## The 4-minute parser construction was maxLookahead, not validation

`new LLangParser()` took **~347 seconds**, paid fresh by every process. Chevrotain's docs
recommend `skipValidations` for constructor time. Measured, that takes **349s — no better**:

```
Grammar Recording               6 ms
Grammar Validations           275 ms   <-- all skipValidations saves
ComputeLookaheadFunctions 347,071 ms   <-- 99.92% of it
```

Lookahead-automaton construction is superlinear in k, and k is the only real lever:
**k=3 → ~347s | k=2 → 283ms | k=1 → 25ms**. Settled at `maxLookahead: 2`, which keeps validations
**on** — Chevrotain still reports zero ambiguities, i.e. its own static analysis says two tokens
suffice for every alternation here. If a future rule genuinely needs three, override it on that one
alternation (`OR({ MAX_LOOKAHEAD: 3, ... })`); do not raise the global.

## Adjacency is load-bearing, and the token stream loses it

The PEG distinguishes `arr[i]` (indexer) and `Expr[]` (array type) from `arr [i]` / `Expr [1 2]`
(a value) purely by **adjacency** — it puts no whitespace production between them. Chevrotain's
lexer discards whitespace, so that information survives only in token offsets and has to be
recovered explicitly (`isAdjacentLBracket`). The same applies to `HttpMethod:GET`. This is the one
place where "just use a real lexer" costs something the scannerless grammar got for free.

## Confirmed live PEG misparses (deliberately NOT reproduced)

- `(defclass Pair<T U>)` → generics **silently dropped** (`generics: []`), with `<T` and `U>` left
  as junk *identifiers in the class body* — `<` and `>` are in the PEG's `Control` char class, so
  they glue onto identifiers. Its `.expect` golden encodes this. grammar_v2 parses
  `generics: [T, U]`.
- `(defstruct Rectangle :implements Shape)` → dropped the same way, `:implements` and `Shape`
  becoming junk identifiers in the struct body.

## Open: `defstruct :implements` is an unimplemented feature, not a parser gap

`StructNode` has no `implements`/`extends` field at all (`ClassNode` does), and no pass downstream
consumes one. `examples/05-oop/01_interfacses.lisp` is aspirational and passes under neither
frontend: the PEG misparses it into junk and emits wrong output (FAIL); grammar_v2 rejects it at
parse time (ERROR). Belongs with whatever settles `defstruct` value-type semantics (**D11**).

## Not a PEG bug: `(let nullable 1)`

The audit cites this as the poster-child misparse. It is not — the **PEG parses it correctly**.
The bug was in grammar_v2's own recovered token definitions (all 28 keywords had
`longer_alt: undefined`), fixed in Phase 2a. Worth stating plainly so the claim stops being
repeated.

## Status after Phase 2d

`AstProvider` defaults to `grammar_v2`; `--frontend peg` still selects the old parser. Same 57
examples pass under both. `l-lang.pegjs`, `l-lang.js`, `peggy` and the `parser` script are
**not deleted yet** — that is a separate step, once dev has run on grammar_v2 for a cycle.

---

## D16 — Destructuring bindings

**Ruling:** `let`/`mut` and function parameters bind either a NAME or a destructuring PATTERN.

```lisp
(let [x y] point)                      ; vector
(let [first second ...rest] numbers)   ; with a rest element
(let {:name :age} person)              ; map, shorthand -- binds `name` and `age`
(let {:city home-town} person)         ; map, renamed
(let {:user {:name :id}} profile)      ; nested
(fn print-point [[x y]] ...)           ; parameters too
```

This was a genuine **spec gap**: destructuring appears in the corpus
(`examples/01-basics/18_destructuring.lisp`, `20_scope.lisp`) and in the docs, but no ruling
D1–D15 covered it, and neither frontend parsed it. Written down now because it is implemented.

**Semantics.** JavaScript has all of it natively, so a binding pattern lowers directly to an
ESTree `ArrayPattern` / `ObjectPattern` — no temporaries, no lowering pass. `_` binds nothing (an
array hole). The shorthand `{:name}` is normalised in the AST builder into an explicit
identifier-pattern, so every consumer (match codegen, destructuring codegen, the symbol table)
sees one uniform shape rather than special-casing an absent pattern.

A destructuring binding declares **N names, not one**. `SymbolTable.defineSymbol` and
`defineParameter` emit one entry per bound name (`ast.bindingIdentifiers`), all pointing back at
the same node. Any pass that reaches for `node.name.id` on a `variable` or `parameter` is wrong,
and must ask `bindingIdentifiers` instead.

**Not typed yet.** The type passes skip destructuring bindings. Typing `(let [x y] point)`
properly needs tuple/element types, which is **D5 / P8** — and the type passes report nothing at
all today (zero `results.add` calls, see P4), so skipping costs nothing that is not already lost.
This is a known, documented hole, not an oversight.

**Still out of reach, and why** — the two examples that motivated this are not fully unblocked:
- `18_destructuring.lisp:48` — `(fn print-point [[x y] <- [Int Int]])` needs a **tuple type**
  (`[Int Int]`), which neither frontend has ever supported. That is D5/P8, not the form layer.
- `20_scope.lisp:68` — blocked on **D12**'s `for` clause syntax, before it ever reaches its
  destructuring on line 112.

Both now fail on a *different, correctly-named* blocker than they did before, which is the point.

---

# P4 addendum — what arming the type checker actually found

The audit's P4 said "today l-lang is a statically-ANNOTATED language; this phase makes it a
statically-TYPED one." That was right. The specifics were not always, and the measurements below
are all from running the code, not from reading it.

## The type system could not fail a build — and the reason was one missing capital letter

Its *only* `context.results.add` — the sole route to `hasErrors`, and therefore the only way any
type error could block codegen — lived in `TypeCheckingValidatorAstVisitor`. That class dispatched:

```ts
return (this as any)[`visit${node._type}`]?.(node) ?? node;
```

with **no capitalisation at all**. Not "kebab-case", as the audit framed it: even the single-word
`"variable"` builds `visitvariable`. Not one of its four visitors could ever be reached, and because
that same `visit()` override suppressed the inherited child-walk, it never recursed either. It ran
on every compile and did nothing, for 360 lines. Deleted; its error path moved to the pass that
actually runs.

Meanwhile the six checks that *did* run all reported through `context.log(LogLevel.Error, …)`, which
touches the logger and nothing else. The gating plumbing (`results.add` → `hasErrors` → codegen
blocked → exit 1) was fully built and correct the entire time. **It was simply never fed.**

## Measure before you arm

Armed as-is, those six checks emitted **54 diagnostics across 17 currently-passing tests**. The
suite would have gone 58 → ~39 and the phase would have looked unshippable. Every one was a false
positive. The measurement harness (`npm run test:type-errors`) was built *first*, before any type
code was touched, which is the only reason the cleanup was falsifiable — and it caught a regression
mid-phase that would otherwise have shipped (`!!a.generics !== !!b.generics` looks right and is not:
a non-generic class carries `generics: []`, its type-ref carries `undefined`, and the two are the
same type).

## The false positives were structural, not subtle

- **`inferOperatorType` had become the fallback for any unresolvable call head.** So every JS global
  and member call was run through the operator tables and reported as an invalid operator —
  *"Invalid unary operator `Math.log` for type Int"*. The type system had no model of JS interop,
  and its fallback was *assume it's an operator, then complain it isn't a valid one*.
- **A user-defined `:operator +` is registered as an ordinary symbol named `+`.** Resolving the head
  as a function therefore made *every* `+` in a file resolve to the Complex overload, so
  `(+ c1.real c2.real)` — adding two Reals — reported *"Expected Complex, got Real"*. Operators must
  dispatch before functions; which overload applies depends on the operand types.
- **`convertAstTypeToInferred` was declared three times and the copies disagreed**, each knowing
  something the others didn't. Only one consulted the symbol table; the others made every
  user-defined type a *primitive of the same name*, so a `<- Complex` annotation produced
  `{kind:"primitive", name:"Complex"}` and reported *"Cannot assign Complex to Complex"*.
- **`typesEqual` returned `true` for any two map types** — `Map<String,Int>` equalled
  `Map<String,Boolean>`, and `isAssignable` short-circuits on it.

## The checker had never seen most of the program

Not mentioned anywhere in the audit. Both passes override `visit()` with manual dispatch and no
child walk, and `visitList` **skipped everything that was not a declaration** ("*Skip comments and
other non-declaration items*"). So no loop body, match arm, try block — or even a call at statement
level — had ever been type-checked. `(if "str" 1 2)` produced **nothing**: `visitIf` existed and had
simply never been reached.

## Live language inconsistency: `Bool` vs `Boolean`

The corpus annotates with `Bool` 6 times and `Boolean` 15 times. The type system knows only
`Boolean`. Nobody noticed, because nothing was ever checked. **This needs a ruling** — is `Bool` a
legal spelling, or should the six uses be corrected? Until then, an unrecognised type name is
`Unknown` (gradual), not an invented primitive that equals nothing.

## Open: the unresolved-identifier check is blocked on P6, not on effort

The audit's ★ finding ("no unresolved-identifier check exists anywhere") is real, and it stays real.
It cannot be built on the current resolution model:

- `typeEnv.resolveIdentifier` fails on **165 identifiers** across the corpus, overwhelmingly
  function **parameters and locals** (`n` ×36, `x`, `a`, `amount`, `idx`) — the type environment does
  not track nested scopes.
- Narrowing to call *heads* doesn't rescue it: of **357** unresolved heads, 175 are special forms
  (`return`, `new`, `throw`) and most of the rest are symbols **imported** from `20-stdlib`
  (`print`, `log`, `is-nil`) — and imports are never inlined, because `InlineImportsAstVisitor` is
  disabled.

Both facts are the audit's own **P6** ("symbol resolution is global, name-keyed, and top-level-only
… structurally incapable of seeing a nested scope"). The check belongs *after* P6. It is recorded as
a pending negative test with its reason, not quietly dropped. The same constraint is why
duplicate-declaration is checked syntactically per-block rather than through the symbol table.

## Status

`LL0200` type mismatch · `LL0201` if-condition · `LL0202` assignment · `LL0203` argument ·
`LL0204` operator · `LL0211` arity · `LL0212` duplicate declaration · `LL0213` return type.

A type error now blocks codegen and exits 1. Zero false positives on the corpus; 58 tests pass under
both frontends.

---

# P6 addendum — scope-aware resolution, and a bundler we did not need

## The symbol table could not answer "what does `x` mean *here*"

`Scope` has always been a tree — it has `parent` and `scopes`, and `SymbolTableBuilder` genuinely
builds it. But `SymbolTable.scopes` was a flat list of module **roots**, and every resolution path
walked **upward** via `.parent` (which from a root is `undefined`). **Neither path ever read
`scope.scopes`.** So a function parameter, or a `let` in a body, was written into a child scope by
`defineSymbol` and was then unfindable.

That single gap explains a remarkable amount:

- **Codegen kept a shadow symbol table.** `localIdentifiersStack` registered parameters, in its own
  words, *"BEFORE processing - this prevents them from being resolved to inlined symbols from
  imports"*. It registered **only** parameters — so a `let` in a body sharing a name with an
  imported symbol was rewritten to **the import's** JS name. Two different symbols, one name.
- **`identifiersCache`** was a flat, scopeless, never-cleared name→jsname map. First resolution won,
  forever.
- **P4's unresolved-identifier check was unbuildable**, because `resolveIdentifier` failed on 165
  identifiers that were really just parameters and locals.

`resolveSymbol(name, from)` now walks the real scope chain outward from the node's own scope. Both
shims are deleted — `grep -c` in `codegen/` returns **0** for each, which is the audit's own success
criterion for this phase.

**A subtlety worth recording:** the symbol table is built on the *pre-desugar* AST while codegen sees
the *post-desugar* one. This works because `BaseAstTreeWalker` copies `_parent: node._parent` — the
**original** parent object — so one step up from a desugared node lands back in the tree that was
indexed.

## "Comes from another file" is not "is an import"

Deleting the shims took the suite 58 → 57, and the regression was the fix doing its job:

```js
const __ll_inlined_result_1 = new __ll_inlined_Vector3_1();   // used here...
const __ll_inlined_Vector3_1 = class Vector3 { ... };          // ...declared after -> TDZ
```

When a library function is cloned into a module, its **body** is visited too — and the locals inside
it now resolve (correctly) to the library's scopes. A source-only test therefore hoisted those
locals to the top level as if they were exports. `isImportedSymbol` now requires a **root scope**.
Before scope-awareness this was invisible: a nested local of another module was simply
*unresolvable*, so it fell through untouched.

## The bundler was not needed, and the measurement is why

P6c was planned as "emit definitions in `DependencyGraph.iterate()` order". The premise was wrong.
**Emission is already topological, and always was.** `ensureSymbolInlined` claims its name *before*
descending (so cycles terminate) but writes the *definition* **after**, once everything it
references has been written. Insertion is post-order; `Object.values()` preserves it. A deep chain
(`main → f → g → h → const → class`, with `f` written first in the library) still emits the class,
then the const, then `h`, then `g`, then `f`.

The TDZ crash that motivated the ordering theory was **not an ordering bug** — it was the
locals-hoisted-as-imports bug above. Rewriting emission to walk modules would have produced the same
order, additionally emitted unreachable definitions, and added risk for nothing. The invariant is now
documented at the insertion point and pinned by tests that assert the emitted **order**, not merely
the output — function declarations hoist, so a wrong order can still pass by accident.

`DependencyGraph.iterate()` remains uncalled. It is *correct* now, and it is the right tool if
emission ever needs module-level ordering — but wiring it in today would be ceremony.

## Module graph: three bugs, all silent

- **An import cycle was `RangeError: Maximum call stack size exceeded`.** The only re-entry guard
  (`cacheModule`) ran *after* the recursion. Now an in-progress set, and `LL0300` — a **warning**,
  because under the module-init ruling a cycle is benign.
- **Every non-root graph node was keyed by a path that does not exist** (`path.join` on an
  already-absolute path). Harmless only because nothing consumed the graph.
- **Imported modules were compiled through full codegen and the output discarded** — `stopAt`
  defaulted to `"codegen"`. Now `"types"`.

## Rulings

- **Module init (audit 6.8): definitions only — an imported module's body never runs.** Previously
  true by accident (the inliner only cloned referenced definitions); now deliberate, and pinned by a
  test. No goldens moved.
- **`export` enforcement is deferred.** It is decorative today: `exportName` is written in one place
  and **read nowhere**, so you can import a symbol that was never exported. Enforcing it is a
  corpus-wide change — `20-stdlib/std/types.lisp` defines 8 functions and exports **zero**, and the
  stdlib has 6 `(export …)` forms against 53 `(fn …)` definitions. It needs its own phase and its own
  ruling, and must not be mistaken for an oversight.

## P7 — generics stop being a lie

`(defclass Container<T>)` reported itself as `{ generics: [null], properties: [{ type: 'Unknown' }] }`.
`T` was not merely unchecked, it was **not represented** — and an `Unknown` silently disables every
check that touches it. `08-types/10_generics_basic.lisp` was the suite's one red FAIL (not an xfail)
because of it; its golden already specified the right answer.

### The declared type was a lie (P7a)

`ClassNode.generics` was declared `GenericTypeNode[]` and `InterfaceNode.generics`
`InterfaceGenericType[]`. **Neither frontend emitted either.** What arrived was a `TypeNameNode`
whose `name` is a plain string, so all six consumers read `generic.name.name`, got `undefined`, and
bound every type parameter under the name `undefined`. Same bug class as `TypeDefNode` declared `{}`
in Phase 2 — TypeScript cannot catch a lie it has been told to believe. Declaring the truth is what
*found* the six sites: they were the entire output of `tsc`.

Two things that were parsed and discarded are now kept, in **both** frontends:

- **Variance.** `(definterface Producer<:out T>)`. It rides on the type-name.
- **Type arguments.** `:implements Producer<Animal>` dropped its `<Animal>` in both frontends — so
  `16_covariance.lisp`, whose every line is `:implements Producer<Animal>`, retained not one of the
  type arguments it exists to demonstrate.

### A bare type parameter is compatible with anything (P7b)

Type parameters are now bound in `CollectTypesPass` — which builds the metadata codegen reports, and
which never entered a scope, so `bindTypeParameter` had nowhere to write. (`InferAndCheckPass` did
bind them; it runs *second*, too late.)

Binding `T` for real is what makes the rule necessary: `(let c (Container 42))` checks `Int` against
a bare `T`, and deciding that honestly means **instantiating** `Container<Int>` and substituting —
a type system l-lang does not have. **We fix the name, we do not implement instantiation.** Gradual
typing has to keep holding exactly where inference stops; before P7b it did so only by accident,
because `T` *was* `Unknown`. An *instantiated* generic (`Container<Int>`, `Int[]`) carries its
arguments and is still compared structurally.

### An absent annotation is `Any`, not `Unknown` (P7c)

    Any      the source declared nothing, so anything goes  -- a statement about the PROGRAM
    Unknown  we tried to infer and failed                   -- a statement about the COMPILER

Reporting `type: 'Unknown'` for `(let :ctor name)` tells the user their compiler is confused when
their code simply said nothing. Same `kind`, so gradual typing is untouched — only the *name*
changes. This is a restoration, not an invention: the runtime converter still carries a
`m.type.name || 'Any'` fallback from when `Any` was the default, made unreachable because `Unknown`
is a truthy name. Both metadata goldens (`01_interfacses`, `10_generics_basic`) independently say
`Any`; **no passing golden pins `Unknown` or `Void` anywhere.**

### Subtyping, then variance (P7d)

`isAssignable(Dog, Animal)` was **false**. `TypeChecker` said `// TODO: Class inheritance checking`,
so passing a subclass to a function typed on its parent was a type error, and variance was
decoration -- `Producer<Dog> -> Producer<Animal>` cannot be decided if `Dog -> Animal` cannot be.
Subtyping is nominal: a class is its ancestors and the interfaces it declares, and nothing else.

**Declaration-site variance (`LL0214`).**

    :out T   COVARIANT      T is produced, never consumed -- return positions only
    :in  T   CONTRAVARIANT  T is consumed, never produced -- parameter positions only
    T        INVARIANT      anywhere; the DEFAULT, and unrestricted

The rule is what makes the use-site rule **sound**, not a style preference. If `:out T` could sit in
a parameter, then `Producer<Dog>` -- which we now accept wherever a `Producer<Animal>` is wanted --
would expose a method taking a `Dog`, and a caller holding what it believes is a `Producer<Animal>`
would hand it a `Cat`. Covariance is only safe because `T` never comes IN.

**The variance belongs to the DECLARATION, not the use.** `Producer<Dog>` does not know it is
covariant; `(definterface Producer<:out T>)` does. So `isAssignable` looks it up rather than reading
it off the operand.

**Two bugs found by the tests that must REJECT.** The covariance tests passed before either was
fixed -- vacuously, and that is the entire argument for writing the negative half:

- **A type annotation lost its type arguments.** `Box<Animal>` parses as
  `{_type:"type", type:{_type:"generic-type", ...}}` -- the compound type is NESTED in the wrapper,
  and `convertAstType`'s `"type"` branch read only `typeNode.type.name`, saw `Box`, and threw the
  `<Animal>` away. The `generic-type` branch was therefore **unreachable from any annotation**, and
  every `Box<Dog>` / `Producer<Animal>` in the language collapsed to a bare `Box` / `Producer`. The
  same shape bug as the array flag: the outer node is a wrapper, the inner node carries the meaning.
- **That branch, once reachable, was itself wrong** -- it re-wrapped each argument (already a
  `TypeNode`) in a synthetic `simple-type`, which has no `.name`, yielding `Unknown`.

### The one golden edit

`10_generics_basic.expect`: `requiredCount: 0` → `1`. **A golden is never edited to make the
compiler pass — this one was asserting a bug, not a behaviour.** It encodes the pre-Phase-3
`hasDefault` defect (`null !== undefined`, i.e. *always true*, so every ctor parameter looked
optional). `(mut :ctor value <- T)` has no default and `(let c (Container 42))` passes one argument:
**1 is correct.** Approved explicitly before the edit. Every other field in that golden was matched
by fixing the *compiler*, and no other golden moved.

Suite: **58 → 59. The one red FAIL is closed.**

## P5 — the code generator emitted wrong JavaScript

The last untouched layer, and the only one still producing **wrong answers** rather than missing
features. Its diagnostic count was small (3 corpus-wide) and that number was a lie: **acorn validates
syntax, not behaviour**, so every bug that emits *valid JavaScript which does the wrong thing* is
invisible to `LL0101` by construction. Two of them sat in the stdlib.

Hence `npm run test:codegen` (P5a): each case compiles a small program, **runs** the emitted
JavaScript, and asserts its stdout. Committed RED, before any fix — a case that passes on its first
run proves nothing about the bug it claims to cover. It went 8/11 failing → 0.

**It immediately falsified a claim in P5's own plan.** The plan asserted that `when`'s emitted comma
operator, `("a", "b")`, "discards the earlier values". It does not: `(a, b)` evaluates `a`, then `b`,
and yields `b` — last-value semantics with every side effect intact. The case passed on its first
run. The claim was retracted, not quietly carried.

### The silent ones (P5b) — valid JS, wrong behaviour

- **`:ctor` defaults were dropped.** `JSClassBuilder` reduced its parameters to a `string[]` *before*
  building the parameter list, so the default was structurally unreachable; `AssignmentPattern`
  occurred nowhere in the compiler. Carried as the raw AST **node** now — *not* via
  `extractDefaultValue`, which is a lossy reflection artifact returning the string `"<expression>"`
  for anything but a scalar literal. Live in `std/math.lisp` (`Complex`, `Vector3`).
- **`cond`'s `else` emitted `case _else:`** — an identifier bound to nothing, so a `cond` threw
  `ReferenceError` the moment its else was reached. `test: null` **is** `default:` in ESTree.
- **Map keys were mangled**, against D13's own ruling: `{ :my-key 1 }` emitted `{ my2dkey: 1 }`.

**`LL0102`** (new): a defaulted constructor parameter followed by a required one. Legal JavaScript
and a trap — `constructor(a = 1, b)` can only be called as `new C(1, 2)`, so the default is
unreachable. **Reported, never silently reordered**: the parameter order is the source's.

### The invalid ones (P5c)

- **A block cannot stand where JavaScript wants an expression.** `visitWhen` emitted a
  ConditionalExpression in every context; `visitIf` had the same bug in its *expression* path. Two
  shared helpers (`asExpression` — an IIFE whose tail is returned — and `asStatement`), lifted from
  `visitMatch`'s local `ensureReturns`, which had always done exactly this.
- **A type is erased.** `visitTypeDef` emitted `const Number = undefined;` for
  `(deftype Number Int | Real)` — *shadowing the JS global*, while `std/types.lisp` calls
  `(Number.isInteger x)` seventeen lines below. A type alias emits nothing unless it names a value.
- **The inliner bound by assertion rather than by fact**, casting any emission to an Expression. That
  survived a `ClassDeclaration` only by accident (`const X = class Y {}` is valid) and produced
  `const __ll_inlined_Number_1 = const Number = undefined;`.

### Async (P5d)

`visitAwait` did not exist — the only *reachable* node type with no emitter. `async` itself was
already fully wired.

- **A built-in modifier is not a user-defined one.** Codegen's "custom modifier" filter excluded only
  `operator`, so every other builtin was wrapped in a call to a `__ll_modifier_<name>` transformer
  that does not exist — `(fn :async main [])` emitted `__ll_modifier_async()(...)`. `isBuiltinModifier`
  had existed in `helpers/modifiers.ts` all along; codegen never asked it.
- **PEG could not parse `await` at all** — it read `(await X)` as a *call* to an identifier named
  `await` and emitted `_await(...)`. grammar_v2 has had an `awaitExpr` since D14. Added to the PEG
  grammar; the frontends agree again.

### `when` has no else

`WhenNode { condition, then[] }`, and the reference calls it "a simple if without else". A false
condition yields `undefined`. **`04_when.lisp` was at fault, not the compiler** — its `category`
else-chain was aspirational. Rewritten to use `if`, which does have an else. Same call as
`09_more_for_loops` and `20_scope`.

Goldens **authored** for `04_when` and `07-async/00`, which had none. No existing golden moved.

Suite: **59 → 63**, zero FAILs, under both frontends.

## D3 — metaprogramming: `defmodifier` (D3b)

**A `defmodifier` body is a RUNTIME DECORATOR.** It evaluates to a function taking the original
function and returning its replacement:

```lisp
(defmodifier logged []
  (fn [original]
    (fn [...args]
      (console.log "[log] call:" args)
      (original ...args))))
```

emits `function __ll_modifier_logged() { return original => (...args) => {...}; }`, which is exactly
the shape the application site already called. **Modifier ARGUMENTS are the modifier function's
parameters** — `:retry[4]` emits `__ll_modifier_retry(4)(originalFn)`. **An EMPTY body is an identity
pass-through**, not a memoizer.

### What it was

`visitModifierDef` never read `node.body` or `node.params`. It emitted **the same hardcoded memoizer
for every modifier in the language**, under a comment that admitted it. `(defmodifier identity [])` —
an explicitly do-nothing modifier — emitted a `Map`-backed cache. `modifierDefinitions` was written
and read nowhere.

Nobody noticed for two compounding reasons. Memoizing a pure function is **observationally
identical** to leaving it alone — so only an assertion on the emitted TEXT can catch it, which is why
the harness grew one. And every `defmodifier` in the corpus had an empty body, because **any other
shape crashed the compiler**: `enterScope` silently no-ops on an unregistered node type while
`exitScope` pops unconditionally, and `modifier-def` was not registered. The corpus had been written
around the bug.

**Four goldens certified it** and are re-authored from intent: `02_logging_modifier.expect` contained
no log lines, `03_timing_modifier.expect` no timings. `05_multiple_modifiers.expect` even contained a
literal `\n` — a backslash and an `n`, not a newline — which is what recording rather than authoring
gets you. Approved before the edit; the same category as P7c's `requiredCount`.

### Order of application

Modifiers apply left to right, each wrapping the last, so the **rightmost ends up outermost**:
`(fn :logged :memoized f)` is `memoized(logged(f))`. The cache therefore sits in front of the logger
and a cache HIT never reaches it. `05_multiple_modifiers.lisp` demonstrates exactly this.

### Two bugs found on the way

- **A modifier's own parameters were never declared.** `visitFunction` calls `defineParameter`;
  `visitModifierDef` only *visited* its params. So the `times` of `(defmodifier retry [times])` was an
  unresolved identifier (`LL0210`) the moment the body referenced it.
- **PEG's `while` took only ONE body expression.** `(while c (a) (b) (c))` put `(a)` in the loop and
  hoisted `(b)` and `(c)` *outside* it — they ran once, after the loop finished. A silent miscompile,
  and a divergence from grammar_v2, which has always taken many. `When`, two rules above it, already
  did it correctly; `While` was simply missed.

## D3 — metaprogramming: `:comptime` (D3c)

`:comptime` folds, and always has (see the retraction above). Its bugs were not in the folding but in
what happened when folding **failed** — and in one case, in what happened when it **succeeded**.

### A fold disagreed with the runtime

The sharpest bug in the phase, and invisible to every kind of test except one that compares them:

```lisp
(let :comptime folded (+ 1 2 3))   ;; -> 3
(let ran (+ 1 2 3))                ;; -> 6
```

The sandbox **hand-rolled its own operators**, and its `+` was BINARY — `(a, b) => a + b` — while the
real runtime's `+` is VARIADIC. So the identical expression gave two different answers depending on
*when* it was evaluated. **`:comptime` silently changed the answer.**

A compile-time evaluator that disagrees with the run-time one is worse than no compile-time evaluator
at all: the bug only appears in the builds where the fold happens to fire. The sandbox now runs
`RuntimeProvider.getRuntimeShim()` — the single source both paths already use — so the two cannot
diverge. It also hand-rolled only ten operators, so `%`, `&&`, `||` and `!` were simply missing.

### An unfoldable call shipped a ReferenceError

Worse than the "silent downgrade to run time" it was described as. A `:comptime` function's
declaration is **deleted** from the output unconditionally, while a *call* to it was only replaced
when the fold succeeded. So:

```lisp
(fn :comptime twice [n <- Int] -> Int (* n 2))
(let x 5)
(let y (twice x))      ;; x is a runtime binding -- the fold cannot fire
```

left the callee gone and the call standing, and shipped `ReferenceError: twice is not defined` with
**zero diagnostics**. Every failure path in the pass returned the node unchanged and said nothing;
the sandbox's actual complaint went to a logger the harness discards.

**A call to a `:comptime` function must fold.** It is not optional — asking for compile-time
evaluation and passing a run-time value is a contradiction, and it is now `LL0099`, located, naming
what defeated the fold. `evaluateExpression` returns a RESULT rather than `undefined`-means-failure,
so a genuine `undefined` is no longer mistaken for an error, and the reason reaches the diagnostic.

## D3 — metaprogramming: `defmacro` and `quote` (D3d)

### `defmacro` is reserved, and refused BY NAME

D3: macros are OUT for 1.0, and `(defmacro ...)` is *"a hard 'not implemented in 0.x' error, never a
silent call."* Never a silent call — and equally, never an **unlocated** one.

`DefMacroKw` was lexed by both frontends and consumed by no rule, so `(defmacro foo [x] ...)` gave
either a bewildering parse error about an unexpected `)` (grammar_v2) or a parse as a **call to an
undefined function named `defmacro`** (PEG) — exactly the "compiles with zero errors into
syntactically invalid JavaScript" D3 complains of.

**Reserving a keyword means PARSING it.** Both frontends now accept the form, purely so the compiler
can refuse it by name, with a location: **`LL0023`**, which also says what metaprogramming *is*
today (`:comptime` and `defmodifier`).

### `quote` emits DATA

`'(+ 1 2)` used to compile to `JSON.stringify(node)` — the **string**
`"{\"_type\":\"quote\",...}"` — so `expr.nodes[0]` was a `TypeError`, because a string has no
`.nodes`. Code-as-data was code-as-**text**, which is code-as-nothing. It now emits an object
literal you can walk.

The value is the quoted **datum**, not the quote wrapper: `'x` is a symbol, `'(a b)` is a list. The
`quote` node is a compile-time marker with no business surviving into the program's data.

**`QuoteNode.nodes` was declared `ASTNode[]` and was an array in neither frontend consistently** —
grammar_v2 *unwrapped* the list (an array for `'(a b)`, a bare node for `'x`), PEG kept the list node.
Another declared-type-is-a-lie, in the family of `TypeDefNode` (Phase 2) and `ClassNode.generics`
(P7a). Normalised to PEG's shape, which preserves the structure. Fixing the declared type immediately
caught a consumer that had assumed the array and was emitting `'((+ 1 2))` — a different program.

`'"Hello {(name)}"` is **not** a quote — it is a `formatted-string`, split off by a negative lookahead
(`/'(?!")/`) in both frontends. They share a leading `'` and nothing else. Pinned by a harness case.

**This is code as DATA, not code as CODE.** There is no `eval`.

## D9 — what is `nil`?

### The premise was backwards (D9a)

The ruling reads as a *tightening* — "non-nullable by default" — and it is not one. **Annotated slots
were already non-nullable.** The nil literal types as `Null`, `isUnknown` is false for it, and nothing
anywhere ever set `nullable` on a *target*, so `isAssignable(Null, String)` was already false and
`(let x <- String nil)` already errored (LL0200).

The cage was always shut. What was missing was the **door**: no way to say "this one may be nil". D9
builds `T?`. This is recorded because it inverts the phase's risk — the danger was never a flood of
new errors, it was that `T?` would ship inert.

### One bottom value (D9b, D9c)

There were **two**, and they were strictly distinguishable:

```lisp
(== (when false 1) nil)   ;; => FALSE
```

`nil` emitted `null`; `if`-no-else / `when` / `cond` / a function running off its end all emitted
`undefined`; and `__ll_deep_eq` opens with `a === b`. **The language could not detect the bottom value
it produced itself.**

- **`nil` is the spelling. `null` survives only as the JS-interop alias** — same node, same emission.
  `none` / `void` / `undefined` are deleted, and LL0210 refuses them by name.
- **`undefined` had to leave `JS_GLOBALS` too.** Dropping it from `NilKw` alone would have re-admitted
  it as an ambient global, still emitting the JS `undefined` identifier, with zero diagnostics — a
  half-fix indistinguishable from a fix.
- **Eight codegen sites** emitted the implicit bottom; all now emit `nil`. (Two others are LL0100 /
  LL0102 error-recovery placeholders and are left alone.)
- **`__ll_deep_eq` gains the one loose `==` in the runtime.** l-lang emits only `null`, but JavaScript
  hands back `undefined` constantly. Since `undefined` is no longer a spelling, a program *cannot ask*
  which bottom it got — so the two must be indistinguishable. `a == null` is exactly that, and 0, `""`,
  `false` and `NaN` stay tight.
- **`head []` returned THE ARRAY**, so "did I get anything?" was unanswerable. It is nil. This is the
  lie D9's own entry above (`first`/`last`, typed honestly) was written about.
- **`:nullable` was a MODIFIER** that nothing read: `(let :nullable x <- String)` compiled clean and
  meant nothing. Deleted. Optionality is spelled `T?`, in the type, where the checker can see it.

### Two goldens moved, by ruling (D9c)

`03_if_else.expect` and `04_when.expect` said `Message: undefined` / `Nothing: undefined`. They now say
`null`. This is the one place D9 changes an observed answer, it was signed off before the work started,
and the diff is exactly those two lines.

### `T?` (D9d, D9e)

**An annotated binding used to bind its VALUE's type**, not its declared one (`bindType(varName,
valueType)` — "the actual value type"). So `(mut pet <- Animal (Dog))` bound `Dog`, and `(pet :=
(Cat))` was an LL0202 *false positive*. Annotating is precisely how you ask for the WIDER type, and
the wider it was, the more wrong the binding became. It would also have killed D9 outright: `(let x <-
String? nil)` binds `Null`, so the `?` evaporates one line after it is written.

**Three rules are the whole of the feature**, and the first was already in force:

| | |
|---|---|
| `nil` → `T` | refused — *this always was* |
| `nil` → `T?` | accepted |
| `T` → `T?` | **widens** — an optional is a superset, not a nil-only slot |
| `T?` → `T` | **refused** — the forced unwrap |

`Void` and `Nil` are **the same type**. In a Lisp everything is an expression, so "returns nothing"
and "returns the bottom value" are one statement — a function that runs off its end emits `null` and
is declared `-> Void`. Keeping them apart would mean `(fn f [] -> Void)` could not return the only
value it *can* return. (The nil literal was called `Null`, a name invented at one site and known
nowhere else — `isKnownPrimitive("Null")` is false — so `-> nil` returning `nil` was "declares Void,
returns Null". It survived only because `checkReturns` bailed on both names before comparing them.)

Two things that would each have made `T?` parse, type-check, and mean nothing:

- **`typesEqual` compares by NAME**, and runs FIRST in `isAssignable`. `String?` and `String` were
  equal, so the forced unwrap short-circuited to `true` before its own rule was consulted.
- **`formatType` had no optional branch**, so the unwrap's message would have read *"cannot assign
  String to String"* — not an error message, a koan.

**Optionality is a FLAG, not `T | Nil`.** That is the ruling's own reasoning: `T?` is a memory-layout
decision for the native backend (`T` = a raw value, no null check; `T?` = tagged), and a flag is what
that lowers to.

**`?` binds outside `[]`**: `T[]?` is an optional array, `(T?)[]` an array of optionals. Adjacency-gated
exactly like the array suffix — `String?` is optional, `String ?` is a `String` and then something
else — which is why the PEG's `TypeName` had to stop eating the whitespace in front of its own
suffixes. That single trailing `_` is also why the PEG could never gate its ARRAY suffix either
(`Expr []` was an array type there and a vector VALUE in grammar_v2).

### PEG: `void` the spelling vs `Void` the type

The PEG's `NilKw` was `"void"i` — **case-insensitive** — so `Void`, the return TYPE used across
`08-types/` and `std/io.lisp`, lexed as a nil *keyword* there while grammar_v2 (case-sensitive since
D14) read it as an identifier. It also had no boundary guard, so `nullable` lexed as `null` + `able` —
the exact D14 misparse, recorded in `diff-frontends.ts`, never fixed on this side. Both are now fixed,
and the guard is the identifier-continuation set (tighter than the `!NonControl` that `TrueKw` and
`FalseKw` still use — those admit `true-x`).

## P8 — papercuts: ordinary code that silently did the wrong thing

Not missing features. **Wrong answers**, in code anyone would write in their first hour.

### Member access after an indexer (P8b)

```lisp
(console.log xs[0].name)   ->   console.log(xs[0], name)   ->   ReferenceError, ZERO diagnostics
```

`primaryExpr` was `identifier indexerSuffix*` — no member access after an index — so `.name` fell out
of the loop and parsed as a **headless composite-identifier**, which is a real form (`05_matching.lisp`
pipes with `(.apply evt)`). It became a separate ARGUMENT. `LL0210` cannot catch it: `name` is a
perfectly good identifier that resolves to nothing.

**Adjacency is the discriminator**, exactly as it already was for the indexer: `xs [0]` is an
identifier and a vector, `xs[0]` an index; `foo .bar` is an identifier and a member-ref, `foo.bar` is
one name.

**A member suffix is a computed index with a string key** — `obj.name` and `obj["name"]` are the same
thing in JavaScript — so no new AST shape and no new codegen was needed. **But the SPELLING has to
survive**: D1 rules `(obj.m)` a CALL and `(obj["m"])` a READ, and those emit identical JS. Erasing the
distinction would have silently turned every `(xs["key"])` into a call — the opposite of what D1 is
for. `IndexerNode.members` records which suffixes were written `.name`, and with it D1 finally extends
to an indexer head: `(gs[0].hi)` calls, `(gs[0])` and `(gs["hi"])` read.

### A single-block body kept its implicit return (P8c)

```lisp
(fn f [n] ((console.log "side") (* n 2)))   ;; -> undefined
(fn f [n]  (console.log "side") (* n 2))    ;; -> 8
```

The same program, two spellings, two answers. `visitFunction`'s implicit return only fired on an
EXPRESSION; a block emits a `BlockStatement` and its value was dropped. Now `withTrailingReturn` — the
helper `visitWhen` and `visitMatch` already use.

**32 corpus functions (of 68 single-block bodies) newly return a value, and not one golden moved.**
That is the honest reading: nothing was CONSUMING those values, so the bug was latent in the corpus
and live for anyone writing new code.

### Bare string keys in map literals (P8d)

`{"host" "localhost"}` did not parse — `keyValue` required a leading colon. The colon exists so a BARE
IDENTIFIER can be a key (`:name`, not `name`, which would read as a variable); a string literal is
already unmistakably a key.

### `fn` parameter defaults — DEFERRED, and why

`(fn greet [name <- String "World"])` **cannot work**, and this was measured, not assumed: a parameter
list is space-separated, so `[a b]` is unresolvably "two parameters" or "`a` defaulting to `b`". The
first attempt parsed `[a <- Int b <- Int]` as `a` defaulting to `b`, plus a parameter named `<-`.

**Common Lisp hit the same wall and solved it with a marker** — `&optional (name "World")`. l-lang
will need one too; `:=` is the natural candidate, being D2's one assignment operator, and a default IS
an assignment.

Deferred until **after D9**, for a reason worth recording: a defaulted parameter is **omittable
without being nullable**. Inside the body `name` is always a `String`. Without defaults, every
omittable argument must become `T?` and be unwrapped for something that is never actually absent — so
defaults make D9 *better*, not worse, and how the two compose is best decided once optionals exist. It
also needs `LL0211` taught the difference between *required* and *total* arity, or the type checker
will reject `(greet)` as "too few arguments".

It is the only one of the four papercuts that adds a FEATURE rather than fixing a wrong answer.

## Open findings

- **Three runtime functions are DEAD, and one of them nearly bought a fake fix.** Nothing in the
  codegen ever calls `__ll_match_list`, `__ll_match_struct`, or `__ll_is_type` — they are emitted into
  every program and reachable from nothing. Vector patterns are *inlined* (`_` becomes `&& true`), and
  the `:is` type patterns that would need `__ll_is_type` do not parse at all (grammar_v2: "Expecting
  RightDoubleArrow but found ':is'" — the misparse behind the `05_pattern_matching` xfail).

  This matters beyond the dead weight. The D9 plan carried an item — "a `nil` pattern is a WILDCARD,
  because `__ll_match_list` does `if (pattern === null) continue`" — which is *true of the shim text*
  and **cannot fire**. Read from the source it looked live; built as a test case, it did not exist.
  Fixing it would have been indistinguishable, in the commit log, from fixing something.

- **A boolean cannot be a match pattern.** `constantPattern` is `StringLiteral | number` — so
  `(match x { true => …})` does not parse. Found while adding `nil` to the same rule; the same two
  lines would fix it, but nothing in the corpus proved it broken, so it is a finding, not a commit.

- **A bare operator-identifier compiles to an undefined reference.** `(let x <- String ? 1)` emits
  `const x = _3f;` — LL0210 does not check the operators-as-identifiers form (which exists so
  `(fn :operator + …)` can be declared). Pre-existing, and orthogonal to `T?`: adjacency gating means
  a spaced `?` correctly does NOT become optionality, it just falls into this older hole.

- **`expectDiagnostic` in the codegen harness could only ever match the CODE.** It built its
  diagnostic string from `String(m.message).split("\n").pop()` — the LAST line, which is usually
  empty. Asserting on message TEXT silently could not work. Fixed in D9e, which is the first phase
  that needed it (the point of `T? -> T` is that the message *says* `String?`).

- **`if` / `when` / `cond` as a CALL ARGUMENT emit invalid JavaScript** (LL0101). A `let` initializer
  is an expression context and a call argument is not, so `(console.log (when false 1))` emits
  `console.log(if (false) {…`. `(let v (when false 1))` is fine. A P5 leftover — loud rather than
  silent, which is why it waited.

- **`set?` cannot be spelled** in grammar_v2 at all: `Identifier` excludes `?`. It is a registered
  runtime symbol reachable only from the PEG. D9e makes `?` a type suffix, which settles it — but the
  Lisp `foo?` predicate convention is foreclosed by that, deliberately, and nothing in the corpus used
  it (zero `?`-suffixed identifiers in live code).

- **`(new)` with no class name emits a bottom value** instead of a diagnostic. It is a malformed form
  and should be refused.

- ~~**`:comptime` is accepted and IGNORED.**~~ **RETRACTED — this was false.**

  I wrote, in P5d and here, that `:comptime` is silently ignored and that its two tests evaluate at
  run time. **Both claims are wrong.** `:comptime` *folds*, and always has:

  ```
  (let :comptime x (+ 10 20))     ->  const x = 30;
  (fn :comptime factorial [n] …)  ->  DELETED -- not present in the emitted JS at all
  (let fact5 (factorial 5))       ->  const fact5 = 120;
  ```

  `ComptimeEvaluationAstVisitor` — a real partial evaluator running a `node:vm` sandbox — is wired
  into the desugar stage at `Context.ts:326`. I never looked for it. The reasoning that led me astray
  was sound as far as it went (the goldens assert only *values*, so they genuinely cannot distinguish
  a fold from a run) and then I asserted the conclusion I expected instead of reading the output. The
  emitted JavaScript settles it in one line.

  The P5d *fix* was real — `:comptime` is a **built-in** modifier, and codegen was wrapping it in a
  call to a `__ll_modifier_comptime` transformer that does not exist, which is why those two tests
  were erroring. My *explanation* of the fix was not.

  What `:comptime` actually needs is narrower, and is D3's business: its sandbox hand-rolls ~10
  operators, and `evaluateExpression` **catches every failure and returns `undefined`** — so a
  `:comptime` variable that cannot be folded raises `LL0099` (correct), while a `:comptime` *call*
  that cannot be folded degrades **silently** to run time. That is the "silently degrades" class,
  and it is what the phase should kill.

- **`eval` / a runtime AST interpreter does not exist.** `RuntimeProvider` registers `"eval": ""`, so
  `(eval x)` falls through to host JavaScript's `eval`. Quote is now code-as-DATA; executing a quoted
  form is code-as-CODE, and needs a second evaluator — at run time this time, on top of the
  compile-time one `:comptime` already has. `01_quoting.lisp` wants it.

- **Quasiquote / unquote do not exist.** `QuoteNode.mode` is written by both parsers, declared nowhere
  and read nowhere; the PEG's `Unquoted` rule matches *whitespace* and is referenced by zero rules.

- **An `if` as the last body item still loses its implicit return.** P8c fixed the parenthesized-block
  case; a trailing `if` emits an `IfStatement`, which `withTrailingReturn` leaves alone by design. The
  corpus writes `(return …)` in both branches. Whether an `if` should be an expression in tail position
  is a ruling, not a bug.

- **`fn` parameter defaults are unrepresentable.** `ast.ParameterNode` has no default slot at all, so
  `(fn f [x 5])` is not merely unemitted. Grammar + AST + codegen. The `AssignmentPattern` support
  P5b added to the class builder is what it will need.

- **String keys in map literals do not parse.** `{"host" "localhost"}` — the `keyValue` rule requires
  a leading colon. This, not codegen, is what actually blocks `04-data-types/02_maps.lisp`; its old
  xfail reason ("D13: map-key codegen crash") was stale, and D13's codegen half is now fixed.

- **The numeric tower (D8).** `octal-number`, `binary-number`, `hex-number`, `fraction-number`,
  `complex-number` all lex but have no emitter — five latent `LL0100`s. None appear in the corpus.

- **`:ctor` defaults are dropped by codegen.** `(defclass Vec (let :ctor x <- Int 7))` emits
  `constructor(x) { this.x = x; }` — no default — so `(new Vec)` leaves `x` undefined. The *type*
  side was fixed in Phase 3 (`hasDefault` was computing `null !== undefined`, i.e. always true); the
  *codegen* side never reads it. **P5.**
## LL0210 — an identifier that resolves to nothing

**Armed.** A call to an undefined function no longer "silently degrades" into JavaScript that throws
if the line is reached; it is a compile error. Reference position only — an identifier is checked
where it is READ, never where it is BOUND.

Two structural notes, because both were false-positive sources and both are easy to reintroduce:

- **Call heads are checked in the list-dispatch, not in `inferExpressionType`'s identifier case.**
  A call head never passes through it — the dispatch reads `funcName` directly.
- **Resolution goes through the CONTEXT's symbol table, not the pass's own.** The type pass is handed
  the MODULE's table, which holds only that module's scopes. Imports are joined into the context's
  table, and that is also what codegen resolves against. Asking the module-local table alone flags
  every imported symbol — `log`, `print`, `double` — as undefined.

Exempt: map/enum keys, operators, special forms, JS globals, runtime-provider references. A member
expression asserts only that its HEAD exists — `s.indexOf` is a question about `s`.

Map and enum keys are matched by `_location.start.offset`, **not by node identity**: the type pass
runs on the DESUGARED tree while `_parent` still points into the pre-desugar one.

### `visitList`: a list headed by an identifier is a call, not a block

`visitList` applied that test to each ITEM but not to the list ITSELF, so a call was only inferred
when it arrived WRAPPED in an enclosing block. True at statement level; false for the
single-expression body of every control-flow form — a `for :then` body, a match arm. Those were
walked as blocks, so the callee was visited as a statement and the call was never inferred at all.
Arity and argument checks now reach loop and match bodies for the first time.

Special forms are excluded: they are headed by an identifier and are not calls. Typing `(return x)`
as a call to a function named `return` yields Unknown, and a `return` that infers as Unknown stops
the enclosing function's return type from propagating.

## Open findings

- **`:ctor` defaults are dropped by codegen.** `(defclass Vec (let :ctor x <- Int 7))` emits
  `constructor(x) { this.x = x; }` — no default — so `(new Vec)` leaves `x` undefined. The *type*
  side was fixed in Phase 3 (`hasDefault` was computing `null !== undefined`, i.e. always true); the
  *codegen* side never reads it. **P5.**

- **Generic constraints are not real.** PEG parses `:where T :of Comparable` into broken plumbing
  (`{where, ...constraints}` spreads an array into an object, giving numeric keys; `Class` then reads
  a `c.clause` that is never produced). grammar_v2 has no constraint rule at all. And
  `13_generic_constraints.lisp` does not actually use constraint syntax — nothing in the corpus
  exercises it. Its own phase.

- **`(fn f<T> [...])` — function-level type parameters are unparseable.** `FunctionNode.generics` is
  never populated by either frontend, so only classes and interfaces have a generics slot that is
  filled. P7 binds them where they are converted, so the code is correct and inert; making them
  *parseable* is a grammar change.

- **Generic INSTANTIATION is not inferred.** `(let c (Container 42))` does not deduce
  `Container<Int>`; the constructor's bare `T` simply accepts the `Int`. Variance and subtyping are
  checked, but a type ARGUMENT is never inferred from a call. That is the deliberate boundary of P7.

- **A generic PARENT drops its arguments.** `:extends Container<Int>` records `parentClass` as the
  bare name `Container`; only `:implements` keeps its type arguments. Subtyping through a generic
  base class therefore compares no arguments.
