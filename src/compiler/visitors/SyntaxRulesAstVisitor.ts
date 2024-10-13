import * as ast from "../ast";
import { BaseAstVisitor } from "./BaseAstVisitor";
import { LogLevel } from "../CompilationContext";
import { checkRules, Rule, Rules as r } from "../NodeValidationRules";

export class SyntaxRulesAstVisitor extends BaseAstVisitor {
  public errors: number = 0;
  public warnings: number = 0;

  private error(message: string) {
    this.errors++;
    this.context.log(LogLevel.Error, message);
  }

  visitProgram(node: ast.ProgramNode) {
    node.program.forEach((x) => this.visit(x));
  }

  visitList(node: ast.ListNode) {
    node.nodes.forEach((x) => this.visit(x));
  }

  visitFunction(node: ast.FunctionNode) {
    // Visit parameters
    node.params.forEach((param) => this.visit(param));

    // Visit return type
    if (node.ret) {
      this.visit(node.ret);
    }

    // Visit function modifiers
    node.modifiers.forEach((modifier) => this.visit(modifier));

    checkRules(node, [r.externFunctionCannotHaveBody], this.context).forEach((msg) =>
      this.error(msg)
    );

    // Visit function body
    node.body.forEach((stmt) => this.visit(stmt));
  }

  visitFunctionParameter(node: ast.FunctionParameterNode) {

    checkRules(node, [r.functionParameterMustHaveNameRule], this.context).forEach((msg) =>
      this.error(msg)
    );
    // Visit parameter type
    if (node.type) {
      this.visit(node.type);
    }


    // Visit parameter modifiers
    node.modifiers
      .flatMap((modifier) =>
        checkRules(modifier, [r.functionParameterAllowedModifiersRule], this.context)
      )
      .forEach((msg) => this.error(msg));
  }

  // visitFunctionModifier(node: ast.FunctionModifierNode) {
  //   const validModifiers = ["extern", "override", "extension", "operator"];
  //   if (!validModifiers.includes(node.modifier)) {
  //     this.error(node, "LL0015", `Invalid function modifier '${node.modifier}'.`);
  //   }
  // }

  visitInterface(node: ast.InterfaceNode) {
    const body = node.body.flatMap((x) => (x as ast.ListNode)?.nodes ?? [x]);

    body.flatMap((member) =>
      checkRules(member, [
        r.invalidInterfaceMembers as Rule<ast.ASTNode>,
        r.interfaceMembersCannotHaveInitializers as Rule<ast.ASTNode>,
        r.interfaceMembersCannotBeExtern as Rule<ast.ASTNode>,
        r.interfaceMembersCannotHaveBodyDeclarations as Rule<ast.ASTNode>,
      ], this.context)
    ).forEach((msg) => this.error(msg));

    // Visit interface body members
    body.forEach((member) => this.visit(member));
  }

  visitTryCatch(node: ast.TryCatchNode) {
    checkRules(node, [
      r.tryCatchHasEitherCatchOrFinally,
      r.onlyOneDefaultCatchBlockAllowed,
    ], this.context).forEach((msg) => this.error(msg));

    // Visit try block
    this.visit(node.try.body);

    // Visit catch blocks
    node.catch.forEach((catchBlock) => {
      if (catchBlock.filter) {
        // Visit catch filter
        if (catchBlock.filter.type) {
          this.visit(catchBlock.filter.type);
        }
      }
      // Visit catch body
      this.visit(catchBlock.body);
    });

    // Visit finally block
    if (node.finally) {
      this.visit(node.finally.body);
    }
  }

  visitVariable(node: ast.VariableNode) {
    checkRules(node, [
      r.variableHasNameRule,
      r.mutableVariableMustHaveInitializerRule,
    ], this.context).forEach((msg) => this.error(msg));

    // Visit variable modifiers
    node.modifiers.forEach((modifier) => this.visit(modifier));

    // Visit variable type
    if (node.type) {
      this.visit(node.type);
    }

    // Visit variable value
    if (node.value) {
      this.visit(node.value);
    }
  }

  visitClass(node: ast.ClassNode) {
    checkRules(node, [r.classMustHaveNameRule], this.context).forEach((msg) => this.error(msg));

    // Visit access modifiers
    node.access.forEach((accessModifier) => this.visit(accessModifier));
    // Visit implements and extends
    node.implements.forEach((impl) => this.visit(impl));
    node.extends.forEach((ext) => this.visit(ext));
    // Visit generics
    node.generics?.forEach((generic) => this.visit(generic));
    // Visit class body
    node.body.forEach((member) => this.visit(member));
  }

  // visitAccessModifier(node: ast.AccessModifierNode) {
  //   const validModifiers = ["public", "private", "static", "internal"];
  //   if (!validModifiers.includes(node.modifier)) {
  //     this.error(node, "LL0013", `Invalid access modifier '${node.modifier}'.`);
  //   }
  // }

  visitImplements(node: ast.ImplementsNode) {
    this.visit(node.type);
  }

  visitExtends(node: ast.ExtendsNode) {
    this.visit(node.type);
  }

  visitAssignment(node: ast.AssignmentNode) {
    // Visit assignable
    this.visit(node.assignable);
    // Visit value
    this.visit(node.value);
  }

  visitIndexer(node: ast.IndexerNode) {
    // Visit identifier and index
    this.visit(node.id);
    this.visit(node.index);
  }

  visitAwait(node: ast.AwaitNode) {
    // Visit expression
    this.visit(node.expression);
  }

  visitWhen(node: ast.WhenNode) {
    checkRules(node, [r.whenMustHaveCondition, r.whenMustHaveThenClause], this.context).forEach((msg) => this.error(msg)); 
    this.visit(node.condition!);
    node.then?.forEach((stmt) => this.visit(stmt));
  }

  visitIf(node: ast.IfNode) {
    checkRules(node, [r.ifMustHaveCondition, r.ifMustHaveThenClause], this.context).forEach((msg) => this.error(msg));

    this.visit(node.condition!);
    this.visit(node.then!);
    this.visit(node.else!);
  }

  visitMatch(node: ast.MatchNode) {
    this.visit(node.expression);

    checkRules(node, [r.matchMustHaveCases], this.context).forEach((msg) => this.error(msg)); 

    node.cases.forEach((matchCase) => this.visit(matchCase));
  }

  visitMatchCase(node: ast.MatchCaseNode) {
    this.visit(node.pattern);
    this.visit(node.body);
  }

  visitAnyPattern(node: ast.AnyPatternNode) {
    // Nothing to visit
  }

  visitListPattern(node: ast.ListPatternNode) {
    node.elements.forEach((element) => this.visit(element));
  }

  visitVectorPattern(node: ast.VectorPatternNode) {
    node.elements.forEach((element) => this.visit(element));
  }

  visitMapPattern(node: ast.MapPatternNode) {
    node.pairs.forEach((pair) => this.visit(pair));
  }

  visitMapPatternPair(node: ast.MapPatternPairNode) {
    this.visit(node.key);
    this.visit(node.pattern);
  }

  visitIdentifierPattern(node: ast.IdentifierPatternNode) {
    // Visit identifier
    this.visit(node.id);
  }

  visitConstantPattern(node: ast.ConstantPatternNode) {
    // Visit constant value
    this.visit(node.constant);
  }

  visitString(node: ast.StringNode) {
    // Nothing to do for raw strings
  }

  visitFormattedString(node: ast.FormattedStringNode) {
    node.value.forEach((item) => this.visit(item));
  }

  visitFormatExpression(node: ast.FormatExpressionNode) {
    this.visit(node.expression);
  }

  visitIdentifier(node: ast.IdentifierNode) {
    checkRules(node, [r.identifierHasNameRule], this.context).forEach((msg) => this.error(msg)); 
  }

  visitImport(node: ast.ImportNode) {
    checkRules(node, [r.importHasSource, r.importHasSymbols], this.context).forEach((msg) =>
      this.error(msg)
    );
  }

  visitExport(node: ast.ExportNode) {
    node.names.forEach((name) => {
      this.visit(name);
    });
  }

  visitTypeName(node: ast.TypeNameNode) {
    // TODO: Implement type name validation
  }

  visitUnionType(node: ast.UnionTypeNode) {
    node.types.forEach((type) => this.visit(type));
  }

  visitIntersectionType(node: ast.IntersectionTypeNode) {
    node.types.forEach((type) => this.visit(type));
  }

  visitSimpleType(node: ast.SimpleTypeNode) {
    this.visit(node.name);
  }

  visitGenericType(node: ast.GenericTypeNode) {
    this.visit(node.name);
    if (node.generic) {
      this.visit(node.generic);
    }
    // Visit constraints if any
    node.constraints?.forEach((constraint) => this.visit(constraint));
  }

  visitFunctionCarrying(node: ast.FunctionCarryingNode) {
    this.visit(node.identifier);
    node.sequence.forEach((seqItem) => {
      this.visit(seqItem.function);
      seqItem.arguments.forEach((arg) => this.visit(arg));
    });
  }

  visitTypeMapping(node: ast.TypeMappingNode) {
    // NOTE: Implement validation for type mapping if needed
  }

  visitMappedType(node: ast.MappedTypeNode) {
    // TODO: Implement validation for mapped type
    // node.mapping.forEach((mapping) => this.visit(mapping));
  }

  visitMapType(node: ast.MapTypeNode) {
    node.keys.forEach((keyDef) => this.visit(keyDef));
  }

  visitKeyValue(node: ast.MapKeyValueNode) {
    this.visit(node.key);
    this.visit(node.value);
  }

  visitKeyDefinition(node: ast.MapKeyValueNode) {
    this.visit(node.key);
    this.visit(node.value);
  }

  visitQuote(node: ast.QuoteNode) {
    if (node.nodes) {
      node.nodes.forEach((n) => this.visit(n));
    }
  }

  visitVector(node: ast.VectorNode) {
    node.values.forEach((value) => this.visit(value));
  }

  visitMap(node: ast.MapNode) {
    node.values.forEach((value) => this.visit(value));
  }

  visitNumber(node: ast.NumberNode) {
    checkRules(node, [
      r.fractionHasNonZeroDenominator as Rule<ast.NumberNode>,
    ], this.context).forEach((msg) => this.error(msg));
  }

  visitComment(node: ast.CommentNode) {
    // Optionally, we could check for TODOs or FIXMEs
  }

  visitControlComment(node: ast.ControlCommentNode) {
    // NOTE: Implement validation for control comments if needed
  }
}
