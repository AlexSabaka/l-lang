> **ARCHIVED 2026-07-28 — frozen at `376c84a`, not brought current.**
>
> It described itself as *"Draft — consolidating seed. Not yet canonical"* and deferred to
> `DECISIONS.md`, `FLOOR.md` and `STDLIB.md` wherever they disagreed. Two independent audits of its
> halves measured the drift at **37% and 34% of subsections** — 39 commits and 16 rulings after its
> one and only corrections pass, which was itself two days old. D68 through D90 are absent or wrong
> throughout: the `:foo` trichotomy, the metaprogramming tiers, `defattribute`, the in-house comptime
> interpreter, the flat `defmodifier` contract, six stdlib modules, **C becoming the reference
> backend**, the numeric tower, `Ring`, and units of measure.
>
> **Why it is not repaired.** Its most accurate sections verify *because they restate* something else
> — D47, `FLOOR.md` §3.5, `Context.ts`, `regex.lisp`. It was a second copy of the truth in a different
> register, and a second copy decays at the rate the first one changes. It also created a **contested
> normative claim**: §11.4 says *"this is the normative specification"* of the display format, and
> `FLOOR.md` §3.5 says *"this section IS the specification"* of the same thing, in transcribed-
> identical prose, with no rule for which wins.
>
> **What it got right is the reader problem**, stated in its own §0.1: `DECISIONS.md` is ordered by
> *when* a ruling was taken, not by *what* it is about, so a newcomer cannot find anything. The answer
> is a topic index inside `DECISIONS.md` — pointers cannot drift into falsehood the way re-narrated
> prose did.
>
> **One section was extracted** before archiving: Appendix E's prior-art synthesis, which existed
> nowhere else, is now [`docs/spec/PRIOR-ART.md`](../spec/PRIOR-ART.md).
>
> Source comments citing *"RFC-0001 §5.6"* (the refusal of narrowing casts) refer to this document;
> the ruling they actually depend on is **D41** (`:of` narrows) with **D46/B-3** (`defcast` converts).

# RFC-0001 — The l-lang Report

> **A statically typed Lisp that compiles to native code.**
>
> | | |
> |---|---|
> | **Status** | Draft — consolidating seed. Not yet canonical. |
> | **Version** | Describes l-lang as of `376c84a`, 2026-07-26 |
> | **Supersedes** | Nothing. `docs/spec/DECISIONS.md`, `FLOOR.md` and `STDLIB.md` remain authoritative where they and this document disagree. |
> | **Audience** | Anyone who wants to know what l-lang *is* — and why it is that way. |

---

## 0. About this document

### 0.1 What it is

l-lang's design has been decided in unusual detail — seventy-four numbered rulings, most of them
argued from measurement rather than taste. But those rulings live in a 5,900-line ledger ordered by
*when they were made*, not by what they are about. To learn how `match` behaves you currently read
six decisions minted weeks apart, two of which amend a third.

This document is the same language, ordered by topic. It is meant to be read start to finish.

Three things ride together in every section:

- **The rule** — what the language does. This is the bulk of the text.
- **The reasoning** — why, and what was rejected on the way. l-lang's decisions are its most
  interesting property; a spec that hides them is a worse spec.
- **The status** — what is actually built. l-lang is pre-1.0 and a meaningful fraction of it is
  ruled-but-unbuilt. Saying so is not an apology; a specification that cannot be distinguished from
  a wishlist is useless to a contributor.

### 0.2 Status vocabulary

Used consistently, and it always means exactly this:

C is the **sole supported backend** (§13.4); JavaScript is retained only as a differential oracle.
Status is therefore defined against C, with oracle coverage noted separately.

| Marker | Meaning |
|---|---|
| **Built** | Implemented and covered by the example corpus on the supported backend (C), and also runs on the oracle. |
| **Built — C only** | Implemented and covered on C. JavaScript refuses it with a diagnostic, or degrades. A legitimate terminal state, not a gap. |
| **Compatibility-only — JS** | Exists on the deprecated backend and is **refused on C**. Not available on the supported target. |
| **Partial** | Works for the common shapes; known holes, named where they matter. |
| **Ruled, not built** | The design is settled and normative. No implementation yet. |
| **Reserved** | The syntax parses and is rejected with a specific diagnostic, to keep the surface free. |
| **Parked** | Considered, not decided, deliberately not being worked on. See Appendix D. |

> **Why the split.** Under D66 no new work lands on JavaScript, so a feature built on C after that
> ruling can never acquire two-backend coverage. Defining **Built** as "both backends" would have
> made the newest and most important work permanently unclassifiable. Oracle coverage is evidence,
> not a requirement.

### 0.3 Notation

Grammar is EBNF (§3), generated from the parser itself. In running text:

- `code` is literal l-lang or a shell command.
- **`LL0015`** is a diagnostic code; every code cited is real and catalogued in Appendix B.
- **(D42)** cites a numbered ruling; every one is real and indexed in Appendix A.
- *Italics* in a quoted rule mark the operative word.

Code examples are drawn from the example corpus (`examples/`), which is l-lang's test suite — so
every program shown here is one the compiler is checked against, not an idealisation.

### 0.4 How to read it

| If you want… | Read |
|---|---|
| A feel for the language | §1, then §4–§7 |
| To write l-lang today | §2, §4–§10, §12 |
| To work on the compiler | §11, §13, Appendix C |
| To know why something is the way it is | The section that owns it; then Appendix A |
| To know why something *isn't* | Appendix D |

---

## 1. Motivation and design principles

### 1.1 The pitch

Most Lisps are dynamically typed. Most statically typed languages are syntactically heavy. l-lang
takes the position that these are independent axes and that the interesting quadrant — S-expressions
with a real static type system, compiled to native code — is under-explored.

Concretely, it is a language with:

- **Homoiconic syntax.** Everything is a list. There is no statement/expression divide (§4).
- **A type system with teeth.** Nominal types, structural interfaces, real generics, non-nullable
  by default, refinement newtypes. Type errors are fatal, not advisory (§5).
- **Classes that behave like C#'s.** Constructors, single inheritance, interfaces, operator
  overloading, extension methods — not prototype chains (§6).
- **Pattern matching** as the primary conditional construct (§7).
- **Two exception mechanisms.** Ordinary `try`/`catch`, plus a Common Lisp condition system with
  resumable restarts (§8).
- **Coroutines.** Generators and a lazy sequence library built on an iteration protocol (§9).
- **Packages** as the compilation unit, with package-scoped visibility (§10).
- **A native target.** C11 today, with the compiler structured around a typed IR built for it (§13).

It is explicitly a personal language — built for its author's enjoyment, not for adoption. That is
worth stating because it explains several rulings that would otherwise look arbitrary: features get
refused for being *unjustified*, not merely for being hard.

### 1.2 The principles

These are not aspirations. Each was learned by getting it wrong first, and each has visibly changed
the language.

#### Measure, then rule

Rulings are made from evidence. When D53 claimed the corpus needed a certain container primitive,
the claim was checked, found false, and *retracted in place* — the ledger carries the correction
rather than quietly editing history. When a proposal to add glyph synonyms for math operators came
up, the Latin-1 range was banned on a measured encoder-collision ground, not an aesthetic one.

The corollary: a ruling that was never measured is marked as such.

#### "Written and never wired in"

l-lang's signature failure mode, found nine separate times in one audit: code that exists, looks
correct, is never called, and therefore asserts nothing. A scope tree was built that nothing could
read. An `(export …)` form parsed and enforced nothing. A `(call f a b)` form was believed missing
and was in fact present, silently dropping its arguments.

> **Of a claimed feature, do not ask "is it implemented?" — ask "who calls it?"**

This is why the corpus (§13.6) is structured to *execute* everything it compiles, and why a file
that is compiled but never run is classified as asserting nothing.

#### One tree, one truth

The two halves of the compiler must read the same program. A long-lived class of bug came from the
type checker and the code generator disagreeing about what a form *was* — the call-versus-block
rule was independently implemented three times, with three answers. D25 settled the rule; the
implementations were collapsed into one.

#### The floor is a cost, not a convenience

Every operation the runtime provides natively is a place the two backends can silently diverge.
So the set of such operations — the *intrinsic floor* (§11) — is deliberately minimised, and
everything expressible in l-lang is written in l-lang, on top of it. This shrank the native surface
from roughly ninety entries to twenty-eight. Portability then holds by construction rather than by
conformance testing.

#### A golden is derived, never captured

Expected-output files are written by reasoning from the specification, then diffed against the
implementation. They are never generated by running the program and blessing whatever came out.

The reason is concrete: the output format was once JavaScript's, inherited from the first backend
and never actually chosen. A file whose header read *"l-lang has exactly ONE bottom value, spelled
`nil`"* had a golden that said `null` — the specification contradicted by its own test, in the same
file. Capturing output freezes bugs into "expected."

#### Refuse loudly

Where a backend cannot implement something, it emits a diagnostic saying so (**`LL0105`**,
**`LL0106`**, **`LL0107`**, **`LL0108`**). It does not emit code that is subtly wrong. A refusal is
a supported outcome; a silent wrong answer is the one thing the project treats as unacceptable.

---

## 2. Lexical structure

**Status: Built.**

l-lang is read by a hand-written Chevrotain lexer and parser (`src/compiler/frontend/grammar_v2/`).
There is one frontend; an earlier scannerless PEG was retired and deleted (D14, D39).

### 2.1 Identifiers

```
Identifier ::= [a-zA-Z_\u0080-\uFFFF] [a-zA-Z0-9_\-\u0080-\uFFFF]*
```

Letters, digits, `_`, `-`, and any non-ASCII character above U+0080. **Hyphens are identifier
characters**, so `read-line` is one name, not a subtraction. Non-ASCII is deliberately included:
identifiers may be written in any script.

`?` and `!` are *not* identifier characters — they lex as operators. This is a consequence of the
naming ruling (D21): predicates are spelled `is-empty`, not `empty?`, and mutators are spelled
`set`, not `set!`. Scheme's convention was considered and rejected by name.

The colon `:` is reserved (D1/D2/D14). It introduces modifiers, map keys, and enum keys, and can
never begin an identifier.

Keywords are lexed with an `Identifier` fallback, so `iffy` is an identifier and not `if` followed
by `fy`. Keywords are case-sensitive.

### 2.2 Operators

Three distinct sets are involved, and conflating them is a common misreading:

1. **The punctuation alphabet** is closed: `[*+\-\\/^&%$#@!~=|<>?]`. No character enters it from user
   code.
2. **The operator forms with dedicated parsing** — the table below — are closed and longest-match
   (D2/D14). User code cannot introduce a new infix form or precedence; an `infix` facility was
   proposed and rejected (Appendix D).
3. **Overloadable operator names** are *not* a fixed list. Any punctuation-shaped name may be
   declared with `:operator` and dispatched by type (§6.8).

So the *syntax* is closed; the *overload surface* is open over the closed alphabet.

| | |
|---|---|
| Arithmetic | `+` `-` `*` `/` `%` `^` |
| Comparison | `==` `!=` `<` `>` `<=` `>=` |
| Assignment | `:=` |
| Compound assignment | `+=` `-=` `*=` `/=` `%=` |
| Binding / annotation | `<-` |
| Return type | `->` |
| Match arm | `=>` |
| Pipeline | `\|>` |
| Type union / intersection | `\|` `&` |
| Optional | `?` |
| Spread | `...` |
| Range | `..` |
| Wildcard pattern | `_` |

`=` is **not** assignment. It was deleted as an assignment operator (D2) because a single `=` doing
double duty as binding, comparison and mutation is the ambiguity that makes Lisp-with-mutation hard
to read. Assignment is `:=`, a real lexed token.

Note the lexer's negative lookaheads, which make the set unambiguous: `<` does not match when
followed by `-` or `=`; `.` does not match when followed by `.`; `..` does not match when followed
by a third `.`. So `0..2`, `0 .. 2`, and `[a ...rest]` all lex correctly without spacing rules.

### 2.3 Numeric literals

Seven forms lex (D8):

| Form | Example | Lexes | Codegen |
|---|---|---|---|
| Integer | `42`, `-7` | yes | **Built** |
| Float | `3.14`, `1e-7` | yes | **Built** |
| Hexadecimal | `0xFF` | yes | **Ruled, not built** |
| Binary | `0b1011` | yes | **Ruled, not built** |
| Octal | `0o17` | yes (D71) | **Ruled, not built** |
| Rational | `3/4` | yes | **Ruled, not built** |
| Complex | `3+4i` | yes | **Ruled, not built** |

> **Status note.** Only integer and float literals reach code generation. This remains the largest
> single unbuilt area of the language surface: the numeric tower was designed early and deferred
> repeatedly. Every other form lexes and then meets `LL0100` — a named refusal, not a silent one.

**Digit separators (D71).** `_` groups digits in any radix that admits them — `1_000_000`,
`0xDEAD_BEEF`, `0b1010_1010`, `0o1_7`, `1_250.75`. Python's strict rule rather than C#'s: a single
`_` between digit groups, so `_1`, `1_` and `1__0` are not literals at all. The separator is stripped
where the token becomes a node, so nothing downstream knows it existed — which is a correctness
requirement rather than tidiness, since the C backend reads a literal's raw text as the only lossless
copy of a big integer and would otherwise fall back to a value that has already rounded past 2^53.

**The octal disagreement is RESOLVED (D71).** D8 requires the `0o` prefix and rejects C's bare leading
zero as a well-known error source that buys nothing; the lexer used to be `/0[0-7]+/`, accepting
exactly the rejected form and not recognising `0o17` at all. It is now `/0o[0-7]+/`, and `0o17` lexes
as octal and meets the ordinary `LL0100` refusal for the unbuilt numeric tower.

> Removing the bare form was not sufficient on its own. `[+-]?[0-9]+` would then have matched `017` as
> **decimal 17**, so a literal that meant fifteen would quietly start meaning seventeen — one silent
> wrong answer traded for another, which is worse than either alone. A leading zero on a multi-digit
> number is therefore **`LL0030`**, a refusal: the radix is named by a prefix or the number is decimal,
> and a leading zero names nothing.

`**=` is in the same position: D2 enumerated it among the compound assignments, no token was ever
built, and `(a **= 3)` currently parses as a *call* rather than reporting an error. Note also that
exponentiation is spelled `^`, so if the operator is built it should probably be `^=`.

Inside a vector literal, a comma is whitespace: `[1, 2, 3]` and `[1 2 3]` are the same vector (D8).
Commas are permitted, never required, and carry no meaning anywhere in the language.

### 2.4 Strings

Plain strings are double-quoted with backslash escapes: `"a\nb"`, `"say \"hi\""`.

**Prefixed literals (D67).** A letter fused to the opening quote, with no whitespace between:

| Form | Meaning |
|---|---|
| `"…"` | a plain string; escapes are processed |
| `r"…"` | a **raw** string; escapes are *not* processed |
| `f"…"` | a **formatted** (interpolated) string |
| `'"…"` | the formatted string's retained alias |

Interpolated strings embed expressions in braces:

```lisp
(let name "Ada")
(console.log f"Hello, {name}! Next year: {(+ year 1)}")
(console.log '"Hello, {name}! Next year: {(+ year 1)}")   ; the same thing
```

A brace expression may be any expression. Values are rendered by `display` (§11.4), so an
interpolated string prints the same way `console.log` would print the value.

`'"…"` is retained rather than deprecated for an ergonomic reason: `'` and `"` are the same key under
shift while `f` and `"` are not, and `'` is already the quote reader-macro, so `'"` reads as Lisp
shorthand rather than as debt.

A raw string is Python's: `r"\d+"` is the three characters `\`, `d`, `+` where `"\\d+"` would be
needed otherwise, and doubling every backslash is the single largest ergonomic cost of writing regular
expressions as ordinary strings. `\"` still does not *terminate* a raw string and both characters
survive — the one place raw cannot mean "the lexer stops thinking", or a pattern could never contain a
quote at all.

> **A prefix is purely lexical.** What comes out is an ordinary `String` node, so the type checker,
> both backends and every library are unaware one was used. `r"…"` is not a `Regex` value and costs
> nothing anywhere; `std/text/regex` (§12.5) takes `String` patterns exactly as it would otherwise. A
> `Regex` value type with comptime-compiled literals stays available as a later, purely additive
> change — and is newly practical now that the compiler owns its own evaluator (§6.11).
>
> The prefixes `b"`, `p"` and `c"` are held open. `re"…"` is deliberately *not* among them: a raw
> string is what a regex needs, and the engine takes a `String`.

This mechanism is what lets regular expressions exist without a `/pattern/flags` literal, which was
rejected for being unfixably ambiguous with division in a homoiconic reader — see Appendix D. `/` is
never touched and remains division.

### 2.5 Comments

`;` to end of line. There is no block comment form.

By convention the corpus uses `;;` for a line comment on its own line and `;` for a trailing one,
following Lisp practice, but the lexer does not distinguish them.

### 2.6 Reserved words

The following parse and are rejected, to keep the surface available:

| Reserved | Diagnostic | Why |
|---|---|---|
| `defmacro`, `defsyntax` | **`LL0023`** | Macros are out for 1.0 (D3). See §6.9. |
| `:gc`, `:stack`, `:manual` | **`LL0016`** | Native memory-management syntax, reserved by D15/D59 with **no meaning** (§11.6). |
| `:destructor` | **`LL0016`** | Reserved by D15. Unlike the three above it *has* an intended meaning — scope-bound cleanup (§11.6) — but it is not built. |
| `:protected` | **`LL0015`** | Deleted, not reserved-for-later — see Appendix D. |
| `:nullable` | **`LL0015`** | Optionality is spelled `T?` (§5.3). |

Any modifier not on a construct's whitelist is a hard error (**`LL0015`**, D4). There is no "unknown
modifier is ignored" path; an unrecognised modifier is far more likely to be a typo than an
extension point.

---

## 3. Grammar

**Status: Built.**

The grammar below is **generated from the parser**, by serialising Chevrotain's grammar AST
(`npm run grammar:ebnf`, emitted to `docs/inbox/l-lang.grammar.ebnf`). It is therefore guaranteed to
describe the parser that ships, not a parallel document that drifts.

> **Caveat, carried from the generator.** Thirty-one semantic *gates* in the parser are not
> expressible in a context-free grammar. The grammar below is consequently **over-permissive** —
> notably at matrix/vector disambiguation, adjacency chains, and composite identifiers. It describes
> the *shape* of the language, not the exact accepted set. Where this document's prose and the
> grammar disagree about what is legal, the prose is the specification.

An interactive railroad-diagram rendering is generated alongside it by `npm run grammar:diagrams`.

> **Not every special form is a grammar production.** `return`, `throw`, `yield`, `new` and `call`
> have no production below — they parse as ordinary identifier-headed lists and are reclassified
> during AST construction, using the head rule in §4.2. The productions that *do* appear
> (`ifExpr`, `matchExpr`, `tryCatchExpr`, and the rest) are the forms whose internal shape the
> parser must know in order to read them at all.
>
> Two consequences. A form's absence here says nothing about whether it exists. And the grammar is
> **under-permissive** in at least one visible place: `primaryExpr` attaches member suffixes only to
> identifiers, yet `((Vault).reveal)` is valid — it is admitted through the optional head of
> `compositeIdentifier` plus an AST-level rewrite (§4.2).

### 3.1 Productions

```ebnf
program                ::= expression* ;
expression             ::= ( comment | importExpr | exportExpr | variable | functionExpr | classDecl
                           | structDecl | enumDecl | interfaceDecl | typeDefDecl | modifierDefDecl
                           | attributeDefDecl | castDefDecl
                           | macroDecl | whenExpr | ifExpr | condExpr | forExpr | whileExpr
                           | tryCatchExpr | restartCaseExpr | handleExpr | signalExpr
                           | invokeRestartExpr | matchExpr | awaitExpr | spreadExpr
                           | assignmentOrExpr | quoteExpr | nil | boolean | number | string ) ;
assignmentOrExpr       ::= primaryExpr assignmentOp? ;
primaryExpr            ::= ( list | matrix | vector | map | identifier ( ( indexerSuffix | memberSuffix ) )* ) ;
assignmentOp           ::= ( ":=" expression | <PlusEq> expression | "-=" expression
                           | <StarEq> expression | <SlashEq> expression | "%=" expression ) ;
memberSuffix           ::= <Dot> ( <Identifier> | <BareKeyword> ) ;
indexerSuffix          ::= <LBracket> ( expression ","? )+ <RBracket> ;
comment                ::= <Comment> ;
nil                    ::= ( "nil" | "null" ) ;
boolean                ::= ( ( "true" | "#t" ) | ( "false" | "#f" ) ) ;
number                 ::= ( <ComplexNumber> | <FractionNumber> | <HexNumber> | <BinaryNumber>
                           | <OctalNumber> | <FloatNumber> | <IntegerNumber> ) ;
string                 ::= ( formattedString | <RawString> | <StringLiteral> ) ;
formattedString        ::= <FormattedStringStart> ( ( <StringContent> | formatExpr ) )* <FormattedStringEnd> ;
formatExpr             ::= <FormatExprStart> expression? <FormatExprEnd> ;
identifier             ::= ( compositeIdentifier | simpleIdentifier ) ;
simpleIdentifier       ::= ( <Identifier> ( <Colon> <Identifier> )? | <Plus> | <Minus> | <Star>
                           | <Slash> | <Percent> | <Caret> | <Equal> | <Question> | <Exclamation>
                           | <Tilde> | <Pipe> | <Ampersand> | <LAngle> | <RAngle> | "<-" | "->"
                           | "=>" | "==" | "!=" | <OperatorIdent> ) ;
compositeIdentifier    ::= <Identifier>? ( <Dot> ( <Identifier> | <BareKeyword> ) )+ ;
list                   ::= <LParen> expression* ( <OfModKw> type )? ( <Range> expression )? <RParen> ;
vector                 ::= <LBracket> ( expression ","? )* <RBracket> ;
matrix                 ::= <LBracket> matrixRow ( <Pipe> matrixRow )+ <RBracket> ;
matrixRow              ::= ( expression ","? )+ ;
map                    ::= <LBrace> ( ( keyValue | comment ) ","? )* <RBrace> ;
keyValue               ::= ( <Colon> key expression? | <ModKeyword> expression? | string expression ) ;
key                    ::= ( <Identifier> | <StringLiteral> | <BareKeyword> ) ;
quoteExpr              ::= <Quote> ( list | expression ) ;

type                   ::= ( <LParen> unionType <RParen> ( <LBracket> <RBracket> )? <Question>?
                           | unionType ( <LBracket> <RBracket> )? <Question>? ) ;
unionType              ::= intersectionType ( <Pipe> intersectionType )* ;
intersectionType       ::= basicType ( <Ampersand> basicType )* ;
basicType              ::= ( functionType | mapType | tupleType | genericType | simpleType )
                           ( <LBracket> <RBracket> )? <Question>? ;
simpleType             ::= typeName ;
typeName               ::= ( <Identifier> | ( "nil" | "null" ) ) ;
genericType            ::= typeName <LAngle> ( type ","? )+ <RAngle> ;
functionType           ::= "async"? "fn" <LBracket> type* <RBracket> "->" type ;
mapType                ::= <LBrace> ( keyTypeDefinition ","? )* <RBrace> ;
keyTypeDefinition      ::= <Colon> mapKeyType "<-" type ;
mapKeyType             ::= ( identifier | <StringLiteral> ) ;
tupleType              ::= <LBracket> type+ <RBracket> ;

modifier               ::= <Colon> ( <Identifier> | "async" ) ( <LBracket> ( expression ","? )* <RBracket> )? ;
variable               ::= ( "let" | "mut" ) modifier* ( ( vectorPattern | mapPattern | identifier ) )?
                           ( "<-" type )? expression? ;
functionExpr           ::= "async"? "fn" modifier* identifier?
                           ( <LAngle> ( genericParam ","? )+ <RAngle> )?
                           <LBracket> ( parameter ","? )* <RBracket> ( "->" type )? expression* ;
parameter              ::= <Spread>? ( vectorPattern | mapPattern | identifier ) modifier* ( "<-" type )? ;

classDecl              ::= "defclass" modifier* classOrInterfaceName?
                           ( ( <ExtendsModKw> typeRef+ | <ImplementsModKw> typeRef+ ) )* expression* ;
classOrInterfaceName   ::= typeName ( <LAngle> ( genericParam ","? )+ <RAngle> )? ;
genericParam           ::= modifier? typeName ;
typeRef                ::= typeName ( <LAngle> ( type ","? )+ <RAngle> )? ;
structDecl             ::= "defstruct" modifier* typeName?
                           ( ( <ExtendsModKw> typeRef+ | <ImplementsModKw> typeRef+ ) )* expression* ;
enumDecl               ::= "defenum" modifier* typeName? ( ( enumKey | comment ) )* ;
enumKey                ::= <Colon> ( <Identifier> | <StringLiteral> ) ( "=>" expression )? ;
interfaceDecl          ::= "definterface" modifier* classOrInterfaceName?
                           ( <ImplementsModKw> typeRef+ )? expression* ;
typeDefDecl            ::= "deftype" modifier* identifier "<-" type
                           ( <SatisfiesModKw> refinementConstraint )? ;
refinementConstraint   ::= <LParen> expression? <Range> expression? <RParen> ;
macroDecl              ::= "defmacro" <Identifier>? expression* ;
modifierDefDecl        ::= "defmodifier" <Identifier> ( <LBracket> ( parameter ","? )* <RBracket> )? expression* ;
attributeDefDecl       ::= "defattribute" <Identifier> ( <LBracket> ( parameter ","? )* <RBracket> )? ;

importExpr             ::= "import" ( importDefinition ","? )+ ;
importDefinition       ::= ( importSymbols | importSource ) ;
importSymbols          ::= <LBrace> ( symbolAlias ","? )+ <RBrace> "from" importSource ;
symbolAlias            ::= typeName ( <AsModKw> typeName )? ;
importSource           ::= ( <StringLiteral> | identifier ) ;
exportExpr             ::= "export" ( exportAlias ","? )+ ;
exportAlias            ::= ( identifier | typeName ) ( <AsModKw> identifier )? ;

whenExpr               ::= "when" ( <CondModKw>? expression )? ( <ThenModKw>? expression* )? ;
ifExpr                 ::= "if" ( <CondModKw>? expression )? ( <ThenModKw>? expression )?
                           ( <ElseModKw>? expression )? ;
condExpr               ::= "cond" ( comment* condCase )+ ;
condCase               ::= <LParen> ( <ElseModKw> expression
                           | ( <CondModKw>? expression )? ( <ThenModKw>? expression )? ) <RParen> ;
forExpr                ::= "for" ( comment* forClause )+ ;
forClause              ::= ( <InitModKw> expression | <EachModKw> forEachBinding | <CondModKw> expression
                           | <FromModKw> expression | <StepModKw> expression | <ThenModKw> expression
                           | <ElseModKw> expression ) ;
forEachBinding         ::= ( vectorPattern | mapPattern | identifier ) ;
whileExpr              ::= "while" ( <CondModKw>? expression )? ( <ThenModKw>? expression* )? ;

tryCatchExpr           ::= "try" expression? catchClause* finallyClause? ;
catchClause            ::= "catch" catchFilter? expression? ;
catchFilter            ::= <Identifier> ( <OfModKw> typeName )? ;
finallyClause          ::= "finally" expression ;
restartCaseExpr        ::= "restart-case" expression restartArm* ;
restartArm             ::= <LParen> <Colon> <Identifier> vector expression* <RParen> ;
handleExpr             ::= "handle" expression handleClause* ;
handleClause           ::= <LParen> <OnModKw> typeName vector expression* <RParen> ;
signalExpr             ::= "signal" expression ;
invokeRestartExpr      ::= "invoke-restart" <Colon> <Identifier> expression* ;

matchExpr              ::= "match" expression <LBrace> ( comment* matchCase )+ <RBrace> ;
matchCase              ::= pattern ( <WhenModKw> expression )? "=>" expression ;
pattern                ::= ( anyPattern | restPattern | functionalPattern | listPattern | vectorPattern
                           | mapPattern | typePattern | constantPattern | identifierPattern ) ;
anyPattern             ::= <Underscore> ;
functionalPattern      ::= <LParen> pattern* <RParen> "->" pattern ;
typePattern            ::= identifier <OfModKw> type ;
listPattern            ::= <LParen> pattern* <RParen> ;
vectorPattern          ::= <LBracket> pattern* <RBracket> ;
mapPattern             ::= <LBrace> ( mapPatternPair ","? )* <RBrace> ;
mapPatternPair         ::= <Colon> key pattern? ;
restPattern            ::= <Spread> identifier ;
identifierPattern      ::= identifier ;
constantPattern        ::= ( <StringLiteral> | <RawString> | ( "nil" | "null" ) | number ) ;

awaitExpr              ::= "await" expression ;
spreadExpr             ::= <Spread> expression ;
```

### 3.2 Lexical terminals

```ebnf
<Ampersand>             ::= /&(?![=&])/
<AsModKw>               ::= /:as(?![a-zA-Z0-9_-])/
<BareKeyword>           ::= (token category)
<BinaryNumber>          ::= /0b[01]+/
<Caret>                 ::= /\^(?!=)/
<Colon>                 ::= /:(?!=)/
<Comment>               ::= /;[^\n\r]*/
<ComplexNumber>         ::= /[+-]?[0-9]+\.?[0-9]*[+-][0-9]+\.?[0-9]*[ij]/
<CondModKw>             ::= /:cond(?![a-zA-Z0-9_-])/
<Dot>                   ::= /\.(?!\.)/
<EachModKw>             ::= /:each(?![a-zA-Z0-9_-])/
<ElseModKw>             ::= /:else(?![a-zA-Z0-9_-])/
<Equal>                 ::= /=(?![=>])/
<Exclamation>           ::= /!(?!=)/
<ExtendsModKw>          ::= /:extends(?![a-zA-Z0-9_-])/
<FloatNumber>           ::= /[+-]?[0-9]+\.(?!\.)[0-9]*([eE][+-]?[0-9]+)?|[+-]?[0-9]+[eE][+-]?[0-9]+/
<FormatExprEnd>         ::= /\}/
<FormatExprStart>       ::= /\{/
<FormattedStringEnd>    ::= /"/
<FormattedStringStart>  ::= /'"/
<FractionNumber>        ::= /[+-]?[0-9]+\/[0-9]+/
<FromModKw>             ::= /:from(?![a-zA-Z0-9_-])/
<HexNumber>             ::= /0x[0-9a-fA-F]+/
<Identifier>            ::= /[a-zA-Z_\u0080-\uFFFF][a-zA-Z0-9_\-\u0080-\uFFFF]*/
<ImplementsModKw>       ::= /:implements(?![a-zA-Z0-9_-])/
<InitModKw>             ::= /:init(?![a-zA-Z0-9_-])/
<IntegerNumber>         ::= /[+-]?[0-9]+/
<LAngle>                ::= /<(?![-=])/
<LBrace>                ::= /\{/
<LBracket>              ::= /\[/
<LParen>                ::= /\(/
<Minus>                 ::= /-(?![=>])/
<ModKeyword>            ::= (token category)
<OctalNumber>           ::= /0[0-7]+/
<OfModKw>               ::= /:of(?![a-zA-Z0-9_-])/
<OnModKw>               ::= /:on(?![a-zA-Z0-9_-])/
<OperatorIdent>         ::= /[*+\-\\/^&%$#@!~=|<>?]+/
<Percent>               ::= /%(?!=)/
<Pipe>                  ::= /\|(?![=|>])/
<Plus>                  ::= /\+(?!=)/
<PlusEq>                ::= /\+=/
<Question>              ::= /\?/
<Quote>                 ::= /'(?!")/
<RAngle>                ::= />(?!=)/
<RBrace>                ::= /\}/
<RBracket>              ::= /\]/
<RParen>                ::= /\)/
<Range>                 ::= /\.\.(?!\.)/
<SatisfiesModKw>        ::= /:satisfies(?![a-zA-Z0-9_-])/
<Slash>                 ::= /\/(?!=)/
<SlashEq>               ::= /\/=/
<Spread>                ::= /\.\.\./
<Star>                  ::= /\*(?!=)/
<StarEq>                ::= /\*=/
<StepModKw>             ::= /:step(?![a-zA-Z0-9_-])/
<StringContent>         ::= /(?:[^"\\{]|\\["\\/bfnrtu{]|\\u[0-9a-fA-F]{4})+/
<StringLiteral>         ::= /"(?:[^"\\]|\\.)*"/
<RawString>             ::= /r"(?:[^"\\]|\\.)*"/
<ThenModKw>             ::= /:then(?![a-zA-Z0-9_-])/
<Tilde>                 ::= /~(?!=)/
<Underscore>            ::= /_(?![a-zA-Z0-9])/
<WhenModKw>             ::= /:when(?![a-zA-Z0-9_-])/
```

---

## 4. The evaluation model

### 4.1 Everything is an expression

There is no statement/expression distinction. `if`, `match`, `try`, a block — all produce values.
A function body is a list of expressions and yields the last one.

```lisp
(fn classify [n] (
    (if (> n 0) "positive" "non-positive")
))
```

A trailing `if` yields a value (D18); the return goes on each branch, not around the whole form.
This was, in the ruling's own words, *forced rather than chosen* — in an expression language there
is no other coherent answer.

### 4.2 What a list means

**Status: Built.**

`(a b c)` is the entire syntax, so the rule that reads it is the most load-bearing rule in the
language. It was, for a long time, never written down — with the result that the code generator
guessed it, the type checker guessed it again, and the desugarer guessed a third time. D25 settles
it. A list is read **by its head**, in this order:

| Head | Reading |
|---|---|
| A **special form** (`let`, `fn`, `if`, `return`, `match`, …) | That form. Decided before anything else. |
| An **identifier** with ≥1 argument | **Call.** `(g 1)` cannot mean anything else, whatever `g` names. |
| An **identifier** with 0 arguments | **Call if and only if it names a function** (D1). |
| A **dotted member**, `(obj.m)` | **Call**, always — the source wrote `.m`. |
| A **lambda literal**, `((fn [x] x) 21)` | **Call.** |
| A list of exactly one non-identifier element | **Grouping.** `((+ 1 2))` → `3`. |
| Anything else | **Implicit block.** This is the file wrapper and every function body. |

The zero-argument case deserves its own note, because it was reversed once — but only for **bare
names**, not for dotted members.

The original rule was that *every* zero-argument list is a call, including `(x)` for a plain
identifier. That broke nine corpus files and was struck. The settled rule is that `(x)` is a call
**iff `x` names a function**, decided by `x`'s *type*, which the checker knows:

```lisp
(solve-maze)          ;; `solve-maze` is a function -> a CALL
(let n [1 2 3].length)
(let m { :count (n) })    ;; `n` is a value -> a property READ, not a call
```

A **dotted** member is unaffected by that reversal and remains a call unconditionally: the source
wrote `.m`, which is an explicit request to invoke.

#### Why a lambda head can be lifted and a call head cannot

The tempting general rule — *"a head that evaluates to a function is the callee"* — is refuted by
the corpus, fatally:

```lisp
(                        ;; the file wrapper. Its head is `(console.log 1)`: a CALL.
  (console.log 1)
  (console.log 2)
)
```

Every file and every function body is a list whose head is a call. Reading a call head as a callee
turns all of them into "apply the result of the first form to the rest." A **lambda literal** head
has no such collision — a block beginning with a bare lambda literal is a no-op, computing a closure
and discarding it, so nothing is lost by lifting that one shape.

#### `(call f a b)` — the application form

For a callee that is an arbitrary expression:

```lisp
(call (get-fn) 2)        ;; the escape hatch: any callee expression
((get-fn) 2)             ;; a BLOCK -- yields 2, discards the function. LL0220.
```

`((get-fn) 2)` is structurally identical to the file wrapper, so it cannot be ruled an application.
Instead it is *diagnosed*: **`LL0220`** fires when a block computes a function, discards it, and
moves on — which is not a block anyone meant to write.

> **The limit, stated rather than hidden.** Gradual typing forbids reporting on an unknown type, so
> `LL0220` fires only where the head's type is genuinely known to be a function. A checker that
> guessed here would report on correct code, and that trade is the wrong way round.

#### `(expr).member`

A member access on a computed object is a call on that member:

```lisp
((Vault).reveal)          ;; new Vault().reveal()
((mk).method a b)
((0 .. 10).by 3)          ;; the range form in §5.8
```

**How this parses is not obvious from the grammar, and is worth stating.** A `.member` suffix
attaches only to a *name* (`primaryExpr`), so on a parenthesised expression it does not attach at
all. Instead it falls out as a separate **headless composite identifier** — note that
`compositeIdentifier` has an *optional* leading `<Identifier>`, which is precisely what admits a
bare `.member`. The resulting three-part list `[computed-object, headless-.member, …args]` is then
recognised during AST construction and rewritten into the same call-on-member nodes the pipeline
already produces.

So the feature is **built and grammatical**, but it is expressed as a desugaring over a permissive
production rather than as a dedicated one. Reading the grammar alone suggests these forms are
illegal; they are not.

### 4.3 Evaluation order

Arguments evaluate left to right. A block evaluates its forms in order and yields the last.

### 4.4 `return`

**Status: Built.**

`return` returns from the **function** (D40) — not from the enclosing block, expression, or match
arm. This is the C-family reading, and it is the one users expect.

```lisp
(fn find-first [xs p] -> Int (
    (for :each x :from xs :then (when (p x) (return x)))
    (return -1)
))
```

The ruling had a consequence worth recording: rather than emit code that approximated `return`
where it could not honour it, the backend *refused* those cases with a diagnostic. That refusal was
retired once the typed IR (§13.2) made the construct expressible for real.

### 4.5 Declaration before evaluation

**Status: Built.**

> A value must be declared before it is **evaluated** — not before it is *mentioned* (D24).

Types and functions are always forward-referenceable: mutually recursive functions need no
declarations, and a class may name a type defined later in the file. But a *value* may only be
referenced ahead of its definition from a **deferred** position — inside a function body that has
not run yet.

```lisp
(fn f [] (g))       ;; fine: `g` is defined below, and `f` has not run
(fn g [] 42)

(let a b)           ;; LL0219: `b` is evaluated here, and does not exist yet
(let b 1)
```

The obvious version of this rule was wrong, and that is why it is stated carefully. A class *reads*
as a type — forward-referenceable — but has a temporal dead zone like any other binding, so a
reference that actually evaluates it early is an error. **`LL0219`** covers both.

### 4.6 Void

**Status: Built.**

`Void` and `Nil` are the **same type** (D9). In a language where everything is an expression,
"returns nothing" and "returns the bottom value" are one statement: a function that runs off its end
yields `nil` and is declared `-> Void`.

Declaring `-> Void` **binds** (D49a): it suppresses the implicit return, so the function yields `nil`
even if its last expression had a value. Annotating a return type is how you ask for the declared
behaviour, not a comment on the inferred one.

### 4.7 Control forms

**Status: Built.**

`if`, `when` and `cond` take their operands **positionally**. `for` takes **named, order-free**
clauses (D12) — because a four-part loop header with positional parts is unreadable in
S-expressions.

```lisp
(if (> x 0) "pos" "neg")

(when (> x 0) (console.log "positive"))

(cond
    ((< x 0)  "negative")
    ((== x 0) "zero")
    (:else    "positive"))

(for :init (mut i 0) :cond (< i 5) :step (i := (+ i 1)) :then (console.log i))

(for :each x :from [1 2 3] :then (console.log x))

(while (< i 10) (i := (+ i 1)))
```

The `cond` default is spelled **`:else`**. Notably, this was ruled and then not implemented for over
a year — the compiler routed around it in silence, which is exactly the failure mode §1.2 names.

A special form consumes its **whole parent list** (D12). This is what makes
`(if (> x 0) "pos" "neg")` work without extra parentheses.

### 4.8 Pipelines

**Status: Built.**

`|>` threads a value left to right into the next form's **first** argument position.

```lisp
(nums |> (map square) |> (take 3) |> to-list)
```

Three forms are supported on the right of a pipe:

| Form | Meaning |
|---|---|
| `name` | `(name x)` |
| `(name args…)` | `(name x args…)` |
| `(.m args…)` | `x.m(args…)` — a **method** call (D17) |

The method form matters: `(x \|> (.m a))` is `x.m(a)`, not the free call `m(x, a)`. Both readings
are defensible; the source wrote a dot, so the dot wins.

---

## 5. The type system

Type errors are **fatal** (D5). The type checker is a checker, not an annotator: a program with a
type error does not reach code generation.

### 5.1 Nominal types, structural interfaces

**Status: Built.**

> **Types are nominal. Interfaces are structural.** (D42)

This is Go's model, and it resolves a contradiction that sat in the spec for months — an early
ruling had called the whole system structural, which was neither implemented nor, on reflection,
wanted.

- Two classes with identical fields are **different types**. A `Meter` is not a `Kelvin`. Identity is
  by name, which is the entire point of declaring a type.
- An interface is satisfied by **shape**. A class does not need to declare `:implements` to satisfy
  one — if it has the members, it conforms. **`LL0209`** reports non-conformance.
- An **empty interface** is refused. Structurally, everything satisfies it, so it is not a
  constraint; accepting it would let a meaningless annotation look meaningful.

Class-to-class and struct-to-struct assignability beyond inheritance is not ruled, and is not
currently accepted.

### 5.2 Primitive types

**Status: Built.**

| Type | Representation | Notes |
|---|---|---|
| `Int` | wrapping **`int64`** | Two's complement, wraps on overflow (D51) |
| `Real` | IEEE-754 **`f64`** | |
| `Boolean` | | `true` / `false`, also spelled `#t` / `#f` |
| `String` | Unicode **codepoints** | Not UTF-16 code units (D52) |
| `Void` / `Nil` | the bottom value | One type, two names (§4.6) |
| `Any` | the gradual top | |

Canonical spellings are enforced: `Bool` canonicalises to `Boolean`, `Number` to `Real`, and
`nil`/`Nil` to `Void` (D44).

#### Int versus Real is decided statically

**Status: Built.**

The distinction is a **compile-time** one (D43). The runtime is not asked to carry a tag
distinguishing an integer-valued `Real` from an `Int`. Where the checker genuinely cannot decide,
it reports **`LL0104`** rather than guessing.

The consequence users notice:

```lisp
(/ 7 2)      ;; => 3     -- Int / Int is INTEGER division (D49d)
(/ 7.0 2)    ;; => 3.5   -- Real is involved, so it is real division
```

Integer division was chosen because `Int` genuinely means `int64`: having `/` silently produce a
`Real` from two `Int`s makes the type of an expression depend on its values, which is the thing the
static decision exists to prevent.

`truncate : Number -> Int` is the sole door from `Real` to `Int`. `floor`, `ceil` and `round`
return **`Real`**, deliberately — they are rounding operations, not conversions, and fusing the two
is how precision bugs get introduced silently.

#### Bit operators

**Status: Built.**

`band`, `bor`, `bxor`, `bnot`, `shl`, `shr`, `ushr` (D61). `Int` only. Shifts are masked to 64 bits;
`shr` is **arithmetic** (sign-propagating), `ushr` is **logical**. Word spellings rather than
`&`/`|`/`^` symbols, per the naming convention (D21) and to keep `|` and `&` free for type unions
and intersections.

### 5.3 Nullability

**Status: Built.**

Types are **non-nullable by default**. Optionality is spelled `T?` (D9).

| Assignment | Result |
|---|---|
| `nil` → `T` | Refused |
| `nil` → `T?` | Accepted |
| `T` → `T?` | **Widens** — an optional is a superset, not a nil-only slot |
| `T?` → `T` | **Refused** — this is the forced unwrap, **`LL0205`** |

There is exactly **one bottom value**, spelled `nil`. `null` survives only as a JavaScript-interop
alias for the same thing. `none`, `void` and `undefined` are refused by name (**`LL0210`**).

> **A note on the term.** "Bottom value" is l-lang's own usage and is not the type-theoretic one: a
> bottom *type* is uninhabited, whereas `Void`/`Nil` has exactly one inhabitant and is produced by
> ordinary control flow. Read it as *the* unit value — the single thing an expression yields when it
> has nothing else to yield. The phrase is kept because the rulings use it and the property it names
> — that there is exactly one such value, not two — is the point.

> **Why this is stated so firmly.** There used to be *two* bottom values, and they were
> distinguishable: `(== (when false 1) nil)` evaluated to **false**. The language could not detect
> the bottom value it produced itself. Optionality is also a **flag**, not sugar for `T | Nil` —
> because `T?` is a memory-layout decision for the native backend (`T` is a raw value with no null
> check; `T?` is tagged), and a flag is what a layout decision needs to be.

Accessors are split by totality (D9f): an indexer is **partial** and may fail, while `get` is
**total** and answers `nil`. `(head [])` is `nil`, not the empty array — the old answer made "did I
get anything?" unanswerable.

### 5.4 Composite types

**Status: Built.**

These are *type expressions*, written in annotation position (after `<-` or `->`), not standalone
forms:

```
Int[]                              array
Int?                               optional
Animal | Dog                       union
Comparable & Hashable              intersection
[Int String]                       tuple                        (D37)
{ :name <- String }                record                       (D37)
{ :key <- String :value <- Int }   record, several fields
Map<String Int>                    generic
fn [Int Int] -> Int                function type
```

Tuples and records are **codegen-free** — they are type-system constructs over the existing vector
and map representations, adding no runtime cost. One known gap: a fully-computed field read
(`(get xs i).name`) loses the member type.

### 5.5 Generics

**Status: Partial.**

Generics are real — instantiated and checked, not merely parsed.

```lisp
(defclass Box<T>
    (let :ctor value <- T)
    (fn get [] -> T this.value))

(fn first-of<T> [xs <- T[]] -> T? (get xs 0))
```

They are **erased at runtime**: `Box<Dog>` and `Box<Cat>` are one type at run time. This is why
casting to a generic type is refused (Appendix D) — the runtime carries no evidence to check
against, and a cast that cannot be checked is a lie.

> **Known holes.** Two erasure gaps remain: generic constraint checking (`:where T :of Comparable`)
> is a bug rather than a missing feature, and type-argument assignability returns true when either
> side carries no arguments. Array and generic *argument* type-checking is likewise incomplete.

### 5.6 Type guards and narrowing

**Status: Built.**

`:of` tests a value's type, in expression position, and **narrows** the binding in the branch it
guards (D41).

```lisp
(if (x :of Dog) (x.bark) (console.log "not a dog"))
```

There is **no narrowing cast**. `(cast<T> x)` and `x as T` were both refused as *narrowing* forms;
`:of` does the job, and does it soundly. The argument, from a five-lens review of the question, was
that every legitimate use of a C++-style cast already had an l-lang feature covering it.

**Conversion is a different question, and `(cast<T> x)` is now the form it earned (D46/B-3, Built).**
A `defcast` declares a user-defined conversion keyed by *(source, target)* rather than by name:

```lisp
(defclass Celsius (let :ctor degrees <- Real))

(defcast :explicit [c <- Celsius] -> Real c.degrees)   ; fires only where written
(defcast :implicit [c <- Celsius] -> Real c.degrees)   ; the compiler applies it

(let t (Celsius 21.5))
(let as-real <- Real (cast<Real> t))                   ; :explicit
(let also    <- Real t)                                ; :implicit, at a coercion site
```

Every rule of `:implicit` is a refusal, which is the point: `:explicit` never fires implicitly;
conversions never chain, so no amount of declaring makes `A` reach `C` through `B`; **a subtype
relation is preferred**, so a conversion can add assignability but never redirect an existing one
through a user function; exactly one of the two kinds is required (**`LL0241`**); and an `:implicit`
conversion may not *target* a refined newtype (**`LL0243`**), because entering one runs a range check
that can panic, and a conversion that can abort the program must be asked for.

> Implicit conversion needs two halves that ask the same question, or they disagree: the checker must
> admit the pair (consulted **last**, after every nominal and structural answer), and the lowering must
> insert the call. It fires at let-init, return and assignment; the **argument** site is the one
> coercion site not wired, because an argument's destination is the callee's parameter type and needs
> the resolved callee at the call site.
>
> The implementation is smaller than it sounds: a `defcast` is rewritten at parse time into an
> ordinarily-named function, so the symbol table, the checker and both backends treat it as one — no
> emitter work, duplicate pairs collide as an ordinary duplicate declaration, and "does a conversion
> exist?" is a name lookup, which gets *imported* conversions right for free.

`:of` is the value-level test; `:is` is reserved for type-level bounds. They are not aliases.

> **A known limit.** Narrowing is lost on reassignment — a variable narrowed by a guard and then
> assigned reverts to its declared type without a diagnostic. This is logged as a defect.

### 5.7 Refinement types

**Status: Built** — all six boundaries, on `Int` and `Real` bases alike.

A `deftype` may carry a `:satisfies` constraint, producing a **nominal newtype** over a base type.

```lisp
(deftype uint8  <- Int  :satisfies (0 .. 255))   ;; a bounded integer
(deftype Kelvin <- Real :satisfies (0 ..))       ;; open-ended: absolute zero and up

(let x <- uint8 200)
(let y <- uint8 (+ x 55))     ;; uint8 widens to Int for arithmetic, narrows back on binding
(let k <- Kelvin 273)
```

Three properties, each deliberate:

- **Nominal.** Two refined types with the same base and the same bounds are still *different types*.
  This is the units pattern: a `Kelvin` is not a `Meter`, even though both are non-negative `Real`s.
- **Laid out as its base.** A `uint8` is an `int64` at run time; the refinement is a checking
  discipline, not a representation.
- **Checked at boundaries.** A value crossing into a refined type is range-checked at **let-init, a
  parameter, a return, a `:ctor` field, a field with a written initializer, and an assignment**. Both
  `Int` and `Real` bases are enforced; a `Real` refinement gets its own check, because routing a double
  through the integer signature would truncate the very bound being tested.

  > The boundaries split across two compiler stages, and the split is principled rather than
  > incidental. **Coercion sites** — let-init, return, assignment, an explicit cast — are handled
  > during IR lowering, because the destination's type is only known after the types stage: an
  > assignment target carries no annotation at all, so a name-matching desugar structurally cannot see
  > it. **Binding guards** — a parameter and a `:ctor` field — stay earlier, because the value arrives
  > already bound with no expression slot to wrap, and they are callee-side guarantees that hold for
  > callers the compiler cannot see.
  >
  > Compound assignment (`+=` and family) is the one write still unguarded: the check belongs on the
  > *result*, not the right-hand operand. D2 makes `:=` the only assignment operator in any case.

A violated refinement **panics**. It is deliberately not catchable:

```lisp
(let boom <- uint8 256)
;; refinement violated: 256 is outside the declared range
```

The reasoning is that a contract breach is a *bug*, not an error condition — code that recovers from
"this value was supposed to be in range and wasn't" is code papering over a defect. A recoverable
path via the condition system (§8.3) is contemplated but not built.

> **The predicate fragment is decidable, deliberately.** The original design admitted arbitrary
> boolean predicates, on the argument that "it's just running a bool." That was overturned: an
> arbitrary predicate makes refinements undecidable and static checking impossible. The v1 fragment
> is **ranges, finite literal enums, and length ranges**. Runtime function predicates are banned.
>
> A separate, deliberately-unstarted project would discharge refinements *statically* at
> Liquid-Haskell / F* / Dafny grade, reusing this same syntax. It is kept separate on purpose, with
> a stated discipline: a refinement that cannot be discharged runs its check at runtime, full stop.
> The moment the checker begins opportunistically proving predicates, that project has begun without
> a decision to begin it.

### 5.8 Ranges

**Status: Built.**

`..` is a **first-class range value**, not merely refinement sugar — a lazy `Iterable<Int>`.

```lisp
(for :each i :from (0 .. 5)          :then (console.log i))   ;; inclusive, ascending
(for :each i :from (5 .. 1)          :then (console.log i))   ;; descending: step -1 inferred
(for :each i :from ((0 .. 10).by 3)  :then (console.log i))   ;; 0 3 6 9
(for :each i :from ((0 .. 4).exclusive) :then (console.log i));; drops the upper bound
(for :each i :from (0..2)            :then (console.log i))   ;; spacing is free
```

Ranges are **inclusive by default**, with `.exclusive` to drop the top bound and `.by n` to set the
step magnitude (the sign follows the direction). A range is re-iterable — it hands back a fresh
cursor each time — so binding one and walking it twice works. `Int` only, for now.

### 5.9 Protocols

**Status: Built.**

Three interfaces in `std/core/protocols` back language-level behaviour (D63):

| Protocol | Member | Drives |
|---|---|---|
| `Comparable<T>` | `compare-to` | The `(compare a b)` dispatcher, and sorting |
| `Hashable` | `hash` | The `(hash-of x)` dispatcher |
| `Formattable` | `format` | `display` (§11.4), **nominally** |

`hash-of`'s default is djb2, and is explicitly a v1 rather than a final hash protocol.

---

## 6. Declarations

### 6.1 Bindings

**Status: Built.**

```lisp
(let x 42)                ;; immutable binding
(let y <- Int 42)         ;; with a type annotation
(mut counter 0)           ;; mutable binding
(counter := 1)            ;; assignment
(counter += 1)            ;; compound assignment
```

`let` is **binding-immutable**, in Rust's sense (D10): the *binding* cannot be reassigned. It does
not freeze the object a binding points at. **`LL0233`** reports assignment to a `let`. The rule
extends to parameters, which are `let`-like by default.

An annotated binding binds its **declared** type, not its value's type. This matters: annotating is
precisely how you ask for the wider type, and binding the narrower one made the annotation actively
harmful.

Destructuring binds a name or a pattern (D16), in `let`, `mut`, and parameters:

```lisp
(let [a b] pair)
(let {:name :age} person)
```

### 6.2 Functions

**Status: Built.**

```lisp
(fn add [a <- Int b <- Int] -> Int (+ a b))

(fn greet [name <- String] -> String
    (+ "Hello, " name "!"))

(fn identity<T> [x <- T] -> T x)

(let square (fn [x] (* x x)))          ;; a lambda

(fn sum [...nums] (reduce + 0 nums))   ;; spread parameter
```

Types on parameters and returns are optional; the checker infers where it can. Parameter **defaults
do not exist** — the syntax is not there, and the roadmap lists it as a gap rather than a decision.

### 6.3 Modifiers

**Status: Built.**

Modifiers are colon-prefixed and precede the name. Each construct has a **whitelist**; anything else
is **`LL0015`** (D4).

```lisp
(fn :async :public fetch-all [url] -> Task<String> …)
(fn :gen count-up [n <- Int] -> Iterator<Int> …)
(fn :extension words [s <- String] -> String[] …)
(let :ctor x <- Int)
(defclass :internal FoodsController :extends ControllerBase …)
```

Modifiers split into two kinds that compose differently (D34):

- **Dispatch modifiers** change *how the function is found* — `:operator`, `:extension`. Two dispatch
  modifiers on one function is the single forbidden pairing (**`LL0229`**), because they would each
  claim the call site.
- **Body modifiers** change *what the function does* — `:async`, `:gen`, `:memoized`, and any
  user-defined modifier. These stack.

**Arguments are adjacency-gated (D68).** A modifier may take arguments, and the bracket must butt
directly against the name: `:retry[4]` takes an argument, `:public [x]` is a modifier followed by a
separate bracket belonging to the construct.

> Ungated, the argument list was greedy and ate whatever `[…]` came next, which broke three ordinary
> forms. `(fn :public [x <- Int] …)` did not parse **at all**, and `(let :private [a b] pt)` misparsed
> *silently* into `LL0006 Constant variable must have an initializer` — a confident, correctly-located
> diagnostic about a problem the program does not have. Adjacency is the grammar's existing
> discriminator for exactly this shape (`arr[i]` against `arr [i]`), so this is one mechanism applied
> to a second case rather than a new rule.
>
> A declared-but-unsupplied argument is **`LL0033`**, which names adjacency: `:retry [4]` spaced is
> almost always the intent, and without the diagnostic the author gets a parse error some distance from
> the mistake.

### 6.4 The three roles a `:name` can play

**Status: Built (D68, D72).**

`:foo` carried three unrelated concepts under one syntax, and the conflation was the single root of
several separately-reported defects. They are now distinguished by how they are *declared*:

| Role | Declared by | Arguments | Runtime effect |
|---|---|---|---|
| **Modifier** | the language | never | none — it is a fact the compiler acts on |
| **Decorator** | `defmodifier` | yes | wraps the declaration |
| **Attribute** | `defattribute` | yes, **literals only** | none — it is data |

`:foo` is exactly one of the three, enforced: declaring one name twice is **`LL0031`**. They share a
namespace on purpose, so that reading `:tag` at a use site tells you whether it transforms the
declaration or merely describes it.

**A decorator** is a runtime transformer (D3b):

```lisp
(defmodifier memoized [])

(fn :memoized fibonacci [n] …)
```

A modifier must be declared before use; `:memoized` with no `(defmodifier memoized …)` is
**`LL0015`**, not a silent no-op.

**An attribute** is annotation data — it wraps nothing and runs nothing:

```lisp
(defattribute docstring [text <- String])
(defattribute deprecated [])

(fn :docstring["adds two numbers"] :deprecated add [a <- Int b <- Int] -> Int (+ a b))
(defclass :docstring["a widget"] Widget (let :ctor size <- Int))
```

A `defattribute` has a name and typed parameters and **no body** — refused in the grammar rather than
by a diagnostic, because the absence *is* the distinction: a `defmodifier` has a body because it
returns the function it wraps a declaration with, and an attribute is never applied to anything. Its
arguments must be literals (**`LL0032`**), because an attribute is data and data that must be
evaluated to be read is not data.

> **The split is what makes annotations portable.** Both backends decided "is this a decorator?" by
> "is it not a builtin?", and both were wrong about an attribute in opposite directions — C refused it
> outright, while JavaScript emitted a call to a wrapper function that was never written. Attributes
> now work on both backends and on every construct, including a **class**, where a decorator still
> cannot. The decorator is the genuinely hard part and is now the only part that is backend-specific.
>
> Applying a decorator to a class is **not** refused, having been tried and withdrawn on evidence: a
> *pass-through* decorator — one returning `original` unchanged — works, and the corpus contains one.
> Only the *wrapping* shape fails, and which shape a `defmodifier` returns is not decidable in general.
> See Appendix D.

All three roles are discoverable through reflection (§12.2 `std/llang/reflect` / D68, D72): a declaration's `modifiers`
carry each name, its role, and its literal arguments.

### 6.5 Classes

**Status: Built.**

```lisp
(defclass Point
    (let :ctor x <- Int)
    (let :ctor y <- Int)

    (fn to-string [] -> String
        (+ "Point(" this.x ", " this.y ")")))

(let p (Point 10 20))
(console.log p.x (p.to-string))
```

- **Single inheritance**, via `:extends`. Interfaces via `:implements`.
- `:ctor` on a field makes it a constructor parameter — the whole constructor, in the common case.
- `this` refers to the instance.
- **Visibility** is `:public` / `:internal` / `:private` (§10.3).

There is no `protected`. It was **deleted**, not deferred — see Appendix D.

### 6.6 Structs

**Status: Built.**

`defstruct` declares a **value type**: assignment and parameter passing copy.

```lisp
(defstruct Vec2
    (let :ctor x <- Real)
    (let :ctor y <- Real))
```

Structs carry the same member surface as classes — fields, methods, operators, interfaces. An
operator on a struct may not mutate `this` (**`LL0207`**), which would defeat the value semantics.

> **A known divergence.** Pushing a struct into an array copies on the JavaScript backend and
> aliases on C. Value semantics are a language rule, and half-implementing one is worse than not
> implementing it; this is tracked as an open defect (Appendix C).

### 6.7 Interfaces and enums

**Status: Built.**

```lisp
(definterface Shape
    (fn area [] -> Real))

(defenum Color
    :red
    :green
    :blue)
```

Interfaces are structural (§5.1). Enum keys may carry explicit values with `=>`.

**An enum member is a compile-time constant.** `Color:red` folds below the IR to its value — no
lookup, no allocation, and nothing emitted at run time. A member with no explicit `=>` takes its
**ordinal**, including one that *follows* an explicit value: in `(defenum S :ok => 200 :missing => 404
:teapot)`, `S:teapot` is **2**, not C#'s previous-plus-one 405.

> **Enums are describable without being reified (D70).** Because nothing survives compilation, an enum
> was the one declaration kind reflection could not see at all — `(type-by-name "Color")` answered nil
> while every class, struct, interface and function answered a descriptor. A metadata entry now carries
> the name and the members; member references stay folded, so nothing on the hot path changes. This is
> what makes `enum-name-of` — a value back to the name it was written as — expressible at all.

### 6.8 Operator overloading

**Status: Built.**

There are **two ways to declare an operator**, and they differ in arity (**`LL0208`**).

**Inside a type** — `this` *is* the left operand, so a binary operator takes **one** parameter and a
unary operator takes **none**:

```lisp
(defstruct Vec2
    (let :ctor x <- Real 0.0)
    (let :ctor y <- Real 0.0)

    (fn :operator + [o <- Vec2] -> Vec2
        (return (Vec2 (+ this.x o.x) (+ this.y o.y))))

    (fn :operator - [] -> Vec2
        (return (Vec2 (- 0 this.x) (- 0 this.y)))))
```

**At top level** — both operands are parameters:

```lisp
(fn :operator + [u <- Vec2 v <- Vec2] -> Vec2
    (return (Vec2 (+ u.x v.x) (+ u.y v.y))))
```

An operator name is tested by **shape**, not against a fixed list: a name is an operator if it is
punctuation — it contains no word characters. So the set is user-extensible, and the corpus
overloads `+ - * /` and `==`. An operator not defined for the operand types is **`LL0204`**.

**The standard library restricts itself far below what the language allows**, and that restriction
is worth knowing because it is the recommended discipline (D57). Within `std/math`, a type may
overload **binary `+ - * /` and unary `-` only** — the field operations, whose meaning the reals
already fix unambiguously and which complex numbers, rationals and vectors *extend* rather than
redefine. Dot product, cross product, magnitude, comparison and equality are **ASCII method names**
(`.dot`, `.cross`, `.abs`, `.eq`, `.near`), not glyphs.

> **Why the standard library holds that line.** `v · w` for a dot product reads beautifully and is a
> trap on both ends: it enlarges the closed set of head operators the checker recognises, and it
> feeds the identifier encoder a character that does not survive the round-trip.

A glyph synonym — `·`, `×`, `⋅` — may exist, but only as a **member** whose body delegates to the
ASCII method that does the work, and only from **U+2000 upward**. The Latin-1 range U+0080–U+00FF is
**banned** on a measured ground: those characters collide in the encoder. The glyph is never the only
way in, so deleting an entire notation block changes no behaviour.

### 6.9 Extension methods

**Status: Built.**

`:extension` makes a free function callable as a method on its **first** parameter:

```lisp
(fn :extension words [s <- String] -> String[]
    (filter (fn [w] (> (strlen w) 0)) (split (trim s) " ")))

(s.words)          ;; both call the same free function
(s |> words)
```

Dispatch is **compile-time and nominal**, not a runtime registry. Extensions chain, and compose with
`:gen` for lazy extension methods.

### 6.10 Type aliases and newtypes

**Status: Built.**

```lisp
(deftype Name <- String)                          ;; alias
(deftype uint8 <- Int :satisfies (0 .. 255))      ;; refined newtype (§5.7)
```

The `<-` binder is **required**. Without a constraint, `deftype` introduces an alias; with one, a
distinct nominal type.

### 6.11 Metaprogramming

**Status: `:comptime` Built; macros Reserved.**

l-lang has **one** metaprogramming tier built for 1.0, of three that are now specified.

**The three tiers are distinguished by what the handler RECEIVES (D69):**

| Tier | Receives | Job | Status |
|---|---|---|---|
| `:comptime` | nothing | evaluate ordinary l-lang, fold the result | **Built** |
| `defmacro` | a cons list of tokens | rewriting below the grammar | **Reserved** |
| `defsyntax` | a full AST | grammar-native forms | **Reserved** |

`:comptime` marks a function evaluated at compile time (D3c), in the style of Zig:

```lisp
(fn :comptime max [a b] (if (> a b) a b))
```

The call is folded during compilation. A comptime call's arguments must be **literals** — that is
what asking for compile-time evaluation means — and a comptime function that cannot be folded raises
**`LL0099`** rather than quietly declining, because the declaration is deleted from the output
unconditionally and a silent failure would ship a call to a function that no longer exists.

**The evaluator is the compiler's own (D73).** `:comptime` used to be evaluated by lowering the
expression to JavaScript and running it in a `node:vm` sandbox, which made the JavaScript backend the
compiler's *evaluator* rather than merely a target — and is why §13.4's deprecation could not become
deletion. An AST interpreter now does it, and no JavaScript is in the path.

> That change also fixed a live wrong answer nobody had measured. The fold's result came back through
> a JS `number`, so `(inc 9007199254740992)` folded to `9007199254740992` — the `+ 1` silently gone —
> while the same call at run time and the same literal written directly were both exact. Identically
> wrong on **both** backends, which means the differential oracle (§13.6) could not structurally have
> caught it. An `Int` is now carried as an arbitrary-precision integer end to end.
>
> Two rules the sandbox could never have enforced now hold. **Nondeterministic operations are refused**
> at compile time — `Math.random`, `Date.now`, the file and clock entries — because a fold bakes one
> compilation's answer into the artefact, so folding them would make the same source stop producing the
> same program. They remain available at run time; the refusal is about *when*. And a **non-terminating
> fold is a failed compile rather than a hung one**: `vm.runInContext` was called with no timeout, so a
> runaway `:comptime` recursion hung the build with no diagnostic and nothing to interrupt but the
> process. Step and depth budgets end that, and the diagnostic points at the recursive *call* rather
> than the expression that triggered the fold.

The interpreter implements the **floor** (§11) for the deterministic entries, so `Math.cos` at compile
time and `Math.cos` at run time are two implementations of one spec'd contract rather than two
opinions. This is also why the obvious alternative is a mirage: routing comptime through `std/math`
would not have removed any host coupling, because that module's own `cos` is `(Math.cos x)`.

`defmacro` and `defsyntax` **parse and are refused** with **`LL0023`** (D3). Quasiquote and unquote
do not exist. `quote` emits **data**, not an executable form.

> **Why macros are still out.** They were held out of 1.0 deliberately, not for lack of time. A macro
> system interacts with the type system, the module system, and the IR in ways that need to be
> designed against a *stable* version of each — and none of the three was stable when the question
> came up. Reserving the syntax keeps the door open without committing to a design.
>
> The sub-question recorded here as genuinely unsettled — whether a quoted form is a cons-list or an
> AST datum — **is now answered (D69)**. It was unanswerable as posed, because it was posed as
> either/or: it is *both*, and the tier says which. `defmacro` works in tokens because that is the
> level at which rewriting is honest about what it is doing; `defsyntax` works in AST because a
> grammar-native form has to survive typechecking.
>
> The remaining blocker is no longer design but the evaluator's reach: `:comptime` evaluates a subset,
> and a syntax tier needs AST-in/AST-out plus a declaration form. The subset is small because a
> comptime call's arguments are already required to be constants; a macro tier's would not be.

`eval` is likewise refused (**`LL0236`**) on both backends. It compiled to the host's `eval`, which
is not a language feature but an escape from one; a real implementation needs a runtime AST
interpreter and is its own project.

---

## 7. Pattern matching

**Status: Built.**

`match` is the primary conditional construct.

```lisp
(fn analyze-vector [vec] (
    (match vec {
        [1 2 3]      => "One, two, three"
        [1 _ _]      => "Starts with one, of length 3"
        [1 ...rest]  => "Starts with one, of any length"
        []           => "Just an empty vector"
        _            => "Literally anything"
    })
))
```

Arms are tried in order. `match` is an expression and yields its arm's value.

### 7.1 The pattern zoo

| Pattern | Example | Notes |
|---|---|---|
| Wildcard | `_` | Matches anything, binds nothing |
| Constant | `42`, `"x"`, `nil` | |
| Identifier | `n` | Matches anything, **binds** |
| Vector | `[a b c]` | Destructures, fixed length |
| Map | `{:name :age}` | Destructures by key |
| List | `(a b)` | |
| Type | `x :of Dog` | Matches and **binds narrowed** (D27) |
| Rest | `[a ...rest]` | Trailing only, named only (D28) |
| Regex | `r"ca+t"` | **Anchored full match** (D67); see §12.5 |

**Booleans are not constant patterns.** `constantPattern` admits strings, `nil` and numbers, but not
`true` / `false` / `#t` / `#f`, so `(match b { true => … })` is a **parse error**. Match on a boolean
with a guard (`b :when b => …`) or an `if` until this is built.

**A constant pattern's escapes are decoded (D74).** They were not, and the defect is worth recording
because of how long it survived: `constantPattern` sliced the quotes off and stopped, where every
other string in the language is decoded, so one spelling meant two things depending on which side of
the arm it sat on.

```lisp
(== s "\\")                 ; true          -- one backslash, correctly decoded
(match s { "\\" => … })     ; never fired   -- two characters, compared against one
```

> Silent, and invisible to inspection: the arm does not error, it simply never matches, so the form
> falls to its catch-all and produces a plausible wrong answer. Both backends agreed, so the
> differential oracle could not have found it either. It surfaced only when a regex engine needed to
> match on `\` — the first program that must.

### 7.2 Guards

**Status: Built.**

An arm may carry a `:when` guard (D26):

```lisp
(match n {
    x :when (< x 0)  => "negative"
    0                => "zero"
    _                => "positive"
})
```

> **Rejected: predicate-lambda arms.** Allowing an arbitrary lambda as a match arm was proposed and
> refused as redundant — `:when` already covers it, and two spellings for one idea is a cost with no
> return. Likewise the `pattern -> Type =>` type-guard arm form: `:of` patterns already do that job.

### 7.3 Type patterns

`:of` in pattern position both matches and narrows:

```lisp
(match shape {
    c :of Circle => (* 3.14159 c.radius c.radius)
    r :of Rect   => (* r.w r.h)
    _            => 0
})
```

### 7.4 Rest patterns

`[a ...rest]` binds the head and collects the tail. **Trailing only, and named only** — mid-list
rest (`[a ...mid b]`) and anonymous rest (`[a ...]` as a binding form) are not built.

### 7.5 A pattern that is deliberately dead

`functional-pattern` (`(p q) -> r`) parses and never matches. It is left dead **on purpose**, and
said out loud rather than quietly dropped: it may not be meaningfully implementable, and where the
runtime carries no evidence to test against, the honest move is to leave the arm dead and document
it rather than ship something that looks like it works.

---

## 8. Errors, conditions and restarts

l-lang has **two** error mechanisms. Ordinary exceptions, which unwind; and a condition system,
which does not have to.

### 8.1 Exceptions

**Status: Built.**

```lisp
(try
    (risky-thing)
    catch e :of ValueError (console.log "bad value:" e.message)
    catch e :of Error      (console.log "something else:" e.message)
    finally                (cleanup))
```

`throw` raises; `catch` may carry a **type filter** (`catch e :of T`), and clauses are tried in
order. `finally` runs on every exit path — normal completion, an exception, an early `return`, and a
restart transfer (§8.3).

### 8.2 The error tower

**Status: Built.**

`std/core/errors` defines l-lang's own hierarchy, rooted at an l-lang-owned `Error` (D62):

```
Error
├── TypeError
├── RangeError
├── ValueError
│   ├── KeyError
│   └── IndexError
├── ArithmeticError
├── IOError
│   ├── FileError
│   └── NotFound
└── FatalError
```

`Error` is **l-lang's**, not the host's. This mattered more than it sounds: an error type owned by
the runtime is an error type whose layout, name, and inheritance behaviour differ per backend, which
is exactly the divergence surface §11 exists to eliminate. `std/core/errors` is one of the two
ambient preludes (§12.3), so the tower is in scope everywhere without an import.

Errors carry a `cause`, set through the `caused-by` extension, so a wrapped error keeps its chain.

```lisp
(defclass ParseError :extends Error (let :ctor message))
```

Subclassing `Error` from user code works and is the expected way to add domain errors.

### 8.3 Conditions and restarts

**Status: Built — C only.** The JavaScript backend refuses all four forms with **`LL0108`**.

This is the Common Lisp condition system, restricted to a tractable subset (D47). The distinction
from exceptions is that a **handler runs at the signalling point**, before any stack is unwound —
so it can decide to *resume* rather than merely to recover.

Four forms:

| Form | Role |
|---|---|
| `(restart-case body (:name [args] …) …)` | Establishes named recovery points around `body` |
| `(signal condition)` | Raises a condition, **without** unwinding |
| `(handle body (:on Type [e] …) …)` | Establishes handlers, which run in place |
| `(invoke-restart :name args…)` | Transfers to a named restart |

The simplest use — a restart invoked directly, no handler involved:

```lisp
(fn lookup [k] -> Int (
    (restart-case
        (if (== k 1) 100 (invoke-restart :use-default 0))
        (:use-default [v] v))
))

(lookup 1)   ;; => 100   -- the body yields; no transfer
(lookup 9)   ;; => 0     -- transfers; the arm binds v = 0, and its value is the form's value
```

The full arc — a low-level function signals, a high-level handler decides policy, and the recovery
happens back down at the low level where the context still exists:

```lisp
(defclass ParseError :extends Error (let :ctor message))

(fn bad-path [] -> Int (
    (signal (ParseError "bad digit"))
    (return -1)
))

(fn parse-num [ok] -> Int (
    (restart-case
        (if ok 42 (bad-path))
        (:use-default [v] v))
))

(handle
    ((console.log (parse-num true))
     (console.log (parse-num false))
     (console.log (parse-num false)))
    (:on ParseError [e]
        (console.log (e.message))
        (invoke-restart :use-default 0)))
```

That is the property no exception system has: the handler's `console.log` runs **before** the
recovered value is printed, because the handler executes at the signal point rather than after
unwinding to the `handle` form.

Three rules that fall out, each settled by building it:

- **A declining handler falls through to the next clause of the same form**, then outward.
- **`signal` with no handler yields `nil`** and execution continues at the signal point.
- **A restart frame stays armed** after a transfer crosses it, so the next signal is handled too.

> **The hard part, flagged before it was built.** A restart transfer **must** run any intervening
> `finally` blocks. Naive `setjmp`/`longjmp` does not do this, and a skipped cleanup is a silent
> wrong answer. The implementation therefore unified `try`/`catch`/`finally` and the restart
> machinery onto **one** frame stack walked by **one** unwind routine — which makes cleanup
> correctness true by construction rather than by a parallel mechanism that could silently skip it.
>
> Building it surfaced a second, wider bug: the C standard's rule on objects modified between
> `setjmp` and `longjmp` (C11 §7.13.2.1p3) affected plain `try`/`catch` too, silently returning
> stale values at any optimisation level above `-O0`. The corpus had only ever built at `-O0`, the
> one level where the reads happened to work. A permanent `-O2` test fence now exists.

> **Why JavaScript refuses.** Resumption requires re-entering a frame that has not been unwound.
> JavaScript offers no mechanism for this. Rather than approximate it — which would produce
> programs that look right and behave differently — the backend refuses with `LL0108`. This is the
> mirror of the C backend's own refusals (§13.4), and it is the intended design of a
> two-backend language: refuse loudly, never diverge quietly.
>
> Because JavaScript refuses, it cannot serve as the oracle here. All twenty-one conformance
> programs for this feature were derived by hand from the specification.

---

## 9. Coroutines

### 9.1 The iteration protocol

**Status: Built.**

Language constructs are defined by **stdlib protocols**, then lowered per backend (D29). Iteration
is the first and most load-bearing instance: `for :each` is not a builtin with special knowledge of
arrays, it is defined by `Iterable<T>` / `Iterator<T>` in `std/iter` (D30).

```lisp
(definterface Iterable<T>  (fn iter [] -> Iterator<T>))
(definterface Iterator<T>  (fn next [] -> T?))
```

`Iterator<T>` itself implements `Iterable<T>`, so a cursor can be handed anywhere a collection can.
`nil` from `next` **means done** — which is why the element type of an iterator may not itself admit
`nil` (**`LL0238`**).

A third interface, `Disposable`, was added later for cursors holding resources.

### 9.2 Generators

**Status: Built.**

`:gen` makes a function a generator; `yield` produces one value and suspends (D31). The model is
C#'s, not Python's.

```lisp
(fn :gen count-up [n <- Int] -> Iterator<Int> (
    (mut i 1)
    (while (<= i n) (
        (yield i)
        (i := (+ i 1))
    ))
))

(for :each v :from (count-up 5) :then (console.log v))
```

Because a generator computes nothing until pulled, an infinite one is safe:

```lisp
(fn :gen fibs [] -> Iterator<Int> (
    (mut a 0) (mut b 1)
    (while true (
        (yield a)
        (let nxt (+ a b))
        (a := b)
        (b := nxt)
    ))
))

(fibs |> (take 8) |> to-list)     ;; terminates: `take` pulls eight and stops
```

Three rules worth stating, all of them **`LL0237`**–**`LL0239`**:

- A bare `(yield)` with no value is an **error**. (The original ruling had it yield `nil`; that was
  reversed, because `nil` is how an iterator says *done*.)
- A generator's element type may not admit `nil`, for the same reason.
- `yield` inside a protected region (a `try` body) is refused on **both** backends.

A generator value displays as `#<generator name>` — an unreadable object, like a closure, because
its members are a suspended frame.

### 9.3 Lazy sequences

**Status: Built.**

Two collection libraries exist, and this is deliberate (D33):

| | `std/seq` | `std/iter/linq` |
|---|---|---|
| Evaluation | **Eager** | **Lazy** |
| Collection argument | **Last** | **First** |
| Surface | Ordinary calls | The pipe `\|>`, and a method form |

They export colliding names — `map`, `filter`, `reduce` — on purpose. **A file picks one**
(**`LL0230`**). Two conventions is a considered cost; three would be chaos, and one would mean
giving up either laziness or the conventional argument order.

```lisp
(import "std/iter/linq")

(employees
    |> (filter is-eng)
    |> (map name-of)
    |> to-list)

((seq employees).filter is-eng)     ;; the same operators, C#-style
```

Every hop is a generator; nothing runs until a terminal (`to-list`, `reduce`, `count`, `for-each`)
pulls.

> **Rejected: an `infix` facility.** Making the pipe surface generalise into user-declared infix
> operators was proposed and closed. The operator set is closed on purpose (§2.2).

### 9.4 Async

**Status: Compatibility-only — JavaScript; refused on C (`LL0105`).** Async is therefore *not
available on the supported target*, and a program that uses it does not compile natively.

`:async` and `await` follow the `Awaitable<T>` / `Task<T>` protocol (D32). The type layer is
complete (**`LL0227`**, **`LL0228`**).

```lisp
(fn :async :public get-all [query] -> Task<IActionResult> (
    (query
        |> _repo.GetAll
        |> .Skip (* query.Page query.PageSize)
        |> .Take query.PageSize
        |> Ok)))
```

`std/core/async` exports exactly `Awaitable<T>` and `Task<T>` — **no combinators**. There is no
`all`, no `race`, no `delay`. Those are library decisions that need an await-ordering specification
to be meaningful, and that specification is the open part.

> **`:async` on C is a deliberate non-build (D60), not an oversight.** The reasoning: making async
> work on C requires a microtask queue and a top-level drain, and the only available specification
> for the *ordering* those must reproduce is V8's. l-lang declines to define its concurrency
> semantics by transcribing another runtime's scheduler. Await ordering will be specified by
> l-lang, and until it is, C refuses.
>
> This is the clearest example of the project's posture: an unbuilt feature with a stated reason
> beats a built feature whose semantics were inherited by accident.

### 9.5 How coroutines are compiled

**Status: Built.**

Both `:gen` and `:async` lower through **one** state-machine pass over the typed IR (D58). A
coroutine becomes an object whose environment is the suspended frame plus a state variable; resuming
is a call that switches on that state.

Locals are promoted to the heap frame wholesale, with no liveness analysis — a deliberate simplicity
choice, with a typed frame named as the future optimisation rather than pretended to exist.

A pleasant side effect: reifying locals into a heap frame *removes* the `setjmp`-clobber hazard §8.3
describes, since the values no longer live in the C stack frame that a `longjmp` invalidates.

---

## 10. Modules and packages

### 10.1 Modules

**Status: Built.**

A file is a module. Top-level definitions are **module-private** unless exported (D20).

```lisp
;; lib.lisp
(
    (fn double [x] (return (* x 2)))
    (export double)
)

;; main.lisp
(
    (import "lib.lisp")
    (console.log (double 5))
)
```

Selective import binds only what it names:

```lisp
(import { double } from "lib.lisp")
(import { plain-name :as aliased } from "provider.lisp")
```

`:as` binds on **both** sides of the boundary, and a rename **replaces** rather than adds — after
`(import { plain-name :as aliased } …)`, `plain-name` is unbound in this file.

Three questions are asked of every cross-module name, each with its own diagnostic:

| Question | Diagnostic |
|---|---|
| Does the module export it? | **`LL0215`** |
| Did this file ask for it? | **`LL0216`** |
| Does the module have it at all? | **`LL0235`** |

Plus **`LL0217`** for an unresolvable import, **`LL0232`** for exporting an undefined name, and
**`LL0300`** — a *warning* — for an import cycle.

> **Known limit.** A module boundary is **not transitive**: if A imports B and B imports C, A can
> name C's exports. Whether it should be transitive is a real question that the ruling does not
> answer.

Imports resolve from the importing file's directory first, which prevents a local file from shadowing
a library.

#### Module initialisation is under-specified

The working rule is that a module body does not execute on import beyond establishing its
definitions. That is enough for the corpus, where standard-library modules are definitions and
nothing else, but it does not answer what a module with effectful top-level code does:

```lisp
(
    (let table (build-table))     ;; is this evaluated on import?
    (console.log "loaded")        ;; is this ever printed?
    (export table)
)
```

Open questions the specification owes an answer to: whether top-level initialisers evaluate at
import; whether they evaluate once per module, once per package, or once per importer; whether
effectful top-level code is permitted at all; what order initialisation takes under an import cycle
(currently only a **warning**, `LL0300`); and whether the file wrapper runs when a module is imported
or only when it is the entry point.

This interacts with the declare-before-evaluate rule (§4.5): a symbol graph settles *ordering within
a file*, but module initialisation is a temporal question across files, and the two are not the same
rule.

### 10.2 The standard library resolves by name

**Status: Built.**

`(import "std/math")` resolves by **name**, not by path (D19). The standard library is an ordinary
l-lang library in `lib/std/` that ships with the compiler — *not* a compiler feature. Relative
imports keep working unchanged.

The resolver ascends from the compiler's own location looking for a `lib/`, and **stops at the
repository root**. This is deliberate: it can never wander up and adopt the system `/lib`.

### 10.3 Packages

**Status: Built.**

The compilation unit is a **package** (D35) — the C# assembly / Rust crate idea. A directory with a
`package.yaml` is one:

```yaml
name: geometry
sources: ["*.lisp"]
```

Files in a package see each other with **no import and no export between them**. The package's
exports are the union of its files' exports.

Visibility has three levels:

| Modifier | Visible to |
|---|---|
| `:public` | Everyone |
| `:internal` | The package (**the default**) |
| `:private` | The declaring file (**`LL0206`**) |

There is **no `protected`**. It is the implementation-inheritance leak that Go and Rust both drop,
and l-lang drops it too — `:protected` is now **`LL0015`**, refused by name.

### 10.4 Native declarations

**Status: Built.**

`:extern` declares a name the host provides. It exists so that host globals are *declared* rather
than *allow-listed inside the compiler*, which is what they used to be.

The only module that uses it is `std/js` (§12.3) — everything else in the standard library sits on
the intrinsic floor instead.

---

## 11. The intrinsic floor

**Status: Built.**

### 11.1 What it is, and why it is small

> The **intrinsic floor** is the smallest set of runtime operations that are (a) *irreducible* —
> needing a syscall, hardware, a host facility, or a representation primitive l-lang cannot express —
> and (b) implemented by **both** backends to **one** specification. (D50)

Everything above the floor is written in l-lang, on the floor, and is therefore portable **by
construction**: one source, both backends run it. The floor is the only place the two can diverge,
so it is the only place that needs conformance testing.

The design rule, applied operation by operation: *push down to pure l-lang unless irreducible.*

> **Why minimal.** Every floor entry is a divergence risk. The floor is a **cost, not a
> convenience** — an entry is worth adding only when nothing above it can express the operation.
>
> This is not theoretical. Applying the rule cut the native surface roughly in half at a stroke, and
> three planned groups turned out to be *unnecessary* rather than unfinished,
> each for the same reason: the primitive already existed under another name. `flatten` needed an
> array test, and `(x :of Array)` is one. `includes` needed structural equality, and `==` is it.
> `concat` needed string joining, and `+` is it. Only the **codepoint** group was genuinely
> irreducible — nothing in the language could ask what a string's third character was, because every
> available spelling answered in the host's own units.

The motivating measurement: a green test suite is not parity, it is *parity on the inputs the suite
happens to use*. Two divergences sat undetected for months — the length of `"café"`, and `int64`
exactness — because no corpus program happened to ask.

### 11.2 The inventory

> **On counting.** The floor's authoritative definition is the typed table in
> `src/compiler/floor/floor.ts`; it currently holds **72** keyed entries. The frequently quoted
> figure of "about 28" is the count at the end of the phase that established the floor, and it is
> now stale — bit operators, file I/O, refinement checks, clocks and reflection all arrived
> afterwards, each with its own ruling.
>
> The table below groups those entries by role rather than enumerating every key, so it should be
> read as a map of the surface, not as the count. Any claim about floor *size* should be taken from
> the module, not from prose — including this document's.

| Group | Primitives | Note |
|---|---|---|
| Strings | `codepoint-at` `codepoint-length` `string-to-codepoints` `string-from-codepoints` | A codepoint is an **`Int`**, not a `Char` |
| Case | *(none)* | ASCII case mapping is l-lang; the Unicode table is deferred |
| Numbers | `number->string` `string->number` `truncate` | `truncate` is the sole `Real → Int` door |
| Math | `sqrt sin cos tan asin acos atan atan2 exp log pow` | Host libm; last-ULP tolerance documented |
| Vectors | *(none)* | `.length` / `.push` / `.slice` / the indexer already carry both backends |
| Maps | `map-get` `map-set` `map-has` `map-delete` `map-keys` | String keys. No `map-new` — `{}` is the literal |
| Equality | *(none)* | `==` already lowers to a deep structural comparison on both |
| Reflection | *(the backend emits a metadata graph)* | The accessor shape is the spec, not the graph |
| I/O sink | `write-string` `write-string-err` | Raw stdout/stderr. **No** formatting |
| Time | `clock-ns` `sleep-ns` | Two clocks behind one entry: `(clock-ns "mono")`, `(clock-ns "wall")`, both in nanoseconds |
| Host | `random` `now` `clock` `args` `env` `exit` | Syscalls and entropy |

Note the selector-string pattern on `clock-ns`. It exists because a zero-argument call is a
*property read* (§4.2), so `(clock-mono)` would not be a call at all.

Written **in l-lang on top of this**: all of `std/core`, `std/seq`, string operations, `std/io`
including `print`'s substitution, `std/fn`, the display formatter, the number predicates, and the
derived math.

### 11.3 The numeric and string models

**`Int` is a wrapping `int64`.** On C, `int64_t` compiled with **`-fwrapv`**. On JavaScript, a
`BigInt` masked to 64 bits. Mixed `Int`/`Real` arithmetic promotes to `Real`.

> **`-fwrapv` is load-bearing, not a nicety.** Signed overflow is undefined behaviour in C; the
> wrapping semantics D51 specifies are obtained from the flag, not from the standard. A translation
> unit built without it does not implement l-lang's integer model, and `INT64_MAX + 1` becomes UB
> rather than wrapping.
>
> This has two consequences the specification should own rather than leave implicit. First,
> `-fwrapv` is a compiler extension — supported by GCC and Clang, but naming it makes the supported
> toolchain part of the contract; a strictly-conforming emitter would instead do wrapping
> arithmetic through unsigned types and explicit conversions. Second, `-fwrapv` does **not** cover
> everything: `INT64_MIN / -1`, `-INT64_MIN`, and out-of-range or negative shift counts remain
> undefined and need their own guards. See §13.3 for where this currently leaks.

**`String` is a sequence of Unicode codepoints** — scalar values, not UTF-16 code units and not
bytes. `(codepoint-at s i)` answers an `Int`, or `-1` when out of range.

Case and trim operations are **ASCII**, deliberately and explicitly. Full Unicode case mapping needs
a vendored table; that is deferred, and stating the limit beats shipping a table that is right for
some scripts.

### 11.4 The display format

This is the **normative** specification for how l-lang renders values. It is written to be
executable from the text alone, because under D55 neither backend is the oracle: both are
implementations, and a golden is derived from *this rule*, never captured from a run.

**The thesis: l-lang prints l-lang.** A printed value is, as far as possible, source you could paste
back — the classic Lisp read/print correspondence. `[1 2 3]` prints as `[1 2 3]`, not as
JavaScript's `[ 1, 2, 3 ]`. `nil` printing as `nil` is a consequence of that principle, not a patch
on top of it.

Three names, two distinct operations:

```
to-string(v)        The `+` string-concat context, and ONLY that context.

display(v)          Every human-facing rendering: console output, `print`'s {N} substitution,
                    and '"...{expr}" interpolation.
                      = the raw characters, if v is a String at the TOP level
                      = inspect(v, 0) otherwise
                    The top-level-bare rule is what makes (print "Hello, {0}!" "World")
                    print  Hello, World!  rather than  Hello, "World"!

inspect(v, indent)  The structural rendering, defined below.
```

```
inspect(v, indent):
  nil            -> nil
  Bool           -> true | false
  Int            -> decimal digits, with no BigInt `n` suffix
  Real           -> shortest round-trip; negative zero prints -0
  String         -> "..." with \\ \" \n \t \r escaped; every other character literal
  Char           -> #\c                       (PROVISIONAL: the reader has no Char literal)
  Closure        -> #<fn name>  |  #<fn>       when anonymous
  Generator      -> #<generator name>  |  #<generator>
  vec, empty     -> []
  map, empty     -> {}
  obj, no fields -> ClassName{}
  vec            -> entries are inspect(elem), SPACE-separated
  map            -> entries are `:key value`, space-separated; the key is bare after the colon
                    when identifier-like, else quoted -- {:a 1} vs {"a b" 1}
  obj            -> ClassName followed immediately by the map form over its fields

  CONTAINER LAYOUT (vec, map, obj -- the only place indent matters):
    Render the one-line form first, recursively:
        vec  ->  "[" + entries joined " " + "]"
        map  ->  "{" + entries joined " " + "}"
        obj  ->  ClassName + the map form
    Let TEXT be that one-line form PLUS its own line prefix -- the `:key ` when this container
    is a map value, empty otherwise. The prefix counts: it occupies the same line.
    If  indent + length(TEXT)  <=  80   ->  emit the one-line form.
    Otherwise emit the broken form:
        the opening bracket, newline,
        each entry rendered by this same rule at indent+2, preceded by (indent+2) spaces,
        newline after each,
        (indent) spaces, the closing bracket.
    There is no separator in the broken form: the newline IS the separator, which is one of
    the things dropping commas buys.

  DEPTH   -> unlimited. [Object] and [Array] never appear.
  CYCLES  -> a container already being rendered higher in the current recursion renders
             #<circular>, the same unreadable-object marker a closure uses.
```

Worked example. The outer map's one-line form is 103 characters at `indent = 0`, so it breaks. Its
`:params` entry is 33 characters at `indent = 2`, so it stays inline:

```
{
  :name "is-null"
  :kind "function"
  :params [{:name "x" :type "Any"}]
  :returns "Boolean"
  :nullable false
}
```

Four clarifications, each of which was a live divergence before it was written down:

- **The identifier-like key test is the reader's**, not a judgement call — it is the lexer's
  `Identifier` pattern. So `-` is in (kebab-case), `$` is out (it lexes as an operator), a leading
  digit is out, and non-ASCII is **in**.
- **The width budget is counted in codepoints** — not bytes, not UTF-16 code units. For a vector of
  twenty emoji the three answers were 24, 44 and 84.
- **A value displays under its source name.** An imported class shows its declared name, never a
  compiler-mangled one; a kebab-case field prints with its hyphen.
- **Binding a lambda does not name it.** `(let g (fn [a b] …))` displays `#<fn>`, not `#<fn g>` —
  that was JavaScript's `NamedEvaluation` naming a value the language never did.

`Real` renders shortest-round-trip, with exponential form when the absolute value is ≥1e21 or, for
a non-zero value, <1e-6 — spelled `1e-7` and `1e+21`. Zero renders as `0`, never exponentially.
`NaN`, `Infinity` and `-Infinity` render as those words.

**Not covered, deferred rather than dropped:** format specifiers (`{0:F2}`, alignment, culture).
They need number-formatting rules that do not exist yet.

#### Three things §11.4 does not yet settle

Recorded because each is observable, and because "one golden grades both backends" makes an
unspecified rendering a source of spurious diffs rather than a harmless omission.

- **Map and object entry order is not specified.** The algorithm renders entries in sequence without
  saying what the sequence is. This collides directly with the permanently-declined divergence in
  §13.4: C's association list preserves insertion order, a plain JavaScript object does not. Either
  insertion order is normative for display, or display sorts keys, or map order is explicitly
  unspecified and goldens must not depend on it. Object *field* order needs the same treatment —
  declaration order is the obvious candidate, since the metadata carries it.
- **`Formattable` dispatch is not in the algorithm.** §5.9 states that `Formattable` drives
  `display` nominally, but the type-case above is closed and never consults it. The specification
  predates the protocol. What needs stating: whether custom formatting precedes structural object
  rendering, whether it applies to nested values or only at the top level, and how it interacts with
  the cycle rule.
- **Type is not preserved for integral reals.** `1.0` is a `Real`, and shortest-round-trip renders
  it `1`, which the reader takes as an `Int`. That is in tension with the read/print correspondence
  the section opens with. Either integral reals need a marker (`1.0`), or the "source you could
  paste back" claim holds for values but not for types, and should say so.

### 11.5 `print`

`print`'s first argument is a template, scanned left to right:

```
"{{"            ->  emit a literal {
"}}"            ->  emit a literal }
"{" digits "}"  ->  the argument at that 0-based index, rendered by display()
                    index >= argument count  ->  THROW
anything else   ->  emitted verbatim
```

Every occurrence of an index is substituted, not just the first. An out-of-range placeholder
**throws**, following C#'s `FormatException` rather than printing the template or an empty string —
a format bug that prints something plausible is exactly the silent-wrong class this design exists to
eliminate. A lone `}` is emitted verbatim; only `{` opens a placeholder, so nothing is ambiguous.

### 11.6 Memory

**Status: Ruled, not built.**

The memory model is a **precise tracing garbage collector with shadow-stack roots, and no
finalizers** (D59). The heap is already precisely traceable; only the roots are missing.

`:gc`, `:stack` and `:manual` stay **reserved with no meaning** (§2.6) — D59 rules the collector, not
those modifiers.

`:destructor` is different, and the difference matters: D59 states its intended semantics —
**scope-bound cleanup**, deterministic and *not* GC finalisation — while leaving it unbuilt. It is
therefore *ruled, not built*, not *reserved with no meaning*.

> **What must be specified before it is built.** Scope-bound cleanup has to state its ordering
> against every non-local exit the language already has: an early `return` (§4.4), an exception, a
> restart transfer (§8.3), an abandoned generator frame (§9.5), and `Disposable` (§9.1). The restart
> case is the sharp one — a transfer must run intervening cleanup, which is exactly the property the
> unified frame stack was built to guarantee.

The acceptance test exists and is **deliberately red**: it measures resident memory growth across a
doubling allocation loop, where a ratio near 2.0 means no collector and near 1.0 means one. It will
turn green when the collector lands, and not before. An acceptance test that passes before the
feature exists is worse than no test.

### 11.7 Conformance

A floor primitive is **done** when its behavioural guard is green on both backends and listed in the
C ratchet (§13.5). Three mechanisms enforce it:

1. **One golden, both backends.** The same expected-output file grades C and JavaScript. That single
   property is the parity instrument — per-backend goldens are refused, because they would let a
   divergence be recorded as expected.
2. **Differential guards** in `examples/80-adversarial/`, one per ruling.
3. **The ratchet** — a file that passes on C and is not on the list is a *failure*, so coverage
   cannot silently regress.

---

## 12. The standard library

**Status: Built** (32 modules), with named gaps.

### 12.1 What it is

The standard library is **a library, not a compiler feature** (D19). It is ordinary l-lang source in
`lib/std/`, written on the intrinsic floor, resolved by name. Every module is written in l-lang; the
only one containing `:extern` declarations is `std/js`.

This was not always true. The stdlib previously existed *three times* — a runtime shim injected as
text, an allow-list buried in the type checker, and l-lang source that nobody ran — and the three
disagreed. The allow-list, in the audit's words, *"is not a standard library, it is a hole in the
type system."*

### 12.2 The modules

| Module | Exports |
|---|---|
| `std/core/types` | `Number Bool Str List Dict`, `type-name type-kind`, `is-nil is-int is-real is-number is-string is-bool is-array is-map is-function is-instance` |
| `std/core/string` | `strlen substr upcase downcase trim split join contains starts-with ends-with char-at pad-start pad-end repeat format-args is-digit is-alpha is-alnum is-space is-upper is-lower parse-int try-parse-int` |
| `std/core/errors` | `Error TypeError RangeError ValueError KeyError IndexError ArithmeticError IOError FileError NotFound FatalError caused-by` |
| `std/core/protocols` | `Comparable Hashable Formattable compare hash-of` |
| `std/core/async` | `Awaitable Task` |
| `std/iter` | `Iterable Iterator Disposable Range` |
| `std/iter/linq` | `map filter enumerate concat skip skip-while flat-map seq take take-while zip to-list reduce count for-each` |
| `std/seq` | `range zip map filter reduce flatten reverse sort sort-by min-by max-by index-of includes first last at length` |
| `std/fn` | `identity constantly partial compose` |
| `std/io` | `print prn alert` |
| `std/io/console` | `stdin read-line read-lines` |
| `std/io/files` | `CHUNK exists open try-open close read-chunk write-chunk read-file try-read-file write-file append-file read-lines` |
| `std/io/stream` | `Writer Reader StdOut StdErr FileWriter FileReader LineReader stdout stderr open-writer open-reader write-line copy strip-cr` |
| `std/js` | 34 host externs — `console Math JSON Object Array Symbol Reflect Proxy BigInt Date RegExp Map Set Promise parseInt parseFloat isNaN isFinite window document navigator process setTimeout …` |
| `std/llang/reflect` | `name-of kind-of type-name type-kind is-class is-struct is-interface is-function is-primitive is-container is-enum properties methods params returns ctor-params generics interfaces arity parent ancestors is-subtype-of find-method has-property modifiers modifier-names has-modifier decorators attributes attribute-names has-attribute attribute-args enum-members enum-member-names enum-value enum-name-of …` |
| `std/debug` | `dbg dbg-at inspect dump unreachable todo unimplemented` |
| `std/test` | `AssertionError assert assert-eq assert-ne test run-tests` |
| `std/sys/path` | `Path PathLike` |
| `std/sys/process` | `args env is-env-set env-or exit` |
| `std/sys/timers` | `ns us ms s now-ns now-ms epoch-ns epoch-ms sleep-us sleep-ms sleep-s Clock MonoClock WallClock ManualClock Stopwatch Ticker Task Scheduler` |
| `std/math` | `sqr sqrt sin cos tan log exp abs floor ceil round truncate pow min max inc dec E PI TAU` |
| `std/math/constants` | `PI TAU E PHI SQRT2 SQRT1_2 LN2 LN10 LOG2E LOG10E EULER_GAMMA EPSILON MAX_VALUE MIN_NORMAL INF NEG_INF NAN` |
| `std/math/elementary` | `abs sign min max clamp lerp floor ceil round trunc fract deg-to-rad rad-to-deg hypot asin acos is-even is-odd gcd lcm factorial binomial log2 log10 cbrt sinh cosh tanh asinh acosh atanh …` |
| `std/math/complex` | `Complex rect polar scale I real-fixed` |
| `std/math/rational` | `Rational from-int from-real` |
| `std/math/vector` | `Vec2 Vec3 Vec` |
| `std/math/stats` | `sum mean minimum maximum range variance-pop variance-sample stddev-pop stddev-sample median mode percentile quartiles iqr covariance pearson linreg …` |
| `std/math/special` | `gamma lgamma beta lbeta erf erfc lfactorial factorial-real lbinomial binomial-real` |
| `std/math/integrate` | `RealFn RootResult trapezoid simpson adaptive-simpson bisect newton secant` |
| `std/math/random` | `Random default-random` |
| `std/text/regex` | `RegexMatch first-match is-match is-full-match find-all count-matches` |
| `std/math/symbolic/expr` | `Expr Env rnum inum var neg sin cos exp log add sub mul div pow subst eval free-vars simplify-helpers …` |

### 12.3 Conventions

**Naming (D21).** Kebab-case throughout. Predicates are `is-x`. Scheme's `nil?` / `set!` spellings
are rejected by name. A direct binding to a C standard-library function may *additionally* expose
the C name as an alias (`string-length` / `strlen`).

**Layout (D22).** Module families mirror C standard-library headers where one exists — `io/` for
`stdio.h`, `math/` for `math.h`, `sys/` for `unistd.h`. Signatures stay l-lang: no `char*`, no errno
returns, no out-parameters. `core/` is reserved for the foundational, prelude-adjacent tier.

**Preludes.** A prelude is a host-free leaf that imports nothing, injected into every module. There
are exactly **two**: `std/js` and `std/core/errors`. The self-containment rule is not stylistic —
two ambient preludes importing each other was a live import cycle.

**One convention per file.** `std/seq` (eager, collection-last) and `std/iter/linq` (lazy,
collection-first) export colliding names deliberately; a file picks one (§9.3).

**Determinism is the API.** `std/math/random` is seeded — xoshiro256** seeded by SplitMix64, in pure
l-lang with no floor entry (D65). A generator whose sequence cannot be reproduced is untestable, so
seeding is the interface rather than an option on it.

**Paths are a value type.** `std/sys/path` defines `Path` as a struct; `/` is canonical and `\` is
normalised to it; an extension excludes the dot (D64). Filesystem *operations* are out of scope for
that module.

### 12.4 Design principles

These govern what enters the standard library, and are as much a part of the design as any ruling:

- **Effects are values, not ambience.** A clock, a writer, a random source is passed, not reached
  for. This is why `std/sys/timers` exports a `ManualClock` alongside the real ones — testability
  falls out of the shape rather than being retrofitted.
- **Serialization is reading**, because the language is a Lisp. The reader and the printer are two
  halves of one correspondence (§11.4), not separate features.
- **Two conventions, never three.** Where a genuine trade-off exists (eager versus lazy), pick two
  and make the choice explicit. Do not pick one and lose half the use cases, and do not pick three.
- **Protocols are small, and paired with fakes.** A protocol with five members is a protocol nobody
  implements.
- **Errors are one story.** One tower (§8.2), rooted in l-lang, not one per module.
- **Testing is a language citizen.** `std/test` ships with the language.
- **The standard library states rules; it does not import opinions.** Where the host offers a
  facility with semantics l-lang has not chosen, the standard library does not re-export it.

### 12.5 Regular expressions

**Status: Built (D67).**

Regex is an **l-lang engine** in `std/text/regex` — not a binding to the host's, and not a grammar
feature.

```lisp
(import "std/text/regex")

(is-match r"\d+" "id-42")                    ; does it occur?
(is-full-match r"[a-z]+" "regex")            ; is the whole string this shape?
(first-match r"\d+" "id-42-x")               ; RegexMatch? -- start, end, value
(find-all r"\d+" "a1 b22 c333")              ; every non-overlapping match
(count-matches r"\d+" "a1 b22 c333")
```

- **Not a literal.** A `/pattern/flags` literal is unfixably ambiguous with division in a homoiconic
  reader (Appendix D). Patterns are ordinary strings, written raw: `r"\d+"` (§2.4).
- **Not ambient.** It is imported like any other module.
- **An l-lang engine**, so both backends run *the same program* — every line of the corpus example is
  byte-identical across them because it is not two implementations. Binding POSIX `<regex.h>` on C
  while JavaScript had RegExp would have made `\d`, lazy quantifiers and lookaround mean different
  things per backend, which is exactly the divergence D66 exists to stop.
- **The matcher carries the set of reachable positions** rather than backtracking, so `(a|ab)b`
  resolves against `abb` without the exponential blowup that shape gives a naive backtracker. A repeat
  discards zero-width results, which is what stops `(a?)*` looping forever.
- **`find-all` is where the `g` flag went.** Global was never a property of the pattern; it is which
  call you make.
- **`first-match` answers an optional**, so D9 makes the no-match case impossible to forget.
- **In `match` patterns**, a regex is sugar lowered during AST construction to the `:when` guard that
  already worked — `s :when (is-full-match r"ca+t" s) => …` — so it is shorter rather than newly
  possible. It is an **anchored full match**, not a search: Ruby's searching `when /re/` was
  considered and rejected, because a pattern that silently matches a substring is a bug factory. Spell
  a search `r".*ca+t.*"`.
  - A deliberate, visible price: `"cat"` and `r"cat"` mean different things in pattern position —
    equality against the literal text, versus a regex. The prefix is right there in the source.
  - A regex pattern **nested** inside a vector or map pattern is **`LL0035`**: the rewrite needs a
    subject to bind and guard on, and a nested element is being destructured rather than tested.

**Supported:** literals, escaped metacharacters, `.`, `[abc]`, `[a-z]`, `[^…]`, grouping, alternation,
`*`, `+`, `?`, `^`, `$`, and `\d` `\w` `\s` with their negations.

**Not built, and named rather than implied:** captures — which `replace` and `split` need before they
can be real — lookaround, backreferences, lazy quantifiers, Unicode properties, and inline flags. The
inline-flag spelling `(?i)` remains the ruled form when they arrive; it is a property of the pattern,
which is why it is not a suffix. Counted `{n,m}` is nearly free: the node already carries `min`/`max`
and only the parser arm is missing.

---

## 13. Compilation model and backends

### 13.1 The pipeline

**Status: Built.**

```
source ──▶ parse ──▶ syntax ──▶ symbols ──▶ desugar ──▶ types ──▶ codegen
```

| Stage | What happens |
|---|---|
| **parse** | Chevrotain lexer and parser produce a CST; an AST builder lowers it to typed nodes |
| **syntax** | Declarative node validation. Errors gate per *module*, so a sibling's failure does not stop this one |
| **symbols** | Dependency graph, scope tree, symbol table; imports resolved and package siblings joined |
| **desugar** | Comptime folding, then desugaring |
| **types** | Inference and checking against the joined symbol table, so cross-module calls are checked |
| **codegen** | Backend dispatch |

Any stage can be the stopping point (`--stage`), which emits the intermediate artifact as JSON.
The prelude modules (§12.3) are injected between parse and symbols.

### 13.2 The HIR

**Status: Built.**

Between type checking and code generation sits a **typed, destination-driven intermediate
representation** (D45). It exists because l-lang is expression-oriented and its first target was
statement-oriented, and a single visitor was performing five lowerings at once, ad hoc.

Six requirements define it:

| | |
|---|---|
| **R1** | Position is explicit — the IR is in administrative normal form |
| **R2** | Operand shapes are uniform: field read, method call, and index are distinct nodes |
| **R3** | Store sites are explicit, so value-semantics copies have somewhere to live |
| **R4** | Dispatch is resolved in the IR, not in the emitter |
| **R5** | The IR is typed |
| **R6** | IR → target is mechanical, roughly 1:1 |

R6 is the load-bearing one, and it has a governing corollary:

> **If the emitter has to make a judgement call, that judgement belongs in an IR pass.**

That generalises into the rule that governs the whole backend split:

> **A-0.** A thing leaves the shared core **only** if it is genuinely a single-backend pass. A
> decision that *both* backends make stays in core and must be represented as a node, so they
> cannot diverge. Never relabel a real gap. (D48)

The same principle as the intrinsic floor (§11), one layer up: A-0 governs the compile-time
contract, the floor governs the runtime one.

An unresolved type in the IR means **"box me"** — a representation decision, not a hole. That
distinction matters: if a native backend *rejects* unresolved types rather than boxing them, l-lang
stops being gradually typed on native.

### 13.3 The C backend

**Status: Built — 203 of 270 corpus programs.**

C11 is the supported target. The pipeline is IR → resolve to a C-shaped IR → insert coercions →
emit. Output is a **single self-contained translation unit**, and the normative build is:

```bash
cc -std=c11 -fwrapv out.c -o out -lm
```

`-fwrapv` is required by D51 (§11.3); without it the program does not implement l-lang's integer
semantics.

> **A live inconsistency, recorded rather than smoothed over.** The test runner builds with
> `-std=c11 -fwrapv` exactly as above. The `l-lang run` command does **not** — it shells
> `cc -w <file> -o <out>`, omitting both `-std=c11` and `-fwrapv`. So the path the test suite
> validates and the path a user actually runs have different integer semantics, and the difference
> is invisible until an overflow occurs. The build command above is the specification; the CLI is
> the thing that needs to change.

The backend is a **fail-closed adversarial probe**. It may only reach below the IR through
instrumented accessors, each of which requires an explicit `(assumption, construct, note)` triple
and records an entry in a gap ledger. The result is that the backend's own incompleteness is
*measured* rather than estimated, and the ledger is reproducible on demand.

Where the backend cannot model something, it **refuses** with **`LL0105`**, **`LL0106`** or
**`LL0107`**. A refusal is a supported outcome.

### 13.4 The JavaScript backend

**Status: Deprecated (D66). Retained as a differential oracle.**

l-lang began as a JavaScript transpiler. It is not one now.

- **C is the sole supported target.** JavaScript is retained, not deleted, because one golden
  grading two independent implementations is the strongest correctness instrument the project has
  (§11.7).
- **No new features or fixes** land on the JavaScript path.
- **JavaScript may now degrade or no-op** on native-only features. This explicitly reverses the
  earlier standing rule that everything shipped had to be JavaScript-safe.
- Every JavaScript code generation emits a deprecation **warning**.

Two divergences are permanently **declined** rather than pending: map insertion order (C's
association list preserves it, a plain JavaScript object does not), and astral-plane string handling
(codepoints versus UTF-16 code units). Both are recorded, guarded, and closed.

> This ruling is the largest posture reversal in l-lang's history, and worth understanding as a
> whole: a native target stopped being *upside* and became *the point*. Everything downstream —
> the floor, the IR's A-0 rule, the refusal diagnostics — is that decision working itself out.

**What still stands between deprecation and deletion.** Three things did; one is now gone.

| Blocker | State |
|---|---|
| `:comptime` was evaluated by lowering to JavaScript and running it in `node:vm` | **Resolved (D73).** The compiler has its own AST interpreter; no JavaScript is in the fold path (§6.11). |
| The REPL has its own `node:vm` | **Open.** It executes *arbitrary* user code rather than the comptime subset — a different problem wearing the same word, needing effectively a whole l-lang VM. |
| The differential oracle | **Open.** Losing a second implementation means losing the instrument; the replacement named for it is the fuzzer in Appendix D. |

> The middle row is the one worth not underestimating. "The evaluator" and "the REPL" sound like the
> same task and are not: a comptime call's arguments are already required to be constants, so the
> interpreter models no runtime state, no closure capture and no mutation. A REPL has all three.
>
> The third row deserves its own caution. Three defects found in the last stretch of work — a comptime
> fold losing integer precision past 2^53, a match pattern never decoding its escapes, and a folded
> `Math.random` baking a build-time constant into the artefact — were **invisible to the oracle**,
> because both backends agreed. A second implementation catches divergence, not shared wrongness. That
> argues for the fuzzer independently of the deletion, rather than only as its precondition.

There is also an l-lang → l-lang backend, a working pretty-printer and round-tripper. **LLVM does
not exist**; it is a design target with readiness analysis, not code.

### 13.5 The command line

```bash
l-lang run       <file>            # compile and execute
l-lang transform <file>            # compile to disk
l-lang parse     <file>            # AST only
l-lang repl                        # interactive session
l-lang clean     <folder>          # remove generated artifacts
```

| Flag | Meaning |
|---|---|
| `--backend <js\|c\|llang>` | Target. **Defaults to `js`** — see the note below |
| `--stage <parse\|syntax\|symbols\|desugar\|types\|codegen>` | Stop after a stage and emit its artifact |
| `-o, --output <dir>` | Output directory |
| `-I, --lib <dir>` | Additional library search root, repeatable |
| `-L, --log-level <level>` | `verbose` · `debug` · `info` · `warning` · `error` |
| `--short-errors` | One line per diagnostic |
| `--perf` | Performance metrics |
| `--stdin` / `--stdout` | Read source from stdin / write result to stdout |
| `--no-map` | Disable source maps |
| `--validate-metadata` | Check type-metadata completeness before codegen |

On the C backend, `run` writes a translation unit, invokes `cc`, executes the result, forwards its
exit code, and removes both artifacts.

> **The default backend contradicts the backend policy.** `--backend` still defaults to `js`, so an
> invocation with no flag targets the deprecated oracle and emits a deprecation warning on every
> run. Under D66 the default should be `c`. This is recorded as an inconsistency between the ruling
> and the tool, not as a considered choice — nothing in D66 argues for keeping the old default, and
> the warning text itself tells the user to pass `--language c`.

The REPL treats a session as **a program that grows one top-level form at a time** (D23). Every
input recompiles the whole session; only the new form executes. One name has one type — rebinding a
name at a different type is **`REPL0001`**.

### 13.6 The example corpus is the test suite

**Status: Built.** 270 programs, 222 goldens.

`examples/` is not documentation that happens to compile — it is the primary test suite.

| Convention | Meaning |
|---|---|
| `name.lisp` | The program |
| `name.expect` | Expected **stdout**. The *same* file grades both backends |
| `name.panic` | The program is expected to die; the file holds a substring that must appear on stderr |
| `_name.lisp` | Scratch, excluded from the corpus |

Every `.lisp` file must be **declared** — it either has a golden, or an explicit manifest entry.
An undeclared file is a hard suite error, never a silent skip.

Five declared statuses: `test` (has a golden), `library` (imported, compiled, never run), `fixture`
(unverifiable under a plain runtime), `negative` (**must** fail, and must report every listed
diagnostic code), and `xfail` (a real feature example with no golden yet, each carrying a written
root cause).

Two directories carry particular weight:

- **`examples/80-adversarial/`** — 77 programs. Regression and parity guards, not tutorials: minimal
  repros extracted from audits, one conformance guard per floor ruling, and differential guards for
  every place the two backends were caught disagreeing.
- **`examples/90-diagnostics/`** — 20 programs, **zero goldens by design**. Each must fail to
  compile and must report exactly the codes pinned for it. The runner also fails if the compiler
  *throws* instead of producing a located diagnostic.

Alongside the corpus run: code generation, type errors (corpus target **zero** diagnostics),
diagnostics-registry integrity, module system, REPL, AST invariants, grammar smoke, and the memory
acceptance test (§11.6, deliberately red).

The governing discipline, from the manifest's own header:

> Authoring goldens against current, soon-to-change, occasionally-buggy output freezes bugs into
> "expected" — the exact mistake this manifest exists to stop repeating.

---

# Appendix A — Decision index

Every ruling that governs the language, D1–D74, with where this document specifies it. The full
argument and evidence for each lives in `docs/spec/DECISIONS.md`.

| # | Ruling | Status | § |
|---|---|---|---|
| D1 | `(x)` is a call iff `x` names a function | Built (reversed once, then settled) | §4.2 |
| D2 | `:=` is assignment; `=` deleted as an assignment operator | Built | §2.2 |
| D3 | `defmacro` / `defsyntax` are out for 1.0, reserved | Reserved | §6.11 |
| D3b | `defmodifier` is a runtime decorator | Built | §6.4 |
| D3c | `:comptime` folds at compile time | Built | §6.11 |
| D3d | `defmacro` refused by name; `quote` emits data | Reserved | §6.11 |
| D4 | Unknown modifiers are a hard error, whitelisted per construct | Built | §6.3 |
| D5 | Full type system: real generics, fatal type errors | Superseded in part by D42 | §5 |
| D6 | Module model: `export` is a hard boundary | Superseded by D20/D35 | §10 |
| D7 | A full, real standard library | Realized by D19–D22 | §12 |
| D8 | Seven numeric literal forms; comma is whitespace | Accepted; five forms unbuilt | §2.3 |
| D9 | Non-nullable by default, `T?`, one bottom value `nil` | Built | §5.3 |
| D10 | `let` is binding-immutable, Rust-style | Built | §6.1 |
| D11 | The class surface; `defstruct` is a by-copy value type | Built | §6.5, §6.6 |
| D12 | `for` is named-only and order-free; `cond` default is `:else` | Built | §4.7 |
| D13 | Map keys are strings, never mangled | Built | §5.4 |
| D14 | The frontend is Chevrotain; retire the scannerless PEG | Built | §2 |
| D15 | `:gc` / `:stack` / `:manual` / `:destructor` are reserved | Reserved | §2.6, §11.6 |
| D16 | Destructuring binds a name or a pattern | Built | §6.1 |
| D17 | `(x \|> (.m a))` is a method call | Built | §4.8 |
| D18 | A trailing `if` yields a value | Built | §4.1 |
| D19 | The stdlib is a library, not a compiler feature | Built | §10.2, §12.1 |
| D20 | `export` is the module boundary | Built | §10.1 |
| D21 | Naming: kebab-case, `is-x` predicates; Scheme spellings rejected | Built | §2.1, §12.3 |
| D22 | Module layout mirrors cstd headers; signatures stay l-lang | Built | §12.3 |
| D23 | REPL semantics: a session is a growing program | Built | §13.5 |
| D24 | A value must be declared before it is *evaluated* | Built | §4.5 |
| D25 | What a list is: call, block, or grouping | Built | §4.2 |
| D26 | Match guards: `pattern :when expr` | Built | §7.2 |
| D27 | `:of` type patterns match and bind | Built | §7.3 |
| D28 | Rest patterns `[a ...rest]`, trailing and named only | Built | §7.4 |
| D29 | Language constructs are defined by stdlib protocols | Built | §9.1 |
| D30 | The iteration protocol: `Iterable<T>` / `Iterator<T>` | Built | §9.1 |
| D31 | Generators: `:gen` + `yield` | Built | §9.2 |
| D32 | Async: the `Awaitable<T>` / `Task<T>` protocol | Built (JS); refused on C | §9.4 |
| D33 | LINQ: the lazy sequence library; one convention per file | Built | §9.3 |
| D34 | Modifier composition: dispatch versus body modifiers | Built | §6.3 |
| D35 | The compilation unit is a package; visibility is package-scoped | Built | §10.3 |
| D36 | Typed surfaces: generic accessors and native member types | Built | §5 |
| D37 | Tuples `[Int String]` and records `{:name <- String}` | Built | §5.4 |
| D38 | Diagnostics live in one registry | Built | Appx B |
| D39 | One frontend, one backend: PEG and js-legacy retired | Built | §2, §13.4 |
| D39 *(rider)* | `and` / `or` / `not` are in the language; colon-path map access is not | Ruled, not built | Appx C, Appx D |
| D40 | `return` returns from the function | Built | §4.4 |
| D41 | `:of` is a type guard in expression position, and it narrows | Built | §5.6 |
| D42 | Types are nominal, interfaces are structural (the Go model) | Built | §5.1 |
| D43 | Int versus Real is decided statically | Built | §5.2 |
| D44 | An annotation must name a type that exists | Built | §5.2 |
| D45 | The HIR: a typed, destination-driven, post-typecheck IR | Built | §13.2 |
| D46 | The coercion pass is the checked-conversion layer | Refinements and ranges built; `defcast` and fixed-width ints not | §5.7, §5.8 |
| D47 | Conditions and restarts, a resumable second mechanism | Built — C only | §8.3 |
| D48 | The A-0 rule: a dual-backend decision stays in core | Built | §13.2 |
| D49a | `-> Void` binds, suppressing the implicit return | Built | §4.6 |
| D49b | A `Void` expression in value position is `nil` | Built | §4.6 |
| D49c | Module scope is settled semantics | Built | §10.1 |
| D49d | `/` on two `Int`s is integer division | Built | §5.2 |
| D50 | The floor is a typed, minimal, shared contract | Built | §11.1 |
| D51 | `Int` is wrapping `int64`, `Real` is `f64` | Built | §5.2, §11.3 |
| D52 | `String` is Unicode codepoints | Built | §5.2, §11.3 |
| D53 | Primitive `vec` / `map`; structural `equals` | Built (partly unspent) | §11.2 |
| D54 | Reflection has one metadata shape | Built | §11.2, §12.2 |
| D55 | Display is l-lang's own format, specified by transcription | Built | §11.4 |
| D56 | Time is nanoseconds, two clocks, one floor entry | Built | §11.2 |
| D57 | `std/math` overloads exactly five operators | Built | §6.8 |
| D58 | Coroutine lowering: one state-machine pass; a generator is an object | Built | §9.5 |
| D59 | Memory: a precise tracing GC, shadow-stack roots, no finalizers | **Ruled, not built** | §11.6 |
| D60 | `:async` stays C-refused; l-lang owns await ordering | Ruled — a deliberate non-build | §9.4 |
| D61 | Bit operators: `Int` only, 64-bit wrap, masked shifts | Built | §5.2 |
| D62 | `std/core/errors`: a typed error tower on an l-lang-owned `Error` | Built | §8.2 |
| D63 | The protocol family: Comparable / Hashable / Formattable | Built | §5.9 |
| D64 | `std/sys/path`: paths are a value type, `/` canonical | Built | §12.3 |
| D65 | `std/math/random`: seeded determinism is the API | Built | §12.3 |
| D66 | The JavaScript backend is deprecated; C is the sole target | Built | §13.4 |
| D67 | Regex is an l-lang engine in `std/text/regex`; `r"…"` is a raw string | Built | §2.4, §7.1, §12.5 |
| D68 | `:foo` is three roles: modifier, decorator, attribute; modifier arguments are adjacency-gated | Built | §6.3, §6.4 |
| D69 | The metaprogramming tiers, keyed on what the handler receives | `:comptime` Built; the other two Reserved | §6.11 |
| D70 | Enums get an RTTI representation; members stay folded | Built | §12.2 |
| D71 | `_` digit separators; `0o` is the only octal; a leading zero is refused | Built | §2.3 |
| D72 | `defattribute` — annotation data, portable to both backends | Built | §6.4 |
| D73 | `:comptime` is evaluated by an in-house interpreter, not `node:vm` | Built | §6.11, §13.4 |
| D74 | A match pattern's string decodes like every other string | Built | §7.1 |

**A note on numbering.** D-numbers were allocated without a lock, and two branches once minted the
same number independently. D23 was renumbered on merge; any `D17` in the REPL sources means D23.
D5, D6 and D7 are the early rulings that later work superseded — they are kept in the register
rather than deleted, because the reasoning that replaced them is only legible next to what it
replaced.

---

# Appendix B — Diagnostics

Diagnostics live in **one registry** (D38), keyed by name with the code as a field. The registry is
integrity-checked by its own test suite, which also allocates the next free code in each band.

### LL00xx — syntax and structure

| Code | Name |
|---|---|
| LL0001 | IdentifierHasName |
| LL0002 | FractionHasZeroDenominator |
| LL0003 | ImportMustHaveSource |
| LL0005 | VariableMustHaveName |
| LL0006 | ConstantVariableMustHaveInitializer |
| LL0007 | TryCatchHasEitherCatchOrFinally |
| LL0008 | OnlyOneDefaultCatchBlockAllowed |
| LL0009 | InvalidInterfaceMembers |
| LL0010 | InterfaceMembersCannotHaveInitializers |
| LL0011 | InterfaceMembersCannotBeExtern |
| LL0012 | InterfaceMembersCannotHaveBodyDeclarations |
| LL0013 | ExternFunctionCannotHaveBody |
| LL0014 | FunctionParameterMustHaveName |
| LL0015 | UnknownModifier |
| LL0016 | ReservedNativeModifier |
| LL0017 | DuplicateForClause |
| LL0018 | MissingForClause |
| LL0019 | UnparenthesizedForm |
| LL0020 | MatchMustHaveCases |
| LL0021 | IdentifierMustHaveName |
| LL0022 | OnlyOneVisibilityModifierAllowed |
| LL0023 | MacroNotImplemented |
| LL0024 | FunctionAllowedParameterModifiers |
| LL0025 | ClassMustHaveName |
| LL0026 | IfMustHaveCondition · WhenMustHaveCondition |
| LL0027 | IfMustHaveThenClause |
| LL0028 | WhenMustHaveThenClause |
| LL0029 | RestPatternMustBeTrailing |
| LL0030 | LeadingZeroNumber — a numeric literal with a leading zero (D71) |
| LL0031 | DuplicateAnnotation — one `:name` declared twice (D72) |
| LL0032 | AttributeArgNotLiteral — an attribute argument that must be evaluated (D72) |
| LL0033 | ModifierArgsNotAdjacent — declared arguments, none supplied; probably spaced (D68) |
| LL0035 | RegexPatternNested — a regex pattern inside another pattern (D67) |
| LL0099 | ComptimeVariable · ComptimeArgNotLiteral · ComptimeEval |

`LL0004` was **deleted** — it encoded an invariant that turned out to be false.

### LL01xx — code generation

| Code | Name |
|---|---|
| LL0100 | Unhandled |
| LL0101 | InvalidEmittedJs |
| LL0102 | BindingPositionInvalid · DefaultBeforeRequired |
| LL0104 | UntestableType |
| LL0105 | **CoroutineRefused** (C backend) |
| LL0106 | **Unhandled** (C backend) |
| LL0107 | **UnresolvableExtern** (C backend) |
| LL0108 | **RestartsRefused** (JavaScript backend) |

The four bold entries are **refusals**, not failures — a backend stating that it will not emit code
it cannot make correct (§1.2).

### LL02xx — types and modules

| Code | Name |
|---|---|
| LL0200 | VariableAssignMismatch |
| LL0201 | IfConditionNotBoolean |
| LL0202 | AssignmentMismatch · AssignBackMismatch |
| LL0203 | ArgumentMismatch |
| LL0204 | OperatorNotDefinedBinary · OperatorNotDefinedUnary |
| LL0205 | PossiblyNil |
| LL0206 | PrivateAccess |
| LL0207 | OperatorMutatesThis |
| LL0208 | OperatorArity |
| LL0209 | InterfaceNotSatisfied |
| LL0210 | NotDefined |
| LL0211 | Arity |
| LL0212 | AlreadyDeclared |
| LL0213 | ReturnMismatch |
| LL0214 | CovariantInParam · ContravariantInReturn |
| LL0215 | NotExported |
| LL0216 | NotBound |
| LL0217 | UnresolvedImport · NamespaceImportUnsupported |
| LL0218 | TypeOfStringLiteral *(warning)* |
| LL0219 | UsedBeforeDeclared |
| LL0220 | BlockNotCall |
| LL0221 | NotIterable |
| LL0222 | YieldOutsideGen |
| LL0223 | GenReturnsValue |
| LL0224 | GenReturnType |
| LL0225 | GenYieldMismatch |
| LL0226 | GenNeverYields |
| LL0227 | AwaitOutsideAsync |
| LL0228 | AsyncReturnType |
| LL0229 | ExtensionNoReceiver |
| LL0230 | ArrayLazyMember |
| LL0231 | UnknownTypeName |
| LL0232 | CannotExportUndefined |
| LL0233 | ImmutableAssignment |
| LL0234 | ExtensionNeedsNominalImplements |
| LL0235 | ImportNameNotFound |
| LL0236 | EvalNotImplemented |
| LL0237 | GenYieldNoValue |
| LL0238 | GenNullableElement |
| LL0239 | GenYieldInProtected |
| LL0240 | AmbiguousImport |

### LL03xx — warnings

| Code | Name |
|---|---|
| LL0300 | ImportCycle |

### REPL

| Code | Meaning |
|---|---|
| REPL0001 | A name rebound at a different type within one session (§13.5) |

---

# Appendix C — Implementation status

### C.1 By feature

| Area | Status |
|---|---|
| Variables, functions, closures, higher-order functions | **Built** |
| Pipelines `\|>` | **Built** |
| Control flow — `if` / `when` / `cond` / `for` / `while` | **Built** |
| Pattern matching — guards, `:of`, vector, map, rest | **Built** (`functional-pattern` deliberately dead) |
| Classes, inheritance, interfaces, structs | **Built** |
| Value semantics and struct copies | **Built** (one divergence, C.4) |
| Operator overloading | **Built** |
| Generics | **Built**, erased; two erasure holes |
| `defmodifier`, `defattribute`, `:comptime`, `:extension` | **Built** |
| Modules, packages, visibility, `:as` aliasing | **Built** |
| `try` / `catch` / `finally`, the typed error tower | **Built** |
| Conditions and restarts | **Built — C only** (`LL0108` on JS) |
| Generators, the iteration protocol, LINQ, `std/seq` | **Built** |
| `:async` / `await` | **Built on JS**; refused on C (D60) |
| RTTI and reflection | **Built** |
| String interpolation | **Built** |
| The intrinsic floor — int64, codepoints, file I/O, bit ops, clocks | **Built** |
| Digit separators; `0o` octal lexing (D71) | **Built** |
| Modifier/decorator/attribute reflection, enum RTTI (D68, D70, D72) | **Built** |
| The comptime evaluator — in-house, no `node:vm` (D73) | **Built** |
| Refinement newtypes and `..` ranges | **Built** — checked at all six boundaries, Int and Real |
| The C11 backend | **Built** — 223 / 299 corpus programs |
| Numeric tower — hex, binary, octal, rational, complex | **Ruled, not built** (`LL0100`) |
| `defcast :implicit` / `:explicit` (D46/B-3) | **Built** — the argument site is the one coercion site not yet wired |
| Native fixed-width integer types (D46/B-2) | **Ruled, not built** |
| Regex, `r"…"` raw strings, `f"…"` | **Built** (D67) — engine, prefixes and match arms |
| Garbage collection | **Ruled, not built** (acceptance test deliberately red) |
| `and` / `or` / `not` as forms | **Ruled, not built** — accepted alongside D39; no separate ruling |
| `**=` | **Ruled, not built** — still parses as a *call* rather than reporting an error (§2.3) |
| Boolean match patterns | **Not built** — parse error (§7.1) |
| `:destructor` scope-bound cleanup | **Ruled, not built** (§11.6) |
| `defmacro` / `defsyntax`, `eval`, quasiquote | **Reserved** — the tiers are specified (D69), none of the two beyond `:comptime` is built |
| LLVM backend | Design target only — no code |

### C.2 Backend split

- **C11** — 223 of 299 corpus programs pass and are pinned in a ratchet. A program that passes on C
  and is *not* pinned is a test failure, so coverage cannot silently regress. The remainder are
  either not-yet-implemented or explicit refusals.
- **JavaScript** — complete but deprecated (§13.4). Exactly **two** corpus programs are known-failing,
  and both are **declined** rather than pending: map insertion order, and astral-plane strings.

### C.3 The xfail list

Thirteen corpus programs are real feature examples with no golden. Seven are the *example's* fault,
not the compiler's — a distinction worth keeping, because an xfail list that conflates the two stops
being readable.

| Example | Cause | Whose fault |
|---|---|---|
| `00-basics/02_scope` | Self-referential shadowing binding emits a temporal-dead-zone read; the checker misses it too | Compiler |
| `03-loops/02_more_for_loops` | Uses `:inline`, an undeclared modifier | Example |
| `04-pattern-matching/03_pattern_kinds` | Match-guard misparse | Compiler |
| `04-pattern-matching/04_destructuring` | Duplicate declarations; and a genuine open question about destructuring *assignment* | Both |
| `05-data-structures/02_maps` | Runtime-shim selection bug; missing map member surface | Compiler |
| `06-value-semantics/01_structs_refinement` | Wants sized array types and `:stack` fields — neither exists | Example |
| `07-types/04_argument_types` | Array and generic argument checking incomplete | Compiler |
| `12-quote-macros/00_quoting` | `defmacro` is reserved (`LL0023`) | Example |
| `18-error-handling/01_try_catch` | — | Compiler |
| `20-algorithms/00_bfs` | Nil-safety friction on a shift result | Example |
| `20-algorithms/02_game_of_life` | Compiles and runs clean; fails on the compiler's own *correct* bounds check | Example |
| `20-algorithms/10_memoization_modifier` | Applies `:memoized` with no `defmodifier` | Example |
| `80-adversarial/hyphen_field_encoding` | **Live bug** — see C.4 | Compiler |

### C.4 Open defects

Recorded rather than hidden. None is a blocker; each is a known wrong answer.

> **A defect class this list cannot represent, and the oracle cannot see.** Every entry below was found
> because two implementations disagreed, or because a golden moved. Three defects fixed after this
> document was first written were invisible to both instruments, because **both backends agreed and
> were both wrong**: a `:comptime` fold losing integer precision past 2^53 (D73), a match pattern never
> decoding its escapes so the arm silently never fired (D74), and a folded `Math.random` baking one
> build's constant into the artefact (D73).
>
> A second implementation catches *divergence*, not *shared wrongness*, and a corpus catches
> *regression*, not *absence*. Each of the three was found by writing a program that had never been
> written before — arithmetic past 2^53, a pattern containing a backslash — rather than by any check
> the project runs. That is the argument for the fuzzer in Appendix D, and it stands independently of
> whether the JavaScript backend is ever deleted.

- **Hyphenated map fields encode inconsistently.** `w.next-dir` mangles on the dot-access path but
  not on the literal key, so three spellings of one field disagree. Deliberately left without a
  golden — *current output is wrong, and a golden would bless it.* The general question it raises is
  where the identifier-encoding boundary sits, which is unanswered.
- **Value semantics diverge on array push.** Pushing a struct into an array copies on JavaScript and
  aliases on C.
- **A boxed container element handed to an overloaded operator** misses an unbox on C — which stings,
  because summing a field across a collection is the canonical reason to have operator overloading.
- **A value-position `match` with a throwing arm** emits invalid JavaScript. Correct on C.
- **Narrowing is lost on reassignment** after a `:of` guard, with no diagnostic.
- **Anonymous `(fn :gen [] …)` does not parse**; a nested `:gen` bound with `let` crashes the
  JavaScript backend with an uncaught exception rather than a diagnostic.
- **Missing diagnostics** — `(new)` with no class name; `fn` parameter defaults do not exist at all;
  nil-check coverage reads only the head of a member chain.
- **`for :each` disposal is ruled and not built** — dispose always, C# semantics, accept the price
  loudly.
- **A module boundary is not transitive** (§10.1), and whether it should be is unruled.
- **`std/math`'s `Vector3` still uses a banned Latin-1 operator glyph** (§6.8) — acknowledged debt.
- **The type checker does not infer every expression.** The count of runtime member-dispatch sites is
  the thermometer; it has fallen from 50 to 23. What remains is host interop and collection element
  types over arrays of maps.

---

# Appendix D — Parked and rejected

Recorded so they are not re-litigated. A rejection here is a decision, not an oversight.

### Rejected

| Proposal | Why |
|---|---|
| **`/pattern/flags` regex literals** | Unfixably ambiguous with division in a homoiconic reader — demonstrated by a case where the literal spans two `(/ a b)` forms. No token ordering rescues it. Raw strings (`r"…"`) serve the need instead (D67). |
| **`(cast<T> x)` / `x as T` as type *tests*** | The runtime carries no evidence for a generic or structural cast, and a cast that cannot be checked is a lie. `:of` narrows soundly. *Conversion* is a different question and is served by `defcast`. |
| **`infix` — user-declared infix operators** | The operator set is closed on purpose (§2.2). |
| **`protected`** | The implementation-inheritance leak that Go and Rust both drop. Now `LL0015`. |
| **Predicate-lambda match arms** | Redundant with `:when` guards. Two spellings for one idea is a cost with no return. |
| **The `pattern -> Type =>` type-guard arm** | `:of` patterns already do this. |
| **Colon-path map access (`person:name`)** | Not a language feature; `:` is reserved for modifiers and keys. |
| **`:nullable` as a modifier** | It compiled clean and meant nothing. Optionality is `T?`, in the type, where the checker can see it. |
| **Scheme spellings (`nil?`, `set!`)** | Rejected by name in favour of `is-nil` and `set` (D21). |
| **Bare leading-zero octal (`017`)** | A well-known error source that buys nothing. `0o17` is required. |
| **Glyph head-operators (`:operator ·`)** | They would widen the closed head-operator set, and the character does not survive the identifier encoder. Allowed as *members* from U+2000 up (§6.8). |
| **Latin-1 operator glyphs (U+0080–U+00FF)** | Measured encoder collision. |
| **Refusing a decorator on a class** | Tried and withdrawn on evidence. The claim was that no class-shaped decorator can be written; a *pass-through* one — returning `original` unchanged — works, and the corpus already contained one. Only the *wrapping* shape fails, and which a `defmodifier` returns is not decidable in general, so a hard error there would break working code. `defattribute` (§6.4) serves the annotation case portably. |
| **Ruby-style searching `when /re/`** | A pattern that silently matches a substring is a bug factory. Regex in `match` is an anchored full match. |
| **Per-backend goldens** | They would let a divergence be recorded as expected — the opposite of what the corpus is for. |
| **Capturing goldens from a run** | Freezes bugs into "expected" (§1.2). |
| **Async combinators in `std/core/async`** | They need an await-ordering specification that does not exist yet. |
| **A generated placeholder name for anonymous functions** | `#<fn __ll_lam_3>` is the compiler-internal leak the display rules exist to remove (§11.4). |

### Parked

Considered, not decided, deliberately not being worked on.

| Proposal | State |
|---|---|
| **Mapped types, `keyof`, `T[P]`** | The worst fit of the bunch for an S-expression language. If ever wanted, only in a restricted compile-time form. Parked, not closed. |
| **A quoted-AST DSL and runtime `eval`** | Blocked on the metaprogramming tier (§6.11), which now has tiers (D69) but still no grammar. Its sub-question — is a quote a cons-list or an AST datum? — **is answered**: it was unanswerable as posed, because it is *both*, and the tier says which. |
| **Statically discharged (provable) refinements** | A separate verification project at Liquid-Haskell / F* / Dafny grade, sharing this predicate syntax. Kept separate on purpose (§5.7). |
| **A typed coroutine frame** | Named as the optimisation over the current promote-everything frame; not built (§9.5). |
| **Bounded generics and ergonomics** | `:where` relations, `with`-copy, `:readonly` fields, flags enums, attributes surfaced through reflection. Designed, unscheduled. |
| **Full Unicode case mapping** | Needs a vendored table. Deferred, not dropped; ASCII behaviour is documented rather than pretended (§11.3). |
| **Format specifiers (`{0:F2}`, alignment, culture)** | Need number-formatting rules that D51 has not specified (§11.4). |
| **A `Char` literal** | The display rules provisionally render `#\c`, but nothing can construct one. Whoever adds the literal decides the rendering. |
| **A differential fuzzer** | The recommended remedy for the fact that a behavioural corpus is a *regression* guard, not a *correctness* guard — it demonstrates features, it does not attack them. Two silent evaluation-order bugs once passed a fully green corpus, and three more defects (C.4) were later found to be invisible to the *oracle* as well, because both backends agreed. Also now a precondition for §13.4's deletion. |
| **A `--portable` advisory mode** | Would flag host-extern use at compile time. Proposed, unruled. |

---

# Appendix E — Prior art

l-lang's decisions are mostly *chosen* from existing designs rather than invented, and the sources
are worth naming.

**Language design**

| Source | What was taken |
|---|---|
| **Go** | Nominal types with structural interfaces (D42); no `protected` |
| **C#** | Class surface, generators as `IEnumerable`, LINQ, `string.Format` positional substitution, extension methods |
| **Rust** | `let` as a binding-immutability rule (D10); the crate as compilation unit (D35) |
| **Zig** | `comptime` as the metaprogramming tier (D3c) |
| **Common Lisp** | The condition system — `restart-case`, `handle`, `signal`, `invoke-restart` (D47) |
| **Scheme** | Considered and *departed from* on naming (D21) |
| **TypeScript** | Union and intersection types; narrowing by type guard (D41) |
| **Swift / Kotlin** | Optionality as a type-level flag rather than a union (D9) |

**Compiler architecture**

| Source | What was taken |
|---|---|
| **rustc MIR**, `rustc_codegen_ssa` | Neutral typed core plus per-backend pipelines (D45, D48) |
| **Kotlin IR**, **Swift SIL** | The same shape, independently — three precedents for one decision |
| **Rustlantis** | Differential fuzzing as the correctness instrument a feature corpus cannot be |
| **Grift / Siek** | Coercions as a distinct checked layer, and blame calculus (D46) |
| **Val / Hylo** | Value semantics as a language rule rather than a convention (D11) |
| **Dart `rti`**, **PureScript** | Erasure and the cost of runtime type checks — PureScript's deleted checks informed refusing the cast form |

**Runtime and library**

| Source | What was taken |
|---|---|
| **Russ Cox, RE1/RE2** | The linear-time matching property targeted for `std/text/regex` (D67) |
| **xoshiro256\*\* / SplitMix64** | The seeded generator behind `std/math/random` (D65) |
| **Ryū** and shortest-round-trip printing | `Real` rendering (§11.4) |
| **Howard Hinnant, civil-time** | The intended shape of a future date library |
| **C11 §7.13.2.1p3** | The `setjmp` clobber rule — which turned out to affect plain `try`/`catch` (§8.3) |

**A watch-item worth carrying forward**, recorded during the native-backend design work:

> Several arguments lean on *"LLVM has types, so this gets easier."* It is sometimes **backwards** —
> a native target makes you pay explicitly for things a dynamic runtime gave away for free.

---

*End of RFC-0001.*
