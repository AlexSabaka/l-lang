import * as ast from "../frontend/ast";
import { InferredType, SymbolTable, TypeParameter } from "../analysis/SymbolTable";
import { nativeFieldType } from "./nativeMembers";
import { TypeChecker } from "./TypeChecker";
import { floorEntry } from "../floor/floor";

/**
 * TypeEnvironment - Manages type inference and binds inferred types to the symbol table
 * Maintains scope hierarchy during traversal and updates symbol entries with their inferred types
 */
export class TypeEnvironment {
  private symbolTable: SymbolTable;
  private scopeStack: Scope[] = [];

  /**
   * THE TYPE CHANNEL: what type does THIS expression have?
   *
   * The scope frames above are a traversal stack -- `exitScope` pops them and their `localTypes` go
   * with them, so when the pass ends every type it inferred is gone. That is why `typeEnv` was a dead
   * local in `Context`: there was nothing behind the door. Codegen consequently had NO per-node type
   * information at all, and had to guess -- with source-order lists, a hardcoded blacklist of field
   * names lifted from the example corpus, and a `__ll_copy` wrapped around every value on the chance
   * it might be a struct.
   *
   * This map is the answer to that question, and it OUTLIVES the pass. Identity-keyed, because the
   * same node objects flow desugar -> types -> codegen, and because a source span is not an identity
   * (see `setType`).
   *
   * It is deliberately SEPARATE from the symbol table's `inferredType`, which answers a different
   * question -- "what is the shape of the type named `Dog`?" -- and is keyed by symbol, not by node.
   * Both are needed. Neither substitutes for the other.
   */
  private readonly nodeTypes: Map<ast.ASTNode, InferredType> = new Map();

  /** The per-node type channel, for codegen. Empty until the types stage has run. */
  getNodeTypes(): ReadonlyMap<ast.ASTNode, InferredType> {
    return this.nodeTypes;
  }

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
   * The within-pass memo for `inferExpressionType`, keyed by node IDENTITY.
   *
   * It used to be keyed by `${_type}_${start.offset}_${end.offset}` -- the SOURCE SPAN. That is not a
   * key, it is a collision waiting for a desugarer: a synthesized node legitimately carries the
   * location of the node it wraps, so `(return e)` and `e` hash to the same string whenever they
   * share a `_type`. Which they do exactly when `e` is a CALL -- the common implicit return.
   *
   * The consequence was silent and precise: the return-list was typed `Unknown` first, `checkReturns`
   * then asked for `e`'s type, got the poisoned entry, and gave up. So an implicit return of a
   * LITERAL was checked (different `_type`, no collision) and an implicit return of a CALL was not --
   * and a gate written with a literal would have passed while the check was dead.
   *
   * Two distinct nodes are two distinct nodes, whatever they point at in the source.
   */
  setType(node: ast.ASTNode, type: InferredType): void {
    // The CHANNEL first, and unconditionally. The early-return below is about the memo -- and it used
    // to guard this write too, so every expression at module top level, outside any entered scope, was
    // recorded nowhere at all.
    this.nodeTypes.set(node, type);

    // The memo, which is scoped and is popped with its frame.
    if (this.scopeStack.length === 0) return;
    this.scopeStack[this.scopeStack.length - 1].localTypes.set(node, type);
  }

  /**
   * Get type for an expression node
   */
  getType(node: ast.ASTNode): InferredType | undefined {
    // Search from innermost scope outward
    for (let i = this.scopeStack.length - 1; i >= 0; i--) {
      const type = this.scopeStack[i].localTypes.get(node);
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
   * What type does `name` have, as seen FROM `from`?
   *
   * Four tiers, in order: this environment's own scope stack (narrowings and generic type
   * parameters, which deliberately SHADOW the declaration), the built-in primitives, a dotted member
   * walk, and finally the symbol table -- which is the thing that actually knows about scopes.
   *
   * `from` is what makes that last tier able to see a parameter or a local. Without it the lookup is
   * flat: it searches the module ROOTS only, so it answers about a top-level symbol of the same name
   * or about nothing at all. That is not a near-miss -- it is a wrong answer with the right shape,
   * and it is why `(fn f [] (let x <- Int 5) ...)` believed its `x` was a top-level `x` declared
   * String.
   *
   * A caller resolving a TYPE name may still omit `from`: a class, struct, interface or alias is
   * top-level by construction (ScanPass only ever scans top-level items), so for those the flat
   * search is not merely tolerable, it is the correct question.
   */
  resolveIdentifier(name: string, from?: ast.ASTNode): InferredType | undefined {
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

    // Support dot- AND colon-path member access. `config.host` and the map/record `config:host` are the
    // same field read; both split here (a record field is written either way). A leading `:` (a bare
    // keyword like `:host`) yields an empty base and falls through to undefined, unchanged.
    if ((name.includes('.') || name.includes(':')) && !name.startsWith(':')) {
        const parts = name.split(/[.:]/);

        // The intrinsic floor (D50): `Math.sqrt` is `Real -> Real` because the shared contract in
        // compiler/floor/floor.ts says so -- the same entry the C backend derives its runtime call
        // from. Without this the name resolved through `(let :extern Math)`, which is Unknown, so
        // the checker could not compare its own view of `Math.floor` against the C table's. They
        // disagreed for as long as both existed (D51 amendment (b)).
        //
        // Applied ONLY when the base is untyped. A floor name is a HOST global, so anything that
        // gives the base a real type -- a user's own `Math` object, an imported class -- is a
        // different thing that happens to share a spelling, and wins.
        const fe = floorEntry(name);
        if (fe) {
          const baseT = this.resolveIdentifier(parts[0], from);
          if (!baseT || baseT.kind === "unknown") {
            return { kind: "function", name, params: fe.params, returns: fe.ret, isVariadic: !!fe.variadic };
          }
        }
        // The BASE is a value -- a local, a parameter -- so it is resolved from `from` like any
        // other. The member names after it are not; they are looked up in the base's type.
        let currentType = this.resolveIdentifier(parts[0], from);

        if (!currentType) return undefined;

        for (let i = 1; i < parts.length; i++) {
           if (!currentType) return undefined;

           // An INSTANTIATED generic -- `Container<Int>` (Phase 5).
           //
           // Dereference to the declaration, and carry the type arguments through to the member's
           // type: `c.value` on a `Container<Int>` is `Int`, not the bare `T` the declaration says.
           // Without this, instantiating a class would ANNOUNCE the argument and then throw it away
           // at the only place it matters -- and member access would degrade to Unknown, which is a
           // silent loss of the very information the inference just recovered.
           let memberSubst: Map<string, InferredType> | undefined;
           const instantiated = TypeChecker.instantiationOf(currentType, this.symbolTable);
           if (instantiated) {
               currentType = instantiated.declaration;
               memberSubst = instantiated.subst;
           }

           // Resolve type-ref to actual type definition if needed. A type name: top-level, flat.
           if (currentType.kind === 'type-ref' && currentType.refName) {
               const resolved = this.resolveIdentifier(currentType.refName);
               if (resolved) currentType = resolved;
           }
           // A `deftype` alias to a record (`(deftype Person {:name <- String})`) -- follow it to the
           // record so its fields are visible.
           if (currentType.kind === 'type-alias' && currentType.aliasedType) {
               currentType = currentType.aliasedType;
           }

           const memberName = parts[i];
           // Lookup member in currentType. A `map` with `members` is an INFERRED record (Rb) -- a map
           // literal that kept its per-field types; its field access resolves the same way.
           if (currentType.kind === 'class' || currentType.kind === 'struct' || currentType.kind === 'interface' || currentType.kind === 'record' || (currentType.kind === 'map' && (currentType as any).members)) {
               const member: any = currentType.members?.find((m: any) => m.name === memberName);
               if (member) {
                   currentType = memberSubst
                     ? TypeChecker.substitute(member.type, memberSubst)
                     : member.type;
               } else {
                   // Member not found in 'members' list
                   // TODO: Handle interface inheritance lookups if needed
                   return undefined;
               }
           } else {
               // A native FIELD on a String/Array receiver (Phase T / Ja): `s.length` -> `Int`. Methods
               // (`s.toUpperCase`, `arr.shift`) are resolved by the method-call path, which takes their
               // return type directly -- modelling them as functions here would arity-check the args.
               const native = nativeFieldType(currentType, memberName);
               if (native) {
                   currentType = native;
               } else {
                   // Cannot access property on non-object type (primitive/func)
                   return undefined;
               }
           }
        }
        return currentType;
    }

    // Check symbol table for user-defined types
    const symbol = from
      ? this.symbolTable.resolveSymbol(name, from)
      : this.symbolTable.resolveSymbol(name);
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
   * Helper to create tuple types (`[Int String]`) -- fixed-length, positional, heterogeneous.
   */
  static tuple(elements: InferredType[]): InferredType {
    return {
      kind: "tuple",
      name: "Tuple",
      elements,
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
  /**
   * `typeParameters` is what makes a call site able to SOLVE for `T` (Phase 5).
   *
   * Without it, a function type records `params`, `returns` and `isVariadic` and nothing else -- so a
   * call site sees `T` in the signature and has no way to know it is a FREE VARIABLE to be solved
   * rather than a concrete type named "T". `funcType.returns` was handed back raw, and a declared
   * `-> T?` reached the caller as a literal `{kind:"generic", name:"T", optional:true}`, which no
   * check knows what to do with.
   */
  static function(
    params: InferredType[],
    returns: InferredType,
    isVariadic = false,
    typeParameters?: TypeParameter[]
  ): InferredType {
    return {
      kind: "function",
      name: "Function",
      params,
      returns,
      ...(isVariadic ? { isVariadic } : {}),
      ...(typeParameters?.length ? { typeParameters } : {}),
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
  localTypes: Map<ast.ASTNode, InferredType>;
  localIdentifiers: Map<string, InferredType>;  // For generic type parameters
}
