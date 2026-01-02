import * as ast from "../frontend/ast";

export enum ScopeType {
  program = "program",
  class = "class",
  interface = "interface",
  function = "function",
  variable = "variable",
  method = "method",
  match = "match",
  when = "when",
  if = "if",

  // list = "list",
  // quote = "quote",
  // vector = "vector",
  // map = "map",
  // for = "for",
  // foreach = "foreach",
  // while = "while",
  // try = "try",
  // catch = "catch",
  // await = "await",
  // export = "export",
  // import = "import",
  // typedef = "typedef",
  // pattern = "pattern",
  // parameter = "parameter",
}

export function isNodeScope(type: any): type is ScopeType {
  return [ "program", "class", "interface", "function", "variable", "method", "match", "when", "if" ].includes(type);
}

export type SymbolVisibility = "public" | "private" | "protected" | "internal";

export function isVisibilityModifier(modifier: ast.ModifierNode["modifier"]): modifier is SymbolVisibility {
  return [ "public", "private", "protected", "internal" ].includes(modifier);
}

/**
 * Inferred type information for a symbol
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

export interface SymbolEntry {
  name: ast.IdentifierNode | ast.TypeNameNode;
  nodeType: ast.NodeType;  // The AST node type (variable, function, class, etc)
  scope: Scope;
  value: ast.ASTNode;
  mutability: boolean;
  exportName: ast.IdentifierNode | ast.TypeNameNode | undefined;
  visibility: SymbolVisibility;
  // Type information integrated into symbol entry
  inferredType?: InferredType;  // The inferred or declared type of this symbol
}

export interface Scope {
  node: ast.ASTNode;
  type: ast.ASTNode["_type"];
  table: Map<string, SymbolEntry>;
  scopes: Scope[];
  parent: Scope | undefined;
}

export class SymbolTable {
  private scopes: Scope[] = [];
  private symbolCache: Map<string, SymbolEntry> = new Map();
  private cacheValid: boolean = true;

  constructor(root: Scope | undefined) {
    if (root) {
      this.scopes.push(root);
    }
  }

  /**
   * Bind a type to an existing symbol
   */
  bindType(name: string, type: InferredType): void {
    const symbol = this.resolveSymbol(name);
    if (symbol) {
      symbol.inferredType = type;
    }
  }

  /**
   * Resolve a symbol by identifier or string name
   */
  resolveSymbol(name: ast.IdentifierNode | ast.TypeNameNode | string): SymbolEntry | undefined {
    const symbolName = typeof name === "string" ? name : (name.name ?? name.id);
    
    // Check cache first for O(1) lookup
    if (this.cacheValid && this.symbolCache.has(symbolName)) {
      return this.symbolCache.get(symbolName);
    }

    // If cache is not valid, build it now from the scopes.
    if (!this.cacheValid) {
      this.symbolCache.clear();
      for (const s of this.scopes) {
        let current: Scope | undefined = s;
        while (current !== undefined) {
          for (const [k, sym] of current.table.entries()) {
            if (!this.symbolCache.has(k)) {
              this.symbolCache.set(k, sym);
            }
          }
          current = current.parent;
        }
      }
      this.cacheValid = true;
      return this.symbolCache.get(symbolName);
    }

    // Cache is marked valid but symbol not found in cache — fall back to
    // the original recursive search to preserve resolution semantics
    // when incremental updates may not have populated the cache yet.
    for (let s of this.scopes) {
      const symbol = this.findSymbolRecursively(symbolName, s);
      if (symbol) {
        // Cache the result
        this.symbolCache.set(symbolName, symbol);
        return symbol;
      }
    }
    return undefined;
  }

  join(other: SymbolTable): SymbolTable {
    this.scopes = [...this.scopes, ...other.scopes];
    // Invalidate cache after joining symbol tables
    this.cacheValid = false;
    this.symbolCache.clear();
    return this;
  }

  /**
   * Join symbol tables while avoiding duplication of re-exported symbols
   * Returns count of new symbols added
   */
  joinWithoutDuplication(other: SymbolTable): number {
    let addedCount = 0;
    
    for (const scope of other.scopes) {
      // Check if scope already exists
      const existingScope = this.scopes.find(s => s.node === scope.node);
      
      if (existingScope) {
        // Merge symbol tables, skipping duplicates
        for (const [key, symbol] of scope.table.entries()) {
          if (!existingScope.table.has(key)) {
            existingScope.table.set(key, symbol);
            addedCount++;
          }
        }
      } else {
        // New scope, add it
        this.scopes.push(scope);
        addedCount += scope.table.size;
      }
    }

    // Invalidate cache after joining
    this.cacheValid = false;
    this.symbolCache.clear();
    return addedCount;
  }

  private findSymbolRecursively(name: string, scope: Scope | undefined) {
    let current: Scope | undefined = scope;
    let symbol: SymbolEntry | undefined = undefined;
    while (symbol === undefined && current !== undefined) {
      symbol = current.table.get(name);
      current = current.parent;
    }
    return symbol;
  }
}

export class SymbolTableBuilder {
  private root: Scope | undefined;
  private active: Scope | undefined;

  build(): SymbolTable {
    return new SymbolTable(this.root);
  }

  enterScope(node: ast.ASTNode) {
    const nodeType = node._type as any;
    if (!isNodeScope(nodeType)) {
      return;
    }

    const scopeType = nodeType as ScopeType;
    if (this.root === undefined) {
      if (scopeType != ScopeType.program) {
        throw new Error("Something fishy going on with scopes.");
      }

      this.root = {
        type: scopeType,
        node: node,
        table: new Map<string, SymbolEntry>(),
        scopes: [],
        parent: undefined,
      };
    }

    if (this.active === undefined) {
      this.active = this.root;
    }

    if (this.active.node === node) {
      return;
    }

    const newScope = {
      type: node._type,
      node: node,
      table: new Map<string, SymbolEntry>(),
      scopes: [],
      parent: this.active,
    };

    this.active.scopes.push(newScope);

    this.active = newScope;
  }

  exitScope() {
    if (this.root === undefined) {
      throw new Error("No root scope. Cannot exit.");
    }

    if (this.active === undefined) {
      throw new Error("No active scope. Cannot exit.");
    }

    if (this.active.parent === undefined) {
      throw new Error("Already at the root scope. Cannot exit.");
    }

    this.active = this.active.parent;
  }

  defineSymbol(node: ast.VariableNode | ast.FunctionNode | ast.ClassNode | ast.InterfaceNode) {
    if (this.root === undefined) {
      throw new Error("No root scope. Cannot define symbol.");
    }

    if (this.active === undefined) {
      throw new Error("No active scope. Cannot define symbol.");
    }

    this.active.table.set(node.name?.id ?? node.name?.name, {
      name: node.name,
      nodeType: node._type,
      scope: this.active,
      value: node,
      mutability: node.mutable ?? false,
      exportName: undefined,
      visibility: node.modifiers.filter(x => isVisibilityModifier(x.modifier)).at(0)?.modifier as SymbolVisibility,
      // inferredType will be populated during type inference phase
    });
  }

  resolveSymbol(name: ast.IdentifierNode | ast.TypeNameNode): SymbolEntry | undefined {
    if (this.root === undefined) {
      throw new Error("No root scope. Cannot resolve symbol.");
    }

    if (this.active === undefined) {
      throw new Error("No active scope. Cannot resolve symbol.");
    }

    return this.findSymbolRecursively(name.name ?? name.id, this.active);
  }

  private findSymbolRecursively(name: string, scope: Scope) {
    let current: Scope | undefined = scope;
    let symbol: SymbolEntry | undefined = undefined;
    while (symbol === undefined && current !== undefined) {
      symbol = current.table.get(name);
      current = current.parent;
    }
    return symbol;
  }

  /**
   * Get the root scope
   */
  getRoot(): Scope | undefined {
    return this.root;
  }
}
