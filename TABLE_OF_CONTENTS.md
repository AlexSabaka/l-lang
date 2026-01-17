# 📑 Complete Table of Contents

Comprehensive index of all l-lang documentation organized by section.

---

## 🚀 Getting Started (New Users)

1. **[docs/QUICK_START.md](docs/QUICK_START.md)** - Installation & first program (5 min)
   - Installation steps
   - Your first program
   - Interactive REPL
   - Common commands
   - File structure overview

2. **[docs/API_REFERENCE.md](docs/API_REFERENCE.md)** - Built-in functions & standard library
   - Arithmetic & math
   - String operations
   - Collections (arrays, maps)
   - Type operations
   - I/O & output
   - Control flow
   - Type system
   - OOP & classes
   - Metaprogramming
   - Module system
   - Error handling

3. **[README.md](README.md)** - Project overview
   - What is l-lang?
   - Feature highlights
   - Installation & usage
   - Test status
   - Contributing guidelines

---

## 📚 Language Reference

### Core Language

**[docs/language/SYNTAX.md](docs/language/SYNTAX.md)** (664 lines) - Complete language syntax
- 1. Comments & Literals
  - Single-line comments, multi-line comments
  - Numbers (integers, floats)
  - Strings, keywords, symbols, booleans
  - nil/empty values

- 2. Variables & State
  - `let` (immutable)
  - `mut` (mutable)
  - `var` (local scope)
  - Type annotations
  - Scope rules

- 3. Data Structures
  - Vectors/Arrays
  - Maps/Dictionaries
  - Matrices (2D arrays)
  - Tuples
  - Sets

- 4. Functions & Pipelines
  - Function definition: `fn`, `defn`
  - Parameters & return types
  - Arrow functions
  - Pipeline operator `|>`
  - Implicit returns
  - Arity overloading

- 5. Control Flow
  - `if`/`else` conditionals
  - `when` (no else)
  - `cond` (multiple branches)
  - `match` pattern matching
  - `for` loops
  - `while` loops
  - `doseq` iteration
  - `do` blocks

- 6. Pattern Matching
  - Literals matching
  - Destructuring
  - Vector patterns
  - Map patterns
  - Guard clauses
  - Wildcard `_`

- 7. Object-Oriented Programming
  - Class definition: `defclass`
  - Constructors (`:ctor`)
  - Instance variables
  - Methods
  - Inheritance (`:inherits`)
  - Super calls
  - Visibility modifiers (`:public`, `:internal`)
  - Structs (`defstruct`)
  - Interfaces
  - Enums (union types)

- 8. Metaprogramming: The Three Tiers
  - `comptime` (compile-time evaluation)
  - `defmacro` (syntax rewrites)
  - `defsyntax` (DSL building)
  - Quote/unquote
  - Gensym

- 9. Type System
  - Type annotations
  - Primitive types (Int, Float, String, Bool)
  - Collection types (Array, Map)
  - Union types (A | B)
  - Type aliases (`deftype`)
  - Generics
  - Structural typing
  - Type guards

- 10. Modules & Imports
  - Module definition
  - `import` statements
  - `export` statements
  - Namespacing
  - Circular dependency handling

- 11. Runtime Type Information (RTTI)
  - `typeof` operator
  - `type-name` function
  - Type predicates
  - Reflection

- 12. Error Handling
  - `try`/`catch`/`finally`
  - Custom error types
  - `throw` statement
  - Error propagation

- 13. Async & Promises
  - `async` functions
  - `await` expressions
  - Promise handling
  - Concurrent operations

- 14. Naming Conventions
  - Variables: `snake_case`
  - Functions: `kebab-case`
  - Classes: `PascalCase`
  - Constants: `UPPER_SNAKE_CASE`

---

## 🏗️ Compiler Architecture

### Core Concepts

**[docs/architecture/COMPILER_ARCHITECTURE.md](docs/architecture/COMPILER_ARCHITECTURE.md)** (346 lines) - Complete 6-stage pipeline
- Architecture Overview
  - Parse → Syntax → Symbols → Desugar → Types → Codegen
  - Directory structure
  - Key files in each phase

- Key Architectural Patterns
  1. Visitor Pattern with Controlled Traversal
     - BaseAstTreeWalker behavior
     - Custom visit() override
     - When to use manual control

  2. Two-Pass Analysis Pattern
     - Symbols: ScanPass + ResolvePass
     - Type Inference: CollectTypesPass + InferAndCheckPass
     - Why two passes needed

  3. AST Structure Quirk: List-Wrapped Declarations
     - Top-level declarations wrapped in list nodes
     - Handling in visitors
     - Affected files

  4. SymbolTable Structure with Integrated Types
     - SymbolEntry interface
     - Type binding flow
     - JSON output format

- Development Workflows
  - Testing compilation stages (--stage flag)
  - Grammar updates (npm run parser)
  - Adding type inference
  - Module caching & symbol merging

- Critical Context & Gotchas
  - Type binding not appearing in output
  - Module caching & symbol merging issues
  - Desugaring before codegen requirement

- Debugging Tips
  - Debug logging (LogLevel)
  - AST inspection with jq
  - Trace visitor calls
  - Scope chain inspection

---

### Type System Deep Dive

**[docs/compiler/TYPE_SYSTEM.md](docs/compiler/TYPE_SYSTEM.md)** (260 lines) - Type inference & checking
- InferredType Interface
  - Type kinds (primitive, array, map, union, struct, etc.)
  - Generic type parameters
  - JSON representation

- TypeEnvironment
  - Scope management
  - Type binding
  - Scope chain
  - Identifier resolution

- TypeChecker
  - Type compatibility rules
  - Assignability checking
  - Type narrowing
  - Union type handling

- Type Inference Pipeline
  - Phase 1: CollectTypesPass (collect annotations)
  - Phase 2: InferAndCheckPass (infer & validate)
  - Two-pass flow diagram

- Special Type Cases
  - Recursive types
  - Structural types
  - Union type narrowing
  - Generic type parameters

- Common Issues & Solutions
  - Type not being inferred
  - Scope pollution
  - Generic parameter binding
  - Union type matching

- Adding New Type Kinds
  - Step-by-step guide
  - Modifying InferredType
  - Updating TypeChecker
  - Adding inference logic

---

### Feature Implementation Examples

**[docs/compiler/DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md](docs/compiler/DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md)** (262 lines)
- Type Aliases (`deftype`) Implementation
  - Symbol collection phase
  - Type inference phase
  - Type compatibility checking
  - Test results & examples

**[docs/compiler/DEFMODIFIER_IMPLEMENTATION.md](docs/compiler/DEFMODIFIER_IMPLEMENTATION.md)** (302 lines)
- User-Defined Modifiers (`defmodifier`) Implementation
  - Modifier definition & registration
  - Modifier application to functions
  - Modifier execution in codegen
  - Examples & test results

---

## 🛠️ Development Guides

### Implementation & Contributing

**[docs/development/IMPLEMENTATION_GUIDE.md](docs/development/IMPLEMENTATION_GUIDE.md)** (316 lines)
- How to Implement New Features
  - Pattern: Adding a new type kind
  - Pattern: Adding transformations in desugaring
  - Pattern: Adding runtime helpers
  
- Understanding Compilation Artifacts
  - `.parsed.json` (raw AST)
  - `.symbols.json` (symbol table)
  - `.types.json` (inferred types)
  - `.js` (generated JavaScript)

- Debugging Tools
  - JSON artifact inspection with jq
  - Stage-by-stage testing
  - Log level control
  - TypeScript debugging

- Common Implementation Tasks
  - Grammar changes
  - Adding visitor methods
  - Symbol resolution
  - Type inference
  - Code generation

---

### Testing & Quality

**[docs/development/TEST_CONSOLIDATION.md](docs/development/TEST_CONSOLIDATION.md)** (219 lines)
- Unified Test Runner
  - Running all tests
  - Running specific tests
  - Verbose output mode
  
- Test Infrastructure
  - Example-based testing
  - Jest unit tests
  - CI/CD integration

**[docs/development/BUG_FIXES_SUMMARY.md](docs/development/BUG_FIXES_SUMMARY.md)** (317 lines)
- Recent Fixes & Improvements (Jan 2026)
  - Critical codegen fixes
  - String interpolation fix
  - `new` keyword fix
  - Zero-arg function calls
  - Method vs property disambiguation
  - Test results: 36/39 passing
  - Known limitations
  - Architecture improvements

---

### Interactive Development

**[docs/development/REPL_GUIDE.md](docs/development/REPL_GUIDE.md)** (342 lines)
- REPL Features
  - Syntax highlighting
  - Tab-completion
  - Command history
  - Multi-line input
  - Bracket balancing
  
- Built-in Commands
  - `.help` - Show help
  - `.symbols` - List symbols
  - `.types` - Show type info
  - `.reset` - Clear context
  - `.exit` - Quit REPL

- Usage Examples
  - Basic expressions
  - Function definition
  - Symbol inspection
  - Type checking
  - Troubleshooting

---

### Project Planning & Progress

**[docs/development/TODO.md](docs/development/TODO.md)** (227 lines)
- Completed Work ✅
  - Priority 0: ESTree code generation
  - Priority 1: Two-pass symbol table
  - Priority 2: Module dependency caching
  - Priority 3: Grammar & syntax polish
  - Priority 4: OOP & inheritance
  - Priority 4.5: Type inference fixes
  - Priority 5: Architecture refactor

- In Progress
  - Architecture improvements
  - Type system enhancements
  - Standard library
  
- Next Steps
  - High-level IR
  - LLVM backend
  - Performance optimizations
  - Tooling improvements

---

## 📊 Project Status & Planning

### Roadmap & Vision

**[docs/planning/ROADMAP.md](docs/planning/ROADMAP.md)** (119 lines)
- Phase 1: Stabilization & architecture fixes ✅
  - Parse, symbols, types working
  - Basic OOP support
  
- Phase 2: Syntax harmonization & OOP ✅
  - Complete inheritance & super calls
  - Interface/struct support
  - Pattern matching
  
- Phase 2.5: Architecture refactor ✅
  - Type system refactor
  - Symbol table redesign
  - Visitor pattern improvements
  
- Phase 3: High-Level IR (Future)
  - Intermediate representation
  - Optimization passes
  - Backend agnosticity
  
- Phase 4: Native compilation via LLVM (Future)
  - LLVM codegen
  - Performance optimizations
  - Binary distribution

---

### Changelog & History

**[docs/history/CHANGELOG.md](docs/history/CHANGELOG.md)** (290 lines)
- Type System Extensions (Jan 2026)
  - User-defined types (deftype)
  - Struct support (defstruct)
  - Enhanced type inference
  
- Architecture Refactor (Jan 2026)
  - Integrated types in symbol table
  - Two-pass symbol resolution
  - Module caching
  
- Type Inference Fixes (Dec 2025)
  - Union type handling
  - Generic type parameters
  - Scope-aware inference
  
- OOP Implementation (Nov 2025)
  - Class definition & instantiation
  - Inheritance & super calls
  - Method resolution
  
- Previous Milestones
  - Module system (Oct 2025)
  - ESTree codegen (Sep 2025)
  - Pattern matching (Aug 2025)
  - Initial compiler architecture (Jul 2025)
  
- Known Issues
  - Standard library not complete
  - Some modifier edge cases
  - LLVM backend not started
  
- Compiler Statistics
  - Test coverage: 92% (36/39)
  - Architecture: 6-stage pipeline
  - Type system: Full inference
  - Platforms: JavaScript (LLVM future)

---

## 📖 Navigation Guides

### Quick Navigation

**[docs/SIDEBAR.md](docs/SIDEBAR.md)** - Complete section navigator
- Quick links to all documentation
- Organized by topic
- Quick lookup tables
- Mobile-friendly format

**[docs/INDEX.md](docs/INDEX.md)** - Documentation hub
- Start here! Pathways by role
- Quick start guides
- Complete topic index
- Related resources

---

## 📂 Source Code Structure

### Core Compiler

```
src/compiler/
├── frontend/
│   ├── grammar/l-lang.pegjs     # PEG.js grammar definition
│   ├── l-lang.js                # Generated parser
│   ├── ast.ts                   # AST node definitions (~800 lines)
│   └── AstProvider.ts           # AST caching & parsing
│
├── analysis/
│   ├── SymbolTable.ts           # Symbol storage (405 lines)
│   ├── DependencyGraph.ts       # Module dependencies
│   └── visitors/
│       ├── BuildSymbolTableAstVisitor.ts    # 2-pass symbol building
│       └── SemanticValidatorAstVisitor.ts   # Semantic validation
│
├── types/
│   ├── TypeEnvironment.ts       # Scope management
│   ├── TypeChecker.ts           # Type checking (337 lines)
│   └── visitors/
│       ├── InferTypesAstVisitor.ts          # 2-pass type inference
│       └── TypeCheckingValidatorAstVisitor.ts
│
├── transformation/
│   └── visitors/
│       └── DesugarAstVisitor.ts # Syntax normalization (pipelines, etc.)
│
├── codegen/
│   ├── js-estree/               # ESTree → JavaScript (current)
│   ├── js-legacy/               # String-based codegen (deprecated)
│   └── ClassBuilder.ts          # Class inheritance expansion
│
├── helpers/
│   ├── runtime/                 # Pattern matching, type checking
│   └── utils/                   # AST formatting, error handling
│
├── Context.ts                   # Compilation orchestrator (230 lines)
├── BaseAstVisitor.ts            # Visitor base class
├── BaseAstTreeWalker.ts         # Tree traversal base
└── index.ts                     # Compiler entry point
```

### CLI & REPL

```
src/cli/
├── repl/
│   └── PersistentREPLContext.ts # REPL state management
├── commands/
│   ├── run.ts                   # Run .lisp files
│   ├── transform.ts             # Compile to JavaScript
│   ├── repl.ts                  # Interactive shell
│   └── ...
└── index.ts                     # CLI entry point
```

### Test Suite

```
src/test/
├── e2e/                         # End-to-end tests
├── unit/                        # Unit tests
└── runner.ts                    # Test orchestration
```

---

## 🎯 Quick References

### By Task

| Task | Documentation |
|------|---------------|
| Learn l-lang | [QUICK_START.md](docs/QUICK_START.md) + [SYNTAX.md](docs/language/SYNTAX.md) |
| Add a feature | [IMPLEMENTATION_GUIDE.md](docs/development/IMPLEMENTATION_GUIDE.md) |
| Fix a bug | [ARCHITECTURE.md#gotchas](docs/architecture/COMPILER_ARCHITECTURE.md#critical-context--gotchas) |
| Add a type | [TYPE_SYSTEM.md](docs/compiler/TYPE_SYSTEM.md#adding-new-type-kinds) |
| Write tests | [TEST_CONSOLIDATION.md](docs/development/TEST_CONSOLIDATION.md) |
| Use REPL | [REPL_GUIDE.md](docs/development/REPL_GUIDE.md) |
| Find a function | [API_REFERENCE.md](docs/API_REFERENCE.md) |
| See what's done | [TODO.md](docs/development/TODO.md) |
| Plan next steps | [ROADMAP.md](docs/planning/ROADMAP.md) |

### By Role

| Role | Path |
|------|------|
| Language User | [QUICK_START.md](docs/QUICK_START.md) → [SYNTAX.md](docs/language/SYNTAX.md) → [API_REFERENCE.md](docs/API_REFERENCE.md) |
| Compiler Developer | [QUICK_START.md](docs/QUICK_START.md) → [ARCHITECTURE.md](docs/architecture/COMPILER_ARCHITECTURE.md) → [IMPLEMENTATION_GUIDE.md](docs/development/IMPLEMENTATION_GUIDE.md) |
| Type System Hacker | [TYPE_SYSTEM.md](docs/compiler/TYPE_SYSTEM.md) → [IMPLEMENTATION_GUIDE.md](docs/development/IMPLEMENTATION_GUIDE.md#pattern-adding-a-new-type-kind) |
| Debugger | [ARCHITECTURE.md#gotchas](docs/architecture/COMPILER_ARCHITECTURE.md#critical-context--gotchas) → [IMPLEMENTATION_GUIDE.md#debugging](docs/development/IMPLEMENTATION_GUIDE.md#debugging-tools) |

---

## 🔗 External Links

- **GitHub**: https://github.com/AlexSabaka/l-lang
- **Issues**: https://github.com/AlexSabaka/l-lang/issues
- **Discussions**: https://github.com/AlexSabaka/l-lang/discussions

---

**Last Updated**: January 16, 2026

**Total Documentation**: ~4000+ lines across 16+ files
**Coverage**: Language, architecture, compiler, development, planning, history
