import fs from "node:fs";
// import peggy from "peggy";
import { parse } from "./grammar/l-lang"
import * as ast from "./ast";
import path from "node:path";

// const grammar = fs.readFileSync("./compiler/grammar/l-lang.pegjs", {
//   encoding: "utf-8",
// });

function assignParentNodeReferences(
  node: ast.ASTNode,
  parent?: ast.ASTNode
): void {
  node._parent = parent;

  for (const key of ast.getNodeIterableKeys(node)) {
    if (ast.isIterableAstNode(node[key])) {
      node[key].forEach((child: ast.ASTNode) =>
        assignParentNodeReferences(child, node)
      );
    } else if (ast.isAstNode(node[key])) {
      assignParentNodeReferences(node[key] as ast.ASTNode, node);
    }
  }
}

interface CacheEntry {
  ast: ast.ProgramNode;
  source: string;
}

export class AstProvider {
  private cache: Map<string, CacheEntry> = new Map<string, CacheEntry>();
  // private parser: peggy.Parser = peggy.generate(grammar);

  loadFile(file: string, basedir?: string) {
    if (this.cache.has(file)) {
      return;
    }

    const filePath = path.resolve(basedir ?? "", file);
    const source = fs.readFileSync(filePath, { encoding: "utf-8" });
    const ast = parse(source, {
      startRule: "Program",
      grammarSource: filePath,
      cache: true,
    });

    assignParentNodeReferences(ast);

    this.cache.set(filePath, { ast, source });
  }

  getAst(file: string, basedir?: string): ast.ProgramNode | undefined {
    const filePath = path.resolve(basedir ?? "", file);
    if (!this.cache.has(filePath)) {
      this.loadFile(file, basedir);
    }

    return this.cache.get(filePath)?.ast;
  }

  getSource(location: ast.Location, overhead: number = 0): string {
    const filePath = path.resolve(location.source!);
    if (!this.cache.has(filePath)) {
      throw new Error(`File ${filePath} not found in the AST cache`);
    }

    const source = this.cache.get(filePath)?.source ?? "";
    const start = location.start.offset - overhead;
    const end = location.end.offset + overhead;
    const res = source.slice(
      start < 0 ? 0 : start,
      end > source.length ? source.length : end
    );

    return res;
  }
}
