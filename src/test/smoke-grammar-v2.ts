#!/usr/bin/env ts-node
/**
 * grammar_v2 (Chevrotain) smoke test.
 *
 * NOT a full corpus diff against the PEG frontend -- that's Phase 2b, deferred. This just
 * proves the ported lexer/parser/AST-builder are internally consistent on a handful of
 * hand-written snippets covering the constructs the port touches.
 *
 * Parser construction used to take ~4 minutes here (maxLookahead: 3 over ~90 mutually-recursive
 * rules -- Chevrotain's lookahead-automaton construction is superlinear in k, and it does not
 * persist across process boundaries, so every process paid it fresh). Phase 2c dropped the
 * grammar to maxLookahead: 2, which is ~1200x cheaper and still validates clean; see the comment
 * on the `super(...)` config in grammar_v2/Parser.ts. The whole script now runs in ~1s.
 *
 * It still pays construction exactly once for all 8 snippets rather than per snippet -- keep it
 * that way if k ever has to go back up.
 *
 * Usage: npm run test:grammar-v2-smoke
 */
import { LLangLexer } from "../compiler/frontend/grammar_v2/tokens";

interface SmokeCase {
  name: string;
  source: string;
  check: (result: { tokens: any[]; ast: any }) => void;
}

// `parser`/`LLangAstBuilder` are loaded via a deferred require() inside main(), not a static
// top-level import -- a static import would trigger Parser.ts's module-level
// `export const parser = new LLangParser()` during module resolution, before any of this
// script's own code runs, making the ~4min construction cost impossible to time or report
// honestly from here.
let parser: any;
let LLangAstBuilder: any;

function parse(source: string): { tokens: any[]; ast: any } {
  const lexResult = LLangLexer.tokenize(source);
  if (lexResult.errors.length > 0) {
    throw new Error(`Lex error: ${lexResult.errors.map((e: any) => e.message).join("; ")}`);
  }
  parser.input = lexResult.tokens;
  const cst = parser.program();
  if (parser.errors.length > 0) {
    throw new Error(`Parse error: ${parser.errors.map((e: any) => e.message).join("; ")}`);
  }
  const builder = new LLangAstBuilder("smoke-test");
  const ast = builder.visit(cst);
  return { tokens: lexResult.tokens, ast };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// A conventionally-parenthesized top-level form -- e.g. (let x 5) -- has its outer parens
// consumed by the generic `list` CST rule before the inner keyword (LetKw, DefClassKw, ...)
// is even reached, since none of the special-form alternatives consume their own wrapping
// parens (they rely on an enclosing list/body loop to do that). The result is a redundant
// single-child `list` node wrapping the real declaration -- the same "List-Wrapped
// Declarations" quirk already documented for the current PEG frontend. Unwrap it generically
// rather than hardcoding a fixed nesting depth.
function unwrapList(node: any): any {
  while (node && node._type === "list" && node.nodes.length === 1) {
    node = node.nodes[0];
  }
  return node;
}

function tokenNames(tokens: any[]): string[] {
  return tokens.map((t) => t.tokenType.name);
}

const CASES: SmokeCase[] = [
  {
    name: "longer_alt fix: (let nullable 1)",
    source: "(let nullable 1)",
    check: ({ tokens }) => {
      const names = tokenNames(tokens);
      assert(!names.includes("NilKw"), `NilKw leaked into ${names.join(" ")}`);
      assert(
        names.join(" ") === "LParen LetKw Identifier IntegerNumber RParen",
        `got ${names.join(" ")}`
      );
    },
  },
  {
    // The D14 longer_alt class, for OPERATORS. `**`/`++`/`--`/`//` are built from a single-char
    // operator token (`Star`/`Plus`/`Minus`/`Slash`) whose pattern excludes only a following `=`,
    // not a following copy of itself -- so each lexed as TWO tokens. `||`/`&&` escaped because their
    // patterns DO exclude their own double; `<>`/`<|` escaped because `LAngle` already carries
    // `longer_alt: OperatorIdent`. So `(fn :operator ** ...)` died at the parser ("Expecting LBracket
    // but found '*'"), and `(-- 5)` silently lexed as `(- - 5)` and folded to NaN.
    name: "longer_alt: a doubled operator lexes as ONE OperatorIdent, not two single-char tokens",
    source: "(** 2 3) (++ 1) (-- 5)",
    check: ({ tokens }) => {
      const names = tokenNames(tokens);
      assert(
        names.join(" ") ===
          "LParen OperatorIdent IntegerNumber IntegerNumber RParen " +
          "LParen OperatorIdent IntegerNumber RParen " +
          "LParen OperatorIdent IntegerNumber RParen",
        `got ${names.join(" ")} -- each of **/++/-- must be one OperatorIdent`
      );
    },
  },
  {
    // The exact crash: a doubled-char operator NAME in a `:operator` definition. The name lexed as
    // `Star Star`, the def rule read `Star` as the name and then demanded `[`, hit the second `Star`.
    name: "longer_alt: (fn :operator ** ...) parses instead of 'Expecting LBracket'",
    source: "(fn :operator ** [a <- Int b <- Int] -> Int (return a))",
    check: ({ ast }) => {
      assert(!!ast && Array.isArray(ast.program), "a doubled-char operator name must parse");
    },
  },
  {
    // GUARD: RAngle must NOT get `longer_alt: OperatorIdent`, or nested generics close (`>>`) would
    // lex as one OperatorIdent and the generics rule -- which wants two RAngle -- would break.
    name: "longer_alt guard: nested generics still close with two RAngle",
    source: "(fn f [x <- Map<Int List<Int>>] -> Int (return 0))",
    check: ({ tokens }) => {
      const names = tokenNames(tokens);
      const raCount = names.filter((n) => n === "RAngle").length;
      assert(raCount === 2, `nested generics must close with two RAngle, got ${raCount} in ${names.join(" ")}`);
    },
  },
  {
    name: "case-sensitivity fix: DEFCLASS vs defclass",
    source: "(DEFCLASS Foo) (defclass Foo)",
    check: ({ tokens }) => {
      const names = tokenNames(tokens);
      // First form: (DEFCLASS Foo) -> LParen Identifier Identifier RParen
      assert(names[1] === "Identifier", `uppercase DEFCLASS should lex as Identifier, got ${names[1]}`);
      // Second form starts after the first RParen
      const secondStart = names.indexOf("RParen") + 1;
      assert(
        names[secondStart + 1] === "DefClassKw",
        `lowercase defclass should lex as DefClassKw, got ${names[secondStart + 1]}`
      );
    },
  },
  {
    name: "generics lex as distinct tokens: (new Box<Int> 42)",
    source: "(new Box<Int> 42)",
    check: ({ tokens }) => {
      const names = tokenNames(tokens);
      assert(
        names.join(" ") ===
          "LParen Identifier Identifier LAngle Identifier RAngle IntegerNumber RParen",
        `got ${names.join(" ")} -- Box<Int> must lex as 6 distinct tokens, not one mangled identifier`
      );
    },
  },
  {
    // Octal is `0o17` as of D71. It was `017` here, which pinned the bare leading-zero form the spec
    // rejects by name -- and which meant 15. That spelling now lexes as an ordinary integer so the
    // leading zero can be refused with a location (LL0030, pinned in 90-diagnostics); this case
    // pins the replacement.
    name: "all 7 numeric literal forms",
    source: "(let nums (list 42 3.14 0xFF 0b1010 0o17 1/3 3.0+4.0i))",
    check: ({ ast }) => {
      const variable = unwrapList(ast.program[0]);
      const listCall = variable.value; // (list ...) -- a real multi-child call, not unwrapped
      const elementTypes = listCall.nodes.slice(1).map((n: any) => n._type);
      assert(
        elementTypes.join(",") ===
          [
            "integer-number", "float-number", "hex-number", "binary-number",
            "octal-number", "fraction-number", "complex-number",
          ].join(","),
        `got ${elementTypes.join(",")}`
      );
    },
  },
  {
    // D71 digit separators, across every radix that admits them, plus the value each carries.
    name: "digit separators lex per radix and strip to the value",
    source: "(let nums (list 1_000_000 1_250.75 0xDEAD_BEEF 0b1010_1010 0o1_7))",
    check: ({ ast }) => {
      const variable = unwrapList(ast.program[0]);
      const nodes = variable.value.nodes.slice(1);
      const got = nodes.map((n: any) => `${n._type}=${n.value}`).join(",");
      assert(
        got ===
          [
            "integer-number=1000000", "float-number=1250.75", "hex-number=3735928559",
            "binary-number=170", "octal-number=15",
          ].join(","),
        `got ${got}`
      );
    },
  },
  {
    name: "formatted string interpolation mode push/pop",
    source: '(let greeting f"Hello, {name}!")',
    check: ({ ast }) => {
      const variable = unwrapList(ast.program[0]);
      const value = variable.value;
      assert(value._type === "formatted-string", `expected formatted-string, got ${value._type}`);
    },
  },
  {
    name: "class with :extends",
    source: "(defclass Box :extends Shape (fn init [] nil))",
    check: ({ ast }) => {
      const node = unwrapList(ast.program[0]);
      assert(node._type === "class", `expected class, got ${node._type}`);
      assert(node.extends.length === 1, `expected 1 extends entry, got ${node.extends.length}`);
    },
  },
  {
    name: "for-each",
    source: "(for :each x :from (list 1 2 3) :then (println x))",
    check: ({ ast }) => {
      const node = unwrapList(ast.program[0]);
      assert(node._type === "for-each", `expected for-each, got ${node._type}`);
      assert(node.variable != null, "variable should be present");
      assert(node.collection != null, "collection should be present");
      assert(node.then != null, "then should be present");
    },
  },
  {
    name: "async fn + await (D14: previously unwritable, no AwaitKw existed)",
    source: "(async fn f [] (await p))",
    check: ({ ast }) => {
      const node = unwrapList(ast.program[0]);
      assert(node._type === "function", `expected function, got ${node._type}`);
      assert(node.async === true, "async flag should be true");
      const bodyStmt = unwrapList(node.body[0]);
      assert(bodyStmt._type === "await", `expected await body, got ${bodyStmt._type}`);
    },
  },
  {
    // The D14 bug class again, and it was still live: a token that must defer to a longer
    // `Identifier` match and does not.
    //
    // `Underscore`'s lookahead was `/_(?![a-zA-Z0-9])/` -- which omits `_` ITSELF. So in `__x` the
    // first `_` is followed by `_`, not by an alphanumeric, the lookahead passes, and `Underscore`
    // (which sits BEFORE `Identifier` in the token array) wins. The identifier is shredded:
    //
    //     (let __x 1)     grammar_v2: "Expecting RParen but found '_'"
    //                     peg:        fine
    //
    // A FRONTEND DIVERGENCE, live for anyone writing `__private` or `__init` -- and it is exactly why
    // the old REPL was dead on the first keystroke: its boundary marker was named `__repl_marker`.
    // Cured the way D14 cured every keyword: `longer_alt: Identifier`.
    name: "`__x` lexes as an identifier, not a shredded wildcard (inbox #1)",
    source: "(let __x 1)",
    check: ({ ast }) => {
      const node = unwrapList(ast.program[0]);
      assert(node._type === "variable", `expected variable, got ${node._type}`);
      assert(node.name?.id === "__x", `expected name '__x', got ${JSON.stringify(node.name?.id)}`);
    },
  },
  {
    // ...and a BARE `_` must still be the match wildcard. The cure must not swallow the token it was
    // protecting: there is no longer `Identifier` match for a lone `_`, so `longer_alt` never fires.
    name: "a bare `_` is still the match wildcard (guard)",
    source: '(match v { 1 => "one" _ => "other" })',
    check: ({ ast }) => {
      const node = unwrapList(ast.program[0]);
      assert(node._type === "match", `expected match, got ${node._type}`);
      assert(node.cases?.length === 2, `expected 2 cases, got ${node.cases?.length}`);
    },
  },
  {
    // `_location.end.offset` is EXCLUSIVE -- one past the last character, the way `slice` means it.
    //
    // It used to be Chevrotain's `endOffset` verbatim, which is INCLUSIVE, while the PEG emitted an
    // exclusive one. The two frontends disagreed about what the FIELD MEANS:
    //
    //     (let x 10)      grammar_v2:  list = 0..9    INCLUSIVE
    //                     peg:         list = 0..11   EXCLUSIVE
    //
    // `AstProvider.getSource` slices `[start, end)`. So it was right under the PEG and TRUNCATED EVERY
    // DIAGNOSTIC'S SOURCE EXCERPT BY ONE CHARACTER under grammar_v2 -- the default. It printed
    // `(let x <- Int "str"` with the closing paren missing, which reads as a wrapping artefact, which
    // is how it hid in plain sight. The frontend-diff harness (retired with the PEG in Pb) could never
    // have caught it either: it compared node shapes and ignored `_location` entirely.
    //
    // Slicing the form back out of its own source is the invariant, and it is the one that matters --
    // it is what `getSource` does.
    name: "`end.offset` is EXCLUSIVE: a node slices back to its own source (inbox #8)",
    source: "(let x 10)",
    check: ({ ast }) => {
      const src = "(let x 10)";
      const list = ast.program[0];
      const { start, end } = list._location;
      const sliced = src.slice(start.offset, end.offset);
      assert(
        sliced === src,
        `slicing [start, end) must yield the whole form. got ${JSON.stringify(sliced)}, want ${JSON.stringify(src)}`
      );
    },
  },
  {
    // A `:keyword` CLAUSE on a head that does not declare it is D95's deferred restriction, and until
    // 2026-07-30 it was reported as `Expecting token of type --> RParen <-- but found --> ':then' <--`
    // -- accurate, useless, and identical to what a stray brace says. Nothing in it names the rule.
    //
    // Driven through the REAL parser rather than a synthesized error, so the case cannot drift from
    // what a user actually gets: it re-parses a failing source and hands the parser's own error and
    // token to the same explainer `AstProvider` calls.
    name: "a :keyword clause on a user head is explained, not reported as `RParen`",
    source: "(let x 1)", // parses; the assertion below drives its own source
    check: () => {
      const { explainParseError } = require("../compiler/frontend/AstProvider");
      const failing = LLangLexer.tokenize("(myform :then 1)");
      parser.input = failing.tokens;
      parser.program();
      assert(parser.errors.length > 0, "`(myform :then 1)` must not parse -- that is the restriction");
      const e = parser.errors[0];
      const msg: string = explainParseError(e, (e as any).token);
      assert(msg.includes("D95"), `must name the ruling it is enforcing. got: ${msg}`);
      assert(msg.includes("defmacro"), `must name the tier that CAN spell this today. got: ${msg}`);
      assert(msg.includes(":then"), `must quote the clause the user wrote. got: ${msg}`);
      // The parser's own text is kept, bracketed: it is what a bug report needs and what a reader
      // comparing against Chevrotain's docs will look for.
      assert(msg.includes("[parser:"), `must retain the raw parser message. got: ${msg}`);
    },
  },
  {
    // The GUARD on the case above: only a clause marker is re-explained. An ordinary parse error must
    // arrive verbatim, or the special case has quietly become the general one -- which would be worse
    // than the message it replaced, since every unbalanced paren would blame a keyword.
    name: "an ordinary parse error is passed through untouched",
    source: "(let x 1)",
    check: () => {
      const { explainParseError } = require("../compiler/frontend/AstProvider");
      const failing = LLangLexer.tokenize("(console.log 1");
      parser.input = failing.tokens;
      parser.program();
      assert(parser.errors.length > 0, "`(console.log 1` must not parse");
      const e = parser.errors[0];
      const msg: string = explainParseError(e, (e as any).token);
      assert(msg === e.message, `an unbalanced paren must read exactly as the parser said. got: ${msg}`);
    },
  },
];

function main() {
  console.log(`Constructing grammar_v2 parser...`);
  const constructStart = Date.now();
  ({ parser } = require("../compiler/frontend/grammar_v2/Parser"));
  ({ LLangAstBuilder } = require("../compiler/frontend/grammar_v2/AstBuilder"));
  console.log(`Parser ready after ${Math.round((Date.now() - constructStart) / 1000)}s.\n`);

  let passed = 0;
  const failures: string[] = [];

  for (const c of CASES) {
    try {
      const result = parse(c.source);
      c.check(result);
      console.log(`  PASS  ${c.name}`);
      passed++;
    } catch (e: any) {
      console.log(`  FAIL  ${c.name}`);
      console.log(`        ${e.message}`);
      failures.push(c.name);
    }
  }

  console.log(`\n${passed}/${CASES.length} passed`);
  if (failures.length > 0) {
    console.log(`Failed: ${failures.join(", ")}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
