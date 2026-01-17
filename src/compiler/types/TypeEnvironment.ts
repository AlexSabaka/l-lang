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
   * Bind a generic type parameter to a type in the current scope
   */
  bindTypeParameter(name: string, type: InferredType): void {
    if (this.scopeStack.length === 0) {
      return;
    }
    this.scopeStack[this.scopeStack.length - 1].localIdentifiers.set(name, type);
  }

  /**
   * Bind an identifier to a type in the symbol table
   */
  bindIdentifier(name: string, type: InferredType, node: ast.ASTNode): void {
    this.symbolTable.bindType(name, type);
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
  static function(params: InferredType[], returns: InferredType): InferredType {
    return {
      kind: "function",
      name: "Function",
      params,
      returns,
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
}

/**
 * Local scope for type tracking
 */
interface Scope {
  node: ast.ASTNode;
  localTypes: Map<string, InferredType>;
  localIdentifiers: Map<string, InferredType>;  // For generic type parameters
}
