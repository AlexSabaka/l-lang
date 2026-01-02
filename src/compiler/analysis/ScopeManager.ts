import * as ast from "../frontend/ast";

/**
 * ScopeManager - Base class for scope-based information management
 * Provides common scope hierarchy and resolution logic for SymbolTable, TypeEnvironment, etc.
 */
export interface ScopeEntry {
  node: ast.ASTNode;
  // Entry type can vary - will be extended by subclasses
  [key: string]: any;
}

export interface Scope {
  node: ast.ASTNode;
  type: ast.ASTNode["_type"];
  entries: Map<string, ScopeEntry>;
  scopes: Scope[];
  parent: Scope | undefined;
}

export abstract class ScopeManager {
  protected root: Scope | undefined;
  protected active: Scope | undefined;
  protected cache: Map<string, ScopeEntry> = new Map();
  protected cacheValid: boolean = true;

  /**
   * Enter a new scope for the given node
   */
  enterScope(node: ast.ASTNode): void {
    if (!this.root) {
      this.root = {
        node,
        type: node._type,
        entries: new Map(),
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

    const newScope: Scope = {
      node,
      type: node._type,
      entries: new Map(),
      scopes: [],
      parent: this.active,
    };

    this.active.scopes.push(newScope);
    this.active = newScope;
  }

  /**
   * Exit the current scope
   */
  exitScope(): void {
    if (!this.active || !this.active.parent) {
      throw new Error("Cannot exit root scope or no active scope");
    }
    this.active = this.active.parent;
  }

  /**
   * Define an entry in the current scope
   */
  protected defineEntry(key: string, entry: ScopeEntry): void {
    if (!this.active) {
      throw new Error("No active scope to define entry");
    }
    this.active.entries.set(key, entry);
    this.invalidateCache();
  }

  /**
   * Resolve an entry by traversing scope chain
   */
  protected resolveEntry(name: string): ScopeEntry | undefined {
    // Check cache first for O(1) lookup
    if (this.cacheValid && this.cache.has(name)) {
      return this.cache.get(name);
    }

    // If cache is not valid, rebuild it from scopes
    if (!this.cacheValid) {
      this.rebuildCache();
      return this.cache.get(name);
    }

    // Cache is valid but entry not found - perform scope chain traversal
    const result = this.findEntryInChain(name);
    if (result) {
      this.cache.set(name, result);
    }
    return result;
  }

  /**
   * Find entry by traversing scope chain
   */
  protected findEntryInChain(name: string): ScopeEntry | undefined {
    let current: Scope | undefined = this.active;
    while (current) {
      const entry = current.entries.get(name);
      if (entry) {
        return entry;
      }
      current = current.parent;
    }
    return undefined;
  }

  /**
   * Invalidate the cache (call when modifying scopes)
   */
  protected invalidateCache(): void {
    this.cacheValid = false;
    this.cache.clear();
  }

  /**
   * Rebuild cache from all scopes
   */
  protected rebuildCache(): void {
    this.cache.clear();
    if (!this.root) return;

    const traverseScopes = (scope: Scope) => {
      // Add entries from this scope if not already in cache
      for (const [key, entry] of scope.entries.entries()) {
        if (!this.cache.has(key)) {
          this.cache.set(key, entry);
        }
      }
      // Traverse child scopes
      for (const child of scope.scopes) {
        traverseScopes(child);
      }
    };

    traverseScopes(this.root);
    this.cacheValid = true;
  }

  /**
   * Get root scope
   */
  getRoot(): Scope | undefined {
    return this.root;
  }

  /**
   * Get active scope
   */
  getActive(): Scope | undefined {
    return this.active;
  }

  /**
   * Debug: Get scope chain as string
   */
  debugScopeChain(): string {
    const chain: string[] = [];
    let current: Scope | undefined = this.active;
    while (current) {
      const nodeType = (current.node && ((current.node as any)._type ?? (current.node as any).name?.name)) || 'root';
      chain.push(`${nodeType}(${[...current.entries.keys()].join(',')})`);
      current = current.parent;
    }
    return chain.join(' -> ');
  }
}
