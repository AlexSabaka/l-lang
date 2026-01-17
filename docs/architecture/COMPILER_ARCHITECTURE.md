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
[4] TREESHAKE     → Remove unused imports and dead code
    ↓
[5] COMPTIME      → Evaluate :comptime functions, inline results, remove definitions
    ↓
[6] TYPES         → Type inference (2-pass collect/infer) + validation
    ↓
[7] CODEGEN       → ESTree AST → JavaScript (astring)
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
│                     # ComptimeEvaluationAstVisitor (compile-time execution)
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

### 5. DefModifier Implementation Pattern

**Architecture**: DefModifier syntax `(defmodifier name [])` creates user-defined function transformers that operate at compile time.

**Implementation Phases**:

1. **Symbol Table Phase**: Register modifier definitions as `nodeType: "modifier-def"`
2. **Type Inference Phase**: Process modifier scopes and register function transformer types  
3. **Code Generation Phase**: Generate JavaScript modifier functions and apply them to modified functions

**Generated Code Pattern**:
```javascript
// Modifier definition generates transformer function
function __ll_modifier_memoized() {
  return originalFunction => {
    const cache = new Map();
    return (...args) => {
      const key = JSON.stringify(args);
      if (cache.has(key)) return cache.get(key);
      const result = originalFunction.apply(this, args);
      cache.set(key, result);
      return result;
    };
  };
}

// Modified function gets wrapped automatically  
const fibonacci = __ll_modifier_memoized()(function (n) {
  // Original function body
});
```

**Key Implementation Files**:
- [BuildSymbolTableAstVisitor.ts](../../src/compiler/analysis/visitors/BuildSymbolTableAstVisitor.ts) - `visitModifierDef()` methods
- [SymbolTable.ts](../../src/compiler/analysis/SymbolTable.ts) - Extended `defineSymbol()` for modifier-def nodes
- [InferTypesAstVisitor.ts](../../src/compiler/types/visitors/InferTypesAstVisitor.ts) - Modifier scope and type handling
- [JSTransformerAstVisitor.ts](../../src/compiler/codegen/js-estree/visitors/JSTransformerAstVisitor.ts) - `visitModifierDef()` and `applyModifiersToDeclaration()`

**Application Pattern**: Functions with `:modifier` syntax trigger `applyModifiersToDeclaration()` which wraps the function declaration with modifier transformations.

**Examples**: See `examples/06-modifiers/` for comprehensive usage patterns including memoization, logging, timing, and multiple modifier combinations.

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

### Performance Profiling

Use `--perf` flag to measure compilation pass performance and identify bottlenecks:

```bash
# Performance profiling for full compilation
ts-node ./src/index.ts transform --perf examples/05-oop/00_inheritance.lisp

# Profiling specific compilation stages
ts-node ./src/index.ts transform --perf --stage types examples/01-basics/08_pipelines.lisp

# Performance analysis while running code
ts-node ./src/index.ts run --perf examples/01-basics/07_memoization.lisp
```

**Typical Performance Characteristics**:
- **Parse stage**: 60-90% of compilation time (PEG.js parsing overhead)
- **Symbol resolution**: 2-8% with moderate memory usage 
- **Type inference**: 8-17% with highest memory consumption
- **Code generation**: 3-6% with visitor-intensive processing

**Key Metrics Tracked**:
- Pass-by-pass timing with percentages
- Memory usage and delta per pass
- AST node counts and visitor operations
- Pass-specific data (symbols count, output size, etc.)
- Bottleneck identification and optimization recommendations

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

### Comptime Evaluation (Phase 5)

**Purpose**: Execute compile-time functions and inline their results as constants.

**Implementation** ([ComptimeEvaluationAstVisitor.ts](../../src/compiler/transformation/visitors/ComptimeEvaluationAstVisitor.ts)):

1. **Detect Comptime Functions**: Check `modifiers` for `:comptime` flag
2. **VM Execution**:
   - Transpile function to JavaScript using JSTransformerAstVisitor
   - Execute in Node.js `vm` sandbox with timeout protection
   - Cache results in `comptimeValues` map
3. **Inline Results**: Replace function call nodes with NumberNode/StringNode literals
4. **Dead Code Elimination**: Return `null` from `visitList()` for comptime functions to mark for removal
5. **AST Filtering**: Parent visitors filter `null` values from child arrays

**Key Design Decisions**:
- Runs AFTER symbols phase to access symbol table for type information
- Runs BEFORE types phase so inlined values can be type-checked
- Uses DesugarAstVisitor locally (not globally) to handle implicit returns without breaking other constructs
- Recursive functions supported via proper function hoisting in VM context

**Example Flow**:
```typescript
// Input: (let x (factorial 5))
// 1. Detect factorial is comptime from symbol table
// 2. Transpile factorial function to JS
// 3. Execute in vm: factorial(5) → 120
// 4. Replace call node with NumberNode(120)
// 5. Mark factorial function definition for removal
// Output: const x = 120;
```

### Desugaring Must Run Before Codegen

Pipeline transformations `(a |> b)` → `(b a)` and implicit returns must be complete before JavaScript generation. If JSTransformer receives unsugared AST, it will crash.

**Note**: DesugarAstVisitor is NOT run globally anymore (removed from pipeline). It's only invoked locally within ComptimeEvaluationAstVisitor to handle implicit returns for comptime functions.

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
