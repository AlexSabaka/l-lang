import * as ast from "./frontend/ast";
import { Context, LogLevel } from "./Context";
import { formatWithOptions } from "util";

export class BaseAstVisitor {
  context: Context;

  constructor(context: Context) {
    this.context = context;
  }

  // Helper methods
  compare(a: ast.ASTNode, b: ast.ASTNode): boolean {
    const at = JSON.stringify(a, (k, v) => k === "_location" || k === "_parent" ? undefined : v);
    const bt = JSON.stringify(b, (k, v) => k === "_location" || k === "_parent" ? undefined : v);
    return at === bt;
  }

  dump(n: ast.ASTNode): string {
    return formatWithOptions(
      { depth: 6, colors: true },
      JSON.parse(
        JSON.stringify(n, (k, v) =>
          k === "_location" || k === "_parent" ? undefined : v
        )
      )
    );
  }

  // Visitor methods
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
        "class": this.visitClass.bind(this),
        "enum": this.visitEnum.bind(this),
        "enum-key": this.visitEnumKey.bind(this),
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
        "complex-number": this.visitComplexNumber.bind(this),
        "integer-number": this.visitIntegerNumber.bind(this),
        "float-number": this.visitFloatNumber.bind(this),
        "simple-identifier": this.visitSimpleIdentifier.bind(this),
        "composite-identifier": this.visitCompositeIdentifier.bind(this),
        "comment": this.visitComment.bind(this),
      };

    if (node === undefined || node === null) {
      this.context.log(LogLevel.Error, "Cannot process undefined node.");
      return undefined;
    }

    if (node?._type === undefined) {
      this.context.log(LogLevel.Error, `Cannot process node without type: ${node}`);
      return undefined;
    }

    const nodeVisitor = astVisitors[node._type];
    if (nodeVisitor === undefined) {
      this.context.log(
        LogLevel.Error,
        `No visitor implemented for node type '${node._type}'`
      );
      return defaultVisitor ? defaultVisitor(node) : undefined;
    }

    return nodeVisitor(node);
  }

  visitProgram(node: ast.ProgramNode): any {
    this.context.log(LogLevel.Verbose, "Method visitProgram skipped");
    return node;
  }

  visitList(node: ast.ListNode): any {
    this.context.log(LogLevel.Verbose, "Method visitList skipped");
    return node;
  }

  visitQuote(node: ast.QuoteNode): any {
    this.context.log(LogLevel.Verbose, "Method visitQuote skipped");
    return node;
  }

  visitVector(node: ast.VectorNode): any {
    this.context.log(LogLevel.Verbose, "Method visitVector skipped");
    return node;
  }

  visitMatrix(node: ast.MatrixNode): any {
    this.context.log(LogLevel.Verbose, "Method visitMatrix skipped");
    return node;
  }

  visitMap(node: ast.MapNode): any {
    this.context.log(LogLevel.Verbose, "Method visitMap skipped");
    return node;
  }

  visitKeyValue(node: ast.KeyValueNode): any {
    this.context.log(LogLevel.Verbose, "Method visitKeyValue skipped");
    return node;
  }

  visitExport(node: ast.ExportNode): any {
    this.context.log(LogLevel.Verbose, "Method visitExport skipped");
    return node;
  }

  visitImport(node: ast.ImportNode): any {
    this.context.log(LogLevel.Verbose, "Method visitImport skipped");
    return node;
  }

  visitTypeName(node: ast.TypeNameNode): any {
    this.context.log(LogLevel.Verbose, "Method visitTypeName skipped");
    return node;
  }

  visitType(node: ast.TypeNode): any {
    this.context.log(LogLevel.Verbose, "Method visitType skipped");
    return node;
  }

  visitUnionType(node: ast.UnionTypeNode): any {
    this.context.log(LogLevel.Verbose, "Method visitUnionType skipped");
    return node;
  }

  visitIntersectionType(node: ast.IntersectionTypeNode): any {
    this.context.log(LogLevel.Verbose, "Method visitIntersectionType skipped");
    return node;
  }

  visitFunctionType(node: ast.FunctionTypeNode): any {
    this.context.log(LogLevel.Verbose, "Method visitFunctionType skipped");
    return node;
  }

  visitSimpleType(node: ast.SimpleTypeNode): any {
    this.context.log(LogLevel.Verbose, "Method visitSimpleType skipped");
    return node;
  }

  visitGenericType(node: ast.GenericTypeNode): any {
    this.context.log(LogLevel.Verbose, "Method visitGenericType skipped");
    return node;
  }

  visitMapType(node: ast.MapTypeNode): any {
    this.context.log(LogLevel.Verbose, "Method visitMapType skipped");
    return node;
  }

  visitMapKeyType(node: ast.MapKeyTypeNode): any {
    this.context.log(LogLevel.Verbose, "Method visitMapKeyType skipped");
    return node;
  }

  visitMappedType(node: ast.MappedTypeNode): any {
    this.context.log(LogLevel.Verbose, "Method visitMappedType skipped");
    return node;
  }

  visitModifier(node: ast.ModifierNode): any {
    this.context.log(LogLevel.Verbose, "Method visitModifier skipped");
    return node;
  }

  visitVariable(node: ast.VariableNode): any {
    this.context.log(LogLevel.Verbose, "Method visitVariable skipped");
    return node;
  }

  visitFunction(node: ast.FunctionNode): any {
    this.context.log(LogLevel.Verbose, "Method visitFunction skipped");
    return node;
  }

  visitParameter(node: ast.ParameterNode): any {
    this.context.log(LogLevel.Verbose, "Method visitParameter skipped");
    return node;
  }

  visitClass(node: ast.ClassNode): any {
    this.context.log(LogLevel.Verbose, "Method visitClass skipped");
    return node;
  }

  visitEnum(node: ast.EnumNode): any {
    this.context.log(LogLevel.Verbose, "Method visitEnum skipped");
    return node;
  }

  visitEnumKey(node: ast.EnumKeyNode): any {
    this.context.log(LogLevel.Verbose, "Method visitEnumKey skipped");
    return node;
  }

  visitStruct(node: ast.StructNode): any {
    this.context.log(LogLevel.Verbose, "Method visitStruct skipped");
    return node;
  }

  visitTypeDef(node: ast.TypeDefNode): any {
    this.context.log(LogLevel.Verbose, "Method visitTypeDef skipped");
    return node;
  }

  visitInterface(node: ast.InterfaceNode): any {
    this.context.log(LogLevel.Verbose, "Method visitInterface skipped");
    return node;
  }

  visitImplements(node: ast.ImplementsNode): any {
    this.context.log(LogLevel.Verbose, "Method visitImplements skipped");
    return node;
  }

  visitExtends(node: ast.ExtendsNode): any {
    this.context.log(LogLevel.Verbose, "Method visitExtends skipped");
    return node;
  }

  visitTypeConstraint(node: ast.TypeConstraintNode): any {
    this.context.log(LogLevel.Verbose, "Method visitTypeConstraint skipped");
    return node;
  }

  visitAwait(node: ast.AwaitNode): any {
    this.context.log(LogLevel.Verbose, "Method visitAwait skipped");
    return node;
  }

  visitSpread(node: ast.SpreadNode): any {
    this.context.log(LogLevel.Verbose, "Method visitSpread skipped");
    return node;
  }

  visitSimpleAssignment(node: ast.SimpleAssignmentNode): any {
    this.context.log(LogLevel.Verbose, "Method visitSimpleAssignment skipped");
    return node;
  }

  visitCompoundAssignment(node: ast.CompoundAssignmentNode): any {
    this.context.log(
      LogLevel.Verbose,
      "Method visitCompoundAssignment skipped"
    );
    return node;
  }

  visitIndexer(node: ast.IndexerNode): any {
    this.context.log(LogLevel.Verbose, "Method visitIndexer skipped");
    return node;
  }

  visitTryCatch(node: ast.TryCatchNode): any {
    this.context.log(LogLevel.Verbose, "Method visitTryCatch skipped");
    return node;
  }

  visitWhen(node: ast.WhenNode): any {
    this.context.log(LogLevel.Verbose, "Method visitWhen skipped");
    return node;
  }

  visitIf(node: ast.IfNode): any {
    this.context.log(LogLevel.Verbose, "Method visitIf skipped");
    return node;
  }

  visitCond(node: ast.CondNode): any {
    this.context.log(LogLevel.Verbose, "Method visitCond skipped");
    return node;
  }

  visitCondCase(node: ast.CondCaseNode): any {
    this.context.log(LogLevel.Verbose, "Method visitCondCase skipped");
    return node;
  }

  visitFor(node: ast.ForNode): any {
    this.context.log(LogLevel.Verbose, "Method visitFor skipped");
    return node;
  }

  visitForEach(node: ast.ForEachNode): any {
    this.context.log(LogLevel.Verbose, "Method visitForEach skipped");
    return node;
  }

  visitWhile(node: ast.WhileNode): any {
    this.context.log(LogLevel.Verbose, "Method visitWhile skipped");
    return node;
  }

  visitMatch(node: ast.MatchNode): any {
    this.context.log(LogLevel.Verbose, "Method visitMatch skipped");
    return node;
  }

  visitMatchCase(node: ast.MatchCaseNode): any {
    this.context.log(LogLevel.Verbose, "Method visitMatchCase skipped");
    return node;
  }

  visitAnyPattern(node: ast.AnyPatternNode): any {
    this.context.log(LogLevel.Verbose, "Method visitAnyPattern skipped");
    return node;
  }

  visitFunctionalPattern(node: ast.FunctionalPatternNode): any {
    this.context.log(LogLevel.Verbose, "Method visitFunctionalPattern skipped");
    return node;
  }

  visitTypePattern(node: ast.TypePatternNode): any {
    this.context.log(LogLevel.Verbose, "Method visitTypePattern skipped");
    return node;
  }

  visitListPattern(node: ast.ListPatternNode): any {
    this.context.log(LogLevel.Verbose, "Method visitListPattern skipped");
    return node;
  }

  visitVectorPattern(node: ast.VectorPatternNode): any {
    this.context.log(LogLevel.Verbose, "Method visitVectorPattern skipped");
    return node;
  }

  visitMapPattern(node: ast.MapPatternNode): any {
    this.context.log(LogLevel.Verbose, "Method visitMapPattern skipped");
    return node;
  }

  visitMapPatternPair(node: ast.MapPatternPairNode): any {
    this.context.log(LogLevel.Verbose, "Method visitMapPatternPair skipped");
    return node;
  }

  visitIdentifierPattern(node: ast.IdentifierPatternNode): any {
    this.context.log(LogLevel.Verbose, "Method visitIdentifierPattern skipped");
    return node;
  }

  visitConstantPattern(node: ast.ConstantPatternNode): any {
    this.context.log(LogLevel.Verbose, "Method visitConstantPattern skipped");
    return node;
  }

  visitString(node: ast.StringNode): any {
    this.context.log(LogLevel.Verbose, "Method visitString skipped");
    return node;
  }

  visitFormattedString(node: ast.FormattedStringNode): any {
    this.context.log(LogLevel.Verbose, "Method visitFormattedString skipped");
    return node;
  }

  visitFormatExpression(node: ast.FormatExpressionNode): any {
    this.context.log(LogLevel.Verbose, "Method visitFormatExpression skipped");
    return node;
  }

  visitBoolean(node: ast.BooleanNode): any {
    this.context.log(LogLevel.Verbose, "Method visitBoolean skipped");
    return node;
  }

  visitNull(node: ast.NullNode): any {
    this.context.log(LogLevel.Verbose, "Method visitNull skipped");
    return node;
  }

  visitOctalNumber(node: ast.OctalNumberNode): any {
    this.context.log(LogLevel.Verbose, "Method visitOctalNumber skipped");
    return node;
  }

  visitBinaryNumber(node: ast.BinaryNumberNode): any {
    this.context.log(LogLevel.Verbose, "Method visitBinaryNumber skipped");
    return node;
  }

  visitHexNumber(node: ast.HexNumberNode): any {
    this.context.log(LogLevel.Verbose, "Method visitHexNumber skipped");
    return node;
  }

  visitComplexNumber(node: ast.ComplexNumberNode): any {
    this.context.log(LogLevel.Verbose, "Method visitComplexNumber skipped");
    return node;
  }

  visitFractionNumber(node: ast.FractionNumberNode): any {
    this.context.log(LogLevel.Verbose, "Method visitFractionNumber skipped");
    return node;
  }

  visitIntegerNumber(node: ast.IntegerNumberNode): any {
    this.context.log(LogLevel.Verbose, "Method visitIntegerNumber skipped");
    return node;
  }

  visitFloatNumber(node: ast.FloatNumberNode): any {
    this.context.log(LogLevel.Verbose, "Method visitFloatNumber skipped");
    return node;
  }

  visitSimpleIdentifier(node: ast.SimpleIdentifierNode): any {
    this.context.log(LogLevel.Verbose, "Method visitSimpleIdentifier skipped");
    return node;
  }

  visitCompositeIdentifier(node: ast.CompositeIdentifierNode): any {
    this.context.log(
      LogLevel.Verbose,
      "Method visitCompositeIdentifier skipped"
    );
    return node;
  }

  visitComment(node: ast.CommentNode): any {
    this.context.log(LogLevel.Verbose, "Method visitComment skipped");
    return node;
  }
}
