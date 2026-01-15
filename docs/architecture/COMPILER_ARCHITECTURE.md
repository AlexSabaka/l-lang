# 🏗️ l-lang Compiler Architecture Guide

A statically-typed Lisp compiler targeting JavaScript (LLVM future). This guide explains the architecture and workflows needed to contribute effectively.

## Architecture Overview

### Compilation Pipeline (6 Stages)

The compiler processes l-lang → JavaScript through a **phase-based architecture**:

```
Input (.lisp)
    ↓
[1] PARSE         → AST generation via PEG.js grammar
    ↓
[2] SYNTAX        → Grammar rule validation (SyntaxRulesAstVisitor)
    ↓
[3] SYMBOLS       → Symbol table + dependency analysis (2-pass scan/resolve)
    ↓
[4] DESUGAR       → Transform complex syntax (pipelines |>, implicit returns)
    ↓
[5] TYPES         → Type inference (2-pass collect/infer) + validation
    ↓
[6] CODEGEN       → ESTree AST → JavaScript (astring)
    ↓
Output (.js)
```

**Key Files**: 
- [Context.ts](../../src/compiler/Context.ts#L39) defines `CompilationStage` type and orchestrates all passes via `process(file, stopAt)` method.
- [l-lang.pegjs](../../src/compiler/frontend/grammar/l-lang.pegjs) - PEG.js grammar for parsing

### Directory Structure

```
src/compiler/
├── frontend/          # Input: parsing, grammar, AST definitions
│   ├── ast.ts        # AST node interfaces (~800 lines)
│   ├── grammar/      # PEG.js grammar (l-lang.pegjs) → l-lang.js
│   └── AstProvider.ts # Caches parsed ASTs per file
├── analysis/         # Middle-end: symbol resolution, type tracking
│   ├── SymbolTable.ts # Symbol entries with integrated InferredType
│   ├── DependencyGraph.ts # Module dependency tracking
│   └── visitors/     # BuildSymbolTableAstVisitor, SemanticValidatorAstVisitor
├── transformation/   # AST normalization passes
│   └── visitors/     # DesugarAstVisitor (pipelines, implicit returns)
├── types/           # Type inference engine
│   ├── TypeEnvironment.ts # Scope-aware type binding
│   ├── TypeChecker.ts    # Type compatibility checking
│   └── visitors/     # InferTypesAstVisitor (2-pass), TypeCheckingValidator
├── codegen/         # Output: JavaScript generation
│   ├── js-legacy/   # String-based codegen (deprecated)
│   ├── js-estree/   # ESTree nodes → astring
│   └── ClassBuilder.ts # Class inheritance expansion
├── helpers/
│   ├── runtime/      # Pattern matching, type checking runtime
│   └── utils/        # AST formatting, error handling
└── Context.ts        # Orchestrator (invokes all passes in order)
```

## Key Architectural Patterns

### 1. Visitor Pattern with Controlled Traversal

**Problem**: `BaseAstTreeWalker` auto-recursively traverses all children. Type inference needs manual control to avoid double-traversal and scope corruption.

**Solution**: Override `visit()` to prevent auto-recursion and call visitXxx methods directly.

```typescript
// Example: InferTypesAstVisitor
visit(node: ast.ASTNode): any {
  if (!node) return node;
  // Only call visitXxx, don't auto-recurse
  return (this as any)[`visit${node._type}`]?.(node) ?? node;
}
```

**When to use**: Type inference, scope-sensitive analysis. Avoid modifying base walker behavior unless debugging.

### 2. Two-Pass Analysis Pattern

**Symbols Pass** ([BuildSymbolTableAstVisitor.ts](../../src/compiler/analysis/visitors/BuildSymbolTableAstVisitor.ts)):
- **ScanPass**: Collects all top-level declarations (functions, classes, variables)
- **ResolvePass**: Links identifiers to symbol entries, handles forward references

**Type Inference** ([InferTypesAstVisitor.ts](../../src/compiler/types/visitors/InferTypesAstVisitor.ts)):
- **CollectTypesPass**: Records explicit type annotations from declarations
- **InferAndCheckPass**: Infers types for expressions, validates assignments

**Why**: Enables forward references (call function before definition) and type narrowing.

### 3. AST Structure Quirk: List-Wrapped Declarations

**Discovery**: Top-level declarations are wrapped in list nodes:
```
(mut y)          → ListNode([VariableNode]) not direct VariableNode
(let x 10)       → ListNode([VariableNode])
(console.log x)  → ListNode([CompositeIdentifierNode, ...])
```

**Handling**: When visiting ListNodes in declaration contexts, check first node's type:
```typescript
if (item._type === "list" && item.nodes?.[0]._type === "variable") {
  this.visit(item.nodes[0]); // Visit unwrapped variable
}
```

**Affected Files**: 
- [InferTypesAstVisitor.ts](../../src/compiler/types/visitors/InferTypesAstVisitor.ts)
- [BuildSymbolTableAstVisitor.ts](../../src/compiler/analysis/visitors/BuildSymbolTableAstVisitor.ts)

### 4. SymbolTable Structure with Integrated Types

**Key Change** (Phase 3.5): Type information moved INTO symbol table instead of separate structure.

```typescript
interface SymbolEntry {
  name: Identifier;
  nodeType: string;           // "variable" | "function" | "class"
  mutability: boolean;
  visibility: "public" | "internal";
  inferredType?: InferredType; // NOW INTEGRATED
}
```

**Type Binding Flow**:
```
InferTypesAstVisitor.visitVariable()
  → typeEnv.bindIdentifier(varName, type, node)
    → symbolTable.bindType(varName, type)
      → resolveSymbol(varName).inferredType = type
```

**JSON Output**: Types appear nested in symbols:
```json
{
  "symbols": {
    "entries": {
      "x": {
        "name": "x",
        "nodeType": "variable",
        "inferredType": { "kind": "primitive", "name": "Int" }
      }
    }
  }
}
```

## Development Workflows

### Testing Compilation Stages

Use `transform --stage <stage>` to inspect intermediate outputs:

```bash
# Parse only (raw AST)
ts-node ./src/index.ts transform --stage parse examples/01-basics/00_vars.lisp
# Outputs: 00_vars.parsed.json

# After symbol resolution (with symbol table)
ts-node ./src/index.ts transform --stage symbols examples/01-basics/00_vars.lisp
# Outputs: 00_vars.symbols.json (includes symbol table)

# After type inference (with inferred types)
ts-node ./src/index.ts transform --stage types examples/01-basics/00_vars.lisp
# Outputs: 00_vars.types.json (types IN symbol entries)

# Full JavaScript compilation
ts-node ./src/index.ts transform examples/01-basics/00_vars.lisp
# Outputs: 00_vars.js
```

**Debugging**: Inspect JSON outputs with `jq`:
```bash
cat 00_vars.types.json | jq '.symbols.entries.x.inferredType'
```

### Grammar Updates

1. Edit [l-lang.pegjs](../../src/compiler/frontend/grammar/l-lang.pegjs)
2. Regenerate parser:
   ```bash
   npm run parser
   ```
3. Update AST types in [ast.ts](../../src/compiler/frontend/ast.ts)
4. Add visitor methods to relevant visitors (DesugarAstVisitor, InferTypesAstVisitor, JSTransformerAstVisitor)

### Adding Type Inference for New Constructs

1. Add `visitXxx` to `CollectTypesPass` (collect explicit types)
2. Add `visitXxx` to `InferAndCheckPass` (infer expression types)
3. Update `TypeChecker.isAssignable()` if creating new type kinds
4. Test with `transform --stage types` and verify `inferredType` appears in JSON

**Example**: When adding Map literal support, you'd:
- CollectTypesPass: record `Map<K, V>` from annotations
- InferAndCheckPass: infer from `{:key val, :key val}` syntax to `Map<String, Int>`
- TypeChecker: handle Map compatibility checking

## Critical Context & Gotchas

### Type Binding Not Appearing in Output

**Symptoms**: Symbol entries have no `inferredType` field after type stage.

**Root Causes**:
1. **visitVariable not called**: Check list wrapping (see "AST Structure Quirk")
   - Solution: scan ListNode.nodes directly, not just firstNode
2. **Type resolved instead of inferred**: If `resolveIdentifier()` finds declared type, binding is skipped
   - Solution: Only bind inferred types when no explicit annotation exists
3. **Double-traversal corruption**: BaseAstTreeWalker visits children twice (once in visit(), once in auto-recurse)
   - Solution: Override visit() in scope-sensitive passes to prevent auto-recursion

### Module Caching & Symbol Merging

[Context.ts](../../src/compiler/Context.ts#L154) caches parsed modules to avoid re-parsing:
- First parse: runs all passes, caches symbols
- Subsequent parses: reuses cached symbols via `getModule()`
- Risk: symbol duplication if merging incorrectly

**Safe Pattern**: Use `symbolTable.joinWithoutDuplication()` to merge imported symbols.

### Desugaring Must Run Before Codegen

Pipeline transformations `(a |> b)` → `(b a)` and implicit returns must be complete before JavaScript generation. If JSTransformer receives unsugared AST, it will crash.

[Context.ts](../../src/compiler/Context.ts#L204) runs DesugarAstVisitor before types stage—do NOT move it.

## Testing & Validation

### Run Tests
```bash
npm test
```

### Example-Based Testing
All examples in `examples/` have `.expect` files showing expected output:
```bash
examples/01-basics/00_vars.lisp      # Input
examples/01-basics/00_vars.expect    # Expected stdout
examples/01-basics/00_vars.js        # Generated (after compile)
```

### Common Test Patterns

- **Type inference**: [examples/04-data-types/04_enums.lisp](../../examples/04-data-types/04_enums.lisp) (union types)
- **Scoping**: [examples/10-algorithms/01_evaluator.lisp](../../examples/10-algorithms/01_evaluator.lisp) (nested functions)
- **Classes**: [examples/05-oop/00_inheritance.lisp](../../examples/05-oop/00_inheritance.lisp) (super calls, member access)

## Build & Deployment

```bash
npm run build    # Compile TypeScript → dist/
npm run parser   # Regenerate PEG.js grammar
npm test         # Jest unit tests
```

**Note**: Grammar changes require `npm run parser` before `npm run build`.

## Debugging Tips

1. **Enable debug logging**: `ts-node ./src/index.ts transform ... -L Debug`
2. **Inspect AST**: Use `jq` on stage outputs (`.ast`, `.symbols`)
3. **Trace visitor calls**: Add `context.log(LogLevel.Info, ...)` in visitXxx methods
4. **Check scope chains**: TypeEnvironment has `debugScopeChain()` for scope stack inspection

---

**Last Updated**: January 2026 | Reflects Phase 3.5 architecture with integrated types
