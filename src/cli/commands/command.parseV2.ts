import fs from "node:fs";

import { LLangLexer } from "../../compiler/frontend/grammar_v2/tokens";
import { parser } from "../../compiler/frontend/grammar_v2/Parser";
import { LLangAstBuilder } from "../../compiler/frontend/grammar_v2/AstBuilder";

/**
 * Standalone entry point for the grammar_v2 (Chevrotain) frontend -- parallel to, not
 * replacing, `transform --stage parse` (the PEG frontend's equivalent). Prints AST JSON to
 * stdout only; deliberately does not write a `.parsed.json` file the way `command.transform.ts`
 * does. Not wired into AstProvider.ts/Context.ts -- this is a fully separate code path.
 */
export function parseV2(file: string) {
  const source = fs.readFileSync(file, "utf-8");

  const lexResult = LLangLexer.tokenize(source);
  if (lexResult.errors.length > 0) {
    console.error("Lex errors:");
    for (const err of lexResult.errors) {
      console.error(`  ${err.message} at line ${err.line}, column ${err.column}`);
    }
    process.exitCode = 1;
    return;
  }

  parser.input = lexResult.tokens;
  const cst = parser.program();
  if (parser.errors.length > 0) {
    console.error("Parse errors:");
    for (const err of parser.errors) {
      console.error(`  ${err.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const builder = new LLangAstBuilder(file);
  const programAst = builder.visit(cst);

  console.log(
    JSON.stringify(
      programAst,
      (k, v) => (k === "_location" || k === "_parent" ? undefined : v),
      2
    )
  );
}
