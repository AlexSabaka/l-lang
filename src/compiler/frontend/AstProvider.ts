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
  // Safety check: Parser might return nulls in some edge cases
  if (!node) return;

  node._parent = parent;

  for (const key of ast.getNodeIterableKeys(node)) {
    const value = node[key];

    if (Array.isArray(value)) {
      // Recursively handle nested arrays and ASTNodes
      const processArray = (arr: any) => {
        if (!Array.isArray(arr)) {
          // If it's not an array but an ASTNode, process it
          if (ast.isAstNode(arr)) {
            assignParentNodeReferences(arr as ast.ASTNode, node);
          }
          return;
        }
        arr.forEach((item: any) => {
          if (Array.isArray(item)) {
            // Nested array, recurse
            processArray(item);
          } else if (item && ast.isAstNode(item)) {
            // It's an ASTNode, process it
            assignParentNodeReferences(item as ast.ASTNode, node);
          }
        });
      };
      processArray(value);
    } else if (ast.isAstNode(value)) {
      assignParentNodeReferences(value as ast.ASTNode, node);
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

  /**
   * Loads a file, parses it, and stores it in the cache using the Absolute Path as the key.
   */
  loadFile(filePath: string) {
    if (this.cache.has(filePath)) {
      return;
    }

    // 2. Read from the resolved path
    const source = fs.readFileSync(filePath, { encoding: "utf-8" });
    
    const ast = parse(source, {
      startRule: "Program",
      grammarSource: filePath, // Good: helps source maps map back to absolute path
      cache: true,
    });

    assignParentNodeReferences(ast);

    // 3. Store using the Absolute Path
    this.cache.set(filePath, { ast, source });
  }

  getAst(file: string, basedir?: string): ast.ProgramNode | undefined {
    const filePath = path.resolve(basedir ?? "", file);
    
    if (!this.cache.has(filePath)) {
      this.loadFile(filePath);
    }

    return this.cache.get(filePath)?.ast;
  }

  getSource(location: ast.Location, overhead: number = 0): string {
    // Ensure we are looking up the absolute path
    const filePath = path.resolve(location.source!);
    
    if (!this.cache.has(filePath)) {
      // If we are here, it means we tried to get source for a file we haven't loaded yet?
      // Or location.source is pointing somewhere weird.
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