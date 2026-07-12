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

    // Null can be assigned to nullable types
    if (sourceUnwrapped.name === "Null" && targetUnwrapped.nullable) {
      return true;
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

    // TODO: Interface implementation checking
    // TODO: Class inheritance checking

    return false;
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

  /** Nothing is known about this type. Never report an error against it. */
  static isUnknown(type: InferredType | undefined): boolean {
    return !type || type.kind === "unknown" || type.name === "Unknown";
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