import * as path from "node:path";
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
  /** D72. Registered so both backends can ask "is this name an attribute?" from one source. */
  "attribute-def" = "attribute-def",

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
  kind: "primitive" | "class" | "interface" | "generic" | "function" | "union" | "unknown" | "map" | "type-alias" | "struct" | "type-ref" | "array" | "tuple" | "record";
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
  elements?: InferredType[]; // For tuple types (`[Int String]`) -- fixed-length, positional
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
  // A REFINED newtype (D46 amend): a `type-alias` marked NOMINAL -- distinct by NAME, so `Kelvin` and
  // `Meter` (both `<- Real :satisfies (0 ..)`) are DIFFERENT types. It still unwraps to `aliasedType`
  // for codegen / layout / arithmetic (base layout), but `isAssignable` consults `nominal` BEFORE
  // unwrapping. Absent/false => an ordinary transparent alias (Number, PathLike, ...), unchanged.
  nominal?: boolean;
  refinement?: { lo: number | null; hi: number | null };  // inclusive bounds; null = open (unbounded) that side
  // Type reference support (forward references to types)
  refName?: string;  // Name of the type being referenced
  resolved?: boolean;  // Whether this type-ref has been resolved
  /**
   * The SOURCE of the file that wrote this type reference (T). A `type-ref` resolves lazily, long
   * after its AST node is gone, so without this the lazy `unwrapType` lookup cannot prefer the module
   * the file DIRECTLY imported over one reached only transitively -- the S1b fix for value names, one
   * namespace over. Stamped at `convertAstTypeCore`, read by `TypeChecker.unwrapType`. Advisory:
   * absent means "resolve as before" (bare, first-wins).
   */
  askingSource?: string;
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
  /**
   * The SOURCE of the file where this class's `:extends` was written (T). `parentClass` is a bare name
   * string, and `constructorParams` resolves it far from the definition site, so without this it falls
   * to first-wins for a cross-module parent-name collision. The `:extends` is always written in the
   * class's own file, so this is that file's source, used to prefer the directly-imported parent.
   */
  parentSource?: string;
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
  visibility: 'public' | 'private' | 'internal';
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
  visibility: 'public' | 'private' | 'internal';
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
 * A modifier attached to a DECLARATION, as reflection sees it (D68).
 *
 * `kind` is D68's three roles, by their own names: a `builtin` is a fact the compiler acts on
 * (`:public`, `:ctor`, `:gen`), a `decorator` is a transformer declared by `defmodifier`, and an
 * `attribute` is annotation data declared by `defattribute` (D72).
 *
 * Computed from `isBuiltinModifier` plus the declared-annotation registry -- the same two sources
 * both backends consult to decide whether to emit a `__ll_modifier_` wrapper. Deriving it any other
 * way would let the graph describe a modifier as one thing while codegen treats it as another.
 */
export interface ModifierInfo {
  name: string;
  kind: "builtin" | "decorator" | "attribute";
  /**
   * The literal arguments written at the use site, or absent.
   *
   * Absent covers two different things on purpose, because reflection cannot usefully tell them
   * apart: no arguments were written, or an argument was not a literal and therefore cannot be
   * carried by a metadata table that is emitted as data. An attribute is required to use literals
   * (D72), so in practice absence means "none written" for the kind where it matters.
   */
  args?: (string | number | boolean)[];
}

/** One member of an enum, as reflection sees it (D70). */
export interface EnumMemberInfo {
  name: string;
  value: number | string;
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
  /** D68: the declaration's own modifiers. Absent or empty on a declaration carrying none. */
  modifiers?: ModifierInfo[];
  /** D70: an enum's members, in declaration order. Only ever set when `kind` is "enum". */
  enumMembers?: EnumMemberInfo[];
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
  /**
   * A DESCRIPTION with no inferred type behind it (D70).
   *
   * Every other declaration carries its `CodegenMetadata` on `inferredType`, which is the right home
   * when there IS one. An enum has none: `InferredType.kind` is a closed union with no `enum` arm,
   * and `defineSymbol` leaves an enum's `inferredType` undefined. Inventing one purely to carry a
   * description would put a new arm through `isAssignable` and the checker -- changing what programs
   * type-check, as a side effect of a reflection feature.
   *
   * So the description hangs here instead, and `getAllTypeMetadata` reads both. It says exactly what
   * is true: describable, not typed.
   */
  codegenMetadata?: CodegenMetadata;
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

/**
 * Which module does this root scope belong to?
 *
 * The identity `join` merges on. It is the FILE, not the node: a re-parse of the same file yields a
 * brand new ProgramNode, so anything keyed on node identity sees a re-processed module as a stranger
 * and stacks it alongside the old one.
 */
function moduleOf(scope: Scope): string | undefined {
  return scope.node?._location?.source;
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
   * Every type the METADATA TABLE should describe -- `__ll_type_metadata`'s whole contents.
   *
   * Keyed on "has `codegenMetadata`", not on `kind`. That was two near-identical getters
   * (`getAllClassMetadata` filtering class/struct, `getAllFunctionMetadata` filtering function), and
   * the kind test was always a RESTATEMENT of the metadata test: only `visitFunction`, `visitClass`
   * and `visitStruct` ever minted a `codegenMetadata`, so the two conditions could not disagree. What
   * the kind filter DID do was silently exclude anything new -- an interface got a shape (D42/Zf) and
   * still could not reach the table, because `'interface'` was in neither list (Zja).
   *
   * `extern` is excluded (Zjb). `std/js` is the PRELUDE -- implicitly imported into every module -- so
   * its nine `(fn :extern ...)` declarations were in EVERY program's table, all rendering
   * `{returns:'Any'}`. An ambient global is the HOST's, and the table describes l-lang's types. The
   * same seam and the same reasoning as `InferTypesAstVisitor`'s ordering check and codegen's
   * inlining check, which both already read `entry.value.extern`.
   */
  getAllTypeMetadata(): Map<string, CodegenMetadata> {
    const metadata = new Map<string, CodegenMetadata>();

    for (const [name, entry] of this.getAllSymbols().entries()) {
      // `entry.codegenMetadata` is the second home, for a declaration that is describable without
      // being typed -- an enum (D70). See the field's own comment for why it does not ride
      // `inferredType` like everything else.
      const md = entry.inferredType?.codegenMetadata ?? entry.codegenMetadata;
      if (!md) continue;
      if ((entry.value as any)?.extern) continue;
      metadata.set(name, md);
    }

    return metadata;
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
   * Which modules does `importer` DIRECTLY import? Absolute paths. Installed by `Context`, which owns
   * the import graph (`importBindings`, populated by the dependency-graph pass and already read by
   * `importBinds`). Undefined in a table nobody wired up, where `resolveByImportPriority` is a no-op
   * and resolution behaves exactly as it did before S1b.
   */
  public directImportsOf?: (importer: string) => Set<string> | undefined;

  /** Memo for `resolveByImportPriority`, keyed `askingFile::name`. Cleared with the symbol cache. */
  private importPriorityCache: Map<string, SymbolEntry | undefined> = new Map();

  /**
   * Resolve `name` by asking WHAT THIS FILE IMPORTED, before falling back to the flat union (S1b).
   *
   * THE BUG THIS FIXES. `resolveSymbol`'s fall-through is a flat first-wins union over every loaded
   * module root, built by iterating `this.scopes` in module-JOIN order. So which `write-line` /
   * `iabs` / `rect` a file gets was decided by which module happened to be processed first -- and a
   * stdlib module always wins, because the prelude and package co-processing get there earlier. Three
   * separate games-corpus findings (N1, N15, N2) were this one bug:
   *
   *   - a one-parameter `write-line` defined ONE FILE AWAY lost to `std/io/stream`'s two-parameter
   *     one, which the program reached only transitively -- reported as "expects 2 arguments, got 1";
   *   - `std/math/rational.lisp`'s PRIVATE `iabs` beat a program's own exported `iabs`, and the
   *     resulting LL0215 named a stdlib file the program never mentioned;
   *   - `std/math/complex`'s `rect` beat a local five-parameter `rect`, silently whenever arities agree.
   *
   * The FENCE was never wrong: `checkSymbolVisible` asks the right two questions and `isVisibleFrom`
   * is a single correct rule. Resolution simply handed them the wrong symbol.
   *
   * WHY THIS IS NOT THE FIX THAT "ONLY LOOKED AIRTIGHT". The note on `isVisibleFrom` warns that
   * filtering inside the fall-through does not work, because it can only judge visibility if the
   * caller passed `from` -- and measured, most do not (63 `resolveSymbol` call sites, 13 pass it). That
   * is still true, and this respects it: the priority pass runs ONLY on the `from` path and changes
   * nothing for a bare call. It is also a REORDERING, never a filter -- a name reachable only
   * transitively still resolves, through the unchanged union below. Nothing that resolved before
   * stops resolving, which is what bounds the blast radius of touching resolution at all.
   *
   * TIERS. A directly-imported module that EXPORTS the name wins; failing that, a directly-imported
   * module that merely declares it (so a package sibling, which reaches this file by belonging to the
   * unit rather than by name-binding, still resolves). An operator counts as exported for the same
   * reason it is exempt everywhere else (W): it is found by DISPATCH and has no name to export.
   *
   * The prelude and package siblings are recorded as direct imports too (`injectPrelude`,
   * `injectPackageSiblings` both call `recordImport`), which is correct: `console` must resolve, and a
   * package is one compilation unit. It does not re-open N15, because the leak there is TRANSITIVE --
   * `main.lisp` imports `num.lisp`, whose own import of the std/math package is one hop further out.
   */
  private resolveByImportPriority(name: string, from: ast.ASTNode): SymbolEntry | undefined {
    const askingFile = (from as any)?._location?.source;
    if (!askingFile) return undefined;
    return this.resolveByImportPrioritySource(name, askingFile);
  }

  /**
   * The same import-priority resolution, given the asking file's SOURCE directly instead of a node (T).
   *
   * A TYPE reference (`<- Widget`, `:extends Widget`) resolves LAZILY, from a deferred
   * `type-ref{refName}` that carries only a name string -- so by the time `TypeChecker.unwrapType`
   * looks it up, the AST node with its `_location.source` is long gone, and the bare `resolveSymbol`
   * fell to the flat first-wins union the same way a bare value lookup did before S1b. The type-ref
   * now carries its asking source as a string, and this is the entry it hands to; it is the exact
   * body `resolveByImportPriority` used to inline, extracted so both the node path and the string path
   * share one implementation and one memo.
   */
  resolveByImportPrioritySource(name: string, askingFile: string): SymbolEntry | undefined {
    if (!this.directImportsOf || !askingFile) return undefined;

    const memoKey = `${askingFile}::${name}`;
    if (this.importPriorityCache.has(memoKey)) return this.importPriorityCache.get(memoKey);

    let answer: SymbolEntry | undefined;
    const direct = this.directImportsOf(askingFile);
    if (direct && direct.size > 0) {
      let declaredButNotExported: SymbolEntry | undefined;
      for (const scope of this.scopes) {
        const mod = moduleOf(scope);
        if (!mod || !direct.has(path.resolve(mod))) continue;
        const found = scope.table.get(name);
        if (!found) continue;
        if (found.exportName !== undefined || found.isOperator) {
          answer = found;
          break;
        }
        declaredButNotExported ??= found;
      }
      answer ??= declaredButNotExported;
    }

    this.importPriorityCache.set(memoKey, answer);
    return answer;
  }

  /**
   * Do two DIRECTLY imported packages both offer `name`? (S1c, LL0240.)
   *
   * S1b made resolution deterministic -- a directly-imported declaration beats a transitively-reached
   * one -- but determinism is not the same as unambiguous. When two directly-imported modules each
   * export the name, the priority pass takes whichever root comes first in the forest, and THAT order
   * is still an accident of module processing. This is the question that notices.
   *
   * Compared by PACKAGE, not by file. A package publishes the union of its files' exports (Mb), so
   * `math/math` re-exporting `math/constants`' `PI` is the design working, not a collision: 25
   * exported names in the current stdlib are owned by more than one module and most are exactly that
   * shape. Two different packages offering one name is the case with no owner.
   *
   * Returns the two module files, or undefined when there is no ambiguity. Reported once per use
   * site by the checker, which is where a node and a location exist.
   */
  ambiguousDirectImports(
    name: string,
    from: ast.ASTNode,
    packageOf: (file: string) => string | undefined
  ): { a: string; b: string } | undefined {
    if (!this.directImportsOf) return undefined;
    const askingFile = (from as any)?._location?.source;
    if (!askingFile) return undefined;
    const direct = this.directImportsOf(askingFile);
    if (!direct || direct.size < 2) return undefined;

    const offerers: string[] = [];
    const packagesSeen = new Set<string>();
    for (const scope of this.scopes) {
      const mod = moduleOf(scope);
      if (!mod || !direct.has(path.resolve(mod))) continue;
      const found = scope.table.get(name);
      if (!found || found.exportName === undefined || found.isOperator) continue;
      // One entry per PACKAGE. A file outside any package is its own unit, keyed by its own path.
      const pkg = packageOf(mod) ?? path.resolve(mod);
      if (packagesSeen.has(pkg)) continue;
      packagesSeen.add(pkg);
      offerers.push(mod);
      if (offerers.length === 2) return { a: offerers[0], b: offerers[1] };
    }
    return undefined;
  }

  /**
   * Resolve `name` as seen FROM `from` -- i.e. lexically.
   *
   * With `from`, this walks the real scope chain outward from the node's own scope, so a parameter
   * or a local `let` shadows a module-level or imported symbol of the same name, as it must. On a
   * miss it prefers what the file actually IMPORTED (`resolveByImportPriority`, S1b) before the flat
   * union. Without `from`, the old behaviour is preserved: a flat search of the module-root tables.
   * Callers migrate one at a time rather than in one risky sweep.
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
      // Not in the lexical chain. Before the flat union, ask what THIS FILE actually imported (S1b).
      const preferred = this.resolveByImportPriority(symbolName, from);
      if (preferred) return preferred;

      // Still nothing. Fall through to the root union below -- that is where symbols from OTHER
      // modules live, and they are legitimately visible here.
    }

    // Check cache first for O(1) lookup
    if (this.cacheValid && this.symbolCache.has(symbolName)) {
      return this.symbolCache.get(symbolName);
    }

    // If cache is not valid, build it now from the scopes.
    if (!this.cacheValid) {
      this.symbolCache.clear();
      this.importPriorityCache.clear();
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

  /**
   * What does `moduleFile` OFFER under the name `offered`?
   *
   * The module-boundary companion to `isVisibleFrom`, and a different question from `resolveSymbol`.
   * `resolveSymbol` finds a symbol by the name it was DECLARED with; a consumer names a module's
   * symbol by the name that module OFFERS it as, and `(export a :as b)` makes those two different.
   * A module offers a name if it declares it, or if some declaration's `exportName` is that name.
   *
   * Declared name first: under `(export a :as b)` a module offers `b` and no longer offers `a`, but
   * an unaliased export offers its declared name, and that is overwhelmingly the common case. Only
   * the TOP-LEVEL scope of that module is searched -- a local or a class member never crosses a
   * boundary as a free name, which is the same cut `isVisibleFrom` makes via `scope.parent`.
   */
  moduleOffering(moduleFile: string, offered: string): SymbolEntry | undefined {
    const root = this.rootFor(moduleFile);
    if (!root) return undefined;

    const direct = root.table.get(offered);
    // A declaration whose export was NOT renamed still offers its own name. One that WAS renamed
    // offers only the alias, so a direct hit whose exportName is a different name does not count.
    if (direct) {
      const exported = direct.exportName ? ast.symbolName(direct.exportName) : undefined;
      if (exported === undefined || exported === offered) return direct;
    }

    for (const entry of root.table.values()) {
      if (!entry.exportName) continue;
      if (ast.symbolName(entry.exportName) === offered) return entry;
    }
    return undefined;
  }

  /** Does `moduleFile`'s own top-level scope already declare `name`? (A local definition wins.) */
  hasOwnTopLevel(moduleFile: string, name: string): boolean {
    return this.rootFor(moduleFile)?.table.has(name) ?? false;
  }

  /**
   * Bind `name` in `moduleFile`'s top-level scope to an EXISTING entry from another module.
   *
   * The alias binding, and the only writer of a name a module did not declare. It shares the target
   * entry rather than copying it, which is what makes the rename transparent everywhere downstream:
   * codegen resolves an identifier to a `SymbolEntry` and derives the emitted name from THAT (the JS
   * inliner keys on `source::declaredName`), so an aliased reference emits the same inlined binding
   * as an unaliased one with no codegen change at all.
   */
  bindTopLevel(moduleFile: string, name: string, entry: SymbolEntry): void {
    const root = this.rootFor(moduleFile);
    if (!root || root.table.has(name)) return;
    root.table.set(name, entry);
    this.cacheValid = false;
    this.indexValid = false;
    this.symbolCache.clear();
    this.importPriorityCache.clear();
  }

  private rootFor(moduleFile: string): Scope | undefined {
    return this.scopes.find(
      (s) => moduleOf(s) !== undefined && path.resolve(moduleOf(s)!) === path.resolve(moduleFile)
    );
  }

  /**
   * Re-point this module's top-level entries at the DESUGARED nodes (S1a).
   *
   * There are two trees per module and the symbol table indexes the wrong one. The stage order is
   * symbols -> desugar -> types, deliberately (the desugar comment in Context explains why it cannot
   * move: the scope index is built over the pre-desugar tree and `scopeOf` climbs `_parent` back into
   * it). But `DesugarAstVisitor` REBUILDS nodes, so after it runs, `SymbolEntry.value` still points at
   * pre-desugar objects while everything downstream -- type inference, and therefore `Context.nodeTypes`
   * -- works on the new ones.
   *
   * For the module being compiled that is harmless: codegen walks the desugared tree directly and never
   * consults `entry.value` for its own bodies. For an IMPORTED module it is the N14 bug. The JS inliner
   * emits `resolved.value` -- the pre-desugar body -- and the on-demand HIR lowering then asks the type
   * channel about nodes that were never typed, because the typed copies are different objects. Every
   * type-driven decision degrades at once: `(/ Int Int)` loses D49d's integer division and an Int
   * literal loses its BigInt suffix.
   *
   * Measured on the two-file repro: the two trees carry the SAME source ranges (`33..49`, `41..48`,
   * `44..45`, `46..47`) and share no object identity at all -- which is both the proof and the fix.
   * Matching on `_type` + exact source range is unambiguous: a rebuild preserves the span a construct
   * occupies, and two different constructs of the same kind cannot occupy the same span.
   *
   * Only ROOT entries are re-pointed. A local or a class member never crosses a module boundary as a
   * free name (the same cut `isVisibleFrom` and `moduleOffering` make), so nothing else can be reached
   * through an import, and leaving them alone keeps the change as small as the bug.
   *
   * Returns the number of entries re-pointed -- the instrument. A module whose count is 0 while it
   * declares top-level names means the match failed and N14 is silently back.
   */
  repointAfterDesugar(moduleFile: string, desugared: ast.ASTNode): number {
    const root = this.rootFor(moduleFile);
    if (!root) return 0;

    const key = (n: any): string | undefined => {
      const s = n?._location?.start?.offset;
      const e = n?._location?.end?.offset;
      if (s === undefined || e === undefined) return undefined;
      return `${n._type}@${s}..${e}`;
    };

    // Index the desugared tree by kind+span. First writer wins: an outer node is visited before the
    // inner one it wraps, and a definition is the outermost thing at its own span.
    const index = new Map<string, ast.ASTNode>();
    const seen = new Set<any>();
    const walk = (n: any): void => {
      if (!n || typeof n !== "object" || seen.has(n)) return;
      seen.add(n);
      if (n._type) {
        const k = key(n);
        if (k !== undefined && !index.has(k)) index.set(k, n as ast.ASTNode);
      }
      for (const prop of Object.keys(n)) {
        if (prop === "_parent" || prop === "_location") continue;
        const v = n[prop];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") walk(v);
      }
    };
    walk(desugared);

    let repointed = 0;
    for (const entry of root.table.values()) {
      const k = key(entry.value);
      if (k === undefined) continue;
      const replacement = index.get(k);
      if (replacement && replacement !== entry.value) {
        entry.value = replacement;
        repointed++;
      }
    }

    // The entries moved, so any cached view of them is stale.
    if (repointed > 0) {
      this.cacheValid = false;
      this.indexValid = false;
      this.symbolCache.clear();
      this.importPriorityCache.clear();
    }
    return repointed;
  }

  /**
   * Merge another module's symbols into this table. Keyed by the MODULE, and idempotent.
   *
   * `this.scopes` is a FOREST of module roots, and `resolveSymbol`'s flat root-union is what makes a
   * symbol declared in another module visible here. That union is only sound while each module appears
   * in it ONCE -- so re-joining a module must REPLACE its root, never append a second one.
   *
   * It used to append: `this.scopes = [...this.scopes, ...other.scopes]`, no dedupe. In a single
   * compile that is invisible, because the module cache guarantees each module joins exactly once. In
   * a REUSED Context -- the whole point of a Context -- re-processing a file stacked a second root for
   * it and the first one never left. And that is not a leak, it is a WRONG ANSWER: the flat cache is
   * first-wins over `scopes` in join order, so the OLDEST root wins, and a symbol from a version of the
   * file that no longer exists beats the one that does. Measured: `(let x 1)` re-typechecked as
   * `(let x "hello")` still resolved `x` as Int, permanently.
   *
   * There was also a `joinWithoutDuplication` sitting right below this, which DID dedupe -- by
   * `scope.node` -- and was called only on the module-cache path, where the scopes are the identical
   * objects and it was therefore a no-op. Node identity could never have fixed the real case anyway: a
   * re-parse produces a brand new ProgramNode every time. **The key is the module, not the node.** One
   * join, one key; the two-methods-with-two-notions-of-"same" is what let the wrong one own the hot path.
   */
  join(other: SymbolTable): SymbolTable {
    for (const incoming of other.scopes) {
      const module = moduleOf(incoming);

      // A root with no source cannot be identified, so it can only be appended -- never matched, never
      // replaced. Appending an unidentifiable root is what the old code did to EVERY root.
      const at = module === undefined ? -1 : this.scopes.findIndex((s) => moduleOf(s) === module);

      if (at >= 0) {
        this.scopes[at] = incoming;
      } else {
        this.scopes.push(incoming);
      }
    }

    // Every index into the forest is now stale.
    this.cacheValid = false;
    this.indexValid = false;
    this.symbolCache.clear();
    this.importPriorityCache.clear();
    return this;
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

  defineSymbol(node: ast.VariableNode | ast.FunctionNode | ast.ClassNode | ast.InterfaceNode | ast.TypeDefNode | ast.StructNode | ast.ModifierDefNode | ast.AttributeDefNode | ast.EnumNode) {
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
    } else if (node._type === "modifier-def" || node._type === "attribute-def") {
      // ModifierDefNode and AttributeDefNode both carry `name` as a plain string
      name = (node as ast.ModifierDefNode | ast.AttributeDefNode).name;
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
