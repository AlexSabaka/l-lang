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
  | CConstruct
  | CFieldGet
  | CClosureMake
  | CTypeTest
  | CBind
  | CBox
  | CUnbox
  | CCast
  | CCopy
);

/** A pattern binding as an EXPRESSION: `(cName = value)`. Used inside a match pattern test's
 *  bind-then-test sequence (spec A7 -- the bind-then-test ordering the JS emitter fuses with commas). */
export interface CBind {
  kind: "c-bind";
  cName: string;
  value: CExpr;
}

/** Construct a struct/class instance (spec A4 -- construction is NOT in the HIR; resolved from the
 *  symbol table). Fields are stored boxed in slot order; `args` are the positional constructor args. */
export interface CConstruct {
  kind: "c-construct";
  className: string;
  isStruct: boolean;
  args: CExpr[];
  /** Default field values for constructor params not supplied (already typed). */
  fieldCount: number;
  /** C names of `:ctor` initializer methods to run on the new object, in declaration order (each takes
   *  self and mutates derived fields). Present -> the construct emits a statement-expression. */
  initMethods?: string[];
}

/** A struct/class field READ by slot: `obj->fields[slot]`, unboxed to the field's static type. */
export interface CFieldGet {
  kind: "c-field-get";
  object: CExpr;
  slot: number;
  fieldName: string;
}

/** One captured free variable of a lifted closure. `value` is computed in the ENCLOSING scope; for a
 *  mutable-captured (cell) binding it is the `ll_value*` pointer itself, shared with the origin. */
export interface CCapture {
  field: string;
  ctype: CType;
  value: CExpr;
  cell: boolean;
}

/** Build a closure value: a lifted function + its captured environment (spec A3 -- callee identity
 *  as a first-class value, which the HIR does not model). */
export interface CClosureMake {
  kind: "c-closure-make";
  liftedName: string;
  envStruct: string | null; // null = no captures (env is NULL)
  captures: CCapture[];
  arity: number;
  /** The source function name, for node's `[Function: name]` inspect format ("" = anonymous). */
  name: string;
}

/** `(x :of T)` -- a runtime type test (D41), and a `match` type-pattern half (spec A7). */
export interface CTypeTest {
  kind: "c-type-test";
  operand: CExpr;
  typeName: string;
  /** true -> a primitive tag test (Int/Real/String/...); false -> nominal (__ll_name walk / Array). */
  primitive: boolean;
}

export interface CLit {
  kind: "c-lit";
  lit: "int" | "real" | "bool" | "str" | "char" | "nil";
  /** The C-source spelling for numerics/bools; the RAW string content (unescaped) for `str`. */
  value: string;
}

/** A resolved user binding read. `cName` is the mangled C identifier. (A2 evidence.)
 *  `cell` = a mutable-captured binding, stored as a heap `ll_value*`; reads deref it. */
export interface CRef {
  kind: "c-ref";
  cName: string;
  cell?: boolean;
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
  /** A call through a closure VALUE (uniform boxed convention): unbox `fn` to ll_closure*, box each
   *  arg, call fn->fn(fn->env, argc, argv); the result is boxed. `fn` is the closure-valued expr. */
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
  | CTry
  | CRestartCase
  | CHandle
);

/** A try/catch/finally, lowered to a setjmp/longjmp handler frame. Each catch may filter on an
 *  error class name (`catch e :of T`); an unfiltered catch is the default; no match rethrows. */
export interface CTry {
  kind: "c-try";
  tryBlock: CBlock;
  errVar: string; // the boxed `ll_value` holding the thrown error in the catch arm
  catches: { errorCName?: string; filterTypeName?: string; body: CBlock }[];
  finalizer: CBlock | null;
}

/**
 * D47 `restart-case` -- SCAFFOLD (TODO restart-stage2). Lowered to ONE setjmp pad (an LL_RESTART frame on
 * the shared handler stack) whose arms emit INLINE at the `else` branch, keyed by the invoked restart's
 * index. `resultCName` is the value-position result temp (the join of body + arm values). Not yet produced
 * by ResolveHirToCir (which refuses restart forms today); the field shape lands here for stage-2.
 */
export interface CRestartCase {
  kind: "c-restart-case";
  body: CBlock;
  resultCName?: string;
  arms: { name: string; paramCNames: string[]; body: CBlock }[];
}

/**
 * D47 `handle` -- SCAFFOLD (TODO restart-stage2). Lowered to ONE bookkeeping LL_HANDLER frame carrying the
 * ORDERED clause list (source order -- first-written matching `:on` wins). Each clause closure-converts to
 * `static ll_value <handlerFnName>(void* env, ll_value cond)` capturing the handle-frame's live locals. Not
 * yet produced by ResolveHirToCir; the field shape lands here for stage-2.
 */
export interface CHandle {
  kind: "c-handle";
  body: CBlock;
  resultCName?: string;
  clauses: { condType: string; binderCName?: string; handlerFnName: string; body: CBlock }[];
}

export interface CExprStmt {
  kind: "c-expr-stmt";
  expr: CExpr;
}

/** A declaration. Covers both lowering temps and user lets/muts (structure resolved from src -- A2/A5 dip).
 *  `cell` = a mutable-captured binding, stored as a heap `ll_value*` shared with escaping closures. */
export interface CDecl {
  kind: "c-decl";
  cName: string;
  declCType: CType;
  init: CExpr | null;
  cell?: boolean;
}

export type CLValue =
  | { kind: "name"; cName: string; ctype: CType; cell?: boolean }
  | { kind: "index"; base: CExpr; index: CExpr; mode: IndexMode }
  | { kind: "field"; object: CExpr; slot: number; fieldName: string }
  | { kind: "dyn-field"; object: CExpr; fieldName: string };

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

/** A lifted lambda/closure: `ll_value fn(void* env, int argc, ll_value* argv)`. Params are unboxed
 *  from argv, captures read from the env struct. Always returns boxed (the uniform convention). */
export interface CLifted {
  liftedName: string;
  envStruct: string | null; // the C struct name for captures, or null (no captures -> env unused)
  captures: { field: string; ctype: CType; cell: boolean }[];
  params: CParam[];
  body: CBlock;
}

/** A struct/class descriptor -> an `ll_class` in the emitted runtime (spec A4). */
export interface CClass {
  name: string;
  isStruct: boolean;
  parent?: string; // `:extends` base name, for reflection
  fields: { name: string; ctype: CType }[]; // slot order
  /** OWN methods (not inherited), for the runtime dynamic-dispatch table: each gets a boxed adapter.
   *  `params` excludes self; the emitter unboxes argv to these, calls cName, boxes ret. */
  methods: { name: string; cName: string; params: CType[]; ret: CType }[];
}

export interface CModule {
  functions: CFunction[];
  lifted: CLifted[];
  classes: CClass[];
  /** Module-level bindings referenced by top-level functions -> file-scope C globals. */
  globals: { cName: string; ctype: CType }[];
  /** Top-level functions used as VALUES need a boxed-convention adapter; keyed by cName. */
  adapters: { forCName: string; params: CType[]; ret: CType; arity: number }[];
  /** Top-level statements, in order -- the body of `int main(void)`. */
  main: CBlock;
}
