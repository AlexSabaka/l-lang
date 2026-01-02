import { InferredType } from "./TypeEnvironment";

/**
 * TypeChecker - Handles type compatibility and promotion rules
 * Follows C# semantics with numeric type promotion
 */
export class TypeChecker {
  /**
   * Check if 'source' can be assigned to 'target'
   * Returns true if assignment is valid
   */
  static isAssignable(source: InferredType, target: InferredType): boolean {
    // Exact match
    if (this.typesEqual(source, target)) {
      return true;
    }

    // Any type accepts everything (like 'object' in C#)
    if (target.kind === "unknown" && target.name === "Any") {
      return true;
    }

    // Null can be assigned to nullable types
    if (source.name === "Null" && target.nullable) {
      return true;
    }

    // Numeric promotion: Int -> Real (like C# int -> double)
    if (this.canPromote(source, target)) {
      return true;
    }

    // Array covariance: Array<Derived> -> Array<Base> (read-only)
    if (this.isArrayCovariant(source, target)) {
      return true;
    }

    // Union types: T is assignable to T1 | T2 if T is assignable to any alternative
    if (target.kind === "union") {
      return target.alternatives?.some(alt => this.isAssignable(source, alt)) ?? false;
    }

    // Source union: T1 | T2 is assignable to T if all alternatives are assignable
    if (source.kind === "union") {
      return source.alternatives?.every(alt => this.isAssignable(alt, target)) ?? false;
    }

    // TODO: Interface implementation checking
    // TODO: Class inheritance checking

    return false;
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

    // Check generics (e.g., Array<Int> vs Array<String>)
    if (a.generics && b.generics) {
      if (a.generics.length !== b.generics.length) {
        return false;
      }
      return a.generics.every((g, i) => this.typesEqual(g, b.generics![i]));
    }

    // Check function signatures
    if (a.kind === "function" && b.kind === "function") {
      if (!this.typesEqual(a.returns!, b.returns!)) {
        return false;
      }
      if (a.params!.length !== b.params!.length) {
        return false;
      }
      return a.params!.every((p, i) => this.typesEqual(p, b.params![i]));
    }

    return true;
  }

  /**
   * Array covariance check
   * Array<Derived> can be used where Array<Base> is expected (read-only)
   */
  static isArrayCovariant(source: InferredType, target: InferredType): boolean {
    if (!source.isArray || !target.isArray) {
      return false;
    }

    if (!source.generics || !target.generics) {
      return false;
    }

    // TODO: Check if source element type is derived from target element type
    // For now, just check if they're assignable
    return this.isAssignable(source.generics[0], target.generics[0]);
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