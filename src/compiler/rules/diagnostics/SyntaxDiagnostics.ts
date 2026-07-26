import { def } from "./Diagnostic";
import { RuleSeverity } from "../RuleBuilder";

const { Error } = RuleSeverity;

/**
 * The syntax/modifier diagnostics emitted imperatively by `SyntaxRulesAstVisitor` (D3/D4 and the
 * `for`-clause checks), migrated out of its `reportModifierError` helper.
 *
 * These codes (LL0015-LL0019) once COLLIDED with declarative `NodeValidationRules` of the same numbers
 * (unrelated: "parameter modifier must be in/out/ref", "class must have a name", If/When clauses) --
 * they had been numbered independently and overlapped. RESOLVED (D38): every doc and a live test
 * (`imports.ts`) references LL0015 as the "unknown modifier" error (the imperative one below), so the
 * imperative codes KEPT LL0015-LL0019 and the five declarative colliders moved to LL0024-LL0028.
 */
export const SyntaxDiagnostics = {
  // LL0015 -- D4: an unknown `:modifier`
  UnknownModifier: def<{ name: string; on: string; suggestion?: string }>(
    "LL0015",
    Error,
    (p) =>
      `Unknown modifier ':${p.name}'${p.on}.` +
      (p.suggestion ? ` Did you mean ':${p.suggestion}'?` : "") +
      ` Declare it with (defmodifier ${p.name} ...) if it is meant to be a custom modifier.`
  ),

  // LL0016 -- a modifier reserved for the native backend, used on the JS target
  ReservedNativeModifier: def<{ name: string }>(
    "LL0016",
    Error,
    (p) =>
      `':${p.name}' is reserved for the native backend and is not implemented on the JS target.`
  ),

  // LL0017 -- a `for` clause given more than once
  DuplicateForClause: def<{ kind: string }>(
    "LL0017",
    Error,
    (p) =>
      `Duplicate '${p.kind}' clause. Each 'for' clause may appear at most once; the first wins.`
  ),

  // LL0018 -- a `for` missing a required clause
  MissingForClause: def<{ name: string; why: string }>(
    "LL0018",
    Error,
    (p) => `'for' is missing its required '${p.name}' clause -- ${p.why}.`
  ),

  // LL0019 -- a bare (unparenthesized) top-level declaration
  UnparenthesizedForm: def<{ form: string }>(
    "LL0019",
    Error,
    (p) =>
      `'${p.form}' must be parenthesized: write (${p.form} ...). A bare declaration at the top ` +
      `level silently swallows the form that follows it.`
  ),

  // LL0023 -- D3: `defmacro`/`defsyntax` are reserved but not implemented in 0.x
  // LL0241 (D46/B-3) -- a `defcast` must say WHEN it fires.
  //
  // `:implicit` is chosen by the compiler at coercion sites; `:explicit` only ever fires at a written
  // `(cast<T> x)`. They are not defaults for one another and the difference is the whole safety
  // story, so neither is assumed: a conversion that fires silently when the author meant it to be
  // asked for is exactly the C++ mistake D46 cites. Both at once is equally meaningless.
  CastNeedsOneKind: def<{ found: string }>(
    "LL0241",
    Error,
    (p) =>
      `a 'defcast' must carry exactly one of ':implicit' or ':explicit' (D46/B-3), but ${p.found}. ` +
      `':implicit' fires by itself at assignment, argument and return positions; ':explicit' fires ` +
      `only where '(cast<T> x)' is written. Neither is the default for the other.`
  ),

  // LL0243 (D46/B-3) -- an `:implicit` conversion whose TARGET is a refined newtype.
  //
  // B-3 permits implicit conversion for "lossless widening only", and in general only the author can
  // assert that. This is the one case the compiler can see for itself: entering a refined newtype
  // runs its range check, which PANICS on a value outside the range. A conversion that can abort the
  // program is exactly what must not fire without being written. `:explicit` is the form for it --
  // the range is still enforced, the author just has to ask.
  ImplicitCastToRefined: def<{ target: string }>(
    "LL0243",
    Error,
    (p) =>
      `an ':implicit' defcast cannot target '${p.target}', which is a refined newtype: entering it ` +
      `runs a range check that panics out of range, and a conversion that can abort the program must ` +
      `not fire silently. Declare it ':explicit' and write '(cast<${p.target}> x)' at the sites you ` +
      `mean it.`
  ),

  MacroNotImplemented: def<{ keyword: string; name?: string }>(
    "LL0023",
    Error,
    (p) =>
      `'${p.keyword}' is not implemented in 0.x. Macros are planned, and the keyword is ` +
      `reserved${p.name ? ` -- '${p.name}' is not defined` : ""}. ` +
      `Metaprogramming today is ':comptime' (compile-time evaluation) and ` +
      `'defmodifier' (a decorator).`
  ),
};
