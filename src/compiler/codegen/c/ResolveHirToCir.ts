// P1 -- HIR -> CIR: the resolver, and the heart of the probe.
//
// The JS emitter hands every opaque leaf back to the legacy visitor. The C pipeline has no legacy
// visitor -- so THIS pass must resolve what the HIR left opaque: atoms (A2), calls and their dispatch
// (A3), declaration structure (A2/A5), the extern boundary (A9). Every one of those resolutions
// requires reaching BELOW the HIR, and the rule that keeps the experiment honest is that such
// reaches happen ONLY through the three dip* helpers, each of which records a gap-ledger entry
// before answering. The ledger output is the backend's primary deliverable; the C code is the vehicle.
//
// Hard-fail posture: anything this pass cannot resolve is an LL0106 refusal (or LL0105 for
// coroutines, LL0107 for host globals) -- never a guess.

import * as ast from "../../frontend/ast";
import type { Context } from "../../Context";
import type { InferredType, SymbolEntry } from "../../analysis/SymbolTable";
import { classifyList } from "../../analysis/listForm";
import type { HirModule } from "../../hir";
import { LowerAstToHirVisitor } from "../../hir";
import type { HBlock, HExpr, HStmt } from "../../hir/nodes";
import { report, CBackendDiagnostics } from "../../rules/diagnostics";
import { GapLedger, Assumption } from "./GapLedger";
import {
  CBlock, CExpr, CStmt, CModule, CFunction, CParam, CLValue, CCallee, BinopMode, CMapEntry,
} from "./cir";
import { CType, C_BOOL, C_INT, C_REAL, C_STR, C_VALUE, C_VOID, mapType, ctypeEquals } from "./ctype";
import { INTRINSIC_CALLS, NATIVE_METHODS, NATIVE_FIELDS } from "./intrinsics";

const BINARY_OPS = new Set(["+", "-", "*", "/", "%", "==", "!=", "≠", "<", ">", "<=", ">=", "&&", "||"]);
const NUMERIC = (t: CType) => t.k === "int" || t.k === "real";

/** Mangle an l-lang identifier into a collision-free C identifier. Lowering temps pass through. */
export function mangleC(name: string): string {
  if (name.startsWith("__ll_hir")) return name;
  return (
    "u_" +
    name.replace(/[^A-Za-z0-9_]/g, (ch) => `_${ch.codePointAt(0)!.toString(16)}`)
  );
}

class Refusal extends Error {}

export class ResolveHirToCir {
  private readonly functions: CFunction[] = [];
  /** Declared CTypes of lowering temps and user locals, by C name (P1-scoped truth for reads). */
  private readonly declTypes = new Map<string, CType>();
  private refused = false;

  constructor(
    private readonly context: Context,
    private readonly hir: HirModule,
    readonly ledger: GapLedger
  ) {}

  // -- the three sanctioned dips (each records before answering) -----------------------------------

  private dipAst<T>(a: Assumption, construct: string, src: ast.ASTNode, note: string, read: () => T): T {
    this.ledger.record(a, construct, src, note);
    return read();
  }

  private dipNodeTypes(a: Assumption, construct: string, src: ast.ASTNode, note: string): InferredType | undefined {
    this.ledger.record(a, construct, src, note);
    return this.context.nodeTypes.get(src);
  }

  private dipSymbols(a: Assumption, construct: string, src: ast.ASTNode, note: string, name: string): SymbolEntry | undefined {
    this.ledger.record(a, construct, src, note);
    try {
      return this.context.symbolTable.resolveSymbol(name, src);
    } catch {
      return undefined;
    }
  }

  /** Is this entry an `:extern` host-global declaration (the std/js prelude)? */
  private isExtern(entry: SymbolEntry | undefined): boolean {
    return (entry?.value as any)?.extern === true;
  }

  /** The source path of the module being compiled; set by resolveModule from the ProgramNode. */
  private rootSource: string | undefined;

  /** Is this entry DEFINED in the module being compiled (vs imported from the stdlib)? */
  private isLocalDef(entry: SymbolEntry | undefined): boolean {
    const src = (entry?.value as any)?._location?.source;
    return typeof src === "string" && src === this.rootSource;
  }

  // -- entry ----------------------------------------------------------------------------------------

  resolveModule(root: ast.ASTNode): CModule | null {
    this.rootSource = root._location?.source;
    const body = this.hir.bodyFor(root);
    const main = body ? this.resolveBlock(body) : { stmts: [] };
    if (this.refused) return null;
    return { functions: this.functions, main };
  }

  // -- types ----------------------------------------------------------------------------------------

  /** The CType of an HIR node: its channel type, with the A1 rule (undefined = box + ledger). */
  private ctypeOf(h: { src: ast.ASTNode; type: InferredType | undefined }, construct: string): CType {
    if (h.type === undefined) {
      this.ledger.record("A1", construct, h.src, "node has no type in the channel; boxed");
      return C_VALUE;
    }
    return mapType(h.type);
  }

  /** The CType of a RAW AST node reached through a dip (opaque-leaf internals). */
  private ctypeOfAst(node: ast.ASTNode, construct: string): CType {
    const t = this.context.nodeTypes.get(node);
    if (t === undefined) {
      this.ledger.record("A1", construct, node, "raw AST node missing from nodeTypes; boxed");
      return C_VALUE;
    }
    return mapType(t);
  }

  // -- statements -----------------------------------------------------------------------------------

  resolveBlock(b: HBlock): CBlock {
    const stmts: CStmt[] = [];
    for (const s of b.stmts) stmts.push(...this.resolveStmt(s));
    return { stmts };
  }

  private resolveStmt(h: HStmt): CStmt[] {
    try {
      switch (h.kind) {
        case "opaque-stmt":
          return this.resolveAstStmt(h.src);

        case "expr-stmt": {
          const expr = this.resolveExpr(h.expr);
          return [{ src: h.src, ctype: C_VOID, kind: "c-expr-stmt", expr }];
        }

        case "decl-temp": {
          const t = h.init ? this.resolveExpr(h.init) : null;
          const declCType = t ? t.ctype : this.ctypeOf(h, "decl-temp");
          this.declTypes.set(h.name, declCType);
          return [{ src: h.src, ctype: C_VOID, kind: "c-decl", cName: h.name, declCType, init: t }];
        }

        case "assign-temp": {
          let value = this.resolveExpr(h.value);
          if (h.isStore) {
            // The D11 copy DECISION is not on the node -- the HIR only has a flag (spec A5).
            this.ledger.record("A5", "assign-temp-store", h.src, "isStore flag stands in for an explicit copy node");
            value = { src: h.src, ctype: value.ctype, kind: "c-copy", inner: value };
          }
          const target: CLValue = { kind: "name", cName: h.name, ctype: this.declTypes.get(h.name) ?? value.ctype };
          return [{ src: h.src, ctype: C_VOID, kind: "c-assign", target, value }];
        }

        case "var-decl":
          return this.resolveVarDecl(h.src as ast.VariableNode, h.init ? this.resolveExpr(h.init) : null);

        case "user-assign":
          return this.resolveUserAssign(h.src as ast.SimpleAssignmentNode | ast.CompoundAssignmentNode, this.resolveExpr(h.rhs));

        case "if": {
          const test = this.resolveExpr(h.test);
          return [{
            src: h.src, ctype: C_VOID, kind: "c-if",
            test,
            then: this.resolveBlock(h.then),
            else: h.else ? this.resolveBlock(h.else) : null,
          }];
        }

        case "block":
          return [{ src: h.src, ctype: C_VOID, kind: "c-block", body: this.resolveBlock(h.body) }];

        case "return": {
          let value = h.value ? this.resolveExpr(h.value) : null;
          if (value && h.isStore) {
            this.ledger.record("A5", "return-store", h.src, "isStore flag stands in for an explicit copy node");
            value = { src: h.src, ctype: value.ctype, kind: "c-copy", inner: value };
          }
          return [{ src: h.src, ctype: C_VOID, kind: "c-return", value }];
        }

        case "while":
          return [{
            src: h.src, ctype: C_VOID, kind: "c-while",
            test: this.resolveExpr(h.test),
            body: this.resolveBlock(h.body),
          }];

        case "for": {
          const update = h.update
            ? this.asUpdateStmt(h.update)
            : null;
          const out: CStmt[] = [{
            src: h.src, ctype: C_VOID, kind: "c-for",
            init: this.resolveBlock(h.init),
            test: h.test ? this.resolveExpr(h.test) : null,
            update,
            body: this.resolveBlock(h.body),
          }];
          if (h.elseBlock) out.push({ src: h.src, ctype: C_VOID, kind: "c-block", body: this.resolveBlock(h.elseBlock) });
          return out;
        }

        case "for-each":
          return this.resolveForEach(h);

        case "hoist": {
          // Phase A supports only non-binding patterns (any/constant/nil); a binding match refuses in
          // pattern-test resolution, so the hoist has nothing to declare.
          this.ledger.record("A7", "hoist", h.src, "pattern variable set computed below the HIR (legacy patternVars seam)");
          return [];
        }

        case "try":
          throw this.refuse(h.src, "try-catch", "resolveStmt");

        default: {
          const never: never = h;
          throw this.refuse((never as any).src, `hir:${(never as any).kind}`, "resolveStmt");
        }
      }
    } catch (e) {
      if (e instanceof Refusal) return [];
      throw e;
    }
  }

  /** A for `:step` is an expression in the HIR; C wants a statement. */
  private asUpdateStmt(e: HExpr): CStmt {
    const expr = this.resolveExpr(e);
    return { src: e.src, ctype: C_VOID, kind: "c-expr-stmt", expr };
  }

  private resolveVarDecl(node: ast.VariableNode, init: CExpr | null): CStmt[] {
    // The declaration STRUCTURE (name, mutability, destructuring) is not on the HIR node (A2/A5 --
    // the legacy emitVarDecl seam).
    const name = this.dipAst("A2", "decl-structure", node, "binding name/mutability read from raw VariableNode", () => node.name);
    if (name._type !== "simple-identifier" && name._type !== "composite-identifier") {
      throw this.refuse(node, "destructuring-declaration", "resolveVarDecl");
    }
    if (node.extern) return []; // an ambient host global declaration -- nothing to emit
    const srcName = ast.symbolName(name);
    const cName = mangleC(srcName);
    // The binding's declared/inferred type. For a MUTABLE binding the symbol table's DECLARED type
    // must win: the channel's entry on the VariableNode carries the INITIALIZER's narrowed type
    // (`(mut label <- String? "hello")` arrives as String, not String?), and a mut binding can be
    // re-assigned outside that narrowing. Measured on this corpus; a real channel finding (A1).
    let t: InferredType | undefined;
    if (node.mutable) {
      this.ledger.record("A1", "mut-decl-narrowed", node, "channel type on a mut decl is the initializer's narrowing; declared type from symbols");
      t = this.dipSymbols("A2", "decl-type", node, "declaration type resolved through the symbol table", srcName)?.inferredType
        ?? this.context.nodeTypes.get(node);
    } else {
      t = this.context.nodeTypes.get(node);
      if (t === undefined) {
        t = this.dipSymbols("A2", "decl-type", node, "declaration type resolved through the symbol table", srcName)?.inferredType;
      }
    }
    const declCType = t !== undefined ? mapType(t) : init ? init.ctype : C_VALUE;
    if (t === undefined && !init) this.ledger.record("A1", "decl-untyped", node, "no channel or symbol type for binding; boxed");
    this.declTypes.set(cName, declCType);
    return [{ src: node, ctype: C_VOID, kind: "c-decl", cName, declCType, init }];
  }

  private resolveUserAssign(node: ast.SimpleAssignmentNode | ast.CompoundAssignmentNode, rhs: CExpr): CStmt[] {
    const target = this.dipAst("A2", "assign-target", node, "assignment target read from raw AST (legacy emitAssign seam)", () => node.assignable);
    if (target._type === "simple-identifier" || target._type === "composite-identifier") {
      const cName = mangleC(ast.symbolName(target));
      const ctype = this.declTypes.get(cName) ?? this.bindingCType(target as ast.IdentifierNode);
      return [{ src: node, ctype: C_VOID, kind: "c-assign", target: { kind: "name", cName, ctype }, value: rhs }];
    }
    throw this.refuse(node, `assign-to-${target._type}`, "resolveUserAssign");
  }

  private resolveForEach(h: Extract<HStmt, { kind: "for-each" }>): CStmt[] {
    const node = h.src as ast.ForEachNode;
    const variable = this.dipAst("A2", "foreach-variable", node, "loop binding read from raw ForEachNode (legacy emitForEach seam)", () => node.variable);
    if (variable._type !== "simple-identifier" && variable._type !== "composite-identifier") {
      throw this.refuse(node, "foreach-destructuring", "resolveForEach");
    }
    const collection = this.resolveExpr(h.collection);
    let varCType: CType = C_VALUE;
    if (collection.ctype.k === "vec") varCType = collection.ctype.elem;
    else if (collection.ctype.k === "str") varCType = C_STR;
    else this.ledger.record("A1", "foreach-elem", node, "collection element type unknown; boxed");
    // D11: each iteration value is copied (shallow). The HIR does not say so -- the legacy
    // emitForEach seam does (A5).
    this.ledger.record("A5", "foreach-copy", node, "per-iteration element copy decided below the HIR");
    const cName = mangleC(ast.symbolName(variable as ast.IdentifierNode));
    this.declTypes.set(cName, varCType);
    return [{
      src: node, ctype: C_VOID, kind: "c-foreach",
      varCName: cName, varCType, collection,
      body: this.resolveBlock(h.body),
      elseBlock: h.elseBlock ? this.resolveBlock(h.elseBlock) : null,
    }];
  }

  // -- expressions ----------------------------------------------------------------------------------

  private resolveExpr(h: HExpr): CExpr {
    switch (h.kind) {
      case "opaque-expr":
        return this.resolveAstExpr(h.src);

      case "nil":
        return { src: h.src, ctype: C_VALUE, kind: "c-nil" };

      case "temp": {
        const ctype = this.declTypes.get(h.name) ?? this.ctypeOf(h, "temp-read");
        return { src: h.src, ctype, kind: "c-temp", name: h.name };
      }

      case "ternary": {
        const test = this.resolveExpr(h.test);
        const then = this.resolveExpr(h.then);
        const els = this.resolveExpr(h.else);
        const ctype = ctypeEquals(then.ctype, els.ctype) ? then.ctype : this.ctypeOf(h, "ternary");
        return { src: h.src, ctype, kind: "c-ternary", test, then, else: els };
      }

      case "seq": {
        const exprs = h.exprs.map((e) => this.resolveExpr(e));
        return { src: h.src, ctype: exprs.length ? exprs[exprs.length - 1].ctype : C_VALUE, kind: "c-seq", exprs };
      }

      case "vector": {
        const elements = h.elements.map((e) => this.resolveExpr(e));
        const ct = this.ctypeOf(h, "vector");
        return { src: h.src, ctype: ct.k === "vec" ? ct : { k: "vec", elem: C_VALUE }, kind: "c-vector", elements };
      }

      case "matrix": {
        const rows = h.rows.map((row) =>
          ({ src: h.src, ctype: { k: "vec", elem: C_VALUE } as CType, kind: "c-vector" as const, elements: row.map((e) => this.resolveExpr(e)) })
        );
        return { src: h.src, ctype: { k: "vec", elem: { k: "vec", elem: C_VALUE } }, kind: "c-vector", elements: rows };
      }

      case "map": {
        const entries: CMapEntry[] = h.entries.map((e) => ({
          key: e.keyLiteral !== undefined ? e.keyLiteral : this.resolveExpr(e.key!),
          value: this.resolveExpr(e.value),
        }));
        return { src: h.src, ctype: { k: "map" }, kind: "c-map", entries };
      }

      case "member":
        throw this.refuse(h.src, "hir-member(pipeline)", "resolveExpr");

      case "index":
        return this.resolveIndexChain(h);

      case "pattern-test":
        return this.resolvePatternTest(h);

      default: {
        const never: never = h;
        throw this.refuse((never as any).src, `hir:${(never as any).kind}`, "resolveExpr");
      }
    }
  }

  private resolveIndexChain(h: Extract<HExpr, { kind: "index" }>): CExpr {
    let expr = this.resolveExpr(h.base);
    for (const step of h.steps) {
      if (step.isMember) {
        // A `.name` step: a native-member READ (D1 read form).
        const nameNode = step.index;
        const name = nameNode.kind === "opaque-expr" && (nameNode.src as any).id !== undefined
          ? String((nameNode.src as any).id)
          : nameNode.kind === "opaque-expr" && (nameNode.src as any).value !== undefined
            ? String((nameNode.src as any).value)
            : null;
        if (name === null) throw this.refuse(h.src, "computed-member-step", "resolveIndexChain");
        expr = this.memberRead(h.src, expr, name);
      } else {
        const index = this.resolveExpr(step.index);
        expr = this.indexRead(h.src, expr, index, true);
      }
    }
    return expr;
  }

  private memberRead(src: ast.ASTNode, object: CExpr, fieldName: string): CExpr {
    const baseKey = object.ctype.k === "str" ? "str" : object.ctype.k === "vec" ? "vec" : "dyn";
    const field = NATIVE_FIELDS.get(`${baseKey}.${fieldName}`) ?? NATIVE_FIELDS.get(`dyn.${fieldName}`);
    if (baseKey === "dyn") {
      this.ledger.record("A3", "member-dyn", src, "boxed receiver forces runtime member dispatch");
      if (!field) {
        // The __ll_member mirror: a fully-dynamic member read (a map field, typically).
        return { src, ctype: C_VALUE, kind: "c-member", object, fieldName, runtimeFn: "ll_dyn_member", needsName: true };
      }
    }
    if (!field) throw this.refuse(src, `member-read:${fieldName}`, "memberRead");
    return { src, ctype: field.ret, kind: "c-member", object, fieldName, runtimeFn: field.runtimeFn };
  }

  private indexRead(src: ast.ASTNode, base: CExpr, index: CExpr, checked: boolean): CExpr {
    const mode = base.ctype.k === "vec" ? "vec" : base.ctype.k === "map" ? "map" : base.ctype.k === "str" ? "str" : "boxed";
    const elem: CType =
      base.ctype.k === "vec" ? base.ctype.elem : base.ctype.k === "str" ? C_STR : C_VALUE;
    if (mode === "boxed") this.ledger.record("A1", "index-boxed-base", src, "index base has no static container type");
    return { src, ctype: elem, kind: "c-index", base, index, mode, checked };
  }

  private resolvePatternTest(h: Extract<HExpr, { kind: "pattern-test" }>): CExpr {
    // The HIR carries the raw PatternNode + scrutinee name; the test decomposition happens HERE,
    // below the HIR -- exactly the A7 seam the spec names (legacy generateCondition).
    const pattern = this.dipAst("A7", "pattern-test", h.src, "pattern decomposed from raw PatternNode (legacy generateCondition seam)", () => h.pattern);
    const scrut: CExpr = {
      src: h.src,
      ctype: this.declTypes.get(h.scrutName) ?? C_VALUE,
      kind: "c-temp",
      name: h.scrutName,
    };
    let test = this.patternCondition(pattern, scrut, h.src);
    if (h.guard) {
      const guard = this.dipAst("A7", "pattern-guard", h.src, "guard expression read from raw AST", () => h.guard!);
      test = {
        src: h.src, ctype: C_BOOL, kind: "c-binop", op: "&&", mode: "bool",
        lhs: test, rhs: this.resolveAstExpr(guard),
      };
    }
    return test;
  }

  private patternCondition(p: ast.PatternNode, scrut: CExpr, src: ast.ASTNode): CExpr {
    switch (p._type) {
      case "any-pattern":
        return { src, ctype: C_BOOL, kind: "c-lit", lit: "bool", value: "true" };
      case "constant-pattern": {
        const c = (p as ast.ConstantPatternNode).constant;
        const lit = this.resolveAstExpr(c);
        return { src, ctype: C_BOOL, kind: "c-binop", op: "==", mode: "eq-deep", lhs: scrut, rhs: lit };
      }
      default:
        throw this.refuse(src, `pattern:${p._type}`, "patternCondition");
    }
  }

  // -- raw-AST resolution (the opaque-leaf half; every entry point is a dip) ------------------------

  private resolveAstStmt(node: ast.ASTNode): CStmt[] {
    switch (node._type) {
      case "import":
        this.ledger.record("A9-extern", "import", node, "module import skipped (v0 intrinsics stand in for the stdlib)");
        return [];
      case "type-def":
        return []; // compile-time only
      case "function":
        this.collectFunction(node as ast.FunctionNode);
        return [];
      case "variable": {
        // A declaration inside a RAW subtree (or a bodyless `(mut x)` / `:extern`).
        const v = node as ast.VariableNode;
        return this.resolveVarDecl(v, v.value ? this.resolveAstExpr(v.value) : null);
      }
      // -- raw STRUCTURAL statements. These exist because the HIR lowering BAILS to an opaque leaf on
      // them (most importantly: HFor.update is an HExpr, so any `:step (i := ...)` -- i.e. every
      // C-style for in the corpus -- falls back to legacy, taking its whole subtree raw with it).
      // The JS emitter absorbs that via the legacy visitor; the C backend must re-lower the raw AST.
      // A finding in itself, ledgered per construct.
      case "simple-assignment":
        this.ledger.record("new", "raw-structural:assign", node, "assignment reached codegen raw (inside a bailed subtree)");
        return this.resolveUserAssign(node as ast.SimpleAssignmentNode, this.resolveAstExpr((node as ast.SimpleAssignmentNode).value));
      case "if": {
        this.ledger.record("new", "raw-structural:if", node, "if reached codegen raw (inside a bailed subtree)");
        const n = node as ast.IfNode;
        return [{
          src: node, ctype: C_VOID, kind: "c-if",
          test: this.resolveAstExpr(n.condition),
          then: this.resolveAstBlock(n.then),
          else: n.else ? this.resolveAstBlock(n.else) : null,
        }];
      }
      case "when": {
        this.ledger.record("new", "raw-structural:when", node, "when reached codegen raw (inside a bailed subtree)");
        const n = node as ast.WhenNode;
        return [{
          src: node, ctype: C_VOID, kind: "c-if",
          test: this.resolveAstExpr(n.condition),
          then: { stmts: (n.then ?? []).flatMap((s) => this.resolveAstStmt(s)) },
          else: null,
        }];
      }
      case "cond": {
        this.ledger.record("new", "raw-structural:cond", node, "cond reached codegen raw (inside a bailed subtree)");
        const n = node as ast.CondNode;
        let chain: CStmt[] = [];
        for (let i = n.cases.length - 1; i >= 0; i--) {
          const c = n.cases[i];
          const body = this.resolveAstBlock(c.body);
          const isElse = (c.condition as any)?._type === "simple-identifier" && (c.condition as any).id === "else";
          if (isElse) {
            chain = [{ src: c, ctype: C_VOID, kind: "c-block", body }];
          } else {
            chain = [{
              src: c, ctype: C_VOID, kind: "c-if",
              test: this.resolveAstExpr(c.condition),
              then: body,
              else: chain.length ? { stmts: chain } : null,
            }];
          }
        }
        return chain;
      }
      case "while": {
        this.ledger.record("new", "raw-structural:while", node, "while reached codegen raw (inside a bailed subtree)");
        const n = node as ast.WhileNode;
        return [{
          src: node, ctype: C_VOID, kind: "c-while",
          test: this.resolveAstExpr(n.condition),
          body: this.resolveAstBlock(n.then),
        }];
      }
      case "for": {
        this.ledger.record("new", "raw-structural:for", node, "HFor cannot carry a statement-bearing :step; whole for arrives raw");
        const n = node as ast.ForNode;
        const out: CStmt[] = [{
          src: node, ctype: C_VOID, kind: "c-for",
          init: n.initial ? { stmts: this.resolveAstStmt(n.initial) } : { stmts: [] },
          test: n.condition ? this.resolveAstExpr(n.condition) : null,
          update: n.step ? this.singleStmt(this.resolveAstStmt(n.step), n.step) : null,
          body: this.resolveAstBlock(n.then),
        }];
        if (n.else) out.push({ src: node, ctype: C_VOID, kind: "c-block", body: this.resolveAstBlock(n.else) });
        return out;
      }
      case "for-each": {
        this.ledger.record("new", "raw-structural:for-each", node, "for-each reached codegen raw (inside a bailed subtree)");
        const n = node as ast.ForEachNode;
        if (n.variable._type !== "simple-identifier" && n.variable._type !== "composite-identifier") {
          throw this.refuse(node, "foreach-destructuring", "resolveAstStmt");
        }
        const collection = this.resolveAstExpr(n.collection);
        const varCType: CType = collection.ctype.k === "vec" ? collection.ctype.elem : C_VALUE;
        const cName = mangleC(ast.symbolName(n.variable as ast.IdentifierNode));
        this.declTypes.set(cName, varCType);
        return [{
          src: node, ctype: C_VOID, kind: "c-foreach",
          varCName: cName, varCType, collection,
          body: this.resolveAstBlock(n.then),
          elseBlock: n.else ? this.resolveAstBlock(n.else) : null,
        }];
      }
      case "compound-assignment": {
        const ca = node as ast.CompoundAssignmentNode;
        if (ca.operator === ":=") {
          this.ledger.record("new", "raw-structural:assign", node, "assignment reached codegen raw (inside a bailed subtree)");
          return this.resolveUserAssign(ca, this.resolveAstExpr(ca.value));
        }
        const op = ca.operator.endsWith("=") ? ca.operator.slice(0, -1) : null;
        if (op && BINARY_OPS.has(op) && (ca.assignable._type === "simple-identifier" || ca.assignable._type === "composite-identifier")) {
          const read = this.resolveIdentifier(ca.assignable as ast.IdentifierNode);
          const rhs = this.resolveAstExpr(ca.value);
          const value = this.mkBinop(op, read, rhs, node);
          const cName = mangleC(ast.symbolName(ca.assignable as ast.IdentifierNode));
          return [{ src: node, ctype: C_VOID, kind: "c-assign", target: { kind: "name", cName, ctype: read.ctype }, value }];
        }
        throw this.refuse(node, "compound-assignment", "resolveAstStmt");
      }
      case "list": {
        const form = classifyList(node as ast.ListNode);
        if (form.kind === "block") return form.items.flatMap((s) => this.resolveAstStmt(s));
        if (form.kind === "grouping") return this.resolveAstStmt(form.inner);
        if (form.kind === "special" && form.name === "return") {
          this.ledger.record("new", "raw-structural:return", node, "return reached codegen raw (inside a bailed subtree)");
          const value = form.args.length ? this.resolveAstExpr(form.args[0]) : null;
          return [{ src: node, ctype: C_VOID, kind: "c-return", value }];
        }
        const expr = this.resolveAstExpr(node);
        return [{ src: node, ctype: C_VOID, kind: "c-expr-stmt", expr }];
      }
      case "comment":
        return [];
      default: {
        // Anything else: it is an expression evaluated for effect.
        const expr = this.resolveAstExpr(node);
        return [{ src: node, ctype: C_VOID, kind: "c-expr-stmt", expr }];
      }
    }
  }

  /** A raw body (a list-block, a grouping, or a single statement) as a CBlock. */
  private resolveAstBlock(node: ast.ASTNode): CBlock {
    return { stmts: this.resolveAstStmt(node) };
  }

  /** Collapse a one-statement resolution (a for `:step`) or wrap several in a block. */
  private singleStmt(stmts: CStmt[], src: ast.ASTNode): CStmt {
    if (stmts.length === 1) return stmts[0];
    return { src, ctype: C_VOID, kind: "c-block", body: { stmts } };
  }

  private resolveAstExpr(node: ast.ASTNode): CExpr {
    switch (node._type) {
      case "integer-number":
        return { src: node, ctype: C_INT, kind: "c-lit", lit: "int", value: String((node as ast.IntegerNumberNode).value) };
      case "float-number":
        return { src: node, ctype: C_REAL, kind: "c-lit", lit: "real", value: String((node as ast.FloatNumberNode).value) };
      case "hex-number":
      case "octal-number":
      case "binary-number": {
        // The numeric-tower literals the spec measured as typing `Unknown` (A1's "real but tiny" hole).
        this.ledger.record("A1", "numeric-tower-literal", node, "hex/oct/bin literal; channel types it Unknown, it is Int");
        return { src: node, ctype: C_INT, kind: "c-lit", lit: "int", value: String((node as any).value) };
      }
      case "string":
        return { src: node, ctype: C_STR, kind: "c-lit", lit: "str", value: (node as ast.StringNode).value };
      case "boolean":
        return { src: node, ctype: C_BOOL, kind: "c-lit", lit: "bool", value: (node as ast.BooleanNode).value ? "true" : "false" };
      case "null":
        return { src: node, ctype: C_VALUE, kind: "c-nil" };
      case "simple-identifier":
      case "composite-identifier":
        return this.resolveIdentifier(node as ast.IdentifierNode);
      case "formatted-string":
        return this.resolveFormattedString(node as ast.FormattedStringNode);
      case "list":
        return this.resolveList(node as ast.ListNode);
      case "vector": {
        this.ledger.record("A2", "raw-vector", node, "vector literal reached codegen as a raw leaf (not HVector)");
        const v = node as ast.VectorNode;
        return {
          src: node, ctype: { k: "vec", elem: C_VALUE }, kind: "c-vector",
          elements: (v.values ?? []).map((e) => this.resolveAstExpr(e)),
        };
      }
      case "indexer": {
        // A raw indexer leaf (it can arrive inside rebuilt call operands).
        this.ledger.record("A2", "raw-indexer", node, "indexer reached codegen as a raw leaf (not HIndex)");
        return this.resolveRawIndexer(node as ast.IndexerNode);
      }
      default:
        throw this.refuse(node, node._type, "resolveAstExpr");
    }
  }

  private resolveRawIndexer(node: ast.IndexerNode): CExpr {
    let expr: CExpr = this.resolveIdentifier(node.id);
    (node.indices ?? []).forEach((group, g) => {
      const isMember = node.members?.[g] === true;
      for (const ix of group) {
        if (isMember) {
          const name = (ix as any).id !== undefined ? String((ix as any).id) : String((ix as any).value ?? "");
          expr = this.memberRead(node, expr, name);
        } else {
          expr = this.indexRead(node, expr, this.resolveAstExpr(ix), true);
        }
      }
    });
    return expr;
  }

  /** A variable read (A2's `HRef`): resolved via channel, then symbol table -- the measured-sparse path. */
  private resolveIdentifier(node: ast.IdentifierNode): CExpr {
    const name = ast.symbolName(node);
    // Lowering temps: synthesized identifiers whose type was re-registered on the channel.
    if (name.startsWith("__ll_hir")) {
      const ctype = this.declTypes.get(name) ?? this.ctypeOfAst(node, "temp-substituted");
      return { src: node, ctype, kind: "c-temp", name };
    }
    if (node._type === "composite-identifier") {
      return this.resolveCompositeRead(node as ast.CompositeIdentifierNode);
    }
    this.ledger.record("A2", "atom-ref", node, "variable read is an opaque leaf; resolved below the HIR");
    let t = this.context.nodeTypes.get(node);
    if (t === undefined) {
      const entry = this.dipSymbols("A1", "ref-type-via-symbols", node, "identifier use missing from channel; binding type from symbol table", name);
      if (this.isExtern(entry)) throw this.refuseExtern(node, name);
      t = entry?.inferredType;
    }
    const cName = mangleC(name);
    const ctype = this.declTypes.get(cName) ?? (t !== undefined ? mapType(t) : C_VALUE);
    if (t === undefined && !this.declTypes.has(cName)) {
      this.ledger.record("A1", "ref-untyped", node, "no channel or symbol type for identifier use; boxed");
    }
    return { src: node, ctype, kind: "c-ref", cName };
  }

  private bindingCType(node: ast.IdentifierNode): CType {
    const entry = this.dipSymbols("A2", "binding-type", node, "binding type resolved through the symbol table", ast.symbolName(node));
    return entry?.inferredType !== undefined ? mapType(entry.inferredType) : C_VALUE;
  }

  /** `a.b` as a VALUE: a local's native member, or a host global (A9). */
  private resolveCompositeRead(node: ast.CompositeIdentifierNode): CExpr {
    const parts = node.parts;
    const headName = parts[0];
    const local = (() => { try { return this.context.symbolTable.resolveSymbol(headName, node); } catch { return undefined; } })();
    const isLocal = !this.isExtern(local) && (local?.inferredType !== undefined || this.declTypes.has(mangleC(headName)));
    if (isLocal) {
      // A member read off a local binding.
      let expr: CExpr = {
        src: node,
        ctype: this.declTypes.get(mangleC(headName)) ?? mapType(local?.inferredType),
        kind: "c-ref",
        cName: mangleC(headName),
      };
      this.ledger.record("A2", "atom-ref", node, "variable read is an opaque leaf; resolved below the HIR");
      for (const field of parts.slice(1)) expr = this.memberRead(node, expr, field);
      return expr;
    }
    throw this.refuseExtern(node, node.id);
  }

  private resolveFormattedString(node: ast.FormattedStringNode): CExpr {
    this.ledger.record("A2", "formatted-string", node, "interpolation segments resolved from raw AST");
    const parts: (string | CExpr)[] = [];
    for (const v of node.value ?? []) {
      if (v._type === "format-expression") {
        parts.push(this.resolveAstExpr((v as ast.FormatExpressionNode).expression));
      } else if (v._type === "string") {
        parts.push((v as ast.StringNode).value);
      } else {
        parts.push(String((v as any).value ?? ""));
      }
    }
    return { src: node, ctype: C_STR, kind: "c-interp", parts };
  }

  // -- calls (A3: every entry here is dispatch resolution the HIR does not model) -------------------

  private resolveList(node: ast.ListNode): CExpr {
    const form = classifyList(node);
    switch (form.kind) {
      case "grouping":
        return this.resolveAstExpr(form.inner);
      case "call":
        return this.resolveCall(node, form.callee, form.args);
      case "special":
        throw this.refuse(node, `special:${form.name}`, "resolveList");
      case "apply":
        throw this.refuse(node, "apply-lambda", "resolveList");
      case "empty":
        return { src: node, ctype: C_VALUE, kind: "c-nil" };
      case "block":
        throw this.refuse(node, "block-in-value-position", "resolveList");
    }
  }

  private resolveCall(node: ast.ListNode, callee: ast.ASTNode, args: ast.ASTNode[]): CExpr {
    this.ledger.record("A3", "call-dispatch", node, "call kind/callee identity resolved below the HIR (no call node in the HIR)");

    // Operators.
    if (callee._type === "simple-identifier") {
      const op = (callee as ast.SimpleIdentifierNode).id;
      if (op === "!" && args.length === 1) {
        const operand = this.resolveAstExpr(args[0]);
        return { src: node, ctype: C_BOOL, kind: "c-unop", op: "!", mode: "bool", operand };
      }
      if (op === "-" && args.length === 1) {
        const operand = this.resolveAstExpr(args[0]);
        const mode = operand.ctype.k === "real" ? "real" : "int";
        return { src: node, ctype: operand.ctype.k === "real" ? C_REAL : C_INT, kind: "c-unop", op: "-", mode, operand };
      }
      if (BINARY_OPS.has(op) && args.length >= 2) {
        // Left-fold: `(+ a b c)` == `((a+b)+c)`, per-pair mode decisions (string contagion works).
        let acc = this.resolveAstExpr(args[0]);
        for (let i = 1; i < args.length; i++) {
          acc = this.mkBinop(op, acc, this.resolveAstExpr(args[i]), node);
        }
        return acc;
      }
    }

    // Dotted callee: `(x.m ...)` native method, or `(Math.log ...)` host intrinsic.
    if (callee._type === "composite-identifier") {
      return this.resolveDottedCall(node, callee as ast.CompositeIdentifierNode, args);
    }
    if (ast.isListNode(callee) || callee._type === "indexer") {
      throw this.refuse(node, "computed-callee", "resolveCall");
    }

    // A plain named callee: a user function, a runtime builtin, or (zero-arg, non-function) a grouped value.
    if (callee._type === "simple-identifier") {
      const name = (callee as ast.SimpleIdentifierNode).id;
      const entry = this.dipSymbols("A3", "callee-identity", node, "callee resolved through the symbol table (spec wants it on the call node)", name);
      const symT = entry?.inferredType;
      // A function DEFINED IN THIS MODULE wins (the JS shadowing rule: library names are shadowable).
      if (symT?.kind === "function" && this.isLocalDef(entry) && !this.isExtern(entry)) {
        const params = (symT.params ?? []).map((p) => mapType(p));
        const ret = this.userFnRet(symT, node);
        const cArgs = args.map((a) => this.resolveAstExpr(a));
        const calleeC: CCallee = { kind: "free", cName: mangleC(name), params, ret };
        return { src: node, ctype: ret, kind: "c-call", callee: calleeC, args: cArgs };
      }
      const builtin = INTRINSIC_CALLS.get(name);
      if (builtin) {
        if (entry !== undefined) {
          // The name resolves to an imported l-lang stdlib body the intrinsic shadows (v0 strategy).
          this.ledger.record("A9-extern", "stdlib-intrinsic", node, `'${name}' stdlib body shadowed by a C intrinsic`);
        }
        const cArgs = args.map((a) => this.resolveAstExpr(a));
        return { src: node, ctype: builtin.ret, kind: "c-call", callee: { kind: "intrinsic", ...builtin }, args: cArgs };
      }
      if (symT?.kind === "function") {
        // Imported (non-intrinsic) l-lang function: on-demand body compilation is Phase B.
        throw this.refuse(node, `imported-function:${name}`, "resolveCall");
      }
      if (args.length === 0) {
        // `(x)` where x is not a function: redundant parens around a value (D1).
        return this.resolveIdentifier(callee as ast.IdentifierNode);
      }
      throw this.refuseExtern(node, name);
    }

    throw this.refuse(node, `callee:${callee._type}`, "resolveCall");
  }

  private resolveDottedCall(node: ast.ListNode, callee: ast.CompositeIdentifierNode, args: ast.ASTNode[]): CExpr {
    const whole = callee.id;
    const intrinsic = INTRINSIC_CALLS.get(whole);
    const headName = callee.parts[0];
    const localEntry = (() => { try { return this.context.symbolTable.resolveSymbol(headName, callee); } catch { return undefined; } })();
    const localCType = this.declTypes.get(mangleC(headName));

    // A local binding wins over a host global of the same spelling -- but an `:extern` entry IS the
    // host global (the std/js prelude declares `console`, `Math`, ... into the symbol table).
    if (!this.isExtern(localEntry) && (localEntry?.inferredType !== undefined || localCType !== undefined)) {
      let recv: CExpr = {
        src: callee,
        ctype: localCType ?? mapType(localEntry?.inferredType),
        kind: "c-ref",
        cName: mangleC(headName),
      };
      // Intermediate `.a.b` parts are member reads; the LAST part is the method.
      for (const mid of callee.parts.slice(1, -1)) recv = this.memberRead(node, recv, mid);
      const method = callee.parts[callee.parts.length - 1];
      return this.resolveNativeMethod(node, recv, method, args);
    }

    if (intrinsic) {
      this.ledger.record("A9-extern", "host-intrinsic", node, `'${whole}' resolved against the C runtime (JS resolves it against the host)`);
      const cArgs = args.map((a) => this.resolveAstExpr(a));
      return { src: node, ctype: intrinsic.ret, kind: "c-call", callee: { kind: "intrinsic", ...intrinsic }, args: cArgs };
    }

    throw this.refuseExtern(node, whole);
  }

  private resolveNativeMethod(node: ast.ListNode, recv: CExpr, method: string, args: ast.ASTNode[]): CExpr {
    const baseKey = recv.ctype.k === "str" ? "str" : recv.ctype.k === "vec" ? "vec" : "dyn";
    let def = NATIVE_METHODS.get(`${baseKey}.${method}`);
    let cArgs = args.map((a) => this.resolveAstExpr(a));

    if (!def && baseKey !== "dyn") {
      // A zero-arg "call" of a FIELD (`(m.length)`): D1 makes the dotted form a call, __ll_member
      // makes a non-function a read. Mirror that.
      const field = NATIVE_FIELDS.get(`${baseKey}.${method}`);
      if (field && args.length === 0) {
        return { src: node, ctype: field.ret, kind: "c-member", object: recv, fieldName: method, runtimeFn: field.runtimeFn };
      }
    }
    if (!def) {
      if (baseKey === "dyn") {
        this.ledger.record("A3", "method-dyn", node, "boxed receiver forces runtime method dispatch");
        const dyn = NATIVE_METHODS.get("dyn.method")!;
        const nameLit: CExpr = { src: node, ctype: C_STR, kind: "c-lit", lit: "str", value: method };
        return { src: node, ctype: dyn.ret, kind: "c-call", callee: { kind: "intrinsic", ...dyn }, args: [recv, nameLit, ...cArgs] };
      }
      throw this.refuse(node, `method:${baseKey}.${method}`, "resolveNativeMethod");
    }

    // Pad optional trailing args (slice end) with the runtime's END sentinel.
    while (cArgs.length + 1 < def.params.length) {
      cArgs.push({ src: node, ctype: C_INT, kind: "c-lit", lit: "int", value: "LL_END" });
    }
    return { src: node, ctype: def.ret, kind: "c-call", callee: { kind: "intrinsic", ...def }, args: [recv, ...cArgs] };
  }

  private mkBinop(op: string, lhs: CExpr, rhs: CExpr, src: ast.ASTNode): CExpr {
    const canonOp = op === "≠" ? "!=" : op;
    const mode = this.binopMode(canonOp, lhs, rhs, src);
    const ctype = this.binopCType(canonOp, mode);
    return { src, ctype, kind: "c-binop", op: canonOp, mode, lhs, rhs };
  }

  private binopMode(op: string, l: CExpr, r: CExpr, src: ast.ASTNode): BinopMode {
    const lt = l.ctype, rt = r.ctype;
    if (op === "&&" || op === "||") return "bool";
    if (op === "+" && (lt.k === "str" || rt.k === "str")) return "str-concat";
    if (["+", "-", "*", "/", "%"].includes(op)) {
      if (op === "/") {
        // JS division always yields a Real. If the checker claims Int, the runtime disagrees -- a
        // genuine checker/runtime divergence, ledgered, and the golden (JS) semantics win.
        const claimed = this.context.nodeTypes.get(src);
        if (claimed?.kind === "primitive" && claimed.name === "Int") {
          this.ledger.record("new", "int-division", src, "checker types Int/Int division as Int; JS runtime yields Real");
        }
        return "real";
      }
      if (lt.k === "int" && rt.k === "int") return "int";
      if (NUMERIC(lt) && NUMERIC(rt)) return "real";
      // A boxed operand with a numeric partner (or a numeric checker result): the narrowing case.
      const resultT = this.ctypeOfAst(src, "binop-result");
      if ((lt.k === "value" || rt.k === "value") && (NUMERIC(lt) || NUMERIC(rt) || NUMERIC(resultT))) {
        this.ledger.record("A6", "narrowed-arith", src, "boxed operand in numeric arithmetic; unbox inserted (JS erases this coercion)");
        return resultT.k === "int" && op !== "/" ? "int" : NUMERIC(resultT) ? (resultT.k as "int" | "real") : "real";
      }
      if (lt.k === "value" || rt.k === "value") {
        // Fully-dynamic arithmetic: the JS operator shim's native tail (registry dispatch is Phase C).
        this.ledger.record("A3", "boxed-op", src, "operands untyped; runtime generic operator (JS shim's native tail)");
        return "boxed";
      }
      throw this.refuse(src, `arith-on-${lt.k}/${rt.k}`, "binopMode");
    }
    if (["==", "!="].includes(op)) {
      if (lt.k === "str" && rt.k === "str") return "str-cmp";
      if (lt.k === "int" && rt.k === "int") return "int";
      if (NUMERIC(lt) && NUMERIC(rt)) return "real";
      if (lt.k === "bool" && rt.k === "bool") return "bool";
      return "eq-deep";
    }
    if (["<", ">", "<=", ">="].includes(op)) {
      if (lt.k === "str" && rt.k === "str") return "str-cmp";
      if (lt.k === "int" && rt.k === "int") return "int";
      if (NUMERIC(lt) && NUMERIC(rt)) return "real";
      if ((lt.k === "value" || rt.k === "value") && (NUMERIC(lt) || NUMERIC(rt))) {
        this.ledger.record("A6", "narrowed-compare", src, "boxed operand in ordered comparison; unbox inserted");
        return lt.k === "real" || rt.k === "real" ? "real" : "int";
      }
      if (lt.k === "value" || rt.k === "value") {
        this.ledger.record("A3", "boxed-op", src, "operands untyped; runtime generic comparison");
        return "boxed";
      }
      throw this.refuse(src, `compare-on-${lt.k}/${rt.k}`, "binopMode");
    }
    throw this.refuse(src, `op:${op}`, "binopMode");
  }

  private binopCType(op: string, mode: BinopMode): CType {
    if (["==", "!=", "<", ">", "<=", ">="].includes(op)) return C_BOOL;
    if (op === "&&" || op === "||") return C_BOOL;
    if (mode === "str-concat") return C_STR;
    if (mode === "int") return C_INT;
    if (mode === "real") return C_REAL;
    return C_VALUE; // boxed arithmetic keeps int-ness at runtime; statically it is a box
  }

  /** A user function's C return type. A checker-`Void` return becomes boxed `ll_value`: the corpus
   *  contains functions the checker types Void whose bodies RETURN VALUES the caller then prints --
   *  a checker/runtime divergence a typed target cannot paper over (ledgered). */
  private userFnRet(t: InferredType | undefined, src: ast.ASTNode): CType {
    const mapped = mapType(t?.kind === "function" ? t.returns : undefined);
    if (mapped.k === "void") {
      this.ledger.record("new", "void-fn-boxed", src, "checker-Void user function returns ll_value (bodies may return values the checker missed)");
      return C_VALUE;
    }
    return mapped;
  }

  // -- functions ------------------------------------------------------------------------------------

  private collectFunction(fn: ast.FunctionNode): void {
    const name = fn.name ? ast.symbolName(fn.name) : "<anonymous>";
    if (fn.generator || fn.async) {
      report(this.context, CBackendDiagnostics.CoroutineRefused, fn, {
        form: fn.generator ? "a generator (:gen)" : "async (:async)",
        name,
      });
      this.ledger.record("A8", fn.generator ? "generator" : "async", fn, "coroutine construct refused (no suspend/resume model in the HIR)");
      this.refused = true;
      return;
    }
    if (!fn.name) {
      this.refuse(fn, "lambda", "collectFunction");
      return;
    }

    // The signature is NOT on any HIR node -- the HirModule maps the FunctionNode to a body and
    // nothing else (A3: callee identity/signature live below the HIR).
    const symT = this.dipSymbols("A3", "function-signature", fn, "signature resolved through the symbol table (not on the HIR)", name)?.inferredType;
    const paramTs: (InferredType | undefined)[] =
      symT?.kind === "function" && symT.params ? symT.params : fn.params.map(() => undefined);
    const ret = this.userFnRet(symT, fn);

    const params: CParam[] = fn.params.map((p, i) => {
      if (p.name._type !== "simple-identifier" && p.name._type !== "composite-identifier") {
        this.refuse(p, "param-destructuring", "collectFunction");
        return { cName: `p${i}`, ctype: C_VALUE };
      }
      const t = paramTs[i];
      if (t === undefined) this.ledger.record("A1", "param-untyped", p, "parameter type unavailable; boxed");
      const cName = mangleC(ast.symbolName(p.name as ast.IdentifierNode));
      const ctype = t !== undefined ? mapType(t) : C_VALUE;
      this.declTypes.set(cName, ctype);
      return { cName, ctype };
    });

    let body = this.hir.bodyFor(fn);
    if (!body) {
      // The on-demand path the JS emitter also has (imported/inlined bodies not pre-lowered).
      this.ledger.record("A3", "on-demand-lower", fn, "function body not pre-lowered; lowered on demand");
      body = new LowerAstToHirVisitor(this.context, "__ll_hir_i").lowerBody(fn.body ?? []);
    }
    this.functions.push({ src: fn, cName: mangleC(name), params, ret, body: this.resolveBlock(body) });
  }

  // -- refusals -------------------------------------------------------------------------------------

  private refuse(node: ast.ASTNode, type: string, where: string): Refusal {
    report(this.context, CBackendDiagnostics.Unhandled, node, { type, where });
    this.ledger.record("new", `unhandled:${type}`, node, `no CIR lowering (${where})`);
    this.refused = true;
    return new Refusal(type);
  }

  private refuseExtern(node: ast.ASTNode, name: string): Refusal {
    report(this.context, CBackendDiagnostics.UnresolvableExtern, node, { name });
    this.ledger.record("A9-extern", "unresolvable", node, `'${name}' has no C representation`);
    this.refused = true;
    return new Refusal(name);
  }
}
