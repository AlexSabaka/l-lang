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

  // LL0030 (D71) -- a numeric literal with a leading zero.
  //
  // The radix is named by a PREFIX or it is decimal: `0x` hex, `0b` binary, `0o` octal, a `.` for a
  // Real, and otherwise a decimal integer starting with a significant digit. A leading zero names
  // nothing, and in C-family languages it silently names octal -- which is precisely the trap this
  // refuses. `0` itself is fine, and so is `0.5`; the rule only bites when digits FOLLOW the zero.
  //
  // Refusing is not optional here. Dropping the old bare-octal token without this would have left
  // `017` matching as a decimal integer, so a literal that means 15 today would quietly start meaning
  // 17 -- one silent wrong answer swapped for another, which is worse than either alone.
  LeadingZeroNumber: def<{ literal: string; suggestion: string }>(
    "LL0030",
    Error,
    (p) =>
      `'${p.literal}' has a leading zero, which names no radix. Write '${p.suggestion}' for the ` +
      `decimal value, or '0o…' for octal, '0x…' for hex, '0b…' for binary. A leading zero is octal ` +
      `in the C family and decimal here, so it is refused rather than quietly read as one of them.`
  ),

  // LL0031 (D72) -- one `:name` declared twice.
  //
  // D68's three roles share ONE namespace, deliberately: a `:foo` is a builtin modifier, a decorator
  // or an attribute, and never two of them. Without this the second declaration silently won and the
  // first stopped meaning anything -- `(defmodifier tag …)` then `(defattribute tag …)` left `:tag`
  // an attribute, so the decorator no longer wrapped and nothing said so.
  DuplicateAnnotation: def<{ name: string; first: string; second: string }>(
    "LL0031",
    Error,
    (p) =>
      `'${p.name}' is declared twice -- once as ${p.first}, once as ${p.second}. A ':name' is a ` +
      `builtin modifier, a decorator (defmodifier) or an attribute (defattribute), and never two at ` +
      `once: they share one namespace so that reading ':${p.name}' tells you what it does. Rename one.`
  ),

  // LL0032 (D72) -- an attribute argument that is not a literal.
  //
  // An attribute is DATA, carried in a metadata table that is emitted as data -- which is exactly why
  // it needs no evaluator and works on C. An argument that has to be run to be read is not data, and
  // silently dropping it would leave the annotation present with its arguments missing.
  AttributeArgNotLiteral: def<{ name: string }>(
    "LL0032",
    Error,
    (p) =>
      `an argument of ':${p.name}' is not a literal. An attribute is DATA -- it is carried in the ` +
      `reflection metadata, which is emitted as data and never evaluated -- so its arguments must be ` +
      `strings, numbers or booleans. A value that has to be computed belongs to a decorator ` +
      `(defmodifier), which runs.`
  ),

  // LL0033 (D68-a's debt) -- arguments that were almost certainly written SPACED.
  //
  // D68-a gated a modifier's argument bracket on adjacency, which fixed three constructs and turned
  // one working-by-accident spelling into an unhelpful error further along the line: `:retry [4]`
  // parses as a bare `:retry` followed by a vector, and the vector is then read as whatever the
  // construct expects next. The declared arity is what makes this legible -- `:retry` takes one
  // argument and was given none, and there is exactly one likely reason.
  ModifierArgsNotAdjacent: def<{ name: string; arity: number }>(
    "LL0033",
    Error,
    (p) =>
      `':${p.name}' declares ${p.arity} argument${p.arity === 1 ? "" : "s"} but was applied with ` +
      `none. Arguments must be ADJACENT to the modifier name -- write ':${p.name}[…]', not ` +
      `':${p.name} […]', because a spaced bracket belongs to the declaration (its parameter list, or ` +
      `its destructuring pattern) rather than to the modifier.`
  ),

  // LL0035 (D67) -- a regex pattern nested inside another pattern.
  //
  // `r"…"` in pattern position is sugar for a `:when` guard, and the rewrite happens at the match
  // ARM, where there is a subject to bind and guard on. Nested inside a vector or map pattern there
  // is no such place: the element is being destructured, not tested.
  //
  // Refused rather than left alone, because leaving it means the node stays an ordinary constant and
  // matches by EQUALITY against the pattern's own text -- so `[r"\d+" x]` would quietly test whether
  // the first element is the four characters `\d+`. That is the one outcome nobody writing `r"…"`
  // intends, and it would not error.
  RegexPatternNested: def<{}>(
    "LL0035",
    Error,
    () =>
      `a regex pattern is only allowed as a whole match arm, not nested inside another pattern. ` +
      `'r"…"' in a match arm lowers to a guard over the value being matched, and a nested pattern is ` +
      `destructuring rather than testing -- there is nothing there to guard. Bind the part you want ` +
      `and test it with ':when', e.g. '[first rest] :when (is-full-match r"…" first) => …'.`
  ),

  // LL0036 (D75) -- a decorator applied with a non-constant argument, or inside a function body.
  //
  // `:name[args]` is STATIC sugar: it is unfolded at compile time, so its arguments must be known
  // then. This is not a new kind of rule -- `:comptime` requires literal arguments (LL0099) for the
  // identical reason, and this is that reason applied to the other compile-time form.
  //
  // Nor is it merely unimplemented. A decoration whose argument is a runtime value is undecidable by
  // construction: a body that branches on the argument needs every branch to survive, and a
  // decoration inside a function body is a NEW decoration on every call, each needing its own setup
  // state. That is the definition of dynamic, and the dynamic form is spelled differently -- an
  // explicit wrapper, which works on both backends.
  DecoratorArgNotConstant: def<{ name: string; why: string }>(
    "LL0036",
    Error,
    (p) =>
      `':${p.name}' is a decorator, so it is applied at COMPILE TIME -- but ${p.why}. A decorator's ` +
      `arguments must be literals and the decoration must be at module level, the same rule ` +
      `':comptime' has and for the same reason. For a decoration that depends on runtime values, ` +
      `wrap explicitly instead: '(let f (${p.name} g))'.`
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

  // LL0038-LL0042 (D95) -- the `defsyntax` tier's refusals.
  //
  // All five are SYNTAX-band because the expansion stage runs between parse and syntax, before names
  // mean anything. A handler that fails has to be reported there or not at all: nothing downstream
  // models a `syntax-def`, so an unreported failure would leave the use site standing as a call to a
  // function that no longer exists -- the exact shape of the `:comptime` bug LL0099 was written for,
  // where the declaration was deleted and the call was not.

  // A second `defsyntax` of the same name. Keyed by name like every other registry here, so the later
  // one would simply WIN and the earlier stop applying -- the silent failure D72/LL0031 records for
  // `defmodifier`, where a decorator quietly stopped decorating and the program kept compiling.
  SyntaxRedefined: def<{ name: string }>(
    "LL0038",
    Error,
    (p) =>
      `'${p.name}' is already declared as a 'defsyntax' in this module. A second declaration would ` +
      `silently replace the first, and every use site before it would change meaning.`
  ),

  // Arity is checked BEFORE the handler runs, so the message can name both numbers. A handler called
  // with the wrong count would otherwise fail somewhere inside its own body, pointing at the template.
  SyntaxArity: def<{ name: string; expected: number; got: number }>(
    "LL0039",
    Error,
    (p) =>
      `the syntax '${p.name}' takes ${p.expected} form${p.expected === 1 ? "" : "s"}, but ${p.got} ` +
      `${p.got === 1 ? "was" : "were"} given. A 'defsyntax' is matched on shape, so the count is part ` +
      `of the form it accepts.`
  ),

  // Two budgets, because a macro runs away in two directions. `depth` is `(defsyntax loop [] (loop))`,
  // which expands into itself at one site forever; `total` is a handler that grows its output each
  // round -- bounded depth, unbounded work. A compiler that never returns is worse than one that
  // refuses, which is the argument the comptime interpreter's own step budget already makes.
  SyntaxRunaway: def<{ name: string; limit: string }>(
    "LL0040",
    Error,
    (p) =>
      `expanding '${p.name}' did not terminate (${p.limit} budget exhausted). A 'defsyntax' that ` +
      `expands into its own form, directly or through another, has no fixed point.`
  ),

  // The handler ran and raised. Carries the interpreter's own message, which names the construct it
  // could not evaluate -- the subset a handler may use is the comptime subset.
  SyntaxFailed: def<{ name: string; error: string }>(
    "LL0041",
    Error,
    (p) => `expanding '${p.name}' failed: ${p.error}`
  ),

  // A handler that answers 5 has not written a macro; it has written a function with the wrong
  // keyword. Refused by name rather than by whatever a raw value breaks downstream.
  SyntaxNotAForm: def<{ name: string; got: string }>(
    "LL0042",
    Error,
    (p) =>
      `the syntax '${p.name}' must expand to a FORM, but it answered ${p.got}. Build one with a ` +
      "quasiquote -- '`(if ~c nil ~body)' -- rather than returning a value."
  ),

  // LL0023 -- RE-AIMED by D102. It used to mean "macros are not implemented"; both tiers are built
  // now (D95-a `defsyntax`, D102 `defmacro`), so that message became false.
  //
  // It is NOT retired, because it is still reachable and still useful. The token expander reads a
  // `defmacro` by BRACKET MATCHING -- it must, since a file using one may not parse until after the
  // expansion -- and a form it cannot read is left alone. That form then reaches the parser as a
  // `macro-def` node, which nothing downstream models. Measured: `(defmacro)` with no name does
  // exactly this. So the code now says what the situation actually is, which is a malformed
  // declaration rather than a missing feature.
  MacroNotImplemented: def<{ keyword: string; name?: string }>(
    "LL0023",
    Error,
    (p) =>
      `this '${p.keyword}' could not be read by the macro expander, so it was never applied` +
      `${p.name ? ` -- '${p.name}' is not defined` : ""}. A '${p.keyword}' is ` +
      `'(${p.keyword} name [params] body…)'; the expander finds it by matching brackets before the ` +
      `parser runs, and skips anything that does not have that shape.`
  ),
};
