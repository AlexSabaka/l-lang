import * as ast from "../frontend/ast";

/**
 * Represents an inferred or declared type in the system
 */
export interface InferredType {
  kind: "primitive" | "class" | "interface" | "generic" | "function" | "union" | "unknown" | "map";
  name: string;
  generics?: InferredType[];
  params?: InferredType[];  // For function types
  returns?: InferredType;   // For function types
  alternatives?: InferredType[];  // For union types
  keyType?: InferredType;   // For map types
  valueType?: InferredType; // For map types
  inner?: InferredType;     // For array element type (alternative to generics[0])
  isArray?: boolean;
  nullable?: boolean;
}

/**
 * Type environment entry - associates an AST node with its inferred type
 */
export interface TypeEntry {
  node: ast.ASTNode;
  type: InferredType;
  scope: TypeScope;
}

/**
 * Scope for type resolution
 */
export interface TypeScope {
  node: ast.ASTNode;
  types: Map<string, TypeEntry>;
  scopes: TypeScope[];
  parent: TypeScope | undefined;
}

/**
 * TypeEnvironment - Manages type inference state across the compilation
 * Similar to SymbolTable but specifically for type information
 */
export class TypeEnvironment {
  private root: TypeScope | undefined;
  private active: TypeScope | undefined;
  private typeCache: Map<string, InferredType> = new Map();

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

  constructor() {
    // Initialize with built-in types
    TypeEnvironment.PRIMITIVES.forEach((type, name) => {
      this.typeCache.set(name, type);
    });
  }

  /**
   * Enter a new type scope
   */
  enterScope(node: ast.ASTNode) {
    if (!this.root) {
      this.root = {
        node,
        types: new Map(),
        scopes: [],
        parent: undefined,
      };
      this.active = this.root;
      return;
    }

    if (!this.active) {
      this.active = this.root;
    }

    if (this.active.node === node) {
      return;
    }

    const newScope: TypeScope = {
      node,
      types: new Map(),
      scopes: [],
      parent: this.active,
    };

    this.active.scopes.push(newScope);
    this.active = newScope;
  }

  /**
   * Exit current scope
   */
  exitScope() {
    if (!this.active || !this.active.parent) {
      throw new Error("Cannot exit root scope or no active scope");
    }
    this.active = this.active.parent;
  }

  /**
   * Associate a node with an inferred type
   */
  setType(node: ast.ASTNode, type: InferredType) {
    if (!this.active) {
      throw new Error("No active scope to set type");
    }

    const key = this.getNodeKey(node);
    this.active.types.set(key, {
      node,
      type,
      scope: this.active,
    });
  }

  /**
   * Bind an identifier to a type in the current scope
   */
  bindIdentifier(name: string, type: InferredType, node: ast.ASTNode) {
    if (!this.active) {
      throw new Error("No active scope to bind identifier");
    }

    this.active.types.set(name, {
      node,
      type,
      scope: this.active,
    });
  }

  /**
   * Resolve type for an identifier
   */
  resolveIdentifier(name: string): InferredType | undefined {
    let current: TypeScope | undefined = this.active;

    while (current) {
      const entry = current.types.get(name);
      if (entry) {
        return entry.type;
      }
      current = current.parent;
    }

    // Check primitives
    return this.typeCache.get(name);
  }

  /**
   * Return a debug representation of the scope chain (node types and keys)
   */
  debugScopeChain(): string {
    const chain: string[] = [];
    let c: TypeScope | undefined = this.active;
    while (c) {
      const nodeType = (c.node && ((c.node as any)._type ?? (c.node as any).name?.name)) || 'root';
      chain.push(`${nodeType}(${[...c.types.keys()].join(',')})`);
      c = c.parent;
    }
    return chain.join(' -> ');
  }

  /**
   * Get type for a specific AST node
   */
  getType(node: ast.ASTNode): InferredType | undefined {
    const key = this.getNodeKey(node);
    let current: TypeScope | undefined = this.active;

    while (current) {
      const entry = current.types.get(key);
      if (entry) {
        return entry.type;
      }
      current = current.parent;
    }

    return undefined;
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