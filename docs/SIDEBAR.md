# 📖 Navigation Sidebar

Quick access to all documentation sections for easy web-based navigation.

## 🎯 Start Here

- **[INDEX.md](INDEX.md)** - Documentation hub & quick start by role
- **[QUICK_START.md](QUICK_START.md)** - Get up and running in 5 minutes

---

## 📘 Language & Syntax

### Learn the Language
- **[language/SYNTAX.md](language/SYNTAX.md)** - Complete language reference (664 lines)
  - Comments & literals
  - Variables & types
  - Functions & pipelines
  - Pattern matching
  - OOP (classes, structs, interfaces)
  - Metaprogramming (comptime, defmacro, defsyntax)
  - Type system details
  - Modules & imports

### Examples
- **[examples/01-basics/](../examples/01-basics/)** - Variable assignment, functions, basics
- **[examples/04-data-types/](../examples/04-data-types/)** - Type system, enums, unions
- **[examples/05-oop/](../examples/05-oop/)** - Classes, inheritance, methods
- **[examples/10-algorithms/](../examples/10-algorithms/)** - Complex real-world examples

---

## 🔧 Compiler Architecture

### Core Architecture
- **[architecture/COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md)** - 6-stage pipeline (346 lines)
  - Parse → Syntax → Symbols → Desugar → Types → Codegen
  - Visitor pattern & AST traversal
  - Symbol table with integrated types
  - Type inference pipeline
  - Module caching

### Type System
- **[compiler/TYPE_SYSTEM.md](compiler/TYPE_SYSTEM.md)** - Type inference & checking (260 lines)
  - InferredType interface & kinds
  - TypeEnvironment (scope management)
  - TypeChecker (compatibility rules)
  - Special cases (recursive, structs, unions)
  - Adding new type kinds

### Implementation Details
- **[compiler/DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md](compiler/DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md)** - Type aliases & structs (262 lines)
- **[compiler/DEFMODIFIER_IMPLEMENTATION.md](compiler/DEFMODIFIER_IMPLEMENTATION.md)** - User-defined modifiers (302 lines)

---

## 🛠️ Development & Contributing

### Getting Started
- **[development/IMPLEMENTATION_GUIDE.md](development/IMPLEMENTATION_GUIDE.md)** - How to add features (316 lines)
  - Pattern: adding new type kinds
  - Pattern: adding transformations
  - Pattern: adding runtime helpers
  - Debugging tools & techniques
  - Common implementation tasks

### Testing & Validation
- **[development/TEST_CONSOLIDATION.md](development/TEST_CONSOLIDATION.md)** - Test infrastructure (219 lines)
- **[development/BUG_FIXES_SUMMARY.md](development/BUG_FIXES_SUMMARY.md)** - Recent fixes (317 lines)
  - Critical codegen fixes
  - String interpolation fix
  - Zero-arg function calls
  - Test results: 36/39 passing

### REPL (Interactive Shell)
- **[development/REPL_GUIDE.md](development/REPL_GUIDE.md)** - Interactive REPL features (342 lines)
  - Syntax highlighting
  - Tab-completion (keywords, symbols, members)
  - Commands: `.help`, `.symbols`, `.types`, `.reset`
  - Keyboard shortcuts
  - Troubleshooting

### Tasks & Progress
- **[development/TODO.md](development/TODO.md)** - Implementation checklist (227 lines)
  - Completed: Parse, symbols, OOP, inheritance
  - In progress: Architecture improvements
  - Next: Native compilation (LLVM)

---

## 📊 Project Status & Planning

### Roadmap
- **[planning/ROADMAP.md](planning/ROADMAP.md)** - Product roadmap (119 lines)
  - Phase 1: Stabilization ✅
  - Phase 2: OOP & syntax ✅
  - Phase 2.5: Architecture refactor ✅
  - Phase 3: High-level IR (future)
  - Phase 4: LLVM native compilation (future)

### Changelog
- **[history/CHANGELOG.md](history/CHANGELOG.md)** - Timeline of changes (290 lines)
  - Type system extensions (Jan 2026)
  - Architecture refactor (Jan 2026)
  - OOP implementation (Nov 2025)
  - Module system (Oct 2025)
  - ESTree codegen (Sep 2025)

---

## 🔗 Source Code References

### Core Compiler Files
- `src/compiler/Context.ts` - Compilation orchestrator (230 lines)
- `src/compiler/analysis/SymbolTable.ts` - Symbol storage & resolution (405 lines)
- `src/compiler/types/TypeChecker.ts` - Type compatibility checking (337 lines)
- `src/compiler/types/visitors/InferTypesAstVisitor.ts` - Type inference (2-pass)
- `src/compiler/analysis/visitors/BuildSymbolTableAstVisitor.ts` - Symbol collection (2-pass)
- `src/compiler/frontend/grammar/l-lang.pegjs` - PEG.js grammar
- `src/compiler/frontend/ast.ts` - AST node definitions (~800 lines)

### Code Generation
- `src/compiler/codegen/js-estree/` - ESTree → JavaScript
- `src/compiler/codegen/js-legacy/` - String-based codegen (deprecated)

### Analysis & Transformation
- `src/compiler/transformation/visitors/DesugarAstVisitor.ts` - Syntax normalization
- `src/compiler/helpers/runtime/` - Runtime support functions

---

## 💡 Quick Lookup by Topic

### Syntax Questions
- Variables: [SYNTAX.md#2-variables--state](language/SYNTAX.md#2-variables--state)
- Functions: [SYNTAX.md#4-functions--pipelines](language/SYNTAX.md#4-functions--pipelines)
- Pattern matching: [SYNTAX.md#6-pattern-matching](language/SYNTAX.md#6-pattern-matching)
- OOP: [SYNTAX.md#7-object-oriented-programming](language/SYNTAX.md#7-object-oriented-programming)
- Metaprogramming: [SYNTAX.md#8-metaprogramming-the-three-tiers](language/SYNTAX.md#8-metaprogramming-the-three-tiers)

### Architecture Questions
- Pipeline stages: [COMPILER_ARCHITECTURE.md#architecture-overview](architecture/COMPILER_ARCHITECTURE.md#architecture-overview)
- Symbol resolution: [COMPILER_ARCHITECTURE.md#4-symboltable-structure-with-integrated-types](architecture/COMPILER_ARCHITECTURE.md#4-symboltable-structure-with-integrated-types)
- Type inference: [TYPE_SYSTEM.md#type-inference-pipeline](compiler/TYPE_SYSTEM.md#type-inference-pipeline)
- Code generation: [COMPILER_ARCHITECTURE.md#testing-compilation-stages](architecture/COMPILER_ARCHITECTURE.md#testing-compilation-stages)

### Implementation Help
- Adding types: [IMPLEMENTATION_GUIDE.md#pattern-adding-a-new-type-kind](development/IMPLEMENTATION_GUIDE.md#pattern-adding-a-new-type-kind)
- Adding transformations: [IMPLEMENTATION_GUIDE.md#pattern-adding-transformations-in-desugaring](development/IMPLEMENTATION_GUIDE.md#pattern-adding-transformations-in-desugaring)
- Runtime helpers: [IMPLEMENTATION_GUIDE.md#pattern-adding-runtime-helpers](development/IMPLEMENTATION_GUIDE.md#pattern-adding-runtime-helpers)
- Debugging: [COMPILER_ARCHITECTURE.md#debugging-tips](architecture/COMPILER_ARCHITECTURE.md#debugging-tips)

### Troubleshooting
- Types not appearing: [COMPILER_ARCHITECTURE.md#type-binding-not-appearing-in-output](architecture/COMPILER_ARCHITECTURE.md#type-binding-not-appearing-in-output)
- Symbol duplication: [COMPILER_ARCHITECTURE.md#module-caching--symbol-merging](architecture/COMPILER_ARCHITECTURE.md#module-caching--symbol-merging)
- Desugaring issues: [COMPILER_ARCHITECTURE.md#desugaring-must-run-before-codegen](architecture/COMPILER_ARCHITECTURE.md#desugaring-must-run-before-codegen)

---

## 📱 Mobile-Friendly Formats

All markdown files are optimized for reading on:
- ✅ Desktop browsers
- ✅ Tablets (GitHub web, GitLab, etc.)
- ✅ Mobile phones (GitHub mobile, GitLab mobile)
- ✅ Text editors (VS Code, Vim, etc.)
- ✅ Terminal/console viewers (lynx, w3m, etc.)

---

**Last Updated**: January 16, 2026
