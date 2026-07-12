/**
 * l-lang AST Builder
 *
 * Converts Chevrotain CST (Concrete Syntax Tree) to the AST format
 * expected by the l-lang compiler. This must produce identical output
 * to the PEG.js parser.
 */
import * as ast from "../ast";
import { parser } from "./Parser";

// Get the base visitor constructor from the parser
const BaseCstVisitor = parser.getBaseCstVisitorConstructor();

/**
 * Helper to create location from CST context
 */
function createLocation(ctx: any, source: string): ast.Location {
  let firstToken: any;
  let lastToken: any;

  // Recursively find first and last tokens
  const findTokens = (obj: any): void => {
    if (!obj || typeof obj !== "object") return;
    if ("startOffset" in obj && typeof obj.startOffset === "number") {
      const token = obj;
      if (!firstToken || token.startOffset < firstToken.startOffset) {
        firstToken = token;
      }
      if (!lastToken || (token.endOffset || 0) > (lastToken.endOffset || 0)) {
        lastToken = token;
      }
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach(findTokens);
    } else {
      Object.values(obj).forEach(findTokens);
    }
  };

  findTokens(ctx);

  if (!firstToken || !lastToken) {
    return {
      source,
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 0, line: 1, column: 1 },
    };
  }

  return {
    source,
    start: {
      offset: firstToken.startOffset,
      line: firstToken.startLine || 1,
      column: firstToken.startColumn || 1,
    },
    end: {
      offset: lastToken.endOffset || firstToken.startOffset,
      line: lastToken.endLine || firstToken.startLine || 1,
      column: (lastToken.endColumn || firstToken.startColumn || 1) + 1,
    },
  };
}

/**
 * AST Builder - converts CST to AST
 */
export class LLangAstBuilder extends BaseCstVisitor {
  private source: string;

  constructor(source: string) {
    super();
    this.source = source;
    this.validateVisitor();
  }

  private loc(ctx: any): ast.Location {
    return createLocation(ctx, this.source);
  }

  private makeNode(type: string, ctx: any, data: any): any {
    return {
      ...data,
      _type: type,
      _location: this.loc(ctx),
      _parent: undefined,
    };
  }

  // ========================================================================
  // PROGRAM
  // ========================================================================
  program(ctx: any): ast.ProgramNode {
    const program = ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : [];
    return this.makeNode("program", ctx, { program });
  }

  // ========================================================================
  // EXPRESSION
  // ========================================================================
  expression(ctx: any): ast.ASTNode {
    // Find which alternative matched
    const alternatives = [
      "comment", "importExpr", "exportExpr", "variable", "functionExpr",
      "classDecl", "structDecl", "enumDecl", "interfaceDecl", "typeDefDecl",
      "modifierDefDecl", "whenExpr", "ifExpr", "condExpr", "forExpr",
      "whileExpr", "tryCatchExpr", "matchExpr", "awaitExpr", "spreadExpr",
      "assignmentOrExpr", "quoteExpr", "nil", "boolean", "number", "string",
    ];
    for (const alt of alternatives) {
      if (ctx[alt]) {
        return this.visit(ctx[alt][0]);
      }
    }
    throw new Error(`Unknown expression type in context: ${Object.keys(ctx)}`);
  }

  assignmentOrExpr(ctx: any): ast.ASTNode {
    const base = this.visit(ctx.primaryExpr[0]);
    if (ctx.assignmentOp) {
      const { operator, value } = this.visit(ctx.assignmentOp[0]);
      // D2 (docs/spec/DECISIONS.md#d2) makes := the only assignment operator eventually;
      // the recovered grammar already treats all of these as one "compound-assignment" node.
      return this.makeNode("compound-assignment", ctx, {
        assignable: base,
        value,
        operator,
      });
    }
    return base;
  }

  primaryExpr(ctx: any): ast.ASTNode {
    if (ctx.list) {
      return this.visit(ctx.list[0]);
    }
    if (ctx.matrix) {
      return this.visit(ctx.matrix[0]);
    }
    if (ctx.vector) {
      return this.visit(ctx.vector[0]);
    }
    if (ctx.map) {
      return this.visit(ctx.map[0]);
    }
    if (ctx.identifier) {
      const id = this.visit(ctx.identifier[0]);
      if (ctx.indexerSuffix && ctx.indexerSuffix.length > 0) {
        const indices = ctx.indexerSuffix.map((s: any) => this.visit(s));
        return this.makeNode("indexer", ctx, { id, indices });
      }
      return id;
    }
    throw new Error(`Unknown primary expression: ${Object.keys(ctx)}`);
  }

  assignmentOp(ctx: any): { operator: string; value: ast.ASTNode } {
    let operator = ":=";
    if (ctx.ColonEq) operator = ":=";
    else if (ctx.PlusEq) operator = "+=";
    else if (ctx.MinusEq) operator = "-=";
    else if (ctx.StarEq) operator = "*=";
    else if (ctx.SlashEq) operator = "/=";
    else if (ctx.PercentEq) operator = "%=";

    const value = this.visit(ctx.expression[0]);
    return { operator, value };
  }

  indexerSuffix(ctx: any): ast.ASTNode[] {
    return ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : [];
  }

  // ========================================================================
  // LITERALS
  // ========================================================================
  comment(ctx: any): ast.CommentNode {
    const text = ctx.Comment[0].image;
    return this.makeNode("comment", ctx, {
      comment: text.slice(1).trim(), // Remove leading ; and trim
    });
  }

  nil(ctx: any): ast.NullNode {
    return this.makeNode("null", ctx, {
      keyword: ctx.NilKw[0].image.toLowerCase(),
    });
  }

  boolean(ctx: any): ast.BooleanNode {
    const value = !!ctx.TrueKw;
    return this.makeNode("boolean", ctx, { value });
  }

  number(ctx: any): ast.NumberNode {
    if (ctx.ComplexNumber) {
      const match = ctx.ComplexNumber[0].image;
      // Parse complex: real+imaginaryj or real-imaginaryj
      const parsed = match.match(/([+-]?[0-9.]+)([+-][0-9.]+)[ij]/i);
      return this.makeNode("complex-number", ctx, {
        match,
        real: parseFloat(parsed?.[1] || "0"),
        imaginary: parseFloat(parsed?.[2] || "0"),
      });
    }
    if (ctx.FractionNumber) {
      const match = ctx.FractionNumber[0].image;
      const [num, denom] = match.split("/");
      return this.makeNode("fraction-number", ctx, {
        match,
        numerator: parseInt(num, 10),
        denominator: parseInt(denom, 10),
      });
    }
    if (ctx.HexNumber) {
      const match = ctx.HexNumber[0].image;
      return this.makeNode("hex-number", ctx, {
        match: match.slice(2), // Remove 0x
        value: parseInt(match, 16),
      });
    }
    if (ctx.BinaryNumber) {
      const match = ctx.BinaryNumber[0].image;
      return this.makeNode("binary-number", ctx, {
        match: match.slice(2), // Remove 0b
        value: parseInt(match.slice(2), 2),
      });
    }
    if (ctx.OctalNumber) {
      const match = ctx.OctalNumber[0].image;
      return this.makeNode("octal-number", ctx, {
        match,
        value: parseInt(match, 8),
      });
    }
    if (ctx.FloatNumber) {
      const match = ctx.FloatNumber[0].image;
      return this.makeNode("float-number", ctx, {
        match,
        value: parseFloat(match),
      });
    }
    if (ctx.IntegerNumber) {
      const match = ctx.IntegerNumber[0].image;
      return this.makeNode("integer-number", ctx, {
        match,
        value: parseInt(match, 10),
      });
    }
    throw new Error("Unknown number type");
  }

  string(ctx: any): ast.ASTNode {
    if (ctx.formattedString) {
      return this.visit(ctx.formattedString[0]);
    }
    // Raw string - remove quotes
    const value = ctx.StringLiteral[0].image.slice(1, -1);
    return this.makeNode("string", ctx, { value });
  }

  formattedString(ctx: any): ast.FormattedStringNode {
    // Collect items with their positions for correct ordering
    const items: Array<{ type: "string" | "expr"; offset: number; value: any }> = [];
    if (ctx.StringContent) {
      for (const token of ctx.StringContent) {
        items.push({
          type: "string",
          offset: token.startOffset,
          value: this.unescapeString(token.image),
        });
      }
    }
    if (ctx.formatExpr) {
      for (const expr of ctx.formatExpr) {
        const firstToken = this.getFirstToken(expr);
        items.push({
          type: "expr",
          offset: firstToken?.startOffset || 0,
          value: expr,
        });
      }
    }

    // Sort by position
    items.sort((a, b) => a.offset - b.offset);

    // Fold consecutive strings (match PEG behavior)
    const folded = items.reduce((acc: any[], item) => {
      if (item.type === "string") {
        if (acc.length > 0 && typeof acc[acc.length - 1] === "string") {
          acc[acc.length - 1] += item.value;
        } else {
          acc.push(item.value);
        }
      } else {
        acc.push(item.value);
      }
      return acc;
    }, []);

    // Convert to AST nodes
    const value = folded.map((item) => {
      if (typeof item === "string") {
        return this.makeNode("string", ctx, { value: item });
      }
      return this.visit(item);
    });

    return this.makeNode("formatted-string", ctx, { value });
  }

  private unescapeString(s: string): string {
    return s
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\{/g, "{");
  }

  private getFirstToken(cst: any): any {
    if (!cst || typeof cst !== "object") return undefined;
    if ("startOffset" in cst && typeof cst.startOffset === "number") {
      return cst;
    }
    if (cst.children) {
      for (const key of Object.keys(cst.children)) {
        const children = cst.children[key];
        if (Array.isArray(children)) {
          for (const child of children) {
            const token = this.getFirstToken(child);
            if (token) return token;
          }
        }
      }
    }
    return undefined;
  }

  formatExpr(ctx: any): ast.FormatExpressionNode {
    const expression = ctx.expression ? this.visit(ctx.expression[0]) : null;
    return this.makeNode("format-expression", ctx, { expression });
  }

  // ========================================================================
  // IDENTIFIERS
  // ========================================================================
  identifier(ctx: any): ast.IdentifierNode {
    if (ctx.compositeIdentifier) {
      return this.visit(ctx.compositeIdentifier[0]);
    }
    return this.visit(ctx.simpleIdentifier[0]);
  }

  simpleIdentifier(ctx: any): ast.SimpleIdentifierNode {
    // Find which token matched
    const tokenKeys = [
      "Identifier", "Plus", "Minus", "Star", "Slash", "Percent",
      "Caret", "Equal", "Question", "Exclamation", "Tilde",
      "Pipe", "Ampersand", "LAngle", "RAngle", "LeftArrow",
      "RightArrow", "RightDoubleArrow", "EqualEq", "ExclamationEq",
      "OperatorIdent",
    ];
    // Enum member access `HttpMethod:GET` is parsed as Identifier Colon Identifier but must
    // collapse back into ONE identifier whose name carries the colon -- that is exactly what the
    // PEG produces, and what symbol resolution and codegen key off. See simpleIdentifier in
    // Parser.ts.
    if (ctx.Colon && ctx.Identifier?.length > 1) {
      return this.makeNode("simple-identifier", ctx, {
        id: ctx.Identifier.map((tok: any) => tok.image).join(":"),
      });
    }
    for (const key of tokenKeys) {
      if (ctx[key]) {
        return this.makeNode("simple-identifier", ctx, {
          id: ctx[key][0].image,
        });
      }
    }
    throw new Error(`Unknown simple identifier: ${Object.keys(ctx)}`);
  }

  compositeIdentifier(ctx: any): ast.CompositeIdentifierNode {
    const parts: string[] = [];
    // Collect all identifier parts
    if (ctx.Identifier) {
      for (const token of ctx.Identifier) {
        parts.push(token.image);
      }
    }
    const headless = !ctx.Identifier || ctx.Identifier.length === (ctx.Dot?.length || 0);
    const id = parts.join(".");
    return this.makeNode("composite-identifier", ctx, {
      id,
      headless,
      parts,
    });
  }

  // ========================================================================
  // DATA STRUCTURES
  // ========================================================================
  list(ctx: any): ast.ListNode {
    const nodes = ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : [];
    return this.makeNode("list", ctx, { nodes });
  }

  vector(ctx: any): ast.VectorNode {
    const values = ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : [];
    return this.makeNode("vector", ctx, { values });
  }

  matrix(ctx: any): ast.MatrixNode {
    const rows = ctx.matrixRow ? ctx.matrixRow.map((r: any) => this.visit(r)) : [];
    return this.makeNode("matrix", ctx, { rows });
  }

  matrixRow(ctx: any): ast.ASTNode[] {
    return ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : [];
  }

  map(ctx: any): ast.MapNode {
    const values: any[] = [];
    if (ctx.keyValue) {
      for (const kv of ctx.keyValue) {
        values.push(this.visit(kv));
      }
    }
    return this.makeNode("map", ctx, { values });
  }

  keyValue(ctx: any): ast.KeyValueNode {
    const key = this.visit(ctx.key[0]);
    const value = ctx.expression ? this.visit(ctx.expression[0]) : null;
    return this.makeNode("key-value", ctx, { key, value });
  }

  key(ctx: any): ast.ASTNode {
    if (ctx.Identifier) {
      return this.makeNode("simple-identifier", ctx, {
        id: ctx.Identifier[0].image,
      });
    }
    const value = ctx.StringLiteral[0].image.slice(1, -1);
    return this.makeNode("string", ctx, { value });
  }

  quoteExpr(ctx: any): ast.QuoteNode {
    let nodes;
    if (ctx.list) {
      // '(...)
      const listNode = this.visit(ctx.list[0]);
      nodes = listNode.nodes;
    } else {
      // 'expr
      nodes = this.visit(ctx.expression[0]);
    }
    return this.makeNode("quote", ctx, { mode: "default", nodes });
  }

  // ========================================================================
  // TYPES
  // ========================================================================
  type(ctx: any): ast.TypeNode {
    const type = this.visit(ctx.unionType[0]);
    const array = !!ctx.LBracket;
    return this.makeNode("type", ctx, { type, array });
  }

  unionType(ctx: any): ast.ASTNode {
    const types = ctx.intersectionType.map((t: any) => this.visit(t));
    if (types.length === 1) return types[0];
    return this.makeNode("union-type", ctx, { types });
  }

  intersectionType(ctx: any): ast.ASTNode {
    const types = ctx.basicType.map((t: any) => this.visit(t));
    if (types.length === 1) return types[0];
    return this.makeNode("intersection-type", ctx, { types });
  }

  basicType(ctx: any): ast.ASTNode {
    let type: any;
    if (ctx.functionType) {
      type = this.visit(ctx.functionType[0]);
    } else if (ctx.mapType) {
      type = this.visit(ctx.mapType[0]);
    } else if (ctx.genericType) {
      type = this.visit(ctx.genericType[0]);
    } else if (ctx.simpleType) {
      type = this.visit(ctx.simpleType[0]);
    } else {
      throw new Error(`Unknown basic type: ${Object.keys(ctx)}`);
    }
    const array = !!ctx.LBracket;
    return { ...type, array };
  }

  simpleType(ctx: any): ast.SimpleTypeNode {
    const name = this.visit(ctx.typeName[0]);
    return this.makeNode("simple-type", ctx, { name });
  }

  typeName(ctx: any): ast.TypeNameNode {
    const name = ctx.Identifier ? ctx.Identifier[0].image : ctx.NilKw[0].image;
    return this.makeNode("type-name", ctx, { name });
  }

  genericType(ctx: any): ast.GenericTypeNode {
    const name = this.visit(ctx.typeName[0]);
    const generics = ctx.type ? ctx.type.map((t: any) => this.visit(t)) : [];
    return this.makeNode("generic-type", ctx, { name, generics });
  }

  functionType(ctx: any): ast.FunctionTypeNode {
    const types = ctx.type ? ctx.type.map((t: any) => this.visit(t)) : [];
    const params = types.slice(0, -1);
    const ret = types.length > 0 ? types[types.length - 1] : null;
    return this.makeNode("function-type", ctx, { params, ret });
  }

  mapType(ctx: any): ast.MapTypeNode {
    const keys = ctx.keyTypeDefinition ? ctx.keyTypeDefinition.map((k: any) => this.visit(k)) : [];
    return this.makeNode("map-type", ctx, { keys });
  }

  keyTypeDefinition(ctx: any): ast.MapKeyTypeNode {
    const key = this.visit(ctx.mapKeyType[0]);
    const type = this.visit(ctx.type[0]);
    return this.makeNode("map-key-type", ctx, { key, type });
  }

  mapKeyType(ctx: any): ast.ASTNode {
    if (ctx.identifier) {
      return this.visit(ctx.identifier[0]);
    }
    const value = ctx.StringLiteral[0].image.slice(1, -1);
    return this.makeNode("string", ctx, { value });
  }

  // ========================================================================
  // MODIFIERS
  // ========================================================================
  modifier(ctx: any): ast.ModifierNode {
    // `:async` lexes its name as AsyncKw rather than Identifier -- see the modifier rule.
    const nameToken = ctx.Identifier?.[0] ?? ctx.AsyncKw?.[0];
    const modifier = nameToken.image.toLowerCase();
    const args = ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : undefined;
    return this.makeNode("modifier", ctx, { modifier, args });
  }

  // ========================================================================
  // DECLARATIONS
  // ========================================================================
  variable(ctx: any): ast.VariableNode {
    const mutable = !!ctx.MutKw;
    const modifiers = ctx.modifier ? ctx.modifier.map((m: any) => this.visit(m)) : [];
    const name = ctx.identifier ? this.visit(ctx.identifier[0]) : null;
    const type = ctx.type ? this.visit(ctx.type[0]) : null;
    const value = ctx.expression ? this.visit(ctx.expression[0]) : null;
    return this.makeNode("variable", ctx, {
      name,
      mutable,
      modifiers,
      type,
      value,
    });
  }

  functionExpr(ctx: any): ast.FunctionNode {
    const modifiers = ctx.modifier ? ctx.modifier.map((m: any) => this.visit(m)) : [];
    // PEG derives this purely from the modifiers (`async = !!modifiers.find(m => m.modifier ===
    // "async")`) -- `(fn :async f [] ...)` is the only async form the PEG has. Reading it off
    // `ctx.AsyncKw` alone meant the flag stayed false for every real async function in the corpus.
    // `ctx.AsyncKw` here is the `(async fn ...)` prefix form, which this frontend also accepts.
    const async = !!ctx.AsyncKw || modifiers.some((m: any) => m.modifier === "async");
    const name = ctx.identifier ? this.visit(ctx.identifier[0]) : null;
    const params = ctx.parameter ? ctx.parameter.map((p: any) => this.visit(p)) : [];
    const returns = ctx.type ? this.visit(ctx.type[0]) : null;
    const body = ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : [];
    const extern = modifiers.some((m: any) => m.modifier === "extern");
    return this.makeNode("function", ctx, {
      name,
      async,
      extern,
      modifiers,
      params,
      returns,
      body,
    });
  }

  parameter(ctx: any): ast.ParameterNode {
    const spread = !!ctx.Spread;
    const name = this.visit(ctx.identifier[0]);
    const modifiers = ctx.modifier ? ctx.modifier.map((m: any) => this.visit(m)) : [];
    const type = ctx.type ? this.visit(ctx.type[0]) : null;
    return this.makeNode("parameter", ctx, {
      name,
      modifiers,
      type,
      spread,
    });
  }

  classDecl(ctx: any): ast.ClassNode {
    const modifiers = ctx.modifier ? ctx.modifier.map((m: any) => this.visit(m)) : [];
    let name = null;
    let generics: any[] = [];
    if (ctx.classOrInterfaceName) {
      const nameData = this.visit(ctx.classOrInterfaceName[0]);
      name = nameData.name;
      generics = nameData.generics || [];
    }

    // Collect extends and implements
    const extendsNodes: any[] = [];
    const implementsNodes: any[] = [];
    if (ctx.ExtendsModKw && ctx.typeName) {
      // Find typeName that follows ExtendsModKw
      let typeNameIndex = 0;
      for (let i = 0; i < (ctx.ExtendsModKw?.length || 0); i++) {
        if (typeNameIndex < ctx.typeName.length) {
          extendsNodes.push(
            this.makeNode("extends", ctx, {
              type: this.visit(ctx.typeName[typeNameIndex]),
            })
          );
          typeNameIndex++;
        }
      }
    }
    if (ctx.ImplementsModKw && ctx.typeName) {
      let typeNameIndex = ctx.ExtendsModKw?.length || 0;
      for (let i = 0; i < (ctx.ImplementsModKw?.length || 0); i++) {
        if (typeNameIndex < ctx.typeName.length) {
          implementsNodes.push(
            this.makeNode("implements", ctx, {
              type: this.visit(ctx.typeName[typeNameIndex]),
            })
          );
          typeNameIndex++;
        }
      }
    }

    const body = ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : [];

    return this.makeNode("class", ctx, {
      name,
      modifiers,
      implements: implementsNodes,
      extends: extendsNodes,
      generics,
      body,
    });
  }

  classOrInterfaceName(ctx: any): { name: ast.TypeNameNode; generics: ast.TypeNameNode[] } {
    const typeNames = ctx.typeName ? ctx.typeName.map((t: any) => this.visit(t)) : [];
    const name = typeNames[0] || null;
    const generics = typeNames.slice(1);
    return { name, generics };
  }

  structDecl(ctx: any): ast.StructNode {
    const modifiers = ctx.modifier ? ctx.modifier.map((m: any) => this.visit(m)) : [];
    const name = ctx.typeName ? this.visit(ctx.typeName[0]) : null;
    const body = ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : [];
    return this.makeNode("struct", ctx, { name, modifiers, body });
  }

  enumDecl(ctx: any): ast.EnumNode {
    const modifiers = ctx.modifier ? ctx.modifier.map((m: any) => this.visit(m)) : [];
    const name = ctx.typeName ? this.visit(ctx.typeName[0]) : null;
    const body = ctx.enumKey ? ctx.enumKey.map((k: any) => this.visit(k)) : [];
    return this.makeNode("enum", ctx, { name, modifiers, body });
  }

  enumKey(ctx: any): ast.EnumKeyNode {
    const key = ctx.Identifier
      ? this.makeNode("simple-identifier", ctx, { id: ctx.Identifier[0].image })
      : this.makeNode("string", ctx, { value: ctx.StringLiteral[0].image.slice(1, -1) });
    const value = ctx.expression ? this.visit(ctx.expression[0]) : null;
    return this.makeNode("enum-key", ctx, { key, value });
  }

  interfaceDecl(ctx: any): ast.InterfaceNode {
    const modifiers = ctx.modifier ? ctx.modifier.map((m: any) => this.visit(m)) : [];
    let name = null;
    let generics = null;
    if (ctx.classOrInterfaceName) {
      const nameData = this.visit(ctx.classOrInterfaceName[0]);
      name = nameData.name;
      generics = nameData.generics.length > 0 ? nameData.generics : null;
    }
    const implementsType = ctx.typeName ? this.visit(ctx.typeName[0]) : null;
    const body = ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : [];
    return this.makeNode("interface", ctx, {
      name,
      generics,
      modifiers,
      implements: implementsType,
      body,
    });
  }

  typeDefDecl(ctx: any): ast.TypeDefNode {
    const modifiers = ctx.modifier ? ctx.modifier.map((m: any) => this.visit(m)) : [];
    const name = ctx.identifier ? this.visit(ctx.identifier[0]) : null;
    const type = ctx.type ? this.visit(ctx.type[0]) : null;
    return this.makeNode("type-def", ctx, { name, type, modifiers });
  }

  modifierDefDecl(ctx: any): ast.ModifierDefNode {
    const name = ctx.Identifier[0].image.toLowerCase();
    const params = ctx.parameter ? ctx.parameter.map((p: any) => this.visit(p)) : [];
    const body = ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : [];
    return this.makeNode("modifier-def", ctx, { name, params, body });
  }

  // ========================================================================
  // IMPORT / EXPORT
  // ========================================================================
  importExpr(ctx: any): ast.ImportNode {
    const imports = ctx.importDefinition ? ctx.importDefinition.map((d: any) => this.visit(d)) : [];
    return this.makeNode("import", ctx, { imports });
  }

  importDefinition(ctx: any): ast.ImportDefinition {
    if (ctx.importSymbols) {
      return this.visit(ctx.importSymbols[0]);
    }
    // Simple import source
    const source = this.visit(ctx.importSource[0]);
    return { source, symbols: [] } as any;
  }

  importSymbols(ctx: any): ast.ImportDefinition {
    const symbols = ctx.symbolAlias ? ctx.symbolAlias.map((s: any) => this.visit(s)) : [];
    const source = this.visit(ctx.importSource[0]);
    return { source, symbols } as any;
  }

  symbolAlias(ctx: any): ast.ImportExportAlias {
    const typeNames = ctx.typeName ? ctx.typeName.map((t: any) => this.visit(t)) : [];
    const symbol = typeNames[0];
    const as = typeNames.length > 1 ? typeNames[1] : undefined;
    return { symbol, as } as any;
  }

  importSource(ctx: any): ast.FileImportSource | ast.NamespaceImportSource {
    if (ctx.StringLiteral) {
      const file = this.makeNode("string", ctx, {
        value: ctx.StringLiteral[0].image.slice(1, -1),
      });
      return { file } as any;
    }
    const namespace = this.visit(ctx.identifier[0]);
    return { namespace } as any;
  }

  exportExpr(ctx: any): ast.ExportNode {
    const exports = ctx.exportAlias ? ctx.exportAlias.map((a: any) => this.visit(a)) : [];
    return this.makeNode("export", ctx, { exports });
  }

  exportAlias(ctx: any): ast.ImportExportAlias {
    let symbol;
    if (ctx.identifier) {
      symbol = this.visit(ctx.identifier[0]);
    } else {
      symbol = this.visit(ctx.typeName[0]);
    }
    // Check for :as alias
    let as;
    if (ctx.identifier && ctx.identifier.length > 1) {
      as = this.visit(ctx.identifier[1]);
    }
    return { symbol, as } as any;
  }

  // ========================================================================
  // CONTROL FLOW
  // ========================================================================
  whenExpr(ctx: any): ast.WhenNode {
    const expressions = ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : [];
    const condition = expressions.length > 0 ? expressions[0] : null;
    const then = expressions.slice(1);
    return this.makeNode("when", ctx, { condition, then });
  }

  ifExpr(ctx: any): ast.IfNode {
    const expressions = ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : [];
    const condition = expressions.length > 0 ? expressions[0] : null;
    const then = expressions.length > 1 ? expressions[1] : null;
    const elseThen = expressions.length > 2 ? expressions[2] : null;
    return this.makeNode("if", ctx, { condition, then, else: elseThen });
  }

  condExpr(ctx: any): ast.CondNode {
    const cases = ctx.condCase ? ctx.condCase.map((c: any) => this.visit(c)) : [];
    return this.makeNode("cond", ctx, { cases });
  }

  condCase(ctx: any): ast.CondCaseNode {
    const expressions = ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : [];
    const condition = expressions.length > 0 ? expressions[0] : null;
    const body = expressions.length > 1 ? expressions[1] : null;
    return this.makeNode("cond-case", ctx, { condition, body });
  }

  forExpr(ctx: any): ast.ForNode | ast.ForEachNode {
    // Check if this is a for-each loop
    const isForEach = !!ctx.EachModKw;
    const expressions = ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : [];

    if (isForEach) {
      const variable = ctx.identifier ? this.visit(ctx.identifier[0]) : null;
      // For for-each: expressions are [collection, then, else]
      let collection = null;
      let then = null;
      let elseThen = null;
      // The expression after :from is the collection
      // The expression after :then is the body
      // The expression after :else is the else clause
      let exprIdx = 0;
      if (ctx.FromModKw && exprIdx < expressions.length) {
        collection = expressions[exprIdx++];
      }
      if (exprIdx < expressions.length) {
        then = expressions[exprIdx++];
      }
      if (ctx.ElseModKw && exprIdx < expressions.length) {
        elseThen = expressions[exprIdx];
      }
      return this.makeNode("for-each", ctx, {
        variable,
        collection,
        then,
        else: elseThen,
      });
    }

    // Regular for loop
    let initial = null;
    let condition = null;
    let step = null;
    let then = null;
    let elseThen = null;
    // Map expressions to their roles based on modifiers present
    let exprIdx = 0;
    if (exprIdx < expressions.length) {
      initial = expressions[exprIdx++];
    }
    if (exprIdx < expressions.length) {
      condition = expressions[exprIdx++];
    }
    if (ctx.StepModKw && exprIdx < expressions.length) {
      step = expressions[exprIdx++];
    }
    if (exprIdx < expressions.length) {
      then = expressions[exprIdx++];
    }
    if (ctx.ElseModKw && exprIdx < expressions.length) {
      elseThen = expressions[exprIdx];
    }
    return this.makeNode("for", ctx, {
      initial,
      condition,
      step,
      then,
      else: elseThen,
    });
  }

  whileExpr(ctx: any): ast.WhileNode {
    const expressions = ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : [];
    const condition = expressions.length > 0 ? expressions[0] : null;
    // Multiple body expressions - wrap in list or use single
    let then = null;
    if (expressions.length > 1) {
      const bodyExprs = expressions.slice(1);
      if (bodyExprs.length === 1) {
        then = bodyExprs[0];
      } else {
        then = this.makeNode("list", ctx, { nodes: bodyExprs });
      }
    }
    return this.makeNode("while", ctx, { condition, then });
  }

  tryCatchExpr(ctx: any): ast.TryCatchNode {
    const tryBlock = ctx.expression ? this.visit(ctx.expression[0]) : null;
    const catchBlocks = ctx.catchClause ? ctx.catchClause.map((c: any) => this.visit(c)) : [];
    const finallyBlock = ctx.finallyClause ? this.visit(ctx.finallyClause[0]) : null;
    return this.makeNode("try-catch", ctx, {
      try: tryBlock,
      catch: catchBlocks,
      finally: finallyBlock,
    });
  }

  catchClause(ctx: any): ast.TryCatchFilter {
    let filter = null;
    if (ctx.catchFilter) {
      filter = this.visit(ctx.catchFilter[0]);
    }
    const body = ctx.expression ? this.visit(ctx.expression[0]) : null;
    return { filter, body } as any;
  }

  catchFilter(ctx: any): { name: ast.SimpleIdentifierNode; type: ast.TypeNameNode | null } {
    const name = this.makeNode("simple-identifier", ctx, {
      id: ctx.Identifier[0].image,
    });
    const type = ctx.typeName ? this.visit(ctx.typeName[0]) : null;
    return { name, type };
  }

  finallyClause(ctx: any): ast.ASTNode {
    return this.visit(ctx.expression[0]);
  }

  matchExpr(ctx: any): ast.MatchNode {
    const expression = this.visit(ctx.expression[0]);
    const cases = ctx.matchCase ? ctx.matchCase.map((c: any) => this.visit(c)) : [];
    return this.makeNode("match", ctx, { expression, cases });
  }

  matchCase(ctx: any): ast.MatchCaseNode {
    const pattern = this.visit(ctx.pattern[0]);
    const body = this.visit(ctx.expression[0]);
    return this.makeNode("match-case", ctx, { pattern, body });
  }

  // ========================================================================
  // PATTERNS
  // ========================================================================
  pattern(ctx: any): ast.PatternNode {
    const alternatives = [
      "anyPattern", "functionalPattern", "listPattern", "vectorPattern",
      "mapPattern", "typePattern", "constantPattern", "identifierPattern",
    ];
    for (const alt of alternatives) {
      if (ctx[alt]) {
        return this.visit(ctx[alt][0]);
      }
    }
    throw new Error(`Unknown pattern: ${Object.keys(ctx)}`);
  }

  anyPattern(ctx: any): ast.AnyPatternNode {
    return this.makeNode("any-pattern", ctx, {});
  }

  functionalPattern(ctx: any): ast.FunctionalPatternNode {
    const patterns = ctx.pattern ? ctx.pattern.map((p: any) => this.visit(p)) : [];
    const params = patterns.slice(0, -1);
    const ret = patterns.length > 0 ? patterns[patterns.length - 1] : null;
    return this.makeNode("functional-pattern", ctx, { params, ret });
  }

  typePattern(ctx: any): ast.TypePatternNode {
    const id = this.visit(ctx.identifier[0]);
    const type = this.visit(ctx.type[0]);
    return this.makeNode("type-pattern", ctx, { id, type });
  }

  listPattern(ctx: any): ast.ListPatternNode {
    const elements = ctx.pattern ? ctx.pattern.map((p: any) => this.visit(p)) : [];
    return this.makeNode("list-pattern", ctx, { elements });
  }

  vectorPattern(ctx: any): ast.VectorPatternNode {
    const elements = ctx.pattern ? ctx.pattern.map((p: any) => this.visit(p)) : [];
    return this.makeNode("vector-pattern", ctx, { elements });
  }

  mapPattern(ctx: any): ast.MapPatternNode {
    const pairs = ctx.mapPatternPair ? ctx.mapPatternPair.map((p: any) => this.visit(p)) : [];
    return this.makeNode("map-pattern", ctx, { pairs });
  }

  mapPatternPair(ctx: any): ast.MapPatternPairNode {
    const key = this.visit(ctx.key[0]);
    const pattern = this.visit(ctx.pattern[0]);
    return this.makeNode("map-pattern-pair", ctx, { key, pattern });
  }

  identifierPattern(ctx: any): ast.IdentifierPatternNode {
    const id = this.visit(ctx.identifier[0]);
    return this.makeNode("identifier-pattern", ctx, { id });
  }

  constantPattern(ctx: any): ast.ConstantPatternNode {
    let constant;
    if (ctx.StringLiteral) {
      constant = this.makeNode("string", ctx, {
        value: ctx.StringLiteral[0].image.slice(1, -1),
      });
    } else {
      constant = this.visit(ctx.number[0]);
    }
    return this.makeNode("constant-pattern", ctx, { constant });
  }

  // ========================================================================
  // OPERATORS
  // ========================================================================
  awaitExpr(ctx: any): ast.AwaitNode {
    const expression = this.visit(ctx.expression[0]);
    return this.makeNode("await", ctx, { expression });
  }

  spreadExpr(ctx: any): ast.SpreadNode {
    const expression = this.visit(ctx.expression[0]);
    return this.makeNode("spread", ctx, { expression });
  }
}
