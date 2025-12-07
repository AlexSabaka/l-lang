# 🏗️ Compiler Architecture Refactoring Plan

**Phase:** v0.3.5 (Between Phase 2 and Phase 3)  
**Status:** Not Started  
**Priority:** 5 in TODO.md  

## Overview

This refactoring separates **logic transformation** from **code generation**, making the compiler architecture more modular and easier to retarget (LLVM, Wasm, etc.).

### Current Pipeline (v0.3.0)
```
Raw AST
  ↓
BuildSymbolTable (2-pass)
  ↓
BuildDependencyGraph
  ↓
JSTransformerAstVisitor ← Does EVERYTHING:
  • Transforms pipelines
  • Injects implicit returns
  • Handles list unrolling
  • Generates match logic
  • + Codegen to JS
  ↓
JavaScript Output
```

### New Pipeline (v0.3.5)
```
Raw AST
  ↓
BuildSymbolTable (2-pass)
  ↓
BuildDependencyGraph
  ↓
SemanticValidator
  ↓
DesugarAstVisitor ← NEW: Transform logic only
  • Convert (a |> b) → (b a)
  • Inject explicit returns
  • Unroll [1 | 2] → [[1], [2]]
  ↓
JSTransformerAstVisitor ← SIMPLIFIED: Pure codegen
  • Maps ESTree nodes to JS
  • Calls runtime helpers for patterns
  ↓
JavaScript Output (with runtime shim prepended)
```

---

## Directory Restructuring

### Before (Flat)
```
src/compiler/
├── grammar/
├── AstProvider.ts
├── SymbolTable.ts
├── DependencyGraph.ts
├── ast.ts
├── Context.ts
├── cli.ts
├── tools.ts
├── rules/
├── lib/
├── utils/
└── visitors/
    ├── BaseAstVisitor.ts
    ├── BaseAstTreeWalker.ts
    ├── BuildSymbolTableAstVisitor.ts
    ├── BuildDependencyGraphAstVisitor.ts
    ├── InlineImportsAstVisitor.ts
    ├── JSTransformerAstVisitor.ts
    ├── SemanticValidatorAstVisitor.ts
    ├── SyntaxRulesAstVisitor.ts
    ├── InferTypesAstVisitor.ts
    └── TreeShakeAstVisitor.ts
```

### After (Organized by Phase)
```
src/compiler/
├── frontend/
│   ├── grammar/
│   ├── AstProvider.ts
│   └── ast.ts
├── analysis/
│   ├── SymbolTable.ts
│   ├── DependencyGraph.ts
│   └── visitors/
│       ├── BuildSymbolTableAstVisitor.ts
│       ├── BuildDependencyGraphAstVisitor.ts
│       ├── SemanticValidatorAstVisitor.ts
│       └── SyntaxRulesAstVisitor.ts
├── transformation/
│   └── visitors/
│       ├── DesugarAstVisitor.ts      ← NEW
│       ├── InlineImportsAstVisitor.ts
│       ├── InferTypesAstVisitor.ts
│       └── TreeShakeAstVisitor.ts
├── codegen/
│   ├── ClassBuilder.ts               ← EXTRACTED
│   └── visitors/
│       └── JSTransformerAstVisitor.ts (simplified)
├── runtime/
│   ├── match.ts                      ← NEW: Pattern matching helpers
│   ├── types.ts                      ← NEW: Type checking helpers
│   └── index.ts                      ← Exports runtime shim
├── rules/
├── lib/
├── utils/
├── Context.ts
├── cli.ts
├── tools.ts
└── index.ts (updated barrel exports)
```

---

## Task Breakdown

### Task 5A: Directory Restructuring
**Deliverable:** Reorganized directory structure with updated imports

1. Create new subdirectories:
   - `frontend/`, `analysis/`, `transformation/`, `codegen/`, `runtime/`
   
2. Move files:
   - `grammar/`, `ast.ts`, `AstProvider.ts` → `frontend/`
   - `SymbolTable.ts`, `DependencyGraph.ts` → `analysis/`
   - Analysis visitors → `analysis/visitors/`
   - `InlineImportsAstVisitor.ts` → `transformation/visitors/`
   - `JSTransformerAstVisitor.ts` → `codegen/visitors/`
   
3. Update imports in:
   - All visitor files
   - `Context.ts`
   - `index.ts` barrel exports
   - CLI and tool files

### Task 5B: Create DesugarAstVisitor
**Deliverable:** New visitor that normalizes the AST before codegen

Moves three major transformations out of `JSTransformer`:

#### 1. Pipeline Transformation
**Current (in JSTransformer):**
```typescript
// Input: (a |> b |> c)
// Output: (c (b a))
transformPipelineList(node) { ... }
```

**New (in DesugarAstVisitor):**
- Extract `transformPipelineList` logic
- Replace pipeline nodes with nested function call nodes
- Runs in pass after analysis, before codegen

#### 2. Implicit Return Injection
**Current (in JSTransformer):**
```typescript
// Scan function body, inject return on last expression
injectImplicitReturn(bodyNode) { ... }
```

**New (in DesugarAstVisitor):**
- Create `(return ...)` node wrapper for last expression
- Exclude: `if`, `while`, `for`, `try`, explicit returns, declarations
- Normalizes all functions to explicit return structure

#### 3. List/Matrix Unrolling
**Current (in JSTransformer):**
```typescript
// Input: [1 | 2]
// Output: [[1], [2]]
unrollMatrix(node) { ... }
```

**New (in DesugarAstVisitor):**
- Convert pipe-separated lists to nested arrays
- Preserves semantics; simplifies codegen

### Task 5C: Runtime Shim Integration
**Deliverable:** Extract pattern matching to runtime library

#### Create `src/compiler/runtime/match.ts`
Pattern matching helpers that will be prepended to compiled output:

```typescript
// _ll_match_list: Test if value matches list pattern
export function _ll_match_list(val: any, patterns: any[]): boolean { ... }

// _ll_match_struct: Test if value matches destructuring pattern
export function _ll_match_struct(val: any, patterns: object): boolean { ... }
```

#### Create `src/compiler/runtime/types.ts`
Type checking helpers:

```typescript
// _ll_is_type: Runtime type check
export function _ll_is_type(val: any, type: string): boolean { ... }
```

#### Create `src/compiler/runtime/index.ts`
Exports runtime shim as JavaScript string:

```typescript
export function getRuntimeShim(): string {
  return `
    function _ll_match_list(val, patterns) { ... }
    function _ll_match_struct(val, patterns) { ... }
    function _ll_is_type(val, type) { ... }
  `;
}
```

#### Update JSTransformerAstVisitor
- Replace inline match logic with calls to runtime helpers:
  ```typescript
  // Before: `Array.isArray(x) && x.length === 3 && typeof x[0] === 'number'`
  // After: `_ll_match_list(x, [{ type: 'number' }, ..., ...])`
  ```
- Prepend runtime shim to final output (like current `std.console` handling)

### Task 5D: Standardize ClassBuilder
**Deliverable:** Extract and simplify class generation

#### Current (in JSTransformer)
```typescript
class ClassBuilder {
  // Inside JSTransformerAstVisitor, instantiated per class
  // Directly generates SourceNodes
}
```

#### New (separate module)
```typescript
// src/compiler/codegen/ClassBuilder.ts
export class ClassBuilder {
  constructor(symbolTable: SymbolTable) { ... }
  build(classNode: ClassNode): ESTree.Node { ... }
}
```

- Takes `SymbolTable` to resolve parent classes
- Returns ESTree.ClassDeclaration (not SourceNode)
- Handles inheritance parameter passing
- Unit testable in isolation

#### Tests
Create `src/compiler/codegen/__tests__/ClassBuilder.test.ts`:
- Test simple class definition
- Test inheritance with parameter passing
- Test parameter shadowing
- Test constructor chaining

### Task 5E: Simplify JSTransformerAstVisitor
**Deliverable:** Pure codegen mapping ESTree nodes to JS

Remove:
- ✗ `transformPipelineList` (now in DesugarAstVisitor)
- ✗ `injectImplicitReturn` (now in DesugarAstVisitor)
- ✗ `unrollMatrix` (now in DesugarAstVisitor)
- ✗ Inline match logic (now calls runtime helpers)
- ✗ Direct `ClassBuilder` instantiation (now separate module)

Result: Visitor just maps AST nodes to ESTree equivalents.

### Task 5F: Update Compilation Pipeline
**Deliverable:** Integrate all changes into Context

Update `Context.ts` to run visitors in order:

```typescript
export class Context {
  async compileAstToJs(ast: AstNode): Promise<string> {
    // 1. Analysis phase
    const symbolTable = new BuildSymbolTableAstVisitor(this).visit(ast);
    new BuildDependencyGraphAstVisitor(this).visit(ast);
    
    // 2. Semantic validation
    new SemanticValidatorAstVisitor(this).visit(ast);
    new SyntaxRulesAstVisitor(this).visit(ast);
    
    // 3. NEW: Transformation phase
    const desugarred = new DesugarAstVisitor(symbolTable).visit(ast);
    
    // 4. Tree shaking
    const shaken = new TreeShakeAstVisitor(this).visit(desugared);
    
    // 5. Codegen phase
    const estree = new JSTransformerAstVisitor(symbolTable).visit(shaken);
    
    // 6. Output with runtime shim
    const runtimeShim = getRuntimeShim();
    const code = astring.generate(estree);
    
    return runtimeShim + '\n' + code;
  }
}
```

---

## Implementation Order

1. **5A** - Directory restructuring (foundations)
2. **5B** - DesugarAstVisitor (core logic)
3. **5D** - Extract ClassBuilder (cleaner JSTransformer)
4. **5E** - Simplify JSTransformer (remove moved logic)
5. **5C** - Runtime shim integration (optimize generated code)
6. **5F** - Update pipeline (tie everything together)

---

## Benefits

### Immediate
- **Testability:** Each phase is independent; easier to unit test
- **Readability:** No 500-line visitor doing 5 different things
- **Maintainability:** Logic bugs isolated to specific visitors

### For v0.4.0 (IR Phase)
- **Retargetability:** Replace JSTransformer with LLVMCodegenVisitor; reuse desugaring
- **Clarity:** Easier to define HIR with desugared AST as input

### Code Quality
- Generated JS is cleaner (less inline pattern matching)
- Visitor classes are smaller and more focused

---

## Testing Strategy

### Phase 1: Directory Migration
```bash
npm run compile  # Should work identically after restructuring
npm run test     # All tests should pass
```

### Phase 2: DesugarAstVisitor
Create `examples/desugaring.lisp`:
```lisp
; Test pipelines
(fn foo [a] (+ a 1))
(let x 5)
(x |> foo |> foo |> (fn [a] (* a 2)))

; Test implicit returns
(fn bar [] (if true 42 0))

; Test list unrolling
(let y [1 | 2 | 3])
```

Verify AST before/after desugaring.

### Phase 3: Runtime Integration
Add test case for pattern matching:
```lisp
(match data
  ([1 2 3] "found")
  (_ "not found"))
```

Verify runtime helper is called in generated JS.

### Phase 4: End-to-End
Run full test suite; ensure all examples still work.

