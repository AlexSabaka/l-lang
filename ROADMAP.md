# 🦥 l-lang Roadmap: The Enterprise Sloth Vision

> "We get there when we get there, but we do it right."

This document outlines the high-level milestones for the `l-lang` compiler. The goal is to transition from a "Proof of Concept" transpiler to a robust, type-safe compiler with a proper Intermediate Representation (IR) capable of targeting LLVM.

## ✅ Phase 1: Stabilization & Architecture Fixes (v0.2.0)
**Theme:** "Stop the bleeding."
**STATUS: COMPLETE** ✨

Focused on technical debt, specifically in code generation and symbol resolution. No new language features added—only foundational improvements.

*   **Objective A:** Replace string-concatenation codegen with structured AST generation (ESTree). ✅
    - Replaced `JSCompilerAstVisitor` string concatenation with `JSTransformerAstVisitor` using ESTree nodes
    - Integrated `astring` for clean ES5+ code generation
    - Fixed: formatted strings, function scoping, expression context, compound assignments
    - All examples now generate proper JavaScript AST instead of string concatenation
    
*   **Objective B:** Implement proper lexical scoping and forward references (Two-Pass Compilation). ✅
    - Refactored `BuildSymbolTableAstVisitor` into `ScanPass` and `ResolvePass`
    - Implemented O(1) symbol lookup with lazy cache rebuild in `SymbolTable.resolveSymbol()`
    - Forward references now work correctly; functions can be called before definition
    
*   **Objective C:** Fix circular dependency handling in the module system. ✅
    - Created `ModuleCache` in `Context` for flat, single-pass module processing
    - Refactored `DependencyGraph` from tree-based to cache-based architecture
    - Prevents duplicate module loading with Map<AbsolutePath, ImportUnit>
    - Implemented `InlineImportsAstVisitor` for proper symbol inlining
    - Path resolution fixed (removed double-concatenation bug)
    - All imported symbols now inline correctly in compiled output

## 🎨 Phase 2: Syntax Harmonization & Standard Lib (v0.3.0)
**Theme:** "Make it feel like Lisp, work like C#."
**STATUS: IN PROGRESS** 🚧

Refining the grammar and implementing critical OOP features needed for real-world usage.

*   **Objective A:** Refactor Attributes/Decorators to be homoiconic (inside the S-expression). ✅
    - Grammar updated to support `:attributes` style syntax
    - JSTransformerAstVisitor updated to handle new node structure
    - Full consistency achieved
    
*   **Objective B:** Implement proper OOP with Class Inheritance. ✅ (NEW - Priority 4)
    - Parent class resolution via symbol table lookup
    - Constructor parameter passing with `super(args)`
    - Parameter shadowing support (local vs inherited)
    - Implicit return statements in functions
    - All legacy code cleaned up (removed string-based compiler)
    
*   **Objective C:** Clean up the PEG.js grammar for performance. 🚧
    - Removed legacy extension files (`infix.pegjs`, `js.pegjs`)
    - Grammar consolidated in `l-lang.pegjs`
    - Reorganized examples into semantic folders
    
*   **Objective D:** Implement a lightweight Runtime Shim (Pattern matching logic, Type checks) to keep generated code clean. ⏳

## 🏗️ Phase 2.5: Compiler Architecture Refactor (v0.3.5)
**Theme:** "Separate concerns, simplify generation."
**STATUS: COMPLETE** ✅

Moving from "analysis + codegen" to "analysis + desugaring + codegen". This makes the codebase more modular and prepares us for IR-based compilation.

*   **Objective A:** Introduce Desugaring Pass. ✅
    - Separated transformation logic (pipelines, implicit returns, list unrolling) into `DesugarAstVisitor`.
    - AST is normalized before JS generation.
    - Benefit: `JSTransformer` is now pure codegen, easier to retarget (LLVM, Wasm, etc.).
    
*   **Objective B:** Reorganize `src/compiler` by phase. ✅
    - Grouped files into `frontend/`, `analysis/`, `transformation/`, `codegen/`, `helpers/`.
    - Clear phase-based architecture; each phase has single responsibility.
    
*   **Objective C:** Extract Runtime Helpers. ✅
    - Moved pattern matching logic to `helpers/runtime/match.ts`.
    - Centralized type checking in `helpers/runtime/types.ts`.
    - Runtime shim generated at compile-time; prepends to output.
    - Benefit: Generated code is cleaner; complex patterns don't bloat output.
    
*   **Objective D:** Standardize `ClassBuilder`. ✅
    - Extracted from `JSTransformer` into separate module.
    - Returns ESTree nodes; removed direct string codegen.
    - Unit tests added for inheritance edge cases.

## 🧠 Phase 3: The Brain Transplant (v0.4.0)
**Theme:** "Prepare for the metal."
Moving away from direct AST-to-JS compilation towards a distinct Intermediate Representation (IR). This is the pre-requisite for LLVM.

*   **Objective A:** Define `High-Level IR` (HIR) - A typed, desugared tree.
*   **Objective B:** Implement `Lowering` pass (AST -> HIR).
*   **Objective C:** Refactor JS Codegen to consume HIR instead of AST (replacing desugaring pass).

## 🚀 Phase 4: The Speed of Light (v1.0.0)
**Theme:** "The Sloth becomes a Cheetah."
Targeting native binaries via LLVM.

*   **Objective A:** Implement LLVM IR Codegen visitor.
*   **Objective B:** Introduce strict memory layout for Structs/Classes.
*   **Objective C:** Native standard library implementation.

---
**Status Legend:**
*   🚧 In Progress
*   ✅ Complete
*   🔮 Future Thinking