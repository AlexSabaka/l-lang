# 🦥 l-lang

> **"We get there when we get there, but we do it right."**

**l-lang** is a statically typed Lisp that thinks it's C#, built by someone who got tired of choosing between functional elegance and enterprise pragmatism.

---

## What Is This?

Most Lisps are dynamic typing in nature, but I see static typing as a basic necessity. Most enterprise languages are way over verbose _imo_. With **l-lang** I try to marry expressiveness of lisps with static typing and possibly to be compiled into machine code.

It's a general-purpose language currently transpiling to JavaScript (LLVM backend in the distant future yet). It features:

- **Homoiconic Syntax:** Code is data. Data is code. Everything is an S-expression because nested function calls are a crime against readability.
- **TypeScript-Grade Type System:** Generics, interfaces, structural typing, union types (`Animal | Dog`). Static safety without the verbosity tax.
- **Real OOP:** Classes, inheritance, constructors—not the weird prototype chain nonsense. If you liked C# but wished it had macros, this is your drug.
- **Three-Tier Metaprogramming:** Zig-style `comptime` for type-level programming, Common Lisp `defmacro` for simple rewrites, full `defsyntax` for building DSLs. Pick your poison.
- **Pipeline Operators:** Native `|>` support because `(f (g (h x)))` is visual torture.
- **Pattern Matching:** Actual `match` expressions that make `switch` statements look like a joke from the 1970s.
- **Trimmed RTTI:** C#-style reflection but lighter—just enough to inspect types at runtime without the bloat.
- **Lazy LINQ:** collection-first `:gen` operators (`map`/`filter`/`take`/`zip`/…) over an iteration protocol, chained through the `|>` pipe. `(nums |> (map square) |> (take 3) |> to-list)` — lazy end to end, so it terminates over an infinite generator.
- **Packages & visibility:** a `package.yaml` compilation unit (the C# assembly / Rust crate steal), with package-scoped `public`/`internal`/`private`. No `protected` — the implementation-inheritance leak Go and Rust drop.
- **Extension methods:** `(fn :extension area [self <- Rectangle] ...)` so `(rect.area)` dispatches to a free function — compile-time and nominal, protocol-aware, and it composes with `:gen` for lazy extension methods.

---

## Sample of l-lang

```lisp
(defclass :internal FoodsController :extends ControllerBase
    (let :ctor _repo <- IFoodsRepository<Food>)

    ;; Async + strict typing + pipelines
    (fn :async :public GetAll [query] -> IActionResult (
        (query
            |> _repo.GetAll
            |> .Skip (* query.Page query.PageSize)
            |> .Take query.PageSize
            |> Ok)))
)

;; Pattern matching with destructuring
(fn analyze-vector [vec] (
    (match vec {
        [1 2 3]   => "One, two, three"
        [1 _ _]   => "Starts with one, of length 3"
        [1 ...]   => "Starts with one, of any length"
        []        => "Just an empty vector"
        _         => "Literally anything"
    })
))

;; Comptime generics (Zig-inspired)
(fn :comptime max [a b] (if (> a b) a b))

;; User-defined function modifiers
(defmodifier memoized [])
(fn :memoized fibonacci [n] (
    (match n {
        0 => 1
        1 => 1
        _ => (+ (fibonacci (- n 1)) (fibonacci (- n 2)))
    })
))

;; Runtime type introspection
(fn describe [x] (
    (match (typeof x) {
        Int    => "A number with no identity crisis"
        String => "Text, probably a lie"
        _      => "Something we didn't plan for"
    })
))
```

---

## Status: Pre-Alpha

**Current State:** Under Construction

The compiler transpiles to JavaScript. Stabilizing syntax and building the standard library while trying not to add every feature that seems cool.

See the [roadmap](docs/roadmap.md) for the details.

---

## 📚 Documentation

**New to l-lang?** Start here:

1. **[Quick Start](docs/quick-start.md)** ⚡ - Get running in 5 minutes
2. **[Language Reference](docs/language-reference.md)** 🔌 - Built-in functions & standard library
3. **[Language Syntax](docs/language-syntax.md)** 📖 - The complete syntax guide
4. **[Documentation Index](docs/INDEX.md)** 📑 - Full documentation hub

**Going deeper:**
- **[Compiler](docs/language-compiler.md)** 🏗️ - The compilation pipeline
- **[Decisions log](docs/spec/DECISIONS.md)** 🧭 - Every ruling (D1..D36), with the evidence
- **[Roadmap](docs/roadmap.md)** 🗺️ - Phases, status, and the known gaps
- **[REPL](docs/repl.md)** - Interactive REPL features
- **[Changelog](docs/changelog.md)** - What changed

**For contributors:** read **[Contributing](docs/CONTRIBUTING.md)** 🤝, and the [decisions log](docs/spec/DECISIONS.md) for how rulings are made and gated.

---

```bash
# Clone the repo
git clone https://github.com/AlexSabaka/l-lang.git
cd l-lang

# Install dependencies
cd src && npm install

# Build the compiler
npm run parser
npm run build

# Interactive REPL 🎨
ts-node src/index.ts repl

# Compile and run a file
ts-node src/index.ts run examples/01-basics/00_vars.lisp

# Or compile to JavaScript
ts-node src/index.ts transform examples/01-basics/00_vars.lisp
node examples/01-basics/00_vars.js

# Performance profiling & optimization 🔍
ts-node src/index.ts transform --perf examples/05-oop/00_inheritance.lisp
ts-node src/index.ts run --perf examples/01-basics/08_pipelines.lisp

# Run the golden test suite (green on both frontends; a handful of tracked xfails)
npm test

# Run tests with detailed output
npm test -- --verbose
```

### Interactive REPL

Launch the feature-rich REPL for exploring l-lang:

```bash
ts-node src/index.ts repl
```

**Features:**
- 🎨 Syntax highlighting
- 🔍 Tab-based autocomplete (keywords, symbols, member access)
- 💾 Persistent context across evaluations
- 📝 Multi-line input with bracket balancing
- ⌨️ Command history (↑/↓ arrows)
- 🔧 Built-in commands (`.help`, `.symbols`, `.types`, `.reset`)

See [docs/repl.md](docs/repl.md) for complete documentation.

### Test Status

**The golden suite is green on both frontends** (grammar_v2 and the legacy PEG), with a handful of
tracked `xfail`s — each an example that asks for a feature not yet built, not a regression. Alongside it
run the codegen, type-error (corpus reports **0** diagnostics), import, REPL, and grammar-smoke suites.

All core features validated:
- ✅ Variables, functions, closures
- ✅ String interpolation  
- ✅ Pattern matching
- ✅ Control flow (if/when/cond/for/while)
- ✅ Classes & inheritance
- ✅ Error handling
- ✅ Module system
- ✅ Pipelines
- ✅ **DefModifiers** - User-defined function transformers (`examples/06-modifiers/`)

See [src/test/README.md](src/test/README.md) for testing documentation.

---

## Contributing

Sloths and turtle followers are welcomed! Here's how to get started:

1. **Read [Contributing](docs/CONTRIBUTING.md)** for contribution guidelines
2. **Check the [roadmap](docs/roadmap.md)** for status and the known gaps
3. **Read the [Compiler doc](docs/language-compiler.md)** to understand the pipeline
4. **Follow the rulings** in the [decisions log](docs/spec/DECISIONS.md) — every change is measured and gated

**Want to help?** We need:
- Bug fixes (the [decisions log](docs/spec/DECISIONS.md) records past ones and their evidence)
- Documentation & examples
- Standard library implementation
- Type system improvements
- Grammar enhancements
- LLVM backend (future phase)

### Disclaimer

This dev branch was 70% vibe coded. Thanks Anthropic AI and Google Gemini.

---

## 📜 License

MIT
