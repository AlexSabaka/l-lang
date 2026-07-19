// CIR -- the C backend's resolved IR.
//
// This is the HIR with its opaque leaves RESOLVED: atoms are modeled (c-lit/c-ref, spec A2), calls
// carry their resolved callee identity (c-call, spec A3), and every value node carries a CType
// (spec A1). It deliberately prototypes the consumption spec's target node family
// (hir-llvm-consumption-spec.md, "the node family the standalone emitter consumes") out-of-tree:
// what P1 has to synthesize here from raw AST + nodeTypes + symbol table is exactly what the real
// HIR cuts (Steps 3-8) would put on the HIR itself.
//
// Produced by ResolveHirToCir (P1), refined by InsertCoercions (P2, which is the ONLY pass that
// mints c-box/c-unbox/c-cast), consumed by EmitCirToC (P3), which is mechanical and hard-fails on
// anything unhandled (the EmitHirToEstree posture).

import type * as ast from "../../frontend/ast";
import type { CType } from "./ctype";

export interface CBase {
  /** Source node, for location comments and diagnostics. */
  src: ast.ASTNode;
  /** The static C type of this value. `{k:"value"}` = boxed (the Unknown home). */
  ctype: CType;
}

// -- Expressions -----------------------------------------------------------------------------------

export type CExpr = CBase & (
  | CLit
  | CRef
  | CTemp
  | CNil
  | CInterp
  | CCall
  | CBinop
  | CUnop
  | CTernary
  | CSeq
  | CVector
  | CMapLit
  | CIndex
  | CMember
  | CBox
  | CUnbox
  | CCast
  | CCopy
);

export interface CLit {
  kind: "c-lit";
  lit: "int" | "real" | "bool" | "str" | "char" | "nil";
  /** The C-source spelling for numerics/bools; the RAW string content (unescaped) for `str`. */
  value: string;
}

/** A resolved user binding read. `cName` is the mangled C identifier. (A2 evidence.) */
export interface CRef {
  kind: "c-ref";
  cName: string;
}

/** A lowering temp (`__ll_hir_N`) -- already C-safe. */
export interface CTemp {
  kind: "c-temp";
  name: string;
}

export interface CNil {
  kind: "c-nil";
}

/** A formatted string: literal segments interleaved with typed interpolations (JS ToString semantics). */
export interface CInterp {
  kind: "c-interp";
  parts: (string | CExpr)[];
}

export type CCallee =
  /** A user free function with a typed C signature. The sig rides here so P2 can coerce args locally. */
  | { kind: "free"; cName: string; params: CType[]; ret: CType }
  /**
   * A runtime intrinsic (print, math, builtins, native members). `runtimeFn` is the C symbol.
   * `params` are the expected arg CTypes (P2 coerces); a variadic intrinsic takes boxed varargs.
   * A native METHOD call has its receiver prepended as arg 0 by P1 (dispatch fully resolved).
   */
  | { kind: "intrinsic"; runtimeFn: string; variadic: boolean; params: CType[]; ret: CType }
  /** A call through a closure value (uniform boxed convention). Phase B. */
  | { kind: "closure"; fn: CExpr };

export interface CCall {
  kind: "c-call";
  callee: CCallee;
  args: CExpr[];
}

/**
 * The emit mode P1 resolved for a native binary operator -- the dispatch DECISION lives here, in the
 * pass, so the emitter stays judgment-free (R6 discipline, applied to the C pipeline).
 */
export type BinopMode =
  | "int" // int64 arithmetic/comparison
  | "real" // double arithmetic/comparison (mixed int/real promotes)
  | "bool" // && || on bools
  | "str-concat" // + on strings
  | "str-cmp" // ==/!=/</... on strings
  | "eq-deep" // ==/!= via ll_deep_eq (containers, boxed)
  | "boxed"; // operands boxed -> runtime operator dispatch (registry order). Phase C.

export interface CBinop {
  kind: "c-binop";
  op: string; // the SOURCE operator (+ - * / % == != < > <= >= && ||)
  mode: BinopMode;
  lhs: CExpr;
  rhs: CExpr;
}

export interface CUnop {
  kind: "c-unop";
  op: "!" | "-";
  mode: "int" | "real" | "bool" | "boxed";
  operand: CExpr;
}

export interface CTernary {
  kind: "c-ternary";
  test: CExpr;
  then: CExpr;
  else: CExpr;
}

export interface CSeq {
  kind: "c-seq";
  exprs: CExpr[];
}

export interface CVector {
  kind: "c-vector";
  elements: CExpr[];
}

export interface CMapEntry {
  key: string | CExpr; // a literal `:key`, or a computed key expression
  value: CExpr;
}

export interface CMapLit {
  kind: "c-map";
  entries: CMapEntry[];
}

/** One resolved index step. Mode decided by P1 from the base's ctype. */
export type IndexMode = "vec" | "map" | "str" | "boxed";

export interface CIndex {
  kind: "c-index";
  base: CExpr;
  index: CExpr;
  mode: IndexMode;
  /** true -> partial semantics (`__ll_index`: trap on miss); false -> plain read. */
  checked: boolean;
}

/** A member READ fully resolved by P1 to a runtime accessor: `runtimeFn(object)` -- or, for a
 *  fully-dynamic read (`needsName`), `runtimeFn(object, ll_str_lit(fieldName))`. */
export interface CMember {
  kind: "c-member";
  object: CExpr;
  fieldName: string;
  runtimeFn: string;
  needsName?: boolean;
}

// P2-only nodes (spec A6 -- the coercion family JS erases).
export interface CBox {
  kind: "c-box";
  inner: CExpr;
  from: CType;
}

export interface CUnbox {
  kind: "c-unbox";
  inner: CExpr;
  to: CType;
}

export interface CCast {
  kind: "c-cast";
  inner: CExpr;
  from: CType;
  to: CType;
}

/** An explicit CP3 value-copy at a store site (spec A5). Phase C for structs; identity until then. */
export interface CCopy {
  kind: "c-copy";
  inner: CExpr;
}

// -- Statements ------------------------------------------------------------------------------------

export type CStmt = CBase & (
  | CExprStmt
  | CDecl
  | CAssign
  | CIf
  | CBlockStmt
  | CReturn
  | CWhile
  | CFor
  | CForEach
);

export interface CExprStmt {
  kind: "c-expr-stmt";
  expr: CExpr;
}

/** A declaration. Covers both lowering temps and user lets/muts (structure resolved from src -- A2/A5 dip). */
export interface CDecl {
  kind: "c-decl";
  cName: string;
  declCType: CType;
  init: CExpr | null;
}

export type CLValue =
  | { kind: "name"; cName: string; ctype: CType }
  | { kind: "index"; base: CExpr; index: CExpr; mode: IndexMode };

export interface CAssign {
  kind: "c-assign";
  target: CLValue;
  value: CExpr;
}

export interface CIf {
  kind: "c-if";
  test: CExpr;
  then: CBlock;
  else: CBlock | null;
}

export interface CBlockStmt {
  kind: "c-block";
  body: CBlock;
}

export interface CReturn {
  kind: "c-return";
  value: CExpr | null;
}

export interface CWhile {
  kind: "c-while";
  test: CExpr;
  body: CBlock;
}

export interface CFor {
  kind: "c-for";
  init: CBlock;
  test: CExpr | null;
  update: CStmt | null;
  body: CBlock;
}

/** A for-each over a vector/string, lowered to an index loop (iterator protocol is later work). */
export interface CForEach {
  kind: "c-foreach";
  varCName: string;
  varCType: CType;
  collection: CExpr;
  body: CBlock;
  elseBlock: CBlock | null;
}

export interface CBlock {
  stmts: CStmt[];
}

// -- Top level -------------------------------------------------------------------------------------

export interface CParam {
  cName: string;
  ctype: CType;
}

export interface CFunction {
  src: ast.ASTNode;
  cName: string;
  params: CParam[];
  ret: CType;
  body: CBlock;
}

export interface CModule {
  functions: CFunction[];
  /** Top-level statements, in order -- the body of `int main(void)`. */
  main: CBlock;
}
