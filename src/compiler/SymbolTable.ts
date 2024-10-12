import { ASTNode, ClassNode, FunctionNode, IdentifierNode, InterfaceNode, NodeType, TypeNameNode, VariableNode } from "./ast";

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

export interface SymbolEntry {
  name: IdentifierNode | TypeNameNode | undefined;
  type: NodeType; // Extract<NodeType, "variable" | "function" | "class" | "interface">;
  scope: ScopeType;
  mutability: boolean;
  value: ASTNode | undefined;
}

export interface Scope {
  scope: ScopeType;
  table: Map<string, SymbolEntry>;
}

export class SymbolTable {
  private scopes: Scope[] = [];

  get currentScope(): ScopeType {
    if (!this.scopes[0]) {
      throw new Error(`No current scope to define symbol: ${name}`);
    }

    return this.scopes[0].scope;
  }

  enterScope(scope: ScopeType) {
    this.scopes.unshift({ scope, table: new Map<string, SymbolEntry>() });
  }

  exitScope() {
    return this.scopes.shift();
  }

  defineSymbol(node: VariableNode | FunctionNode | ClassNode | InterfaceNode) {
    if (!this.scopes[0]) {
      throw new Error(`No current scope to define symbol: ${name}`);
    }

    const entryKey = (node.name as any)?.id || (node.name as any)?.name; 

    this.scopes[0].table.set(entryKey, {
      name: node.name,
      type: node._type,
      scope: this.scopes[0].scope,
      mutability: (node as VariableNode)?.mutable ?? false,
      value: node,
    });
  }

  resolveSymbol(name: string): SymbolEntry | undefined {
    for (const scope of this.scopes) {
      if (scope.table.has(name)) {
        return scope.table.get(name);
      }
    }
    return undefined;
  }
}
