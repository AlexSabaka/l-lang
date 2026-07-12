import { ast, LogLevel, Context } from "../..";
import { BaseAstVisitor  } from "../../BaseAstVisitor";

export class LlangTransformerAstVisitor extends BaseAstVisitor {
  constructor(context: Context) {
    super(context);
  }

  public compile(root: ast.ASTNode) {
    this.context.log(LogLevel.Debug, "Starting Llang AST to Llang code transformation...", "LlangTransformerAstVisitor.compile");
    const result = this.visit(root);
    this.context.log(LogLevel.Debug, "Completed Llang AST to Llang code transformation.", "LlangTransformerAstVisitor.compile");
    return { code: result, map: null };
  }

  private mapVisitJoinNodes(nodes: ast.ASTNode[], indent: string = ' ', end: string = ''): string {
    if (!nodes || nodes.length === 0) return '';
    return `${nodes.map(x => this.visit(x)).join(indent)}${end}`;
  }

  private visitNullable(node: ast.ASTNode | null | undefined, prefix: string = '', suffix: string = ''): string {
    if (!node) return '';
    return `${prefix}${this.visit(node)}${suffix}`;
  }

  // --- Basics ---

  visitProgram(node: ast.ProgramNode): any {
    return `${this.mapVisitJoinNodes(node.program, '\n  ', '\n')}`;
  }

  visitList(node: ast.ListNode): any {
    return `(${this.mapVisitJoinNodes(node.nodes)})`;
  }

  visitQuote(node: ast.QuoteNode): any {
    return `'(${this.mapVisitJoinNodes(node.nodes || [])})`;
  }

  visitVector(node: ast.VectorNode): any {
    return `[${this.mapVisitJoinNodes(node.values)}]`;
  }

  visitMatrix(node: ast.MatrixNode): any {
    return `[${node.rows.map(r => this.mapVisitJoinNodes(r, ' ')).join(' | ')}]`;
  }

  visitMap(node: ast.MapNode): any {
    return `{${this.mapVisitJoinNodes(node.values, ' ')}}`;
  }

  visitKeyValue(node: ast.KeyValueNode): any {
    return `:${this.visit(node.key)} ${this.visitNullable(node.value)}`;
  }

  // --- Modules ---

  visitExport(node: ast.ExportNode): any {
    const exports = node.exports.map(e => {
      const as = e.as ? ` :as ${ast.symbolName(e.as)}` : '';
      const symbol = e.symbol._type === 'type-name' ? (e.symbol as any).name : (e.symbol as any).id;
      return `${symbol}${as}`;
    }).join(' ');
    return `(export ${exports})`;
  }

  visitImport(node: ast.ImportNode): any {
    // Reconstructing import syntax is complex due to variations
    const mapSource = (s: ast.NamespaceImportSource | ast.FileImportSource) => 
      (s as ast.FileImportSource).file ? `"${(s as ast.FileImportSource).file.value}"` : (s as ast.NamespaceImportSource).namespace.id;

    const imports = node.imports.map((imp: ast.ImportDefinition) => {
      if (imp.symbols) {
        // { a, b :as c } from "file"
        const syms = imp.symbols.map((s: ast.ImportExportAlias) => 
          `${ast.symbolName(s.symbol)}${s.as ? ' :as ' + ast.symbolName(s.as) : ''}`
        ).join(' ');
        
        return `{ ${syms} } from ${mapSource(imp.source)}`;
      } else {
        // Simple import: "file" or namespace
        return mapSource(imp.source);
      }
    }); 

    return `(import ${imports.join(' ')})`;
  }

  // --- Types ---

  visitTypeName(node: ast.TypeNameNode): any {
    return node.name;
  }

  visitType(node: ast.TypeNode): any {
    const base = this.visit(node.type);
    return `${base}${node.array ? '[]' : ''}`;
  }

  visitUnionType(node: ast.UnionTypeNode): any {
    return node.types.map(t => this.visit(t)).join(' | ');
  }

  visitIntersectionType(node: ast.IntersectionTypeNode): any {
    return node.types.map(t => this.visit(t)).join(' & ');
  }

  visitFunctionType(node: ast.FunctionTypeNode): any {
    return `fn [${this.mapVisitJoinNodes(node.params)}] -> ${this.visit(node.ret[0])}`;
  }

  visitSimpleType(node: ast.SimpleTypeNode): any {
    return node.name.name; // SimpleType wraps TypeName
  }

  visitGenericType(node: ast.GenericTypeNode): any {
    return `${node.name.name}<${this.mapVisitJoinNodes(node.generics, ', ')}>`;
  }

  visitMapType(node: ast.MapTypeNode): any {
    return `{${this.mapVisitJoinNodes(node.keys, ' ')}}`;
  }

  visitMapKeyType(node: ast.MapKeyTypeNode): any {
    const key = typeof node.key === 'string' ? `"${node.key}"` : (node.key as any).id || (node.key as any).name;
    return `:${key} <- ${this.visit(node.type)}`;
  }

  visitMappedType(node: ast.MappedTypeNode): any {
    // Simplified reconstruction
    return `{ ${this.mapVisitJoinNodes(node.mapping as any[])} }`;
  }

  // --- Declarations ---

  visitModifier(node: ast.ModifierNode): any {
    return `:${node.modifier}`;
  }

  visitVariable(node: ast.VariableNode): any {
    const kw = node.mutable ? 'mut' : 'let';
    const mods = this.mapVisitJoinNodes(node.modifiers);
    const name = node.name ? ` ${this.visit(node.name)}` : '';
    const type = node.type ? ` <- ${this.visit(node.type)}` : '';
    const val = node.value ? ` ${this.visit(node.value)}` : '';
    
    return `${kw}${mods ? ' ' + mods : ''}${name}${type}${val}`;
  }

  visitFunction(node: ast.FunctionNode): any {
    const asyncKw = node.async ? 'async ' : '';
    const mods = this.mapVisitJoinNodes(node.modifiers);
    const name = node.name ? ` ${this.visit(node.name)}` : '';
    const params = `[${this.mapVisitJoinNodes(node.params)}]`;
    const ret = node.returns ? ` -> ${this.visit(node.returns)}` : '';
    const body = this.mapVisitJoinNodes(node.body);
    
    return `${asyncKw}fn${mods ? ' ' + mods : ''}${name} ${params}${ret} ${body}`;
  }

  visitParameter(node: ast.ParameterNode): any {
    const mods = this.mapVisitJoinNodes(node.modifiers);
    const name = this.visit(node.name);
    const type = node.type ? ` <- ${this.visit(node.type)}` : '';
    return `${mods ? mods + ' ' : ''}${name}${type}`;
  }

  // --- OOP ---

  visitClass(node: ast.ClassNode): any {
    const mods = this.mapVisitJoinNodes(node.modifiers);
    const name = node.name ? ` ${node.name.name}` : ''; // Accessing nested TypeName
    
    const impls = node.implements && node.implements.length 
      ? ' ' + node.implements.map(i => this.visit(i)).join(' ') 
      : '';
    const exts = node.extends && node.extends.length 
      ? ' ' + node.extends.map(e => this.visit(e)).join(' ') 
      : '';
      
    // Generics and constraints would go here if needed
    
    const body = this.mapVisitJoinNodes(node.body, ' ');
    return `(defclass${mods ? ' ' + mods : ''}${name}${exts}${impls} ${body})`;
  }

  visitEnum(node: ast.EnumNode): any {
    const mods = this.mapVisitJoinNodes(node.modifiers);
    const name = node.name ? ` ${this.visit(node.name)}` : '';
    const body = this.mapVisitJoinNodes(node.body, ' ');
    return `(defenum${mods ? ' ' + mods : ''}${name} ${body})`;
  }

  visitStruct(node: ast.StructNode): any {
    const mods = this.mapVisitJoinNodes(node.modifiers);
    const name = node.name ? ` ${this.visit(node.name)}` : '';
    const body = this.mapVisitJoinNodes(node.body, ' ');
    return `(defstruct${mods ? ' ' + mods : ''}${name} ${body})`;
  }

  visitTypeDef(node: ast.TypeDefNode): any {
    // Assuming structure based on parser TODOs
    return `(deftype ...)`; 
  }

  visitInterface(node: ast.InterfaceNode): any {
     const mods = this.mapVisitJoinNodes(node.modifiers);
     const name = node.name ? ` ${node.name.name}` : '';
     const impl = node.implements ? ` ${this.visit(node.implements)}` : '';
     const body = this.mapVisitJoinNodes(node.body, ' ');
     return `(definterface${mods ? ' ' + mods : ''}${name}${impl} ${body})`;
  }

  visitImplements(node: ast.ImplementsNode): any {
    return `:implements ${this.visit(node.type)}`;
  }

  visitExtends(node: ast.ExtendsNode): any {
    return `:extends ${this.visit(node.type)}`;
  }

  visitTypeConstraint(node: ast.TypeConstraintNode): any {
    const parts = (node.constraints ?? [])
      .map((c) => `:${c.constraint} ${this.visit(c.value)}`)
      .join(' ');
    return `(:where ${this.visit(node.where)} ${parts})`;
  }

  // --- Operators ---
  visitSpread(node: ast.SpreadNode): any {
    return `...${this.visit(node.expression)}`;
  }

  visitSimpleAssignment(node: ast.SimpleAssignmentNode): any {
    return `(${this.visit(node.assignable)} = ${this.visit(node.value)})`;
  }

  visitCompoundAssignment(node: ast.CompoundAssignmentNode): any {
    // Note: Parser might strip the '=' from operator, ensure it's added back if needed
    return `(${this.visit(node.assignable)} ${node.operator}= ${this.visit(node.value)})`;
  }

  visitIndexer(node: ast.IndexerNode): any {
    const indices = node.indices.map((i: any) => this.visit(i)).join(', ');
    return `${this.visit(node.id)}[${indices}]`;
  }

  // --- Control Flow ---

  visitTryCatch(node: ast.TryCatchNode): any {
    let result = `(try ${this.visitNullable(node.try)}`;
    
    if (node.catch && node.catch.length > 0) {
        result += ' ' + node.catch.map((c: any) => {
            const type = c.filter && c.filter.type ? ` :of ${this.visit(c.filter.type)}` : '';
            const name = c.filter ? ` ${c.filter.name.id}` : '';
            return `catch${name}${type} ${this.visitNullable(c.body)}`;
        }).join(' ');
    }
    
    if (node.finally) {
        result += ` finally ${this.visit(node.finally)}`;
    }
    
    return result + ')';
  }

  visitWhen(node: ast.WhenNode): any {
    const cond = node.condition ? ` ${this.visit(node.condition)}` : '';
    const then = node.then ? ` :then ${this.mapVisitJoinNodes(node.then)}` : '';
    return `(when${cond}${then})`;
  }

  visitIf(node: ast.IfNode): any {
    const cond = node.condition ? ` ${this.visit(node.condition)}` : '';
    const then = node.then ? ` ${this.visit(node.then)}` : '';
    const elseThen = node.else ? ` ${this.visit(node.else)}` : '';
    return `(if${cond}${then}${elseThen})`;
  }

  visitCond(node: ast.CondNode): any {
    return `(cond ${this.mapVisitJoinNodes(node.cases)})`;
  }

  visitCondCase(node: ast.CondCaseNode): any {
    const cond = node.condition ? this.visit(node.condition) : '';
    const body = node.body ? this.visit(node.body) : '';
    return `(${cond} ${body})`;
  }

  visitFor(node: ast.ForNode): any {
    const init = this.visitNullable(node.initial, ' :init ');
    const cond = this.visitNullable(node.condition, ' :cond ');
    const step = this.visitNullable(node.step, ' :step ');
    const then = this.visitNullable(node.then, ' :then ');
    const els = this.visitNullable(node.else, ' :else ');
    return `(for${init}${cond}${step}${then}${els})`;
  }

  visitForEach(node: ast.ForEachNode): any {
    const variable = this.visitNullable(node.variable, ' :each ');
    const coll = this.visitNullable(node.collection, ' :from ');
    const then = this.visitNullable(node.then, ' :then ');
    const els = this.visitNullable(node.else, ' :else ');
    return `(for${variable}${coll}${then}${els})`;
  }

  visitWhile(node: ast.WhileNode): any {
    const cond = node.condition ? ` ${this.visit(node.condition)}` : '';
    const then = node.then ? ` ${this.visit(node.then)}` : '';
    return `(while${cond}${then})`;
  }

  // --- Pattern Matching ---

  visitMatch(node: ast.MatchNode): any {
    return `(match ${this.visit(node.expression)} { ${this.mapVisitJoinNodes(node.cases, ' ')} })`;
  }

  visitMatchCase(node: ast.MatchCaseNode): any {
    return `${this.visit(node.pattern)} => ${this.visit(node.body)}`;
  }

  visitAnyPattern(node: ast.AnyPatternNode): any {
    return '_';
  }

  visitFunctionalPattern(node: ast.FunctionalPatternNode): any {
    return `(${this.mapVisitJoinNodes(node.params)}) -> ${this.visit(node.ret)}`;
  }

  visitTypePattern(node: ast.TypePatternNode): any {
    return `${this.visit(node.id)} :of ${this.visit(node.type)}`;
  }

  visitListPattern(node: ast.ListPatternNode): any {
    return `(${this.mapVisitJoinNodes(node.elements)})`;
  }

  visitVectorPattern(node: ast.VectorPatternNode): any {
    return `[${this.mapVisitJoinNodes(node.elements)}]`;
  }

  visitMapPattern(node: ast.MapPatternNode): any {
    return `{ ${this.mapVisitJoinNodes(node.pairs, ', ')} }`;
  }

  visitMapPatternPair(node: ast.MapPatternPairNode): any {
    return `:${this.visit(node.key)} ${this.visit(node.pattern)}`;
  }

  visitIdentifierPattern(node: ast.IdentifierPatternNode): any {
    return this.visit(node.id);
  }

  visitConstantPattern(node: ast.ConstantPatternNode): any {
    // ConstantPattern usually wraps a literal (String or Number)
    // If it wraps a generic LiteralNode, we need to dispatch
    return this.visit(node.constant); 
  }

  // --- Literals ---

  visitString(node: ast.StringNode): any {
    return `"${node.value}"`;
  }

  visitFormattedString(node: ast.FormattedStringNode): any {
    // Reconstruct the formatted string syntax '"..."
    const parts = node.value.map((item: any) => {
        if (item._type === 'string') return item.value;
        if (item._type === 'format-expression') return `{${this.visit(item.expression)}}`;
        return '';
    }).join('');
    return `'"${parts}"`;
  }

  visitFormatExpression(node: ast.FormatExpressionNode): any {
    return `{${this.visit(node.expression)}}`;
  }

  visitBoolean(node: ast.BooleanNode): any {
    return node.value ? 'true' : 'false';
  }

  visitNull(node: ast.NullNode): any {
    return node.keyword; // "nil", "null", "void", etc.
  }

  // Numbers: prefer 'match' to preserve original formatting (hex, binary, etc.)
  visitOctalNumber(node: ast.OctalNumberNode): any { return node.match; }
  visitBinaryNumber(node: ast.BinaryNumberNode): any { return node.match; }
  visitHexNumber(node: ast.HexNumberNode): any { return node.match; }
  visitComplexNumber(node: ast.ComplexNumberNode): any { return node.match; }
  visitFractionNumber(node: ast.FractionNumberNode): any { return node.match; }
  visitIntegerNumber(node: ast.IntegerNumberNode): any { return node.match || node.value.toString(); }
  visitFloatNumber(node: ast.FloatNumberNode): any { return node.match || node.value.toString(); }

  visitSimpleIdentifier(node: ast.SimpleIdentifierNode): any {
    return node.id;
  }

  visitCompositeIdentifier(node: ast.CompositeIdentifierNode): any {
    return (node.headless ? '.' : '') + node.id;
  }

  visitComment(node: ast.CommentNode): any {
    return `;${node.comment}\n`;
  }
}