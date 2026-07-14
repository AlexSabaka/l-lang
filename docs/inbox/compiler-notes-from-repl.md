# Compiler notes from the REPL refactor

**From:** the `repl-refactor` stream (worktree `../l-lang-repl`)
**To:** whoever is holding the compiler / audit-report stream
**Date:** 2026-07-13
**Status:** none of this was fixed by the REPL stream — the refactor was scoped REPL-side only
(`src/cli/**`), by decision. This was a hand-off, not a complaint.

---

## TRIAGED ON THE DEV SYNC (2026-07-14)

**Six of the nine are closed.** Each was a real bug, and four of them were hurting *everyone*, not
just the REPL.

| # | Item | Outcome |
|---|---|---|
| **1** | `__ident` shredded by `Underscore` | ✅ **FIXED.** `longer_alt: Identifier` — the D14 cure, as recommended. Gated in `test:grammar-v2-smoke`, plus a guard that a bare `_` is still the wildcard. |
| **8** | `end.offset` inclusive, `getSource` slices exclusive | ✅ **FIXED — and it was worse than reported.** Not an off-by-one: **the two frontends disagreed about what the field MEANS.** grammar_v2 emitted Chevrotain's *inclusive* `endOffset`; the PEG emitted an *exclusive* one. So `getSource` was correct under `--frontend peg` and **truncated every diagnostic's source excerpt by one character under the default**. Fixed at the source (`AstBuilder`), so the REPL's `end + 1` — itself frontend-divergent — is gone. Gated. |
| **9** | codegen internals private, unenumerable | ✅ **FIXED (codegen half).** `beginProgram`, `getInlinedDefinitions`, `getOperatorRegistrations`, `getInlineStandardSymbols`, `populateTypesMetadata` are public; `compile()` uses the same seam. **The ask was hiding a bug:** `rootSource` is set on compile()'s first line, the REPL never calls compile(), so `isImportedSymbol` bailed on every symbol and **an `(import …)` in the REPL type-checked clean and died at run time.** Gated. `SYMBOL_MAP` enumeration: still open. |
| **7** | forward ref to a top-level `let` is unchecked | ✅ **RULED AND FIXED — D24.** It needed a *language ruling* first, and the obvious one was wrong: "functions and types may forward-reference" **permits the case that crashes**, because a class reads as a "type" while `class X {}` has a TDZ. The rule is **a value must be declared before it is EVALUATED** — deferred references (from a fn/method/lambda body) stay legal, as in every other language. **LL0219.** It also required fixing codegen first: `(f)` before its declaration printed the *function object*, which made "a function may be forward-referenced" a lie. |
| **3** | no raw message — string-surgery on formatted output | ✅ **FIXED.** `RuleValidationMessage` now carries `text` (the raw sentence), `column` and `location`; `message` is unchanged, so every existing caller is untouched. The REPL's ANSI-stripping regex is **deleted**, not kept as a fallback — a fallback that never runs is how a seam quietly stops being load-bearing. Also fixed the sharp edge the item flagged in passing: `formatMessage` **threw** out-of-Context (`getSource` → *File not found in the AST cache*), so merely *reading* `.message` could take the process down; it now degrades to the sentence. Gated end-to-end-anchored in `test:repl`. |
| **4** | `AstProvider` can only read from disk | ✅ **FIXED.** `loadSource(virtualPath, source)` — the compile-a-string entry point the compiler never had. **The REPL no longer writes anything to disk**; `.llang-repl.lisp` in the working directory is gone. `loadSource` *overwrites*, which also closes the stale-cache half of the item: `loadFile` early-returns on a cache hit, so re-reading a path with new text silently returned the old AST. `invalidate()` is the other half. Gated by a case that asserts the file was never created. |
| **6** | dead README links | ✅ `docs/repl.md` exists and is linked. The other five stale `docs/development/**` links: still open. |

**Still open, and correctly deferred:** #2 (`checkBracketsBalance` — still exported and still wrong;
nothing in the compiler calls it, so it is dead *and* wrong), #5 (`SymbolTable.join` blind-concats
scopes, which caps the REPL at O(n²)), and the two tails: `SYMBOL_MAP` enumeration (#9) and the five
stale `docs/development/**` links (#6).

**What the two seams cost to keep:** nothing, once found. #3 and #4 were each ~30 lines and *purely
additive* — no caller changed. What they bought is that neither workaround can rot: the REPL had been
parsing another module's output format with a regex, and writing a file to the user's working
directory on every keystroke-batch, and both of those would have kept working right up until they
didn't.

**Note on numbering:** this doc's `D17` is now **D23**. The REPL stream and `dev` minted `D17`
independently — two branches, one register, no lock.

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

## 3. `RuleValidationMessage` has no raw message — forces string-surgery on formatted output — ✅ **FIXED**

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

## 4. `AstProvider` can only read from disk — no in-memory source entry point — ✅ **FIXED**

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

## 7. A forward reference to a top-level `let` is not type-checked — **found on the dev sync**

Not a REPL bug, and not blocking me. Flagging it because I measured it and it is the kind of gap
this project takes seriously.

```lisp
(fn double [] -> Int (* x 2))   ; `x` is not declared yet
(let x "hi")
```

compiles **clean**. No LL0204. Reorder the two forms and the same program reports
`LL0204 Operator '*' is not defined for String and Int` — so the check exists; it simply does not
fire when the use precedes the declaration. Related, and already known from earlier planning:
`(let a x)` before `(let x 1)` inside a normal top-level block also compiles, and only fails at run
time with a TDZ `ReferenceError`.

Whether a top-level `let` should be forward-referenceable at all is a language ruling, not a bug
report. But **if it is, the reference must be type-checked**, and today it silently is not.

**Also worth knowing, since P6 changed it:** the checker used to read a second `(let x ...)` at the
same scope as an *assignment* to the existing symbol (LL0200: "cannot assign String to Int"). Since
P6 made resolution scope-aware it reads a second *declaration*. Nothing in the corpus depended on
the old behaviour — inside a file, a redeclaration in the same block is LL0212 either way — but the
REPL had been leaning on LL0200 without knowing it. The REPL now enforces one-name-one-type itself
(REPL0001, D23) and no longer depends on how the checker resolves anything.

---

## 8. `_location.end.offset` is INCLUSIVE, and `getSource` slices as if it were not

**`src/compiler/rules/RuleBuilder.ts:57`** → `AstProvider.getSource` (`AstProvider.ts:147`):

```ts
const res = source.slice(start, end);   // end === location.end.offset
```

Measured: for `(let x 10)` at offset 0, `end.offset` is **9** — the index of the closing paren, not
one past it. So `slice(start, end)` yields `"(let x 10"`. **Every diagnostic's source excerpt is
truncated by one character.** It is cosmetic, and it has been hiding in plain sight because a
missing trailing `)` in an error message reads as a wrapping artefact.

`.load` hit the same edge and has to slice `end + 1`. Either fix `getSource` to `end + 1`, or make
`end.offset` exclusive — but one of the two, because right now the field's meaning is decided
differently in different places.

---

## 9. `RuntimeProvider.SYMBOL_MAP` is private, so nothing can enumerate the builtins

The REPL's completer wants to offer the runtime's symbols (`head`, `tail`, `cons`, `list`, `get`,
`type`, …). They live in `private static readonly SYMBOL_MAP`, and the only accessor,
`getRuntimeShimForSymbols(symbols)`, wants the names as an *argument*. So the completer reaches in
with `(RuntimeProvider as any).SYMBOL_MAP`.

A `public static symbolNames(): string[]` would remove the cast. Worth it for a second reason: the
old hand-written completer offered `map`, `filter`, `reduce`, `fold` and `print` as builtins, and
**not one of them exists** — which is exactly the drift you get when a list cannot be derived.

Same shape, same ask, for `JSTransformerAstVisitor`'s `inlinedDefinitions`, `operatorRegistrations`
and `populateTypesMetadata` — the REPL drives codegen from outside the compiler and needs all three
after visiting, but `visitProgram`/`compile` (which it deliberately does not call) are what normally
drain them. Three more `as any` casts that a `public` would delete.

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
| 7 | Forward ref to a top-level `let` is unchecked | **bug** | worked around (REPL0001) |
| 8 | `end.offset` inclusive, but `getSource` slices exclusive | **bug** (cosmetic) | worked around (`end + 1`) |
| 9 | `SYMBOL_MAP` / codegen internals private, unenumerable | missing seam | worked around (`as any`) |

1 and 2 are worth fixing regardless of the REPL. 3, 4 and 5 are the price of the REPL being a
second-class embedder of this compiler; none is urgent.
