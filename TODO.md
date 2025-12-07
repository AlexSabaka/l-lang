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
**STATUS: NOT STARTED** 🚧

- [ ] **Task 5A: Directory Restructuring**
    - [ ] Create new subdirectories under `src/compiler`:
        - [ ] `frontend/` - Move `grammar/`, `ast.ts`, `AstProvider.ts`
        - [ ] `analysis/` - Move `SymbolTable.ts`, `DependencyGraph.ts`
        - [ ] `analysis/visitors/` - Move `BuildSymbolTableAstVisitor.ts`, `BuildDependencyGraphAstVisitor.ts`, `SemanticValidatorAstVisitor.ts`, `SyntaxRulesAstVisitor.ts`
        - [ ] `transformation/` - Create new phase for desugaring
        - [ ] `transformation/visitors/` - Move `InlineImportsAstVisitor.ts`, create new `DesugarAstVisitor.ts`
        - [ ] `codegen/visitors/` - Move `JSTransformerAstVisitor.ts`
        - [ ] `runtime/` - Create new for runtime helpers
    - [ ] Update all import paths in visitor files and `Context.ts`
    - [ ] Update `index.ts` barrel exports

- [ ] **Task 5B: Create `DesugarAstVisitor.ts`** (NEW!)
    - [ ] Move `transformPipelineList` logic from `JSTransformer` to `DesugarAstVisitor`
        - [ ] Convert `(a |> b |> c)` to nested function calls `(c (b a))`
    - [ ] Move **Implicit Return Logic** from `JSTransformer`
        - [ ] Scan function bodies and convert last expression to explicit `(return ...)`
        - [ ] Exclude control statements, explicit returns, variable declarations
    - [ ] Move **Matrix/List Unrolling** logic
        - [ ] Convert `[1 | 2]` to `[[1], [2]]`
    - [ ] Pipeline: Raw AST → DesugarAstVisitor → Simplified AST → JSTransformer

- [ ] **Task 5C: Runtime Shim Integration**
    - [ ] Create `src/compiler/runtime/match.ts` - Pattern matching helpers
        - [ ] Implement `_ll_match_list(val, patterns)` for complex list matching
        - [ ] Implement `_ll_match_struct(val, patterns)` for destructuring
    - [ ] Create `src/compiler/runtime/types.ts` - Type checking helpers
        - [ ] Implement `_ll_is_type(val, type)` for runtime type checks
    - [ ] Create `src/compiler/runtime/index.ts` - Export and generate runtime shim string
    - [ ] Update `JSTransformerAstVisitor.visitMatch()` to call runtime helpers instead of generating inline code
    - [ ] Prepend runtime shim to generated output (like `std.console`)

- [ ] **Task 5D: Standardize `ClassBuilder`**
    - [ ] Extract `ClassBuilder` from `JSTransformerAstVisitor.ts` into separate file
    - [ ] Refactor to consume `SymbolTable` and return ESTree nodes instead of SourceNodes
    - [ ] Remove direct codegen; let `JSTransformer` handle output
    - [ ] Add unit tests for `ClassBuilder` with inheritance edge cases

- [ ] **Task 5E: Simplify `JSTransformerAstVisitor.ts`**
    - [ ] Remove pipeline transformation logic (now in `DesugarAstVisitor`)
    - [ ] Remove implicit return logic (now in `DesugarAstVisitor`)
    - [ ] Remove matrix unrolling logic (now in `DesugarAstVisitor`)
    - [ ] Remove `ClassBuilder` instantiation (now separate module)
    - [ ] Remove match codegen complexity (now calls runtime helpers)
    - [ ] Result: **Pure codegen** mapping desugared AST to JS

- [ ] **Task 5F: Update Compilation Pipeline**
    - [ ] Modify `Context.ts` to run visitors in new order:
        1. Parse (AstProvider)
        2. Analysis (BuildSymbolTable, BuildDependencyGraph, Semantic Validation)
        3. **NEW:** Desugaring (DesugarAstVisitor)
        4. Codegen (JSTransformer)
    - [ ] Ensure `TreeShakeAstVisitor` runs after desugaring
    - [ ] Add runtime shim prepend to final output

---

## 🛠️ Priority 6: Tooling & DX
*Context: Making the developer experience nice.*

- [ ] **Expand `RuleBuilder`**
    - [ ] Add rule: `CycleDetection` (Error if Class A inherits Class B inherits Class A).
    - [ ] Add rule: `UnusedVariable` (Warning if defined but never read - requires Symbol Table usage count).
- [ ] **Unit Tests**
    - [ ] Create a test harness that runs a `.txt` file and asserts the output JS matches a snapshot.

---

## 🧠 Backlog (For later)
- [ ] Type Inference Visitor (The hard part).
- [ ] LLVM IR Generation.
- [ ] Self-hosting (Writing the compiler in l-lang).