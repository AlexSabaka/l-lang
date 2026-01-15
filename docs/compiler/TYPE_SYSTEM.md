# 🧬 Type System Architecture

## Overview

The l-lang type system provides static, compile-time type checking with TypeScript-style structural typing, union types, and full generic support.

## Type System Components

### InferredType (Symbol Table Integration)

Located in [SymbolTable.ts](../../src/compiler/analysis/SymbolTable.ts#L50)

```typescript
interface InferredType {
  kind: "primitive" | "class" | "interface" | "generic" | "function" 
      | "union" | "unknown" | "map" | "array"
      | "type-alias" | "struct" | "type-ref";
  
  name: string;
  generics?: InferredType[];        // Generic type parameters
  params?: InferredType[];          // Function parameters
  returns?: InferredType;           // Function return type
  alternatives?: InferredType[];    // Union type alternatives
  keyType?: InferredType;           // Map key type
  valueType?: InferredType;         // Map value type
  inner?: InferredType;             // Array element type / alias target
  isArray?: boolean;
  nullable?: boolean;
  
  // Type-alias specific
  aliasedType?: InferredType;
  isRecursive?: boolean;
  typeReferences?: string[];
  
  // Struct specific
  members?: StructMember[];
  constructor?: ConstructorInfo;
  
  // Type-ref specific (forward reference)
  refName?: string;
  resolved?: boolean;
}
```

### TypeEnvironment (Scope Management)

Located in [TypeEnvironment.ts](../../src/compiler/types/TypeEnvironment.ts)

Manages type bindings across nested scopes:
- Program scope (global)
- Function scopes (parameters visible to body)
- Class scopes (member visibility)
- Block scopes (if/for/while)

**Key Methods:**
- `enterScope()` - Push new scope
- `exitScope()` - Pop scope and clear bindings
- `bindIdentifier(name, type, node)` - Register type for identifier
- `resolveIdentifier(name)` - Look up type in scope chain

### TypeChecker (Compatibility Rules)

Located in [TypeChecker.ts](../../src/compiler/types/TypeChecker.ts)

Implements type compatibility rules:
- **Primitive compatibility**: Int assignable to Real, etc.
- **Union handling**: Value of type `A` assignable to union `A | B`
- **Generic variance**: Array<Int> assignable to Array<Int>, not Array<Object>
- **Structural typing**: Objects assignable if they have required shape
- **Type-alias unwrapping**: Aliases unwrapped before checking compatibility

## Type Inference Pipeline

### Two-Pass Analysis

**Pass 1: CollectTypesPass** 
- Walks AST and collects explicit type annotations
- Records function signatures, class members, type aliases
- Registers types in symbol table

**Pass 2: InferAndCheckPass**
- Infers types for expressions without annotations
- Validates type assignments and function calls
- Resolves forward references and circular dependencies

### How Types Flow Through Compilation

```
1. PARSE: Extract raw AST with no type info
   ↓
2. SYMBOLS: Register function/class/variable names
   ↓
3. TYPES (CollectPass): Record explicit type annotations
        ├─ (let x <- Int 5) → x: Int
        ├─ (fn add [a <- Int b <- Int] -> Int ...) → add: Int → Int → Int
        └─ (deftype Expr ...) → Expr: type-alias
   ↓
4. TYPES (InferPass): Infer missing types and validate
        ├─ (+ 1 2) → inferred as Int
        ├─ (list.push "hello") → type error if list is Int[]
        └─ Resolve recursive type references
   ↓
5. DESUGAR: Transform complex syntax (no type changes)
   ↓
6. CODEGEN: Generate JavaScript with types embedded as comments
```

## Special Type Cases

### Recursive Type-Aliases

Example:
```lisp
(deftype Expr (Int | String | Expr)[])
```

**Challenge**: Expr references itself during definition.

**Solution**: Three-phase registration
1. Register placeholder (enables forward refs)
2. Build aliased type structure
3. Mark as recursive and track references

### User-Defined Structs

Example:
```lisp
(defstruct vec2
    (let :ctor x <- Real 0)
    (let :ctor y <- Real 0))
```

**Tracks**:
- Member fields with types
- Constructor parameter names, types, and default values
- Method signatures

### Union Types

```lisp
(let status <- Int | String "loading")
(status := 200)  ;; Valid - Int in union
```

**Rule**: Value assignable to union if it matches any alternative.

## Type Representation in JSON Output

After the `types` compilation stage, symbol entries include inferred types:

```json
{
  "symbols": {
    "entries": {
      "greet": {
        "name": "greet",
        "nodeType": "function",
        "inferredType": {
          "kind": "function",
          "params": [
            {"kind": "primitive", "name": "String"}
          ],
          "returns": {"kind": "primitive", "name": "String"}
        }
      },
      "MyClass": {
        "name": "MyClass",
        "nodeType": "class",
        "inferredType": {
          "kind": "class",
          "name": "MyClass",
          "members": [
            {"name": "x", "type": {"kind": "primitive", "name": "Int"}}
          ]
        }
      }
    }
  }
}
```

## Common Type Issues & Solutions

### Issue: Unknown Type in Symbol Entry

**Cause**: Type inference didn't visit the node

**Solution**:
- Check if node is wrapped in list (see [Architecture Guide](COMPILER_ARCHITECTURE.md#3-ast-structure-quirk-list-wrapped-declarations))
- Ensure visitXxx method called for declaration type
- Verify scope entry/exit in two-pass analysis

### Issue: Type Incompatibility Error

**Cause**: Assigned type doesn't match declaration

**Solutions**:
- Verify explicit type annotation matches usage
- Check if assigning to wrong union alternative
- Ensure type-alias unwrapping works correctly

### Issue: Forward Reference Unresolved

**Cause**: Type used before definition

**Solution**: Two-pass analysis handles this automatically, but verify:
- Type registered in CollectTypesPass
- Reference resolved in InferAndCheckPass
- No circular dependency breaking resolution

## Adding Support for New Type Kinds

When extending the type system:

1. **Extend InferredType interface** in [SymbolTable.ts](../../src/compiler/analysis/SymbolTable.ts)
   ```typescript
   kind: "..." | "newKind";
   newKindField?: YourType;
   ```

2. **Add visitXxx to CollectTypesPass** in [InferTypesAstVisitor.ts](../../src/compiler/types/visitors/InferTypesAstVisitor.ts)
   - Collect explicit type annotations

3. **Add visitXxx to InferAndCheckPass**
   - Infer missing types
   - Validate constraints

4. **Update TypeChecker.isAssignable()** in [TypeChecker.ts](../../src/compiler/types/TypeChecker.ts)
   - Define compatibility rules for new kind

5. **Update TypeChecker.formatType()** 
   - Add formatting for debug output

6. **Test with transform stage**:
   ```bash
   ts-node ./src/index.ts transform --stage types example.lisp
   cat example.types.json | jq '.symbols.entries'
   ```

## Related Documentation

- [Language Syntax Reference](../language/SYNTAX.md) - How to use types in l-lang
- [Compiler Architecture](../architecture/COMPILER_ARCHITECTURE.md) - How types flow through compilation
- [Implementation Details](../development/TYPE_SYSTEM_PLAN.md) - Detailed implementation roadmap
