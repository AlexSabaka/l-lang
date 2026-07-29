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
  | CInvokeRestart
  | CSignal
);

/** D47 `(invoke-restart :name args)` -- a diverging transfer to the newest LL_RESTART frame offering
 *  `name`. Emits `ll_invoke_restart("name", packedArgs)` where `packedArgs` is a boxed positional vector
 *  of the args (or nil for none); ctype is `void` (it never returns a value). */
export interface CInvokeRestart {
  kind: "c-invoke-restart";
  name: string;
  packedArgs: CExpr;
}

/** D47 `(signal <cond>)` -- ll_signal's in-place LL_HANDLER walk. Nil-on-all-decline / DIVERGES on a
 *  handler's transfer -- but it IS an expression (ctype value). */
export interface CSignal {
  kind: "c-signal";
  condition: CExpr;
}

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
  /** C2: this slot holds a CELL (a one-field object), so the read derefs through it. A generator
   *  frame slot that carries a mutable capture is the only producer. */
  cell?: boolean;
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
  /**
   * Per-argument: is this one SPREAD into the call rather than passed as one argument?
   *
   * Set on a `closure` callee, or on a VARIADIC `intrinsic` one (`(console.log ...xs)`), and in both
   * cases it is forced rather than stylistic: with a spread the
   * argument count is not known until run time, so the direct C convention cannot express the call
   * at all. `resolveFreeCall` converts even an ordinary top-level callee to a function VALUE when it
   * sees one.
   */
  spread?: boolean[];
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
  /**
   * Per-element: is this part SPREAD into the vector rather than placed in it?
   *
   * Absent on the overwhelmingly common literal, which keeps its `ll_vec_of` emission unchanged --
   * a mask of all-false would cost every vector in the corpus an extra array and a loop for nothing.
   * Present only when the source actually wrote `...x`, and then the whole thing routes through
   * `ll_vec_build`.
   */
  spread?: boolean[];
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
 *  fully-dynamic read (`needsName`), `runtimeFn(object, ll_str_from(fieldName, len))`. */
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
  | CDispatch
  | CLabel
);

/**
 * D58's resume prologue: `switch (state) { case k: goto __Lk; ... default: return nil; }`.
 *
 * The CIR had no switch and no goto before this, because everything in it is structured. That is not
 * an oversight to correct in general -- it is why these two nodes are the ENTIRE cost of the state
 * machine's control flow. Re-entry jumps straight to a label inside the (possibly nested) loop where
 * the generator suspended, and the body around it is emitted completely unchanged.
 *
 * `stateSlot` is the frame field holding the machine's state; `states` are the live resume points.
 */
export interface CDispatch {
  kind: "c-dispatch";
  stateSlot: number;
  states: number[];
}

/** The label a `c-dispatch` jumps to -- one per suspend point, emitted right after its `return`. */
export interface CLabel {
  kind: "c-label";
  state: number;
}

/** A try/catch/finally. At emit time (Cr-0) it becomes up to two `ll_frame`s on the unified handler
 *  stack -- a CLEANUP frame (per `finally`) wrapping a CATCH frame (per catch chain) -- walked by
 *  `ll_unwind`. That CLEANUP/CATCH split is a C-emission detail and deliberately does NOT live here (the
 *  JS backend lowers this same node to a native `TryStatement`). Each catch may filter on an error class
 *  name (`catch e :of T`); an unfiltered catch is the default; no match rethrows. */
export interface CTry {
  kind: "c-try";
  tryBlock: CBlock;
  errVar: string; // the boxed `ll_value` holding the thrown error in the catch arm
  catches: { errorCName?: string; filterTypeName?: string; body: CBlock }[];
  finalizer: CBlock | null;
}

/**
 * D47 `restart-case` (Cr-1a). Lowered to ONE setjmp pad (an LL_RESTART frame on the shared handler
 * stack) whose arms emit INLINE at the `else` branch, keyed by the invoked restart's index.
 * `resultCName` is vestigial (the value flows via the pre-declared temp + assign-dests).
 */
export interface CRestartCase {
  kind: "c-restart-case";
  body: CBlock;
  resultCName?: string;
  arms: { name: string; paramCNames: string[]; body: CBlock }[];
}

/**
 * D47 `handle` (Cr-1b). ONE bookkeeping LL_HANDLER frame -- NEVER a longjmp target (signal walks it
 * in place), so no setjmp pad. Clauses (source order; a decline falls to the next matching one) closure-
 * convert to lifted `(void*, ll_value) -> ll_value` handlers (CLifted abi:"handler") sharing ONE env
 * struct (the frame has one henv): `captures` is the set-union of every clause's captures, filled at
 * the install site.
 */
export interface CHandle {
  kind: "c-handle";
  body: CBlock;
  envStruct: string | null;
  captures: CCapture[];
  clauses: { condType: string; handlerFnName: string }[];
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
  | { kind: "field"; object: CExpr; slot: number; fieldName: string; cell?: boolean }
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
  /** D12 `:else`, which runs after the loop and SEES the `:init` bindings -- so it has to be emitted
   *  inside the same C block, exactly like c-foreach's. As a sibling statement it could not. */
  elseBlock: CBlock | null;
}

/**
 * A for-each. TWO lowerings, and which one is a P1 decision:
 *
 *   viaProtocol: false   the collection is statically a VECTOR -> a direct index loop, no allocation
 *   viaProtocol: true    anything else -> D30's protocol, `ll_iter` then `ll_next` until nil
 *
 * The protocol arm is what a `for :each` over a string, a map, or a user `Iterable` uses. Before it,
 * the emitter wrote `ll_vec*` over whatever P1 handed it, so a string CRASHED (`no cast str -> vec`)
 * and a user Iterable crashed differently (`no cast obj -> vec`) -- both uncaught exceptions rather
 * than diagnostics, and both reachable from ordinary code.
 */
export interface CForEach {
  kind: "c-foreach";
  varCName: string;
  varCType: CType;
  collection: CExpr;
  body: CBlock;
  elseBlock: CBlock | null;
  /** Use D30's iterator protocol rather than an index loop. */
  viaProtocol?: boolean;
  /**
   * D16 `(for :each [key val] :from ...)` -- the loop variable is a PATTERN, so `varCName` holds the
   * element container and these bind its members. Each `value` is an expression over `varCName`,
   * built by P1 (a bounds-guarded element read: absent index -> nil, matching JS's `undefined`).
   *
   * They are a field rather than statements prepended to `body` because of WHERE they must be
   * emitted: the names are DECLARED beside `varCName` -- outside the loop, inside the block the
   * for-each opens -- and only ASSIGNED per iteration. That is what keeps them readable from the
   * `:else` clause, which runs after the loop and may reference the final binding, and it is exactly
   * the shape the JS emitter reaches for (`let x, y; for ([x, y] of pts)`), for the same reason.
   */
  destructure?: { cName: string; ctype: CType; value: CExpr }[];
}

export interface CBlock {
  stmts: CStmt[];
}

// -- Top level -------------------------------------------------------------------------------------

export interface CParam {
  cName: string;
  ctype: CType;
  /**
   * `[...args]` -- this parameter collects the remaining arguments.
   *
   * Read only by the LIFTED-closure emitter, and that asymmetry is the whole point. A top-level
   * function's rest parameter is packed by the CALL SITE (`packRestArgs`), because the call site
   * knows the arity. A closure is reached through `ll_call` with a flat `argv`, so there is no such
   * site -- nothing packs it, and the parameter used to receive `argv[i]`, a single value, where the
   * body expected a vector.
   */
  rest?: boolean;
}

export interface CFunction {
  src: ast.ASTNode;
  cName: string;
  params: CParam[];
  ret: CType;
  body: CBlock;
}

/** A lifted lambda/closure: `ll_value fn(void* env, int argc, ll_value* argv)`. Params are unboxed
 *  from argv, captures read from the env struct. Always returns boxed (the uniform convention).
 *  abi:"handler" (D47 Cr-1b) is a lifted handle clause instead: `ll_value fn(void* env, ll_value cond)`
 *  -- params is the [binder] (or empty), the trailing `return ll_nil()` is the decline. Clauses of one
 *  handle form share ONE env struct (the same envStruct name + identical union capture list). */
export interface CLifted {
  liftedName: string;
  envStruct: string | null; // the C struct name for captures, or null (no captures -> env unused)
  captures: { field: string; ctype: CType; cell: boolean }[];
  params: CParam[];
  body: CBlock;
  abi?: "argv" | "handler"; // default argv
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
  /** The transitive `:implements` closure. D24 erases interfaces, so `ll_class` carrying this list is
   *  the only way `(x :of SomeInterface)` can answer at run time (gap ledger §14.1). The JS backend
   *  emits the identical list as `static __ll_interfaces`, from the same modeled `HClass.interfaces`. */
  interfaces?: string[];
  /**
   * D58: this class is a GENERATOR's synthesized frame type, and `genStep` names its step function.
   *
   * The runtime reads it in four places and they are the whole of the generator's identity:
   * `ll_iter` answers the instance itself (an Iterator IS an Iterable), `ll_next` calls `genStep`
   * directly rather than walking a method table by name, `ll_inspect` writes `#<generator NAME>`
   * instead of `NAME{...}`, and `ll_type` answers `kind: "generator"`. `name` is the SOURCE name --
   * `fibs`, not the synthesized tag -- because that is what all four of those surfaces show.
   *
   * The class is deliberately kept OUT of `__ll_class_registry` and out of the metadata graph, so
   * `type-by-name` cannot find it: per D58 the synthesized class never enters the reflection graph.
   * Printing it as `NAME{...}` would put a frame's state number and its spilled locals into
   * user-facing output, which is the leak FLOOR.md's F.7/F.8 amendment already rejected for lambdas.
   */
  genStep?: string;
  /** The name the RUNTIME reports (`ll_class.name`), when it differs from the C symbol suffix. A
   *  generator's tag must be a C identifier while its source name may be kebab-case. */
  sourceName?: string;
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
  /** The reflection metadata graph (D54), from the SHARED builder the JS backend uses. Materialised
   *  as ll_value maps at the top of main so `type` / `type-by-name` can answer from real data. */
  metadata: Record<string, any>;
}
