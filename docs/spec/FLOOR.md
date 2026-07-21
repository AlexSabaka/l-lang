# The intrinsic floor — the runtime contract both backends must not diverge on

> **Status: the standard, not yet the library.** Almost none of this is implemented — the JS backend
> reaches host globals, the C backend reaches `runtime.c` + a private `intrinsics.ts` table, and the
> two are only *accidentally* in agreement wherever the corpus happens to be ASCII and integer-valued.
> This document is the ruling that turns that accident into a specification, plus the worklist that
> Phase F executes against.
>
> Rulings live in [`DECISIONS.md`](./DECISIONS.md) as **D50–D54**. This is their evidence and their
> expansion. It is the runtime-boundary companion to [`STDLIB.md`](./STDLIB.md) (Phase S): Phase S
> decides *where the library lives and what it exports*; Phase F decides *what sits below it that a
> library cannot be written without*.

---

## 1. The floor is the divergence surface

[D48](./DECISIONS.md)'s governing rule (**A-0**) is the whole instrument: *a decision **both**
backends make stays core and must be nodified so they cannot diverge; a thing leaves core only if it
is genuinely single-backend.* D48 applies it to the **HIR** — the compile-time contract. The floor is
**the same rule one layer down**, at the **runtime** contract: a runtime operation both backends
perform must be specified once, so the two implementations cannot silently drift.

They *do* drift today. The [§5.2 parity audit](../inbox/c-backend-gap-ledger.md) found seven executable
corpus files where **C runs and prints a wrong answer** — the silent-wrong class — in four clusters,
all of them a runtime primitive implemented twice and disagreeing:

| cluster | JS | C | now a guard |
|---|---|---|---|
| `print` `{0}` positional | `x=5` | `x={0} 5` | `80-adversarial/print_positional_format.lisp` |
| container-in-string | `[ 1, 2, 3 ]` | `1,2,3` | `80-adversarial/interp_container_format.lisp` |
| reflection depth | full `{kind,params,…}` | `{name,extends}` | `80-adversarial/reflection_metadata_depth.lisp` |
| modifier side effects | `[log]` prints | (C refuses, fail-closed) | — |

And that is only what an **all-ASCII, small-integer** corpus exposes. Two divergences are latent,
untested because nothing exercises them: `(length "café")` is 4 on JS (UTF-16 units) and 5 on C
(UTF-8 bytes); `(+ 9007199254740992 1)` is exact on a native `int64_t` and lossy on an f64. The
corpus is green over both. **A green suite is not parity; it is parity *on the inputs the suite
happens to use*.**

The ledger already names the hole and its size. **A9-extern — the extern boundary — is 642 dips,
"unmodeled by the spec; every program preludes `std/js`."** [D49b](./DECISIONS.md) points a
second finger at the same place: the residual void-in-value bug is *"blocked on the `std/js` surface
declaring its return types somewhere both backends read."* The floor **is** that surface — a single
typed contract that replaces the two private, untyped halves the boundary is made of today:

- the C backend's `codegen/c/intrinsics.ts` — ~90 name→function mappings, a table only C reads;
- the `lib/std/js.lisp` prelude — 37 `:extern` names, all `Unknown`, a list only JS reads.

Neither is checkable against the other. The floor makes them one.

---

## 2. What is irreducible, and what collapses

The design rule, op by op: **push down to pure l-lang unless the op is irreducible** — needs a
syscall, hardware, a host facility, or a representation primitive l-lang cannot express. Everything
reducible becomes l-lang written *on* the floor, and is therefore portable by construction: one
source, both backends run it.

**The floor (irreducible; per-backend; conformance-tested):**

| group | primitives | note |
|---|---|---|
| strings | `codepoint-at` `codepoint-length` `string-from-codepoints` `concat` | codepoint model; a codepoint is the existing `Char` (`uint32_t`) |
| case | `codepoint-upcase` `codepoint-downcase` | one **vendored** simple-case table, compiled into both runtimes |
| numbers | `number->string` `string->number` `truncate` | `number->string` is shortest-round-trip (Ryū on C, `.toString` on JS) |
| math | `sqrt sin cos tan asin acos atan atan2 exp log pow` | host libm / `Math`; last-ULP tolerance documented |
| vectors | `vec-new` `vec-push!` `vec-get` `vec-set!` `vec-length` | the growable-array representation |
| maps | `map-new` `map-get` `map-set!` `map-has` `map-delete` `map-keys` | insertion-ordered; **String** keys |
| equality | `equals` | structural, deep |
| reflection | *(backend emits the metadata graph)* | shape is spec'd, not per-backend (§D54) |
| i/o sink | `write-string` `write-string-err` | raw stdout/stderr; **no** formatting |
| host | `random` `now` `clock` `args` `env` `exit` | syscalls / entropy |

**Pure l-lang, on the floor (portable by construction):** all of `std/core`
(`head tail cons elem get empty`), `std/seq` (`map filter reduce zip range reverse flatten sort first
last at`), `std/string` (`starts-with ends-with includes index-of trim split join substr pad* repeat
replace upcase downcase`), `std/io` (`print println prn` + the `{0}` substitution), `std/fn`, the
display/`inspect` formatter, the number predicates, and the derived math
(`abs min max round floor ceil sign inc dec`).

`intrinsics.ts` goes from **~90 entries to ~28** — and each of the ~28 is a *typed* signature both
backends read, not a name C maps in private.

---

## 3. The rulings

### D50 — the intrinsic floor is a typed, minimal, shared contract

The floor is the smallest set of runtime operations that (a) are irreducible per §2 and (b) both
backends must implement to one specification. It is expressed as **typed signatures both backends
consume** — the same file resolves the C runtime function *and* the checker's view of the name —
retiring the private `intrinsics.ts` table and the untyped `std/js` prelude as separate things.
Everything not on the floor is l-lang and is never a backend primitive. This is D48 A-0 at the
runtime boundary, and it is the modeled answer to the ledger's A9-extern row and D49b's residual.

*Why minimal:* every floor entry is a divergence risk that must be conformance-tested; every op
pushed to l-lang is a divergence made **impossible**. The floor is a cost, not a convenience.

### D51 — the numeric floor: `Int` is wrapping `int64`, `Real` is `f64`

`Int` is a **wrapping 64-bit two's-complement integer** on both backends; `Real` is IEEE-754
double. This completes the D43 → [D49d](./DECISIONS.md) arc: the static type does not merely
decide *operations* (D49d gave `Int / Int` integer division), it decides **representation**.

- **Materialisation.** C: `int64_t` with `-fwrapv` (or `uint64_t` arithmetic cast back) — plain
  signed overflow is UB and would not *be* wrapping. JS: `BigInt`, normalised with
  `BigInt.asIntN(64, …)` after each op. This is a **real migration of the working JS backend** off
  f64 for `Int`; it is the most expensive item in Phase F and is why it is ruled explicitly rather
  than drifted into. Output is golden-stable — `String(5n)` is `"5"`, no `n`.
- **`number->string`** is shortest-round-trip (the JS `Number.prototype.toString` result is the
  spec; C vendors a Ryū/Grisu snippet to match). `0.1` prints `0.1`, not `0.100000`.
- **Division** per D49d: `Int / Int` truncates toward zero; a `Real` operand promotes to `Real`.
  **Modulo** matches — truncated, sign-of-dividend (`-7 % 2 = -1`).
- **Mixed** `Int`/`Real` arithmetic promotes to `Real`; a numeric literal with a `.` is `Real`,
  else `Int`. `==` is numeric (`1 == 1.0` is true); `equals` is structural-and-typed (§D53).
- **Bitwise** (`<< >> & | ^ ~`) is well-defined on `Int` because `Int` is now genuinely `int64`.
- **Transcendentals** use host libm / `Math`; a last-ULP mismatch is a documented tolerance caught
  by a not-yet guard, not a vendored correctly-rounded library.
- **Derived** math (`abs min max round floor ceil sign`) is l-lang on `truncate` + comparison;
  `round`/float→int tie-breaks adopt the JS rule (`2.5 → 3`, `-0.5 → -0`).
- `string->number` on malformed input is **nil** (a [D9](./DECISIONS.md) optional), not `NaN`.

### D52 — the string floor: Unicode codepoints

A `String` is a sequence of **Unicode scalar values** (codepoints), not UTF-16 code units and not
bytes. `(length "café")` is 4; `(length "😀")` is 1. A codepoint is the existing `Char` (`uint32_t`),
so `codepoint-at` returns a `Char` with no new type.

- **Floor:** `codepoint-at`, `codepoint-length`, `string-from-codepoints`, `concat`, plus the
  vendored simple-case pair. C decodes UTF-8; JS iterates scalar values (`[...s]`, never `.length`).
- **Everything else is l-lang** on those: `starts-with`, `includes`, `index-of`, `trim`, `split`,
  `join`, `substr`, `slice`, `pad*`, `repeat`, `replace`, `char-at`, `upcase`, `downcase`.
- **Case** is Unicode-correct via one **vendored** simple-case-mapping table shared by both
  runtimes (`towupper`/`toUpperCase` are locale/ICU-version-dependent and would diverge — the exact
  §5.2 class of bug). `(upcase "café") → "CAFÉ"`.
- **Consequence:** non-ASCII goldens change from the JS-UTF-16 accident to the correct codepoint
  count — a one-time re-capture, pinned by a guard so the change is visible, not silent.

### D53 — the container floor: primitive `vec` and `map`, structural `equals`

- **Vectors** are a floor representation (`vec-new/push!/get/set!/length`); `pop shift unshift
  reverse slice concat join index-of includes map filter reduce zip range flatten` are l-lang.
  `sort` is a **stable mergesort in l-lang** (host `sort`/`qsort` differ on stability).
- **Maps** are a floor representation, **insertion-ordered** with **String** keys
  (`map-new/get/set!/has/delete/keys`). Insertion order is spec'd because the corpus already bakes
  it into goldens (`JSON.stringify`, nested `:kw` maps, `inspect`). Richer keys are a later,
  separate expansion.
- **`equals`** is a structural, deep floor primitive: `[1 2]` equals `[1 2]`, `{:a 1}` equals
  `{:a 1}`. `includes`, `index-of`, and set/uniq operations are l-lang built on it. (An l-lang
  `equals` recursing on reflection tags was the alternative; a floor primitive is chosen for speed
  and one canonical spec.)

### D54 — display is node's `util.inspect`; reflection has one metadata shape

- **Display.** The canonical rendering of a value in interpolation, `console.log`, and `inspect`
  is **node's `util.inspect`** — `[ 1, 2, 3 ]`, `{ a: 1, b: 2 }`, single-quoted `'a'`, its depth
  and wrapping rules. Both backends reproduce it exactly. Chosen for golden-stability (zero corpus
  churn); the C side mimics node rather than the two agreeing on a cleaner l-lang format.
- **Reflection.** The backend **emits the metadata graph** (a class's fields/methods/params, a
  function's params/returns/nullable) into the runtime; the **accessor shape is the spec, not
  per-backend**. The JS `type`/`type-by-name` object is that spec — `{name, kind, params:[{name,
  type}], returns, nullable}` for a function, `{name, kind, properties, methods, constructor,
  nullable}` for a class — and `reflection_metadata_depth.lisp` pins it. [D48-Q5](./DECISIONS.md)
  put field types on the HIR class node (`af6047e`); the residual is purely that the C *runtime*
  descriptor does not yet emit them.

---

## 4. The worklist — Phase F

In dependency order. Each sub-phase lands its floor primitives **and** the conformance guards that
prove parity, then collapses the corresponding `std/*` module to l-lang on top of them.

- **Fa — the shared typed surface (D50).** One typed floor contract; retire `intrinsics.ts`'s private
  table and fold the typed slice of `std/js` into it. Unblocks D49b's void-in-value residual (the
  boundary now declares return types both backends read). *No behaviour change; the plumbing.*
- **Fb — the i/o + format base.** `write-string` as the only sink; `print`/`println`/`prn` and the
  `{0}` substitution become l-lang on it. **Greens §5.2 cluster 1.**
- **Fc — the display formatter (D54).** l-lang `inspect` reproducing `util.inspect`, on
  `number->string` + reflection tag. **Greens §5.2 cluster 2.**
- **Fd — reflection depth (D54).** C runtime emits the metadata graph now on the HIR class node.
  **Greens §5.2 cluster 3.**
- **Fe — the numeric floor (D51).** The hard one: JS `Int` → `BigInt`, C `-fwrapv` + vendored Ryū
  for `number->string`. Guarded by an overflow/precision differential and a float-formatting
  differential (both currently latent).
- **Ff — the string floor (D52).** C UTF-8 decode, JS scalar-value iteration, the vendored case
  table; `std/string` collapses to l-lang. Guarded by a non-ASCII length/case/index differential;
  re-capture the affected goldens once.
- **Fg — containers + equality (D53).** `vec`/`map` primitives, structural `equals`; `std/seq`
  collapses to l-lang.

**The three hard, up-front items** — vendored **Ryū**, **UTF-8 decode**, the vendored **case table**
— are each real work and each, until done, is exactly one named not-yet guard, the same pattern the
§5.2 three already establish. Nothing is silently deferred.

---

## 5. Conformance — how the floor stays undivergent

The mechanism already exists and needs no new machinery:

- **One golden, both backends.** `npm test` checks JS against the `.expect`; `npm run test:c`
  checks C against *the same* `.expect`. Parity is the default grading, not an extra pass.
- **Differential guards in `examples/80-adversarial/`.** Each floor primitive that can diverge gets
  a minimal JS-green guard documenting expected-vs-C. The [§5.2 three](../../examples/80-adversarial)
  are the first; Phase F adds the latent ones (overflow, float format, non-ASCII length/case).
- **The ratchet in `src/test/c-status.ts`.** A guard absent from `C_PASSING` is soft `not-yet`
  (never red) until C reaches parity; the moment it passes while unlisted the ratchet turns **red**
  ("add it"), forcing promotion. Silent divergence becomes a named, self-announcing target.

A floor primitive is **done** when its guard is green on both backends and lives in `C_PASSING`.
Until then it is visible, measured, and cannot masquerade as covered.
