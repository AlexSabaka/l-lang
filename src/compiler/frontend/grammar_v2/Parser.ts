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
  memberSuffix: ParserMethod<[], CstNode>;
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
  tupleType: ParserMethod<[], CstNode>;
  modifier: ParserMethod<[], CstNode>;
  variable: ParserMethod<[], CstNode>;
  functionExpr: ParserMethod<[], CstNode>;
  parameter: ParserMethod<[], CstNode>;
  classDecl: ParserMethod<[], CstNode>;
  classOrInterfaceName: ParserMethod<[], CstNode>;
  genericParam: ParserMethod<[], CstNode>;
  typeRef: ParserMethod<[], CstNode>;
  structDecl: ParserMethod<[], CstNode>;
  enumDecl: ParserMethod<[], CstNode>;
  enumKey: ParserMethod<[], CstNode>;
  interfaceDecl: ParserMethod<[], CstNode>;
  typeDefDecl: ParserMethod<[], CstNode>;
  modifierDefDecl: ParserMethod<[], CstNode>;
  macroDecl: ParserMethod<[], CstNode>;
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
  forClause: ParserMethod<[], CstNode>;
  forEachBinding: ParserMethod<[], CstNode>;
  whileExpr: ParserMethod<[], CstNode>;
  tryCatchExpr: ParserMethod<[], CstNode>;
  catchClause: ParserMethod<[], CstNode>;
  catchFilter: ParserMethod<[], CstNode>;
  finallyClause: ParserMethod<[], CstNode>;
  // D47 conditions/restarts (each form CONSUMEs only its keyword; the enclosing `list` supplies parens).
  restartCaseExpr: ParserMethod<[], CstNode>;
  restartArm: ParserMethod<[], CstNode>;
  handleExpr: ParserMethod<[], CstNode>;
  handleClause: ParserMethod<[], CstNode>;
  signalExpr: ParserMethod<[], CstNode>;
  invokeRestartExpr: ParserMethod<[], CstNode>;
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
  restPattern: ParserMethod<[], CstNode>;
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
        { ALT: () => this.SUBRULE(this.macroDecl) },
        // Control flow (keywords: when, if, cond, for, while, try, match)
        { ALT: () => this.SUBRULE(this.whenExpr) },
        { ALT: () => this.SUBRULE(this.ifExpr) },
        { ALT: () => this.SUBRULE(this.condExpr) },
        { ALT: () => this.SUBRULE(this.forExpr) },
        { ALT: () => this.SUBRULE(this.whileExpr) },
        { ALT: () => this.SUBRULE(this.tryCatchExpr) },
        // D47 conditions/restarts -- each leads with a distinct keyword, so k=1 disambiguates.
        { ALT: () => this.SUBRULE(this.restartCaseExpr) },
        { ALT: () => this.SUBRULE(this.handleExpr) },
        { ALT: () => this.SUBRULE(this.signalExpr) },
        { ALT: () => this.SUBRULE(this.invokeRestartExpr) },
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
        // An identifier followed by a SUFFIX CHAIN: `xs[0]`, `xs[0].name`, `m.rows[0][1].v`.
        //
        // The loop used to accept only `[...]`, so `.name` fell out of it and was parsed as a
        // HEADLESS composite-identifier -- `.bar` is a legal form (05_matching.lisp pipes with
        // `(.apply evt)`) -- which made it a separate argument. `xs[0].name` emitted
        // `console.log(xs[0], name)`: the `.name` silently LOST, and a ReferenceError at run time
        // with no diagnostic, because `name` is a perfectly good identifier that resolves to nothing.
        //
        // The GATEs are load-bearing, and adjacency is exactly the right discriminator for BOTH
        // suffixes: `xs [0]` (spaced) is an identifier and a vector, `xs[0]` is an index; `foo .bar`
        // (spaced) is an identifier and a headless member-ref, `foo.bar` is one name.
        {
          ALT: () => {
            this.SUBRULE(this.identifier);
            this.MANY({
              GATE: () => this.isAdjacentLBracket() || this.isAdjacentDot(),
              DEF: () =>
                this.OR2([
                  {
                    GATE: () => this.LA(1)?.tokenType === t.LBracket,
                    ALT: () => this.SUBRULE(this.indexerSuffix),
                  },
                  { ALT: () => this.SUBRULE(this.memberSuffix) },
                ]),
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

    // PEG: ("[" @Expression|1.., ","?| "]") -- at least one index, comma optional.
    /**
     * `.name` after an index or another member. NOT the same thing as `a.b`, which the lexer-level
     * `compositeIdentifier` rule consumes whole -- this is the suffix that can follow a `[...]`.
     */
    this.memberSuffix = this.RULE("memberSuffix", () => {
      this.CONSUME(t.Dot);
      // Same rule as compositeIdentifier's tail: after a dot, a name is data. `xs[0].from` must read
      // the field, not report that `from` is a clause.
      this.OR([
        { ALT: () => this.CONSUME(t.Identifier) },
        { ALT: () => this.CONSUME(t.BareKeyword) },
      ]);
    });

    this.indexerSuffix = this.RULE("indexerSuffix", () => {
      this.CONSUME(t.LBracket);
      this.AT_LEAST_ONE(() => {
        this.SUBRULE(this.expression);
        this.OPTION(() => this.CONSUME(t.Comma));
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
        {
          ALT: () => {
            this.CONSUME(t.Identifier);
            // Enum member access: `HttpMethod:GET`. The PEG lexes this as a SINGLE identifier
            // (`:` is in its `Control` char class), so the name literally carries the colon and
            // symbol resolution / codegen key off the string "HttpMethod:GET". Reproduce that
            // exactly rather than inventing a qualified-access node no downstream pass reads.
            //
            // Adjacency-gated: `HttpMethod:GET` has no spaces, whereas a modifier (`(let :ctor x)`)
            // or a map key (`{:name "Alice"}`) always has whitespace before its colon. Without the
            // gate this would swallow those.
            this.OPTION({
              GATE: () => this.isAdjacentQualifier(),
              DEF: () => {
                this.CONSUME(t.Colon);
                this.CONSUME2(t.Identifier);
              },
            });
          },
        },
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
        // AFTER A DOT, A NAME IS DATA. `m.from` is a field read, not a `from` clause -- the member
        // half of AF-044. Writing `{:from "src"}` is worthless if `m.from` cannot read it back, so
        // the key fix and this one are one change.
        //
        // Only the TAIL accepts a keyword; the HEAD above stays an Identifier, because a head is a
        // binding and `from` is not a legal variable name.
        this.OR([
          { ALT: () => this.CONSUME2(t.Identifier) },
          { ALT: () => this.CONSUME(t.BareKeyword) },
        ]);
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
      // `(x :of String)` -- a TYPE GUARD in expression position (D41). `:of` is the ruled spelling for
      // "is this value a T" (D27), and this is the same question a match arm asks, asked where a value
      // is wanted.
      //
      // An OPTION on the list rather than its own gated alternative, because the guarded expression is
      // arbitrary -- `((get xs i) :of Dog)` -- and no fixed lookahead can see past it to the `:of`.
      // The builder enforces the shape (exactly one expression before `:of`); the grammar only has to
      // let the token in.
      this.OPTION(() => {
        this.CONSUME(t.OfModKw);
        this.SUBRULE(this.type);
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

    // The GATE mirrors the PEG's `(!"|" @Expression)*` -- a row must NOT swallow its own
    // separator. simpleIdentifier accepts operators (including Pipe) as identifiers, so without
    // this the row eats the `|`, and then matrix's AT_LEAST_ONE(CONSUME(Pipe)) finds none.
    this.matrixRow = this.RULE("matrixRow", () => {
      this.AT_LEAST_ONE({
        GATE: () => {
          const la = this.LA(1)?.tokenType;
          return la !== t.Pipe && la !== t.RBracket;
        },
        DEF: () => {
          this.SUBRULE(this.expression);
          this.OPTION(() => this.CONSUME(t.Comma));
        },
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

    /**
     * `{ :name "x" }` -- the colon form -- and `{ "host" "localhost" }` -- a bare STRING key.
     *
     * Only the colon form existed, so `{"host" "localhost"}` was a parse error. That, not codegen, is
     * what actually blocked 04-data-types/02_maps.lisp: its old xfail blamed a "D13 map-key codegen
     * crash", but D13's codegen half was fixed in P5b and the file never reached codegen at all.
     *
     * A string key needs no colon to be unambiguous. The colon exists to let a BARE IDENTIFIER be a
     * key -- `:name` rather than `name`, which would read as a variable reference. A string literal
     * is already unmistakably a key.
     */
    this.keyValue = this.RULE("keyValue", () => {
      this.OR([
        {
          ALT: () => {
            this.CONSUME(t.Colon);
            this.SUBRULE(this.key);
            this.OPTION(() => {
              this.SUBRULE(this.expression);
            });
          },
        },
        {
          // A MODIFIER keyword key -- `{:step 1}`, `{:from "src"}`.
          //
          // These lex as ONE token with the colon INSIDE it (`:step` -> StepModKw), so the branch
          // above cannot see a `Colon` to consume and the whole map failed to parse (AF-044). A map
          // key is data (D13), and `{:step 1}` is a step COUNT -- the grammar of `for` has no
          // business reaching into an object literal.
          ALT: () => {
            this.CONSUME(t.ModKeyword);
            this.OPTION2(() => {
              this.SUBRULE2(this.expression);
            });
          },
        },
        {
          ALT: () => {
            this.SUBRULE(this.string);
            this.SUBRULE3(this.expression);
          },
        },
      ]);
    });

    this.key = this.RULE("key", () => {
      this.OR([
        { ALT: () => this.CONSUME(t.Identifier) },
        { ALT: () => this.CONSUME(t.StringLiteral) },
        // A BARE keyword key -- `{:mut 1}`, `{:fn 2}`, `{:true 3}`.
        //
        // The colon is a separate token for these, so the Colon branch above already matched; it is
        // only the NAME that the lexer had claimed as a keyword. `{:name 1}` worked and `{:fn 1}`
        // did not, purely because `fn` happens to be a token and `name` does not -- which is a fact
        // about the lexer leaking into what a user may call a field.
        { ALT: () => this.CONSUME(t.BareKeyword) },
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
      this.OR([
        {
          // Parenthesized type -- the PEG's second Type alternative:
          //   "(" _ type:UnionType _ ")" _ array:"[]"?
          // Missing here entirely, so `(deftype Expr (Int | String | Expr)[])` produced a
          // deftype with a NULL type, and the type pass then crashed dereferencing it.
          GATE: () => this.LA(1)?.tokenType === t.LParen,
          ALT: () => {
            this.CONSUME(t.LParen);
            this.SUBRULE(this.unionType);
            this.CONSUME(t.RParen);
            this.OPTION({
              GATE: () => this.isAdjacentLBracket(),
              DEF: () => {
                this.CONSUME(t.LBracket);
                this.CONSUME(t.RBracket);
              },
            });
            // `(Int | String)?` -- optionality on a parenthesized type, OUTSIDE any array suffix.
            this.OPTION3({
              GATE: () => this.isAdjacentQuestion(),
              DEF: () => this.CONSUME(t.Question),
            });
          },
        },
        {
          ALT: () => {
            this.SUBRULE2(this.unionType);
            // Array-type suffix `Expr[]`. Same adjacency rule as the indexer: the `[` must butt
            // directly against the type. Without the GATE, `(let program <- Expr ["+" 10])`
            // reads the vector VALUE as an array-type suffix on `Expr` and dies on the `"+"`.
            this.OPTION2({
              GATE: () => this.isAdjacentLBracket(),
              DEF: () => {
                this.CONSUME2(t.LBracket);
                this.CONSUME2(t.RBracket);
              },
            });
            // `Int | String?` -- optionality on the whole union.
            this.OPTION4({
              GATE: () => this.isAdjacentQuestion(),
              DEF: () => this.CONSUME2(t.Question),
            });
          },
        },
      ]);
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
        // A TUPLE type: a LEADING `[` (the array suffix `Int[]` is postfix and never starts a type).
        { ALT: () => this.SUBRULE(this.tupleType), GATE: () => this.LA(1)?.tokenType === t.LBracket },
        { ALT: () => this.SUBRULE(this.genericType), GATE: () => this.isGenericType() },
        { ALT: () => this.SUBRULE(this.simpleType) },
      ]);
      // Array-type suffix, same adjacency rule as in `type` above -- this is the inner of the
      // two sites, and the one that actually fires first.
      this.OPTION({
        GATE: () => this.isAdjacentLBracket(),
        DEF: () => {
          this.CONSUME(t.LBracket);
          this.CONSUME(t.RBracket);
        },
      });
      // `String?` -- the optional suffix (D9), and the one that actually fires for a plain `T?`.
      // AFTER the array suffix, so `T[]?` is an OPTIONAL ARRAY. An array of optionals is `(T?)[]`,
      // which reaches this same site through the parenthesized alternative in `type`.
      this.OPTION2({
        GATE: () => this.isAdjacentQuestion(),
        DEF: () => this.CONSUME(t.Question),
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

    // PEG: name:TypeName "<" generics:Type|1.., ","?| ">" -- comma optional (`Pair<T U>`).
    this.genericType = this.RULE("genericType", () => {
      this.SUBRULE(this.typeName);
      this.CONSUME(t.LAngle);
      this.AT_LEAST_ONE(() => {
        this.SUBRULE(this.type);
        this.OPTION(() => this.CONSUME(t.Comma));
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

    // PEG: "{" keys:KeyDefinition|.., ","?| "}" -- comma optional.
    this.mapType = this.RULE("mapType", () => {
      this.CONSUME(t.LBrace);
      this.MANY(() => {
        this.SUBRULE(this.keyTypeDefinition);
        this.OPTION(() => this.CONSUME(t.Comma));
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

    // A TUPLE type -- `[Int String]`, elements whitespace-separated like a vector literal. `AT_LEAST_ONE`
    // stops at `]` (RBracket is not in `type`'s FIRST set). Elements are full `type`s, so `[Int[] String?]`
    // and nested `[Int [A B]]` work. The trailing `[]` array suffix (array-of-tuples) is handled by the
    // caller `basicType`, exactly as for every other basic type.
    this.tupleType = this.RULE("tupleType", () => {
      this.CONSUME(t.LBracket);
      this.AT_LEAST_ONE(() => this.SUBRULE(this.type));
      this.CONSUME(t.RBracket);
    });

    // ========================================================================
    // MODIFIERS (like :public, :private, :ctor, etc.)
    // ========================================================================
    // PEG: ":" ModifierName ("[" _ args:Expression|.., ","?| _ "]")? -- comma optional.
    this.modifier = this.RULE("modifier", () => {
      this.CONSUME(t.Colon);
      // The name is normally an Identifier, but PEG's ModifierName is just [a-zA-Z_][\w-]* --
      // it does not exclude keywords. `:async` is the real one: `async` lexes as AsyncKw here,
      // not Identifier, so `(fn :async f [] ...)` -- the ONLY async syntax the PEG actually has
      // -- could not parse at all. Any other keyword used as a modifier name needs adding here
      // too; `:cond` and `:from` are safe because they lex whole, as reserved *ModKw tokens.
      this.OR([
        { ALT: () => this.CONSUME(t.Identifier) },
        { ALT: () => this.CONSUME(t.AsyncKw) },
      ]);
      this.OPTION(() => {
        this.CONSUME(t.LBracket);
        this.MANY(() => {
          this.SUBRULE(this.expression);
          this.OPTION2(() => this.CONSUME(t.Comma));
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
      // The binding target: a plain name, or a destructuring pattern.
      //   (let x 5) | (let [x y] point) | (let {:name :age} person)
      // A `[` or `{` in the NAME slot -- i.e. immediately after let/mut and its modifiers, before
      // any value -- can only be a destructuring pattern. A vector or map VALUE always follows a
      // name (`(let resources [])`), so there is nothing to be ambiguous with.
      this.OPTION(() => {
        this.OR2([
          {
            GATE: () => this.LA(1)?.tokenType === t.LBracket,
            ALT: () => this.SUBRULE(this.vectorPattern),
          },
          {
            GATE: () => this.LA(1)?.tokenType === t.LBrace,
            ALT: () => this.SUBRULE(this.mapPattern),
          },
          { ALT: () => this.SUBRULE(this.identifier) },
        ]);
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
      // `<T>` -- a generic FUNCTION (Phase 5).
      //
      // This slot did not exist, so `(fn my-head<T> [xs <- T[]] -> T?)` was a PARSE ERROR here while
      // PEG lexed the whole of `my-head<T>` as a single identifier. `FunctionNode.generics` has been
      // declared the whole time -- with a comment saying it is "NEVER populated by either frontend" --
      // and every downstream binder already handles it. Only the grammar was missing.
      //
      // `genericParam`, the same rule classes use, so `:out`/`:in` come along for free.
      this.OPTION5(() => {
        this.CONSUME(t.LAngle);
        this.AT_LEAST_ONE(() => {
          this.SUBRULE(this.genericParam);
          this.OPTION6(() => this.CONSUME2(t.Comma));
        });
        this.CONSUME(t.RAngle);
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
      // Same binding target as `variable`: a name, or a destructuring pattern.
      //   (fn f [x] ...) | (fn print-point [[x y]] ...) | (fn greet [{:name}] ...)
      this.OR([
        {
          GATE: () => this.LA(1)?.tokenType === t.LBracket,
          ALT: () => this.SUBRULE(this.vectorPattern),
        },
        {
          GATE: () => this.LA(1)?.tokenType === t.LBrace,
          ALT: () => this.SUBRULE(this.mapPattern),
        },
        { ALT: () => this.SUBRULE(this.identifier) },
      ]);
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
              this.SUBRULE(this.typeRef);
            },
          },
          {
            ALT: () => {
              this.CONSUME(t.ImplementsModKw);
              this.SUBRULE2(this.typeRef);
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
        this.AT_LEAST_ONE(() => {
          this.SUBRULE(this.genericParam);
          this.OPTION2(() => this.CONSUME(t.Comma));
        });
        this.CONSUME(t.RAngle);
      });
    });

    /**
     * A declared type PARAMETER: `T`, or `:out T` / `:in T`.
     *
     * Its own rule, rather than `OPTION(modifier) typeName` inlined into the list above, because a
     * Chevrotain CST hands back `ctx.modifier` and `ctx.typeName` as two FLAT arrays -- so in
     * `Producer<:out T, U>` there is no way to tell which parameter the `:out` belonged to. One CST
     * node per parameter keeps them paired.
     */
    this.genericParam = this.RULE("genericParam", () => {
      this.OPTION(() => this.SUBRULE(this.modifier));
      this.SUBRULE(this.typeName);
    });

    /**
     * A type reference in an `:extends` / `:implements` clause: `Animal`, or `Producer<Animal>`.
     * Both clauses used to consume a bare `typeName`, silently dropping the type ARGUMENTS.
     */
    this.typeRef = this.RULE("typeRef", () => {
      this.SUBRULE(this.typeName);
      this.OPTION(() => {
        this.CONSUME(t.LAngle);
        this.AT_LEAST_ONE(() => {
          this.SUBRULE(this.type);
          this.OPTION2(() => this.CONSUME(t.Comma));
        });
        this.CONSUME(t.RAngle);
      });
    });

    // defstruct Name :extends Type :implements Type body*
    //
    // The `:extends` / `:implements` clauses are D11. A struct had NO class surface: `:implements` is
    // its own token (not a generic modifier), so `MANY(modifier)` could never consume it and neither
    // could `expression` -- `(defstruct Rect :implements Shape ...)` was a hard parse error, and it is
    // the last ERROR in the suite (05-oop/01_interfacses.lisp).
    //
    // The PEG was WORSE, and silent: it parsed the same source and dumped `:implements Shape` into the
    // struct BODY as two junk bare identifiers, so the interface was simply forgotten and the program
    // ran. The loud frontend was the correct one.
    this.structDecl = this.RULE("structDecl", () => {
      this.CONSUME(t.DefStructKw);
      this.MANY(() => {
        this.SUBRULE(this.modifier);
      });
      this.OPTION(() => {
        this.SUBRULE(this.typeName);
      });
      this.MANY2(() => {
        this.OR([
          {
            ALT: () => {
              this.CONSUME(t.ExtendsModKw);
              this.SUBRULE(this.typeRef);
            },
          },
          {
            ALT: () => {
              this.CONSUME(t.ImplementsModKw);
              this.SUBRULE2(this.typeRef);
            },
          },
        ]);
      });
      this.MANY3(() => {
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
        this.SUBRULE(this.typeRef);
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
    /**
     * `(defmacro name [params] body)`.
     *
     * D3 rules macros OUT for 1.0 and RESERVES the keyword: `(defmacro ...)` must be a hard
     * "not implemented in 0.x" error, never a silent call. Reserving it means PARSING it -- so the
     * compiler can refuse it by name, with a location, instead of dying on a bewildering
     * "Expecting RParen but found ..." three tokens later.
     *
     * `DefMacroKw` has always been lexed by both frontends and consumed by no rule. Deliberately
     * permissive about what follows: the form is rejected outright, so there is nothing to be gained
     * by being strict about the shape of something we will not compile.
     */
    this.macroDecl = this.RULE("macroDecl", () => {
      this.CONSUME(t.DefMacroKw);
      this.OPTION(() => this.CONSUME(t.Identifier));
      this.MANY(() => {
        this.SUBRULE(this.expression);
      });
    });

    this.modifierDefDecl = this.RULE("modifierDefDecl", () => {
      this.CONSUME(t.DefModifierKw);
      this.CONSUME(t.Identifier);
      // PEG: ("[" _ @FunctionParameter|.., ","?| _ "]" _)? -- comma optional.
      // MANY2, not MANY: this rule already uses MANY for the body below, and Chevrotain
      // requires a unique occurrence index per DSL method within a rule.
      this.OPTION(() => {
        this.CONSUME(t.LBracket);
        this.MANY2(() => {
          this.SUBRULE(this.parameter);
          this.OPTION2(() => this.CONSUME(t.Comma));
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
    // PEG: imports:ImportDefinition|1.., ","?| -- comma optional.
    this.importExpr = this.RULE("importExpr", () => {
      this.CONSUME(t.ImportKw);
      this.AT_LEAST_ONE(() => {
        this.SUBRULE(this.importDefinition);
        this.OPTION(() => this.CONSUME(t.Comma));
      });
    });

    this.importDefinition = this.RULE("importDefinition", () => {
      this.OR([
        { ALT: () => this.SUBRULE(this.importSymbols) },
        { ALT: () => this.SUBRULE(this.importSource) },
      ]);
    });

    // PEG: "{" symbols:SymbolAlias|1.., ","?| "}" -- comma optional.
    this.importSymbols = this.RULE("importSymbols", () => {
      this.CONSUME(t.LBrace);
      this.AT_LEAST_ONE(() => {
        this.SUBRULE(this.symbolAlias);
        this.OPTION(() => this.CONSUME(t.Comma));
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
      this.AT_LEAST_ONE(() => {
        this.SUBRULE(this.exportAlias);
        this.OPTION(() => this.CONSUME(t.Comma));
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
        // Leading comments BETWEEN clauses (PR1). Comments are real tokens (l-lang keeps them as AST
        // nodes), so a `;; note` before a `(:else ...)` clause was an unexpected token and threw a raw
        // parse error. Consumed here so a clause may be documented.
        this.MANY(() => this.SUBRULE(this.comment));
        this.SUBRULE(this.condCase);
      });
    });

    this.condCase = this.RULE("condCase", () => {
      this.CONSUME(t.LParen);
      this.OR([
        {
          // `(:else body)` -- THE DEFAULT CLAUSE (D12: "`cond`'s default clause is spelled `:else`").
          //
          // It has no condition, which is the only thing that makes it a separate alternative: every
          // other clause is `(<condition> <body>)`. The AST builder gives it a `true` condition, so
          // downstream this IS an ordinary clause -- see `condCase` there.
          //
          // ElseModKw has existed all along and is consumed by the `if`/`when` and `for` rules; this
          // rule had simply never referenced it, so a ruling made in D12 was never implemented and
          // the corpus wrote `(true ...)` instead, with a comment explaining that it meant default.
          ALT: () => {
            this.CONSUME(t.ElseModKw);
            this.SUBRULE3(this.expression);
          },
        },
        {
          ALT: () => {
            this.OPTION(() => {
              this.OPTION2(() => this.CONSUME(t.CondModKw));
              this.SUBRULE(this.expression);
            });
            this.OPTION3(() => {
              this.OPTION4(() => this.CONSUME(t.ThenModKw));
              this.SUBRULE2(this.expression);
            });
          },
        },
      ]);
      this.CONSUME(t.RParen);
    });

    /**
     * D12: `for` is NAMED-ONLY and ORDER-FREE -- a bag of `:keyword expression` clauses.
     *
     *   (for :each x :from xs :then body)                 ; for-each
     *   (for :init i :cond c :step s :then body :else e)  ; classic
     *
     * The old rule was a fixed sequence of positional OPTION slots whose keywords were themselves
     * optional, so a bare expression silently fell into whatever slot came next and the clause
     * order was load-bearing. That is what the audit meant by "the for-each feature and the
     * for-each bug are currently the same code": for-each worked *because* of the slot drift.
     *
     * As a bag, an unknown clause (`:i`, `:of`) can no longer slide into a slot -- it simply is
     * not one of the alternatives, and the parser says so with a located error naming the clauses
     * it does accept. Duplicate and missing-required clauses are checked on the AST; see
     * SyntaxRulesAstVisitor.visitFor.
     *
     * It also retires the OPTION-index pressure that made the previous rule unfinishable:
     * Chevrotain defines only OPTION..OPTION9, the old rule had used nine of the ten, and that
     * is very likely why `:else` sat commented out rather than finished.
     */
    this.forExpr = this.RULE("forExpr", () => {
      this.CONSUME(t.ForKw);
      this.AT_LEAST_ONE(() => {
        this.MANY(() => this.SUBRULE(this.comment)); // PR1: a comment between `:keyword` clauses
        this.SUBRULE(this.forClause);
      });
    });

    this.forClause = this.RULE("forClause", () => {
      this.OR([
        { ALT: () => { this.CONSUME(t.InitModKw); this.SUBRULE(this.expression); } },
        { ALT: () => { this.CONSUME(t.EachModKw); this.SUBRULE(this.forEachBinding); } },
        { ALT: () => { this.CONSUME(t.CondModKw); this.SUBRULE2(this.expression); } },
        { ALT: () => { this.CONSUME(t.FromModKw); this.SUBRULE3(this.expression); } },
        { ALT: () => { this.CONSUME(t.StepModKw); this.SUBRULE4(this.expression); } },
        { ALT: () => { this.CONSUME(t.ThenModKw); this.SUBRULE5(this.expression); } },
        { ALT: () => { this.CONSUME(t.ElseModKw); this.SUBRULE6(this.expression); } },
      ]);
    });

    // The `:each` binding is a full binding target (D16), not just a name -- the corpus already
    // relies on it: `(for :each [key val] :from settings.entries ...)`.
    this.forEachBinding = this.RULE("forEachBinding", () => {
      this.OR([
        {
          GATE: () => this.LA(1)?.tokenType === t.LBracket,
          ALT: () => this.SUBRULE(this.vectorPattern),
        },
        {
          GATE: () => this.LA(1)?.tokenType === t.LBrace,
          ALT: () => this.SUBRULE(this.mapPattern),
        },
        { ALT: () => this.SUBRULE(this.identifier) },
      ]);
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

    // ========================================================================
    // D47 CONDITIONS / RESTARTS (C-native, JS-refused)
    //
    // `handle` is kept DISTINCT from `try` on purpose: opposite mechanisms (try unwinds UP to the
    // handler; a handler runs IN PLACE without unwinding). See docs/spec/DECISIONS.md#d47.
    //
    // The body is MANDATORY (a single SUBRULE, not an OPTION). This is the deliberate scaffold cure for
    // the construction ambiguity the blueprint flagged: an OPTION(body) followed by a MANY of LParen-led
    // arms/clauses collides at the `(` (a body list also starts with `(`). With a mandatory single body
    // the following MANY decides purely on `(` (arm/clause) vs `)` (end of the enclosing list) -- k=1,
    // no ambiguity. The arm/clause params vector is likewise MANDATORY (`[]` when unused), which removes
    // the second latent ambiguity (a `[..]` params vector vs a `[..]` vector-literal body expression).
    // (restart-case <body> (:name [params] body*)*)
    this.restartCaseExpr = this.RULE("restartCaseExpr", () => {
      this.CONSUME(t.RestartCaseKw);
      this.SUBRULE(this.expression); // the protected body (mandatory)
      this.MANY(() => this.SUBRULE(this.restartArm));
    });

    // (:name [params] body*) -- each arm's body value becomes the whole form's value when invoked (D47).
    this.restartArm = this.RULE("restartArm", () => {
      this.CONSUME(t.LParen);
      this.CONSUME(t.Colon);
      this.CONSUME(t.Identifier);
      this.SUBRULE(this.vector); // params (mandatory; `[]` when the restart takes none)
      this.MANY(() => this.SUBRULE(this.expression));
      this.CONSUME(t.RParen);
    });

    // (handle <body> (:on Cond [c] body*)*) -- in-place handlers.
    this.handleExpr = this.RULE("handleExpr", () => {
      this.CONSUME(t.HandleKw);
      this.SUBRULE(this.expression); // the protected body (mandatory)
      this.MANY(() => this.SUBRULE(this.handleClause));
    });

    // (:on Cond [binder] body*) -- clauses stay in SOURCE order end-to-end.
    this.handleClause = this.RULE("handleClause", () => {
      this.CONSUME(t.LParen);
      this.CONSUME(t.OnModKw);
      this.SUBRULE(this.typeName);
      this.SUBRULE(this.vector); // the condition binder (mandatory; `[]` when unused)
      this.MANY(() => this.SUBRULE(this.expression));
      this.CONSUME(t.RParen);
    });

    // (signal <cond>) -- the pure primitive: walks handlers in place; RETURNS nil if unhandled.
    this.signalExpr = this.RULE("signalExpr", () => {
      this.CONSUME(t.SignalKw);
      this.SUBRULE(this.expression);
    });

    // (invoke-restart :name args*) -- a diverging control transfer.
    this.invokeRestartExpr = this.RULE("invokeRestartExpr", () => {
      this.CONSUME(t.InvokeRestartKw);
      this.CONSUME(t.Colon);
      this.CONSUME(t.Identifier);
      this.MANY(() => this.SUBRULE(this.expression));
    });

    // match expression { cases }
    this.matchExpr = this.RULE("matchExpr", () => {
      this.CONSUME(t.MatchKw);
      this.SUBRULE(this.expression);
      this.CONSUME(t.LBrace);
      this.AT_LEAST_ONE(() => {
        this.MANY(() => this.SUBRULE(this.comment)); // PR1: a comment between arms
        this.SUBRULE(this.matchCase);
      });
      this.CONSUME(t.RBrace);
    });

    this.matchCase = this.RULE("matchCase", () => {
      this.SUBRULE(this.pattern);
      // `:when <expr>` (D26). Optional, and lexically SEPARATE from the pattern -- which is the whole
      // reason it is unambiguous where a predicate-shaped pattern would not be. The pattern binds; the
      // guard reads those bindings.
      this.OPTION(() => {
        this.CONSUME(t.WhenModKw);
        this.SUBRULE1(this.expression, { LABEL: "guard" });
      });
      this.CONSUME(t.RightDoubleArrow);
      this.SUBRULE2(this.expression, { LABEL: "body" });
    });

    // ========================================================================
    // PATTERNS
    // ========================================================================
    this.pattern = this.RULE("pattern", () => {
      this.OR([
        { ALT: () => this.SUBRULE(this.anyPattern) },
        { ALT: () => this.SUBRULE(this.restPattern), GATE: () => this.LA(1)?.tokenType === t.Spread },
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

    // The pattern is OPTIONAL: `{:name :age}` is the shorthand form, binding `name` and `age`
    // under their own names. A pattern appears only when the binding is renamed
    // (`{:firstName first-name}`) or nested (`{:user {:name :id}}`). No pattern alternative can
    // begin with a Colon, so the next pair's `:key` never gets mistaken for this pair's value.
    this.mapPatternPair = this.RULE("mapPatternPair", () => {
      this.CONSUME(t.Colon);
      this.SUBRULE(this.key);
      this.OPTION(() => this.SUBRULE(this.pattern));
    });

    // `...rest`, as the tail of a vector pattern: `(let [first second ...rest] numbers)`.
    this.restPattern = this.RULE("restPattern", () => {
      this.CONSUME(t.Spread);
      this.SUBRULE(this.identifier);
    });

    this.identifierPattern = this.RULE("identifierPattern", () => {
      this.SUBRULE(this.identifier);
    });

    this.constantPattern = this.RULE("constantPattern", () => {
      this.OR([
        { ALT: () => this.CONSUME(t.StringLiteral) },
        // `nil` is a CONSTANT to match against, not a name to bind (D9). It reached
        // `identifierPattern` before, which wants an Identifier and gets a NilKw -- "Expecting
        // RBracket but found 'nil'". The PEG had the opposite bug and it was the dangerous one: `nil`
        // IS an identifier char sequence there, so `[nil 2]` bound a VARIABLE NAMED `nil`, matched
        // ANYTHING, and shadowed the literal -- silently.
        { ALT: () => this.CONSUME(t.NilKw) },
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

  /**
   * Does this `[...]` literal contain a top-level `|`, i.e. is it a matrix rather than a vector?
   *
   * Scanning starts at LA(2), NOT LA(1): LA(1) is the `[` that OPENS this literal. Counting it
   * as a nested bracket pushed depth to 1, so every row separator inside sat at depth 1 and the
   * `depth === 0` test could never fire -- isMatrix() always returned false and matrices never
   * parsed at all. The `|` then fell through to simpleIdentifier (which accepts operators as
   * identifiers) and was emitted as an identifier named `|`, hence the `_7c is not defined`
   * ReferenceError at runtime.
   */
  private isMatrix(): boolean {
    let depth = 0;
    let i = 2;
    while (i < 100) {
      // Safety limit
      const token = this.LA(i);
      if (!token) break;
      if (token.tokenType === t.RBracket && depth === 0) break; // closes this literal
      if (token.tokenType === t.LBracket) depth++;
      else if (token.tokenType === t.RBracket) depth--;
      else if (token.tokenType === t.Pipe && depth === 0) return true;
      i++;
    }
    return false;
  }

  /**
   * Is the next token a `[` that butts *directly* against the previous token, with no
   * whitespace between them?
   *
   * `arr[i]` is an indexer and `Expr[]` is an array type; `arr [i]` is an identifier followed by
   * a separate vector, and `Expr [1 2]` is a type followed by a vector value.
   *
   * The PEG frontend distinguishes them by adjacency -- its rule is
   *   Indexer = id:Identifier indices:("[" @Expression|1.., ","?| "]")|1..|
   * with no whitespace rule between the identifier and the `[`, so the bracket has to butt
   * directly against it. Chevrotain's lexer discards whitespace, so that information survives
   * only in the token offsets: require the `[` to start exactly where the previous token ended.
   *
   * Without this the indexer is greedy and silently eats a following vector argument --
   * `(analyze-vector [1 9 9])` parses as indexing `analyze-vector` at `[1 9 9]` rather than
   * calling it with a vector.
   */
  private isAdjacentLBracket(): boolean {
    const prev = this.LA(0); // last consumed token
    const next = this.LA(1);
    if (!prev || !next || next.tokenType !== t.LBracket) return false;
    if (typeof prev.endOffset !== "number" || typeof next.startOffset !== "number") return false;
    return next.startOffset === prev.endOffset + 1;
  }

  /**
   * `String?` -- the optional-type suffix (D9). Same adjacency rule as the array suffix, and needed
   * for the same reason: `?` is ALSO a legal operator-identifier (see `simpleIdentifier`, where the
   * OR block admits operators so that `(fn :operator ? ...)` can be declared). So a spaced `?` after
   * a type must NOT be swallowed as optionality -- `(let x <- String ? a b)` is a `String`, and then
   * something else entirely.
   *
   * The suffix binds OUTSIDE the array suffix: `T[]?` is an optional array, and an array of optionals
   * is `(T?)[]` -- which the parenthesized alternative of `type` already reaches, since `basicType`
   * carries its own `?`.
   */
  private isAdjacentQuestion(): boolean {
    const prev = this.LA(0);
    const next = this.LA(1);
    if (!prev || !next || next.tokenType !== t.Question) return false;
    if (typeof prev.endOffset !== "number" || typeof next.startOffset !== "number") return false;
    return next.startOffset === prev.endOffset + 1;
  }

  /**
   * `HttpMethod:GET` -- an Identifier, a `:`, and an Identifier with no whitespace anywhere
   * between them. See the comment in `simpleIdentifier`: this is an enum member reference, which
   * the PEG lexes as one colon-bearing identifier. Whitespace anywhere means it is something else
   * (a modifier, or a map key), so all three tokens must be strictly adjacent.
   */
  /**
   * A `.` immediately after the token just consumed -- no whitespace.
   *
   * Same discriminator as isAdjacentLBracket, and for the same reason. `foo .bar` (spaced) is an
   * identifier followed by a HEADLESS member-reference, which is a real form: 05_matching.lisp
   * pipes with `(.apply evt1)`. `foo.bar` with no space is one thing.
   */
  private isAdjacentDot(): boolean {
    const prev = this.LA(0); // last consumed token
    const next = this.LA(1);
    if (!prev || !next || next.tokenType !== t.Dot) return false;
    if (typeof prev.endOffset !== "number" || typeof next.startOffset !== "number") return false;
    return next.startOffset === prev.endOffset + 1;
  }

  private isAdjacentQualifier(): boolean {
    const prev = this.LA(0); // the Identifier we just consumed
    const colon = this.LA(1);
    const next = this.LA(2);
    if (!prev || !colon || !next) return false;
    if (colon.tokenType !== t.Colon || next.tokenType !== t.Identifier) return false;
    if (typeof prev.endOffset !== "number" || typeof colon.endOffset !== "number") return false;
    return colon.startOffset === prev.endOffset + 1 && next.startOffset === colon.endOffset + 1;
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
      first?.tokenType === t.NilKw ||
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
