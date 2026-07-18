// HIR -> ESTree. The mechanical backend half: after lowering, control flow is already in statement
// position and value-position conditionals already carry their temps, so this is a structural map
// with NO position analysis, NO return injection, NO copy decisions, NO dispatch (hir-brief.md R6).
// The litmus test: if a case here has to make a judgment call, that judgment belongs in the lowering.
//
// Hard-fail posture (the Kotlin/JS-IR discipline): the switches are exhaustive (TS `never` check) and
// the default THROWS -- an unhandled kind is an internal invariant violation, not a user-reachable
// state. The acorn re-parse (LL0101) and the LL0100 totality net still sit below this in `compile()`.

import type * as ESTree from "estree";
import type * as ast from "../frontend/ast";
import type { HBlock, HExpr, HStmt } from "./nodes";

/**
 * What the emitter is allowed to ask of the legacy JSTransformer. Deliberately narrow: leaves, the nil
 * literal, and the one documented R6 debt (`storeValue` = the D11 copy, dies at R3). Everything else
 * the emitter builds itself.
 */
export interface LegacyLeafEmitter {
  /** Emit an AST subtree as an ESTree expression (JSTransformer.visitExpr). */
  leafExpr(node: ast.ASTNode): ESTree.Expression;
  /** Emit an AST subtree as an ESTree statement (JSTransformer.asStatement over visit). */
  leafStmt(node: ast.ASTNode): ESTree.Statement;
  /** Wrap a stored expression in the D11 value-copy when it may be a struct (JSTransformer.asValue). */
  storeValue(emitted: ESTree.Expression, src: ast.ASTNode): ESTree.Expression;
  /** The runtime nil literal for the D9 bottom value. */
  nilLiteral(src: ast.ASTNode): ESTree.Expression;
  /** A match arm's pattern condition against the scrutinee temp (JSTransformer.generateCondition). */
  patternTest(pattern: ast.PatternNode, scrutName: string): ESTree.Expression;
  /** The pattern variables a match binds, to hoist (findIdentifiersToDefine). */
  patternVars(match: ast.MatchNode): string[];
}

/** Mirrors ESTreeBuilder.loc: a located source range, or null when the node has no location. */
function loc(src: ast.ASTNode): ESTree.SourceLocation | null {
  const l = src?._location;
  if (!l) return null;
  return {
    source: l.source,
    start: { line: l.start.line, column: l.start.column },
    end: { line: l.end.line, column: l.end.column },
  } as ESTree.SourceLocation;
}

function ident(name: string, src: ast.ASTNode): ESTree.Identifier {
  return { type: "Identifier", name, loc: loc(src) } as ESTree.Identifier;
}

export class EmitHirToEstree {
  constructor(private readonly legacy: LegacyLeafEmitter) {}

  emitBlock(block: HBlock): ESTree.Statement[] {
    // Drop EmptyStatements -- an empty pattern-hoist (a match that binds no variables) emits one.
    return block.stmts.map((s) => this.emitStmt(s)).filter((s) => s.type !== "EmptyStatement");
  }

  private emitStmt(h: HStmt): ESTree.Statement {
    switch (h.kind) {
      case "opaque-stmt":
        return this.legacy.leafStmt(h.src);

      case "expr-stmt":
        return {
          type: "ExpressionStatement",
          expression: this.emitExpr(h.expr),
          loc: loc(h.src),
        } as ESTree.ExpressionStatement;

      case "decl-temp":
        return {
          type: "VariableDeclaration",
          kind: h.init ? "const" : "let",
          declarations: [
            {
              type: "VariableDeclarator",
              id: ident(h.name, h.src),
              init: h.init ? this.emitExpr(h.init) : null,
              loc: loc(h.src),
            } as ESTree.VariableDeclarator,
          ],
          loc: loc(h.src),
        } as ESTree.VariableDeclaration;

      case "assign-temp": {
        let right = this.emitExpr(h.value);
        if (h.isStore) right = this.legacy.storeValue(right, h.src);
        return {
          type: "ExpressionStatement",
          expression: {
            type: "AssignmentExpression",
            operator: "=",
            left: ident(h.name, h.src),
            right,
            loc: loc(h.src),
          } as ESTree.AssignmentExpression,
          loc: loc(h.src),
        } as ESTree.ExpressionStatement;
      }

      case "if": {
        // The CONSEQUENT is ALWAYS braced -- dangling-else (CF2) is impossible by construction. The
        // ALTERNATE is braced too, EXCEPT a lone nested `if`, which emits bare as `else if` (matching
        // legacy visitCond/visitIf, so a cond chain stays an `else if` chain rather than `else { if }`).
        // Unwrapping is safe only for a statement legal un-braced -- an `if` is; a declaration is not.
        let alternate: ESTree.Statement | null = null;
        if (h.else) {
          alternate =
            h.else.stmts.length === 1 && h.else.stmts[0].kind === "if"
              ? this.emitStmt(h.else.stmts[0])
              : ({ type: "BlockStatement", body: this.emitBlock(h.else), loc: loc(h.src) } as ESTree.BlockStatement);
        }
        return {
          type: "IfStatement",
          test: this.emitExpr(h.test),
          consequent: { type: "BlockStatement", body: this.emitBlock(h.then), loc: loc(h.src) } as ESTree.BlockStatement,
          alternate,
          loc: loc(h.src),
        } as ESTree.IfStatement;
      }

      case "block":
        return { type: "BlockStatement", body: this.emitBlock(h.body), loc: loc(h.src) } as ESTree.BlockStatement;

      case "hoist": {
        const names = this.legacy.patternVars(h.src as ast.MatchNode);
        if (names.length === 0) return { type: "EmptyStatement", loc: loc(h.src) } as ESTree.EmptyStatement;
        return {
          type: "VariableDeclaration",
          kind: "let",
          declarations: names.map(
            (n) => ({ type: "VariableDeclarator", id: ident(n, h.src), init: null, loc: loc(h.src) } as ESTree.VariableDeclarator)
          ),
          loc: loc(h.src),
        } as ESTree.VariableDeclaration;
      }

      case "return": {
        let arg: ESTree.Expression | null = h.value ? this.emitExpr(h.value) : null;
        if (arg && h.isStore) arg = this.legacy.storeValue(arg, h.src);
        return { type: "ReturnStatement", argument: arg, loc: loc(h.src) } as ESTree.ReturnStatement;
      }

      default: {
        const never: never = h;
        throw new Error(`HIR emit: unhandled statement kind '${(never as any).kind}'`);
      }
    }
  }

  private emitExpr(h: HExpr): ESTree.Expression {
    switch (h.kind) {
      case "opaque-expr":
        return this.legacy.leafExpr(h.src);

      case "nil":
        return this.legacy.nilLiteral(h.src);

      case "temp":
        return ident(h.name, h.src);

      case "ternary":
        return {
          type: "ConditionalExpression",
          test: this.emitExpr(h.test),
          consequent: this.emitExpr(h.then),
          alternate: this.emitExpr(h.else),
          loc: loc(h.src),
        } as ESTree.ConditionalExpression;

      case "seq":
        return {
          type: "SequenceExpression",
          expressions: h.exprs.map((e) => this.emitExpr(e)),
          loc: loc(h.src),
        } as ESTree.SequenceExpression;

      case "pattern-test": {
        const cond = this.legacy.patternTest(h.pattern, h.scrutName);
        if (!h.guard) return cond;
        // `:when` (D26): ANDed AFTER the pattern so the guard sees the bindings the pattern made.
        return {
          type: "LogicalExpression",
          operator: "&&",
          left: cond,
          right: this.legacy.leafExpr(h.guard),
          loc: loc(h.src),
        } as ESTree.LogicalExpression;
      }

      default: {
        const never: never = h;
        throw new Error(`HIR emit: unhandled expression kind '${(never as any).kind}'`);
      }
    }
  }
}
