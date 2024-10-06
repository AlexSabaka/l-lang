import fs from "node:fs";
import peggy from "peggy";

import * as ast from "./ast";

const grammar = fs.readFileSync("./compiler/grammar/l-lang.pegjs", {
  encoding: "utf-8",
});

export class AstProvider {
  private cache: Map<string, ast.ProgramNode> = new Map<
    string,
    ast.ProgramNode
  >();
  private parser: peggy.Parser = peggy.generate(grammar);

  get(file: string): ast.ProgramNode | undefined {
    if (this.cache.has(file)) {
      return this.cache.get(file);
    }

    const source = fs.readFileSync(file, { encoding: "utf-8" });
    const ast = this.parser.parse(source, {
      startRule: "Program",
      grammarSource: file,
      cache: true,
    });

    this.cache.set(file, ast);

    return ast as ast.ProgramNode;
  }
}
