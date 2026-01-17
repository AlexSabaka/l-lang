# ⚡ Quick Start Guide

Get up and running with l-lang in **5 minutes**.

---

## 🎯 Installation

```bash
# Clone & enter repo
git clone https://github.com/AlexSabaka/l-lang.git
cd l-lang

# Install dependencies
cd src && npm install

# Build compiler & grammar
npm run parser
npm run build

npm install -g ./
```

**Verify installation:**
```bash
npm test
```

---

## 🎨 Your First Program

### 1. Create `hello.lisp`
```lisp
(console.log "Hello, l-lang! 👋")
```

### 2. Run it
```bash
l-lang run hello.lisp
```

**Output:**
```
Hello, l-lang! 👋
```

---

## 📚 Learn by Example

### Variables & Types
```lisp
(mut count 0)           ;; Mutable variable
(let name "World")      ;; Immutable constant
(let x <- Int 42)       ;; Type annotation
```

### Functions
```lisp
(fn greet [name] (
    (+ "Hello, " name)
))

(greet "Alice")  ;; Output: "Hello, Alice"
```

### Pipelines (My Favorite!)
```lisp
(fn add [a b] (+ a b))
(fn double [x] (* x 2))

;; Instead of: (double (add 5 3))
(5 |> (add 3) |> double)  ;; Output: 16
```

### Pattern Matching
```lisp
(fn describe [x] (
    (match x {
        0     => "Zero!"
        1     => "One!"
        _     => "Something else"
    })
))

(describe 0)  ;; Output: "Zero!"
```

### Classes & OOP
```lisp
(defclass Animal
    (let :ctor name)
    
    (fn speak [] (
        (+ this.name " makes a sound")
    ))
)

(let dog (new Animal "Dog"))
(dog.speak)  ;; Output: "Dog makes a sound"
```

---

## 🔧 Common Commands

| Command | Purpose |
|---------|---------|
| `npm test` | Run test suite (50/81 passing) |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm run parser` | Regenerate PEG.js grammar |
| `ts-node src/index.ts run FILE.lisp` | Compile & execute file |
| `ts-node src/index.ts transform FILE.lisp` | Compile to JavaScript |
| `ts-node src/index.ts repl` | Interactive REPL shell |
| `ts-node src/index.ts run --perf FILE.lisp` | Run with performance profiling |
| `ts-node src/index.ts transform --perf FILE.lisp` | Compile with performance metrics |

---

## 🐚 Interactive REPL

Launch the feature-rich REPL:
```bash
ts-node src/index.ts repl
```

**Features:**
- 🎨 Syntax highlighting
- 🔍 Tab-complete keywords, symbols, & member access
- 📝 Multi-line input support
- ⌨️ Command history (↑/↓)
- 🔧 Built-in commands:
  - `.help` - Show help
  - `.symbols` - List all symbols
  - `.types` - Show type info
  - `.reset` - Clear context

**Example REPL session:**
```
λ> (+ 1 2)
3

λ> (let greet (fn [name] (+ "Hi " name)))
undefined

λ> (greet "Bob")
"Hi Bob"

λ> .symbols
Available symbols: +, -, *, /, greet, ...

λ> .exit
```

For detailed REPL docs: [development/REPL_GUIDE.md](development/REPL_GUIDE.md)

---

## 📊 Compilation Pipeline

l-lang compiles through **6 stages**:

```
Input (.lisp)
    ↓
[1] PARSE     → Raw AST (00_vars.parsed.json)
    ↓
[2] SYNTAX    → Grammar validation
    ↓
[3] SYMBOLS   → Symbol resolution (00_vars.symbols.json)
    ↓
[4] DESUGAR   → Normalize syntax (pipelines, etc.)
    ↓
[5] TYPES     → Type inference (00_vars.types.json)
    ↓
[6] CODEGEN   → JavaScript output (00_vars.js)
    ↓
Output (.js)
```

**Inspect intermediate stages:**
```bash
# View raw AST
ts-node src/index.ts transform --stage parse examples/01-basics/00_vars.lisp
cat examples/01-basics/00_vars.parsed.json | jq .

# View symbol table (with types)
ts-node src/index.ts transform --stage types examples/01-basics/00_vars.lisp
cat examples/01-basics/00_vars.types.json | jq '.symbols'

# View generated JavaScript
ts-node src/index.ts transform examples/01-basics/00_vars.lisp
cat examples/01-basics/00_vars.js
```

---

## 📂 File Structure

```
l-lang/
├── README.md                    # Project overview
├── docs/                        # 📍 All documentation
│   ├── INDEX.md                # Doc hub
│   ├── QUICK_START.md          # This file
│   ├── SIDEBAR.md              # Navigation menu
│   ├── language/SYNTAX.md      # Complete language reference
│   ├── architecture/           # Compiler architecture docs
│   ├── compiler/               # Type system, implementations
│   ├── development/            # Contributing guides
│   ├── planning/               # Roadmap
│   └── history/                # Changelog
├── src/
│   ├── compiler/               # Compiler implementation
│   │   ├── frontend/           # Parsing & AST
│   │   ├── analysis/           # Symbol resolution
│   │   ├── types/              # Type inference
│   │   ├── transformation/     # AST normalization
│   │   ├── codegen/            # JavaScript generation
│   │   └── Context.ts          # Orchestrator
│   ├── cli/                    # CLI & REPL
│   └── index.ts                # Entry point
├── examples/                   # Example programs
│   ├── 01-basics/              # Variables, functions
│   ├── 04-data-types/          # Type system
│   ├── 05-oop/                 # Classes & inheritance
│   └── 10-algorithms/          # Complex examples
└── test/                       # Test suite (36/39 passing)
```

---

## 🎯 Next Steps

### I want to...

**Learn the language**
→ Read [language/SYNTAX.md](language/SYNTAX.md) (starts with basics, goes to advanced features)

**Understand the compiler**
→ Read [architecture/COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md) (6-stage pipeline explanation)

**Contribute features**
→ Read [development/IMPLEMENTATION_GUIDE.md](development/IMPLEMENTATION_GUIDE.md) (step-by-step patterns)

**Debug issues**
→ Read [architecture/COMPILER_ARCHITECTURE.md#critical-context--gotchas](architecture/COMPILER_ARCHITECTURE.md#critical-context--gotchas) (common pitfalls)

**Check progress**
→ Read [development/TODO.md](development/TODO.md) (what's done & what's next)

**See what's coming**
→ Read [planning/ROADMAP.md](planning/ROADMAP.md) (future phases)

---

## ✅ Test Suite

Run the full test suite:
```bash
npm test

# Output:
# ✅ Passed:  36
# ❌ Failed:  1 (modifiers runtime issue)
# 💥 Errors:  2 (stdlib not yet implemented)
# ⚠️  Skipped: 42
```

**Run with verbose output:**
```bash
npm test -- --verbose
```

**Test categories:**
- ✅ Variables, functions, closures
- ✅ String interpolation
- ✅ Pattern matching
- ✅ Control flow (if/when/cond/for/while)
- ✅ Classes & inheritance
- ✅ Error handling
- ✅ Module system
- ✅ Pipelines
- ⚠️ Modifiers (runtime helper issue)
- ⚠️ Standard library (not yet implemented)

---

## 🆘 Troubleshooting

### "Command not found: ts-node"
```bash
cd src && npm install -g ts-node
```

### "npm test" fails
```bash
cd src
npm install
npm run build
npm test
```

### Parser errors after grammar changes
```bash
npm run parser    # Regenerate l-lang.js from l-lang.pegjs
npm run build     # Recompile TypeScript
npm test          # Verify
```

### Type errors not showing
```bash
# Check if types are being inferred
ts-node src/index.ts transform --stage types FILE.lisp
cat FILE.types.json | jq '.symbols.entries.YOUR_VAR.inferredType'
```

---

## 📖 Full Documentation

- **[INDEX.md](INDEX.md)** - Complete documentation hub
- **[SIDEBAR.md](SIDEBAR.md)** - All sections organized by topic
- **[language/SYNTAX.md](language/SYNTAX.md)** - Complete language reference
- **[architecture/COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md)** - Deep dive into how it works

---

## 🎓 Philosophy

> **"We get there when we get there, but we do it right."**

l-lang is a statically-typed Lisp that marries:
- 🎨 **Expressive syntax** (Lisp elegance)
- 🛡️ **Static type safety** (TypeScript-grade types)
- 🏗️ **Enterprise pragmatism** (real OOP, modules, standard library incoming)
- 🚀 **Performance** (JavaScript today, LLVM tomorrow)

---

**Status**: Pre-Alpha | **Tests**: 36/39 ✅ | **Last Updated**: January 16, 2026

For questions or issues, check [architecture/COMPILER_ARCHITECTURE.md#debugging-tips](architecture/COMPILER_ARCHITECTURE.md#debugging-tips).
