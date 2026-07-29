/**
 * l-lang Lexer Tokens
 *
 * This lexer uses multi-mode lexing to handle formatted strings properly.
 * The key insight is that formatted strings need to balance {} braces for expressions.
 */
import { createToken, Lexer, TokenType } from "chevrotain";

// ============================================================================
// WHITESPACE & COMMENTS
// ============================================================================
export const WhiteSpace = createToken({
  name: "WhiteSpace",
  pattern: /[ \t\n\r]+/,
  group: Lexer.SKIPPED,
});

export const Comment = createToken({
  name: "Comment",
  pattern: /;[^\n\r]*/,
});

// ============================================================================
// IDENTIFIER - declared here (ahead of its "MUST be last" position in the
// token arrays below) so the keyword tokens can reference it via
// `longer_alt`. Array order below still governs lexer priority, not
// declaration order -- Identifier/OperatorIdent still go last in every mode's
// token list, exactly as the original.
// ============================================================================
// The \u0080-\uFFFF (non-ASCII) range matches the PEG frontend, whose `NonControl` class is a
// *negated* set of ASCII punctuation -- so every non-ASCII character is a legal identifier
// character there. l-lang leans on this: examples/20-stdlib/std/math.lisp declares the
// dot-product operator as `(fn :operator · [v2 <- Vector3] -> Real ...)`, naming it `·`
// (U+00B7). Restricting this token to ASCII made that file -- a `library` other tests import --
// impossible to tokenize at all.
// Only the non-ASCII range is added: every ASCII operator/bracket/keyword keeps its own token,
// and Identifier is last in the token arrays, so those all still win over it.
export const Identifier = createToken({
  name: "Identifier",
  pattern: /[a-zA-Z_\u0080-\uFFFF][a-zA-Z0-9_\-\u0080-\uFFFF]*/,
});

// Operator identifier (for operator overloading like `fn :operator + [...]`), and for the
// pipeline operators `|>` / `<|`. Declared here, ahead of its "MUST be last" position in the
// token arrays below, so LAngle can reference it via `longer_alt` -- array order still governs
// lexer priority, not declaration order.
export const OperatorIdent = createToken({
  name: "OperatorIdent",
  pattern: /[*+\-\\/^&%$#@!~=|<>?]+/,
});

// ============================================================================
// KEYWORDS
// Order: longer patterns first, then alphabetically
//
// D14 fix: every plain keyword below sets `longer_alt: Identifier` and drops
// the `/i` case-insensitive flag -- both were the single largest bug class in
// the l-lang stabilization audit. Without `longer_alt`, `(let nullable 1)`
// misparsed as LetKw + NilKw("null") + Identifier("able") because nothing
// told the lexer to prefer a longer Identifier match over a keyword prefix.
// See docs/spec/DECISIONS.md#d14.
// ============================================================================
// KEYWORD CATEGORIES -- so a keyword can still be DATA.
//
// A map key is a string, never syntax (D13: `{:my-key 1}` emits `{"my-key": 1}` verbatim). But the
// lexer runs context-free, so `{:from "src"}` lexed `:from` as the for-clause token and the map rule
// -- which wanted `Colon` + `Identifier` -- could not accept it. `{:step 1}` was a hard parse error:
// a step COUNT rejected because `for` has a step CLAUSE (AF-044). The PEG accepted these and emitted
// correct JS, so retiring it (Pb) removed the only way to write them.
//
// Two categories, because there are two token shapes:
//   - `BareKeyword`  -- `mut`, `fn`, `true` ...: the colon is a SEPARATE token, so `:mut` arrives as
//                       Colon + MutKw and only the `key` rule needs to accept it.
//   - `ModKeyword`   -- `:step`, `:from` ...: the colon is INSIDE the token, so `keyValue` needs an
//                       alternative that consumes the whole thing and strips the colon itself.
//
// `Lexer.NA` -- a category is never matched directly; it exists so `CONSUME` can name a whole family.
// Adding a keyword to either family is all a future token needs to stay usable as a key.
// ============================================================================
export const BareKeyword = createToken({ name: "BareKeyword", pattern: Lexer.NA });
export const ModKeyword = createToken({ name: "ModKeyword", pattern: Lexer.NA });

// ============================================================================
// Declaration Keywords
export const DefInterfaceKw = createToken({ name: "DefInterfaceKw", pattern: /definterface/, longer_alt: Identifier, categories: [BareKeyword] });
export const DefModifierKw = createToken({ name: "DefModifierKw", pattern: /defmodifier/, longer_alt: Identifier, categories: [BareKeyword] });
// D72 -- an ATTRIBUTE: annotation DATA, as opposed to `defmodifier`'s transformer. Declared as a name
// and typed parameters with no body, applied as `:name[args]` through D68-a's adjacency-gated
// modifier arguments, and carried into the reflection graph rather than run.
export const DefAttributeKw = createToken({ name: "DefAttributeKw", pattern: /defattribute/, longer_alt: Identifier, categories: [BareKeyword] });
export const DefStructKw = createToken({ name: "DefStructKw", pattern: /defstruct/, longer_alt: Identifier, categories: [BareKeyword] });
export const DefClassKw = createToken({ name: "DefClassKw", pattern: /defclass/, longer_alt: Identifier, categories: [BareKeyword] });
export const DefMacroKw = createToken({ name: "DefMacroKw", pattern: /defmacro/, longer_alt: Identifier, categories: [BareKeyword] });
// D95/D3 -- `defsyntax` finally gets a token. D3 reserved BOTH keywords and its own standing banner
// recorded that only one of them was: `defsyntax` gave `LL0210 is not defined`, the message any typo
// gets. Unlike `defmacro`, which is still refused by name (LL0023), this one is now IMPLEMENTED --
// D95 places its expansion between parse and syntax.
export const DefSyntaxKw = createToken({ name: "DefSyntaxKw", pattern: /defsyntax/, longer_alt: Identifier, categories: [BareKeyword] });
export const DefEnumKw = createToken({ name: "DefEnumKw", pattern: /defenum/, longer_alt: Identifier, categories: [BareKeyword] });
export const DefTypeKw = createToken({ name: "DefTypeKw", pattern: /deftype/, longer_alt: Identifier, categories: [BareKeyword] });
// D46/B-3: a user-defined CONVERSION -- a stripped function keyed by (source, target) rather than
// by name. Not a narrowing cast; RFC-0001 §5.6 refuses those, `:of` narrows soundly.
export const DefCastKw = createToken({ name: "DefCastKw", pattern: /defcast/, longer_alt: Identifier, categories: [BareKeyword] });
// The USE site of a `defcast`: `(cast<Real> c)`. A CONVERSION, not a type test -- RFC-0001 §5.6
// refuses narrowing casts and `:of` narrows soundly.
export const CastKw = createToken({ name: "CastKw", pattern: /cast/, longer_alt: Identifier, categories: [BareKeyword] });
// Control Flow Keywords
export const FinallyKw = createToken({ name: "FinallyKw", pattern: /finally/, longer_alt: Identifier, categories: [BareKeyword] });
export const MatchKw = createToken({ name: "MatchKw", pattern: /match/, longer_alt: Identifier, categories: [BareKeyword] });
export const WhileKw = createToken({ name: "WhileKw", pattern: /while/, longer_alt: Identifier, categories: [BareKeyword] });
export const CatchKw = createToken({ name: "CatchKw", pattern: /catch/, longer_alt: Identifier, categories: [BareKeyword] });
export const AwaitKw = createToken({ name: "AwaitKw", pattern: /await/, longer_alt: Identifier, categories: [BareKeyword] });
export const AsyncKw = createToken({ name: "AsyncKw", pattern: /async/, longer_alt: Identifier, categories: [BareKeyword] });
export const CondKw = createToken({ name: "CondKw", pattern: /cond/, longer_alt: Identifier, categories: [BareKeyword] });
export const WhenKw = createToken({ name: "WhenKw", pattern: /when/, longer_alt: Identifier, categories: [BareKeyword] });
export const TryKw = createToken({ name: "TryKw", pattern: /try/, longer_alt: Identifier, categories: [BareKeyword] });
// D47 conditions/restarts (C-native, JS-refused). Reserved keywords. Two of them carry a hyphen, which
// is a legal Identifier char -- so `longer_alt: Identifier` is MANDATORY (the D14 cure): it keeps every
// `handle-*` / `signal-*` prefix identifier (handle-request, signal-strength) lexing as an Identifier,
// since a strictly-longer match wins. Declared most-specific FIRST (restart-case / invoke-restart before
// their `signal`-less bare prefixes); array order in the mode lists below governs actual lexer priority.
export const RestartCaseKw = createToken({ name: "RestartCaseKw", pattern: /restart-case/, longer_alt: Identifier, categories: [BareKeyword] });
export const InvokeRestartKw = createToken({ name: "InvokeRestartKw", pattern: /invoke-restart/, longer_alt: Identifier, categories: [BareKeyword] });
export const SignalKw = createToken({ name: "SignalKw", pattern: /signal/, longer_alt: Identifier, categories: [BareKeyword] });
export const HandleKw = createToken({ name: "HandleKw", pattern: /handle/, longer_alt: Identifier, categories: [BareKeyword] });
export const ForKw = createToken({ name: "ForKw", pattern: /for/, longer_alt: Identifier, categories: [BareKeyword] });
export const IfKw = createToken({ name: "IfKw", pattern: /if/, longer_alt: Identifier, categories: [BareKeyword] });
// Module Keywords
export const ExportKw = createToken({ name: "ExportKw", pattern: /export/, longer_alt: Identifier, categories: [BareKeyword] });
export const ImportKw = createToken({ name: "ImportKw", pattern: /import/, longer_alt: Identifier, categories: [BareKeyword] });
export const FromKw = createToken({ name: "FromKw", pattern: /from/, longer_alt: Identifier, categories: [BareKeyword] });
// Other Keywords
export const KeyOfKw = createToken({ name: "KeyOfKw", pattern: /keyof/, longer_alt: Identifier, categories: [BareKeyword] });
export const MutKw = createToken({ name: "MutKw", pattern: /mut/, longer_alt: Identifier, categories: [BareKeyword] });
export const LetKw = createToken({ name: "LetKw", pattern: /let/, longer_alt: Identifier, categories: [BareKeyword] });
export const FnKw = createToken({ name: "FnKw", pattern: /fn/, longer_alt: Identifier, categories: [BareKeyword] });
// Boolean Literals (before Identifier)
export const TrueKw = createToken({ name: "TrueKw", pattern: /true|#t/, longer_alt: Identifier, categories: [BareKeyword] });
export const FalseKw = createToken({ name: "FalseKw", pattern: /false|#f/, longer_alt: Identifier, categories: [BareKeyword] });
// Nil. ONE bottom value (D9).
//
// `none` / `void` / `undefined` are DELETED as spellings. They lex as plain Identifiers now, and
// LL0210 refuses them -- which is the whole point: `undefined` was the SECOND bottom value, and four
// spellings of one value meant nobody could tell there were two of them.
//
// `null` survives ONLY as the JS-interop alias. It is the same node and the same emission as `nil`.
//
// `void` the spelling goes; `Void` the TYPE stays. They are distinguishable only because this token
// is case-SENSITIVE (D14) -- which the PEG's `"void"i` was not.
export const NilKw = createToken({
  name: "NilKw",
  pattern: /nil|null/,
  longer_alt: Identifier,
  categories: [BareKeyword],
});

// ============================================================================
// MODIFIER KEYWORDS (start with colon)
//
// These are the modifier names the *grammar* reserves (they occupy structural slots in
// classDecl/forExpr/condExpr/...). Every other `:name` is a generic modifier or map key and
// lexes as `Colon` + `Identifier` instead -- see the `Colon` token below.
//
// These precede `Colon` in the token arrays, so `:extends` wins over `Colon`+`Identifier`.
// The trailing `(?![a-zA-Z0-9_-])` is what stops that from over-matching: without it,
// `:extendsfoo` would lex as ExtendsModKw + Identifier("foo") rather than as a modifier named
// `extendsfoo`. Same over-match class as the `longer_alt` bug fixed in Phase 2a, and the same
// negative-lookahead idiom used by Dot/Pipe/Equal/LAngle/Underscore below.
//
// No longer_alt: these can never collide with Identifier (which never starts with `:`).
// Case-sensitive, consistent with the plain keywords above.
// ============================================================================
const modKwTail = "(?![a-zA-Z0-9_-])";
export const ImplementsModKw = createToken({ name: "ImplementsModKw", pattern: new RegExp(`:implements${modKwTail}`), categories: [ModKeyword] });
export const ExtendsModKw = createToken({ name: "ExtendsModKw", pattern: new RegExp(`:extends${modKwTail}`), categories: [ModKeyword] });
export const WhereModKw = createToken({ name: "WhereModKw", pattern: new RegExp(`:where${modKwTail}`), categories: [ModKeyword] });
// `:satisfies` -- the value-REFINEMENT clause on `deftype` (D46 amend). Reads with the implicit subject
// ("Int satisfies (0..255)"); `:where` dangled. Descriptive fragment only (ranges/enums/length) -- a
// refined `deftype` is a distinct newtype the compiler can lay out and check at boundaries.
export const SatisfiesModKw = createToken({ name: "SatisfiesModKw", pattern: new RegExp(`:satisfies${modKwTail}`), categories: [ModKeyword] });
export const CondModKw = createToken({ name: "CondModKw", pattern: new RegExp(`:cond${modKwTail}`), categories: [ModKeyword] });
export const ThenModKw = createToken({ name: "ThenModKw", pattern: new RegExp(`:then${modKwTail}`), categories: [ModKeyword] });
export const ElseModKw = createToken({ name: "ElseModKw", pattern: new RegExp(`:else${modKwTail}`), categories: [ModKeyword] });
export const InitModKw = createToken({ name: "InitModKw", pattern: new RegExp(`:init${modKwTail}`), categories: [ModKeyword] });
export const StepModKw = createToken({ name: "StepModKw", pattern: new RegExp(`:step${modKwTail}`), categories: [ModKeyword] });
export const EachModKw = createToken({ name: "EachModKw", pattern: new RegExp(`:each${modKwTail}`), categories: [ModKeyword] });
export const FromModKw = createToken({ name: "FromModKw", pattern: new RegExp(`:from${modKwTail}`), categories: [ModKeyword] });
export const AsModKw = createToken({ name: "AsModKw", pattern: new RegExp(`:as${modKwTail}`), categories: [ModKeyword] });
export const OfModKw = createToken({ name: "OfModKw", pattern: new RegExp(`:of${modKwTail}`), categories: [ModKeyword] });
export const IsModKw = createToken({ name: "IsModKw", pattern: new RegExp(`:is${modKwTail}`), categories: [ModKeyword] });
export const WhenModKw = createToken({ name: "WhenModKw", pattern: new RegExp(`:when${modKwTail}`), categories: [ModKeyword] });
// D47 `handle` clause head: `(:on Cond [c] ...)`. The modKwTail negative-lookahead stops `:on` from
// over-matching `:online`. A restart NAME or handle binder that spells `:on` is thus unavailable as a
// name (it lexes as this structural token) -- a SyntaxRules diagnostic should flag that, as for the
// other ~16 structural ModKeywords. (Post-parse shape checks are a follow-up; the token lands here.)
export const OnModKw = createToken({ name: "OnModKw", pattern: new RegExp(`:on${modKwTail}`), categories: [ModKeyword] });

// ============================================================================
// OPERATORS (Multi-char before single-char!)
// ============================================================================
export const RightDoubleArrow = createToken({ name: "RightDoubleArrow", pattern: /=>/ });
export const LeftArrow = createToken({ name: "LeftArrow", pattern: /<-/ });
export const RightArrow = createToken({ name: "RightArrow", pattern: /->/ });
// Compound Assignments
export const PlusEq = createToken({ name: "PlusEq", pattern: /\+=/ });
export const MinusEq = createToken({ name: "MinusEq", pattern: /-=/ });
export const StarEq = createToken({ name: "StarEq", pattern: /\*=/ });
export const SlashEq = createToken({ name: "SlashEq", pattern: /\/=/ });
export const PercentEq = createToken({ name: "PercentEq", pattern: /%=/ });
export const AmpersandEq = createToken({ name: "AmpersandEq", pattern: /&=/ });
export const PipeEq = createToken({ name: "PipeEq", pattern: /\|=/ });
export const CaretEq = createToken({ name: "CaretEq", pattern: /\^=/ });
export const TildeEq = createToken({ name: "TildeEq", pattern: /~=/ });
export const ExclamationEq = createToken({ name: "ExclamationEq", pattern: /!=/ });
export const EqualEq = createToken({ name: "EqualEq", pattern: /==/ });
export const ColonEq = createToken({ name: "ColonEq", pattern: /:=/ });
// Other multi-char operators
export const Spread = createToken({ name: "Spread", pattern: /\.\.\./ });
// The `..` RANGE operator (D46/B-0): EXACTLY two dots -- `(?!\.)` keeps it distinct from `...` (Spread).
// `Dot` below (single `.`, `(?!\.)`) and this are mutually exclusive by lookahead, so array order between
// the dot family does not matter; but see FloatNumber -- `0.` used to swallow the first dot of `0..100`.
export const Range = createToken({ name: "Range", pattern: /\.\.(?!\.)/ });
// Single-char operators with negative lookahead to prevent consuming multi-char
export const Dot = createToken({ name: "Dot", pattern: /\.(?!\.)/ });
export const Pipe = createToken({ name: "Pipe", pattern: /\|(?![=|>])/ });
export const Ampersand = createToken({ name: "Ampersand", pattern: /&(?![=&])/ });
export const Equal = createToken({ name: "Equal", pattern: /=(?![=>])/ });
// `longer_alt: OperatorIdent` is the D14 cure applied to operators (see LAngle below). Each of these
// excludes only a following `=` (so `+=`/`*=`/... still win as compound-assign tokens), NOT a
// following copy of itself -- so without the fallback `**` lexed as `Star Star`, `++` as `Plus Plus`,
// `--` as `Minus Minus`, breaking `(fn :operator ** ...)` at the parser and folding `(-- 5)` to NaN.
// A lone `+`/`*`/... still wins (OperatorIdent matches no further); the fallback fires only when a
// second operator char follows. `Pipe`/`Ampersand` already exclude their own double (`||`/`&&`), and
// `RAngle` is deliberately left uncured so nested generics still close as two `>` (`List<Int>>`).
export const Plus = createToken({ name: "Plus", pattern: /\+(?!=)/, longer_alt: OperatorIdent });
export const Minus = createToken({ name: "Minus", pattern: /-(?![=>])/, longer_alt: OperatorIdent });
export const Star = createToken({ name: "Star", pattern: /\*(?!=)/, longer_alt: OperatorIdent });
export const Slash = createToken({ name: "Slash", pattern: /\/(?!=)/, longer_alt: OperatorIdent });
export const Percent = createToken({ name: "Percent", pattern: /%(?!=)/, longer_alt: OperatorIdent });
export const Caret = createToken({ name: "Caret", pattern: /\^(?!=)/, longer_alt: OperatorIdent });
export const Question = createToken({ name: "Question", pattern: /\?/ });
export const Exclamation = createToken({ name: "Exclamation", pattern: /!(?!=)/ });
export const Tilde = createToken({ name: "Tilde", pattern: /~(?!=)/ });
export const Comma = createToken({ name: "Comma", pattern: /,/ });
/**
 * The match-wildcard `_`. And it USED TO SHRED `__private`.
 *
 * The lookahead was `/_(?![a-zA-Z0-9])/` -- which omits `_` itself. So in `__x`, the first `_` is
 * followed by `_`, not by an alphanumeric; the lookahead passes; and `Underscore` (which sits BEFORE
 * `Identifier` in the token array) wins. The identifier is shredded and the parse dies:
 *
 *     (let __x 1)   ->  grammar_v2: "Expecting RParen but found '_'"
 *                       peg:        fine
 *
 * A frontend divergence, live for anyone who writes `__private` or `__init` -- and it is exactly why
 * the old REPL was dead on the first keystroke: it injected a boundary marker named `__repl_marker`.
 *
 * This is the **D14 bug class**, unchanged: a token that must defer to a longer `Identifier` match and
 * does not. `(let nullable 1)` lexed as `null` + `able` for the same reason. So it gets the D14 cure --
 * `longer_alt: Identifier` -- rather than a fiddlier character class. A bare `_` still lexes as
 * `Underscore` (no longer Identifier match exists); `__x` lexes as `Identifier` (3 chars beats 1).
 */
export const Underscore = createToken({
  name: "Underscore",
  pattern: /_(?![a-zA-Z0-9])/,
  longer_alt: Identifier,
});

// ============================================================================
// BRACKETS & DELIMITERS
// ============================================================================
export const LParen = createToken({ name: "LParen", pattern: /\(/ });
export const RParen = createToken({ name: "RParen", pattern: /\)/ });
export const LBracket = createToken({ name: "LBracket", pattern: /\[/ });
export const RBracket = createToken({ name: "RBracket", pattern: /\]/ });
export const LBrace = createToken({ name: "LBrace", pattern: /\{/ });
export const RBrace = createToken({ name: "RBrace", pattern: /\}/ });
// `longer_alt` is what makes the reverse-pipeline operator `<|` work. Chevrotain picks the first
// token in ARRAY order that matches, not the longest -- and LAngle precedes OperatorIdent -- so
// `<|` matched LAngle and split into LAngle + Pipe, emitting an identifier named `<`. (`|>` was
// only fine by accident: Pipe's own pattern already excludes a following `>`.) With longer_alt,
// OperatorIdent wins whenever it matches MORE characters: `<|` -> OperatorIdent, while a plain `<`
// (generics `Box<Int>`, comparison `(< i 5)`) still lexes as LAngle, because there OperatorIdent
// matches no further than LAngle does.
export const LAngle = createToken({
  name: "LAngle",
  pattern: /<(?![-=])/, // Not followed by - or =
  longer_alt: OperatorIdent,
});
export const RAngle = createToken({ name: "RAngle", pattern: />(?!=)/ }); // Not followed by =
// Only `:=` is excluded (and `ColonEq` precedes this token in the arrays anyway, so it wins
// regardless). A colon followed by a letter MUST lex as `Colon` + `Identifier`: that is the
// sequence the `modifier` and `keyValue` parser rules consume, and it is the only design that
// can work -- `defmodifier` lets users define modifier names in l-lang source (`:logged`,
// `:retry`, ... in examples/06-modifiers), so they can never be enumerated as fixed tokens.
// The earlier `(?![a-zA-Z=])` made both of those rules unreachable and left 44/95 examples
// unable to tokenize at all.
export const Colon = createToken({ name: "Colon", pattern: /:(?!=)/ });

// ============================================================================
// LITERALS
// ============================================================================
// Numbers (Most specific first!)
export const ComplexNumber = createToken({
  name: "ComplexNumber",
  pattern: /[+-]?[0-9]+\.?[0-9]*[+-][0-9]+\.?[0-9]*[ij]/i,
});
export const FractionNumber = createToken({
  name: "FractionNumber",
  pattern: /[+-]?[0-9]+\/[0-9]+/,
});
// D71 -- `_` is a digit-group SEPARATOR: `1_000_000`, `0xDEAD_BEEF`, `0b1010_1010`.
//
// Python's strict rule, not C#'s: a single `_` BETWEEN digit groups, so `_1`, `1_` and `1__0` are all
// rejected. C# tolerates `1__000` and gains nothing for it. Every radix gets the same treatment, and
// the shape is always `<digits>(_<digits>)*` -- which cannot end in `_` by construction.
//
// The ordering matters and is a trap rather than a preference: `_` is an IDENTIFIER character and
// `Identifier` is greedy, so these patterns must stay ahead of it in the token array. If `1_000` ever
// fell through to `1` followed by the identifier `_000`, that is two perfectly valid tokens -- a
// silent wrong answer rather than a lex error.
export const HexNumber = createToken({
  name: "HexNumber",
  pattern: /0x[0-9a-fA-F]+(?:_[0-9a-fA-F]+)*/,
});
export const BinaryNumber = createToken({
  name: "BinaryNumber",
  pattern: /0b[01]+(?:_[01]+)*/,
});
// `0o17`, and ONLY `0o17` (D71). This was `/0[0-7]+/` -- bare leading-zero octal, the form the spec
// rejects by name, while the `0o` form it requires did not exist at all. `017` therefore meant 15,
// silently. It now falls through to `IntegerNumber`, which matches it whole so that the leading zero
// can be REFUSED with a location (LL0030) rather than quietly re-read as decimal 17: without that
// refusal this change would trade one silent wrong answer for a different one.
export const OctalNumber = createToken({
  name: "OctalNumber",
  pattern: /0o[0-7]+(?:_[0-7]+)*/,
});
/**
 * `4i`, `4.5j`, `1_000i`, `1e3i` -- an IMAGINARY literal (D88), desugared to `(Complex 0.0 n)`.
 *
 * DECIMALS ONLY, by ruling: hex/octal/binary take no postfix ever. That falls out of the token order
 * rather than needing a check -- Hex/Binary/Octal are matched BEFORE this, so `0xFFi` lexes as the hex
 * number `0xFF` followed by the identifier `i`, and fails as an ordinary undefined name rather than
 * silently becoming an imaginary hex.
 *
 * `[ij]` and not `[ijIJ]`: capital `I` is `std/math/complex`'s exported unit-imaginary CONSTANT, and a
 * postfix that shadowed it would make `I` mean two things one character apart.
 *
 * The leading `[+-]?` is safe here for the same reason it is on `IntegerNumber`: l-lang is prefix, so
 * there is no infix `x+4i` for a signed literal to swallow the operator of.
 */
export const ImaginaryNumber = createToken({
  name: "ImaginaryNumber",
  pattern:
    /[+-]?[0-9]+(?:_[0-9]+)*(?:\.(?!\.)(?:[0-9]+(?:_[0-9]+)*)?)?(?:[eE][+-]?[0-9]+)?[ij]/,
});
export const FloatNumber = createToken({
  name: "FloatNumber",
  // `(?!\.)` after the dot: `0.5` and trailing-dot `1.` still lex as floats, but `0..100` no longer has
  // its first dot swallowed into a `0.` float (which would leave a stray `.100`). Lets the `..` RANGE
  // operator sit flush against an integer -- `0..100` tokenizes as `0 .. 100`, same as `0 .. 100`.
  pattern:
    /[+-]?[0-9]+(?:_[0-9]+)*\.(?!\.)(?:[0-9]+(?:_[0-9]+)*)?(?:[eE][+-]?[0-9]+)?|[+-]?[0-9]+(?:_[0-9]+)*[eE][+-]?[0-9]+/,
});
export const IntegerNumber = createToken({
  name: "IntegerNumber",
  pattern: /[+-]?[0-9]+(?:_[0-9]+)*/,
});
/**
 * `r"…"` -- a RAW string (D67). Python's semantics exactly: no escape processing, so `r"\d+"` is the
 * four characters `\d+` where `"\\d+"` would be needed otherwise. That ergonomic difference IS the
 * motivation -- a regex is the program that suffers most from doubling every backslash.
 *
 * A raw string is a String and nothing more. It is NOT a Regex value: it costs nothing in the type
 * system and nothing in either backend, and `std/text/regex` keeps taking `String` patterns exactly as
 * it does today. A `Regex` type with comptime-compiled literals stays available as a later, purely
 * additive round.
 *
 * `\"` still does not terminate the string, and BOTH characters are kept -- Python's rule again. That
 * is the one place "raw" cannot mean "the lexer stops thinking", because otherwise a pattern could
 * never contain a quote at all.
 *
 * Ordering: anywhere ahead of `Identifier` (which is last) is enough. `r"x"` matches here first;
 * `robot` does not match at all and falls to `Identifier`; and `buf"x"` lexes as `buf` followed by a
 * plain string, because this needs `r` and `"` adjacent from the very first character.
 */
export const RawString = createToken({
  name: "RawString",
  pattern: /r"(?:[^"\\]|\\.)*"/,
});
// Formatted String Tokens (lexer mode switching)
//
// `f"…"` is the canonical formatted string as of D67, and `'"…"` is RETAINED as an alias rather than
// deprecated: Sabaka's objection is ergonomic and correct -- `'` and `"` are the same key under shift
// while `f` and `"` are not -- and `'` is already the quote reader-macro, so `'"` reads as a Lisp
// shorthand rather than as debt. Keeping both also avoids a 384-site sweep across lib, examples, the
// games repo and the scratchpads, two of which are embedded in TypeScript test sources (the trap that
// bit the P3a `<-` migration). Retiring `'"` later is one sed, so this is the reversible order.
export const FormattedStringStart = createToken({
  name: "FormattedStringStart",
  pattern: /(?:'|f)"/,
  push_mode: "formatted_string_mode",
});
export const FormattedStringEnd = createToken({
  name: "FormattedStringEnd",
  pattern: /"/,
  pop_mode: true,
});
export const FormatExprStart = createToken({
  name: "FormatExprStart",
  pattern: /\{/,
  push_mode: "format_expr_mode",
});
export const FormatExprEnd = createToken({
  name: "FormatExprEnd",
  pattern: /\}/,
  pop_mode: true,
});
export const StringContent = createToken({
  name: "StringContent",
  pattern: /(?:[^"\\{]|\\["\\/bfnrtu{]|\\u[0-9a-fA-F]{4})+/,
  line_breaks: true,
});
export const Quote = createToken({ name: "Quote", pattern: /'(?!")/ }); // Not followed by "
// D96 -- QUASIQUOTE. A template: quoted like `'`, except that a tight `~x` inside it is an UNQUOTE
// and splices `x`'s value in. Backtick was measured free before it was taken: it is not a token, and
// its only occurrences in the corpus and stdlib are inside comments.
//
// There is no Unquote token. `~` already lexes as `Tilde` (an operator-name character), and the
// parser reads a TIGHT `~x` inside a quasiquote as the unquote -- adjacency, exactly the rule D88/N4
// gave `..` and D93 gave `...`. Adding a second token for it would make `~` ambiguous everywhere
// else, which is the cost `,` was rejected for.
export const Quasiquote = createToken({ name: "Quasiquote", pattern: /`/ });
export const StringLiteral = createToken({
  name: "StringLiteral",
  pattern: /"(?:[^"\\]|\\.)*"/,
});

// ============================================================================
// OPERATOR IDENTIFIER (catch-all, must be last alongside Identifier)

// ============================================================================
// TOKEN GROUPS FOR LEXER MODES
// ============================================================================
export const defaultModeTokens: TokenType[] = [
  WhiteSpace,
  Comment,
  // Keywords (most specific first)
  DefInterfaceKw, DefModifierKw, DefAttributeKw, DefStructKw, DefClassKw, DefMacroKw, DefSyntaxKw, DefEnumKw, DefTypeKw, DefCastKw, CastKw,
  FinallyKw, MatchKw, WhileKw, CatchKw, AwaitKw, AsyncKw,
  // D47 restart keywords -- multi-word (hyphenated) forms FIRST so they win over their bare prefixes.
  RestartCaseKw, InvokeRestartKw, SignalKw, HandleKw,
  CondKw, WhenKw, TryKw, ForKw, IfKw,
  ExportKw, ImportKw, FromKw,
  KeyOfKw, MutKw, LetKw, FnKw,
  TrueKw, FalseKw, NilKw,
  // Modifier Keywords (start with :)
  ImplementsModKw, ExtendsModKw, WhereModKw, SatisfiesModKw,
  CondModKw, ThenModKw, ElseModKw,
  InitModKw, StepModKw, EachModKw, FromModKw,
  AsModKw, OfModKw, IsModKw, WhenModKw, OnModKw,
  // Multi-char operators first!
  RightDoubleArrow, LeftArrow, RightArrow,
  PlusEq, MinusEq, StarEq, SlashEq, PercentEq,
  AmpersandEq, PipeEq, CaretEq, TildeEq,
  ExclamationEq, EqualEq, ColonEq,
  Spread, Range,
  // Brackets
  LParen, RParen, LBracket, RBracket, LBrace, RBrace,
  LAngle, RAngle,
  // Literals (most specific first!) before single-char operators
  ComplexNumber, FractionNumber,
  HexNumber, BinaryNumber, OctalNumber,
  ImaginaryNumber,
  FloatNumber, IntegerNumber,
  RawString, FormattedStringStart, Quote, Quasiquote, StringLiteral,
  // Single-char operators after numbers (so +/- in numbers match first)
  Dot, Pipe, Ampersand, Equal, Plus, Minus, Star, Slash,
  Percent, Caret, Question, Exclamation, Tilde, Comma, Colon, Underscore,
  // Identifiers (MUST be last!)
  Identifier,
  OperatorIdent,
];

export const formattedStringModeTokens: TokenType[] = [
  StringContent,
  FormatExprStart,
  FormattedStringEnd,
];

// Format expression mode - supports nested expressions including nested {}
export const formatExprModeTokens: TokenType[] = [
  WhiteSpace,
  Comment,
  // Keywords
  DefInterfaceKw, DefModifierKw, DefAttributeKw, DefStructKw, DefClassKw, DefMacroKw, DefSyntaxKw, DefEnumKw, DefTypeKw, DefCastKw, CastKw,
  FinallyKw, MatchKw, WhileKw, CatchKw, AwaitKw, AsyncKw,
  // D47 restart keywords -- multi-word (hyphenated) forms FIRST so they win over their bare prefixes.
  RestartCaseKw, InvokeRestartKw, SignalKw, HandleKw,
  CondKw, WhenKw, TryKw, ForKw, IfKw,
  ExportKw, ImportKw, FromKw,
  KeyOfKw, MutKw, LetKw, FnKw,
  TrueKw, FalseKw, NilKw,
  // Modifier Keywords
  ImplementsModKw, ExtendsModKw, WhereModKw, SatisfiesModKw,
  CondModKw, ThenModKw, ElseModKw,
  InitModKw, StepModKw, EachModKw, FromModKw,
  AsModKw, OfModKw, IsModKw, WhenModKw, OnModKw,
  // Operators
  RightDoubleArrow, LeftArrow, RightArrow,
  PlusEq, MinusEq, StarEq, SlashEq, PercentEq,
  AmpersandEq, PipeEq, CaretEq, TildeEq,
  ExclamationEq, EqualEq, ColonEq,
  Spread, Range,
  // Brackets - FormatExprStart pushes another format_expr_mode for nesting
  LParen, RParen, LBracket, RBracket,
  FormatExprStart, FormatExprEnd, // {} with mode push/pop for nesting
  LAngle, RAngle,
  // Literals
  ComplexNumber, FractionNumber,
  HexNumber, BinaryNumber, OctalNumber,
  ImaginaryNumber,
  FloatNumber, IntegerNumber,
  RawString, Quote, Quasiquote, StringLiteral,
  // Operators
  Dot, Pipe, Ampersand, Equal, Plus, Minus, Star, Slash,
  Percent, Caret, Question, Exclamation, Tilde, Comma, Colon, Underscore,
  // Identifiers
  Identifier,
  OperatorIdent,
];

// ============================================================================
// LEXER DEFINITION
// ============================================================================
export const LLangLexer = new Lexer(
  {
    modes: {
      default_mode: defaultModeTokens,
      formatted_string_mode: formattedStringModeTokens,
      format_expr_mode: formatExprModeTokens,
    },
    defaultMode: "default_mode",
  },
  {
    ensureOptimizations: false,
    positionTracking: "full",
  }
);

// Export all tokens as an array for the parser
export const allTokens: TokenType[] = [
  // The CATEGORY tokens go in the PARSER's vocabulary, and in no lexer mode.
  //
  // `Lexer.NA` means they are never matched directly, so they must stay out of the modes above --
  // but Chevrotain computes category membership only for the token types it is actually handed, and
  // the parser is handed exactly this array. Without them here, `CONSUME(ModKeyword)` fails with
  // "Expecting token of type --> ModKeyword <-- but found --> ':step'": the token IS a ModKeyword,
  // the parser had simply never been told the category exists.
  BareKeyword,
  ModKeyword,
  ...defaultModeTokens,
  ...formattedStringModeTokens.filter((t) => !defaultModeTokens.includes(t)),
  ...formatExprModeTokens.filter(
    (t) => !defaultModeTokens.includes(t) && !formattedStringModeTokens.includes(t)
  ),
];
