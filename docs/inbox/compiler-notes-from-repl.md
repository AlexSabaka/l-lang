# Compiler notes from the REPL refactor

**From:** the `repl-refactor` stream (worktree `../l-lang-repl`)
**To:** whoever is holding the compiler / audit-report stream
**Date:** 2026-07-13
**Status:** none of this is being fixed by me — the REPL refactor is scoped REPL-side only
(`src/cli/**`), by decision. This is a hand-off, not a complaint.

While making the REPL work again I found five defects and gaps that live under `src/compiler/`.
Two are real user-facing bugs that have nothing to do with the REPL. Three are missing seams that
force the REPL into workarounds it would rather not have. Ordered by how much I think they matter.

---

## 1. `__`-prefixed identifiers do not tokenize (grammar_v2) — **real bug, user-facing**

**`src/compiler/frontend/grammar_v2/tokens.ts:169`**

```ts
export const Underscore = createToken({ name: "Underscore", pattern: /_(?![a-zA-Z0-9])/ });
```

The negative lookahead omits `_` itself. So in `__private`, the first `_` is followed by `_` — not
an alphanumeric — the lookahead passes, and `Underscore` (the match-wildcard, which sits *before*
`Identifier` in the token array) wins. The identifier is shredded.

**Repro** (default frontend):

```lisp
( (let __x 1) )
```
```
Error: ...:1:8: Expecting token of type --> RParen <-- but found --> '_' <--
```

`(let _x 1)` and `(let a_b 1)` are fine — it is specifically **two or more leading underscores**.
Works under `--frontend peg`, so `test:diff-frontends` should be catching this and isn't.

This is the same family as the D14 bug (`(let nullable 1)` lexing as `null` + `able`) — a token that
needs to defer to a longer `Identifier` match and doesn't. The two candidate fixes:

- add `_` (and `-`, and the non-ASCII range) to the lookahead: `/_(?![a-zA-Z0-9_\--￿])/`
- or, more idiomatic and consistent with how every keyword in this file was fixed for D14, give it
  `longer_alt: Identifier`. A bare `_` still lexes as `Underscore` (no longer `Identifier` match
  exists); `__x` lexes as `Identifier` (7 chars beats 1).

I'd take `longer_alt` — it matches the D14 treatment and doesn't require getting a character class
exactly right.

**Why the REPL cares:** it doesn't, any more. The old REPL injected a boundary marker named
`__repl_marker`, which is why *every single REPL input* died at the lexer — that was the whole
"REPL is fully broken" story. The refactor removes the marker entirely (structural tail-codegen
instead of splitting generated JS on a marker string), so the REPL routes around this. But the bug
is still live for anyone who writes `__private` or `__init`, and it deserves a
`test:grammar-v2-smoke` case.

---

## 2. `checkBracketsBalance` is wrong in three ways — **real bug, and it crashes the REPL**

**`src/compiler/utils/checkBracketsBalance.ts`**

Signature is `true | number`, documented as "true if balanced, otherwise the number of unclosed
brackets". It does not honour that contract:

1. **Mismatched bracket returns a count, not an error.** `if (stack.pop() !== char) return stack.length;`
   — for `(]` that's `0`, which reads as "zero unclosed brackets", i.e. indistinguishable from
   balanced-but-not-`true`. There is no way for a caller to tell "you need more input" from "that
   bracket is wrong".
2. **Too many closers returns `-1`**, which is not "a number of unclosed brackets" either. This one
   is at least *documented* in a comment, but it means the return type has three semantic cases
   crammed into `true | number` with no way to discriminate.
3. **String scanning is naive.** `if (char === '"') inString = !inString;` — no escape handling, so
   `"a\"b"` toggles the flag three times and everything after it is misclassified. And `;` line
   comments are not skipped at all, so a `)` inside a comment counts.

Consequence in the old REPL: `-1 * 2 = -2`, then `".".repeat(-2)` → uncaught `RangeError`, **the
process dies**. Typing a single `)` at the prompt killed the REPL.

The REPL refactor ships its own reader (`src/cli/repl/readiness.ts`) returning a proper
discriminated union — `complete | incomplete(depth) | error(reason)` — with escapes and comments
handled, because it needs richer semantics than a shared util should carry. So **I am not touching
this file.** But it is still exported from `compiler/utils` and still wrong; if anything else calls
it, it has the same bugs.

---

## 3. `RuleValidationMessage` has no raw message — forces string-surgery on formatted output

**`src/compiler/rules/RuleBuilder.ts:92-115`**

```ts
export interface RuleValidationMessage {
  code: string; severity: RuleSeverity; source: string; line: number;
  get message(): string;   // <- lazily calls formatMessage(): chalk + terminal-width + source excerpt
}
```

`rule.message` (the raw human sentence) is captured in the closure and never exposed. The only way
out is `message`, which is a fully-rendered, chalk-coloured, `process.stdout.columns`-aware string
with a trailing `at <abs-path>:<line>:<col>`.

That's fine for `logCompilationMessages`. It is awkward for any *other* consumer:

- **The REPL** compiles a synthesized program (replayed history + the new input) written to a temp
  file. Line numbers in `message` are therefore absolute in a temp file the user has never seen —
  `at /var/folders/.../llang-repl-1783949087754.lisp:47:3`. The REPL has to reach into the rendered
  string and rewrite that fragment to point at the user's actual input line. It works, but it's a
  regex against another module's output format, and it will break the day `formatMessage` changes.
- Anything wanting **structured** diagnostics (LSP, an editor plugin, a JSON reporter) has the same
  problem, worse.

**Ask:** add the raw fields to `RuleValidationMessage` — `rawMessage: string` (the rule sentence) and
ideally `column: number` / the `_location` itself. Purely additive; `message` keeps working; every
existing caller is untouched. The REPL then renders its own diagnostic and drops the regex.

Also worth knowing: `formatMessage` calls `context.astProvider.getSource(...)`, which **throws**
`File ... not found in the AST cache` if the node's file isn't in *that* Context's cache. So a
`RuleValidationMessage` is not safely renderable outside the Context that produced it. That's a
sharp edge for anyone who wants to collect diagnostics across compilations.

---

## 4. `AstProvider` can only read from disk — no in-memory source entry point

**`src/compiler/frontend/AstProvider.ts:107-121`**

```ts
loadFile(filePath: string) {
  if (this.cache.has(filePath)) return;          // <- early return: same path, new text = STALE AST
  const source = fs.readFileSync(filePath, ...); // <- the only way in
  ...
}
```

Two coupled consequences:

- There is no "compile this string" path anywhere in the compiler. The REPL therefore **writes a
  temp `.lisp` file on every single keystroke-batch** purely to have something `AstProvider` will
  read. That is the only reason `os.tmpdir()` appears in the REPL at all.
- Because the cache is keyed on absolute path and early-returns on a hit, re-compiling the *same*
  path with *new* text silently returns the **stale AST**. So the REPL cannot reuse a `Context`
  even if it wanted to — it must throw the whole `Context` away and build a fresh one per input
  (fresh `Context` ⇒ fresh `AstProvider` ⇒ empty cache). It currently sidesteps this by also using
  a fresh temp path per input.

**Ask:** `loadSource(virtualPath: string, text: string)` (or an `invalidate(path)`). Small, additive.
It would let the REPL drop the temp-file dance entirely, and it's the prerequisite for any
in-editor/LSP use later.

---

## 5. `SymbolTable.join` blind-concats scopes — blocks a truly incremental REPL

**`src/compiler/analysis/SymbolTable.ts:444`**

```ts
join(other: SymbolTable): SymbolTable {
  this.scopes = [...this.scopes, ...other.scopes];   // no dedupe
  ...
}
```

Re-processing the same source into a reused `Context` piles up duplicate scopes without bound. Note
there is already a `joinWithoutDuplication` directly below it (which *does* dedupe by `scope.node`)
— `Context.processModule` uses the blind one.

I have not chased whether that's a live bug in the normal compile path (it may well be fine, since a
`Context` is per-compilation today and each module joins once). Flagging it because it is **the**
thing standing between the REPL and true incrementality: the REPL currently replays and fully
re-typechecks its entire history on every input — O(n²) — and the reason it can't just keep one
`Context` alive and feed it one form at a time is this plus #4.

Accepted as debt on the REPL side for now. At human REPL scale (hundreds of forms) the replay is
cheap. But if someone is already in `SymbolTable` for the audit, this is the seam.

---

## 6. Housekeeping: seven dead `docs/development/**` links in the README

`README.md` lines 98, 99, **105**, **161**, 187, 189, 192 all point into `docs/development/`, which
does not exist — `docs/` was flattened at some point. Line 105 and 161 advertise
`docs/development/REPL_GUIDE.md` as "complete REPL documentation". There is no REPL guide, and there
never was one in this tree.

I'll write real REPL docs at the end of the refactor and fix 105/161 then. The other five
(`IMPLEMENTATION_GUIDE.md`, `TODO.md`, `BUG_FIXES_SUMMARY.md`) are not mine — someone should either
restore them or cut the links.

---

## Summary

| # | Item | Kind | Blocks REPL? |
|---|---|---|---|
| 1 | `Underscore` lookahead shreds `__ident` | **bug** | routed around |
| 2 | `checkBracketsBalance` contract violations | **bug** | routed around (REPL-local reader) |
| 3 | No raw message on `RuleValidationMessage` | missing seam | worked around (regex) |
| 4 | `AstProvider` disk-only + stale cache | missing seam | worked around (temp files) |
| 5 | `SymbolTable.join` blind concat | missing seam | caps REPL at O(n²) |
| 6 | Dead README links | housekeeping | no |

1 and 2 are worth fixing regardless of the REPL. 3, 4 and 5 are the price of the REPL being a
second-class embedder of this compiler; none is urgent.
