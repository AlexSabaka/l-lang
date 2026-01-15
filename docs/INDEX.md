# 📚 l-lang Documentation Index

Welcome to the l-lang compiler documentation. This directory contains complete information about the l-lang language, compiler architecture, and development guides.

## 🗺️ Documentation Organization

### [language/](language/)
**Language Reference & Syntax**

- [SYNTAX.md](language/SYNTAX.md) - Complete language reference
  - Basics, comments, literals
  - Variables, state, type annotations
  - Data structures (vectors, maps, matrices)
  - Functions, pipelines, async/await
  - Flow control (if/else, loops, pattern matching)
  - OOP (classes, structs, interfaces, enums)
  - Metaprogramming (comptime, defmacro, defsyntax)
  - Type system (structural typing, generics, unions, guards)
  - Modules & imports
  - Runtime type information (RTTI)
  - Memory management
  - Naming conventions

### [compiler/](compiler/)
**Compiler Design & Implementation Details**

- [COMPILER_ARCHITECTURE.md](../architecture/COMPILER_ARCHITECTURE.md) - Core architecture guide
  - 6-stage compilation pipeline
  - Directory structure
  - Visitor pattern & controlled traversal
  - Two-pass analysis pattern
  - AST structure quirks
  - Symbol table integration
  - Development workflows
  - Testing & validation
  - Build & deployment
  - Debugging tips

- [TYPE_SYSTEM.md](compiler/TYPE_SYSTEM.md) - Type system architecture
  - InferredType interface
  - TypeEnvironment (scope management)
  - TypeChecker (compatibility rules)
  - Type inference pipeline
  - Special type cases (recursive, structs, unions)
  - JSON representation
  - Common issues & solutions
  - Adding new type kinds

- [DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md](compiler/DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md) - Type alias & struct implementation
  - Complete implementation summary
  - Symbol collection
  - Type inference (2-pass)
  - Type compatibility
  - Test results & examples
  - Architecture improvements

### [architecture/](architecture/)
**Detailed Architectural Guides**

- [COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md)
  - Full compilation pipeline (6 stages)
  - Phase-based directory structure
  - Key architectural patterns
  - Critical gotchas & edge cases
  - Development workflows

### [development/](development/)
**Development & Implementation Guides**

- [BUG_FIXES_SUMMARY.md](development/BUG_FIXES_SUMMARY.md) - Recent bug fixes (Jan 2026)
  - Critical codegen fixes (string interpolation, `new` keyword)
  - Zero-arg function calls fix
  - Method vs property disambiguation
  - Test results: 27/27 passing (100%)
  - Known limitations & future work
  - Architecture improvements

- [TODO.md](development/TODO.md) - Implementation task list (ordered by priority)
  - Priority 0: ESTree code generation ✅
  - Priority 1: Two-pass symbol table ✅
  - Priority 2: Module dependency caching ✅
  - Priority 3: Grammar & syntax polish ✅
  - Priority 4: OOP & inheritance ✅
  - Priority 4.5: Type inference fixes ✅
  - Priority 5: Architecture refactor ✅
  - Priority 6: Tooling & developer experience

- [IMPLEMENTATION_GUIDE.md](development/IMPLEMENTATION_GUIDE.md) - How to implement new features
  - Adding new type kinds (step-by-step)
  - Adding AST transformations
  - Adding runtime helpers
  - Understanding compilation artifacts (.parsed.json, .symbols.json, .types.json, .js)
  - Debugging tools
  - Common implementation tasks

### [planning/](planning/)
**Roadmap & Future Planning**

- [ROADMAP.md](planning/ROADMAP.md) - Product roadmap
  - Phase 1: Stabilization & architecture fixes ✅
  - Phase 2: Syntax harmonization & OOP ✅
  - Phase 2.5: Architecture refactor ✅
  - Phase 3: High-Level IR (future)
  - Phase 4: Native compilation via LLVM (future)

### [history/](history/)
**Changelog & Implementation History**

- [CHANGELOG.md](history/CHANGELOG.md) - Timeline of major changes
  - Type system extensions (Jan 2026)
  - Architecture refactor (Jan 2026)
  - Type inference fixes (Dec 2025)
  - OOP implementation (Nov 2025)
  - Module system fixes (Oct 2025)
  - ESTree codegen (Sep 2025)
  - Previous milestones
  - Known issues
  - Compiler statistics

---

## 🎯 Quick Start by Role

### For Language Users
1. Start with [language/SYNTAX.md](language/SYNTAX.md) - Learn l-lang syntax and features
2. Check examples in `examples/` directory
3. Review [ROADMAP.md](planning/ROADMAP.md) to see what's coming

### For Compiler Contributors
1. Read [COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md) - Understand the architecture
2. Follow [IMPLEMENTATION_GUIDE.md](development/IMPLEMENTATION_GUIDE.md) - Learn how to add features
3. Reference [TYPE_SYSTEM.md](compiler/TYPE_SYSTEM.md) - Understand type handling
4. Check [TODO.md](development/TODO.md) - Find tasks to work on

### For Debuggers
1. Review [COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md#critical-context--gotchas) - Common gotchas
2. Learn [IMPLEMENTATION_GUIDE.md](development/IMPLEMENTATION_GUIDE.md#debugging-tools) - Debugging techniques
3. Inspect `.json` artifacts at each compilation stage

### For Adding Language Features
1. Read [IMPLEMENTATION_GUIDE.md](development/IMPLEMENTATION_GUIDE.md) - Pattern for adding features
2. Study existing implementations like [DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md](compiler/DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md)
3. Reference [TYPE_SYSTEM.md](compiler/TYPE_SYSTEM.md) if adding types
4. Check [CHANGELOG.md](history/CHANGELOG.md) for recent patterns

---

## 🔍 Finding Information by Topic

### Syntax & Language Features
- Variables & types: [SYNTAX.md](language/SYNTAX.md#2-variables--state)
- Functions & pipelines: [SYNTAX.md](language/SYNTAX.md#4-functions--pipelines)
- Pattern matching: [SYNTAX.md](language/SYNTAX.md#6-pattern-matching)
- OOP: [SYNTAX.md](language/SYNTAX.md#7-object-oriented-programming)
- Metaprogramming: [SYNTAX.md](language/SYNTAX.md#8-metaprogramming-the-three-tiers)

### Compiler Architecture
- 6-stage pipeline: [COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md#architecture-overview)
- Symbol table: [COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md#4-symboltable-structure-with-integrated-types)
- Type inference: [TYPE_SYSTEM.md](compiler/TYPE_SYSTEM.md#type-inference-pipeline)
- Code generation: [COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md#testing-compilation-stages)

### Implementation Details
- Adding type kinds: [IMPLEMENTATION_GUIDE.md](development/IMPLEMENTATION_GUIDE.md#pattern-adding-a-new-type-kind)
- Adding transformations: [IMPLEMENTATION_GUIDE.md](development/IMPLEMENTATION_GUIDE.md#pattern-adding-transformations-in-desugaring)
- Adding runtime helpers: [IMPLEMENTATION_GUIDE.md](development/IMPLEMENTATION_GUIDE.md#pattern-adding-runtime-helpers)
- Type-alias implementation: [DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md](compiler/DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md)

### Development Workflow
- Test compilation stages: [COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md#testing-compilation-stages)
- Grammar updates: [COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md#grammar-updates)
- Type inference: [COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md#adding-type-inference-for-new-constructs)
- Debugging: [COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md#debugging-tips)

### Project Status
- Completed work: [TODO.md](development/TODO.md) (✅ sections)
- Current work: [TODO.md](development/TODO.md#-priority-4-oopinheritance-class-improvements)
- Future work: [ROADMAP.md](planning/ROADMAP.md)
- Timeline: [CHANGELOG.md](history/CHANGELOG.md)

---

## 📞 Related Resources

### Source Code
- [src/compiler/frontend/grammar/l-lang.pegjs](../../src/compiler/frontend/grammar/l-lang.pegjs) - PEG.js grammar
- [src/compiler/frontend/ast.ts](../../src/compiler/frontend/ast.ts) - AST node definitions
- [src/compiler/analysis/SymbolTable.ts](../../src/compiler/analysis/SymbolTable.ts) - Symbol table
- [src/compiler/types/visitors/InferTypesAstVisitor.ts](../../src/compiler/types/visitors/InferTypesAstVisitor.ts) - Type inference
- [src/compiler/types/TypeChecker.ts](../../src/compiler/types/TypeChecker.ts) - Type rules
- [src/compiler/Context.ts](../../src/compiler/Context.ts) - Compilation orchestrator

### Examples
- [examples/01-basics/](../../examples/01-basics/) - Basic syntax
- [examples/04-data-types/](../../examples/04-data-types/) - Type system
- [examples/05-oop/](../../examples/05-oop/) - Classes & inheritance
- [examples/10-algorithms/](../../examples/10-algorithms/) - Complex examples

### Root Files
- [README.md](../../README.md) - Project overview
- [LICENSE](../../LICENSE) - MIT License

---

## 📖 How to Use This Documentation

1. **First Time**: Start with [language/SYNTAX.md](language/SYNTAX.md) to learn l-lang
2. **Contributing**: Read [COMPILER_ARCHITECTURE.md](architecture/COMPILER_ARCHITECTURE.md) and [IMPLEMENTATION_GUIDE.md](development/IMPLEMENTATION_GUIDE.md)
3. **Debugging Issues**: Check [COMPILER_ARCHITECTURE.md#critical-context--gotchas](architecture/COMPILER_ARCHITECTURE.md#critical-context--gotchas)
4. **Adding Features**: Follow patterns in [DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md](compiler/DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md)
5. **Project Status**: Check [TODO.md](development/TODO.md) and [CHANGELOG.md](history/CHANGELOG.md)

---

## 📋 Documentation Status

**Last Updated**: January 15, 2026

All documentation is current and reflects Phase 3.5 of the compiler (architecture refactor complete, type system extended with user-defined types).

---

**Navigation**: [Parent Directory](../../) | [Root README](../../README.md)
