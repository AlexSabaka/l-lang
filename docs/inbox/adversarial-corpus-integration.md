# Adversarial corpus integration

> **Note (post-integration reorg):** the paths in this writeup are as they were at
> integration time. `examples/` was subsequently reorganized into a decade-block
> taxonomy (`00-basics` … `20-algorithms`, `30-applications`, `80-adversarial`,
> `90-diagnostics`, `99-fixtures`), and the 7 full games under `30-games/` were
> dropped after their runnable feature-logic was extracted into `30-applications/`
> (they live on in the separate `l-lang-ex` repo). See the reorg commit and
> `src/test/manifest.ts` for current locations.

Folding three external directories of l-lang programs into `examples/` as adversarial
feature + language coverage — the regression net for the JS→LLVM backend split.

Sources:
1. `l-lang-post-audit/proposed-examples/` — 10 audit-authored corpus additions, each goldened.
2. `l-lang-post-audit/probes/` — ~300 audit probe programs (p0-smoke … p5-friction).
3. `l-lang-ex/` — 7 real games + `FINDINGS.md` (prior black-box adversarial analysis).

All work is staged, uncommitted. Only `examples/`, `src/test/manifest.ts`, and this doc
were touched. The compiler was not modified.

---

## Final tally — `npm test` GREEN

| bucket    | baseline | after | Δ    |
|-----------|---------:|------:|-----:|
| Passed    | 71       | 99    | +28  |
| Failed    | 0        | 0     | 0    |
| Errors    | 0        | 0     | 0    |
| Library   | 2        | 12    | +10  |
| Fixture   | 2        | 9     | +7   |
| XFail     | 16       | 18    | +2   |
| **Total** | 91       | 138   | +47  |

`+28 Passed` = **15 new green tests + 13 negative tests** (a passing negative counts as a pass).

**All auxiliary harnesses green after integration:**
- `test` — 99 pass / 0 fail / 0 error / 138 total
- `test:type-errors` — corpus diagnostics on passing tests **0** (target 0); 0 negative failures
- `test:codegen` — 299 cases / 0 failed
- `test:diagnostics` — 45 probes match / PASS
- `test:imports` — 19/19
- `test:repl` — 26 cases / 0 failed

**Integrated (green):** 15 · **Quarantined:** 15 (13 negative + 2 xfail) · **Fixtures:** 7 games ·
**Libraries:** 10 · **Dropped:** ~280 probes (redundant/noise — see §Dropped).

---

## The headline finding: the audit's #1 fix landed

The audit (at commit `23a24cd`) named its single highest-leverage fix **"brace every emitted
conditional body"** — it would retire the entire silent control-flow cluster CF1/CF2/CF3, the
only bugs that recurred across games. **At current HEAD (`e587922`, post-HIR) that cluster is
FIXED**, verified by re-running the exact minimal repros from the game reports:

| finding | repro | audit behaviour (silent wrong) | HEAD behaviour | now |
|---|---|---|---|---|
| **CF1** | `(\|\| false (return "early"))` | function fell through → `"fell-through"` | returns `"early"` | ✅ fixed |
| **CF2** | one-armed `if` as a `cond` clause body | dangling-else ate later clauses; `dispatch "a"`→`"default"` | `"none"`/`"B-fired"`/`"default"` | ✅ fixed |
| **CF3** | bare `(if …)` as a `match` arm body | arm silently vanished; `glyph 3 f f`→`"3"` | `"."` (arm fires) | ✅ fixed |
| **CP1** | `[x ...xs]` spread in array literal | dropped all but first → `[0,1]` | `[0,1,2,3]` | ✅ fixed |
| **PR3** | `"\x1b[2J"` hex escape | degraded to bare `x1b` | decodes to U+001B | ✅ fixed |

All five are pinned as **green regression guards** in `examples/80-adversarial/`, so the backend
split cannot silently reintroduce them. Also fixed and confirmed by the existing inline
`test:type-errors` suite: **TY1** (nil into a user type's `T?`), **TY7** (`Int[][]` 2D annotation),
**TY8** (`:extension` on a structural conformer refused, not a runtime crash).

---

## NEW bugs found during integration (flagged loudly, NOT papered over)

Each is quarantined (xfail / documented), never blessed with a wrong-output golden.

### 1. `:comptime` inliner regression — duplicate inlined `const` (xfail)
`examples/11-comptime/01_comptime_table.lisp` was **10/10 green under the audit's
`bin/verify-examples` at `23a24cd`; it is broken at HEAD.** A `:comptime` helper (`deg-to-rad`)
called by another `:comptime` fn (`cos2`), where `cosines` folds `cos2` **five times**, re-inlines
`deg-to-rad` into the same comptime-eval scope each fold and emits a duplicate
`const __ll_inlined_deg2dto2drad_1`. The evaluator throws *"Identifier … has already been
declared"* (LL0099). Squares/triangles/lookup-square fold fine — only **comptime-calling-comptime,
folded more than once** collides. Same family as ROADMAP-DELTA **AF-046**.
Expected output (for when it is fixed):
```
squares:   1 4 9 16 25 36 49 64
triangles: 1 3 6 10 15 21
cos table: 1 0.87 0.71 0.5 0
lookup-square 5  -> 25
lookup-square 99 -> -1
```

### 2. Hyphenated map field: dot-access mangles the hyphen (xfail — finding PR4, STILL LIVE)
`examples/80-adversarial/hyphen_field_encoding.lisp`. The `:next-dir` map key stays literal, but
dot access mangles `.next-dir` → `.next2ddir`, so the two spellings address different fields:
```
read-only half: undefined                              ← w.next-dir reads a key never written
after write: down
bracket: up                                            ← w["next-dir"] reads the original
whole map: {"next-dir":"up","next2ddir":"down"}        ← dot-WRITE created a second, mangled key
```
The only finding from the friction set that did NOT get fixed. Silent wrong answer; no golden.

### 3. `LL0231 "X is not a type"` regressed 3 of the 10 audit-blessed examples
A new/hardened diagnostic (post-`23a24cd`) now rejects annotations naming a non-type. It broke:
- `02_rpn_error_paths.lisp` — `-> nil` return type (×3). **Fixed in-place** → `-> Void` (the
  corpus convention; no green example uses `-> nil`, all 4 that do are xfail). Behaviour-preserving,
  golden unchanged. Now green.
- `06-import/02_packages/geometry/shapes.lisp` — `-> Float` (not a primitive). **Fixed in-place**
  → `-> Real`. Behaviour-preserving, golden unchanged. Now green.
- `11_comptime_table.lisp` — separately broken (bug #1 above), not this.

This is a real drift signal: the audit's `verify-examples` gate cannot catch a diagnostic that
lands *after* it ran. Both fixes are legitimate example-side corrections under current rules.

### 4. `LL0008` is reachable — contradicts COVERAGE-MATRIX
COVERAGE-MATRIX:127 recorded `LL0008` (two default `catch` blocks) as an *"unreachable predicate"*
that *"can never fire."* At HEAD it **fires cleanly** on `02-errors/diagnostics/ll0008_two_default_catch.lisp`.
Pinned as a negative test so it stays reachable.

### 5. `LL0014` / `LL0024` confirmed dead
Both probes (`ll0014-nameless-param`, `ll0024-bad-param-modifier`) **compile clean** at HEAD — no
diagnostic — confirming COVERAGE-MATRIX:126's "dead wiring" call. Dropped (cannot be negative tests).

---

## What was integrated, and where

### A. proposed-examples → 9 green + 1 xfail (`examples/`)
All re-verified against HEAD (not trusted from the audit commit). 7 compiled + matched their
shipped goldens byte-for-byte under the runner's normalization; 2 were fixed in-place (§NEW #3);
1 is xfail (§NEW #1).

| file | covers |
|---|---|
| `20-stdlib/02_linq_pipeline.lisp` | std/linq (15 exports) — first corpus consumer |
| `11-generators/00_generators_and_iteration.lisp` | `:gen`/`yield`, std/iter, raw `iter`/`next` cursor — first ever; **new category dir** |
| `06-modifiers/06_extension_methods.lisp` | `:extension` + method chaining — first ever |
| `07-async/01_async_pipeline.lisp` | std/async `Task<T>`/`Awaitable<T>` — first ever |
| `05-oop/03_dispatch_and_type_patterns.lisp` | `v :of T` type patterns, RTTI dispatch |
| `06-import/02_packages/` | multi-file `package.yaml` package + `:private` (main = test; 3 sub-files = library) |
| `10-algorithms/06_tokenizer.lisp` | match guards + std/string |
| `10-algorithms/07_state_machine.lisp` | two enums, pair-destructuring arms, `reduce` |
| `02-errors/02_rpn_error_paths.lisp` | try/catch error paths + `catch e :of Error` (fixed `nil`→`Void`) |
| `04-data-types/11_comptime_table.lisp` | **xfail** — comptime inliner regression (§NEW #1) |

### B. l-lang-ex games → 7 fixtures + 7 libraries (`examples/30-games/`)
All 7 games **compile clean**; none is node-runnable — the 5 terminal games drive an interactive
TTY (`node:readline` + `process.stdin.setRawMode` + `setInterval`), the 2 p5 games need a browser.
Every one dies at runtime on a host facility the golden harness cannot provide — the same shape as
the pre-existing `99-p5js/main.lisp` fixture. Kept as compile-checked, feature-dense adversarial
programs (records, structs, generics, packages, `:undoable`/`:extension` modifiers, generators,
async, operator overloading); their *runnable* bug repros live in `90-adversarial/`.

`snake` · `tetris` · `minesweeper` · `sokoban/` (package) · `dungeon/` (multi-file) · `boids-p5/` ·
`doodle-jump-p5/`. Each terminal game's manifest reason lists the FINDINGS it exposed.

### C. probes → 6 adversarial repros + 13 negatives
- **`examples/80-adversarial/`** — the p5-friction silent-bug repros, rewritten clean with headers
  documenting expected-vs-actual. 5 green guards (spread, return-in-`\|\|`, hex escape, cond
  dangling-else, match-arm-if) + 1 green paren-grouping guard + 1 xfail (hyphen, still live).
- **`examples/90-diagnostics/`** — 13 `negative` tests from `p1-matrix/ll*`, filling the
  coverage hole COVERAGE-MATRIX flagged (21 codes with zero asserting test).

---

## Full quarantine list

### Negative tests (13) — file MUST fail with the pinned code
| file | code | note |
|---|---|---|
| `ll0005_nameless_let` | LL0005 | `(let)` — never-exercised code |
| `ll0008_two_default_catch` | LL0008 | **now reachable** (contradicts COVERAGE-MATRIX, §NEW #4) |
| `ll0009_iface_invalid_member` | LL0009 | `defclass` inside `definterface` |
| `ll0010_iface_init` | LL0010 | initialized `let` in interface |
| `ll0011_iface_extern` | LL0011 | `:extern` method in interface |
| `ll0012_iface_body` | LL0012 | method with a body in interface |
| `ll0019_bare_let` | LL0019 | bare top-level `let x 5` |
| `ll0025_nameless_class` | LL0025 | `(defclass)` (runner frontend; peg diverges to LL0210) |
| `ll0026_if_no_cond` | LL0026 | `(if)` |
| `ll0028_when_no_then` | LL0028 | `(when)` |
| `ll0212_dup_decl` | LL0212 | duplicate `let` (snapshot pinned the non-firing shape) |
| `ll0217_import_empty` | LL0217 | `(import "")` (not LL0003 — masked) |
| `ll0100_hex_number` | LL0100 | hex literal parses, no emitter (representative of numeric tower) |

Codes newly asserted for the first time: LL0005, LL0009, LL0010, LL0011, LL0012, LL0019, LL0026,
LL0028, LL0100, plus LL0008/LL0025/LL0212/LL0217.

### XFail (2)
| file | reason |
|---|---|
| `04-data-types/11_comptime_table.lisp` | comptime inliner regression — duplicate inlined `const` (§NEW #1) |
| `90-adversarial/hyphen_field_encoding.lisp` | PR4 — hyphen field dot-access mangling, still live silent-wrong (§NEW #2) |

---

## What was dropped, and why

The `probes/` tree is ~300 files, mostly instrumentation for a **peg-vs-grammar_v2 cross-check**
that is not corpus-relevant, plus per-probe `out/`, `result.json`, `run.*.txt` build artifacts.
Integrated only the two slices that add unique, non-redundant corpus value (friction repros +
diagnostic negatives). Dropped, by category:

- **`p3-integration/` (~20)** — the audit already **distilled these into `proposed-examples/`**
  (tokenizer→`06_tokenizer`, state-machine→`07_state_machine`, rpn→`02_rpn`, linq→`02_linq`,
  generators→`00_generators`, async→`01_async`, extension→`06_extension`). Keeping both violates
  "prefer the clearest single version."
- **`p4-roadmap/x-*` (~20)** — reproductions of examples **already in the corpus as xfail**
  (`x-bfs`, `x-gol`, `x-scope`, `x-destructuring`, `x-quoting`, `x-maps`, `x-structs07`, …).
- **`p2-verify/` (~60)** — friction/gap **verification** runs; the findings they verify are
  captured either as `90-adversarial/` repros or in the game fixtures.
- **`p0-smoke/` (~4)** — trivial hello/import smoke, covered by `01-basics/`.
- **`p1-matrix/` non-`ll*` (~50)** — surface-coverage probes for constructs already `covered`.
- **`p2-gaps/g*` (~40)** — gap probes; their silent-bug findings are represented by the fixtures
  (the games hit them in situ) or superseded (several are now fixed, e.g. the CF/CP/PR cluster).
- **Dropped from the `ll*` negatives (5):** `ll0003`/`ll0020` (parse **throws** — not a located
  diagnostic, so `runNegativeTest` can't assert them), `ll0014`/`ll0024` (compile **clean** — dead
  wiring, §NEW #5), `ll0007` (already asserted by `02-errors/01_errors.lisp`).
- **`p5-friction/snake-main.lisp`** — the full snake game, redundant with `30-games/snake/`.

---

## Method notes
- Every classification was made by **compiling + running against current HEAD**, via a throwaway
  triage harness mirroring `runner.ts`'s exact compile options + `CHILD_ENV` (deleted after use).
- All green goldens were captured from **actual observed stdout** (byte-exact, incl. the lone-space
  line in `match_arm_bare_if.expect` and the literal `` escape in `hex_string_escape.expect`)
  and sanity-checked value-by-value — never hand-typed where an escape could slip.
- Nothing was committed. `l-lang-ex` (a separate git repo) was read-only.
