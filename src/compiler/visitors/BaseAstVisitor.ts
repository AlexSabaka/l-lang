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

  visit(node: ast.ASTNode, defaultVisitor?: (node?: ast.ASTNode) => any) {
    const astVisitors: Record<ast.NodeType, ((node: any) => any) | undefined> = {
      "type": undefined,
      "type-def": undefined,
      "map-key-type": undefined,
      "function-type": undefined,
      "function-modifier": undefined,
      "for": undefined,
      "for-each": undefined,
      "while": this.visitWhile.bind(this),
      "indexer": undefined,
      "try-catch": this.visitTryCatch.bind(this),
      "assignment": this.visitAssignment.bind(this),
      "compound-assignment": this.visitAssignment.bind(this),
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

    if (node === undefined) {
      this.context.log(LogLevel.Error, "Cannot process undefined node.");
      return defaultVisitor ? defaultVisitor() : undefined;
    }

    if (node?._type === undefined) {
      this.context.log(LogLevel.Error, "Cannot process node without type.");
      return defaultVisitor ? defaultVisitor() : undefined;
    }

    const nodeVisitor = astVisitors[node._type];
    if (nodeVisitor === undefined) {
      this.context.log(LogLevel.Error, `No visitor implemented for node type '${node._type}'`);
      return defaultVisitor ? defaultVisitor() : undefined;
    }

    return nodeVisitor(node);
  }

  visitWhile(node: ast.WhileNode): any {
    this.context.log(LogLevel.Info, "Method visitWhile skipped");
  }

  visitAssignment(node: ast.AssignmentNode): any {
    this.context.log(LogLevel.Info, "Method visitAssignment skipped");
  }

  visitTryCatch(node: ast.TryCatchNode): any {
    this.context.log(LogLevel.Info, "Method visitTryCatch skipped");
  }

  visitProgram(node: ast.ProgramNode): any {
    this.context.log(LogLevel.Info, "Method visitProgram skipped");
  }

  visitImport(node: ast.ImportNode): any {
    this.context.log(LogLevel.Info, "Method visitImport skipped");
  }

  visitExport(node: ast.ExportNode): any {
    this.context.log(LogLevel.Info, "Method visitExport skipped");
  }

  visitTypeName(node: ast.TypeNameNode): any {
    this.context.log(LogLevel.Info, "Method visitTypeName skipped");
  }

  visitUnionType(node: ast.UnionTypeNode): any {
    this.context.log(LogLevel.Info, "Method visitUnionType skipped");
  }

  visitIntersectionType(node: ast.IntersectionTypeNode): any {
    this.context.log(LogLevel.Info, "Method visitIntersectionType skipped");
  }

  visitSimpleType(node: ast.SimpleTypeNode): any {
    this.context.log(LogLevel.Info, "Method visitSimpleType skipped");
  }

  visitGenericType(node: ast.GenericTypeNode): any {
    this.context.log(LogLevel.Info, "Method visitGenericType skipped");
  }

  visitMapType(node: ast.MapTypeNode): any {
    this.context.log(LogLevel.Info, "Method visitMapType skipped");
  }

  visitMappedType(node: ast.MappedTypeNode): any {
    this.context.log(LogLevel.Info, "Method visitMappedType skipped");
  }

  visitTypeMapping(node: ast.TypeMappingNode): any {
    this.context.log(LogLevel.Info, "Method visitTypeMapping skipped");
  }

  visitFieldModifier(node: ast.FieldModifierNode): any {
    this.context.log(LogLevel.Info, "Method visitFieldModifier skipped");
  }

  visitParameterModifier(node: ast.ParameterModifierNode): any {
    this.context.log(LogLevel.Info, "Method visitParameterModifier skipped");
  }

  visitFunctionCarrying(node: ast.FunctionCarryingNode): any {
    this.context.log(LogLevel.Info, "Method visitFunctionCarrying skipped");
  }

  visitFunctionCarryingLeft(node: ast.FunctionCarryingLeftNode): any {
    this.context.log(LogLevel.Info, "Method visitFunctionCarryingLeft skipped");
  }

  visitFunctionCarryingRight(node: ast.FunctionCarryingRightNode): any {
    this.context.log(LogLevel.Info, "Method visitFunctionCarryingRight skipped");
  }

  visitClass(node: ast.ClassNode): any {
    this.context.log(LogLevel.Info, "Method visitClass skipped");
  }

  visitInterface(node: ast.InterfaceNode): any {
    this.context.log(LogLevel.Info, "Method visitInterface skipped");
  }

  visitAccessModifier(node: ast.AccessModifierNode): any {
    this.context.log(LogLevel.Info, "Method visitAccessModifier skipped");
  }

  visitImplements(node: ast.ImplementsNode): any {
    this.context.log(LogLevel.Info, "Method visitImplements skipped");
  }

  visitExtends(node: ast.ExtendsNode): any {
    this.context.log(LogLevel.Info, "Method visitExtends skipped");
  }

  visitConstraintImplements(node: ast.ConstraintImplementsNode): any {
    this.context.log(LogLevel.Info, "Method visitConstraintImplements skipped");
  }

  visitConstraintInherits(node: ast.ConstraintInheritsNode): any {
    this.context.log(LogLevel.Info, "Method visitConstraintInherits skipped");
  }

  visitConstraintIs(node: ast.ConstraintIsNode): any {
    this.context.log(LogLevel.Info, "Method visitConstraintIs skipped");
  }

  visitConstraintHas(node: ast.ConstraintHasNode): any {
    this.context.log(LogLevel.Info, "Method visitConstraintHas skipped");
  }

  visitMatchCase(node: ast.MatchCaseNode): any {
    this.context.log(LogLevel.Info, "Method visitMatchCase skipped");
  }

  visitListPattern(node: ast.ListPatternNode): any {
    this.context.log(LogLevel.Info, "Method visitListPattern skipped");
  }

  visitVectorPattern(node: ast.VectorPatternNode): any {
    this.context.log(LogLevel.Info, "Method visitVectorPattern skipped");
  }

  visitMapPattern(node: ast.MapPatternNode): any {
    this.context.log(LogLevel.Info, "Method visitMapPattern skipped");
  }

  visitMapPatternPair(node: ast.MapPatternPairNode): any {
    this.context.log(LogLevel.Info, "Method visitMapPatternPair skipped");
  }

  visitControlComment(node: ast.ControlCommentNode): any {
    this.context.log(LogLevel.Info, "Method visitControlComment skipped");
  }

  visitString(node: ast.StringNode): any {
    this.context.log(LogLevel.Info, "Method visitString skipped");
  }

  visitFormattedString(node: ast.FormattedStringNode): any {
    this.context.log(LogLevel.Info, "Method visitFormattedString skipped");
  }

  visitFormatExpression(node: ast.FormatExpressionNode): any {
    this.context.log(LogLevel.Info, "Method visitFormatExpression skipped");
  }

  visitIdentifier(node: ast.IdentifierNode): any {
    this.context.log(LogLevel.Info, "Method visitIdentifier skipped");
  }

  visitVariable(node: ast.VariableNode): any {
    this.context.log(LogLevel.Info, "Method visitVariable skipped");
  }

  visitFunction(node: ast.FunctionNode): any {
    this.context.log(LogLevel.Info, "Method visitFunction skipped");
  }

  visitFunctionParameter(node: ast.FunctionParameterNode): any {
    this.context.log(LogLevel.Info, "Method visitFunctionParameter skipped");
  }

  visitAwait(node: ast.AwaitNode): any {
    this.context.log(LogLevel.Info, "Method visitAwait skipped");
  }

  visitWhen(node: ast.WhenNode): any {
    this.context.log(LogLevel.Info, "Method visitWhen skipped");
  }

  visitIf(node: ast.IfNode): any {
    this.context.log(LogLevel.Info, "Method visitIf skipped");
  }

  visitMatch(node: ast.MatchNode): any {
    this.context.log(LogLevel.Info, "Method visitMatch skipped");
  }

  visitAnyPattern(node: ast.AnyPatternNode): any {
    this.context.log(LogLevel.Info, "Method visitAnyPattern skipped");
  }

  visitIdentifierPattern(node: ast.IdentifierPatternNode): any {
    this.context.log(LogLevel.Info, "Method visitIdentifierPattern skipped");
  }

  visitConstantPattern(node: ast.ConstantPatternNode): any {
    this.context.log(LogLevel.Info, "Method visitConstantPattern skipped");
  }

  visitNumber(node: ast.NumberNode): any {
    this.context.log(LogLevel.Info, "Method visitNumber skipped");
  }

  visitList(node: ast.ListNode): any {
    this.context.log(LogLevel.Info, "Method visitList skipped");
  }

  visitQuote(node: ast.QuoteNode): any {
    this.context.log(LogLevel.Info, "Method visitQuote skipped");
  }

  visitVector(node: ast.VectorNode): any {
    this.context.log(LogLevel.Info, "Method visitVector skipped");
  }

  visitMap(node: ast.MapNode): any {
    this.context.log(LogLevel.Info, "Method visitMap skipped");
  }

  visitKeyDefinition(node: ast.MapKeyValueNode): any {
    this.context.log(LogLevel.Info, "Method visitKeyDefinition skipped");
  }

  visitKeyValue(node: ast.MapKeyValueNode): any {
    this.context.log(LogLevel.Info, "Method visitKeyValue skipped");
  }

  visitComment(node: ast.CommentNode): any {
    this.context.log(LogLevel.Info, "Method visitComment skipped");
  }
};
