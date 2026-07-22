# The intrinsic floor — the runtime contract both backends must not diverge on

> **Status: the standard, not yet the library.** Almost none of this is implemented — the JS backend
> reaches host globals, the C backend reaches `runtime.c` + a private `intrinsics.ts` table, and the
> two are only *accidentally* in agreement wherever the corpus happens to be ASCII and integer-valued.
> This document is the ruling that turns that accident into a specification, plus the worklist that
> Phase F executes against.
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

They *do* drift today. The [§5.2 parity audit](../inbox/c-backend-gap-ledger.md) found seven executable
corpus files where **C runs and prints a wrong answer** — the silent-wrong class — in four clusters,
all of them a runtime primitive implemented twice and disagreeing:

| cluster | JS | C | now a guard |
|---|---|---|---|
| `print` `{0}` positional | `x=5` | ✅ *fixed by rest-param packing* | `80-adversarial/print_positional_format.lisp` |
| container-in-string | `[ 1, 2, 3 ]` | `1,2,3` | `80-adversarial/interp_container_format.lisp` |
| reflection depth | full `{kind,params,…}` | ✅ *fixed by Fd* | `80-adversarial/reflection_metadata_depth.lisp` |
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
| numbers | `number->string` `string->number` `truncate` | `number->string` is shortest-round-trip; `truncate` is the SOLE `Real -> Int` door (D51 amendment (b)) |
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
replace upcase downcase`), `std/io` (`print prn` + the `{N}` substitution, §3.6), `std/fn`, the
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
                    `'"...{(expr)}"` interpolation.
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
- **Fc — the display formatter (D55).** l-lang `inspect` implementing **§3.5**, on `number->string`
  + reflection tag. **Greens §5.2 cluster 2.** Re-derives the ~87 wrapping-dependent golden lines
  from the §3.5 rule, and adds the `[Circular]` guard.
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

  *Not done, and deliberately:* §2 lists the display/`inspect` formatter itself as pure l-lang, and it
  is native in both runtimes. An l-lang formatter needs `map-keys` (Fg) and `number->string` (D51) as
  floor primitives, and neither exists yet — so this is sequencing, not an oversight. Until then the
  two implementations are held together by the §5.2 guards, which is the weaker instrument D50 warns
  about and the reason to finish the job after Fg.
- **Fe — the numeric floor (D51).** JS `Int` → `BigInt` + `BigInt.asIntN(64)`, C `-fwrapv`, and the
  `number->string` exponent thresholds. Guarded by an overflow/precision differential and a
  float-formatting differential (both currently latent).
- **Ff — the string floor (D52).** C UTF-8 decode, JS scalar-value iteration, the vendored case
  table; `std/string` collapses to l-lang. Guarded by a non-ASCII length/case/index differential;
  re-capture the affected goldens once.
- **Fg — containers + equality (D53).** `vec`/`map` primitives, structural `equals`; `std/seq`
  collapses to l-lang.

**Fc is the linchpin — corrected sequencing.** Fe was moved to second on the argument that it rewrites
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

**A note on how Fc must be verified.** Its ~87 wrapping-dependent golden lines have no independent
oracle: node's rule is being *replaced*, so whoever implements §3.5 would otherwise be writing both
the code and the expected output and checking one against the other. Everything except wrapping and
depth still agrees with node, so node remains a check there — but the wrapping decisions must be
verified *arithmetically* against the rule (count the one-line form, compare to 80 minus indent), not
by running the new formatter and accepting what it prints.

**The two hard, up-front items** — **UTF-8 decode** and the vendored **case table** — are each real
work and each, until done, is exactly one named not-yet guard, the same pattern the §5.2 three already
establish. Nothing is silently deferred. (Ryū was a third until D51's amendment (c) showed
`ll_fmt_double` already generates shortest-round-trip digits; what remains is threshold matching.)

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
