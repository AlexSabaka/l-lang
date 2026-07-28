> **ARCHIVED 2026-07-28.** The model case: it bannered itself SUPERSEDED by **D67** when the ruling
> landed, and every fork it opened is now ruled *and* built — the engine is l-lang
> (`lib/std/text/regex.lisp`), the literal is `r"…"` (so `/` is untouched), and it is not ambient.
>
> Kept for its measurements: the `/…/`-versus-division ambiguity demo, where the literal's own pattern
> spans two `(/ a b)` forms and no token ordering rescues it. That is the argument, and it is not
> restated at length in D67.

# Regex literals — recon on the parked frontend stub (2026-07-26)

> **SUPERSEDED by D67 (2026-07-26).** All three forks below are ruled: the engine is written in
> **l-lang** (Sabaka's `regex_poc.lisp`), not in C, which dissolves Fork 2 entirely; it lives in
> **`std/text/regex`** and is NOT ambient (Fork 3); and the literal is **`r"…"`, a prefixed RAW
> STRING** — not `/…/`, not a sigil — which sidesteps Fork 1's division ambiguity without touching `/`
> (Fork 1). `f"…"` joins it as the canonical formatted string with `'"…"` retained as an alias. This
> note is kept for the measurements it carries (the ambiguity demo, the stub's defects, the parked
> `stash@{0}`); read D67 for what was decided.

Sabaka started a `/pattern/flags` regex literal in the worktree. It is **parked**, not landed:

```
git stash list        # "WIP: regex literals frontend stub (parked from 2026-07-26 worktree)"
git stash show -p stash@{0}
```

The stash covers the five frontend files (`tokens.ts`, `Parser.ts`, `AstBuilder.ts`, `ast.ts`,
`BaseAstVisitor.ts`). The one hunk it does NOT carry is the JS emitter's visitor, reproduced here so
nothing is lost:

```ts
// JSTransformerAstVisitor.ts, beside visitString
visitRegex(node: ast.RegexNode): ESTree.CallExpression {
  return {
    type: "NewExpression",
    callee: ESTreeBuilder.identifier(node, "RegExp"),
    arguments: [ESTreeBuilder.literal(node, node.pattern), ESTreeBuilder.literal(node, node.flags)],
    loc: ESTreeBuilder.loc(node),
  };
}
```

## Why it was parked rather than landed

**The stub is inert.** `RegexLiteral` / `RegexFlags` are created but appear in neither
`defaultModeTokens` nor `allTokens`, so the lexer never emits them and the `regex` parser rule is
unreachable. Nothing regressed by it, and nothing worked either. Landing it as-is would commit an
unreachable rule plus a `console.log` into the parser hot path.

Three defects would have to be fixed even to make it reachable:

1. `RegexLiteral` carries `push_mode: "format_expr_mode"` — copied from the interpolation token. A
   regex literal must not push the string-interpolation lexer mode.
2. `isRegexLiteral()` is dead (never called) and contains a debug `console.log` that would fire on
   every lookahead.
3. `RegexFlags` is a standalone `[gimsuy]+` token. Registered before `Identifier` it swallows any
   identifier spelled from those letters (`i`, `sum`, `gym` all match); registered after, it never
   matches. Flags have to be part of the `RegexLiteral` pattern, not a token of their own.

**And one blocker that is not a defect but a design fork.**

## Fork 1 (blocking): `/…/` is ambiguous with division, and l-lang is a Lisp

`/` is the division head — `(/ 6 2)` — and an overloadable operator (`std/sys/path`'s join). The
literal's pattern `/(?:[^\/\\]|\\.)*\// ` is happy to run from one division to the next:

```
src = "(let a (/ 6 2))\n(let b (/ 8 4))"
match = "/ 6 2))\n(let b (/"
```

Chevrotain resolves by token-array order, so there is no ordering that rescues this: ahead of `Slash`
the regex eats across forms, behind it the regex never lexes. JS gets away with `/…/` because its
parser tracks expression-vs-operator position; a homoiconic reader has no such state. Options:

- **A sigil.** Clojure's `#"…"` precedent — `#/pattern/flags` or `#"pattern"`. Unambiguous with one
  token, no parser state. `#` is already in the `OperatorIdent` charset, so the new token must
  precede it in the array.
- **A form.** `(regex "pattern" "flags")` — zero lexer change, and it composes with the existing
  string machinery (including escapes, which `/…/` would need its own rules for).
- **Reader position tracking.** Rejected on sight: it puts JS's expression/operator state machine
  into a Lisp reader for one literal.

## Fork 2 (blocking): what does the C backend do?

There is no C lowering, and this is the expensive half. D66 makes C the sole target and JS an oracle,
so a JS-only `new RegExp` is precisely the divergence D66 exists to stop. On C the choices are:

- **POSIX `<regex.h>`** (`regcomp`/`regexec`) — in libc, zero dependency, but it is a *different
  language* from JS RegExp: no lazy quantifiers, no lookaround, no named groups, no `\d`/`\w`/`\s`
  shorthands (POSIX spells them `[[:digit:]]`), no Unicode properties. Byte-identical JS↔C on the
  corpus would then be false for anything past the common subset — which the corpus gate would catch
  as a failure, correctly.
- **Vendor an engine** into `runtime.c` (a backtracking matcher, or re2-style). Real work, full
  control, and the only route to one semantics on both backends.
- **Define an l-lang regex dialect** = the intersection we are willing to guarantee, and reject the
  rest at compile time (the same posture as D46's decidable-refinement fragment: ban what cannot be
  supported everywhere rather than let it silently diverge).

## Fork 3: literal, or `std/regex`?

`regex` is on Dove's Tier-1 list as a *module*, not as syntax. A `std/regex` with `Regex` as a value
type (compile / test / match / replace / split, Formattable) needs no grammar change at all, and a
literal can be added later as sugar over it once Forks 1–2 are settled. The reverse order — syntax
first, semantics later — is what left the stub inert.

## What else is missing beyond the frontend

- No `Regex` inferred type; `InferTypes` has no case, so a literal would flow as unknown/Any.
- No HIR lowering and no C emitter case — `onUnhandled` on the C path.
- No stdlib surface (test/match/replace/split/groups), no corpus example, no `c-status.ts` entry.

## Recommendation

Take it as a design round with a D-number, in this order: **Fork 3 first** (module or syntax),
then **Fork 2** (the C engine, which sets the dialect), then **Fork 1** (the literal spelling, if a
literal is wanted at all). The parked stash is the starting point for Fork 1 whenever it comes up;
its `RegexNode` shape (`pattern` + `flags`) survives any of these answers.
