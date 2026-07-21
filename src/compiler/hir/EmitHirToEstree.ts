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
import type { HBlock, HExpr, HPattern, HStmt } from "./nodes";
import { encodeIdentifier } from "../utils/encodeIdentifier";

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
  /** The runtime type test for a `:of` pattern -- `__ll_is_type(v, "T")` and its union/optional
   *  shapes, shared with the expression-position `:of` (JSTransformer.typeTest). `undefined` = the
   *  type is untestable, which the caller reports. */
  patternTypeTest(type: ast.TypeNode, operand: ESTree.Expression, src: ast.ASTNode): ESTree.Expression | undefined;
  /** The constant an enum MEMBER reference folds to (JSTransformer's enumKeys table). */
  enumMemberValue(member: string): string | number | boolean | undefined;
  /** Assemble a for-each (D11 per-iteration copy, D16 destructuring, `__ll_map_copy_each`) over the
   *  HIR-emitted collection / body / else (JSTransformer.assembleForEach). */
  emitForEach(node: ast.ASTNode, collection: ESTree.Expression, bodyStmt: ESTree.Statement, elseFor: ESTree.Statement | null): ESTree.Statement;
  /** The let/mut declaration (destructuring / const-vs-let / D11 copy) over the HIR-emitted init. */
  emitVarDecl(node: ast.ASTNode, initES: ESTree.Expression | null): ESTree.Statement;
  /** A simple `target = <rhs>` (write target + D11 copy) over the HIR-emitted rhs. */
  emitAssign(node: ast.ASTNode, rhsES: ESTree.Expression): ESTree.Expression;
  /** Encode a source name to its emitted JS identifier (encodeIdentifier). A per-backend seam -- the JS
   *  identifier policy for a constructor param's RHS in a field store (HFieldInit). */
  encodeName(name: string): string;
  /** The class-body MEMBERS (markers, fields, constructor, methods, iterable bridge, other) for a class /
   *  struct declaration, built in the class scope with the class-name side effect. The emitter assembles
   *  the ClassDeclaration shell around them from the modeled `name` / `superName`. A per-backend seam --
   *  the JS `ClassBuilder.buildBodyMembers`; a native backend lays out fields/methods instead. */
  emitClassBody(src: ast.ASTNode): Array<ESTree.MethodDefinition | ESTree.PropertyDefinition>;
  /** Finish an assembled class declaration: apply custom `defmodifier` wrapping (a `defmodifier` body is a
   *  runtime decorator, so a modified class becomes a `const` binding) and coerce to a statement. The
   *  remaining legacy post-pass around the modeled shell (JSTransformer.applyModifiersToClass). */
  finishClass(src: ast.ASTNode, decl: ESTree.ClassDeclaration): ESTree.Statement;
  /** The D11 value-copy prologue for a constructor: `p = __ll_copy(p)` for each parameter that may be a
   *  struct (a declared primitive is skipped). A per-backend seam -- the JS `parameterCopyPrologue`. */
  paramCopyPrologue(params: ESTree.Pattern[], types: (ast.TypeNode | undefined)[]): ESTree.Statement[];
  /** Report the default-before-required constructor diagnostic (a defaulted param ahead of a required one).
   *  A legacy hook so the emitter stays free of the diagnostics machinery (JSTransformer.report). */
  reportDefaultBeforeRequired(src: ast.ASTNode, className: string, param: string, plural: boolean, required: string): void;
  /** Report the D47 conditions/restarts refusal (LL0108). The JS backend has no resumable exceptions, so
   *  every restart form refuses -- the mirror of the C backend refusing coroutines. `form` names the
   *  construct (`restart-case` / `handle` / `signal` / `invoke-restart`). A legacy hook so the emitter
   *  stays free of the diagnostics machinery. */
  reportRestartsRefused(src: ast.ASTNode, form: string): void;
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

/** `static <name> = <value>;` -- a class metadata marker (`__ll_name` / `__ll_struct`). Mirrors the
 *  shape JSClassBuilder used: computed:false, static:true, an Identifier key and a Literal value. */
function staticMarker(name: string, value: string | boolean, src: ast.ASTNode): ESTree.PropertyDefinition {
  return {
    type: "PropertyDefinition",
    key: { type: "Identifier", name },
    value: { type: "Literal", value } as ESTree.Literal,
    computed: false,
    static: true,
    loc: loc(src),
  } as ESTree.PropertyDefinition;
}

export class EmitHirToEstree {
  constructor(private readonly legacy: LegacyLeafEmitter) {}

  emitBlock(block: HBlock): ESTree.Statement[] {
    // Drop EmptyStatements -- an empty pattern-hoist (a match that binds no variables) emits one.
    return block.stmts.map((s) => this.emitStmt(s)).filter((s) => s.type !== "EmptyStatement");
  }

  /** Emit a single HIR statement. The entry a non-body caller (JSClassBuilder, building a constructor)
   *  uses to emit a modeled class-body node -- an HFieldInit -- through the one HIR-emit path. */
  emitStatement(h: HStmt): ESTree.Statement {
    return this.emitStmt(h);
  }

  private emitStmt(h: HStmt): ESTree.Statement {
    switch (h.kind) {
      case "opaque-stmt":
        return this.legacy.leafStmt(h.src);

      case "class": {
        // A4 step 2-3: the emitter assembles the ClassDeclaration SHELL from the modeled name / superName,
        // and the metadata MARKERS from sourceName / isStruct (step 3). The remaining body members and the
        // custom-modifier wrapping stay legacy hooks (emitClassBody in the class scope, finishClass for the
        // `defmodifier` wrap). Marker order matches JSClassBuilder: `__ll_name` then `__ll_struct`, first.
        const markers: ESTree.PropertyDefinition[] = [];
        if (h.sourceName != null) markers.push(staticMarker("__ll_name", h.sourceName, h.src));
        if (h.isStruct) markers.push(staticMarker("__ll_struct", true, h.src));
        // A4 step 4: the fields, after the markers and before the constructor. A field is a new home for
        // a value, so a named-struct initializer is D11-copied (`storeValue`); the name + initializer are
        // re-visited by the JS leaf hooks. Visibility is erased (a plain `this.x`, never `#x`; see D11c).
        const fieldDefs: ESTree.PropertyDefinition[] = h.fields.map((f) => ({
          type: "PropertyDefinition",
          key: this.legacy.leafExpr(f.name) as ESTree.PropertyDefinition["key"],
          value: f.valueSrc != null
            ? this.legacy.storeValue(this.legacy.leafExpr(f.valueSrc), f.valueSrc)
            : null,
          computed: false,
          static: f.isStatic,
          loc: loc(f.src),
        }));
        // A4 step 5: the constructor, after the fields and before the methods. The resolved shape (params,
        // super args, field stores, ctor-method calls, and the diagnostic) is on `h.ctor`; the emitter
        // builds the MethodDefinition, with the D11 copy prologue + defaults via legacy hooks and the
        // body statements via the already-modeled HSuperCall / HFieldInit / HCtorMethodCall nodes.
        const ctorDefs: ESTree.MethodDefinition[] = [];
        if (h.ctor) {
          const c = h.ctor;
          const params: ESTree.Pattern[] = c.params.map((p) => {
            const id: ESTree.Identifier = { type: "Identifier", name: this.legacy.encodeName(p.name), loc: loc(h.src) };
            if (p.defaultSrc == null) return id;
            return { type: "AssignmentPattern", left: id, right: this.legacy.leafExpr(p.defaultSrc), loc: loc(h.src) } as ESTree.AssignmentPattern;
          });
          if (c.defaultBeforeRequired) {
            this.legacy.reportDefaultBeforeRequired(h.src, h.name, c.defaultBeforeRequired.param, c.defaultBeforeRequired.plural, c.defaultBeforeRequired.required);
          }
          const body: ESTree.Statement[] = [
            ...this.legacy.paramCopyPrologue(params, c.params.map((p) => p.type)),
            ...(c.hasSuper ? [this.emitStmt({ src: h.src, type: undefined, kind: "super-call", args: c.superArgs } as HStmt)] : []),
            ...c.fieldInits.map((fi) => this.emitStmt({ src: fi.src, type: undefined, kind: "field-init", field: fi.field, paramName: fi.paramName } as HStmt)),
            ...c.ctorMethods.map((m) => this.emitStmt({ src: h.src, type: undefined, kind: "ctor-method-call", method: m } as HStmt)),
          ];
          ctorDefs.push({
            type: "MethodDefinition",
            key: { type: "Identifier", name: "constructor" },
            value: { type: "FunctionExpression", id: null, params, body: { type: "BlockStatement", body }, generator: false, async: false },
            kind: "constructor",
            computed: false,
            static: false,
            loc: loc(h.src),
          });
        }
        const members = [...markers, ...fieldDefs, ...ctorDefs, ...this.legacy.emitClassBody(h.src)];
        const decl: ESTree.ClassDeclaration = {
          type: "ClassDeclaration",
          id: ident(h.name, h.src),
          superClass: h.superName != null ? ident(h.superName, h.src) : null,
          body: { type: "ClassBody", body: members },
          loc: loc(h.src),
        };
        return this.legacy.finishClass(h.src, decl);
      }

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
        const names = h.names.map(encodeIdentifier);
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
        if (arg && h.copies) arg = this.legacy.storeValue(arg, h.src);
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

      case "field-init":
        // A4: a constructor field store `this.<field> = <param>`. The field name is materialized by the
        // JS `leafExpr` (encoding); the RHS param name by the `encodeName` hook. Byte-identical to the
        // raw store JSClassBuilder built. No `loc` -- matching the synthesized constructor body, which
        // carries none (the constructor is not a source function).
        return {
          type: "ExpressionStatement",
          expression: {
            type: "AssignmentExpression",
            operator: "=",
            left: {
              type: "MemberExpression",
              object: { type: "ThisExpression" } as ESTree.ThisExpression,
              property: this.legacy.leafExpr(h.field),
              computed: false,
              optional: false,
            } as ESTree.MemberExpression,
            right: { type: "Identifier", name: this.legacy.encodeName(h.paramName) } as ESTree.Identifier,
          } as ESTree.AssignmentExpression,
        } as ESTree.ExpressionStatement;

      case "super-call":
        // A4: `super(<param> ...)` in a constructor. Args are source param names encoded to identifiers.
        // Byte-identical to the raw call JSClassBuilder built (callee Super, optional: false, no loc).
        return {
          type: "ExpressionStatement",
          expression: {
            type: "CallExpression",
            callee: { type: "Super" } as ESTree.Super,
            arguments: h.args.map((a) => ({ type: "Identifier", name: this.legacy.encodeName(a) } as ESTree.Identifier)),
            optional: false,
          } as ESTree.CallExpression,
        } as ESTree.ExpressionStatement;

      case "ctor-method-call":
        // A4: `this.<method>()` -- a constructor running a `:ctor` initializer method. The method name is
        // materialized by `leafExpr`. Byte-identical to the raw call JSClassBuilder built (no args, no loc).
        return {
          type: "ExpressionStatement",
          expression: {
            type: "CallExpression",
            callee: {
              type: "MemberExpression",
              object: { type: "ThisExpression" } as ESTree.ThisExpression,
              property: this.legacy.leafExpr(h.method),
              computed: false,
              optional: false,
            } as ESTree.MemberExpression,
            arguments: [],
            optional: false,
          } as ESTree.CallExpression,
        } as ESTree.ExpressionStatement;

      case "restart-case":
      case "handle":
        // D47 refused on JS (LL0108). Report the located diagnostic and emit a harmless EmptyStatement --
        // emitStmt must return a valid ESTree Statement, and hasErrors suppresses the output file anyway.
        this.legacy.reportRestartsRefused(h.src, h.kind);
        return { type: "EmptyStatement", loc: loc(h.src) } as ESTree.Statement;

      default: {
        const never: never = h;
        throw new Error(`HIR emit: unhandled statement kind '${(never as any).kind}'`);
      }
    }
  }


  /**
   * A modeled pattern (A7) -> the ESTree boolean that tests it and binds as it goes.
   *
   * Bind-then-test, left to right, folded into a LEFT-associative `&&` chain. Every part of that is
   * observable: the binds are side effects inside a conjunction, so reordering them or dropping a
   * trivially-true conjunct (`_` contributes a literal `true`) changes the emitted program.
   */
  private patternCond(p: HPattern, scrut: ESTree.Expression, src: ast.ASTNode): ESTree.Expression {
    const lit = (value: any): ESTree.Expression => ({ type: "Literal", value, loc: loc(src) } as ESTree.Literal);
    const bindThen = (name: string, value: ESTree.Expression): ESTree.Expression => ({
      type: "SequenceExpression",
      expressions: [
        { type: "AssignmentExpression", operator: "=", left: ident(encodeIdentifier(name), src), right: value } as ESTree.AssignmentExpression,
        lit(true),
      ],
      loc: loc(src),
    } as ESTree.SequenceExpression);
    const and = (a: ESTree.Expression, b: ESTree.Expression): ESTree.Expression =>
      ({ type: "LogicalExpression", operator: "&&", left: a, right: b } as ESTree.LogicalExpression);
    const eq = (a: ESTree.Expression, b: ESTree.Expression, op: "===" | "!==" | ">=" ): ESTree.Expression =>
      ({ type: "BinaryExpression", operator: op, left: a, right: b } as ESTree.BinaryExpression);
    const member = (obj: ESTree.Expression, prop: ESTree.Expression | string, computed: boolean): ESTree.Expression =>
      ({
        type: "MemberExpression",
        object: obj,
        property: typeof prop === "string" ? ident(prop, src) : prop,
        computed,
        optional: false,
        loc: loc(src),
      } as ESTree.MemberExpression);

    switch (p.kind) {
      case "any":
        return lit(true);

      case "bind":
        return bindThen(p.name, scrut);

      case "equals":
        return eq(scrut, this.emitExpr(p.value), "===");

      case "enum-equals": {
        // The member's constant comes from the backend's enum table (A4); the DECISION to test rather
        // than bind was already made at lowering.
        const value = this.legacy.enumMemberValue(p.member);
        return eq(scrut, lit(value), "===");
      }

      case "typed": {
        const isType = this.legacy.patternTypeTest(p.type, scrut, src);
        if (isType === undefined) return lit(false); // untestable -- the hook reported it
        return and(bindThen(p.name, scrut), isType);
      }

      case "vector": {
        const parts: ESTree.Expression[] = [
          {
            type: "CallExpression",
            callee: member(ident("Array", src), "isArray", false),
            arguments: [scrut],
            optional: false,
          } as ESTree.CallExpression,
          // A rest makes the length a FLOOR; without one the shape is exact.
          eq(member(scrut, "length", false), lit(p.elements.length), p.rest ? ">=" : "==="),
        ];
        p.elements.forEach((el, i) => parts.push(this.patternCond(el, member(scrut, lit(i), true), src)));
        if (p.rest) {
          parts.push(
            bindThen(p.rest.name, {
              type: "CallExpression",
              callee: member(scrut, "slice", false),
              arguments: [lit(p.elements.length)],
              optional: false,
            } as ESTree.CallExpression)
          );
        }
        return parts.reduce(and);
      }

      case "map": {
        const parts: ESTree.Expression[] = [
          and(
            eq({ type: "UnaryExpression", operator: "typeof", argument: scrut, prefix: true } as ESTree.UnaryExpression, lit("object"), "==="),
            eq(scrut, lit(null), "!==")
          ),
        ];
        for (const en of p.entries) parts.push(this.patternCond(en.pattern, member(scrut, lit(en.key), true), src));
        return parts.reduce(and);
      }

      case "unsupported":
        return lit(false);
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

      case "member-read":
        // A3: the field-vs-`__ll_member` emission stays the legacy field branch (JS re-visits `src`), so
        // this is byte-identical; the model exists so a native backend resolves the slot off the node.
        return this.legacy.leafExpr(h.src);

      case "formatted-string": {
        // A2: build the template literal DIRECTLY -- byte-identical to visitFormattedString. Consecutive
        // literal segments accumulate into a quasi; each interpolation becomes `__ll_format_object(<e>)`.
        const quasis: ESTree.TemplateElement[] = [];
        const expressions: ESTree.Expression[] = [];
        let cur = "";
        for (const seg of h.segments) {
          if ("str" in seg) { cur += seg.str; continue; }
          quasis.push({ type: "TemplateElement", value: { raw: cur, cooked: cur }, tail: false });
          cur = "";
          expressions.push({
            type: "CallExpression",
            callee: { type: "Identifier", name: "__ll_format_object" },
            arguments: [this.emitExpr(seg.expr)],
            optional: false,
          } as ESTree.CallExpression);
        }
        quasis.push({ type: "TemplateElement", value: { raw: cur, cooked: cur }, tail: true });
        return { type: "TemplateLiteral", quasis, expressions, loc: loc(h.src) } as ESTree.TemplateLiteral;
      }

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
      case "virtual-call":
        // Resolved method dispatch (classifyCall): `obj.method(a)` stays the direct member call, whether
        // the receiver is statically typed (method-call, devirt-able) or untyped (virtual-call, native
        // vtable) -- on JS the runtime resolves both identically. The member callee is the legacy
        // `leafExpr` of the head (visitExpr -- the JS receiver/member policy: `this`, encoding, import-
        // inlining); args are HIR-emitted. Byte-identical to the emitter's callExpression(visitExpr(head),
        // args), with no re-dispatch back through the legacy call path.
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

      case "construct":
        // Resolved construction (classifyCall): `(Dog a)` -> `new Dog(a)`. The class-name callee is the
        // modeled reference (emitRef -- encoding / import-inlining); args are HIR-emitted, never copied at
        // the site. Byte-identical to the emitter's NewExpression branch (no `optional` on a NewExpression).
        return {
          type: "NewExpression",
          callee: this.emitExpr(h.callee),
          arguments: h.args.map((a) => this.emitExpr(a)),
          loc: loc(h.src),
        } as ESTree.NewExpression;

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

      case "match-test": {
        const cond = this.patternCond(h.pattern, ident(h.scrutName, h.src), h.src);
        if (!h.guard) return cond;
        // `:when` (D26): ANDed AFTER the pattern so the guard sees the bindings the pattern made.
        return {
          type: "LogicalExpression",
          operator: "&&",
          left: cond,
          right: this.emitExpr(h.guard),
          loc: loc(h.src),
        } as ESTree.LogicalExpression;
      }

      case "signal":
      case "invoke-restart":
        // D47 refused on JS (LL0108). Report the located diagnostic and emit the harmless `undefined`
        // placeholder (valid in expression context; mirrors the onUnhandled fallback). hasErrors
        // suppresses the output file, so the placeholder never actually ships.
        this.legacy.reportRestartsRefused(h.src, h.kind);
        return { type: "Identifier", name: "undefined", loc: loc(h.src) } as ESTree.Identifier;

      default: {
        const never: never = h;
        throw new Error(`HIR emit: unhandled expression kind '${(never as any).kind}'`);
      }
    }
  }
}
