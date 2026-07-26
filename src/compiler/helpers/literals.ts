import * as ast from "../frontend/ast";

/**
 * IS THIS NODE A CONSTANT, AND WHAT IS IT?
 *
 * One question with several askers, so it gets one answer. The reflection metadata table is emitted
 * as DATA -- a `ll_map_of` of literals on C, an object literal on JS -- so only a literal can reach
 * it, and every consumer of that fact has to agree on which nodes qualify:
 *
 *   - a `defattribute` argument MUST be one (D72/LL0033), because an attribute is data
 *   - a `defmodifier` argument MAY be one, and is carried only if it is (D72)
 *   - an enum member's explicit value is one, or the member reports no value at all (D70)
 *
 * It lives here rather than beside its first caller because those askers sit in different layers --
 * the syntax rules run before the symbol table exists, the metadata builder runs after types -- and
 * a shared predicate must not drag either of them into the other's dependencies. This module imports
 * nothing but the AST.
 *
 * Anything not listed answers undefined, and every caller treats that as "I do not know" rather than
 * substituting a guess. A `string` node's `value` is already unquoted and unescaped by the builder.
 */
export function literalValueOf(node: ast.ASTNode | undefined): string | number | boolean | undefined {
  const n = node as any;
  if (!n || typeof n !== "object") return undefined;
  switch (n._type) {
    case "integer-number":
    case "float-number":
      return typeof n.value === "number" ? n.value : undefined;
    case "string":
      return typeof n.value === "string" ? n.value : undefined;
    case "boolean":
      return typeof n.value === "boolean" ? n.value : undefined;
    default:
      return undefined;
  }
}
