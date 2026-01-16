# l-lang Compiler: AI Development Guide

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

**Key Files**: [Context.ts](src/compiler/Context.ts#L39) defines `CompilationStage` type and orchestrates all passes via `process(file, stopAt)` method.

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

**Symbols Pass** (BuildSymbolTableAstVisitor):
- **ScanPass**: Collects all top-level declarations (functions, classes, variables)
- **ResolvePass**: Links identifiers to symbol entries, handles forward references

**Type Inference** (InferTypesAstVisitor):
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

**Affected Files**: InferTypesAstVisitor.ts, BuildSymbolTableAstVisitor.ts

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

1. Edit [l-lang.pegjs](src/compiler/frontend/grammar/l-lang.pegjs)
2. Regenerate parser:
   ```bash
   npm run parser
   ```
3. Update AST types in [ast.ts](src/compiler/frontend/ast.ts)
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

[Context.ts](src/compiler/Context.ts#L154) caches parsed modules to avoid re-parsing:
- First parse: runs all passes, caches symbols
- Subsequent parses: reuses cached symbols via `getModule()`
- Risk: symbol duplication if merging incorrectly

**Safe Pattern**: Use `symbolTable.joinWithoutDuplication()` to merge imported symbols.

### Desugaring Must Run Before Codegen

Pipeline transformations `(a |> b)` → `(b a)` and implicit returns must be complete before JavaScript generation. If JSTransformer receives unsugared AST, it will crash.

[Context.ts](src/compiler/Context.ts#L204) runs DesugarAstVisitor before types stage—do NOT move it.

### Code Generation: List Semantics & Call vs Reference Disambiguation

**Critical Understanding**: In l-lang, parentheses determine call vs reference semantics:
- `(func)` or `(func args)` → **function call** (generates CallExpression)
- `func` → **reference** (generates Identifier for passing to higher-order functions)

**Problem**: JSTransformerAstVisitor must distinguish between:
1. Function calls: `(console.log x)` → `console.log(x)`
2. Object construction: `(new Dog "Buddy")` → `new Dog("Buddy")`
3. Property access: `p.x` → reference, not `p.x()`
4. Method calls: `(p.speak)` → `p.speak()` (even without args)

**Solution Pattern in visitList() (lines 1602-1695)**:

```typescript
// 1. Handle "new" keyword explicitly
if (firstNode._type === "identifier" && firstNode.value === "new") {
  return ESTreeBuilder.NewExpression(className, constructorArgs);
}

// 2. Composite identifiers (e.g., p.x, console.log)
if (firstNode._type === "composite-identifier") {
  const hasArgs = node.nodes.length > 1;
  const parts = firstNode.parts;
  const lastName = parts[parts.length - 1].value;
  
  // If args present OR lastName looks like method → CallExpression
  if (hasArgs || isMethodName(lastName)) {
    return CallExpression(memberExpr, args);
  }
  // No args and not method name → MemberExpression (property access)
  return memberExpr;
}

// 3. Zero-arg function calls (requires symbol tracking)
if (firstNode._type === "identifier" && node.nodes.length === 1) {
  const originalName = decodeIdentifier(firstNode.value);
  if (this.functions.has(originalName) || this.classes.has(originalName)) {
    return CallExpression(identifier, []);
  }
  // Not a known function → return reference
  return identifier;
}
```

**Heuristics** (when type info unavailable at codegen):
- Method name whitelist: `speak`, `toString`, `valueOf`, `keys`, `values`, etc.
- Function tracking: `this.functions` and `this.classes` sets populated during traversal
- Identifier encoding: Must use `decodeIdentifier()` to handle `make-fib` → `make2dfib` mapping

**Common Bugs** (Jan 2026 fixes):
1. **Composite identifiers always called**: Fixed by checking args presence + method name heuristic
2. **`new` keyword ignored**: Added explicit check before general identifier handling
3. **Zero-arg calls returned as references**: Fixed by checking `this.functions` set with decoded names
4. **Method calls without args treated as property access**: Added method name whitelist
5. **Operator Method Shadowing**: Fixed by appending arity to operator method names (e.g., `_2d_0` for unary, `_2d_1` for binary) to allow both in the same class prototype.

### 5. Operator Overloading & Dynamic Dispatch

**Architecture**: L-lang uses a hybrid dispatch system for operators like `+`, `-`, `*`, `/`, `==`.

1.  **Standalone Overloads**: Functions with `:operator` modifier are registered via `__ll_op_registry.register(symbol, typeNames, function)`.
2.  **Method Overloads**: Classes/structs implement `_xxx_arity` methods.
3.  **Runtime Helpers**: The `RuntimeProvider.ts` emits helper functions (e.g., `const _2b = (...) => ...`) that:
    - Attempt `__ll_op_registry.lookup` first.
    - If no overload, attempt method call on the left operand (e.g., `a._2b_1(b)`).
    - Fall back to native JS (e.g., `a + b`).

**Codegen Pattern**:
```typescript
if (isOperator && name) {
  if (isProgramScope) {
    // Register standalone overload
    this.operatorRegistrations.push(registerCall(originalName, paramTypes, internalName));
  } else if (isMethodScope) {
    // Append arity to method name
    name.name = `${name.name}_${node.params.length}`;
  }
}
```

**Testing Strategy**: Use examples with `.expect` files to validate output:
```bash
npm test  # Runs all 30 validated examples (100% passing as of Jan 16, 2026)
```

## Testing & Validation

### Run Tests
```bash
npm test                # Run all tests via unified TypeScript runner
./test_all.sh          # Alternative: bash wrapper with same functionality
npm test -- --verbose  # Show diffs for failed tests
```

**Current Status** (Jan 15, 2026): 27/27 tests passing (100%), 38 examples pending .expect files

### Test Infrastructure

**Unified Test Runner** ([src/test/runner.ts](src/test/runner.ts)):
- Recursively finds all `.lisp` files in `examples/`
- For each file with `.expect`: compiles → executes → compares output
- Color-coded output: ✅ PASS, ❌ FAIL, ⚠️ SKIP, 💥 ERROR
- Verbose mode: `--verbose` flag shows detailed diffs
- CI-friendly: exits with code 0 (all pass) or 1 (failures/errors)

**Test Workflow**:
```bash
# 1. Create example file
examples/01-basics/new_feature.lisp

# 2. Generate expected output
ts-node src/index.tRun example-based integration tests
```

**Note**: Grammar changes require `npm run parser` before `npm run build`.

**Pre-commit Checklist**:
1. Run `npm run parser` if grammar changed
2. Run `npm run build` to ensure TypeScript compiles
3. Run `npm test` to verify all 27 tests pass
4. Verify no regressions in generated JavaScript code
npm test

# 4. Debug failures
npm test -- --verbose  # Shows exact diff between expected vs actual
```

### Example-Based Testing

All examples in `examples/` with `.expect` files are auto-validated:
```bash
examples/01-basics/00_vars.lisp      # Input (l-lang source)
examples/01-basics/00_vars.expect    # Expected stdout when running .js
examples/01-basics/00_vars.js        # Generated JavaScript (transient)
```

**Skip Logic**: Examples without `.expect` files are reported as SKIP (not failures)

### Common Test Patterns

- **Type inference**: [examples/04-data-types/04_enums.lisp](examples/04-data-types/04_enums.lisp) (union types)
- **Scoping**: [examples/10-algorithms/01_evaluator.lisp](examples/10-algorithms/01_evaluator.lisp) (nested functions)
- **Classes**: [examples/05-oop/00_inheritance.lisp](examples/05-oop/00_inheritance.lisp) (super calls, member access)
- **Closures**: [examples/01-basics/07_memoization.lisp](examples/01-basics/07_memoization.lisp) (closure capture)
- **Pattern matching**: [examples/01-basics/03_matching.lisp](examples/01-basics/03_matching.lisp) (match expressions)

## Build & Deployment

```bash
npm run build    # Compile TypeScript → dist/
npm run parser   # Regenerate PEG.js grammar
npm test         # Jest unit tests
```

**Note**: Grammar changes require `npm run parser` before `npm run build`.

5. **Compare generated JavaScript**: Use `--stage codegen` and inspect `.js` file for unexpected output
6. **Test-driven debugging**: Create minimal `.lisp` example + `.expect` file, run `npm test -- --verbose`

## Known Limitations & Workarounds

### Codegen Phase Lacks Type Information

**Problem**: JavaScript generation (phase 6) operates on desugared AST without type annotations. Cannot distinguish methods from properties by type alone.

**Current Workaround**: Heuristic-based disambiguation in `visitList()`:
- Method name whitelist for common patterns (`speak`, `toString`, etc.)
- Function/class tracking via `this.functions` and `this.classes` sets
- Presence of arguments as primary signal

**Future Solution**: Pass type information from phase 5 (types) to phase 6 (codegen) via AST decoration or parallel data structure.

### Identifier Encoding Inconsistency

**Problem**: L-lang identifiers with hyphens (`make-fib`) are encoded to valid JS (`make2dfib`). Must use `decodeIdentifier()` when looking up symbols.

**Pattern**:
```typescript
// WRONG: Will fail for hyphenated names
if (this.functions.has(node.value)) { ... }

// CORRECT: Decode first
const originalName = decodeIdentifier(node.value);
if (this.functions.has(originalName)) { ... }
```

**Affected Files**: JSTransformerAstVisitor.ts, anywhere comparing against symbol table

### Test Coverage Gaps

**Status**: 27/65 examples have `.expect` files (41.5% coverage)

**Priority for `.expect` creation**:
1. Core features without coverage (async/await, destructuring)
2. Edge cases discovered during development
3. Regression tests for fixed bugs

---

**Last Updated**: Jan 15, 2026 | Added codegen patterns, test infrastructure, known limitation
3. **Trace visitor calls**: Add `context.log(LogLevel.Info, ...)` in visitXxx methods
4. **Check scope chains**: TypeEnvironment has `debugScopeChain()` for scope stack inspection

---

**Last Updated**: Jan 2, 2026 | Reflects Phase 3.5 architecture with integrated types
