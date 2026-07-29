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
import { DesugarAstVisitor } from "../../transformation/visitors/DesugarAstVisitor";
import type { HirModule } from "../../hir";
import { LowerAstToHirVisitor } from "../../hir";
import type { HBlock, HExpr, HPattern, HStmt } from "../../hir/nodes";
import { report, CBackendDiagnostics } from "../../rules/diagnostics";
import { GapLedger, Assumption } from "./GapLedger";
import {
  CBlock, CExpr, CStmt, CModule, CFunction, CParam, CLValue, CCallee, BinopMode, CMapEntry,
  CLifted, CCapture, CClass,
} from "./cir";
import { CType, C_BOOL, C_INT, C_REAL, C_STR, C_VALUE, C_VOID, mapType, ctypeEquals } from "./ctype";
import { INTRINSIC_CALLS, NATIVE_METHODS, NATIVE_FIELDS } from "./intrinsics";
import { nativeMemberDeclared } from "../../types/nativeMembers";
import { freeVariables, freeVariablesOfBody } from "../../hir/freevars";
import { isBuiltinModifier, collectDeclaredAnnotations } from "../../helpers/modifiers";
import { buildTypesMetadata, conformedInterfaceNames } from "../../reflection/metadata";
import { buildExtensionTable, conformingExtensionFn, memberKindIn, receiverType, ExtCandidate } from "../../hir/extensionResolution";
import { lowerCoroutine, CoroutineRefusal } from "../../hir/LowerCoroutines";
import { promoteFrame, PromotedFrame, FramePromotionRefusal, STATE_SLOT, GEN_STATE_NAME } from "./promoteFrame";

/** The state a generator parks in once it is exhausted. Any value the dispatch does not name works;
 *  it must not be 0, which means "not started" and would restart the body. */
const GEN_DONE = -1;

/** Is this function a `:gen`? (The `:async` half of A8 stays refused -- D60.) */
function isGenerator(fn: ast.FunctionNode): boolean {
  return !!fn.generator && !fn.async;
}

const BINARY_OPS = new Set(["+", "-", "*", "/", "%", "==", "!=", "≠", "<", ">", "<=", ">=", "&&", "||"]);
const NUMERIC = (t: CType) => t.k === "int" || t.k === "real";
/** The vec-of-boxed-values type: what a REST parameter receives, and what `ll_list` returns. */
const VEC_OF_VALUE: CType = { k: "vec", elem: C_VALUE };

/**
 * Escape one source name into C's identifier alphabet, INJECTIVELY.
 *
 * The old spelling was `name.replace(/[^A-Za-z0-9_]/g, ch => "_" + hex)`, which is not injective for
 * two independent reasons -- and both bit:
 *
 *   1. `_` PASSED THROUGH UNESCAPED, so an escape was indistinguishable from a literal underscore
 *      followed by hex digits: `a-b` -> `u_a` + `_2d` + `b` = `u_a_2db`, and `a_2db` -> `u_a_2db`.
 *      Two distinct bindings, one C identifier.
 *   2. THE HEX RUN HAD NO TERMINATOR, and a codepoint's hex is variable-length. ` ac` (space, a, c)
 *      escapes to `_20` + `ac`; U+20AC escapes to `_20ac`. Same string. Escaping `_` alone would have
 *      left this one live.
 *
 * So: `_` doubles to `__`, and every other disallowed character becomes `_<hex>_`. A `_` is followed
 * by either another `_` (a literal underscore) or by at least one hex digit and a closing `_` (an
 * escape) -- and hex digits are never `_`, so the two cases are told apart by the second character.
 *
 * This also makes the METHOD-NAME JOIN injective, which was a separate reported collision:
 * `__ll_method_<class>_<method>` could be reached two ways, class `Foo` + method `bar_baz` and class
 * `Foo_bar` + method `baz`. Neither part can now produce a lone `_`, so the separator is unambiguous:
 * `Foo_bar__baz` and `Foo__bar_baz`.
 */
function escapeC(name: string): string {
  let out = "";
  for (const ch of name) {
    if (ch === "_") out += "__";
    else if (/[A-Za-z0-9]/.test(ch)) out += ch;
    else out += `_${ch.codePointAt(0)!.toString(16)}_`;
  }
  return out;
}

/** Mangle an l-lang identifier into a collision-free C identifier. Lowering temps pass through. */
export function mangleC(name: string): string {
  if (name.startsWith("__ll_hir")) return name;
  return "u_" + escapeC(name);
}

/** Mangle without the `u_` user prefix, for compiler-synthesized symbols (class/method names). */
function mangleBare(name: string): string {
  return escapeC(name);
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
  parent?: string; // `:extends` base class name (for inheritance + reflection)
  /** `isCtor` = this field receives a positional CONSTRUCTION arg (it is a `:ctor` field / ctor
   *  parameter), as opposed to a plain field that only ever takes its own default. Construction maps
   *  the k-th arg to the k-th ctor field IN SLOT ORDER -- not to raw slot `k` -- so a plain field
   *  interleaved below a ctor field (which inheritance introduces) does not steal a ctor arg (§9.2). */
  fields: { name: string; ctype: CType; default?: ast.ASTNode; isCtor?: boolean }[];
  fieldSlot: Map<string, number>;
  /** The transitive `:implements` closure -- D24 erases interfaces, so this is conformance's only
   *  runtime carrier (gap ledger §14.1). Consumed from the modeled `HClass.interfaces`. */
  interfaces: string[];
  /** Every method callable on this class, INHERITED ENTRIES INCLUDED -- a child that does not override
   *  carries the parent's entry verbatim, `cName` and all. That is what makes an override detectable
   *  without a second table: `Add.methods.get("show").cName` is `__ll_method_BinOp_show` when `Add`
   *  inherits it and `__ll_method_Add_show` when it overrides. See `overridesBelow`.
   *
   *  Filled by `registerClass` during the PRE-PASS (`collectClassesAndOperators`), which walks every
   *  top-level declaration before a single body is lowered -- so the table is complete, for every
   *  class, at the moment any method body asks a devirtualization question. `collectMethod` later
   *  lowers the bodies; it adds no names. */
  methods: Map<string, { cName: string; params: CType[]; ret: CType }>;
  /** C names of `:ctor` initializer methods, in declaration order -- run on the object right after
   *  construction to compute derived fields (`this.full-name := ...`). */
  ctorMethods: string[];
}

export class ResolveHirToCir {
  private readonly functions: CFunction[] = [];
  private readonly lifted: CLifted[] = [];
  private readonly adapters = new Map<string, { forCName: string; params: CType[]; ret: CType; arity: number; restAt?: number }>();
  /** Top-level user function signatures, by SOURCE name -- direct-call targets.
   *  `restAt` is the index of a REST parameter (`[a ...xs]`) when the function has one: from that
   *  position on, the call site packs its trailing arguments into one vec (see `packRestArgs`). */
  private readonly topLevelFns = new Map<string, { params: CType[]; ret: CType; arity: number; restAt?: number }>();
  /** Imported (non-intrinsic) l-lang bodies lowered on demand, by ALIAS KEY (see `aliasFor`). */
  private readonly importedLowered = new Set<string>();
  /**
   * The flat-namespace guard.
   *
   * C has one global namespace; l-lang has module-PRIVATE bindings (D20), so two imported modules may
   * legitimately each define `TAG` or `decorate`. Keyed by bare source name, the second silently
   * reused the first's global and the program printed the first module's answer -- a wrong answer,
   * not a crash. `aliasFor` hands every (defining module, source name) pair its own alias: the bare
   * name for whoever claims it first, then `name#2`, `name#3`, ... The alias is what `topLevelFns` /
   * `importedLowered` / `importedValues` key on and what `mangleC` turns into the C identifier, so
   * every existing single-claimant program emits byte-identical C.
   */
  private readonly aliases = new Map<string, string>();
  /** alias -> the `${module}::${name}` key that owns it (so a re-ask by the same owner is stable). */
  private readonly aliasOwner = new Map<string, string>();
  /**
   * THIS module's own top-level function / global names.
   *
   * `topLevelFns` and `globalNames` accumulate imported entries too, so asking them "is this one of
   * mine?" answers yes for whatever import registered the spelling FIRST -- which routed a second
   * module's private `decorate` / `TAG` straight to the first module's C name, short-circuiting
   * before module identity was ever consulted. These two sets are written only by the pre-scan, so
   * they mean what those call sites actually need.
   */
  private readonly ownFns = new Set<string>();
  private readonly ownGlobals = new Set<string>();
  /** Struct/class descriptors, by source name (spec A4). */
  private readonly classes = new Map<string, ClassDesc>();
  /** Operator overloads: key `<op>:<leftOperandTypeName>` -> the operator's C function. `isMethod`
   *  = an in-struct operator whose LEFT operand is the implicit `this`; `unary` = a one-operand op.
   *  `otherCType` is the DECLARED CType of the RIGHT operand's param (a union/`Any` -> boxed `ll_value`):
   *  the call site must declare it so InsertCoercions boxes the argument to match the real signature. */
  private readonly operators = new Map<string, { cName: string; ret: CType; isMethod: boolean; unary: boolean; otherCType?: CType }>();
  /** Enum members, keyed by the full `EnumName:Key` string (exactly the JS `enumKeys` key). A member
   *  is a compile-time constant -- the value is an explicit AST node or, by default, the ordinal. The
   *  reference `HttpMethod:GET` is a simple-identifier whose id IS that string (D: enums are not
   *  symbols); a match arm `HttpMethod:GET =>` is an equality test, not a binding. */
  private readonly enumValues = new Map<string, { valueNode: ast.ASTNode | null; ordinal: number }>();
  /** `:extension` methods, keyed `method:ReceiverType`. An extension is a free function (also in
   *  topLevelFns, callable directly / by pipeline) that `(recv.method args)` devirtualizes to a
   *  direct call `method(recv, ...args)` on its first parameter -- Dove's Q4 static case (D34). */
  private readonly extensions = new Map<string, string>();
  /** ANF temps that hold a class NAME, not a runtime value: `(new Inventory ...)` lowers the class
   *  head into `__ll_hir_N = Inventory`, but a class is not a value in C -- map the temp to the name so
   *  the `new` reads it back, and emit no decl for it. */
  private readonly tempClassName = new Map<string, string>();
  /** The class whose method body is being resolved (so `this` binds to `__self`). */
  private selfClass: string | undefined;
  /** Module-level binding names that top-level functions reference -> hoisted to C globals (a C
   *  function cannot see `main`'s locals; this is the module-scope analog of closure capture). */
  private readonly globalNames = new Set<string>();
  private readonly globalDecls: { cName: string; ctype: CType }[] = [];
  private readonly globalDeclared = new Set<string>();
  /** `defmodifier` names whose body is EMPTY -- a genuine identity, safe to ignore. Anything else
   *  refuses (see refuseCustomModifier); the C backend cannot apply a decorator. */
  private readonly emptyModifiers = new Set<string>();
  /** D72: names declared by `defattribute` in this module -- annotation data, nothing to apply. */
  private readonly attributeNames = new Set<string>();
  /** Every `defmodifier` in this module, by name -- the decorator bodies the static unfold reads. */
  private readonly modifierDefs = new Map<string, ast.ModifierDefNode>();
  /** Imported module-level bindings already hoisted to C globals (dedup for ensureImportedValue). */
  private readonly importedValues = new Set<string>();
  /** Their initializers, spliced in FRONT of `main` -- an import is evaluated before the importer. */
  private readonly importedInits: CStmt[] = [];
  /** Lexical scope stack of local bindings (by C name). scope[0] is the module/main body. */
  private readonly scopes: Map<string, VarInfo>[] = [new Map()];
  /** Names (C names) that must be heap cells in the CURRENT function scope (mutable-captured). */
  private cellVars: Set<string> = new Set();
  private liftCounter = 0;
  /** Fresh-name counter for compiler-introduced locals (the destructuring element temp). */
  private tempCounter = 0;
  /** D58: resolving a `:gen` body, so `for :each` desugars to an explicit cursor loop (its cursor
   *  must be a real declaration for the frame promotion to see it) and `return` parks the machine. */
  private inGenerator = false;
  /** The synthesized frame classes, one per `:gen`. Not in `this.classes` -- see `toModule`. */
  private readonly genClasses: CClass[] = [];
  /** The shared `:extension` table, built once on first use (it walks the whole symbol table). */
  private extTable?: Map<string, ExtCandidate[]>;
  /** True while resolving a FUNCTION body (top-level or lifted). A `function` statement seen when
   *  false is a module-level declaration; when true it is a nested closure. (Scope depth cannot tell
   *  them apart because each function resolves on an isolated scope stack.) */
  private inFunctionBody = false;
  private refused = false;
  /** A class/struct's src ClassNode -> its modeled HClass, so registerClass can CONSUME the field layout
   *  the HIR resolved (names + order + parent + struct-ness + defaults) instead of re-deriving it from the
   *  symbol table. Verified across the corpus to reproduce the checker-derived layout exactly. */
  private readonly hclassBySrc = new Map<ast.ASTNode, any>();

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
    return this.resolveSymbolSafe(name, src);
  }

  /** Resolve a symbol without recording a ledger dip -- for a lookup whose RESULT is not a below-HIR type
   *  read (e.g. a local ref's binding-KIND classification, whose type already rides the binding). */
  private resolveSymbolSafe(name: string, src: ast.ASTNode): SymbolEntry | undefined {
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
    // Error/TypeError/RangeError are l-lang classes now (std/core/errors, F1). Register the REAL class
    // so C emits its descriptor (message, and `cause` once added); SyntaxError/ReferenceError stay
    // synthetic host-error stand-ins. `root` scopes the ambient-class lookup.
    this.registerBuiltinClasses(root);
    // D72 -- the module's attribute names, through the SAME registry the JS backend reads, so the two
    // cannot disagree about whether a given `:name` is annotation data or a decorator to refuse. It
    // walks the AST rather than the flattened top-level statements, which also means a `defattribute`
    // that is not top-level is still seen. A separate set from `emptyModifiers` because the reason
    // differs: an empty modifier is a decorator with nothing to apply, an attribute is never applied.
    for (const [name, info] of collectDeclaredAnnotations(root)) {
      if (info.kind === "attribute") this.attributeNames.add(name);
    }
    // The top-level declarations, flattened out of the HIR body (the whole program is one block, so
    // each declaration arrives as an opaque-stmt whose `src` is the desugared StructNode / ClassNode
    // / FunctionNode). Drive the pre-pass off these, not the raw program (which is still list-wrapped).
    const items = this.topLevelStmtNodes(body);
    // Collect struct/class descriptors and operator overloads first: construction, field access,
    // methods and operator dispatch are all resolved from these, not from the HIR (spec A4/A3).
    this.collectClassesAndOperators(items);
    // Register every top-level function first, so forward references (call before declaration, or a
    // function used as a value) resolve regardless of order.
    for (const n of items) {
      if (n?._type === "modifier-def" && ((n as ast.ModifierDefNode).body ?? []).length === 0) {
        this.emptyModifiers.add((n as ast.ModifierDefNode).name);
      }
      if (n?._type === "modifier-def") this.modifierDefs.set((n as ast.ModifierDefNode).name, n as ast.ModifierDefNode);
    }
    this.registerModuleFunctions(items);
    // A module-level binding referenced by any top-level function must be a C global.
    this.computeGlobals(items);
    // The module body is itself a scope for capture purposes (a top-level lambda still captures
    // module locals). Compute its cell set from nested closures before resolving.
    //
    // FROM THE AST (`root`), NOT FROM `items` -- the same correction D72's annotation registry made
    // ten lines up, for the same reason and with the same failure mode. `topLevelStmtNodes` keeps only
    // `opaque-stmt | class | expr-stmt | var-decl` and recurses into `block`, so a top-level `for` /
    // `while` / `if` is not in it AT ALL: measured, a module whose only statement is a `for` yields
    // **zero** items, and the cell set came back empty without looking at anything. A `mut` declared
    // in that loop's `:init` and captured by a closure beside it was therefore copied into the closure
    // environment (`__e->u_i = u_i`) and mutated there, so the loop never advanced.
    //
    // Walking the AST is also the honest shape for the question being asked: "which of this frame's
    // mutable bindings does some nested closure capture" is a property of the whole frame, not of the
    // declarations that survived a flattening pass aimed at something else.
    this.cellVars = this.computeCellVars([root]);
    const resolvedMain = body ? this.resolveBlock(body) : { stmts: [] };
    // An imported binding initializes BEFORE this module's own body -- the order the import implies.
    const main = { stmts: [...this.importedInits, ...resolvedMain.stmts] };
    if (this.refused) return null;
    // DEDUPED by descriptor identity, not by key. `this.classes` is keyed by the name a program
    // SPELLS, and an aliased import (`{ Widget :as Gadget }`) deliberately points two keys at one
    // descriptor -- an alias is a second name for one definition, never a second definition. Emitting
    // `values()` verbatim wrote that definition's field table, method adapters and class descriptor
    // out twice, and cc rejected the second.
    const classes: CClass[] = [...new Set(this.classes.values())].map((c) => {
      // OWN methods only (inherited ones carry the parent's cName and are found via the runtime parent
      // walk): a method is this class's own iff its cName was built with this class's mangled name.
      const ownPrefix = `__ll_method_${mangleBare(c.name)}_`;
      const methods = [...c.methods.entries()]
        .filter(([, m]) => m.cName.startsWith(ownPrefix))
        .map(([name, m]) => ({ name, cName: m.cName, params: m.params, ret: m.ret }));
      return { name: c.name, isStruct: c.isStruct, parent: c.parent, fields: c.fields, methods, interfaces: c.interfaces };
    });
    return {
      functions: this.functions,
      lifted: this.lifted,
      // D58 frame classes are appended rather than folded into `this.classes`: that map is keyed by
      // the name a program can SPELL in a type annotation, and a generator's frame type is not one.
      classes: [...classes, ...this.genClasses],
      globals: this.globalDecls,
      adapters: [...this.adapters.values()],
      main,
      // The SAME graph the JS backend emits -- one builder (D54), so the two cannot answer
      // differently about a class's fields or a function's params.
      metadata: buildTypesMetadata(this.context),
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
    // Same claim as for this module's functions: our own globals own their bare names, so an
    // imported module's private binding of the same name is aliased aside rather than colliding.
    for (const g of this.globalNames) { this.aliasFor(g, this.rootSource ?? ""); this.ownGlobals.add(g); }
    if (this.globalNames.size) this.ledger.record("new", "module-global", items[0], "module-level binding referenced by a top-level function; hoisted to a C global (JS closes over module scope for free)");
  }

  /** Built-in Error classes: `message`-carrying classes, so error handling has concrete types. */
  private registerBuiltinClasses(root: ast.ASTNode): void {
    // Error/TypeError/RangeError are l-lang classes (std/core/errors, an ambient prelude since F1).
    // Register the REAL class eagerly -- via ensureClassRegistered against the root scope -- so C emits
    // the l-lang descriptor (its real fields: `message`, and `cause` once added) rather than a synthetic
    // message-only stub, and so `Error` is ALWAYS in the class registry as an ancestor for the
    // ll_is_type chain walk (a synthetic SyntaxError/ReferenceError still names it as `parent`). The
    // runtime never depends on the layout -- `ll_uncaught` finds "message" by name, catch matches by
    // name up the :extends chain, `ll_trap` builds no object -- so this is observationally a no-op while
    // Error is message-only, and the enabler for `cause`. Fall back to synthetic only if the ambient
    // module is somehow absent.
    for (const name of ["Error", "TypeError", "RangeError"]) {
      if (this.classes.has(name)) continue;
      if (this.ensureClassRegistered(name, root)) continue;
      this.registerSyntheticError(name);
    }
    // SyntaxError/ReferenceError have no l-lang class -- they are host-error names `ll_trap` prints and
    // user code rarely constructs on C. Kept synthetic (message-only), extending `Error`.
    for (const name of ["SyntaxError", "ReferenceError"]) {
      if (!this.classes.has(name)) this.registerSyntheticError(name);
    }
  }

  /** A synthetic message-only Error-family descriptor: the fallback for a host-error name with no l-lang
   *  class (SyntaxError/ReferenceError, or Error/TypeError/RangeError if the ambient module is absent). */
  private registerSyntheticError(name: string): void {
    const fields = [{ name: "message", ctype: C_STR }];
    const fieldSlot = new Map([["message", 0]]);
    this.classes.set(name, { name, isStruct: false, parent: name === "Error" ? undefined : "Error", fields, fieldSlot, methods: new Map(), ctorMethods: [], interfaces: [] });
  }

  // -- struct/class collection (spec A4: the whole layer is absent from the HIR) -------------------

  /** The desugared declaration nodes at module top level (opaque-stmt src nodes from the HIR body). */
  private topLevelStmtNodes(body: HBlock | undefined): ast.ASTNode[] {
    const out: ast.ASTNode[] = [];
    const walk = (b: HBlock | undefined): void => {
      for (const s of b?.stmts ?? []) {
        if (s.kind === "class") this.hclassBySrc.set(s.src, s); // capture the modeled HClass for registerClass
        if (s.kind === "opaque-stmt" || s.kind === "class" || s.kind === "expr-stmt" || s.kind === "var-decl") out.push(s.src);
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
      if (n._type === "enum") this.registerEnum(n as ast.EnumNode);
      // A top-level `:operator` / `:extension` function -- collected for static devirtualization.
      if (n._type === "function") { this.maybeRegisterOperator(n as ast.FunctionNode); this.registerExtension(n as ast.FunctionNode); }
    }
  }

  /** `(fn :extension manhattan [self <- Vec2 o] ...)` -- register the method-call surface. The body
   *  is an ordinary top-level function (also in topLevelFns); `:extension` only makes `(recv.manhattan
   *  o)` devirtualize to `manhattan(recv, o)`, keyed by the receiver (first-param) type (D34, Q4). */
  private registerExtension(fn: ast.FunctionNode): void {
    if (!fn.modifiers?.some((m) => m.modifier === "extension") || !fn.name) return;
    const method = ast.symbolName(fn.name);
    const recvType = this.paramTypeName(fn.params?.[0]);
    if (!recvType) return;
    this.extensions.set(`${method}:${recvType}`, method);
  }

  /** The l-lang type NAME of a receiver's CType (for extension-method lookup): a struct/class by its
   *  class name, a primitive by its spelling. Arrays/maps/closures have no simple receiver name. */
  private ctypeName(ct: CType): string | undefined {
    switch (ct.k) {
      case "obj": return ct.className;
      case "str": return "String";
      case "int": return "Int";
      case "real": return "Real";
      case "bool": return "Boolean";
      case "char": return "Char";
      default: return undefined;
    }
  }

  /** `(defenum HttpMethod :GET :POST ...)` -- each member is a compile-time constant `EnumName:Key`.
   *  Mirrors JS `visitEnum` exactly: the value is the explicit `=> v` or, absent one, the ordinal.
   *  Nothing is emitted at runtime; references and match arms read the constant back (A4-adjacent:
   *  the HIR keeps no enum node, and enums were never even given symbols). */
  private registerEnum(node: ast.EnumNode): void {
    const enumName = node.name.name;
    (node.body ?? []).forEach((k, i) => {
      const key = `${enumName}:${ast.keyName((k as ast.EnumKeyNode).key)}`;
      this.enumValues.set(key, { valueNode: (k as ast.EnumKeyNode).value ?? null, ordinal: i });
      this.ledger.record("A4", "enum-member", node, "enum member is a compile-time constant resolved below the HIR (enums are not even symbols)");
    });
  }

  /**
   * The enum table, asked about a member that may live in ANOTHER MODULE (S1d / N11).
   *
   * `registerEnum` is driven off `topLevelStmtNodes(body)` -- the ROOT module's declarations -- so an
   * imported enum was never scanned and `Dir:up` was simply absent. The reference then fell through
   * to `resolveAstExpr`'s identifier path and emitted `u_Dir_3aup`, a name nothing declares:
   * `use of undeclared identifier`, caught by cc rather than by a diagnostic. Same finding as the JS
   * side's `ReferenceError: Dir3aup is not defined`; different pipeline, so a second fix.
   *
   * Resolved LAZILY, on first reference, which is the same route imported CLASSES already take here
   * (`registerClass`'s "no HClass -- imported/desugared copy" fallback reads the symbol table too).
   * The symbol table registers the ENUM even though it never registers its members, so the head of
   * `Dir:up` is enough to find the declaration and fold the member to its constant.
   *
   * Nothing is emitted either way -- an enum member is a compile-time constant on this backend -- so
   * unlike the JS fix there is no declaration to collide, and no rename question.
   */
  private lookupEnumMember(name: string): { valueNode: ast.ASTNode | null; ordinal: number } | undefined {
    const known = this.enumValues.get(name);
    if (known) return known;

    const cut = name.indexOf(":");
    if (cut <= 0) return undefined;
    const head = name.slice(0, cut);
    const owner: any = this.context?.symbolTable?.resolveSymbol?.(head as any);
    if (!owner || owner.nodeType !== "enum" || owner.value?._type !== "enum") return undefined;

    this.registerEnum(owner.value as ast.EnumNode);
    return this.enumValues.get(name);
  }

  /** The value expression of an enum member: the explicit value, or the ordinal as an Int literal. */
  private enumValueExpr(entry: { valueNode: ast.ASTNode | null; ordinal: number }, src: ast.ASTNode): CExpr {
    if (entry.valueNode) return this.resolveAstExpr(entry.valueNode);
    return { src, ctype: C_INT, kind: "c-lit", lit: "int", value: String(entry.ordinal) };
  }

  private registerClass(node: ast.StructNode | ast.ClassNode): void {
    const name = ast.symbolName(node.name);
    if (this.classes.has(name)) return;
    const isStruct = node._type === "struct";
    const hc = this.hclassBySrc.get(node);
    const t: any = (() => { try { return this.context.symbolTable.resolveSymbol(name, node)?.inferredType; } catch { return undefined; } })();
    const astFieldTypes = this.memberFieldTypes(node);
    const memberType = (fname: string): CType => {
      const m = (t?.members ?? []).find((mm: any) => mm.name === fname && mm.type?.kind !== "function");
      return m?.type ? mapType(m.type) : C_VALUE;
    };
    // The per-field DEFAULT value (`(let :ctor x <- Real 0.0)` / `(let :private tag "rect")`): the
    // initializer used when a ctor arg is omitted, and the ONLY initializer for a non-ctor field.
    const astFieldDefaults = this.memberFieldDefaults(node);
    // OWN field layout -- CONSUMED from the modeled HClass when present: the own `:ctor` field stores
    // (HFieldInit), then the non-ctor fields (HFieldDecl), in the source order the JS ClassBuilder emits.
    // The whole layout+order lives on the HIR now (A4), so this is no longer a dip; only field TYPES stay
    // an AST read (`(let :ctor x <- Real)`), which is the A1 type layer the HIR does not carry yet. Without
    // an HClass (an imported/desugared copy) fall back to the checker's ctorInfo + body scan.
    let ownFields: { name: string; ctype: CType; default?: ast.ASTNode; isCtor?: boolean }[];
    if (hc) {
      // Layout AND field TYPES both ride HClass now (A4 + A1/D48 step 4): a `:ctor` field's type comes
      // from its constructor parameter, a plain field's from HFieldDecl.type. No class-body AST walk.
      const modeledType = new Map<string, CType>();
      for (const p of (hc.ctor?.params ?? []) as any[]) {
        const ct = this.typeNodeToCType(p.type);
        if (ct) modeledType.set(p.name, ct);
      }
      for (const f of (hc.fields ?? []) as any[]) {
        const nm = ast.symbolName(f.name);
        const ct = this.typeNodeToCType(f.type) ?? this.ctypeFromLiteral(f.valueSrc);
        if (ct) modeledType.set(nm, ct);
      }
      // `fieldInits` are the `:ctor` fields (they take a construction arg); `hc.fields` are plain
      // (default-only). Order is ctor fields first, then plain -- the same order the slots take.
      const ctorNames = ((hc.ctor?.fieldInits ?? []) as any[]).map((fi) => ast.symbolName(fi.field));
      const ctorNameSet = new Set(ctorNames);
      const ownNames: string[] = [...ctorNames, ...((hc.fields ?? []) as any[]).map((f) => ast.symbolName(f.name))];
      ownFields = ownNames.map((nm) => ({ name: nm, ctype: modeledType.get(nm) ?? memberType(nm), default: astFieldDefaults.get(nm), isCtor: ctorNameSet.has(nm) }));
    } else {
      this.ledger.record("A4", isStruct ? "defstruct" : "defclass", node, "construction/field-layout resolved from the symbol table (no HClass -- imported/desugared copy)");
      const ctorParams: any[] = t?.ctorInfo?.params ?? [];
      ownFields = ctorParams.map((p: any) => ({
        name: p.name,
        ctype: astFieldTypes.get(p.name) ?? (p.type ? mapType(p.type) : memberType(p.name)),
        default: astFieldDefaults.get(p.name),
        isCtor: true, // ctorInfo.params ARE the construction parameters
      }));
      const seen = new Set(ownFields.map((f) => f.name));
      for (const [fname, ct] of astFieldTypes) {
        if (!seen.has(fname)) { ownFields.push({ name: fname, ctype: ct, default: astFieldDefaults.get(fname) }); seen.add(fname); }
      }
    }
    // Inheritance (`:extends`): the parent's fields come FIRST (lower slots), then this class's own --
    // the layout the JS ClassBuilder also produces. The whole hierarchy is a symbol-table walk the
    // HIR does not model (spec A4).
    const parent = this.extendsName(node) ?? (typeof t?.parentClass === "string" ? t.parentClass : undefined);
    // A local class may extend an IMPORTED parent (T1b). The parent is registered on demand, not by
    // the root-module pre-pass, so without this its descriptor is absent and the child inherits NO
    // fields -- a missing inherited member trapped on C. E2 fixed this for an imported class's parent;
    // this is the same, for a LOCAL class whose parent is imported.
    if (parent && !this.classes.has(parent)) this.ensureClassRegistered(parent, node);
    const parentDesc = parent ? this.classes.get(parent) : undefined;
    if (parent && parentDesc) this.ledger.record("A4", "inherit", node, `'${name}' inherits '${parent}' fields/methods (hierarchy walked below the HIR)`);
    // Parent fields first, then own -- but a field that RE-declares a parent's keeps the parent slot
    // (a child that also declares `message` shadows, it does not add a second slot).
    const fields: { name: string; ctype: CType }[] = parentDesc ? [...parentDesc.fields] : [];
    const fieldSlot = new Map<string, number>();
    fields.forEach((f, i) => fieldSlot.set(f.name, i));
    for (const f of ownFields) {
      if (fieldSlot.has(f.name)) fields[fieldSlot.get(f.name)!] = f; // override in place
      else { fieldSlot.set(f.name, fields.length); fields.push(f); }
    }
    // Inherited methods (own override): copy the parent's method table, then this class's methods
    // shadow by name below.
    const methods = new Map<string, { cName: string; params: CType[]; ret: CType }>();
    if (parentDesc) for (const [mn, m] of parentDesc.methods) methods.set(mn, m);
    const ctorMethods: string[] = parentDesc ? [...parentDesc.ctorMethods] : [];
    // Register the descriptor NOW (before processing members) so a self-referential member type --
    // an operator returning its own class, a method taking the same struct -- resolves to obj.
    // The conformance closure rides the modeled HClass (A-0: both backends need the same answer, so
    // it is decided once at lowering). Falls back to computing it here for an IMPORTED class, whose
    // HClass this module never lowered.
    const interfaces = hc?.interfaces ?? (() => { try { return conformedInterfaceNames(this.context, name); } catch { return []; } })();
    this.classes.set(name, { name, isStruct, parent: parentDesc ? parent : undefined, fields, fieldSlot, methods, ctorMethods, interfaces });
    for (const m of this.memberFunctions(node)) {
      if (!m.name) continue;
      const mn = ast.symbolName(m.name);
      const isOp = m.modifiers?.some((mod) => mod.modifier === "operator");
      if (isOp) { this.maybeRegisterOperator(m, name); continue; }
      const sig: any = t?.methodSignatures?.get?.(mn);
      const paramCTypes = m.params.map((p, i) => this.typeNodeToCType(p.type) ?? (sig?.params?.[i] ? mapType(sig.params[i]) : C_VALUE));
      const cName = `__ll_method_${mangleBare(name)}_${mangleBare(mn)}`;
      // NEVER downgrade a method to a C `void` return: like a top-level fn, a `-> Void` method whose
      // body returns a value (the implicit-return desugar wraps every tail) stays boxed ll_value, or the
      // `return <v>` cc-fails. Same void-fn-boxed treatment userFnRet gives free functions.
      const rawRet = this.typeNodeToCType(m.returns) ?? mapType(sig?.returns);
      let ret = rawRet;
      // D49a: a `-> Void` method returns nothing now that the implicit return is suppressed.
      methods.set(mn, { cName, params: paramCTypes, ret });
      // A `:ctor` initializer method runs at construction time (after field init) to derive fields.
      if (m.modifiers?.some((mod) => mod.modifier === "ctor")) ctorMethods.push(cName);
    }
  }

  /** The `:extends` base class name of a struct/class, if any. */
  private extendsName(node: ast.StructNode | ast.ClassNode): string | undefined {
    const ext = (node.extends ?? [])[0] as any;
    if (!ext) return undefined;
    return this.typeNodeName(ext.type ?? ext) ?? (typeof ext.name === "string" ? ext.name : undefined);
  }

  /** Every field of a struct/class body in declaration order, with its CType from the annotation or
   *  (for an unannotated `:public` field) inferred from its default value. */
  private memberFieldTypes(node: ast.StructNode | ast.ClassNode): Map<string, CType> {
    const out = new Map<string, CType>();
    const consider = (v: ast.VariableNode): void => {
      const nm = v.name;
      if (nm?._type !== "simple-identifier" && nm?._type !== "composite-identifier") return;
      const ct = this.typeNodeToCType(v.type) ?? this.ctypeFromLiteral(v.value) ?? C_VALUE;
      out.set(ast.symbolName(nm as ast.IdentifierNode), ct);
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

  /** Field name -> its DEFAULT value AST (the initializer on `(let :ctor x <- Real 0.0)` / `(let tag
   *  "rect")`). Same body walk as memberFieldTypes; used to fill fields a construction omits. */
  private memberFieldDefaults(node: ast.StructNode | ast.ClassNode): Map<string, ast.ASTNode> {
    const out = new Map<string, ast.ASTNode>();
    const consider = (v: ast.VariableNode): void => {
      const nm = v.name;
      if ((nm?._type !== "simple-identifier" && nm?._type !== "composite-identifier") || !v.value) return;
      out.set(ast.symbolName(nm as ast.IdentifierNode), v.value);
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

  /** Best-effort CType from a literal default value (an unannotated field's type). */
  private ctypeFromLiteral(v: ast.ASTNode | undefined): CType | undefined {
    switch (v?._type) {
      case "integer-number": return C_INT;
      case "float-number": return C_REAL;
      case "string": return C_STR;
      case "boolean": return C_BOOL;
      default: return undefined;
    }
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
    // The RIGHT operand's DECLARED CType: `fn.params[0]` for a method op (self is implicit), `fn.params[1]`
    // for a free op. A union/`Any` param -> `C_VALUE` (boxed), which the call site must declare so the
    // argument gets boxed to match the emitted signature (gap ledger §20). Binary only.
    const otherParam = unary ? undefined : (isMethod ? fn.params[0] : fn.params[1]);
    const otherCType = unary ? undefined : (this.typeNodeToCType(otherParam?.type) ?? C_VALUE);
    this.operators.set(`${unary ? "u" : ""}${op}:${opType}`, { cName, ret, isMethod, unary, otherCType });
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
    if (this.classes.has(nm)) return { k: "obj", className: this.canonClassName(nm) };
    const prim: Record<string, CType> = {
      Int: C_INT, Real: C_REAL, Boolean: C_BOOL, Bool: C_BOOL, String: C_STR, Char: { k: "char" }, Void: C_VOID,
    };
    if (prim[nm]) return prim[nm];
    // An imported class used as a TYPE annotation (`v <- Vector3`): register its descriptor on demand
    // so the param/field/return stays typed as obj. Checked after primitives so `Int`/`Real`/... never
    // hit the symbol table.
    if (this.ensureClassRegistered(nm, t)) return { k: "obj", className: this.canonClassName(nm) };
    return undefined;
  }

  /**
   * The name a class is DEFINED under, given whatever a program spelled.
   *
   * `this.classes` is keyed by the spelled name, and an aliased import points two keys at one
   * descriptor. Everything the EMITTER writes -- `__ll_class_X`, `__ll_fields_X`, `__ll_methods_X`,
   * `__ll_method_X_m` -- is derived from the definition, so an alias must be resolved here rather
   * than travelling into a CType or a `c-construct` and emitting a reference to `__ll_class_Gadget`
   * that no declaration ever produced.
   */
  private canonClassName(nm: string): string {
    return this.classes.get(nm)?.name ?? nm;
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

  /**
   * THE TWO WALKERS MUST AGREE ABOUT WHERE THE SCOPE ENDS, and they did not.
   *
   * `collectNestedFreeVars` descends GENERICALLY over every non-`_` key, stopping only at a nested
   * `function`. This one used to descend only into `list` blocks -- so it never entered a `for`, a
   * `while`, an `if` or a `try`. A `mut` declared in a `for`'s `:init` was therefore invisible to it,
   * while a closure declared beside that `mut` WAS visible to its sibling. The capture was seen and
   * the binding it captured was not, so the intersection came out empty and no cell was allocated.
   *
   * Measured: a closure over a `mut` in an ordinary function body works and answers 2; the identical
   * closure moved into a `for`'s `:init` does not. That asymmetry is the whole bug -- capture-by-
   * reference is implemented and was simply not reached.
   *
   * The rule both walkers now share: **the cell set is the FUNCTION FRAME's**, so descend everywhere
   * the frame extends and stop at a nested `function`, whose muts are its own scope's problem. That is
   * what `cellVars` already means at every call site -- a function body (3719), a handle clause (1405),
   * or the module body (348).
   */
  private collectMutDecls(node: any, into: Set<string>): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) this.collectMutDecls(c, into); return; }
    if (node._type === "variable" && (node as ast.VariableNode).mutable) {
      const n = (node as ast.VariableNode).name;
      if (n._type === "simple-identifier" || n._type === "composite-identifier") into.add(ast.symbolName(n as ast.IdentifierNode));
    }
    // A nested fn opens its own frame; its muts are ITS scope's problem.
    if (node._type === "function") return;
    for (const k of Object.keys(node)) {
      if (k.startsWith("_")) continue;
      this.collectMutDecls(node[k], into);
    }
  }

  private collectNestedFreeVars(node: any, into: Set<string>): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) this.collectNestedFreeVars(c, into); return; }
    if (node._type === "function") {
      for (const n of freeVariables(node as ast.FunctionNode)) into.add(n);
      return;
    }
    if (node._type === "handle") {
      // D47 (Cr-1b): a handle clause closure-converts like a nested fn -- a mut it references must
      // become a cell (shared ll_value*), or the clause would mutate a dead install-time snapshot.
      const hn = node as ast.HandleNode;
      this.collectNestedFreeVars(hn.body, into);
      for (const c of hn.clauses ?? []) {
        const bound = c.binder ? [(c.binder as any).id ?? ast.symbolName(c.binder as any)] : [];
        for (const n of freeVariablesOfBody(c.body ?? [], bound)) into.add(n);
      }
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
        case "class":
          // A4 step 1: a class/struct declaration in body position. `resolveAstStmt` routes struct/class
          // to `collectClassMembers` and emits nothing (the type is registered in the pre-pass) -- the
          // same no-op the opaque leaf performed. When the class is lowered onto HClass, this consumes
          // the modeled node instead of re-reading `h.src`.
          return this.resolveAstStmt(h.src);

        case "expr-stmt": {
          const expr = this.resolveExpr(h.expr);
          return [{ src: h.src, ctype: C_VOID, kind: "c-expr-stmt", expr }];
        }

        case "decl-temp": {
          // A temp whose value is merely a class NAME (the ANF-hoisted head of `(new C ...)`): a class
          // is not a runtime value in C, so record the name for the `new` and emit no decl.
          const cn = this.classNameOf(h.init);
          if (cn) { this.tempClassName.set(h.name, cn); return []; }
          const t = h.init ? this.resolveExpr(h.init) : null;
          let declCType = t ? t.ctype : this.ctypeOf(h, "decl-temp");
          if (declCType.k === "void") declCType = C_VALUE; // no `void` variable -- see resolveVarDecl
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
          return this.resolveVarDecl(h.src as ast.VariableNode, h.init ? this.resolveExpr(h.init) : null, { name: h.name, mutable: h.mutable, declaredType: h.declaredType, copies: h.copies });

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
          // D31/D58: inside a `:gen`, `return` ENDS THE SEQUENCE. It is valueless by ruling -- a
          // `(return x)` in a generator is LL0223, because its value has no place in the sequence --
          // so the machine parks and answers nil, exactly as falling off the end does. Parking is
          // what stops the next pull from dispatching back to the last suspend and re-running the
          // tail forever.
          if (this.inGenerator) {
            return [
              { src: h.src, ctype: C_VOID, kind: "c-assign", target: { kind: "name", cName: GEN_STATE_NAME, ctype: C_INT }, value: { src: h.src, ctype: C_INT, kind: "c-lit", lit: "int", value: String(GEN_DONE) } },
              { src: h.src, ctype: C_VOID, kind: "c-return", value: { src: h.src, ctype: C_VALUE, kind: "c-nil" } },
            ];
          }
          let value = h.value ? this.resolveExpr(h.value) : null;
          // The copy decision rode the HIR node (A5) -- consume it, no re-derive, no dip.
          if (value) value = this.copyDecided(value, h.src, h.copies);
          return [{ src: h.src, ctype: C_VOID, kind: "c-return", value }];
        }

        case "while":
          return [{
            src: h.src, ctype: C_VOID, kind: "c-while",
            test: this.resolveExpr(h.test),
            body: this.resolveBlock(h.body),
          }];

        case "for": {
          // THE INIT IS RESOLVED FIRST, AND THE ORDER IS LOAD-BEARING.
          //
          // The `:init` DECLARES what the `:cond` and `:step` READ -- the induction variable, and (as
          // `03-loops/02_more_for_loops.lisp` does) any helper closure over it. Resolving the step
          // first asks `resolveIdentifier` for names that do not exist yet: a local falls back to the
          // type channel and lands on C_VALUE while the init later declares `int64_t`, and a FUNCTION
          // is not found at all and refuses as LL0107 (an unresolvable host global) -- which is why
          // that file has been refused rather than compiled.
          //
          // This is also just C's own order: `for (init; test; update)` evaluates init once, before
          // either of the others.
          //
          // IT MUST LAND WITH THE `collectMutDecls` FIX AND NOT BEFORE IT. Reordering alone makes that
          // file resolve its closures and then LOOP FOREVER, because the `mut`s in its `:init` were
          // invisible to the cell analysis and the closures got copies. Measured, and reverted once
          // for exactly that reason (D94-a): a refusal traded for a hang is a worse program.
          const init = this.resolveBlock(h.init);
          const test = h.test ? this.resolveExpr(h.test) : null;
          // The step is a STATEMENT on the node now (an assignment, normally). resolveStmt can yield
          // several; the update slot takes one, and the lowering already guaranteed that shape.
          const updateStmts = h.update ? this.resolveStmt(h.update) : [];
          const update = updateStmts.length === 1 ? updateStmts[0] : null;
          const out: CStmt[] = [{
            src: h.src, ctype: C_VOID, kind: "c-for",
            init,
            test,
            update,
            body: this.resolveBlock(h.body),
            // On the node, not a trailing sibling: `:else` reads the `:init` bindings, which live in
            // the block the loop opened. See the raw-structural path for the same reasoning.
            elseBlock: h.elseBlock ? this.resolveBlock(h.elseBlock) : null,
          }];
          return out;
        }

        case "for-each":
          return this.resolveForEach(h);

        case "closure-decl":
          return this.resolveNestedFnDecl(h.src as ast.FunctionNode, h.closure);

        case "hoist": {
          // The match's pattern variables, declared boxed at the top of its block scope. The name SET
          // (and its order) is decided at lowering now -- this used to recompute it from the raw
          // MatchNode with a walk that quietly disagreed with the JS one about rest bindings.
          const out: CStmt[] = [];
          for (const n of h.names) {
            const cName = mangleC(n);
            this.declareLocal(cName, C_VALUE);
            out.push({ src: h.src, ctype: C_VOID, kind: "c-decl", cName, declCType: C_VALUE, init: null });
          }
          return out;
        }

        case "try":
          return this.resolveTry(h);

        case "restart-case":
          return this.resolveRestartCase(h);
        case "handle":
          return this.resolveHandle(h);

        // D58's state machine (non-core, minted only by LowerCoroutines). The frame reference is
        // filled in by `promoteFrame`, which is the only pass that knows the slot layout -- so a
        // suspend is emitted here as its two halves (park the state, hand out the value) over a
        // placeholder name target, and the promotion rewrites it into a field store like any other.
        case "dispatch":
          return [{ src: h.src, ctype: C_VOID, kind: "c-dispatch", stateSlot: STATE_SLOT, states: h.states }];

        case "resume-point":
          return [{ src: h.src, ctype: C_VOID, kind: "c-label", state: h.state }];

        case "suspend": {
          const value = this.resolveExpr(h.value);
          return [
            { src: h.src, ctype: C_VOID, kind: "c-assign", target: { kind: "name", cName: GEN_STATE_NAME, ctype: C_INT }, value: { src: h.src, ctype: C_INT, kind: "c-lit", lit: "int", value: String(h.state) } },
            { src: h.src, ctype: C_VOID, kind: "c-return", value },
          ];
        }

        case "field-init":
        case "super-call":
        case "ctor-method-call":
          // A4 (dev, JS-side): constructor-body statements built by JSClassBuilder at JS emit time -- they
          // never reach the C backend, which lowers classes through its own class-registration path
          // (resolveConstruct / registerClass), not the shared body lowering. Unreachable here; refuse
          // rather than guess. When the class is lowered to HIR proper, the C emitter consumes these.
          throw this.refuse(h.src, h.kind, "resolveStmt");

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
  private resolveVarDecl(node: ast.VariableNode, init: CExpr | null, modeled?: { name: string | null; mutable: boolean; declaredType: InferredType | undefined; copies: boolean }): CStmt[] {
    // Name / mutability / declared-type: OFF THE HIR NODE when the declaration was modeled (HVarDecl), so
    // no decl-structure / decl-type / mut-narrowed dip below the HIR. The raw path (a var-decl inside a
    // bailed opaque subtree) still reads the VariableNode + symbol table, and records those dips.
    let srcName: string;
    let mutable: boolean;
    let t: InferredType | undefined;
    if (modeled) {
      // A DESTRUCTURING target. `HVarDecl.name` is null for one, because the binding STRUCTURE is not
      // modeled on the HIR -- the JS emitter reads it off the raw VariableNode too, for the same
      // reason. So this reads the pattern from the AST, exactly as that path does.
      if (modeled.name === null) return this.resolveDestructuringDecl(node, init);
      srcName = modeled.name;
      mutable = modeled.mutable;
      t = modeled.declaredType;
    } else {
      const name = this.dipAst("A2", "decl-structure", node, "binding name/mutability read from raw VariableNode", () => node.name);
      if (name._type !== "simple-identifier" && name._type !== "composite-identifier") {
        return this.resolveDestructuringDecl(node, init);
      }
      srcName = ast.symbolName(name);
      mutable = node.mutable;
      // For a MUTABLE binding the symbol table's DECLARED type wins (the channel carries the initializer's
      // narrowing, and a mut can be re-assigned outside it); for a `let`, the channel then the symbols.
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
    }
    if (node.extern) return []; // an ambient host global declaration -- nothing to emit
    const cName = mangleC(srcName);
    let declCType = t !== undefined ? mapType(t) : init ? init.ctype : C_VALUE;
    // There is no `void` VARIABLE. A binding whose declared type is Void holds the bottom value, which
    // is a value like any other (D9 / D49b: a Void expression in value position is nil) -- so it is
    // boxed. Reachable since D49a made `-> Void` functions actually return void: `(let r (noisy 1))`
    // would otherwise emit `void r`, which does not compile.
    if (declCType.k === "void") declCType = C_VALUE;
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
    //
    // EXCEPT when the binding is a module-level one that gets hoisted to a C global: file-scope
    // storage is ALREADY shared with every function, so the cell buys nothing and actively breaks the
    // emission. The global was declared from the cell-widened ctype (a plain `ll_value`) while the
    // module-scope reads kept `cell: true` and emitted `(*u_calls)` -- a deref of a non-pointer, and a
    // file that disagreed with itself about the same name.
    const isModuleGlobal = !this.inFunctionBody && this.globalNames.has(srcName);
    const cell = !isModuleGlobal && this.cellVars.has(cName);
    if (cell) {
      this.ledger.record("A5", "mut-capture-cell", node, "mut binding captured by a closure; boxed into a shared heap cell");
      declCType = C_VALUE;
    }
    // A `let`/`mut` is a store site: a struct initializer is COPIED (D11). The DECISION rode the HIR
    // node (A5) on the modeled path, so consume it -- no re-derive, no dip. The raw path re-derives.
    const storedInit = init
      ? (modeled ? this.copyDecided(init, node, modeled.copies) : this.copyStore(init, node, "let-decl"))
      : null;
    // A module-level binding referenced by a function is a C GLOBAL: declare it once at file scope
    // and emit an ASSIGNMENT here (the global is visible to the functions that close over it).
    if (!this.inFunctionBody && this.globalNames.has(srcName)) {
      if (!this.globalDeclared.has(cName)) {
        this.globalDeclared.add(cName);
        this.globalDecls.push({ cName, ctype: declCType });
      }
      this.declareLocal(cName, declCType, mutable, cell); // still in module scope for local reads
      if (!storedInit) return [];
      return [{ src: node, ctype: C_VOID, kind: "c-assign", target: { kind: "name", cName, ctype: declCType }, value: storedInit }];
    }
    this.declareLocal(cName, declCType, mutable, cell);
    return [{ src: node, ctype: C_VOID, kind: "c-decl", cName, declCType, init: storedInit, cell }];
  }

  /**
   * `(let [a b] pt)` and `(let {:name :city} person)` -- a destructuring declaration on C.
   *
   * The whole lowering is one temporary plus N ordinary bindings that read out of it, which is what
   * the JS backend's native `ArrayPattern`/`ObjectPattern` means anyway. The temporary matters: the
   * initializer is evaluated ONCE, where N separate reads of the initializer expression would
   * re-evaluate it -- and `(let [a b] (next-pair))` must not call `next-pair` twice.
   *
   * The element read is BOUNDS-GUARDED, and that is the subtlety `foreachDestructure` above already
   * paid for: `ll_index_vec` TRAPS out of range, while JS's `let [a, b, c] = [1, 2]` leaves `c`
   * undefined, which D9 makes nil. An unguarded index would turn a short vector from a silent nil on
   * one backend into a process exit on the other -- in a construct whose whole point is that it reads
   * like a pattern match. A map key needs no guard: the dotted read is already total (D9).
   *
   * Nested patterns and `...rest` refuse, matching `foreachDestructure`'s limits rather than
   * inventing different ones for the same shape.
   */
  private resolveDestructuringDecl(node: ast.VariableNode, init: CExpr | null): CStmt[] {
    const target = this.dipAst("A2", "decl-structure", node, "destructuring pattern read from raw VariableNode", () => node.name);
    if (!init) throw this.refuse(node, "destructuring-declaration-without-initializer", "resolveVarDecl");
    this.ledger.record("A2", "destructure-decl", node, "binding structure of a destructuring declaration is not in the HIR");

    const tmp = `__ll_de_${this.tempCounter++}`;
    this.declareLocal(tmp, C_VALUE);
    const out: CStmt[] = [
      { src: node, ctype: C_VOID, kind: "c-decl", cName: tmp, declCType: C_VALUE, init, cell: false },
    ];
    const base: CExpr = { src: node, ctype: C_VALUE, kind: "c-ref", cName: tmp };

    const bind = (cName: string, value: CExpr) => {
      this.declareLocal(cName, C_VALUE);
      out.push({ src: node, ctype: C_VOID, kind: "c-decl", cName, declCType: C_VALUE, init: value, cell: false });
    };

    if (target._type === "vector-pattern") {
      (target as ast.VectorPatternNode).elements.forEach((el, i) => {
        if (el._type !== "identifier-pattern") {
          throw this.refuse(node, `destructuring-element:${el._type}`, "resolveDestructuringDecl");
        }
        const idx: CExpr = { src: node, ctype: C_INT, kind: "c-lit", lit: "int", value: String(i) };
        const len: CExpr = { src: node, ctype: C_INT, kind: "c-member", object: base, fieldName: "length", runtimeFn: "ll_dyn_length" };
        const inRange: CExpr = { src: node, ctype: C_BOOL, kind: "c-binop", op: "<", mode: "int", lhs: idx, rhs: len };
        const read: CExpr = { src: node, ctype: C_VALUE, kind: "c-index", base, index: idx, mode: "boxed", checked: false };
        bind(mangleC(ast.symbolName((el as ast.IdentifierPatternNode).id)), {
          src: node, ctype: C_VALUE, kind: "c-ternary",
          test: inRange, then: read, else: { src: node, ctype: C_VALUE, kind: "c-nil" },
        });
      });
      return out;
    }

    if (target._type === "map-pattern") {
      for (const pair of (target as ast.MapPatternNode).pairs) {
        if (pair.pattern._type !== "identifier-pattern") {
          throw this.refuse(node, `destructuring-element:${pair.pattern._type}`, "resolveDestructuringDecl");
        }
        // `{:name :age}` binds `name` from key "name"; `{:firstName first}` binds `first` from key
        // "firstName". The KEY is the map lookup, the PATTERN is the binding -- they differ only in
        // the renaming form, and the builder already made the shorthand explicit by filling the
        // pattern in from the key.
        bind(mangleC(ast.symbolName((pair.pattern as ast.IdentifierPatternNode).id)),
             this.memberRead(node, base, ast.keyName(pair.key)));
      }
      return out;
    }

    throw this.refuse(node, `destructuring-declaration:${target._type}`, "resolveVarDecl");
  }

  private resolveUserAssign(node: ast.SimpleAssignmentNode | ast.CompoundAssignmentNode, rhs: CExpr): CStmt[] {
    const target = this.dipAst("A2", "assign-target", node, "assignment target read from raw AST (legacy emitAssign seam)", () => node.assignable);
    const lval = this.resolveLValue(node, target);
    return [{ src: node, ctype: C_VOID, kind: "c-assign", target: lval, value: this.copyStore(rhs, node, "user-assign") }];
  }

  /** The D11 copy DECISION at a store site (spec A5). Wraps a struct/boxed value in an explicit copy
   *  node; a native primitive, array or class reference is left alone (CP3 shallow-at-reference). The
   *  copy MATERIALIZATION (deep vs shared) is the runtime's ll_copy dispatching on the tag. */
  /** The copy at a MODELED store site (A5): the DECISION rode the HIR node (`shouldCopyOnStore`), so
   *  consume it -- no re-derivation, no dip. The ctype guard stays (never wrap a non-obj/value; a fresh
   *  construction is already a new value), so the materialization is identical to `copyStore` minus the
   *  independently-synthesised decision -- which is exactly the divergence D48/Q1 removes. */
  private copyDecided(e: CExpr, src: ast.ASTNode, copies: boolean): CExpr {
    if (!copies) return e;
    if (e.ctype.k !== "obj" && e.ctype.k !== "value") return e;
    if (e.kind === "c-construct") return e;
    return { src, ctype: e.ctype, kind: "c-copy", inner: e };
  }

  private copyStore(e: CExpr, src: ast.ASTNode, site: string): CExpr {
    if (e.ctype.k !== "obj" && e.ctype.k !== "value") return e; // int/real/str/vec/map/closure: no copy
    // A fresh construction is already a new value -- no copy needed (matches the JS elision).
    if (e.kind === "c-construct") return e;
    this.ledger.record("A5", `copy:${site}`, src, "explicit CP3 value-copy at a store site (the D11 decision the HIR only flags)");
    return { src, ctype: e.ctype, kind: "c-copy", inner: e };
  }

  /**
   * `'(+ 1 2)` -- CODE AS DATA (D3d), reconstructed as a value the program can walk.
   *
   * The exact twin of `JSTransformerAstVisitor.dataToESTree`, and it has to be: both backends are
   * graded against ONE golden, so a quoted form must print identically on each. The shared contract is
   * three lines long -- an array becomes a vector, an object becomes a map keyed by its own field
   * names MINUS `_location` and `_parent`, and everything else is its literal. Those two keys are
   * dropped because they are compiler bookkeeping (`_parent` is also cyclic, so emitting it would not
   * terminate).
   *
   * D3d's ruling is what makes this worth having: quote used to compile to `JSON.stringify(node)`,
   * which is code-as-TEXT, i.e. code as nothing. The map tree is walkable -- `expr.nodes.nodes` and
   * `(head ...)` work on it -- and it is the representation half of homoiconicity. The RETURN trip
   * (`eval`) is still LL0236, and this does not change that.
   *
   * Nothing new in the emitter: `c-map` and `c-vector` already exist, and `EmitCirToC` already builds
   * exactly this shape for the `__ll_meta` reflection graph (D70).
   */
  private quoteDatum(value: any, at: ast.ASTNode): CExpr {
    if (value === null || value === undefined) {
      return { src: at, ctype: C_VALUE, kind: "c-lit", lit: "nil", value: "nil" };
    }
    if (Array.isArray(value)) {
      return {
        src: at, ctype: { k: "vec", elem: C_VALUE }, kind: "c-vector",
        elements: value.map((v) => this.quoteDatum(v, at)),
      };
    }
    if (typeof value === "object") {
      const entries: CMapEntry[] = Object.keys(value)
        .filter((k) => k !== "_location" && k !== "_parent")
        .map((k) => ({ key: k, value: this.quoteDatum(value[k], at) }));
      return { src: at, ctype: { k: "map" }, kind: "c-map", entries };
    }
    if (typeof value === "boolean") {
      return { src: at, ctype: C_BOOL, kind: "c-lit", lit: "bool", value: value ? "true" : "false" };
    }
    if (typeof value === "number") {
      // An AST literal's `value` is a JS number. Integral ones stay Int so `'(+ 1 2)` reports `1`
      // rather than `1.0` -- D51's Int/Real split, kept through the datum.
      return Number.isInteger(value)
        ? { src: at, ctype: C_INT, kind: "c-lit", lit: "int", value: String(value) }
        : { src: at, ctype: C_REAL, kind: "c-lit", lit: "real", value: String(value) };
    }
    return { src: at, ctype: C_STR, kind: "c-lit", lit: "str", value: String(value) };
  }

  /** Resolve an assignment target to an lvalue: a name, a struct FIELD chain, or an INDEX. */
  private resolveLValue(node: ast.ASTNode, target: ast.ASTNode): CLValue {
    // `x` / `this.x` / `a.b.c` -- an identifier or dotted chain.
    if (target._type === "simple-identifier" || target._type === "composite-identifier") {
      const parts = target._type === "composite-identifier" ? (target as ast.CompositeIdentifierNode).parts : [(target as ast.SimpleIdentifierNode).id];
      if (parts.length === 1) {
        const cName = mangleC(parts[0]);
        const info = this.localInfo(cName);
        // A module global's DECLARED ctype wins over re-inference: a captured-mut global is boxed
        // (ll_value) even though the symbol channel still types it Int, so the lvalue must be boxed
        // too or the store unboxes the RHS into a boxed slot (a cc type error).
        const ctype = info?.ctype ?? this.globalCType(parts[0], cName) ?? this.bindingCType(target as ast.IdentifierNode);
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
      // The indexer's HEAD can itself be a dotted path -- `world.boxes[i] := v`. Split it the way the
      // composite-identifier branch above does (head object, then intermediate field reads); mangling
      // the whole path as ONE identifier produced `u_world_2eboxes`, which no C scope declares.
      const headParts = idx.id._type === "composite-identifier"
        ? (idx.id as ast.CompositeIdentifierNode).parts
        : [ast.symbolName(idx.id as any)];
      let obj = this.headObject(node, headParts[0]);
      for (const mid of headParts.slice(1)) obj = this.memberRead(node, obj, mid);
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
    const ctype = info?.ctype ?? this.globalCType(headName, cName) ?? this.bindingCType({ _type: "simple-identifier", id: headName } as any);
    return { src: node, ctype, kind: "c-ref", cName, cell: info?.cell };
  }

  /** The DECLARED ctype of a module global (undefined if `name` is not a hoisted global). Used at
   *  store/receiver sites, where re-inferring the type can disagree with how the global was declared. */
  private globalCType(name: string, cName: string): CType | undefined {
    if (!this.globalNames.has(name)) return undefined;
    return this.globalDecls.find((d) => d.cName === cName)?.ctype;
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
    // A boxed receiver (an array element `(let c cells[i])`, a closure-captured struct cell, an
    // Unknown slot): the field store cannot be a static slot -- it is a runtime member write by name
    // (ll_member_slot), the store-side analog of A3's boxed member READ. Still an A4 field-store dip:
    // the HIR carries no field-store node in either the typed or the boxed case.
    this.ledger.record("A4", "field-store", node, "struct field store on a boxed receiver -> runtime member write by name (not the HIR)");
    return { kind: "dyn-field", object: obj, fieldName };
  }

  /** HTry -> a setjmp/longjmp handler frame (spec: try/catch is native-pipeline machinery). The
   *  catch filter chain and the error binding are rebuilt here, the same shape the JS emitter makes. */
  private resolveTry(h: Extract<HStmt, { kind: "try" }>): CStmt[] {
    this.ledger.record("A8", "try-catch", h.src, "try/catch lowered to setjmp/longjmp (native-only machinery; JS gets it free)");
    const errVar = mangleC(h.catchVar);
    this.declareLocal(errVar, C_VALUE);
    const catches = (h.catches ?? []).map((c) => {
      let errorCName: string | undefined;
      if (c.errorName) {
        errorCName = mangleC(ast.symbolName(c.errorName as ast.IdentifierNode));
        this.declareLocal(errorCName, C_VALUE);
      }
      return { errorCName, filterTypeName: c.filterTypeName, body: this.resolveBlock(c.body) };
    });
    return [{
      src: h.src, ctype: C_VOID, kind: "c-try",
      tryBlock: this.resolveBlock(h.tryBlock),
      errVar,
      catches,
      finalizer: h.finalizer ? this.resolveBlock(h.finalizer) : null,
    }];
  }

  /** D47 `restart-case`: an LL_RESTART frame (a setjmp pad) offering the arm names; the body runs with it
   *  installed, an `invoke-restart` transfers into the pad and dispatches on `which` to the chosen arm.
   *  The value flows via the pre-declared result temp -- the body + each arm were lowered to the same
   *  assign-dest -- so there is no `resultCName` to plumb. Each arm's params are unpacked from the packed
   *  restart args at the pad (see EmitCirToC). */
  private resolveRestartCase(h: Extract<HStmt, { kind: "restart-case" }>): CStmt[] {
    this.ledger.record("A8", "restart-case", h.src, "restart-case lowered to a native setjmp LL_RESTART frame + ll_unwind (JS refuses -- LL0108)");
    const body = this.resolveBlock(h.body);
    const arms = (h.arms ?? []).map((a) => {
      const paramCNames = (a.params ?? []).map((p) => mangleC(p));
      for (const pc of paramCNames) this.declareLocal(pc, C_VALUE);
      return { name: a.name, paramCNames, body: this.resolveBlock(a.body) };
    });
    return [{ src: h.src, ctype: C_VOID, kind: "c-restart-case", body, arms }];
  }

  /** D47 `invoke-restart`: pack the args into a boxed positional vector (nil for none) and emit the
   *  diverging ll_invoke_restart call. P2 boxes the vector to a value; the target arm unpacks by index. */
  private resolveInvokeRestart(h: Extract<HExpr, { kind: "invoke-restart" }>): CExpr {
    const args = (h.args ?? []).map((a) => this.resolveExpr(a));
    const packedArgs: CExpr = args.length
      ? { src: h.src, ctype: { k: "vec", elem: C_VALUE }, kind: "c-vector", elements: args }
      : { src: h.src, ctype: C_VALUE, kind: "c-nil" };
    return { src: h.src, ctype: C_VOID, kind: "c-invoke-restart", name: h.name, packedArgs };
  }

  /** D47 `handle`: ONE bookkeeping LL_HANDLER frame (no setjmp -- ll_signal walks it in place); each
   *  clause closure-converts to a lifted `(void*, ll_value) -> ll_value` handler (abi:"handler") sharing
   *  ONE union env (the frame has one henv). A clause that RETURNS declines -- a `return` in a clause
   *  body returns from the lifted fn, not the user fn (a non-local exit is spelled invoke-restart).
   *  Clauses close over the scope SURROUNDING the form (captures computed at install, before body locals
   *  exist -- CL bind-time capture). The value flows via the pre-declared result temp (the body was
   *  lowered to an assign-dest); clause bodies are EFFECT. */
  private resolveHandle(h: Extract<HStmt, { kind: "handle" }>): CStmt[] {
    this.ledger.record("A8", "handle", h.src, "handle lowered to a native LL_HANDLER frame + lifted (void*,ll_value) clause handlers; ll_signal walks in place (JS refuses -- LL0108)");
    const node = h.src as ast.HandleNode; // AST clauses are index-parallel to the HIR clauses
    const id = this.liftCounter++;

    // Union captures across ALL clauses (one henv) -- computed BEFORE the body resolves, so body locals
    // (declared into this flat scope by resolveBlock) cannot leak into the env.
    const captures: CCapture[] = [];
    const capType = new Map<string, { ctype: CType; cell: boolean }>();
    (h.clauses ?? []).forEach((clause, i) => {
      const astBody = node.clauses?.[i]?.body ?? [];
      for (const srcName of freeVariablesOfBody(astBody, clause.binder ? [clause.binder] : [])) {
        const cName = mangleC(srcName);
        if (capType.has(cName)) continue;
        const info = this.localInfo(cName);
        if (!info) continue; // a global / top-level fn / intrinsic -- resolved without capture
        // For a cell, capture the POINTER (c-ref with cell:false emits the bare `ll_value*` variable).
        const value: CExpr = { src: h.src, ctype: info.cell ? C_VALUE : info.ctype, kind: "c-ref", cName, cell: false };
        captures.push({ field: cName, ctype: info.cell ? C_VALUE : info.ctype, value, cell: info.cell });
        capType.set(cName, { ctype: info.cell ? C_VALUE : info.ctype, cell: info.cell });
      }
    });
    const envStruct = captures.length ? `__ll_env_hnd${id}` : null;
    if (captures.length) this.ledger.record("A3", "handler-lift", h.src, "handle clauses lifted with a shared captured environment (not in the HIR)");

    const body = this.resolveBlock(h.body);

    // Each clause: resolve its ALREADY-LOWERED HIR body in an ISOLATED scope (binder + the union
    // captures only) and lift it under the handler ABI -- resolveBlock, not resolveFunctionBody (the
    // clause is HIR, not an AST fn).
    const clauses = (h.clauses ?? []).map((clause, i) => {
      const liftedName = `__ll_hnd_${id}_${i}`;
      const savedScopes = this.scopes.slice();
      const savedCells = this.cellVars;
      const savedInFn = this.inFunctionBody;
      (this as any).scopes = [new Map<string, VarInfo>()];
      this.inFunctionBody = true;
      try {
        this.cellVars = this.computeCellVars(node.clauses?.[i]?.body ?? []);
        const params: CParam[] = [];
        if (clause.binder) {
          const bc = mangleC(clause.binder);
          this.declareLocal(bc, C_VALUE);
          params.push({ cName: bc, ctype: C_VALUE });
        }
        // Declare captures in the lifted scope (cells stay cells so reads deref).
        for (const [cName, info] of capType) this.declareLocal(cName, info.ctype, info.cell, info.cell);
        const cbody = this.resolveBlock(clause.body);
        this.lifted.push({
          liftedName,
          envStruct,
          captures: captures.map((c) => ({ field: c.field, ctype: c.ctype, cell: c.cell })),
          params,
          body: cbody,
          abi: "handler",
        });
      } finally {
        (this as any).scopes = savedScopes;
        this.cellVars = savedCells;
        this.inFunctionBody = savedInFn;
      }
      return { condType: clause.condType, handlerFnName: liftedName };
    });

    return [{ src: h.src, ctype: C_VOID, kind: "c-handle", body, envStruct, captures, clauses }];
  }

  /**
   * D58: `for :each` inside a generator becomes an EXPLICIT cursor loop.
   *
   *     let __it = ll_iter(coll); let __e = ll_next(__it)
   *     while (__e != nil) { v = __e; <body>; __e = ll_next(__it) }
   *
   * -- which is, not coincidentally, how `take-while` and `zip` are already written by hand in
   * `std/iter/linq/linq-early.lisp`. The reason is storage, not style. `c-foreach` synthesises its
   * cursor and element as locals OF THE EMITTED C FUNCTION, created inside `EmitCirToC` and therefore
   * invisible to the frame promotion: resuming into such a loop would find the cursor indeterminate
   * and walk a garbage pointer. Written out as real declarations, both become ordinary frame slots
   * with no special case anywhere.
   *
   * Applied to EVERY `for :each` in a generator, not only the ones containing a suspend. Whether a
   * loop can be re-entered is a question about the whole body, and answering it per loop would mean
   * being right about it twice.
   */
  private resolveForEachInGenerator(h: Extract<HStmt, { kind: "for-each" }>): CStmt[] {
    const node = h.src as ast.ForEachNode;
    const variable = node.variable;
    if (variable._type !== "simple-identifier" && variable._type !== "composite-identifier") {
      throw this.refuse(node, "foreach-destructuring-in-generator", "resolveForEachInGenerator");
    }
    if (h.elseBlock) throw this.refuse(node, "foreach-else-in-generator", "resolveForEachInGenerator");
    const collection = this.resolveExpr(h.collection);
    const itName = `__ll_it_${this.tempCounter++}`;
    const elName = `__ll_el_${this.tempCounter++}`;
    const varCName = mangleC(ast.symbolName(variable as ast.IdentifierNode));
    this.declareLocal(itName, C_VALUE);
    this.declareLocal(elName, C_VALUE);
    this.declareLocal(varCName, C_VALUE);
    const ref = (cName: string): CExpr => ({ src: node, ctype: C_VALUE, kind: "c-ref", cName });
    const call = (runtimeFn: string, arg: CExpr): CExpr => ({
      src: node, ctype: C_VALUE, kind: "c-call",
      callee: { kind: "intrinsic", runtimeFn, variadic: false, params: [C_VALUE], ret: C_VALUE },
      args: [arg],
    });
    const decl = (cName: string, init: CExpr): CStmt =>
      ({ src: node, ctype: C_VOID, kind: "c-decl", cName, declCType: C_VALUE, init });
    const store = (cName: string, value: CExpr): CStmt =>
      ({ src: node, ctype: C_VOID, kind: "c-assign", target: { kind: "name", cName, ctype: C_VALUE }, value });
    this.ledger.record("A3", "generator-foreach", node, "for :each inside a :gen lowered to an explicit cursor loop (its cursor must be a frame slot)");
    const test: CExpr = {
      src: node, ctype: C_BOOL, kind: "c-binop", op: "!=", mode: "eq-deep",
      lhs: ref(elName), rhs: { src: node, ctype: C_VALUE, kind: "c-nil" },
    };
    // D11: the per-iteration copy the emitter's own for-each arm applies, kept explicit here.
    const bind = store(varCName, { src: node, ctype: C_VALUE, kind: "c-copy", inner: ref(elName) });
    const body = this.resolveBlock(h.body);
    return [
      decl(itName, call("ll_iter", collection)),
      decl(elName, call("ll_next", ref(itName))),
      { src: node, ctype: C_VOID, kind: "c-decl", cName: varCName, declCType: C_VALUE, init: null },
      {
        src: node, ctype: C_VOID, kind: "c-while", test,
        body: { stmts: [bind, ...body.stmts, store(elName, call("ll_next", ref(itName)))] },
      },
    ];
  }

  private resolveForEach(h: Extract<HStmt, { kind: "for-each" }>): CStmt[] {
    if (this.inGenerator) return this.resolveForEachInGenerator(h);
    const node = h.src as ast.ForEachNode;
    const variable = this.dipAst("A2", "foreach-variable", node, "loop binding read from raw ForEachNode (legacy emitForEach seam)", () => node.variable);
    // D16: the loop variable may be a PATTERN. A vector pattern is the only shape the corpus uses
    // (`[key val]` over map entries, `[i e]` over `enumerate`, `[up down]` over `zip`), and it is the
    // only one lowered here; a MAP pattern still refuses, under its own name so the ledger can tell
    // the two apart rather than reporting a closed gap as open.
    const pattern = variable._type === "vector-pattern" ? (variable as ast.VectorPatternNode) : null;
    if (!pattern && variable._type !== "simple-identifier" && variable._type !== "composite-identifier") {
      throw this.refuse(node, `foreach-destructuring:${variable._type}`, "resolveForEach");
    }
    const collection = this.resolveExpr(h.collection);
    // WHICH LOWERING. A statically-known vector keeps the direct index loop -- no allocation, and it
    // is what the whole corpus iterates. Everything ELSE goes through D30's protocol: a string, a map,
    // a user `Iterable`, or a boxed value whose shape is only known at run time.
    //
    // There used to be no second arm. `varCType` was set here for str and obj, and the emitter then
    // wrote `ll_vec*` over the collection unconditionally -- so `for :each` over a String crashed with
    // `no cast str -> vec` and over a hand-written Iterable with `no cast obj -> vec`, both uncaught
    // exceptions rather than diagnostics. An `Iterable<T>`-typed PARAMETER was worse: it boxed, and
    // `ll_unbox_vec` trapped at run time on anything that was not an array. D29's ruling warned about
    // exactly this -- "`for :each` was hardcoded to emit `for...of`, with no protocol behind it" --
    // and the C backend had reproduced it.
    const viaProtocol = collection.ctype.k !== "vec";
    // A destructuring loop OPENS each element, so the element itself is a container held boxed --
    // whatever the collection's static element type says. Both readers below (`ll_dyn_length` and
    // `ll_index_dyn`) take an `ll_value`, and forcing the type here is what keeps a `vec<vec<...>>`
    // collection from handing them an already-unboxed `ll_vec*`.
    let varCType: CType = C_VALUE;
    if (pattern) this.ledger.record("A2", "foreach-destructure", node, "loop-variable pattern bound by element reads (the binding structure is not in the HIR)");
    else if (collection.ctype.k === "vec") varCType = collection.ctype.elem;
    else if (collection.ctype.k === "str") varCType = C_STR;
    else this.ledger.record("A1", "foreach-elem", node, "collection element type unknown; boxed");
    if (viaProtocol) {
      this.ledger.record("A3", "foreach-protocol", node, "non-vector collection iterated through D30's iter/next protocol");
    }
    // D11: each iteration value is copied (shallow). The HIR does not say so -- the legacy
    // emitForEach seam does (A5).
    this.ledger.record("A5", "foreach-copy", node, "per-iteration element copy decided below the HIR");
    const cName = pattern
      ? `__ll_de_${this.tempCounter++}`
      : mangleC(ast.symbolName(variable as ast.IdentifierNode));
    this.declareLocal(cName, varCType);
    const destructure = pattern ? this.foreachDestructure(pattern, cName, node) : undefined;
    return [{
      src: node, ctype: C_VOID, kind: "c-foreach",
      varCName: cName, varCType, collection, viaProtocol, destructure,
      body: this.resolveBlock(h.body),
      elseBlock: h.elseBlock ? this.resolveBlock(h.elseBlock) : null,
    }];
  }

  /**
   * D16 `(for :each [a b] :from ...)` -- bind each pattern name to one element slot.
   *
   * The read is BOUNDS-GUARDED (`i < len ? elem[i] : nil`) rather than a bare index, and that is the
   * whole subtlety. `ll_index_vec` TRAPS out of range ("RangeError: vector index out of bounds"),
   * while JS's `let [a, b, c] = [1, 2]` leaves `c` undefined -- which D9 makes nil. An unguarded
   * index would turn a short element from a silent nil on one backend into a process exit on the
   * other, in a construct whose whole point is that it reads like a pattern match. The guard is a
   * `c-ternary` over a `c-ref`, so it needs no new runtime function and re-evaluates nothing: the
   * base is the element temp, which is pure.
   *
   * Nested patterns and `...rest` refuse. `match`'s `vectorPattern` supports both, but it gets to
   * lean on a preceding length TEST that a `for :each` has no place to put; rather than half-support
   * them here, they name themselves in the ledger.
   */
  private foreachDestructure(
    pattern: ast.VectorPatternNode,
    elemCName: string,
    node: ast.ASTNode
  ): { cName: string; ctype: CType; value: CExpr }[] {
    return pattern.elements.map((el, i) => {
      // A vector pattern's elements are PATTERNS, so a plain name arrives wrapped as an
      // `identifier-pattern`. Anything else -- a nested pattern, a `...rest`, a constant -- refuses.
      if (el._type !== "identifier-pattern") {
        throw this.refuse(node, `foreach-destructuring-element:${el._type}`, "foreachDestructure");
      }
      const base: CExpr = { src: node, ctype: C_VALUE, kind: "c-ref", cName: elemCName };
      const idx: CExpr = { src: node, ctype: C_INT, kind: "c-lit", lit: "int", value: String(i) };
      const len: CExpr = { src: node, ctype: C_INT, kind: "c-member", object: base, fieldName: "length", runtimeFn: "ll_dyn_length" };
      const inRange: CExpr = { src: node, ctype: C_BOOL, kind: "c-binop", op: "<", mode: "int", lhs: idx, rhs: len };
      const read: CExpr = { src: node, ctype: C_VALUE, kind: "c-index", base, index: idx, mode: "boxed", checked: false };
      const value: CExpr = {
        src: node, ctype: C_VALUE, kind: "c-ternary",
        test: inRange, then: read, else: { src: node, ctype: C_VALUE, kind: "c-nil" },
      };
      const cName = mangleC(ast.symbolName(el.id));
      this.declareLocal(cName, C_VALUE);
      return { cName, ctype: C_VALUE, value };
    });
  }

  // -- expressions ----------------------------------------------------------------------------------

  private resolveExpr(h: HExpr): CExpr {
    switch (h.kind) {
      case "opaque-expr":
        return this.resolveAstExpr(h.src);

      case "closure":
        // The capture set, each capture's MODE, and the signature are decided at lowering now; this
        // only materializes them (env struct + the boxed argv ABI).
        return this.lift(h.src as ast.FunctionNode, h);

      case "function-ref":
        // A top-level function used as a VALUE -> a boxed-convention adapter. The decision that this
        // name denotes a function rode the node, so no symbol-table dip here.
        return this.functionValue(h.src, h.name);

      case "literal":
        // Step 3 (HLiteral) landed on dev: the atom is MODELED -- its value and type ride the node
        // itself, so no dip below the HIR (the A2/A1 drain the probe was measuring). No ledger entry.
        return this.resolveHLiteral(h);

      case "ref":
        // Step 3 (HRef) landed on dev: a reference ATOM is MODELED -- its source name rides the node,
        // so the read is no longer an opaque leaf and records NO A2 atom-ref dip (the drain the probe
        // measured). The binding RESOLUTION (local/global/fn/enum) still runs, and the type still
        // falls to the channel/symbols where dev has not yet moved full resolution onto the node.
        return this.resolveIdentifier(h.src as ast.IdentifierNode, true);

      case "free-call":
        return this.resolveFreeCall(h);

      case "ext-call": {
        // A3: CONSUME HExtCall -- INCLUDING its `fnName`, which is the whole point of the node.
        //
        // This used to route through the generic method dispatch on the theory that "the extension
        // dispatch already lives inside the method resolver". It does, but only for receivers with a
        // CONCRETE C type; a boxed one fell through to `ll_dyn_method`, which searches a method table
        // that by construction never holds a free function, and trapped. So the node's own resolved
        // answer was being recomputed by a weaker rule and then lost.
        //
        // Now it is used directly, exactly as the JS emitter uses it (`extFn(recv, ...args)`). The
        // receiver comes from the head's first part; anything that shape does not cover falls back to
        // the method dispatch, which still handles the primitive-extension and user-method cases.
        const ext = this.extCallDirect(h);
        return ext ?? this.resolveMethodCall(h);
      }

      case "method-call":
      case "virtual-call":
        // A3: CONSUME the HIR's method classification. HMethodCall (typed receiver, devirt-able) and
        // HVirtualCall (untyped receiver, dynamic) both dispatch to the method resolver, which branches on
        // the RESOLVED receiver type (obj -> resolveObjMethod devirt; str/vec/dyn -> native / ll_dyn_method).
        // So the C backend no longer re-classifies the call through resolveCall (the A3:call-dispatch dip);
        // it routes straight to the same resolver resolveCall would, byte-identically, minus that record.
        return this.resolveMethodCall(h);

      case "construct": {
        // A4: CONSUME HConstruct -- the callee names the class, and `h.args` are the already-lowered
        // constructor operands. With the field LAYOUT off HClass (registerClass) and the ARGS off the HIR
        // node, construction no longer dips to the raw AST (only an omitted arg's default still does).
        // A callee that is not a plain class ref (a computed / imported-but-unresolvable head) falls back
        // to the raw-AST path, which registers the class on demand and re-derives from `h.src`.
        const className = this.classNameOf(h.callee);
        if (className && this.ensureClassRegistered(className, h.src)) {
          return this.buildConstruct(h.src, className, h.args.map((a) => this.resolveExpr(a)), true);
        }
        return this.resolveAstExpr(h.src);
      }

      case "operator":
        // A3: CONSUME HOperator. `(op a b)` dispatches straight to the operator resolver (native machine op
        // when operand types are known, struct-overload devirt, string contagion) instead of being
        // re-classified through resolveCall -- closing that share of the A3:call-dispatch dip, byte-identical.
        return this.resolveOperator(h);

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
        // A SPREAD element (`[a ...xs]`) arrives as an opaque expr wrapping the SpreadNode, because
        // the HIR lowers it through the legacy path -- so it is recognised by its source node and
        // resolved as its INNER expression. Not copied: `...xs` contributes xs's ELEMENTS, and each
        // one was already stored when xs was built.
        const spread = h.elements.map((e) => this.spreadInner(e) !== undefined);
        const elements = h.elements.map((e, i) => {
          const inner = this.spreadInner(e);
          if (inner !== undefined) return this.resolveAstExpr(inner);
          return this.copyStore(this.resolveExpr(e), h.src, "collection-elem");
        });
        if (spread.some(Boolean)) {
          this.ledger.record("A2", "vector-spread", h.src, "spread element read from the raw SpreadNode (the HIR lowers it opaquely)");
          return { src: h.src, ctype: { k: "vec", elem: C_VALUE }, kind: "c-vector", elements, spread };
        }
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

      case "member-read":
        // A3: a modeled field READ `(obj.field)`. classifyCall already decided this is a 2-part field on a
        // `composite-identifier` receiver and left that callee on `head`; consume it STRAIGHT through
        // resolveDottedCall -- the exact resolver dispatchMemberCall reaches for a dotted head -- instead of
        // re-running classifyList on the raw list. Provably byte-identical (a member-read head is always a
        // composite-identifier, and its 0 args are dead against the empty argVals), minus the double
        // classification (classifyCall HIR-side vs classifyList C-side) -- the Q5 drain.
        return this.resolveDottedCall(h.src as ast.ListNode, h.head as ast.CompositeIdentifierNode, [], []);

      case "formatted-string": {
        // A2: consume the modeled segments -- an interpolation rides its HExpr (resolveExpr), so neither
        // the segments nor their nested reads/calls re-walk the raw AST. Byte-identical c-interp.
        const parts: (string | CExpr)[] = h.segments.map((seg) => ("str" in seg ? seg.str : this.resolveExpr(seg.expr)));
        return { src: h.src, ctype: C_STR, kind: "c-interp", parts };
      }

      case "member":
        throw this.refuse(h.src, "hir-member(pipeline)", "resolveExpr");

      case "index":
        return this.resolveIndexChain(h);

      case "match-test":
        return this.resolvePatternTest(h);

      case "invoke-restart":
        return this.resolveInvokeRestart(h);
      case "signal":
        // D47 `signal`: nil-on-all-decline / DIVERGES-on-transfer -- ll_signal's in-place LL_HANDLER
        // walk. No ledger record (mirrors invoke-restart; the A8 record lives on the installing form).
        return { src: h.src, ctype: C_VALUE, kind: "c-signal", condition: this.resolveExpr(h.condition) };

      case "yield":
        // A8, until G4 lands the state-machine pass that CONSUMES this node. Defensive only:
        // `refuseCoroutine` now gates EVERY path that resolves a `:gen` body -- collectFunction,
        // collectMethod, the on-demand imported body, and (since G2) `lift` for a nested one -- so the
        // honest LL0105 always fires at the function first. Kept because the exhaustiveness check
        // requires an arm, and a silent fallthrough here would be worse than a loud one.
        throw this.refuse(h.src, "yield", "resolveExpr");

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
        // A `.name` step: a native-member READ (D1 read form). The name arrives as a modeled HLiteral
        // (Step 3) or, for the not-yet-drained kinds, still an opaque identifier/string leaf.
        const nameNode = step.index;
        const name = nameNode.kind === "literal"
          ? String(nameNode.value)
          : nameNode.kind === "opaque-expr" && (nameNode.src as any).id !== undefined
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

  /**
   * If this HIR expression is a SPREAD, the expression being spread; otherwise undefined.
   *
   * `...xs` has no HIR node of its own -- `lowerVector` and the call lowering send it through the
   * legacy path, so it arrives as an opaque expr whose `src` is the SpreadNode. Recognising it by
   * source is therefore the only handle there is, and it is the same handle the JS emitter uses.
   */
  /**
   * `(console.log ...xs)` -- a spread argument to an INTRINSIC callee. Answers undefined when there is
   * no spread, so a caller can fall through to its ordinary path.
   *
   * The third and last call shape spread had to learn. The free-call path (`(f ...xs)`) got it in the
   * D75 round and the vector literal (`[0 ...xs]`) with it, but an INTRINSIC callee reaches neither:
   * its arguments are mapped through `resolveAstExpr`, which has no arm for a spread node. So the
   * refusal named `spread` and pointed at the ARGUMENT, giving no hint that the callee was the reason
   * -- which is why this outlived the round that fixed the other two.
   *
   * Shared by both intrinsic call sites deliberately. They resolve the same construct through
   * different routes (a dotted head, a simple one), and a rule about how spread lowers should not
   * depend on which spelling got there.
   *
   * Only a VARIADIC intrinsic can take one: a fixed-arity one (`Math.pow`) has a declared parameter
   * list that a run-time-length argument list cannot satisfy, so that stays a refusal rather than
   * silently truncating.
   */
  private intrinsicSpreadCall(
    node: ast.ListNode,
    name: string,
    intrinsic: { runtimeFn: string; params: CType[]; ret: CType; variadic: boolean },
    args: ast.ASTNode[]
  ): CExpr | undefined {
    const spread = args.map((a) => a?._type === "spread");
    if (!spread.some(Boolean)) return undefined;
    if (!intrinsic.variadic) throw this.refuse(node, `spread-into-fixed-arity:${name}`, "intrinsicSpreadCall");
    const parts = args.map((a, i) =>
      spread[i] ? this.resolveAstExpr((a as ast.SpreadNode).expression) : this.resolveAstExpr(a)
    );
    this.ledger.record("A3", "spread-intrinsic", node, `'${name}' called with a spread -- argument list built at run time`);
    return { src: node, ctype: intrinsic.ret, kind: "c-call", callee: { kind: "intrinsic", ...intrinsic }, args: parts, spread };
  }

  private spreadInner(h: HExpr): ast.ASTNode | undefined {
    const src: any = (h as any).src;
    return src?._type === "spread" ? (src as ast.SpreadNode).expression : undefined;
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
      const ext = this.tryExtensionCall(src, object, fieldName, []);
      if (ext) return ext;
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
    if (!field) {
      // A zero-arg `:extension` on a primitive receiver used as a dotted-call value `(s.titlecase)`.
      const ext = this.tryExtensionCall(src, object, fieldName, []);
      if (ext) return ext;
      throw this.refuse(src, `member-read:${fieldName}`, "memberRead");
    }
    return { src, ctype: field.ret, kind: "c-member", object, fieldName, runtimeFn: field.runtimeFn };
  }

  private indexRead(src: ast.ASTNode, base: CExpr, index: CExpr, checked: boolean): CExpr {
    const mode = base.ctype.k === "vec" ? "vec" : base.ctype.k === "map" ? "map" : base.ctype.k === "str" ? "str" : "boxed";
    const elem: CType =
      base.ctype.k === "vec" ? base.ctype.elem : base.ctype.k === "str" ? C_STR : C_VALUE;
    if (mode === "boxed") this.ledger.record("A1", "index-boxed-base", src, "index base has no static container type");
    return { src, ctype: elem, kind: "c-index", base, index, mode, checked };
  }

  private resolvePatternTest(h: Extract<HExpr, { kind: "match-test" }>): CExpr {
    // The test SHAPE is modeled on the HIR (A7): which tests, in what order, what binds. What is left
    // here is purely mechanical -- how C reaches a sub-value and spells each primitive test.
    const pattern = h.pattern;
    const scrut: CExpr = {
      src: h.src,
      ctype: this.localCType(h.scrutName) ?? C_VALUE,
      kind: "c-temp",
      name: h.scrutName,
    };
    // Pattern tests operate on a BOXED scrutinee (type test, dynamic length/index all take ll_value).
    let test = this.patternCondition(pattern, this.boxed(scrut), h.src);
    if (h.guard) {
      test = {
        src: h.src, ctype: C_BOOL, kind: "c-binop", op: "&&", mode: "bool",
        lhs: test, rhs: this.resolveExpr(h.guard),
      };
    }
    return test;
  }

  private readonly TRUE = (src: ast.ASTNode): CExpr => ({ src, ctype: C_BOOL, kind: "c-lit", lit: "bool", value: "true" });

  /** Explicitly box a value (a P1-inserted c-box that P2 passes through). Identity if already boxed. */
  private boxed(e: CExpr): CExpr {
    if (e.ctype.k === "value") return e;
    return { src: e.src, ctype: C_VALUE, kind: "c-box", inner: e, from: e.ctype };
  }

  /**
   * A modeled pattern (A7) -> the C boolean that tests it and binds as it goes.
   *
   * The DECISIONS are already made on the node; this spells them in C: `ll_deep_eq` for an equality,
   * `ll_is_type` for a container/type check, `ll_index_dyn` / `ll_get` to reach a sub-value. Order is
   * the node's order -- bind-then-test, left to right -- and a trivially-true conjunct is kept, since
   * dropping it would change the emitted C for no gain.
   */
  private patternCondition(p: HPattern, scrut: CExpr, src: ast.ASTNode): CExpr {
    switch (p.kind) {
      case "any":
        return this.TRUE(src);

      case "equals": {
        const lit = this.resolveExpr(p.value);
        return { src, ctype: C_BOOL, kind: "c-binop", op: "==", mode: "eq-deep", lhs: scrut, rhs: lit };
      }

      case "enum-equals": {
        // The test-vs-bind decision came from the HIR; the member's constant is still folded here,
        // where the enum table lives (A4 -- the HIR keeps no enum node).
        const entry = this.lookupEnumMember(p.member);
        const lit = entry ? this.enumValueExpr(entry, src) : this.resolveAstExpr({ _type: "simple-identifier", id: p.member } as any);
        return { src, ctype: C_BOOL, kind: "c-binop", op: "==", mode: "eq-deep", lhs: scrut, rhs: lit };
      }

      case "bind":
        return this.bindThen(mangleC(p.name), scrut, this.TRUE(src), src);

      case "typed": {
        const info = this.typeTestName(p.type) ?? { name: "?", primitive: false };
        const test: CExpr = { src, ctype: C_BOOL, kind: "c-type-test", operand: scrut, typeName: info.name, primitive: info.primitive };
        return this.bindThen(mangleC(p.name), scrut, test, src);
      }

      case "vector":
        return this.vectorPattern(p, scrut, src);

      case "map":
        return this.mapPattern(p, scrut, src);

      case "unsupported":
        throw this.refuse(src, `pattern:${p.what}`, "patternCondition");
    }
  }

  /** `(cName = value, test)` -- a bind sequenced before a boolean test (the A7 comma fusion). */
  private bindThen(cName: string, value: CExpr, test: CExpr, src: ast.ASTNode): CExpr {
    const bind: CExpr = { src, ctype: value.ctype, kind: "c-bind", cName, value };
    return { src, ctype: C_BOOL, kind: "c-seq", exprs: [bind, test] };
  }

  /** `[p0 p1 ...rest]` -- is-array && length (a floor with a rest, exact without) && each element,
   *  then the rest binding, which is a binding rather than a test. */
  private vectorPattern(p: Extract<HPattern, { kind: "vector" }>, scrut: CExpr, src: ast.ASTNode): CExpr {
    let test: CExpr = { src, ctype: C_BOOL, kind: "c-type-test", operand: scrut, typeName: "Array", primitive: false };
    const lenExpr: CExpr = { src, ctype: C_INT, kind: "c-member", object: scrut, fieldName: "length", runtimeFn: "ll_dyn_length" };
    const lenLit: CExpr = { src, ctype: C_INT, kind: "c-lit", lit: "int", value: String(p.elements.length) };
    test = this.and(test, { src, ctype: C_BOOL, kind: "c-binop", op: p.rest ? ">=" : "==", mode: "int", lhs: lenExpr, rhs: lenLit }, src);
    p.elements.forEach((el, i) => {
      // The length check already guaranteed the index is in range.
      const idx: CExpr = { src, ctype: C_INT, kind: "c-lit", lit: "int", value: String(i) };
      const elem: CExpr = { src, ctype: C_VALUE, kind: "c-index", base: scrut, index: idx, mode: "boxed", checked: false };
      test = this.and(test, this.patternCondition(el, elem, src), src);
    });
    if (p.rest) {
      // The tail slice. C had no binding here at all -- the name was declared and left nil -- because
      // its bound-name walk read a field the rest node does not have. Modeled, both backends bind it.
      const VEC_VALUE: CType = { k: "vec", elem: C_VALUE };
      const from: CExpr = { src, ctype: C_INT, kind: "c-lit", lit: "int", value: String(p.elements.length) };
      // `LL_END` is the runtime's "end omitted" sentinel, the same one `xs.slice(n)` lowers to. P2
      // unboxes the scrutinee into the vec param and boxes the result back for the binding.
      const end: CExpr = { src, ctype: C_INT, kind: "c-lit", lit: "int", value: "LL_END" };
      const slice: CExpr = {
        src, ctype: VEC_VALUE, kind: "c-call",
        callee: { kind: "intrinsic", runtimeFn: "ll_vec_slice", variadic: false, params: [VEC_VALUE, C_INT, C_INT], ret: VEC_VALUE },
        args: [scrut, from, end],
      };
      test = this.and(test, this.bindThen(mangleC(p.rest.name), slice, this.TRUE(src), src), src);
    }
    return test;
  }

  /** `{:k pat ...}` -- is-map && each key's value matches its sub-pattern (total lookup, no trap). */
  private mapPattern(p: Extract<HPattern, { kind: "map" }>, scrut: CExpr, src: ast.ASTNode): CExpr {
    let test: CExpr = { src, ctype: C_BOOL, kind: "c-type-test", operand: scrut, typeName: "Map", primitive: false };
    for (const en of p.entries) {
      const keyLit: CExpr = { src, ctype: C_STR, kind: "c-lit", lit: "str", value: en.key };
      // Total map access (`ll_get`): an absent key is nil, not a trap.
      const val: CExpr = { src, ctype: C_VALUE, kind: "c-call", callee: { kind: "intrinsic", runtimeFn: "ll_get", variadic: false, params: [C_VALUE, C_VALUE], ret: C_VALUE }, args: [scrut, keyLit] };
      test = this.and(test, this.patternCondition(en.pattern, val, src), src);
    }
    return test;
  }

  private and(a: CExpr, b: CExpr, src: ast.ASTNode): CExpr {
    return { src, ctype: C_BOOL, kind: "c-binop", op: "&&", mode: "bool", lhs: a, rhs: b };
  }

  // -- raw-AST resolution (the opaque-leaf half; every entry point is a dip) ------------------------

  private resolveAstStmt(node: ast.ASTNode): CStmt[] {
    switch (node._type) {
      case "import":
        this.ledger.record("A9-extern", "import", node, "module import skipped (v0 intrinsics stand in for the stdlib)");
        return [];
      // An EXPORT emits nothing, for the same reason an import does: it is a symbol-table fact, and
      // the passes that consume it (`BuildSymbolTableAstVisitor`, `InlineImportsAstVisitor`) have long
      // since run. There is no C to generate for "this name is visible outside the module".
      //
      // Its absence here was not a decision, it was a HOLE: `resolveAstStmt`'s `default` arm treats an
      // unrecognised node as "an expression evaluated for effect" and hands it to `resolveAstExpr`,
      // which has no arm for it either -- so a module ending in `(export …)` refused with
      // `ELL0106 Cannot generate C for 'export'`. That was SIX of the C backend's eleven refusals
      // (`15-modules/00_lib`, `01_lib_a/b/c`, `18-error-handling/20_imported_error_lib` and
      // `21_imported_error_tower_lib`), each carrying a golden it never reached, and every one of them
      // a module whose only sin was declaring what it exports.
      //
      // Not ledger-recorded, unlike `import`. A skipped import is a real gap being tracked -- the v0
      // intrinsics stand in for the stdlib and one day will not. A skipped export is complete: there
      // is nothing further to emit, now or later.
      case "export":
        return [];
      case "type-def":
      case "interface":
      case "modifier-def":
      case "attribute-def":
      case "macro-def":
      case "enum":
        return []; // compile-time / erased declarations (interfaces are erased per D24; enums are constants; an attribute is metadata, D72)
      case "struct":
      case "class":
        this.collectClassMembers(node as ast.StructNode | ast.ClassNode);
        return [];
      case "function": {
        const f = node as ast.FunctionNode;
        // Declaration or closure VALUE -- decided structurally at lowering and consumed here, so the
        // two backends cannot disagree. Asking `inFunctionBody` instead was wrong for a `fn` inside a
        // `for :init` at module level: not "in a function", yet plainly not a top-level declaration.
        const isDecl = this.hir.isDeclarationFn(f) || (!this.inFunctionBody && !this.hir.bodyFor(f));
        if (isDecl) { this.collectFunction(f); return []; }
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
        // `:else` rides the node instead of trailing it as a sibling block: it runs after the loop but
        // is still inside the `:init` scope, and `(for :init (mut sum 0) ... :else (log sum))` is the
        // normal way to use it. Emitted as a sibling it landed outside the braces holding `sum`.
        return [{
          src: node, ctype: C_VOID, kind: "c-for",
          init: n.initial ? { stmts: this.resolveAstStmt(n.initial) } : { stmts: [] },
          test: n.condition ? this.resolveAstExpr(n.condition) : null,
          update: n.step ? this.singleStmt(this.resolveAstStmt(n.step), n.step) : null,
          body: this.resolveAstBlock(n.then),
          elseBlock: n.else ? this.resolveAstBlock(n.else) : null,
        }];
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
      case "integer-number": {
        // The RAW lexed text, for the same reason as resolveHLiteral: `value` is a JS f64 and has
        // already rounded anything past 2^53. This is the raw-AST twin of that site -- one was fixed
        // and the other was not, which is exactly how a precision bug survives a fix.
        const n = node as ast.IntegerNumberNode;
        const raw = n.match;
        const exact = raw !== undefined && /^[+-]?\d+$/.test(raw.trim()) ? raw.trim() : String(n.value);
        return { src: node, ctype: C_INT, kind: "c-lit", lit: "int", value: exact };
      }
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
      case "quote":
        // `'(+ 1 2)` -- CODE AS DATA (D3d). The operand is never evaluated; it is reconstructed as a
        // walkable value. See `quoteDatum`.
        return this.quoteDatum((node as ast.QuoteNode).nodes, node);
      default:
        throw this.refuse(node, node._type, "resolveAstExpr");
    }
  }

  /**
   * An `HExtCall` emitted as the free call its `fnName` already names: `extFn(receiver, ...args)`.
   *
   * `undefined` when the receiver is not a plain 2-part `obj.method` head (the only shape
   * `classifyCall` mints an ext-call for) or the function cannot be resolved here -- the caller then
   * falls back to the generic method dispatch rather than guessing.
   */
  private extCallDirect(h: Extract<HExpr, { kind: "ext-call" }>): CExpr | undefined {
    const head = h.head;
    if (head._type !== "composite-identifier") return undefined;
    const parts = (head as ast.CompositeIdentifierNode).parts;
    if (parts.length !== 2 || !parts[0]) return undefined;
    const target = this.ensureFreeFn(h.fnName, h.src);
    if (!target) return undefined;
    const recv = this.headObject(h.src, parts[0]);
    if (!recv) return undefined;
    this.ledger.record("A3", "extension-devirt-node", h.src, `'${parts[1]}' devirtualized to ':extension' ${h.fnName} off the HIR node`);
    return {
      src: h.src, ctype: target.sig.ret, kind: "c-call",
      callee: { kind: "free", cName: target.cName, params: target.sig.params, ret: target.sig.ret },
      args: [recv, ...h.args.map((a) => this.resolveExpr(a))],
    };
  }

  /**
   * `(recv.member args)` on a BOXED receiver -> the conforming `:extension`, as a free call.
   *
   * The dispatch DECISION comes from the shared resolver (`hir/extensionResolution`) -- the same
   * `buildExtensionTable`/`conformingExtensionFn` pair the JS side and `classifyCall` use, so the two
   * backends cannot disagree about which extension conforms. What is per-backend is only the
   * materialization: JS emits `extFn(recv, ...args)`, and so does this, as a typed C call.
   *
   * Keyed on the receiver's INFERRED TYPE rather than its name, which is what makes it work for a
   * chained receiver (`((seq xs).filter p)`) as well as a bound one (`(s.filter p)`). Those parse to
   * different list shapes -- `classifyCall` models the second and leaves the first opaque -- but both
   * arrive here with a resolved receiver expression, and `recv.src` is the node whose type answers.
   */
  private dynExtensionCall(node: ast.ASTNode, recv: CExpr, method: string, cArgs: CExpr[], recvName?: string): CExpr | undefined {
    // The receiver's static type, from whichever channel actually describes IT. A chained receiver is
    // an expression and the type channel has its node; a BOUND one arrives as a `c-ref` whose `src`
    // is the enclosing `obj.method` node, so the channel there would answer about the call. For that
    // shape the caller passes the source name and the symbol table answers -- the same `receiverType`
    // lookup `classifyCall` performs.
    const typeInfo = (recvName !== undefined ? receiverType(this.context as any, recvName, node) : undefined)
      ?? this.context.nodeTypes?.get(recv.src);
    if (!typeInfo) return undefined;
    // A REAL member wins over an extension, and checking that here is not optional -- it is the same
    // order `classifyCall` applies (method, then field, then a conforming extension). Without it, a
    // boxed receiver whose type genuinely declares `m` would be silently redirected to an extension
    // of the same name, which is a divergence from JS invented while closing one.
    if (memberKindIn(typeInfo, method) !== undefined) return undefined;
    this.extTable ??= buildExtensionTable(this.context as any);
    const fnName = conformingExtensionFn(this.context as any, this.extTable, typeInfo, method);
    if (!fnName) return undefined;
    const target = this.ensureFreeFn(fnName, node);
    if (!target) return undefined;
    this.ledger.record("A3", "extension-devirt-dyn", node, `'${method}' devirtualized to the conforming :extension '${fnName}' on a boxed receiver`);
    return {
      src: node, ctype: target.sig.ret, kind: "c-call",
      callee: { kind: "free", cName: target.cName, params: target.sig.params, ret: target.sig.ret },
      args: [recv, ...cArgs],
    };
  }

  /**
   * A top-level function by SOURCE name, lowering it on demand if it belongs to another module --
   * the same resolution `functionValue` does, factored out so extension devirtualization can reuse it.
   * `undefined` means the name does not denote a lowerable function here.
   */
  private ensureFreeFn(name: string, node: ast.ASTNode): { cName: string; sig: { params: CType[]; ret: CType; arity: number } } | undefined {
    let alias = name;
    if (!this.ownFns.has(name)) {
      const entry = this.resolveSymbolSafe(name, node);
      const fnNode = entry?.value as ast.FunctionNode | undefined;
      if (fnNode?._type === "function" && !this.isExtern(entry)
          && ResolveHirToCir.moduleOfNode(fnNode) !== (this.rootSource ?? "")) {
        alias = this.lowerImportedFunction(name, fnNode);
      }
    }
    const sig = this.topLevelFns.get(alias);
    return sig ? { cName: mangleC(alias), sig } : undefined;
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
      // A core CallNode is UNAMBIGUOUSLY a call: `(call f)` desugars to exactly this shape
      // (DesugarAstVisitor.transformCall) for the sole purpose of saying so. `resolveCall` applies
      // D1's zero-arg READ rule -- `(counter)` reads the binding rather than invoking it -- which is
      // right for a bare list and wrong here, and it is why `(call check-j)` in a `for :cond` came
      // out as the closure VALUE and then failed to emit as `no cast closure -> bool`. A zero-arg
      // closure has no other spelling, so this branch is the only way to invoke one.
      if (callee._type === "simple-identifier" && args.length === 0
          && this.localInfo(mangleC((callee as ast.SimpleIdentifierNode).id))) {
        return this.closureCall(node, this.resolveIdentifier(callee as ast.IdentifierNode), []);
      }
      // Otherwise reuse the full callee-resolution path (operators, top-level, intrinsics, closures).
      return this.resolveCall(node as ast.ListNode, callee, args);
    }
    if (callee._type === "function") {
      return this.closureCall(node, this.resolveLambda(callee as ast.FunctionNode), args);
    }
    // A `member` callee is a METHOD CALL, not a call through a member's value -- `(x |> (.m a))`
    // desugars to exactly this shape (D17). resolveCall already dispatches it properly, so reuse it:
    // falling through to the computed-callee case below resolved the member as a VALUE, which invokes
    // a zero-arg method and then applies the real arguments to whatever it returned.
    if (callee._type === "member") {
      return this.resolveCall(node as ast.ListNode, callee, args);
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

  /** A modeled HIR literal (Step 3): value + checker type ride the node -- no dip below the HIR. */
  private resolveHLiteral(h: Extract<HExpr, { kind: "literal" }>): CExpr {
    const v = h.value;
    if (typeof v === "boolean") {
      return { src: h.src, ctype: C_BOOL, kind: "c-lit", lit: "bool", value: v ? "true" : "false" };
    }
    if (typeof v === "string") {
      return { src: h.src, ctype: C_STR, kind: "c-lit", lit: "str", value: v };
    }
    // A number: Int vs Real from the node's own type (the A1 win -- type on the node, not nodeTypes),
    // falling back to the value's integrality.
    const isReal = h.type?.kind === "primitive" ? h.type.name === "Real" : !Number.isInteger(v);
    if (isReal) return { src: h.src, ctype: C_REAL, kind: "c-lit", lit: "real", value: String(v) };
    // An Int literal is emitted from its SOURCE TEXT, not from `String(v)`.
    //
    // `IntegerNumberNode.value` is a JS `number`, i.e. an f64, so the parser has already rounded any
    // literal past 2^53 before codegen ever sees it: `9007199254740993` arrived as ...992, and
    // `4611686018427387904` as ...388000. C's `int64_t` can represent both exactly, so the loss was
    // pure round-tripping -- a live wrong answer on the native backend, independent of D51.
    // `match` is the raw text the lexer matched; it is the only lossless copy on the node.
    const raw = (h.src as { match?: string }).match;
    const exact = raw !== undefined && /^[+-]?\d+$/.test(raw) ? raw : String(v);
    return { src: h.src, ctype: C_INT, kind: "c-lit", lit: "int", value: exact };
  }

  /** The common concrete element type of a vector literal, or undefined if the elements disagree. */
  private commonElemType(elements: CExpr[]): CType | undefined {
    if (elements.length === 0) return undefined;
    const unwrap = (e: CExpr): CType => (e.kind === "c-copy" ? e.inner.ctype : e.ctype);
    const first = unwrap(elements[0]);
    if (first.k === "value") return undefined;
    return elements.every((e) => ctypeEquals(unwrap(e), first)) ? first : undefined;
  }

  /**
   * A3 (consume HMethodCall / HVirtualCall): dispatch a modeled method call straight to the method
   * resolver, bypassing resolveCall's re-classification (and its A3:call-dispatch dip). The routing MIRRORS
   * resolveCall's member/composite-callee branches exactly -- a `this.m` / `local.m` composite goes to
   * resolveDottedCall, an `obj.m` member to resolveNativeMethod with the resolved receiver -- so the emitted
   * call is byte-identical. The args come off the call form (which carries the lowered operands). A head
   * shape the method router does not cover (a null field name, a non-method callee) falls back to the raw
   * path, which registers the same dispatch it always did.
   */
  private resolveMethodCall(h: Extract<HExpr, { kind: "method-call" | "virtual-call" | "ext-call" }>): CExpr {
    // Consume the ALREADY-LOWERED operands (h.args): each rides its HRef/atom, so an argument read records
    // no A2:atom-ref dip. The receiver still resolves off the callee (raw AST).
    //
    // EXCEPT WITH A SPREAD, where pre-resolving is exactly wrong. `resolveExpr` on a spread operand
    // reaches `resolveAstExpr`, which has no arm for one, so `(console.log ...xs)` refused HERE --
    // before the member router could see that the callee was a variadic intrinsic able to take it.
    // That is why the message named `spread` and pointed at the argument: the argument really was
    // where it failed, and the callee -- the thing that decides whether a spread is legal -- had not
    // been looked at yet.
    //
    // Handing the raw args down instead lets `resolveDottedCall` map them itself, which is where the
    // spread rule lives. Every other operand takes the pre-lowered path exactly as before; this is a
    // fallback for one shape, not a change of route.
    if (h.args.some((a) => this.spreadInner(a) !== undefined)) {
      return this.dispatchMemberCall(h.src as ast.ListNode, undefined);
    }
    return this.dispatchMemberCall(h.src as ast.ListNode, h.args.map((a) => this.resolveExpr(a)));
  }

  /**
   * A3: a member-position dispatch `(obj.member ...)` routed STRAIGHT to the member resolver, bypassing
   * resolveCall's re-classification (its A3:call-dispatch dip). Mirrors resolveCall's member/composite
   * branches exactly (a `this.m`/`local.m` composite -> resolveDottedCall; an `obj.m` member ->
   * resolveNativeMethod on the resolved receiver), with `argVals` the pre-resolved operands (empty for a
   * 0-arg field read). A shape the router does not cover falls back to the raw path.
   */
  private dispatchMemberCall(list: ast.ListNode, argVals: CExpr[] | undefined): CExpr {
    const form = classifyList(list);
    if (form.kind === "call") {
      const callee = form.callee;
      if (callee._type === "composite-identifier") {
        return this.resolveDottedCall(list, callee as ast.CompositeIdentifierNode, form.args, argVals);
      }
      if (callee._type === "member") {
        const m = callee as ast.MemberNode;
        const fieldName = this.memberName(m.property);
        if (fieldName !== null) {
          return this.resolveNativeMethod(list, this.resolveAstExpr(m.object), fieldName, form.args, argVals);
        }
      }
    }
    return this.resolveAstExpr(list);
  }

  /**
   * The operator dispatch (unary `!`, unary `-` with struct-overload devirt, binary left-fold via mkBinop)
   * -- shared by resolveCall's raw path and the HIR `operator` case (HOperator). Returns undefined when
   * `op` is not a built-in operator form, so the caller falls through (resolveCall to the rest of its
   * dispatch; the HIR case to the raw path). Extracted verbatim from resolveCall so both are byte-identical.
   */
  private resolveOperatorCall(node: ast.ListNode, op: string, args: ast.ASTNode[], argVals?: CExpr[], intDiv = false): CExpr | undefined {
    // The operand at position i: a pre-resolved value (HIR path, consuming h.args) or a raw-AST resolve.
    const A = (i: number): CExpr => (argVals ? argVals[i] : this.resolveAstExpr(args[i]));
    const n = argVals ? argVals.length : args.length;
    if (op === "!" && n === 1) {
      return { src: node, ctype: C_BOOL, kind: "c-unop", op: "!", mode: "bool", operand: A(0) };
    }
    if (op === "-" && n === 1) {
      const operand = A(0);
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
    if (BINARY_OPS.has(op) && n >= 2) {
      // Left-fold: `(+ a b c)` == `((a+b)+c)`, per-pair mode decisions (string contagion works).
      let acc = A(0);
      for (let i = 1; i < n; i++) {
        acc = this.mkBinop(op, acc, A(i), node, intDiv);
      }
      return acc;
    }
    return undefined;
  }

  /**
   * A3 (consume HOperator): an operator call `(op a b)` dispatches straight to the operator resolver with
   * its ALREADY-LOWERED operands (h.args resolved via resolveExpr, so an operand read rides its HRef and
   * records no A2:atom-ref dip), bypassing resolveCall's re-classification (the A3:call-dispatch dip). The
   * emitted op is byte-identical -- the modeled/raw distinction only gates the ledger. A user operator the
   * resolver does not cover falls back to the raw path.
   */
  private resolveOperator(h: Extract<HExpr, { kind: "operator" }>): CExpr {
    const argVals = h.args.map((a) => this.resolveExpr(a));
    const res = this.resolveOperatorCall(h.src as ast.ListNode, h.op, [], argVals, h.intDiv);
    if (res) return res;
    return this.resolveAstExpr(h.src);
  }

  /** The RAW-AST construction path (a bare `(C ...)` / `(new C ...)` reached via resolveList): resolve the
   *  positional args off the AST, then fill the slots. The A4:construct dip -- no HConstruct was consumed. */
  private resolveConstruct(node: ast.ASTNode, className: string, args: ast.ASTNode[]): CExpr {
    this.ledger.record("A4", "construct", node, `construction of '${className}' resolved from the symbol table (raw-AST path, no HConstruct)`);
    return this.buildConstruct(node, className, args.map((a) => this.resolveAstExpr(a)), false);
  }

  /**
   * Fill a construction's field slots from the RESOLVED positional args -- shared by the raw-AST path
   * (`resolveConstruct`) and the HIR path (the `construct` case consuming HConstruct). Every slot gets a
   * provided positional arg, else the field's declared default, else nil (`ll_obj_new` zero-fills).
   *
   * `fromHir` records honestly: when the args come from HConstruct AND the layout from HClass, the
   * A4:construct dip is closed -- the only AST read left is a per-field DEFAULT for an OMITTED arg (the
   * HIR carries the args, not the defaults), recorded per use.
   */
  private buildConstruct(node: ast.ASTNode, classNameSpelled: string, argVals: CExpr[], fromHir: boolean): CExpr {
    const desc = this.classes.get(classNameSpelled)!;
    const className = desc?.name ?? classNameSpelled;
    // Positional args map to the CTOR fields in SLOT ORDER (= flattened ctor-param order), not to raw
    // slots: a plain (non-ctor) field interleaved below a ctor field -- which inheritance introduces --
    // would otherwise steal a ctor arg and leave the ctor field nil (gap ledger §9.2). The k-th ctor
    // field gets `argVals[k]`; every other slot (a plain field, or a ctor field whose arg was omitted)
    // takes its declared default, else nil (`ll_obj_new` zero-fills).
    //
    // Fallback: if the descriptor marked NO ctor fields (an imported class whose ctorInfo was
    // unavailable, or a plain-field-only struct), keep the by-slot-index fill -- the pre-§9.2 behaviour,
    // correct wherever there is no interleaving to get wrong.
    const argForSlot = new Map<number, CExpr>();
    const hasCtorFields = desc.fields.some((f) => f.isCtor);
    if (hasCtorFields) {
      let k = 0;
      desc.fields.forEach((f, i) => { if (f.isCtor) { if (k < argVals.length) argForSlot.set(i, argVals[k]); k++; } });
    } else {
      desc.fields.forEach((_f, i) => { if (i < argVals.length) argForSlot.set(i, argVals[i]); });
    }
    const cArgs = desc.fields.map((f, i) => {
      // A field initializer is a store site: a struct-typed value is copied (D11), an array/class shared.
      const arg = argForSlot.get(i);
      if (arg !== undefined) return this.copyStore(arg, node, "field-init");
      if (f.default) {
        if (fromHir) this.ledger.record("A4", "construct-default", node, `omitted arg -> field '${f.name}' default read from AST (HConstruct carries args, not defaults)`);
        return this.copyStore(this.resolveAstExpr(f.default), node, "field-init");
      }
      return { src: node, ctype: C_VALUE, kind: "c-nil" } as CExpr;
    });
    return {
      src: node, ctype: { k: "obj", className },
      kind: "c-construct", className, isStruct: desc.isStruct, args: cArgs, fieldCount: desc.fields.length,
      initMethods: desc.ctorMethods.length ? [...desc.ctorMethods] : undefined,
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
  /**
   * Does any class BELOW `className` override `method` with its own implementation?
   *
   * Answered by comparing C names: an inheriting child carries the parent's entry verbatim, so a
   * DIFFERENT `cName` for the same method name is exactly an override. No second table, and nothing
   * that can drift out of step with the one being read.
   *
   * The walk is over every registered class rather than a child index, because the pre-pass records
   * `parent` and nothing builds the inverse edge. Class counts are small and this runs once per
   * candidate call site.
   */
  private overridesBelow(className: string, method: string, baseCName: string): boolean {
    for (const d of this.classes.values()) {
      if (d.name === className) continue;
      const own = d.methods.get(method);
      if (!own || own.cName === baseCName) continue;
      for (let p = d.parent; p; p = this.classes.get(p)?.parent) {
        if (p === className) return true;
      }
    }
    return false;
  }

  /** `(recv.method args)` through the class method table -- the same `ll_dyn_method` shape the native
   *  fallback and the interface-typed receiver already use. Answers a boxed `ll_value`; P2 unboxes at
   *  the consumer, exactly as it does for every other dynamically-dispatched call. */
  private dynMethodCall(node: ast.ASTNode, recv: CExpr, method: string, cArgs: CExpr[]): CExpr {
    const dyn = NATIVE_METHODS.get("dyn.method")!;
    const nameLit: CExpr = { src: node, ctype: C_STR, kind: "c-lit", lit: "str", value: method };
    const boxed: CExpr = { src: node, ctype: C_VALUE, kind: "c-box", inner: recv, from: recv.ctype };
    return { src: node, ctype: dyn.ret, kind: "c-call", callee: { kind: "intrinsic", ...dyn }, args: [boxed, nameLit, ...cArgs] };
  }

  private resolveObjMethod(node: ast.ASTNode, recv: CExpr, method: string, args: ast.ASTNode[], argVals?: CExpr[]): CExpr {
    const className = (recv.ctype as any).className as string;
    const desc = this.classes.get(className)!;
    const m = desc.methods.get(method);
    if (m) {
      const cArgs = argVals ?? args.map((a) => this.resolveAstExpr(a));
      // DEVIRTUALIZE ONLY WHEN NOTHING BELOW OVERRIDES. Otherwise this is a VIRTUAL call and has to go
      // through the method table, because the receiver's static class is an upper bound, not an
      // identity -- `this` inside a base method is routinely a subclass instance, which is the entire
      // point of declaring the method there.
      //
      // This used to devirtualize unconditionally, and it was a SILENT WRONG ANSWER rather than a
      // missing feature. `09-oop/03_dispatch_and_type_patterns` has `BinOp.show` call `this.symbol`,
      // overridden by `Add` and `Mul`: the emitted C called `__ll_method_BinOp_symbol` and printed the
      // base's placeholder, so `((2 + 3) * (4 + (5 * 6)))` came out as `((2 ? 3) ? (4 ? (5 ? 6)))`.
      // Nothing failed; the answer was simply wrong, on the supported backend.
      //
      // Why it survived: the same method's `this.left.show` DID dispatch dynamically -- `left` is
      // typed as the INTERFACE `Node`, which has no class to devirtualize to. So a file exercising
      // both shapes looked like it was testing virtual dispatch, and half of it was.
      //
      // The dynamic path costs a name lookup in the class's method table; the tables and their `_dyn`
      // adapters were already emitted for every class (`__ll_methods_Add[]`), so this changes which
      // call is emitted and nothing else. Devirtualization still applies to every method nobody
      // overrides, which is nearly all of them.
      if (!this.overridesBelow(className, method, m.cName)) {
        this.ledger.record("A3", "method-devirt", node, "method call devirtualized to a direct call with explicit self (SIL-style)");
        return { src: node, ctype: m.ret, kind: "c-call", callee: { kind: "free", cName: m.cName, params: [{ k: "obj", className }, ...m.params], ret: m.ret }, args: [recv, ...cArgs] };
      }
      this.ledger.record("A3", "method-virtual", node, `'${method}' is overridden below '${className}' -- dispatched through the method table`);
      return this.dynMethodCall(node, recv, method, cArgs);
    }
    if (desc.fieldSlot.has(method)) {
      // `(obj.field)` with NO args is a D1 field READ; with args, a call through a field-held closure.
      const field = this.fieldGet(node, recv, method);
      const cArgs = argVals ?? args.map((a) => this.resolveAstExpr(a));
      return cArgs.length === 0 ? field : this.closureCallResolved(node, field, cArgs);
    }
    const ext = this.tryExtensionCall(node, recv, method, args, argVals);
    if (ext) return ext;
    throw this.refuse(node, `method:${className}.${method}`, "resolveObjMethod");
  }

  /** `(recv.method args)` on a TYPED struct/class receiver where `method` is an `:extension` ->
   *  a direct call `method(recv, ...args)`. The devirtualization the HIR does not model (A3, Q4).
   *
   *  Resolves through the FOREST-WIDE `buildExtensionTable`/`conformingExtensionFn` pair (the same the JS
   *  side and `dynExtensionCall` use), NOT the root-module-only `this.extensions` map: that map is built
   *  by `registerExtension` from the ROOT module's top-level items alone, so an extension defined in an
   *  imported/ambient module (`std/core/errors`' `caused-by`) was invisible, and it keyed on the exact
   *  receiver-type name, so a BASE-class extension never dispatched for a SUBCLASS receiver
   *  (`(indexError.caused-by …)` -> ELL0106). `conformingExtensionFn` walks the `:extends`/`:implements`
   *  chain, and `ensureFreeFn` lowers the imported extension body on demand. */
  private tryExtensionCall(node: ast.ASTNode, recv: CExpr, method: string, args: ast.ASTNode[], argVals?: CExpr[]): CExpr | undefined {
    const recvType = this.ctypeName(recv.ctype);
    if (!recvType) return undefined;
    const typeInfo = this.resolveSymbolSafe(recvType, node)?.inferredType ?? { name: recvType, kind: "class" };
    if (memberKindIn(typeInfo, method) !== undefined) return undefined; // a real member wins over an extension
    this.extTable ??= buildExtensionTable(this.context as any);
    const fnName = conformingExtensionFn(this.context as any, this.extTable, typeInfo, method);
    if (!fnName) return undefined;
    const target = this.ensureFreeFn(fnName, node);
    if (!target) return undefined;
    this.ledger.record("A3", "extension-devirt", node, "extension method devirtualized to a free call on its first parameter (Q4 static case)");
    const cArgs = argVals ?? args.map((a) => this.resolveAstExpr(a));
    return { src: node, ctype: target.sig.ret, kind: "c-call", callee: { kind: "free", cName: target.cName, params: target.sig.params, ret: target.sig.ret }, args: [recv, ...cArgs] };
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
  /** `modeled` = the read arrived as an HRef (the name rides the HIR node), so the A2 atom-ref dip is
   *  DRAINED -- the read is no longer an opaque leaf. Binding resolution and the A1 type fallback still
   *  run (those channels haven't fully moved onto the node yet); only the atom-ref record is skipped. */
  private resolveIdentifier(node: ast.IdentifierNode, modeled = false): CExpr {
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
    // An enum member reference `HttpMethod:GET` -- a compile-time constant, not a binding.
    const enumEntry = this.lookupEnumMember(name);
    if (enumEntry) {
      this.ledger.record("A4", "enum-ref", node, "enum member reference folded to its constant value (not the HIR)");
      return this.enumValueExpr(enumEntry, node);
    }
    // Host numeric constants (std/js externs) with a direct C equivalent.
    if ((name === "NaN" || name === "Infinity") && !this.localInfo(mangleC(name))) {
      this.ledger.record("A9-extern", "host-constant", node, `'${name}' host constant mapped to a C value`);
      return { src: node, ctype: C_REAL, kind: "c-lit", lit: "real", value: name === "NaN" ? "NAN" : "INFINITY" };
    }
    if (node._type === "composite-identifier") {
      return this.resolveCompositeRead(node as ast.CompositeIdentifierNode, modeled);
    }
    const cName = mangleC(name);
    const info = this.localInfo(cName);
    // A module-level GLOBAL referenced from inside a function (not shadowed by a local).
    if (!info && this.ownGlobals.has(name)) {
      const g = this.globalDecls.find((d) => d.cName === cName);
      if (!modeled) this.ledger.record("A2", "atom-ref", node, "variable read is an opaque leaf; resolved below the HIR");
      return { src: node, ctype: g?.ctype ?? C_VALUE, kind: "c-ref", cName };
    }
    // A TOP-LEVEL function referenced as a VALUE (not called): becomes a closure via an adapter --
    // the "functions are values" gap the HIR does not model (spec A3). Only when it is NOT a local
    // (a local of the same name shadows).
    if (!info && this.topLevelFns.has(name)) {
      return this.functionValue(node, name);
    }
    // An imported VALUE binding (`(export secret-number-a)` in another module). Functions and classes
    // were already lowered on demand; a plain `let`/`mut` was not, so its mangled name was emitted as
    // a bare reference that no C scope declares. Hoist it to a global here, same as the local
    // module-global path, with its initializer run at the top of main.
    const importedCName = info ? undefined : this.ensureImportedValue(name, node);
    if (importedCName) {
      const g = this.globalDecls.find((d) => d.cName === importedCName);
      if (!modeled) this.ledger.record("A2", "atom-ref", node, "variable read is an opaque leaf; resolved below the HIR");
      // `importedCName`, not `cName`: the defining module may not own the bare spelling.
      return { src: node, ctype: g?.ctype ?? C_VALUE, kind: "c-ref", cName: importedCName };
    }
    if (!modeled) this.ledger.record("A2", "atom-ref", node, "variable read is an opaque leaf; resolved below the HIR");
    let t = this.context.nodeTypes.get(node);
    if (t === undefined) {
      // A LOCAL binding already carries its type from its DEFINITION SITE (declareLocal recorded the
      // declaration / combinator-result CType, read below as info.ctype) -- so a local ref is NOT a
      // ref-type-via-symbols dip (its type is on the binding, spec A1's "type at the definition"). The
      // symbol entry is still resolved for the extern / function-as-value classification (a binding-KIND
      // question, not a type one), but WITHOUT recording the type dip; only a non-local ref records it.
      const entry = info
        ? this.resolveSymbolSafe(name, node)
        : this.dipSymbols("A1", "ref-type-via-symbols", node, "identifier use missing from channel; binding type from symbol table", name);
      if (this.isExtern(entry)) throw this.refuseExtern(node, name);
      // An imported/top-level function referenced as a value but not yet registered: treat as a value.
      //
      // `inferredType.kind === "function"` is NOT enough to say the definition is a function: a
      // `(let c5 (constantly 5))` binds a VARIABLE whose inferred type is a function, and reading
      // `.params` off that VariableNode crashed the backend outright ("reading 'map'" of undefined).
      // A variable holding a function is a closure VALUE and belongs on the ordinary binding path
      // below -- only a real declaration gets a top-level adapter. (D1: `(x)` is a call iff `x` is a
      // function, declared as one OR holding one -- but only the first has a body to point at.)
      if (entry?.inferredType?.kind === "function" && this.isLocalDef(entry)
          && (entry.value as ast.ASTNode | undefined)?._type === "function") {
        // Register under the bare name ONLY for a function of this module. For an imported one that
        // would claim the bare spelling on the wrong module's behalf; `functionValue` resolves the
        // definition and lowers it under its own module's alias instead.
        const fnNode = entry.value as ast.FunctionNode;
        if (ResolveHirToCir.moduleOfNode(fnNode) === (this.rootSource ?? "")) this.registerTopLevel(fnNode, name);
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

  /**
   * A top-level function used as a value -> a closure over a boxed-convention adapter (no captures).
   *
   * The name alone is not enough to say WHICH function: an imported module's private `label` shares
   * its spelling with another import's, and -- unlike a direct call -- a value reference never went
   * through the branch that lowers an imported body. So this used to do two wrong things at once:
   * crash outright (`topLevelFns.get(name)!` is undefined when the function was only ever referenced,
   * never called) or, once some other module had registered the spelling, silently hand back THAT
   * module's function. Resolve the definition here, lower it under its own module's alias, and build
   * the adapter from the alias.
   */
  private functionValue(node: ast.ASTNode, name: string): CExpr {
    this.ledger.record("A3", "function-as-value", node, "function used as a first-class value; boxed-convention adapter synthesized");
    let alias = name;
    // Only a function of ANOTHER module needs resolving: this module's own top-level functions are
    // all registered by the pre-scan and own their bare names, so their path is unchanged.
    if (!this.ownFns.has(name)) {
      const entry = this.resolveSymbolSafe(name, node);
      const fnNode = entry?.value as ast.FunctionNode | undefined;
      if (fnNode?._type === "function" && !this.isExtern(entry)
          && ResolveHirToCir.moduleOfNode(fnNode) !== (this.rootSource ?? "")) {
        alias = this.lowerImportedFunction(name, fnNode);
      }
    }
    const sig = this.topLevelFns.get(alias);
    // Previously a TypeError from a `!` on undefined. A refusal is the honest form: the backend does
    // not know what this name denotes, and saying so beats emitting an adapter for a body nothing
    // defines (which would fail at link time, further from the cause).
    if (!sig) throw this.refuse(node, `function-value:${name}`, "functionValue");
    const cName = mangleC(alias);
    this.adapters.set(cName, { forCName: cName, params: sig.params, ret: sig.ret, arity: sig.arity, restAt: sig.restAt });
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
  private resolveCompositeRead(node: ast.CompositeIdentifierNode, modeled = false): CExpr {
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
    // N12 / gap ledger §15.3: an IMPORTED module-level head (`GLYPHS.length`, GLYPHS exported from
    // another module) must be hoisted to a C global -- exactly as the simple-read path
    // (resolveIdentifier) and the dotted-CALL path (resolveDottedCall) already do. Without it the dotted
    // READ emitted `ll_dyn_length(u_GLYPHS)` against a name no C scope declares. The hoisted global's
    // DECLARED ctype (a `vec` for an `Int[]`) is also what makes `.length` pick `ll_vec_len` instead of
    // the dynamic accessor. Returns undefined for our own module global, so same-module heads are
    // unchanged. Skipped when the head is already a C local.
    const importedCName = info ? undefined : this.ensureImportedValue(headName, node);
    const isLocal = !this.isExtern(local) && (local?.inferredType !== undefined || info !== undefined);
    if (importedCName || isLocal) {
      // A member read off a local binding. A hoisted module global's DECLARED ctype wins over
      // re-inference here, exactly as it does at store sites (resolveLValue) and receiver sites
      // (headObject): re-inferring `FOODS` as untyped picked the DYNAMIC accessor for `.length` and
      // handed it a concrete `ll_vec*`, which is a cc type error -- while `FOODS[i]`, which goes
      // through headObject, got the right type on the same line.
      const cName = importedCName ?? mangleC(headName);
      const ctype = info?.ctype
        ?? (importedCName
          ? this.globalDecls.find((d) => d.cName === cName)?.ctype
          : this.globalCType(headName, cName))
        ?? mapType(local?.inferredType);
      let expr: CExpr = { src: node, ctype: ctype ?? C_VALUE, kind: "c-ref", cName, cell: info?.cell };
      if (!modeled) this.ledger.record("A2", "atom-ref", node, "variable read is an opaque leaf; resolved below the HIR");
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
          let clsName = cls._type === "simple-identifier" ? (cls as ast.SimpleIdentifierNode).id
            : cls._type === "type-name" ? (cls as any).name : undefined;
          // ANF may hoist the class head into a temp (`__ll_hir_N = Inventory`); read the name back.
          if (clsName && this.tempClassName.has(clsName)) clsName = this.tempClassName.get(clsName)!;
          if (clsName && this.ensureClassRegistered(clsName, node)) return this.resolveConstruct(node, clsName, form.args.slice(1));
        }
        // `(throw x)` -> ll_throw(box(x)); diverges (void).
        if (form.name === "throw" && form.args.length === 1) {
          this.ledger.record("A8", "throw", node, "throw lowered to a longjmp (native error machinery)");
          const err = this.resolveAstExpr(form.args[0]);
          return { src: node, ctype: C_VOID, kind: "c-call", callee: { kind: "intrinsic", runtimeFn: "ll_throw", variadic: false, params: [C_VALUE], ret: C_VOID }, args: [err] };
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
      const opRes = this.resolveOperatorCall(node, (callee as ast.SimpleIdentifierNode).id, args);
      if (opRes) return opRes;
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
    if (callee._type === "member") {
      // A method call on a COMPUTED receiver: `((s.reversewords).titlecase)` -- method chaining. Route
      // through the method dispatcher (user method / :extension / native / field-closure), not a blind
      // closure call, so a chained extension devirtualizes the same as `(s.titlecase)` does.
      const m = callee as ast.MemberNode;
      const fieldName = this.memberName(m.property);
      if (fieldName !== null) return this.resolveNativeMethod(node, this.resolveAstExpr(m.object), fieldName, args);
      return this.closureCall(node, this.resolveAstExpr(callee), args);
    }
    if (callee._type === "call") {
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
      // (2) A struct/class name -> construction (spec A4: the HIR models no construction). Registers
      // an imported class on demand (the class-level analog of imported-body lowering).
      if (this.ensureClassRegistered(name, node)) {
        return this.resolveConstruct(node, name, args);
      }
      // (3) A top-level function defined in this module -> a direct typed C call.
      if (this.ownFns.has(name)) {
        const sig = this.topLevelFns.get(name)!;
        const cArgs = args.map((a) => this.resolveAstExpr(a));
        return { src: node, ctype: sig.ret, kind: "c-call", callee: { kind: "free", cName, params: sig.params, ret: sig.ret }, args: this.packRestArgs(node, sig, cArgs) };
      }
      const entry = this.dipSymbols("A3", "callee-identity", node, "callee resolved through the symbol table (spec wants it on the call node)", name);
      const symT = entry?.inferredType;
      const builtin = INTRINSIC_CALLS.get(name);
      if (builtin) {
        if (entry !== undefined && !this.isExtern(entry)) {
          this.ledger.record("A9-extern", "stdlib-intrinsic", node, `'${name}' stdlib body shadowed by a C intrinsic`);
        }
        const spreadCall = this.intrinsicSpreadCall(node, name, builtin, args);
        if (spreadCall) return spreadCall;
        const cArgs = args.map((a) => this.resolveAstExpr(a));
        return { src: node, ctype: builtin.ret, kind: "c-call", callee: { kind: "intrinsic", ...builtin }, args: cArgs };
      }
      // (3) An IMPORTED (non-intrinsic) l-lang function -> lower its body on demand (the C analog of
      // the JS backend's ensureSymbolInlined) and call it directly.
      if (symT?.kind === "function" && !this.isExtern(entry) && (entry?.value as any)?._type === "function") {
        // The ALIAS, not the source name: another module may already own the bare spelling.
        const alias = this.lowerImportedFunction(name, entry!.value as ast.FunctionNode);
        const sig = this.topLevelFns.get(alias);
        // A refused import (e.g. an imported `:gen` generator) registered nothing; the compilation is
        // already refused, so return a placeholder rather than crash on a missing signature.
        if (!sig) return { src: node, ctype: C_VALUE, kind: "c-nil" };
        const cArgs = args.map((a) => this.resolveAstExpr(a));
        return { src: node, ctype: sig.ret, kind: "c-call", callee: { kind: "free", cName: mangleC(alias), params: sig.params, ret: sig.ret }, args: this.packRestArgs(node, sig, cArgs) };
      }
      if (args.length === 0) {
        // `(x)` where x is not a function: redundant parens around a value (D1).
        return this.resolveIdentifier(callee as ast.IdentifierNode);
      }
      throw this.refuseExtern(node, name);
    }

    throw this.refuse(node, `callee:${callee._type}`, "resolveCall");
  }

  /**
   * An imported `let`/`mut` used as a value -> a C global initialized at the top of `main`.
   *
   * The value analog of lowerImportedFunction / imported-class registration (A9's extern boundary).
   * Without it, `(export secret-number-a)` in another module resolved to a bare mangled name that no
   * C scope declares -- the whole module's body is NOT emitted (that is the point of on-demand
   * lowering; the library's own top-level side effects must not run), so nothing ever declared it.
   *
   * Returns true when `name` is such a binding, after registering it. The initializer is resolved in
   * an ISOLATED scope: it belongs to the other module and must not see this one's locals.
   */
  /** The file a node (or a symbol's defining scope) came from -- the module identity aliases key on. */
  private static moduleOfNode(node: ast.ASTNode | undefined): string {
    return node?._location?.source ?? "";
  }

  private static moduleOfEntry(entry: SymbolEntry | undefined): string {
    let s: any = entry?.scope;
    while (s?.parent) s = s.parent;
    return ResolveHirToCir.moduleOfNode(s?.node) || ResolveHirToCir.moduleOfNode(entry?.value);
  }

  /**
   * The alias a (defining module, source name) pair owns in C's ONE global namespace.
   *
   * D20 makes a module-private binding real, so `alpha.lisp` and `beta.lisp` may each define `TAG`
   * and `decorate`. Whoever asks first keeps the bare name -- which is why every existing program
   * emits byte-identical C -- and a later, DIFFERENT module gets `name#2`, `name#3`, ... The mangled
   * form is what actually has to be unique, so the search tests `mangleC(candidate)` rather than the
   * alias: `decorate#2` mangles to `u_decorate_232`, and so would a user symbol literally spelled
   * `decorate_232`.
   */
  private aliasFor(name: string, module: string): string {
    const owner = `${module}::${name}`;
    const existing = this.aliases.get(owner);
    if (existing !== undefined) return existing;
    let alias = name;
    for (let n = 2; ; n++) {
      const held = this.aliasOwner.get(mangleC(alias));
      if (held === undefined || held === owner) break;
      alias = `${name}#${n}`;
    }
    this.aliases.set(owner, alias);
    this.aliasOwner.set(mangleC(alias), owner);
    return alias;
  }

  /**
   * Hoist an imported module-level binding to a C global. Returns the C NAME it was given, or
   * undefined when the name is not such a binding.
   *
   * The name is per DEFINING MODULE (`aliasFor`), not per spelling: `alpha.lisp` and `beta.lisp` may
   * each have a private `TAG` (D20), and deduping on the bare spelling made the second reuse the
   * first's global -- the program then printed the first module's value, silently.
   */
  private ensureImportedValue(name: string, node: ast.ASTNode): string | undefined {
    const entry = this.resolveSymbolSafe(name, node);
    const varNode = entry?.value as ast.VariableNode | undefined;
    if (!entry || this.isExtern(entry) || varNode?._type !== "variable") return undefined;
    if (varNode.name?._type !== "simple-identifier") return undefined; // a destructuring import: not modeled
    const module = ResolveHirToCir.moduleOfEntry(entry);
    // OUR OWN module-level binding: `computeGlobals` already owns it and its declaration is emitted
    // where the variable is resolved. Say so by returning nothing, so the caller keeps the existing
    // path -- this is also the check that used to be the caller's `!globalNames.has(name)` guard,
    // which could not tell "our global" from "an import that happens to share the spelling".
    if (module === (this.rootSource ?? "")) return undefined;
    const alias = this.aliasFor(name, module);
    const cName = mangleC(alias);
    if (this.importedValues.has(alias)) return cName;
    this.importedValues.add(alias);
    this.ledger.record("A9-extern", "imported-value", node, `imported l-lang binding '${name}' hoisted to a C global (value analog of imported-body)`);
    let init: CExpr | null = null;
    this.isolated(varNode as any, () => {
      init = varNode.value ? this.resolveAstExpr(varNode.value) : null;
    });
    const ctype: CType = init ? (init as CExpr).ctype : C_VALUE;
    this.globalDeclared.add(cName);
    this.globalNames.add(alias);
    this.globalDecls.push({ cName, ctype });
    if (init) {
      this.importedInits.push({
        src: node, ctype: C_VOID, kind: "c-assign",
        target: { kind: "name", cName, ctype }, value: init,
      });
    }
    return cName;
  }

  /**
   * Lower an imported l-lang function's body on demand, isolating its scope.
   *
   * Returns the ALIAS the function is known by from here on -- the bare source name unless another
   * module already claimed it, in which case the caller must look up `topLevelFns` and build the C
   * name with the alias, not the source name. Two imported modules may each define a private
   * `decorate` (D20); dedup on the bare name made the second silently reuse the first's body.
   */
  private lowerImportedFunction(name: string, fn: ast.FunctionNode): string {
    const alias = this.aliasFor(name, ResolveHirToCir.moduleOfNode(fn));
    if (this.importedLowered.has(alias)) return alias;
    this.importedLowered.add(alias);
    // `fn` is the symbol table's PRE-desugar node -- give it the implicit return the main module got.
    fn = this.desugaredCopyOf(fn);
    // D58: an imported `:gen` takes the same path as a local one. This is not a corner -- ALL ELEVEN
    // of `std/iter/linq`'s lazy operators are imported generators, so without this arm the library
    // that motivated the whole phase stays refused.
    if (isGenerator(fn) && fn.name) {
      this.ledger.record("A9-extern", "imported-body", fn, `imported l-lang generator '${name}' lowered on demand`);
      this.collectGenerator(fn, alias);
      return alias;
    }
    if (this.refuseCoroutine(fn, name)) return alias;
    this.ledger.record("A9-extern", "imported-body", fn, `imported l-lang function '${name}' lowered on demand (C analog of ensureSymbolInlined)`);
    this.registerTopLevel(fn, alias);
    const sig = this.topLevelFns.get(alias)!;
    this.isolated(fn, () => {
      const params: CParam[] = fn.params.map((p, i) => this.declareParam(p, sig.params[i]));
      const prologue = this.paramCopyPrologue(fn, params);
      const body = this.resolveFunctionBody(fn);
      this.functions.push({ src: fn, cName: mangleC(alias), params, ret: sig.ret, body: { stmts: [...prologue, ...body.stmts] } });
    });
    return alias;
  }

  private resolveDottedCall(node: ast.ListNode, callee: ast.CompositeIdentifierNode, args: ast.ASTNode[], argVals?: CExpr[]): CExpr {
    const whole = callee.id;
    const intrinsic = INTRINSIC_CALLS.get(whole);
    const headName = callee.parts[0];
    // `(this.field)` / `(this.method args)` inside a method body.
    if (headName === "this" && this.selfClass) {
      let recv: CExpr = { src: callee, ctype: { k: "obj", className: this.selfClass }, kind: "c-ref", cName: "__self" };
      for (const mid of callee.parts.slice(1, -1)) recv = this.memberRead(node, recv, mid);
      return this.resolveNativeMethod(node, recv, callee.parts[callee.parts.length - 1], args, argVals);
    }
    const localEntry = (() => { try { return this.context.symbolTable.resolveSymbol(headName, callee); } catch { return undefined; } })();
    const localVar = this.localInfo(mangleC(headName));

    // A module-level binding of ANOTHER module, reached as a dotted HEAD -- `(DIGITS.indexOf c)`
    // inside a lowered imported body. It resolves in the SYMBOL table but is a local of no C scope,
    // so the bare `u_DIGITS` built below would be a reference nothing declares. Hoist it to a C
    // global first, exactly as `resolveIdentifier` does for the non-dotted read of the same binding
    // -- that path had the ensure and this one did not, which is the whole of the bug.
    const headCName = localVar !== undefined || this.isExtern(localEntry)
      ? undefined
      : this.ensureImportedValue(headName, callee)
        ?? (this.globalNames.has(headName) ? mangleC(headName) : undefined);
    // Once hoisted (here or by the module-global pass), the GLOBAL's declared ctype is what C sees;
    // `mapType(inferredType)` is only the fallback for a binding that is neither local nor global.
    const globalT = headCName ? this.globalDecls.find((d) => d.cName === headCName)?.ctype : undefined;

    // A local binding wins over a host global of the same spelling -- but an `:extern` entry IS the
    // host global (the std/js prelude declares `console`, `Math`, ... into the symbol table).
    if (!this.isExtern(localEntry) && (localEntry?.inferredType !== undefined || localVar !== undefined || headCName !== undefined)) {
      let recv: CExpr = {
        src: callee,
        ctype: localVar?.ctype ?? globalT ?? mapType(localEntry?.inferredType),
        kind: "c-ref",
        cName: localVar !== undefined ? mangleC(headName) : headCName ?? mangleC(headName),
        cell: localVar?.cell,
      };
      // Intermediate `.a.b` parts are member reads; the LAST part is the method.
      for (const mid of callee.parts.slice(1, -1)) recv = this.memberRead(node, recv, mid);
      const method = callee.parts[callee.parts.length - 1];
      // For a 2-part `obj.method`, pass the receiver's SOURCE NAME down. The receiver CExpr built
      // above carries `src: callee` -- the whole `obj.method` node -- so its type channel entry
      // describes the call, not the binding, and extension devirtualization cannot key on it. Only
      // a 2-part head names the receiver; `.a.b.method` resolves through member reads instead.
      const recvName = callee.parts.length === 2 ? headName : undefined;
      return this.resolveNativeMethod(node, recv, method, args, argVals, recvName);
    }

    if (intrinsic) {
      this.ledger.record("A9-extern", "host-intrinsic", node, `'${whole}' resolved against the C runtime (JS resolves it against the host)`);
      const spreadCall = this.intrinsicSpreadCall(node, whole, intrinsic, args);
      if (spreadCall) return spreadCall;
      const cArgs = argVals ?? args.map((a) => this.resolveAstExpr(a));
      return { src: node, ctype: intrinsic.ret, kind: "c-call", callee: { kind: "intrinsic", ...intrinsic }, args: cArgs };
    }

    throw this.refuseExtern(node, whole);
  }

  private resolveNativeMethod(node: ast.ListNode, recv: CExpr, method: string, args: ast.ASTNode[], argVals?: CExpr[], recvName?: string): CExpr {
    // A struct/class receiver -> a devirtualized user method (spec A3/A4).
    if (recv.ctype.k === "obj") return this.resolveObjMethod(node, recv, method, args, argVals);
    const baseKey = recv.ctype.k === "str" ? "str" : recv.ctype.k === "vec" ? "vec" : "dyn";
    let def = NATIVE_METHODS.get(`${baseKey}.${method}`);
    let cArgs = argVals ?? args.map((a) => this.resolveAstExpr(a));

    if (!def && baseKey !== "dyn") {
      // A zero-arg "call" of a FIELD (`(m.length)`): D1 makes the dotted form a call, __ll_member
      // makes a non-function a read. Mirror that.
      const field = NATIVE_FIELDS.get(`${baseKey}.${method}`);
      if (field && cArgs.length === 0) {
        return { src: node, ctype: field.ret, kind: "c-member", object: recv, fieldName: method, runtimeFn: field.runtimeFn };
      }
    }
    if (!def) {
      if (baseKey === "dyn") {
        // An `:extension` conforming to the receiver's STATIC type, devirtualized to a free call --
        // tried BEFORE the runtime fallback, because the runtime has no answer for it.
        //
        // This is the method SURFACE (`(coll.filter p)`, D33's second surface). An extension is a free
        // function, not a member of the receiver's class, so `ll_dyn_method` searches a method table
        // that by construction never contains it and traps: "no such method on this value". The
        // branch below only ever reached extensions on a CONCRETELY typed receiver (`(s.words)` on a
        // String, keyed by C type name), so a boxed one -- which is what every `Iterable<T>` is --
        // had no path at all.
        const ext = this.dynExtensionCall(node, recv, method, cArgs, recvName);
        if (ext) return ext;
        // `(recv.name)` on a BOXED receiver: the runtime decides method-vs-field (the __ll_member
        // rule -- a function member is called, a non-function is read). ll_dyn_method dispatches on
        // the actual tag and falls back to a field read for a non-method name (e.g. `err.message`).
        this.ledger.record("A3", "method-dyn", node, "boxed receiver forces runtime dispatch (method or field read)");
        const dyn = NATIVE_METHODS.get("dyn.method")!;
        const nameLit: CExpr = { src: node, ctype: C_STR, kind: "c-lit", lit: "str", value: method };
        return { src: node, ctype: dyn.ret, kind: "c-call", callee: { kind: "intrinsic", ...dyn }, args: [recv, nameLit, ...cArgs] };
      }
      // A registered `:extension` on this primitive receiver (`(s.words)` on a String) -> free call.
      const recvType = this.ctypeName(recv.ctype);
      const extName = recvType ? this.extensions.get(`${method}:${recvType}`) : undefined;
      const sig = extName ? this.topLevelFns.get(extName) : undefined;
      if (extName && sig) {
        this.ledger.record("A3", "extension-devirt", node, "extension method devirtualized to a free call on its first parameter (Q4 static case)");
        return { src: node, ctype: sig.ret, kind: "c-call", callee: { kind: "free", cName: mangleC(extName), params: sig.params, ret: sig.ret }, args: [recv, ...cArgs] };
      }
      // DECLARED, but with no static lowering -> the DYNAMIC arm, which already implements it.
      //
      // This is the fix for an inversion: `ll_dyn_method` handles `map`/`filter`/`reduce`/
      // `lastIndexOf` on a vec, but they were only reachable through a BOXED receiver. A statically
      // typed one looked up NATIVE_METHODS, missed, and refused -- so TYPING THE RECEIVER LOST
      // CAPABILITY, and `(xs.map f)` compiled or not depending on whether inference had reached `xs`.
      //
      // Gated on the member being DECLARED in the shared table rather than falling back blindly: an
      // undeclared name must stay a compile-time refusal, because `ll_dyn_method` answers an unknown
      // name with a field read and then traps. Routing everything would turn fail-closed into
      // fail-open, which is strictly worse than the gap it fixes.
      if (nativeMemberDeclared(baseKey, method)) {
        this.ledger.record("A3", "method-dyn-fallback", node, `'${baseKey}.${method}' is declared but has no static C lowering -- routed through ll_dyn_method`);
        const dyn = NATIVE_METHODS.get("dyn.method")!;
        const nameLit: CExpr = { src: node, ctype: C_STR, kind: "c-lit", lit: "str", value: method };
        const boxed: CExpr = { src: node, ctype: C_VALUE, kind: "c-box", inner: recv, from: recv.ctype };
        return { src: node, ctype: dyn.ret, kind: "c-call", callee: { kind: "intrinsic", ...dyn }, args: [boxed, nameLit, ...cArgs] };
      }
      throw this.refuse(node, `method:${baseKey}.${method}`, "resolveNativeMethod");
    }

    // Pad optional trailing args (slice end) with the runtime's END sentinel.
    while (cArgs.length + 1 < def.params.length) {
      cArgs.push({ src: node, ctype: C_INT, kind: "c-lit", lit: "int", value: "LL_END" });
    }
    return { src: node, ctype: def.ret, kind: "c-call", callee: { kind: "intrinsic", ...def }, args: [recv, ...cArgs] };
  }

  private mkBinop(op: string, lhs: CExpr, rhs: CExpr, src: ast.ASTNode, intDiv = false): CExpr {
    const canonOp = op === "≠" ? "!=" : op;
    // A user `:operator` overload on a struct/class LEFT operand -> a direct devirtualized call (Q4:
    // extensions/operators resolve statically when the operand type is known). Both shapes call
    // `opfn(lhs, rhs)`: a method op takes lhs as self, a top-level op takes both as params.
    if (lhs.ctype.k === "obj") {
      const overload = this.operators.get(`${canonOp}:${lhs.ctype.className}`);
      if (overload) {
        this.ledger.record("A3", "operator-call", src, "operator overload dispatched statically to a direct call");
        // D88/N3, the MIRROR case: the overload is the left's, and the right needs promoting into the
        // operand type it declares -- `(+ 1/2 1)`. The checker already accepts it, because
        // `isAssignable` consults `:implicit` casts when matching the parameter; without this the
        // backend then emitted a `c-cast int -> obj` that has no lowering, so the two stages agreed
        // the program was valid and only one of them could produce it.
        const want = overload.otherCType;
        if (want?.k === "obj" && rhs.ctype.k !== "obj") {
          const promotedRhs = this.implicitConvert(rhs, want.className, src);
          if (promotedRhs) rhs = promotedRhs;
        }
        return {
          src, ctype: overload.ret, kind: "c-call",
          // The right param is the operator's DECLARED operand type, NOT the concrete `rhs.ctype`: a
          // union/`Any` operand is a boxed `ll_value` in the emitted signature, so declaring it lets
          // InsertCoercions box `rhs` to match (§20). Identical to before for a concrete operand.
          callee: { kind: "free", cName: overload.cName, params: [lhs.ctype, overload.otherCType ?? rhs.ctype], ret: overload.ret },
          args: [lhs, rhs],
        };
      }
    }
    // D88/N3 -- PROMOTION. The lookup above asks only the LEFT operand, so `(+ 1 1/2)` asked `Int` and
    // came away empty: the overload lives on `Rational`. If the RIGHT operand owns the operator and
    // the left has an `:implicit` defcast to it, convert the left and dispatch. The checker's
    // `promoteOperand` decides the same thing on the same evidence; this materializes the call it
    // implied, so the two cannot disagree about whether the program type-checked.
    const promoted = this.promoteBinop(canonOp, lhs, rhs, src);
    if (promoted) return promoted;

    const mode = this.binopMode(canonOp, lhs, rhs, src, intDiv);
    const ctype = this.binopCType(canonOp, mode);
    return { src, ctype, kind: "c-binop", op: canonOp, mode, lhs, rhs };
  }

  /** The l-lang type NAME a C type stands for, for building a `__cast_<S>_to_<T>` lookup. */
  private static typeNameOfCType(t: CType): string | undefined {
    switch (t.k) {
      case "int": return "Int";
      case "real": return "Real";
      case "str": return "String";
      case "bool": return "Boolean";
      case "char": return "Char";
      case "obj": return t.className;
      default: return undefined;
    }
  }

  /**
   * `expr` converted to the l-lang type `to` through its `:implicit` defcast, or undefined if there
   * is none. The conversion is an ordinary function -- the AstBuilder rewrites a `defcast` into
   * `__cast_<S>_to_<T>` -- so this lowers it on demand exactly as any other imported body and adds no
   * cast machinery of its own.
   */
  private implicitConvert(expr: CExpr, to: string, src: ast.ASTNode): CExpr | undefined {
    const from = ResolveHirToCir.typeNameOfCType(expr.ctype);
    if (!from || from === to) return undefined;
    const castName = `__cast_${from}_to_${to}`;
    const entry = this.resolveSymbolSafe(castName, src);
    if (!entry || this.isExtern(entry) || (entry.value as any)?._type !== "function") return undefined;
    if (!(entry.value as ast.FunctionNode).modifiers?.some((m) => m.modifier === "implicit")) return undefined;
    const alias = this.lowerImportedFunction(castName, entry.value as ast.FunctionNode);
    const sig = this.topLevelFns.get(alias);
    if (!sig) return undefined;
    this.ledger.record("A6", "operand-promotion", src, `'${from}' promoted to '${to}' via an :implicit defcast at an operator operand`);
    return {
      src, ctype: sig.ret, kind: "c-call",
      callee: { kind: "free", cName: mangleC(alias), params: sig.params, ret: sig.ret },
      args: [expr],
    };
  }

  /**
   * `lhs op rhs` where the OVERLOAD belongs to `rhs`'s class and `lhs` converts into it.
   *
   * The conversion is an ordinary function: a `defcast` is rewritten by the AstBuilder into
   * `__cast_<S>_to_<T>`, so this looks the name up and lowers it on demand exactly as any other
   * imported body -- no cast machinery of its own, which is the point. `:implicit` was always the
   * declaration for this; it had simply never been consulted at an operand position.
   */
  private promoteBinop(op: string, lhs: CExpr, rhs: CExpr, src: ast.ASTNode): CExpr | undefined {
    if (rhs.ctype.k !== "obj") return undefined;
    const overload = this.operators.get(`${op}:${rhs.ctype.className}`);
    if (!overload) return undefined;
    const converted = this.implicitConvert(lhs, rhs.ctype.className, src);
    if (!converted) return undefined;
    return {
      src, ctype: overload.ret, kind: "c-call",
      callee: { kind: "free", cName: overload.cName, params: [converted.ctype, overload.otherCType ?? rhs.ctype], ret: overload.ret },
      args: [converted, rhs],
    };
  }

  private binopMode(op: string, l: CExpr, r: CExpr, src: ast.ASTNode, intDiv = false): BinopMode {
    const lt = l.ctype, rt = r.ctype;
    if (op === "&&" || op === "||") return "bool";
    if (op === "+" && (lt.k === "str" || rt.k === "str")) return "str-concat";
    if (["+", "-", "*", "/", "%"].includes(op)) {
      if (op === "/") {
        // A BOXED OPERAND IS CHECKED FIRST, like every other operator below. This `return` used to
        // come before that check, so `/` was the one arithmetic operator that narrowed an Unknown --
        // and it narrowed it to `real`, unconditionally. The result was a SILENT WRONG ANSWER whose
        // shape is the worst kind: the same expression answered differently depending on whether its
        // operands happened to be statically typed.
        //
        //     (/ 7 2)  statically Int/Int   ->  3      (mode "int", ll_idiv)
        //     (/ 7 2)  through an Unknown   ->  3.5    (mode "real", ll_unbox_real on an LL_INT)
        //
        // JS answers 3 for both -- Int is a BigInt there, so the shim's runtime dispatch divides two
        // BigInts and truncates. Falling to "boxed" routes through `ll_op_div`, which dispatches on
        // the actual tags exactly as `+`/`-`/`*` already did, and inherits D85's guards with it: a
        // zero divisor PANICS instead of yielding Infinity, and INT64_MIN/-1 wraps per D51.
        if (lt.k === "value" || rt.k === "value") {
          this.ledger.record("A6", "boxed-arith", src, "boxed operand in division; runtime tag dispatch (cannot narrow an Unknown)");
          return "boxed";
        }
        // D49d: `Int / Int` is integer division. The decision is the NODE's (h.intDiv), not something
        // re-derived from CIR ctypes here -- deriving it locally is how the two backends first
        // disagreed: C read int/int off the ctypes for `(/ (round x) 100)` and truncated, while JS read
        // the HIR types, saw non-Int, and did not. int64_t `/` truncates toward zero, matching the
        // Math.trunc JS emits. That hazard is a STATIC one and does not reach the boxed branch above,
        // where neither backend has a type to read and both dispatch on the runtime tag.
        return intDiv ? "int" : "real";
      }
      if (lt.k === "int" && rt.k === "int") return "int";
      if (NUMERIC(lt) && NUMERIC(rt)) return "real";
      // A boxed operand CANNOT be narrowed to a native type here -- its runtime Int/Real is unknown,
      // so unboxing it as the guessed type would trap. Use the generic runtime op (the JS shim's
      // native tail), which dispatches on the actual tag and preserves int-ness; the RESULT is boxed
      // and unboxed at its use site off the checker's type (the A6 coercion the boxing forces).
      if (lt.k === "value" || rt.k === "value") {
        this.ledger.record("A6", "boxed-arith", src, "boxed operand in arithmetic; runtime tag dispatch (cannot narrow an Unknown)");
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
      // A boxed operand CANNOT be safely narrowed here: its runtime type (Int vs Real) is unknown, so
      // guessing from the partner would unbox a Real as an Int and trap. Dispatch on the actual tag
      // at run time (the JS operator-shim's native tail) -- the coercion the boxing forces (A6/A3).
      if (lt.k === "value" || rt.k === "value") {
        this.ledger.record("A6", "boxed-compare", src, "boxed operand in comparison; runtime tag dispatch (cannot narrow an Unknown)");
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
    // D49a: `-> Void` binds -- the implicit-return desugar no longer wraps such a body, so a Void
    // function really does return nothing and C emits a real `void`. This used to widen to ll_value
    // because the tail WAS returned, which is what made `-> Void` unenforceable.
    return mapped;
  }

  // -- functions ------------------------------------------------------------------------------------

  /** Refuse a coroutine (A8); returns true if refused. */
  /**
   * A user `defmodifier` applied to a declaration -- refuse rather than silently drop it.
   *
   * A custom modifier is a DECORATOR: `(fn :retry[4] task [] ...)` means
   * `__ll_modifier_retry(4)(task)`, which is what the JS backend emits. The C backend has no
   * application mechanism at all, and was quietly emitting the UNDECORATED function -- so `:retry`
   * never retried, `:logged` never logged, and `:memoized` recomputed on what its own golden calls a
   * cache hit. Silent wrong answers, and exactly what this pass's hard-fail posture exists to prevent.
   *
   * A modifier declared with an EMPTY body is a genuine identity -- there is nothing to apply, so
   * ignoring it is correct rather than a guess, and `(defmodifier identity [])` still compiles. Any
   * modifier with a body, or one this module cannot see to prove empty, refuses.
   */
  private refuseCustomModifier(fn: ast.FunctionNode, name: string): boolean {
    for (const m of fn.modifiers ?? []) {
      if (isBuiltinModifier(m.modifier)) continue;
      // D72 -- an ATTRIBUTE is annotation data, so there is nothing here to refuse. It reaches the
      // reflection graph and emits no code, which is what makes this backend's support for
      // annotations real rather than pending: the hard part of D68 is the DECORATOR, and this
      // separates the two so C stops rejecting both for the sins of one.
      if (this.attributeNames.has(m.modifier)) continue;
      if (this.emptyModifiers.has(m.modifier)) continue;
      this.refuse(fn, `modifier:${m.modifier} on '${name}'`, "collectFunction");
      return true;
    }
    return false;
  }

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
  /** A lone `(fn …)` expression arrives wrapped in list(s); peel until it is not a 1-element list. */
  private unwrapExpr(n: ast.ASTNode | undefined): ast.ASTNode | undefined {
    let cur = n;
    for (let i = 0; i < 8; i++) {
      if (cur?._type !== "list") return cur;
      const nodes = (cur as ast.ListNode).nodes ?? [];
      if (nodes.length !== 1) return cur;
      cur = nodes[0];
    }
    return cur;
  }

  /**
   * D75's shape: `SETUP… (fn [original ...args] BODY)`.
   *
   * Flat, so this is one check rather than a walk through a nesting nobody specified -- which is the
   * whole reason D75 was ratified before this code was written. The previous, curried contract had to
   * be reverse-engineered, and the first attempt got it wrong.
   */
  private decoratorShape(
    modName: string
  ): { setup: ast.ASTNode[]; wrapper: ast.FunctionNode } | undefined {
    const def = this.modifierDefs.get(modName);
    if (!def?.body?.length) return undefined;
    const last = this.unwrapExpr(def.body[def.body.length - 1]);
    if (last?._type !== "function") return undefined;
    const w = last as ast.FunctionNode;
    if (!(w.params ?? []).length) return undefined;   // must take `original` at least
    return { setup: def.body.slice(0, -1), wrapper: w };
  }

  /**
   * A DECORATED function, unfolded STATICALLY (D75).
   *
   *     (defmodifier logged [] (fn [original ...args] BODY))
   *     (fn :logged add [a b] ORIG)
   *
   * becomes two ordinary C functions: `add__w0` holding ORIG, and `add` holding BODY with `original`
   * bound to `add__w0`. Dynamic composition would instead make the decorated NAME a value, needing a
   * trampoline, boxed dispatch at every call, and a change to call classification in the shared HIR.
   * Unfolded, a decorated function never stops being a direct, typed C function.
   *
   * The renaming is free here because the backend already owns the source-name -> cName map, which is
   * why this lives in the backend rather than in a source rewrite: no synthesized node ever needs a
   * `_parent`.
   *
   * Modifiers apply in SOURCE ORDER, innermost first, matching what the JS path composes.
   */
  private collectDecorated(fn: ast.FunctionNode, name: string): boolean {
    const decorators = (fn.modifiers ?? []).filter(
      (m) => !isBuiltinModifier(m.modifier) && !this.attributeNames.has(m.modifier) && !this.emptyModifiers.has(m.modifier)
    );
    if (decorators.length === 0) return false;

    const shapes = decorators.map((m) => ({ mod: m, shape: this.decoratorShape(m.modifier) }));
    const bad = shapes.find((s) => !s.shape);
    if (bad) {
      this.refuse(fn, `decorator-shape:${bad.mod.modifier} on '${name}'`, "collectDecorated");
      return true;
    }
    // Decoration-time SETUP hoisting is the next step; refused by name meanwhile rather than dropped,
    // because dropping it silently would give every call a fresh cache.
    const stateful = shapes.find((s) => s.shape!.setup.length > 0);
    if (stateful) {
      this.refuse(fn, `decorator-setup:${stateful.mod.modifier} on '${name}'`, "collectDecorated");
      return true;
    }

    this.emitLayer(fn, `${name}__w0`, fn, undefined);
    let prev = `${name}__w0`;
    shapes.forEach((s, i) => {
      const layer = i === shapes.length - 1 ? name : `${name}__w${i + 1}`;
      this.emitLayer(fn, layer, s.shape!.wrapper, {
        prev,
        mod: s.mod,
        modParams: this.modifierDefs.get(s.mod.modifier)!.params ?? [],
      });
      prev = layer;
    });
    return true;
  }

  /** One unfolded layer. `bind` is absent for the undecorated body and present for each wrapper. */
  private emitLayer(
    src: ast.FunctionNode,
    cname: string,
    shapeFn: ast.FunctionNode,
    bind: { prev: string; mod: ast.ModifierNode; modParams: ast.ParameterNode[] } | undefined
  ): void {
    // A wrapper's own parameters are `...args` -- everything after `original`, which is bound below
    // rather than passed.
    const params = bind ? (shapeFn.params ?? []).slice(1) : shapeFn.params ?? [];
    const synth = { ...shapeFn, params, name: { ...(src.name as any), id: cname }, modifiers: [] } as ast.FunctionNode;
    this.ownFns.add(cname);
    // The pre-scan already registered the PUBLIC name with the undecorated function's signature, and
    // `registerTopLevel` early-returns on a name it knows. A wrapper's signature is its own
    // (`...args` packs to one vec), so the stale entry has to go or call sites are typed against a
    // function that is no longer there -- measured as "too few arguments to function call".
    this.topLevelFns.delete(cname);
    this.registerTopLevel(synth, cname);
    const sig = this.topLevelFns.get(cname)!;
    this.isolated(synth, () => {
      const cParams: CParam[] = synth.params.map((p, i) => this.declareParam(p, sig.params[i]));
      const prologue: CStmt[] = [];
      if (bind) {
        // `original` is the previous layer AS A VALUE, so `(original ...args)` resolves through
        // `resolveFreeCall`'s local-callee branch -- the closure path, which is right because the
        // wrapper does not know the original's arity.
        const oc = mangleC(ast.symbolName((shapeFn.params ?? [])[0].name as ast.IdentifierNode));
        this.declareLocal(oc, C_VALUE);
        prologue.push({ src, ctype: C_VOID, kind: "c-decl", cName: oc, declCType: C_VALUE, init: this.functionValue(src, bind.prev), cell: false });
        // `:retry[4]` makes the modifier's own `times` the constant 4 -- the point of unfolding.
        bind.modParams.forEach((p, i) => {
          const argNode = bind.mod.args?.[i];
          if (!argNode) return;
          const pc = mangleC(ast.symbolName(p.name as ast.IdentifierNode));
          const val = this.resolveAstExpr(argNode);
          this.declareLocal(pc, val.ctype);
          prologue.push({ src, ctype: C_VOID, kind: "c-decl", cName: pc, declCType: val.ctype, init: val, cell: false });
        });
      }
      const body = this.resolveFunctionBody(synth);
      this.functions.push({ src, cName: mangleC(cname), params: cParams, ret: sig.ret, body: { stmts: [...prologue, ...body.stmts] } });
    });
  }

  private registerTopLevel(fn: ast.FunctionNode, name: string): void {
    if (this.topLevelFns.has(name)) return;
    const symT = this.dipSymbols("A3", "function-signature", fn, "signature resolved through the symbol table (not on the HIR)", name)?.inferredType;
    const symParams: any[] = symT?.kind === "function" ? symT.params ?? [] : [];
    const params = fn.params.map((p, i) => {
      // A REST parameter is always the vec the call site packs -- never whatever the annotation or
      // the checker says the ELEMENTS are. `[...args <- Any[]]` happens to agree; `[...args]` (no
      // annotation) would otherwise land on boxed `value` and the packed vec would not fit.
      if (p.spread) return VEC_OF_VALUE;
      const sigT = symParams[i] ? mapType(symParams[i]) : undefined;
      return (sigT && sigT.k !== "value" ? sigT : undefined) ?? this.ctypeFromAnnotation(p) ?? sigT ?? C_VALUE;
    });
    const restAt = fn.params.findIndex((p) => p.spread);
    const ret = this.userFnRet(symT, fn) ;
    // Prefer a CONCRETE annotated return over a boxed symbol type -- but NEVER downgrade to `void`:
    // a `-> Void` (or inferred-Void) function may still return values the checker missed, so it stays
    // boxed `ll_value` (userFnRet already yielded that). A void C return would reject `return <v>`.
    const annotatedRet = this.typeNodeToCType(fn.returns);
    const useAnnotated = ret.k === "value" && annotatedRet && annotatedRet.k !== "void";
    this.topLevelFns.set(name, {
      params,
      // D58: a `:gen` returns its FRAME INSTANCE, boxed -- never whatever `-> Iterator<T>` maps to.
      // The declared return type describes the SEQUENCE the generator produces, not the value the
      // call hands back, and those are different things in every language that has both.
      ret: isGenerator(fn) ? C_VALUE : useAnnotated ? annotatedRet! : ret,
      arity: fn.params.length,
      restAt: restAt >= 0 ? restAt : undefined,
    });
  }

  /** Pre-scan the module body: register every top-level function BEFORE resolving (forward refs).
   *  A generator/async function is registered too (with a stub signature) so its call sites resolve
   *  without crashing -- the whole compilation is refused (LL0105) and the output nulled regardless. */
  private registerModuleFunctions(items: ast.ASTNode[]): void {
    for (const n of items) {
      if (n?._type === "function" && (n as ast.FunctionNode).name
          && !(n as ast.FunctionNode).modifiers?.some((m) => m.modifier === "operator")) {
        const nm = ast.symbolName((n as ast.FunctionNode).name);
        // This module runs first, so it always keeps the bare name; the claim is what makes a LATER
        // import with the same private name step aside instead of overwriting it.
        this.aliasFor(nm, this.rootSource ?? "");
        this.ownFns.add(nm);
        this.registerTopLevel(n as ast.FunctionNode, nm);
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
    if (isGenerator(fn) && fn.name) { this.collectGenerator(fn, name); return; }
    if (this.refuseCoroutine(fn, name)) return;
    if (!fn.name) { this.refuse(fn, "lambda", "collectFunction"); return; }
    // A top-level `:operator` function compiles under its operator symbol, not its `+` name.
    if (fn.modifiers?.some((m) => m.modifier === "operator")) { this.collectOperatorFn(fn); return; }
    if (this.collectDecorated(fn, name)) return;
    if (this.refuseCustomModifier(fn, name)) return;
    this.registerTopLevel(fn, name);
    const sig = this.topLevelFns.get(name)!;
    this.isolated(fn, () => {
      const params: CParam[] = fn.params.map((p, i) => this.declareParam(p, sig.params[i]));
      const prologue = this.paramCopyPrologue(fn, params);
      const body = this.resolveFunctionBody(fn);
      this.functions.push({ src: fn, cName: mangleC(name), params, ret: sig.ret, body: { stmts: [...prologue, ...body.stmts] } });
    });
  }

  /**
   * D58: a `:gen` declaration -> a synthesized frame CLASS, a step function, and a factory.
   *
   * The three pieces, and why each is where it is:
   *
   *   THE CLASS is the generator instance. Its fields ARE the frame -- slot 0 the state, the rest
   *   every param and local -- because `ll_obj` is already a header plus boxed slots and
   *   `ll_obj_new` already nil-fills what the caller does not supply. It carries no method table:
   *   `ll_iter`/`ll_next` read `is_gen`/`gen_step` off the descriptor instead of dispatching by
   *   name, which is the per-element path of every lazy pipeline.
   *
   *   THE STEP FUNCTION is the body, re-enterable: a dispatch prologue jumps to the label of the
   *   suspend it stopped at, and the body around it is emitted completely unchanged (`LowerCoroutines`
   *   explains why that works, `promoteFrame` why it is safe).
   *
   *   THE FACTORY keeps the original name, arity and modifiers, so `(fn :extension :gen map<T> ...)`
   *   still dispatches as an extension and every call site is untouched. It allocates the frame with
   *   state 0 and the params in slot order -- one `ll_obj_new`, no store sequence.
   *
   * A refusal from either half is caught here so it names the FUNCTION and the shape, rather than
   * surfacing as an unmodeled-construct error pointing at an expression.
   */
  private collectGenerator(fn: ast.FunctionNode, name: string): void {
    if (this.refuseCustomModifier(fn, name)) return;
    this.registerTopLevel(fn, name);
    const sig = this.topLevelFns.get(name)!;
    const cName = mangleC(name);
    const tag = `__ll_gen_${cName}`;
    const stepName = `${tag}_step`;
    const sourceName = (fn as any).__ll_source_name ?? ast.symbolName(fn.name!);
    const frameCType: CType = { k: "obj", className: tag };
    try {
      let params: CParam[] = [];
      let promoted!: PromotedFrame;
      let states: number[] = [];
      this.isolated(fn, () => {
        const saved = this.inGenerator;
        this.inGenerator = true;
        try {
          params = fn.params.map((p, i) => this.declareParam(p, sig.params[i]));
          const lowered = lowerCoroutine(this.hirBodyFor(fn), fn);
          states = lowered.states;
          const body = this.resolveBlock(lowered.body);
          promoted = promoteFrame(body, params, fn);
        } finally {
          this.inGenerator = saved;
        }
      });
      const self: CExpr = { src: fn, ctype: frameCType, kind: "c-ref", cName: "__f" };
      // Falling off the end MUST park the machine, or the next pull would dispatch back to the last
      // suspend's label and re-run the tail forever. The dispatch's `default` arm answers nil from
      // then on; `DONE` is simply any state the switch does not name.
      promoted.body.stmts.push(
        { src: fn, ctype: C_VOID, kind: "c-assign", target: { kind: "field", object: self, slot: STATE_SLOT, fieldName: "state" }, value: { src: fn, ctype: C_INT, kind: "c-lit", lit: "int", value: String(GEN_DONE) } },
        { src: fn, ctype: C_VOID, kind: "c-return", value: { src: fn, ctype: C_VALUE, kind: "c-nil" } },
      );
      const dispatched = states.length
        ? promoted.body
        : { stmts: promoted.body.stmts }; // a `:gen` with no yield: an empty sequence, no prologue
      this.functions.push({
        src: fn, cName: stepName, params: [{ cName: "__f", ctype: frameCType }], ret: C_VALUE, body: dispatched,
      });
      this.genClasses.push({
        name: tag,
        sourceName,
        isStruct: false,
        // Slot order IS the frame layout, state first (see promoteFrame). Every slot is declared
        // boxed because that is what an `ll_obj` field is; the reader's static type comes back
        // through P2's unbox at the `c-field-get`.
        fields: promoted.slots.map((s) => ({ name: s.cName, ctype: C_VALUE })),
        methods: [],
        genStep: stepName,
      });
      // The factory: `ll_obj_new(&__ll_class_<tag>, 1 + argc, {0, ...params})`.
      const zero: CExpr = { src: fn, ctype: C_INT, kind: "c-lit", lit: "int", value: "0" };
      const make: CExpr = {
        src: fn, ctype: frameCType, kind: "c-construct", className: tag, isStruct: false,
        args: [zero, ...params.map((p) => ({ src: fn, ctype: p.ctype, kind: "c-ref", cName: p.cName } as CExpr))],
        fieldCount: promoted.slots.length,
      };
      this.functions.push({
        src: fn, cName, params, ret: C_VALUE,
        body: { stmts: [{ src: fn, ctype: C_VOID, kind: "c-return", value: make }] },
      });
    } catch (e) {
      if (e instanceof CoroutineRefusal || e instanceof FramePromotionRefusal) {
        this.refuse(fn, `generator '${name}': ${e.message}`, "collectGenerator");
        return;
      }
      throw e;
    }
  }

  /** The lowered HIR body for a function -- the pre-lowered one when the pipeline produced it, else
   *  lowered on demand (which is how every IMPORTED body arrives, `std/iter/linq` included). */
  private hirBodyFor(fn: ast.FunctionNode): HBlock {
    const pre = this.hir.bodyFor(fn);
    if (pre) return pre;
    this.ledger.record("A3", "on-demand-lower", fn, "function body not pre-lowered; lowered on demand");
    return new LowerAstToHirVisitor(this.context, `__ll_hir_i${this.liftCounter}`).lowerBody(fn.body ?? []);
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

  /** Ensure a class NAME has a C descriptor + lowered methods, registering it ON DEMAND if it was
   *  defined in an IMPORTED module (`(new Vector3 ...)` where Vector3 lives in std/math). The
   *  class-level analog of lowerImportedFunction (A9's imported-body): the symbol table carries the
   *  imported class's AST node on `entry.value`, so collectClassMembers builds the descriptor and
   *  lowers its methods/operators the same way a local class's are. Returns whether `name` is now a
   *  known class. Idempotent: once registered, later calls short-circuit (no duplicate lowering). */
  private ensureClassRegistered(name: string, node: ast.ASTNode): boolean {
    if (this.classes.has(name)) return true;
    const entry = (() => { try { return this.context.symbolTable.resolveSymbol(name as any, node as any); } catch { return undefined; } })();
    const val = entry?.value as ast.ASTNode | undefined;
    if (val && (val._type === "struct" || val._type === "class") && !this.isExtern(entry)) {
      // The idempotence check above is keyed on the SPELLED name, but `collectClassMembers` registers
      // under the DEFINITION's own name. Those agree for every unaliased import and part company
      // under `(import { Widget :as Gadget } ...)`: `classes.has("Gadget")` stayed false however many
      // times the class was lowered, so every reference lowered it again and C got
      // `redefinition of '__ll_method_Widget_describe'`. Register once, under the declared name, then
      // point the spelled name at the SAME descriptor -- an alias is a second name for one
      // definition, never a second definition.
      const declared = ast.symbolName((val as any).name) ?? name;
      if (!this.classes.has(declared)) {
        // Register the `:extends` PARENT first (E2). An imported class was registered on demand but
        // its parent never was, so registering an imported `IndexError` left `ValueError` absent from
        // the class registry -- the `ll_is_type` chain walk could not find it (a `catch :of ValueError`
        // on a thrown `IndexError` matched nothing), and `collectClassMembers`' field flattening had no
        // parent layout to inherit `message` from. Recurse the chain here; it terminates at the ambient
        // `Error` -- itself an l-lang class now (std/core/errors, F1), which `registerBuiltinClasses`
        // registers up front through this very path, so the `classes.has` guard short-circuits. (Before
        // F1 `Error` was a `let :extern` and this recursion bottomed out at a synthetic builtin.)
        // Idempotent via the `classes.has` guard, so a diamond or a re-reference does not loop.
        const parent = this.extendsName(val as ast.StructNode | ast.ClassNode);
        if (parent && !this.classes.has(parent)) this.ensureClassRegistered(parent, node);
        this.ledger.record("A9-extern", "imported-class", node, `imported class '${declared}' registered + methods lowered on demand (class analog of imported-body)`);
        this.collectClassMembers(this.desugaredCopyOf(val) as ast.StructNode | ast.ClassNode);
      }
      const desc = this.classes.get(declared);
      if (desc && declared !== name) this.classes.set(name, desc);
      return this.classes.has(name);
    }
    return false;
  }

  /** If an HExpr is merely a reference to a class NAME (local or imported), return that name -- used to
   *  recognize the ANF-hoisted head of a `new` (`__ll_hir_N = Inventory`), which is not a value. */
  private classNameOf(h: HExpr | null | undefined): string | undefined {
    if (!h) return undefined;
    let name: string | undefined;
    let node: ast.ASTNode | undefined;
    if (h.kind === "ref") { name = h.name; node = h.src; }
    else if (h.kind === "opaque-expr" && (h.src as any)?._type === "simple-identifier") { name = (h.src as any).id; node = h.src; }
    if (!name) return undefined;
    if (this.classes.has(name)) return name;
    const entry = (() => { try { return this.context.symbolTable.resolveSymbol(name as any, node as any); } catch { return undefined; } })();
    const v = entry?.value as any;
    return (v && (v._type === "struct" || v._type === "class") && !this.isExtern(entry)) ? name : undefined;
  }

  /** A DESUGARED clone of a node pulled from the symbol table. `symbol.value` is the PRE-desugar parse
   *  tree (the symbol table is built before the desugar stage), so an imported function/method body has
   *  NO implicit return -- `(fn sqr [x] (* x x))` would lower to `(* x x); return nil`. Clone (never
   *  mutate the shared tree; `_parent` stays by reference to keep the lexical walk working) then run the
   *  implicit-return desugaring, exactly as the JS backend's `desugaredCopyOf` does for the same reason.
   *  Applies to classes too: their methods are function bodies like any other. */
  private desugaredCopyOf<T extends ast.ASTNode>(node: T): T {
    const copy = new DesugarAstVisitor(this.context, true).visit(this.cloneNode(node)) as unknown as T;
    this.carryTypesInto(copy, node);
    return copy;
  }

  /**
   * Give the copy the TYPES its original carries (the C analog of S1a / N14, mirroring the JS backend's
   * `JSTransformerAstVisitor.carryTypesInto` byte-for-byte).
   *
   * `context.nodeTypes` is identity-keyed, and `desugaredCopyOf` produces objects that by construction
   * have no identity in it: `cloneNode` mints a fresh tree and the desugarer then rebuilds parts of it.
   * So every IMPORTED body -- which the C backend re-lowers on demand from exactly such a clone
   * (`hirBodyFor` -> `LowerAstToHirVisitor.lowerBody`) -- arrived at the HIR lowering completely
   * untyped, and every type-driven decision silently degraded. The one that changed answers: `(/ Int
   * Int)` is INTEGER division decided from the static operand types (D49d,
   * `LowerAstToHirVisitor.isIntDivision`), so with the types gone it fell to `real` division and a
   * function declared `-> Int` divided as `double` -- silently right below 2^53, wrong above it; and in
   * an imported METHOD assigning the quotient to an `Int` field, a hard `TypeError` trap (ledger §15.2 /
   * §15.7). The JS side of the same bug was fixed by S1a; this is its C twin, in the one clone helper
   * both imported-body paths (`lowerImportedFunction`, imported-class `collectClassMembers`) funnel
   * through.
   *
   * MATCHED ON KIND + EXACT SOURCE SPAN, once, between two trees already known to correspond. A copy
   * preserves the span each construct occupies, and two constructs of the same kind cannot occupy the
   * same span in one file, so the correspondence is exact rather than heuristic. Nothing is invented:
   * only nodes the ORIGINAL was given a type for get one, and an existing entry is never overwritten.
   *
   * Depends on `SymbolTable.repointAfterDesugar` (S1a) having run: until `symbol.value` points at the
   * DESUGARED, typed tree, the original passed here carries no types and there is nothing to carry.
   */
  private carryTypesInto(copy: ast.ASTNode, original: ast.ASTNode): void {
    const nodeTypes = this.context?.nodeTypes;
    if (!nodeTypes || nodeTypes.size === 0) return;

    const key = (n: any): string | undefined => {
      const s = n?._location?.start?.offset;
      const e = n?._location?.end?.offset;
      if (s === undefined || e === undefined) return undefined;
      return `${n._type}@${s}..${e}`;
    };

    const walk = (n: any, seen: Set<any>, visit: (n: any) => void): void => {
      if (!n || typeof n !== "object" || seen.has(n)) return;
      seen.add(n);
      if (n._type) visit(n);
      for (const prop of Object.keys(n)) {
        if (prop === "_parent" || prop === "_location") continue;
        const v = n[prop];
        if (Array.isArray(v)) v.forEach((x) => walk(x, seen, visit));
        else if (v && typeof v === "object") walk(v, seen, visit);
      }
    };

    // Index the original's types by kind+span. First writer wins, matching the copy's own walk order.
    const byKey = new Map<string, InferredType>();
    walk(original, new Set(), (n) => {
      const t = nodeTypes.get(n);
      const k = key(n);
      if (t !== undefined && k !== undefined && !byKey.has(k)) byKey.set(k, t);
    });
    if (byKey.size === 0) return;

    walk(copy, new Set(), (n) => {
      if (nodeTypes.has(n)) return; // already answered -- never overwrite
      const k = key(n);
      const t = k === undefined ? undefined : byKey.get(k);
      if (t !== undefined) this.context.recordSynthesizedNodeType(n, t);
    });
  }

  private cloneNode<T extends ast.ASTNode>(n: T): T {
    const clone = (v: any): any => {
      if (Array.isArray(v)) return v.map(clone);
      if (!v || typeof v !== "object") return v;
      const out: any = {};
      for (const k of Object.keys(v)) out[k] = k === "_parent" ? v[k] : clone(v[k]);
      return out;
    };
    return clone(n) as T;
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
    // A REST parameter overrides both: it receives the vec the call site packs (see packRestArgs),
    // and must match `registerTopLevel`'s view of the same parameter.
    const annotated = this.ctypeFromAnnotation(p);
    const ctype = p.spread ? VEC_OF_VALUE : (sigT && sigT.k !== "value" ? sigT : undefined) ?? annotated ?? sigT ?? C_VALUE;
    if (ctype.k === "value") this.ledger.record("A1", "param-untyped", p, "parameter type unavailable; boxed");
    const cName = mangleC(ast.symbolName(p.name as ast.IdentifierNode));
    // A param captured mutably by a nested closure must be a cell (the mut-capture channel again).
    const cell = this.cellVars.has(cName);
    this.declareLocal(cName, cell ? C_VALUE : ctype, false, cell);
    return p.spread ? { cName, ctype, rest: true } : { cName, ctype };
  }

  /** Map a parameter's AST type annotation to a CType -- a known struct/class -> obj, else primitive. */
  private ctypeFromAnnotation(p: ast.ParameterNode): CType | undefined {
    return this.typeNodeToCType(p.type);
  }

  /**
   * REST-parameter packing: `(f a b c)` against `(fn f [x ...rest])` becomes `f(a, ll_list(2, {b, c}))`.
   *
   * C has no rest parameter, so the callee takes a plain vec and the CALL SITE builds it -- which is
   * also what the JS backend gets for free from a `RestElement`. `ll_list` is the existing variadic
   * `list` intrinsic: it already returns a vec and, being variadic, makes P2 box every packed
   * argument to `ll_value` (InsertCoercions), which is exactly the element type a rest vec holds.
   *
   * Packing is UNCONDITIONAL, including when the sole trailing argument is itself a vec: `(f arr)`
   * binds `rest` to `[arr]`, not to `arr`, matching JS's `f(arr)` against `(...rest)`. Forwarding it
   * instead would be a silent one-element-off bug in exactly the case that looks like it should work.
   *
   * Note this is a lowering of the CALL, not a variadic C function: the emitted callee has a fixed
   * arity. That is the difference from an `intrinsic` marked `variadic`, which becomes a genuine C
   * varargs call and boxes at the call site without ever building an array -- the mechanism `print`
   * used to ride, and the reason it appeared to work while io.lisp's body was unreachable.
   */
  private packRestArgs(node: ast.ASTNode, sig: { restAt?: number }, cArgs: CExpr[]): CExpr[] {
    const at = sig.restAt;
    if (at === undefined) return cArgs;
    const packed: CExpr = {
      src: node,
      ctype: VEC_OF_VALUE,
      kind: "c-call",
      callee: { kind: "intrinsic", runtimeFn: "ll_list", variadic: true, params: [], ret: VEC_OF_VALUE },
      args: cArgs.slice(at),
    };
    return [...cArgs.slice(0, at), packed];
  }

  /** D11 copy-on-entry (A5): a struct-typed or boxed param is copied (passed by value). A native
   *  primitive, array or class-reference param is not (it is already a value or a shared reference). */
  private paramCopyPrologue(fn: ast.FunctionNode, params: CParam[]): CStmt[] {
    const out: CStmt[] = [];
    // The per-param copy decision rode the HIR node (A5, keyed by fn, in param order) -- consume it, no
    // re-derive, no dip. Guard on length so a mismatched param list (a synthetic prologue) falls back to
    // the raw ctype rule + the dip. The ctype guard stays either way (never c-copy a non-obj/value).
    const raw = this.hir.paramCopiesFor(fn);
    const copies = raw && raw.length === params.length ? raw : undefined;
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      if (p.ctype.k !== "value" && p.ctype.k !== "obj") continue;
      if (copies) {
        if (!copies[i]) continue; // node decision: no copy (e.g. a class param -- ll_copy would no-op)
      } else {
        this.ledger.record("A5", "param-copy", fn, "callee-side D11 copy-on-entry (a struct/boxed param passes by value)");
      }
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
    // C2: a nested `:gen` LOWERS now. `:async` is still refused by ruling (D60), which is what
    // `refuseCoroutine` is left guarding.
    if (isGenerator(fn)) return this.liftGenerator(fn, "<lambda>");
    if (this.refuseCoroutine(fn, "<lambda>")) return { src: fn, ctype: C_VALUE, kind: "c-nil" };
    return this.lift(fn);
  }

  /** A nested NAMED function declaration statement -> lift it and bind a local closure value. */
  private resolveNestedFnDecl(fn: ast.FunctionNode, modeled?: Extract<HExpr, { kind: "closure" }>): CStmt[] {
    const name = ast.symbolName(fn.name);
    // C2: a nested `:gen` declaration binds a FACTORY closure, exactly as a nested plain function
    // binds its own closure -- calling it makes a fresh frame, which is what per-instance state means.
    const closure = isGenerator(fn)
      ? this.liftGenerator(fn, name)
      : (this.refuseCoroutine(fn, name) ? null : this.lift(fn, modeled));
    if (closure === null) return [];
    const cName = mangleC(name);
    this.declareLocal(cName, closure.ctype, false, false);
    return [{ src: fn, ctype: C_VOID, kind: "c-decl", cName, declCType: closure.ctype, init: closure }];
  }

  /**
   * Lift a function (lambda or nested named): compute its captures against the CURRENT scopes, build
   * a top-level `ll_value fn(void* env, int argc, ll_value* argv)`, and return the closure-make. This
   * is the env the HIR does not model (spec A3 -- callee identity and closed-over state as a value).
   */
  private lift(fn: ast.FunctionNode, modeled?: Extract<HExpr, { kind: "closure" }>): CExpr {
    // A8: a NESTED `:gen`/`:async` refuses here, at the function, exactly as a top-level one does in
    // collectFunction. Without this the nested body was resolved anyway and its `yield` surfaced as
    // LL0106 "no CIR lowering exists for 'yield'" -- which files a modeled, deliberately-deferred
    // construct as an *unmodeled* one, mislabelling the ledger's refusal frontier. LL0105 is the
    // honest answer, and it names the function rather than pointing at an expression.
    if (this.refuseCoroutine(fn, fn.name ? ast.symbolName(fn.name) : "<anonymous>")) {
      throw new Refusal("coroutine");
    }
    if (!modeled) this.ledger.record("A3", "closure-lift", fn, "nested function lifted with an explicit captured environment (not in the HIR)");
    const id = this.liftCounter++;
    const baseName = fn.name ? mangleC(ast.symbolName(fn.name)) : "lam";
    const liftedName = `__ll_lam_${baseName}_${id}`;

    // Captures: free vars bound in an ENCLOSING (or the current) scope. Computed BEFORE we isolate.
    const captures: CCapture[] = [];
    const capType = new Map<string, { ctype: CType; cell: boolean }>();
    // The capture SET and each capture's MODE come from the node (D48/Q3). Without a modeled node --
    // an imported body lowered on demand -- fall back to deriving them here.
    const modeledCaptures = modeled?.captures.map((c) => c.name);
    for (const srcName of modeledCaptures ?? freeVariables(fn)) {
      const cName = mangleC(srcName);
      // A hoisted module global lives at C file scope, so the lifted function can name it directly.
      // Capturing it would copy it into the env and silently fork the mutation -- which is exactly
      // why such a binding used to be forced into a heap cell to compensate.
      if (this.globalDeclared.has(cName)) continue;
      const info = this.localInfo(cName);
      if (!info) continue; // a global / top-level fn / intrinsic -- resolved without capture
      // For a cell, capture the POINTER (c-ref with cell:false emits the bare `ll_value*` variable).
      const value: CExpr = { src: fn, ctype: info.cell ? C_VALUE : info.ctype, kind: "c-ref", cName, cell: false };
      captures.push({ field: cName, ctype: info.cell ? C_VALUE : info.ctype, value, cell: info.cell });
      capType.set(cName, { ctype: info.cell ? C_VALUE : info.ctype, cell: info.cell });
    }

    // Build the lifted params (typed) from the signature.
    const symT = modeled
      ? undefined
      : this.dipSymbols("A3", "lambda-signature", fn, "lambda signature resolved through the symbol table", fn.name ? ast.symbolName(fn.name) : "<lambda>")?.inferredType;
    const paramTs = modeled
      ? modeled.params.map((p) => p.type)
      : symT?.kind === "function" && symT.params ? symT.params : fn.params.map(() => undefined);

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
    const ret = modeled ? this.userFnRet({ kind: "function", returns: modeled.returnType } as any, fn) : this.userFnRet(symT, fn);
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

  /**
   * A NESTED `:gen` -- lift it as a closure whose call builds a coroutine frame (C2, spec A8).
   *
   * `collectGenerator` handles the top-level case: a frame class, a step function, and a plain C
   * factory. The only thing a nested one adds is CAPTURE, and the frame turns out to be the natural
   * place to put it -- `promoteFrame` promotes every param and local to a slot by ruling ("promote
   * everything", D58), so a captured binding is just another slot. Pass the captures alongside the
   * params and the promotion covers them; the step function then reads a capture exactly as it reads
   * a local, with no special case anywhere in the state machine.
   *
   * THE ONE THING THAT HAD TO CHANGE FOR THIS TO WORK is not here: a frame slot is an `ll_value`, and
   * a mutable capture used to be a bare `ll_value*`, which the value union has no arm for. Cells are
   * one-field OBJECTS now (see `ll_cell` in runtime.c), so they box into a slot like anything else.
   * The alternative -- an 11th tag on `ll_value` -- would have put a user-invisible arm through 47
   * `case LL_` sites, equality, copy and display, for something that must never be observed.
   *
   * The factory is the LIFTED function: called through the closure ABI, it reads captures out of the
   * env and params out of `argv`, and returns the constructed frame.
   */
  private liftGenerator(fn: ast.FunctionNode, declName: string): CExpr {
    const id = this.liftCounter++;
    const baseName = fn.name ? mangleC(ast.symbolName(fn.name)) : "lam";
    const liftedName = `__ll_lam_${baseName}_${id}`;
    const tag = `__ll_gen_${baseName}_${id}`;
    const stepName = `${tag}_step`;
    const frameCType: CType = { k: "obj", className: tag };
    this.ledger.record("A8", "nested-generator", fn, "nested `:gen` lifted: captures become frame slots (C2)");

    // Captures, against the CURRENT scopes -- computed before isolating, exactly as `lift` does.
    const captures: CCapture[] = [];
    const capType = new Map<string, { ctype: CType; cell: boolean }>();
    for (const srcName of freeVariables(fn)) {
      const cName = mangleC(srcName);
      if (this.globalDeclared.has(cName)) continue; // a file-scope global needs no capture
      const info = this.localInfo(cName);
      if (!info) continue;
      const ctype = info.cell ? C_VALUE : info.ctype;
      captures.push({ field: cName, ctype, value: { src: fn, ctype, kind: "c-ref", cName, cell: false }, cell: info.cell });
      capType.set(cName, { ctype, cell: info.cell });
    }

    const savedScopes = this.scopes.slice();
    const savedCells = this.cellVars;
    const savedInFn = this.inFunctionBody;
    (this as any).scopes = [new Map<string, VarInfo>()];
    this.inFunctionBody = true;
    let params: CParam[] = [];
    let promoted!: PromotedFrame;
    let states: number[] = [];
    let capParams: { cName: string; ctype: CType; cell?: boolean }[] = [];
    try {
      this.cellVars = this.computeCellVars(fn.body ?? []);
      const symT = this.dipSymbols("A3", "gen-signature", fn, "nested generator signature via the symbol table", declName)?.inferredType;
      const paramTs = symT?.kind === "function" && symT.params ? symT.params : fn.params.map(() => undefined);
      params = fn.params.map((p, i) => this.declareParam(p, paramTs[i] !== undefined ? mapType(paramTs[i]!) : undefined));
      // A capture is declared as an ordinary local of the frame scope, so the body resolves it like
      // any other binding -- and `promoteFrame` then gives it a slot because it is in the param list.
      // `cell:false` on purpose: inside the frame the slot IS the storage, and the cell object it
      // holds is deref'd by the same `c-ref` path a captured cell uses in a plain closure.
      for (const [cName, info] of capType) this.declareLocal(cName, info.ctype, true, info.cell);
      capParams = [...capType.entries()].map(([cName, info]) => ({ cName, ctype: info.ctype, cell: info.cell }));
      const saved = this.inGenerator;
      this.inGenerator = true;
      try {
        const lowered = lowerCoroutine(this.hirBodyFor(fn), fn);
        states = lowered.states;
        promoted = promoteFrame(this.resolveBlock(lowered.body), [...params, ...capParams], fn);
      } finally {
        this.inGenerator = saved;
      }
    } finally {
      (this as any).scopes = savedScopes;
      this.cellVars = savedCells;
      this.inFunctionBody = savedInFn;
    }

    const self: CExpr = { src: fn, ctype: frameCType, kind: "c-ref", cName: "__f" };
    // Falling off the end PARKS the machine -- without it the next pull dispatches back to the last
    // suspend and re-runs the tail forever. Identical to the top-level path, and for the same reason.
    promoted.body.stmts.push(
      { src: fn, ctype: C_VOID, kind: "c-assign", target: { kind: "field", object: self, slot: STATE_SLOT, fieldName: "state" }, value: { src: fn, ctype: C_INT, kind: "c-lit", lit: "int", value: String(GEN_DONE) } },
      { src: fn, ctype: C_VOID, kind: "c-return", value: { src: fn, ctype: C_VALUE, kind: "c-nil" } },
    );
    this.functions.push({
      src: fn, cName: stepName, params: [{ cName: "__f", ctype: frameCType }], ret: C_VALUE,
      body: states.length ? promoted.body : { stmts: promoted.body.stmts },
    });
    this.genClasses.push({
      name: tag, sourceName: declName, isStruct: false,
      fields: promoted.slots.map((s) => ({ name: s.cName, ctype: C_VALUE })),
      methods: [], genStep: stepName,
    });

    // The factory body: construct the frame from the lifted function's params and its captures.
    const zero: CExpr = { src: fn, ctype: C_INT, kind: "c-lit", lit: "int", value: "0" };
    const make: CExpr = {
      src: fn, ctype: frameCType, kind: "c-construct", className: tag, isStruct: false,
      args: [
        zero,
        ...params.map((p) => ({ src: fn, ctype: p.ctype, kind: "c-ref", cName: p.cName } as CExpr)),
        ...capParams.map((c) => ({ src: fn, ctype: c.ctype, kind: "c-ref", cName: c.cName } as CExpr)),
      ],
      fieldCount: promoted.slots.length,
    };
    this.lifted.push({
      liftedName,
      envStruct: captures.length ? `__ll_env_${liftedName}` : null,
      captures: captures.map((c) => ({ field: c.field, ctype: c.ctype, cell: c.cell })),
      params,
      body: { stmts: [{ src: fn, ctype: C_VOID, kind: "c-return", value: make }] },
    });

    return {
      src: fn,
      ctype: { k: "closure", params: params.map((p) => p.ctype), ret: C_VALUE },
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
    return this.closureCallResolved(node, fnv, args.map((a) => this.resolveAstExpr(a)));
  }

  private closureCallResolved(node: ast.ASTNode, fnv: CExpr, cArgs: CExpr[]): CExpr {
    this.ledger.record("A3", "closure-call", node, "call through a closure value (boxed calling convention; JS gets this free)");
    const ret = fnv.ctype.k === "closure" ? fnv.ctype.ret : C_VALUE;
    // `ll_call` returns a BOXED `ll_value` -- that is what "the uniform boxed calling convention"
    // means -- so this node must SAY `value`, not the closure's declared return ctype. It used to
    // claim `ret`, and the lie surfaced as the emitter boxing an already-boxed value with the wrong
    // boxer: `ll_box_str(ll_call(...))`, passing an `ll_value` where `ll_str*` was expected. P2 is the
    // coercion pass, so the unbox belongs to it and is inserted at the CONSUMER -- building it here
    // would fuse cast insertion into resolution, which InsertCoercions' own header rules out.
    //
    // Only reachable through a closure with a CONCRETE return ctype, which is why `(call f)` on a
    // `-> String` lambda found it and every `-> Void` or already-boxed one did not.
    void ret;
    return { src: node, ctype: C_VALUE, kind: "c-call", callee: { kind: "closure", fn: fnv }, args: cArgs };
  }

  /** HFreeCall (dev A3, step 2): a resolved FREE call `(f a ...)` -- classifyCall already decided the
   *  dispatch kind, so NO A2 call-dispatch dip is recorded here (the drain the probe measured). The
   *  callee is a modeled HRef; the args are lowered HExprs (temp-hoisted at lowering, so resolved via
   *  resolveExpr, NOT re-read from raw AST). classifyCall excludes operators/constructors/dotted, so
   *  the callee is only a local closure, a top-level fn, an intrinsic, or an imported l-lang fn. The
   *  `callee-identity` satellite dip stays where imported-ness is still read from symbols (not yet on
   *  the node). */
  private resolveFreeCall(h: Extract<HExpr, { kind: "free-call" }>): CExpr {
    const node = h.src as ast.ListNode;
    if (h.callee.kind !== "ref") return this.resolveAstExpr(node); // not a modeled name -> legacy path
    const name = h.callee.name;
    const cName = mangleC(name);

    // (0) A SPREAD argument forces the BOXED convention, whatever the callee is. `(f a ...xs)` does
    // not have a statically known argument count, so a direct C call cannot express it -- even a
    // plain top-level function is reached as a value here. This is checked before every other case
    // precisely because it overrides all of them.
    const spread = h.args.map((a) => this.spreadInner(a) !== undefined);
    if (spread.some(Boolean)) {
      const parts = h.args.map((a) => {
        const inner = this.spreadInner(a);
        return inner !== undefined ? this.resolveAstExpr(inner) : this.resolveExpr(a);
      });
      const fnv = this.localInfo(cName)
        ? this.resolveIdentifier(h.callee.src as ast.IdentifierNode, true)
        : this.functionValue(node, name);
      this.ledger.record("A3", "spread-call", node, "call with a spread argument goes through the boxed convention (the argument count is not static)");
      return { src: node, ctype: C_VALUE, kind: "c-call", callee: { kind: "closure", fn: fnv }, args: parts, spread };
    }

    const cArgs = h.args.map((a) => this.resolveExpr(a));

    // (1) A local binding used as a callee -> a call through a closure value (spec A3).
    if (this.localInfo(cName)) {
      return this.closureCallResolved(node, this.resolveIdentifier(h.callee.src as ast.IdentifierNode, true), cArgs);
    }
    // (2) A top-level function in this module -> a direct typed C call.
    if (this.ownFns.has(name)) {
      const sig = this.topLevelFns.get(name)!;
      return { src: node, ctype: sig.ret, kind: "c-call", callee: { kind: "free", cName, params: sig.params, ret: sig.ret }, args: this.packRestArgs(node, sig, cArgs) };
    }
    // (3) An intrinsic (a std/js host global with a simple name, e.g. `print`) or an imported l-lang
    // function whose body is lowered on demand. Which of the two is still a symbol-table question --
    // the callee-identity satellite the node does not yet answer.
    // The callee identity rode the HIR node (A3, D48/Q3) -- consume it, no re-resolution, no dip.
    const cb = h.calleeBinding;
    const builtin = INTRINSIC_CALLS.get(name);
    if (builtin) {
      if (cb && cb.resolved && !cb.extern) {
        this.ledger.record("A9-extern", "stdlib-intrinsic", node, `'${name}' stdlib body shadowed by a C intrinsic`);
      }
      return { src: node, ctype: builtin.ret, kind: "c-call", callee: { kind: "intrinsic", ...builtin }, args: cArgs };
    }
    if (cb && cb.isFunctionType && !cb.extern && cb.fnNode) {
      // The ALIAS, not the source name: another module may already own the bare spelling.
      const alias = this.lowerImportedFunction(name, cb.fnNode);
      const sig = this.topLevelFns.get(alias);
      if (!sig) return { src: node, ctype: C_VALUE, kind: "c-nil" };
      return { src: node, ctype: sig.ret, kind: "c-call", callee: { kind: "free", cName: mangleC(alias), params: sig.params, ret: sig.ret }, args: this.packRestArgs(node, sig, cArgs) };
    }
    throw this.refuseExtern(node, name);
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
