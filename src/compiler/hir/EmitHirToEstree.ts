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
  /** Materialize a reference atom (HRef) -- the JS identifier policy: encoding, import-inlining, and
   *  runtime-shim registration. A per-backend seam (an LLVM backend would mangle a symbol instead). */
  emitRef(node: ast.ASTNode): ESTree.Expression;
  /** Materialize a resolved `:extension` call (HExtCall): re-visit the `obj.method` head for the
   *  RECEIVER expression, and map the SOURCE `fnName` to the EMITTED name (import-inlining / encoding).
   *  A per-backend seam -- the JS `emittedExtensionName` / member-object emission. */
  emitExtCall(head: ast.ASTNode, fnName: string): { name: string; receiver: ESTree.Expression };
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
  /** Assemble a for-each (D11 per-iteration copy, D16 destructuring, `__ll_map_copy_each`) over the
   *  HIR-emitted collection / body / else (JSTransformer.assembleForEach). */
  emitForEach(node: ast.ASTNode, collection: ESTree.Expression, bodyStmt: ESTree.Statement, elseFor: ESTree.Statement | null): ESTree.Statement;
  /** The let/mut declaration (destructuring / const-vs-let / D11 copy) over the HIR-emitted init. */
  emitVarDecl(node: ast.ASTNode, initES: ESTree.Expression | null): ESTree.Statement;
  /** A simple `target = <rhs>` (write target + D11 copy) over the HIR-emitted rhs. */
  emitAssign(node: ast.ASTNode, rhsES: ESTree.Expression): ESTree.Expression;
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

      case "var-decl":
        return this.legacy.emitVarDecl(h.src, h.init ? this.emitExpr(h.init) : null);

      case "user-assign":
        return {
          type: "ExpressionStatement",
          expression: this.legacy.emitAssign(h.src, this.emitExpr(h.rhs)),
          loc: loc(h.src),
        } as ESTree.ExpressionStatement;

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

      case "while":
        return {
          type: "WhileStatement",
          test: this.emitExpr(h.test),
          body: { type: "BlockStatement", body: this.emitBlock(h.body), loc: loc(h.src) } as ESTree.BlockStatement,
          loc: loc(h.src),
        } as ESTree.WhileStatement;

      case "for": {
        const stmts: ESTree.Statement[] = [...this.emitBlock(h.init)];
        stmts.push({
          type: "ForStatement",
          init: null,
          test: h.test ? this.emitExpr(h.test) : null,
          update: h.update ? this.emitExpr(h.update) : null,
          body: { type: "BlockStatement", body: this.emitBlock(h.body), loc: loc(h.src) } as ESTree.BlockStatement,
          loc: loc(h.src),
        } as ESTree.ForStatement);
        if (h.elseBlock) stmts.push(...this.emitBlock(h.elseBlock));
        return stmts.length === 1
          ? stmts[0]
          : ({ type: "BlockStatement", body: stmts, loc: loc(h.src) } as ESTree.BlockStatement);
      }

      case "for-each": {
        const collectionES = this.emitExpr(h.collection);
        const bodyStmt = { type: "BlockStatement", body: this.emitBlock(h.body), loc: loc(h.src) } as ESTree.BlockStatement;
        const elseFor = h.elseBlock
          ? ({ type: "BlockStatement", body: this.emitBlock(h.elseBlock), loc: loc(h.src) } as ESTree.BlockStatement)
          : null;
        return this.legacy.emitForEach(h.src, collectionES, bodyStmt, elseFor);
      }

      case "try": {
        const catchVarId = ident(h.catchVar, h.src);
        const errBinding = (name: ast.ASTNode | undefined): ESTree.Statement[] =>
          name
            ? [
                {
                  type: "VariableDeclaration",
                  kind: "const",
                  declarations: [
                    { type: "VariableDeclarator", id: this.legacy.leafExpr(name), init: catchVarId } as ESTree.VariableDeclarator,
                  ],
                  loc: loc(h.src),
                } as ESTree.VariableDeclaration,
              ]
            : [];
        let handler: ESTree.CatchClause | null = null;
        if (h.catches.length > 0) {
          const def = h.catches.find((c) => !c.filterTypeName);
          let chainTail: ESTree.Statement = def
            ? ({ type: "BlockStatement", body: [...errBinding(def.errorName), ...this.emitBlock(def.body)], loc: loc(h.src) } as ESTree.BlockStatement)
            : ({ type: "ThrowStatement", argument: catchVarId, loc: loc(h.src) } as ESTree.ThrowStatement);
          const filtered = h.catches.filter((c) => c.filterTypeName);
          for (let i = filtered.length - 1; i >= 0; i--) {
            const c = filtered[i];
            chainTail = {
              type: "IfStatement",
              test: {
                type: "BinaryExpression",
                operator: "instanceof",
                left: catchVarId,
                right: { type: "Identifier", name: c.filterTypeName! } as ESTree.Identifier,
              } as ESTree.BinaryExpression,
              consequent: { type: "BlockStatement", body: [...errBinding(c.errorName), ...this.emitBlock(c.body)], loc: loc(h.src) } as ESTree.BlockStatement,
              alternate: chainTail,
              loc: loc(h.src),
            } as ESTree.IfStatement;
          }
          handler = {
            type: "CatchClause",
            param: catchVarId,
            body: { type: "BlockStatement", body: [chainTail], loc: loc(h.src) } as ESTree.BlockStatement,
          } as ESTree.CatchClause;
        }
        return {
          type: "TryStatement",
          block: { type: "BlockStatement", body: this.emitBlock(h.tryBlock), loc: loc(h.src) } as ESTree.BlockStatement,
          handler,
          finalizer: h.finalizer ? ({ type: "BlockStatement", body: this.emitBlock(h.finalizer), loc: loc(h.src) } as ESTree.BlockStatement) : null,
          loc: loc(h.src),
        } as ESTree.TryStatement;
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

      case "literal":
        // Modeled atom: build the Literal directly -- byte-identical to ESTreeBuilder.literal, no leaf.
        return { type: "Literal", value: h.value, loc: loc(h.src) } as ESTree.Literal;

      case "ref":
        // Modeled atom: JS materializes the reference (its identifier policy) via the per-backend hook.
        return this.legacy.emitRef(h.src);

      case "free-call":
        // Resolved dispatch (classifyCall): build the call directly -- byte-identical to
        // ESTreeBuilder.callExpression -- with no re-dispatch back through the legacy call path.
        return {
          type: "CallExpression",
          callee: this.emitExpr(h.callee),
          arguments: h.args.map((a) => this.emitExpr(a)),
          optional: false,
          loc: loc(h.src),
        } as ESTree.CallExpression;

      case "ext-call": {
        // Resolved `:extension` dispatch (classifyCall): `obj.method(a)` -> `extFn(obj, a)`. The JS hook
        // supplies the receiver + the emitted extension name (import-inlining); args are HIR-emitted.
        // Byte-identical to the emitter's ext branch: callExpression(identifier(extFn), [recv, ...args]).
        const ext = this.legacy.emitExtCall(h.head, h.fnName);
        return {
          type: "CallExpression",
          callee: { type: "Identifier", name: ext.name, loc: loc(h.src) } as ESTree.Identifier,
          arguments: [ext.receiver, ...h.args.map((a) => this.emitExpr(a))],
          optional: false,
          loc: loc(h.src),
        } as ESTree.CallExpression;
      }

      case "method-call":
        // Resolved method dispatch (classifyCall): `obj.method(a)` stays the direct member call. The
        // member callee is the legacy `leafExpr` of the head (visitExpr -- the JS receiver/member policy:
        // `this`, encoding, import-inlining); args are HIR-emitted. Byte-identical to the emitter's
        // callExpression(visitExpr(head), args), with no re-dispatch back through the legacy call path.
        return {
          type: "CallExpression",
          callee: this.legacy.leafExpr(h.head),
          arguments: h.args.map((a) => this.emitExpr(a)),
          optional: false,
          loc: loc(h.src),
        } as ESTree.CallExpression;

      case "operator":
        // Resolved operator dispatch (classifyCall). On JS an operator IS a shim call: `leafExpr(head)`
        // (visitExpr) encodes the operator to its shim identifier (`+` -> `_2b`) AND registers the shim,
        // exactly as the emitter's callee did; args are HIR-emitted. Byte-identical to the emitter's
        // callExpression(visitExpr(head), args). `h.op` rides the node for the native backend, unused here.
        return {
          type: "CallExpression",
          callee: this.legacy.leafExpr(h.head),
          arguments: h.args.map((a) => this.emitExpr(a)),
          optional: false,
          loc: loc(h.src),
        } as ESTree.CallExpression;

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

      case "vector":
        // Fully inverted: build the array here, emitting each element via emitExpr (so a ternary/temp
        // element is handled by the HIR, never legacy asExpression) and applying the D11 element copy.
        return {
          type: "ArrayExpression",
          elements: h.elements.map((e) => this.legacy.storeValue(this.emitExpr(e), e.src)),
          loc: loc(h.src),
        } as ESTree.ArrayExpression;

      case "matrix":
        return {
          type: "ArrayExpression",
          elements: h.rows.map(
            (row) =>
              ({
                type: "ArrayExpression",
                elements: row.map((e) => this.legacy.storeValue(this.emitExpr(e), e.src)),
              } as ESTree.ArrayExpression)
          ),
          loc: loc(h.src),
        } as ESTree.ArrayExpression;

      case "map":
        return {
          type: "ObjectExpression",
          properties: h.entries.map(
            (e) =>
              ({
                type: "Property",
                // D13: a `:identifier` key is a STRING, unmangled; a computed key emits via emitExpr.
                key:
                  e.keyLiteral !== undefined
                    ? ({ type: "Literal", value: e.keyLiteral, loc: loc(e.src) } as ESTree.Literal)
                    : this.emitExpr(e.key!),
                value: this.legacy.storeValue(this.emitExpr(e.value), e.value.src),
                kind: "init",
                method: false,
                shorthand: false,
                computed: false,
                loc: loc(e.src),
              } as ESTree.Property)
          ),
          loc: loc(h.src),
        } as ESTree.ObjectExpression;

      case "member":
        return {
          type: "MemberExpression",
          object: this.emitExpr(h.object),
          property: this.emitExpr(h.property),
          computed: h.computed,
          optional: false,
          loc: loc(h.src),
        } as ESTree.MemberExpression;

      case "index": {
        // Fold the suffix chain: `.member` -> plain `expr[idx]` (D1 read); a bracket -> checked
        // `__ll_index(expr, idx)` (D9f). Children emit via emitExpr, so a control-flow index works.
        let expr: ESTree.Expression = this.emitExpr(h.base);
        for (const step of h.steps) {
          expr = step.isMember
            ? ({
                type: "MemberExpression",
                object: expr,
                property: this.emitExpr(step.index),
                computed: true,
                optional: false,
                loc: loc(h.src),
              } as ESTree.MemberExpression)
            : ({
                type: "CallExpression",
                callee: { type: "Identifier", name: "__ll_index", loc: loc(h.src) } as ESTree.Identifier,
                arguments: [expr, this.emitExpr(step.index)],
                optional: false,
                loc: loc(h.src),
              } as ESTree.CallExpression);
        }
        return expr;
      }

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
