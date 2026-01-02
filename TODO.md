# 📝 Implementation Tasks

This list is ordered by priority. **Do not jump ahead.** Start with "Priority 0". Finish the current block to unlock the next level. 🎮 

Important: **Commit often**

## ✅ Priority 0: The "No Strings Attached" Refactor (Codegen)
*Context: We are currently concatenating strings to generate JS. This is fragile and hard to debug.*
**STATUS: COMPLETE** ✨

- [x] **Install Dependencies**
    - [x] `npm install estree` (Types for JS AST)
    - [x] `npm install astring` (Or `escodegen` - for printing ESTree to string)
- [x] **Create `JSTransformer` Visitor**
    - [x] Create new visitor `JSTransformerAstVisitor.ts`.
    - [x] Change return type of `visit` methods from `string` to `ESTree.Node`.
- [x] **Port Basic Nodes**
    - [x] Port `visitNumber`, `visitString`, `visitBoolean` to return ESTree Literals.
    - [x] Port `visitIdentifier` to return ESTree Identifiers.
- [x] **Port Control Flow**
    - [x] Port `visitIf`, `visitWhile` to return `IfStatement`, `WhileStatement`.
    - [x] **Crucial:** Ensure `visitMatch` logic generates a cleaner IIFE or Switch statement structure using AST nodes.
- [x] **Switch Compiler Pipeline**
    - [x] Update `Context.ts` to use `astring.generate(ast)` instead of the old string joiner.
    - [x] Verify source maps still work (most generators handle this automatically).

## ✅ Priority 1: The "Psychic" Symbol Table (Scoping)
*Context: We can't see functions defined later in the file. We need to look twice.*
**STATUS: COMPLETE** ✨

- [x] **Refactor `BuildSymbolTableAstVisitor`**
    - [x] **Split into two passes:**
        - [x] `ScanPass`: Walk the tree. Record Class names, Function names, Variable names. **Do not** enter function bodies.
        - [x] `ResolvePass`: Walk the tree. Enter bodies. Validate that used identifiers exist in the table created by `ScanPass`.
- [x] **Fix `SymbolTable.ts` Performance**
    - [x] Refactor `resolveSymbol` to avoid iterating through `this.scopes` array linearly.
    - [x] Implement a lookup cache: `Map<string, SymbolEntry>` for O(1) access.

## 🕸️ Priority 2: The Dependency Web (Modules)
*Context: Our dependency graph is a tree, but it should be a flat cache to avoid loading modules twice.*

- [x] **Refactor `DependencyGraph.ts`**
    - [x] Create a `ModuleCache` (Map<AbsolutePath, ImportUnit>) in `Context`.
    - [x] Update `find` or `add` to check `ModuleCache` before creating a new `ImportUnit`.
    - [x] Ensure `SymbolTable.join` handles re-exports correctly without duplicating symbols.

## ✅ Priority 3: Grammar & Syntax Polish
*Context: The syntax needs to be consistent with Lisp philosophy.*
**STATUS: COMPLETE** ✨

- [x] **Refactor Attributes**
    - [x] Update `l-lang.pegjs` grammar.
    - [x] Change `[Attr] (defclass ...)` to `(defclass :attributes [Attr] ...)` or `(defclass (meta [Attr]) ...)`.
    - [x] Update `JSTransformerAstVisitor` to handle the new node structure.
- [x] **Kill the Escape Hatch**
    - [x] Remove `js'()` raw injection support from the grammar (force yourself to use the language features!).
    - [x] Ensure `std` lib covers the missing functionality (e.g., `Math`, `Console`).
- [x] **Clean up Legacy Code**
    - [x] Remove `JSCompilerAstVisitor` (string-based compiler) - no longer needed
    - [x] Remove legacy visitors: `BabelAstVisitor`, `RecastAstVisitor`, `ConvertAstToJsVisitor`
    - [x] Remove legacy extension grammar files: `infix.pegjs`, `js.pegjs`
    - [x] Reorganize examples into semantic folders (`01-basics/`, `02-errors/`, `04-data-types/`, `05-oop/`, `06-import/`, `07-async/`, `10-algorithms/`, `99-p5js/`)

## 🚧 Priority 4: OOP & Inheritance (Class Improvements)
*Context: Classes need proper inheritance support with constructor parameter passing.*
**STATUS: IN PROGRESS** 🚧

- [x] **Implement Proper Class Inheritance**
    - [x] Resolve parent class via symbol table lookup
    - [x] Extract `:ctor` parameters from parent class definition
    - [x] Generate proper `super()` calls with parent arguments
    - [x] Handle parameter shadowing (local vs inherited parameters)
    - [x] Flatten nested body arrays in class definitions
- [x] **Implicit Return in Functions**
    - [x] Add implicit `return` for last expression in function bodies
    - [x] Exclude control statements (`if`, `while`, `for`, `try`)
    - [x] Exclude explicit return statements and variable declarations
    - [x] Preserve statement context detection
- [ ] **Complete OOP Feature Set**
    - [ ] Interface implementation checks
    - [ ] Abstract class support
    - [ ] Static methods and properties

## 🏗️ Priority 5: Compiler Architecture Refactor (Desugaring & Cleanup)
*Context: Separate logic from generation, introduce desugaring pass, reorganize directory structure.*
**STATUS: COMPLETE** ✅

- [x] **Task 5A: Directory Restructuring** ✅
    - [x] Create new subdirectories under `src/compiler`:
        - [x] `frontend/` - Move `grammar/`, `ast.ts`, `AstProvider.ts`
        - [x] `analysis/` - Move `SymbolTable.ts`, `DependencyGraph.ts`
        - [x] `analysis/visitors/` - Move `BuildSymbolTableAstVisitor.ts`, `BuildDependencyGraphAstVisitor.ts`, `SemanticValidatorAstVisitor.ts`, `SyntaxRulesAstVisitor.ts`
        - [x] `transformation/` - Create new phase for desugaring
        - [x] `transformation/visitors/` - Move `InlineImportsAstVisitor.ts`, create new `DesugarAstVisitor.ts`
        - [x] `codegen/visitors/` - Move `JSTransformerAstVisitor.ts`
        - [x] `runtime/` - Create new for runtime helpers
    - [x] Update all import paths in visitor files and `Context.ts`
    - [x] Update `index.ts` barrel exports
    - **Commit:** `76a5d5e` - Task 5A - Reorganize compiler by compilation phase

- [x] **Task 5B: Create `DesugarAstVisitor.ts`** ✅
    - [x] Move `transformPipelineList` logic from `JSTransformer` to `DesugarAstVisitor`
        - [x] Convert `(a |> b |> c)` to nested function calls `(c (b a))`
    - [x] Move **Implicit Return Logic** from `JSTransformer`
        - [x] Scan function bodies and convert last expression to explicit `(return ...)`
        - [x] Exclude control statements, explicit returns, variable declarations
    - [x] Move **Matrix/List Unrolling** logic
        - [x] Convert `[1 | 2]` to `[[1], [2]]`
    - [x] Pipeline: Raw AST → DesugarAstVisitor → Simplified AST → JSTransformer
    - **Commit:** `2ad0870` - Task 5B - Create DesugarAstVisitor for AST transformation

- [x] **Task 5C: Runtime Shim Integration** ✅
    - [x] Create `src/compiler/runtime/match.ts` - Pattern matching helpers
        - [x] Implement `_ll_match_list(val, patterns)` for complex list matching
        - [x] Implement `_ll_match_struct(val, patterns)` for destructuring
    - [x] Create `src/compiler/runtime/types.ts` - Type checking helpers
        - [x] Implement `_ll_is_type(val, type)` for runtime type checks
    - [x] Create `src/compiler/runtime/index.ts` - Export and generate runtime shim string
    - [x] Update `JSTransformerAstVisitor.visitMatch()` to call runtime helpers instead of generating inline code
    - [x] Prepend runtime shim to generated output (like `std.console`)
    - **Commit:** `0d37c60` - Task 5C - Create runtime helpers for pattern matching & type checking

- [x] **Task 5D: Standardize `ClassBuilder`** ✅
    - [x] Extract `ClassBuilder` from `JSTransformerAstVisitor.ts` into separate file
    - [x] Refactor to consume `SymbolTable` and return ESTree nodes instead of SourceNodes
    - [x] Remove direct codegen; let `JSTransformer` handle output
    - [x] Add unit tests for `ClassBuilder` with inheritance edge cases
    - **Commit:** `65a6393` - Task 5D - Extract ClassBuilder into separate module

- [x] **Task 5E: Simplify `JSTransformerAstVisitor.ts`** ✅
    - [x] Remove pipeline transformation logic (now in `DesugarAstVisitor`)
    - [x] Remove implicit return logic (now in `DesugarAstVisitor`)
    - [x] Remove matrix unrolling logic (now in `DesugarAstVisitor`)
    - [x] Remove `ClassBuilder` instantiation (now separate module)
    - [x] Remove match codegen complexity (now calls runtime helpers)
    - [x] Result: **Pure codegen** mapping desugared AST to JS
    - **Integrated with other tasks**

- [x] **Task 5F: Update Compilation Pipeline** ✅
    - [x] Modify `Context.ts` to run visitors in new order:
        1. Parse (AstProvider)
        2. Analysis (BuildSymbolTable, BuildDependencyGraph, Semantic Validation)
        3. **NEW:** Desugaring (DesugarAstVisitor)
        4. Codegen (JSTransformer)
    - [x] Ensure `TreeShakeAstVisitor` runs after desugaring
    - [x] Add runtime shim prepend to final output
    - **Commit:** `c58497b` - Task 5F - Integrate desugaring pass and runtime shim into compilation pipeline

- [x] **Bonus: Reorganize helpers, consolidate lib + runtime + utils** ✅
    - [x] Merged `src/compiler/lib/` → `src/compiler/helpers/runtime/`
    - [x] Merged `src/compiler/utils/` → `src/compiler/helpers/utils/`
    - [x] Consolidated `src/compiler/runtime/` → `src/compiler/helpers/runtime/`
    - [x] Created organized barrel exports at each level
    - [x] Updated all import paths across codebase (10+ files)
    - [x] Updated getRuntimeShim() to be clean and isolated
    - **Commit:** `ee9e438` - Reorganize helpers, consolidate lib + runtime + utils

---

## 🛠️ Priority 6: Tooling & DX
*Context: Making the developer experience nice.*

- [ ] **Expand `RuleBuilder`**
    - [ ] Add rule: `CycleDetection` (Error if Class A inherits Class B inherits Class A).
    - [ ] Add rule: `UnusedVariable` (Warning if defined but never read - requires Symbol Table usage count).
- [ ] **Unit Tests**
    - [ ] Create a test harness that runs a `.txt` file and asserts the output JS matches a snapshot.

## 🔍 Priority 4.5: Type Inference System (COMPLETED) ✅
*Context: Fixing critical bugs in parameter binding and type inference for complex expressions.*
**STATUS: COMPLETE** ✅

- [x] **Fix Parameter Binding Scope Isolation (CRITICAL)**
    - [x] Override visit() in CollectTypesPass and InferAndCheckPass
    - [x] Prevent BaseAstTreeWalker double-traversal that was causing scope mismatch
    - [x] Add proper exitScope() calls in visitProgram()
    - [x] Result: Function parameters now resolve correctly in function bodies
    - **Commit:** Type inference scope fixes

- [x] **Implement Map Type Inference**
    - [x] Added `case "map"` to inferExpressionType()
    - [x] Infers key and value types from key-value pairs
    - [x] Returns Map<K, V> type using TypeEnvironment.map() helper
    - **Commit:** Map type inference

- [x] **Implement Indexer Type Inference**
    - [x] Added `case "indexer"` to inferExpressionType()
    - [x] Properly handles array[i] → element type
    - [x] Properly handles map[key] → value type
    - [x] Works with both array representations (generics[0] and inner field)
    - **Commit:** Indexer type inference

- [x] **Extend TypeEnvironment for Map Types**
    - [x] Added "map" to InferredType.kind union
    - [x] Added keyType, valueType, and inner fields to InferredType
    - [x] Implemented TypeEnvironment.map() static helper method
    - **Commit:** TypeEnvironment map type support

- [x] **Fix TypeCheckingValidatorAstVisitor Scope Management**
    - [x] Applied same visit() override to prevent double-traversal
    - [x] Added map and indexer type inference cases
    - **Commit:** Validator scope and type inference fixes

- [x] **Testing & Validation**
    - [x] All three test examples pass without type errors
    - [x] 02_fn_types.lisp - Type annotations and parameter resolution ✅
    - [x] 06_flow_control.lisp - Flow control with typed parameters ✅
    - [x] 07_memoization.lisp - Map literals and indexer operations ✅

---

## 🧠 Backlog (For later)
- [ ] **Advanced Type Inference**
    - [ ] Implicit Return Type Inference - Infer return types from function body expressions
    - [ ] Bidirectional Type Inference - Propagate expected types from call context to narrow Unknown types
    - [ ] Better error messages with full context
    - [ ] Full generic type support in type inference
- [ ] LLVM IR Generation.
- [ ] Self-hosting (Writing the compiler in l-lang).