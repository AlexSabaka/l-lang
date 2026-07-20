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
  | HLiteral
  | HRef
  | HFreeCall
  | HExtCall
  | HMethodCall
  | HVirtualCall
  | HOperator
  | HConstruct
  | HOpaqueExpr
  | HNil
  | HTernary
  | HSeq
  | HPatternTest
  | HVector
  | HMatrix
  | HMap
  | HMember
  | HFormattedString
  | HIndex;

/** One segment of a formatted string: a literal chunk, or an interpolation expression (already lowered). */
export type HFormatSegment = { str: string } | { expr: HExpr };

/**
 * An interpolated string `f"a{x}b"` (A2 -- was an opaque leaf re-walked from the raw AST). `segments` are
 * the source-order chunks: a literal string, or an interpolation expression the HIR lowered like a call's
 * operand (so evaluation order + temp binding are unchanged). The JS emitter accumulates consecutive
 * literals into template quasis and wraps each interpolation in `__ll_format_object`; a native backend
 * interleaves the parts into its string builder -- neither re-walks the raw AST for the segments.
 */
export interface HFormattedString extends HBase {
  kind: "formatted-string";
  segments: HFormatSegment[];
}

/**
 * A modeled literal ATOM -- integer/float/string/boolean (A2). The value is on the node, so the emitter
 * builds `{ type: "Literal", value }` DIRECTLY (no legacy leaf), and `type` is the checker's ground
 * truth -- the first opaque atom drained toward the "consume core HIR" bar. (The numeric tower --
 * hex/oct/bin/fraction/complex -- and char/formatted-string stay opaque until they carry their own
 * repr + emission.)
 */
export interface HLiteral extends HBase {
  kind: "literal";
  value: string | number | boolean;
}

/**
 * A modeled reference ATOM -- a simple/composite identifier (A2). `name` is the SOURCE name
 * (backend-neutral): the IR carries it, and each backend owns its identifier policy (Dove) -- the JS
 * materialization hook (`emitRef`) does encoding / import-inlining / runtime-shim registration; an LLVM
 * backend would mangle a symbol. `type` is the resolved binding's type. First slice of the
 * resolved-atom contract the dispatch cuts (A3) reuse. (Fuller resolution -- which declaration,
 * imported-ness -- moves onto the node in a follow-up; the JS hook re-resolves for now.)
 */
export interface HRef extends HBase {
  kind: "ref";
  name: string;
}

/**
 * A resolved FREE CALL `(f a ...)` -- the first modeled dispatch kind (A3). The dispatch decision was
 * made at lowering by the shared `classifyCall` (D1: `f` names a function, or the call carries args),
 * so the emitter just builds the `CallExpression` -- no re-dispatch. `callee` is the modeled reference,
 * `args` the lowered operands (with the same evaluation-order hoisting the opaque path used). Emitted
 * directly; falls back to legacy emission of `src` only when substituted into a legacy-parent operand.
 */
export interface HFreeCall extends HBase {
  kind: "free-call";
  callee: HExpr;
  args: HExpr[];
}

/**
 * A resolved `:extension` CALL `obj.method(a ...)` -- the second modeled dispatch kind (A3, TY8). The
 * shared `classifyCall` decided at lowering that the receiver's type lacks a native `method` but an
 * `:extension method` conforms nominally, so this lowers to the direct free call `extFn(obj, a ...)`.
 * `fnName` is the SOURCE extension name (backend-neutral); `args` are the lowered operands (the receiver
 * is NOT among them -- it is synthesized from `head`). The JS materialization is a per-backend hook
 * (`emitExtCall`): it re-visits `head` for the receiver expression and maps `fnName` to the EMITTED name
 * (import-inlining / encoding), exactly the `emitRef` contract. Falls back to legacy emission of the
 * rebuilt call only when substituted into a legacy-parent operand (hexprToAst), same as a free call.
 */
export interface HExtCall extends HBase {
  kind: "ext-call";
  head: ast.ASTNode;
  fnName: string;
  args: HExpr[];
}

/**
 * A resolved METHOD CALL `obj.method(a ...)` -- the third modeled dispatch kind (A3, TY8). The shared
 * `classifyCall` decided at lowering that the receiver's type carries a native/user `method`, so this
 * stays a direct member call `obj.method(args)` (no devirtualization -- that is ext's job). `head` is the
 * `obj.method` composite-identifier; the MEMBER CALLEE is materialized by the existing `leafExpr` hook
 * (`visitExpr(head)` -- the JS receiver/member policy: encoding, `this`, import-inlining), so no new seam
 * is needed. `args` are the lowered operands. Falls back to legacy emission of the rebuilt call only when
 * substituted into a legacy-parent operand (hexprToAst), same as free/ext. (The storing mutators
 * push/unshift are NOT modeled here -- their D11 arg-copy is A5 / HCopyStore, still opaque.)
 */
export interface HMethodCall extends HBase {
  kind: "method-call";
  head: ast.ASTNode;
  args: HExpr[];
}

/**
 * A resolved VIRTUAL (dynamic-receiver) method call `obj.method(a ...)` -- the fifth modeled dispatch
 * kind (A3, TY8). `classifyCall` reached this because the receiver's TYPE is unknown (no native member,
 * no conforming `:extension`), so dispatch is decided at RUNTIME. On JS that is byte-identical to a
 * static method call -- `callExpression(leafExpr(head), args)`, the runtime resolves it -- so this
 * reuses the same `leafExpr` hook and carries no extra data. It is a DISTINCT kind from `HMethodCall`
 * only to ENCODE the dispatch decision: `method` is devirt-able (concrete receiver), `virtual` needs a
 * witness/vtable on a native backend (the C backend's `ll_dyn_method`). The static/dynamic split is thus
 * made once, in the shared classifier, not re-derived per backend. (0-arg dynamic access -> `__ll_member`
 * is a separate member-dyn emission, still opaque.)
 */
export interface HVirtualCall extends HBase {
  kind: "virtual-call";
  head: ast.ASTNode;
  args: HExpr[];
}

/**
 * A resolved OPERATOR call `(op a ...)` -- the fourth modeled dispatch kind (A3, TY8), and a DISTINCT
 * one on purpose: an operator is not a free call to a shim. `op` is the SOURCE symbol (`+`, `==`, `<`,
 * ...), backend-neutral -- a native backend reads it plus the operand types and emits a machine op
 * (static, D43) or a boxed runtime dispatch (an `Unknown` operand). On JS it routes through the runtime
 * shim: the member callee is the encoded operator identifier (`+` -> `_2b`) and the shim gets registered,
 * both done by the existing `leafExpr(head)` hook (`visitExpr(head)`), so no new seam. `args` are the
 * lowered operands. Excludes `||`/`&&` (short-circuit LogicalExpression, kept opaque). Falls back to
 * legacy emission of the rebuilt call only when substituted into a legacy-parent operand (hexprToAst).
 */
export interface HOperator extends HBase {
  kind: "operator";
  op: string;
  head: ast.ASTNode;
  args: HExpr[];
}

/**
 * A CONSTRUCTION `(Dog "rex")` -> `new Dog("rex")` -- the `new`-emitting sibling of HFreeCall (A3/A4).
 * `callee` is the modeled class-name reference; `args` the lowered operands (never copied at the call
 * site). On JS it emits a `NewExpression`; a native backend allocates the object and runs the
 * constructor. The first foothold of A4 (construction in the HIR) -- the class DEFINITION side (fields,
 * `:ctor`, field initializers, super) stays in `JSClassBuilder` until that is inverted to HFieldInit.
 */
export interface HConstruct extends HBase {
  kind: "construct";
  callee: HExpr;
  args: HExpr[];
}

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
  | HWhile
  | HFor
  | HForEach
  | HVarDecl
  | HUserAssign
  | HFieldInit
  | HSuperCall
  | HCtorMethodCall
  | HClass
  | HOpaqueStmt;

/** An expression evaluated for effect; its value is discarded. */
export interface HExprStmt extends HBase {
  kind: "expr-stmt";
  expr: HExpr;
}

/**
 * A constructor field STORE `this.field = param` (A4 -- the spec's "per-field this.x = param"). The
 * first modeled piece of the class DEFINITION: `field` is the field-name node (the JS emitter encodes it
 * via `leafExpr`, an LLVM backend would resolve a slot); `paramName` the source constructor-param name
 * (encoded to the RHS via the `encodeName` hook). Emitted directly by the HIR emitter -- so the store
 * SHAPE has one home -- with `JSClassBuilder` building the nodes for now (the class is not yet lowered;
 * when it is, the lowering produces these and JSClassBuilder becomes the thin consumer the spec wants).
 */
export interface HFieldInit extends HBase {
  kind: "field-init";
  field: ast.ASTNode;
  paramName: string;
}

/**
 * A constructor `super(a, b)` call (A4). `args` are the SOURCE param names forwarded to the parent (the
 * inheritance pass-through JSClassBuilder computes); the JS emitter encodes each to an identifier. A
 * native backend calls the parent's initializer. Like HFieldInit, built by JSClassBuilder for now.
 */
export interface HSuperCall extends HBase {
  kind: "super-call";
  args: string[];
}

/**
 * A constructor's call to a `:ctor` initializer METHOD `this.method()` (A4) -- a class may derive fields
 * at construction via a `:ctor`-modified method, run after the field stores. `method` is the method-name
 * node (encoded via `leafExpr`). Built by JSClassBuilder for now, like HFieldInit.
 */
export interface HCtorMethodCall extends HBase {
  kind: "ctor-method-call";
  method: ast.ASTNode;
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

/**
 * The loops. Their BODY (and `for`'s init / `else`) is an HBlock lowered in effect position -- which is
 * the STATEMENT SINK a value-position `if` in the body needs (the whole reason loops must be modelled,
 * not delegated). The test/step of a `while`/`for` are inline HExprs (re-evaluated each iteration, so
 * they cannot be hoisted -- a statement-bearing test falls back to legacy at lowering). The for-each
 * copy/destructuring assembly stays a legacy emit hook, driven by the HIR-emitted collection + body.
 */
export interface HWhile extends HBase {
  kind: "while";
  test: HExpr;
  body: HBlock;
}

export interface HFor extends HBase {
  kind: "for";
  init: HBlock;
  test: HExpr | null;
  update: HExpr | null;
  body: HBlock;
  elseBlock: HBlock | null;
}

export interface HForEach extends HBase {
  kind: "for-each";
  collection: HExpr;
  body: HBlock;
  elseBlock: HBlock | null;
}

/**
 * A `let`/`mut` declaration whose initializer is an HExpr the HIR emits inline -- so a value-position
 * `if`/collection init is a real ternary/temp/array, never a legacy asExpression ternary. The
 * declaration structure (name / destructuring / const-vs-let / the D11 copy) stays a legacy emit hook.
 */
export interface HVarDecl extends HBase {
  kind: "var-decl";
  init: HExpr | null;
  /**
   * The binding NAME (A2 -- the declaration structure on the node, not read from the raw VariableNode),
   * or null when the target is a destructuring pattern (which the native path refuses). The JS emitter
   * still uses `emitVarDecl` for the full structure (const-vs-let, destructuring, the D11 copy).
   */
  name: string | null;
  /** `mut` vs `let` -- the mutability on the node (A2). */
  mutable: boolean;
  /**
   * The binding's DECLARED type (A1), resolved once at lowering: for a `mut` the symbol table's declared
   * type wins (the channel carries the initializer's NARROWED type, and a mut can be re-assigned outside
   * that narrowing); for a `let` the channel type, else the symbol table. On the node so the native
   * backend needs neither `nodeTypes` nor the symbol table for it.
   */
  declaredType: InferredType | undefined;
}

/** A simple assignment `(x := rhs)` whose RHS is an HExpr the HIR emits inline; the target + D11 copy
 *  stay a legacy emit hook. (A compound `x += rhs` keeps the legacy substitution path.) */
export interface HUserAssign extends HBase {
  kind: "user-assign";
  rhs: HExpr;
}

/**
 * A class / struct DECLARATION (A4, class-def step 1 -- the seam).
 *
 * A class was, until now, indistinguishable from any other leaf statement: it lowered to an
 * `HOpaqueStmt` and the emitter re-visited `src`. That is the same catch-all a bare `foo()` uses, so
 * neither backend could tell "a type is being declared here" from "some effect runs here" -- and the
 * whole class SHAPE (fields, constructor, methods, markers) lived entirely off the HIR, in
 * `JSClassBuilder` on the JS side and a parallel `registerClass` pre-pass on the C side.
 *
 * `HClass` gives the declaration its own node, and the SHELL now lives on it (step 2): `name` is the
 * declared type name and `superName` the single parent's name -- the JS `class <name> extends <super>`
 * identity and, for a native backend, the struct tag + parent link. Both are the RAW source names, which
 * is what the JS id/superClass are built from (a class id is not encoded, unlike a value-position ref)
 * and are STABLE by codegen time: the import inliner renames a class in the transformation stage
 * (`node.name` is already `__ll_inlined_Point_3` here; `__ll_source_name` keeps the original), before
 * lowering, so capturing the name at lowering is safe.
 *
 * The JS emitter assembles the `ClassDeclaration` (id, superClass, ClassBody) from these; the class-body
 * MEMBERS (markers, fields, constructor + its resolved params/prologue/super/field-stores/ctor-methods,
 * methods, iterable bridge) and the custom-modifier wrapping remain legacy hooks for now
 * (`emitClassBody` / `finishClass`). Those members move onto this node in the following gated increments,
 * until `JSClassBuilder` is the thin consumer the spec wants (Step 5) and the C backend consumes the same
 * modeled node instead of re-deriving from raw AST.
 */
/**
 * A class-body FIELD declaration (A4, step 4) -- a non-`:ctor` member variable, emitted as a JS
 * `PropertyDefinition` (a native backend lays out a struct slot). `name` is the field-name node and
 * `valueSrc` its initializer node (both re-visited by the JS leaf hooks); `hasInit` is `valueSrc != null`.
 * `isStatic` is the `:static` modifier (D11e). The initializer's D11 value-copy is applied by the emitter
 * via `storeValue` (a field is a new home for a value). Not an HStmt -- a member spec carried on HClass.
 */
export interface HFieldDecl {
  src: ast.ASTNode;
  name: ast.ASTNode;
  valueSrc: ast.ASTNode | null;
  isStatic: boolean;
}

/**
 * A resolved constructor PARAMETER (A4, step 5). `name` is the raw source name (the JS emitter encodes it
 * and, for a default, wraps in an AssignmentPattern over the re-visited `defaultSrc`). `type` is carried
 * only so the D11 copy prologue can SKIP a parameter declared a known primitive -- it cannot be a struct.
 */
export interface HCtorParam {
  name: string;
  defaultSrc: ast.ASTNode | null;
  type: ast.TypeNode | undefined;
}

/**
 * The resolved CONSTRUCTOR of a class (A4, step 5), or absent (`HClass.ctor === null`) when the class needs
 * none. The whole of JSClassBuilder.buildConstructor's structural work is done in the lowering now:
 *   - `params` -- the final parameter list after inheritance pass-through (a parent's required ctor params
 *     come first, in the parent's order, then the local `:ctor` params), each with its default + type.
 *   - `hasSuper` / `superArgs` -- whether to emit `super(...)` and the source names forwarded to it.
 *   - `fieldInits` -- the `this.<field> = <param>` stores (the local `:ctor` variables), as HFieldInit data.
 *   - `ctorMethods` -- the `:ctor` initializer method names, run last (`this.<method>()`), as HCtorMethodCall.
 *   - `defaultBeforeRequired` -- the LL diagnostic payload when a defaulted param precedes a required one
 *     (legal JS, a trap; the parameter ORDER is the source's and must not be reordered). Reported at emit.
 * The JS emitter assembles the MethodDefinition; the D11 parameter-copy prologue stays a legacy hook.
 */
export interface HCtor {
  params: HCtorParam[];
  hasSuper: boolean;
  superArgs: string[];
  fieldInits: Array<{ src: ast.ASTNode; field: ast.ASTNode; paramName: string }>;
  ctorMethods: ast.ASTNode[];
  defaultBeforeRequired: { param: string; plural: boolean; required: string } | null;
}

export interface HClass extends HBase {
  kind: "class";
  /** The declared type name (raw / unencoded) -- the JS class id, a native struct tag. */
  name: string;
  /** The single parent type's name, or null -- the JS `extends` clause / native parent link. */
  superName: string | null;
  /**
   * The type's SOURCE name (`__ll_source_name ?? name`) -- the `static __ll_name` marker's value, which
   * is NOT `name`: the import inliner renames the binding (`name` = `__ll_inlined_Point_3`) but the type
   * identity stays `Point`, and the operator/RTTI registries key on this. Null only if there is no name.
   */
  sourceName: string | null;
  /** A struct is a VALUE TYPE -- the `static __ll_struct = true` marker (D11); a class omits it. This is
   *  exactly the by-value discrimination a native backend needs, so it rides the node, not just the JS. */
  isStruct: boolean;
  /** The class-body FIELDS (non-`:ctor` member variables), in source order. Emitted as PropertyDefinitions
   *  before the constructor; a native backend reads the struct layout from them. */
  fields: HFieldDecl[];
  /** The resolved constructor, or null when the class needs none (no params, no parent, no `:ctor` vars). */
  ctor: HCtor | null;
}

/** A leaf statement: emit by coercing the legacy `visit(src)` to a statement. */
export interface HOpaqueStmt extends HBase {
  kind: "opaque-stmt";
}

/** A statement list. Not a JS scope on its own -- an HBlockStmt is the scoping wrapper. */
export interface HBlock {
  stmts: HStmt[];
}
