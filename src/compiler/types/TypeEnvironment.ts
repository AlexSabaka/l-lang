import * as ast from "../frontend/ast";
import { InferredType, SymbolTable } from "../analysis/SymbolTable";

/**
 * TypeEnvironment - Manages type inference and binds inferred types to the symbol table
 * Maintains scope hierarchy during traversal and updates symbol entries with their inferred types
 */
export class TypeEnvironment {
  private symbolTable: SymbolTable;
  private scopeStack: Scope[] = [];

  // Built-in primitive types
  private static PRIMITIVES: Map<string, InferredType> = new Map([
    ["Int", { kind: "primitive", name: "Int" }],
    ["Real", { kind: "primitive", name: "Real" }],
    ["String", { kind: "primitive", name: "String" }],
    ["Char", { kind: "primitive", name: "Char" }],
    ["Boolean", { kind: "primitive", name: "Boolean" }],
    ["Void", { kind: "primitive", name: "Void" }],
    ["Any", { kind: "unknown", name: "Any" }],
  ]);

  /** Is `name` one of the language's built-in primitive types? */
  static isKnownPrimitive(name: string): boolean {
    return TypeEnvironment.PRIMITIVES.has(name);
  }

  constructor(symbolTable: SymbolTable) {
    this.symbolTable = symbolTable;
  }

  /**
   * Enter a new scope for type tracking
   */
  enterScope(node: ast.ASTNode): void {
    this.scopeStack.push({
      node,
      localTypes: new Map(),
      localIdentifiers: new Map(),
    });
  }

  /**
   * Exit the current scope
   */
  exitScope(): void {
    if (this.scopeStack.length > 0) {
      this.scopeStack.pop();
    }
  }

  /**
   * Set type for an expression node
   */
  setType(node: ast.ASTNode, type: InferredType): void {
    if (this.scopeStack.length === 0) {
      return;
    }
    const key = this.getNodeKey(node);
    this.scopeStack[this.scopeStack.length - 1].localTypes.set(key, type);
  }

  /**
   * Get type for an expression node
   */
  getType(node: ast.ASTNode): InferredType | undefined {
    const key = this.getNodeKey(node);
    // Search from innermost scope outward
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      const type = this.scopeStack[i].localTypes.get(key);
      if (type) {
        return type;
      }
    }
    return undefined;
  }

  /**
   * Bind a name to a type in the CURRENT SCOPE ONLY. It disappears at `exitScope`, and
   * `resolveIdentifier` consults it BEFORE the symbol table, so it shadows the declaration.
   *
   * The distinction from `bindIdentifier` is load-bearing and easy to get wrong: `bindIdentifier`
   * writes THROUGH to the symbol table, which is neither scoped nor reversible. Narrowing bound with
   * it would narrow `h` for the rest of the PROGRAM -- the nil-check believed everywhere, which is
   * strictly worse than not believing it at all, because it reports nothing while proving nothing.
   *
   * `bindTypeParameter` has always done exactly this -- it is how a generic `T` gets bound. This is
   * the same operation under a name that says what it does.
   */
  bindInScope(name: string, type: InferredType): void {
    if (this.scopeStack.length === 0) {
      return;
    }
    this.scopeStack[this.scopeStack.length - 1].localIdentifiers.set(name, type);
  }

  /** Bind a generic type parameter to a type in the current scope. */
  bindTypeParameter(name: string, type: InferredType): void {
    this.bindInScope(name, type);
  }

  /**
   * Bind an identifier to a type in the symbol table, on the symbol `name` denotes AS SEEN FROM
   * `node`. PERMANENT (it survives the scope) but no longer scope-BLIND -- see `bindInScope` for the
   * reversible, branch-local variant that narrowing needs.
   *
   * `node` was always in this signature and was always thrown away: the body was
   * `this.symbolTable.bindType(name, type)`, a flat write. A parameter's type, a local `let`'s type
   * -- every one of them was written to whatever top-level symbol happened to share the name, or to
   * nowhere at all. The plumbing was drilled and never connected.
   */
  bindIdentifier(name: string, type: InferredType, node: ast.ASTNode): void {
    this.symbolTable.bindType(name, type, node);
  }

  /**
   * Resolve type for an identifier (generics, primitives, or symbol types)
   */
  resolveIdentifier(name: string): InferredType | undefined {
    // Check if it's a generic type parameter in current scope
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      const typeParam = this.scopeStack[i].localIdentifiers.get(name);
      if (typeParam) {
        return typeParam;
      }
    }
    
    // Check if it's a built-in primitive
    if (TypeEnvironment.PRIMITIVES.has(name)) {
      return TypeEnvironment.PRIMITIVES.get(name);
    }
    
    // Support dot notation for member access
    if (name.includes('.')) {
        const parts = name.split('.');
        let currentType = this.resolveIdentifier(parts[0]);
        
        if (!currentType) return undefined;
        
        for (let i = 1; i < parts.length; i++) {
           if (!currentType) return undefined;
           
           // Resolve type-ref to actual type definition if needed
           if (currentType.kind === 'type-ref' && currentType.refName) {
               const resolved = this.resolveIdentifier(currentType.refName);
               if (resolved) currentType = resolved;
           }

           const memberName = parts[i];
           // Lookup member in currentType
           if (currentType.kind === 'class' || currentType.kind === 'struct' || currentType.kind === 'interface') {
               const member: any = currentType.members?.find((m: any) => m.name === memberName);
               if (member) {
                   currentType = member.type;
               } else {
                   // Member not found in 'members' list
                   // TODO: Handle interface inheritance lookups if needed
                   return undefined;
               }
           } else {
               // Cannot access property on non-object type (primitive/func)
               return undefined;
           }
        }
        return currentType;
    }

    // Check symbol table for user-defined types
    const symbol = this.symbolTable.resolveSymbol(name);
    if (symbol && symbol.inferredType) {
      return symbol.inferredType;
    }

    return undefined;
  }

  /**
   * Debug: Get current scope chain
   */
  debugScopeChain(): string {
    return this.scopeStack.map((s, i) => {
      const nodeType = (s.node && ((s.node as any)._type ?? (s.node as any).name?.name)) || 'root';
      return `${i}: ${nodeType}(${[...s.localTypes.keys()].length} types)`;
    }).join(' -> ');
  }

  /**
   * Create a unique key for an AST node
   */
  private getNodeKey(node: ast.ASTNode): string {
    return `${node._type}_${node._location.start.offset}_${node._location.end.offset}`;
  }

  /**
   * Helper to create primitive types
   */
  static primitive(name: string): InferredType {
    return { kind: "primitive", name };
  }

  /**
   * Helper to create array types
   */
  static array(elementType: InferredType): InferredType {
    return {
      kind: "generic",
      name: "Array",
      generics: [elementType],
      isArray: true,
    };
  }

  /**
   * Helper to create map types (Dictionary<K, V>)
   */
  static map(keyType: InferredType, valueType: InferredType): InferredType {
    return {
      kind: "map",
      name: "Map",
      keyType,
      valueType,
    };
  }

  /**
   * Helper to create function types
   */
  static function(
    params: InferredType[],
    returns: InferredType,
    isVariadic = false
  ): InferredType {
    return {
      kind: "function",
      name: "Function",
      params,
      returns,
      ...(isVariadic ? { isVariadic } : {}),
    };
  }

  /**
   * Helper to create union types
   */
  static union(alternatives: InferredType[]): InferredType {
    return {
      kind: "union",
      name: alternatives.map(t => t.name).join(" | "),
      alternatives,
    };
  }

  /**
   * Unknown type for expressions we can't infer yet
   */
  static unknown(): InferredType {
    return { kind: "unknown", name: "Unknown" };
  }

  /**
   * `Any` -- the top type, and what an ABSENT annotation means.
   *
   * The same `kind` as `unknown()`, so gradual typing is unaffected: `isUnknown` is true for both,
   * and `isAssignable` already lets `Any` accept everything. The difference is what the type is
   * CALLED, and that difference is the whole point:
   *
   *   Any      the source declared nothing, so anything goes -- a statement about the PROGRAM
   *   Unknown  we tried to infer and failed                  -- a statement about the COMPILER
   *
   * Reporting `type: 'Unknown'` for `(let :ctor name)` tells the user their compiler is confused,
   * when in fact their code simply said nothing. Both metadata goldens say `Any`, and the runtime
   * converter still carries a `m.type.name || 'Any'` fallback from when this was the default --
   * unreachable, because `Unknown` is a truthy name.
   */
  static any(): InferredType {
    return { kind: "unknown", name: "Any" };
  }

  /**
   * `T?` -- a type that also admits nil (D9).
   *
   * A FLAG on the type, not a wrapper and not `T | Nil`. That is deliberate, and it is the ruling's
   * own reasoning: `T?` is a memory-layout decision for the native backend (`T` = a raw value with no
   * null check, `T?` = tagged or niche-packed), and a flag is what that lowers to. A union would also
   * have made `T?` structurally equal to a one-armed union of `T`, which it is not.
   *
   * Idempotent: `T??` is `T?`.
   */
  static optional(type: InferredType): InferredType {
    return type.optional ? type : { ...type, optional: true };
  }

  /**
   * The type of the `nil` LITERAL. Assignable only to an optional target -- that rule is the whole of
   * "non-nullable by default", and it was already in force before D9: nothing ever set the flag on a
   * target, so `(let x <- String nil)` has always been an LL0200.
   */
  static nil(): InferredType {
    return { kind: "primitive", name: "Nil" };
  }
}

/**
 * Local scope for type tracking
 */
interface Scope {
  node: ast.ASTNode;
  localTypes: Map<string, InferredType>;
  localIdentifiers: Map<string, InferredType>;  // For generic type parameters
}
