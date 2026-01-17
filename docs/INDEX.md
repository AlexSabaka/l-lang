# 📚 l-lang Documentation Index

Welcome to the **l-lang** compiler documentation. This directory contains complete information about the language, compiler architecture, and development guides for the **l-lang statically-typed Lisp** that transpiles to JavaScript.

**Current Status**: Pre-Alpha (36/39 tests passing, Phase 3.5 architecture - integrated type system)

---

## 🗺️ Documentation Organization

### 📖 Core Resources (Start Here!)

| Resource | Purpose | Best For |
|----------|---------|----------|
| **[QUICK_START.md](QUICK_START.md)** | Get running in 5 minutes | New users, quick setup |
| **[SIDEBAR.md](SIDEBAR.md)** | Complete navigation menu | Finding topics, web browsing |
| **[API_REFERENCE.md](API_REFERENCE.md)** | Built-in functions & API | Developers, looking up functions |
| **[language/SYNTAX.md](language/SYNTAX.md)** | Complete language guide | Learning l-lang syntax |

### 🏗️ Architecture & Design

- **[architecture/COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md)** (346 lines) - Complete 6-stage pipeline
  - Parse → Syntax → Symbols → Desugar → Types → Codegen
  - Visitor patterns, AST structure
  - Symbol table design
  - Critical gotchas & debugging

- **[compiler/TYPE_SYSTEM.md](compiler/TYPE_SYSTEM.md)** (260 lines) - Type inference deep dive
  - InferredType interface & kinds
  - TypeEnvironment (scope management)
  - Type inference pipeline (2-pass)
  - Adding new type kinds

### 📚 Detailed Guides
### 📚 Detailed Guides

- **[compiler/DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md](compiler/DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md)** (262 lines) - Type aliases & structs
- **[compiler/DEFMODIFIER_IMPLEMENTATION.md](compiler/DEFMODIFIER_IMPLEMENTATION.md)** (302 lines) - User-defined modifiers

### 🛠️ Development & Contributing

- **[development/IMPLEMENTATION_GUIDE.md](development/IMPLEMENTATION_GUIDE.md)** (316 lines) - How to add features
  - Patterns for adding type kinds, transformations, runtime helpers
  - Using compilation artifact JSON files (`.parsed.json`, `.symbols.json`, `.types.json`)
  - Debugging techniques & tools

- **[development/REPL_GUIDE.md](development/REPL_GUIDE.md)** (342 lines) - Interactive REPL
  - Syntax highlighting, tab-completion
  - Commands: `.help`, `.symbols`, `.types`, `.reset`
  - Keyboard navigation

- **[development/BUG_FIXES_SUMMARY.md](development/BUG_FIXES_SUMMARY.md)** (317 lines) - Recent improvements
  - Critical codegen fixes (string interpolation, `new` keyword, zero-arg calls)
  - Test results: 36/39 passing (92%)

- **[development/TEST_CONSOLIDATION.md](development/TEST_CONSOLIDATION.md)** (219 lines) - Test infrastructure
  - Unified TypeScript test runner
  - Running specific tests, verbose mode

- **[development/TODO.md](development/TODO.md)** (227 lines) - Implementation checklist
  - What's complete ✅
  - What's in progress
  - What's next (LLVM backend)

### 📊 Project Status & Planning

- **[planning/ROADMAP.md](planning/ROADMAP.md)** (119 lines) - Product roadmap
  - Phase 1: Stabilization ✅
  - Phase 2: OOP & syntax ✅
  - Phase 2.5: Architecture refactor ✅
  - Phase 3: High-level IR (future)
  - Phase 4: LLVM native compilation (future)

- **[history/CHANGELOG.md](history/CHANGELOG.md)** (290 lines) - Timeline of changes
  - Type system extensions (Jan 2026)
  - Architecture refactor (Jan 2026)
  - OOP implementation (Nov 2025)
  - Previous milestones & known issues

---

## 🎯 Quick Start by Role

### For Language Users
1. **[QUICK_START.md](QUICK_START.md)** - Installation & your first program (5 min)
2. **[API_REFERENCE.md](API_REFERENCE.md)** - Built-in functions & standard library
3. **[language/SYNTAX.md](language/SYNTAX.md)** - Complete language reference
4. Check `examples/` directory for working code examples

### For Compiler Contributors
1. **[QUICK_START.md](QUICK_START.md)** - Setup & project structure (5 min)
2. **[architecture/COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md)** - Pipeline architecture
3. **[development/IMPLEMENTATION_GUIDE.md](development/IMPLEMENTATION_GUIDE.md)** - How to add features
4. **[compiler/TYPE_SYSTEM.md](compiler/TYPE_SYSTEM.md)** - Type inference details
5. **[development/TODO.md](development/TODO.md)** - Find a task to work on

### For Debugging Issues
1. **[architecture/COMPILER_ARCHITECTURE.md#critical-context--gotchas](architecture/COMPILER_ARCHITECTURE.md#critical-context--gotchas)** - Common pitfalls
2. **[development/IMPLEMENTATION_GUIDE.md#debugging-tools](development/IMPLEMENTATION_GUIDE.md#debugging-tools)** - Debugging techniques
3. **[development/BUG_FIXES_SUMMARY.md](development/BUG_FIXES_SUMMARY.md)** - Recent fixes & patterns
4. **[SIDEBAR.md](SIDEBAR.md)** - Quick lookup by topic

### For Adding Language Features
1. **[development/IMPLEMENTATION_GUIDE.md](development/IMPLEMENTATION_GUIDE.md)** - Feature implementation pattern
2. **[compiler/DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md](compiler/DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md)** - Real implementation example
3. **[compiler/TYPE_SYSTEM.md](compiler/TYPE_SYSTEM.md)** - If adding types
4. **[development/BUG_FIXES_SUMMARY.md](development/BUG_FIXES_SUMMARY.md)** - Recent patterns & gotchas

---

## 🔍 Finding Information by Topic

### Language & Syntax
- **Variables & types**: [language/SYNTAX.md](language/SYNTAX.md) | [API_REFERENCE.md](API_REFERENCE.md#-type-system)
- **Functions & pipelines**: [language/SYNTAX.md](language/SYNTAX.md) | [API_REFERENCE.md](API_REFERENCE.md#-pipeline-operator)
- **Pattern matching**: [language/SYNTAX.md](language/SYNTAX.md) | [API_REFERENCE.md](API_REFERENCE.md#-pattern-matching)
- **OOP (classes, inheritance)**: [language/SYNTAX.md](language/SYNTAX.md) | [API_REFERENCE.md](API_REFERENCE.md#-object-oriented-programming)
- **Metaprogramming**: [language/SYNTAX.md](language/SYNTAX.md) | [API_REFERENCE.md](API_REFERENCE.md#-metaprogramming)
- **Modules & imports**: [language/SYNTAX.md](language/SYNTAX.md) | [API_REFERENCE.md](API_REFERENCE.md#-module-system)

### Compiler Architecture
- **6-stage pipeline**: [architecture/COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md#architecture-overview)
- **Symbol table & resolution**: [architecture/COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md#4-symboltable-structure-with-integrated-types)
- **Type inference**: [compiler/TYPE_SYSTEM.md](compiler/TYPE_SYSTEM.md#type-inference-pipeline) | [architecture/COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md#adding-type-inference-for-new-constructs)
- **Code generation**: [architecture/COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md#testing-compilation-stages)
- **AST design**: [architecture/COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md#3-ast-structure-quirk-list-wrapped-declarations)

### Implementation & Development
- **Adding type kinds**: [development/IMPLEMENTATION_GUIDE.md](development/IMPLEMENTATION_GUIDE.md#pattern-adding-a-new-type-kind)
- **Adding syntax transformations**: [development/IMPLEMENTATION_GUIDE.md](development/IMPLEMENTATION_GUIDE.md#pattern-adding-transformations-in-desugaring)
- **Adding runtime helpers**: [development/IMPLEMENTATION_GUIDE.md](development/IMPLEMENTATION_GUIDE.md#pattern-adding-runtime-helpers)
- **Type aliases & structs**: [compiler/DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md](compiler/DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md)
- **User-defined modifiers**: [compiler/DEFMODIFIER_IMPLEMENTATION.md](compiler/DEFMODIFIER_IMPLEMENTATION.md)

### Development Workflow
- **Testing stages**: [architecture/COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md#testing-compilation-stages)
- **Grammar updates**: [architecture/COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md#grammar-updates)
- **Running tests**: [development/TEST_CONSOLIDATION.md](development/TEST_CONSOLIDATION.md)
- **REPL usage**: [development/REPL_GUIDE.md](development/REPL_GUIDE.md)
- **Debugging**: [architecture/COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md#debugging-tips) | [development/IMPLEMENTATION_GUIDE.md](development/IMPLEMENTATION_GUIDE.md#debugging-tools)

### Project Status
- **What's done**: [development/TODO.md](development/TODO.md) (✅ sections)
- **Current work**: [development/TODO.md](development/TODO.md#-priority-4-oopinheritance-class-improvements)
- **Future work**: [planning/ROADMAP.md](planning/ROADMAP.md)
- **Timeline**: [history/CHANGELOG.md](history/CHANGELOG.md)
- **Recent fixes**: [development/BUG_FIXES_SUMMARY.md](development/BUG_FIXES_SUMMARY.md)

---

## 📖 How to Use This Documentation

**First time here?**
→ Start with [QUICK_START.md](QUICK_START.md) (5 minutes) then read [language/SYNTAX.md](language/SYNTAX.md)

**Want to contribute?**
→ Read [architecture/COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md) then [development/IMPLEMENTATION_GUIDE.md](development/IMPLEMENTATION_GUIDE.md)

**Looking for something specific?**
→ Use [SIDEBAR.md](SIDEBAR.md) for organized topic navigation

**Need function docs?**
→ Check [API_REFERENCE.md](API_REFERENCE.md) for all built-in functions and types

**Debugging a problem?**
→ See [architecture/COMPILER_ARCHITECTURE.md#critical-context--gotchas](architecture/COMPILER_ARCHITECTURE.md#critical-context--gotchas)

**Want to see what's next?**
→ Read [planning/ROADMAP.md](planning/ROADMAP.md) for future directions

---

## 📋 Documentation Status

**Last Updated**: January 16, 2026

**Coverage**:
- ✅ Language syntax (complete)
- ✅ Compiler architecture (6-stage pipeline documented)
- ✅ Type system (inference & checking)
- ✅ OOP & inheritance
- ✅ Module system
- ✅ REPL & tooling
- ✅ Type aliases & structs
- ✅ User-defined modifiers
- ⚠️ Standard library (in progress)
- ⚠️ LLVM backend (planned)

**Test Status**: 36/39 passing (92%) - See [development/BUG_FIXES_SUMMARY.md](development/BUG_FIXES_SUMMARY.md)

---

## 🔗 Related Resources

### Source Code Navigation
- Core compiler: [src/compiler/](../../src/compiler/)
- Grammar definition: [src/compiler/frontend/grammar/l-lang.pegjs](../../src/compiler/frontend/grammar/l-lang.pegjs)
- Test suite: [src/test/](../../src/test/)

### Examples
- Basic syntax: [examples/01-basics/](../../examples/01-basics/)
- Type system: [examples/04-data-types/](../../examples/04-data-types/)
- Classes & OOP: [examples/05-oop/](../../examples/05-oop/)
- Complex algorithms: [examples/10-algorithms/](../../examples/10-algorithms/)
- User-defined modifiers: [examples/06-modifiers/](../../examples/06-modifiers/)

### Project Files
- [README.md](../../README.md) - Main project README
- [LICENSE](../../LICENSE) - MIT License
- [test_all.sh](../../test_all.sh) - Test runner script

---

**Navigation**: [QUICK_START](QUICK_START.md) | [SIDEBAR](SIDEBAR.md) | [API Reference](API_REFERENCE.md)
