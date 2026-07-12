#!/usr/bin/env ts-node
/**
 * grammar_v2 (Chevrotain) smoke test.
 *
 * NOT a full corpus diff against the PEG frontend -- that's Phase 2b, deferred. This just
 * proves the ported lexer/parser/AST-builder are internally consistent on a handful of
 * hand-written snippets covering the constructs the port touches.
 *
 * Cost warning: constructing the Chevrotain parser (`new LLangParser()`, which happens once
 * at module load via `grammar_v2/Parser.ts`'s `export const parser = new LLangParser()`)
 * takes ~4 minutes. This is inherent to the recovered grammar (maxLookahead: 3 over ~90
 * heavily mutually-recursive rules) -- confirmed present in the original recovered
 * Parser.js/tokens.js, not introduced by the TypeScript port. Chevrotain does not persist
 * this computation across process boundaries, so every fresh process pays it once. This
 * script pays that cost exactly once for all 8 snippets below, not per snippet -- do not
 * restructure this into one-process-per-snippet.
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
    name: "all 7 numeric literal forms",
    source: "(let nums (list 42 3.14 0xFF 0b1010 017 1/3 3.0+4.0i))",
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
    name: "formatted string interpolation mode push/pop",
    source: '(let greeting \'"Hello, {name}!")',
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
];

function main() {
  console.log(`Constructing grammar_v2 parser (this takes ~4 minutes, see file header)...`);
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
