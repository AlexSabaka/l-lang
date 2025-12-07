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

## 🎨 Priority 3: Grammar & Syntax Polish
*Context: The syntax needs to be consistent with Lisp philosophy.*

- [x] **Refactor Attributes**
    - [x] Update `l-lang.pegjs` grammar.
    - [x] Change `[Attr] (defclass ...)` to `(defclass :attributes [Attr] ...)` or `(defclass (meta [Attr]) ...)`.
    - [x] Update `JSCompilerAstVisitor` (or the new Transformer) to handle the new node structure.
- [x] **Kill the Escape Hatch**
    - [x] Remove `js'()` raw injection support from the grammar (force yourself to use the language features!).
    - [ ] Ensure `std` lib covers the missing functionality (e.g., `Math`, `Console`).

## 🛠️ Priority 4: Tooling & DX
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