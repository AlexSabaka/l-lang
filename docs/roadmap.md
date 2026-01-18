# 🗺️ Roadmap & Status

> "We get there when we get there, but we do it right."

This document outlines the high-level milestones for the `l-lang` compiler, merging strategic goals with tactical implementation tasks.

**Status Legend:**
*   ✅ Complete
*   🚧 In Progress
*   🔮 Future Thinking

---

## ✅ Phase 1: Stabilization & Architecture Fixes (v0.2.0)
**Theme:** "Stop the bleeding."
**Status:** COMPLETE ✨

Focused on technical debt, specifically in code generation and symbol resolution. No new language features added—only foundational improvements.

### Objectives
*   **AST Codegen:** Replace string-concatenation codegen with structured ESTree AST generation via `astring`.
*   **Two-Pass Symbol Resolution:** Implement proper lexical scoping, forward references, and O(1) symbol lookup.
*   **Module System Fixes:** Fix circular dependency handling and implement flat caching (`ModuleCache`).

### Completed Types
- [x] **Codegen Refactor**
    - [x] Install `estree` and `astring` deps
    - [x] Create `JSTransformerAstVisitor` returning ESTree Nodes
    - [x] Port all basic nodes (Literals, Identifiers) and Control Flow
    - [x] Switch compiler pipeline to use `astring`
- [x] **Symbol Table Refactor**
    - [x] Split `BuildSymbolTableAstVisitor` into `ScanPass` and `ResolvePass`
    - [x] Optimize `SymbolTable` performance with caching
- [x] **Dependency Management**
    - [x] Refactor `DependencyGraph` to use `ModuleCache`
    - [x] Ensure `SymbolTable.join` handles re-exports correctly

---

## ✅ Phase 2: Syntax Harmonization & Standard Lib (v0.3.0)
**Theme:** "Make it feel like Lisp, work like C#."
**Status:** COMPLETE ✨

Refining the grammar and implementing critical OOP features needed for real-world usage.

### Objectives
*   **Homoiconic Attributes:** Refactor decorators to be part of S-expressions (`:attributes [...]`).
*   **Clean Parsing:** Remove legacy PEG.js extensions and consolidate grammar.
*   **Runtime Shim:** Implement lightweight runtime helpers for pattern matching and type checks.
*   **OOP & Inheritance:** Full class inheritance, `super()` calls, and parameter shadowing.
*   **Type Inference:** Fix scope isolation bugs and support Map/Indexer types.
*   **Generics & Interfaces:** Full generic class/interface support with RTTI.

### Completed Tasks
- [x] **Grammar & Syntax Polish**
    - [x] Refactor attributes syntax
    - [x] Remove `js'()` raw injection (kill escape hatch)
    - [x] Clean up legacy code (`JSCompilerAstVisitor`, older visitors)
- [x] **OOP & Inheritance**
    - [x] Implement proper class inheritance with parent symbol resolution
    - [x] Implicit return in functions
    - [x] Interface implementation checks
    - [x] Generic classes and interfaces
    - [x] Runtime Type Information (RTTI)
- [x] **Type System Fixes**
    - [x] Fix parameter binding scope isolation (Critical)
    - [x] Implement Map and Indexer type inference
- [x] **Operator Overloading**
    - [x] Operator registry for standalone overloads
    - [x] Dynamic dispatch helpers
- [x] **DefModifiers (Metaprogramming)**
    - [x] Symbol table support for `modifier-def`
    - [x] Codegen for higher-order transformer functions

---

## ✅ Phase 2.5: Compiler Architecture Refactor (v0.3.5)
**Theme:** "Separate concerns, simplify generation."
**Status:** COMPLETE ✨

Moving from "analysis + codegen" to "analysis + desugaring + codegen".

### Objectives
*   **Desugaring Pass:** Separate transformation logic (pipelines, implicit returns) from usage.
*   **Phase-based Directory Structure:** Reorganize `src/compiler` by phase (`frontend`, `analysis`, `transformation`, `codegen`).
*   **Runtime Helpers:** Extract pattern matching and type checking logic to helpers.

### Completed Tasks
- [x] **Directory Restructuring**
    - [x] Create subdirectories: `frontend`, `analysis`, `transformation`, `codegen`, `types`, `helpers`
- [x] **DesugarAstVisitor**
    - [x] Move pipeline (`|>`) transformation logic
    - [x] Move implicit return logic
- [x] **Runtime Integration**
    - [x] Create `runtime/match.ts` and `runtime/types.ts`
    - [x] Implement Shim prepending
- [x] **ClassBuilder Standardization**
    - [x] Extract `ClassBuilder` to generate ESTree nodes

---

## 🚧 Phase 3: Tooling & DX
**Theme:** "Making it nice to use."

*   [ ] **Compiler Rules/Linting**
    - [ ] `CycleDetection`: Error on inheritance cycles
    - [ ] `UnusedVariable`: Warning via usage counts
*   [ ] **Testing Infrastructure**
    - [ ] Snapshot testing harness

## 🔮 Phase 4: Advanced Type System (v0.4.0)
**Theme:** "Type Safety First."

*   [ ] **Generic Type Inference**
    - [ ] Infer generic args from call sites
*   [ ] **Generic Constraints**
    - [ ] `:where T :extends Base`
*   [ ] **Variance Checking**
    - [ ] Covariance/Contravariance validation (`:out`, `:in`)
*   [ ] **Static Class Members**
    - [ ] Static methods and properties
*   [ ] **Abstract Classes**

## 🧠 Phase 5: The Brain Transplant (v0.5.0)
**Theme:** "Prepare for the metal."
Moving towards Intermediate Representation (IR).

*   [ ] **HIR (High-Level IR):** Define typed, desugared tree.
*   [ ] **Lowering:** Implement AST -> HIR pass.
*   [ ] **IR Codegen:** Refactor JS codegen to consume HIR.

## 🚀 Phase 6: The Speed of Light (v1.0.0)
**Theme:** "The Sloth becomes a Cheetah."
Targeting native binaries via LLVM.

*   [ ] **LLVM IR Codegen visitor**
*   [ ] **Strict Memory Layout**
*   [ ] **Native Standard Library**
