import * as ast from "../ast";
import { Context, LogLevel } from "../Context";

export interface AstVisitorConstructor {
  new (moduleName: string, context: Context): BaseAstVisitor;
}
export class BaseAstVisitor {
  context: Context;

  constructor(context: Context) {
    this.context = context;
  }

  visit(node: ast.ASTNode, defaultVisitor?: (node?: ast.ASTNode) => any): any {
    const astVisitors: Record<ast.NodeType, ((node: any) => any) | undefined> =
      {
        "program": this.visitProgram.bind(this),
        "list": this.visitList.bind(this),
        "quote": this.visitQuote.bind(this),
        "vector": this.visitVector.bind(this),
        "matrix": this.visitMatrix.bind(this),
        "map": this.visitMap.bind(this),
        "key-value": this.visitKeyValue.bind(this),
        "export": this.visitExport.bind(this),
        "import": this.visitImport.bind(this),
        "type-name": this.visitTypeName.bind(this),
        "type": this.visitType.bind(this),
        "union-type": this.visitUnionType.bind(this),
        "intersection-type": this.visitIntersectionType.bind(this),
        "function-type": this.visitFunctionType.bind(this),
        "simple-type": this.visitSimpleType.bind(this),
        "generic-type": this.visitGenericType.bind(this),
        "map-type": this.visitMapType.bind(this),
        "map-key-type": this.visitMapKeyType.bind(this),
        "mapped-type": this.visitMappedType.bind(this),
        "modifier": this.visitModifier.bind(this),
        "variable": this.visitVariable.bind(this),
        "function": this.visitFunction.bind(this),
        "parameter": this.visitParameter.bind(this),
        "function-carrying": this.visitFunctionCarrying.bind(this),
        "class": this.visitClass.bind(this),
        "enum": this.visitEnum.bind(this),
        "struct": this.visitStruct.bind(this),
        "type-def": this.visitTypeDef.bind(this),
        "interface": this.visitInterface.bind(this),
        "implements": this.visitImplements.bind(this),
        "extends": this.visitExtends.bind(this),
        "type-constraint": this.visitTypeConstraint.bind(this),
        "await": this.visitAwait.bind(this),
        "spread": this.visitSpread.bind(this),
        "simple-assignment": this.visitSimpleAssignment.bind(this),
        "compound-assignment": this.visitCompoundAssignment.bind(this),
        "indexer": this.visitIndexer.bind(this),
        "try-catch": this.visitTryCatch.bind(this),
        "when": this.visitWhen.bind(this),
        "if": this.visitIf.bind(this),
        "cond": this.visitCond.bind(this),
        "cond-case": this.visitCondCase.bind(this),
        "for": this.visitFor.bind(this),
        "for-each": this.visitForEach.bind(this),
        "while": this.visitWhile.bind(this),
        "match": this.visitMatch.bind(this),
        "match-case": this.visitMatchCase.bind(this),
        "any-pattern": this.visitAnyPattern.bind(this),
        "functional-pattern": this.visitFunctionalPattern.bind(this),
        "type-pattern": this.visitTypePattern.bind(this),
        "list-pattern": this.visitListPattern.bind(this),
        "vector-pattern": this.visitVectorPattern.bind(this),
        "map-pattern": this.visitMapPattern.bind(this),
        "map-pattern-pair": this.visitMapPatternPair.bind(this),
        "identifier-pattern": this.visitIdentifierPattern.bind(this),
        "constant-pattern": this.visitConstantPattern.bind(this),
        "string": this.visitString.bind(this),
        "formatted-string": this.visitFormattedString.bind(this),
        "format-expression": this.visitFormatExpression.bind(this),
        "boolean": this.visitBoolean.bind(this),
        "null": this.visitNull.bind(this),
        "octal-number": this.visitOctalNumber.bind(this),
        "binary-number": this.visitBinaryNumber.bind(this),
        "hex-number": this.visitHexNumber.bind(this),
        "fraction-number": this.visitFractionNumber.bind(this),
        "integer-number": this.visitIntegerNumber.bind(this),
        "float-number": this.visitFloatNumber.bind(this),
        "simple-identifier": this.visitSimpleIdentifier.bind(this),
        "composite-identifier": this.visitCompositeIdentifier.bind(this),
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
      this.context.log(
        LogLevel.Error,
        `No visitor implemented for node type '${node._type}'`
      );
      return defaultVisitor ? defaultVisitor() : undefined;
    }

    return nodeVisitor(node);
  }

  visitProgram(node: ast.ProgramNode): any {
    this.context.log(LogLevel.Verbose, "Method visitProgram skipped");
  }

  visitList(node: ast.ListNode): any {
    this.context.log(LogLevel.Verbose, "Method visitList skipped");
  }

  visitQuote(node: ast.QuoteNode): any {
    this.context.log(LogLevel.Verbose, "Method visitQuote skipped");
  }

  visitVector(node: ast.VectorNode): any {
    this.context.log(LogLevel.Verbose, "Method visitVector skipped");
  }

  visitMatrix(node: ast.MatrixNode): any {
    this.context.log(LogLevel.Verbose, "Method visitMatrix skipped");
  }

  visitMap(node: ast.MapNode): any {
    this.context.log(LogLevel.Verbose, "Method visitMap skipped");
  }

  visitKeyValue(node: ast.KeyValueNode): any {
    this.context.log(LogLevel.Verbose, "Method visitKeyValue skipped");
  }

  visitExport(node: ast.ExportNode): any {
    this.context.log(LogLevel.Verbose, "Method visitExport skipped");
  }

  visitImport(node: ast.ImportNode): any {
    this.context.log(LogLevel.Verbose, "Method visitImport skipped");
  }

  visitTypeName(node: ast.TypeNameNode): any {
    this.context.log(LogLevel.Verbose, "Method visitTypeName skipped");
  }

  visitType(node: ast.TypeNode): any {
    this.context.log(LogLevel.Verbose, "Method visitType skipped");
  }

  visitUnionType(node: ast.UnionTypeNode): any {
    this.context.log(LogLevel.Verbose, "Method visitUnionType skipped");
  }

  visitIntersectionType(node: ast.IntersectionTypeNode): any {
    this.context.log(LogLevel.Verbose, "Method visitIntersectionType skipped");
  }

  visitFunctionType(node: ast.FunctionTypeNode): any {
    this.context.log(LogLevel.Verbose, "Method visitFunctionType skipped");
  }

  visitSimpleType(node: ast.SimpleTypeNode): any {
    this.context.log(LogLevel.Verbose, "Method visitSimpleType skipped");
  }

  visitGenericType(node: ast.GenericTypeNode): any {
    this.context.log(LogLevel.Verbose, "Method visitGenericType skipped");
  }

  visitMapType(node: ast.MapTypeNode): any {
    this.context.log(LogLevel.Verbose, "Method visitMapType skipped");
  }

  visitMapKeyType(node: ast.MapKeyTypeNode): any {
    this.context.log(LogLevel.Verbose, "Method visitMapKeyType skipped");
  }

  visitMappedType(node: ast.MappedTypeNode): any {
    this.context.log(LogLevel.Verbose, "Method visitMappedType skipped");
  }

  visitModifier(node: ast.ModifierNode): any {
    this.context.log(LogLevel.Verbose, "Method visitModifier skipped");
  }

  visitVariable(node: ast.VariableNode): any {
    this.context.log(LogLevel.Verbose, "Method visitVariable skipped");
  }

  visitFunction(node: ast.FunctionNode): any {
    this.context.log(LogLevel.Verbose, "Method visitFunction skipped");
  }

  visitParameter(node: ast.ParameterNode): any {
    this.context.log(LogLevel.Verbose, "Method visitParameter skipped");
  }

  visitFunctionCarrying(node: ast.FunctionCarryingNode): any {
    this.context.log(LogLevel.Verbose, "Method visitFunctionCarrying skipped");
  }

  visitClass(node: ast.ClassNode): any {
    this.context.log(LogLevel.Verbose, "Method visitClass skipped");
  }

  visitEnum(node: ast.EnumNode): any {
    this.context.log(LogLevel.Verbose, "Method visitEnum skipped");
  }

  visitStruct(node: ast.StructNode): any {
    this.context.log(LogLevel.Verbose, "Method visitStruct skipped");
  }

  visitTypeDef(node: ast.TypeDefNode): any {
    this.context.log(LogLevel.Verbose, "Method visitTypeDef skipped");
  }

  visitInterface(node: ast.InterfaceNode): any {
    this.context.log(LogLevel.Verbose, "Method visitInterface skipped");
  }

  visitImplements(node: ast.ImplementsNode): any {
    this.context.log(LogLevel.Verbose, "Method visitImplements skipped");
  }

  visitExtends(node: ast.ExtendsNode): any {
    this.context.log(LogLevel.Verbose, "Method visitExtends skipped");
  }

  visitTypeConstraint(node: ast.TypeConstraintNode): any {
    this.context.log(LogLevel.Verbose, "Method visitTypeConstraint skipped");
  }

  visitAwait(node: ast.AwaitNode): any {
    this.context.log(LogLevel.Verbose, "Method visitAwait skipped");
  }

  visitSpread(node: ast.SpreadNode): any {
    this.context.log(LogLevel.Verbose, "Method visitSpread skipped");
  }

  visitSimpleAssignment(node: ast.SimpleAssignmentNode): any {
    this.context.log(LogLevel.Verbose, "Method visitSimpleAssignment skipped");
  }

  visitCompoundAssignment(node: ast.CompoundAssignmentNode): any {
    this.context.log(
      LogLevel.Verbose,
      "Method visitCompoundAssignment skipped"
    );
  }

  visitIndexer(node: ast.IndexerNode): any {
    this.context.log(LogLevel.Verbose, "Method visitIndexer skipped");
  }

  visitTryCatch(node: ast.TryCatchNode): any {
    this.context.log(LogLevel.Verbose, "Method visitTryCatch skipped");
  }

  visitWhen(node: ast.WhenNode): any {
    this.context.log(LogLevel.Verbose, "Method visitWhen skipped");
  }

  visitIf(node: ast.IfNode): any {
    this.context.log(LogLevel.Verbose, "Method visitIf skipped");
  }

  visitCond(node: ast.CondNode): any {
    this.context.log(LogLevel.Verbose, "Method visitCond skipped");
  }

  visitCondCase(node: ast.CondCaseNode): any {
    this.context.log(LogLevel.Verbose, "Method visitCondCase skipped");
  }

  visitFor(node: ast.ForNode): any {
    this.context.log(LogLevel.Verbose, "Method visitFor skipped");
  }

  visitForEach(node: ast.ForEachNode): any {
    this.context.log(LogLevel.Verbose, "Method visitForEach skipped");
  }

  visitWhile(node: ast.WhileNode): any {
    this.context.log(LogLevel.Verbose, "Method visitWhile skipped");
  }

  visitMatch(node: ast.MatchNode): any {
    this.context.log(LogLevel.Verbose, "Method visitMatch skipped");
  }

  visitMatchCase(node: ast.MatchCaseNode): any {
    this.context.log(LogLevel.Verbose, "Method visitMatchCase skipped");
  }

  visitAnyPattern(node: ast.AnyPatternNode): any {
    this.context.log(LogLevel.Verbose, "Method visitAnyPattern skipped");
  }

  visitFunctionalPattern(node: ast.FunctionalPatternNode): any {
    this.context.log(LogLevel.Verbose, "Method visitFunctionalPattern skipped");
  }

  visitTypePattern(node: ast.TypePatternNode): any {
    this.context.log(LogLevel.Verbose, "Method visitTypePattern skipped");
  }

  visitListPattern(node: ast.ListPatternNode): any {
    this.context.log(LogLevel.Verbose, "Method visitListPattern skipped");
  }

  visitVectorPattern(node: ast.VectorPatternNode): any {
    this.context.log(LogLevel.Verbose, "Method visitVectorPattern skipped");
  }

  visitMapPattern(node: ast.MapPatternNode): any {
    this.context.log(LogLevel.Verbose, "Method visitMapPattern skipped");
  }

  visitMapPatternPair(node: ast.MapPatternPairNode): any {
    this.context.log(LogLevel.Verbose, "Method visitMapPatternPair skipped");
  }

  visitIdentifierPattern(node: ast.IdentifierPatternNode): any {
    this.context.log(LogLevel.Verbose, "Method visitIdentifierPattern skipped");
  }

  visitConstantPattern(node: ast.ConstantPatternNode): any {
    this.context.log(LogLevel.Verbose, "Method visitConstantPattern skipped");
  }

  visitString(node: ast.StringNode): any {
    this.context.log(LogLevel.Verbose, "Method visitString skipped");
  }

  visitFormattedString(node: ast.FormattedStringNode): any {
    this.context.log(LogLevel.Verbose, "Method visitFormattedString skipped");
  }

  visitFormatExpression(node: ast.FormatExpressionNode): any {
    this.context.log(LogLevel.Verbose, "Method visitFormatExpression skipped");
  }

  visitBoolean(node: ast.BooleanNode): any {
    this.context.log(LogLevel.Verbose, "Method visitBoolean skipped");
  }

  visitNull(node: ast.NullNode): any {
    this.context.log(LogLevel.Verbose, "Method visitNull skipped");
  }

  visitOctalNumber(node: ast.OctalNumberNode): any {
    this.context.log(LogLevel.Verbose, "Method visitOctalNumber skipped");
  }

  visitBinaryNumber(node: ast.BinaryNumberNode): any {
    this.context.log(LogLevel.Verbose, "Method visitBinaryNumber skipped");
  }

  visitHexNumber(node: ast.HexNumberNode): any {
    this.context.log(LogLevel.Verbose, "Method visitHexNumber skipped");
  }

  visitFractionNumber(node: ast.FractionNumberNode): any {
    this.context.log(LogLevel.Verbose, "Method visitFractionNumber skipped");
  }

  visitIntegerNumber(node: ast.IntegerNumberNode): any {
    this.context.log(LogLevel.Verbose, "Method visitIntegerNumber skipped");
  }

  visitFloatNumber(node: ast.FloatNumberNode): any {
    this.context.log(LogLevel.Verbose, "Method visitFloatNumber skipped");
  }

  visitSimpleIdentifier(node: ast.SimpleIdentifierNode): any {
    this.context.log(LogLevel.Verbose, "Method visitSimpleIdentifier skipped");
  }

  visitCompositeIdentifier(node: ast.CompositeIdentifierNode): any {
    this.context.log(
      LogLevel.Verbose,
      "Method visitCompositeIdentifier skipped"
    );
  }

  visitComment(node: ast.CommentNode): any {
    this.context.log(LogLevel.Verbose, "Method visitComment skipped");
  }

  visitControlComment(node: ast.ControlCommentNode): any {
    this.context.log(LogLevel.Verbose, "Method visitControlComment skipped");
  }
}
