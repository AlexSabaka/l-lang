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
      // EXCLUSIVE -- one past the last character, the way `String.slice` and the PEG both mean it.
      //
      // It was `lastToken.endOffset`, and Chevrotain's `endOffset` is INCLUSIVE: it indexes the last
      // character, not one past it. So the two frontends disagreed about what this field MEANS:
      //
      //     (let x 10)      grammar_v2:  list = 0..9    INCLUSIVE
      //                     peg:         list = 0..11   EXCLUSIVE
      //
      // `AstProvider.getSource` slices `[start, end)`, so it was correct under the PEG and **truncated
      // every diagnostic's source excerpt by one character** under grammar_v2 -- the default. It read
      // as `(let x <- Int "str"` with the closing paren missing, which looks like a wrapping artefact
      // and is why it hid in plain sight for so long.
      //
      // The `+ 1` on `column` directly below has always been here: the same object was already
      // half-exclusive. This makes the offset agree with it, with the PEG, and with `slice`.
      //
      // `??`, not `||`: `endOffset` of 0 is a valid offset and `||` would discard it.
      offset: (lastToken.endOffset ?? firstToken.startOffset ?? 0) + 1,
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

  /**
   * `..` BINDS BY ADJACENCY (D88/N4): `1..2` is a Range, `1 .. 2` is not.
   *
   * l-lang separates list elements by WHITESPACE, so `1..2` versus `1 .. 2` is the same boundary
   * question as `12` versus `1 2` -- one element or three. It is not an operator whose meaning changes
   * with spacing; it is the language's existing element rule applied to a token that happens to be
   * punctuation. Which is what makes `array[1..2]` (one range index) and `array[1 .. 2]` (an index, a
   * span, an index) distinguishable without inventing a second token or requiring commas.
   *
   * Offsets rather than a lexer mode, because the lexer cannot see across tokens: chevrotain's
   * `endOffset` is INCLUSIVE of the last character, and a node's `_location.end.offset` is EXCLUSIVE
   * (pinned by a grammar-v2 smoke test), so the two comparisons are deliberately asymmetric.
   */
  private static rangeIsTight(ctx: any, nodes: any[]): boolean {
    const dots = ctx.Range?.[0];
    const lhsEnd = nodes[0]?._location?.end?.offset;
    const rhsStart = nodes[1]?._location?.start?.offset;
    if (dots == null || lhsEnd == null || rhsStart == null) return true; // no offsets: keep the old answer
    return lhsEnd === dots.startOffset && dots.endOffset + 1 === rhsStart;
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
      "classDecl", "structDecl", "enumDecl", "interfaceDecl", "typeDefDecl", "castDefDecl", "castExpr",
      "modifierDefDecl", "attributeDefDecl", "macroDecl", "whenExpr", "ifExpr", "condExpr", "forExpr",
      "whileExpr", "tryCatchExpr",
      "restartCaseExpr", "handleExpr", "signalExpr", "invokeRestartExpr",
      "matchExpr", "awaitExpr", "spreadExpr",
      // D96 -- `unquoteExpr` sits here, ahead of `assignmentOrExpr`, for the same reason the GRAMMAR
      // puts it there: `~` is a legal operator-name character, so the two share a prefix path and
      // order is what resolves it. This list and the parser's OR must stay in the same order.
      "unquoteExpr",
      "assignmentOrExpr", "quoteExpr", "quasiquoteExpr", "nil", "boolean", "number", "string",
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

      // The suffix chain, IN SOURCE ORDER.
      //
      // The CST hands back `indexerSuffix` and `memberSuffix` as two FLAT arrays with no linkage
      // between them, so `m.rows[0][1].v` would otherwise come back as "two indexes" and "one
      // member" with no way to know the member came last. Offsets carry the order the arrays lose --
      // the same trap as the `:extends`/`:implements` clauses in P7a.
      const suffixes = [
        ...(ctx.indexerSuffix ?? []).map((s: any) => ({ at: s.location.startOffset, cst: s, member: false })),
        ...(ctx.memberSuffix ?? []).map((s: any) => ({ at: s.location.startOffset, cst: s, member: true })),
      ].sort((a, b) => a.at - b.at);

      if (suffixes.length > 0) {
        // A MEMBER suffix is a computed index with a string key. `obj.name` and `obj["name"]` are the
        // same thing in JavaScript, so no new AST shape is needed -- visitIndexer already emits
        // exactly this. It is also what D13 requires of map keys: a string, never mangled.
        const indices = suffixes.map((s) =>
          s.member ? [this.visit(s.cst)] : this.visit(s.cst)
        );
        // Which suffixes were written `.name`. They emit identically to a string index, but D1 rules
        // `(obj.m)` a CALL and `(obj["m"])` a read -- so the spelling has to survive.
        const members = suffixes.map((s) => s.member);
        return this.makeNode("indexer", ctx, { id, indices, members });
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

  /** `.name` -- emitted as the STRING key of a computed access. See primaryExpr. */
  memberSuffix(ctx: any): ast.StringNode {
    // Either token shape -- a keyword-named member (`xs[0].from`) arrives as BareKeyword. Only one
    // of the two can be present, so there is no ordering question here as there is in
    // compositeIdentifier.
    const token = (ctx.Identifier ?? ctx.BareKeyword)[0];
    return this.makeNode("string", ctx, { value: token.image });
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
    // Always "nil" (D9). `null` is only the JS-interop ALIAS -- the same value, not a second one --
    // so the spelling must not survive into the AST. It used to, and codegen branched on it: an
    // `undefined` keyword emitted the JS `undefined` identifier while every other spelling emitted
    // `null`. That branch was the second bottom value.
    return this.makeNode("null", ctx, { keyword: "nil" });
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
    // D88: an IMAGINARY literal is a complex-number node with a zero real part, so it rides the same
    // desugar `3+4i` does and needs no AST type of its own. The trailing `i`/`j` is dropped before
    // parsing; separators go with it, for the reason spelled out below.
    if (ctx.ImaginaryNumber) {
      const match = ctx.ImaginaryNumber[0].image;
      const digits = match.slice(0, -1).replace(/_/g, "");
      return this.makeNode("complex-number", ctx, {
        match,
        real: 0,
        imaginary: parseFloat(digits),
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
    // D71 -- digit separators are stripped HERE, at the single point where a token becomes a node, so
    // that no consumer downstream has to know they exist.
    //
    // This is a correctness requirement, not tidiness. `ResolveHirToCir` reads `node.match` as "the
    // only lossless copy on the node" and guards it with `/^[+-]?\d+$/` before trusting it -- an
    // underscore fails that guard, the site falls back to `String(node.value)`, and a JS number has
    // already rounded anything past 2^53. Leaving separators in `match` would therefore have
    // reintroduced, for exactly the literals big enough to need grouping, the precision bug those two
    // sites exist to fix. `value` needs it too: `parseInt("1_000", 10)` is 1.
    const bare = (s: string) => s.replace(/_/g, "");
    if (ctx.HexNumber) {
      const match = bare(ctx.HexNumber[0].image);
      return this.makeNode("hex-number", ctx, {
        match: match.slice(2), // Remove 0x
        value: parseInt(match, 16),
      });
    }
    if (ctx.BinaryNumber) {
      const match = bare(ctx.BinaryNumber[0].image);
      return this.makeNode("binary-number", ctx, {
        match: match.slice(2), // Remove 0b
        value: parseInt(match.slice(2), 2),
      });
    }
    if (ctx.OctalNumber) {
      const match = bare(ctx.OctalNumber[0].image);
      return this.makeNode("octal-number", ctx, {
        match: match.slice(2), // Remove 0o
        // `.slice(2)` is load-bearing now that the prefix is `0o` rather than a bare leading zero:
        // `parseInt("0o17", 8)` is 0, because parseInt stops at the first character outside the radix.
        // The old form was `parseInt("017", 8)` -- which worked, and meant 15.
        value: parseInt(match.slice(2), 8),
      });
    }
    if (ctx.FloatNumber) {
      const match = bare(ctx.FloatNumber[0].image);
      return this.makeNode("float-number", ctx, {
        match,
        value: parseFloat(match),
      });
    }
    if (ctx.IntegerNumber) {
      const match = bare(ctx.IntegerNumber[0].image);
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
    // D67 -- `r"…"` is RAW: strip `r"` and the closing quote, and decode NOTHING. That is the entire
    // difference, and it is why `r"\d+"` is the four characters a regex wants where `"\\d+"` needs the
    // backslash doubled. The result is an ordinary `string` node, so nothing downstream -- the
    // checker, either backend, `std/text/regex` -- has any idea a prefix was involved.
    if (ctx.RawString) {
      return this.makeNode("string", ctx, {
        value: ctx.RawString[0].image.slice(2, -1),
      });
    }
    // Strip the quotes, then DECODE. The decode is what was missing: `formattedString` below has always
    // called `unescapeString`, and this path did not -- so `'"a\nb"` printed a newline and `"a\nb"`
    // printed a backslash and an `n`. Same escape, two answers, in one language.
    const value = this.unescapeString(ctx.StringLiteral[0].image.slice(1, -1));
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

  /**
   * Decode the escape sequences in a string literal's body. ONE PASS, and that is the whole point.
   *
   * This used to be a chain of `.replace()` calls -- `\\n` -> newline, then `\\\\` -> backslash, and so on --
   * which is wrong for the one input that matters:
   *
   *     "a\\\\nb"        the source says: BACKSLASH, then the letter n
   *
   * The `/\\n/` pass runs FIRST and matches the second backslash together with the `n`, so an escaped
   * backslash followed by a letter decodes to a backslash and a NEWLINE. A decoder that rewrites its own
   * output cannot be correct; it has to consume each escape exactly once, left to right.
   *
   * The set matches the PEG's `Char` rule exactly. Two frontends must agree, and an escape the other one
   * rejects is a divergence, not a feature.
   */
  private unescapeString(s: string): string {
    // `x[0-9a-fA-F]{2}` sits alongside the `u` alternative and BEFORE the catch-all `.`, which is the
    // whole bug: there was no `x` alternative, so `\x1b` matched `.`, took the "an unknown escape is
    // the character itself" branch below, and decoded to the three characters `x1b`. Silently -- a
    // length-12 ANSI string arrived as length 16 and simply failed to colour anything (AF-004).
    //
    // Anchored to EXACTLY two hex digits, so a malformed `\xZZ` still falls through to the catch-all
    // and stays `xZZ` rather than throwing or eating what follows.
    return s.replace(
      /\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g,
      (_match: string, esc: string): string => {
        // LENGTH, not just the leading character. The catch-all `.` hands back a ONE-character esc,
        // so a malformed `\xZZ` arrives here as plain `"x"` -- and `esc[0] === "x"` would then call
        // `parseInt("", 16)`, which is NaN, and `String.fromCharCode(NaN)` is a NUL byte. A hex
        // escape is `x` + exactly 2 (length 3); a unicode escape is `u` + exactly 4 (length 5);
        // anything else is the catch-all and must fall through to the switch.
        //
        // This was already live for `\u`: `"\uZZZZ"` decoded to NUL, silently. Adding `\x` without
        // the length check would have duplicated the bug rather than found it -- the malformed-escape
        // guard case is what caught it.
        if (esc.length === 5 && esc[0] === "u")
          return String.fromCharCode(parseInt(esc.slice(1), 16));
        if (esc.length === 3 && esc[0] === "x")
          return String.fromCharCode(parseInt(esc.slice(1), 16));
        switch (esc) {
          case "n": return "\n";
          case "r": return "\r";
          case "t": return "\t";
          case "b": return "\b";
          case "f": return "\f";
          case '"': return '"';
          case "\\": return "\\";
          case "/": return "/";
          case "{": return "{";
          case "}": return "}";
          // An unknown escape is the character itself -- `\q` is `q`. Same as the PEG, which simply has
          // no alternative for it and therefore cannot produce a backslash either.
          default: return esc;
        }
      }
    );
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
    // Chevrotain keys CST children by TOKEN NAME, not occurrence index, so the head (CONSUME)
    // and the tail (CONSUME2) both land in ctx.Identifier, in source order.
    //
    // A keyword-named member (`m.from`) arrives as a BareKeyword instead, in its OWN array -- so the
    // two arrays each stay in source order but say nothing about each other, and `m.from.x` would
    // rebuild as "m.x.from". Merging by startOffset restores the one order that matters: the source's.
    const images: string[] = [
      ...(ctx.Identifier ?? []),
      ...(ctx.BareKeyword ?? []),
    ]
      .sort((a: any, b: any) => a.startOffset - b.startOffset)
      .map((token: any) => token.image);

    // Headless means `.foo` -- one dot per identifier, with no head before the first dot.
    const headless = images.length === (ctx.Dot?.length ?? 0);
    const id = images.join(".");

    // The PEG builds `parts: [head, ...tail]`, so for a headless `.foo` the head is a null
    // PLACEHOLDER at index 0 and `parts` is [null, "foo"]. Codegen depends on that offset:
    // visitCompositeIdentifier does `startPartId = node.headless ? 1 : 0` and reads
    // parts[startPartId]. Omitting the placeholder left parts[1] undefined and crashed
    // encodeIdentifier() on every headless composite (05_matching, 08_pipelines).
    const parts = headless ? [null, ...images] : images;

    return this.makeNode("composite-identifier", ctx, {
      id,
      headless,
      parts,
    });
  }

  // ========================================================================
  // DATA STRUCTURES
  // ========================================================================
  list(ctx: any): ast.ListNode | ast.TypeGuardNode {
    const nodes = ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : [];

    // `(x :of String)` -- a TYPE GUARD (D41), not a list. The grammar lets `:of` in anywhere a list
    // can appear because no fixed lookahead can see past an arbitrary guarded expression; the SHAPE is
    // enforced here: exactly one expression, then `:of`, then a type.
    //
    // A malformed `(a b :of T)` keeps its list shape and its `:of` is dropped, which the type stage
    // then reports as an ordinary arity/type error on `(a b)` rather than a parse error nobody can
    // read. Deliberate: `:of` is not a call.
    if (ctx.OfModKw && ctx.type && nodes.length === 1) {
      return this.makeNode("type-guard", ctx, {
        value: nodes[0],
        type: this.visit(ctx.type[0]),
      });
    }

    // `(lo .. hi)` -- the RANGE operator (D46/B-0). DESUGARED here to a `(Range lo hi nil true)`
    // construction (std/iter): inclusive by default, step nil (Range fills in +1/-1 by direction).
    // `.by`/`.exclusive` are plain methods on the result. Kept as pure desugar -- no dedicated node,
    // no new lowering -- so type inference, codegen and iteration all treat a range as an ordinary
    // Iterable construction. Exactly one expr each side (the `..` binds two operands); anything else
    // keeps the list shape and the type stage reports it, mirroring the `:of` fall-through above.
    if (ctx.Range && nodes.length === 2) {
      if (LLangAstBuilder.rangeIsTight(ctx, nodes)) {
        // `synthetic` marks this head as the RANGE OPERATOR's, not a user-written `Range`. The
        // injector keys on it, so `(0..3)` pulls in `std/iter` while `(let Range 5)` does not.
        const head = this.makeNode("simple-identifier", ctx, { id: "Range", synthetic: "range-op" });
        const stepNil = this.makeNode("null", ctx, { keyword: "nil" });
        const inclusive = this.makeNode("boolean", ctx, { value: true });
        return this.makeNode("list", ctx, { nodes: [head, nodes[0], nodes[1], stepNil, inclusive] });
      }
      // SPACED, so it is not a range: the `..` is its own element, exactly as the whitespace says.
      // Kept in the list rather than dropped, because dropping it turned `(0 .. 3)` into the block
      // `(0 3)` -- whose value is 3, which then failed at RUN TIME as "value is not iterable". A
      // silent re-reading is the one outcome worse than an error.
      //
      // It surfaces as `LL0210 '..' is not defined`, which is literally true and forward-compatible:
      // a standalone `..` is the SPAN/wildcard (`array[1 .. 2]` = `array[1, *, 2]`), and
      // multidimensional views do not exist yet. When they land, this name gains a meaning and this
      // arm needs no change.
      const dots = this.makeNode("simple-identifier", ctx, { id: ".." });
      return this.makeNode("list", ctx, { nodes: [nodes[0], dots, nodes[1]] });
    }

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
    // Three forms: `:key value` (ctx.key), `"key" value` (ctx.string -- a bare string key), and
    // `:step value` (ctx.ModKeyword -- a MODIFIER keyword, whose colon is part of the token).
    //
    // The ModKeyword image carries its own leading colon (":step"), so the name is `.slice(1)`.
    // `modKwTail` (`(?![a-zA-Z0-9_-])`) guarantees the token is the whole word, so nothing else can
    // be hiding in the image.
    const key = ctx.ModKeyword
      ? this.makeNode("simple-identifier", ctx, {
          id: ctx.ModKeyword[0].image.slice(1),
        })
      : ctx.key
      ? this.visit(ctx.key[0])
      : this.visit(ctx.string[0]);
    const value = ctx.expression ? this.visit(ctx.expression[0]) : null;
    return this.makeNode("key-value", ctx, { key, value });
  }

  key(ctx: any): ast.ASTNode {
    if (ctx.Identifier) {
      return this.makeNode("simple-identifier", ctx, {
        id: ctx.Identifier[0].image,
      });
    }
    // A BARE keyword used as a key -- `{:mut 1}`. The token is the name itself (no colon; that was
    // consumed separately), so its image IS the key. It becomes an ordinary identifier node: by D13
    // a key is a string, and `mut` is only a keyword where the grammar asked for one.
    if (ctx.BareKeyword) {
      return this.makeNode("simple-identifier", ctx, {
        id: ctx.BareKeyword[0].image,
      });
    }
    const value = ctx.StringLiteral[0].image.slice(1, -1);
    return this.makeNode("string", ctx, { value });
  }

  quoteExpr(ctx: any): ast.QuoteNode {
    // The quoted DATUM -- one node. `'(a b)` is a LIST; `'x` is a symbol.
    //
    // The list branch used to return `listNode.nodes`, unwrapping the list into a bare array of its
    // elements -- so `'(a b)` and `'x` had different shapes, and neither matched the declared
    // `ASTNode[]`. PEG kept the list node; this now agrees with it.
    const nodes = ctx.list
      ? this.visit(ctx.list[0])
      : this.visit(ctx.expression[0]);
    return this.makeNode("quote", ctx, { mode: "default", nodes });
  }

  /** `` `(if ~c nil) `` -- a quasiquoted template (D96). Same datum rule as `quote`. */
  quasiquoteExpr(ctx: any): ast.QuasiquoteNode {
    const nodes = ctx.list ? this.visit(ctx.list[0]) : this.visit(ctx.expression[0]);
    return this.makeNode("quasiquote", ctx, { nodes });
  }

  /**
   * `~x` -- an unquote, BOUND BY ADJACENCY (D96).
   *
   * The same gate `spreadExpr` uses for `...` (D93) and `rangeIsTight` uses for `..` (D88/N4):
   * compare the operator's end offset against the operand's start. Tight is the hole; SPACED is the
   * operator character `~` followed by a separate expression, which is what it has always been.
   *
   * A spaced `~` becomes the bare marker identifier `~`, exactly as a spaced `...` does -- reported,
   * never silently re-read, because a silent re-reading is the one outcome worse than an error.
   */
  unquoteExpr(ctx: any): ast.ASTNode {
    const expression = this.visit(ctx.expression[0]);
    const tilde = ctx.Tilde?.[0];
    const operandStart = expression?._location?.start?.offset;
    const tight =
      tilde == null || operandStart == null ? true : tilde.endOffset + 1 === operandStart;
    if (tight) return this.makeNode("unquote", ctx, { expression });
    return this.makeNode("simple-identifier", ctx, { id: "~" });
  }

  // ========================================================================
  // TYPES
  // ========================================================================
  type(ctx: any): ast.TypeNode {
    // Both alternatives (bare and parenthesized) put their union under ctx.unionType, since
    // Chevrotain keys CST children by rule name rather than occurrence index.
    const type = this.visit(ctx.unionType[0]);
    const array = !!ctx.LBracket;
    // `optional` sits on this wrapper for `(A | B)?` and `A | B?`. For a plain `String?` it sits on
    // the INNER node instead (basicType carries its own `?`), exactly as `array` already does --
    // convertAstType reads both positions.
    const optional = !!ctx.Question;
    return this.makeNode("type", ctx, { type, array, optional });
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
    } else if (ctx.tupleType) {
      type = this.visit(ctx.tupleType[0]);
    } else if (ctx.genericType) {
      type = this.visit(ctx.genericType[0]);
    } else if (ctx.simpleType) {
      type = this.visit(ctx.simpleType[0]);
    } else {
      throw new Error(`Unknown basic type: ${Object.keys(ctx)}`);
    }
    const array = !!ctx.LBracket;
    const optional = !!ctx.Question;
    return { ...type, array, optional };
  }

  simpleType(ctx: any): ast.SimpleTypeNode {
    const name = this.visit(ctx.typeName[0]);
    return this.makeNode("simple-type", ctx, { name });
  }

  tupleType(ctx: any): ast.TupleTypeNode {
    const elements = ctx.type ? ctx.type.map((t: any) => this.visit(t)) : [];
    return this.makeNode("tuple-type", ctx, { elements });
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
  /**
   * A `let`/`mut` or a parameter binds either a NAME or a destructuring PATTERN. Chevrotain keys
   * CST children by rule name, so exactly one of identifier / vectorPattern / mapPattern is present.
   */
  private bindingTarget(ctx: any): any {
    if (ctx.vectorPattern) return this.visit(ctx.vectorPattern[0]);
    if (ctx.mapPattern) return this.visit(ctx.mapPattern[0]);
    return ctx.identifier ? this.visit(ctx.identifier[0]) : null;
  }

  restPattern(ctx: any): ast.RestPatternNode {
    const id = this.visit(ctx.identifier[0]);
    return this.makeNode("rest-pattern", ctx, { id });
  }

  variable(ctx: any): ast.VariableNode {
    const mutable = !!ctx.MutKw;
    const modifiers = ctx.modifier ? ctx.modifier.map((m: any) => this.visit(m)) : [];
    // The binding target: an identifier, or a destructuring pattern.
    const name = this.bindingTarget(ctx);
    const type = ctx.type ? this.visit(ctx.type[0]) : null;
    const value = ctx.expression ? this.visit(ctx.expression[0]) : null;
    // Derived post-hoc from the generic modifier list, exactly as `functionExpr` derives its own
    // `extern` -- modifiers cannot be fixed tokens, because `defmodifier` lets users mint new ones.
    const extern = modifiers.some((m: any) => m.modifier === "extern");
    return this.makeNode("variable", ctx, {
      name,
      mutable,
      extern,
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
    // `:gen` (D31): this function lowers to a JS `function*`.
    const generator = modifiers.some((m: any) => m.modifier === "gen");
    const name = ctx.identifier ? this.visit(ctx.identifier[0]) : null;
    const params = ctx.parameter ? ctx.parameter.map((p: any) => this.visit(p)) : [];
    const returns = ctx.type ? this.visit(ctx.type[0]) : null;
    const body = ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : [];
    const extern = modifiers.some((m: any) => m.modifier === "extern");
    // `<T>` on a FUNCTION (Phase 5). Same `genericParam` nodes a class uses, so variance rides along.
    const generics = ctx.genericParam
      ? ctx.genericParam.map((g: any) => this.visit(g))
      : undefined;
    return this.makeNode("function", ctx, {
      name,
      async,
      generator,
      extern,
      modifiers,
      generics,
      params,
      returns,
      body,
    });
  }

  parameter(ctx: any): ast.ParameterNode {
    const spread = !!ctx.Spread;
    const name = this.bindingTarget(ctx);
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

    const { extendsNodes, implementsNodes } = this.pairInheritanceClauses(ctx);
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

  /**
   * Pair each `:extends` / `:implements` keyword with the type reference that FOLLOWS it, by source
   * offset.
   *
   * The CST hands back `ExtendsModKw`, `ImplementsModKw` and `typeRef` as three flat arrays with no
   * linkage between them. The old code walked them by INDEX, assuming every `:extends` came before
   * every `:implements` -- so `(defclass D :implements I :extends B)` assigned `I` to the extends
   * clause and `B` to the implements clause. Offsets have no such assumption.
   *
   * Shared by `classDecl` and `structDecl` (D11d). A struct had no inheritance clauses at all until
   * D11; giving it a second copy of this would have given it a second copy of the bug to rediscover.
   */
  private pairInheritanceClauses(ctx: any): { extendsNodes: any[]; implementsNodes: any[] } {
    const extendsNodes: any[] = [];
    const implementsNodes: any[] = [];

    const clauses = [
      ...(ctx.ExtendsModKw ?? []).map((k: any) => ({ kind: "extends", at: k.startOffset })),
      ...(ctx.ImplementsModKw ?? []).map((k: any) => ({ kind: "implements", at: k.startOffset })),
    ].sort((a, b) => a.at - b.at);

    const refs = [...(ctx.typeRef ?? [])].sort(
      (a: any, b: any) => a.location.startOffset - b.location.startOffset
    );

    // A keyword owns EVERY typeRef up to the next keyword, not just one.
    //
    // The pairing used to be one-to-one (`for i < clauses.length && i < refs.length`), which reads
    // right and silently dropped interfaces: `:implements A B` is ONE `ImplementsModKw` and TWO
    // typeRefs, so the loop ran once and `B` vanished before any pass could see it. The grammar
    // accepts the form, the checker's own loop walks `node.implements` in full, and the D54 metadata
    // maps over all of them -- every layer downstream was ready for a list that only ever had one
    // element. `(defclass Both :implements A B)` reported `:implements ["A"]`, and
    // `08-generics/06_multiple_interfaces.lisp` was green over exactly that wrong answer, because its
    // golden does not print the list. Gap ledger §14.2.
    for (let i = 0; i < clauses.length; i++) {
      const from = clauses[i].at;
      const to = i + 1 < clauses.length ? clauses[i + 1].at : Infinity;
      for (const r of refs) {
        if (r.location.startOffset < from || r.location.startOffset >= to) continue;
        const ref = this.visit(r);
        const node = this.makeNode(clauses[i].kind, ctx, { type: ref.type, generics: ref.generics });
        (clauses[i].kind === "extends" ? extendsNodes : implementsNodes).push(node);
      }
    }

    return { extendsNodes, implementsNodes };
  }

  classOrInterfaceName(ctx: any): { name: ast.TypeNameNode; generics: ast.TypeNameNode[] } {
    // The type parameters are `genericParam` nodes now, so the class NAME is the only typeName here
    // -- no more `typeNames.slice(1)`.
    const name = ctx.typeName ? this.visit(ctx.typeName[0]) : null;
    const generics = ctx.genericParam
      ? ctx.genericParam.map((g: any) => this.visit(g))
      : [];
    return { name, generics };
  }

  /** A declared type PARAMETER: `T`, or `:out T` / `:in T`. Variance rides on the type-name. */
  genericParam(ctx: any): ast.TypeNameNode {
    const typeName = this.visit(ctx.typeName[0]) as ast.TypeNameNode;
    const modifier = ctx.modifier ? this.visit(ctx.modifier[0]) : undefined;
    const variance = modifier?.modifier;
    // Anything other than :in / :out in this position is not variance. Ignore it rather than
    // recording nonsense; a dedicated diagnostic belongs with the variance rules, not here.
    if (variance === "in" || variance === "out") {
      typeName.variance = variance;
    }
    return typeName;
  }

  /** `Animal`, or `Producer<Animal>` -- an `:extends` / `:implements` target with its arguments. */
  typeRef(ctx: any): { type: ast.TypeNameNode; generics: ast.TypeNode[] } {
    return {
      type: this.visit(ctx.typeName[0]),
      generics: ctx.type ? ctx.type.map((t: any) => this.visit(t)) : [],
    };
  }

  structDecl(ctx: any): ast.StructNode {
    const modifiers = ctx.modifier ? ctx.modifier.map((m: any) => this.visit(m)) : [];
    const name = ctx.typeName ? this.visit(ctx.typeName[0]) : null;
    const { extendsNodes, implementsNodes } = this.pairInheritanceClauses(ctx);
    const body = ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : [];
    return this.makeNode("struct", ctx, {
      name,
      modifiers,
      implements: implementsNodes,
      extends: extendsNodes,
      body,
    });
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
    // `[]`, not `null`, when there are none -- classDecl already emitted `[]` and every consumer
    // does `node.generics && node.generics.length`, so the two frontends and the two declaration
    // forms may as well agree on one empty value.
    let generics: ast.TypeNameNode[] = [];
    if (ctx.classOrInterfaceName) {
      const nameData = this.visit(ctx.classOrInterfaceName[0]);
      name = nameData.name;
      generics = nameData.generics ?? [];
    }
    const implementsRef = ctx.typeRef ? this.visit(ctx.typeRef[0]) : null;
    const implementsType = implementsRef
      ? this.makeNode("implements", ctx, {
          type: implementsRef.type,
          generics: implementsRef.generics,
        })
      : null;
    const body = ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : [];
    return this.makeNode("interface", ctx, {
      name,
      generics,
      modifiers,
      implements: implementsType,
      body,
    });
  }

  /**
   * `(defcast :implicit [c <- Celsius] -> Real …)` -> an ordinary named function (D46/B-3).
   *
   * A conversion is keyed by (source, target), not by a name, so the name is DERIVED here rather than
   * written: `__cast_<source>_to_<target>`. Rewriting at parse time -- the same move `(lo .. hi)` ->
   * `(Range …)` makes below -- means the symbol table, the checker and both emitters treat it as the
   * plain function it is, and two conversions over the same pair collide as an ordinary duplicate
   * declaration instead of needing a bespoke check. `castOf` is how the registry finds them again.
   */
  castExpr(ctx: any): ast.CastNode {
    return this.makeNode("cast", ctx, {
      target: this.visit(ctx.type[0]),
      value: this.visit(ctx.expression[0]),
    });
  }

  castDefDecl(ctx: any): ast.FunctionNode {
    const modifiers = (ctx.modifier ?? []).map((m: any) => this.visit(m));
    const param = this.visit(ctx.parameter[0]);
    const returns = this.visit(ctx.type[0]);
    const body = (ctx.expression ?? []).map((e: any) => this.visit(e));
    const nameOf = (t: any): string => {
      if (!t || typeof t !== "object") return "unknown";
      if (t._type === "type") return nameOf(t.type);
      const n = typeof t.name === "string" ? t.name : t.name?.name;
      return typeof n === "string" ? n : "unknown";
    };
    const source = nameOf(param?.type);
    const target = nameOf(returns);
    const name = this.makeNode("simple-identifier", ctx, { id: `__cast_${source}_to_${target}` });
    return this.makeNode("function", ctx, {
      name,
      async: false,
      generator: false,
      extern: false,
      modifiers,
      params: [param],
      returns,
      body,
      castOf: { source, target },
    });
  }

  typeDefDecl(ctx: any): ast.TypeDefNode {
    const modifiers = ctx.modifier ? ctx.modifier.map((m: any) => this.visit(m)) : [];
    const name = ctx.identifier ? this.visit(ctx.identifier[0]) : null;
    const type = ctx.type ? this.visit(ctx.type[0]) : null;
    // `:satisfies (...)` -- the refinement that makes this a distinct newtype (D46 amend), attached as
    // metadata. A bare deftype (no refinement) stays a transparent alias; the type layer reads this.
    const refinement = ctx.refinementConstraint ? this.visit(ctx.refinementConstraint[0]) : null;
    return this.makeNode("type-def", ctx, { name, type, modifiers, refinement });
  }

  refinementConstraint(ctx: any): ast.RangeRefinementNode | ast.DimensionRefinementNode {
    // D90's dimension form took the other alternative; the parser's GATE already decided which.
    if (ctx.dimensionConstraint) return this.visit(ctx.dimensionConstraint[0]);
    // A range `( lo? .. hi? )` -- STATIC inclusive bounds; a missing side is an OPEN (unbounded) bound.
    const lo = ctx.lo ? this.visit(ctx.lo[0]) : null;
    const hi = ctx.hi ? this.visit(ctx.hi[0]) : null;
    return this.makeNode("range-refinement", ctx, { lo, hi });
  }

  dimensionConstraint(ctx: any): ast.DimensionRefinementNode {
    const op = ctx.Star ? "*" : "/";
    // ONE bucket, so SOURCE ORDER survives -- and order is the whole meaning of `/`. See the parser's
    // note on why `dimensionOperand` is its own rule rather than an inline OR.
    const operands = (ctx.dimensionOperand ?? []).map((o: any) => this.visit(o));
    return this.makeNode("dimension-refinement", ctx, { op, operands });
  }

  /** A unit NAME (a plain string -- see ast.DimensionRefinementNode) or a nested dimension. */
  dimensionOperand(ctx: any): string | ast.DimensionRefinementNode {
    if (ctx.Identifier) return ctx.Identifier[0].image;
    return this.visit(ctx.dimensionConstraint[0]);
  }

  /** `(defmacro ...)` -- parsed so it can be REFUSED by name (LL0023). See ast.MacroDefNode. */
  macroDecl(ctx: any): ast.MacroDefNode {
    const name = ctx.Identifier ? this.makeNode("simple-identifier", ctx, {
      id: ctx.Identifier[0].image,
    }) : undefined;
    const body = ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : [];
    return this.makeNode("macro-def", ctx, { keyword: "defmacro", name, body });
  }

  modifierDefDecl(ctx: any): ast.ModifierDefNode {
    const name = ctx.Identifier[0].image.toLowerCase();
    const params = ctx.parameter ? ctx.parameter.map((p: any) => this.visit(p)) : [];
    const body = ctx.expression ? ctx.expression.map((e: any) => this.visit(e)) : [];
    return this.makeNode("modifier-def", ctx, { name, params, body });
  }

  /** `(defattribute docstring [text <- String])` -- D72. Lowercased like a modifier name, because
   *  that is the namespace it is applied from: `:docstring[…]` reaches D4's same check. */
  attributeDefDecl(ctx: any): ast.AttributeDefNode {
    const name = ctx.Identifier[0].image.toLowerCase();
    const params = ctx.parameter ? ctx.parameter.map((p: any) => this.visit(p)) : [];
    return this.makeNode("attribute-def", ctx, { name, params });
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
  /**
   * The positional expressions of a form, with COMMENTS REMOVED.
   *
   * `if`/`when`/`cond`/`while` assign their parts BY POSITION -- D12 keeps them positional and made
   * only `for` named-clause. A comment parses as an ordinary expression and lands in `ctx.expression`
   * alongside everything else, so it TOOK A SLOT:
   *
   *     (if (x :of String)
   *         ; a note
   *         (console.log "hi"))
   *
   *     ->  then  = the comment
   *         else  = (console.log "hi")
   *
   * The `if` ran INVERTED -- the body fired only when the guard was FALSE -- silently, at exit 0. A
   * comment is the one thing in a program nobody expects to change behaviour, which is exactly why
   * this was invisible.
   *
   * D12 already names this bug class, about `for`: "The old builder walked a flat `expressions` array
   * with a moving index and guessed each clause's role from its POSITION ... that positional shuffle
   * is exactly the bug the audit meant." D12's cure was to make `for`'s roles keyword-based; the
   * forms it left positional kept the disease.
   *
   * Comments are not values and never occupy a slot. One helper, so the four cannot disagree.
   */
  private positionalExpressions(ctx: any): ast.ASTNode[] {
    return (ctx.expression ?? [])
      .map((e: any) => this.visit(e))
      .filter((n: any) => n && n._type !== "comment");
  }

  whenExpr(ctx: any): ast.WhenNode {
    const expressions = this.positionalExpressions(ctx);
    const condition = expressions.length > 0 ? expressions[0] : null;
    const then = expressions.slice(1);
    return this.makeNode("when", ctx, { condition, then });
  }

  ifExpr(ctx: any): ast.IfNode {
    const expressions = this.positionalExpressions(ctx);
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
    const expressions = this.positionalExpressions(ctx);

    // `(:else body)` -- the DEFAULT clause (D12). It parses with no condition and exactly one
    // expression, and is given the condition `true`.
    //
    // SUGAR, deliberately: `(true body)` was never a special case, just a clause whose condition
    // happens to be the literal true. Building `:else` as the same node means codegen, the checker
    // and every golden see one shape and cannot disagree about it -- the spelling is the whole
    // change, which is why this needed no emitter work and moved no golden. It also means `(true ...)`
    // keeps working: D12 names the default's SPELLING, it does not forbid writing the condition out.
    if (ctx.ElseModKw) {
      return this.makeNode("cond-case", ctx, {
        condition: this.makeNode("boolean", ctx, { value: true }),
        body: expressions.length > 0 ? expressions[0] : null,
      });
    }

    const condition = expressions.length > 0 ? expressions[0] : null;
    const body = expressions.length > 1 ? expressions[1] : null;
    return this.makeNode("cond-case", ctx, { condition, body });
  }

  /**
   * D12: `for` clauses are a NAMED, ORDER-FREE bag.
   *
   * The old builder walked a flat `expressions` array with a moving index and guessed each
   * clause's role from its POSITION -- `initial = expressions[i++]`, `condition = expressions[i++]`
   * -- so reordering the clauses silently reassigned them. That positional shuffle is exactly the
   * bug the audit meant by "the for-each feature and the for-each bug are the same code". Roles
   * now come from the keyword, so order cannot change meaning.
   */
  forExpr(ctx: any): ast.ForNode | ast.ForEachNode {
    const clauses: { kind: string; value: any }[] = (ctx.forClause ?? []).map((c: any) =>
      this.visit(c)
    );

    const kinds = clauses.map((c) => c.kind);
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const kind of kinds) {
      if (seen.has(kind)) duplicates.add(kind);
      seen.add(kind);
    }

    // First occurrence wins; the duplicate is reported by SyntaxRulesAstVisitor, not silently
    // merged. Recorded only when malformed, so a well-formed `for` carries no extra field.
    const first = (kind: string) => clauses.find((c) => c.kind === kind)?.value ?? null;
    const duplicateClauses = duplicates.size > 0 ? [...duplicates] : undefined;

    if (seen.has("each")) {
      return this.makeNode("for-each", ctx, {
        variable: first("each"),
        collection: first("from"),
        then: first("then"),
        else: first("else"),
        ...(duplicateClauses ? { duplicateClauses } : {}),
      });
    }

    return this.makeNode("for", ctx, {
      initial: first("init"),
      condition: first("cond"),
      step: first("step"),
      then: first("then"),
      else: first("else"),
      ...(duplicateClauses ? { duplicateClauses } : {}),
    });
  }

  forClause(ctx: any): { kind: string; value: any } {
    if (ctx.EachModKw) return { kind: "each", value: this.visit(ctx.forEachBinding[0]) };

    const value = ctx.expression ? this.visit(ctx.expression[0]) : null;
    if (ctx.InitModKw) return { kind: "init", value };
    if (ctx.CondModKw) return { kind: "cond", value };
    if (ctx.FromModKw) return { kind: "from", value };
    if (ctx.StepModKw) return { kind: "step", value };
    if (ctx.ThenModKw) return { kind: "then", value };
    if (ctx.ElseModKw) return { kind: "else", value };

    throw new Error(`Unknown for clause: ${Object.keys(ctx)}`);
  }

  forEachBinding(ctx: any): any {
    return this.bindingTarget(ctx);
  }

  whileExpr(ctx: any): ast.WhileNode {
    const expressions = this.positionalExpressions(ctx);
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

  // ========================================================================
  // D47 CONDITIONS / RESTARTS
  //
  // All four are REAL AST nodes (not C-only special forms): the JS backend must RECOGNIZE and REFUSE
  // them with a located LL0108 -- a special-form-only path would let JS silently emit a call to a
  // nonexistent runtime fn (silent-wrong). positionalExpressions() drops `;comment` nodes so a comment
  // never steals a positional slot.
  // ========================================================================
  restartCaseExpr(ctx: any): ast.RestartCaseNode {
    // Grammar makes the body mandatory + puts arms in their own subrule, so ctx.expression is exactly
    // the body. Arms carry their OWN expressions inside restartArm's ctx.
    const body = ctx.expression ? this.visit(ctx.expression[0]) : null;
    const arms = ctx.restartArm ? ctx.restartArm.map((a: any) => this.visit(a)) : [];
    return this.makeNode("restart-case", ctx, { body, arms });
  }

  restartArm(ctx: any): ast.RestartArm {
    const name = ctx.Identifier[0].image;
    // The (mandatory) params vector -- its element nodes are the restart's parameter binders.
    const params = ctx.vector ? (this.visit(ctx.vector[0]).values as ast.ASTNode[]) : [];
    const body = this.positionalExpressions(ctx);
    return { name, params, body } as ast.RestartArm;
  }

  handleExpr(ctx: any): ast.HandleNode {
    const body = ctx.expression ? this.visit(ctx.expression[0]) : null;
    const clauses = ctx.handleClause ? ctx.handleClause.map((c: any) => this.visit(c)) : [];
    return this.makeNode("handle", ctx, { body, clauses });
  }

  handleClause(ctx: any): ast.HandleClause {
    const condType = this.visit(ctx.typeName[0]).name;
    const binderVec = ctx.vector ? (this.visit(ctx.vector[0]).values as ast.ASTNode[]) : [];
    const binder = binderVec.length > 0 ? binderVec[0] : undefined;
    const body = this.positionalExpressions(ctx);
    return { condType, binder, body } as ast.HandleClause;
  }

  signalExpr(ctx: any): ast.SignalNode {
    const condition = this.visit(ctx.expression[0]);
    return this.makeNode("signal", ctx, { condition });
  }

  invokeRestartExpr(ctx: any): ast.InvokeRestartNode {
    const name = ctx.Identifier[0].image;
    const args = this.positionalExpressions(ctx);
    return this.makeNode("invoke-restart", ctx, { name, args });
  }

  matchExpr(ctx: any): ast.MatchNode {
    const expression = this.visit(ctx.expression[0]);
    const cases = ctx.matchCase ? ctx.matchCase.map((c: any) => this.visit(c)) : [];
    return this.makeNode("match", ctx, { expression, cases });
  }

  matchCase(ctx: any): ast.MatchCaseNode {
    const pattern = this.visit(ctx.pattern[0]);
    // `:when <expr>` (D26). Labelled `guard`/`body` in the rule so the two expressions never collide.
    const guard = ctx.guard ? this.visit(ctx.guard[0]) : undefined;
    const body = this.visit(ctx.body[0]);

    // D67 -- `r"ca+t" => …` is SUGAR for the `:when` guard that already worked:
    //
    //     s :when (is-full-match r"ca+t" s) => …
    //
    // so it is lowered to exactly that, HERE, at parse time. The desugar pass cannot do it: a
    // synthesized node carries no `_parent`, and the symbol table resolves scope by climbing `_parent`
    // through the PRE-desugar tree -- the wall that forced P3c-1b-ii through a floor builtin. At
    // AstBuilder time the nodes are in the tree before the symbol table is built, so `is-full-match`
    // resolves like any other name and a missing `(import "std/text/regex")` is a plain LL0210 rather
    // than anything special.
    //
    // ANCHORED, not a search: a pattern asserts "x IS this shape", so `r"ca+t"` does not fire against
    // "a caaaat naps". Ruby's searching `when /re/` is the rejected alternative -- a pattern that
    // silently matches a substring is a bug factory. Spell a search `r".*ca+t.*"`.
    if ((pattern as any)?.regexSugar) {
      const subject = this.makeNode("simple-identifier", ctx, { id: "__re" });
      const call = this.makeNode("list", ctx, {
        nodes: [
          this.makeNode("simple-identifier", ctx, { id: "is-full-match" }),
          (pattern as any).constant,
          subject,
        ],
      });
      return this.makeNode("match-case", ctx, {
        pattern: this.makeNode("identifier-pattern", ctx, { id: subject }),
        // An explicit `:when` on a regex arm still applies, and both must hold.
        guard: guard
          ? this.makeNode("list", ctx, {
              nodes: [this.makeNode("simple-identifier", ctx, { id: "&&" }), call, guard],
            })
          : call,
        body,
      });
    }

    return this.makeNode("match-case", ctx, { pattern, guard, body });
  }

  // ========================================================================
  // PATTERNS
  // ========================================================================
  pattern(ctx: any): ast.PatternNode {
    const alternatives = [
      "anyPattern", "restPattern", "functionalPattern", "listPattern", "vectorPattern",
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
    // Shorthand: `{:name :age}` binds each key under its own name. Normalise it into an explicit
    // identifier-pattern right here, so no consumer downstream -- match codegen, destructuring
    // codegen, the symbol table -- has to special-case a missing pattern.
    const pattern = ctx.pattern
      ? this.visit(ctx.pattern[0])
      : this.makeNode("identifier-pattern", ctx, { id: key });
    return this.makeNode("map-pattern-pair", ctx, { key, pattern });
  }

  identifierPattern(ctx: any): ast.IdentifierPatternNode {
    const id = this.visit(ctx.identifier[0]);
    return this.makeNode("identifier-pattern", ctx, { id });
  }

  constantPattern(ctx: any): ast.ConstantPatternNode {
    let constant;
    if (ctx.StringLiteral) {
      // DECODE, like every other string. This sliced the quotes off and stopped, so a match PATTERN
      // kept its escape sequences raw while the identical literal as an EXPRESSION was unescaped:
      //
      //     (== s "\\")                        -> true   (one backslash, correctly decoded)
      //     (match s { "\\" => … })            -> never fired
      //     (match c { "\t" => … })            -> never fired
      //
      // The same escape, two answers, in one language -- which is word for word the defect the
      // `string` builder above carries a comment about having fixed for ITSELF, in the formatted-vs-
      // plain split. The pattern path was never given the same treatment.
      //
      // Silent, and unreachable by inspection: the arm simply never matched, so a `match` over
      // escaped characters fell to its catch-all and produced a plausible wrong answer. It is what a
      // regex engine hits first, since `\` is the one character it must be able to match on.
      constant = this.makeNode("string", ctx, {
        value: this.unescapeString(ctx.StringLiteral[0].image.slice(1, -1)),
      });
    } else if (ctx.RawString) {
      // D67 -- a REGEX pattern. `regexSugar` is a parse-time signal for `matchCase`, which replaces
      // this node entirely; it never reaches a later stage from a match ARM. A raw-string pattern
      // NESTED inside a vector or map pattern has no such rewrite, so the marker survives there and
      // `SyntaxRulesAstVisitor` refuses it -- leaving it would silently mean equality against the
      // pattern's own text, which is the one outcome nobody writing `r"…"` intends.
      return this.makeNode("constant-pattern", ctx, {
        constant: this.makeNode("string", ctx, { value: ctx.RawString[0].image.slice(2, -1) }),
        regexSugar: true,
      });
    } else if (ctx.NilKw) {
      constant = this.makeNode("null", ctx, { keyword: "nil" });
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

  /**
   * `...xs` -- the SPREAD, and it binds by ADJACENCY, exactly as `..` does (D93).
   *
   * The two read as a pair and behaved as a pair only by accident: D88/N4 made `..` tight, so
   * `(0 .. 3)` stopped being a range, while `...` went on accepting `(add3 ... xs)` and `[0 ... xs]`
   * identically to the tight form. Two dot-operators, two answers to the same whitespace question.
   *
   * Same mechanism as `rangeIsTight`. A SPACED `...` is not a spread, and it surfaces as the marker
   * identifier `...`, which `SpreadMustBeAdjacent` (LL0037) reports -- the sibling of `..`'s LL0034,
   * carrying the same explanation.
   *
   * The OPERAND is not carried along with the marker, and that is deliberate: wrapping the pair in a
   * list puts `...` in HEAD position, where the node rule never sees it and the only thing reported
   * is a confusing arity error about the enclosing call. `..` keeps its marker as a MIDDLE element
   * for the same reason. Dropping the operand is safe here precisely because the marker is reported:
   * `..`'s warning against dropping is about a SILENT re-reading, and this one is not silent.
   */
  spreadExpr(ctx: any): ast.ASTNode {
    const expression = this.visit(ctx.expression[0]);
    const dots = ctx.Spread?.[0];
    const operandStart = expression?._location?.start?.offset;

    const tight =
      dots == null || operandStart == null
        ? true // no offsets to judge by: keep the old answer
        : dots.endOffset + 1 === operandStart;

    if (tight) return this.makeNode("spread", ctx, { expression });

    return this.makeNode("simple-identifier", ctx, { id: "..." });
  }
}
