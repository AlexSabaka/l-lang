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
