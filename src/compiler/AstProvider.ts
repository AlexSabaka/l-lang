import fs from "node:fs";
import peggy from "peggy";

import * as ast from "./ast";

const grammar = fs.readFileSync("./compiler/grammar/l-lang.pegjs", {
  encoding: "utf-8",
});

interface CacheEntry {
  ast: ast.ProgramNode;
  source: string;
}

export class AstProvider {
  private cache: Map<string, CacheEntry> = new Map<string, CacheEntry>();
  private parser: peggy.Parser = peggy.generate(grammar);

  load(file: string) {
    if (this.cache.has(file)) {
      return;
    }

    const source = fs.readFileSync(file, { encoding: "utf-8" });
    const ast = this.parser.parse(source, {
      startRule: "Program",
      grammarSource: file,
      cache: true,
    });

    this.cache.set(file, { ast, source });
  }

  getAst(file: string): ast.ProgramNode | undefined {
    if (!this.cache.has(file)) {
      this.load(file);
    }

    return this.cache.get(file)?.ast;
  }

  getSource(location: ast.Location, overhead: number = 0): string {
    if (!this.cache.has(location.source!)) {
      this.load(location.source!);
    }

    const source = this.cache.get(location.source!)?.source ?? "";
    const start = location.start.offset - overhead;
    const end = location.end.offset + overhead;
    const res = source.slice(
      start < 0 ? 0 : start,
      end > source.length ? source.length : end
    );

    return res;
  }
}
