> **ARCHIVED 2026-07-28.** Consumed by **D58** (coroutine lowering), **D59** (a precise tracing GC
> with shadow-stack roots, no finalizers) and **D60** (`:async` stays C-refused) in
> [`DECISIONS.md`](../spec/DECISIONS.md).
>
> **D59 is ruled and NOT built** — the collector does not exist; C mallocs and leaks by design, on
> the grounds that a probe debugging a garbage collector has failed its purpose. So a future
> implementer will come looking, and this is what they will find: measurements, not decisions. The
> allocation inventory (a single `ll_alloc` choke point, 19 runtime + 2 emitter call sites, 7
> `realloc` growth sites) is the part D59 does not restate and is the reason this file is worth
> opening.
>
> Note also that D59's *parity* argument — "JS never runs an abandoned generator's `finally` either"
> — was purchased one day before **D66** stopped making JS parity a design goal. The prior-art half
> of the argument (JEP 421, `SafeHandle`, Go's `SetFinalizer`, Rust's `Drop`) is what the ruling
> rests on now.

# Design-round brief — coroutines (`:gen` / `:async`) and the memory model

**From:** the implementation lane (Cheetah/dev). **For:** the Sabaka⇄Dove round.
**Purpose:** *open* three questions properly, with the measurements behind them, so they can be ruled
once instead of re-stumbled. This is the inverse direction of `hir-design-round-brief.md` — that one
carried rulings *down* to the implementation lane; this one carries findings *up*. Nothing here is a
decision. Where the recon changed the shape of a question, it says so; where a leaning exists it is
labelled as a leaning, not an answer.

**Self-contained by construction.** Every claim below carries its own excerpt inline. No assertion
needs the repo to evaluate.

**Status:** measured against `dev` at `96789ba`, 2026-07-23. No compiler changes were made.

---

## 0. Orientation

Skip if this is familiar; it is here so the brief stands alone.

**l-lang** is an expression-oriented Lisp that compiles to **two** targets: JavaScript (via an ESTree
emitter) and **C** (via a typed CIR — resolve → insert-coercions → emit). Both consume the same
**HIR**, a typed post-typecheck IR (D45).

**The C backend is not a pivot; it is a two-ended probe.** It stands in for "a typed native target," so
wherever it has to reach *below* the HIR to get an answer, it records a **dip** in a gap ledger. The
instrument's whole value is that a dip cannot be argued away — it is counted, not debated. The
`hir-llvm-consumption-spec.md` states assumptions **A1–A8** as the negative space the probe measures
against; **A8 is coroutines**, and it is the one assumption deliberately left unbuilt.

**A-0 (D48), the governing rule.** A thing leaves the shared HIR core **only** if it is genuinely a
single-backend pass — one JS has no version of. A decision **both** backends make stays core and must
be *nodified* so the two cannot diverge. This rule decides several of the questions below almost
mechanically, so it is worth holding onto.

**D47 is the precedent that matters here.** Conditions/restarts (`restart-case` / `handle` / `signal` /
`invoke-restart`) shipped **C-native and JS-refused** — JS has no resumable exceptions, so it emits an
honest diagnostic (LL0108) instead of a guess. That is the exact mirror of C refusing coroutines today.
**Per-backend asymmetry is therefore already a ruled-acceptable shape**, not a novel concession.

**The corpus is the test suite, and one golden grades both backends.** 235 example programs, 187
`.expect` files. There is **no** `.c.expect` anywhere in the tree — C is graded against the *same*
golden as JS, which is what makes a backend that stays green through a change a genuine control. Q2
below is precisely a question about whether to spend that property.

---

## 1. State of play

### What C refuses today

```
LL0105 — '<name>' is a generator (:gen) — the C backend does not support coroutines.
         Generators and async functions need a state-machine lowering the HIR does not
         model yet (spec A8); the backend records the gap and refuses.
```

Fired from a single guard in the resolve pass:

```ts
private refuseCoroutine(fn: ast.FunctionNode, name: string): boolean {
  if (!fn.generator && !fn.async) return false;
  report(this.context, CBackendDiagnostics.CoroutineRefused, fn, { ... });
  this.ledger.record("A8", fn.generator ? "generator" : "async", fn,
                     "coroutine construct refused (no suspend/resume model in the HIR)");
  this.refused = true;
  return true;
}
```

On JS both are nearly free — `:gen` → `function*`, `:async` → `async function`, `await` → an
`AwaitExpression` — so the divergence is entirely one-sided.

### What the memory model is today

From the C runtime's own header comment:

```
 *   - Memory: malloc-and-leak, deliberately. Corpus programs are sub-second; a probe that debugs a
 *     garbage collector has failed its purpose.
```

That was the right call for a probe. It is being questioned now because the games repo is exercising
the backends as a real consumer, and a game loop is not sub-second.

### What the strategy lane already ruled about A8

From `hir-llvm-consumption-spec.md` — worth quoting because it *pre-answers* part of Q1:

> **A8 is optional and cleanly deferrable** — ship the native backend **refusing `:gen`/async with an
> honest diagnostic** (this project's LL0230/LL0234 lineage), most code never notices. When it's
> eventually built, do it the **Rust way — a state-machine transform at the HIR level,
> backend-neutral** (JS skips it via `function*`) — **not** `llvm.coro`, which locks you to LLVM's
> passes and edge cases.

So *where* the transform lives is settled. What was never examined is what it would actually cost
against the runtime as it exists — which is finding 1, and it is the reason this brief exists.

---

## 2. Findings

Five, measured. Two of them reshape the question set.

### Finding 1 — `:gen` on C is a *pure* HIR transform. The runtime is already finished.

This is the headline and it inverts the expected cost.

The C runtime's cursor primitive already accepts a **closure** as a fully-formed iterator:

```c
static ll_value ll_iter(ll_value x) {
  /* D30: an Iterable answers `iterator()`, and an Iterator IS an Iterable -- it answers `this`. */
  if (x.tag == LL_OBJ) return ll_dyn_method(2, (ll_value[]){x, ll_box_str(ll_str_lit("iterator"))});
  if (x.tag == LL_CLOSURE) return x; /* already a cursor */
  ...
}

static ll_value ll_next(ll_value it) {
  if (it.tag == LL_NIL) return ll_nil();
  if (it.tag == LL_CLOSURE) return ll_call(it, 0, (ll_value *)0);
  if (it.tag == LL_OBJ) return ll_dyn_method(2, (ll_value[]){it, ll_box_str(ll_str_lit("next"))});
  ...
}
```
<sub>`runtime.c:2002` and `runtime.c:2026`.</sub>

And `for :each` already routes **every non-vector collection** through that protocol rather than
special-casing arrays:

```ts
// WHICH LOWERING. A statically-known vector keeps the direct index loop [...]. Everything ELSE goes
// through D30's protocol: a string, a map, a user `Iterable`, or a boxed value whose shape is only
// known at run time.
const viaProtocol = collection.ctype.k !== "vec";
```
<sub>`ResolveHirToCir.ts:1182`, `resolveForEach`.</sub>

That path is not theoretical — `examples/80-adversarial/iteration_protocol.lisp` is **C-green today**
and drives `for :each` over a hand-written `:implements Iterable` struct.

**So the target shape a lowered generator must produce already exists and is already consumed:**

> a `:gen` call → an `ll_closure` whose `env` is the coroutine frame (the locals live across a yield,
> plus an `int state`) and whose body is a `switch (e->state)`. `ll_iter` passes it straight through.
> `ll_next` calls it. `for :each` drives it. **Zero runtime changes. No new tag, no new class, no
> scheduler, no allocation strategy.**

The frame struct is not new machinery either. The backend *already* emits a **typed** struct per
closure, with named fields, and already allocates and fills it:

```ts
export interface CLifted {
  liftedName: string;
  envStruct: string | null; // the C struct name for captures, or null (no captures -> env unused)
  captures: { field: string; ctype: CType; cell: boolean }[];
  ...
}
```
<sub>`cir.ts:447`. Emission of the typedef and the `ll_alloc` + field-fill is `EmitCirToC.ts:150-158`.</sub>

A coroutine frame is exactly that, plus a state field, plus the one thing that genuinely does not
exist: **the state-machine transform** — split the body at each `yield`, promote live-across-suspend
locals into the frame, rewrite control flow to re-enter at a label. That is real work and it is the
known tar-pit (Rust's two-await function is 360 lines of MIR vs 23). But it is *the whole job*, and per
the spec quote above it is HIR-level and backend-neutral — **so building it for C is building it for
LLVM.**

**What it unblocks immediately.** Eleven `:gen` definitions across the lazy sequence library —
`map filter enumerate concat skip skip-while flat-map seq` in `linq.lisp`, and `take take-while zip` in
`linq-early.lisp` — of fifteen exported operators. The library is *entirely* C-unavailable today; this
is the whole of it. Three corpus programs become gradeable: `13-generators/00`,
`16-stdlib/02_linq_pipeline`, `30-applications/07_line_clear`.

### Finding 2 — `:async` shares the transform and nothing else, and a golden already constrains it.

A generator's resumption is **synchronous and consumer-driven** — someone calls `next`. An async
function's resumption needs a **scheduler and a source of concurrency**, and C has neither.

And the corpus has already ruled on the observable behaviour, whether or not anyone meant it to.
`examples/14-async/01_async_pipeline.expect`, verbatim:

```
pipeline: start
sync tail: main is still in flight
  row 0: ADA was born in 1815
  row 1: ALAN was born in 1912
  row 2: GRACE was born in 1906
  caught: no row with id 9
pipeline: done
```

Line 2 is the **synchronous tail of the module body**, printing *before* any awaited stage. That is JS
microtask ordering, baked into a golden that C is graded against. The source says so deliberately:

```lisp
;; An :async call returns a Task immediately: the sync tail below runs
;; before any awaited stage resolves -- hence it prints SECOND, not last.
(main)
(print "sync tail: main is still in flight")
```

A run-to-completion `:async` on C prints that line **last** and fails the golden. Matching it requires
deferred resumption with JS-compatible queue discipline: a microtask queue, and a top-level drain after
the module body finishes.

The same file also already contains the two hard interactions, so they are not hypothetical: an `await`
inside a `try`, and a `throw` in stage 1 that must surface as a **rejection** at an `await` three
stages up.

One more piece of context, because it is a deliberate prior decision pointing the other way. The
intrinsic floor chose a **blocking** sleep on both backends specifically to avoid async:

```
// A BLOCKING sleep on the main thread, which JS is usually said not to have.
// `Atomics.wait` on a SharedArrayBuffer genuinely blocks [...]. That is what makes a FIXED-STEP loop
// portable: the same l-lang drives it on both backends, with no event loop and no async anywhere.
```
<sub>`RuntimeProvider.ts:690`.</sub>

So async is *not* currently how l-lang expresses timing, and the games use case is served without it.

### Finding 3 — `yield`/`await` across a `try` collides with the setjmp handler stack.

The C backend lowers `try`/`catch`/`finally`, **and** D47's restarts, onto one global chain of frames,
each holding a `jmp_buf` that points into the **C stack**:

```c
typedef struct ll_frame {
  ll_kind kind;
  jmp_buf buf;
  ll_value err;
  struct ll_frame *prev;
  ...
} ll_frame;

static ll_frame *ll_handler_top = 0;
```
<sub>`runtime.c:213` and `runtime.c:235`.</sub>

A coroutine that suspends inside a `try` returns to its caller, destroying the C frame those `jmp_buf`s
name — while the frames remain on the global chain. Resume, then throw, and the unwind longjmps into a
dead frame. The handler stack must become **per-coroutine** (save and restore the segment at
suspend/resume), or suspension inside a protected region must be **restricted**. C# forbids `yield` in
a `catch` for adjacent reasons; that precedent is available and cheap.

**A pleasant inverse worth knowing:** the transform makes an *existing* problem smaller. C11 7.13.2.1p3
says a non-`volatile` local modified between `setjmp` and `longjmp` is indeterminate after a landing —
a bug that was invisible at `-O0` and silently wrong at `-O1`+, and which the project now fences with a
dedicated `volatiles` analysis and an `-O2` suite. Reifying live-across-suspend locals into a heap
frame takes them out of automatic storage, and therefore out of that rule's scope entirely.

### Finding 4 — the heap is already precisely traceable. Only the *roots* are missing.

Every heap shape carries enough to walk it: `ll_obj` knows its field count from its class descriptor and
stores boxed fields in slot order; `ll_vec` and `ll_map` carry `len`; `ll_closure` carries a typed
`envStruct` the emitter itself named (finding 1). Allocation has one choke point —

```c
static void *ll_alloc(size_t n) {
  void *p = malloc(n ? n : 1);
  if (!p) ll_trap("OutOfMemory", "allocation failed");
  return p;
}
```
<sub>`runtime.c:66`. 19 call sites in the runtime, 2 in the emitter, plus 7 `realloc` growth sites.</sub>

What does **not** exist is any notion of a root. `ll_value` locals live in C automatic storage and
nothing registers them. So the GC question is narrower than "which collector" — the object graph is
already precise; the open part is **root discipline**, and everything else follows from it.

Three constraints frame that choice:

- **Single translation unit.** The emitted program is `runtime.c` prepended to the module, depending on
  libc and libm only — self-contained, no link step beyond `cc prog.c`. Boehm buys a collector in an
  afternoon and spends exactly this property.
- **`-O2` is fenced, and it bites here.** `test:c:o2` exists *because* the setjmp-clobber bug was
  invisible at `-O0`. A conservative stack scanner has the same failure shape: a root held only in a
  register at `-O2` is collected, under a green `-O0` suite.
- **`:stack` allocation is already greenlit** for Phase Bg, noted as "needs escape analysis." Escape
  analysis *removes* GC pressure rather than managing it; the two want to be designed aware of each
  other.

### Finding 5 — the real coupling is one edge, not a shared project.

The framing that opened this round was that coroutines and GC must be done hand in hand. The recon says
the coupling is real but *narrow*, and it is this:

```lisp
;; From examples/13-generators/00_generators_and_iteration.lisp -- an INFINITE generator,
;; consumed finitely.
(fn :gen fibs [] -> Iterator<Int> (
    (mut a 0) (mut b 1)
    (while true ((yield a) (let nxt (+ a b)) (a := b) (b := nxt)))))

(let f8 ((fibs) |> (take 8) |> to-list))
```

`take` pulls eight values and stops, leaving `fibs`'s frame **suspended forever**. On JS the GC takes
it. On C it is unreachable garbage nobody frees. And this is not an edge case in the library — `take`,
`take-while`, `first` and `any` abandon by construction; that is what they are *for*.

But note what this does and does not imply. The baseline is *already* malloc-and-leak, so `:gen`
shipping before GC is **strictly no worse than today**. The coupling is therefore a **constraint on the
frame representation** — traceable, and enumerable — not a build-order dependency. Cheap to honour if
decided *before* the transform is written; expensive to retrofit after.

A second, smaller edge: an abandoned generator's `finally` never runs. JS runs it via `.return()` on
the iterator. D30's protocol is `next() -> T?` with **no disposal hook at all**, on either backend — so
this is a shared-protocol question, not a C question (Q5).

---

## 3. The questions

### Q1 — the coroutine transform: shape, and the frame representation

*Where* it lives is already ruled (HIR-level, backend-neutral, Rust-style, not `llvm.coro`). What is
open:

- **Does the generator object lower to a closure or to an object?** A closure needs literally no runtime
  change (finding 1). An object gets a name in `inspect`/`type` output and somewhere to hang a
  disposal method (Q5). See Q6 — they are the same decision seen twice.
- **What does the frame carry so a future GC can trace it?** The cheap answer is: a typed struct (the
  `envStruct` machinery already produces one) plus registration in some enumerable set at creation. If
  this is decided now, `:gen` is GC-ready by construction. If it is not, it is a retrofit.
- **How much does the transform restrict?** A full transform handles `yield` in arbitrary control flow.
  A restricted one (no suspend inside a protected region — Q4) is meaningfully simpler and covers all
  eleven library operators, which suspend only inside `while` and `for :each`.

### Q2 — is `01_async_pipeline.expect` the oracle for C? ***(the sharpest one)***

Three answers, and they are genuinely different projects:

| | what it costs | what it spends |
|---|---|---|
| **Microtask queue on C** | a queue, a top-level drain, a `Task` repr, rejection propagation, `await`-in-`try` across the setjmp stack | nothing — the golden and the control both survive |
| **Per-backend `.c.expect`** | almost nothing | the same-golden control, at exactly the point where divergence is most likely to hide. No `.c.expect` exists anywhere in the corpus today |
| **Keep `:async` C-refused** | nothing; LL0105 stays for `:async` only, `:gen` lands | nothing — D47 already ruled per-backend asymmetry acceptable, and this is its mirror |

**Sabaka's leaning, recorded not settled:** a microtask queue "is fine and lightweight for the C
backend." Worth testing that against the rest of the bill — the queue itself is indeed small; the
`Task` representation, rejection propagation through a chain of suspended frames, and `await` inside a
`try` across the setjmp handler stack are the parts that are not.

Also worth weighing: with no timers, no I/O multiplexing and no threads, **nothing on C makes a `Task`
pending except an `await` on another async function.** A microtask queue over that is fully
deterministic — which is good (it can match JS exactly) and also a sign that async on C is currently a
*sequencing* device rather than a concurrency one.

### Q3 — GC root discipline ***(genuinely open)***

| | precision | `-O2` | single TU | emitter cost |
|---|---|---|---|---|
| **Shadow stack** | precise | safe | preserved | a frame push/pop and a slot per boxed local, in **every** emitted function |
| **Conservative scan** | imprecise (false retention) | **register-only roots can be collected** | preserved | none |
| **Boehm `libgc`** | conservative, battle-tested | handled by the library | **spent** | none |
| **Rule the constraint only** | — | — | — | none; defers the choice |

**Sabaka's position:** unsure, leaning shadow stack *or* Boehm, and explicitly wants this ruled here.

Two things to weigh that the table flattens. First, the `-O2` row is not theoretical for this codebase
— the setjmp-clobber bug was a real silent-wrong-answer at `-O1`+ that a green `-O0` suite did not
catch, and a conservative scanner fails the same way. Second, **there is no acceptance test for a
collector today.** Nothing in the corpus measures memory; a bounded-memory assertion (RSS after N
iterations ≈ RSS after 2N) would have to be built before any of these can be *graded*. That argues for
either building the test first, or ruling the constraint (option 4) and choosing later.

### Q4 — `yield` / `await` inside `try` / `finally` / `restart-case`

Per-coroutine handler segment (save/restore `ll_handler_top` across a suspend), or forbid suspension
inside a protected region (the C# precedent)?

D47's Cr-0 lesson applies almost directly and is the strongest available guidance: the hard part there
was that a restart transfer **must** run intervening cleanups, and it was solved by unifying everything
onto *one* stack walked by *one* primitive — explicitly **not** by adding a parallel mechanism. A
per-coroutine segment is a save/restore of that one stack, which is in keeping. A second, parallel
unwind path for coroutines would not be.

### Q5 — does D30 grow a disposal hook?

Needed for an abandoned generator's `finally`. D30 today is `Iterator<T>` = `next() -> T?`, nil means
done. Adding disposal is a **both-backends protocol change**, so by A-0 it is core and must be nodified
rather than left to each backend. Note it is not a C-only problem: JS has `.return()` and l-lang does
not currently expose it, so today an abandoned generator's `finally` is unreliable on *both* backends.

### Q6 — closure or object for the generator instance?

Mechanically decides Q5. A closure is free (finding 1) but has nowhere to put `dispose`. An object costs
a class descriptor per generator but is uniform with hand-written iterators and prints sensibly. If Q5
answers "yes, disposal," this likely answers itself.

### Q7 — do finalizers exist?

`:destructor` (D15) is already a language feature, and `ll_frame` invokes it during unwind. If a
collector lands, does it run destructors on collection? Non-deterministic finalization is a well-known
trap, and **"no — destructors are scope-bound, GC is memory-only"** is a perfectly defensible ruling
that costs nothing to state now and is painful to retract later.

### Q8 — a real hole, probably a one-line correction

D31 says `(yield)` with no argument yields **nil**. D30 says nil **means done**. Through the
`iter`/`next` cursor these are the same value, so a bare `(yield)` silently truncates the sequence. The
runtime already argues the protocol's side:

```c
/* nil MEANS DONE -- the whole protocol, and the reason it needs no `{value, done}` pair. D9 gives the
 * language exactly one bottom value, so "no more elements" and "absent" are the same answer, and a
 * sequence containing nil is not expressible anyway. */
```

If that stands, D31's "`(yield)` yields nil" should become "a valueless `(yield)` is an error" or be
struck. Flagged for completeness; it does not need a design round.

---

## 4. Sequencing

Stated as options with honest cost, not as a recommendation.

**A — `:gen` alone, GC ruled as a constraint.** One HIR pass, no runtime changes, no scheduler. Drains
the entire lazy library to C and *is* the LLVM coroutine work. Requires Q1, Q4, Q6 answered; Q3 answered
only as far as "the frame must be traceable and enumerable." Leaves `:async` refused (Q2 = option 3) and
the collector unbuilt. Smallest thing that produces a real capability.

**B — `:gen` + GC.** Adds the collector and its acceptance test, which does not exist yet. Requires Q3
fully. Closes the abandoned-frame leak that `take` creates by construction — though note that leak is
no worse than today's baseline.

**C — all three.** Adds the microtask queue, `Task` representation, and rejection propagation through
suspended frames. Requires every question answered, including the `await`-inside-`try` interaction with
the setjmp stack (Q4's hardest case).

**D — rulings only, build later.** What this round is. D58–D60 land in `DECISIONS.md`; the build is a
later phase against settled contracts.

The one ordering constraint the recon actually establishes: **whatever the frame representation is, it
should be decided before the transform is written**, because "traceable and enumerable" is nearly free
up front and a retrofit afterward.

---

## 5. What would falsify the central claim

Finding 1 is load-bearing for everything above, so it deserves an explicit disproof condition. The claim
is that a `:gen` lowered to a state-machine closure needs **no C runtime changes**. It is wrong if:

- `ll_next`'s closure arm cannot express "done" distinctly from "yielded nil" — but D30 already rules a
  sequence containing nil inexpressible (Q8), so this is closed;
- a generator's result must satisfy `iterator()` as well as `next()` — a *fresh cursor per call* under
  D30. A generator is an `Iterator`, and an `Iterator` `:implements Iterable` by answering `this`, which
  `ll_iter`'s closure passthrough already does. Closed, but it is the sharpest edge;
- the transform needs to suspend across a call boundary (it does not — `yield` is lexical within one
  function body; delegation would need `yield*`, which l-lang does not have and `concat` avoids by
  re-yielding in a loop).

The cheapest empirical check on all three, if wanted before ruling: hand-write the state machine for one
operator (`take`) as an l-lang `:implements Iterable` struct and confirm it drives `for :each` on C
unmodified. That path is already known green via `80-adversarial/iteration_protocol.lisp`.
