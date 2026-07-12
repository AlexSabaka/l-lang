/**
 * l-lang Chevrotain Parser
 *
 * This parser produces a CST (Concrete Syntax Tree) that is then converted
 * to an AST by the AstBuilder.
 *
 * Key design decisions:
 * 1. Expression is the core unit - everything is an expression
 * 2. Keywords are handled before identifiers in expression alternatives
 * 3. BACKTRACK gates are used sparingly for true ambiguities
 * 4. Comments are preserved in the CST for AST reconstruction
 */
import { CstParser, CstNode, ParserMethod } from "chevrotain";
import * as t from "./tokens";

class LLangParser extends CstParser {
  program: ParserMethod<[], CstNode>;
  expression: ParserMethod<[], CstNode>;
  assignmentOrExpr: ParserMethod<[], CstNode>;
  primaryExpr: ParserMethod<[], CstNode>;
  assignmentOp: ParserMethod<[], CstNode>;
  indexerSuffix: ParserMethod<[], CstNode>;
  comment: ParserMethod<[], CstNode>;
  nil: ParserMethod<[], CstNode>;
  boolean: ParserMethod<[], CstNode>;
  number: ParserMethod<[], CstNode>;
  string: ParserMethod<[], CstNode>;
  formattedString: ParserMethod<[], CstNode>;
  formatExpr: ParserMethod<[], CstNode>;
  identifier: ParserMethod<[], CstNode>;
  simpleIdentifier: ParserMethod<[], CstNode>;
  compositeIdentifier: ParserMethod<[], CstNode>;
  list: ParserMethod<[], CstNode>;
  vector: ParserMethod<[], CstNode>;
  matrix: ParserMethod<[], CstNode>;
  matrixRow: ParserMethod<[], CstNode>;
  map: ParserMethod<[], CstNode>;
  keyValue: ParserMethod<[], CstNode>;
  key: ParserMethod<[], CstNode>;
  quoteExpr: ParserMethod<[], CstNode>;
  type: ParserMethod<[], CstNode>;
  unionType: ParserMethod<[], CstNode>;
  intersectionType: ParserMethod<[], CstNode>;
  basicType: ParserMethod<[], CstNode>;
  simpleType: ParserMethod<[], CstNode>;
  typeName: ParserMethod<[], CstNode>;
  genericType: ParserMethod<[], CstNode>;
  functionType: ParserMethod<[], CstNode>;
  mapType: ParserMethod<[], CstNode>;
  keyTypeDefinition: ParserMethod<[], CstNode>;
  mapKeyType: ParserMethod<[], CstNode>;
  modifier: ParserMethod<[], CstNode>;
  variable: ParserMethod<[], CstNode>;
  functionExpr: ParserMethod<[], CstNode>;
  parameter: ParserMethod<[], CstNode>;
  classDecl: ParserMethod<[], CstNode>;
  classOrInterfaceName: ParserMethod<[], CstNode>;
  structDecl: ParserMethod<[], CstNode>;
  enumDecl: ParserMethod<[], CstNode>;
  enumKey: ParserMethod<[], CstNode>;
  interfaceDecl: ParserMethod<[], CstNode>;
  typeDefDecl: ParserMethod<[], CstNode>;
  modifierDefDecl: ParserMethod<[], CstNode>;
  importExpr: ParserMethod<[], CstNode>;
  importDefinition: ParserMethod<[], CstNode>;
  importSymbols: ParserMethod<[], CstNode>;
  symbolAlias: ParserMethod<[], CstNode>;
  importSource: ParserMethod<[], CstNode>;
  exportExpr: ParserMethod<[], CstNode>;
  exportAlias: ParserMethod<[], CstNode>;
  whenExpr: ParserMethod<[], CstNode>;
  ifExpr: ParserMethod<[], CstNode>;
  condExpr: ParserMethod<[], CstNode>;
  condCase: ParserMethod<[], CstNode>;
  forExpr: ParserMethod<[], CstNode>;
  whileExpr: ParserMethod<[], CstNode>;
  tryCatchExpr: ParserMethod<[], CstNode>;
  catchClause: ParserMethod<[], CstNode>;
  catchFilter: ParserMethod<[], CstNode>;
  finallyClause: ParserMethod<[], CstNode>;
  matchExpr: ParserMethod<[], CstNode>;
  matchCase: ParserMethod<[], CstNode>;
  pattern: ParserMethod<[], CstNode>;
  anyPattern: ParserMethod<[], CstNode>;
  functionalPattern: ParserMethod<[], CstNode>;
  typePattern: ParserMethod<[], CstNode>;
  listPattern: ParserMethod<[], CstNode>;
  vectorPattern: ParserMethod<[], CstNode>;
  mapPattern: ParserMethod<[], CstNode>;
  mapPatternPair: ParserMethod<[], CstNode>;
  identifierPattern: ParserMethod<[], CstNode>;
  constantPattern: ParserMethod<[], CstNode>;
  awaitExpr: ParserMethod<[], CstNode>;
  spreadExpr: ParserMethod<[], CstNode>;

  constructor() {
    super(t.allTokens, {
      recoveryEnabled: false,
      nodeLocationTracking: "full",
      // Was 3, which made `new LLangParser()` take ~347 SECONDS -- paid fresh by every process,
      // since Chevrotain does not cache this across process boundaries. Measured with
      // `traceInitPerf` at maxLookahead 3:
      //
      //   Grammar Recording               6 ms
      //   Grammar Validations           275 ms
      //   ComputeLookaheadFunctions 347,071 ms   <-- 99.92% of it
      //
      // So it is NOT the grammar validations: `skipValidations: true` was measured at 349s, no
      // better, and it would have cost us the ambiguity detection that caught the quoteExpr and
      // exportAlias defects. Lookahead-automaton construction is superlinear in k, and k is the
      // only real lever here:  k=3 -> ~347s | k=2 -> 283ms | k=1 -> 25ms.
      //
      // k=2 keeps validations ON and Chevrotain still reports zero ambiguities, i.e. its own
      // static analysis says two tokens suffice for every alternation in this grammar.
      // If some future rule genuinely needs 3, override it on that ONE alternation
      // (`this.OR({ MAX_LOOKAHEAD: 3, DEF: [...] })`) rather than raising this global back to 3.
      maxLookahead: 2,
    });

    // ========================================================================
    // PROGRAM - Entry point
    // ========================================================================
    this.program = this.RULE("program", () => {
      this.MANY(() => {
        this.SUBRULE(this.expression);
      });
    });

    // ========================================================================
    // EXPRESSION - The core of the grammar
    //
    // Order matters! Keywords must come before list/identifier to avoid
    // consuming keywords as identifiers.
    // ========================================================================
    this.expression = this.RULE("expression", () => {
      this.OR([
        // Comments first
        { ALT: () => this.SUBRULE(this.comment) },
        // Import/Export declarations (keywords at top level)
        { ALT: () => this.SUBRULE(this.importExpr) },
        { ALT: () => this.SUBRULE(this.exportExpr) },
        // Variable and function declarations (let/mut/fn keywords)
        { ALT: () => this.SUBRULE(this.variable) },
        { ALT: () => this.SUBRULE(this.functionExpr) },
        // Type definitions (defclass, defstruct, defenum, definterface, deftype, defmodifier)
        { ALT: () => this.SUBRULE(this.classDecl) },
        { ALT: () => this.SUBRULE(this.structDecl) },
        { ALT: () => this.SUBRULE(this.enumDecl) },
        { ALT: () => this.SUBRULE(this.interfaceDecl) },
        { ALT: () => this.SUBRULE(this.typeDefDecl) },
        { ALT: () => this.SUBRULE(this.modifierDefDecl) },
        // Control flow (keywords: when, if, cond, for, while, try, match)
        { ALT: () => this.SUBRULE(this.whenExpr) },
        { ALT: () => this.SUBRULE(this.ifExpr) },
        { ALT: () => this.SUBRULE(this.condExpr) },
        { ALT: () => this.SUBRULE(this.forExpr) },
        { ALT: () => this.SUBRULE(this.whileExpr) },
        { ALT: () => this.SUBRULE(this.tryCatchExpr) },
        { ALT: () => this.SUBRULE(this.matchExpr) },
        // Await operator
        { ALT: () => this.SUBRULE(this.awaitExpr) },
        // Spread operator
        { ALT: () => this.SUBRULE(this.spreadExpr) },
        // Assignment or simple expression
        // This handles: identifier, identifier[idx], list, vector, map, matrix
        // with optional assignment suffix
        { ALT: () => this.SUBRULE(this.assignmentOrExpr) },
        // Quote expression
        { ALT: () => this.SUBRULE(this.quoteExpr) },
        // Literals (cannot be assigned to)
        { ALT: () => this.SUBRULE(this.nil) },
        { ALT: () => this.SUBRULE(this.boolean) },
        { ALT: () => this.SUBRULE(this.number) },
        { ALT: () => this.SUBRULE(this.string) },
      ]);
    });

    // Assignment or simple expression (handles indexers and assignments)
    this.assignmentOrExpr = this.RULE("assignmentOrExpr", () => {
      this.SUBRULE(this.primaryExpr);
      this.OPTION(() => {
        this.SUBRULE(this.assignmentOp);
      });
    });

    this.primaryExpr = this.RULE("primaryExpr", () => {
      this.OR([
        // List: ( ... )
        { ALT: () => this.SUBRULE(this.list) },
        // Matrix must come before vector (both start with [)
        { ALT: () => this.SUBRULE(this.matrix), GATE: () => this.isMatrix() },
        // Vector: [ ... ]
        { ALT: () => this.SUBRULE(this.vector) },
        // Map: { ... }
        { ALT: () => this.SUBRULE(this.map) },
        // Identifier with optional indexer
        {
          ALT: () => {
            this.SUBRULE(this.identifier);
            this.MANY(() => {
              this.SUBRULE(this.indexerSuffix);
            });
          },
        },
      ]);
    });

    this.assignmentOp = this.RULE("assignmentOp", () => {
      this.OR([
        {
          ALT: () => {
            this.CONSUME(t.ColonEq);
            this.SUBRULE(this.expression);
          },
        },
        {
          ALT: () => {
            this.CONSUME(t.PlusEq);
            this.SUBRULE2(this.expression);
          },
        },
        {
          ALT: () => {
            this.CONSUME(t.MinusEq);
            this.SUBRULE3(this.expression);
          },
        },
        {
          ALT: () => {
            this.CONSUME(t.StarEq);
            this.SUBRULE4(this.expression);
          },
        },
        {
          ALT: () => {
            this.CONSUME(t.SlashEq);
            this.SUBRULE5(this.expression);
          },
        },
        {
          ALT: () => {
            this.CONSUME(t.PercentEq);
            this.SUBRULE6(this.expression);
          },
        },
      ]);
    });

    this.indexerSuffix = this.RULE("indexerSuffix", () => {
      this.CONSUME(t.LBracket);
      this.MANY_SEP({
        SEP: t.Comma,
        DEF: () => this.SUBRULE(this.expression),
      });
      this.CONSUME(t.RBracket);
    });

    // ========================================================================
    // LITERALS
    // ========================================================================
    this.comment = this.RULE("comment", () => {
      this.CONSUME(t.Comment);
    });

    this.nil = this.RULE("nil", () => {
      this.CONSUME(t.NilKw);
    });

    this.boolean = this.RULE("boolean", () => {
      this.OR([{ ALT: () => this.CONSUME(t.TrueKw) }, { ALT: () => this.CONSUME(t.FalseKw) }]);
    });

    this.number = this.RULE("number", () => {
      this.OR([
        { ALT: () => this.CONSUME(t.ComplexNumber) },
        { ALT: () => this.CONSUME(t.FractionNumber) },
        { ALT: () => this.CONSUME(t.HexNumber) },
        { ALT: () => this.CONSUME(t.BinaryNumber) },
        { ALT: () => this.CONSUME(t.OctalNumber) },
        { ALT: () => this.CONSUME(t.FloatNumber) },
        { ALT: () => this.CONSUME(t.IntegerNumber) },
      ]);
    });

    this.string = this.RULE("string", () => {
      this.OR([
        { ALT: () => this.SUBRULE(this.formattedString) },
        { ALT: () => this.CONSUME(t.StringLiteral) },
      ]);
    });

    this.formattedString = this.RULE("formattedString", () => {
      this.CONSUME(t.FormattedStringStart);
      this.MANY(() => {
        this.OR([
          { ALT: () => this.CONSUME(t.StringContent) },
          { ALT: () => this.SUBRULE(this.formatExpr) },
        ]);
      });
      this.CONSUME(t.FormattedStringEnd);
    });

    this.formatExpr = this.RULE("formatExpr", () => {
      this.CONSUME(t.FormatExprStart);
      this.OPTION(() => {
        this.SUBRULE(this.expression);
      });
      this.CONSUME(t.FormatExprEnd);
    });

    // ========================================================================
    // IDENTIFIERS
    // ========================================================================
    this.identifier = this.RULE("identifier", () => {
      this.OR([
        { ALT: () => this.SUBRULE(this.compositeIdentifier), GATE: () => this.isCompositeIdentifier() },
        { ALT: () => this.SUBRULE(this.simpleIdentifier) },
      ]);
    });

    this.simpleIdentifier = this.RULE("simpleIdentifier", () => {
      this.OR([
        { ALT: () => this.CONSUME(t.Identifier) },
        // Allow operators as identifiers (for operator overloading)
        { ALT: () => this.CONSUME(t.Plus) },
        { ALT: () => this.CONSUME(t.Minus) },
        { ALT: () => this.CONSUME(t.Star) },
        { ALT: () => this.CONSUME(t.Slash) },
        { ALT: () => this.CONSUME(t.Percent) },
        { ALT: () => this.CONSUME(t.Caret) },
        { ALT: () => this.CONSUME(t.Equal) },
        { ALT: () => this.CONSUME(t.Question) },
        { ALT: () => this.CONSUME(t.Exclamation) },
        { ALT: () => this.CONSUME(t.Tilde) },
        { ALT: () => this.CONSUME(t.Pipe) },
        { ALT: () => this.CONSUME(t.Ampersand) },
        { ALT: () => this.CONSUME(t.LAngle) },
        { ALT: () => this.CONSUME(t.RAngle) },
        { ALT: () => this.CONSUME(t.LeftArrow) },
        { ALT: () => this.CONSUME(t.RightArrow) },
        { ALT: () => this.CONSUME(t.RightDoubleArrow) },
        { ALT: () => this.CONSUME(t.EqualEq) },
        { ALT: () => this.CONSUME(t.ExclamationEq) },
        { ALT: () => this.CONSUME(t.OperatorIdent) },
      ]);
    });

    this.compositeIdentifier = this.RULE("compositeIdentifier", () => {
      // Optional head: foo.bar or .bar (headless)
      this.OPTION(() => {
        this.CONSUME(t.Identifier);
      });
      this.AT_LEAST_ONE(() => {
        this.CONSUME(t.Dot);
        this.CONSUME2(t.Identifier);
      });
    });

    // ========================================================================
    // DATA STRUCTURES
    // ========================================================================
    this.list = this.RULE("list", () => {
      this.CONSUME(t.LParen);
      this.MANY(() => {
        this.SUBRULE(this.expression);
      });
      this.CONSUME(t.RParen);
    });

    this.vector = this.RULE("vector", () => {
      this.CONSUME(t.LBracket);
      this.MANY(() => {
        this.SUBRULE(this.expression);
        this.OPTION(() => this.CONSUME(t.Comma));
      });
      this.CONSUME(t.RBracket);
    });

    this.matrix = this.RULE("matrix", () => {
      this.CONSUME(t.LBracket);
      this.SUBRULE(this.matrixRow);
      this.AT_LEAST_ONE(() => {
        this.CONSUME(t.Pipe);
        this.SUBRULE2(this.matrixRow);
      });
      this.CONSUME(t.RBracket);
    });

    this.matrixRow = this.RULE("matrixRow", () => {
      this.AT_LEAST_ONE(() => {
        this.SUBRULE(this.expression);
        this.OPTION(() => this.CONSUME(t.Comma));
      });
    });

    this.map = this.RULE("map", () => {
      this.CONSUME(t.LBrace);
      this.MANY(() => {
        this.OR([
          { ALT: () => this.SUBRULE(this.keyValue) },
          { ALT: () => this.SUBRULE(this.comment) },
        ]);
        this.OPTION(() => this.CONSUME(t.Comma));
      });
      this.CONSUME(t.RBrace);
    });

    this.keyValue = this.RULE("keyValue", () => {
      this.CONSUME(t.Colon);
      this.SUBRULE(this.key);
      this.OPTION(() => {
        this.SUBRULE(this.expression);
      });
    });

    this.key = this.RULE("key", () => {
      this.OR([
        { ALT: () => this.CONSUME(t.Identifier) },
        { ALT: () => this.CONSUME(t.StringLiteral) },
      ]);
    });

    // Quote: 'expr or '(expr*)
    //
    // NOT in the recovered source: `list` and `expression` both derive paths starting
    // with `(` (expression -> assignmentOrExpr -> primaryExpr -> list), which Chevrotain's
    // static analysis flags as ambiguous and refuses to construct without this flag. This is
    // a genuine defect in the recovered grammar (verified: the compiled Parser.js has no GATE
    // here either) -- IGNORE_AMBIGUITIES is Chevrotain's documented mechanism for "resolve by
    // declaration order," which is what a bare OR already does at parse time; `list` (the
    // more specific case, a literal paren) is tried first, falling back to `expression`.
    this.quoteExpr = this.RULE("quoteExpr", () => {
      this.CONSUME(t.Quote);
      this.OR({
        IGNORE_AMBIGUITIES: true,
        DEF: [
          { ALT: () => this.SUBRULE(this.list) },
          { ALT: () => this.SUBRULE(this.expression) },
        ],
      });
    });

    // ========================================================================
    // TYPES
    // ========================================================================
    this.type = this.RULE("type", () => {
      this.SUBRULE(this.unionType);
      this.OPTION(() => {
        this.CONSUME(t.LBracket);
        this.CONSUME(t.RBracket);
      });
    });

    this.unionType = this.RULE("unionType", () => {
      this.SUBRULE(this.intersectionType);
      this.MANY(() => {
        this.CONSUME(t.Pipe);
        this.SUBRULE2(this.intersectionType);
      });
    });

    this.intersectionType = this.RULE("intersectionType", () => {
      this.SUBRULE(this.basicType);
      this.MANY(() => {
        this.CONSUME(t.Ampersand);
        this.SUBRULE2(this.basicType);
      });
    });

    this.basicType = this.RULE("basicType", () => {
      this.OR([
        { ALT: () => this.SUBRULE(this.functionType), GATE: () => this.isFunctionType() },
        { ALT: () => this.SUBRULE(this.mapType), GATE: () => this.LA(1)?.tokenType === t.LBrace },
        { ALT: () => this.SUBRULE(this.genericType), GATE: () => this.isGenericType() },
        { ALT: () => this.SUBRULE(this.simpleType) },
      ]);
      this.OPTION(() => {
        this.CONSUME(t.LBracket);
        this.CONSUME(t.RBracket);
      });
    });

    this.simpleType = this.RULE("simpleType", () => {
      this.SUBRULE(this.typeName);
    });

    this.typeName = this.RULE("typeName", () => {
      this.OR([
        { ALT: () => this.CONSUME(t.Identifier) },
        { ALT: () => this.CONSUME(t.NilKw) },
      ]);
    });

    this.genericType = this.RULE("genericType", () => {
      this.SUBRULE(this.typeName);
      this.CONSUME(t.LAngle);
      this.MANY_SEP({
        SEP: t.Comma,
        DEF: () => this.SUBRULE(this.type),
      });
      this.CONSUME(t.RAngle);
    });

    this.functionType = this.RULE("functionType", () => {
      this.OPTION(() => {
        this.CONSUME(t.AsyncKw);
      });
      this.CONSUME(t.FnKw);
      this.CONSUME(t.LBracket);
      this.MANY(() => {
        this.SUBRULE(this.type);
      });
      this.CONSUME(t.RBracket);
      this.CONSUME(t.RightArrow);
      this.SUBRULE2(this.type);
    });

    this.mapType = this.RULE("mapType", () => {
      this.CONSUME(t.LBrace);
      this.MANY_SEP({
        SEP: t.Comma,
        DEF: () => this.SUBRULE(this.keyTypeDefinition),
      });
      this.CONSUME(t.RBrace);
    });

    this.keyTypeDefinition = this.RULE("keyTypeDefinition", () => {
      this.CONSUME(t.Colon);
      this.SUBRULE(this.mapKeyType);
      this.CONSUME(t.LeftArrow);
      this.SUBRULE(this.type);
    });

    this.mapKeyType = this.RULE("mapKeyType", () => {
      this.OR([
        { ALT: () => this.SUBRULE(this.identifier) },
        { ALT: () => this.CONSUME(t.StringLiteral) },
      ]);
    });

    // ========================================================================
    // MODIFIERS (like :public, :private, :ctor, etc.)
    // ========================================================================
    this.modifier = this.RULE("modifier", () => {
      this.CONSUME(t.Colon);
      this.CONSUME(t.Identifier);
      this.OPTION(() => {
        this.CONSUME(t.LBracket);
        this.MANY_SEP({
          SEP: t.Comma,
          DEF: () => this.SUBRULE(this.expression),
        });
        this.CONSUME(t.RBracket);
      });
    });

    // ========================================================================
    // DECLARATIONS
    // ========================================================================
    // Variable: (let|mut) :modifiers? name? <- Type? value?
    this.variable = this.RULE("variable", () => {
      this.OR([{ ALT: () => this.CONSUME(t.LetKw) }, { ALT: () => this.CONSUME(t.MutKw) }]);
      this.MANY(() => {
        this.SUBRULE(this.modifier);
      });
      this.OPTION(() => {
        this.SUBRULE(this.identifier);
      });
      this.OPTION2(() => {
        this.CONSUME(t.LeftArrow);
        this.SUBRULE(this.type);
      });
      this.OPTION3(() => {
        this.SUBRULE(this.expression);
      });
    });

    // Function: (async)? fn :modifiers? name? [params] (-> Type)? body*
    this.functionExpr = this.RULE("functionExpr", () => {
      this.OPTION(() => {
        this.CONSUME(t.AsyncKw);
      });
      this.CONSUME(t.FnKw);
      this.MANY(() => {
        this.SUBRULE(this.modifier);
      });
      this.OPTION2(() => {
        this.SUBRULE(this.identifier);
      });
      this.CONSUME(t.LBracket);
      this.MANY2(() => {
        this.SUBRULE(this.parameter);
        this.OPTION3(() => this.CONSUME(t.Comma));
      });
      this.CONSUME(t.RBracket);
      this.OPTION4(() => {
        this.CONSUME(t.RightArrow);
        this.SUBRULE(this.type);
      });
      this.MANY3(() => {
        this.SUBRULE(this.expression);
      });
    });

    this.parameter = this.RULE("parameter", () => {
      this.OPTION(() => {
        this.CONSUME(t.Spread);
      });
      this.SUBRULE(this.identifier);
      this.MANY(() => {
        this.SUBRULE(this.modifier);
      });
      this.OPTION2(() => {
        this.CONSUME(t.LeftArrow);
        this.SUBRULE(this.type);
      });
    });

    // defclass Name<Generics>? :extends Type :implements Type body*
    this.classDecl = this.RULE("classDecl", () => {
      this.CONSUME(t.DefClassKw);
      this.MANY(() => {
        this.SUBRULE(this.modifier);
      });
      this.OPTION(() => {
        this.SUBRULE(this.classOrInterfaceName);
      });
      this.MANY2(() => {
        this.OR([
          {
            ALT: () => {
              this.CONSUME(t.ExtendsModKw);
              this.SUBRULE(this.typeName);
            },
          },
          {
            ALT: () => {
              this.CONSUME(t.ImplementsModKw);
              this.SUBRULE2(this.typeName);
            },
          },
        ]);
      });
      this.MANY3(() => {
        this.SUBRULE(this.expression);
      });
    });

    this.classOrInterfaceName = this.RULE("classOrInterfaceName", () => {
      this.SUBRULE(this.typeName);
      this.OPTION(() => {
        this.CONSUME(t.LAngle);
        this.AT_LEAST_ONE_SEP({
          SEP: t.Comma,
          DEF: () => this.SUBRULE2(this.typeName),
        });
        this.CONSUME(t.RAngle);
      });
    });

    // defstruct Name :modifiers? body*
    this.structDecl = this.RULE("structDecl", () => {
      this.CONSUME(t.DefStructKw);
      this.MANY(() => {
        this.SUBRULE(this.modifier);
      });
      this.OPTION(() => {
        this.SUBRULE(this.typeName);
      });
      this.MANY2(() => {
        this.SUBRULE(this.expression);
      });
    });

    // defenum Name :modifiers? (:key => value)*
    this.enumDecl = this.RULE("enumDecl", () => {
      this.CONSUME(t.DefEnumKw);
      this.MANY(() => {
        this.SUBRULE(this.modifier);
      });
      this.OPTION(() => {
        this.SUBRULE(this.typeName);
      });
      this.MANY2(() => {
        this.OR([
          { ALT: () => this.SUBRULE(this.enumKey) },
          { ALT: () => this.SUBRULE(this.comment) },
        ]);
      });
    });

    this.enumKey = this.RULE("enumKey", () => {
      this.CONSUME(t.Colon);
      this.OR([
        { ALT: () => this.CONSUME(t.Identifier) },
        { ALT: () => this.CONSUME(t.StringLiteral) },
      ]);
      this.OPTION(() => {
        this.CONSUME(t.RightDoubleArrow);
        this.SUBRULE(this.expression);
      });
    });

    // definterface Name<Generics>? :implements Type body*
    this.interfaceDecl = this.RULE("interfaceDecl", () => {
      this.CONSUME(t.DefInterfaceKw);
      this.MANY(() => {
        this.SUBRULE(this.modifier);
      });
      this.OPTION(() => {
        this.SUBRULE(this.classOrInterfaceName);
      });
      this.OPTION2(() => {
        this.CONSUME(t.ImplementsModKw);
        this.SUBRULE(this.typeName);
      });
      this.MANY2(() => {
        this.SUBRULE(this.expression);
      });
    });

    // deftype name Type
    this.typeDefDecl = this.RULE("typeDefDecl", () => {
      this.CONSUME(t.DefTypeKw);
      this.MANY(() => {
        this.SUBRULE(this.modifier);
      });
      this.OPTION(() => {
        this.SUBRULE(this.identifier);
      });
      this.OPTION2(() => {
        this.SUBRULE(this.type);
      });
    });

    // defmodifier name [params] body*
    this.modifierDefDecl = this.RULE("modifierDefDecl", () => {
      this.CONSUME(t.DefModifierKw);
      this.CONSUME(t.Identifier);
      this.OPTION(() => {
        this.CONSUME(t.LBracket);
        this.MANY_SEP({
          SEP: t.Comma,
          DEF: () => this.SUBRULE(this.parameter),
        });
        this.CONSUME(t.RBracket);
      });
      this.MANY(() => {
        this.SUBRULE(this.expression);
      });
    });

    // ========================================================================
    // IMPORT / EXPORT
    // ========================================================================
    // import "file.lisp" | module.namespace | { symbols } from source
    this.importExpr = this.RULE("importExpr", () => {
      this.CONSUME(t.ImportKw);
      this.AT_LEAST_ONE_SEP({
        SEP: t.Comma,
        DEF: () => this.SUBRULE(this.importDefinition),
      });
    });

    this.importDefinition = this.RULE("importDefinition", () => {
      this.OR([
        { ALT: () => this.SUBRULE(this.importSymbols) },
        { ALT: () => this.SUBRULE(this.importSource) },
      ]);
    });

    this.importSymbols = this.RULE("importSymbols", () => {
      this.CONSUME(t.LBrace);
      this.MANY_SEP({
        SEP: t.Comma,
        DEF: () => this.SUBRULE(this.symbolAlias),
      });
      this.CONSUME(t.RBrace);
      this.CONSUME(t.FromKw);
      this.SUBRULE(this.importSource);
    });

    this.symbolAlias = this.RULE("symbolAlias", () => {
      this.SUBRULE(this.typeName);
      this.OPTION(() => {
        this.CONSUME(t.AsModKw);
        this.SUBRULE2(this.typeName);
      });
    });

    this.importSource = this.RULE("importSource", () => {
      this.OR([
        { ALT: () => this.CONSUME(t.StringLiteral) },
        { ALT: () => this.SUBRULE(this.identifier) },
      ]);
    });

    // export symbol :as alias, ...
    this.exportExpr = this.RULE("exportExpr", () => {
      this.CONSUME(t.ExportKw);
      this.AT_LEAST_ONE_SEP({
        SEP: t.Comma,
        DEF: () => this.SUBRULE(this.exportAlias),
      });
    });

    this.exportAlias = this.RULE("exportAlias", () => {
      // Same class of pre-existing ambiguity as quoteExpr above: `identifier` and `typeName`
      // both accept a bare Identifier token as their first alternative. Declaration order
      // (identifier first) matches the original's intent.
      this.OR({
        IGNORE_AMBIGUITIES: true,
        DEF: [
          { ALT: () => this.SUBRULE(this.identifier) },
          { ALT: () => this.SUBRULE(this.typeName) },
        ],
      });
      this.OPTION(() => {
        this.CONSUME(t.AsModKw);
        this.SUBRULE2(this.identifier);
      });
    });

    // ========================================================================
    // CONTROL FLOW
    // ========================================================================
    // when :cond? condition :then? then*
    this.whenExpr = this.RULE("whenExpr", () => {
      this.CONSUME(t.WhenKw);
      this.OPTION(() => {
        this.OPTION2(() => this.CONSUME(t.CondModKw));
        this.SUBRULE(this.expression);
      });
      this.OPTION3(() => {
        this.OPTION4(() => this.CONSUME(t.ThenModKw));
        this.MANY(() => {
          this.SUBRULE2(this.expression);
        });
      });
    });

    // if :cond? condition :then? then :else? else
    this.ifExpr = this.RULE("ifExpr", () => {
      this.CONSUME(t.IfKw);
      this.OPTION(() => {
        this.OPTION2(() => this.CONSUME(t.CondModKw));
        this.SUBRULE(this.expression);
      });
      this.OPTION3(() => {
        this.OPTION4(() => this.CONSUME(t.ThenModKw));
        this.SUBRULE2(this.expression);
      });
      this.OPTION5(() => {
        this.OPTION6(() => this.CONSUME(t.ElseModKw));
        this.SUBRULE3(this.expression);
      });
    });

    // cond (condition body)+
    this.condExpr = this.RULE("condExpr", () => {
      this.CONSUME(t.CondKw);
      this.AT_LEAST_ONE(() => {
        this.SUBRULE(this.condCase);
      });
    });

    this.condCase = this.RULE("condCase", () => {
      this.CONSUME(t.LParen);
      this.OPTION(() => {
        this.OPTION2(() => this.CONSUME(t.CondModKw));
        this.SUBRULE(this.expression);
      });
      this.OPTION3(() => {
        this.OPTION4(() => this.CONSUME(t.ThenModKw));
        this.SUBRULE2(this.expression);
      });
      this.CONSUME(t.RParen);
    });

    // for :init init :each var :cond cond :from collection :step step :then then :else else
    this.forExpr = this.RULE("forExpr", () => {
      this.CONSUME(t.ForKw);
      // :init expression (for regular for)
      this.OPTION(() => {
        this.OPTION2(() => this.CONSUME(t.InitModKw));
        this.SUBRULE(this.expression);
      });
      // :each identifier (for for-each)
      this.OPTION3(() => {
        this.CONSUME(t.EachModKw);
        this.SUBRULE(this.identifier);
      });
      // :cond expression
      this.OPTION4(() => {
        this.OPTION5(() => this.CONSUME(t.CondModKw));
        this.SUBRULE2(this.expression);
      });
      // :from expression (collection for for-each)
      this.OPTION6(() => {
        this.CONSUME(t.FromModKw);
        this.SUBRULE3(this.expression);
      });
      // :step expression
      this.OPTION7(() => {
        this.CONSUME(t.StepModKw);
        this.SUBRULE4(this.expression);
      });
      // :then expression
      this.OPTION8(() => {
        this.OPTION9(() => this.CONSUME(t.ThenModKw));
        this.SUBRULE5(this.expression);
      });
      // :else expression
      // this.OPTION10(() => {
      //   this.CONSUME(t.ElseModKw);
      //   this.SUBRULE6(this.expression);
      // });
    });

    // while :cond? condition :then? then*
    this.whileExpr = this.RULE("whileExpr", () => {
      this.CONSUME(t.WhileKw);
      this.OPTION(() => {
        this.OPTION2(() => this.CONSUME(t.CondModKw));
        this.SUBRULE(this.expression);
      });
      this.OPTION3(() => {
        this.OPTION4(() => this.CONSUME(t.ThenModKw));
        this.MANY(() => {
          this.SUBRULE2(this.expression);
        });
      });
    });

    // try expression catch* finally?
    this.tryCatchExpr = this.RULE("tryCatchExpr", () => {
      this.CONSUME(t.TryKw);
      this.OPTION(() => {
        this.SUBRULE(this.expression);
      });
      this.MANY(() => {
        this.SUBRULE(this.catchClause);
      });
      this.OPTION2(() => {
        this.SUBRULE(this.finallyClause);
      });
    });

    this.catchClause = this.RULE("catchClause", () => {
      this.CONSUME(t.CatchKw);
      this.OPTION(() => {
        this.SUBRULE(this.catchFilter);
      });
      this.OPTION2(() => {
        this.SUBRULE(this.expression);
      });
    });

    this.catchFilter = this.RULE("catchFilter", () => {
      this.CONSUME(t.Identifier);
      this.OPTION(() => {
        this.CONSUME(t.OfModKw);
        this.SUBRULE(this.typeName);
      });
    });

    this.finallyClause = this.RULE("finallyClause", () => {
      this.CONSUME(t.FinallyKw);
      this.SUBRULE(this.expression);
    });

    // match expression { cases }
    this.matchExpr = this.RULE("matchExpr", () => {
      this.CONSUME(t.MatchKw);
      this.SUBRULE(this.expression);
      this.CONSUME(t.LBrace);
      this.AT_LEAST_ONE(() => {
        this.SUBRULE(this.matchCase);
      });
      this.CONSUME(t.RBrace);
    });

    this.matchCase = this.RULE("matchCase", () => {
      this.SUBRULE(this.pattern);
      this.CONSUME(t.RightDoubleArrow);
      this.SUBRULE(this.expression);
    });

    // ========================================================================
    // PATTERNS
    // ========================================================================
    this.pattern = this.RULE("pattern", () => {
      this.OR([
        { ALT: () => this.SUBRULE(this.anyPattern) },
        { ALT: () => this.SUBRULE(this.functionalPattern), GATE: () => this.isFunctionalPattern() },
        { ALT: () => this.SUBRULE(this.listPattern) },
        { ALT: () => this.SUBRULE(this.vectorPattern) },
        { ALT: () => this.SUBRULE(this.mapPattern) },
        { ALT: () => this.SUBRULE(this.typePattern), GATE: () => this.isTypePattern() },
        { ALT: () => this.SUBRULE(this.constantPattern), GATE: () => this.isConstantPattern() },
        { ALT: () => this.SUBRULE(this.identifierPattern) },
      ]);
    });

    this.anyPattern = this.RULE("anyPattern", () => {
      this.CONSUME(t.Underscore);
    });

    this.functionalPattern = this.RULE("functionalPattern", () => {
      this.CONSUME(t.LParen);
      this.MANY(() => {
        this.SUBRULE(this.pattern);
      });
      this.CONSUME(t.RParen);
      this.CONSUME(t.RightArrow);
      this.SUBRULE2(this.pattern);
    });

    this.typePattern = this.RULE("typePattern", () => {
      this.SUBRULE(this.identifier);
      this.CONSUME(t.OfModKw);
      this.SUBRULE(this.type);
    });

    this.listPattern = this.RULE("listPattern", () => {
      this.CONSUME(t.LParen);
      this.MANY(() => {
        this.SUBRULE(this.pattern);
      });
      this.CONSUME(t.RParen);
    });

    this.vectorPattern = this.RULE("vectorPattern", () => {
      this.CONSUME(t.LBracket);
      this.MANY(() => {
        this.SUBRULE(this.pattern);
      });
      this.CONSUME(t.RBracket);
    });

    this.mapPattern = this.RULE("mapPattern", () => {
      this.CONSUME(t.LBrace);
      this.MANY(() => {
        this.SUBRULE(this.mapPatternPair);
        this.OPTION(() => this.CONSUME(t.Comma));
      });
      this.CONSUME(t.RBrace);
    });

    this.mapPatternPair = this.RULE("mapPatternPair", () => {
      this.CONSUME(t.Colon);
      this.SUBRULE(this.key);
      this.SUBRULE(this.pattern);
    });

    this.identifierPattern = this.RULE("identifierPattern", () => {
      this.SUBRULE(this.identifier);
    });

    this.constantPattern = this.RULE("constantPattern", () => {
      this.OR([
        { ALT: () => this.CONSUME(t.StringLiteral) },
        { ALT: () => this.SUBRULE(this.number) },
      ]);
    });

    // ========================================================================
    // OPERATORS
    // ========================================================================
    this.awaitExpr = this.RULE("awaitExpr", () => {
      this.CONSUME(t.AwaitKw);
      this.SUBRULE(this.expression);
    });

    this.spreadExpr = this.RULE("spreadExpr", () => {
      this.CONSUME(t.Spread);
      this.SUBRULE(this.expression);
    });

    this.performSelfAnalysis();
  }

  // Lookahead to detect if this is a matrix (contains |)
  private isMatrix(): boolean {
    let depth = 0;
    let i = 1;
    while (i < 100) {
      // Safety limit
      const token = this.LA(i);
      if (!token || (token.tokenType === t.RBracket && depth === 0)) break;
      if (token.tokenType === t.LBracket) depth++;
      if (token.tokenType === t.RBracket) depth--;
      if (token.tokenType === t.Pipe && depth === 0) return true;
      i++;
    }
    return false;
  }

  private isCompositeIdentifier(): boolean {
    // Check if we have Identifier.Identifier pattern or .Identifier (headless)
    const first = this.LA(1);
    const second = this.LA(2);
    if (first?.tokenType === t.Dot) return true; // Headless: .foo
    if (first?.tokenType === t.Identifier && second?.tokenType === t.Dot) return true;
    return false;
  }

  private isFunctionType(): boolean {
    const first = this.LA(1);
    return first?.tokenType === t.FnKw || first?.tokenType === t.AsyncKw;
  }

  private isGenericType(): boolean {
    // TypeName<...>
    const first = this.LA(1);
    const second = this.LA(2);
    return first?.tokenType === t.Identifier && second?.tokenType === t.LAngle;
  }

  private isFunctionalPattern(): boolean {
    // ( patterns* ) -> pattern
    // Need to look for -> after closing paren
    let depth = 0;
    let i = 1;
    const first = this.LA(1);
    if (first?.tokenType !== t.LParen) return false;
    while (i < 50) {
      const token = this.LA(i);
      if (!token) break;
      if (token.tokenType === t.LParen) depth++;
      if (token.tokenType === t.RParen) {
        depth--;
        if (depth === 0) {
          const next = this.LA(i + 1);
          return next?.tokenType === t.RightArrow;
        }
      }
      i++;
    }
    return false;
  }

  private isTypePattern(): boolean {
    // identifier :of type
    const first = this.LA(1);
    const second = this.LA(2);
    return first?.tokenType === t.Identifier && second?.tokenType === t.OfModKw;
  }

  private isConstantPattern(): boolean {
    const first = this.LA(1);
    return (
      first?.tokenType === t.StringLiteral ||
      first?.tokenType === t.IntegerNumber ||
      first?.tokenType === t.FloatNumber ||
      first?.tokenType === t.HexNumber ||
      first?.tokenType === t.BinaryNumber ||
      first?.tokenType === t.OctalNumber ||
      first?.tokenType === t.FractionNumber ||
      first?.tokenType === t.ComplexNumber
    );
  }
}

export const parser = new LLangParser();
