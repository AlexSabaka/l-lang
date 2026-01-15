# 📚 Implementation Roadmap

Complete specifications and guides for implementing new features in the l-lang compiler.

## Currently Implemented: deftype & defstruct Support

See [DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md](DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md) for complete details on how recursive type-aliases and struct types were implemented.

### Status: ✅ COMPLETE (January 3, 2026)

**What was implemented:**
- Type-alias support with recursive type detection
- Struct support with member extraction and constructor generation
- Three-phase type registration for circular dependencies
- Two-pass type resolution (collection + inference)
- Full integration with symbol table

**Key files:**
- [SymbolTable.ts](../../src/compiler/analysis/SymbolTable.ts) - Type interface extensions
- [BuildSymbolTableAstVisitor.ts](../../src/compiler/analysis/visitors/BuildSymbolTableAstVisitor.ts) - Symbol registration
- [InferTypesAstVisitor.ts](../../src/compiler/types/visitors/InferTypesAstVisitor.ts) - Type inference

**Test examples:**
- [01_evaluator.lisp](../../examples/10-algorithms/01_evaluator.lisp) - Recursive type-alias
- [06_structs.lisp](../../examples/04-data-types/06_structs.lisp) - Struct with constructor

---

## Pattern: Adding a New Type Kind

When extending the type system to support a new construct:

### 1. Extend InferredType

**File**: [src/compiler/analysis/SymbolTable.ts](../../src/compiler/analysis/SymbolTable.ts)

```typescript
export interface InferredType {
  kind: "..." | "your-kind";  // Add here
  // ... add new fields for your kind
  yourField?: YourFieldType;
}
```

### 2. Register in Symbol Collection

**File**: [src/compiler/analysis/visitors/BuildSymbolTableAstVisitor.ts](../../src/compiler/analysis/visitors/BuildSymbolTableAstVisitor.ts)

In both `ScanPass` and `ResolvePass`:

```typescript
visitYourNode(node: ast.YourNodeType) {
  const name = node.name.id;
  this.symbolTable.defineSymbol(name, "your-kind", node, visibility);
}
```

### 3. Type Collection (Pass 1)

**File**: [src/compiler/types/visitors/InferTypesAstVisitor.ts](../../src/compiler/types/visitors/InferTypesAstVisitor.ts)

In `CollectTypesPass`:

```typescript
visitYourNode(node: ast.YourNodeType) {
  const yourType: InferredType = {
    kind: "your-kind",
    name: node.name,
    // ... set fields
  };
  
  this.typeEnv.bindIdentifier(node.name, yourType, node);
}
```

### 4. Type Inference (Pass 2)

In `InferAndCheckPass`:

```typescript
visitYourNode(node: ast.YourNodeType) {
  // Resolve any forward references or incomplete types
  // Validate constraints
}
```

### 5. Compatibility Checking

**File**: [src/compiler/types/TypeChecker.ts](../../src/compiler/types/TypeChecker.ts)

```typescript
isAssignable(valueType: InferredType, targetType: InferredType): boolean {
  // ... existing checks ...
  
  if (targetType.kind === "your-kind") {
    // Your compatibility rules
    return /* ... */;
  }
}

formatType(type: InferredType): string {
  // ... existing cases ...
  case "your-kind":
    return `your-kind ${type.name}`;
}
```

### 6. Test

```bash
ts-node ./src/index.ts transform --stage types example.lisp
cat example.types.json | jq '.symbols.entries'
```

Verify your new kind appears in the inferred types.

---

## Pattern: Adding Transformations in Desugaring

When the AST needs normalization before codegen:

### 1. Create Visitor Method in DesugarAstVisitor

**File**: [src/compiler/transformation/visitors/DesugarAstVisitor.ts](../../src/compiler/transformation/visitors/DesugarAstVisitor.ts)

```typescript
visitYourConstruct(node: ast.YourConstructNode) {
  // Transform complex syntax to simple equivalents
  const simplified = /* ... */;
  return simplified;
}
```

**Example**: Pipeline transformation
```typescript
// Input: (a |> b |> c)
// Output: (c (b a))
visitPipelineList(node: ast.ListNode) {
  const pipes = this.extractPipes(node);
  return this.chainFunctionCalls(pipes.reverse());
}
```

### 2. Ensure Order in Pipeline

**File**: [src/compiler/Context.ts](../../src/compiler/Context.ts)

Verify desugaring runs before codegen:

```typescript
// 1. Analysis phase
// 2. Transformation phase
const desugared = new DesugarAstVisitor(symbolTable).visit(ast);

// 3. Codegen phase
const estree = new JSTransformerAstVisitor(symbolTable).visit(desugared);
```

---

## Pattern: Adding Runtime Helpers

When code generation needs helper functions:

### 1. Create Helper Module

**File**: [src/compiler/helpers/runtime/your_helper.ts](../../src/compiler/helpers/runtime/)

```typescript
export function getYourHelper(): string {
  return `
    function _ll_your_helper(args) {
      // Implementation
    }
  `;
}
```

### 2. Export from RuntimeProvider

**File**: [src/compiler/helpers/runtime/index.ts](../../src/compiler/helpers/runtime/index.ts)

```typescript
export function getRuntimeShim(): string {
  return `
    ${getYourHelper()}
    ${getMatchHelper()}
    ${getTypesHelper()}
  `;
}
```

### 3. Call from JSTransformer

**File**: [src/compiler/codegen/visitors/JSTransformerAstVisitor.ts](../../src/compiler/codegen/visitors/JSTransformerAstVisitor.ts)

```typescript
visitYourNode(node: ast.YourNodeType): ESTree.Node {
  // Generate call to _ll_your_helper
  return {
    type: "CallExpression",
    callee: { type: "Identifier", name: "_ll_your_helper" },
    arguments: [ /* ... */ ]
  };
}
```

### 4. Verify in Output

The runtime shim is prepended to output, so your helper will be available:

```javascript
// Generated output
function _ll_your_helper(args) { ... }

// User code can call it
_ll_your_helper(someValue);
```

---

## Understanding Compilation Artifacts

The compiler produces intermediate `.json` files at each stage for debugging:

### .parsed.json
Raw AST after parsing (stage: `parse`)

```bash
ts-node ./src/index.ts transform --stage parse example.lisp
```

Shows: Full abstract syntax tree without any processing.

### .symbols.json
After symbol collection (stage: `symbols`)

```bash
ts-node ./src/index.ts transform --stage symbols example.lisp
```

Shows: Symbol table with all top-level declarations, no types yet.

### .types.json
After type inference (stage: `types`)

```bash
ts-node ./src/index.ts transform --stage types example.lisp
```

Shows: Symbol entries with `inferredType` field populated.

### .js
Final JavaScript output (default stage: `codegen`)

```bash
ts-node ./src/index.ts transform example.lisp
```

Shows: Generated JavaScript code with runtime shim prepended.

---

## Debugging Tools

### Inspect Specific Symbols
```bash
cat example.types.json | jq '.symbols.entries.myFunction'
```

### Check Type Information
```bash
cat example.types.json | jq '.symbols.entries.x.inferredType'
```

### View Full AST
```bash
cat example.parsed.json | jq '.ast' | less
```

### Enable Debug Logging
```bash
ts-node ./src/index.ts transform --loglevel Debug example.lisp
```

---

## Common Implementation Tasks

### Fixing Type Inference

1. Check if visitXxx method exists for your AST node type
2. Verify scope entry/exit is correct (enter/exitScope calls)
3. Ensure list-wrapped nodes are unwrapped properly
4. Test with `transform --stage types` to see if inferredType appears

### Adding Grammar Changes

1. Edit [l-lang.pegjs](../../src/compiler/frontend/grammar/l-lang.pegjs)
2. Run `npm run parser` to regenerate parser
3. Update AST interfaces in [ast.ts](../../src/compiler/frontend/ast.ts)
4. Add visitor methods to all relevant visitors

### Handling Recursive Structures

Use three-phase registration:
1. Register placeholder (empty/unknown type)
2. Process definition with forward references allowed
3. Update with complete type information

Example: Type-alias implementation in [InferTypesAstVisitor.ts](../../src/compiler/types/visitors/InferTypesAstVisitor.ts#L300)

---

**Last Updated**: January 2026
