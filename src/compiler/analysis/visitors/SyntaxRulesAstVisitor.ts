import * as ast from "../../frontend/ast";
import { BaseAstTreeWalker } from "../../BaseAstTreeWalker";
import { checkRules, Rule, Rules as r } from "../../rules";
import { createRule, RuleSeverity } from "../../rules/RuleBuilder";
import {
  builtinModifiersFor,
  collectDefinedModifiers,
  suggestModifier,
  RESERVED_NATIVE_MODIFIERS,
} from "../../helpers/modifiers";

export class SyntaxRulesAstVisitor extends BaseAstTreeWalker {
  /**
   * Modifier names defined in this module by `(defmodifier name ...)`. Populated in visitProgram,
   * which the tree walker runs before it descends into the children -- see D4 enforcement in
   * visitModifier below.
   */
  private definedModifiers: Set<string> = new Set();

  visitProgram(node: ast.ProgramNode) {
    this.definedModifiers = collectDefinedModifiers(node);
    return node;
  }

  /**
   * D4: an unknown `:modifier` is a hard error, whitelisted per construct, with a did-you-mean.
   *
   * This replaces two blocks that sat commented out here for a long time. They could never have
   * worked: they were written against `FunctionModifierNode` and `AccessModifierNode`, node types
   * that do not exist -- the AST has one `ModifierNode`, and the construct it modifies is its
   * `_parent`. That is presumably why they were switched off rather than fixed.
   *
   * The valid set is per-construct builtins UNION the modifiers this module defines itself.
   * `defmodifier` makes modifiers user-extensible, so a constant whitelist is not merely
   * incomplete -- it is wrong by construction, and would reject `:logged` / `:retry` / `:timed` /
   * `:identity`, i.e. the four `examples/06-modifiers` tests that pass today.
   */
  visitModifier(node: ast.ModifierNode) {
    const name = node.modifier.replace(/^:/, "").toLowerCase();

    // Parameter modifiers keep their own, more specific diagnostic (below); don't double-report.
    const construct = (node._parent as ast.ASTNode | undefined)?._type;
    if (construct === "parameter") return node;

    if ((RESERVED_NATIVE_MODIFIERS as readonly string[]).includes(name)) {
      this.reportModifierError(
        node,
        "LL0016",
        `':${name}' is reserved for the native backend and is not implemented on the JS target.`
      );
      return node;
    }

    const builtins = builtinModifiersFor(construct);
    if (builtins.includes(name) || this.definedModifiers.has(name)) {
      return node;
    }

    const valid = [...builtins, ...this.definedModifiers];
    const suggestion = suggestModifier(name, valid);
    const on = construct ? ` on ${construct}` : "";

    this.reportModifierError(
      node,
      "LL0015",
      `Unknown modifier ':${name}'${on}.` +
        (suggestion ? ` Did you mean ':${suggestion}'?` : "") +
        ` Declare it with (defmodifier ${name} ...) if it is meant to be a custom modifier.`
    );

    return node;
  }

  private reportModifierError(node: ast.ASTNode, code: string, message: string): void {
    const rule = createRule<ast.ASTNode>()
      .addSeverity(RuleSeverity.Error)
      .addCode(code)
      .addMessage(message)
      .addTest(() => true)
      .build();

    this.context.results.add(node, rule, this.context);
  }

  visitFunction(node: ast.FunctionNode) {
    checkRules(node, [r.ExternFunctionCannotHaveBody], this.context);
  }

  visitFunctionParameter(node: ast.ParameterNode) {
    checkRules(node, [r.FunctionParameterMustHaveName], this.context);
    node.modifiers.forEach((modifier) =>
      checkRules(modifier, [r.FunctionAllowedParameterModifiers], this.context)
    );
  }

  visitInterface(node: ast.InterfaceNode) {
    const body = node.body.flatMap((x) => (x as ast.ListNode)?.nodes ?? [x]);

    body.forEach((member) =>
      checkRules(
        member,
        [
          r.InvalidInterfaceMembers as Rule<ast.ASTNode>,
          r.InterfaceMembersCannotHaveInitializers as Rule<ast.ASTNode>,
          r.InterfaceMembersCannotBeExtern as Rule<ast.ASTNode>,
          r.InterfaceMembersCannotHaveBodyDeclarations as Rule<ast.ASTNode>,
        ],
        this.context
      )
    );
  }

  visitTryCatch(node: ast.TryCatchNode) {
    checkRules(
      node,
      [r.TryCatchHasEitherCatchOrFinally, r.OnlyOneDefaultCatchBlockAllowed],
      this.context
    );
  }

  visitVariable(node: ast.VariableNode) {
    checkRules(
      node,
      [r.VariableMustHaveName, r.ConstantVariableMustHaveInitializer],
      this.context
    );
  }

  visitClass(node: ast.ClassNode) {
    checkRules(node, [r.ClassMustHaveName], this.context);
  }

  /**
   * D12: unknown, duplicate, or missing-required `for` clauses are hard errors.
   *
   * Unknown clauses are already impossible -- the parser's clause bag simply has no alternative
   * for `:i` or `:of`, so it errors at parse time naming the clauses it does accept. What survives
   * to here is duplication (`:then` twice) and omission.
   */
  visitFor(node: ast.ForNode) {
    this.checkForClauses(node, node.duplicateClauses, [
      [node.condition, ":cond", "a `for` with no condition would never terminate"],
    ]);
    return node;
  }

  visitForEach(node: ast.ForEachNode) {
    this.checkForClauses(node, node.duplicateClauses, [
      [node.collection, ":from", "a `for :each` has nothing to iterate over without it"],
    ]);
    return node;
  }

  private checkForClauses(
    node: ast.ASTNode,
    duplicates: string[] | undefined,
    required: [unknown, string, string][]
  ): void {
    for (const kind of duplicates ?? []) {
      this.reportModifierError(
        node,
        "LL0017",
        `Duplicate '${kind}' clause. Each 'for' clause may appear at most once; the first wins.`
      );
    }

    for (const [slot, name, why] of required) {
      if (slot === null || slot === undefined) {
        this.reportModifierError(
          node,
          "LL0018",
          `'for' is missing its required '${name}' clause -- ${why}.`
        );
      }
    }
  }

  visitWhen(node: ast.WhenNode) {
    checkRules(
      node,
      [r.WhenMustHaveCondition, r.WhenMustHaveThenClause],
      this.context
    );
  }

  visitIf(node: ast.IfNode) {
    checkRules(
      node,
      [r.IfMustHaveCondition, r.IfMustHaveThenClause],
      this.context
    );
  }

  visitMatch(node: ast.MatchNode) {
    checkRules(node, [r.MatchMustHaveCases], this.context);
  }

  visitIdentifier(node: ast.IdentifierNode) {
    checkRules(node, [r.IdentifierMustHaveName], this.context);
  }

  visitImport(node: ast.ImportNode) {
    checkRules(node, [r.ImportMustHaveSource], this.context);
  }

  visitFractionNumber(node: ast.FractionNumberNode) {
    checkRules(
      node,
      [r.FractionHasZeroDenominator],
      this.context
    );
  }

  visitComment(node: ast.CommentNode) {
    // Optionally, we could check for TODOs or FIXMEs
  }
}
