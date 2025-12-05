# 🦥 l-lang Roadmap: The Enterprise Sloth Vision

> "We get there when we get there, but we do it right."

This document outlines the high-level milestones for the `l-lang` compiler. The goal is to transition from a "Proof of Concept" transpiler to a robust, type-safe compiler with a proper Intermediate Representation (IR) capable of targeting LLVM.

## 🏁 Phase 1: Stabilization & Architecture Fixes (v0.2.0)
**Theme:** "Stop the bleeding."
Currently, the compiler works but is brittle. This phase focuses on technical debt, specifically in code generation and symbol resolution. We are not adding new language features here.

*   **Objective A:** Replace string-concatenation codegen with structured AST generation (ESTree).
*   **Objective B:** Implement proper lexical scoping and forward references (Two-Pass Compilation).
*   **Objective C:** Fix circular dependency handling in the module system.

## 🎨 Phase 2: Syntax Harmonization & Standard Lib (v0.3.0)
**Theme:** "Make it feel like Lisp, work like C#."
Refining the grammar to be consistent and implementing the core runtime needed to make the language actually usable.

*   **Objective A:** Refactor Attributes/Decorators to be homoiconic (inside the S-expression).
*   **Objective B:** Clean up the PEG.js grammar for performance.
*   **Objective C:** Implement a lightweight Runtime Shim (Pattern matching logic, Type checks) to keep generated code clean.

## 🧠 Phase 3: The Brain Transplant (v0.4.0)
**Theme:** "Prepare for the metal."
Moving away from direct AST-to-JS compilation towards a distinct Intermediate Representation (IR). This is the pre-requisite for LLVM.

*   **Objective A:** Define `High-Level IR` (HIR) - A typed, desugared tree.
*   **Objective B:** Implement `Lowering` pass (AST -> HIR).
*   **Objective C:** Refactor JS Codegen to consume HIR instead of AST.

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