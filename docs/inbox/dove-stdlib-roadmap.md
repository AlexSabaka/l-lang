# The stdlib gap roadmap — from "the corpus runs" to "programs can be written"

**What this is.** An audit of `lib/std` as of the 2026-07-23 merge (26 modules), a map of what is
missing against the question *"can a program be written without reaching below the library?"*, and a
proposed build order optimized for the stated goal: **vibe-test programs of different kinds, on both
backends, with no hacky escape hatches.** Every proposal names its implementation route and its
honest cost, sorted by the D50 discipline: the irreducible part goes on the floor once, the loop
around it is l-lang written once.

**What was audited.** All 26 merged modules, their exports, their bodies, and the floor surface they
stand on. One module is known to exist and is absent from the merge: `std/core/errors` (the
`Error -> ValueError -> KeyError` tower from the gap ledger's §9) — its row below is inferred from
the ledger, not read. Flag if anything else was dropped in the merge.

---

## 1. Inventory snapshot

| Package | Modules | Surface (abridged) | State |
|---|---|---|---|
| `std/core` | async, string, types, (errors) | Awaitable/Task; codepoint string ops + format-args; type predicates + aliases | solid; **string has holes** (§3) |
| `std/fn` | fn | identity, constantly, partial, compose | **JS-only in fact** (§3) |
| `std/io` | console, files, io, stream | read-line; whole-file + handles; print/prn; Writer/Reader/LineReader | solid; **text-only** (§5) |
| `std/iter` | iter, linq ×2 | Iterable/Iterator/Disposable; 15 lazy operators | solid; **operator set incomplete** (§3) |
| `std/js` | js | the extern prelude, 40 host names | by design JS-only (§7) |
| `std/llang` | reflect | 35 fns over the D54 graph | solid |
| `std/math` | 9 modules | constants, elementary, special, stats, integrate, complex, rational, vector, symbolic | deep; **random + fft blocked** (§6) |
| `std/seq` | seq | eager map/filter/reduce/sort/… + total accessors | solid; small holes (§3) |
| `std/sys` | process, timers | args/env/exit; clocks, Stopwatch, Ticker, driven Scheduler | solid |

**The floor today** (ambient, both backends): `write-string`, `write-string-err`,
`file-open/read/write/close/exists`, `clock-ns`, `sleep-ns`, `sys-arg/env/exit`,
`codepoint-length/at`, `string-to/from-codepoints`, `iter`, `next`, `deep-copy`, `equals`,
`index-of`, `includes`, `map-get/set/has/delete/keys`, number→string per ECMA-262.

**The headline gaps**, in one sentence each. There is no way to turn a string into a number on both
backends. There is no regex, no calendar, no JSON, no random, no Set, no path manipulation, no
directory listing, no assert, no argument parser, and no bytes. Half of those are pure l-lang on the
existing floor; the audit's real finding is how *few* need anything below the library.

---

## 2. Method — the four tiers

Everything below sorts into four tiers by what it costs, and the tier is the roadmap:

- **Tier 0** — holes inside modules that already exist. Hours each, no rulings, no floor.
- **Tier 1** — new modules that are pure l-lang on the *current* floor. Days each; the bulk of the value.
- **Tier 2** — needs new floor entries. Each entry is implemented twice, so each is named, minimal,
  and total — the `file-open` pattern, never a library implemented twice.
- **Tier 3** — blocked on language work. Listed with the blocker named, so the language lane can see
  which features have a stdlib consumer waiting (the inverse of building features nobody wants).

---

## 3. Tier 0 — completing what exists

### `std/core/string` — the working set is not finished

Present: length/index/slice family (codepoint-correct), case (ASCII-ruled), trim, split/join,
predicates, padding, repeat, format-args. Missing, in rough order of how soon a test program hits
the wall:

- **`parse-int` — the single highest-value function in this document.** Pure l-lang over
  codepoints: sign, digit loop, overflow via D51's wrapping int64 (rule it: wrap, or nil on
  overflow — nil is the honest one, signature `String -> Int?`, total, `nil` for anything
  unparseable). No floor entry. Without it, a program cannot read a number from a file, stdin, or
  its own argv — which is to say it cannot do the first thing most test programs do.
- **`parse-real`** — see Tier 2; correctly-rounded decimal→double is genuinely hard and the one
  case where delegating to the host is *ruled safe* (both `strtod` and JS `Number()` are
  correctly-rounded per IEEE, so they agree bit-for-bit — the same symmetry argument Fe-4 already
  banked in the other direction).
- **`replace` / `replace-all`** — substring predicate logic is already ruled byte-scan-safe
  (self-synchronizing UTF-8, the module's own header); replacement is the same scan plus splicing.
  Pure l-lang.
- **`find` (position-returning `index-of` for strings)** — must answer in *codepoints*, so it joins
  the rewritten set: scan the decoded vector. `String -> String -> Int` with -1-or-nil ruling
  (lean `Int?`, nil-absent, per D9).
- **Char classes**: `is-digit`, `is-alpha`, `is-alnum`, `is-space`, `is-upper`, `is-lower` — ASCII-ruled
  like case, one place, replacing the private `ascii-*` trio. Regex (§4) wants exactly these.
- **`StringBuilder`** — a class over a parts vector with one final `join`. `read-file` and
  `LineReader` concatenate strings in a loop, which is quadratic on the C runtime's immutable
  strings. Land the builder, then migrate the two call sites. (Alternative: an amortized-growth
  `ll_str` append on the floor — more invasive, not needed if the builder exists.)
- **Fix `(split s "")`** — flagged-not-fixed in the module header; the codepoint spelling is one
  line over `string-to-codepoints`.

### `std/iter/linq` — the operator set stops one shelf short

Fifteen operators, and the brief's own prose already talks about `first` and `any` as
early-abandoners — **neither exists**. The missing standard shelf, all pure l-lang, all
`:extension` over `Iterable<T>`, terminals unless noted:

- `first` / `last` (`-> T?`), `any` / `all` (predicate, early-exit), `find` (`-> T?`, early-exit),
- `min` / `max` / `sum` (numeric terminals; `sum` typed `Iterable<Int> -> Int` and a `sum-real` twin,
  or wait for generics-over-Number),
- `distinct` (lazy, `:gen`; seen-set over D53 `equals` is O(n²) until hashing lands — ship it with
  that cost stated in the header, the `std/collections` note in §4 upgrades it later),
- `chunk` (lazy, `Iterator<T[]>`), `window` later,
- `group-by` (terminal, `-> Map` with string keys per D13 — the key function answers String for now;
  honest and useful),
- `sort-by` as a terminal (drain to vector, reuse `std/seq`'s merge sort, answer `T[]`).

### `std/seq` — small mirror holes

`any`, `all`, `find`, `unique`, `group-by`, `min-by`/`max-by`, `sum`, `concat`. Same conventions as
the module (eager, collection-last). An afternoon.

### `std/fn` — currently a JS module wearing a portable module's clothes

`partial` uses `func.apply`, `compose` uses `funcs.reduceRight` — host members, the exact
three-host-spellings-in-a-trench-coat shape `core/types` was cured of, and (per the timers header)
`(call f args)` **does not spread**, so the portable rewrite is blocked on the language: either a
spread-call ruling (`(call f ...args)`) or an `apply` floor entry. Until then this module cannot be
honest. Options: (a) mark it JS-only loudly and keep it out of portable programs, (b) land
arity-limited portable forms (`compose2`, `partial1` — ugly, but real), (c) do the language work
(§6, it is small). Lean (c); this is the smallest Tier-3 item and it unblocks callbacks-with-args
in `std/sys/timers` too, which its own header names as a limitation.

### `std/core/errors` — include it, and note what fences it

Absent from the merge but live in the tree. Two notes travel with it: the ledger's §9.2 C
field-layout trap (inherited plain-default field + mixed ctor list + ≥2 levels) currently forbids
giving deep nodes plain fields (`Error.cause` is the named casualty) — fix the C layout before the
tower grows; and the LL0218 duplicate-symbol gate is still pending while the stdlib doubles in
size — land the gate *first*, the `Number`-defined-twice incident is the warning shot already fired.

### Map ergonomics — a module, not a floor change

The floor has `map-get/set/has/delete/keys`. Missing everyday layer, pure l-lang over it:
`get-or`, `update` (fn over current value), `merge`, `entries` / `values` (as vectors or lazy over
the protocol), `map-of` (build from pairs), `invert`, `count-by`. Proposed home: `std/collections`
(§4) rather than a separate `std/map`, so the everyday shelf is one import.

---

## 4. Tier 1 — new modules, pure l-lang on the current floor

Ordered by value-per-effort for the vibe-test goal, not alphabetically.

### `std/test` — asserts, and self-checking programs

The corpus is graded by an external execute-and-assert-stdout harness; a *program* has no way to
check itself. The module is small and everything it needs already exists: `assert` /
`assert-eq` / `assert-ne` built on D53's structural `equals`, failure messages built on D55's
display (`expected {0}, got {1}` finally means the same string on both backends — the formatter
work pays off here first), a `test` registrar + `run-tests` runner counting pass/fail, exit code
via `std/sys/process`. A vibe-test program that ends `(run-tests)` is a portable golden of itself.
Effort: a day. Floor: none. This should be first among the new modules because it multiplies the
value of every program written after it.

### `std/cli` — argument parsing over `args`

Flags (`-v`, `--verbose`), options with values (`--depth 3`, `--depth=3`), positionals, repeated
options, `--`, and generated `--help` text (through the display formatter). Pure l-lang over
`std/sys/process`'s `args`. Effort: a day. Every test program with a knob wants it; without it each
program hand-rolls an argv loop, which is exactly the escape-hatch smell being hunted.

### `std/log` — levels over the stream layer

`debug/info/warn/error` to `stderr` through `std/io/stream`'s `Writer` (so it is redirectable and
testable — log to a `StringBuilder`-backed writer in tests), timestamps via `std/sys/timers`
(injectable `Clock`, same ManualClock trick that made the scheduler goldenable), a level threshold.
Half a day. Deliberately boring.

### `std/data/json` — and it is almost suspiciously well-aligned

A recursive-descent parser and a canonical emitter, both pure l-lang over codepoints. The alignment
that makes this cheap is not luck, it is three past rulings converging:

- JSON objects are string-keyed — **D13 rules l-lang maps string-keyed**. The mapping is 1:1 with
  zero impedance: object→Map, array→vector, string/number/bool/null→String/Real/Boolean/nil.
- JSON number emission must be shortest-round-trip decimal — **Fe-4 landed exactly ECMA-262
  number→string on both backends**. The emitter's hardest part already exists as a floor entry.
- Parsing numbers needs correctly-rounded decimal→double — the one `parse-real` floor entry (§5)
  serves both this module and `std/core/string`.

Escape sequences (`\uXXXX`, surrogate pairs → one codepoint) are ordinary codepoint work. Decide
Int-vs-Real on parse: rule it — a number with no `.`/`e` and in int64 range parses as Int,
otherwise Real (matches how l-lang literals read, keeps `(json-parse "3")` usable as an Int).
Effort: 2–3 days including an adversarial corpus file. This is also the serialization story for
save-files in the games repo, which is a real consumer already standing there.

### `std/collections` — the everyday containers

- **`Set`** — two-stage honesty. Stage 1 ships now: `SetOf<T>` over a vector + D53 `equals`
  (contains is O(n)); *plus* a fast-path `StringSet`/`IntSet` over the string-keyed map floor
  (Int keys via decimal encoding — reversible, canonical). Stage 2 upgrades the general one when a
  hash protocol lands (§6). The interface (`add/has/remove/size/values`) does not change between
  stages, which is the reason to ship stage 1 rather than wait.
- **`Queue`/`Deque`** — ring buffer over a vector; `Stack` — a vector with the right names.
- **`Counter`**, **`DefaultMap`** — thin map wrappers, the `get-or`/`update` shelf from §3 lives here.
- **Heap/priority queue** — binary heap over a vector with a key function; the Scheduler's
  linear-scan `pump` becomes its first internal consumer, and Dijkstra-shaped vibe-test programs its
  first external one.
- Sorted map/tree: **not yet** — no consumer, and Comparable-protocol questions attached. Listed to
  say it was considered.

### `std/os/path` — pure string work

`join`, `dirname`, `basename`, `extension`, `normalize`, `is-absolute`. **Ruling needed and cheap:**
the separator is `/` on both backends, `\` is accepted on read and normalized — l-lang states a
rule rather than importing the host's opinion, the D52 move again. Pairs with the Tier-2 dir
entries (§5) but is useful alone (path math on argv). Half a day.

### `std/math/random` — deterministic, seeded, and finally unblocked

Blocked today (the roadmap doc names it), and the blocker is **bit operators** (§6). Once they
land: `SplitMix64` for seeding + `xoshiro256**` as the generator, ~40 lines of pure l-lang, both
algorithms public domain with published test vectors — which means the module is *goldenable
against the reference implementation's own numbers*, the strongest kind of conformance test this
project has. Surface: a `Random` class (seeded ctor — determinism is the API, matching the
ManualClock philosophy), `next-int`, `int-in [lo hi)`, `real` (53-bit), `bool`, `shuffle`,
`choice`, `sample`. Default instance seeded from `clock-ns` for the casual caller. Games repo is
the standing consumer. One day after bit ops.

### `std/time/date` — the calendar, on the wall clock that already exists

`epoch-ns` exists; what is missing is *civil time*. The core is Howard Hinnant's
`days_from_civil` / `civil_from_days` — exact integer algorithms, public domain, ~30 lines total,
provably correct over the entire int range, and pure l-lang. On top: a `Date` / `DateTime` /
`Duration` value-type trio (`defstruct`, D11 copy semantics fit a date perfectly), ISO 8601
format/parse (parse needs only `parse-int`), weekday, leap-year, add/diff.

**Ruling needed, and it should be aggressive: UTC only.** No timezone database, no local time in
v1. The tz database is a moving multi-megabyte political artifact and vendoring it twice is the
divergence machine D52 exists to prevent. If local time is ever wanted, it is *one* floor entry
(`tz-offset-ns`, the host's opinion, labeled as such) — deferred until a consumer exists. Two days.

### `std/text/regex` — the big one, and the best dogfooding program in this document

**Do not delegate to host RegExp.** C has nothing to delegate to, and even if it did, JS RegExp vs
POSIX/PCRE disagree on enough (classes, Unicode, anchors) that the goldens would be host opinions —
the trench-coat pattern at its worst. Write the engine in l-lang, once.

**Proposed scope — the regular subset, run on a Pike VM (Thompson NFA):** literals, `.`, classes
`[a-z]`/`[^…]` and the `\d\w\s` shorthands (ASCII-ruled, per the D52 house style), anchors `^ $`,
quantifiers `* + ? {m,n}` greedy and lazy, alternation, capture groups. **Deliberately excluded:
backreferences and lookaround** — excluding them is what keeps the language regular, which buys
guaranteed-linear matching (no ReDoS class at all — a *stronger* property than the hosts have) and
an implementation a person can hold in their head: compile pattern → NFA program (~5 opcodes:
char/class/split/jump/save), then breadth-first execute over codepoints with the standard
two-thread-list VM. Prior art is Russ Cox's RE1/RE2 essays; RE1 is a few hundred lines of C, and
the l-lang version is the same size. Surface: `re-compile` (→ a `Regex` value; compile errors are
values, not traps), `is-match`, `find` (→ `Match?` with groups + codepoint spans), `find-all`
(lazy, `:gen` — an `Iterator<Match>`, which makes the whole lazy library its consumer), `replace`,
`split`.

Why "best dogfooding": a regex engine exercises strings, vectors, structs, recursion, closures,
the iterator protocol, and error paths, all in one ~600-line program with an unbounded supply of
adversarial goldens. If the language has friction, this program finds it. Effort: a week, honestly.
Do it after the small modules so the friction it finds is friction in the language, not in missing
`parse-int`.

### `std/math/fft` — after bit ops, over Complex

Iterative radix-2 Cooley–Tukey over `Complex[]` (the struct exists), bit-reversal permutation
(wants the shifts), forward/inverse, real-input convenience. Goldenable against closed-form DFTs of
small inputs and Parseval's identity. Two days after bit ops. Low urgency — listed because the
blocked-modules doc names it, and its blocker is the same three operators as random's.

---

## 5. Tier 2 — new floor entries (each implemented twice, so each is argued)

The D50 test for every row: is this irreducible (a syscall, a host capability, or a
correctly-rounded numeric primitive), and is it total?

| Floor entry | Shape | Why it cannot be l-lang | Consumer |
|---|---|---|---|
| `parse-real` | `String -> Real?` | correctly-rounded decimal→double is `strtod`/Eisel-Lemire territory; both hosts are correctly-rounded per IEEE so they **agree bit-for-bit** — delegation is safe by the same symmetry Fe-4 banked | `std/core/string`, `std/data/json` |
| `dir-list` | `String -> String[]?` (names, no dots; nil if unreadable) | `readdir(2)` / `fs.readdirSync` | `std/os/fs` |
| `file-stat` | `String -> Stat?` (size, mtime-ns, kind: file/dir/other) | `stat(2)` | `std/os/fs` |
| `dir-make` | `String -> Boolean` | `mkdir(2)` | `std/os/fs` |
| `file-remove`, `file-rename` | `String -> Boolean`, `String String -> Boolean` | `unlink`/`rename` | `std/os/fs` |
| `cwd` | via unary spelling (the D1 nullary trap — same route as `sys-arg`) | `getcwd` | `std/os/path`, `std/os/fs` |
| `tz-offset-ns` | **deferred** — listed so its future home is named | host tz opinion | `std/time/date`, later |

With the five fs entries, `std/os/fs` (Tier 1 once they exist) assembles the ergonomic layer in
l-lang: `walk` (recursive, lazy `:gen` — another consumer for D58), `glob` (over `dir-list` + the
regex engine's class machinery — `*`/`?`/`**` translate to the NFA in ~30 lines), `remove-tree`
with the obvious guard rails.

**Bytes — the deliberate non-entry.** The whole I/O floor is `String`, UTF-8-validated, and
`file-read` *completes trailing multi-byte sequences* — binary files are unrepresentable today, by
construction. Rule it explicitly rather than leave it discovered: **the I/O contract is text, for
now.** The real fix is a first-class `Bytes` value (with `String` as validated-UTF-8-over-bytes, the
Rust/Go lesson) plus `-bytes` twins of the file floor — a language-level addition with D-rulings
attached (literals? indexing answers Int? display?). Defer until the consumer arrives, and name the
consumer so it is recognized on arrival: **binary assets in the games repo** (images, save files
beyond JSON). Writing the ruling now costs a paragraph; retrofitting bytes under a String-shaped
stdlib later costs an audit.

---

## 6. Tier 3 — blocked on language work (each with its stdlib consumer named)

Listed so the language lane can prioritize by who is waiting, not by what is interesting.

1. **Bit operators** (`band` `bor` `bxor` `bnot` `shl` `shr` — or operator-symbol spellings, a D21
   naming call). Semantics ruling is small and must be explicit: defined on Int only, wrap at 64
   bits (`-fwrapv` + BigInt masking already establish the regime), shift counts masked to 0–63,
   `shr` arithmetic (sign-propagating) with `ushr` if ever needed. Both backends are trivial —
   BigInt has native operators, C has native operators, and D51 already made the two
   representations agree. **Waiting on it: `std/math/random`, `std/math/fft`, any future hash
   protocol.** This is the highest-leverage small language item in the file.
2. **Spread call** (`(call f ...args)` or an `apply` floor entry). **Waiting: `std/fn`'s
   portability, `std/sys/timers` callbacks-with-arguments** (its header documents the trap today).
3. **`:gen` on the C backend** — D58, already ruled; the build drains the *entire* lazy library
   plus `walk`, `find-all`, and every `Iterator<Match>` to C. Nothing in this roadmap needs to wait
   for it (all Tier 0/1 modules run eager on C today except the `:gen`-marked operators), but it is
   the single biggest is-the-stdlib-real-on-C multiplier.
4. **Hash/equality protocol** — D53's `equals` is the floor's half; a `Hashable` story (derive from
   the D54 reflection graph? a `hash` floor entry over primitives + structural combine?) is the
   missing half. **Waiting: `std/collections`' general Set/Map stage 2, `distinct` at O(n).**
   Needs a design round, not a patch — flagged for a future brief.
5. **Lambda return-type inference** — `linq`'s own header documents `map`/`flat-map` answering
   `Iterator<Any>` because a lambda's return type is not inferred. **Waiting: the type-quality of
   the whole lazy library.**
6. **Function argument defaults** — deferred per the standing ruling (needs D9 + LL0211 first);
   the stdlib is currently *compensating with name multiplication* (`read-file`/`try-read-file` is
   principled, but mode strings, CHUNK sizes, and seed arguments all want defaults). Not urgent;
   listed because the stdlib is where the pressure will accumulate visibly.

---

## 7. The `--portable` advisory — turning the prelude into a fence

A direct serve for the vibe-test goal. `std/js` is implicitly imported everywhere, so a
JS-authored program can silently lean on `Date`, `RegExp`, `Promise`, `parseInt` — and only
discover it at C-compile time (LL0107, honest but late). Proposal: an **advisory diagnostic mode**
(`--portable`, or a `package.yaml` key) that flags *any* use of a `std/js` extern at JS-compile
time — "this name is host-ambient; the portable spelling is `std/time/date`" — with the did-you-mean
pointing at the stdlib module that replaces it as each one lands. The C backend stays the
enforcement; this is the same fact surfaced where the author is. Cheap (the externs are all
declared in one module; the checker already resolves through it), and it converts every new stdlib
module into an automatic migration hint.

---

## 8. Rulings this roadmap needs (the D-round shopping list)

Collected from above so they can be ruled in one sitting rather than re-stumbled per module:

1. `parse-int` overflow behavior → nil (total, `Int?`) vs wrap. Lean nil.
2. JSON number parse: no-dot-no-exp-in-range → Int, else Real.
3. Path separator: `/` canonical on both backends, `\` normalized on read.
4. Date: **UTC only**, tz explicitly out of core; epoch-ns is the interchange value.
5. Bit operators: Int-only, 64-bit wrap, masked shifts, arithmetic `shr`.
6. Regex: ASCII classes, no backreferences/lookaround (linear-time guarantee stated as a feature).
7. Bytes: text-only I/O contract *ruled*, `Bytes` named as the future language item + its consumer.
8. Random: seeded determinism is the API; reference-vector conformance is the golden.
9. LL0218 (duplicate cross-module symbol) lands **before** the module count doubles.
10. `std/fn`: JS-only quarantine vs spread-call language fix. Lean the fix (it is small).

---

## 9. Proposed build order, against the actual goal

The goal is *writing programs to feel the language*, so the order optimizes time-to-first-honest-
program, not architectural neatness:

| Step | What | Cost | What it unlocks |
|---|---|---|---|
| 1 | `parse-int` + string `replace`/`find` + char classes (§3) | hours | reading input at all |
| 2 | linq/seq completion (§3) | hours–1d | pipelines stop hitting missing shelves |
| 3 | `std/test` + `std/cli` + `std/log` | ~2d | self-checking, parameterized programs |
| 4 | bit-ops ruling + `std/math/random` | ~1.5d | games, sims, property-ish tests |
| 5 | `parse-real` floor + `std/data/json` | 2–3d | config, save files, data programs |
| 6 | fs floor entries + `std/os/path` + `std/os/fs` | ~2d | programs over real directories |
| 7 | `std/collections` stage 1 | ~1.5d | Set/Queue/Counter idioms |
| 8 | `std/time/date` | ~2d | logs, schedules, anything timestamped |
| 9 | `std/text/regex` | ~1w | text tooling; the friction-finder |
| 10 | `std/math/fft`, collections stage 2, bytes design | as pulled | long tail |

Steps 1–4 are roughly one focused week and take the language from "the corpus runs" to "a person
can sit down and write a small real program on either backend without touching an extern." That is
the vibe-test threshold.

---

## 10. The perfect-world stdlib — what a finished l-lang's library looks like

Permission to wonder was granted, so: not a feature list, but the principles a perfect stdlib for
*this specific language* would hold, each with the seed that already exists in the tree.

**Effects are values you are handed, not ambience you reach for.** The best idea in the current
stdlib is `Clock` — the scheduler is testable *because* time is a parameter. The perfect stdlib
generalizes it: filesystem, randomness, clock, and streams are capability values (`Fs`, `Random`,
`Clock`, `Io`) passed where needed and defaulted at `main`, so *every* effectful module has a fake
and every program is goldenable by construction. This is Zig's std.Io conclusion reached from the
other direction — they arrived at "I/O is an allocator-shaped parameter" after shipping and
unshipping compiler-level async; l-lang can arrive there before shipping a scheduler at all. The
driven-not-ambient Scheduler is already this in miniature.

**Serialization is reading, because the language is a lisp.** D55 made display l-lang's own; the
perfect stdlib closes the loop with a *reader*: `(parse-value (display x))` round-trips for every
data value. At that point l-lang's literal syntax **is** the serialization format — homoiconicity
cashed out as engineering instead of slogan — and JSON becomes a foreign-interchange module rather
than the native persistence story. The display formatter is half of this, built and ruled; the
reader is a parser the project already knows how to write.

**Derive, don't write, the boring protocols.** The D54 reflection graph exists on both backends —
which is the hard part of a derive system, already paid for. Perfect world: `:derive[json equals
hash display]` as a defmodifier walking the graph, so a `defstruct` gets its serialization, its
equality, its hash, and its pretty-print for free, and the three hand-written versions that would
otherwise drift never exist. This is serde/Haskell-deriving, except the metadata layer is already
in the tree.

**Protocols small, everywhere, and paired with their fakes.** `Iterable`/`Iterator`/`Disposable`,
`Writer`/`Reader`, `Clock` is the house style already: one-or-two-method interfaces, lowered per
backend, conformance-testable. The perfect stdlib completes the set — `Comparable`, `Hashable`,
`Formattable` — and never ships a concrete type where a two-method interface would do.

**Two conventions, never three.** D33's eager/collection-last vs lazy/collection-first split is a
genuinely good piece of design — it refuses the false unification that makes other stdlibs
confusing. Perfect world keeps exactly these two and extends them mechanically: every new
sequence-shaped module answers "which convention am I in" in its first line.

**The stdlib states rules; it never imports opinions.** ASCII case, four whitespace chars, `/`
separators, UTC, ECMA-262 number formatting, wrapping int64 — the pattern is: where hosts disagree,
l-lang writes down a small exact rule both can implement, even when the rule is deliberately
narrower than what a host offers. The perfect stdlib has *zero* locale-dependent, host-version-
dependent, or tz-database-dependent behavior in core; all of that lives in clearly-labeled
`ext/host-*` modules that portable programs simply do not import.

**Errors are one story.** Values (`T?`) for absence, exceptions for defects, D47
conditions/restarts for the recoverable-with-policy middle — the trio exists; the perfect stdlib
rules *which shelf each module uses* as visibly as D21 rules names, so `try-` twins, throwing
defaults, and restartable operations are predictable across the whole library rather than
per-module taste.

**Testing is a language citizen.** `std/test` grows property-based checking over the seeded
`Random` (generate, shrink, replay-by-seed — determinism makes failures goldens automatically), and
doc examples in comments are executable. A stdlib whose every claim is a runnable assertion is the
"no golden from broken output" discipline applied to documentation.

**And the refusals, because a perfect stdlib is defined by them too:** no finalizers (D59 already),
no global mutable state, no ambient event loop until a real host owns one, no threads before a
memory model, no tz database in core, no locale in core, no second way to do a ruled thing. The
project's taste is already most of this list; the perfect world is mostly the tree continuing to
say no in the same places.

---

*Corrections welcome where the audit misread a module — everything above was taken from the
2026-07-23 merge and the gap ledger, with `std/core/errors` inferred rather than read.*
