import { InferredType, SymbolTable } from "../analysis/SymbolTable";

/**
 * TypeChecker - Handles type compatibility and promotion rules
 * Follows C# semantics with numeric type promotion
 */
export class TypeChecker {
  /**
   * Check if 'source' can be assigned to 'target'
   * Returns true if assignment is valid
   */
  static isAssignable(source: InferredType, target: InferredType, symbolTable?: SymbolTable): boolean {
    // Unwrap type-aliases and type-refs for comparison
    const sourceUnwrapped = this.unwrapType(source, symbolTable);
    const targetUnwrapped = this.unwrapType(target, symbolTable);

    // Exact match
    if (this.typesEqual(sourceUnwrapped, targetUnwrapped)) {
      return true;
    }

    // Any type accepts everything (like 'object' in C#)
    if (targetUnwrapped.kind === "unknown" && targetUnwrapped.name === "Any") {
      return true;
    }

    // THE ERASURE RULE WAS DELETED HERE (P5d). Generics have stopped being a lie.
    //
    //     if (isBareTypeParameter(source) || isBareTypeParameter(target)) return true;
    //
    // Every `T` passed, in BOTH directions, always. That single line was the whole of l-lang's
    // generics, and its own note admitted as much:
    //
    //     "Deciding that honestly means INSTANTIATING the class -- inferring `Container<Int>` from
    //      the call and substituting -- and that is a type system l-lang does not have."
    //
    // It has one now (P5b/P5c). `(Container 42)` infers `Container<Int>`; `(my-head [1 2 3])` solves
    // `T = Int` and returns `Int?`; `(Box (Dog))` is a `Box<Dog>` and is refused where a `Box<Animal>`
    // is wanted.
    //
    // THE ORDERING IS WHAT MADE THE DELETION POSSIBLE, and it took two attempts to see it. Deleting
    // the rule on its own reported `expected T, got Int` on every generic call in the corpus -- which
    // is not a type error, it is the checker complaining that it has not done its job yet. A generic
    // signature has to be SOLVED before its arguments are judged. Once `checkCallArguments` compares
    // against the INSTANTIATED signature, there is nothing left for this rule to paper over, and it
    // goes with zero corpus diagnostics.
    //
    // It also caught a real bug in one of Phase 5's own tests on the way out: `(fn first-of<T> [xs <-
    // T[]] -> T (return (elem xs 0)))` returns `T?`, not `T` -- `elem` is the TOTAL accessor -- and the
    // erasure rule had been hiding that LL0213 all along.
    //
    // A bare `T` that reaches here now is genuinely unsolved -- inside a generic body, `this.value`
    // really is `T` and there is nothing to compare it to. Gradual typing already covers that: an
    // unbound name converts to Unknown, and `isUnknown` short-circuits the check. What is gone is the
    // blanket amnesty.

    // --- nil, and `T?` (D9) ---------------------------------------------------------------------
    //
    // These three rules ARE "non-nullable by default". Note the first was already in force before D9
    // -- nothing ever set the flag on a target, so `isAssignable(Nil, String)` fell through to
    // `return false` and `(let x <- String nil)` was already an LL0200. What did not exist was any
    // way to say YES.

    // nil goes into an optional slot, and nowhere else.
    if (this.isNil(sourceUnwrapped)) {
      return !!targetUnwrapped.optional;
    }

    // `T?` does NOT go into a `T`. This is the forced unwrap, and it is the whole point of the
    // feature: the value might be nil, and the target promises it never is.
    if (sourceUnwrapped.optional && !targetUnwrapped.optional) {
      return false;
    }

    // `T` WIDENS into a `T?`. An optional is a superset, not a nil-only slot -- `(let x <- String?
    // "hi")` is ordinary code. Compare the underlying types with the flag set aside on both sides, so
    // that `Dog -> Animal?` still gets subtyping, promotion and the rest of the ladder below.
    if (targetUnwrapped.optional) {
      return this.isAssignable(
        { ...sourceUnwrapped, optional: false },
        { ...targetUnwrapped, optional: false },
        symbolTable
      );
    }

    // Numeric promotion: Int -> Real (like C# int -> double)
    if (this.canPromote(sourceUnwrapped, targetUnwrapped)) {
      return true;
    }

    // Array covariance: Array<Derived> -> Array<Base> (read-only)
    if (this.isArrayCovariant(sourceUnwrapped, targetUnwrapped, symbolTable)) {
      return true;
    }

    // Union types: T is assignable to T1 | T2 if T is assignable to any alternative
    if (targetUnwrapped.kind === "union") {
      // For each target alternative, unwrap it and check if source is assignable to it
      return targetUnwrapped.alternatives?.some((alt: InferredType) => {
        const unwrappedAlt = this.unwrapType(alt, symbolTable);
        return this.isAssignable(sourceUnwrapped, unwrappedAlt, symbolTable);
      }) ?? false;
    }

    // Source union: T1 | T2 is assignable to T if all alternatives are assignable
    if (sourceUnwrapped.kind === "union") {
      // For each source alternative, unwrap it and check if it's assignable to target
      const allAssignable = sourceUnwrapped.alternatives?.every((alt: InferredType) => {
        const unwrappedAlt = this.unwrapType(alt, symbolTable);
        return this.isAssignable(unwrappedAlt, targetUnwrapped, symbolTable);
      }) ?? false;
      return allAssignable;
    }

    // Nominal subtyping: `Dog` is an `Animal`; a `DogProducer` is a `Producer<Dog>`; and -- because
    // `T` is declared `:out` -- a `Producer<Dog>` is a `Producer<Animal>`.
    //
    // This replaces `// TODO: Interface implementation checking` / `// TODO: Class inheritance
    // checking`, which meant isAssignable(Dog, Animal) was literally FALSE. Everything that follows
    // from inheritance -- passing a subclass to a function typed on its parent -- was a type error.
    if (this.isSubtype(sourceUnwrapped, targetUnwrapped, symbolTable)) {
      return true;
    }

    return false;
  }

  /**
   * Is `source` a subtype of `target`? Walks the parent chain and the implemented interfaces.
   *
   * Nominal, not structural: a class is its ancestors and the interfaces it declares, and nothing
   * else. Needs the symbol table -- a type carries only the NAME of its parent, not the parent.
   *
   * Only ever ADDS assignability, so it cannot introduce a false positive on the corpus.
   */
  static isSubtype(source: InferredType, target: InferredType, symbolTable?: SymbolTable): boolean {
    if (!symbolTable || !source?.name || !target?.name) {
      return false;
    }

    // The iteration protocol (D30) is checked NOMINALLY, GRADUALLY on the element type. A native array,
    // or any value that (transitively) `:implements Iterable`/`Iterator`, satisfies `Iterable<_>` /
    // `Iterator<_>`. The element type ARGUMENTS are best-effort here -- a lambda's return type is not
    // inferred (so `map`'s element is `Any`), tuple elements are deferred -- and requiring them to match
    // only produces false positives on correct lazy chains. This is the same nominal test codegen's
    // dispatch (`receiverConformsTo`) already uses, so the two passes agree. (Arrays ARE iterable but are
    // NOT a nominal conformer for DISPATCH -- that exclusion lives at the dispatch sites, via
    // `conformsNominally`, not here.)
    if (target.name === "Iterable" || target.name === "Iterator") {
      if (source.isArray || source.name === "Array") return true;
      if (this.conformsNominally(source, target.name, symbolTable)) return true;
    }

    const seen = new Set<string>();

    const visit = (type: InferredType | undefined): boolean => {
      if (!type?.name || seen.has(type.name)) {
        return false;
      }
      seen.add(type.name);

      // The same nominal type. Whether it MATCHES then depends on the type arguments, and that is
      // where variance lives: `Producer<Dog>` reaches `Producer<Animal>` only because `T` is `:out`.
      if (type.name === target.name && this.typeArgumentsAssignable(type, target, symbolTable)) {
        return true;
      }

      // Re-resolve to the DECLARED type to reach its TRANSITIVE supers. The `interfaceType` stored on
      // an `:implements` entry is a bare `{name, generics}` with no supers of its own, so a multi-hop
      // interface chain (`Iterator :implements Iterable`, or `C :implements B :implements A`) is
      // invisible without this. The direct-match check above still uses the passed `type`, which
      // carries the concrete type ARGUMENTS from the `:implements` clause; the recursion below uses the
      // re-resolved declaration, which carries the SUPERS. (`seen` keys on name, so we cannot visit
      // both a bare and a declared node of the same name -- fold them into one step here.)
      const declared = symbolTable.resolveSymbol(type.name)?.inferredType;
      const supersFrom = declared ?? type;

      // The interfaces it declares. Their type ARGUMENTS come from the `:implements` clause, so a
      // DogProducer arrives here as `Producer<Dog>` rather than a bare `Producer`.
      for (const impl of supersFrom.implementedInterfaces ?? []) {
        if (visit(impl.interfaceType ?? { kind: "interface", name: impl.interfaceName })) {
          return true;
        }
      }

      // Its parent, resolved by name.
      const parentClass = supersFrom.parentClass ?? type.parentClass;
      if (parentClass) {
        const parent = symbolTable.resolveSymbol(parentClass);
        if (visit(parent?.inferredType)) {
          return true;
        }
      }

      return false;
    };

    return visit(source);
  }

  /**
   * Purely NOMINAL conformance -- `type` IS `name`, or (transitively) `:implements`/`:extends` it -- with
   * NO array leniency and NO element-type check. This is the dispatch question ("does `(x.m)` resolve to
   * an `:extension m` written on `name`?"), the checker's twin of codegen's `receiverConformsTo`: a
   * native array is NOT a nominal `Iterable`, so `(arr.map f)` stays on native eager array.map. Re-resolves
   * each interface by name to reach its own supers (`Iterator :implements Iterable`).
   */
  static conformsNominally(
    type: InferredType | undefined,
    name: string,
    symbolTable: SymbolTable,
    seen: Set<string> = new Set()
  ): boolean {
    if (!type?.name || seen.has(type.name)) return false;
    seen.add(type.name);
    if (type.name === name) return true;

    const declared = symbolTable.resolveSymbol(type.name)?.inferredType;
    const from = declared ?? type;

    for (const impl of from.implementedInterfaces ?? []) {
      if (impl.interfaceName === name) return true;
      const sup = symbolTable.resolveSymbol(impl.interfaceName)?.inferredType;
      if (sup && this.conformsNominally(sup, name, symbolTable, seen)) return true;
    }

    const parent = from.parentClass;
    if (parent) {
      const p = symbolTable.resolveSymbol(parent)?.inferredType;
      if (p && this.conformsNominally(p, name, symbolTable, seen)) return true;
    }
    return false;
  }

  /**
   * Compare two same-named generic types' arguments, honouring DECLARATION-SITE variance.
   *
   *   :out T   covariant      -- Producer<Dog> is a Producer<Animal>
   *   :in T    contravariant  -- Consumer<Animal> is a Consumer<Dog>
   *   T        invariant      -- Box<Dog> is NOT a Box<Animal>, and that is the default
   *
   * The variance belongs to the DECLARATION, not the use: `Producer<Dog>` does not know it is
   * covariant, `(definterface Producer<:out T>)` does. So it is looked up, not read off the operand.
   */
  private static typeArgumentsAssignable(
    source: InferredType,
    target: InferredType,
    symbolTable?: SymbolTable
  ): boolean {
    const sourceArgs = source.generics ?? [];
    const targetArgs = target.generics ?? [];

    // A bare `Producer` against a `Producer<Animal>`: the arguments were never written, so there is
    // nothing to compare and nothing to complain about. Same reasoning as a bare type parameter.
    if (sourceArgs.length === 0 || targetArgs.length === 0) {
      return true;
    }
    if (sourceArgs.length !== targetArgs.length) {
      return false;
    }

    const declaration = symbolTable?.resolveSymbol(target.name)?.inferredType;
    const params = declaration?.generics ?? [];

    return sourceArgs.every((arg, i) => {
      switch (params[i]?.variance) {
        case "out":
          return this.isAssignable(arg, targetArgs[i], symbolTable);
        case "in":
          return this.isAssignable(targetArgs[i], arg, symbolTable);
        default:
          return this.typesEqual(
            this.unwrapType(arg, symbolTable),
            this.unwrapType(targetArgs[i], symbolTable)
          );
      }
    });
  }

  /**
   * Find a user-defined operator in a type
   */
  static findOperator(type: InferredType, op: string, paramCount: number, symbolTable?: SymbolTable): InferredType | undefined {
    const unwrapped = this.unwrapType(type, symbolTable);

    if (unwrapped.kind === "struct" || unwrapped.kind === "class") {
      const member = unwrapped.members?.find(m => m.isOperator && m.operatorSymbol === op && (m.type as any).params?.length === paramCount);
      return member?.type;
    }

    return undefined;
  }

  /**
   * Unwrap type-alias and type-ref to get the underlying type
   */
  static unwrapType(type: InferredType, symbolTable?: SymbolTable): InferredType {
    if (!type) {
      return type;
    }

    // If it's a type-alias, use its aliased type
    if (type.kind === "type-alias" && type.aliasedType) {
      return this.unwrapType(type.aliasedType, symbolTable);
    }

    // If it's a type-ref, look it up in the symbol table to get the actual type
    if (type.kind === "type-ref" && type.refName) {
      if (symbolTable) {
        const symbol = symbolTable.resolveSymbol(type.refName);
        if (symbol && symbol.inferredType) {
          return this.unwrapType(symbol.inferredType, symbolTable);
        }
      }
      // If no symbol table provided, just return the type-ref as-is
      // This will be handled by the union/array logic
    }

    return type;
  }

  /**
   * Check for numeric type promotion
   * Int -> Real (like C# int -> double)
   * Char -> Int -> Real
   */
  static canPromote(source: InferredType, target: InferredType): boolean {
    if (source.kind !== "primitive" || target.kind !== "primitive") {
      return false;
    }

    const promotionRules: Record<string, string[]> = {
      "Char": ["Int", "Real"],
      "Int": ["Real"],
    };

    return promotionRules[source.name]?.includes(target.name) ?? false;
  }

  /**
   * Check exact type equality
   */
  static typesEqual(a: InferredType, b: InferredType): boolean {
    if (a.kind !== b.kind || a.name !== b.name) {
      return false;
    }

    // Check array flag
    if (a.isArray !== b.isArray) {
      return false;
    }

    // `String?` is NOT `String` (D9). Without this, typesEqual -- which runs FIRST in isAssignable --
    // compares the two by name, finds them equal, and returns true before the optional rules below
    // are ever consulted. The forced unwrap would have been silently dead, and `T?` would have been
    // an annotation that parsed, type-checked, and meant nothing.
    if (!!a.optional !== !!b.optional) {
      return false;
    }

    // Generic ARGUMENTS must match. The old guard was `if (a.generics && b.generics)`, so a type
    // with generics compared EQUAL to the same type without them -- `Box<Int>` === bare `Box` --
    // by falling through to the `return true` at the end.
    //
    // Compare by LENGTH, treating absent and empty as the same thing: a non-generic class carries
    // `generics: []` while its unwrapped type-ref carries `undefined`, and those are the same type.
    // (Testing `!!a.generics !== !!b.generics` instead looks right and is not -- it makes `Complex`
    // unassignable to `Complex`.)
    const aGenerics = a.generics ?? [];
    const bGenerics = b.generics ?? [];
    if (aGenerics.length !== bGenerics.length) {
      return false;
    }
    if (!aGenerics.every((g: InferredType, i: number) => this.typesEqual(g, bGenerics[i]))) {
      return false;
    }

    // Map types carry keyType/valueType, NOT generics -- so the guard above never saw them and
    // NOTHING compared them. `Map<String,Int>` compared equal to `Map<String,Boolean>`, and
    // isAssignable short-circuits on typesEqual, so the assignment type-checked.
    if (a.kind === "map" || b.kind === "map") {
      if (a.kind !== b.kind) return false;
      const keyOk =
        !a.keyType && !b.keyType
          ? true
          : !!a.keyType && !!b.keyType && this.typesEqual(a.keyType, b.keyType);
      const valueOk =
        !a.valueType && !b.valueType
          ? true
          : !!a.valueType && !!b.valueType && this.typesEqual(a.valueType, b.valueType);
      if (!keyOk || !valueOk) return false;
    }

    // Check function signatures
    if (a.kind === "function" && b.kind === "function") {
      if (!this.typesEqual(a.returns!, b.returns!)) {
        return false;
      }
      if (a.params!.length !== b.params!.length) {
        return false;
      }
      return a.params!.every((p: InferredType, i: number) => this.typesEqual(p, b.params![i]));
    }

    return true;
  }

  /**
   * Array covariance check
   * Array<Derived> can be used where Array<Base> is expected (read-only)
   */
  static isArrayCovariant(source: InferredType, target: InferredType, symbolTable?: SymbolTable): boolean {
    if (!source.isArray || !target.isArray) {
      return false;
    }

    if (!source.generics || !target.generics) {
      return false;
    }

    // TODO: Check if source element type is derived from target element type
    // For now, just check if they're assignable
    return this.isAssignable(source.generics[0], target.generics[0], symbolTable);
  }

  /**
   * Find common type for multiple expressions (for type inference)
   * Used in scenarios like: let x = cond ? 1 : 2.5  => Real
   */
  static findCommonType(types: InferredType[]): InferredType | undefined {
    if (types.length === 0) {
      return undefined;
    }

    if (types.length === 1) {
      return types[0];
    }

    // If all types are the same, return that type
    const first = types[0];
    if (types.every(t => this.typesEqual(t, first))) {
      return first;
    }

    // Check numeric promotion
    const allNumeric = types.every(t => 
      t.kind === "primitive" && ["Int", "Real", "Char"].includes(t.name)
    );

    if (allNumeric) {
      // If any is Real, promote all to Real
      if (types.some(t => t.name === "Real")) {
        return { kind: "primitive", name: "Real" };
      }
      // If any is Int, promote Char to Int
      if (types.some(t => t.name === "Int")) {
        return { kind: "primitive", name: "Int" };
      }
      return { kind: "primitive", name: "Char" };
    }

    // TODO: Find common base class/interface

    // Fallback: create union type
    return {
      kind: "union",
      name: types.map(t => t.name).join(" | "),
      alternatives: types,
    };
  }

  /**
   * Format type for error messages
   */
  static formatType(type: any): string {
    if (!type) {
      return "Unknown";
    }

    // If it's not a proper type object, stringify it carefully
    if (typeof type !== 'object' || !type.kind) {
      return JSON.stringify(type).substring(0, 50) || "Unknown";
    }

    // `String?` (D9). Without this every diagnostic about an optional prints it as `String` -- so
    // "cannot assign String to String" would be the message for the forced unwrap, which is the one
    // error the feature exists to produce.
    if (type.optional) {
      return `${this.formatType({ ...type, optional: false })}?`;
    }

    if (type.isArray) {
      return `${this.formatType(type.generics![0])}[]`;
    }

    if (type.kind === "generic" && type.generics) {
      const generics = type.generics.map((g: any) => this.formatType(g)).join(", ");
      return `${type.name}<${generics}>`;
    }

    if (type.kind === "function") {
      const params = type.params!.map((p: any) => this.formatType(p)).join(", ");
      const ret = this.formatType(type.returns!);
      return `(${params}) -> ${ret}`;
    }

    if (type.kind === "union") {
      return type.alternatives!.map((a: any) => this.formatType(a)).join(" | ");
    }

    // Type-alias: format as the aliased type
    if (type.kind === "type-alias") {
      return `${type.name}` + (type.aliasedType ? ` (alias for ${this.formatType(type.aliasedType)})` : "");
    }

    // Type-ref: format as the reference name
    if (type.kind === "type-ref") {
      return type.refName || type.name;
    }

    // Struct: format as struct name
    if (type.kind === "struct") {
      return `struct ${type.name}`;
    }

    // Array: format with element type
    if (type.kind === "array" && type.inner) {
      return `${this.formatType(type.inner)}[]`;
    }

    return type.name || "Unknown";
  }

  /**
   * Get result type of binary operation
   */
  static getBinaryOpType(
    op: string,
    left: InferredType,
    right: InferredType
  ): InferredType | undefined {
    // Arithmetic: +, -, *, /, %
    if (["+", "-", "*", "/", "%"].includes(op)) {
      if (this.isNumeric(left) && this.isNumeric(right)) {
        return this.findCommonType([left, right]);
      }
      // String concatenation with +
      if (op === "+" && (left.name === "String" || right.name === "String")) {
        return { kind: "primitive", name: "String" };
      }
      return undefined;
    }

    // Comparison: <, >, <=, >=, ==, !=
    if (["<", ">", "<=", ">=", "==", "!="].includes(op)) {
      return { kind: "primitive", name: "Boolean" };
    }

    // Logical: &&, ||
    if (["&&", "||"].includes(op)) {
      if (left.name === "Boolean" && right.name === "Boolean") {
        return { kind: "primitive", name: "Boolean" };
      }
      return undefined;
    }

    return undefined;
  }

  /**
   * Is this call head an OPERATOR, rather than a function or method name?
   *
   * Load-bearing. `inferOperatorType` had quietly become the fallback for any call head the type
   * system could not resolve, so every JS global and every member call was run through the
   * operator tables and then reported as an invalid operator:
   *
   *     Invalid unary operator 'Math.log' for type Int
   *     Invalid binary operator 'template.replace' for types String and String
   *
   * Tested by SHAPE, not against a fixed list, because operators are user-extensible: l-lang has
   * `(fn :operator · [v2 <- Vector3] ...)` in the stdlib. An operator name is punctuation -- it
   * contains no word characters -- while `Math.log`, `indexOf` and `new` all do.
   */
  static isOperatorName(name: string): boolean {
    return name.length > 0 && !/\w/.test(name);
  }

  /**
   * Nothing is known about this type. Never report an error against it.
   *
   * This has to be STRUCTURAL, not just a check on the top-level kind. `(let result [])` -- an
   * empty vector -- is `Unknown[]`, and an array whose element type we could not infer tells us
   * exactly as little as a bare Unknown does. Treating it as a known type made the stdlib's
   *     (fn range [...] -> Int[] (let result []) ... (return result))
   * report "declares it returns Int[], but returns Unknown[]" -- which is not a defect in `range`,
   * it is the checker complaining about its own ignorance.
   */
  static isUnknown(type: InferredType | undefined): boolean {
    if (!type) return true;
    if (type.kind === "unknown" || type.name === "Unknown") return true;
    // A generic (including an array) whose every argument is unknown is itself uninformative.
    if (type.generics?.length && type.generics.every((g) => this.isUnknown(g))) return true;
    // A UNION with an unknown ALTERNATIVE is uninformative -- and note it is `some` here where it is
    // `every` above, which is not an inconsistency but the actual rule:
    //
    //   a generic is narrowed by each argument, so one KNOWN argument still says something;
    //   a union is widened by each alternative, so one UNKNOWN alternative says nothing.
    //
    // `(x <- String | Number)` -- `Number` names no l-lang type (the primitives are Int, Real,
    // String, Char, Boolean, Void, Any), so this is `String | Unknown`. We cannot know what that
    // Unknown admits, therefore we cannot know that a Boolean is NOT one of them. Reporting anyway
    // is how a gradual checker becomes a noise generator, and it is the rule this type system has
    // held to everywhere else.
    if (type.alternatives?.length && type.alternatives.some((a) => this.isUnknown(a))) return true;
    return false;
  }

  /**
   * The type of the `nil` literal (D9).
   *
   * `Void` is accepted as the same thing. In a Lisp everything is an expression, so "returns nothing"
   * and "returns the bottom value" are one statement -- a function that runs off its end emits `null`
   * and is declared `-> Void`. Keeping them distinct would mean `(fn f [] -> Void)` could not return
   * `nil`, which is the only value it CAN return.
   */
  static isNil(type: InferredType | undefined): boolean {
    if (!type) return false;
    return type.kind === "primitive" && (type.name === "Nil" || type.name === "Void");
  }

  /**
   * An UNINSTANTIATED type parameter -- the `T` of `(defclass Container<T>)`, standing for a type we
   * have not inferred.
   *
   * Distinct from an INSTANTIATED generic: `Container<Int>` and `Int[]` are also `kind: "generic"`,
   * but they carry their arguments and are compared structurally. A type parameter carries none --
   * there is nothing to compare it against.
   */
  static isBareTypeParameter(type: InferredType | undefined): boolean {
    return !!type && type.kind === "generic" && !type.generics?.length;
  }

  /**
   * Replace every type VARIABLE in `type` with its solution (Phase 5).
   *
   * Lives here, not in the checker's visitor, because two very different consumers need exactly the
   * same operation and must not disagree about it: the call site (`(my-head [1 2 3])` -> `Int?`) and
   * MEMBER ACCESS on a generic instance (`c.value` on a `Container<Int>` -> `Int`, not `T`).
   *
   * `optional` is a FLAG, not a wrapper (D9), and carrying it is the whole point: lose it and `T?`
   * quietly becomes `T`, LL0205 never fires, every gate stays green, and the feature looks finished
   * while doing nothing.
   */
  static substitute(type: InferredType, subst: Map<string, InferredType>): InferredType {
    if (!type || subst.size === 0) return type;

    if (this.isBareTypeParameter(type) && subst.has(type.name)) {
      const solved = subst.get(type.name)!;
      return type.optional || solved.optional ? { ...solved, optional: true } : solved;
    }

    const result = { ...type };
    if (type.generics) result.generics = type.generics.map((g) => this.substitute(g, subst));
    if (type.alternatives) result.alternatives = type.alternatives.map((a) => this.substitute(a, subst));
    if (type.inner) result.inner = this.substitute(type.inner, subst);
    if (type.params) result.params = type.params.map((p) => this.substitute(p, subst));
    if (type.returns) result.returns = this.substitute(type.returns, subst);
    if (type.keyType) result.keyType = this.substitute(type.keyType, subst);
    if (type.valueType) result.valueType = this.substitute(type.valueType, subst);
    return result;
  }

  /**
   * The substitution implied by an INSTANTIATION -- `Container<Int>` against `class Container<T>`
   * gives `{T -> Int}`.
   *
   * `declaration.generics` on a class holds its type PARAMETERS (the field means arguments on a
   * use-site and parameters on a declaration -- one of the sharper edges in this type system).
   */
  static instantiationOf(
    instance: InferredType,
    symbolTable?: SymbolTable
  ): { declaration: InferredType; subst: Map<string, InferredType> } | undefined {
    if (instance?.kind !== "generic" || !instance.generics?.length) return undefined;

    const declaration = symbolTable?.resolveSymbol(instance.name)?.inferredType;
    if (!declaration) return undefined;

    const params = declaration.generics ?? [];
    const subst = new Map<string, InferredType>();
    params.forEach((p, i) => {
      const arg = instance.generics![i];
      if (this.isBareTypeParameter(p) && arg) subst.set(p.name, arg);
    });

    return { declaration, subst };
  }

  /**
   * Check if type is numeric
   */
  static isNumeric(type: InferredType): boolean {
    return type.kind === "primitive" && ["Int", "Real", "Char"].includes(type.name);
  }

  /**
   * Get return type for unary operation
   */
  static getUnaryOpType(op: string, operand: InferredType): InferredType | undefined {
    if (op === "!" && operand.name === "Boolean") {
      return { kind: "primitive", name: "Boolean" };
    }

    if (["+", "-"].includes(op) && this.isNumeric(operand)) {
      return operand;
    }

    return undefined;
  }
}