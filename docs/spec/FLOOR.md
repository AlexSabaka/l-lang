# The intrinsic floor — the runtime contract both backends must not diverge on

> **Status: implemented. Phase F is complete (Fa–Fg), 2026-07-22.** This document was written as a
> specification plus a worklist, at a time when almost none of it existed: the JS backend reached host
> globals, the C backend reached `runtime.c` plus a private `intrinsics.ts` table, and the two agreed
> only *accidentally*, wherever the corpus happened to be ASCII and integer-valued. All of it is built.
> §4 is now the planning record rather than a worklist — kept because the reasoning is what makes the
> phase auditable, and marked inline where a prediction turned out to be wrong.
>
> What the floor did **not** absorb is named where it lives, not hidden here: the display formatter is
> §3.5-conformant in both runtimes but still native in both (Fc), the two remaining JS divergences are
> costed and declined in `src/test/js-status.ts`, and D50's native-member boundary rules the escape
> hatch that both of those sit on.
>
> Rulings live in [`DECISIONS.md`](./DECISIONS.md) as **D50–D55**. This is their evidence and their
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

They *did* drift, and the drift is what motivated this document. A parity audit on 2026-07-22 found
seven executable corpus files where **the two backends printed different answers** — the silent-wrong
class — in four clusters, every one a runtime primitive implemented twice and disagreeing:

| cluster | JS | C | the guard |
|---|---|---|---|
| `print` `{0}` positional | `x=5` | `x={0}` | `80-adversarial/print_positional_format.lisp` |
| container-in-string | `[ 1, 2, 3 ]` | `1,2,3` | `80-adversarial/interp_container_format.lisp` |
| reflection depth | full `{kind,params,…}` | a `{name, extends}` stub | `80-adversarial/reflection_metadata_depth.lisp` |
| modifier side effects | `[log]` prints | C refuses, fail-closed | — |

**All four are now closed**, and the mechanism that closed them is the point: each became a minimal
guard in `examples/80-adversarial/`, deliberately left *unlisted* in the C ratchet so that the day C
reached parity the build turned red demanding promotion. All three guards are listed in
`src/test/c-status.ts` today (lines 225, 525, 655) — rest-param packing, the Formattable display
rewire, and Fd's metadata graph respectively. Cluster 4 never needed a guard: a fail-closed refusal
is already the loud signal, and there is no silent-wrong to catch.

> The audit itself is archived at [`docs/_archive/c-backend-gap-ledger.md`](../_archive/c-backend-gap-ledger.md)
> §5.2 — its framing (C as a probe, JS as the oracle) was reversed by **D86**. The live half of that
> ledger, still cited by name from `src/`, is [`C-BACKEND-FINDINGS.md`](./C-BACKEND-FINDINGS.md).

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
| strings | `codepoint-at` `codepoint-length` `string-to-codepoints` `string-from-codepoints` | codepoint model; a codepoint is an **`Int`**, not a `Char` (Ff-1). `concat` is **not** here — `+` already is it |
| case | *(none — ASCII, in l-lang)* | the vendored table is **deferred**; `std/string` maps `a-z`/`A-Z` and passes the rest through (Ff-2) |
| numbers | `number->string` `string->number` `truncate` | `number->string` is shortest-round-trip; `truncate` is the SOLE `Real -> Int` door (D51 amendment (b)) |
| math | `sqrt sin cos tan asin acos atan atan2 exp log pow` | host libm / `Math`; last-ULP tolerance documented |
| vectors | *(none)* | **unspent** (Fg-3): `.length`/`.push`/`.slice`/the indexer already carry both backends |
| maps | `map-get` `map-set` `map-has` `map-delete` `map-keys` | String keys; no `map-new` (`{}` is the literal, and D1 makes a zero-arg call a *read*); insertion order holds on C only — see D53 |
| equality | *(none)* | **unspent** (Fg-4): `==` already lowers to `ll_deep_eq` / `__ll_deep_eq`, structural and deep on both |
| reflection | *(backend emits the metadata graph)* | shape is spec'd, not per-backend (§D54) |
| i/o sink | `write-string` `write-string-err` | raw stdout/stderr; **no** formatting |
| time | `clock-ns` `sleep-ns` | **two clocks behind one entry** — `(clock-ns "mono")` for durations, `(clock-ns "wall")` for timestamps; both answer **nanoseconds** (D56). The selector exists because D1 makes a zero-arg call a *read*, same trap as `map-new` and `sys-args`. `sleep-us/ms/s` are l-lang |
| host | `random` `now` `clock` `args` `env` `exit` | syscalls / entropy |

**Pure l-lang, on the floor (portable by construction):** all of `std/core`
(`head tail cons elem get empty`), `std/seq` (`map filter reduce zip range reverse flatten sort first
last at`), `std/string` (`starts-with ends-with includes index-of trim split join substr pad* repeat
replace upcase downcase`), `std/io` (`print prn` + the `{N}` substitution, §3.6), `std/fn`, the
display/`inspect` formatter, the number predicates, and the derived math
(`abs min max round floor ceil sign inc dec`).

> **As built (Phase F).** The table above is the plan; these rows are what the floor actually holds
> after Fa–Ff. Three planned groups turned out to be **unnecessary** rather than unfinished, each for
> the same reason: the primitive already existed under another name. `flatten` needed an array test
> and `(x :of Array)` is one; `includes`/`index-of` needed structural equality and `==` is it;
> `concat` needed string joining and `+` is it. Only the **codepoint** group was genuinely
> irreducible — nothing in the language could ask what a string's third character is, because every
> spelling answered in the host's own units. That is the shape D50 predicts and the reason it says
> the floor is a cost: an entry is worth adding only when nothing above it can express the operation.

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
  than drifted into. *Amended:* the original "output is golden-stable, `String(5n)` is `"5"`" was a
  claim about the **coercion** path — the *display* path prints `1n` / `[ 1n, 2n ]`. Under D55 the
  formatter is ours and renders an `Int` as digits, so the suffix never arises; see §3.5 "Numbers".
- **`number->string`** is shortest-round-trip (the JS `Number.prototype.toString` result is the
  spec). `0.1` prints `0.1`, not `0.100000`. *Amended:* `ll_fmt_double` already generates the digits;
  the residual is the exponent threshold and spelling — see §3.5 "Numbers".
- **Division** per D49d: `Int / Int` truncates toward zero; a `Real` operand promotes to `Real`.
  **Modulo** matches — truncated, sign-of-dividend (`-7 % 2 = -1`).
- **Mixed** `Int`/`Real` arithmetic promotes to `Real`; a numeric literal with a `.` is `Real`,
  else `Int`. `==` is numeric (`1 == 1.0` is true); `equals` is structural-and-typed (§D53).
- **Bitwise** (`<< >> & | ^ ~`) is well-defined on `Int` because `Int` is now genuinely `int64`.
- **Transcendentals** use host libm / `Math`; a last-ULP mismatch is a documented tolerance caught
  by a not-yet guard, not a vendored correctly-rounded library.
- **Derived** math (`abs min max round floor ceil sign`) is l-lang on `truncate` + comparison, and
  every one of them returns **`Real`** — `truncate : Number -> Int` is the only narrowing door
  (D51 amendment (b)). The `round` tie-break adopts the JS rule (`2.5 → 3`, `-0.5 → -0`), which is
  itself the proof that `round` cannot return `Int`: `-0` is not an `Int` value.
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

> **Amended 2026-07-22 (Ff-1), as built.** Three corrections, all made while landing the primitives.
>
> *`codepoint-at` returns an `Int`, not a `Char`.* A `Char` still has no agreed rendering — the
> display formatter has no JS arm for one — and after D51 an `Int` is already distinguishable from a
> `Real` on both backends, so the scalar value itself carries the whole answer with one less
> representation to converge.
>
> *Out of range is `-1`, not nil.* A codepoint is non-negative by definition, so `-1` is out of band
> rather than the in-band lie D9 objects to, and it lets a scanner look one character ahead without a
> bounds test — the same affordance `io.lisp`'s format scanner already takes from `charAt` returning
> `""`. A lone surrogate or an out-of-range value encodes as `U+FFFD` on **both** sides, matching what
> each decoder answers for input it cannot read, so a round trip is total in either direction.
>
> *`concat` is not a floor entry.* `+` already concatenates strings identically on both backends and
> is exercised on every `print` path. Adding `concat` would be a second name for it — the same
> argument that kept `equals` off the floor in Fg-4.
>
> *The "consequence" line above did not happen, and could not have.* The corpus contains **exactly
> one** non-ASCII string literal — `"·"` in `30-applications/04_flood_fill.lisp` — and never measures
> it. Zero goldens changed. Ff is guard-only signal, exactly as Fe was.
>
> *And the measurement that motivates the phase, taken before any of it was written:* `(strlen "café")`
> was 4 on JS and **5** on C; `(strlen "Привіт")` 6 and **12**; `(strlen "a😀b")` **4** and **6**,
> where D52 says 3. JS is right below U+10000 by accident — one UTF-16 unit per codepoint — and wrong
> the moment anything is astral. This is a floor **both** backends are rebuilt onto, not one catching
> up with the other. Pinned by `80-adversarial/codepoint_floor.lisp`.

> **Amended 2026-07-22 (Ff-2) — case and trim are ASCII, and the vendored table is deferred.**
>
> `upcase`/`downcase` map `a-z`/`A-Z` and pass everything else through, on both backends: `(upcase
> "café")` is **`"CAFé"`** and `(upcase "Привіт")` is unchanged. `trim` removes exactly space, tab, LF
> and CR — not the ~25 characters of Unicode `White_Space` that JS's `.trim` takes.
>
> *This is a narrowing of the ruling above, taken with its eyes open.* The vendored simple-case table
> is still the right long-term answer. It is also ~1400 entries with conditional and locale-sensitive
> cases, vendored **twice** and kept in step, for a corpus containing one non-ASCII string literal.
> The alternative is not "do nothing": the divergence was already live — `(upcase "café")` gave
> `CAFÉ` on JS and `CAFé` on C — so the only question was which becomes the rule. C's wins because it
> *is* a rule, where JS's came from `toUpperCase`, an ICU- and locale-version-dependent host
> function; adopting it would mean conformance-by-chasing-a-host, which §D55 already rejected for
> `util.inspect`. ASCII is a rule both backends state exactly. When the table lands it replaces
> `ascii-upper`/`ascii-lower` and `string_codepoints.lisp` changes with it, on purpose.
>
> *A fourth primitive was added:* **`string-to-codepoints : String -> Int[]`**, the inverse of
> `string-from-codepoints`. Every function in `std/string` decodes once, works on the `Int[]` with
> ordinary vector code, and encodes once — which is what keeps them linear. Built out of repeated
> `codepoint-at` they would each re-walk the string per character, since a codepoint index is a walk
> on both backends.
>
> *What stayed a native delegation, and why it is sound:* `split`, `join`, `contains`, `starts-with`,
> `ends-with`. UTF-8 is **self-synchronizing** — a continuation byte cannot be mistaken for a lead
> byte — so a valid encoded needle cannot match starting inside a character, and a substring
> *predicate* is already codepoint-correct on a byte scan. What is unsafe is anything returning or
> taking a **position** or a **width**, which is exactly the set that was rewritten. The one hole is
> `(split s "")`, wrong on both backends and used nowhere in the corpus; flagged, not fixed.
>
> *Two names from the list above are deliberately still missing.* `index-of` **collides**: `std/seq`
> exports one (Fg-4) and `16-stdlib/test_stdlib.lisp` imports both modules — D33's "pick one
> convention per file" settles seq-vs-linq because those are alternatives, and seq-vs-string because
> they are not. `replace` would import JS's special replacement syntax (`$&`, `$1`, `$$`), which C's
> `ll_str_replace` does not have. Both need their own ruling rather than whichever spelling was
> convenient.

> **Amended 2026-07-22 (Ff-3) — the native members, and the one gap that stays.**
>
> `.length`, `.charAt`, `.slice`, `.indexOf`, `.padStart`/`.padEnd`, `.split ""` and the indexer
> `s[i]` now count **characters on C**. They counted bytes, which matches *neither* JS nor D52 —
> `"café".length` was 5 here and 4 there, `"Привіт".length` 12 and 6 — and that made bytes strictly
> the worst of the three options available: a codepoint count agrees with JS for everything below
> U+10000 and with D52 always. Byte offsets no longer leave `runtime.c`.
>
> **Correction 2026-07-22 (F.2/F.4).** That last sentence was false when written, twice over, and
> both leaks were pure-BMP rather than astral. `ll_dyn_method`'s `length` arm -- the CALL position
> `(x.length)` on a boxed receiver, a different dispatch path from the read Ff-3 moved -- returned
> `s->len` raw, so `"café"` measured 4 when read and **5 when called**, on the same value in the
> same program. And `ll_str_last_index_of`, one function below the `ll_str_index_of` that Ff-3 did
> convert, returned the raw byte offset: `("éécaféx".lastIndexOf "x")` gave **9** where the
> character index is 6. Both fixed; `lastIndexOf`, `padStart` and `padEnd` also gained the dynamic
> arm they never had (they trapped on a boxed receiver). Pinned by the `last-*` and `dyn-*` lines
> in `native_string_codepoints.lisp`, which is green on both backends.
>
> **`std/seq`'s `length` dispatches on `(coll :of String)`** and answers `codepoint-length`. It was
> `coll.length`, so the language's own measurement inherited whichever host unit the backend used.
> The dispatch lives there, in one place, rather than in each backend.
>
> *The residual gap is astral-only and JS's, and it is listed rather than closed.* (True only as
> of the F.2/F.4 correction above -- when this was written, two BMP byte leaks were still live on
> C, so the claim was wrong about both the range and the backend.) JS's members still
> count UTF-16 code units, so they agree with D52 below U+10000 and part company on a surrogate pair.
> The fix has no good shape: C's members are *our* implementation, so moving them touched one file;
> JS's are the *host's*, and `s.length` is a property read. Routing it through a receiver-aware helper
> only where the checker typed the receiver `String` would be **worse than the gap** — a typed
> receiver answering 3 and an untyped one 4 is the language disagreeing with itself depending on
> inference, the same failure `native_search_numeric.lisp` pins for `.includes`. Doing it
> unconditionally puts a runtime type test on all 78 `.length` sites in the corpus, most of them
> arrays. Guarded by `native_string_astral.lisp`, listed in `js-status.ts`, and the language's own
> spellings — `std/string`'s and `std/seq`'s — are correct on both backends and are the supported
> answer.
>
> *Unrelated gap found while probing, flagged not fixed:* `(expr).field` does not chain. `((mk).slice
> 0 2)` is a method call on a call result and works; `(mk).length` parses `length` as a separate
> identifier and reports `ELL0210 'length' is not defined`. Method suffixes chain, field suffixes do
> not.

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

### D54 — reflection has one metadata shape

*(D54 originally also ruled display; that half is superseded by **D55** and now lives in §3.5.)*

- **Reflection.** The backend **emits the metadata graph** (a class's fields/methods/params, a
  function's params/returns/nullable) into the runtime; the **accessor shape is the spec, not
  per-backend**. The JS `type`/`type-by-name` object is that spec — `{name, kind, params:[{name,
  type}], returns, nullable}` for a function, `{name, kind, properties, methods, constructor,
  nullable}` for a class — and `reflection_metadata_depth.lisp` pins it. [D48-Q5](./DECISIONS.md)
  put field types on the HIR class node (`af6047e`); the residual is purely that the C *runtime*
  descriptor does not yet emit them.
- **Reflecting a value the graph does not describe** (Lb). `Nil`, `Array`, `Map` and `Function` are
  **seeded in the shared builder** alongside the primitives, `Array`/`Map` with kind **`container`**,
  so neither backend answers from its own fallback. A container's **elements are not its
  `properties`**. `(type v)` names the value from its **representation** — C's tag, and on JS the
  D51 encoding (`Int` is a BigInt, `Real` a number); reading that encoding is not the same as
  guessing from the value, so an un-inferred `5.0` still answers `Real`.

### D55 — display is l-lang's own format (see §3.5)

The canonical rendering of a value is **ours**, transcribed in §3.5 below and implemented from that
text by both backends. Not node's `util.inspect`. See [`DECISIONS.md`](./DECISIONS.md) for the ruling
and its rationale; §3.5 is the normative text.

---

## 3.5 The display format — the normative rule

> This section **is** the specification. It is written to be executable from the text alone, because
> under D55 neither backend is the oracle: both are implementations, and a golden is derived from
> *this* rule, never captured from a run.

### The thesis: l-lang prints l-lang

You write `[1 2 3]`. It used to print `[ 1, 2, 3 ]` — JavaScript's notation, inherited from the first
backend and never chosen. The clearest evidence is in `00-basics/04_nil_handling.lisp`, whose header
says *"l-lang has exactly ONE bottom value, spelled `nil`"* and whose golden said `nil is: null`: D9
stated in the comment and contradicted by the output, in the same file.

So the format is **l-lang's own reader syntax**. A printed value is, as far as possible, source you
could paste back — the classic Lisp read/print correspondence. `nil` printing as `nil` is not a patch
on top of that; it is a consequence of it.

### Three names, two of them distinct operations

```
to-string(v)        the `+` string-concat context, and ONLY that context. JS ToString shapes, kept
                    because the corpus bakes them in and `ll_to_string_sb` already implements them:
                    Int digits, Real shortest-round-trip, String raw, Bool true/false, nil "null",
                    vec comma-joined, map "[object Object]".

display(v)          every human-facing rendering: `console.log`, `print`'s {N} substitution, and
                    `f"...{(expr)}"` interpolation.
                      = the raw characters, if v is a String at the TOP level
                      = inspect(v, 0) otherwise
                    The top-level-bare rule is what keeps `(print "Hello, {0}!" "World")` printing
                    `Hello, World!` rather than `Hello, "World"!`.

inspect(v, indent)  the structural rendering, defined below.
```

### `inspect`

```
inspect(v, indent):
  nil            -> nil                      (D9: one bottom value, and this is how it is spelled)
  Bool           -> true | false
  Int            -> decimal digits           (no BigInt `n` suffix -- D51 amendment (a))
  Real           -> shortest round-trip; negative zero prints -0
  String         -> "..." with \\ \" \n \t \r escaped; every other character literal
  Char           -> #\c                      (PROVISIONAL: the reader has no Char literal yet, and
                                              no corpus example constructs one)
  Closure        -> #<fn name>  |  #<fn>     when anonymous
  Generator      -> #<generator name>  |  #<generator>    (D58/G3: the value a `:gen` call returns.
                                              An unreadable object, like a closure -- its members are
                                              the suspended frame, and the synthesized state-machine
                                              class never appears. `name` is the SOURCE name.)
  vec, empty     -> []
  map, empty     -> {}
  obj, no fields -> ClassName{}
  vec            -> entries are inspect(elem), SPACE-separated
  map            -> entries are `:key value`, space-separated; the key is bare after the colon when
                    identifier-like, else quoted (`{"a b" 1}`)
  obj            -> ClassName followed immediately by the map form over its fields

  CONTAINER LAYOUT (vec, map, obj -- the only place indent matters):
    Render the one-line form first, recursively:
        vec  ->  "[" + entries joined " " + "]"
        map  ->  "{" + entries joined " " + "}"
        obj  ->  ClassName + the map form
    Let TEXT be that one-line form PLUS its own line prefix -- the `:key ` when this container is a
    map value, empty otherwise. (The prefix counts: it occupies the same line.)
    If  indent + length(TEXT)  <=  80   ->  emit the one-line form.
    Otherwise emit the broken form:
        the opening bracket, newline,
        each entry rendered by this same rule at indent+2, preceded by (indent+2) spaces,
        newline after each,
        (indent) spaces, the closing bracket.
    There is no separator in the broken form: the newline IS the separator, which is one of the
    things dropping commas buys.

  DEPTH   -> unlimited. `[Object]` and `[Array]` never appear.
  CYCLES  -> a container already being rendered higher in the current recursion renders `#<circular>`,
             the same unreadable-object marker a closure uses.
```

Worked example. The outer map's one-line form is **103** chars at `indent = 0`, so `0 + 103 > 80` and
it breaks. Its `:params` entry is **33** chars at `indent = 2` (`:params [{:name "x" :type "Any"}]`,
prefix included), so `2 + 33 = 35 <= 80` and it stays inline:

```
{
  :name "is-null"
  :kind "function"
  :params [{:name "x" :type "Any"}]
  :returns "Boolean"
  :nullable false
}
```

### Numbers

`Real` renders shortest-round-trip. `runtime.c`'s `ll_fmt_double` already produces the digits
(`%.15g`/`%.16g`/`%.17g`, first that round-trips through `strtod`); what must be matched is the
**exponent threshold and spelling** — exponential form at ≥1e21 and <1e-6, spelled `1e-7` / `1e+21`,
not `%g`'s `1e-07`. `NaN`, `Infinity`, `-Infinity` render as those words. Under D51 an `Int` is a
`BigInt` on JS; it renders as digits with **no `n` suffix** — automatic here, not a special case,
because the formatter is ours rather than `util.inspect`.

### What this deliberately does not cover

**Format specifiers** — `{0:F2}`, alignment, culture — are *deferred, not dropped*. They need
number-formatting rules D51 has not spec'd. `print` accepts `{N}` and the `{{` / `}}` escapes only.

---

> **Amended 2026-07-22 (the formatter) — four divergences, all live, none guarded.**
>
> §3.5 was implemented twice on the argument that conformance guards keep the two in step. **The
> guards did not exist**, and every one of these was live; every existing display golden was blind to
> all of them, because each concerns a shape the corpus never prints.
>
> *The ident-like key test is the READER's, not a judgement call.* Both sides had invented one and
> disagreed in **both directions** — C allowed `$` and rejected `-`, JS the reverse, so `{"a-b" 1
> :a$b 2}` on one was `{:a-b 1 "a$b" 2}` on the other. Since D55 rules this to be l-lang's own reader
> syntax, the only defensible rule is the tokenizer's `Identifier` pattern, and both now transcribe
> it: `-` is in (D21's kebab-case), `$` is out (it lexes as an *operator*), a leading digit is out,
> and **non-ASCII is in** — which neither implementation had.
>
> *The class tag counts toward the width budget.* C wrote it straight to the output and measured only
> the braces, so a tagged instance was measured without its own name and stayed flat at 84 columns
> where JS broke it.
>
> *The cycle set grows.* C's was 256 fixed slots whose push silently did nothing once full, so a
> cycle nested deeper went undetected and the renderer recursed until the process died — a measured
> **segfault**, not a mis-render.
>
> *An imported class displays under its SOURCE name.* JS read `__ll_name` off the **instance**, where
> it is never present (it is stamped static on the constructor), and fell through to
> `constructor.name` — the mangler's name. `__ll_inlined_Money_1{...}` reached user-facing output.
> This is the Zh bug, already fixed once for `type`/`__ll_is_type`; Fc reintroduced it by writing a
> third copy from scratch instead of following the two that were right.
>
> *Char is the fifth item on that list and is NOT fixed, because it is not reachable.* C renders a
> Char as `#\c`; JS has no Char at runtime at all (a Char *is* a one-character string). But the
> grammar has no Char literal, so no `LL_CHAR` value can be constructed — the arm is unreachable, and
> `#\c` is in any case syntax the reader cannot take back, which §3.5 already marks provisional.
> Whoever adds a Char literal must decide this; there is nothing to conform to today.
>
> **Amendment, 2026-07-22 (F.6) — the width budget is counted in CODEPOINTS.** §3.5 never stated
> the unit in a clause; it was only inferable from worked examples ("103 chars", "84 columns"), and
> both implementations counted something else — **bytes** on C (`one.len` on the flat buffer) and
> **UTF-16 code units** on JS (`oneLine.length`). For a vector of twenty emoji the three answers were
> 24 (the rule), 44 (JS) and 84 (C). A Cyrillic map 54 columns wide broke across four lines on C.
> Both now count characters, at every site that measures: the flat form, the `:key ` prefix that
> shares a line, and a quoted key. The ASCII 80/81 boundary is unchanged, which is what the guard's
> ladder pins alongside the non-ASCII rows.
>
> **Amendment, 2026-07-22 (F.7/F.8) — a value displays under its SOURCE name.** Two more arms of
> the same switch read HOST reflection. Struct/class FIELD names came from `Object.keys(v)`, so
> D21's kebab-case printed encoded — `Rec{:first2dname "Ada"}` against C's `Rec{:first-name}` — and
> the mangled key passed the ident-like test cleanly, so nothing flagged it. FUNCTION names came
> from `Function.name`, so a kebab-case function printed `#<fn my2dkebab2dfn>` and an **imported**
> one printed `#<fn __ll_inlined__double_1>` — the same compiler-internal leak this section already
> forbids for a class tag. Both now carry the source name: fields on the constructor as
> `__ll_fields` (carried, not decoded — the encoding is not reversible, `a2db` encodes `a-b` and is
> also a legal name), functions as `__ll_name`.
>
> *And the ruling that follows from it:* **binding a lambda does not name it.** `(let g (fn [a b]
> ...))` printed `#<fn g>` on JS purely because ECMA-262 NamedEvaluation names an anonymous
> function expression after its binding — the host naming a value the language never did. Since
> every function l-lang *does* name now carries `__ll_name`, the formatter reads only that and
> answers `#<fn>` otherwise, which is what C always said. A generated placeholder name was
> considered and rejected: `#<fn __ll_lam_3>` is the very class of leak the paragraph above removes.
>
> Guarded by `80-adversarial/display_conformance.lisp` and `display_imported_class_tag/`.
> **Full retirement of the duplicate implementation stays deferred**, still blocked on a portable
> `kind-of` and on `console.log` leaving the floor.

## 3.6 `print` — C# `string.Format` positional substitution

`print`'s first argument is a template scanned left to right:

```
"{{"            ->  emit a literal {
"}}"            ->  emit a literal }
"{" digits "}"  ->  the argument at that 0-based index, rendered by display()
                    index >= argument count  ->  THROW
anything else   ->  emitted verbatim
```

Every occurrence of an index is substituted, not just the first — today's first-match-only behaviour
is an artifact of `String.prototype.replace` with a string needle, not a decision. A placeholder whose
index has no argument **throws**, following C#'s `FormatException` rather than silently printing the
template or an empty string: a format bug that prints something plausible is the silent-wrong class
this whole document exists to eliminate. A lone `}` is emitted verbatim (a documented deviation from
C#: only `{` opens a placeholder, so nothing is ambiguous).

---

## 4. The worklist — Phase F

In dependency order. Each sub-phase lands its floor primitives **and** the conformance guards that
prove parity, then collapses the corresponding `std/*` module to l-lang on top of them.

- ✅ **Fa — the shared typed surface (D50). DONE.** `compiler/floor/floor.ts` states each floor op
  once, in l-lang types, with the `runtime.c` function that implements it. The C backend derives its
  `INTRINSIC_CALLS` CTypes from it via `mapType` (verified a pure refactor: the derived table was
  dumped and diffed against the old hardcoded one, all 36 entries identical), and the checker
  resolves floor names through the same entries, so `Math.sqrt` is `Real -> Real` instead of Unknown.
  Two real defects surfaced the moment the names were typed: `(Math.random 0 100)` (LL0211, an
  example bug the file's own comment already contradicted) and `truncate`'s `-> Int` over a
  Real-returning body — fixed by making `Math.trunc` the one NARROWING floor entry, `[Real] -> Int`,
  backed by a new `ll_truncate`. *Still hand-mirrored, and the next thing the floor should absorb:*
  `NATIVE_METHODS`/`NATIVE_FIELDS` vs `types/nativeMembers.ts`.
- ✅ **Fc — the display formatter (D55). DONE, as §3.5 conformance — NOT as retirement.** Both
  runtimes implement §3.5 and the wrapping-dependent goldens were re-derived arithmetically from the
  rule. The five divergences this document listed as unguarded are fixed and each ships with the guard
  that catches it: the class tag now counts against C's width budget, the two ident-like key tests
  agree, the class name is read the way `__ll_is_type` reads it (`constructor.__ll_name`, not the
  instance — the Zh bug, reintroduced by Fc and caught again), C's cycle set grew from a silent
  256-entry cap to unbounded, and the JS side stopped reading host reflection where C read l-lang's
  own metadata. See `display_conformance`, `display_source_names/`, `display_lambda_name`,
  `display_imported_class_tag/`.

  *Still native in both runtimes, deliberately.* §2 lists the formatter itself as pure l-lang. Two of
  the five blockers landed with Fg and Fe (`map-keys`, `number->string`); the ones that remain are a
  portable `kind-of`, a string builder (concat is O(n²)), and `console.log` off the floor — it is
  callable with no import at ~948 sites, so an l-lang formatter needs an auto-preluded module or a
  callback mechanism C does not have. Fixing the five divergences was most of the benefit at a
  fraction of the cost; retirement stays on the worklist with its blockers named rather than pending.
- ✅ **Fd — reflection depth (D54). DONE.** The metadata graph is built ONCE
  (`compiler/reflection/metadata.ts`, extracted from the JS transformer and verified byte-identical)
  and emitted into the C module as `ll_value` maps at the top of `main`, so `type`/`type-by-name`
  answer with real properties, methods, constructor params, generics and interfaces instead of
  `{name, extends}`. **§5.2 cluster 3 closed** — and with it the last of the four parity clusters that
  had a silent-wrong to guard.
- ✅ **Fb — the i/o + format base. DONE.** `write-string` / `write-string-err` are the floor's only
  route out to a stream — raw bytes, no newline, no join, no formatting — and `console.log` is now a
  LAYER over the sink on both backends rather than a host call. A partial line is expressible for the
  first time. `display` is exposed alongside them, which closed the last Fc debt: `print`'s `{N}` was
  still rendering through `+` (to-string), so `(print "{0}" [4 5])` printed `4,5` while
  `(console.log [4 5])` printed `[4 5]` — one value, two renderings. §3.6 says `display`, and now it
  is.

  *On the formatter's retirement, which this bullet used to defer to Fg:* see Fc above — the blockers
  it named (`map-keys`, `number->string`) have since landed, and the ones that remain are different
  ones.
- ✅ **Fe — the numeric floor (D51). DONE.** `Int` is a wrapping 64-bit integer on both backends: a
  `BigInt` normalised with `asIntN(64)` on JS, `int64_t` under `-fwrapv` on C. `number->string` now
  follows ECMA-262's `Number::toString` on both. The differentials FLOOR.md called "latent" are
  written and green: `int64_exact`, `int64_wrap`, `int_real_runtime_tag`, `real_format_thresholds`.

  *Guards first paid for itself.* The corpus's largest integer is 3628800, so a successful migration
  would have looked exactly like no migration. Writing the discriminating guards BEFORE the work
  found four bugs that predate D51 entirely — three of them on the backend everyone assumed was
  correct:
  - int literals were round-tripped through an f64 (`String(value)` on a JS `number`), so C emitted
    `INT64_C(4611686018427388000)` for a source literal of `4611686018427387904`. In **two** places,
    and fixing one is how the second survived;
  - no `-fwrapv`, so `INT64_MAX + 1` was undefined behaviour rather than the wrap D51 requires;
  - `ll_is_type` collapsed Int and Real *deliberately*, to mirror a JS limitation — the precise
    backend degraded to match the imprecise one;
  - `ll_fmt_double` had the shortest-round-trip digits right and everything around them wrong:
    `0.000001` printed `1e-06` and `1e-7` printed `1e-07`.

  *What D51 buys beyond exactness:* the runtime can finally tell an Int from a Real, which
  `RuntimeProvider`'s own comment argued at length was unbuyable. The collapse now survives only for
  an **integral host Number** — a gradually-typed value that could be either — instead of for every
  number. `(5.5 :of Int)` is false at last, and Int-keyed operator dispatch works.

  *Cost, measured:* BigInt with `asIntN` is **6.5×** slower than Number in a tight loop, but the
  corpus's two hottest programs run in 173 ms (recursive fib) and 30 ms (tokenizer) against a 5 s
  timeout. D51 accepted the cost; it is not a practical problem at this scale.
- ✅ **Ff — the string floor (D52). DONE, with two of its three items re-ruled on contact.** Four
  primitives — `codepoint-length`, `codepoint-at`, `string-to-codepoints`, `string-from-codepoints` —
  and `std/string` rewritten on them: decode once into an `Int[]`, work there, encode once, so every
  function is linear instead of re-walking the string per character. C's byte-oriented surface
  (`ll_str_len`, `char_at`, `index_of`, `pad_*`, and the native members) is now codepoint-oriented.

  *The re-rulings:* **`concat` is not a floor entry** — `+` already concatenates identically on both
  backends, the same argument that kept `equals` off the floor in Fg-4. And the **vendored case table
  is deferred, not built**: case and trim are ASCII on both backends by ruling (D52, Ff-2), because
  the divergence was already live (`CAFÉ` vs `CAFé`) and JS's side of it came from `toUpperCase`,
  which is ICU- and locale-version-dependent — conformance-by-chasing-a-host, which D55 already
  rejected for `util.inspect`. So the "two hard, up-front items" below are one item, and it is done.

  *The promised golden re-capture did not happen, and could not:* the corpus holds exactly one
  non-ASCII string literal and never measures it. Ff had guard-only signal, exactly as Fe did. The
  residual is astral-only and JS's, listed in `js-status.ts` under D50's native-member boundary.
- ✅ **Fg — containers + equality (D53). DONE, and it was four live bugs rather than a refactor.**
  `ll_deep_eq` compared two `int64`s through a `double`; `reverse` mutated in place on C and returned
  fresh on JS; `sort`/`sort-by`/`flatten` trapped outright on C, which is why `test_stdlib` had no C
  golden. `std/seq` is l-lang on the map floor, with a stable top-down mergesort.

  *Two planned floor entries turned out to be unnecessary*, which is the useful correction: `vec-*`
  was not needed (`(x :of Array)` already exists) and neither was `equals` (`==` already does the
  structural comparison). The floor stayed smaller than the plan, which is the direction D50 wants.
  Map insertion order is JS's one open divergence, costed and declined — see `js-status.ts`.

> **Phase F is complete.** Everything from here to the end of §4 is the planning record — the
> sequencing argument, the verification method, the named-up-front risks. It is kept because the
> reasoning is what makes the phase auditable, and because two of its predictions were wrong in
> instructive ways (marked inline). It is no longer a worklist.

**Fc is the linchpin — corrected sequencing, and it held.** Fe was moved to second on the argument that it rewrites
how JS produces numbers, and JS output is what downstream goldens are graded against. That argument
does not survive D55: display goldens are hand-derived from §3.5 *regardless* of what JS does, so JS
is no longer the oracle that would need re-validating. The dependency that actually binds runs the
other way:

- **Fe needs Fc.** Under D51 an `Int` is a `BigInt` on JS. Until our own formatter exists, every
  number still prints through node's inspect — `1n`, `[ 1n, 2n ]` — so landing Fe first churns every
  golden in the corpus. D51 amendment (a) says the suffix "never arises" *because* the formatter is
  ours; that is only true once Fc has landed.
- **Fd needs Fc too**, for its observable half. The metadata graph is independent work, but
  `reflection_metadata_depth.expect` currently bakes node's `[Object]` depth-2 truncation and its
  `compact:3` wrapping — the exact format D55 replaces. Emitting the full graph before Fc means
  matching a rendering we have already ruled we are abandoning.

So the order is **Fa → Fc → Fd → Fb → Fe → Ff → Fg**, and Fc is what unblocks the two after it.
*Executed in that order; the Fc-first argument was correct — no golden in the corpus ever carried a
`1n`.*

**A note on how Fc must be verified.** Its ~87 wrapping-dependent golden lines have no independent
oracle: node's rule is being *replaced*, so whoever implements §3.5 would otherwise be writing both
the code and the expected output and checking one against the other. Everything except wrapping and
depth still agrees with node, so node remains a check there — but the wrapping decisions must be
verified *arithmetically* against the rule (count the one-line form, compare to 80 minus indent), not
by running the new formatter and accepting what it prints.

**The two hard, up-front items** — **UTF-8 decode** and the vendored **case table** — are each real
work and each, until done, is exactly one named not-yet guard, the same pattern the §5.2 three already
establish. Nothing is silently deferred. (Ryū was a third until D51's amendment (c) showed
`ll_fmt_double` already generates shortest-round-trip digits; the threshold matching that remained is
done, in Fe.)

> *Wrong on the second, in a way worth keeping.* The case table was sized as work and turned out to be
> a **ruling**: D52/Ff-2 makes case and trim ASCII on both backends, so there is nothing to vendor
> until someone needs non-ASCII case — at which point it replaces two functions and its guard changes
> with it. Two of the three "hard, up-front items" dissolved on contact with the actual question, and
> both times the dissolution was the more interesting result than the work would have been. The
> pattern repeated inside Fg (`vec-*` and `equals` both proved unnecessary) often enough to be a
> method: **cost the primitive last, after asking whether the language can already say it.**

**A residual Fe leaves behind, named rather than hidden.** `IntegerNumberNode.value` is still a JS
`number`, i.e. the AST itself cannot represent an int64 literal — both backends now read `match`, the
raw lexed text, but anything else that reaches for `.value` re-introduces the rounding. The legacy JS
`visitIntegerNumber` still emits a plain Number, so an Int literal inside an opaque subtree is not a
BigInt; the corpus does not exercise one, which is precisely why it needs writing down.

**A correction to this document's own first draft.** `println` is listed above and in §2 as part of
the `std/io` surface; it **does not exist** anywhere in `lib/` — it is aspirational, and Fb either
writes it or the mention goes.

**§5.2 cluster 1 — CLOSED, and what it actually took.** It looked like pure lookup order:
`ResolveHirToCir` consults `INTRINSIC_CALLS` *before* the branch that lowers an imported l-lang body,
so `print` matched the table and io.lisp's body was unreachable. Removing the `print`/`prn` entries
turned out to be **necessary but not sufficient** — it exposed a second gap one layer down:

> **The C backend could not pack a rest parameter.** `print` is `[msg <- String ...args <- Any[]]`,
> so lowering its body means materialising `5` into the `Any[]` slot, and there was no rest-argument
> packing anywhere in `ResolveHirToCir`. The reason C *appeared* to handle `print` is that
> `ll_console_log` is declared `variadic: true` — a **C varargs call**, which boxes at the call site
> and never builds the array a lowered l-lang body indexes. Two mechanisms that looked alike from
> outside.

Fixed by `packRestArgs`: the callee takes a plain vec and the CALL SITE builds it with the existing
variadic `list` intrinsic, so `(print "x={0}" 5)` emits
`u_print(ll_str_lit("x={0}"), ll_list(1, (ll_value[]){ll_box_int(INT64_C(5))}))`. Packing is
unconditional — `(f arr)` against `[...rest]` binds `rest` to `[arr]`, matching JS.

**A third gap, found on the way — since FIXED.** A `(let DIGITS "0123456789")` at the top of `std/io`
emitted a reference to an undeclared `u_DIGITS`. The hoisting machinery (`ensureImportedValue`)
already existed and was wired into the plain-identifier read path, but **not** into the dotted-head
path — so `(DIGITS.indexOf c)` inside a lowered imported body built a bare `c-ref` that no C scope
declared. One `ensureImportedValue` call in `resolveDottedCall` closes it. No corpus example had ever
caught it because no C-passing example read an imported module-level constant at all; `std/math`'s
`E`/`PI`/`TAU` existed but were never reached from a C path. That coverage is now deliberate:
`80-adversarial/imported_module_constant.lisp` pins both shapes.

**A fourth, from following that thread — the flat-namespace collision, also fixed.** C has one global
namespace; D20 makes a module-*private* binding real, so two imported modules may each define `TAG`
and `decorate`. Everything keyed on the bare source name, so the second silently reused the first's
global and the program printed the first module's answer. Proven, not theorised:
`80-adversarial/module_private_collision/` prints `[from alpha]` twice before the fix and
`[from alpha]` / `<from beta>` after.

The naming was only half of it. `aliasFor` gives each (defining module, source name) pair its own
alias — bare for whoever claims it first, then `name#2` — but that allocator was being asked *too
late*: `topLevelFns` and `globalNames` accumulate imported entries, so `topLevelFns.has(name)` and
`globalNames.has(name)` answered *"yes, mine"* for whatever import registered the spelling first, and
short-circuited before module identity was ever consulted. Splitting out `ownFns` / `ownGlobals` —
written only by the pre-scan — is what actually made the alias reachable.

**And the function-as-VALUE path, the residual of that one — also closed.** `(apply-fn label)` never
calls `label` by name, so it resolves through `functionValue` and its boxed adapter instead of the
branch that lowers an imported body. That path was worse than the others: it did not merely pick the
wrong function, it **crashed** (`topLevelFns.get(name)!` on undefined) whenever the function was only
ever *referenced*, never called — so a private import used purely as a value had never worked at all.
`functionValue` now resolves the definition, lowers it under its own module's alias, and builds the
adapter from that; a name it still cannot resolve is a refusal rather than a `TypeError`.
`80-adversarial/module_private_fnvalue/` pins it, and the two adapters emit distinctly
(`__ll_adapter_u_label` / `__ll_adapter_u_label_232`) while both closures keep `label` as their
display name, so `[Function: label]` output is unaffected.

> **Worth knowing for Phase F:** the C backend's global namespace is still flat underneath — what
> changed is that every path which can reach a *resolved defining module* now asks for that module's
> alias. Anything that resolves a cross-module name without a definition node in hand would
> reintroduce the same class of bug.

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
