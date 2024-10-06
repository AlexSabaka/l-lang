import * as ast from "../ast";
import { CompilationContext, LogLevel } from "../CompilationContext";

export interface AstVisitorConstructor {
  new (moduleName: string, context: CompilationContext): BaseAstVisitor;
}

export class BaseAstVisitor {
  context: CompilationContext;

  constructor(context: CompilationContext) {
    this.context = context;
  }

  visit(node: ast.ASTNode) {
    const astVisitors: Record<ast.NodeType, ((node: any) => any) | undefined> = {
      "type": undefined,
      "type-def": undefined,
      "map-key-type": undefined,
      "function-type": undefined,
      "function-modifier": undefined,
      "for": undefined,
      "for-each": undefined,
      "while": undefined,
      "indexer": undefined,
      "try-catch": this.visitTryCatch.bind(this),
      "assignment": this.visitAssignment.bind(this),
      "compound-assignment": undefined,
      "program": this.visitProgram.bind(this),
      "list": this.visitList.bind(this),
      "quote": this.visitQuote.bind(this),
      "vector": this.visitVector.bind(this),
      "map": this.visitMap.bind(this),
      "key-value": this.visitKeyValue.bind(this),
      "import": this.visitImport.bind(this),
      "export": this.visitExport.bind(this),
      "type-name": this.visitTypeName.bind(this),
      "union-type": this.visitUnionType.bind(this),
      "intersection-type": this.visitIntersectionType.bind(this),
      "simple-type": this.visitSimpleType.bind(this),
      "generic-type": this.visitGenericType.bind(this),
      "map-type": this.visitMapType.bind(this),
      "mapped-type": this.visitMappedType.bind(this),
      "type-mapping": this.visitTypeMapping.bind(this),
      "variable": this.visitVariable.bind(this),
      "field-modifier": this.visitFieldModifier.bind(this),
      "function": this.visitFunction.bind(this),
      "parameter": this.visitFunctionParameter.bind(this),
      "parameter-modifier": this.visitParameterModifier.bind(this),
      "function-carrying-left": this.visitFunctionCarryingLeft.bind(this),
      "function-carrying-right": this.visitFunctionCarryingRight.bind(this),
      "function-carrying": this.visitFunctionCarrying.bind(this),
      "class": this.visitClass.bind(this),
      "interface": this.visitInterface.bind(this),
      "access-modifier": this.visitAccessModifier.bind(this),
      "implements": this.visitImplements.bind(this),
      "extends": this.visitExtends.bind(this),
      "constraint-implements": this.visitConstraintImplements.bind(this),
      "constraint-inherits": this.visitConstraintInherits.bind(this),
      "constraint-is": this.visitConstraintIs.bind(this),
      "constraint-has": this.visitConstraintHas.bind(this),
      "await": this.visitAwait.bind(this),
      "when": this.visitWhen.bind(this),
      "if": this.visitIf.bind(this),
      "match": this.visitMatch.bind(this),
      "match-case": this.visitMatchCase.bind(this),
      "any-pattern": this.visitAnyPattern.bind(this),
      "list-pattern": this.visitListPattern.bind(this),
      "vector-pattern": this.visitVectorPattern.bind(this),
      "map-pattern": this.visitMapPattern.bind(this),
      "map-pattern-pair": this.visitMapPatternPair.bind(this),
      "identifier-pattern": this.visitIdentifierPattern.bind(this),
      "constant-pattern": this.visitConstantPattern.bind(this),
      "string": this.visitString.bind(this),
      "formatted-string": this.visitFormattedString.bind(this),
      "format-expression": this.visitFormatExpression.bind(this),
      "octal-number": this.visitNumber.bind(this),
      "binary-number": this.visitNumber.bind(this),
      "hex-number": this.visitNumber.bind(this),
      "integer-number": this.visitNumber.bind(this),
      "float-number": this.visitNumber.bind(this),
      "simple-identifier": this.visitIdentifier.bind(this),
      "composite-identifier": this.visitIdentifier.bind(this),
      "comment": this.visitComment.bind(this),
      "control-comment": this.visitControlComment.bind(this),
    };

    if (node?._type === undefined) {
      this.context.log(LogLevel.Error, `Cannot process node without type '${node}'`);
      return;
    }

    const nodeVisitor = astVisitors[node._type];
    if (nodeVisitor === undefined) {
      this.context.log(LogLevel.Error, `No visitor implemented for node type '${node._type}'`);
      return;
    }

    return nodeVisitor(node);
  }

  visitAssignment(node: ast.AssignmentNode) {
    this.context.log(LogLevel.Info, "Method visitAssignment skipped");
  }

  visitTryCatch(node: ast.TryCatchNode) {
    this.context.log(LogLevel.Info, "Method visitTryCatch skipped");
  }

  visitProgram(node: ast.ProgramNode) {
    this.context.log(LogLevel.Info, "Method visitProgram skipped");
  }

  visitImport(node: ast.ImportNode) {
    this.context.log(LogLevel.Info, "Method visitImport skipped");
  }

  visitExport(node: ast.ExportNode) {
    this.context.log(LogLevel.Info, "Method visitExport skipped");
  }

  visitTypeName(node: ast.TypeNameNode) {
    this.context.log(LogLevel.Info, "Method visitTypeName skipped");
  }

  visitUnionType(node: ast.UnionTypeNode) {
    this.context.log(LogLevel.Info, "Method visitUnionType skipped");
  }

  visitIntersectionType(node: ast.IntersectionTypeNode) {
    this.context.log(LogLevel.Info, "Method visitIntersectionType skipped");
  }

  visitSimpleType(node: ast.SimpleTypeNode) {
    this.context.log(LogLevel.Info, "Method visitSimpleType skipped");
  }

  visitGenericType(node: ast.GenericTypeNode) {
    this.context.log(LogLevel.Info, "Method visitGenericType skipped");
  }

  visitMapType(node: ast.MapTypeNode) {
    this.context.log(LogLevel.Info, "Method visitMapType skipped");
  }

  visitMappedType(node: ast.MappedTypeNode) {
    this.context.log(LogLevel.Info, "Method visitMappedType skipped");
  }

  visitTypeMapping(node: ast.TypeMappingNode) {
    this.context.log(LogLevel.Info, "Method visitTypeMapping skipped");
  }

  visitFieldModifier(node: ast.FieldModifierNode) {
    this.context.log(LogLevel.Info, "Method visitFieldModifier skipped");
  }

  visitParameterModifier(node: ast.ParameterModifierNode) {
    this.context.log(LogLevel.Info, "Method visitParameterModifier skipped");
  }

  visitFunctionCarrying(node: ast.FunctionCarryingNode) {
    this.context.log(LogLevel.Info, "Method visitFunctionCarrying skipped");
  }

  visitFunctionCarryingLeft(node: ast.FunctionCarryingLeftNode) {
    this.context.log(LogLevel.Info, "Method visitFunctionCarryingLeft skipped");
  }

  visitFunctionCarryingRight(node: ast.FunctionCarryingRightNode) {
    this.context.log(LogLevel.Info, "Method visitFunctionCarryingRight skipped");
  }

  visitClass(node: ast.ClassNode) {
    this.context.log(LogLevel.Info, "Method visitClass skipped");
  }

  visitInterface(node: ast.InterfaceNode) {
    this.context.log(LogLevel.Info, "Method visitInterface skipped");
  }

  visitAccessModifier(node: ast.AccessModifierNode) {
    this.context.log(LogLevel.Info, "Method visitAccessModifier skipped");
  }

  visitImplements(node: ast.ImplementsNode) {
    this.context.log(LogLevel.Info, "Method visitImplements skipped");
  }

  visitExtends(node: ast.ExtendsNode) {
    this.context.log(LogLevel.Info, "Method visitExtends skipped");
  }

  visitConstraintImplements(node: ast.ConstraintImplementsNode) {
    this.context.log(LogLevel.Info, "Method visitConstraintImplements skipped");
  }

  visitConstraintInherits(node: ast.ConstraintInheritsNode) {
    this.context.log(LogLevel.Info, "Method visitConstraintInherits skipped");
  }

  visitConstraintIs(node: ast.ConstraintIsNode) {
    this.context.log(LogLevel.Info, "Method visitConstraintIs skipped");
  }

  visitConstraintHas(node: ast.ConstraintHasNode) {
    this.context.log(LogLevel.Info, "Method visitConstraintHas skipped");
  }

  visitMatchCase(node: ast.MatchCaseNode) {
    this.context.log(LogLevel.Info, "Method visitMatchCase skipped");
  }

  visitListPattern(node: ast.ListPatternNode) {
    this.context.log(LogLevel.Info, "Method visitListPattern skipped");
  }

  visitVectorPattern(node: ast.VectorPatternNode) {
    this.context.log(LogLevel.Info, "Method visitVectorPattern skipped");
  }

  visitMapPattern(node: ast.MapPatternNode) {
    this.context.log(LogLevel.Info, "Method visitMapPattern skipped");
  }

  visitMapPatternPair(node: ast.MapPatternPairNode) {
    this.context.log(LogLevel.Info, "Method visitMapPatternPair skipped");
  }

  visitControlComment(node: ast.ControlCommentNode) {
    this.context.log(LogLevel.Info, "Method visitControlComment skipped");
  }

  visitString(node: ast.StringNode) {
    this.context.log(LogLevel.Info, "Method visitString skipped");
  }

  visitFormattedString(node: ast.FormattedStringNode) {
    this.context.log(LogLevel.Info, "Method visitFormattedString skipped");
  }

  visitFormatExpression(node: ast.FormatExpressionNode) {
    this.context.log(LogLevel.Info, "Method visitFormatExpression skipped");
  }

  visitIdentifier(node: ast.IdentifierNode) {
    this.context.log(LogLevel.Info, "Method visitIdentifier skipped");
  }

  visitVariable(node: ast.VariableNode) {
    this.context.log(LogLevel.Info, "Method visitVariable skipped");
  }

  visitFunction(node: ast.FunctionNode) {
    this.context.log(LogLevel.Info, "Method visitFunction skipped");
  }

  visitFunctionParameter(node: ast.FunctionParameterNode) {
    this.context.log(LogLevel.Info, "Method visitFunctionParameter skipped");
  }

  visitAwait(node: ast.AwaitNode) {
    this.context.log(LogLevel.Info, "Method visitAwait skipped");
  }

  visitWhen(node: ast.WhenNode) {
    this.context.log(LogLevel.Info, "Method visitWhen skipped");
  }

  visitIf(node: ast.IfNode) {
    this.context.log(LogLevel.Info, "Method visitIf skipped");
  }

  visitMatch(node: ast.MatchNode) {
    this.context.log(LogLevel.Info, "Method visitMatch skipped");
  }

  visitAnyPattern(node: ast.AnyPatternNode) {
    this.context.log(LogLevel.Info, "Method visitAnyPattern skipped");
  }

  visitIdentifierPattern(node: ast.IdentifierPatternNode) {
    this.context.log(LogLevel.Info, "Method visitIdentifierPattern skipped");
  }

  visitConstantPattern(node: ast.ConstantPatternNode) {
    this.context.log(LogLevel.Info, "Method visitConstantPattern skipped");
  }

  visitNumber(node: ast.NumberNode) {
    this.context.log(LogLevel.Info, "Method visitNumber skipped");
  }

  visitList(node: ast.ListNode) {
    this.context.log(LogLevel.Info, "Method visitList skipped");
  }

  visitQuote(node: ast.QuoteNode) {
    this.context.log(LogLevel.Info, "Method visitQuote skipped");
  }

  visitVector(node: ast.VectorNode) {
    this.context.log(LogLevel.Info, "Method visitVector skipped");
  }

  visitMap(node: ast.MapNode) {
    this.context.log(LogLevel.Info, "Method visitMap skipped");
  }

  visitKeyDefinition(node: ast.MapKeyValueNode) {
    this.context.log(LogLevel.Info, "Method visitKeyDefinition skipped");
  }

  visitKeyValue(node: ast.MapKeyValueNode) {
    this.context.log(LogLevel.Info, "Method visitKeyValue skipped");
  }

  visitComment(node: ast.CommentNode) {
    this.context.log(LogLevel.Info, "Method visitComment skipped");
  }
};
