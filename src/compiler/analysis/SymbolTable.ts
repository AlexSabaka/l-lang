import * as ast from "../frontend/ast";
import { SymbolVisibility, getVisibility, getModifierNames } from "../helpers/modifiers";

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
  struct = "struct",
  "type-def" = "type-def",
  /**
   * `(defmodifier repeated [n <- Int] ...)`. Its parameters and body are its own -- without a scope
   * they would be defined in the enclosing one, so a modifier's `n` would leak into module scope and
   * collide with a module-level `n`.
   */
  "modifier-def" = "modifier-def",

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
  return [ "program", "class", "interface", "function", "variable", "method", "match", "when", "if", "struct", "type-def", "modifier-def" ].includes(type);
}

/**
 * Inferred type information for a symbol
 */
export interface InferredType {
  kind: "primitive" | "class" | "interface" | "generic" | "function" | "union" | "unknown" | "map" | "type-alias" | "struct" | "type-ref" | "array";
  name: string;
  generics?: InferredType[];
  params?: InferredType[];  // For function types
  returns?: InferredType;   // For function types
  /**
   * The function's last parameter is a rest/spread param: `(fn print [msg <- String ...args])`.
   * Without this, an arity check would reject every call to `print`, `compose` and `partial` --
   * the corpus really does use variadic functions.
   */
  isVariadic?: boolean;     // For function types
  alternatives?: InferredType[];  // For union types
  keyType?: InferredType;   // For map types
  valueType?: InferredType; // For map types
  inner?: InferredType;     // For array element type (alternative to generics[0])
  isArray?: boolean;
  /**
   * `T?` -- this type admits nil (D9).
   *
   * Replaces `nullable`, which carried TWO meanings in one field: it was set on the nil LITERAL
   * ("this IS the bottom value", a fact about a source expression) and read on a TARGET ("this
   * ACCEPTS the bottom value", a fact about a declaration). Nothing ever set it on a target, so the
   * one rule that read it -- `isAssignable`'s `source.name === "Null" && target.nullable` -- was dead
   * code, and the field looked live while meaning nothing.
   *
   * The two are now distinct: the literal has `{kind:"primitive", name:"Nil"}`, and a declaration
   * that admits it has `optional: true`.
   */
  optional?: boolean;
  /**
   * Declaration-site variance, on a `generic` that is a type PARAMETER: the `:out` of
   * `(definterface Producer<:out T>)`. Absent means invariant.
   */
  variance?: ast.TypeVariance;
  // Type alias support
  aliasedType?: InferredType;  // What this type-alias points to
  isRecursive?: boolean;  // True if type-alias references itself
  typeReferences?: string[];  // Names of types referenced in definition
  // Type reference support (forward references to types)
  refName?: string;  // Name of the type being referenced
  resolved?: boolean;  // Whether this type-ref has been resolved
  // Struct support
  members?: StructMember[];  // Struct member information
  ctorInfo?: ConstructorInfo;  // Struct constructor information (renamed to avoid TypeScript 'constructor' conflict)
  
  // Enhanced codegen metadata
  detailedMembers?: DetailedMember[];
  methodSignatures?: Map<string, MethodSignature>;
  operatorOverloads?: OperatorOverload[];
  implementedInterfaces?: InterfaceImplementation[];
  typeParameters?: TypeParameter[];
  parentClass?: string;
  requiresRuntimeMetadata?: boolean;
  codegenMetadata?: CodegenMetadata;
}

/**
 * Information about a struct member
 */
export interface StructMember {
  name: string;
  type: InferredType;
  isCtor: boolean;  // True if marked with :ctor modifier
  isPublic: boolean;
  isPrivate: boolean;
  isOperator?: boolean; // True if this is an operator overload
  operatorSymbol?: string; // The operator symbol
  defaultValue?: any;  // Default value if :ctor param has default
}

/**
 * Detailed member information for complete codegen metadata
 */
export interface DetailedMember {
  name: string;
  type: InferredType;
  visibility: 'public' | 'private' | 'protected' | 'internal';
  modifiers: Set<string>;
  defaultValue?: any;
  isConstructorParam: boolean;
  parameterIndex?: number; // For constructor ordering
  isStatic?: boolean;
  isOperator?: boolean;
  operatorSymbol?: string;
  arity?: number;
}

/**
 * Parameter information for method signatures
 */
export interface ParameterInfo {
  name: string;
  type: InferredType;
  hasDefault: boolean;
  defaultValue?: any;
  isRest?: boolean;
}

/**
 * Complete method signature information
 */
export interface MethodSignature {
  name: string;
  parameters: ParameterInfo[];
  returnType: InferredType;
  modifiers: Set<string>;
  isOperatorOverload: boolean;
  operatorSymbol?: string;
  arity?: number;
  visibility: 'public' | 'private' | 'protected' | 'internal';
}

/**
 * Operator overload information
 */
export interface OperatorOverload {
  symbol: string;
  arity: number;
  parameterTypes: InferredType[];
  returnType: InferredType;
  methodName: string;
}

/**
 * Interface implementation information
 */
export interface InterfaceImplementation {
  interfaceName: string;
  interfaceType: InferredType;
  methodMappings: Map<string, string>; // interface method -> implementation method
}

/**
 * Generic type parameter information
 */
export interface TypeParameter {
  name: string;
  constraints: InferredType[];
  defaultType?: InferredType;
  /** `:out` / `:in`. Absent means invariant. */
  variance?: ast.TypeVariance;
}

/**
 * Complete codegen metadata for a type
 */
export interface CodegenMetadata {
  typeName: string;
  kind: string;
  detailedMembers?: DetailedMember[];
  methodSignatures?: Map<string, MethodSignature>;
  operatorOverloads?: OperatorOverload[];
  implementedInterfaces?: InterfaceImplementation[];
  typeParameters?: TypeParameter[];
  parentClass?: string;
  requiresRuntimeMetadata: boolean;
  constructorSignature?: {
    parameters: ParameterInfo[];
    requiredCount: number;
  };
}

/**
 * Information about a struct constructor
 */
export interface ConstructorInfo {
  params: ConstructorParam[];
  requiredCount: number;  // Number of required (non-default) params
}

/**
 * Constructor parameter information
 */
export interface ConstructorParam {
  name: string;
  type: InferredType;
  hasDefault: boolean;
  defaultValue?: any;
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
  // Generic modifier storage
  modifiers: Set<string>;       // All modifier names (normalized, without colon prefix)
  
  // Computed properties for common modifiers
  get isOperator(): boolean;
  get isComptime(): boolean;
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
  /** node -> the scope that node OWNS. Built lazily from the scope tree; see scopeOf(). */
  private nodeScopeIndex: Map<ast.ASTNode, Scope> = new Map();
  private indexValid: boolean = false;

  constructor(root: Scope | undefined) {
    if (root) {
      this.scopes.push(root);
    }
  }

  /**
   * Bind a type to an existing symbol, as seen FROM `from`.
   *
   * WITHOUT `from` this is the old flat write, and it is only sound for a name that really is at
   * module root -- a function, a class, a struct. For anything nested it is the aliasing bug: see
   * `resolveSymbolLexical`.
   */
  bindType(name: string, type: InferredType, from?: ast.ASTNode): void {
    const symbol = from
      ? this.resolveSymbolLexical(name, from)
      : this.resolveSymbol(name);
    if (symbol) {
      symbol.inferredType = type;
    }
  }

  /**
   * Bind complete type with codegen metadata
   */
  bindCompleteType(name: string, type: InferredType, metadata: CodegenMetadata): void {
    const symbol = this.resolveSymbol(name);
    if (symbol) {
      symbol.inferredType = { ...type, codegenMetadata: metadata };
    }
  }

  /**
   * Retrieve codegen-ready metadata for a symbol
   */
  getCodegenMetadata(name: string): CodegenMetadata | undefined {
    const symbol = this.resolveSymbol(name);
    return symbol?.inferredType?.codegenMetadata;
  }

  /**
   * Get all class metadata for codegen
   */
  getAllClassMetadata(): Map<string, CodegenMetadata> {
    const classMetadata = new Map<string, CodegenMetadata>();
    const allSymbols = this.getAllSymbols();
    
    for (const [name, entry] of allSymbols.entries()) {
      if (entry.inferredType?.kind === 'class' || entry.inferredType?.kind === 'struct') {
        const metadata = entry.inferredType.codegenMetadata;
        if (metadata) {
          classMetadata.set(name, metadata);
        }
      }
    }
    
    return classMetadata;
  }

  /**
   * Get all function metadata for codegen
   */
  getAllFunctionMetadata(): Map<string, CodegenMetadata> {
    const funcMetadata = new Map<string, CodegenMetadata>();
    const allSymbols = this.getAllSymbols();
    
    for (const [name, entry] of allSymbols.entries()) {
      if (entry.inferredType?.kind === 'function') {
        const metadata = entry.inferredType.codegenMetadata;
        if (metadata) {
          funcMetadata.set(name, metadata);
        }
      }
    }
    
    return funcMetadata;
  }

  /**
   * Validate that all symbols have complete codegen metadata
   */
  validateCodegenMetadata(): string[] {
    const missing: string[] = [];
    const allSymbols = this.getAllSymbols();
    
    for (const [name, entry] of allSymbols.entries()) {
      if (entry.inferredType && 
          (entry.inferredType.kind === 'class' || 
           entry.inferredType.kind === 'struct' || 
           entry.inferredType.kind === 'function') &&
          !entry.inferredType.codegenMetadata) {
        missing.push(`${name} (${entry.inferredType.kind})`);
      }
    }
    
    return missing;
  }

  /**
   * Resolve a symbol by identifier or string name
   */
  /**
   * Which scope does this AST node sit in?
   *
   * The scope TREE has always existed -- `Scope` has `parent` and `scopes`, and
   * SymbolTableBuilder genuinely builds it. What was missing is any way to get INTO it: `scopes`
   * is a flat list of module ROOTS, and every resolution path walked UPWARD from a root (whose
   * parent is undefined), never reading `scope.scopes`. So a parameter or a local `let` was
   * written into a child scope and was then unfindable, and codegen had to keep a shadow symbol
   * table (localIdentifiersStack) to compensate.
   *
   * Walking the node's `_parent` chain works even though the symbol table is built on the
   * PRE-desugar AST while codegen sees the POST-desugar one: BaseAstTreeWalker copies
   * `_parent: node._parent`, i.e. the ORIGINAL parent object, so one step up from a desugared node
   * lands back in the pre-desugar tree -- which is the tree that was indexed.
   */
  scopeOf(node: ast.ASTNode | undefined): Scope | undefined {
    if (!node) return undefined;
    if (!this.indexValid) this.rebuildScopeIndex();

    let current: ast.ASTNode | undefined = node;
    while (current) {
      const scope = this.nodeScopeIndex.get(current);
      if (scope) return scope;
      current = current._parent;
    }
    return undefined;
  }

  private rebuildScopeIndex(): void {
    this.nodeScopeIndex = new Map();
    const walk = (scope: Scope): void => {
      this.nodeScopeIndex.set(scope.node, scope);
      scope.scopes.forEach(walk);
    };
    this.scopes.forEach(walk);
    this.indexValid = true;
  }

  /**
   * Resolve `name` STRICTLY lexically: the scope chain outward from `from`, and nothing else.
   *
   * `resolveSymbol(name, from)` falls through to the flat root union when the lexical walk misses,
   * and for a READ that is correct -- symbols from other modules genuinely live in other roots, and
   * they are legitimately visible here.
   *
   * For a WRITE it is catastrophic, and it is the bug this phase exists to fix. `bindType("x", Int)`
   * on a local `x` misses lexically, falls through, finds the TOP-LEVEL `x`, and writes `Int` onto
   * THAT. The local's type is not merely lost -- an unrelated symbol is corrupted with it. So a
   * write asks this question instead, and a miss is a miss.
   *
   * `missed` is the phase's safety instrument. Because the fall-through exists, EVERY failure mode
   * of the migration -- a broken `_parent` chain, an unindexed scope, a wrong `from` -- degrades
   * into exactly the old behaviour: silent, green, and doing nothing. Counting the misses is the
   * only way to tell a landed fix from a no-op that looks like one.
   */
  /**
   * STATIC, deliberately. There is more than one `SymbolTable` alive per compile -- the checker is
   * handed the MODULE's table (`moduleSymbols`) while codegen resolves against the CONTEXT's joined
   * one -- so a per-instance counter reads zero on whichever table you happen to ask. That is not a
   * clean result; it is the instrument missing the events. Process-wide is what makes it honest.
   */
  private static lexicalHits = 0;
  private static lexicalMissNames: Map<string, number> = new Map();

  /**
   * Lexical-resolution stats. `misses` names the symbols a WRITE could not find a home for -- each
   * one is a type the compiler inferred and then had nowhere to put. On a healthy corpus this is
   * empty; anything in it is either a scope the builder never created or a `from` that cannot reach
   * one, and both are bugs.
   */
  static getLexicalStats(): { hits: number; misses: number; missNames: Map<string, number> } {
    let misses = 0;
    for (const n of SymbolTable.lexicalMissNames.values()) misses += n;
    return { hits: SymbolTable.lexicalHits, misses, missNames: SymbolTable.lexicalMissNames };
  }

  static resetLexicalStats(): void {
    SymbolTable.lexicalHits = 0;
    SymbolTable.lexicalMissNames = new Map();
  }

  resolveSymbolLexical(
    name: ast.IdentifierNode | ast.TypeNameNode | string,
    from: ast.ASTNode
  ): SymbolEntry | undefined {
    const symbolName = typeof name === "string" ? name : ast.symbolName(name);

    for (let current = this.scopeOf(from); current !== undefined; current = current.parent) {
      const found = current.table.get(symbolName);
      if (found) {
        SymbolTable.lexicalHits++;
        return found;
      }
    }

    SymbolTable.lexicalMissNames.set(
      symbolName,
      (SymbolTable.lexicalMissNames.get(symbolName) ?? 0) + 1
    );
    return undefined;
  }

  /**
   * Resolve `name` as seen FROM `from` -- i.e. lexically.
   *
   * With `from`, this walks the real scope chain outward from the node's own scope, so a parameter
   * or a local `let` shadows a module-level or imported symbol of the same name, as it must.
   * Without it, the old behaviour is preserved: a flat search of the module-root tables. Callers
   * migrate one at a time rather than in one risky sweep.
   */
  resolveSymbol(
    name: ast.IdentifierNode | ast.TypeNameNode | string,
    from?: ast.ASTNode
  ): SymbolEntry | undefined {
    const symbolName = typeof name === "string" ? name : ast.symbolName(name);

    if (from) {
      const scope = this.scopeOf(from);
      for (let current = scope; current !== undefined; current = current.parent) {
        const found = current.table.get(symbolName);
        if (found) return found;
      }
      // Not in the lexical chain. Fall through to the root union below -- that is where symbols
      // from OTHER modules live, and they are legitimately visible here.
    }

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

  /**
   * D20 -- is `entry` visible from `askingFile`?
   *
   * `(export ...)` was decorative. `SymbolEntry.exportName` had exactly one writer
   * (BuildSymbolTableAstVisitor.visitExport) and ZERO readers, so an unexported top-level symbol was
   * importable, callable, and emitted clean. This is the reader.
   *
   * It is a STATIC on the table, and there is exactly one of it, on purpose. The rule "which symbols
   * cross a module boundary" is the kind of thing this compiler has a habit of implementing three
   * times in three passes and then disagreeing with itself (see: the call-vs-block rule). Both the
   * type checker's doors ask THIS.
   *
   * The obvious home -- filtering the cross-module fall-through inside `resolveSymbol` -- does not
   * work, and would have been a fix that only LOOKED airtight. That fall-through can judge visibility
   * only if it knows who is asking, i.e. only if the caller passed `from`; measured, almost nobody
   * does. Type references, `extends`, `new` and most of codegen call `resolveSymbol(name)` bare. So
   * the test is applied at named doors that know the asking file by other means -- for the checker,
   * `node._location.source`, which is free at every one of them, and which is per-NODE rather than
   * per-pass, so it stays correct no matter which module is being processed.
   *
   * Every clause is a way of NOT flagging. The check fires only on a positive identification -- it
   * can never invent a diagnostic out of missing information, which is why it is safe to hang on a
   * blanket `visitTypeName` that also sees primitives and generic parameters: they resolve to no
   * symbol, so they are never judged.
   */
  static isVisibleFrom(entry: SymbolEntry, askingFile: string | undefined): boolean {
    if (!askingFile) return true; // cannot tell who is asking -> do not invent an answer

    const declaredIn = (entry.value as any)?._location?.source;
    if (!declaredIn) return true; // synthesized, or no provenance -> not judgeable
    if (declaredIn === askingFile) return true; // your own privates are your own

    // Not module top-level: a local, a parameter, a class member. Never crosses a boundary as a
    // free name, and `:private` on a member is a DIFFERENT rule (D11), enforced elsewhere.
    if (entry.scope?.parent !== undefined) return true;

    // W, applied: an operator is LANGUAGE, not library. It "cannot be shadowed, imported or
    // redefined -- only OVERLOADED", and a thing with no name has no export. This clause is
    // load-bearing: `inlineImportedOperators()` exists precisely because an operator is found by
    // DISPATCH and never by name, and the lib in src/test/imports.ts:395 exports `Money` and NOT its
    // `+`. Drop this line and that operator stops being inlined, never reaches
    // `__ll_op_registry.register`, and W's bug returns whole.
    if (entry.isOperator) return true;

    return entry.exportName !== undefined;
  }

  join(other: SymbolTable): SymbolTable {
    this.scopes = [...this.scopes, ...other.scopes];
    // Invalidate cache after joining symbol tables
    this.cacheValid = false;
    this.indexValid = false;
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
    this.indexValid = false;
    this.symbolCache.clear();
    return addedCount;
  }

  /**
   * Get the total number of symbols across all scopes
   */
  get size(): number {
    return this.scopes.reduce((total, scope) => total + scope.table.size, 0);
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

  /**
   * Get all symbols from all scopes (useful for REPL autocomplete)
   */
  getAllSymbols(): Map<string, SymbolEntry> {
    const allSymbols = new Map<string, SymbolEntry>();
    
    for (const scope of this.scopes) {
      this.collectSymbolsFromScope(scope, allSymbols);
    }
    
    return allSymbols;
  }

  /**
   * Recursively collect symbols from a scope and its children
   */
  private collectSymbolsFromScope(scope: Scope, symbols: Map<string, SymbolEntry>): void {
    // Add symbols from current scope
    for (const [name, entry] of scope.table.entries()) {
      if (!symbols.has(name)) {
        symbols.set(name, entry);
      }
    }

    // Recursively add from child scopes
    if (scope.scopes) {
      for (const childScope of scope.scopes) {
        this.collectSymbolsFromScope(childScope, symbols);
      }
    }
  }
}

export class SymbolTableBuilder {
  private root: Scope | undefined;
  private active: Scope | undefined;

  build(): SymbolTable {
    return new SymbolTable(this.root);
  }

  /**
   * Did each open `enterScope()` actually PUSH a scope?
   *
   * `enterScope` has three paths that decline to push -- an unregistered node type, a re-entry into
   * the scope already active, and the creation of the root -- and `exitScope` popped
   * UNCONDITIONALLY. So any caller doing `enterScope(x) ... exitScope()` desynced the stack the
   * instant `enterScope` declined, and the next exit walked off the root:
   *
   *     Error: Already at the root scope. Cannot exit.
   *
   * That is what `(defmodifier m [n <- Int])` did -- `modifier-def` was not a registered scope type,
   * so the enter was a silent no-op and the exit popped a scope it never opened. The compiler
   * crashed outright. `modifier-def` is registered below, but that alone would only fix the ONE node
   * type that happens to have tripped it: the asymmetry is a landmine for every node type that is
   * not in `isNodeScope`, and for every future one.
   *
   * Recording what each enter DID makes the pair impossible to desync. A no-op enter now pairs with
   * a no-op exit.
   */
  private pushedScope: boolean[] = [];

  enterScope(node: ast.ASTNode) {
    const nodeType = node._type as any;
    if (!isNodeScope(nodeType)) {
      this.pushedScope.push(false);
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
      this.pushedScope.push(false);
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
    this.pushedScope.push(true);
  }

  exitScope() {
    const didPush = this.pushedScope.pop();

    if (didPush === undefined) {
      throw new Error("exitScope() without a matching enterScope().");
    }

    // The matching enter declined to push -- an unregistered node type, or a re-entry into the scope
    // already active. There is nothing to unwind, and unwinding anyway is precisely the bug.
    if (!didPush) {
      return;
    }

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

  defineSymbol(node: ast.VariableNode | ast.FunctionNode | ast.ClassNode | ast.InterfaceNode | ast.TypeDefNode | ast.StructNode | ast.ModifierDefNode | ast.EnumNode) {
    if (this.root === undefined) {
      throw new Error("No root scope. Cannot define symbol.");
    }

    if (this.active === undefined) {
      throw new Error("No active scope. Cannot define symbol.");
    }

    const modifiers = (node as any).modifiers || [];
    const modifierNames = new Set<string>(getModifierNames(modifiers));
    const visibility = getVisibility(modifiers);

    const entryFor = (entryName: string, nameNode: any) => {
      this.active!.table.set(entryName, {
        name: nameNode,
        nodeType: node._type,
        scope: this.active!,
        value: node,
        mutability: (node as any).mutable ?? false,
        exportName: undefined,
        visibility,
        modifiers: modifierNames,
        get isOperator() { return modifierNames.has("operator"); },
        get isComptime() { return modifierNames.has("comptime"); },
        // inferredType will be populated during type inference phase
      });
    };

    // A destructuring `let` declares N names, not one: `(let [x y] point)` binds both x and y.
    // Each gets its own entry, pointing back at the same variable node.
    if (node._type === "variable" && ast.isBindingPattern((node as ast.VariableNode).name)) {
      for (const id of ast.bindingIdentifiers((node as ast.VariableNode).name)) {
        entryFor((id as any).id, id);
      }
      return;
    }

    // Get the name from the node (different types have different name structures)
    let name: string;
    if (node._type === "type-def" || node._type === "struct") {
      // TypeDefNode and StructNode have name as an IdentifierNode or TypeNameNode
      name = (node as any).name?.id || (node as any).name?.name;
    } else if (node._type === "modifier-def") {
      // ModifierDefNode has name as a string
      name = (node as ast.ModifierDefNode).name;
    } else {
      // Other node types (variable, function, class, interface)
      name = (node as any).name?.id ?? (node as any).name?.name;
    }

    entryFor(name, (node as any).name);
  }

  /**
   * Define a parameter symbol in the current function scope
   */
  /**
   * Define a binding that is not a `let`, a `fn`, or a parameter: a loop variable, a `catch`
   * clause's error, a name bound by a match pattern.
   *
   * None of these were EVER declared. `for`, `for-each`, `while`, `try-catch` and `match-case` have
   * no visitor in the symbol-table builder, so `(for :each item :from xs ...)` never put `item`
   * anywhere -- which is a large part of why an unresolved-identifier check could not be built.
   */
  defineBinding(target: ast.BindingTarget | undefined, owner: ast.ASTNode): void {
    if (this.active === undefined) {
      throw new Error("No active scope. Cannot define binding.");
    }
    if (!target) return;

    for (const id of ast.bindingIdentifiers(target)) {
      const name = (id as any).id ?? (id as any).name;
      if (!name) continue;

      this.active.table.set(name, {
        name: id,
        nodeType: owner._type,
        scope: this.active,
        value: owner,
        mutability: true, // a loop variable is rebound each iteration
        exportName: undefined,
        visibility: "internal",
        modifiers: new Set<string>(),
        get isOperator() { return false; },
        get isComptime() { return false; },
      });
    }
  }

  defineParameter(param: ast.ParameterNode) {
    if (this.root === undefined) {
      throw new Error("No root scope. Cannot define parameter.");
    }

    if (this.active === undefined) {
      throw new Error("No active scope. Cannot define parameter.");
    }

    const modifiers = param.modifiers || [];
    const modifierNames = new Set<string>(getModifierNames(modifiers));
    const visibility = getVisibility(modifiers);

    // A destructuring parameter binds N names: `(fn print-point [[x y]] ...)` binds x and y.
    const bound = ast.isBindingPattern(param.name)
      ? ast.bindingIdentifiers(param.name)
      : [param.name as ast.IdentifierNode];

    for (const id of bound) {
      const name = (id as any).id ?? (id as any).name;
      this.active.table.set(name, {
        name: id,
        nodeType: "parameter", // Special nodeType for parameters
        scope: this.active,
        value: param,
        mutability: modifierNames.has("mut") || modifierNames.has("ref") || modifierNames.has("out"),
        exportName: undefined,
        visibility,
        modifiers: modifierNames,
        get isOperator() { return false; }, // Parameters can't be operators
        get isComptime() { return modifierNames.has("comptime"); },
        // inferredType will be populated during type inference phase
      });
    }
  }

  resolveSymbol(name: ast.IdentifierNode | ast.TypeNameNode): SymbolEntry | undefined {
    if (this.root === undefined) {
      throw new Error("No root scope. Cannot resolve symbol.");
    }

    if (this.active === undefined) {
      throw new Error("No active scope. Cannot resolve symbol.");
    }

    return this.findSymbolRecursively(ast.symbolName(name), this.active);
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

  /**
   * Get the current active scope
   */
  getActive(): Scope | undefined {
    return this.active;
  }
}
