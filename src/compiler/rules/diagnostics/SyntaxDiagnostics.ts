import { def } from "./Diagnostic";
import { RuleSeverity } from "../RuleBuilder";

const { Error } = RuleSeverity;

/**
 * The syntax/modifier diagnostics emitted imperatively by `SyntaxRulesAstVisitor` (D3/D4 and the
 * `for`-clause checks), migrated out of its `reportModifierError` helper.
 *
 * FINDING -- code collision with the declarative rules. These codes (LL0015-LL0019) are ALSO used by
 * `NodeValidationRules` for UNRELATED diagnostics: LL0015 there is "parameter modifier must be
 * in/out/ref", LL0016 "class must have a name", LL0017 an If/When "condition" clause, and so on. The
 * imperative and declarative diagnostics were numbered independently and overlapped. Preserved AS-IS
 * here -- renumbering changes an emitted code, which is a corpus-affecting, semantic decision, not a
 * refactor's call. The `test:diagnostics` allocator NOTEs the overlap so it stays visible; a later
 * phase can reassign these to free numbers deliberately.
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
