# 📝 Implementation Tasks

This list is ordered by priority. **Do not jump ahead.** Start with "Priority 0". Finish the current block to unlock the next level. 🎮 

Important: **Commit often**

## 🚨 Priority 0: The "No Strings Attached" Refactor (Codegen)
*Context: We are currently concatenating strings to generate JS. This is fragile and hard to debug.*

- [ ] **Install Dependencies**
    - [ ] `npm install estree` (Types for JS AST)
    - [ ] `npm install astring` (Or `escodegen` - for printing ESTree to string)
- [ ] **Create `JSTransformer` Visitor**
    - [ ] Create new visitor `JSTransformerAstVisitor.ts`.
    - [ ] Change return type of `visit` methods from `string` to `ESTree.Node`.
- [ ] **Port Basic Nodes**
    - [ ] Port `visitNumber`, `visitString`, `visitBoolean` to return ESTree Literals.
    - [ ] Port `visitIdentifier` to return ESTree Identifiers.
- [ ] **Port Control Flow**
    - [ ] Port `visitIf`, `visitWhile` to return `IfStatement`, `WhileStatement`.
    - [ ] **Crucial:** Ensure `visitMatch` logic generates a cleaner IIFE or Switch statement structure using AST nodes.
- [ ] **Switch Compiler Pipeline**
    - [ ] Update `Context.ts` to use `astring.generate(ast)` instead of the old string joiner.
    - [ ] Verify source maps still work (most generators handle this automatically).

## 🔮 Priority 1: The "Psychic" Symbol Table (Scoping)
*Context: We can't see functions defined later in the file. We need to look twice.*

- [ ] **Refactor `BuildSymbolTableAstVisitor`**
    - [ ] **Split into two passes:**
        - [ ] `ScanPass`: Walk the tree. Record Class names, Function names, Variable names. **Do not** enter function bodies.
        - [ ] `ResolvePass`: Walk the tree. Enter bodies. Validate that used identifiers exist in the table created by `ScanPass`.
- [ ] **Fix `SymbolTable.ts` Performance**
    - [ ] Refactor `resolveSymbol` to avoid iterating through `this.scopes` array linearly.
    - [ ] Implement a lookup cache: `Map<string, SymbolEntry>` for O(1) access.

## 🕸️ Priority 2: The Dependency Web (Modules)
*Context: Our dependency graph is a tree, but it should be a flat cache to avoid loading modules twice.*

- [ ] **Refactor `DependencyGraph.ts`**
    - [ ] Create a `ModuleCache` (Map<AbsolutePath, ImportUnit>) in `Context`.
    - [ ] Update `find` or `add` to check `ModuleCache` before creating a new `ImportUnit`.
    - [ ] Ensure `SymbolTable.join` handles re-exports correctly without duplicating symbols.

## 🎨 Priority 3: Grammar & Syntax Polish
*Context: The syntax needs to be consistent with Lisp philosophy.*

- [ ] **Refactor Attributes**
    - [ ] Update `l-lang.pegjs` grammar.
    - [ ] Change `[Attr] (defclass ...)` to `(defclass :attributes [Attr] ...)` or `(defclass (meta [Attr]) ...)`.
    - [ ] Update `JSCompilerAstVisitor` (or the new Transformer) to handle the new node structure.
- [ ] **Kill the Escape Hatch**
    - [ ] Remove `js'()` raw injection support from the grammar (force yourself to use the language features!).
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