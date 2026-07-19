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
  CLifted, CCapture, CClass,
} from "./cir";
import { CType, C_BOOL, C_INT, C_REAL, C_STR, C_VALUE, C_VOID, mapType, ctypeEquals } from "./ctype";
import { INTRINSIC_CALLS, NATIVE_METHODS, NATIVE_FIELDS } from "./intrinsics";
import { freeVariables } from "./freevars";

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

/** Mangle without the `u_` user prefix, for compiler-synthesized symbols (class/method names). */
function mangleBare(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, (ch) => `_${ch.codePointAt(0)!.toString(16)}`);
}

/** Encode an operator's characters to hex, mirroring the JS backend's encodeIdentifier. */
function encodeOp(op: string): string {
  return [...op].map((ch) => ch.codePointAt(0)!.toString(16)).join("");
}

class Refusal extends Error {}

/** What the resolver knows about a local binding (a param, a let/mut, or a captured var). */
interface VarInfo {
  ctype: CType;
  mutable: boolean;
  /** A mutable-captured binding: stored as a heap `ll_value*` shared with escaping closures. */
  cell: boolean;
}

/** A struct/class descriptor: field layout + methods. Construction/fields/methods are all resolved
 *  from HERE, not the HIR (spec A4 -- the HIR models no construction at all). */
interface ClassDesc {
  name: string;
  isStruct: boolean;
  fields: { name: string; ctype: CType }[];
  fieldSlot: Map<string, number>;
  methods: Map<string, { cName: string; params: CType[]; ret: CType }>;
}

export class ResolveHirToCir {
  private readonly functions: CFunction[] = [];
  private readonly lifted: CLifted[] = [];
  private readonly adapters = new Map<string, { forCName: string; params: CType[]; ret: CType; arity: number }>();
  /** Top-level user function signatures, by SOURCE name -- direct-call targets. */
  private readonly topLevelFns = new Map<string, { params: CType[]; ret: CType; arity: number }>();
  /** Imported (non-intrinsic) l-lang bodies lowered on demand, by source name (dedup). */
  private readonly importedLowered = new Set<string>();
  /** Struct/class descriptors, by source name (spec A4). */
  private readonly classes = new Map<string, ClassDesc>();
  /** Operator overloads: key `<op>:<leftOperandTypeName>` -> the operator's C function. `isMethod`
   *  = an in-struct operator whose LEFT operand is the implicit `this`; `unary` = a one-operand op. */
  private readonly operators = new Map<string, { cName: string; ret: CType; isMethod: boolean; unary: boolean }>();
  /** The class whose method body is being resolved (so `this` binds to `__self`). */
  private selfClass: string | undefined;
  /** Module-level binding names that top-level functions reference -> hoisted to C globals (a C
   *  function cannot see `main`'s locals; this is the module-scope analog of closure capture). */
  private readonly globalNames = new Set<string>();
  private readonly globalDecls: { cName: string; ctype: CType }[] = [];
  private readonly globalDeclared = new Set<string>();
  /** Lexical scope stack of local bindings (by C name). scope[0] is the module/main body. */
  private readonly scopes: Map<string, VarInfo>[] = [new Map()];
  /** Names (C names) that must be heap cells in the CURRENT function scope (mutable-captured). */
  private cellVars: Set<string> = new Set();
  private liftCounter = 0;
  /** True while resolving a FUNCTION body (top-level or lifted). A `function` statement seen when
   *  false is a module-level declaration; when true it is a nested closure. (Scope depth cannot tell
   *  them apart because each function resolves on an isolated scope stack.) */
  private inFunctionBody = false;
  private refused = false;

  constructor(
    private readonly context: Context,
    private readonly hir: HirModule,
    readonly ledger: GapLedger
  ) {}

  // -- lexical scope (correct per-function locals; captures read enclosing scopes) ------------------

  private pushScope(): void { this.scopes.push(new Map()); }
  private popScope(): void { this.scopes.pop(); }

  private declareLocal(cName: string, ctype: CType, mutable = false, cell = false): void {
    this.scopes[this.scopes.length - 1].set(cName, { ctype, mutable, cell });
  }

  private localInfo(cName: string): VarInfo | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const v = this.scopes[i].get(cName);
      if (v) return v;
    }
    return undefined;
  }

  private localCType(cName: string): CType | undefined { return this.localInfo(cName)?.ctype; }
  private hasLocal(cName: string): boolean { return this.localInfo(cName) !== undefined; }
  /** Bound in an ENCLOSING scope (not the current top scope) -- a capture candidate. */
  private inEnclosingScope(cName: string): VarInfo | undefined {
    for (let i = this.scopes.length - 2; i >= 0; i--) {
      const v = this.scopes[i].get(cName);
      if (v) return v;
    }
    return undefined;
  }

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
    // The top-level declarations, flattened out of the HIR body (the whole program is one block, so
    // each declaration arrives as an opaque-stmt whose `src` is the desugared StructNode / ClassNode
    // / FunctionNode). Drive the pre-pass off these, not the raw program (which is still list-wrapped).
    const items = this.topLevelStmtNodes(body);
    // Collect struct/class descriptors and operator overloads first: construction, field access,
    // methods and operator dispatch are all resolved from these, not from the HIR (spec A4/A3).
    this.collectClassesAndOperators(items);
    // Register every top-level function first, so forward references (call before declaration, or a
    // function used as a value) resolve regardless of order.
    this.registerModuleFunctions(items);
    // A module-level binding referenced by any top-level function must be a C global.
    this.computeGlobals(items);
    // The module body is itself a scope for capture purposes (a top-level lambda still captures
    // module locals). Compute its cell set from nested closures before resolving.
    this.cellVars = this.computeCellVars(items);
    const main = body ? this.resolveBlock(body) : { stmts: [] };
    if (this.refused) return null;
    const classes: CClass[] = [...this.classes.values()].map((c) => ({
      name: c.name, isStruct: c.isStruct, fields: c.fields,
    }));
    return {
      functions: this.functions,
      lifted: this.lifted,
      classes,
      globals: this.globalDecls,
      adapters: [...this.adapters.values()],
      main,
    };
  }

  /** Module-level bindings referenced by a top-level function -> C globals (the module-scope analog
   *  of closure capture: a C function cannot reach `main`'s locals). A finding in itself (the JS
   *  backend gets module-scope closure for free; a C target must hoist). */
  private computeGlobals(items: ast.ASTNode[]): void {
    const moduleBindings = new Set<string>();
    for (const n of items) {
      if (n?._type === "variable") {
        const nm = (n as ast.VariableNode).name;
        if (nm?._type === "simple-identifier" || nm?._type === "composite-identifier") moduleBindings.add(ast.symbolName(nm as ast.IdentifierNode));
      }
    }
    if (moduleBindings.size === 0) return;
    for (const n of items) {
      if (n?._type !== "function") continue;
      for (const fv of freeVariables(n as ast.FunctionNode)) {
        if (moduleBindings.has(fv)) this.globalNames.add(fv);
      }
    }
    if (this.globalNames.size) this.ledger.record("new", "module-global", items[0], "module-level binding referenced by a top-level function; hoisted to a C global (JS closes over module scope for free)");
  }

  // -- struct/class collection (spec A4: the whole layer is absent from the HIR) -------------------

  /** The desugared declaration nodes at module top level (opaque-stmt src nodes from the HIR body). */
  private topLevelStmtNodes(body: HBlock | undefined): ast.ASTNode[] {
    const out: ast.ASTNode[] = [];
    const walk = (b: HBlock | undefined): void => {
      for (const s of b?.stmts ?? []) {
        if (s.kind === "opaque-stmt" || s.kind === "expr-stmt" || s.kind === "var-decl") out.push(s.src);
        else if (s.kind === "block") walk(s.body);
      }
    };
    walk(body);
    return out;
  }

  private collectClassesAndOperators(items: ast.ASTNode[]): void {
    for (const n of items) {
      if (!n) continue;
      if (n._type === "struct" || n._type === "class") this.registerClass(n as ast.StructNode | ast.ClassNode);
      // A top-level `:operator` function -- collected for static devirtualization.
      if (n._type === "function") this.maybeRegisterOperator(n as ast.FunctionNode);
    }
  }

  private registerClass(node: ast.StructNode | ast.ClassNode): void {
    const name = ast.symbolName(node.name);
    if (this.classes.has(name)) return;
    const isStruct = node._type === "struct";
    this.ledger.record("A4", isStruct ? "defstruct" : "defclass", node, "construction/field-layout resolved from the symbol table (the HIR has none)");
    const t: any = (() => { try { return this.context.symbolTable.resolveSymbol(name, node)?.inferredType; } catch { return undefined; } })();
    // Field order: constructor params (the slot order the JS ClassBuilder also uses). Field TYPES
    // come from the AST annotations (`(let :ctor x <- Real)`) -- more complete than the checker's
    // ctorInfo, which erases an inferred struct field type to Unknown (spec A1).
    const ctorParams: any[] = t?.ctorInfo?.params ?? [];
    const astFieldTypes = this.memberFieldTypes(node);
    const memberType = (fname: string): CType => {
      const m = (t?.members ?? []).find((mm: any) => mm.name === fname && mm.type?.kind !== "function");
      return m?.type ? mapType(m.type) : C_VALUE;
    };
    const fields = ctorParams.map((p: any) => ({
      name: p.name,
      ctype: astFieldTypes.get(p.name) ?? (p.type ? mapType(p.type) : memberType(p.name)),
    }));
    const fieldSlot = new Map<string, number>();
    fields.forEach((f, i) => fieldSlot.set(f.name, i));
    const methods = new Map<string, { cName: string; params: CType[]; ret: CType }>();
    // Register the descriptor NOW (before processing members) so a self-referential member type --
    // an operator returning its own class, a method taking the same struct -- resolves to obj.
    this.classes.set(name, { name, isStruct, fields, fieldSlot, methods });
    for (const m of this.memberFunctions(node)) {
      if (!m.name) continue;
      const mn = ast.symbolName(m.name);
      const isOp = m.modifiers?.some((mod) => mod.modifier === "operator");
      if (isOp) { this.maybeRegisterOperator(m, name); continue; }
      const sig: any = t?.methodSignatures?.get?.(mn);
      const paramCTypes = m.params.map((p, i) => this.typeNodeToCType(p.type) ?? (sig?.params?.[i] ? mapType(sig.params[i]) : C_VALUE));
      methods.set(mn, {
        cName: `__ll_method_${mangleBare(name)}_${mangleBare(mn)}`,
        params: paramCTypes,
        ret: this.typeNodeToCType(m.returns) ?? mapType(sig?.returns),
      });
    }
  }

  /** Field type annotations from the struct/class body (`(let :ctor x <- Real 0)` -> {x: real}). */
  private memberFieldTypes(node: ast.StructNode | ast.ClassNode): Map<string, CType> {
    const out = new Map<string, CType>();
    const consider = (v: ast.VariableNode): void => {
      const nm = v.name;
      if (nm?._type !== "simple-identifier" && nm?._type !== "composite-identifier") return;
      const ct = this.typeNodeToCType(v.type);
      if (ct) out.set(ast.symbolName(nm as ast.IdentifierNode), ct);
    };
    for (const item of node.body ?? []) {
      if (item._type === "variable") { consider(item as ast.VariableNode); continue; }
      if (item._type === "list") {
        const v = ((item as ast.ListNode).nodes ?? []).find((n) => n._type === "variable");
        if (v) consider(v as ast.VariableNode);
      }
    }
    return out;
  }

  /** The member functions (methods + operators) of a struct/class. Each body member is a `list`
   *  wrapping the function node (the desugared `(fn ...)` form); unwrap it. */
  private memberFunctions(node: ast.StructNode | ast.ClassNode): ast.FunctionNode[] {
    const out: ast.FunctionNode[] = [];
    for (const item of node.body ?? []) {
      if (item._type === "function") { out.push(item as ast.FunctionNode); continue; }
      if (item._type === "list") {
        const fn = ((item as ast.ListNode).nodes ?? []).find((n) => n._type === "function");
        if (fn) out.push(fn as ast.FunctionNode);
      }
    }
    return out;
  }

  /** Record a `:operator` function keyed by (op, left-operand type) for static devirtualization.
   *  Two shapes: a TOP-LEVEL op writes both operands (`[a b]`); an IN-STRUCT method op writes only
   *  the right operand, the left being the implicit `this` (`[other]`, or `[]` for a unary op). */
  private maybeRegisterOperator(fn: ast.FunctionNode, ownerClass?: string): void {
    const isOp = fn.modifiers?.some((m) => m.modifier === "operator");
    if (!isOp || !fn.name) return;
    const op = ast.symbolName(fn.name);
    const isMethod = ownerClass !== undefined;
    const unary = isMethod ? fn.params.length === 0 : fn.params.length <= 1;
    const opType = ownerClass ?? this.paramTypeName(fn.params[0]);
    if (!opType) return;
    const cName = isMethod
      ? `__ll_method_${mangleBare(ownerClass!)}_op${unary ? "u" : ""}_${encodeOp(op)}`
      : mangleC(`op${unary ? "u" : ""}${op}_${opType}`);
    const t: any = (() => { try { return this.context.symbolTable.resolveSymbol(op, fn)?.inferredType; } catch { return undefined; } })();
    const ret = this.typeNodeToCType(fn.returns) ?? mapType(t?.kind === "function" ? t.returns : undefined);
    this.operators.set(`${unary ? "u" : ""}${op}:${opType}`, { cName, ret, isMethod, unary });
    this.ledger.record("A3", "operator-devirt", fn, "operator overload devirtualized to a direct call by (op, operand type)");
  }

  private paramTypeName(p: ast.ParameterNode | undefined): string | undefined {
    return this.typeNodeName(p?.type);
  }

  /** The source name of a TypeNode, unwrapping the `type` -> `simple-type` -> `type-name` nesting. */
  private typeNodeName(t: any): string | undefined {
    if (!t || typeof t !== "object") return undefined;
    if (t._type === "type") return this.typeNodeName(t.type);
    const nm = typeof t.name === "string" ? t.name : t.name?.name;
    return typeof nm === "string" ? nm : undefined;
  }

  /** Map a TypeNode annotation to a CType: a known struct/class -> obj, primitive -> native, else
   *  undefined (the caller falls back to the symbol channel / boxed). The AST annotation is often
   *  more complete than the symbol table for a struct type (which erases to Unknown). */
  private typeNodeToCType(t: any): CType | undefined {
    if (!t || typeof t !== "object") return undefined;
    // An OPTIONAL type `T?` admits nil -> it must stay boxed (value). Defer to the symbol channel.
    if (t.optional === true || t.type?.optional === true) return undefined;
    if (t.array === true || t.type?.array === true) return { k: "vec", elem: C_VALUE };
    const nm = this.typeNodeName(t);
    if (!nm) return undefined;
    if (this.classes.has(nm)) return { k: "obj", className: nm };
    const prim: Record<string, CType> = {
      Int: C_INT, Real: C_REAL, Boolean: C_BOOL, Bool: C_BOOL, String: C_STR, Char: { k: "char" }, Void: C_VOID,
    };
    return prim[nm];
  }

  // -- cell analysis: which mut-locals of a scope are captured by nested closures ------------------

  /** The mutable locals of THIS statement sequence that some nested closure captures -> heap cells. */
  private computeCellVars(items: ast.ASTNode[]): Set<string> {
    const muts = new Set<string>();
    for (const it of items) this.collectMutDecls(it, muts);
    if (muts.size === 0) return new Set();
    const captured = new Set<string>();
    for (const it of items) this.collectNestedFreeVars(it, captured);
    const cells = new Set<string>();
    for (const m of muts) if (captured.has(m)) cells.add(mangleC(m));
    return cells;
  }

  private collectMutDecls(node: any, into: Set<string>): void {
    if (!node || typeof node !== "object") return;
    if (node._type === "variable" && (node as ast.VariableNode).mutable) {
      const n = (node as ast.VariableNode).name;
      if (n._type === "simple-identifier" || n._type === "composite-identifier") into.add(ast.symbolName(n as ast.IdentifierNode));
    }
    // Only the immediate sequence's own muts (a nested fn's muts are ITS scope's problem).
    if (node._type === "function") return;
    if (node._type === "list") {
      const form = classifyList(node as ast.ListNode);
      if (form.kind === "block") for (const it of form.items) this.collectMutDecls(it, into);
      else if (form.kind === "grouping") this.collectMutDecls(form.inner, into);
    }
  }

  private collectNestedFreeVars(node: any, into: Set<string>): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) this.collectNestedFreeVars(c, into); return; }
    if (node._type === "function") {
      for (const n of freeVariables(node as ast.FunctionNode)) into.add(n);
      return;
    }
    for (const k of Object.keys(node)) {
      if (k.startsWith("_")) continue;
      this.collectNestedFreeVars(node[k], into);
    }
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
          this.declareLocal(h.name, declCType);
          return [{ src: h.src, ctype: C_VOID, kind: "c-decl", cName: h.name, declCType, init: t }];
        }

        case "assign-temp": {
          let value = this.resolveExpr(h.value);
          if (h.isStore) {
            // The D11 copy DECISION is not on the node -- the HIR only has a flag (spec A5).
            this.ledger.record("A5", "assign-temp-store", h.src, "isStore flag stands in for an explicit copy node");
            value = { src: h.src, ctype: value.ctype, kind: "c-copy", inner: value };
          }
          const target: CLValue = { kind: "name", cName: h.name, ctype: this.localCType(h.name) ?? value.ctype };
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
    let declCType = t !== undefined ? mapType(t) : init ? init.ctype : C_VALUE;
    // A binding whose type resolved to boxed but whose initializer is a concrete struct/vector keeps
    // the initializer's shape: the symbol table erases an inferred struct type to Unknown, but the
    // init is authoritative (a struct binding must stay typed for field access). Skip when the
    // annotation is OPTIONAL -- `T?` must stay boxed so it can later hold nil.
    const optionalAnn = !!(node.type && ((node.type as any).optional || (node.type as any).type?.optional));
    if (declCType.k === "value" && !optionalAnn && init && (init.ctype.k === "obj" || init.ctype.k === "vec")) {
      declCType = init.ctype;
    }
    if (t === undefined && !init) this.ledger.record("A1", "decl-untyped", node, "no channel or symbol type for binding; boxed");
    // A mutable binding captured by an escaping closure becomes a heap cell (boxed) so the closure
    // and the origin share the mutation -- the env the HIR does not model (spec A3/A5).
    const cell = this.cellVars.has(cName);
    if (cell) {
      this.ledger.record("A5", "mut-capture-cell", node, "mut binding captured by a closure; boxed into a shared heap cell");
      declCType = C_VALUE;
    }
    // A `let`/`mut` is a store site: a struct initializer is COPIED (D11).
    const storedInit = init ? this.copyStore(init, node, "let-decl") : null;
    // A module-level binding referenced by a function is a C GLOBAL: declare it once at file scope
    // and emit an ASSIGNMENT here (the global is visible to the functions that close over it).
    if (!this.inFunctionBody && this.globalNames.has(srcName)) {
      if (!this.globalDeclared.has(cName)) {
        this.globalDeclared.add(cName);
        this.globalDecls.push({ cName, ctype: declCType });
      }
      this.declareLocal(cName, declCType, node.mutable, cell); // still in module scope for local reads
      if (!storedInit) return [];
      return [{ src: node, ctype: C_VOID, kind: "c-assign", target: { kind: "name", cName, ctype: declCType }, value: storedInit }];
    }
    this.declareLocal(cName, declCType, node.mutable, cell);
    return [{ src: node, ctype: C_VOID, kind: "c-decl", cName, declCType, init: storedInit, cell }];
  }

  private resolveUserAssign(node: ast.SimpleAssignmentNode | ast.CompoundAssignmentNode, rhs: CExpr): CStmt[] {
    const target = this.dipAst("A2", "assign-target", node, "assignment target read from raw AST (legacy emitAssign seam)", () => node.assignable);
    const lval = this.resolveLValue(node, target);
    return [{ src: node, ctype: C_VOID, kind: "c-assign", target: lval, value: this.copyStore(rhs, node, "user-assign") }];
  }

  /** The D11 copy DECISION at a store site (spec A5). Wraps a struct/boxed value in an explicit copy
   *  node; a native primitive, array or class reference is left alone (CP3 shallow-at-reference). The
   *  copy MATERIALIZATION (deep vs shared) is the runtime's ll_copy dispatching on the tag. */
  private copyStore(e: CExpr, src: ast.ASTNode, site: string): CExpr {
    if (e.ctype.k !== "obj" && e.ctype.k !== "value") return e; // int/real/str/vec/map/closure: no copy
    // A fresh construction is already a new value -- no copy needed (matches the JS elision).
    if (e.kind === "c-construct") return e;
    this.ledger.record("A5", `copy:${site}`, src, "explicit CP3 value-copy at a store site (the D11 decision the HIR only flags)");
    return { src, ctype: e.ctype, kind: "c-copy", inner: e };
  }

  /** Resolve an assignment target to an lvalue: a name, a struct FIELD chain, or an INDEX. */
  private resolveLValue(node: ast.ASTNode, target: ast.ASTNode): CLValue {
    // `x` / `this.x` / `a.b.c` -- an identifier or dotted chain.
    if (target._type === "simple-identifier" || target._type === "composite-identifier") {
      const parts = target._type === "composite-identifier" ? (target as ast.CompositeIdentifierNode).parts : [(target as ast.SimpleIdentifierNode).id];
      if (parts.length === 1) {
        const cName = mangleC(parts[0]);
        const info = this.localInfo(cName);
        const ctype = info?.ctype ?? this.bindingCType(target as ast.IdentifierNode);
        return { kind: "name", cName, ctype, cell: info?.cell };
      }
      // A field chain: read the head + intermediate fields, then the LAST part is the store slot.
      let obj = this.headObject(node, parts[0]);
      for (const mid of parts.slice(1, -1)) obj = this.memberRead(node, obj, mid);
      return this.fieldLValue(node, obj, parts[parts.length - 1]);
    }
    // A core `member` node target: `obj.field := v` (member of a computed value).
    if (target._type === "member") {
      const m = target as ast.MemberNode;
      const obj = this.resolveAstExpr(m.object);
      const fieldName = this.memberName(m.property);
      if (fieldName === null) throw this.refuse(node, "computed-member-store", "resolveLValue");
      return this.fieldLValue(node, obj, fieldName);
    }
    // `arr[i] := v` / `obj[k] := v` / `m.field[i] := v` -- an indexer target.
    if (target._type === "indexer") {
      const idx = target as ast.IndexerNode;
      const steps: { isMember: boolean; index: ast.ASTNode }[] = [];
      (idx.indices ?? []).forEach((group, g) => {
        for (const ix of group) steps.push({ isMember: idx.members?.[g] === true, index: ix });
      });
      let obj = this.headObject(node, ast.symbolName(idx.id));
      for (let i = 0; i < steps.length - 1; i++) {
        obj = steps[i].isMember
          ? this.memberRead(node, obj, this.stepName(steps[i].index))
          : this.indexRead(node, obj, this.resolveAstExpr(steps[i].index), true);
      }
      const last = steps[steps.length - 1];
      if (last.isMember) return this.fieldLValue(node, obj, this.stepName(last.index));
      this.ledger.record("A5", "index-store", node, "index assignment lvalue (partial write)");
      const mode = obj.ctype.k === "vec" ? "vec" : obj.ctype.k === "map" ? "map" : obj.ctype.k === "str" ? "str" : "boxed";
      return { kind: "index", base: obj, index: this.resolveAstExpr(last.index), mode };
    }
    throw this.refuse(node, `assign-to-${target._type}`, "resolveLValue");
  }

  private headObject(node: ast.ASTNode, headName: string): CExpr {
    if (headName === "this" && this.selfClass) {
      return { src: node, ctype: { k: "obj", className: this.selfClass }, kind: "c-ref", cName: "__self" };
    }
    const cName = mangleC(headName);
    const info = this.localInfo(cName);
    const ctype = info?.ctype ?? this.bindingCType({ _type: "simple-identifier", id: headName } as any);
    return { src: node, ctype, kind: "c-ref", cName, cell: info?.cell };
  }

  private stepName(step: ast.ASTNode): string {
    return (step as any).id ?? String((step as any).value ?? "");
  }

  private fieldLValue(node: ast.ASTNode, obj: CExpr, fieldName: string): CLValue {
    if (obj.ctype.k === "obj") {
      const desc = this.classes.get(obj.ctype.className);
      if (desc?.fieldSlot.has(fieldName)) {
        this.ledger.record("A4", "field-store", node, "struct field store resolved to a slot (not the HIR)");
        return { kind: "field", object: obj, slot: desc.fieldSlot.get(fieldName)!, fieldName };
      }
    }
    throw this.refuse(node, `field-store:${fieldName}`, "fieldLValue");
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
    this.declareLocal(cName, varCType);
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
        const ctype = this.localCType(h.name) ?? this.ctypeOf(h, "temp-read");
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
        // A collection slot is a store site: a struct element is copied (D11).
        const elements = h.elements.map((e) => this.copyStore(this.resolveExpr(e), h.src, "collection-elem"));
        const ct = this.ctypeOf(h, "vector");
        // Prefer the channel's element type; else infer a common concrete element type (so a vector of
        // structs stays `vec<obj>` and its for-each binding / index reads stay typed).
        const elem = ct.k === "vec" && ct.elem.k !== "value" ? ct.elem : (this.commonElemType(elements) ?? C_VALUE);
        return { src: h.src, ctype: { k: "vec", elem }, kind: "c-vector", elements };
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
    // A struct/class field read routes to slot access (spec A4). A zero-arg method reference stays a
    // member read here only if it is a field-held closure; a genuine method reference is not a value.
    if (object.ctype.k === "obj") {
      const desc = this.classes.get(object.ctype.className);
      if (desc?.fieldSlot.has(fieldName)) return this.fieldGet(src, object, fieldName);
      // A zero-arg method invoked in `{(v.str)}` form: `(v.str)` is a call. Reached here only as a
      // value read of a method -> invoke it (the D1 dotted-call rule); the method takes only self.
      if (desc?.methods.has(fieldName)) return this.resolveObjMethod(src, object, fieldName, []);
    }
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
      ctype: this.localCType(h.scrutName) ?? C_VALUE,
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
      case "interface":
      case "modifier-def":
      case "macro-def":
        return []; // compile-time / erased declarations (interfaces are erased per D24)
      case "struct":
      case "class":
        this.collectClassMembers(node as ast.StructNode | ast.ClassNode);
        return [];
      case "function": {
        const f = node as ast.FunctionNode;
        // A module-level declaration is a top-level C function; a declaration inside a function body
        // is a nested closure bound to a local.
        if (!this.inFunctionBody) { this.collectFunction(f); return []; }
        return this.resolveNestedFnDecl(f);
      }
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
        this.declareLocal(cName, varCType);
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
      case "function":
        // A lambda literal in value position -> a closure.
        return this.resolveLambda(node as ast.FunctionNode);
      case "call": {
        // A desugarer CORE call node (pipelines): the callee is any expression, not just a name.
        const c = node as ast.CallNode;
        return this.resolveCoreCall(c, c.callee, c.arguments ?? []);
      }
      case "member": {
        // A desugarer CORE member node (pipelines: `x |> .length`): member of a computed value.
        const m = node as ast.MemberNode;
        const object = this.resolveAstExpr(m.object);
        const field = this.memberName(m.property);
        if (field === null) throw this.refuse(node, "computed-member", "resolveAstExpr");
        return this.memberRead(node, object, field);
      }
      case "type-guard": {
        // `(x :of T)` -- a runtime type test yielding Boolean (D41, spec A7's guard half).
        const g = node as ast.TypeGuardNode;
        return this.resolveTypeTest(node, this.resolveAstExpr(g.value), g.type);
      }
      default:
        throw this.refuse(node, node._type, "resolveAstExpr");
    }
  }

  /** The field name of a member `property` node (an identifier or a string key). */
  private memberName(property: ast.ASTNode): string | null {
    if (property._type === "simple-identifier") return (property as ast.SimpleIdentifierNode).id;
    if (property._type === "composite-identifier") {
      const parts = (property as ast.CompositeIdentifierNode).parts;
      return parts[parts.length - 1];
    }
    if (property._type === "string") return (property as ast.StringNode).value;
    return null;
  }

  /** A core `call` node whose callee is an arbitrary expression (operator, name, lambda, or value). */
  private resolveCoreCall(node: ast.ASTNode, callee: ast.ASTNode, args: ast.ASTNode[]): CExpr {
    if (callee._type === "simple-identifier" || callee._type === "composite-identifier") {
      // Reuse the full callee-resolution path (operators, top-level, intrinsics, closures).
      return this.resolveCall(node as ast.ListNode, callee, args);
    }
    if (callee._type === "function") {
      return this.closureCall(node, this.resolveLambda(callee as ast.FunctionNode), args);
    }
    // Any other computed callee: evaluate it to a closure value and call through it.
    return this.closureCall(node, this.resolveAstExpr(callee), args);
  }

  /** `(x :of T)` / a match type-pattern: a runtime tag or nominal test (D41). */
  private resolveTypeTest(node: ast.ASTNode, operand: CExpr, typeNode: ast.TypeNode): CExpr {
    const info = this.typeTestName(typeNode);
    if (!info) throw this.refuse(node, "type-test-shape", "resolveTypeTest");
    this.ledger.record("A7", "type-test", node, "runtime type test lowered to ll_is_type (D41)");
    return {
      src: node, ctype: C_BOOL, kind: "c-type-test",
      operand, typeName: info.name, primitive: info.primitive,
    };
  }

  /** Reduce a TypeNode to a runtime-testable name. Generic ARGUMENTS are erased (D24): `Int[]` tests
   *  "is an array", not "array of Int" -- matching the JS `__ll_is_type` the goldens encode. The AST
   *  wraps a `type` around a `simple-type` whose `name` is a `type-name`; unwrap both. */
  private typeTestName(t: any, arrayFromOuter = false): { name: string; primitive: boolean } | null {
    if (!t || typeof t !== "object") return null;
    const isArray = arrayFromOuter || t.array === true || t.isArray === true;
    if (t._type === "type") return this.typeTestName(t.type, isArray);
    if (isArray) return { name: "Array", primitive: false };
    if (t._type === "simple-type" || t._type === "type-name" || t._type === "generic-type") {
      const nm = typeof t.name === "string" ? t.name : t.name?.name;
      if (typeof nm !== "string") return null;
      if (nm === "Array") return { name: "Array", primitive: false };
      const PRIMS = new Set(["Int", "Real", "String", "Boolean", "Bool", "Char", "Void"]);
      return { name: nm, primitive: PRIMS.has(nm) };
    }
    if (typeof t.name === "string") {
      const PRIMS = new Set(["Int", "Real", "String", "Boolean", "Bool", "Char", "Void"]);
      return { name: t.name, primitive: PRIMS.has(t.name) };
    }
    return null;
  }

  // -- struct/class construction, fields, methods (spec A4) ----------------------------------------

  /** The common concrete element type of a vector literal, or undefined if the elements disagree. */
  private commonElemType(elements: CExpr[]): CType | undefined {
    if (elements.length === 0) return undefined;
    const unwrap = (e: CExpr): CType => (e.kind === "c-copy" ? e.inner.ctype : e.ctype);
    const first = unwrap(elements[0]);
    if (first.k === "value") return undefined;
    return elements.every((e) => ctypeEquals(unwrap(e), first)) ? first : undefined;
  }

  private resolveConstruct(node: ast.ASTNode, className: string, args: ast.ASTNode[]): CExpr {
    const desc = this.classes.get(className)!;
    this.ledger.record("A4", "construct", node, `construction of '${className}' resolved from the symbol table (no HIR node)`);
    // A field initializer is a store site: a struct-typed arg is copied (D11), an array/class shared.
    const cArgs = args.map((a) => this.copyStore(this.resolveAstExpr(a), node, "field-init"));
    return {
      src: node, ctype: { k: "obj", className },
      kind: "c-construct", className, isStruct: desc.isStruct, args: cArgs, fieldCount: desc.fields.length,
    };
  }

  /** A field read off a typed struct/class receiver: slot access + unbox. */
  private fieldGet(node: ast.ASTNode, object: CExpr, fieldName: string): CExpr {
    const className = object.ctype.k === "obj" ? object.ctype.className : undefined;
    const desc = className ? this.classes.get(className) : undefined;
    if (desc && desc.fieldSlot.has(fieldName)) {
      const slot = desc.fieldSlot.get(fieldName)!;
      this.ledger.record("A4", "field-get", node, "struct field access resolved to a slot from the descriptor (not the HIR)");
      return { src: node, ctype: desc.fields[slot].ctype, kind: "c-field-get", object, slot, fieldName };
    }
    // A method referenced as a value, or a dynamic member -> fall back to boxed member read.
    return this.memberRead(node, object, fieldName);
  }

  /** A method call on a typed struct/class receiver, devirtualized to a direct call with self. */
  private resolveObjMethod(node: ast.ASTNode, recv: CExpr, method: string, args: ast.ASTNode[]): CExpr {
    const className = (recv.ctype as any).className as string;
    const desc = this.classes.get(className)!;
    const m = desc.methods.get(method);
    if (m) {
      this.ledger.record("A3", "method-devirt", node, "method call devirtualized to a direct call with explicit self (SIL-style)");
      const cArgs = args.map((a) => this.resolveAstExpr(a));
      return { src: node, ctype: m.ret, kind: "c-call", callee: { kind: "free", cName: m.cName, params: [{ k: "obj", className }, ...m.params], ret: m.ret }, args: [recv, ...cArgs] };
    }
    if (desc.fieldSlot.has(method)) {
      // `(obj.field)` with NO args is a D1 field READ; with args, a call through a field-held closure.
      const field = this.fieldGet(node, recv, method);
      return args.length === 0 ? field : this.closureCall(node, field, args);
    }
    throw this.refuse(node, `method:${className}.${method}`, "resolveObjMethod");
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
      const ctype = this.localCType(name) ?? this.ctypeOfAst(node, "temp-substituted");
      return { src: node, ctype, kind: "c-temp", name };
    }
    // `this` inside a method body binds to the self object.
    if (name === "this" && this.selfClass) {
      return { src: node, ctype: { k: "obj", className: this.selfClass }, kind: "c-ref", cName: "__self" };
    }
    if (node._type === "composite-identifier") {
      return this.resolveCompositeRead(node as ast.CompositeIdentifierNode);
    }
    const cName = mangleC(name);
    const info = this.localInfo(cName);
    // A module-level GLOBAL referenced from inside a function (not shadowed by a local).
    if (!info && this.globalNames.has(name)) {
      const g = this.globalDecls.find((d) => d.cName === cName);
      this.ledger.record("A2", "atom-ref", node, "variable read is an opaque leaf; resolved below the HIR");
      return { src: node, ctype: g?.ctype ?? C_VALUE, kind: "c-ref", cName };
    }
    // A TOP-LEVEL function referenced as a VALUE (not called): becomes a closure via an adapter --
    // the "functions are values" gap the HIR does not model (spec A3). Only when it is NOT a local
    // (a local of the same name shadows).
    if (!info && this.topLevelFns.has(name)) {
      return this.functionValue(node, name);
    }
    this.ledger.record("A2", "atom-ref", node, "variable read is an opaque leaf; resolved below the HIR");
    let t = this.context.nodeTypes.get(node);
    if (t === undefined) {
      const entry = this.dipSymbols("A1", "ref-type-via-symbols", node, "identifier use missing from channel; binding type from symbol table", name);
      if (this.isExtern(entry)) throw this.refuseExtern(node, name);
      // An imported/top-level function referenced as a value but not yet registered: treat as a value.
      if (entry?.inferredType?.kind === "function" && this.isLocalDef(entry)) {
        this.registerTopLevel(entry.value as ast.FunctionNode, name);
        return this.functionValue(node, name);
      }
      t = entry?.inferredType;
    }
    const ctype = info?.ctype ?? (t !== undefined ? mapType(t) : C_VALUE);
    if (t === undefined && !info) {
      this.ledger.record("A1", "ref-untyped", node, "no channel or symbol type for identifier use; boxed");
    }
    return { src: node, ctype, kind: "c-ref", cName, cell: info?.cell };
  }

  /** A top-level function used as a value -> a closure over a boxed-convention adapter (no captures). */
  private functionValue(node: ast.ASTNode, name: string): CExpr {
    this.ledger.record("A3", "function-as-value", node, "function used as a first-class value; boxed-convention adapter synthesized");
    const sig = this.topLevelFns.get(name)!;
    const cName = mangleC(name);
    this.adapters.set(cName, { forCName: cName, params: sig.params, ret: sig.ret, arity: sig.arity });
    return {
      src: node,
      ctype: { k: "closure", params: sig.params, ret: sig.ret },
      kind: "c-closure-make",
      liftedName: `__ll_adapter_${cName}`,
      envStruct: null,
      captures: [],
      arity: sig.arity,
      name,
    };
  }

  private bindingCType(node: ast.IdentifierNode): CType {
    const entry = this.dipSymbols("A2", "binding-type", node, "binding type resolved through the symbol table", ast.symbolName(node));
    return entry?.inferredType !== undefined ? mapType(entry.inferredType) : C_VALUE;
  }

  /** `a.b` as a VALUE: `this.field`, a local's struct field / native member, or a host global (A9). */
  private resolveCompositeRead(node: ast.CompositeIdentifierNode): CExpr {
    const parts = node.parts;
    const headName = parts[0];
    // `this.x` inside a method.
    if (headName === "this" && this.selfClass) {
      let expr: CExpr = { src: node, ctype: { k: "obj", className: this.selfClass }, kind: "c-ref", cName: "__self" };
      for (const field of parts.slice(1)) expr = this.memberRead(node, expr, field);
      return expr;
    }
    const local = (() => { try { return this.context.symbolTable.resolveSymbol(headName, node); } catch { return undefined; } })();
    const info = this.localInfo(mangleC(headName));
    const isLocal = !this.isExtern(local) && (local?.inferredType !== undefined || info !== undefined);
    if (isLocal) {
      // A member read off a local binding.
      let expr: CExpr = {
        src: node,
        ctype: info?.ctype ?? mapType(local?.inferredType),
        kind: "c-ref",
        cName: mangleC(headName),
        cell: info?.cell,
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
        // `(new Point 1 2)` -- explicit construction. The class name is the first argument.
        if (form.name === "new" && form.args.length >= 1) {
          const cls = form.args[0];
          const clsName = cls._type === "simple-identifier" ? (cls as ast.SimpleIdentifierNode).id
            : cls._type === "type-name" ? (cls as any).name : undefined;
          if (clsName && this.classes.has(clsName)) return this.resolveConstruct(node, clsName, form.args.slice(1));
        }
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
        // A user unary `:operator -` on a struct operand -> a devirtualized call.
        if (operand.ctype.k === "obj") {
          const overload = this.operators.get(`u-:${operand.ctype.className}`);
          if (overload) {
            this.ledger.record("A3", "operator-call", node, "unary operator overload dispatched statically");
            return { src: node, ctype: overload.ret, kind: "c-call", callee: { kind: "free", cName: overload.cName, params: [operand.ctype], ret: overload.ret }, args: [operand] };
          }
        }
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
      // A local binding of a compound name (a captured closure `a.b`?) is rare; the dotted path
      // handles a local receiver's method. A local CLOSURE named plainly is handled below.
      return this.resolveDottedCall(node, callee as ast.CompositeIdentifierNode, args);
    }
    if (callee._type === "function") {
      // An applied lambda literal: `((fn [x] ...) 3)`.
      return this.closureCall(node, this.resolveLambda(callee as ast.FunctionNode), args);
    }
    if (callee._type === "call" || callee._type === "member") {
      // A computed callee (a pipeline stage producing a function): call through the value.
      return this.closureCall(node, this.resolveAstExpr(callee), args);
    }
    if (ast.isListNode(callee) || callee._type === "indexer") {
      throw this.refuse(node, "computed-callee", "resolveCall");
    }

    // A plain named callee.
    if (callee._type === "simple-identifier") {
      const name = (callee as ast.SimpleIdentifierNode).id;
      const cName = mangleC(name);
      // (1) A LOCAL binding used as a callee. With ARGS -> a call through a closure VALUE (a param
      // `f`, a let-bound closure `times-3`); the "callee is a value" gap (spec A3). With ZERO args
      // it is a D1 READ (`(counter)` reads the binding -- invoking a zero-arg closure is `(call c)`).
      const local = this.localInfo(cName);
      if (local) {
        if (args.length === 0) return this.resolveIdentifier(callee as ast.IdentifierNode);
        return this.closureCall(node, this.resolveIdentifier(callee as ast.IdentifierNode), args);
      }
      // (2) A struct/class name -> construction (spec A4: the HIR models no construction).
      if (this.classes.has(name)) {
        return this.resolveConstruct(node, name, args);
      }
      // (3) A top-level function defined in this module -> a direct typed C call.
      if (this.topLevelFns.has(name)) {
        const sig = this.topLevelFns.get(name)!;
        const cArgs = args.map((a) => this.resolveAstExpr(a));
        return { src: node, ctype: sig.ret, kind: "c-call", callee: { kind: "free", cName, params: sig.params, ret: sig.ret }, args: cArgs };
      }
      const entry = this.dipSymbols("A3", "callee-identity", node, "callee resolved through the symbol table (spec wants it on the call node)", name);
      const symT = entry?.inferredType;
      const builtin = INTRINSIC_CALLS.get(name);
      if (builtin) {
        if (entry !== undefined && !this.isExtern(entry)) {
          this.ledger.record("A9-extern", "stdlib-intrinsic", node, `'${name}' stdlib body shadowed by a C intrinsic`);
        }
        const cArgs = args.map((a) => this.resolveAstExpr(a));
        return { src: node, ctype: builtin.ret, kind: "c-call", callee: { kind: "intrinsic", ...builtin }, args: cArgs };
      }
      // (3) An IMPORTED (non-intrinsic) l-lang function -> lower its body on demand (the C analog of
      // the JS backend's ensureSymbolInlined) and call it directly.
      if (symT?.kind === "function" && !this.isExtern(entry) && (entry?.value as any)?._type === "function") {
        this.lowerImportedFunction(name, entry!.value as ast.FunctionNode);
        const sig = this.topLevelFns.get(name)!;
        const cArgs = args.map((a) => this.resolveAstExpr(a));
        return { src: node, ctype: sig.ret, kind: "c-call", callee: { kind: "free", cName, params: sig.params, ret: sig.ret }, args: cArgs };
      }
      if (args.length === 0) {
        // `(x)` where x is not a function: redundant parens around a value (D1).
        return this.resolveIdentifier(callee as ast.IdentifierNode);
      }
      throw this.refuseExtern(node, name);
    }

    throw this.refuse(node, `callee:${callee._type}`, "resolveCall");
  }

  /** Lower an imported l-lang function's body on demand, isolating its scope (dedup by source name). */
  private lowerImportedFunction(name: string, fn: ast.FunctionNode): void {
    if (this.importedLowered.has(name)) return;
    this.importedLowered.add(name);
    if (this.refuseCoroutine(fn, name)) return;
    this.ledger.record("A9-extern", "imported-body", fn, `imported l-lang function '${name}' lowered on demand (C analog of ensureSymbolInlined)`);
    this.registerTopLevel(fn, name);
    const sig = this.topLevelFns.get(name)!;
    this.isolated(fn, () => {
      const params: CParam[] = fn.params.map((p, i) => this.declareParam(p, sig.params[i]));
      const prologue = this.paramCopyPrologue(fn, params);
      const body = this.resolveFunctionBody(fn);
      this.functions.push({ src: fn, cName: mangleC(name), params, ret: sig.ret, body: { stmts: [...prologue, ...body.stmts] } });
    });
  }

  private resolveDottedCall(node: ast.ListNode, callee: ast.CompositeIdentifierNode, args: ast.ASTNode[]): CExpr {
    const whole = callee.id;
    const intrinsic = INTRINSIC_CALLS.get(whole);
    const headName = callee.parts[0];
    // `(this.field)` / `(this.method args)` inside a method body.
    if (headName === "this" && this.selfClass) {
      let recv: CExpr = { src: callee, ctype: { k: "obj", className: this.selfClass }, kind: "c-ref", cName: "__self" };
      for (const mid of callee.parts.slice(1, -1)) recv = this.memberRead(node, recv, mid);
      return this.resolveNativeMethod(node, recv, callee.parts[callee.parts.length - 1], args);
    }
    const localEntry = (() => { try { return this.context.symbolTable.resolveSymbol(headName, callee); } catch { return undefined; } })();
    const localVar = this.localInfo(mangleC(headName));

    // A local binding wins over a host global of the same spelling -- but an `:extern` entry IS the
    // host global (the std/js prelude declares `console`, `Math`, ... into the symbol table).
    if (!this.isExtern(localEntry) && (localEntry?.inferredType !== undefined || localVar !== undefined)) {
      let recv: CExpr = {
        src: callee,
        ctype: localVar?.ctype ?? mapType(localEntry?.inferredType),
        kind: "c-ref",
        cName: mangleC(headName),
        cell: localVar?.cell,
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
    // A struct/class receiver -> a devirtualized user method (spec A3/A4).
    if (recv.ctype.k === "obj") return this.resolveObjMethod(node, recv, method, args);
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
    // A user `:operator` overload on a struct/class LEFT operand -> a direct devirtualized call (Q4:
    // extensions/operators resolve statically when the operand type is known). Both shapes call
    // `opfn(lhs, rhs)`: a method op takes lhs as self, a top-level op takes both as params.
    if (lhs.ctype.k === "obj") {
      const overload = this.operators.get(`${canonOp}:${lhs.ctype.className}`);
      if (overload) {
        this.ledger.record("A3", "operator-call", src, "operator overload dispatched statically to a direct call");
        return {
          src, ctype: overload.ret, kind: "c-call",
          callee: { kind: "free", cName: overload.cName, params: [lhs.ctype, rhs.ctype], ret: overload.ret },
          args: [lhs, rhs],
        };
      }
    }
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

  /** Refuse a coroutine (A8); returns true if refused. */
  private refuseCoroutine(fn: ast.FunctionNode, name: string): boolean {
    if (!fn.generator && !fn.async) return false;
    report(this.context, CBackendDiagnostics.CoroutineRefused, fn, {
      form: fn.generator ? "a generator (:gen)" : "async (:async)",
      name,
    });
    this.ledger.record("A8", fn.generator ? "generator" : "async", fn, "coroutine construct refused (no suspend/resume model in the HIR)");
    this.refused = true;
    return true;
  }

  /** Register a top-level (module-scope) function's signature so calls and value-uses resolve. The
   *  param/return CTypes must match the DEFINITION site (declareParam), so the AST annotation wins
   *  over a boxed symbol-table type (a struct param the checker erased to Unknown). */
  private registerTopLevel(fn: ast.FunctionNode, name: string): void {
    if (this.topLevelFns.has(name)) return;
    const symT = this.dipSymbols("A3", "function-signature", fn, "signature resolved through the symbol table (not on the HIR)", name)?.inferredType;
    const symParams: any[] = symT?.kind === "function" ? symT.params ?? [] : [];
    const params = fn.params.map((p, i) => {
      const sigT = symParams[i] ? mapType(symParams[i]) : undefined;
      return (sigT && sigT.k !== "value" ? sigT : undefined) ?? this.ctypeFromAnnotation(p) ?? sigT ?? C_VALUE;
    });
    const ret = this.userFnRet(symT, fn) ;
    const annotatedRet = this.typeNodeToCType(fn.returns);
    this.topLevelFns.set(name, { params, ret: ret.k === "value" && annotatedRet ? annotatedRet : ret, arity: fn.params.length });
  }

  /** Pre-scan the module body: register every top-level function BEFORE resolving (forward refs). */
  private registerModuleFunctions(items: ast.ASTNode[]): void {
    for (const n of items) {
      if (n?._type === "function" && (n as ast.FunctionNode).name && !(n as ast.FunctionNode).generator && !(n as ast.FunctionNode).async
          && !(n as ast.FunctionNode).modifiers?.some((m) => m.modifier === "operator")) {
        this.registerTopLevel(n as ast.FunctionNode, ast.symbolName((n as ast.FunctionNode).name));
      }
    }
  }

  /** Run `body` with a fresh isolated scope stack (a C function sees no enclosing frame). */
  private isolated<T>(fn: ast.FunctionNode, run: () => T): T {
    const savedScopes = this.scopes.slice();
    const savedCells = this.cellVars;
    const savedInFn = this.inFunctionBody;
    const savedSelf = this.selfClass;
    (this as any).scopes = [new Map<string, VarInfo>()];
    this.inFunctionBody = true;
    try {
      this.cellVars = this.computeCellVars(fn.body ?? []);
      return run();
    } finally {
      (this as any).scopes = savedScopes;
      this.cellVars = savedCells;
      this.inFunctionBody = savedInFn;
      this.selfClass = savedSelf;
    }
  }

  /** A TOP-LEVEL function declaration -> a typed C function. Isolated param scope + D11 copy prologue. */
  private collectFunction(fn: ast.FunctionNode): void {
    const name = fn.name ? ast.symbolName(fn.name) : "<anonymous>";
    if (this.refuseCoroutine(fn, name)) return;
    if (!fn.name) { this.refuse(fn, "lambda", "collectFunction"); return; }
    // A top-level `:operator` function compiles under its operator symbol, not its `+` name.
    if (fn.modifiers?.some((m) => m.modifier === "operator")) { this.collectOperatorFn(fn); return; }
    this.registerTopLevel(fn, name);
    const sig = this.topLevelFns.get(name)!;
    this.isolated(fn, () => {
      const params: CParam[] = fn.params.map((p, i) => this.declareParam(p, sig.params[i]));
      const prologue = this.paramCopyPrologue(fn, params);
      const body = this.resolveFunctionBody(fn);
      this.functions.push({ src: fn, cName: mangleC(name), params, ret: sig.ret, body: { stmts: [...prologue, ...body.stmts] } });
    });
  }

  /** Compile a struct/class's method bodies (and in-struct operators) as free functions with self. */
  private collectClassMembers(node: ast.StructNode | ast.ClassNode): void {
    const className = ast.symbolName(node.name);
    // The descriptor may not exist yet if this struct was nested past the pre-pass -- register now.
    if (!this.classes.has(className)) this.registerClass(node);
    for (const fn of this.memberFunctions(node)) {
      if (!fn.name) continue;
      if (fn.modifiers?.some((mod) => mod.modifier === "operator")) { this.collectOperatorFn(fn, className); continue; }
      this.collectMethod(fn, className);
    }
  }

  private collectMethod(fn: ast.FunctionNode, className: string): void {
    const mname = ast.symbolName(fn.name);
    if (this.refuseCoroutine(fn, mname)) return;
    const m = this.classes.get(className)!.methods.get(mname)!;
    const selfType: CType = { k: "obj", className };
    this.isolated(fn, () => {
      this.selfClass = className;
      this.declareLocal("__self", selfType);
      const params: CParam[] = fn.params.map((p, i) => this.declareParam(p, m.params[i]));
      const prologue = this.paramCopyPrologue(fn, params);
      const body = this.resolveFunctionBody(fn);
      this.functions.push({
        src: fn, cName: m.cName,
        params: [{ cName: "__self", ctype: selfType }, ...params],
        ret: m.ret, body: { stmts: [...prologue, ...body.stmts] },
      });
    });
  }

  /** Compile an operator function (top-level or in-struct) under its devirtualized operator symbol.
   *  An in-struct method operator gets `self` as its first C parameter (the left operand = `this`). */
  private collectOperatorFn(fn: ast.FunctionNode, ownerClass?: string): void {
    const op = ast.symbolName(fn.name);
    const isMethod = ownerClass !== undefined;
    const unary = isMethod ? fn.params.length === 0 : fn.params.length <= 1;
    const opType = ownerClass ?? this.paramTypeName(fn.params[0]);
    if (!opType) { this.refuse(fn, "operator-untyped-operand", "collectOperatorFn"); return; }
    const entry = this.operators.get(`${unary ? "u" : ""}${op}:${opType}`);
    if (!entry) { this.refuse(fn, `operator:${op}`, "collectOperatorFn"); return; }
    const t: any = (() => { try { return this.context.symbolTable.resolveSymbol(op, fn)?.inferredType; } catch { return undefined; } })();
    const paramTs: any[] = t?.kind === "function" && t.params ? t.params : fn.params.map(() => undefined);
    this.isolated(fn, () => {
      const selfParams: CParam[] = [];
      if (isMethod) {
        this.selfClass = ownerClass;
        this.declareLocal("__self", { k: "obj", className: ownerClass! });
        selfParams.push({ cName: "__self", ctype: { k: "obj", className: ownerClass! } });
      }
      const params: CParam[] = fn.params.map((p, i) => this.declareParam(p, paramTs[i] !== undefined ? mapType(paramTs[i]) : undefined));
      const allParams = [...selfParams, ...params];
      const prologue = this.paramCopyPrologue(fn, params);
      const body = this.resolveFunctionBody(fn);
      this.functions.push({ src: fn, cName: entry.cName, params: allParams, ret: entry.ret, body: { stmts: [...prologue, ...body.stmts] } });
    });
  }

  private declareParam(p: ast.ParameterNode, sigT: CType | undefined): CParam {
    if (p.name._type !== "simple-identifier" && p.name._type !== "composite-identifier") {
      this.refuse(p, "param-destructuring", "declareParam");
      return { cName: `p_bad`, ctype: C_VALUE };
    }
    // Prefer a CONCRETE signature type; when the checker only offers a boxed/Unknown type, the AST
    // annotation wins (the symbol table erases an inferred struct type to Unknown -- spec A1).
    const annotated = this.ctypeFromAnnotation(p);
    const ctype = (sigT && sigT.k !== "value" ? sigT : undefined) ?? annotated ?? sigT ?? C_VALUE;
    if (ctype.k === "value") this.ledger.record("A1", "param-untyped", p, "parameter type unavailable; boxed");
    const cName = mangleC(ast.symbolName(p.name as ast.IdentifierNode));
    // A param captured mutably by a nested closure must be a cell (the mut-capture channel again).
    const cell = this.cellVars.has(cName);
    this.declareLocal(cName, cell ? C_VALUE : ctype, false, cell);
    return { cName, ctype };
  }

  /** Map a parameter's AST type annotation to a CType -- a known struct/class -> obj, else primitive. */
  private ctypeFromAnnotation(p: ast.ParameterNode): CType | undefined {
    return this.typeNodeToCType(p.type);
  }

  /** D11 copy-on-entry (A5): a struct-typed or boxed param is copied (passed by value). A native
   *  primitive, array or class-reference param is not (it is already a value or a shared reference). */
  private paramCopyPrologue(fn: ast.FunctionNode, params: CParam[]): CStmt[] {
    const out: CStmt[] = [];
    for (const p of params) {
      if (p.ctype.k !== "value" && p.ctype.k !== "obj") continue;
      this.ledger.record("A5", "param-copy", fn, "callee-side D11 copy-on-entry (a struct/boxed param passes by value)");
      out.push({
        src: fn, ctype: C_VOID, kind: "c-assign",
        target: { kind: "name", cName: p.cName, ctype: p.ctype },
        value: { src: fn, ctype: p.ctype, kind: "c-copy", inner: { src: fn, ctype: p.ctype, kind: "c-ref", cName: p.cName } },
      });
    }
    return out;
  }

  /** Resolve a function's body from the HIR (or lower on demand if it was not pre-lowered). */
  private resolveFunctionBody(fn: ast.FunctionNode): CBlock {
    let body = this.hir.bodyFor(fn);
    if (!body) {
      this.ledger.record("A3", "on-demand-lower", fn, "function body not pre-lowered; lowered on demand");
      body = new LowerAstToHirVisitor(this.context, `__ll_hir_i${this.liftCounter}`).lowerBody(fn.body ?? []);
    }
    return this.resolveBlock(body);
  }

  // -- closures / lambda lifting -------------------------------------------------------------------

  /** A lambda literal used as a VALUE -> lift it and build a closure. */
  private resolveLambda(fn: ast.FunctionNode): CExpr {
    if (this.refuseCoroutine(fn, "<lambda>")) return { src: fn, ctype: C_VALUE, kind: "c-nil" };
    return this.lift(fn);
  }

  /** A nested NAMED function declaration statement -> lift it and bind a local closure value. */
  private resolveNestedFnDecl(fn: ast.FunctionNode): CStmt[] {
    const name = ast.symbolName(fn.name);
    if (this.refuseCoroutine(fn, name)) return [];
    const closure = this.lift(fn);
    const cName = mangleC(name);
    this.declareLocal(cName, closure.ctype, false, false);
    return [{ src: fn, ctype: C_VOID, kind: "c-decl", cName, declCType: closure.ctype, init: closure }];
  }

  /**
   * Lift a function (lambda or nested named): compute its captures against the CURRENT scopes, build
   * a top-level `ll_value fn(void* env, int argc, ll_value* argv)`, and return the closure-make. This
   * is the env the HIR does not model (spec A3 -- callee identity and closed-over state as a value).
   */
  private lift(fn: ast.FunctionNode): CExpr {
    this.ledger.record("A3", "closure-lift", fn, "nested function lifted with an explicit captured environment (not in the HIR)");
    const id = this.liftCounter++;
    const baseName = fn.name ? mangleC(ast.symbolName(fn.name)) : "lam";
    const liftedName = `__ll_lam_${baseName}_${id}`;

    // Captures: free vars bound in an ENCLOSING (or the current) scope. Computed BEFORE we isolate.
    const captures: CCapture[] = [];
    const capType = new Map<string, { ctype: CType; cell: boolean }>();
    for (const srcName of freeVariables(fn)) {
      const cName = mangleC(srcName);
      const info = this.localInfo(cName);
      if (!info) continue; // a global / top-level fn / intrinsic -- resolved without capture
      // For a cell, capture the POINTER (c-ref with cell:false emits the bare `ll_value*` variable).
      const value: CExpr = { src: fn, ctype: info.cell ? C_VALUE : info.ctype, kind: "c-ref", cName, cell: false };
      captures.push({ field: cName, ctype: info.cell ? C_VALUE : info.ctype, value, cell: info.cell });
      capType.set(cName, { ctype: info.cell ? C_VALUE : info.ctype, cell: info.cell });
    }

    // Build the lifted params (typed) from the signature.
    const symT = this.dipSymbols("A3", "lambda-signature", fn, "lambda signature resolved through the symbol table", fn.name ? ast.symbolName(fn.name) : "<lambda>")?.inferredType;
    const paramTs = symT?.kind === "function" && symT.params ? symT.params : fn.params.map(() => undefined);

    // Resolve the lifted body in an ISOLATED scope (params + captures only -- a C function cannot see
    // the enclosing frame except through its env).
    const savedScopes = this.scopes.slice();
    const savedCells = this.cellVars;
    const savedInFn = this.inFunctionBody;
    (this as any).scopes = [new Map<string, VarInfo>()];
    this.inFunctionBody = true;
    const liftedParams: CParam[] = [];
    try {
      this.cellVars = this.computeCellVars(fn.body ?? []);
      fn.params.forEach((p, i) => {
        const cp = this.declareParam(p, paramTs[i] !== undefined ? mapType(paramTs[i]) : undefined);
        liftedParams.push(cp);
      });
      // Declare captures in the lifted scope (cells stay cells so reads deref).
      for (const [cName, info] of capType) this.declareLocal(cName, info.ctype, info.cell, info.cell);
      const body = this.resolveFunctionBody(fn);
      this.lifted.push({
        liftedName,
        envStruct: captures.length ? `__ll_env_${liftedName}` : null,
        captures: captures.map((c) => ({ field: c.field, ctype: c.ctype, cell: c.cell })),
        params: liftedParams,
        body,
      });
    } finally {
      (this as any).scopes = savedScopes;
      this.cellVars = savedCells;
      this.inFunctionBody = savedInFn;
    }

    const paramCTypes = liftedParams.map((p) => p.ctype);
    const ret = this.userFnRet(symT, fn);
    return {
      src: fn,
      ctype: { k: "closure", params: paramCTypes, ret },
      kind: "c-closure-make",
      liftedName,
      envStruct: captures.length ? `__ll_env_${liftedName}` : null,
      captures,
      arity: fn.params.length,
      name: fn.name ? ast.symbolName(fn.name) : "",
    };
  }

  /** A call through a closure VALUE (uniform boxed convention). */
  private closureCall(node: ast.ASTNode, fnv: CExpr, args: ast.ASTNode[]): CExpr {
    this.ledger.record("A3", "closure-call", node, "call through a closure value (boxed calling convention; JS gets this free)");
    const cArgs = args.map((a) => this.resolveAstExpr(a));
    const ret = fnv.ctype.k === "closure" ? fnv.ctype.ret : C_VALUE;
    return { src: node, ctype: ret, kind: "c-call", callee: { kind: "closure", fn: fnv }, args: cArgs };
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
