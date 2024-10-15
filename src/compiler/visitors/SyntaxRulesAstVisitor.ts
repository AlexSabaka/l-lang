import * as ast from "../ast";
import { BaseAstTreeWalker } from "./BaseAstTreeWalker";
import { checkRules, Rule, Rules as r } from "../rules";

export class SyntaxRulesAstVisitor extends BaseAstTreeWalker {
  visitFunction(node: ast.FunctionNode) {
    checkRules(node, [r.ExternFunctionCannotHaveBody], this.context);
  }

  visitFunctionParameter(node: ast.FunctionParameterNode) {
    checkRules(node, [r.FunctionParameterMustHaveName], this.context);
    node.modifiers.forEach((modifier) =>
      checkRules(modifier, [r.FunctionAllowedParameterModifiers], this.context)
    );
  }

  // visitFunctionModifier(node: ast.FunctionModifierNode) {
  //   const validModifiers = ["extern", "override", "extension", "operator"];
  //   if (!validModifiers.includes(node.modifier)) {
  //     this.error(node, "LL0015", `Invalid function modifier '${node.modifier}'.`);
  //   }
  // }

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

  // visitAccessModifier(node: ast.AccessModifierNode) {
  //   const validModifiers = ["public", "private", "static", "internal"];
  //   if (!validModifiers.includes(node.modifier)) {
  //     this.error(node, "LL0013", `Invalid access modifier '${node.modifier}'.`);
  //   }
  // }

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

  visitNumber(node: ast.NumberNode) {
    checkRules(
      node,
      [r.FractionHasZeroDenominator as Rule<ast.NumberNode>],
      this.context
    );
  }

  visitComment(node: ast.CommentNode) {
    // Optionally, we could check for TODOs or FIXMEs
  }

  visitControlComment(node: ast.ControlCommentNode) {
    // NOTE: Implement validation for control comments if needed
  }
}
