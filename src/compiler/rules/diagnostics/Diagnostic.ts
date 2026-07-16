import type * as ast from "../../frontend/ast";
import type { Context } from "../../Context";
import type { Rule, RuleSeverity } from "../RuleBuilder";

/**
 * A centralized diagnostic DEFINITION -- a code, a severity, and a message TEMPLATE.
 *
 * This is the imperative counterpart to `NodeValidationRules`. A structural rule carries its own
 * `test` predicate and is checked declaratively; an imperative diagnostic has ALREADY been decided
 * at a call site (the type checker found the mismatch, the resolver found the missing name), so it
 * needs no `test` -- only the code/severity/message to record. Centralizing those three here is what
 * lets a call site stop hardcoding `("LL0203", `...`)` literals, and it gives ONE place per category
 * to find a free code number.
 *
 * The message is a FUNCTION of typed params rather than a fixed string, because nearly every
 * diagnostic interpolates runtime values (an arg index, a formatted type, a symbol name). The params
 * are deliberately PRIMITIVES -- strings, numbers -- and any type formatting happens at the call site
 * (`TypeChecker.formatType(...)`), so this module and everything under `rules/diagnostics/` stays a
 * LEAF with no compiler-internal runtime imports. If a def ever needs to import `TypeChecker` or an
 * AST helper to build its text, that is the design slipping: pre-format at the call site instead.
 */
export interface DiagnosticDef<P = void> {
  readonly code: string;
  readonly severity: RuleSeverity;
  readonly message: (params: P) => string;
}

/**
 * Define a diagnostic. The `name` is the KEY it is exported under in a category map -- it is not
 * repeated here, so the category files read as plain data.
 */
export function def<P = void>(
  code: string,
  severity: RuleSeverity,
  message: (params: P) => string
): DiagnosticDef<P> {
  return { code, severity, message };
}

/**
 * Report a diagnostic. Builds the interpolated `Rule` and hands it to the Context's single sink,
 * exactly as the old `report*Error` helpers did (`test: () => true` -- the check already happened).
 *
 * A free function so the two non-visitor reporters (`Context`, `JSClassBuilder`) can use it directly;
 * visitors get the thinner `this.report(def, node, params)` from `BaseAstVisitor`.
 */
export function report<P>(
  context: Context,
  d: DiagnosticDef<P>,
  node: ast.ASTNode,
  params: P
): void {
  const rule: Rule<ast.ASTNode> = {
    code: d.code,
    severity: d.severity,
    message: d.message(params),
    test: () => true,
  };
  context.results.add(node, rule, context);
}
