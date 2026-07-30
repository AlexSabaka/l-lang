# 🦥 l-lang

> **"We get there when we get there, but we do it right."**

**l-lang** is a statically typed Lisp that thinks it's C#, built by someone who got tired of choosing between functional elegance and enterprise pragmatism.

---

## What Is This?

Most Lisps are dynamic typing in nature, but I see static typing as a basic necessity. Most enterprise languages are way over verbose _imo_. With **l-lang** I try to marry expressiveness of lisps with static typing and to compile down to native code.

It's a general-purpose language with **two backends**. The **C backend is the reference implementation** — that's the one that gets fixed and extended, and the one the gate runs. The JavaScript backend is kept as a *differential-testing oracle*: both grade against **one** golden, so a disagreement has nowhere to hide. Since D103 that comparison is a hand-run instrument rather than a per-commit step — it earned its keep (~17–20 C defects) but the ledger it filled was growing faster than the bugs it found.

- **Static types, checked:** generics, interfaces, union types, tuples, records. Types are **nominal**; interfaces conform **structurally** (the Go model). Static safety without the verbosity tax.
- **Refinement newtypes:** `(deftype uint8 <- Int :satisfies (0..255))` — a distinct type with bounds the compiler checks at every boundary, not a comment.
- **Units of measure:** `(deftype :unit Meter <- Real)`, and `(/ d t)` is `Meter/Second`. Dimensions compose through `*` and `/`, `+` refuses to cross them, and the whole thing **erases** — no runtime cost.
- **Real OOP:** classes, inheritance, constructors, virtual dispatch. Value-semantic structs. No `protected` — the implementation-inheritance leak Go and Rust both drop.
- **Conditions & restarts:** Common Lisp's resumable second exception mechanism — `restart-case`, `handle`, `signal`, `invoke-restart` — native on C.
- **Pipeline operators:** `|>` and `<|`, because `(f (g (h x)))` is visual torture.
- **Pattern matching:** `match` with guards, type patterns, rest patterns, and regex arms.
- **Compile-time evaluation:** Zig-style `:comptime`, folded by an in-house interpreter.
- **Lazy LINQ:** collection-first `:gen` operators over an iteration protocol, chained through `|>`, lazy end to end — so it terminates over an infinite generator.
- **Packages & visibility:** a `package.yaml` compilation unit with package-scoped `public`/`internal`/`private`.
- **Extension methods:** `(fn :extension area [self <- Rectangle] ...)` so `(rect.area)` dispatches to a free function — compile-time and nominal.

- **Macros, in two tiers:** `defsyntax` rewrites a full AST (D95-a) and `defmacro` rewrites a cons list of *tokens* (D102) — the only tier that can introduce new surface syntax. Both expand statically, module-locally, under depth and step budgets. Neither claims hygiene.

**What it deliberately isn't:** there is no `eval`; it needs a runtime AST interpreter, which is a phase of its own, and asking for one is a clean LL0236 rather than a silent fallthrough to the host's. `quote` gives you the AST datum (D101), so code-is-data holds and code-as-code does not — yet. There is no REPL: the one that existed ran only on the deprecated backend and was retired by D105.

---

## Sample of l-lang

Every snippet below is lifted from a program in `examples/`, which is the end-to-end test suite —
each one compiles and runs on both backends against a golden.

```lisp
;; examples/01-functions/04_pipelines.lisp
(let result-a
    (5
     |> (sub 7)
     |> (add 1)
     |> square))
```

```lisp
;; examples/09-oop/03_dispatch_and_type_patterns.lisp
(definterface Node
    (fn eval [] -> Real)
    (fn show [] -> String)
)

(defclass Num :implements Node
    (let :ctor value <- Real)

    (fn eval [] -> Real (return this.value))
    (fn show [] -> String (return (+ "" this.value)))
)
```

```lisp
;; examples/16-stdlib/26_units.lisp — dimensions, checked and then erased
(deftype :unit Meter  <- Real)
(deftype :unit Second <- Real)
(deftype :unit Kg     <- Real)

(deftype Speed  <- Real :satisfies (/ Meter Second))
(deftype Watt   <- Real :satisfies (/ (* Kg Meter Meter) (* Second Second Second)))

(let d <- Meter  10.0)
(let t <- Second  2.0)
(let v <- Speed (/ d t))     ;; typechecks: the dimensions match, not the names
;; (+ d t)                   ;; LL0247 — 'Meter' and 'Second'
```

---

## Status: Pre-Alpha

**Current State:** Under Construction

The compiler emits C (the reference target) and JavaScript (the oracle). LLVM is a future phase.
Stabilizing syntax and building the standard library while trying not to add every feature that seems cool.

See the [roadmap](docs/roadmap.md) for what's built, what's left, and what's broken on purpose.

---

## 📚 Documentation

**New to l-lang?** Start here:

1. **[Quick Start](docs/quick-start.md)** ⚡ - Get running in 5 minutes
2. **[Language Syntax](docs/language-syntax.md)** 📖 - The syntax guide
3. **[Language Reference](docs/language-reference.md)** 🔌 - Built-ins & standard library
4. **[Documentation Index](docs/INDEX.md)** 📑 - Full documentation hub

**Going deeper:**
- **[What l-lang is, and is not](docs/spec/IDENTITY.md)** 🧭 - The shape of the language, its refusals, and where the design is currently incoherent.
- **[Decisions log](docs/spec/DECISIONS.md)** - Every ruling, D1–D105, with the measurement behind it. Start at its topic index.
- **[Compiler](docs/language-compiler.md)** 🏗️ - The compilation pipeline
- **[The intrinsic floor](docs/spec/FLOOR.md)** - The runtime contract the backends must not diverge on
- **[Grammar](docs/spec/GRAMMAR.ebnf)** - Generated from the parser, so it cannot drift
- **[Roadmap](docs/roadmap.md)** 🗺️ - Phases, status, and the known gaps
- **[Changelog](docs/changelog.md)** - What changed

**For contributors:** read **[Contributing](docs/CONTRIBUTING.md)** 🤝 and **[CLAUDE.md](CLAUDE.md)** (the working contract — the gate, the ledgers, and why a golden is never blessed from output).

---

```bash
# Clone the repo
git clone https://github.com/AlexSabaka/l-lang.git
cd l-lang

# Install dependencies and build (note: package.json lives in src/)
cd src && npm install && npm run build

# Compile and run a file — C is the default backend
npx ts-node index.ts run ../examples/00-basics/00_vars.lisp

# ...or on the deprecated JavaScript oracle
npx ts-node index.ts run --backend js ../examples/00-basics/00_vars.lisp

# Emit the C without running it
npx ts-node index.ts transform ../examples/00-basics/00_vars.lisp

# The corpus
npm run test:c        # C — the reference, and the gate
npm run test:c:o2     # the same, optimized (this fence catches setjmp clobbers -O0 cannot)
npm test              # JavaScript — an instrument, not a gate (D103)
```

`run` and `transform` both need a working `cc` on your PATH. `--backend js` does not.

### Test Status

**357 programs in `examples/`**, compiled and run against hand-derived goldens. The live numbers are
in the ledgers rather than transcribed here, because a number in a README goes stale and a ledger the
suite reads cannot:

- `src/test/manifest.ts` — what every corpus file is (`test`, `library`, `fixture`, `xfail`, `negative`)
- `src/test/c-status.ts` — what C must pass; an unlisted-but-passing file turns the build **red**
- `src/test/js-status.ts` — what JS is known to fail; the same ratchet, opposite polarity

Alongside the corpus run the codegen, type-error, diagnostics, import, memory, AST-invariant and
grammar-smoke suites. See [src/test/README.md](src/test/README.md).

---

## Contributing

Sloths and turtle followers are welcomed! Here's how to get started:

1. **Read [Contributing](docs/CONTRIBUTING.md)** and **[CLAUDE.md](CLAUDE.md)** for the working rules
2. **Check the [roadmap](docs/roadmap.md)** for status and the known gaps
3. **Read the [Compiler doc](docs/language-compiler.md)** to understand the pipeline
4. **Follow the rulings** in the [decisions log](docs/spec/DECISIONS.md) — every change is measured and gated

**Want to help?** We need:
- Bug fixes — the [known gaps](docs/roadmap.md#known-gaps) list is live and reproduced
- Documentation & examples (adversarial ones especially — the corpus is the correctness net)
- Standard library implementation
- Type system improvements
- LLVM backend (future phase)

### Disclaimer

This dev branch was 70% vibe coded. Thanks Anthropic AI and Google Gemini.

---

## 📜 License

MIT
