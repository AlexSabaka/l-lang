// The l-lang HIR node family.
//
// A typed, post-typecheck, two-sorted (statement/expression) IR between the typed AST and ESTree.
// The datatype IS the invariant (the Kotlin/JS-IR shape): control flow (`if`) exists only as a
// STATEMENT; a value-position conditional is lowered to a temp declared up front, assigned in each
// arm. There are no IIFEs and no "expression that secretly contains statements" -- so HIR->ESTree is
// a mechanical, judgment-free map (hir-brief.md R6).
//
// What the prototype (R1) models: `if`/`when`/`cond`/`match`, blocks, function bodies and tail
// returns. Everything else is an OPAQUE LEAF -- the AST subtree carried unchanged in `src`, emitted
// by calling back into the legacy JSTransformer (visitExpr / visit+coerce). Opaque is the
// always-correct fallback; R2 shrinks the opaque set toward nothing.

import type * as ast from "../frontend/ast";
import type { InferredType } from "../analysis/SymbolTable";

/** Common to every HIR node. */
export interface HBase {
  /**
   * The AST node this came from. Two jobs: identity into `context.nodeTypes` (so a later pass can ask
   * the type of a node the lowering did not itself synthesize), and the carrier of `_location` for
   * source maps. For an opaque leaf, `src` IS the payload the legacy emitter re-visits.
   */
  src: ast.ASTNode;
  /**
   * The checker's type for `src`, read from `context.nodeTypes` at lowering time (R5). `undefined` is
   * a legitimate gradual answer ("the checker did not know"), NEVER "not a struct" and NEVER a cue to
   * re-infer -- no pass below the type checker may run inference (hir-brief.md R5).
   */
  type: InferredType | undefined;
}

// -- Expressions -----------------------------------------------------------------------------------
// An HExpr is an ATOM or a shallow pure combinator over atoms. It never contains a statement; a
// construct that would need one is lowered to statements with a temp, and the temp is the HExpr.

export type HExpr =
  | HTemp
  | HOpaqueExpr
  | HNil
  | HTernary
  | HSeq
  | HPatternTest
  | HVector
  | HMatrix
  | HMap
  | HMember
  | HIndex;

/** A lowering-introduced name (`__ll_hir_<n>`), declared by an HDeclTemp and read here. */
export interface HTemp extends HBase {
  kind: "temp";
  name: string;
}

/** A leaf: emit by handing `src` back to the legacy `visitExpr`. The lowering did not look inside. */
export interface HOpaqueExpr extends HBase {
  kind: "opaque-expr";
}

/** The D9 bottom value -- a missing `else`, an empty `when`. Emits as the runtime nil literal. */
export interface HNil extends HBase {
  kind: "nil";
}

/** The peephole for a value-position `if` whose BOTH arms lowered to pure atoms -- `test ? then : else`. */
export interface HTernary extends HBase {
  kind: "ternary";
  test: HExpr;
  then: HExpr;
  else: HExpr;
}

/** A comma sequence -- parity with the legacy asExpression SequenceExpression for a multi-expr body value. */
export interface HSeq extends HBase {
  kind: "seq";
  exprs: HExpr[];
}

/**
 * A `match` arm's test against the scrutinee temp -- the pattern condition, optionally ANDed with a
 * `:when` guard. Built at EMIT time by the legacy `generateCondition` (patterns are not re-modelled in
 * S3; that is R2). The pattern condition may BIND pattern variables as a side effect, so these tests
 * live in an if/ELSE chain (never sequential ifs) -- a later arm's test must not run once one matched.
 */
export interface HPatternTest extends HBase {
  kind: "pattern-test";
  pattern: ast.PatternNode;
  scrutName: string;
  /** `:when <expr>` (D26) -- emitted as `<patternCond> && <guard>` so the guard sees the bindings. */
  guard?: ast.ASTNode;
}

/**
 * A vector literal `[a b c]`, FULLY inverted: the elements are HExprs the HIR emitter builds directly,
 * so a value-position `if` element emits as a real ternary/temp via emitExpr -- it never reaches the
 * legacy `asExpression`. This is the R2 (full-inversion) shape: the datatype models the structure, and
 * the resolved D11 element copy stays a legacy hook (`storeValue`). The first collection so modelled.
 */
export interface HVector extends HBase {
  kind: "vector";
  elements: HExpr[];
}

/** A matrix literal `[[a b][c d]]` -- an array of row arrays. Cells are HExprs (D11-copied at emit). */
export interface HMatrix extends HBase {
  kind: "matrix";
  rows: HExpr[][];
}

/** One `{ key: value }` entry. `keyLiteral` set for a `:identifier` key (a string, unmangled -- D13). */
export interface HMapEntry {
  src: ast.ASTNode;
  keyLiteral?: string;
  key?: HExpr;
  value: HExpr;
}

/** A map literal `{ :k v }` -- an object. Values are HExprs (D11-copied at emit); keys are data (D13). */
export interface HMap extends HBase {
  kind: "map";
  entries: HMapEntry[];
}

/** A member access `obj.field` / `obj[expr]` (the core, post-desugar node). */
export interface HMember extends HBase {
  kind: "member";
  object: HExpr;
  property: HExpr;
  computed: boolean;
}

/** One suffix of an indexer chain. `isMember` -> plain `expr[idx]` (D1 read); else checked `__ll_index` (D9f). */
export interface HIndexStep {
  isMember: boolean;
  index: HExpr;
}

/** An indexer `xs[i]` / `xs[0].name` (the READ form; a call head is lowered as a call). */
export interface HIndex extends HBase {
  kind: "index";
  base: HExpr;
  steps: HIndexStep[];
}

// -- Statements ------------------------------------------------------------------------------------

export type HStmt =
  | HExprStmt
  | HDeclTemp
  | HAssignTemp
  | HIf
  | HBlockStmt
  | HReturn
  | HHoist
  | HTry
  | HOpaqueStmt;

/** An expression evaluated for effect; its value is discarded. */
export interface HExprStmt extends HBase {
  kind: "expr-stmt";
  expr: HExpr;
}

/** `let <name>;` (init null) or `const <name> = <init>;`. The up-front declaration a value-if assigns into. */
export interface HDeclTemp extends HBase {
  kind: "decl-temp";
  name: string;
  init: HExpr | null;
}

/**
 * `<name> = <value>;`. `isStore` marks a store the HIR itself creates that must preserve D11 value
 * semantics -- routed through the legacy `asValue` (`__ll_copy`) at emit time. Exactly one of the two
 * documented R6 debts; it disappears at R3 when copies become explicit HIR nodes.
 */
export interface HAssignTemp extends HBase {
  kind: "assign-temp";
  name: string;
  value: HExpr;
  isStore: boolean;
}

/** A statement `if`. Arms are ALWAYS emitted braced -- dangling-else (CF2) is impossible by construction. */
export interface HIf extends HBase {
  kind: "if";
  test: HExpr;
  then: HBlock;
  else: HBlock | null;
}

/** A bare `{ ... }` scope. Restores the isolation the match-IIFE used to give (nested pattern vars). */
export interface HBlockStmt extends HBase {
  kind: "block";
  body: HBlock;
}

/** `return <value>;`. `isStore` as for HAssignTemp -- a returned struct value is copied (D11). */
export interface HReturn extends HBase {
  kind: "return";
  value: HExpr | null;
  isStore: boolean;
}

/**
 * Hoisted `match` pattern-variable declarations (`let a, b;`) at the top of the match's block scope.
 * The names are computed at EMIT from `src` (the MatchNode) via the legacy findIdentifiersToDefine,
 * so lowering and legacy stay single-sourced. Emits nothing when the match binds no variables.
 */
export interface HHoist extends HBase {
  kind: "hoist";
}

/** One `catch e :of T (...)` clause. `filterTypeName` undefined = the default catch; `errorName` binds `e`. */
export interface HCatch {
  errorName?: ast.ASTNode;
  filterTypeName?: string;
  body: HBlock;
}

/**
 * A try/catch/finally. Its bodies are HIR-lowered with the enclosing destination, so a value-position
 * `(let v (try (42) catch e (0)))` assigns a result temp in each arm instead of wrapping in an IIFE.
 * The catch-filter CHAIN (instanceof tests, default catch, rethrow, `const e = <tmp>`) is rebuilt by
 * the emitter -- the same shape legacy visitTryCatch produced, over HIR-emitted bodies.
 */
export interface HTry extends HBase {
  kind: "try";
  tryBlock: HBlock;
  catchVar: string;
  catches: HCatch[];
  finalizer: HBlock | null;
}

/** A leaf statement: emit by coercing the legacy `visit(src)` to a statement. */
export interface HOpaqueStmt extends HBase {
  kind: "opaque-stmt";
}

/** A statement list. Not a JS scope on its own -- an HBlockStmt is the scoping wrapper. */
export interface HBlock {
  stmts: HStmt[];
}
