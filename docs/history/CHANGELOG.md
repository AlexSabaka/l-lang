# 📜 Changelog & Implementation History

## 🚀 Recent Major Changes (January 2026)

### Operator Overloading (January 16, 2026)
**Status**: ✅ Complete

Implemented comprehensive operator overloading support for both standalone functions and class/struct methods:

- **Standalone Overloading**: Functions marked with `:operator` are registered in a global `__ll_op_registry` and dispatched at runtime based on argument types.
- **Method Overloading**: Classes and structs can implement operators (e.g., `_2b` for `+`) which are called via dynamic dispatch when used as the left operand.
- **Dynamic Arity Support**: Handles both unary and binary operators (e.g., `-` for negation and subtraction) through arity-suffixed method names (e.g., `_2d_0`, `_2d_1`) to avoid prototype shadowing.
- **Runtime Dispatch Engine**: Updated `+`, `-`, `*`, `/`, and `==` runtime implementations to prioritize registry overloads, then method dispatch, then native JS operations.
- **Symbol Table Metadata**: Added `isOperator` and `operatorSymbol` tracking to `SymbolEntry`.

**Key Implementation Files**:
- [src/compiler/runtime/RuntimeProvider.ts](../../src/compiler/runtime/RuntimeProvider.ts) - Global operator registry and revamped operator dispatchers
- [src/compiler/codegen/js-estree/visitors/JSTransformerAstVisitor.ts](../../src/compiler/codegen/js-estree/visitors/JSTransformerAstVisitor.ts) - Operator registration hoisting and renaming
- [src/compiler/analysis/SymbolTable.ts](../../src/compiler/analysis/SymbolTable.ts) - Operator metadata in symbol table

---

### Type System Extensions (January 3, 2026)
**Status**: ✅ Complete

Added support for user-defined type-aliases and struct types through comprehensive type system extensions:

- **Recursive Type-Aliases**: `deftype Expr (Int | String | Expr)[]` now works correctly
- **Struct Types**: `defstruct vec2` with members and constructors fully supported
- **Type References**: Forward and circular type references properly resolved
- **Symbol Table Integration**: All type information stored in symbol entries

**Key Implementation Files**:
- [src/compiler/analysis/SymbolTable.ts](../../src/compiler/analysis/SymbolTable.ts) - Type interface extensions
- [src/compiler/analysis/visitors/BuildSymbolTableAstVisitor.ts](../../src/compiler/analysis/visitors/BuildSymbolTableAstVisitor.ts) - Symbol registration
- [src/compiler/types/visitors/InferTypesAstVisitor.ts](../../src/compiler/types/visitors/InferTypesAstVisitor.ts) - Type inference implementation
- [src/compiler/types/TypeChecker.ts](../../src/compiler/types/TypeChecker.ts) - Type compatibility rules

**Related Documentation**: See [DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md](DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md)

---

### Compiler Architecture Refactor (January 2, 2026)
**Status**: ✅ Complete - Phase 2.5

Major reorganization of compiler source code by compilation phase:

**Directory Changes**:
```
Before: src/compiler/visitors/ (flat)
After:  src/compiler/
        ├── frontend/
        ├── analysis/
        ├── transformation/
        ├── types/
        ├── codegen/
        ├── helpers/
        └── ... (organized by phase)
```

**Functional Changes**:
- Introduced `DesugarAstVisitor` for AST transformation (pipelines, implicit returns)
- Extracted runtime helpers into separate modules
- Standardized `ClassBuilder` for class code generation
- Simplified `JSTransformerAstVisitor` to pure codegen

**Compilation Pipeline Now**:
```
Parse → Syntax → Symbols → Desugar → Types → Codegen
                             ↑        ↑        ↑
                       Transform   Infer    Generate
                       Complex   & Check    JavaScript
                       Syntax      Types
```

**Related Documentation**: See [docs/architecture/COMPILER_ARCHITECTURE.md](../architecture/COMPILER_ARCHITECTURE.md)

---

### Type Inference System Fixes (December 2025)
**Status**: ✅ Complete - Priority 4.5

Critical bug fixes for parameter type binding and complex expression type inference:

**Issues Fixed**:
1. Function parameters becoming "Unknown" when referenced in function body
   - Root cause: `BaseAstTreeWalker` double-traversal corrupting scope
   - Solution: Override `visit()` to prevent auto-recursion
   
2. Map type inference not working
   - Solution: Added `case "map"` to `inferExpressionType()`
   
3. Indexer operations (array[i], map[key]) not typed correctly
   - Solution: Implemented proper `case "indexer"` type inference

**Test Results**:
- ✅ [02_fn_types.lisp](../../examples/01-basics/02_fn_types.lisp) - Type annotations and parameter resolution
- ✅ [06_flow_control.lisp](../../examples/01-basics/06_flow_control.lisp) - Flow control with typed parameters
- ✅ [07_memoization.lisp](../../examples/01-basics/07_memoization.lisp) - Map literals and indexer operations

---

### OOP & Inheritance Implementation (November 2025)
**Status**: ✅ Complete - Priority 4

Proper class inheritance with constructor parameter passing:

**Features**:
- Parent class resolution via symbol table lookup
- Constructor parameter passing with `super(args)`
- Parameter shadowing (local vs inherited parameters)
- Implicit return statements in function bodies
- Complete cleanup of legacy string-based compiler

**Test Example**: [examples/05-oop/00_inheritance.lisp](../../examples/05-oop/00_inheritance.lisp)

---

### Module System Fixes (October 2025)
**Status**: ✅ Complete - Priority 2

Fixed circular dependency handling in the module system:

**Changes**:
- Created `ModuleCache` in `Context` for flat module processing
- Refactored `DependencyGraph` from tree-based to cache-based
- Implemented proper symbol inlining with `InlineImportsAstVisitor`
- Fixed path resolution bugs

**Result**: All imported symbols now inline correctly in compiled output

---

### ESTree Code Generation (September 2025)
**Status**: ✅ Complete - Priority 0

Replaced string-based code generation with structured AST approach:

**Changes**:
- Created `JSTransformerAstVisitor` using ESTree nodes
- Integrated `astring` for code generation
- Removed `JSCompilerAstVisitor` and legacy visitors
- Fixed: formatted strings, function scoping, expression context, compound assignments

**Result**: Clean JavaScript AST generation instead of string concatenation

---

### Two-Pass Symbol Analysis (September 2025)
**Status**: ✅ Complete - Priority 1

Implemented forward references with two-pass symbol table:

**Changes**:
- Split `BuildSymbolTableAstVisitor` into `ScanPass` and `ResolvePass`
- Implemented O(1) symbol lookup with lazy cache
- Functions can now be called before definition

**Result**: Proper lexical scoping with forward reference support

---

## 🐛 Known Issues

### None Currently Reported
All priority tasks completed. See [TODO.md](TODO.md) for future work items.

---

## 🔄 Previous Major Milestones

### Phase 1: Stabilization & Architecture Fixes (v0.2.0) ✅
- ESTree code generation
- Two-pass symbol analysis
- Module dependency fixing

### Phase 2: Syntax & OOP (v0.3.0) ✅
- Homoiconic attributes
- Class inheritance
- Type inference system
- Runtime shim integration

### Phase 2.5: Architecture Refactor (v0.3.5) ✅
- Desugaring pass introduction
- Directory reorganization
- Runtime helper extraction
- ClassBuilder standardization

### Current: Type System Extensions (v0.3.6) ✅
- Type-alias and struct support
- Recursive type handling
- Forward reference resolution

---

## 🚦 Future Phases

### Phase 3: Intermediate Representation (v0.4.0)
Moving towards LLVM targeting with High-Level IR (HIR)

### Phase 4: Native Compilation (v1.0.0)
LLVM IR generation for native binaries

---

## 📊 Compiler Statistics

**Lines of Code** (TypeScript source only):
- ~800 AST node interfaces ([ast.ts](../../src/compiler/frontend/ast.ts))
- ~400 Symbol table implementation ([SymbolTable.ts](../../src/compiler/analysis/SymbolTable.ts))
- ~1000 Type inference logic ([InferTypesAstVisitor.ts](../../src/compiler/types/visitors/InferTypesAstVisitor.ts))
- ~1200 JavaScript code generation ([JSTransformerAstVisitor.ts](../../src/compiler/codegen/visitors/JSTransformerAstVisitor.ts))
- ~400 Type checking rules ([TypeChecker.ts](../../src/compiler/types/TypeChecker.ts))

**Test Coverage**:
- 30+ example programs in `examples/` directory
- Full compilation pipeline tested (parse → symbols → types → codegen)
- All language features exercised

---

**Last Updated**: January 2026

For detailed implementation information, see [IMPLEMENTATION_GUIDE.md](../development/IMPLEMENTATION_GUIDE.md)
