import * as ast from "./frontend/ast";
import { Context, LogLevel } from "./Context";
import { formatWithOptions } from "util";
import { DiagnosticDef, report } from "./rules/diagnostics";

export class BaseAstVisitor {
  context: Context;
  private visitCount: number = 0;

  constructor(context: Context) {
    this.context = context;
  }

  /**
   * Report a centralized diagnostic against `node`. The code, severity and message TEMPLATE live in a
   * category map under `rules/diagnostics/`; the call site supplies only the node and the (primitive)
   * params. This replaces the per-visitor `report*Error(node, code, message)` helpers -- see the
   * category files for the free-code allocator.
   */
  protected report(d: DiagnosticDef<void>, node: ast.ASTNode): void;
  protected report<P>(d: DiagnosticDef<P>, node: ast.ASTNode, params: P): void;
  protected report<P>(d: DiagnosticDef<P>, node: ast.ASTNode, params?: P): void {
    report(this.context, d, node, params as P);
  }

  // Add method to get visit count
  getVisitCount(): number {
    return this.visitCount;
  }

  // Reset visit count
  resetVisitCount(): void {
    this.visitCount = 0;
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
        "quasiquote": this.visitQuasiquote.bind(this),
        "unquote": this.visitUnquote.bind(this),
        "syntax-def": this.visitSyntaxDef.bind(this),
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
        "tuple-type": this.visitTupleType.bind(this),
        "modifier": this.visitModifier.bind(this),
        "modifier-def": this.visitModifierDef?.bind(this),
        "attribute-def": this.visitAttributeDef?.bind(this),
        "macro-def": this.visitMacroDef?.bind(this),
        "variable": this.visitVariable.bind(this),
        "function": this.visitFunction.bind(this),
        "parameter": this.visitParameter.bind(this),
        "class": this.visitClass.bind(this),
        "enum": this.visitEnum.bind(this),
        "enum-key": this.visitEnumKey.bind(this),
        "struct": this.visitStruct.bind(this),
        "type-def": this.visitTypeDef.bind(this),
        "cast": this.visitCast.bind(this),
        "range-refinement": this.visitRangeRefinement?.bind(this),
        "dimension-refinement": this.visitDimensionRefinement?.bind(this),
        "interface": this.visitInterface.bind(this),
        "implements": this.visitImplements.bind(this),
        "extends": this.visitExtends.bind(this),
        "type-constraint": this.visitTypeConstraint.bind(this),
        "spread": this.visitSpread.bind(this),
        "await": this.visitAwait.bind(this),
        "simple-assignment": this.visitSimpleAssignment.bind(this),
        "compound-assignment": this.visitCompoundAssignment.bind(this),
        "indexer": this.visitIndexer.bind(this),
        "call": this.visitCall.bind(this),
        "member": this.visitMember.bind(this),
        "try-catch": this.visitTryCatch.bind(this),
        "restart-case": this.visitRestartCase.bind(this),
        "handle": this.visitHandle.bind(this),
        "signal": this.visitSignal.bind(this),
        "invoke-restart": this.visitInvokeRestart.bind(this),
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
        "type-guard": this.visitTypeGuard.bind(this),
        "list-pattern": this.visitListPattern.bind(this),
        "vector-pattern": this.visitVectorPattern.bind(this),
        "map-pattern": this.visitMapPattern.bind(this),
        "map-pattern-pair": this.visitMapPatternPair.bind(this),
        "identifier-pattern": this.visitIdentifierPattern.bind(this),
        "rest-pattern": this.visitRestPattern.bind(this),
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

    // Track visit count and record with performance metrics
    this.visitCount++;
    this.context.performanceMetrics.recordVisit();

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

  /**
   * Called when a visitor subclass does NOT override the `visitX` for a node type it was handed.
   *
   * The default is the historical behaviour, and it is correct for the analysis and type passes:
   * they legitimately care about only a few node types, and returning the node unchanged is how
   * they ignore the rest.
   *
   * It is NOT correct for codegen. A backend that "skips" a node silently returns an *AST node*
   * where an ESTree node was expected; that AST node gets spliced into the tree and the failure
   * surfaces much later as a crash inside `astring` (e.g. `this[node.init.type] is not a
   * function`), naming a third-party library instead of the construct the compiler cannot emit.
   * `JSTransformerAstVisitor` therefore overrides this to raise a located LL0100 -- see there.
   */
  protected onUnhandled(node: ast.ASTNode, method: string): any {
    this.context.log(LogLevel.Verbose, `Method ${method} skipped`);
    return node;
  }

  /**
   * Does this class actually IMPLEMENT `visitX`, or is it the inherited no-op?
   *
   * This exists because `(this as any)['visit' + Type]` -- the obvious dispatch, and the one two
   * REWRITING visitors were built on -- is **always truthy**: the block below declares a `visitX`
   * for every node type in the language, each one an `onUnhandled` no-op. So a rewriting visitor
   * that dispatches on truthiness lands on the NO-OP for every type it did not explicitly override,
   * returns the node unchanged, and NEVER RECURSES INTO ITS CHILDREN -- which makes its own
   * generic-recursion fallback dead code it can never reach.
   *
   * Both `DesugarAstVisitor` and `ComptimeEvaluationAstVisitor` were written that way. The desugarer
   * therefore reached only `program`, `list` and `function`, and the comptime pass never entered an
   * `if` body -- so a `:comptime` fold inside an `if` silently did not happen, the tree-shaker then
   * deleted the function as "already folded", and the program threw `ReferenceError` at run time with
   * zero diagnostics.
   *
   * A visitor that only READS (the analysis and type passes) is unaffected: it uses
   * `BaseAstTreeWalker`, whose generic walk recurses regardless of dispatch. A visitor that REWRITES
   * cannot use that walk -- it re-walks the ORIGINAL node's children and overwrites the rewrite -- so
   * it must own its recursion, and must therefore be able to tell a real visitor from the no-op.
   */
  protected overridesVisitor(methodName: string): boolean {
    const method = (this as any)[methodName];
    return (
      typeof method === "function" &&
      method !== (BaseAstVisitor.prototype as any)[methodName]
    );
  }

  visitProgram(node: ast.ProgramNode): any {
    return this.onUnhandled(node, "visitProgram");
  }

  visitList(node: ast.ListNode): any {
    return this.onUnhandled(node, "visitList");
  }

  visitQuasiquote(node: ast.QuasiquoteNode): any {
    return this.onUnhandled(node, "visitQuasiquote");
  }

  visitUnquote(node: ast.UnquoteNode): any {
    return this.onUnhandled(node, "visitUnquote");
  }

  visitSyntaxDef(node: ast.SyntaxDefNode): any {
    return this.onUnhandled(node, "visitSyntaxDef");
  }

  visitQuote(node: ast.QuoteNode): any {
    return this.onUnhandled(node, "visitQuote");
  }

  visitVector(node: ast.VectorNode): any {
    return this.onUnhandled(node, "visitVector");
  }

  visitMatrix(node: ast.MatrixNode): any {
    return this.onUnhandled(node, "visitMatrix");
  }

  visitMap(node: ast.MapNode): any {
    return this.onUnhandled(node, "visitMap");
  }

  visitKeyValue(node: ast.KeyValueNode): any {
    return this.onUnhandled(node, "visitKeyValue");
  }

  visitExport(node: ast.ExportNode): any {
    return this.onUnhandled(node, "visitExport");
  }

  visitImport(node: ast.ImportNode): any {
    return this.onUnhandled(node, "visitImport");
  }

  visitTypeName(node: ast.TypeNameNode): any {
    return this.onUnhandled(node, "visitTypeName");
  }

  visitType(node: ast.TypeNode): any {
    return this.onUnhandled(node, "visitType");
  }

  visitUnionType(node: ast.UnionTypeNode): any {
    return this.onUnhandled(node, "visitUnionType");
  }

  visitIntersectionType(node: ast.IntersectionTypeNode): any {
    return this.onUnhandled(node, "visitIntersectionType");
  }

  visitFunctionType(node: ast.FunctionTypeNode): any {
    return this.onUnhandled(node, "visitFunctionType");
  }

  visitSimpleType(node: ast.SimpleTypeNode): any {
    return this.onUnhandled(node, "visitSimpleType");
  }

  visitGenericType(node: ast.GenericTypeNode): any {
    return this.onUnhandled(node, "visitGenericType");
  }

  visitMapType(node: ast.MapTypeNode): any {
    return this.onUnhandled(node, "visitMapType");
  }

  visitMapKeyType(node: ast.MapKeyTypeNode): any {
    return this.onUnhandled(node, "visitMapKeyType");
  }

  visitTupleType(node: ast.TupleTypeNode): any {
    return this.onUnhandled(node, "visitTupleType");
  }

  visitMappedType(node: ast.MappedTypeNode): any {
    return this.onUnhandled(node, "visitMappedType");
  }

  visitModifier(node: ast.ModifierNode): any {
    return this.onUnhandled(node, "visitModifier");
  }

  visitMacroDef?(node: ast.MacroDefNode): any {
    return this.onUnhandled(node, "visitMacroDef");
  }

  visitModifierDef?(node: ast.ModifierDefNode): any {
    return this.onUnhandled(node, "visitModifierDef");
  }

  visitAttributeDef?(node: ast.AttributeDefNode): any {
    return this.onUnhandled(node, "visitAttributeDef");
  }

  // A `:satisfies (...)` refinement rides on a TypeDefNode as metadata; passes that care about it read
  // `typeDef.refinement` directly. This visitor exists so the node type is exhaustively mapped -- it is
  // not reached in normal top-level traversal (a refinement is never a standalone statement).
  visitRangeRefinement?(node: ast.RangeRefinementNode): any {
    return this.onUnhandled(node, "visitRangeRefinement");
  }

  // Same story as the range refinement above: metadata on a TypeDefNode, mapped here only so the node
  // type is exhaustive. Its operands are STRINGS (D90), so there is nothing under it to traverse.
  visitDimensionRefinement?(node: ast.DimensionRefinementNode): any {
    return this.onUnhandled(node, "visitDimensionRefinement");
  }

  visitVariable(node: ast.VariableNode): any {
    return this.onUnhandled(node, "visitVariable");
  }

  visitFunction(node: ast.FunctionNode): any {
    return this.onUnhandled(node, "visitFunction");
  }

  visitParameter(node: ast.ParameterNode): any {
    return this.onUnhandled(node, "visitParameter");
  }

  visitClass(node: ast.ClassNode): any {
    return this.onUnhandled(node, "visitClass");
  }

  visitEnum(node: ast.EnumNode): any {
    return this.onUnhandled(node, "visitEnum");
  }

  visitEnumKey(node: ast.EnumKeyNode): any {
    return this.onUnhandled(node, "visitEnumKey");
  }

  visitStruct(node: ast.StructNode): any {
    return this.onUnhandled(node, "visitStruct");
  }

  visitCast(node: ast.CastNode): any {
    return this.onUnhandled(node, "visitCast");
  }

  visitTypeDef(node: ast.TypeDefNode): any {
    return this.onUnhandled(node, "visitTypeDef");
  }

  visitInterface(node: ast.InterfaceNode): any {
    return this.onUnhandled(node, "visitInterface");
  }

  visitImplements(node: ast.ImplementsNode): any {
    return this.onUnhandled(node, "visitImplements");
  }

  visitExtends(node: ast.ExtendsNode): any {
    return this.onUnhandled(node, "visitExtends");
  }

  visitTypeConstraint(node: ast.TypeConstraintNode): any {
    return this.onUnhandled(node, "visitTypeConstraint");
  }

  visitSpread(node: ast.SpreadNode): any {
    return this.onUnhandled(node, "visitSpread");
  }

  visitAwait(node: ast.AwaitNode): any {
    return this.onUnhandled(node, "visitAwait");
  }

  visitSimpleAssignment(node: ast.SimpleAssignmentNode): any {
    return this.onUnhandled(node, "visitSimpleAssignment");
  }

  visitCompoundAssignment(node: ast.CompoundAssignmentNode): any {
    return this.onUnhandled(node, "visitCompoundAssignment");
  }

  /**
   * The CORE nodes. See `ast.CallNode` / `ast.MemberNode`.
   *
   * They are in the exhaustive `Record<ast.NodeType, ...>` map above, which means TypeScript forces
   * every backend to answer for them -- a backend that cannot emit one is a COMPILE error here, not a
   * silent pass-through that surfaces later as a crash inside astring. Codegen's `onUnhandled` raises
   * a located LL0100 for the same reason.
   */
  visitCall(node: ast.CallNode): any {
    return this.onUnhandled(node, "visitCall");
  }

  visitMember(node: ast.MemberNode): any {
    return this.onUnhandled(node, "visitMember");
  }

  visitIndexer(node: ast.IndexerNode): any {
    return this.onUnhandled(node, "visitIndexer");
  }

  visitTryCatch(node: ast.TryCatchNode): any {
    return this.onUnhandled(node, "visitTryCatch");
  }

  // D47 conditions/restarts. Default to onUnhandled like every other node. A pass overrides only to
  // add its own handling (the symbol-table builder declares the clause binder / arm params); the
  // CHILDREN, including the clause and arm bodies, are reached by BaseAstTreeWalker's generic walk --
  // they were dark until walkPlainObject taught it to descend into record-shaped fields. The JS
  // backend refuses these forms at emit (LL0108).
  visitRestartCase(node: ast.RestartCaseNode): any {
    return this.onUnhandled(node, "visitRestartCase");
  }

  visitHandle(node: ast.HandleNode): any {
    return this.onUnhandled(node, "visitHandle");
  }

  visitSignal(node: ast.SignalNode): any {
    return this.onUnhandled(node, "visitSignal");
  }

  visitInvokeRestart(node: ast.InvokeRestartNode): any {
    return this.onUnhandled(node, "visitInvokeRestart");
  }

  visitWhen(node: ast.WhenNode): any {
    return this.onUnhandled(node, "visitWhen");
  }

  visitIf(node: ast.IfNode): any {
    return this.onUnhandled(node, "visitIf");
  }

  visitCond(node: ast.CondNode): any {
    return this.onUnhandled(node, "visitCond");
  }

  visitCondCase(node: ast.CondCaseNode): any {
    return this.onUnhandled(node, "visitCondCase");
  }

  visitFor(node: ast.ForNode): any {
    return this.onUnhandled(node, "visitFor");
  }

  visitForEach(node: ast.ForEachNode): any {
    return this.onUnhandled(node, "visitForEach");
  }

  visitWhile(node: ast.WhileNode): any {
    return this.onUnhandled(node, "visitWhile");
  }

  visitMatch(node: ast.MatchNode): any {
    return this.onUnhandled(node, "visitMatch");
  }

  visitMatchCase(node: ast.MatchCaseNode): any {
    return this.onUnhandled(node, "visitMatchCase");
  }

  visitAnyPattern(node: ast.AnyPatternNode): any {
    return this.onUnhandled(node, "visitAnyPattern");
  }

  visitFunctionalPattern(node: ast.FunctionalPatternNode): any {
    return this.onUnhandled(node, "visitFunctionalPattern");
  }

  visitTypePattern(node: ast.TypePatternNode): any {
    return this.onUnhandled(node, "visitTypePattern");
  }

  visitTypeGuard(node: ast.TypeGuardNode): any {
    return this.onUnhandled(node, "visitTypeGuard");
  }

  visitListPattern(node: ast.ListPatternNode): any {
    return this.onUnhandled(node, "visitListPattern");
  }

  visitVectorPattern(node: ast.VectorPatternNode): any {
    return this.onUnhandled(node, "visitVectorPattern");
  }

  visitMapPattern(node: ast.MapPatternNode): any {
    return this.onUnhandled(node, "visitMapPattern");
  }

  visitMapPatternPair(node: ast.MapPatternPairNode): any {
    return this.onUnhandled(node, "visitMapPatternPair");
  }

  visitIdentifierPattern(node: ast.IdentifierPatternNode): any {
    return this.onUnhandled(node, "visitIdentifierPattern");
  }

  visitRestPattern(node: ast.RestPatternNode): any {
    return this.onUnhandled(node, "visitRestPattern");
  }

  visitConstantPattern(node: ast.ConstantPatternNode): any {
    return this.onUnhandled(node, "visitConstantPattern");
  }

  visitString(node: ast.StringNode): any {
    return this.onUnhandled(node, "visitString");
  }

  visitFormattedString(node: ast.FormattedStringNode): any {
    return this.onUnhandled(node, "visitFormattedString");
  }

  visitFormatExpression(node: ast.FormatExpressionNode): any {
    return this.onUnhandled(node, "visitFormatExpression");
  }

  visitBoolean(node: ast.BooleanNode): any {
    return this.onUnhandled(node, "visitBoolean");
  }

  visitNull(node: ast.NullNode): any {
    return this.onUnhandled(node, "visitNull");
  }

  visitOctalNumber(node: ast.OctalNumberNode): any {
    return this.onUnhandled(node, "visitOctalNumber");
  }

  visitBinaryNumber(node: ast.BinaryNumberNode): any {
    return this.onUnhandled(node, "visitBinaryNumber");
  }

  visitHexNumber(node: ast.HexNumberNode): any {
    return this.onUnhandled(node, "visitHexNumber");
  }

  visitComplexNumber(node: ast.ComplexNumberNode): any {
    return this.onUnhandled(node, "visitComplexNumber");
  }

  visitFractionNumber(node: ast.FractionNumberNode): any {
    return this.onUnhandled(node, "visitFractionNumber");
  }

  visitIntegerNumber(node: ast.IntegerNumberNode): any {
    return this.onUnhandled(node, "visitIntegerNumber");
  }

  visitFloatNumber(node: ast.FloatNumberNode): any {
    return this.onUnhandled(node, "visitFloatNumber");
  }

  visitSimpleIdentifier(node: ast.SimpleIdentifierNode): any {
    return this.onUnhandled(node, "visitSimpleIdentifier");
  }

  visitCompositeIdentifier(node: ast.CompositeIdentifierNode): any {
    return this.onUnhandled(node, "visitCompositeIdentifier");
  }

  visitComment(node: ast.CommentNode): any {
    return this.onUnhandled(node, "visitComment");
  }
}
