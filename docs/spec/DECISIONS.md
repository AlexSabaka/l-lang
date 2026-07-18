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

**Ruling (amended by Xe):** `(obj.m)` is decided by the **TYPE** of `obj` — a **method** is called, a
**field** is read. Where the type is not known, it is decided at **run time**, by `__ll_member`. It is
never decided by a list of names.

### The original ruling, and why it did not survive contact

> ~~`(obj.m)` is **always** a call. Bare `obj.m` (no parens) is the only property read. This ruling
> needs no type information at codegen time and deletes the blacklist entirely.~~

**Measured: it breaks 9 corpus files.** `(arr.length)`, `(err.message)`, `(this.name)` — 33 sites —
all mean a *read*, and "always a call" emits `arr.length()`. The rule is simple and uniform and it is
not the rule this language actually has.

### What the blacklist really was

`knownPropertyNames`, 30 entries, consulted whenever `isMethodOnType` said "not a method". Its own
comments give it away:

```js
// Balance and other state properties
'balance', 'age', 'score', 'status', 'state',
// Animal/entity properties
'breed', 'species', 'color', 'weight'
```

Those are not a JavaScript surface. **They are user class field names, lifted out of `examples/` and
hardcoded into the compiler** — someone hit the bug in the inheritance demo and added `breed`. So:

```lisp
(defclass Dog (let :ctor breed) (let :ctor nickname) ...)

(this.breed)      ;; -> this.breed        `breed` is in the list
(this.nickname)   ;; -> this.nickname()   TypeError. It is not.
```

Two fields of the same class, declared identically. **Whether your field worked depended on whether
its name appeared in an array inside the compiler.**

And the type already knew: `methodSignatures` holds the methods, `members` holds them *and the fields,
with their types*. Nothing had to be discovered — only **asked**. `memberKindOn` asks.

### Why the residual list could not just be shrunk to "the JS bits"

That was the plan. Then the sites still reaching the fallback were counted, and they are not only
`s.toUpperCase` and `err.message` — they are `v3.x`, `user.age`, `final-account.balance`: **ordinary
user fields whose receiver type the checker cannot yet infer** (the standing *"114 list nodes have no
entry in the type channel"* gap). A residual list would have had to contain `x`, `y`, `balance`, `age`
— which is *exactly how the original one came to contain them*. A name list can never be right here.

So where the compiler does not know, it no longer guesses: `__ll_member(obj, "m")` calls a method and
reads anything else. The answer was always available — at run time, exactly. Guessing at compile time
was never *necessary*; it was only *earlier*. And the shim shrinks on its own: every receiver the
checker learns to type stops reaching it and goes back to a direct `.x` or `.m()`.

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

> **Superseded in part by [D42](#d42--types-are-nominal-interfaces-are-structural-the-go-model-sub-phases-zfzg).**
> "Full structural typing" now holds for **interfaces only**; classes and structs are **nominal**. P7d
> shipped nominal without ever citing or overruling this ruling, and the contradiction sat unresolved
> for the whole of the intervening work — D42 is where the two were reconciled rather than one quietly
> winning. The "→ Phase 8" pointer below is **dangling**: Phase 8 ≠ P8, and that phase never ran.

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

> **Activated in Phase Z / Zl (LL0233), and extended to parameters.** The ruling above was parked in
> P8 with an in-code marker ("D10 is explicitly P8. Not smuggled in here"), so for the whole
> intervening time the only enforcement was the `let`→`const` accident — a runtime `TypeError` on the
> JS backend and *nothing at all* anywhere else. `mutability` is now read: reassigning an immutable
> binding is a compile-time error.
>
> **A plain parameter is immutable too** — bound once, like a `let`, like Rust. `(fn f [p] (p := 1))`
> is an error; a mutable copy (`(mut p2 p)`) or a `:ref`/`:out` parameter is the way to rebind. This
> goes beyond the original ruling's `let`-only wording, and is a deliberate choice: a parameter is a
> binding, and the language has one rule for bindings. The stdlib's own `print` reassigned its `msg`
> parameter to interpolate `{index}` placeholders — rewritten to a `mut` local, which is exactly the
> discipline the rule asks for.
>
> **The check is about the BINDING, never what it points at.** `x.field := v` and `x[i] := v` mutate
> the object `x` refers to and stay legal on a `let`-bound value — the games' undo/snapshot code
> depends on it. Only a bare-identifier target (`x := v`) is a rebinding.

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

**`:else` was ruled here and never built (fixed in Ye).** For over a year `(cond ... (:else e))` was a
parse error — `ElseModKw` existed and was consumed by the `if`/`when` and `for` rules, and `condCase`
had simply never referenced it. The corpus routed around the gap in silence, writing
`(true (return "F"))` with a `;; Default case` comment beside it: the comment existed *because* the
code could not say what it meant. A ruling nobody implemented and nobody noticed was unimplemented,
because the workaround reads almost as well.

`:else` is **sugar for a `true` condition**, which is what `(true …)` already was — an ordinary clause
whose condition happens to be the literal true. The AST builder gives the `:else` clause a `true`
condition, so codegen, the checker and every golden see one shape: re-authoring
`13_flow_cond.lisp` to `:else` moved **no golden**, which is the proof. `(true …)` therefore keeps
working, and must: this ruling names the default's SPELLING, it does not forbid writing the condition
out.

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

## Operators — language, not library

**`SYMBOL_MAP` was two different things wearing one coat**, and the conflation was a live bug:

| | | fate |
|---|---|---|
| `+ - * / % ! == != ≠ < > <= >= && \|\|` | **language operators.** Not names. Cannot be shadowed, imported or redefined — only **overloaded**, via `:operator`. | stay in the compiler forever |
| `get head tail empty elem cons list call eval type set! set?` | **proto-stdlib functions.** Ordinary, user-definable, **importable** names. | **the D7 worklist** — what a real stdlib replaces, so JS interop lives behind a library boundary rather than inside the code generator |

The two need **opposite** treatment, and nothing could tell them apart. `visitIdentifier` checks import
*before* runtime — which is **exactly right** for the library half (an imported `head` *should* shadow
the builtin) and nonsense for the operator half. So an imported `(fn :operator + …)` was resolved as an
ordinary imported symbol and **inlined**; re-visiting its own body, `(+ a.amount b.amount)` — adding two
Ints — hit the same memo key and compiled to **a call to the function currently being defined**. It
crashed, and the `+` shim was never emitted at all.

> Guarding on `isRuntimeReference` is the obvious fix and is a **landmine**: it would silently shadow an
> imported user `head` with the runtime one. One silent wrong answer traded for another, passing the
> suite today and biting later. `isOperatorSymbol` is narrow by construction — those names cannot be
> user identifiers, so guarding on them cannot capture anything a program meant as its own.

### Three things that were only visible once the one before was fixed

1. **The registration condition asked where the VISITOR was, not what the NODE was** —
   `scope.length === 2 && scope[1] === program`. An imported operator is visited from its call site, so
   the test failed and `:operator` was silently ignored.
2. **An imported operator is never referenced BY NAME.** `(+ a b)` means the shim, and the shim finds
   the overload by *dispatch* — so on-demand inlining had nothing to trigger it and the definition
   simply did not exist. (Invisible before: the old bug dragged it in *as a side effect of miscompiling
   it*.)
3. **`__ll_is_type` compares `constructor.name`, and the inliner RENAMES classes.** Right for the
   *binding*, wrong for the *type*: an overload registered on `["Money","Money"]` could never match an
   **imported** Money. Classes now carry `static __ll_name` — the source name, immune to the rename.

### LL0208 — the two ways to declare an operator

```lisp
;; inside a type -- ONE parameter. `this` IS the left operand. (Or NONE, for a unary operator.)
(fn :operator + [other <- C] -> C ...)
(fn :operator - []           -> C ...)

;; at top level -- TWO parameters. Registered in __ll_op_registry.
(fn :operator + [a <- C b <- C] -> C ...)
```

A **two-param METHOD** was a third form that compiled, emitted `+_2`, and was **never called** — the
shim probes `+_1` (binary) and `+_0` (unary). Silently dead code. It is *refused*, not made to work:
`this` is bound and meaningless inside it, and which of the three names is the left operand is anybody's
guess. (The arity suffix cannot simply be dropped — `08_operators` declares both `- [other]` and `- []`,
which would collide on one JS key.)

### `+=` had always MEANT `x = x + y`. It just did not compile to it.

`visitCompoundAssignment` emitted raw JS `x += y`, which never touches the `+` shim — so it never
reaches the registry or an `_1` method, and a user **overload is never found**. The **type checker
already modelled it correctly** (its own comment reads *"x += y means x = x + y"*). The two halves of
the compiler disagreed about what `+=` means, and the type checker was right.

## D11 — the class surface

**Two of this ruling's own claims were wrong**, and both are recorded here rather than quietly fixed.

### `:private` was a silent wrong answer (D11b, D11c)

```lisp
(defclass Counter (let :private count 0)
  (fn bump [] -> Int (this.count := (+ this.count 1)) (return this.count)))
(c.bump) (c.bump)      ;; -> NaN, NaN.  Zero diagnostics.
```

A `:private` field was emitted as a JS private field, `#count = 0` — and **nothing else in the
compiler had ever heard of `#`**. Every read and write goes through `visitCompositeIdentifier`, which
emits a plain `this.count`. Two declaration-side sites decided privacy; the entire reference side
never found out. The `#` slot kept its initializer forever and `this.count` was `undefined`.

**Erasure is the ruling, and the only coherent option.** `#` is a *runtime* enforcement mechanism;
D11 puts enforcement in the **type checker** (LL0206), where it produces a located error instead of a
wrong number. Without LL0206, erasing the `#` would have been a pure downgrade — swapping a wrong
answer for no enforcement at all.

**Privacy is per-CLASS, not per-instance** (the C#/Java/TypeScript rule): a `Vault` method may read
another `Vault`'s private field.

### The `:static` claim is REFUTED, and the real bug is the inverse

The ruling says *"`:static` is hardcoded `false` in codegen while reflection reports `isStatic: true`"*.
It reports no such thing. Codegen *did* hardcode it — but **reflection reported every `:private` field
as `isPublic: true`**, so codegen called a field private (emitting `#secret`) while reflection called
it public.

Cause: seven comparisons of the form `mod === ':private'` — **with a colon** — against a value both
parsers strip it from. All seven were **dead**, so `visibility`, `isStatic`, `isConstructorParam` and
`isOperator` never left their defaults. The one line in the same loop that *did* work
(`modifiers.add(mod.replace(':', ''))`) stripped defensively — which is precisely what kept the bug
invisible.

Only **two** of the three hardcoded `static: false` were bugs. The third is the **constructor**, where
`false` is correct by construction; "fixing" it would emit `static constructor()`, which is not
JavaScript.

### `defstruct` had no class surface — four gaps, not one (D11d)

`(defstruct Rect :implements Shape …)` was the **last ERROR in the suite**. Fixing the grammar alone
would have fixed nothing:

1. **grammar_v2** refused it — `:implements` is its own token, so `MANY(modifier)` could never eat it.
2. **The PEG parsed it** and dumped the clause into the struct **body** as two junk bare identifiers.
   The interface was forgotten, nothing enforced it, and the program ran. **The loud frontend was the
   correct one** — and the golden, recorded under that silent misparse, asserted that the struct
   implements nothing.
3. **`isSubtype` walks `implementedInterfaces`**, and a struct's type never had one — so a struct
   could never satisfy an interface even once the clause parsed.
4. **`getAllClassMetadata()` requires `codegenMetadata`**, which a struct never got — so `(type p)`
   fell through to a runtime constructor-name guess and answered `kind: 'object'`.

### `:inherits` was never accepted by the compiler

`(defclass Dog :inherits Animal)` is a **parse error**. `:inherits` exists only inside a generic
constraint (`:where T :inherits Base`). The grammar has always agreed with D11 — it was the README and
the reference doc that taught the wrong word, and they are corrected.

### `defstruct` by-copy value semantics — SHIPPED

**A struct is copied when it moves; a class is shared.** `visitStruct` was literally `return
this.visitClass(node)`, so `(mut b a) (b.x := 99)` silently changed `a`.

**A copy is MEMBERWISE, recursing into struct-typed fields; reference types are SHARED** (arrays,
maps, class instances). The C# rule, and what a native struct lowers to: the struct's own storage is
copied, and a field holding a pointer copies the pointer.

> **The corpus could not see this phase, and could not see the way it would go wrong.** Every passing
> struct golden has **all-primitive fields**. A *shallow* copy gives correct value semantics for
> exactly that set and silently keeps aliasing everything else — it would have passed all 68 tests.
> The gate's nested-struct case is the only thing in the tree that can tell the two apart, and it was
> written before a line of the implementation.

**COPY-ON-ENTRY, not copy-on-call.** A parameter *prologue* (`p = __ll_copy(p)`) rather than a wrap
around every call argument. It is one site per *function* instead of N per *call site* — and it is the
only one that works at all for operators: the runtime shim routes `(+ c1 c2)` through `c1['+_1'](c2)`,
so the argument never passes through a call the code generator can see.

**`this` is never copied.** It is the receiver, not a parameter. It must not be: construct-mutate-return
is the corpus's only way to build a struct (~30 sites), and copying the receiver makes every one of
them silently return an unmutated value.

**The marker is `static __ll_struct = true`, intrinsic to the class.** Not `__ll_type_metadata` — which
already records `kind: 'struct'` and is the obvious choice — because it is conditional on
`includeRuntimeShim` *and* the import inliner **renames** structs (`class inlined_Vector3_7`), so any
name-keyed lookup silently misses **every imported struct**.

### LL0207 — a struct `:operator` may not mutate `this`

A struct is passed by value, so an operator receives copies. In C# an operator is `static` for exactly
this reason: `a * b` cannot mutate `a`. A mutating operator is not discouraged — it is **not coherent**.

And it does not merely fail; it **escapes**. The runtime routes `(* w 2)` to `w['*_1'](2)`, so `this`
*is* the caller's struct, and copy-on-entry cannot reach it because the receiver is not a parameter.
Build a new value and return it — which is what the whole corpus already does.

### Deferred (superseded): the original by-copy plan

Not a fix — a **from-scratch feature**, and its own phase. There is no clone helper, no value-type
marker, and codegen has **no per-node type information at all** (`typeEnv` is a dead local at
`Context.ts:345`; the per-node types are keyed into a scope stack that is popped during inference), so
it cannot answer "is this expression a struct?" for anything but a bare identifier. A runtime
`__ll_copy` shim sidesteps that. Shallow-vs-deep, whether `this` is a copy, and whether instances
freeze are all undecided and should be decided *up front*.

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

### The indexer is PARTIAL; `get` is TOTAL (D9f)

**`c[k]` asks for something that is THERE.** Absence is a bug, not a value, and a bug must be loud:
`xs[9999]` throws IndexOutOfRange, `m["absent"]` throws KeyError. **`(get c k)` is the total form** and
answers nil. One rule, both containers.

This closes the last hole in "non-nullable by default". `xs[i]` was typed `Int` and handed back
`undefined` for an out-of-range index — a bottom value straight through a type that promises there
isn't one. **The type system cannot be honest while the commonest expression in the language lies.**

Arrays and maps answer differently *on purpose*, and that asymmetry is what makes a second bottom
value unnecessary — which was the question that opened this ruling. An out-of-range **index** is a
defect (you computed it). An absent **key** is ordinary control flow ("is this configured?"). So:

> **absent → throws. present-but-nil → nil.** The `null`/`undefined` distinction survives, as *control
> flow* rather than as a second value nobody can tell apart.

A **write is unchecked**: `(m["k"] := 1)` on an absent key CREATES it. A read asserts the thing is
there; a write puts it there. A write that refused to create would make building a map impossible.

**This is what gives `T?` a PRODUCER.** `(get c k)`, `(elem xs i)` and `(head xs)` are typed `T?` —
before them, an optional could only ever arise where a programmer typed a `?` by hand, LL0205 would
have had nothing to catch, and the whole feature would have shipped inert while every test passed.

```lisp
(let xs <- Int[] [1 2 3])
(let a <- Int xs[0])         ;; Int   -- partial, and honest: it throws rather than lying
(let b <- Int (get xs 0))    ;; LL0200: cannot assign Int? to Int
(let c <- Int (head xs))     ;; LL0200 -- the lie DECISIONS.md:84 flagged, finally typed
```

**The corpus told us the ruling was right.** Every file that broke was a *memoizer*, and every one
broke on the same line — `(!= memo[n] nil)`, an ABSENCE CHECK written as an assertion that the thing
is present. That is precisely the confusion the partial/total split exists to end. They now ask
`(get memo n)`. Three are passing goldens whose output did **not** move.

### The unwrap is FORCED (D9g)

**LL0205** — a possibly-nil value, *used* as though it were not. This is the error the whole ruling
exists to produce. Everything before it made `T?` sayable, producible and unassignable-to-`T`; without
this, a program could still take an optional and dereference it.

It is a **dereference** check, not an assignability one. The assignability sites (`let`, argument,
`return`) already refuse `T? → T` and report LL0200/LL0203/LL0213 — a second code there would be a
second name for the same error. What had *no* check at all was **using** the thing: reading a member
off it, indexing into it, doing arithmetic with it. (`Int?` is still *named* `Int`, so `isNumeric` said
yes and `(+ h 1)` produced `"null1"` or `NaN` at run time.)

**Equality is exempt, and must be.** `(== h nil)` is how you *discharge* the obligation; if the check
itself were an error, the only way to satisfy LL0205 would be the one expression LL0205 forbids.

**Narrowing**, in two shapes, both syntactic and both deliberately small:

```lisp
(if (!= h nil) (h.length))            ;; narrowed inside the branch it proves
(if (== h nil) (return 0))            ;; narrowed for the REST of the block
(return h.length)                     ;;   <- h is a plain String here
```

There is no flow analysis in this compiler, and inventing one here would be a phase of its own (D5
owns narrowing proper). But **LL0205 without an escape hatch does not make `T?` unsafe — it makes it
unusable**, because the nil-check you just wrote would not be believed. The guard-and-return is the
shape the corpus actually writes; recognising only the branch form would have left the idiom people
reach for first unsupported.

**Two bugs found by building it:**

- **`bindIdentifier` does not bind into a scope.** It writes *through* to the symbol table, which is
  neither scoped nor reversible — so a narrowing bound with it survived `exitScope` and narrowed the
  name for the rest of the **program**. A nil-check believed everywhere is strictly worse than one
  believed nowhere: it reports nothing while proving nothing. The scope-local binding already existed
  (`bindTypeParameter`, which is how a generic `T` is bound) and is now `bindInScope`.
- **Call arguments were never type-inferred** when the callee could not be resolved. So `(let z
  h.length)` reported LL0205 while `(console.log h.length)` — the same expression — reported nothing,
  and `console.log` is most of the corpus's I/O. Inferring them *fully* is the right fix and is **not**
  this phase's: measured, it produces **16 new diagnostics on passing tests**, and none are nil bugs —
  they are LL0210 on locally-scoped names (symbol resolution is top-level-only; **P6**) and LL0211 on a
  headless member call. Shipping a false-positive flood under a nil-safety banner is the exact
  dishonesty this audit exists to stop. The arguments are visible to the **nil check and nothing else**
  until P6 lands.

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

- ~~`__ll_is_type` and the operator registry are keyed on `constructor.name`~~ — **FIXED.** Classes carry
  `static __ll_name`; `__ll_is_type` prefers it.
- ~~An `:operator` METHOD with two parameters is never called~~ — **FIXED**, by refusing it (LL0208).
- ~~DESTRUCTURING binds by reference~~ — **FIXED** (`__ll_copy_each` / `__ll_map_copy_each`).
- ~~An imported top-level operator crashes~~ — **FIXED.**
- ~~`a += b` never reaches the operator shim~~ — **FIXED.**

- **A compound assignment evaluates a side-effecting target TWICE.** `xs[f()] += 1` now calls `f()`
  twice, because `+=` desugars to `xs[f()] = (+ xs[f()] 1)`. Avoiding it needs a temporary, which needs
  statement context, which an assignment in expression position does not have.

- **An identifier beginning with TWO underscores does not lex.** `_foo` and `a_b` are fine; `__bar` is a
  parse error. `Underscore` is `/_(?![a-zA-Z0-9])/` and `_` is not in that lookahead class, so the first
  `_` of `__` matches the standalone-underscore token. One character to fix.

- **A method call on a PARENTHESISED expression emits invalid JavaScript** (LL0101). `((Dog).speak)`,
  `(type p).kind`. Loud, not silent. Bind to a `let` first.

- **`InferAndCheckPass.visitStruct` never visits the struct BODY** — it only resolves member types — so
  struct method bodies are not type-checked by that pass at all.

- **`(defstruct Box<T> …)` does not parse** in either frontend: a struct has no generics. Nothing in
  the corpus asks for one.

- **Reflection does not report a method's staticness.** `result.methods` is `{name, params, returns}`
  and `MethodSignature` has no `isStatic`. An omission, not a lie — but adding it would move two
  goldens, so it is a call, not a drive-by.

- **`getVisibility()` defaults to `internal`; the reflection path defaults to `public`.** Two
  different answers for an *unannotated* member, in one compiler. What the default should be is a
  language ruling — D11b deliberately left it alone rather than change it in passing.

- ~~**Call arguments are invisible to the type checker when the callee cannot be resolved.** Measured
  at **16 diagnostics**… Blocked on **P6**.~~ — **FIXED, and the diagnosis was wrong.** The guard is
  gone. P6 landed and the count was *still 16*: none of them were scope-resolution false positives.
  Seven were nested functions that no pass ever defined, three were enums that no pass ever defined,
  three were a pipeline the desugarer never desugared, and three were **true positives** whose golden
  had recorded the bug's output as the right answer. See *P6 (concluded)*.

- **`\"` inside a string literal is not unescaped** — it emits literally, so `"a \"b\" c"` prints
  `a \"b\" c`. Found while writing `21_nil_handling`; worked around, not fixed.

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

# P6 (concluded) — the checker could not see a local variable

The earlier addendum built the lexical resolver and migrated **codegen** onto it. The **type system**
was never migrated. This is that half, and it turned out not to be the phase the register described.

## The scope tree was fine. The lookup was not.

`resolveSymbol(name, from?)` already had two modes. With `from` it walks the real lexical chain, and
it works — including on the post-desugar AST, because `BaseAstTreeWalker` copies `_parent` **by
reference**, so one step up from a rewritten node lands back in the indexed tree. Without `from` it
searches a flat cache built from module **roots only**.

Four callers passed `from`; three of them were codegen. Everything in the type system asked the flat
question. Measured, on a two-line program:

```
root child scopes:  [ function:[p, loc] ]     <- the parameter and the local, correctly there

p      scopeOf -> function    lexical: FOUND      flat: NOT FOUND
loc    scopeOf -> function    lexical: FOUND      flat: NOT FOUND
outer  scopeOf -> program     lexical: FOUND      flat: FOUND
```

## It was not "the type is dropped". It was ALIASING.

`bindType(name, type)` resolved flat. A flat lookup does not *fail* for a local — it finds **the
top-level symbol of the same name** and writes the local's type onto **that**. So:

```lisp
(let x <- String "a")
(fn f [] -> Int (let x <- Int 5) (return x))
```

reported `LL0200 cannot assign Int to String` **and** `LL0213 'f' returns String`. The compiler
believed the local `x` *was* the outer `x` — for its declared type and its value type both.

Writes now go through a strict `resolveSymbolLexical`, **not** `resolveSymbol(name, from)`, whose
fall-through to the flat root union is right for a READ (other modules' symbols really do live in
other roots) and is exactly how a local's type lands on a homonym.

## Reads and writes are only observable together

This governs the whole sequence, and it is the phase's main hazard. Fix writes alone and reads still
go flat. Fix reads alone and the symbols they now find have no `inferredType`, because nothing bound
them. **Either one shipped alone is indistinguishable from doing nothing** — and because the
fall-through exists, *every* failure mode (a broken `_parent`, an unindexed scope, a wrong `from`)
degrades into precisely the old behaviour: silent, green, and doing nothing.

Hence the instrument, reported by `test:type-errors`:

```
types bound to the right symbol: 1428
types with nowhere to go        : 0     <- was 26, and all 26 were `this`
```

It caught itself immediately: the first reading was `0 hits, 0 misses`, which looks like a clean
no-op and was the counter asking the wrong table — the checker holds the MODULE's `SymbolTable` while
codegen holds the CONTEXT's joined one. It is static for that reason.

## What was actually broken

1. **Every inferred type for a non-top-level name was discarded, or aliased** (above).
2. **The read side is a different function and took no node.** `TypeEnvironment.resolveIdentifier`
   is where every identifier's type comes from.
3. **A nested annotation reached nobody.** `CollectTypesPass` never enters a function body, and
   `visitVariable` read the declared type **by name** rather than from `node.type`. So `(fn f []
   (let x <- Int "hello"))` was checked by nothing at all, and a class field's annotation never
   reached its symbol.
4. **`this` was not in the symbol table at all**, so binding it was a no-op before and after. It is
   not a program symbol; it is scope-local, which is what `bindInScope` is for.
5. **The checker could not see another module.** It was handed `moduleSymbols`, not the joined table
   — so an imported function had no type: no arity check, no argument check, and an imported class
   annotation degraded to Unknown. One word. `checkIdentifierResolves` had already been reaching past
   it by hand.

## The early-return nil guard had NEVER worked inside a function body

The narrowing loop lived in `visitList`, and a function body is not a list. So D9g's whole idiom

```lisp
(fn describe [c <- String?] -> String
    (if (== c nil) (return "empty"))
    (return (+ "holding: " c)))
```

was believed at top level and **nowhere else**. It read as working only because a parameter had no
type to narrow — `LL0205` could not fire, so there was nothing for the missing narrowing to be wrong
about. Two more layers sat under it: a body **wrapped in parens** is a different block, so the guard's
narrowing closed before `checkReturns` ran; and `checkReturns` **re-infers** every return from
scratch, so it now runs while the narrowings are open, or it judges the return against the declaration
rather than against what the guard proved.

And `nilGuard` accepted a **simple** identifier only, so `(if (== this.cache nil) …)` was not a guard
at all. Shipping optional fields without that means a field reported as possibly-nil that **cannot be
guarded** — the checker demanding a check it refuses to believe, which is the exact trap D9g exists to
avoid.

## LL0210's "16 false positives" were sixteen REAL BUGS

The `membersChecksOnly` guard suppressed every check except LL0205/LL0206 inside call arguments,
justified by a measured 16-diagnostic flood "blocked on P6". P6 landed. The count was **still 16**.
None of them were P6's. Each was its own bug:

| n | code | what it really was |
|---|---|---|
| 7 | LL0210 | **A nested function is defined by nobody.** `visitFunction` said *"already defined in ScanPass"* — and ScanPass only scans top-level. `visitVariable`, ten lines up, carries the identical correction for the identical reason. |
| 3 | LL0210 | **An enum is never defined as a symbol.** By anyone. Classes, structs, interfaces and aliases are; enums were left off the list. (And the head split had to learn `:` — the symbol in `HttpMethod:GET` is `HttpMethod`.) |
| 3 | LL0211 | **A pipeline is never desugared.** See below. |
| 3 | LL0203 | **True positives.** `08-types/00_primitives.lisp` says *"Shouldn't compile because of type mismatch"* — and compiled. Its golden recorded the results, `23` and `Help me!`, as though they were right: the file asserted the exact bug it was written to warn about. Split by ruling into a passing test plus `01_type_errors.lisp`, a `negative` test asserting the code. |

## THE DESUGARER IS NOT WIRED INTO THE COMPILER

`DesugarAstVisitor` owns `|>`. The "desugar stage" runs **TreeShake and Comptime and nothing else**.
So codegen desugars pipelines *itself*, and the type checker never sees the rewrite: it reads
`(account |> (.apply evt))` as a standalone call to the free function `apply`, which takes two
arguments. **The two halves of the compiler are reading different programs.** Contained here (a
pipeline types as Unknown; its stage arguments are still checked). The divergence is a phase of its
own.

## Rulings

- **An unannotated `nil` initializer is `T?` with an unknown payload.** `(mut cache nil)` bound `Nil`,
  so every later `(cache := "x")` was "cannot assign String to Nil". Assignable from anything, still
  optional — so D9's forced unwrap keeps applying. An annotation still wins outright.
- **A union with an unknown ALTERNATIVE cannot be judged.** `String | Number` — `Number` names no
  l-lang type — is `String | Unknown`, and we cannot know what that Unknown admits. Note it is `some`
  for a union where it is `every` for a generic: a generic is **narrowed** by each argument, so one
  known argument still says something; a union is **widened** by each alternative, so one unknown
  alternative says nothing.

## A gate case must isolate the axis it names

Four times this phase a case failed for a reason that was not the one it tested. Each would have
credited P6 with a bug it did not cause, or "fixed" something that was not broken:

- `(t.length)` — the CALL form of a member access never reaches `checkNotNil`. Fails identically for a
  top-level optional; never P6's.
- `(console.log (twice 1 2 3))` — a call **argument** is where `membersChecksOnly` ate LL0203/LL0211.
  The cross-module cases stayed red *after* the fix landed, for the guard's reason, not the bug's.
- `this.v.length` — the nil check reads only the **head** of a chain. Misses identically for a local
  base.
- `(let d (Dog))` — a class used before its declaration emits a **reference to the class**, not an
  instance, so the receiver was never a Dog.

## Open findings from P6

- **The desugarer is not in the pipeline** (above). The type checker and codegen see different trees.
- **A class used before its declaration does not construct.** `(Dog)` before `(defclass Dog …)` emits
  `__ll_copy(Dog)` — the class object. Codegen decides "is this a constructor call" from the classes
  it has visited *so far*. Silent. Same order-dependence as `isKnownFunction`.
- **Assigning to a `let` is not checked.** `(this.full-name := …)` on a `let` field compiles clean.
  `let` is a constant.
- **The nil check reads only the HEAD of a member chain**, and a call head never reaches it at all:
  `(t.length)` and `c.v.length` are both unchecked. Two pending cases in `test:type-errors`.
- **`test:type-errors` and `test:imports` are pinned to grammar_v2** with no `--frontend` flag, so
  "0 corpus diagnostics" is a grammar_v2-only claim.
- **`bindCompleteType` / `getCodegenMetadata` are dead** — zero callers.
- **LL0212 was implemented syntactically** to route around the flat table. It can now be real.
- **LL0211 does not know required-vs-total arity**, so `fn` parameter defaults will false-positive
  once they exist.

# One Tree, One Truth — the two halves of the compiler read the same program now

Three roadmap phases were ticked for code that was **written and never wired in**. Two of them were the
same bug, and it was a correctness bug: `DesugarAstVisitor` owns pipelines and implicit returns, and the
"desugar stage" ran TreeShake and Comptime and nothing else. **Codegen did both transforms itself, and
the type checker never saw the result.**

## The headline: an implicit return was enforced by nobody

```
(fn f [] -> Int (return "str"))   ->  LL0213     explicit: checked
(fn f [] -> Int "str")            ->  CLEAN      implicit: UNCHECKED
```

`checkReturns` walks the body for `(return e)` lists. An implicit return has none — codegen added it at
emit time. So a declared return type was enforced **only if you happened to write `return` yourself**.

The fix is not to teach the checker about implicit returns; that would be a *third* implementation of one
rule. It is to have one tree, so `checkReturns` sees the return **because it is there**.

## The desugarer was not "unwired". It was abandoned, incomplete, and wrong.

- **Its traversal reached three node types.** It dispatched on `(this as any)['visit' + Type]` — which is
  **always truthy**, because `BaseAstVisitor` declares a `visitX` for every node type in the language,
  each an `onUnhandled` no-op. Every type without an explicit rule dispatched to that no-op and **was
  never recursed into**. It reached `program`, `list`, `function` — so a pipeline inside a `let`, which is
  how the whole corpus writes them, was never seen.
- **The same dispatch bug was live in `ComptimeEvaluationAstVisitor`, which DOES run.** It never entered
  an `if` body, so a `:comptime` fold inside one silently did not happen — and the tree-shaker then
  deleted the function, *correctly*, because a `:comptime` function is supposed to be folded away.
  **`ReferenceError` at run time, zero diagnostics.** Two passes each doing their job, and a crash falling
  out between them.
- **Its pipeline transform had never produced a valid tree**: it folded `[seed, …args]` at every stage
  instead of threading `current` (a three-stage pipeline dropped the middle), and emitted the callee
  twice. Codegen's copy is correct and exercised by the corpus. **Codegen was the reference
  implementation**, and it is the one that moved.

## A rewriting visitor cannot use `BaseAstTreeWalker`'s walk

It dispatches and *then re-walks the original node's children and overwrites the result*. That is fine for
a pass that only READS (the analysis and type passes). A pass that REWRITES must own its recursion — and
must therefore be able to tell a real visitor from the inherited no-op. `overridesVisitor` does that.

## Two CORE nodes: `call` and `member`

The missing vocabulary was the root cause, not the missing wiring. A `list` is a call **only** when its
head is a name; an `indexer`'s base **must** be a name. So "call this *expression*" and "member of a
*computed* value" — which is exactly what a pipeline stage means — were **inexpressible in the AST**. The
desugarer had nothing to desugar *into*. (The same gap is user-visible: `((fn [x] (* x 2)) 21)` does not
compile.)

## Rulings

- **D17 — `(x |> (.m a))` is a METHOD call**, `x.m(a)`. It used to compile to the *free* call `m(x, a)`:
  codegen's member test was `simple-identifier && id.startsWith(".")`, while the parser produces a
  headless `composite-identifier` whose `id` has no leading dot. **Doubly dead; it had never once
  fired.** `05_matching.lisp` only worked because it defines `(fn apply [acc e] (acc.apply e))` **by
  hand** — a free function whose entire job is to undo the mis-desugaring. Written without that shim, a
  member pipeline reported `LL0210: 'add' is not defined` on a method that plainly exists. Exactly one
  file's emission changed, and **its golden passed unchanged** — the proof that the two forms were always
  supposed to mean the same thing.

- **D18 — a trailing `if` YIELDS A VALUE.** The return goes on each branch. Codegen's rule was the
  opposite ("nothing to convert. Leave it; the block's value is undefined"). It is **forced, not chosen**:
  `10_comptime.lisp`'s factorial gets its only value from a trailing `if` and folded to `null` without it.
  The language already depended on this — codegen simply disagreed with the desugarer, and comptime
  silently relied on the desugarer's answer.

## BLOCKER A — the memo cache was keyed on a SOURCE SPAN

`TypeEnvironment` keyed its memo on `${_type}_${start}_${end}`. That is not a key; it is a collision
waiting for a desugarer. A synthesized node legitimately carries the location of the node it wraps, so
`(return e)` and `e` hash to the **same string** whenever they share a `_type` — which is exactly when `e`
is a **call**, the common implicit return. The return typed `Unknown` first, `checkReturns` read the
poisoned entry, and gave up.

```
implicit "str" tail  ->  LL0213    literal: different _type, no collision
implicit (g)   tail  ->  CLEAN     call: COLLIDES -- the check silently dies
```

**A gate written with a literal would have passed while every call-tail check was dead.** Identity-keyed
now. Two distinct nodes are two distinct nodes, whatever they point at in the source.

## `symbol.value` IS THE PRE-DESUGAR TREE — three bugs, one shape

The symbol table is built *before* the desugar stage, so anything emitting from `symbol.value` has never
seen the desugarer.

- **The inliner** emits imported functions and classes straight from it:
  `const __ll_inlined_sqrt_1 = x => { Math.sqrt(x) };` — returns **undefined**. Codegen had been hiding
  this by injecting the implicit return at *emit* time, so the inlined copy got one for free.
- **Comptime** desugars `symbol.value` before handing it to the sandbox — and always has, for exactly this
  reason. Switch it off and `(factorial 5)` folds to `null`.
- **A LAMBDA is a value; a named `fn` DECLARATION is not.** The old desugarer excluded `function` outright
  — and never ran, so nobody found out. Turning it on swallowed the return of every `defmodifier`, whose
  body **is** a trailing lambda: the wrapper it hands back. `TypeError: add is not a function`.

## The TYPE CHANNEL — there was nothing behind the door

`Context.ts` assigned `typeEnv` and never read it. But `TypeEnvironment.setType` writes into a **scope
frame**, and `exitScope` pops it — so every type the pass inferred was **gone when the pass ended**. It
was a memo, not a channel. The channel had to be *built*: an identity-keyed `Map<ASTNode, InferredType>`,
never scoped, never popped.

```
codegen asked "could this be a struct?"    : 537
  ...the channel HAD a type                : 377   (70%)
  ...and the type PROVED it is not a struct: 138   -> copy elided
```

**The asymmetry is the design.** A type proving NOT-a-struct elides the copy; **no type says nothing**,
and the copy stays. Gradual typing means the channel is often empty, and an empty channel must never read
as "not a struct" — that turns a missing type into an **aliasing bug**, the exact class D11 exists to
kill. Both directions are pinned by tests.

**The estimate was wrong and is recorded as wrong.** The plan predicted 353 elidable (61%), from counting
`__ll_copy` in files declaring no `defstruct` — which quietly assumes a type exists for every node. It does
not: **114 `list` nodes have no channel entry at all**, because the checker never inferred them. The honest
number is 138.

## `__ll_match_list` / `__ll_match_struct` — deleted

Emitted into every program, called by nothing, and unreachable **by construction**: they speak a protocol
where a pattern is a runtime value carrying `{type, __is_type_check}` sentinels, and `__is_type_check`
appeared exactly twice in the compiler — on the two lines *inside them* that read it. Their only callers
were each other. They also could never have been the matcher: they return a boolean and **cannot bind a
name**, while every non-trivial l-lang pattern binds. Codegen compiles patterns inline, emitting
`(n = tmp["name"], true)` — bind and test in one comma expression. **`__ll_is_type` stays**: it is live,
called by `__ll_op_registry.lookup`.

## Open findings from this phase

- **The type checker does not infer every expression.** 114 `list` nodes had no entry in the type channel.
  This caps what codegen can prove, and is the reason the copy elision came in at 138 rather than 353.
- **The call-vs-block rule is implemented THREE times** — codegen's `visitList`, the checker's
  `blockItems`, and now the desugarer's `isBlockList`.
- **`03_matching.lisp`'s golden BAKES IN a silent wrong answer.** `(< _ 0)` — a guard-shaped list pattern —
  parses as a 3-element array *destructure* and falls through to `_`; the golden asserts
  `how da fck are you still alive?`. **A passing test that asserts the bug.** `_3c` (encoded `<`) is also
  emitted as an implicit global — a `ReferenceError` under strict mode.
- **`:is` is not a grammar rule at all** (the keyword is `:of`) — the real cause of the
  `05_pattern_matching` xfail. And `type-pattern`, `rest-pattern` and `functional-pattern` all compile to
  literal `false`.
- **`((fn [x] …) 21)` does not compile** (LL0101). The AST can represent it now (`call`); the grammar
  cannot parse it.
- **`(|> a b c)`** — the prefix pipeline form, used in `W99` — is garbage in both implementations.
- **No ambient-global declaration.** The p5 bindings reference `mouseX`, `mouseY`, `frameCount`, which are
  browser globals the language has no way to declare.

---

# Phase S — the stdlib has three heads, and they disagree

Roadmap Phase 4 / **D7 — "Hide the JS"**. Before writing a single stdlib function, this phase
inventoried what the language *already implicitly promises*. The promise turned out to be made three
times, by three mechanisms, that contradict each other. The full inventory and the worklist are in
**[`STDLIB.md`](./STDLIB.md)**; this section is the rulings and the evidence.

## The three heads

| # | Mechanism | Size | What it actually is |
|---|---|---|---|
| 1 | `RuntimeProvider.SYMBOL_MAP` (library half) | 12 fns | Injected into every program **as text**. `get head tail empty elem cons list call eval type set! set?`. Not importable, not typed. `eval` is literally the empty string. |
| 2 | `InferTypesAstVisitor.JS_GLOBALS` | 30 names | A hardcoded allowlist in the **type checker** that waves raw JS through **untyped**. Not a stdlib — **a hole in the type system**. `console.log` goes through it **579 times**. |
| 3 | `examples/20-stdlib/std/*.lisp` | 6 modules, ~290 lines | Real l-lang. **Compiled, never executed** (`status: "library"`). Its driver is `xfail` and calls `length`, `first`, `last`, `at` — **four functions that exist nowhere**. |

Head 3 was written against a stdlib nobody built, and nothing ever found out, because nothing ever
ran it. It also `deftype`s `Number` **twice** — in `types.lisp` and again in `math.lisp`, *which
imports `types.lisp`* — and exports `Vector3` but not `Complex`, which `complex_math_test` uses
anyway.

## `(export …)` IS DECORATIVE — the module boundary does not exist

A module defining `public-fn` and `secret-fn`, exporting **only** `public-fn`; an importer calling
**both**. It compiles clean and prints both. Zero diagnostics.

- `BuildSymbolTableAstVisitor.visitExport` records the list onto `SymbolEntry.exportName`.
  **`exportName` has zero readers** — five hits in all of `src/`: one declaration, three `undefined`
  initializers, and that single write.
- `SymbolTable.join` splices **all** of an imported module's root scopes in, unfiltered.
- `JSTransformerAstVisitor.isImportedSymbol` — the gate deciding what gets inlined — tests only
  *"declared in another file"* + *"declared at module top level"*. **It conflates top-level with
  exported**; its own comment calls a root-scope symbol "its export".
- **`InlineImportsAstVisitor` is the one pass that DOES honour the export list** — it builds an
  `exportedSymbols` set and filters against it. It is **commented out** in `Context.ts`.

> **The fourth "written and never wired in"** — after the desugarer, the runtime matchers, and the
> type channel. The pattern is now the most reliable predictor of where a bug lives in this
> compiler. The question to ask of a claimed feature is not *"is it implemented?"* but
> **"who calls it?"**

**Also parsed and dropped:** `ImportDefinition.symbols`. A selective import — `(import { a } from
"x.lisp")` — is built by the AST builder and read by nobody. It behaves **identically** to a
whole-module import.

**Blast radius, measured** (mirroring `isImportedSymbol` exactly, then asking whether `exportName`
is set): **46 legitimate** cross-module references, **9 leaked**, in **2 files** — and every leak is
the stdlib leaking into itself (`std/math.lisp`'s unexported `abs min max pow ceil floor round inc`,
plus `Complex`). **Enforcing the boundary costs one export list.** That is the number Sb is planned
against, and it is the difference between a scary phase and a cheap one.

## There is no resolver, and no error path

Import resolution is one line — `path.resolve(dirname(importer), literal)`. No search path, no
module root, no extension inference. **A missing import is a raw Node `ENOENT`, not a diagnostic.**
`std/` resolves only because the importing file happens to sit one directory above it.

## Rulings

- **D19 — the stdlib is a LIBRARY, not a compiler feature.** It lives in **`lib/std/`**, ships with
  the compiler, and resolves **by name**: `(import "std/math")`. Relative imports keep working.
  Heads 1 and 2 are **holes to be closed, not APIs to be kept**.
- **D20 — `export` is the module boundary.** An unexported top-level symbol is **module-private**;
  naming it from another module is a diagnostic. A selective import binds **only** what it names. An
  unresolvable import is a diagnostic, not an `ENOENT`.
- **D21 — naming: kebab-case, `is-x` predicates.** This is what the corpus already does, **10 of
  10**. Scheme spellings (`nil?`, `set!`) are **rejected** — including the ones the runtime shim
  itself uses. A module that is a *direct cstd binding* may **additionally** expose the C name as an
  alias (`strlen` beside `string-length`), so the Phase 7 binding is mechanical rather than a
  translation.
- **D22 — the layout mirrors cstd headers; the signatures stay l-lang.** Each module declares the
  header it binds to. Signatures use l-lang types (`T?`, `Int`, `String`) — no `char*`, no
  errno-returns. Phase 7 binds **header-by-header**, not function-by-function.

  ```
  std/core   <- (the language)  head tail cons list get elem empty
  std/io     <- stdio.h         print println read-line open close
  std/math   <- math.h          sqrt sin cos tan pow floor ceil abs min max E PI
  std/string <- string.h        string-length substr split join trim starts-with
  std/char   <- ctype.h         is-alpha is-digit is-space upcase downcase
  std/time   <- time.h          now clock sleep
  std/os     <- unistd.h        args env exit
  std/seq    <- (none)          map filter reduce zip range      [pure l-lang]
  std/fn     <- (none)          identity compose partial constantly
  ```

**D22 ratifies a drift rather than imposing a shape.** The corpus had already wandered toward cstd
without anyone deciding to: `math.lisp` is already ≈ `math.h`; `strings.lisp` already uses the
literal C names `strlen` and `substr`; and `io.lisp`'s `print`, with its `{0}` placeholders, **is a
`printf`**. That is the cheapest possible grounding for a native stdlib.

## The harness was hiding its own subject

`test:type-errors` counts corpus diagnostics **only on `status: "test"` files**. `library` and
`xfail` are excluded *from the count entirely*. The "0 corpus diagnostics" claim standing since P6
is a claim about **test** files; the true total is **115, across 6 files**.

The whole `std/` tree is marked `library` — **compiled, never run**. That is exactly why a stdlib
calling four nonexistent functions, defining `Number` twice, and leaking nine unexported symbols has
sat in the tree, green, the entire time. **A test that is compiled but never executed asserts
nothing.**

## Open findings from this phase

- **`eval` is the empty string** in `SYMBOL_MAP`. `(eval x)` falls through to host JS. A real `eval`
  needs a runtime AST interpreter — a phase of its own, not a stdlib module.
- **Quasiquote / unquote do not exist.**
- **Namespace imports** (`import foo.bar`) parse, then dead-end on *"not supported yet"*. Either
  implement them or delete the grammar rule.
- **`functional.lisp` exports `apply`** — colliding with D17's `.apply` method call, which is the
  exact collision `05_matching.lisp` hand-rolled a workaround for. A stdlib name can shadow a method
  dispatch, and nothing warns.

## Sb — `export` means something (LL0215)

`SymbolEntry.exportName` had one writer and **zero readers**. It has a reader now, and the module
boundary exists: **LL0215**, *"'X' is defined in 'Y' but is not exported."*

**A private symbol stays RESOLVABLE and is refused by name.** Hiding it instead — filtering it out of
the symbol table — would have reported `'secret-fn' is not defined` about a function that plainly IS
defined, in a file the programmer is looking at. "Resolves" and "is visible" are different questions,
and the fix is to *ask the second one*, not to corrupt the answer to the first.

### `resolveSymbol` could not be the choke point

The obvious design — filter the cross-module fall-through inside `SymbolTable.resolveSymbol` — is a
fix that only *looks* airtight. That fall-through can judge visibility only if it knows who is
asking, i.e. only if the caller passed `from`. **Measured: almost nobody does.** Type references,
`extends`, `new`, and most of codegen call `resolveSymbol(name)` bare. It would have enforced D20 at
exactly one door and been silently permissive at the rest.

So the rule lives in **one** static predicate (`SymbolTable.isVisibleFrom`) applied at named doors,
each of which knows the asking file by other means — for the checker, `node._location.source`, which
is free everywhere and is **per-node rather than per-pass**, so it stays right no matter which module
is being processed.

The comment already sitting on that fall-through stated the bug out loud: it is *"where symbols from
OTHER modules live, and they are **legitimately visible** here."*

### THE HALF-FIX: `new` is a door, and it is the only one the corpus used

`checkIdentifierResolves` is the obvious place, and **it is not enough**. Two doors bypass it, and
both were found by writing the gate before the fix:

1. **`new`** routes to `inferNewExpression`, which returns Unknown on a miss. The *only* leaked
   reference in `20-stdlib/complex_math_test/main.lisp` — **a live golden test**, not an xfail — is
   `Complex`, and it appears solely as `(new Complex 1.0 2.0)`.
2. **A CALL HEAD that resolves.** `checkIdentifierResolves` is reached only on the `else` branch —
   when the head did *not* resolve. A call to an unexported function resolves perfectly well, takes
   the `funcType.kind === "function"` branch, gets its arity checked, and is **never asked whether it
   was allowed to be seen**. Visibility is a question about a name that RESOLVED, which is precisely
   the question nothing was asking.

Wire only the obvious door and every gate in `type-errors.ts` goes green while `Complex` still leaks.
**The proof of enforcement is `complex_math_test` going red** — and it did: `[84/97] main.lisp 💥
ERROR`, two LL0215s, before the export list was fixed. It had been green *because the leak was live*.

### `visitTypeName` is dead code in this pass — and it looked right

The annotation door wanted a `visitTypeName` override: one method, every annotation. It is **never
dispatched**. `InferAndCheckPass.visit` (and `CollectTypesPass.visit`) deliberately override
`BaseAstTreeWalker` to *disable* the automatic child walk — *"we manually control which children to
visit in each visitXxx method"* — and nothing visits a type node. Written, never called, reports
nothing. The annotation door is therefore explicit: one helper (`checkAnnotationVisible`) called from
`visitFunction` (params + returns), `visitVariable`, and `visitClass` (`:extends` / `:implements`).

### AN OPERATOR IS EXEMPT — W, applied

`isVisibleFrom` returns `true` for an operator, and that line is load-bearing.
`inlineImportedOperators()` exists *because* an operator is found by **dispatch** and never by name,
and it routes through `isImportedSymbol`. The lib in `src/test/imports.ts:395` exports `Money` and
**not** its `+`. Add a blanket export check and that operator stops being inlined, never reaches
`__ll_op_registry.register`, and **W's bug returns whole**. This is not a special case: *an operator
is not a name — it cannot be shadowed, imported or redefined, only overloaded*. A thing with no name
has no export. `test:imports` staying 9/9 is the gate.

### Codegen was NOT given the check — deliberately

`isImportedSymbol` compares against `this.rootSource`, so "imported" there means *"not from the root
file"*. That is how the inliner drags in a module's **own private helpers** transitively —
`std/types.lisp`'s `get-type` is unexported and called by the exported `type-name`. A visibility check
there would refuse to inline `get-type` and emit a `ReferenceError`.

**The inliner asks a REACHABILITY question, not a VISIBILITY one**, and conflating them is a
regression. Visibility is decided upstream: LL0215 is a `RuleSeverity.Error`, and `Context` returns
before codegen when `results.hasErrors`, so codegen never sees a program that violates D20.

### The cost, as predicted

**One export list.** `std/math.lisp` omitted `abs floor ceil round pow min max inc dec` (all defined
directly below it) and `Complex`. Nine leaked names; the entire corpus blast radius of the module
boundary. 46 legitimate cross-module references were untouched, and no golden moved.

## Sc — the import side (LL0216, LL0217, and a resolver)

Sb made `export` real, so a module has a public surface. Sc makes `import` real: **resolution**,
**failure**, and **selective binding**. `docs/spec/STDLIB.md` has the worklist.

### There was no resolver, and no failure path

Resolution was one line — `path.resolve(dirname(importer), literal)` — open-coded in three places,
with no search path and no extension inference. **A missing import was a raw Node `ENOENT` stack
trace**: `AstProvider.loadFile` calls `fs.readFileSync` with no `existsSync` guard, and nothing on
the import path caught it. `std/` resolved at all only because every importing file happened to sit
one directory above it.

`ModuleResolver` is now the only thing that turns `(import "…")` into a file:

```
1. the importer's own directory     every corpus import lands here, and must keep landing here
2. the search paths                 the shipped lib/, then any -I roots
```

**Importer-first is a deliberate anti-shadowing rule.** Consult the search path first and a project's
own `std/io.lisp`, sitting next to its source, is silently displaced by the compiler's. A name
resolves to the thing nearest whoever asked. An explicitly relative spec (`./x`, `../x`) or an
absolute one never consults the search path at all: *"./config" means the one next to me; it is not a
request the stdlib may answer.*

### `(import foo.bar)` succeeded, and did nothing

A namespace import **parses in both frontends** and used to reach
`context.log(LogLevel.Error, "not supported yet")`. **A `LogLevel` call is not a diagnostic** — it
touches the logger and never `results`, so `hasErrors` stayed false and **the build SUCCEEDED with
the import silently dropped**. Unsupported is fine. Unsupported and quiet is not. It is **LL0217**.

### The gate that hid sixteen diagnostics — mine

A symbols-stage error does reach `hasErrors`, but the next gate is *after the type checker*. Without
an earlier one, a single misspelled import runs TreeShake, Comptime, Desugar and the whole checker
against a module whose symbols were never loaded, burying the one true diagnostic under a flood of
spurious LL0210s. So Sc1 added a gate after the symbols stage.

It was `if (this.results.hasErrors)` — and that collection is **Context-wide, shared across every
module in the build**. So an error in any *imported* module skipped the *importing* module's type
checking entirely. Measured: **`99-p5js/main.lisp` fell from 60 diagnostics to 44**, because
`p5-bindings.lisp`'s 44 ambient-global LL0210s (a known gap) tripped the gate. Sixteen diagnostics did
not get fixed — **they went silent**.

Caught only because the harness reports a *number*. The gate now tests for **LL0217 specifically**: a
missing symbol table is a reason to stop; somebody else's type error is not.

### `symbols: []` vs `undefined` — and both mean "the whole module"

| `(import "x.lisp")` | grammar_v2 | PEG |
|---|---|---|
| `symbols` | `[]` | **key absent** |

Read `[]` as *"an empty set of bindings"* and **every whole-module import in the language binds
nothing**. A whole-module import names no symbols precisely because it wants all of them. Normalised
before anything else touches it, and pinned by a gate — the corpus would have caught it, but the
corpus is not a spec.

### A silent MISPARSE in PEG, not a parse error

`SymbolAlias` used `TypeName` in both frontends, but they are not the same language: PEG's is
`Alpha (Alpha / Digit)*` with `Alpha = [_a-zA-Z]` — **no hyphen** — while grammar_v2's consumes an
`Identifier`, which allows one.

The expectation was a parse error under PEG. **It was worse.** `SymbolAlias` could not take the
hyphen, the whole `ImportSymbolsDefinition` backtracked, and `ImportSource / namespace: Identifier`
picked up the pieces — PEG's `Ident` is permissive enough to lex **`{` itself as an identifier**. So

```lisp
(import { starts-with } from "std/string")
```

parsed, under PEG, into **four separate NAMESPACE imports** — `{`, `starts-with`, `}`, `from` — with
no error at all. Essentially every exported name in the corpus is hyphenated, so **no real selective
import was expressible in that frontend**, and it failed by quietly meaning something else. Fixed with
a dedicated `SymbolName` rule; both frontends now agree.

### `LL0004 ImportHasSymbols` — deleted

```ts
.addSeverity(Error).addCode("LL0004").addMessage("Import symbol must have a name")
.addTest((node) => node.imports.some((x) => !x.symbols))
```

Defined, exported from the rules barrel, **never wired into any visitor**. Fortunately — because it
was wrong twice over: it encoded a **false invariant** (a whole-module import legitimately names no
symbols), and it was **frontend-divergent** (`!x.symbols` is `false` under grammar_v2 and `true` under
PEG, so wiring it would have failed all 21 corpus imports in one frontend and passed all 21 in the
other).

**The seventh "written and never wired in".** A rule that never ran is not load-bearing — but it is a
*claim*, and this one claimed the language works the opposite of the way it does. Deleted rather than
fixed: the invariant it wanted does not exist.

### The stdlib is a library now

`examples/20-stdlib/std/` → **`lib/std/`**, imported **by name**. This is what makes the resolver
load-bearing the day it lands rather than the eighth thing here that was built and never called.
`test:type-errors` walks `lib/` alongside `examples/` — walking only `examples/` would have dropped
the whole stdlib out of the diagnostic harness, recreating, *in the phase that named it*, the
"compiled but never examined" hole Sa exists to expose.

One hazard found by testing my own code: `defaultLibPaths()` ascends looking for `lib/`, and an
unbounded climb reaches `/` — **where `/lib` EXISTS on Linux**. The compiler would have silently
adopted the OS shared-library directory as its standard library: one platform, no error, only when
its own `lib/` was missing. The ascent is bounded at `.git` (not `package.json` — that lives in
`src/`, one level *below* the repo root where `lib/` sits, so it would stop one level too soon).

## Open findings from this phase

- **`:as` aliasing is unimplemented.** It parses in both frontends, on both the import and the export
  side, and nothing honours it. `exportName` records the alias; no reader renames anything.
- **`ImportExportAlias.as` is typed `IdentifierNode`** but both frontends emit a `TypeNameNode` on the
  import side, and PEG yields `null` where grammar_v2 yields `undefined`. Latent divergences.
- **Import cycles are a WARNING** (`LL0300`) — a cycle does not fail the build. `LL0300` also sits in
  a different band from D20's `LL02xx` codes, which were reserved there because `type-errors.ts` reads
  only `LL02*`. The banding is inconsistent.
- **A transitive import is still visible.** If A imports B and B imports C, A can name C's exports:
  `SymbolTable.join` splices every module's scopes in, and `importBinds` returns `true` when there is
  no *direct* import record rather than inventing a diagnostic from missing information. Whether a
  module boundary should be transitive is a real question, and D20 does not answer it.

## Sd — ambient globals are declarable, and `JS_GLOBALS` is dead

`InferTypesAstVisitor.JS_GLOBALS` was a **hardcoded 37-name allowlist inside the type checker** that
waved raw JavaScript through untyped — `console` alone went through it **579 times**. It was never a
standard library. It was a hole in the type system, and it is now **`lib/std/js.lisp`**: ordinary
l-lang `:extern` declarations, imported implicitly into every module. Interop lives behind a library
boundary instead of inside the compiler, and the set is now **extensible** — a browser target, a node
target and `99-p5js` want different globals, and a hardcoded set could never give them one.

### `:extern` existed, and its own rule forbade the only way to write it

`FunctionNode.extern` parsed identically in both frontends and was honoured by **nobody** — the
eighth *"written and never wired in"*. Worse than dormant:

```ts
LL0013 ExternFunctionCannotHaveBody
  .addTest((node) => node.extern)
  .addTest((node) => !!node.body)      // body is ALWAYS [] for a bodyless fn
```

`!![]` is **`true`**. Every correctly-written `(fn :extern f [x] -> Int)` was rejected for having the
body it did not have. Its sibling LL0012 has always carried the `.length > 0` this was missing. That
is why the corpus contained **zero uses of a feature both grammars parse**. `LL0006` was the same
trap on the value side: an extern `let` has no initialiser *by definition*.

Three more things it needed: **codegen must emit nothing** (`visitFunction` never checked `extern`,
so it would emit `function createCanvas(w, h) {}` — an empty stub **shadowing the real global**);
`extern` had to exist on `VariableNode` (it was already *legal* on a `let` and meant nothing);
and — found the hard way — **an extern must never be INLINED**.

That last one broke everything at once. Once `console` resolves, it looks like an ordinary imported
top-level symbol, so the inliner renames it: `(console.log x)` → `__ll_inlined_console_1.log(x)`.
**82 of 96 codegen cases and 7 of 9 import cases**, instantly. There is nothing to inline in a
declaration; the thing it names belongs to the host.

### 104 p5js diagnostics → 0, and what the noise was hiding

`p5-bindings.lisp` declares p5's 27 ambient globals and gains the `(import "std/types")` it always
needed — **8 of its 44 diagnostics were never about p5**; the file called `is-nil` eight times and
had no `(import …)` line at all.

The declarations are **untyped and rest-only**, deliberately. A declared arity is an *assertion*, and
p5's real signatures are variadic nearly everywhere (`fill`, `color` and `text` each take 1–4
arguments). Declaring `[w h]` buys an arity check and pays for it with **false LL0211s on correct
code**. Typing that surface is its own measured pass. `map` and `color` are declared and *not*
exported — `std/enumerable` exports its own `map`, and the importer must get **that** one. D20's
module boundary is what makes a private p5 global possible at all.

**Two guaranteed runtime crashes were sitting under the noise:**

- `(random-platform-type)` — called, **defined nowhere**. A `ReferenceError` the moment a platform
  spawns. `Platform`'s constructor takes **two** parameters and was being handed three.
- `(platform.init)` — `Platform` has no `init`. A `TypeError`, right behind it.

Neither is diagnosable, and the first says why: **`new`'s ARGUMENTS are never visited.**
`inferNewExpression` reads `args[0]` and returns; `args.slice(1)` is never inferred, so an undefined
function passed as a constructor argument is invisible — as are argument-type and arity errors on
**every** constructor call. Gated `pending`, not fixed: a checker change with its own blast radius.

### The cascade — the second time this shape has appeared

```
(import "./broken.lisp")     ;; has one LL0210
(import "std/math")          ;; never gets its symbols built
(floor 3.7)                  ;; -> LL0210 'floor' is not defined      <- A LIE
```

`Context`'s post-syntax gate was `this.results.hasErrors`, and `results` is a **single Context-wide
collection shared by every module in the build**. Once any module errored, every module imported
*after* it returned before its symbols stage and was never joined. That is why p5js appeared to have
an undefined `floor`, `abs` and `map`: `p5-bindings` is imported first and errored, so `std/math` and
`std/enumerable` were **silently never processed at all**.

**A module's own errors stop that module. Somebody else's do not.** This is the *second* instance of
this exact shape (Sc2 was the first, and that one was mine). A Context-wide collection used as a
per-module signal will keep producing it until every such gate is per-module.

Fixing it exposed a real type error hiding behind it: `std/math` declared `floor`/`ceil`/`round` as
returning `Number` (`Int | Real`), which made every caller's `-> Int` a lie. **They map onto the
integers — that is what they are for.**

### THE RESIDUAL — three names, and a language defect

`String`, `Boolean` and `Number` **could not move to the prelude**, and the reason is a real defect
rather than an oversight: **l-lang resolves types and values from ONE namespace**, and each of these
is *both* an l-lang type and a JS value.

Declaring `Number` in the prelude was tried, and produced **11 new LL0203s** — *expected Number, got
Int*. The mechanism is subtle and is why the first version of the guard missed it entirely:

> Inside `std/math`, `<- Number` resolves **lexically** to that file's own `deftype Number Int | Real`
> — so an *in-file* annotation test looks fine. But when **another module** checks a **call** to one of
> math's functions, the parameter's type-ref is resolved in the **caller's** scope, the lexical walk
> misses, and the flat cross-module fallback finds the extern — a *variable*, not a union. `Int` stops
> being assignable to `Number`.

The guard therefore has to **cross a module boundary**, or it cannot see the thing it exists for. It
was rewritten to do so and then **falsified**: re-adding `Number` to the prelude turns it red; removing
it turns it green.

So the three are named in `TYPE_NAMED_GLOBALS`, **as a defect**. The real fix is to stop resolving
types and values from one namespace (or to prefer a type-kind symbol when resolving a type name).
Until then, a **three-name shim is the honest answer, and a thirty-seven-name allowlist was not**.

## Open findings from this phase

- **`new`'s arguments are never type-checked, or even visited.** Undefined functions, wrong argument
  types and wrong arity are all invisible on every constructor call. Gated `pending`.
- **Types and values share one namespace.** The direct cause of the residual above.
- **Typing the JS globals** is now possible and not done. `TypeEnvironment.resolveIdentifier` already
  resolves a dotted name against a `class`/`struct`/**`interface`**, so `(definterface JsMath (fn sqrt
  [x <- Real] -> Real))` + `(let :extern Math <- JsMath)` would give `Math.sqrt` a checked signature.
  It is a behaviour change and belongs in its own measured pass.
- **`extern` on classes** is not sayable. Only `FunctionNode` and `VariableNode` carry the flag, so an
  ambient *class* (`p5.Vector`) cannot be declared.
- **Member existence is never checked** on any receiver — `platform.init` on a class without `init` is
  silent.

## Sf — the stdlib RUNS, and running it found three bugs in one afternoon

`examples/20-stdlib/test_stdlib.lisp` has a **golden**. It compiles, **executes**, and its output is
asserted on every `npm test`, **in both frontends**. That is the first time any of this code has ever
run.

Sa's finding was that `library`/`xfail` files are *compiled and never executed*, which is how a stdlib
that called four nonexistent functions sat green in the tree. **The moment it actually ran, it found
three real bugs** — none of which any test, any type check, or any amount of reading had caught.

### 1. An inlined function's PARAMETER was replaced by a same-named top-level symbol

`std/math` has `(fn pow [base exp] (Math.pow base exp))` and, separately, `(fn exp [x] (Math.exp x))`.
It emitted:

```js
function __ll_inlined_pow_1(base, exp) {        // <- exp is bound RIGHT HERE
  return Math.pow(base, __ll_inlined_exp_1);    // <- and the body used the FUNCTION
}
```

**`(pow 2 3)` was `NaN`.**

`cloneNode` was a JSON round-trip with a cycle-breaking replacer — and **`_parent` IS the cycle**, so
it was dropped. Every cloned node came out orphaned, and that silently changed what its identifiers
*mean*: `resolveSymbol(name, node)` climbs `_parent` to find a scope, misses, and falls through to the
**flat cross-module union**, where it finds a top-level symbol of the same name.

The fix is the invariant One Tree already established: **a copy keeps the ORIGINAL parent, by
reference.** `nodeScopeIndex` is keyed on the original nodes, so a clone must climb into the original
tree to find its scope.

Nothing exotic triggers this. *Any* library with a function named `exp` and a parameter named `exp` —
i.e. any maths library — was affected.

### 2. A `deftype` was inlined as though it had a runtime value

`std/types` has `(deftype Number Int | Real)` and, in the same file, `(fn is-int [x] (Number.isInteger
x))`. Within that file `Number` resolves same-source and is left alone. But the moment `is-int` is
**inlined into another module**, the inliner resolves `Number` to the deftype, sees a top-level symbol
from another file, and emits `__ll_inlined_Number_1.isInteger(x)` — **a `ReferenceError`**, because a
type definition emits nothing at all.

`isImportedSymbol` now refuses a `type-def`, for the same reason it refuses an `:extern`: **there is no
runtime value to inline.** This is Sd's type/value namespace collision surfacing in *codegen* rather
than in the checker.

### 3. A zero-arg call to a local function value is not a call

`(let c5 (constantly 5))` then `(c5)` printed **the function object**. Codegen decides "is this a
call?" from `this.functions` — a **source-order list of declared functions** — and a local lambda is
not in it, so `(c5)` compiled to a bare `c5`.

D1's own comment states the rule it is not following: *"(func) = call func with zero args"*. But
honouring it for every zero-arg simple identifier was **measured** and it breaks the suite and a
codegen case: **`(x)` is also used as grouping** in the corpus. The two readings are genuinely
ambiguous, and D1 has to rule on which wins. Gated `pending`. `call` is the sanctioned form
(`(call noFill)` in the p5 bindings), and it is what `test_stdlib` uses.

### The layout, and two incoherences closed

D22's names: **`enumerable` → `seq`**, **`strings` → `string`**, **`functional` → `fn`**.

- **`Number` was `deftype`d twice** — in `std/types`, and again in `std/math` *which imports it*. Both
  exported it: two symbols with one name, and the flat fallback picking whichever it reached first.
  Math's copy is gone. Removing it also surfaced that **a module cannot re-export a symbol it does not
  define** — `visitExport` throws a raw `Error` ("Cannot export undefined symbol"), a **stack trace
  rather than a diagnostic**.
- **`fn.lisp` no longer exports `apply`**, which collided with D17's `.apply` method dispatch — the
  exact collision `05_matching.lisp` had to hand-roll a workaround for. It stays module-private, which
  is what D20's boundary is *for*.

### `first`, `last`, `at`, `length` — and an honest `Unknown`

The four functions `test_stdlib` had always called now exist, in `std/seq`. But **`first`/`last`/`at`
return `T?` in principle and cannot say so** — see Se. They ship returning `Unknown`, which is honest:
an `Unknown` silences checks, but it does not *lie* about them. The generic-inference gate is what
turns them real.

### A note on the golden

**It was authored by reasoning about what each line should print, then diffed against what the compiler
produced.** They matched. A `.expect` generated by recording output is not a test; it is a photograph
of whatever the compiler happened to do — and this suite already contains one golden that bakes in a
bug (`03_matching`), which is precisely what that gets you.

The string escapes are a case in point: `"\n"` lexes as a backslash and an `n` and **prints as one**.
Recording the output would have frozen `\n=== STD LIB TESING ===\n` into the golden as the *expected
answer*. `test_stdlib` uses `(print "")` instead, and says why.

## Open findings from this phase

- **String escapes are not decoded.** `"\n"` is a backslash and an `n`. A standing Known Gap, now with
  a second corpus file working around it.
- **`visitExport` throws instead of diagnosing.** An export list naming an undefined symbol crashes the
  compiler with a Node stack trace. And **re-exporting an imported symbol is not supported** — which
  may be right, but it is unstated.
- **`(x)` — call or grouping?** D1 says call; the corpus uses both. Gated `pending`.

---

# Phase 5 — generic inference. Generics stopped being a lie.

`(let b (Box 42))` deduces `Box<Int>`. `(my-head [1 2 3])` on `(fn my-head<T> [xs <- T[]] -> T?)`
solves `T = Int` and returns `Int?`. **The Se gate is green: `std/core` is unblocked.**

## The finding that reframed the phase: you could not WRITE a generic function

```
grammar_v2  ->  PARSE ERROR: Expecting LBracket but found '<'
peg         ->  PARSES.  fn name = "my-head<T>"      <- ONE identifier
```

`grammar_v2`'s `functionExpr` had **no generics slot**. PEG's identifier charset **includes `<` and
`>`** — it has to, because `<`, `>`, `<=` and `>=` are operator *names*, declared as `(fn :operator <
…)` — so `my-head<T>` lexed as a **single name** and produced a function nobody could ever call. A
frontend divergence, and a silent one.

`FunctionNode.generics` had been declared the whole time, carrying a comment reading *"NEVER populated
by either frontend"*, while every downstream binder already handled it. **The ninth "written and never
wired in."** So "generic inference does not work" was never a type-system problem at the root.

The PEG name rule now stops at an angle bracket, and an operator whose name *is* an angle bracket falls
through to a second alternative. A name need not be alphabetic — `W99_L_sloth_design_v1.lisp` already
writes `(fn ?<T> …)`.

## SOLVE, then CHECK AGAINST THE SOLUTION — the ordering is the whole phase

A function type recorded `params`, `returns` and `isVariadic` and nothing else, so a call site saw `T`
and had no way to know it was a **free variable** rather than a concrete type named `T`.
`funcType.returns` was handed back **raw**: a declared `-> T?` reached the caller as a literal
`{kind:"generic", name:"T", optional:true}`, which no check knows what to do with. That is why a
generic optional never fired while a concrete `-> Int?` always did.

Three pieces: the function type carries its **type parameters**; **`unify`** reads a declared parameter
against the actual argument (`T[]` vs `Int[]` recurses into the element and learns `T = Int`); and
**`substitute`** applies the solution.

> **`optional` is a FLAG, not a wrapper** (D9), and carrying it through substitution is the whole
> point. Lose it and `-> T?` quietly becomes `T`, LL0205 never fires, every gate stays green, and the
> feature looks finished while doing nothing.

**And the ordering took two attempts to see.** Deleting the erasure rule on its own reported *`expected
T, got Int`* on every generic call in the corpus — which is not a type error, it is **the checker
complaining that it has not done its job yet**. A generic signature must be **instantiated before its
arguments are judged**. Once `checkCallArguments` compares against the solved signature, there is
nothing left for the erasure rule to paper over.

## A class is INSTANTIATED, and its constructor is checked at all

`(Box 42)` produced a bare `{kind:"type-ref", name:"Box"}` with **no arguments**, so `Box<Dog>` and
`Box<Animal>` were the *same type* and the variance rules P7 wrote had nothing to compare. The existing
invariance test only passed because it **annotates** `<- Box<Dog>` — the annotation did the work and
the inference was never exercised.

The result is `{kind:"generic", name:"Box", generics:[Int]}` — the **same shape the annotation already
produces**, so `typeArgumentsAssignable` compares the two with declaration-site variance, unchanged.
*Not* a `type-ref` carrying `generics`: `unwrapType` dereferences a type-ref to the declaration and
**drops the arguments** on the way.

The type argument reaches the **member**, too: `bi.v` on a `Box<Int>` is `Int`, not the bare `T` the
declaration says. `TypeChecker.substitute` is shared by the call site and the member walk so the two
cannot disagree.

And the constructor's arguments are checked **at all** — the class branch never called
`checkCallArguments`. `(Box 1 2 3)` on a one-parameter constructor was not checked *loosely*; it was
not checked.

### The corpus immediately caught two bugs in that check

Which is the argument for arming a check against **real code** rather than a fixture:

- **`'Complex' expects 2 arguments, got 0`** ×5 — a **defaulted** `:ctor` member is optional.
  `(defstruct Complex (let :ctor real <- Real 0.0) …)` makes `(new Complex)` legal, and it is the
  corpus's declare-then-fill idiom. I had counted *declared* parameters rather than *required* ones.
- **`'Dog' expects 1 argument, got 2`** — an **inherited** `:ctor` member counts. `ctorInfo.params`
  holds only a class's *own*, and a subclass's constructor takes the parent's **first**.

Both are correct programs. Both are now guards.

## The erasure rule is gone

```ts
if (isBareTypeParameter(source) || isBareTypeParameter(target)) return true;   // both directions
```

**Every `T` passed, always.** That one line was the whole of l-lang's generics. It is deleted, with
**zero corpus diagnostics** — and the named canaries it warned about (`14_generic_interface`,
`20-stdlib/complex_math_test`) are green, because inference now types them for real.

It caught a real bug in one of this phase's own tests on the way out: `(fn first-of<T> [xs <- T[]] -> T
(return (elem xs 0)))` returns **`T?`**, not `T` — `elem` is the **total** accessor — and the erasure
rule had been hiding that `LL0213` the whole time. D9's partial/total split doing exactly what it was
built for.

A bare `T` that still reaches `isAssignable` is *genuinely* unsolved — inside a generic body,
`this.value` really is `T` and there is nothing to compare it to. Gradual typing already covers that.
**What is gone is the blanket amnesty.**

## Open findings from this phase

- **Generic constraints** (`:where T :of Comparable`) do **not parse in grammar_v2 at all**; in PEG
  they parse and are then **silently discarded** by two independent bugs — an array spread into an
  object, and a read of a field nothing sets. `:of` is not even a constraint keyword (the set is
  `implements | inherits | is | has`). `TypeParameter.constraints` is the empty slot waiting.
- **`typeArgumentsAssignable` bails out when either side has no arguments** — a bare `Producer`
  satisfies a `Producer<Animal>`. A second, smaller erasure hole.
- **Abstract classes** (`:abstract` is not a modifier) — the remaining Phase 5 bullet.
- **Spending the unblock.** Whether `std/core` should expose Scheme-classic `head`/`tail`/`cons` or an
  invented surface is a **language** question, deliberately left open.
---

## D23 — REPL semantics: what a session is, and what enters history

> **Renumbered on merge.** The `repl-refactor` stream minted this as *D17* while `dev` was
> independently minting **D17** (`(x |> (.m a))` is a method call) and D18–D22. Two branches, one
> register, no lock — the numbers collided. This ruling is unchanged; only its label moved. Any
> `D17` in the REPL sources or `docs/repl.md` means **this**.

The REPL had no ruling and no test, and it rotted invisibly through P4–P8 until it was dead on the
first keystroke. Most of what follows is not new policy — it is what the compiler ALREADY does,
written down, because the REPL depends on it and nothing was stopping a future pass from "fixing"
it away.

**A session is a program that grows by one top-level form at a time.** Each accepted input is a
*cell*, and the session's program is the cells, in order, as **sibling top-level forms**. Every
input recompiles the whole thing — in a statically typed language that is the only sound choice,
since rebinding `x` must be checked against every form that already uses `x` — but **only the new
form is ever executed.** History is compiled, never re-run; the values it produced are already in
the sandbox.

**A session is NOT wrapped in the conventional outer list.** Every example and both new harnesses
wrap a file in one outer `( ... )`. A session must not. That outer list is a *block*: it would make
each cell a block-scoped statement, hide `class`/`const` bindings from the next cell, and turn
every rebinding into a hard LL0212. It is one character away and it is wrong.

**LL0212 (duplicate declaration) is a BLOCK-scope check, and stays one.** It is tested in
`visitList`, not `visitProgram`. Two cells are two lists, so `(let x 1)` then `(let x 2)` is not a
duplicate — while inside a file's single top-level block, a redeclaration remains an error. Both are
correct. *Moving this check to `visitProgram` would make the REPL unusable.* `test:repl` pins it.

**A binding's TYPE is fixed at first declaration, and the REPL enforces that itself (REPL0001).**
`(let x 1)` followed by `(let x "hi")` is refused — **whether or not anything depends on `x`.**
Rebinding at the *same* type is accepted, and redefining a function or a class is accepted.

This is not belt-and-braces; it closes a **silent wrong answer**. Because cells are sibling forms,
a rebinding puts *two* declarations of `x` at program scope with different types — while codegen
emits *one* `var x`. The checker then resolves `(* x 2)` inside an earlier
`(fn double [] -> Int ...)` against the **first** `x` (Int) and says nothing, and at run time
`double` reads the String and returns `null`. A function declared `-> Int` returning null, with no
diagnostic.

**The compiler cannot catch this and must not be asked to.** In a *file* the shape is impossible —
one top-level block, so a redeclaration is LL0212 — and a forward reference from a function body to
a `let` declared *later* at program scope is not type-checked either, so dropping the earlier cell
does not restore the check. Both measured. LL0200 *used* to fire here, because the checker read the
second `let` as an assignment to the existing symbol; P6 made resolution scope-aware, it now reads a
second *declaration*, and that accidental guard is gone. The invariant is the REPL's to hold, and it
holds it directly: **one name, one symbol, one type, for the life of the session.**

**`.delete <name>` is therefore not a convenience — it is the escape hatch.** It is the only way to
give a binding a different type without discarding the session. It removes the cell that declared
the name and replays the survivors into a fresh sandbox (a `var` on a contextified global cannot be
reliably removed, so the sandbox is rebuilt rather than patched). A surviving cell that no longer
compiles without the deleted declaration is **dropped and reported** — never silently kept, and
never silently discarded.

**History is exactly what the user typed.** There is no automatic de-duplication on rebinding.
Dropping the earlier `(let x 1)` would not rescue a type-changing rebind anyway — the refusal does
not come from the old cell — and it would silently take any co-declared names with it. `.history`
does not lie; `.delete` is the only removal.

**An input enters history only if it compiled AND ran to completion.** A refused input, and an input
whose JavaScript threw, leave the session exactly as they found it. Otherwise the replay and the
sandbox diverge, and every later input compiles against a world that never existed.

**A top-level `class` or `enum` in a session is emitted as `var X = class X {...}`, not as a lexical
declaration.** A lexical binding in a `vm.Context` lands in the realm's global lexical environment:
redeclaring it is a `SyntaxError`, and it is not reachable as a property of the global. A REPL in
which a class can be defined exactly once is not a REPL.

*Deferred:* true sequential shadowing — input *n* rebinds `x` at a new type while earlier cells keep
the old `x` by alpha-renaming. It is strictly more permissive and it is what a dynamic REPL gives
away for free. It requires renaming bindings across the replayed AST, and the refusal above is sound
without it.

---

## D24 — forward references: a value must be declared before it is EVALUATED

**Ruling:** a name is forward-referenceable **iff it is not evaluated before its declaration.** The
rule *is* the runtime fact, and it is what every mainstream language does.

| position | rule | why |
|---|---|---|
| **TYPE** (`<- Dog`, `-> T`, `:implements`) | always fine | types are **erased**. An interface emits nothing at all. |
| **a `fn`** | always fine, anywhere | it emits `function f(){}`, which JS **hoists** — and **mutual recursion depends on it**. |
| **a VALUE** — `let`, `mut`, `defclass`, `defstruct`, `defenum`, and a `:extends` parent | only in **DEFERRED** position | a function, method or lambda **body** runs after module init, so the name is bound by the time it is read. In **immediate** position it must be declared first. |

**LL0219** enforces it. Three programs that compiled clean and crashed:

```
(let a x)                        (let x 1)          -> ReferenceError: 'x' before initialization
(let d (new Dog))                (defclass Dog)     -> ReferenceError: 'Dog' ...
(defclass Dog :extends Animal)   (defclass Animal)  -> ReferenceError: 'Animal' ...
```

### The correction that makes the rule correct

The tempting rule — *"functions and types may forward-reference; values may not"* — **permits two of
those three crashes**, because a class reads as a "type".

> **A class is a TYPE in `<- Dog` and a VALUE in `(new Dog)`.**

`class X {}` is not hoisted; it has a temporal dead zone like any `const`. And `:extends` **evaluates**
its parent at class-definition time (`class Dog extends Animal`) while `:implements` does not — an
interface has no runtime existence. Two clauses that look alike and are not.

### Deferred references are LEGAL, and that is the half that matters

```lisp
(fn area [] -> Real (* PI 4))
(let PI 3.14)                     ;; legal. `area` runs after the module is initialised.
```

Banning this was the simpler rule, and it costs nothing measurable (**0 corpus uses**) — but it is
stricter than the runtime requires and stricter than every language people come from. The reason to
allow it is the reason to allow anything: *it works, and forbidding it buys nothing.*

## D1, answered: `(x)` is a call iff `x` names a FUNCTION

`(x)` — a list with a single identifier head — is genuinely ambiguous, and the corpus uses **both**
readings:

```lisp
(solve-maze)                    ;; a zero-arg CALL
'"Squares: {(squares)}"         ;; the VALUE of `squares`, in a string interpolation
```

Measured: **every "grouping" use of `(x)` in the corpus is a variable inside a string interpolation**
(`10-algorithms`, `00_bfs`). **Every other zero-arg `(x)` is a genuine call** (`solve-maze`,
`init-game`, `beginShape`, `main`). "Always a call" was tried and it breaks the suite; "always a
grouping" breaks every zero-arg call. So:

> **`(x)` is a call iff `x` names a function.** Asked of the **symbol table** — not of source order.

### Codegen was source-order dependent, and it made D24 unwritable

The call/construct decision read `this.functions` and `this.classes` — lists codegen fills **as it
visits**. So the same expression compiled differently depending on where it sat in the file:

```
(console.log (f))       ->  [Function: f]      f not visited yet -> a bare reference
(fn f [] -> Int 7)
(console.log (f))       ->  7                  f visited         -> a call
```

**`(f)` before its declaration printed the function object.** A silent wrong answer — and it made *"a
function may be forward-referenced"* a **lie**, which is why D24 could not be written until it was
fixed. The class half was the same bug: a class constructed before its declaration emitted
`__ll_copy(Dog)` — the class *object*, cloned.

Both now ask the symbol table, which is built in a prior pass and knows every declaration regardless
of order. The standing Known Gap *"codegen is source-order dependent"* is closed.

### A false positive worth recording

The first version of the LL0219 check walked the AST for identifiers itself. It immediately produced
**29 diagnostics on passing tests** — flagging `(fn :operator + [c1 <- Complex c2 <- Complex] …)` in
`09_operators.lisp`, because that file *also* declares top-level `(let c1 …)` and `(let c2 …)` further
down.

**A parameter's name is a BINDING, not a reference.** `checkIdentifierResolves`'s own note warns about
exactly this trap — *"map keys, enum keys, a function's own name — none of which are references to
anything"* — and the cure is not to re-derive what the pass already knows. The check moved to the
reference-position path, and the false positives vanished.

The same shape bit once more: hooking it into `checkSymbolVisible` made **type annotations** report,
because the annotation path reaches that function too. `(fn take [d <- Dog])` above `(defclass Dog)` is
legal — a type is not an evaluation. The check is called from the **value** sites by name, and from
nowhere else.

## Open findings from this phase

- **A lambda has no type.** `(let f (fn [] 5))` infers `Unknown` — *even for a direct lambda*. So a
  variable holding a function is indistinguishable from any other variable, and `(c5)` cannot be
  decided. `(call c5)` remains the sanctioned form. Fixing lambda inference would settle the last
  corner of D1.

## D1 — SETTLED. A lambda has a type, and `(x)` is a call iff `x` is a function

`(x)` is a call **iff `x` is a function** — *declared* as one, **or holding one**. The second half
needed the type system to be able to say so, and it could not: **a lambda had no type at all.**

```
(let f (fn [] 5))          ->  Unknown      inferExpressionType had no `case "function"`
(let c5 (constantly 5))    ->  Unknown      an unannotated return was hardcoded to `Any`
```

So a variable holding a function was **indistinguishable from a variable holding anything else**, and
codegen had nothing to ask. `(f)` printed `[Function]`; `(c5)` printed the closure's source.
`test_stdlib` shipped `(call c5)` for the whole life of the file to get round it.

### Structural, and that is a measurement rather than a compromise

`functionTypeOf` reads annotations and — when the return is unannotated — asks the body **one**
question: *is its tail another function?* It does not infer expressions. Of **211** unannotated returns
in the corpus:

| tail is a **lambda** | **8** | `constantly`, `partial`, `compose`, … — exactly what D1 needs |
| tail is a **literal** | **0** | full literal inference would newly type *nothing* |
| tail is something else | 203 | needs full expression inference, and would mostly still be `Unknown` |

The structural answer is **complete for the question being asked**, and it lands with **zero** new
corpus diagnostics. Full return-type inference remains a real, separate feature — and now a clearly
optional one.

### The desugared tree is not the tree that was written

Both halves of the fix failed silently at first, for the same reason: this pass runs **after** the
desugarer.

- `(let f (fn [] 5))` reaches it as a **`list` wrapping the lambda**, so `case "function"` never fired.
  Codegen has always unwrapped exactly this (its own trivial-list unwrap, with the same D1 guard — an
  *identifier* head is a call and must not be unwrapped); the checker did not, so the lambda inside was
  never typed.
- `(fn constantly [x] (fn [] x))`'s tail arrives as **`(return (fn [] x))`** — One Tree's implicit
  return — nested inside *two* lists. Peeling one layer finds another list, decides it is not a
  function, and gives up. `constantly` keeps typing as `Any` and the feature quietly does nothing.

A structural check against a tree you did not write has to peel until it stops being a wrapper.

### The proof

`test_stdlib.lisp` drops `(call c5)` for `(c5)`, and **its golden does not move** — same output,
honest syntax. The workaround, and the note explaining why it was needed, are gone.

## D25 — what a list IS: call, block, or grouping

`(a b c)` is the whole language. Until now the rule was never written down, so codegen guessed it,
the type checker guessed it *again*, and the desugarer guessed it a **third** time — and all three
guessed from the same proxy: **`head._type === "simple-identifier"`.** That proxy is what makes an
applied lambda impossible to write.

**Ruling.** A list is read by its HEAD, in this order:

| head | reading | why |
|---|---|---|
| a **special form** (`let`, `fn`, `if`, `return`, `new`, …) | that form | decided before anything else |
| an **identifier**, with ≥1 argument | **call** | `(g 1)` cannot mean anything else, whatever `g` names |
| an **identifier**, with 0 arguments | **call iff it names a function** (D1) | `(solve-maze)` calls; `{(squares)}` reads |
| a **dotted member** — `(obj.m)` | **call**, always (D1) | the source said `.m` |
| a **lambda literal** — `((fn [x] x) 21)` | **call** | ← **new.** See below. |
| **anything else** (a list, a form) | **implicit block** | this is the file wrapper and every body |
| a list of **exactly one** non-identifier element | **grouping** | `((+ 1 2))` → `3` |

### Why a lambda literal head is unambiguous, and a call head is not

The tempting general rule — *"a head that evaluates to a function is the callee"* — is **refuted by the
corpus, fatally**:

```lisp
(                        ;; <- the file wrapper. Its head is `(console.log 1)`: a CALL.
  (console.log 1)
  (console.log 2)
)
```

Every file and every function body in the repo is a list whose head is a call. Reading a call head as a
callee turns all of them into *"apply the result of the first form to the rest"*. It is not a close
call; it is the most common shape in the language.

A **lambda literal** head has no such collision. A block whose first form is a bare lambda literal is a
**no-op** — it computes a closure and discards it — so that shape has no other meaning to preserve.
That is the entire reason this one case can be lifted and the general one cannot.

### `(call f a b)` — the application form

**Correction.** When D25 was first written this section claimed `call` was the tenth *"written and
never wired in"* — that `(call g 2)` called a function named `call` that did not exist. **That is
false, and the truth is worse.** `call` was a *runtime shim*:

```js
const call = (f, args) => !!args && Array.isArray(args) ? f(...args) : f();
```

Its second parameter is an **argument ARRAY**. So `(call g [2])` works, and `(call g 2)` — the way
anyone would actually write it — passes `2`, fails `Array.isArray`, and calls `g()` **with no arguments
at all**. The argument is *silently dropped*: `(call g 2)` on `(fn [x] (+ x 1))` returns `NaN`, and
nothing reports a thing.

What *is* true is that `CallNode` and codegen's `visitCall` have existed all along, are correct, and
**no source syntax has ever built one** — the only producer is the pipeline (`|>`) desugaring.

So `(call f a b)` is now desugared into that node: variadic, and meaning what it says. All six uses in
the corpus are zero-arg (`(call check-j)`, `(call noFill)`, `(call Math.random)`) and emit exactly what
they did before. Desugared rather than parsed, deliberately — both frontends hand over the identical
list, so neither grammar learns a new form, and the type checker sees the tree codegen sees.

```lisp
(call (get-fn) 2)        ;; the escape hatch: any callee expression
((get-fn) 2)             ;; LL0220 -- see below
```

### LL0220, and the honest limit on it

`((get-fn) 2)` is a **block** under the rule above, so it evaluates `(get-fn)`, throws the function
away, and yields `2`. That is a silent wrong answer, and it cannot be ruled an application, because the
shape is *identical* to the one every file is made of:

```lisp
( (console.log 1) (console.log 2) )     ;; the file wrapper. Head is a CALL.
( (get-fn)        2                )     ;; head is a CALL.
```

Nothing **structural** separates them. So the discriminator is not the shape, it is the **type**: a
block that computes a *function*, discards it, and moves on is not a block anyone meant to write.
`(console.log 1)` is Void and stays a block; `(get-fn)` returns a function and is a mistake.

**And the limit is real, and stated rather than hidden.** Gradual typing forbids reporting on an
`Unknown`, so LL0220 fires only where the head's type is actually *known* to be a function — which
today means where the return type was **inferred**, not declared `-> Any`. Both cases are gated. A
checker that guessed here would report on correct code, and that trade is the right way round.

### `(expr).member` — a member of a COMPUTED object (Xg)

The sibling of `(call f a b)`: `((Vault).reveal)`, `((mk).method a b)` — a member access on a
parenthesised/computed object. A `.member` suffix attaches only to a NAME, so on a `(...)` group the
`.member` fell out as a separate headless `composite-identifier`, the 2-node list read as a block, and
codegen emitted `{ new Vault(); reveal; }` — a bare `reveal` (`ReferenceError`), or invalid JS
(`LL0101`) in an expression slot. **Xg** desugars the shape `[computed-object, headless-.member, …args]`
into `CallNode(MemberNode(object, member), args)` — the same core nodes the pipeline `(x |> .length)`
already produces, and what `ast.ts:487-504` reserves them for. A parenthesised member-list is a call, so
`((Vault).reveal)` → `new Vault().reveal()` (the computed receiver goes through the `__ll_member` runtime
fallback, a thermometer site). Desugared, not parsed — both frontends hand over the identical shape.

## D26 — match guards: `pattern :when expr`

A `match` case tests a **pattern**; a **guard** narrows it with a boolean the pattern alone cannot
express. `Math.random()` returns `[0, 1)`, so this always takes the second arm — deterministically:

```lisp
(match (Math.random) {
  x :when (< x 0)   => "unborn"
  x :when (< x 10)  => "just a baby"     ;; always this one
  _                 => "impossible"
})
```

**Ruling.** A guard is a separate clause, `:when`, between the pattern and `=>`. It is **not** a kind of
pattern.

```
<pattern> [:when <expr>] => <body>
```

The pattern **binds**; the guard **reads** those bindings and returns a boolean. A case matches iff the
pattern matches **and** the guard is truthy. It composes with any pattern:

```lisp
x :when (< x 0)                  ;; bind x, test it
[a b] :when (> a b)              ;; destructure, then compare the parts
x :of String :when (= x "hi")    ;; type-narrow, then test  (see the note below)
```

### Why a clause, and not a predicate-shaped pattern

Two predicate-shaped syntaxes were on the table and both were rejected, for the same reason:

- `(< _ 0)` — what `03_matching.lisp` actually writes. It is **ambiguous with a parenthesised
  destructure** `(1 2 3)`, and disambiguating it would mean asking the symbol table whether the head
  names an operator — a third copy of the D1/D25 question, in a place that does not need one.
- `(fn [x] (< x 10))` — what the design sketch `W99_L_sloth_design_v1.lisp` writes. Unambiguous, but it
  invents a per-arm lambda and a placeholder convention where a plain expression will do.

`:when` is unambiguous with **no** lookup — the pattern and the guard are lexically separate — and it is
what Rust, Scala and F# all chose. The guard reads the pattern's own bindings by name (`x`), not a
magic `_`, so it composes with type patterns and destructuring rather than replacing them.

### What `03_matching.lisp` was, and what its golden asserted

That file is the reason this ruling exists. It wrote guards as `(< _ 0)`, which **do not parse as
guards at all** — `(< _ 0)` is read as a three-element *list-pattern* `[<, _, 0]`, where `<` is an
identifier-pattern that **binds** and thereby emits an assignment to the `<` operator's own `const`
(saved from a `TypeError` only because `Array.isArray` short-circuits first). Every guarded arm fell
through, and **the golden recorded that fall-through as the expected answer** —
`how da fck are you still alive?`. A passing test asserting a bug. Re-authored under this ruling, it
prints `just a baby`.

### Out of scope, surfaced not absorbed

`:of` **type patterns still compile to `false`** (dead since forever), so `x :of String :when …` does
not yet work — the `:when` half is real, the `:of` half is not. Likewise `rest-pattern` (`[1 ...rest]`)
and `functional-pattern`. Those are separate defects; this ruling is guards.

## D27 — `:of` type patterns

`x :of T` matches when the scrutinee is a `T`, and binds it to `x`. It is the value-level companion to
`catch e :of Error` — the corpus already uses `:of` for "this VALUE is a T", and `:is` for TYPE-level
statements (`:where T :is class`, `:is Carrot & Potato`). Two keywords, two jobs; they are not aliases.

```lisp
(match v {
  n :of Int    :when (> n 10) => "big int"   ;; composes with a D26 guard
  n :of Int                   => "int"
  d :of Dog                   => (d.speak)   ;; `d` is bound and typed
  _                           => "other"
})
```

**Wiring, not inventing.** Type patterns *parsed* into a `type-pattern` node all along, and then died:
`generateCondition`'s `default:` returned `literal(false)`, so every one fell through. The runtime test
was never missing either — `__ll_is_type(val, "T")` lives in the always-on preamble, handles primitives
by `typeof` and classes by walking the prototype chain on `__ll_name`, and is already live (the operator
registry dispatches through it). `RuntimeProvider` even documented the intended call:
*"generateCondition calling __ll_is_type"*. This ruling is that call, finally made.

Codegen emits `(x = v, true) && __ll_is_type(v, "T")`: bind first (so `x` is usable in the body and in a
guard), then test. `findIdentifiersToDefine` now declares the type-pattern's binding too, or the `x = v`
would assign to a global.

### Two frontend bugs, one real

- grammar_v2 parsed `:of` correctly; only codegen was dead.
- PEG's `TypePattern = id:Identifier OfModKw type:Type` had **no whitespace** around `:of`, so `x :of Int`
  (as anyone writes it, with spaces) never matched — `x` fell through to an identifier-pattern and the
  leftover `:of Int` broke the whole `MatchCase`, so `match` read as a plain call. Same fall-back
  signature as the D26 guard bug. Fixed with `_` around `OfModKw`.

The docs said `x :is Int`, which never parsed (the grammar wires `:of`) and would have muddied the
`:of`/`:is` split; corrected to `:of`.

### Still out of scope

`rest-pattern` (`[1 ...rest]`) and `functional-pattern` still compile to `false`. Separate defects.

## D28 — rest patterns: `[a ...rest]`

`[a ...rest]` matches an array of length **at least** the fixed count, binds the leading elements
positionally, and binds `rest` to the remaining tail (an array, possibly empty).

```lisp
(match xs {
  [first ...others] => (console.log others.length)   ;; first = xs[0], others = xs.slice(1)
  []                => (console.log "empty")
  _                 => (console.log "not an array")
})
```

**Two dead spots and a missing rule.** The rest element was double-dead in codegen:
`generateArrayPatternCondition` demanded `length === elements.length` (an *exact* length, so a rest
pattern could never match a longer array) and then ran the rest element through `generateCondition`,
where it hit `default: false`. Fixed: with a trailing rest the length check is `>= fixedCount`, and the
rest element emits `(rest = matchVar.slice(fixedCount), true)` -- a binding, not a test.
`findIdentifiersToDefine` declares the `rest` name, or the assignment would hit a global.

And **PEG had no `RestPattern` rule at all** -- `[a ...rest]` never parsed; `VectorPattern`'s `Pattern*`
stopped at `a`, met `...`, and failed to close `]`, so the whole match fell back to a plain list. Added
`RestPattern = _ "..." id _`, before `IdentifierPattern` in the `Pattern` choice. The leading `_` is
load-bearing: without it `[...rest]` alone parsed but `[a ...rest]` did not, because the space after `a`
had nowhere to go.

Rest is **trailing only** -- a rest in the middle (`[a ...mid z]`) is a separate, harder feature -- and
**named only**: `RestPatternNode` has no anonymous form, so `[a ...]` is not accepted.

Destructuring `let [a ...rest] = xs` already worked; this brings match to parity, and it nudged the
frontends one file closer to agreement (18 → 19 identical in the differential).

### The last dead pattern

`functional-pattern` -- `(Int Int) => Int`, matching a value by its function *signature* -- still
compiles to `false`. Unlike the others, it may not be meaningfully implementable on a JS target: a
closure does not carry its parameter types at run time, so there is nothing to test against. Left dead,
and now the *only* thing `generateCondition`'s `default: false` still catches.

## D29 — language constructs are defined by stdlib protocols, and lowered per backend

The principle behind everything in this section. A surface construct -- `for :each`, a generator,
`async`/`await`, and later `with`/`?`/custom deconstruction -- is **not** a hardcoded thing the code
generator knows how to emit. It is **defined by an interface in the stdlib**, and each backend
**lowers that interface its own way**.

```
  construct        protocol (stdlib)         JS lowering          LLVM lowering (future)
  ---------        -----------------         -----------          ----------------------
  for :each        Iterable<T>/Iterator<T>   for...of             vtable calls + loop
  :gen / yield     Iterator<T>               function* / yield    coroutine intrinsics
  async / await    Awaitable<T>              async / await        state machine
```

This was learned from the failure it prevents. `for :each` was hardcoded to emit `for...of`, with **no
protocol behind it** -- so the type checker could not read an element type (the loop variable was
Unknown, an inference gap measured on the `__ll_member` thermometer), a **user type could not be made
iterable at all**, and the construct could never move to another backend without rewriting codegen.

The insight that makes this cheap rather than heroic: **on a JS target the runtime already IS the
protocol.** `for (x of coll)` literally calls `coll[Symbol.iterator]()` then `.next()`; `function*`/
`yield` is a generator; `async`/`await` is a Promise state machine. So "desugar onto the protocol" does
NOT mean rewriting `for :each` into a `while (next …)` loop -- that would uglify the JS, slow it down,
and move every golden for no reason. It means the construct's **semantics** are the protocol, and its
**JS lowering** happens to be the native form. The reframe matters, because the *wrong* reading of
"desugaring" produces worse output than the thing it replaces.

The C# framing -- "`await` is sugar over the `Task<T>` state machine, `foreach` over
`IEnumerator.MoveNext`" -- is the right **mental** model and the wrong **implementation** model for a
JS target. C# lowers to state machines because IL needs them. On JS, the runtime provides them; l-lang
should **lean on the target's primitives**, not reimplement them. The value l-lang adds is the
**type-level protocol** (so the checker can reason, and user types can participate), not the machine.

The protocol lives at the language level precisely SO THAT it survives a backend swap. A future LLVM/HIR
backend has all the building blocks -- vtable dispatch for the interface, `llvm.coro.*` intrinsics for
generators -- and lowers the *same* `Iterable<T>`/`Iterator<T>` differently. The desugaring is written
once, against the protocol; only the leaves change.

## D30 — the iteration protocol: `Iterable<T>` / `Iterator<T>`

The first protocol under D29, in `lib/std/iter.lisp`:

```lisp
(definterface Iterator<T>
  (fn next [] -> T?))          ;; the cursor: next element, or nil when exhausted

(definterface Iterable<T>
  (fn iterator [] -> Iterator<T>))   ;; the source: a FRESH cursor each call
```

**`next` returns `T?`, and `nil` means done** -- not a `{value, done}` record. That folds onto D9: the
same optional, the same forced-unwrap, the same flow-narrowing already in the language. A consumer
writes `(let v (next it))` and D9 narrows `v` to `T` after the nil-check, with no new machinery. On the
JS backend the `T? ↔ {value, done}` bridge is the code generator's job (it lands with generators), not
the protocol's.

**`iterator` yields a FRESH cursor per call**, so a source can be walked more than once. A generator or
a one-shot stream can of course return a cursor that is already spent after one pass; the interface
does not forbid it, but a collection must not.

### `for :each` is defined by this protocol

```
(for :each x :from coll :then body [:else e])
```

requires `coll : Iterable<T>` and binds `x : T` in `body`. **Conformance is by interface** (the ruling):
a user type declares `:implements Iterable<T>`. The built-in collections are blanket conformers, exactly
as arrays implement `IEnumerable` in C# and slices implement `IntoIterator` in Rust:

| collection | element `T` |
|---|---|
| `T[]` | `T` |
| `String` | `Char` |
| `Map<K,V>` | `[K, V]` (a key/value pair) |

Gradual, as everywhere: an **Unknown** collection binds `x` as Unknown and reports nothing; a **known
non-iterable** (`(for :each x :from 5 …)`) is a diagnostic.

### What this ruling does NOT yet do

The interfaces are DEFINED here (Ita) and `for :each` types its element against them (Itb). Two things
are explicitly the *next* phase, because they arrive together:

- **generators** (`:gen` + `yield` → `function*`), the first non-native `Iterable`, and
- **user-type conformance in the JS `for...of` lowering** -- wiring a user `iterator()` to
  `[Symbol.iterator]` and bridging its `next() -> T?` to JS's `{value, done}`.

Until then, native collections flow through the protocol (via `for...of`, which already is the
protocol) and user `:implements Iterable` type-checks but is not yet consumable by `for :each` codegen.

> **Refined by La (D33):** `Iterator<T>` was later declared `:implements Iterable<T>` -- a cursor
> iterates as itself (JS, Rust, Python), which is what lets lazy operators chain (`map` returns an
> `Iterator`, `filter` wants an `Iterable`). The code block above shows the original two interfaces; the
> live `std/iter` has the `:implements` clause.

## D31 — generators: `:gen` + `yield`

A generator is a function that produces a **sequence** by suspending, under D29/D30. The second
protocol construct, and on the JS backend it is nearly free: `:gen` lowers to `function*`, `yield` to
`yield`, and a `function*`'s result object is *already* iterable, so `for :each` drives it through the
existing `for...of` -- no bridge.

```lisp
(fn :gen count-up [n <- Int] -> Iterator<Int>
  (mut i 0)
  (while (< i n)
    (yield i)              ;; produce i, SUSPEND, resume here on the next pull
    (i := (+ i 1))))

(for :each x :from (count-up 3) :then (console.log x))   ;; 0 1 2
```

### `yield` is not redundant with `return`, and here is why

They are different operations: **`yield` produces-and-suspends, `return` produces-and-terminates.** A
function has ONE exit; a generator has MANY suspension points. "yield 0, then 1, then 2" has no
`return`-based expression -- `return` on the first pull ends the function and never resumes. So the
multi-yield case, which is the whole point, requires `yield`. Collapsing `return` into an implicit
yield would help only the degenerate single-value generator, and it would cost the early-exit meaning
of `return` and invert the JS lowering (l-lang `return` → JS `yield` reads as nonsense).

### The rules (C#'s model, chosen deliberately)

| | inside a `:gen` function |
|---|---|
| produce a value | **`(yield x)`** -- the only way. `(yield)` yields nil. |
| stop early | **`(return)`** -- valueless. Ends the sequence. |
| `(return x)` with a value | **error.** Its value has no place in the sequence; silently discarding it (JS/Python) is the trap C# avoids by forbidding it. |
| implicit return of the tail | **suppressed.** A generator's tail value is not a sequence element. |

And because `:gen` is EXPLICIT (the ruling), two consistency checks fall out:

- **`yield` outside a `:gen` function is an error** -- you are not in a generator.
- **a `:gen` function with no `yield` is a warning** -- an empty generator is almost always a mistake.

### The return type is the full `Iterator<T>` (the ruling)

```lisp
(fn :gen f [] -> Iterator<Int> ...)     ;; the honest type; `yield x` is checked against T
```

Not `-> Int` "meaning yields Int". The annotation is *always* the real type -- the less surprising
rule -- and the compiler **errors on a non-`Iterator` return type** for a `:gen`. A called generator's
object is both iterator and iterable (JS `function*` gives exactly that), so `-> Iterator<Int>` flows
straight into `for :each`, which needs `Iterable<Int>` -- the protocol clicking together.

### What Ga ships, and what Gb owes

**Ga**: the `:gen` modifier, the `function*` lowering, `yield` codegen, and `for :each` over a
generator end to end (a generator is natively iterable, so that already runs). **Gb** (done): the
diagnostics that enforce the rules above -- `yield` outside a `:gen` (LL0222), a value-`return` inside
one (LL0223), a non-`Iterator` return type (LL0224), a `yield x` whose type is not the declared `T`
(LL0225), and a warning for a `:gen` that never yields (LL0226). **Gc** (done): a `[Symbol.iterator]()`
method is injected on any `:implements Iterable` type, delegating to the runtime `__ll_js_iter`, which
adapts the user's `next() -> T?` to JS's `{value, done}`. So a hand-written iterable drives `for...of`
too, and Itb's user-conformance path is consumable end to end. A generator needs none of it -- a
`function*` is already a JS iterable.

## D32 — async/await: the `Awaitable<T>` / `Task<T>` protocol

The third construct under D29, in `lib/std/async.lisp`. On JS it is nearly free -- `:async` is already
an `async function`, `await` an `AwaitExpression` -- so unlike generators, the *runtime* was live from
the start. What was missing is the TYPE layer, and that is the point of this ruling.

```lisp
(definterface Awaitable<T> (fn then [on-fulfilled] -> Any))   ;; a thenable -- what await consumes
(definterface Task<T> :implements Awaitable<T>)               ;; the standard awaitable; on JS a Promise<T>
```

### The shape mirrors generators (D31) exactly

| | generator (`:gen`) | async (`:async`) |
|---|---|---|
| declared type | `Iterator<T>` (the full wrapper) | `Task<T>` (the full wrapper) |
| produce | `(yield x)` -- x checked against `T` | `(return x)` -- x checked against `T`, the PAYLOAD |
| consume | `for :each` / `next` unwraps to `T` | `(await e)` unwraps `Task<T>` to `T` |
| the keyword's scope | `yield` only inside `:gen` | `await` only inside `:async` |
| wrong wrapper type | non-`Iterator` return → error | non-`Task`/`Awaitable` return → error |

The one asymmetry worth stating: a generator's `yield x` is checked against the element `T`, and an
async's `(return x)` is *also* checked against `T` -- the Task's PAYLOAD, not the wrapper. So
`(fn :async f [] -> Task<Int> (return 5))` is correct: `5` is the `Int` the Task resolves to. Checking
the return against `Task<Int>` (which is what the checker did before this ruling) is a **false
positive** -- it reported LL0213 on every annotated async function.

### The rules (Ab enforces them)

- **`(await e)` unwraps.** If `e : Task<T>` / `Awaitable<T>` / `Promise<T>`, then `(await e) : T`. The
  three names are one thing on JS (Promise is the native awaitable); the checker treats them alike.
- **`(return x)` in an `:async` produces the payload.** Checked against `T`, not `Task<T>` -- the fix
  for the LL0213 false positive.
- **`await` only inside an `:async` function** -- an error otherwise (l-lang does not do top-level
  await). Mirrors `yield` outside `:gen`.
- **an `:async`'s declared return type must be `Task<T>` / `Awaitable<T>`** (or absent, left to
  inference). A non-awaitable is an error.

### What Aa ships, and what Ab owes

**Aa** (this): the two interfaces and this ruling. No behaviour change -- the runtime already worked;
the checker is untouched, so the LL0213 false positive is still live until Ab. **Ab** (done): the `await`-unwrap
inference (a case in inferExpressionType), the payload-return check (checkReturns unwraps `Task<T>` to
`T` for an async, fixing LL0213), the `await`-outside-`:async` error (LL0227), and the non-awaitable
return-type error (LL0228). The last two live in `checkAsyncRules`, which runs for every function --
the await-outside rule is about the NON-async ones -- exactly as `checkGeneratorRules` does for yield.

## D33 — LINQ: the lazy sequence library (`std/linq`)

The first real *consumer* of the D29 protocols. The operators a query language needs -- `map`, `filter`,
`take`, `zip`, `enumerate`, the C# LINQ steal -- are now **pure stdlib**, in `lib/std/linq.lisp`, with no
new language construct: they are ordinary `:gen` functions over the iteration protocol (D30/D31). Three
rulings make them what they are.

### The surface is the PIPE, not method-chaining

`(coll |> (map f) |> (filter p) |> (take 3))`. The infix `|>` threads the collection as the FIRST
argument of each stage, so the chain desugars to `take(filter(map(coll, f), p), 3)` -- left-to-right,
and type-checked (a pipeline types as its final stage's return; the desugarer feeds one tree to both the
checker and codegen). That "the pipe works and is typed" is itself a correction: DECISIONS' own earlier
"the desugarer is abandoned, incomplete, and wrong" is **superseded** -- it was since wired into the
`"desugar"` stage and its codegen rival removed. (Only the *prefix* `(|> a b)` form is still garbage.)

This settles the surface question the phase opened: **l-lang's LINQ surface is the pipe.** `:extension`
-- which lets `(coll.map f)` dispatch to a free `map` -- was unwired when this phase was written; it is
**built now** (compile-time nominal dispatch, D34 / Phase E), and the "runtime-dispatch registry
mirroring `:operator`" guessed here is **wrong** -- an interface cannot be name-matched at run time
(see D34). The working pipe covers the ergonomics regardless. Collection-first is not a concession to
the pipe: it is *also* C#'s `this`-receiver order, so the identical signatures can become extension
methods (D34). A method-chaining LINQ surface is now **BUILT** (Phase N, Na–Ne): the collection-first
operators are marked `:extension` and typed, so `((coll.map f).filter p).take 3).to-list)` chains
method-style over any `Iterable` -- a generator, or `(seq arr)` for a bare array -- **lazily, proven over
an infinite source**. The pipe stays **primary** (this ruling stands); the method surface is the SAME
operators, one definition. A bare array keeps native eager `.map`/`.filter`; a lazy-only op called on one
(`(arr.take 3)`) is **LL0230** with a fix hint (Ne). The four enablers were a chain: interfaces recording
`:implements` (Na, below), the checker typing extension-call results into the node-type channel (Nb),
codegen dispatching on a computed chain intermediate (Nc), and the typed operators + `seq` gateway (Nd).

### Lazy by construction; the uniform cursor (La)

- **Lazy.** Each operator is `:gen` → `function*`, so a chain is a pipeline of generators that does no
  work until a terminal pulls it. `to-list` / `reduce` / `count` / `for-each` are the terminals -- a
  chain becomes a value only when one drives it. `(nats |> (map square) |> (take 3) |> to-list)` over an
  *infinite* `nats` **terminates** and yields `[0 1 4]` -- the falsifiable proof that laziness is real
  (an eager `take` spins on `(while true)` forever).
- **The cursor.** Straight-through operators (`map`/`filter`/`enumerate`/`concat`/`skip`/`skip-while`/
  `flat-map`) consume via `for :each`, which already unifies array/generator/struct through `for...of`.
  The **early-exit** ones (`take`/`take-while`/`zip`) cannot -- a `for...of` has no `break` -- so they
  pull a raw cursor: `(iter coll)` yields an `Iterator<T>` over ANY iterable (after Gc everything carries
  `[Symbol.iterator]`), `(next it)` advances it, and a `while` stops the instant they are done. `iter`
  and `next` are **runtime builtins** (the `head`/`elem` family in `SYMBOL_MAP`): `iter` reaches through
  `[Symbol.iterator]`, which has no l-lang surface syntax -- the same reason `head`/`elem` cannot leave
  the code generator. `iter` is the exact inverse of `__ll_js_iter` (that adapts `T?`→`{value,done}`;
  this adapts it back).
- **`Iterator<T> :implements Iterable<T>` (La).** A cursor iterates AS ITSELF (JS, Rust's
  `Iterator: IntoIterator`, Python), so `map`'s `Iterator<U>` result satisfies `filter`'s `Iterable<T>`
  parameter and the chains type-check. Pure type-level; the Gc bridge fires on structs, not interfaces.
  **Correction (Na).** This clause was in the source but the type system **dropped it**: `visitInterface`
  built an interface's type from name + generics only, so `Iterator`'s `implementedInterfaces` was empty
  and `isSubtype(Iterator, Iterable)` was always **false** -- the conformance silently never held (no
  `definterface … :implements …` did). Na records it, which fixes interface-extends-interface generally
  and is the foundation the method surface stands on.

### Gradually typed, for now

Like `std/seq`, the operators ship **without** `-> Iterator<T>` annotations. When this phase was written,
call-site generic inference did not exist, so `Iterable<T> -> Iterator<U>` on a free function would only
infer Unknown. It **exists now** (Phase 5, P5b-d), and Phase T spent it on `first`/`last`/`at`. **Now typed (Nd).** The
operators carry `Iterable<T> -> Iterator<...>`, so the method chains resolve hop to hop; element types
stay loose where inference cannot recover them (an element-CHANGING op `map`/`flat-map`, and `enumerate`/
`zip` whose element is a tuple, return `Iterator<Any>`; element-preserving ops keep `Iterator<T>`). The
pipe threads a bare array through them because `isSubtype` treats the iteration protocol nominally and
element-gradually -- an array satisfies `Iterable<_>` (it is iterable), though it is NOT a nominal
conformer for DISPATCH, which is what keeps `(arr.map f)` on native eager array.map. Still gradually typed
and RUN correctly regardless (what laziness needs).

### The `std/seq` boundary (the ruling)

`std/seq` already has `map`/`filter`/`reduce`/`zip` -- collection-**last**, eager, array-only
(`(fn map [op coll] (coll.map op))`), and its `reduce` is `[op init coll]` where `std/linq`'s is
`[coll f init]`. Two `map`s of different argument order looks like a smell; it is a **deliberate
two-convention split**, and the reconciliation is to draw the boundary, not to merge:

- **`std/seq`** -- EAGER, collection-LAST, array-in/array-out. `(map f coll)` runs now and returns an
  array: the classic functional order (Clojure, Haskell), for when you just want the array. Also the
  home of `range` and the total accessors `first`/`last`/`at`/`length`.
- **`std/linq`** -- LAZY, collection-FIRST, pipe-surfaced. `(coll |> (map f))` is a generator that does
  nothing until pulled. `to-list` bridges a lazy chain back to a `seq`-style array.

The two are the same split C# draws between an eager `foreach`/`List` and lazy LINQ. The names collide
but the modules do not: imports are per-file, **no corpus file imports both** (verified), and the ruling
is that a file picks ONE convention -- eager-array (`std/seq`) or lazy-pipe (`std/linq`). Merging them
would force one argument order on both call styles; keeping them distinct serves each. `enumerate`/`zip`
yield 2-element pairs (`[i x]`, `[x y]`) -- typed as TUPLES as of Phase U: `enumerate` is
`Iterator<[Int T]>` and `zip` is `Iterator<[A B]>`, so a consumer's `[i x]` / `[n s]` destructure carries
real element types.

### Phases

**La** (cursor substrate: `iter`/`next` builtins, `Iterator :implements Iterable`), **Lb** (straight-
through `:gen` operators), **Lc** (early-exit + terminals, and the laziness proof), **Ld** (this ruling
and D34).

## D34 — modifier composition: DISPATCH modifiers vs BODY modifiers

Raised by "how should `:extension :gen` interact?". The ruling generalizes past that pair: function
modifiers split into two kinds by **which compiler phase they govern**.

- **DISPATCH modifiers** govern the CALL SITE -- how a call resolves to this function. `:operator` (the
  call `(+ a b)` routes to the overload) and `:extension` (the member call `(x.m a)` routes to a free
  `m`) are dispatch modifiers. They change *how you get here*, not *what runs*.
- **BODY modifiers** govern the EMITTED FUNCTION -- what the definition lowers to. `:gen` (`function*`)
  and `:async` (`async function`) are body modifiers. They change *what runs*, not *how you got here*.

**One dispatch + one body always composes** -- different phases, orthogonal concerns:

- **`:extension :gen`** = a lazy extension method. Exactly C#'s
  `IEnumerable<U> Select<T,U>(this IEnumerable<T>, Func<T,U>)`: the extension routes `(coll.map f)` to
  the free `map`, `:gen` makes its body a `function*`. This is what a method-chaining LINQ surface would
  be built from -- D33 reserves it.
- **`:extension :async`** = an async extension method. Same orthogonality.
- **`:async :gen`** = an async generator (`async function*`, consumed by `for await…of`). Even two body
  modifiers compose here, because `async function*` is a real lowering -- but it needs an `AsyncIterable`
  protocol, a future phase, not built.

The one combination that is **nonsense** is two DISPATCH modifiers on one function (`:operator
:extension`): a call cannot route two ways. That is the only pairing to forbid.

**Status.** All four are built: `:gen` (D31), `:async` (D32), `:operator`, and now **`:extension`
(Phase E)**.

**`:extension` dispatch is COMPILE-TIME nominal — this ruling's "mirror `:operator`'s runtime dispatch"
sketch was WRONG, and Phase E corrects it.** `:operator` dispatches at run time via `__ll_op_registry` +
`__ll_is_type`, which matches a concrete class name on the JS prototype chain — but an interface is not
a JS constructor and never appears there, so `__ll_is_type(anyArray, "Iterable")` is permanently false.
A protocol extension (`self <- Iterable<T>`) could never be name-matched at run time, and protocol
extension is the primary use case. The checker, however, already knows nominal conformance
(`isSubtype` walks `:implements`), and member access already resolves statically when the type is known.
So `(x.m a)` lowers to the free call `m(x, a)` at COMPILE time, when x's static type is a nominal user
type lacking a native `m` and some `:extension m` conforms to it — concrete types and protocols alike.
Native members always win; arrays/primitives never resolve (their methods are not modelled), so an
`Iterable` extension never shadows `arr.map`; an untyped receiver falls to `__ll_member` as before.

The **composition** D34 rules still holds, and Phase E demonstrates it: `:extension` (dispatch, call
site) and `:gen` (body, `function*`) touch different phases, so `(fn :extension :gen where [self <-
Iterable<T> pred] ...)` is a lazy filter METHOD — C#'s `IEnumerable.Where` with `yield` — `(c.where p)`
dispatching to the free generator `where(c, p)`. An `:extension` with no receiver parameter is **LL0229**
(it extends nothing). Result typing is gradual for now (the call types as the extension's declared
return); runtime dispatch for untyped receivers (`[Symbol.iterator]` duck-typing / `__ll_name`-keyed
metadata) is a possible later widening, not built.

## D35 — the compilation unit is a PACKAGE, and visibility is package-scoped (Phase M)

`internal` visibility ("like `private`, but module-level") needs a *module* bigger than a file -- else
it is identical to "not exported." So **the module becomes a package**: a set of files declared as one
compilation unit by a `package.yaml` manifest. The same unit C# means by assembly, Rust by crate
(`pub(crate)`), Go by package.

### The manifest and resolution (Ma)

A `package.yaml` is a boundary MARKER, deliberately not a package manager: `name` (the import identity)
and `sources` (the files of the unit). Nothing else -- dependencies, versions, config, authoring are a
later phase, added when a concrete need appears.

```yaml
name: std/linq
sources: ["*.lisp"]
```

`PackageRegistry` scans the lib roots for manifests and answers two questions: a name → its file
(`resolve`, wired into `ModuleResolver` at search-path priority, additive -- an empty registry is a
no-op) and a file → its package (`packageOf`, the seam visibility hangs off). The stdlib is 10 such
packages (`lib/std/X/{X.lisp, package.yaml}`); `(import "std/X")` resolves by NAME now, not path.

### The package is the unit (Mb)

- **Co-processing.** Importing/processing any file of a package processes them ALL and exposes the
  UNION of their exports. `std/linq` spans `linq.lisp` (straight-through) and `linq-early.lisp`
  (early-exit + terminals); one import brings in both, and neither file imports the other.
- **The boundary is the package, not the file.** `checkSymbolVisible` short-circuits when two files
  share a package: siblings see each other's names with no `(export)`/`(import)` between them. That is
  what makes a package a unit rather than a folder.

### The three levels, and `protected`'s removal (Mc)

- **`public`** -- in the `(export …)` list; crosses the package boundary (D20's LL0215/LL0216, now
  package-scoped).
- **`internal`** -- the DEFAULT (unexported): visible to the whole package, not to importers.
- **`private`** -- FILE-scoped (or, for a member, type-scoped): visible only in its own file, below the
  package default. A `:private` top-level name referenced from any other file -- even a package sibling
  -- is **LL0206**, the same diagnostic as a private class member.
- **`protected` is deleted.** It was a no-op (written to reflection metadata, enforced by nothing, like
  `:nullable` before D9), and it is the tool of implementation inheritance -- the part of classical OOP
  that Go and Rust drop outright: a second, hidden contract subclasses couple to. `:protected` is now
  **LL0015** (D4, unknown modifier). `:extends` stays (it has uses), but a subclass across a package
  boundary is a pure public-API relationship; within a package it may reach `internal` -- an honest
  split the package boundary gives for free, which `protected` never did.

### Enforcement is compile/link-time, and lowers per backend (future)

Visibility is a compile-time contract, not a runtime fence -- the CLR enforces `internal` at load only
because it is a late-bound VM. An AOT target enforces it earlier and harder. The manifest is designed to
lower the boundary per backend: on JS the package's public surface becomes `package.json`'s `exports`
field (Node refuses to resolve an unlisted deep import -- real enforcement); on a native backend the
`public` names become the library's exported (`default`-visibility) symbols and everything else
`hidden`/`internal`-linkage, enforced by the linker. Emission is a later phase; the model is settled.

## D36 — typed surfaces: the generic accessors, and native member types (Phase T)

Two long-standing "the stdlib ships Unknown" / "`__ll_member` thermometer" gaps, closed together.

**Call-site generic inference already worked.** The Phase 5 machinery (`unify` / `substitute` /
`instantiateSignature`) solves a type variable from the arguments and substitutes into the return,
optional flag and all -- the gate "a generic `-> T?` produces an optional at the call site" was `pending`
but PASSING, never un-pended. So `first`/`last`/`at` in `std/seq` are now declared `<T> [coll <- T[]] ->
T?` and `(first [1 2 3])` types `Int?` (Ga). The corpus uses them safely, so the new `LL0205` risk did
not fire: `corpus onTests` stayed 0.

**Native member types are a SIDE TABLE, never a nominal `String`/`Array` symbol.** A `String` receiver is
`{kind:"primitive"}` and an `Int[]` is `{kind:"generic", isArray}`; neither carries a `members` list, so
`(s.toUpperCase)` / `(arr.shift)` degraded to Unknown and, in codegen, to `__ll_member`. Introducing a
nominal `String`/`Array` *symbol* is not an option -- it flips every `<- String` annotation to a type-ref
and breaks primitive assignability project-wide (the documented `LL0203` conflict, `js.lisp`). So
`nativeMembers.ts` is a hardcoded table (the member analogue of `inferTotalAccessorType`), keyed by
receiver kind/name + member, consulted by BOTH resolvers -- the checker (a field-read path and a
method-call path) and codegen (`memberKindIn`). A member is a FIELD (its value type -- `length -> Int`)
or a METHOD (its RETURN type only -- never a `() -> R` function type, which would arity-check the args
and fail `csv.split(",")`). For `Array<T>` members the element `T` comes from the RECEIVER. String and
Array only for now; `Date`/`Error` receivers (`:extern` values) are the residual (Ja/Jb).

The consequence: a typed String/Array member access emits a direct `.member()` / `.member` instead of
`__ll_member` -- `std/string` (receivers annotated `<- String`) now emits ZERO. The thermometer's
"genuine JS interop the compiler correctly cannot type" was, for String and Array, prelude work after
all. What remains is `Date`/`Error` interop and the harder inference (array-of-maps element typing, which
needs record types; field-access chains).

## D37 — richer types: tuples and records (Phases U, R)

Two STRUCTURAL type additions, filling the gaps the rest of the type system kept naming. Both are
**codegen-free** — a tuple is a JS array, a record a JS object; every emitter already produces and consumes
them. The whole of both features is grammar + type-system.

### Tuples (`[Int String]`) — Phase U

Fixed-length, heterogeneous, positionally typed. A LEADING `[` is the tuple; arrays stay postfix `Int[]`
(a 1-tuple `[Int]` is legal, and `[Int Int][]` is an array of tuples). Neither frontend parsed a leading-`[`
type before -- a hard parse error. A tuple is **DISTINCT from an array**: `[Int String]` is not an `Int[]`
(that distinction is the point). The one cross-shape rule is ergonomic -- a vector LITERAL, whose fixed
length is lost at inference (`[5 10]` is `Array<Int>`), is accepted against a homogeneous tuple.

The load-bearing piece is **expected-type (bidirectional) inference** (Ue): a heterogeneous tuple value
`[0 "a"]` cannot be BUILT from a literal otherwise (it collapses to `Array<Int|String>`), so a vector
literal in a tuple context -- a `let`/return/yield annotation -- infers element-wise as that tuple.
Destructuring binds element types from the annotation (`[x y] <- [Int Int]` types `x`,`y` as Int), on the
param, `let`, and for-each sites. This is what let `enumerate`/`zip` become honest: `Iterator<[Int T]>` /
`Iterator<[A B]>` (D33, updated).

### Records (`{:name <- String}`) — Phase R

Structural objects. The annotation `{:f <- T}` (colon key + `<-` type arrow, mirroring `param <- Type` and
the `:key value` map literal) already PARSED in both frontends -- it was dropped in the type layer,
converting to Unknown. Records are supported **both** DECLARED (the annotation, and `(deftype Person {...})`)
and INFERRED (a map literal keeps its per-field types, so `{:name "x"}.name` is String with no annotation).

The implementation REUSES the struct machinery: a record's `InferredType` carries the same `members` a
struct does, so the existing member-walk types field access for free (dot `c.host` and colon `c:host`).
Assignability is the first **STRUCTURAL** (non-nominal) rule in the checker: width + depth -- a source
satisfies a target record when it has an assignable field for every target field (`{:a Int :b Int}` ->
`{:a Int}`), recursing per field. Before this, any two records compared equal.

**Reconciliation.** The corpus examples wrote the record annotation WITHOUT the arrow (`{:host String}`),
which never matched the grammar; corrected to `{:host <- String}`. `18_destructuring`'s tuple and record
params now type (it is blocked further on, on aspirational match-destructuring). **Known gap:** a
FULLY-computed field read `(get xs i).name` (no intermediate binding) drops the member -- the `case
"member"` / computed-call path returns the object type; it works via a named intermediate, and is a
distinct fix.

## D38 — diagnostics live in ONE place: the `rules/diagnostics` registry (sub-phases Ea–Ee)

Every compiler diagnostic used to be born at its call site. The imperative ones -- ~50 across five `report*`
helpers in four visitors and `Context` -- each HARDCODED a `("LLxxxx", \`message\`)` literal, so a message
lived wherever it was thrown and the answer to "what is the next free code?" was `grep "LL0"` read carefully.
(The declarative `NodeValidationRules`, LL0001–0022, were already centralized -- they carry their own `test`
predicate -- but they were the exception.) The RULING: an imperative diagnostic is DATA. Its code, severity
and message TEMPLATE live in `rules/diagnostics/`, one category file per emitting domain (`type`, `syntax`,
`codegen`, `module`, `comptime`); the call site supplies only the node and the params. (The `E` in the
sub-phase labels is for *errors* -- unrelated to the older Phase E, `:extension`.)

### The shape

`def(code, severity, message)`, where `message` is a function of typed PARAMS. A visitor reports with
`this.report(TypeDiagnostics.X, node, {…})` (added to `BaseAstVisitor`); the two non-visitors (`Context`,
`JSClassBuilder`) call the free `report(context, def, node, {…})`. `report` builds the same `Rule`
(`test: () => true` -- the check already happened) and hands it to the one sink, `context.results`. No new
error path, codegen-free, not one golden moved.

Three properties are load-bearing:

- **Keyed by NAME, code is a field.** A code legitimately backs several message VARIANTS the checker
  distinguishes but one sentence cannot -- LL0204 is a unary AND a binary "operator not defined", LL0202 an
  assignment AND an assign-BACK mismatch, LL0099 three comptime failures, LL0102 / LL0217 two each. Where two
  sites produced a byte-identical sentence they now share ONE def (a real dedup).
- **Leaf purity.** Params are PRIMITIVES; any type is pre-formatted at the call site (`formatType`). So
  `rules/diagnostics/` imports nothing from the compiler at runtime (all its imports are type-only) -- it
  cannot form a cycle, and a def needing a compiler import would be the design slipping.
- **The declarative rules stay put.** `NodeValidationRules` is a DIFFERENT mechanism (self-checking, not
  call-site-decided), so it is not migrated; its live codes are registered as `EXTERNAL_CODES` so the
  allocator sees the whole picture.

### The gate

`test:diagnostics` is the phase's instrument and its falsifier. It (1) checks registry integrity -- one
severity per code, `LLdddd` shape -- and prints a free-code ALLOCATOR (next-free per band, so a new code is a
lookup, not a grep); and (2) holds a CHARACTERIZATION SNAPSHOT: every probe's raw `(code, severity, text)`,
pinned byte-for-byte. A behaviour-preserving migration is one the snapshot does not move; every phase re-ran
it and it did not. 42 probes cover 23 of the ~40 codes directly; the rest (internal codegen-bug paths,
module-boundary cases needing sibling files) are verbatim-guarded and covered by the codegen/imports suites.

### The finding, and its resolution

LL0015–LL0019 were OVERLOADED: the imperative modifier diagnostics had been numbered independently of the
declarative rules and landed on codes those rules already used (LL0016 was "reserved native modifier" AND
"class must have a name"; LL0017 fired for a duplicate `for` clause AND, twice, for If/When conditions). This
is exactly the collision a registry exists to prevent -- and it predated the registry. The DIRECTION of the
fix was decided by reference-weight: every doc and a live test (`imports.ts`) calls LL0015 the "unknown
modifier" error (the imperative one), and nothing references the declarative meanings by code. So the
imperative codes KEPT LL0015–LL0019, and the five declarative colliders were reassigned to LL0024–LL0028 (the
If/When "condition" pair shares LL0026, as one concept). The `test:diagnostics` overlap NOTE is now empty.
One further follow-up is logged, not taken: the `test:type-errors` `LL02*`-only filter could become
category-based (it may surface currently-hidden diagnostics), and the declarative rules could eventually fold
into the registry too.

## D39 — one frontend, one backend: the PEG and js-legacy are retired (Phase P)

**Ruling:** `grammar_v2` is the only parser and `js-estree` is the only JS emitter. The PEG grammar and the
js-legacy transformer are deleted, not deprecated. "Both frontends must agree" is no longer a standing
constraint on any phase.

D14 already ruled the PEG was the wrong architecture and revived grammar_v2 to replace it, keeping the PEG
selectable "for one cycle so the cutover is reversible with a single flag". This closes that cycle.

### Why now: the receipts

The post-audit adversarial sweep measured what the PEG's scannerless design costs. With no separate lexer,
whitespace alone decides token boundaries, so any construct the grammar does not recognise degrades into an
ordinary identifier and silently re-parses as a call. Measured, not theorised:

| | the PEG does | grammar_v2 does |
|---|---|---|
| `<- uint8[256] [0]` | deletes the initializer, promotes the SIZE to the value, exit 0 (AF-021) | rejects |
| `3+4i` | emits `const c = 3; 4; i;` -> ReferenceError (AF-025) | LL0100 |
| `:where` constraints | silently discards them (AF-022) | cannot parse them (a real v2 gap) |
| colon-paths | mangles to a junk identifier that reaches codegen (AF-029) | rejects at parse |
| `true`/`false` arms | LL0101, blaming the CODE GENERATOR for its own misparse (AF-030) | correct |
| malformed params | `'fn' is not defined` — a core keyword (AF-031) | located error |
| in-block parse errors | mislocates every one to line 1 col 1 (AF-032) | located |

Retiring it deletes seven audit findings outright, one of them silent-wrong-output and one a crash on valid
input. The remaining halves of AF-004 and AF-022 survive as v2-side gaps and are filed as such.

### The PEG was never ahead — it was masking corpus rot

The cutover gate (`test:diff-frontends`) reported `v2-only failure 4 <-- real v2 bugs, must be 0 to cut over`.
The label was wrong. All four were examples written in syntax the language does not have, which only the PEG
accepted, and which the manifest blamed on compiler milestones that would never clear them:

- `18_destructuring:97` — `[(pattern match) (body)]` arms; the ruled form is `(match x { pat => body })`
- `20_scope:68` — `(for :i 0 :< 3 ...)`; D12 made `for` named-clause-only. The same file also carried
  `(Fn [] Int)`, a capital-`Fn` function type that **never parsed on either frontend** and appears nowhere
  else in the corpus — pure aspiration, resident in the corpus for an unknown length of time.
- `02_maps` — colon-paths (see below)
- `02_game_of_life:6` — `(for (let dy :of offsets) ...)`, a for-OF form D12 does not have

Pa modernised all four with **zero compiler changes**, and the gate went to `v2-only 0 / peg-only 0`. The
lesson generalises: a permissive parser does not merely fail to catch rot, it *manufactures* the appearance of
working code, and then the rot gets attributed to the compiler. Every one of those four xfail reasons was
pointed at the wrong culprit.

Removing the PEG also removes a differential oracle. That is an accepted cost: the audit's data says the
oracle's signal had become ~entirely "the PEG is wrong", which is negative value once the verdict is known.

### js-legacy

The same argument, one layer down. `legacy-js` was a second, older JS transformer kept behind
`--language legacy-js` while js-estree took over. js-estree emits every golden, all 173 codegen cases, the
REPL and the stdlib. Nothing measured legacy-js. An unmeasured second emitter cannot serve as the rollback it
nominally exists to provide — no gate would notice if it broke, and none would have. Deleted.

`codegen/llang/` (l-lang -> l-lang) is kept: a different target, not a duplicate emitter.

### Two rulings made alongside

**Colon-path map access is NOT a language feature.** `person:name` / `nested:user:name` were an early mistake
in the examples. Maps use **dot-path** (`person.name`), with `m["my-key"]` for keys dot-access cannot reach
(D13). grammar_v2's rejection was correct all along; the PEG's acceptance was the defect. `02_maps` was
rewritten, not fixed. Any key must work — dashed keys and keys colliding with lexer keywords alike, which
makes AF-044 (v2 rejects `:each`/`:from`/`:step` as map keys) a hard block now that the PEG's accidental
workaround is gone.

**`and` / `or` / `not` are IN.** They do not currently exist — `(and a b)` is `LL0210 'and' is not defined`;
only `&&`/`||`/`!` do. Omitting them from a Lisp-syntax language was a miss, and plenty of modern languages
carry both spellings. The aliases are ruled in; implementing them is its own work item, not Phase P.

### Verification

The falsifier for the whole phase: removing a frontend and a backend cannot change the surviving one's
output, so **no golden may move**. None did. Every phase held goldens 91 / 16 xfail, type-errors corpus 0,
diagnostics 42/42, codegen 173/0, imports 17/17, repl 26/0, smoke 11/11, tsc 0 errors. 12,580 lines deleted.

## D40 — `return` returns from the FUNCTION (Phase Y)

**Ruling:** `return` returns from the enclosing **function**, from any code path, with no positional
caveats. It is not a value, it is not scoped to the nearest expression, and there is no form it means
something else inside. Where the JS backend cannot express that yet, it **refuses** (LL0103) — it does
not quietly do something else.

The mental-load argument is the ruling's whole basis: a language where `return` works in a `cond` clause
and silently evaporates in a `match` arm is teaching a rule that does not exist. There is nothing to
learn here, and that is the point.

### What was measured

Six forms, two behaviours, no stated rule:

| `return` inside | today |
|---|---|
| a `cond` clause | returns from the function ✅ |
| an `if` in statement position | returns from the function ✅ |
| a `when :then` | returns from the function ✅ |
| a **`match` arm** | swallowed ❌ |
| an `if` in **value** position | swallowed ❌ |
| a `\|\|` / `&&` operand | swallowed ❌ |

The split is mechanical, not designed. A form that emits STATEMENTS lets `return` be a real JS
`return`. A form that emits an IIFE — `match`, always; an `if` used as a value; an operand — makes it
return from the ARROW, so the function the user named keeps running and its declared return type is
quietly defeated. The IIFE arrived with P5c's `asExpression`, D25/Xb pinned `cond`'s behaviour under
"the three that must NOT move", and nobody ever wrote down the rule — so the two halves drifted apart
in silence for a year.

The audit found one sixth of this (AF-003 names `||`/`&&` only). `match` arms — the likeliest place in
a Lisp to write a `return` — went unreported, because a swallowed `return` is indistinguishable from a
function that fell through.

### Why refuse instead of implement

Honouring D40 everywhere, without an IR, means statement hoisting: `(let x (if c (return 1) 2))` has to
become `let x; if (c) { return 1; } else { x = 2; }`, and `(f (|| a (return b)) c)` has to hoist above
the call, at arbitrary depth. That is ANF conversion — i.e. **building an HIR badly, inline, without
admitting that is what it is**. Every bug this session came from that exact shape: two mechanisms
answering one question and drifting apart. It belongs in a real lowering path
(desugared typed AST → HIR → ESTree → JS), which is now Phase 6's business.

So the rule is stated in full and the backend refuses what it cannot honour — the project's own
pattern, used twice already: D3/LL0023 refuses `defmacro` by name as "Planned"; Qe refuses the mid-list
rest D28 says is unbuilt. Ruled in, not built, refuses rather than lies.

**LL0103 is temporary by construction.** When the lowering path lands, the def and its two call sites
are deleted and the refused cases start working — so they are also **HIR's acceptance test, written
before it starts**. That is the concrete thing this ruling buys beyond honesty.

Nothing in `examples/` or `lib/` hits it: zero sites, measured. The diagnostic costs no migration.

### Found while measuring, filed not fixed

- **A trailing `cond` returns `undefined`** — `(fn f [x <- Int] -> String (cond ((> x 0) "pos") (true "neg")))`
  yields undefined against a declared `-> String`. Same class as AF-043. Fixed in Yb.
- **`isValueTail`'s comment is two-thirds wrong.** It says "`if`/`when`/`cond` are EXCLUDED", but
  `wrapIfValue` special-cases `if` above it, so a trailing `if` DOES return its branch value. Three
  trailing forms, three behaviours, one comment claiming they are uniform.
- **`BaseAstTreeWalker` mints nodes that lie about their type.** It builds
  `{...super.visit(node), _type: node._type}` — so when a `visitX` returns a node of a different kind,
  the walker spreads that node's fields and stamps the original `_type` back over them. A lambda in
  expression position arrives at codegen as `_type: "list"` carrying a function's entire field set
  (`params`, `returns`, `body`, …). It works only by luck — codegen dispatches on `_type`, reads
  `nodes[0]` (the real function), and never touches the strays. LL0103's scan was the first code to
  read them, and walked straight into the lambda's own `body`.
- **`(x)` on a match-bound lambda does not call it.** `(let direct (fn [] -> Int (return 5)))` then
  `(direct)` gives 5; binding the same lambda through a `match` gives `[Function (anonymous)]`. D1 rules
  `(x)` is a call iff `x` names a function, and inference types `direct` but not a match's result.
  Identical bindings, one calls, one silently hands back the function object.
- **D12 rules `cond`'s default clause is spelled `:else`, and it does not parse.** `ElseModKw` appears
  in the `if`/`when` and `for` rules; `cond`'s rule has no reference to it. The corpus writes
  `(true (return "F"))` with a `;; Default case` comment. A ruling that was never implemented, routed
  around in silence.

---

## D41 — `:of` is a type guard in expression position, and it narrows (Phase Z / Za)

**Ruling:** `(x :of T)` is a **Boolean-valued type guard**. It asks "is `x` a `T`?", the answer is yes
or no, and inside the branch that answer is TRUE it **narrows** `x` to `T`. The narrowing does not
leak past the branch. The spelling is deliberately the **same `:of`** that `match` already uses for a
type pattern — one operator for "is this a `T`", whether it appears in a `match` arm or a bare
expression.

`:of` is the **only** way to test a value's type, and there is no cast. C#'s `x as T` yields `T?` and
then l-lang (like TS) forces you to guard the `nil` — so `as` is two steps to reach what `:of` gives
in one, and it *creates* the awkwardness it was meant to relieve. `(cast<T> x)` is worse still
(D9-optional you are then forbidden to unwrap), and was refused with it.

### What it replaces

`(x :of T)` is the type-guard sibling of the `nil`-guard (D9). Before Za it existed only as a `match`
pattern; the expression-position form is what lets a plain `(if (x :of String) (x.toUpperCase))`
narrow `x` inside the `then`. The grammar admits `:of` anywhere a list can appear, so the AST builder,
not the grammar, is where a `type-guard` node is distinguished from a call.

### The soundness bugs this shipped a path to — and how they were closed

Expression-position `:of` reached `getTypeName`, which **failed open**: a type it could not name (a
union, a tuple, a map) returned `"Any"`, and `__ll_is_type(v, "Any")` matched *every* value —
`(d :of Int | String)` was TRUE for a `Dog`. Za's narrowing then *believed* the lie and bound a `Dog`
as `Int | String`. Fixed in Zc: `getTypeName` returns `undefined` and the caller **refuses** (LL0104)
rather than inventing a name — the `functional-pattern` precedent (*"where the runtime carries no
evidence, leave it dead and say so"*). A union `:of` that IS decidable — `(x :of Int | String)` — is
expanded at the emitter into `__ll_is_type(x,"Int") || __ll_is_type(x,"String")` (Zd), restoring what
Zc refuses, correctly.

---

## D42 — types are nominal, interfaces are structural (the Go model; sub-phases Zf–Zg)

**Ruling:** A class or struct keeps its **identity**: `Dog` is not a `Cat`, however identical their
shapes, and no amount of matching members makes one assignable to the other. An **interface** is a
**shape**: a class satisfies it by having its members, whether or not it declares `:implements`. A
declared `:implements` is not a password — it is a **claim**, and a claim that is false is an error
(LL0209).

An **empty** interface is satisfied by **nothing** structurally. It is a marker, and a marker must be
claimed.

### The contradiction this settles

D5 ruled "full structural typing". The code has been nominal since P7d (`TypeChecker.ts`). **P7d never
overruled D5** — it shipped nominal as the implementation of an inheritance fix (`isAssignable(Dog,
Animal)` returned `false`; everything downstream of inheritance was a type error), never cited D5, and
never argued the case. D5's "→ Phase 8" pointer is dangling: Phase 8 ≠ P8, and that phase never ran.

They were never answering the same question. D5 wanted **shapes to be enough**; P7d needed **identity to
be preserved**. Go's model gives both, because the two questions live on different constructs. D5 stands
for interfaces; P7d stands for classes.

### What was measured

- `visitInterface` **never read `node.body`**. Every interface in the language was `{kind, name,
  generics}` and nothing else — `(definterface Iterable<T> (fn iterator [] -> Iterator<T>))` dropped its
  methods on the floor. So `:implements` was an **unchecked claim**: nothing could disagree with it
  (`methodMappings: new Map() // TODO`). A class could declare `:implements Iterable`, implement none of
  it, and dispatch would still lower `(x.total)` to `total(x)`.
- Nominal **without** verification is the worst cell of the matrix: the tag costs the flexibility of
  structural typing and buys none of its safety, because nothing checks it.
- **F# is nominal.** The ruling was first taken as "full structural" on the belief that F# — the
  functional model being aimed at — was structural. It is not: F#'s `Person1`/`Person2` is exactly
  `Dog`/`Cat` (MS docs). The F# property actually wanted is structural *equality*, which already ships
  as `__ll_deep_eq` + D11. Corrected on the evidence before implementation.

### What follows

- Conformance is checked in the **check pass**, not at collection: an interface may be declared *after*
  the class implementing it, and `:implements` is **erased** at run time (D24), so declaration order
  must not matter to it.
- Both chains are **walked**, not pre-flattened — the interface's `:implements` and the class's
  `:extends`. Flattening at declaration time needs each super collected before its sub, reintroducing
  the order-dependency the symbol table exists to remove. Cycle-guarded, both.
- A member inherited from a **superclass** satisfies an interface exactly as well as one the class
  declares itself: `(s.greet)` dispatches the same either way.
- Structural conformance runs **last** in `isAssignable`, after nominal. It can only ever ADD
  assignability — which is what made it safe to land on a live corpus.
- Member types are compared only when both sides carry a real one. `Any` means "not inferred", not
  "anything goes"; refusing on it would punish a gap in inference rather than a gap in the class. Same
  gradual stance `isSubtype` takes on the iteration protocol's element types.

### Why empty interfaces are refused

Structurally, an empty interface is satisfied by **everything** — `every` over no members is vacuously
true. `[x <- Marker]` would accept any object at all while *looking* like a constraint: silent, and
worse than refusing. Nominal `isSubtype` runs first and answers declared conformance on its own, so
refusing the structural case costs nothing — a marker interface stays usable, it just has to be
explicit.

### Not ruled here

Class↔class and struct↔struct assignability (`typesEqual`) is untouched. `00_errors`' `CustomError` /
`SpecificError` discrimination, `Dog`/`Cat`, and `Point`/`Vec` are byte-identical in shape and stay
distinct — the goldens pin it, and a moved golden here would mean the Go model landed as full
structural.

---

## D43 — Int vs Real is decided statically; the runtime cannot (Phase Z / Ze)

**Ruling:** `Int` and `Real` are **the same value at run time** — JavaScript has one number type and
`5.0 === 5`. So `(x :of Int)` and `(x :of Real)` are answered from the **static type**, folded at
compile time, and **never** handed to the runtime. The one genuinely undecidable case — a value whose
static type is `Int | Real` asked `:of Int` — is **refused** (LL0104), because no test and no static
answer exists even in principle. `Char` and `String` collide identically (`"c"` is both); reflection
on them is static too, though a `:of Char` *test* stays runtime-decidable (length 1).

### Why not a runtime tag

Every avenue was probed and every one fails:

- **A primitive cannot be tagged.** Property assignment, `Object.defineProperty`, `WeakMap`, and
  `Symbol` all throw on a number or string.
- **BigInt** breaks arithmetic, `JSON`, and `Math`.
- **Boxing** (`new Number(5)`) unboxes at the first operator and prints `[Number: 5]`.

There is no run-time evidence to buy, so the compiler does not pretend to. The checker already knows
the type; the answer comes from the checker or it is not taken at all. When the static type is unknown
(gradual typing leaves the channel empty), `:of` falls back to the runtime `typeof` test and `type`
reflection answers `Unknown` — it does **not** guess, because a guess (`Number.isInteger`) would
*contradict* the static type, and two answers to one question is the failure this rules out.

### What follows

The same static-first rule governs `type` reflection (Zi): `(type 5)` folds to `Int` at compile time,
and the six primitives are real entries in `__ll_type_metadata`. `case 'float'` in `__ll_is_type` was
deleted as dead code — `Float` is not one of the six l-lang primitives (Int, Real, String, Char,
Boolean, Void).

---

## D44 — an annotation must name a type that exists (Phase Z / Zk)

**Ruling:** A type annotation naming a type that does not resolve is an **error** (LL0231), not a
silent `Unknown`. The check is the type-level twin of LL0210's unresolved *identifier*, and an Error
for the same reason it is.

### Why it is not cosmetic

`Unknown` is assignable **to and from everything**. So an annotation naming a type that does not exist
does not merely lose information — it **turns checking off** for that declaration, while looking
exactly like a declaration that is checked. A typo buys *less* safety than writing nothing, and says
nothing about it. `convertAstTypeCore` had fallen through to `Unknown` here for as long as the check
existed, with a standing comment that the diagnostic was owed but blocked on scope-and-import
resolution (P6). That blocker is gone.

### What it measured, and the rule for spelling

Thirteen corpus sites across five files, every one real: `Number` (×7), the lowercase literal `nil`
used as a return type (×4), `Bool` (×1), `Nil` (×1). All were **canonicalized to the types the corpus
already has** — `Bool`→`Boolean`, `Number`→`Real`, `nil`/`Nil`→`Void` — rather than importing
`std/types`, which holds only aliases (`Number = Int | Real`, `Bool = Boolean`, `Str = String`). A
second spelling of a type that already exists earns its keep only if it says something the first does
not; `Bool` and `Str` do not, and D21 already rejected the Scheme spellings on the same ground.

### What it exposed

Two latent bugs `Unknown` was masking surfaced the moment the annotations resolved — the same shape as
Zic's dead-code type test: a genuine `Array<String | Real>` / `[String|Real, Boolean|Void]` return
mismatch (LL0213) in a whitespace example, and **three async/generator negative tests passing
vacuously** — `silent` because `Task<Int>` / `Iterator<Int>` resolved to `Unknown` and nothing could
be checked, not because the type was right. A diagnostic that makes vacuous "it type-checks" tests
impossible is doing exactly what it is for.

## D45 — the HIR prototype: a typed post-typecheck IR, destination-driven (Phase 6, prototype)

D40 named the fix and deferred it: "a real HIR / ANF lowering pass ... explicitly deferred to a future
phase." This is that phase, done prototype-first. There is now a typed intermediate representation
(`src/compiler/hir/`) between the typed AST and ESTree, and the conditional cluster plus operand
hoisting lower through it. As of S5 the HIR is the **default** codegen path; the direct AST→ESTree
emit survives as the `--no-hir` fallback.

### The shape, and the two designs that lost

The brief walked in with two candidate designs (§6 Q1). **Position-tagging** — annotate each AST node
with statement/value position and hoist only what must — lost. The prior art is decisive: ClojureScript's
`:context` tags smear the decision across ~40 emit sites and still fall back to an IIFE for every
non-`if` form, leaning on Google Closure to clean up after; PureScript shipped optional types in its
CoreFn IR and *deleted them* in 2023 when they rotted from disuse. Both are the cautionary tale for
"reuse the AST, tag it."

What won is the **Kotlin/JS-IR shape**: a distinct, two-sorted (statement/expression) node family
whose datatype *is* the invariant — control flow exists only in statement position, a value-position
conditional carries an explicit temp, every node carries its type (mandatory, from the checker's
channel, `undefined` only where the checker itself did not know). The lowering that fills it is
**destination-driven** (ReScript's `continuation` ≙ Dybvig's DDCG ≙ rustc's `expr_into_dest`):
`lower(node, dest)` threads a destination — `effect | value | assign(temp) | return` — down the tree
and returns `{stmts, value}`. One mechanism subsumes three of the emitter's ad-hoc lowerings:
tail-return injection (`withTrailingReturn`), value-position control flow (`asExpression`'s
ternary/IIFE), and dead-code-after-return. A ternary is kept as a **peephole** on the pure-arm case, so
the common output is byte-identical to before; the temp path fires only where the old output was an
IIFE or an LL0103 refusal. **No IIFEs in the new path** — the field's universal lesson is that every
compiler that migrated went *from* IIFEs *to* destination-assignment, never the reverse.

### Where it runs, and the one non-obvious boundary

The lowering is a Context stage (after the type channel is published, before codegen), but it is
**consumed at the `visitFunction` body seam**, not by replacing the whole emitter. Unmodelled
constructs are opaque leaves handed back to the *same* legacy visitor instance, so no node is visited
twice and all its accumulator state (inlined symbols, operator registrations) is filled exactly once.
The **program top level is deliberately not lowered**: codegen's function-form choice keys off scope
*depth* (`this.scope[1] === program` decides declaration-vs-arrow), and a lowered top-level construct
would drop an intermediate scope level; a function body always keeps its own function scope on the
stack, so the invariant holds there and only there. Promoting the pass to own the whole tree is R2's
job, once the opaque set has shrunk to nothing.

Patterns are **reused, not re-modelled**: a `match` arm's condition is still built by the legacy
`generateCondition`, and the pattern-variable list by `findIdentifiersToDefine`, reached through two
narrow emitter hooks. Re-modelling patterns as HIR operand shapes is R2.

### What it retires (in behaviour, on the default path)

- **The value-position IIFE**, for `if`/`when`/`cond`/`match` used as a value — replaced by a temp
  assigned in each branch, or a ternary when the branches are pure. Retires CF1/CF3.
- **The always-IIFE `match`.** A `match` was the one form *always* compiled to an arrow, which is why a
  `return` in an arm always returned from the arrow, not the function — D40's worst case. It now lowers
  to a scrutinee temp + a hoisted block scope + an if/**else** chain (the else-chain is load-bearing:
  a pattern test binds as a side effect, so a later arm's test must not run once one matched).
- **The LL0103 refusal**, for a `return` in a value-position `if`, a `||`/`&&` operand, or a `match`
  arm — the return now lowers to a real return from the function (D40 honoured). The diagnostic and its
  refusal are still reachable via `--no-hir`, and the three `expectDiagnostic: /LL0103/` cases plus the
  diagnostics probe are pinned to that path so they characterize the fallback; the positive is asserted
  by the `hir: true` acceptance cases (codegen A2/A3/A4).
- **Dangling-else (CF2).** Every HIR `if` arm is emitted braced, so `braceIfDangling` has nothing left
  to guard on the HIR path.
- **New capability:** `yield` inside a `match` arm (impossible under the legacy arrow — `yield` in an
  arrow is a SyntaxError).

### The finding it surfaced

`uniqueIdentifier()` (`src/compiler/utils/uniqueIdentifier.ts`) **never writes its incremented counter
back** — every call returns `__ll_<prefix>_1`. The legacy match IIFE hid the collision by giving each
match its own arrow scope; de-IIFE-ing removes that shield, which is *why* the HIR owns a working
per-pass `TempAllocator` rather than reusing it. The bug is still live for the legacy path (match
scrutinees, catch temps, the inliner); logged here, not fixed in this phase (scope discipline).

### Retirement map, and the parallel-run policy

Nothing in the legacy emitter is **deleted yet** — every helper is still live for `--no-hir` and for
the positions the prototype does not traverse (vector/matrix elements, `for`/`while`/`try` internals,
class-field initializers, the program top level). Deleting early would reintroduce the divergent-copies
bug in reverse. The cuts are scheduled by requirement:

- **R2 (operands, the big cut):** `asExpression`'s IIFE + refusal branch, `refuseReturnInExpression`,
  the LL0103 definition and probes, `braceIfDangling`, the legacy `visitMatch` body,
  `withTrailingReturn`/`withTrailingReturnIn`, `--no-hir` and the flag itself.
- **R3 (stores):** `asValue`/`asValueEach`/`needsValueCopy`/`provablyNotAStruct`/`parameterCopyPrologue`
  and the scattered copy sites, once copy insertion is an explicit HIR pass.
- **R4 (dispatch):** `computedExtensionCall`/`extensionFor`/`receiverConformsTo` and the
  checker/codegen double-decision, once dispatch is resolved at lowering.

Until the R2 cut, the legacy path is the **fallback and must stay green in CI** — the dual-mode gate
(`npm test` vs `LL_HIR=0 npm test`) has held for the whole prototype, so behavioural equivalence is
continuously proven, and the fallback goes away *with* the machinery it guards, in one commit.

### What it measured

Six atomic, RED-first steps (S1 plumbing → S2 if/when/cond → S3 match → S4 operands → S5 flip → S6
record). At every step, all suites green in **both** modes: the golden runner (71/0, every example run
behaviourally under the HIR), `test:codegen` (300 cases, 13 of them new `hir: true` acceptance cases),
`test:diagnostics` (46 probes, snapshot **unmoved** throughout — the pins kept it stable), corpus
type-errors at 0, imports, repl. The central migration risk the brief named — golden churn — never
materialised: the golden suite validates by **behaviour** (stdout), so ANF's restructuring is invisible
to it, and the ternary peephole kept the emitted text identical wherever it was already good.
