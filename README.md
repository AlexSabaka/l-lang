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

See [ROADMAP.md](docs/planning/ROADMAP.md) for the details.

---

## 📚 Documentation

**New to l-lang?** Start here:

1. **[docs/QUICK_START.md](docs/QUICK_START.md)** ⚡ - Get running in 5 minutes
2. **[docs/API_REFERENCE.md](docs/API_REFERENCE.md)** 🔌 - Built-in functions & standard library
3. **[docs/language/SYNTAX.md](docs/language/SYNTAX.md)** 📖 - Complete language reference
4. **[TABLE_OF_CONTENTS.md](TABLE_OF_CONTENTS.md)** 📑 - Full documentation index

**For contributors:**
1. **[CONTRIBUTING.md](CONTRIBUTING.md)** 🤝 - How to contribute to l-lang
2. **[docs/architecture/COMPILER_ARCHITECTURE.md](docs/architecture/COMPILER_ARCHITECTURE.md)** 🏗️ - 6-stage compilation pipeline
3. **[docs/development/IMPLEMENTATION_GUIDE.md](docs/development/IMPLEMENTATION_GUIDE.md)** 🛠️ - How to add features
4. **[docs/development/TODO.md](docs/development/TODO.md)** ✅ - Current tasks & progress

**Other useful docs:**
- **[docs/INDEX.md](docs/INDEX.md)** - Documentation hub (role-based pathways)
- **[docs/SIDEBAR.md](docs/SIDEBAR.md)** - Navigation sidebar for all topics
- **[docs/compiler/TYPE_SYSTEM.md](docs/compiler/TYPE_SYSTEM.md)** - Type inference deep dive
- **[docs/repl.md](docs/repl.md)** - Interactive REPL features
- **[docs/planning/ROADMAP.md](docs/planning/ROADMAP.md)** - Future roadmap

**See [TABLE_OF_CONTENTS.md](TABLE_OF_CONTENTS.md) for the complete documentation index.**

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

# Run test suite (50/81 passing ✅)
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

**50/81 tests passing (62%)** ✅

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

1. **Read [CONTRIBUTING.md](CONTRIBUTING.md)** for contribution guidelines
2. **Check [docs/development/TODO.md](docs/development/TODO.md)** for tasks
3. **Read [docs/architecture/COMPILER_ARCHITECTURE.md](docs/architecture/COMPILER_ARCHITECTURE.md)** to understand the compiler
4. **Follow patterns** in [docs/development/IMPLEMENTATION_GUIDE.md](docs/development/IMPLEMENTATION_GUIDE.md)

**Want to help?** We need:
- Bug fixes (see [docs/development/BUG_FIXES_SUMMARY.md](docs/development/BUG_FIXES_SUMMARY.md))
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
