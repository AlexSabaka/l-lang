import fs from "node:fs";
import * as ast from "./ast";
import path from "node:path";
import { LLangLexer } from "./grammar_v2/tokens";
import { parser as v2Parser } from "./grammar_v2/Parser";
import { LLangAstBuilder } from "./grammar_v2/AstBuilder";

// EXPORTED as of D95: the `defsyntax` expansion stage rebuilds parts of the tree, and every node it
// introduces arrives with no `_parent` at all. That chain is not decoration -- `SymbolTable.scopeOf`
// climbs it to find an enclosing scope, and `UnquoteNeedsQuasiquote` climbs it to decide whether a
// hole has a template. Re-linking after an expansion is the same obligation the parse stage has.
export function assignParentNodeReferences(
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
          } else {
            // A record: `catch` clauses, `handle` clauses and restart `arms` all arrive as arrays of
            // plain objects. See assignParentsInRecord.
            assignParentsInRecord(item, node);
          }
        });
      };
      processArray(value);
    } else if (ast.isAstNode(value)) {
      assignParentNodeReferences(value as ast.ASTNode, node);
    } else {
      assignParentsInRecord(value, node);
    }
  }
}

/**
 * Link parents through a RECORD-shaped field -- a plain object holding child nodes but carrying no
 * `_type`, so `isAstNode` is false and the walk above stepped over it.
 *
 * Four AST fields are shaped that way: `catch` clauses (TryCatchFilter), `handle` clauses
 * (HandleClause), `restart-case` arms (RestartArm) and `deftype :where` constraints. Everything inside
 * them had `_parent === undefined`, and `_parent` is how `SymbolTable.scopeOf` finds the enclosing
 * scope -- so a `catch` binder declared in a function's scope was UNRESOLVABLE from the catch body
 * that uses it. It went unnoticed only because no pass ever walked those bodies to ask.
 */
function assignParentsInRecord(value: any, parent: ast.ASTNode): void {
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (Array.isArray(child)) {
      child.forEach((item: any) => {
        if (item && ast.isAstNode(item)) assignParentNodeReferences(item as ast.ASTNode, parent);
        else assignParentsInRecord(item, parent);
      });
    } else if (child && ast.isAstNode(child)) {
      assignParentNodeReferences(child as ast.ASTNode, parent);
    } else {
      assignParentsInRecord(child, parent);
    }
  }
}

interface CacheEntry {
  ast: ast.ProgramNode;
  source: string;
}

export class AstProvider {
  private cache: Map<string, CacheEntry> = new Map<string, CacheEntry>();

  /**
   * grammar_v2 (Chevrotain): tokenize, parse to a CST, then build the AST.
   *
   * The node shapes were originally kept identical to the PEG's so every pass downstream stayed
   * frontend-agnostic during the cutover. The PEG is gone (D39), so these shapes are now simply
   * THE shapes. `_location` carries {source, start/end {offset,line,column}}; `end.offset` is
   * EXCLUSIVE, which `getSource()` and the source-map emitter both rely on.
   */
  private parseWithGrammarV2(source: string, filePath: string): ast.ProgramNode {
    const lexResult = LLangLexer.tokenize(source);
    if (lexResult.errors.length > 0) {
      const e = lexResult.errors[0];
      throw new Error(
        `${filePath}:${e.line}:${e.column}: cannot tokenize: ${e.message}`
      );
    }

    v2Parser.input = lexResult.tokens;
    const cst = v2Parser.program();
    if (v2Parser.errors.length > 0) {
      const e = v2Parser.errors[0];
      const tok = (e as any).token;
      const where = tok?.startLine ? `${tok.startLine}:${tok.startColumn}` : "?";
      throw new Error(`${filePath}:${where}: ${e.message}`);
    }

    return new LLangAstBuilder(filePath).visit(cst) as ast.ProgramNode;
  }

  private parseSource(source: string, filePath: string): ast.ProgramNode {
    return this.parseWithGrammarV2(source, filePath);
  }

  /**
   * Loads a file, parses it, and stores it in the cache using the Absolute Path as the key.
   */
  loadFile(filePath: string) {
    if (this.cache.has(filePath)) {
      return;
    }

    // 2. Read from the resolved path
    const source = fs.readFileSync(filePath, { encoding: "utf-8" });

    this.loadSource(filePath, source);
  }

  /**
   * Compile a STRING. The entry point the compiler did not have.
   *
   * `loadFile` was the only way in, so there was no "compile this text" path anywhere -- and the REPL
   * therefore **wrote a file to disk on every keystroke-batch**, purely to have something the
   * AstProvider would read. That is the only reason it touched the filesystem at all.
   *
   * `virtualPath` need not exist. It still MATTERS: imports resolve against `path.dirname(currentFile)`
   * (ModuleResolver), and `_location.source` is what every diagnostic points at. So a caller passes the
   * path the text should PRETEND to live at -- for the REPL, the working directory, so that a relative
   * `(import "./x.lisp")` typed at the prompt resolves the way the user expects.
   *
   * OVERWRITES, deliberately. `loadFile` early-returns on a cache hit, so re-reading the same path with
   * new text silently returned the STALE AST -- which is why the REPL could not reuse a Context even if
   * it wanted to, and had to throw the whole thing away per input. Same path, new text, new AST.
   */
  loadSource(virtualPath: string, source: string): ast.ProgramNode {
    const filePath = path.resolve(virtualPath);
    const parsed = this.parseSource(source, filePath);

    assignParentNodeReferences(parsed);

    this.cache.set(filePath, { ast: parsed, source });
    return parsed;
  }

  /** Forget a file, so the next `getAst` re-reads it. The other half of the stale-cache problem. */
  invalidate(filePath: string): void {
    this.cache.delete(path.resolve(filePath));
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