// P3 -- CIR -> C source. Mechanical (the EmitHirToEstree posture): exhaustive switches, hard-throw
// default. Consumes ONLY the CIR -- no AST, no nodeTypes, no symbol table. If a case here would need
// a judgment call, that judgment belongs in P1/P2.

import type * as ast from "../../frontend/ast";
import { CBlock, CExpr, CStmt, CFunction, CModule, CLValue, CLifted, CParam, CForEach } from "./cir";
import { CType } from "./ctype";
import { computeVolatileLocals } from "./volatiles";

/** The generator step function's frame parameter, and the label prefix its resume points use. Both
 *  are fixed names: only `promoteFrame` and this emitter ever write them, and they live in one
 *  function each time (D58). */
const GEN_FRAME = "__f";
const GEN_LABEL = "__ll_resume_";

function cType(t: CType): string {
  switch (t.k) {
    case "int": return "int64_t";
    case "real": return "double";
    case "bool": return "bool";
    case "char": return "uint32_t";
    case "str": return "ll_str*";
    case "vec": return "ll_vec*";
    case "map": return "ll_map*";
    case "obj": return "ll_obj*";
    case "closure": return "ll_closure*";
    case "value": return "ll_value";
    case "void": return "void";
  }
}

function defaultInit(t: CType): string {
  switch (t.k) {
    case "int": return "0";
    case "real": return "0.0";
    case "bool": return "false";
    case "char": return "0";
    case "value": return "ll_nil()";
    case "void": return "0";
    default: return "NULL";
  }
}

/** A compile-time-constant zero initializer for a file-scope global (no function calls allowed). */
function staticZero(t: CType): string {
  switch (t.k) {
    case "int": return "0";
    case "real": return "0.0";
    case "bool": return "false";
    case "char": return "0";
    case "value": return "{0}"; // LL_NIL == 0
    default: return "0"; // pointer types -> NULL
  }
}

/**
 * A string literal as an `ll_str*`, WITH ITS LENGTH STATED.
 *
 * `ll_str_lit` measures its argument with `strlen`, which is the one measurement a C string cannot
 * make about an l-lang one: an l-lang String is a counted byte range and may contain NUL. Every
 * literal used to go through it, so `"ab\x00cd"` arrived as the two bytes `ab` -- and because the
 * runtime's own equality is `len == len && memcmp`, ALREADY correct, two distinct literals sharing a
 * NUL prefix compared EQUAL. Measured before this fix: `(== "ab\x00cd" "ab\x00XY")` answered `true`
 * on C and `false` on JS, and `.length` answered 2 against JS's 5.
 *
 * The escape side was never wrong -- `cEscape` emits `\000` for a NUL, always three octal digits, so
 * a following digit cannot be absorbed into it. Only the length was, so only the length is fixed:
 * the byte count is computed here and handed to `ll_str_from`, which copies exactly that many bytes.
 *
 * Used for EVERY literal the emitter produces, including field names and map keys that cannot
 * contain a NUL today. Uniformity is the point -- "which of these seven sites can carry user text?"
 * is a question that has to be re-answered every time one of them moves, and answering it wrong is
 * silent.
 */
function cStr(s: string): string {
  return `ll_str_from("${cEscape(s)}", ${Buffer.byteLength(s, "utf8")})`;
}

/**
 * The i-th argument of a BOXED-CONVENTION entry point, or nil when the caller passed fewer.
 *
 * `(argc, argv)` is a flat, unchecked pair: `ll_call` hands the callee whatever the call site built,
 * and nothing in between compares that count against the callee's arity. The three entry points that
 * unpack it -- a lifted closure, a method's dynamic-dispatch adapter, a top-level function used as a
 * value -- each read `__argv[i]` unconditionally, so an under-applied call READ PAST THE END of the
 * caller's array. Measured: `(f 7)` on a two-parameter closure printed `[7 #<object>]` where JS binds
 * `[7 nil]`.
 *
 * The adapter case is the one worth naming, because it LOOKED correct: a call site builds its
 * arguments as a compound literal, and the stack slot after a one-element one happened to be zero --
 * and `LL_NIL == 0`, so the garbage read decoded as nil and printed `[7 nil]`, the right answer for
 * the wrong reason. Undefined behaviour that agrees with the oracle is still undefined behaviour, and
 * it is why all three sites are fixed rather than only the one that printed wrong.
 *
 * Arity IS checked statically wherever the callee is known -- `(g 7)` on a two-parameter `g` is
 * LL0211 and never reaches here. This path exists only for a callee reached as a VALUE, where the
 * count is not knowable until run time.
 *
 * A missing argument becomes nil, matching JS. For a parameter with a concrete C type the unbox then
 * traps ("expected an Int") instead of computing on garbage, which is the same answer one rung
 * louder. The cost is one compare per parameter per dynamic call, and only on this convention -- a
 * statically resolved call passes typed C arguments and never goes through argv at all.
 */
function arg(i: number): string {
  return `(__argc > ${i} ? __argv[${i}] : ll_nil())`;
}

/** Escape a raw string for a C string literal (UTF-8 bytes pass through). */
function cEscape(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += ch;
  }
  return out;
}

const BOX_FN: Record<string, string> = {
  int: "ll_box_int",
  real: "ll_box_real",
  bool: "ll_box_bool",
  char: "ll_box_char",
  str: "ll_box_str",
  vec: "ll_box_vec",
  map: "ll_box_map",
  obj: "ll_box_obj",
  closure: "ll_box_closure",
};

const UNBOX_FN: Record<string, string> = {
  int: "ll_unbox_int",
  real: "ll_unbox_real",
  bool: "ll_unbox_bool",
  char: "ll_unbox_char",
  str: "ll_unbox_str",
  vec: "ll_unbox_vec",
  map: "ll_unbox_map",
  obj: "ll_unbox_obj",
  closure: "ll_unbox_closure",
};

/**
 * A construct P3 cannot PRINT -- the emitter's twin of `ResolveHirToCir.refuse`.
 *
 * These were six bare `throw new Error("C emit: ...")`, which reached the user as an uncaught
 * TypeScript stack trace pointing into the compiler rather than an LL-coded diagnostic pointing at
 * their source. Two of them are reachable from ordinary programs -- binding a method to a value
 * (`no cast int -> closure`) and an `:implicit` defcast at an arg-coercion site (`no cast obj -> real`)
 * -- so "the compiler crashed" was the reported behaviour for a plain unimplemented lowering.
 *
 * Carrying the CIR node's `src` out rather than reporting in place keeps `EmitCirToC` a pure printer
 * with no `Context`: `CTransformer` catches this and files the same LL0106 that P1 files, with the
 * location the node already knows.
 */
export class EmitRefusal extends Error {
  constructor(readonly node: ast.ASTNode | undefined, readonly what: string) {
    super(`C emit: ${what}`);
  }
}

export class EmitCirToC {
  private out: string[] = [];
  private indent = 0;
  private fresh = 0;
  // The stack of enclosing `try` frames (innermost last) at the current emit point. A `return` or a
  // no-match rethrow must run each enclosing finalizer AND restore `ll_handler_top` on the way out --
  // a raw C `return`/`ll_throw` would jump past both. Every try frame is tracked, even finalizer-less
  // ones: a `return` out of any try still has to pop the handler stack, or it dangles at a dead frame.
  private tryStack: { frameVar: string; finalizer: CBlock | null }[] = [];
  // The locals of the CURRENT C function that must be `volatile` (C11 7.13.2.1p3 -- see volatiles.ts).
  // Swapped per emitted function; `signature()` serves both the forward decl and the definition, so
  // every function's set is computed up front in emitModule rather than at its emit point.
  private volatiles: Set<string> = new Set();
  private volatilesByFn: Map<CFunction | CLifted, Set<string>> = new Map();

  emitModule(m: CModule): string {
    this.out = [];
    // Which locals are clobberable across a setjmp landing, per C function (spec: volatiles.ts).
    this.volatilesByFn = new Map();
    for (const f of m.functions) this.volatilesByFn.set(f, computeVolatileLocals(f.body));
    for (const l of m.lifted) this.volatilesByFn.set(l, computeVolatileLocals(l.body));
    // Forward declarations FIRST: the class method-table adapters (below) call the method functions,
    // so those must be declared before the class descriptors.
    for (const f of m.functions) this.line(this.signature(f) + ";");
    for (const l of m.lifted) {
      if (l.abi === "handler") this.line(`static ll_value ${l.liftedName}(void* __env, ll_value __cond);`);
      else this.line(`static ll_value ${l.liftedName}(void* __env, int __argc, ll_value* __argv);`);
    }
    for (const a of m.adapters) this.line(`static ll_value __ll_adapter_${a.forCName}(void* __env, int __argc, ll_value* __argv);`);
    if (m.functions.length || m.lifted.length || m.adapters.length) this.line("");
    // Struct/class descriptors (ll_class): field names in slot order, is_struct, `:extends` parent, and
    // a dynamic-dispatch method table (boxed adapters) for statically-unknown receivers.
    for (const c of m.classes) {
      // A field-less class gets a NULL field table, written inline. It used to emit a `const char**`
      // VARIABLE initialized to 0 and name it in the descriptor below -- but an array name decays to
      // an address constant while a pointer OBJECT's value is not one, so cc rejected the descriptor:
      // "initializer element is not a compile-time constant". Only classes with fields ever worked.
      const fieldsPtr = c.fields.length ? `__ll_fields_${c.name}` : "0";
      if (c.fields.length) {
        this.line(`static const char* __ll_fields_${c.name}[] = {${c.fields.map((f) => `"${f.name}"`).join(", ")}};`);
      }
      for (const mm of c.methods) this.emitMethodAdapter(mm);
      if (c.methods.length) {
        this.line(`static const ll_method_entry __ll_methods_${c.name}[] = {${c.methods.map((mm) => `{${JSON.stringify(mm.name)}, ${mm.cName}_dyn}`).join(", ")}};`);
      }
      // D24 erases interfaces, so the class descriptor is conformance's only runtime carrier: without
      // it `(x :of Iterable)` is false even for a verified `:implements` (gap ledger §14.1). The list
      // is the transitive closure, identical to the JS `static __ll_interfaces`.
      const ifaces = c.interfaces ?? [];
      if (ifaces.length) {
        this.line(`static const char* __ll_ifaces_${c.name}[] = {${ifaces.map((i) => `"${cEscape(i)}"`).join(", ")}};`);
      }
      const ifacesPtr = ifaces.length ? `__ll_ifaces_${c.name}` : "0";
      const methodsPtr = c.methods.length ? `__ll_methods_${c.name}` : "0";
      // A generator's descriptor carries its SOURCE name (`fibs`, not the synthesized tag) and its
      // step function; the runtime reads both. `name` stays the C-safe tag because it is also the
      // symbol suffix -- a source name may be kebab-case, and `__ll_class_count-up` is not an
      // identifier. D58: the display name is what `#<generator ...>` and `(type g)` show.
      const display = c.sourceName ?? c.name;
      const gen = c.genStep ? `true, ${c.genStep}` : "false, 0";
      this.line(`static ll_class __ll_class_${c.name} = {"${display}", ${c.isStruct ? "true" : "false"}, ${c.fields.length}, ${fieldsPtr}, ${c.parent ? `"${c.parent}"` : "0"}, ${c.methods.length}, ${methodsPtr}, ${ifaces.length}, ${ifacesPtr}, ${gen}};`);
    }
    // A registry of every class, for `type-by-name` reflection. External linkage so the prepended
    // runtime's reflection helpers (which forward-declare it `extern`) can reach it in this one TU.
    //
    // A GENERATOR's synthesized class is deliberately absent (D58): it never enters the reflection
    // graph, so `type-by-name "fibs"` must not find a frame type under that name.
    const registered = m.classes.filter((c) => !c.genStep);
    const regEntries = registered.length ? registered.map((c) => `&__ll_class_${c.name}`).join(", ") : "0";
    this.line(`ll_class* __ll_class_registry[] = {${regEntries}};`);
    this.line(`size_t __ll_class_count = ${registered.length};`);
    this.line("");
    // Module-level bindings referenced by functions -> file-scope globals. A file-scope initializer
    // must be a compile-time constant, so use a zero-init (ll_value {0} == LL_NIL); the real value is
    // assigned in main at the binding's original position.
    for (const g of m.globals) this.line(`static ${cType(g.ctype)} ${g.cName} = ${staticZero(g.ctype)};`);
    if (m.globals.length) this.line("");
    // Env struct definitions for lifted closures that capture. Deduped by name: the clauses of one
    // D47 handle form share ONE struct (the frame has one henv); the first emission defines it for all.
    const envEmitted = new Set<string>();
    for (const l of m.lifted) {
      if (!l.envStruct || envEmitted.has(l.envStruct)) continue;
      envEmitted.add(l.envStruct);
      this.line(`typedef struct ${l.envStruct} {`);
      this.indent++;
      // C2: a cell is a one-field OBJECT now, so a captured cell is an ordinary `ll_value` here --
      // which is also what makes it storable in a generator frame slot.
      for (const c of l.captures) this.line(`${c.cell ? "ll_value" : cType(c.ctype)} ${c.field};`);
      this.indent--;
      this.line(`} ${l.envStruct};`);
    }
    if (m.lifted.some((l) => l.envStruct)) this.line("");
    for (const f of m.functions) this.emitFunction(f);
    for (const l of m.lifted) this.emitLifted(l);
    for (const a of m.adapters) this.emitAdapter(a);
    // `int main(int, char**)`, unconditionally. C hands a program its arguments in exactly one
    // place -- main's parameters -- and every other function in the TU is downstream of that, so the
    // process floor's `ll_sys_args` reads statics that only main can fill. Emitted always rather than
    // only when `sys-args` is reached: both forms are valid C, the unused-parameter warning is
    // suppressed the same way everywhere, and a signature that changes shape depending on what the
    // program happens to call is a second thing to get wrong.
    this.line("int main(int argc, char** argv) {");
    this.volatiles = computeVolatileLocals(m.main); // top-level statements are main's locals
    this.indent++;
    this.line("ll_argc = argc; ll_argv = argv;");
    // D59 step 1: the heap census, dumped at exit when LL_GC_STATS is set. A diagnostic, not a
    // feature -- it adds no language surface, and `test/memory.ts` is its only reader.
    this.line("atexit(ll_gc_report);");
    this.emitMetadata(m.metadata);
    this.withFreshTryStack(() => this.emitBlockStmts(m.main));
    this.line("return 0;");
    this.indent--;
    this.line("}");
    return this.out.join("\n") + "\n";
  }

  /**
   * Materialise the reflection metadata graph (D54) as ll_value maps, first thing in main.
   *
   * The graph comes from the SHARED builder (compiler/reflection/metadata.ts) -- the same function
   * the JS backend calls -- so this emits data, it never decides it. Before this, `ll_class` carried
   * a name and a parent and nothing else, which is why `(type p)` answered a two-key stub and
   * `(type-by-name "add")` answered nil: the graph was never in the C module at all.
   */
  private emitMetadata(meta: Record<string, any>): void {
    const names = Object.keys(meta ?? {});
    if (names.length === 0) return;
    const keys = names.map((n) => cStr(n)).join(", ");
    const vals = names.map((n) => this.metaValue(meta[n])).join(", ");
    this.line(`__ll_meta = ll_map_of(${names.length}, (ll_str*[]){${keys}}, (ll_value[]){${vals}});`);
  }

  /** One JSON-ish metadata value as a boxed C expression. Mirrors the JS table entry for entry. */
  private metaValue(v: any): string {
    if (v === null || v === undefined) return "ll_nil()";
    if (typeof v === "boolean") return `ll_box_bool(${v ? "true" : "false"})`;
    if (typeof v === "number") {
      return Number.isInteger(v) ? `ll_box_int(INT64_C(${v}))` : `ll_box_real(${v})`;
    }
    if (typeof v === "string") return `ll_box_str(${cStr(v)})`;
    if (Array.isArray(v)) {
      if (v.length === 0) return "ll_box_vec(ll_vec_of(0, (ll_value*)0))";
      return `ll_box_vec(ll_vec_of(${v.length}, (ll_value[]){${v.map((x) => this.metaValue(x)).join(", ")}}))`;
    }
    const ks = Object.keys(v);
    if (ks.length === 0) return "ll_box_map(ll_map_of(0, (ll_str**)0, (ll_value*)0))";
    const keys = ks.map((k) => cStr(k)).join(", ");
    const vals = ks.map((k) => this.metaValue(v[k])).join(", ");
    return `ll_box_map(ll_map_of(${ks.length}, (ll_str*[]){${keys}}, (ll_value[]){${vals}}))`;
  }

  /** A lifted closure body: unpack params from argv, captures from env, then the resolved body.
   *  abi:"handler" (D47 Cr-1b) is a lifted handle clause instead: `(void* env, ll_value cond)`. */
  private emitLifted(l: CLifted): void {
    this.volatiles = this.volatilesByFn.get(l) ?? new Set();
    if (l.abi === "handler") {
      // The trailing return is the DECLINE (ll_signal discards a returning handler's value), and a
      // `return` inside the clause is likewise a plain C return = decline (fresh tryStack below).
      this.line(`static ll_value ${l.liftedName}(void* __env, ll_value __cond) {`);
      this.indent++;
      if (l.envStruct) this.line(`${l.envStruct}* __e = (${l.envStruct}*)__env; (void)__e;`);
      else this.line("(void)__env;");
      if (l.params.length) this.line(`${this.declType(l.params[0].ctype, l.params[0].cName)} ${l.params[0].cName} = __cond;`);
      else this.line("(void)__cond;");
      for (const c of l.captures) {
        this.line(`${c.cell ? "ll_value" : this.declType(c.ctype, c.field)} ${c.field} = __e->${c.field};`);
      }
      this.withFreshTryStack(() => this.emitBlockStmts(l.body));
      this.line("return ll_nil();"); // fall-off-end = decline
      this.indent--;
      this.line("}");
      this.line("");
      return;
    }
    this.line(`static ll_value ${l.liftedName}(void* __env, int __argc, ll_value* __argv) {`);
    this.indent++;
    this.line("(void)__argc;");
    if (l.envStruct) this.line(`${l.envStruct}* __e = (${l.envStruct}*)__env; (void)__e;`);
    else this.line("(void)__env;");
    l.params.forEach((p, i) => {
      // `[...args]` COLLECTS the remaining arguments rather than taking one. A top-level function's
      // rest parameter is packed by the call site, which knows the arity; a closure is reached
      // through `ll_call` with a flat argv, so there is no such site and the callee packs. Without
      // this the parameter got `__argv[i]` -- one value where the body expected a vector, which
      // surfaced as `TypeError: expected a Vector` the moment anything asked for `args.length`.
      //
      // `__argc` may be SHORTER than the fixed parameters (a closure can legally be called with
      // fewer), so the count is clamped rather than trusted: `(fn [a ...rest])` called with one
      // argument must give an empty rest, not a negative length.
      if (p.rest) {
        this.line(
          `${this.declType(p.ctype, p.cName)} ${p.cName} = ll_vec_of(` +
            `(size_t)(__argc > ${i} ? __argc - ${i} : 0), __argv + ${i});`
        );
        return;
      }
      if (p.ctype.k === "value") this.line(`${this.declType(p.ctype, p.cName)} ${p.cName} = ${arg(i)};`);
      else this.line(`${this.declType(p.ctype, p.cName)} ${p.cName} = ${UNBOX_FN[p.ctype.k]}(${arg(i)});`);
    });
    for (const c of l.captures) {
      this.line(`${c.cell ? "ll_value" : this.declType(c.ctype, c.field)} ${c.field} = __e->${c.field};`);
    }
    this.withFreshTryStack(() => this.emitBlockStmts(l.body));
    this.line("return ll_nil();"); // closures always return boxed; unreachable when the body returned
    this.indent--;
    this.line("}");
    this.line("");
  }

  /** A boxed-convention method adapter for the dynamic-dispatch table: unbox self + args, call the
   *  typed method, box the result. The witness/vtable entry a statically-unknown receiver dispatches to. */
  private emitMethodAdapter(m: { name: string; cName: string; params: CType[]; ret: CType }): void {
    this.line(`static ll_value ${m.cName}_dyn(ll_value __self, int __argc, ll_value* __argv) {`);
    this.indent++;
    this.line(`(void)__argc;${m.params.length ? "" : " (void)__argv;"}`);
    const argParts = m.params.map((t, i) => (t.k === "value" ? arg(i) : `${UNBOX_FN[t.k]}(${arg(i)})`));
    const call = `${m.cName}(ll_unbox_obj(__self)${argParts.length ? ", " + argParts.join(", ") : ""})`;
    if (m.ret.k === "void") this.line(`${call}; return ll_nil();`);
    else if (m.ret.k === "value") this.line(`return ${call};`);
    else this.line(`return ${BOX_FN[m.ret.k]}(${call});`);
    this.indent--;
    this.line("}");
  }

  /**
   * A boxed-convention adapter for a top-level function used as a value: unbox, call, box.
   *
   * A `[...rest]` PARAMETER IS PACKED HERE, not read. A direct call site packs the vector itself
   * because it knows the arity; `ll_call` hands over a flat argv and there is no such site, so the
   * callee must collect. `emitLifted` above already says this for a lifted closure -- the adapter is
   * the same convention reached by a different route, and it read `__argv[restAt]` as if the vector
   * were already there.
   *
   * That is what made STACKED `...args` DECORATORS trap. D75 unfolds each layer into an ordinary C
   * function taking one packed `ll_vec*`, and binds the next layer's `original` as a closure VALUE --
   * so the outermost layer is called directly (packed by its call site, fine) and every layer beneath
   * it is reached through this adapter (flat, and read as a vector). One decorator worked; two gave
   * `TypeError: expected a Vector`, with the outer's log line already printed.
   *
   * The count is clamped exactly as the closure prologue clamps it, so an under-applied call gives an
   * empty rest rather than a negative length.
   */
  private emitAdapter(a: { forCName: string; params: CType[]; ret: CType; arity: number; restAt?: number }): void {
    this.line(`static ll_value __ll_adapter_${a.forCName}(void* __env, int __argc, ll_value* __argv) {`);
    this.indent++;
    this.line("(void)__env; (void)__argc;");
    const callArgs = a.params.map((t, i) =>
      i === a.restAt
        ? `ll_vec_of((size_t)(__argc > ${i} ? __argc - ${i} : 0), __argv + ${i})`
        : t.k === "value" ? arg(i) : `${UNBOX_FN[t.k]}(${arg(i)})`
    );
    const call = `${a.forCName}(${callArgs.join(", ")})`;
    if (a.ret.k === "void") this.line(`${call}; return ll_nil();`);
    else if (a.ret.k === "value") this.line(`return ${call};`);
    else this.line(`return ${BOX_FN[a.ret.k]}(${call});`);
    this.indent--;
    this.line("}");
    this.line("");
  }

  /** A declaration's type, `volatile`-qualified when the local is clobberable across a setjmp landing
   *  (C11 7.13.2.1p3 -- see volatiles.ts). The qualifier goes AFTER the type so a pointer local reads
   *  `ll_str* volatile p` (a volatile POINTER -- the clobberable slot), not a pointer-to-volatile. */
  private declType(t: CType, cName: string): string {
    return this.volatiles.has(cName) ? `${cType(t)} volatile` : cType(t);
  }

  private signature(f: CFunction): string {
    // Params are locals too: a `:mut`/`:ref`/`:out` param assigned inside a pad is clobberable.
    const vol = this.volatilesByFn.get(f) ?? new Set<string>();
    const params = f.params.length
      ? f.params.map((p) => `${vol.has(p.cName) ? `${cType(p.ctype)} volatile` : cType(p.ctype)} ${p.cName}`).join(", ")
      : "void";
    return `static ${cType(f.ret)} ${f.cName}(${params})`;
  }

  private emitFunction(f: CFunction): void {
    this.volatiles = this.volatilesByFn.get(f) ?? new Set();
    this.line(`${this.signature(f)} {`);
    this.indent++;
    this.withFreshTryStack(() => this.emitBlockStmts(f.body));
    this.indent--;
    this.line("}");
    this.line("");
  }

  private line(s: string): void {
    this.out.push(s ? "  ".repeat(this.indent) + s : "");
  }

  private emitBlockStmts(b: CBlock): void {
    for (const s of b.stmts) this.emitStmt(s);
  }

  /**
   * D16 destructuring loop bindings, DECLARED beside the element variable -- outside the loop, inside
   * the block the for-each opens. That placement is the requirement, not a style choice: the `:else`
   * clause is emitted after the loop inside the same block and may read the final binding, so a name
   * declared in the loop BODY would be out of scope by then and C would reject the program.
   */
  private emitDestructureDecls(d: CForEach["destructure"]): void {
    for (const b of d ?? []) this.line(`${this.declType(b.ctype, b.cName)} ${b.cName} = ${defaultInit(b.ctype)};`);
  }

  /** ...and ASSIGNED per iteration, right after the element variable itself is set. */
  private emitDestructureAssigns(d: CForEach["destructure"]): void {
    for (const b of d ?? []) this.line(`${b.cName} = ${this.expr(b.value)};`);
  }

  /** A `return`, routed through every enclosing `try` frame. The value is evaluated FIRST -- while the
   *  innermost frame is still installed, so a throw inside the return expression is still caught here --
   *  then each frame is unwound inner-to-outer: restore its `ll_handler_top`, run its finalizer. With no
   *  enclosing try this is the plain `return <expr>;`. (l-lang has no break/continue, so `return` is the
   *  only structured early exit that can bypass a finalizer.) */
  private emitReturn(value: CExpr | null): void {
    if (this.tryStack.length === 0) {
      this.line(value ? `return ${this.expr(value)};` : "return;");
      return;
    }
    const frames = this.tryStack;
    this.line("{");
    this.indent++;
    let retTemp = "";
    if (value && value.ctype.k !== "void") {
      retTemp = `__r${this.fresh++}`;
      this.line(`${cType(value.ctype)} ${retTemp} = ${this.expr(value)};`);
    } else if (value) {
      this.line(`(void)(${this.expr(value)});`); // evaluate for effect while the frame is installed
    }
    // Inner-to-outer: pop the frame (so a throw inside its finalizer targets the ENCLOSING try), then
    // run the finalizer. The `frames.slice(0, k)` narrows tryStack so a `return` inside finalizer k
    // routes through the outer frames only, never re-entering k.
    for (let k = frames.length - 1; k >= 0; k--) {
      this.line(`ll_handler_top = ${frames[k].frameVar}.prev;`);
      if (frames[k].finalizer) this.emitFinalizer(frames[k].finalizer!, frames.slice(0, k));
    }
    this.line(retTemp ? `return ${retTemp};` : "return;");
    this.indent--;
    this.line("}");
  }

  /** Emit a finalizer body with `tryStack` narrowed to `outer` -- so a `return`/rethrow inside the
   *  finalizer routes through the enclosing frames only, never re-entering the frame being finalized. */
  private emitFinalizer(finalizer: CBlock, outer: { frameVar: string; finalizer: CBlock | null }[]): void {
    const saved = this.tryStack;
    this.tryStack = outer;
    this.emitBlockStmts(finalizer);
    this.tryStack = saved;
  }

  /** Run `body` with a fresh (empty) try-frame stack, restoring the caller's afterwards. A `try` never
   *  spans a function boundary, so each function body starts clean -- a defensive reset against bleed. */
  private withFreshTryStack(body: () => void): void {
    const saved = this.tryStack;
    this.tryStack = [];
    body();
    this.tryStack = saved;
  }

  private emitStmt(s: CStmt): void {
    switch (s.kind) {
      case "c-expr-stmt": {
        const e = this.expr(s.expr);
        this.line(s.expr.ctype.k === "void" ? `${e};` : `(void)(${e});`);
        return;
      }
      case "c-decl":
        if (s.cell) {
          // A mutable-captured binding: a heap cell shared with escaping closures.
          this.line(`ll_value ${s.cName} = ll_cell(${s.init ? this.expr(s.init) : "ll_nil()"});`);
        } else {
          this.line(`${this.declType(s.declCType, s.cName)} ${s.cName} = ${s.init ? this.expr(s.init) : defaultInit(s.declCType)};`);
        }
        return;
      case "c-assign": {
        // A CONTAINER-slot store must evaluate its value BEFORE taking the slot address.
        //
        // `ll_map_slot` / `ll_index_slot` / `(vec)->items` all hand back a pointer INTO the
        // container's storage, and that storage is `realloc`ed when the container grows. So
        //
        //     *ll_map_slot(memo, k) = fib(n-1) + fib(n-2);
        //
        // computes the slot, then runs a right-hand side that recursively inserts into `memo` --
        // and writes through a pointer freed by the realloc those inserts caused. Memory
        // corruption, surfacing as whatever the freed cell happens to hold (here: a bogus tag, so
        // the read on the next line trapped "expected an Int" three frames away from the cause).
        //
        // P2 has already coerced every non-`name` target's value to `ll_value`, so one boxed temp
        // is always the right shape. A `name` target has no such storage and is left alone.
        if (s.target.kind === "name") {
          this.line(`${this.lvalue(s.target)} = ${this.expr(s.value)};`);
          return;
        }
        const tmp = `__ll_st${this.fresh++}`;
        this.line("{");
        this.indent++;
        this.line(`ll_value ${tmp} = ${this.expr(s.value)};`);
        this.line(`${this.lvalue(s.target)} = ${tmp};`);
        this.indent--;
        this.line("}");
        return;
      }
      case "c-if":
        this.line(`if (${this.expr(s.test)}) {`);
        this.indent++;
        this.emitBlockStmts(s.then);
        this.indent--;
        if (s.else) {
          this.line("} else {");
          this.indent++;
          this.emitBlockStmts(s.else);
          this.indent--;
        }
        this.line("}");
        return;
      case "c-block":
        this.line("{");
        this.indent++;
        this.emitBlockStmts(s.body);
        this.indent--;
        this.line("}");
        return;
      case "c-return":
        this.emitReturn(s.value);
        return;
      case "c-while":
        this.line(`while (${this.expr(s.test)}) {`);
        this.indent++;
        this.emitBlockStmts(s.body);
        this.indent--;
        this.line("}");
        return;
      case "c-for": {
        this.line("{");
        this.indent++;
        this.emitBlockStmts(s.init);
        const test = s.test ? this.expr(s.test) : "";
        let update = "";
        if (s.update) {
          if (s.update.kind === "c-expr-stmt") update = `(void)(${this.expr(s.update.expr)})`;
          else if (s.update.kind === "c-assign" && s.update.target.kind === "name") {
            // `this.lvalue(...)`, NOT `target.cName`. Writing the name directly was a SECOND COPY of
            // the lvalue decision, and it had drifted from the first: `lvalue()` derefs a heap cell
            // (`(*u_j)`) and this did not, so a mutable-captured induction variable was READ through
            // its cell and WRITTEN over the pointer -- `u_j = ll_copy(...)`, which is a `cc` type
            // error, not a silent wrong answer, but only because the types happened to differ.
            //
            // It was unreachable until the cell analysis started seeing `for :init` bindings at all.
            update = `${this.lvalue(s.update.target)} = ${this.expr(s.update.value)}`;
          } else throw new Error("C emit: for update must be an expression or a simple assignment");
        }
        this.line(`for (; ${test}; ${update}) {`);
        this.indent++;
        this.emitBlockStmts(s.body);
        this.indent--;
        this.line("}");
        if (s.elseBlock) this.emitBlockStmts(s.elseBlock); // inside the block: `:else` sees `:init`
        this.indent--;
        this.line("}");
        return;
      }
      case "c-foreach": {
        // The loop variable is declared OUTSIDE the loop: the `:else` block runs after completion and
        // may read the variable's last value (the corpus golden proves this semantic).
        const v = `__c${this.fresh++}`;
        const i = `__i${this.fresh++}`;
        // D30's PROTOCOL arm: a cursor from `ll_iter`, stepped by `ll_next`. Used for every collection
        // that is not statically a vector -- a string, a map, a user `Iterable`, or a boxed value
        // whose shape is only known at run time.
        //
        // EXHAUSTION IS ASKED FOR, NOT INFERRED FROM THE VALUE. This used to break on `${e}.tag ==
        // LL_NIL`, which reads "the element is nil" as "the sequence ended" -- so `[1 nil 2]` walked
        // exactly once and a leading nil lost the container entirely, on C only and in silence.
        // `ll_iter_done` reads a flag off a built-in cursor and falls back to the nil rule only for a
        // user `Iterator<T>`, whose protocol offers nothing else.
        if (s.viaProtocol) {
          const it = `__it${this.fresh++}`;
          const e = `__e${this.fresh++}`;
          this.line("{");
          this.indent++;
          this.line(`ll_value ${it} = ll_iter(${this.expr(s.collection)});`);
          this.line(`${cType(s.varCType)} ${s.varCName} = ${defaultInit(s.varCType)};`);
          this.emitDestructureDecls(s.destructure);
          this.line(`for (;;) {`);
          this.indent++;
          this.line(`ll_value ${e} = ll_next(${it});`);
          this.line(`if (ll_iter_done(${it}, ${e})) break;`);
          const got = `ll_copy(${e})`; // D11 per-iteration copy (identity for non-structs)
          if (s.varCType.k === "value") this.line(`${s.varCName} = ${got};`);
          else this.line(`${s.varCName} = ${UNBOX_FN[s.varCType.k]}(${got});`);
          this.emitDestructureAssigns(s.destructure);
          this.emitBlockStmts(s.body);
          this.indent--;
          this.line("}");
          if (s.elseBlock) this.emitBlockStmts(s.elseBlock);
          this.indent--;
          this.line("}");
          return;
        }
        this.line("{");
        this.indent++;
        this.line(`ll_vec* ${v} = ${this.expr(s.collection)};`);
        this.line(`${cType(s.varCType)} ${s.varCName} = ${defaultInit(s.varCType)};`);
        this.emitDestructureDecls(s.destructure);
        this.line(`for (size_t ${i} = 0; ${i} < ${v}->len; ${i}++) {`);
        this.indent++;
        const elem = `ll_copy(${v}->items[${i}])`; // D11 per-iteration copy (identity for non-structs)
        if (s.varCType.k === "value") {
          this.line(`${s.varCName} = ${elem};`);
        } else {
          this.line(`${s.varCName} = ${UNBOX_FN[s.varCType.k]}(${elem});`);
        }
        this.emitDestructureAssigns(s.destructure);
        this.emitBlockStmts(s.body);
        this.indent--;
        this.line("}");
        if (s.elseBlock) {
          this.emitBlockStmts(s.elseBlock);
        }
        this.indent--;
        this.line("}");
        return;
      }
      case "c-try": {
        // Unified ll_frame model (Cr-0): a `finally` installs a CLEANUP frame (outer), a catch chain a
        // CATCH frame (inner) -- `finally` wraps `catch`. `throw` routes through ll_unwind, which longjmps
        // into the CLEANUP pad on the propagate path; the SAME `finally` is reached by structured
        // fall-through and by the pad landing (one join, discriminated by `pending`), so it is emitted
        // ONCE. `return` stays inline (emitReturn) -- the one tryStack entry carries the OUTERMOST frame,
        // so `ll_handler_top = frame.prev` pops the whole try in one shot. A distinct CLEANUP frame (not a
        // fold into the catch else-arm) is what lets a later restart's ll_unwind run the finally while
        // SKIPPING the catch.
        const hasC = s.catches.length > 0;
        const hasF = !!s.finalizer;
        if (!hasC && !hasF) {
          // A bare `try (body)`: no handlers, no frames -- a throw just propagates. Emit the body plain.
          this.line("{");
          this.indent++;
          this.emitBlockStmts(s.tryBlock);
          this.indent--;
          this.line("}");
          return;
        }
        const cl = hasF ? `__cl${this.fresh++}` : "";
        const ca = hasC ? `__ca${this.fresh++}` : "";
        const outer = hasF ? cl : ca; // one pop of the outermost frame restores the whole try
        this.line("{");
        this.indent++;
        if (hasF) {
          this.line(`ll_frame ${cl}; ${cl}.kind = LL_CLEANUP; ${cl}.dtor = 0; ${cl}.pending = LL_UNWIND_NONE;`);
          this.line(`${cl}.prev = ll_handler_top; ll_handler_top = &${cl};`);
        }
        this.tryStack.push({ frameVar: outer, finalizer: s.finalizer });
        if (hasF) { this.line(`if (setjmp(${cl}.buf) == 0) {`); this.indent++; }
        if (hasC) {
          this.line(`ll_frame ${ca}; ${ca}.kind = LL_CATCH; ${ca}.prev = ll_handler_top; ll_handler_top = &${ca};`);
          this.line(`if (setjmp(${ca}.buf) == 0) {`);
          this.indent++;
          this.emitBlockStmts(s.tryBlock);
          this.line(`ll_handler_top = ${ca}.prev;`); // normal body completion: pop CATCH
          this.indent--;
          this.line("} else {");
          this.indent++;
          this.line(`ll_handler_top = ${ca}.prev;`); // longjmp landing: pop CATCH
          this.line(`ll_value ${s.errVar} = ${ca}.err;`);
          this.emitCatchChain(s, s.catches, 0);
          this.indent--;
          this.line("}");
        } else {
          this.emitBlockStmts(s.tryBlock); // finally-only: body runs directly under the CLEANUP frame
        }
        if (hasF) {
          this.line(`ll_handler_top = ${cl}.prev;`); // STRUCTURED completion (normal OR catch-match): pop CLEANUP
          this.indent--;
          this.line("} else {");
          this.indent++;
          this.line(`ll_handler_top = ${cl}.prev;`); // UNWIND landing (propagate / throw-in-catch): pop CLEANUP
          this.indent--;
          this.line("}");
        }
        this.tryStack.pop();
        if (hasF) {
          this.emitBlockStmts(s.finalizer!); // finally, emitted ONCE (tryStack popped -> a return here routes to outer)
          this.line(`if (${cl}.pending != LL_UNWIND_NONE) ll_unwind(${cl}.prev, ${cl}.pending, ${cl}.target, ${cl}.err, ${cl}.which);`);
        }
        this.indent--;
        this.line("}");
        return;
      }
      case "c-restart-case": {
        // D47 (Cr-1a): an LL_RESTART frame (a setjmp pad) offering the arm names. Body runs installed; an
        // invoke-restart longjmps into the else-branch and switches on `which` to the chosen arm, which
        // unpacks its params from the packed args (rc.err). Mirrors c-try's frame install/pop + tryStack.
        const rc = `__rc${this.fresh++}`;
        this.line("{");
        this.indent++;
        this.line(`ll_frame ${rc}; ${rc}.kind = LL_RESTART;`);
        if (s.arms.length) {
          this.line(`static const char* ${rc}_names[] = {${s.arms.map((a) => `"${cEscape(a.name)}"`).join(", ")}};`);
          this.line(`${rc}.names = ${rc}_names; ${rc}.name_count = ${s.arms.length};`);
        } else {
          this.line(`${rc}.names = 0; ${rc}.name_count = 0;`);
        }
        this.line(`${rc}.prev = ll_handler_top; ll_handler_top = &${rc};`);
        // A `return` in the body must pop this frame (else ll_handler_top dangles at a dead C frame).
        this.tryStack.push({ frameVar: rc, finalizer: null });
        this.line(`if (setjmp(${rc}.buf) == 0) {`);
        this.indent++;
        this.emitBlockStmts(s.body); // body assigns the pre-declared result temp
        this.line(`ll_handler_top = ${rc}.prev;`); // normal completion: pop
        this.indent--;
        this.line("} else {");
        this.indent++;
        this.line(`ll_handler_top = ${rc}.prev;`); // restart landing: pop
        if (s.arms.length) {
          this.line(`switch (${rc}.which) {`);
          this.indent++;
          s.arms.forEach((arm, i) => {
            this.line(`case ${i}: {`);
            this.indent++;
            arm.paramCNames.forEach((pc, j) => this.line(`ll_value ${pc} = ll_index_vec(ll_unbox_vec(${rc}.err), ${j});`));
            this.emitBlockStmts(arm.body); // arm assigns the same result temp
            this.line("break;");
            this.indent--;
            this.line("}");
          });
          this.indent--;
          this.line("}");
        }
        this.indent--;
        this.line("}");
        this.tryStack.pop();
        this.indent--;
        this.line("}");
        return;
      }
      case "c-handle": {
        // D47 (Cr-1b): ONE bookkeeping LL_HANDLER frame -- never a longjmp target (ll_signal walks it
        // in place), so no setjmp pad. Clause handlers are lifted fns (abi:"handler") sharing one env,
        // malloc'd + filled here (a fresh snapshot per execution of the form).
        const hf = `__h${this.fresh++}`;
        this.line("{");
        this.indent++;
        this.line(`ll_frame ${hf}; ${hf}.kind = LL_HANDLER; ${hf}.active = 1;`);
        if (s.clauses.length) {
          this.line(`static const char* ${hf}_types[] = {${s.clauses.map((c) => `"${cEscape(c.condType)}"`).join(", ")}};`);
          this.line(`static ll_value (*${hf}_fns[])(void*, ll_value) = {${s.clauses.map((c) => c.handlerFnName).join(", ")}};`);
          this.line(`${hf}.cond_types = ${hf}_types; ${hf}.handlers = ${hf}_fns; ${hf}.clause_count = ${s.clauses.length};`);
        } else {
          this.line(`${hf}.cond_types = 0; ${hf}.handlers = 0; ${hf}.clause_count = 0;`);
        }
        if (s.envStruct) {
          this.line(`${s.envStruct}* ${hf}_env = (${s.envStruct}*)ll_alloc(sizeof(${s.envStruct}));`);
          for (const c of s.captures) this.line(`${hf}_env->${c.field} = ${this.expr(c.value)};`);
          this.line(`${hf}.henv = ${hf}_env;`);
        } else {
          this.line(`${hf}.henv = 0;`);
        }
        this.line(`${hf}.prev = ll_handler_top; ll_handler_top = &${hf};`);
        // A `return` in the body must pop this frame (the c-restart-case discipline); non-local exits
        // pop it for free (every landing pad resets ll_handler_top past the inner frames).
        this.tryStack.push({ frameVar: hf, finalizer: null });
        this.emitBlockStmts(s.body); // body assigns the pre-declared result temp
        this.line(`ll_handler_top = ${hf}.prev;`); // completion: pop
        this.tryStack.pop();
        this.indent--;
        this.line("}");
        return;
      }
      // D58's state machine. These two are the ENTIRE control-flow cost of the coroutine lowering:
      // the body around them is emitted completely unchanged, and re-entry jumps straight to a label
      // inside whatever (possibly nested) loop the generator suspended in. That is legal C -- a
      // `goto` may enter a block -- and it is safe here because `promoteFrame` left the step function
      // with no locals at all, so no jump can skip an initialisation.
      case "c-dispatch": {
        this.line(`switch ((int)ll_unbox_int((${GEN_FRAME})->fields[${s.stateSlot}])) {`);
        this.indent++;
        this.line("case 0: break;"); // 0 = not started: fall through into the body
        for (const st of s.states) this.line(`case ${st}: goto ${GEN_LABEL}${st};`);
        this.line("default: return ll_nil();"); // parked: exhausted, or ended by `return`
        this.indent--;
        this.line("}");
        return;
      }
      case "c-label":
        // The trailing `;` is required: C forbids a label at the end of a block, and a resume point
        // that happens to be the last statement of a loop body is exactly that.
        this.line(`${GEN_LABEL}${s.state}: ;`);
        return;

      default: {
        const never: never = s;
        throw new EmitRefusal((never as any)?.src, `statement:${(never as any).kind}`);
      }
    }
  }

  /** The catch filter chain: try each filtered catch by type, then the default; no match rethrows. */
  private emitCatchChain(s: Extract<CStmt, { kind: "c-try" }>, catches: Extract<CStmt, { kind: "c-try" }>["catches"], i: number): void {
    if (i >= catches.length) {
      // No arm matched -> rethrow. ll_throw -> ll_unwind walks out from ll_handler_top (already this try's
      // CLEANUP frame or the enclosing handler): the CLEANUP pad runs this try's `finally` on the way, so
      // there is no inline finalizer here anymore (that was the Phase-0 model, pre-Cr-0).
      this.line(`ll_throw(${s.errVar});`);
      return;
    }
    const c = catches[i];
    const bindAndBody = () => {
      if (c.errorCName) this.line(`ll_value ${c.errorCName} = ${s.errVar};`);
      this.emitBlockStmts(c.body);
    };
    if (!c.filterTypeName) { bindAndBody(); return; } // the default catch
    this.line(`if (ll_is_type(${s.errVar}, "${c.filterTypeName}", 0)) {`);
    this.indent++;
    bindAndBody();
    this.indent--;
    this.line("} else {");
    this.indent++;
    this.emitCatchChain(s, catches, i + 1);
    this.indent--;
    this.line("}");
  }

  private lvalue(l: CLValue): string {
    if (l.kind === "name") return l.cell ? `${l.cName}.as.o->fields[0]` : l.cName;
    // C2: a frame slot holding a CELL is written THROUGH the cell, so the enclosing scope sees it.
    // Without this the generator mutates its own copy -- the by-value failure C1 chased.
    if (l.kind === "field") {
      const f = `(${this.expr(l.object)})->fields[${l.slot}]`;
      return l.cell ? `${f}.as.o->fields[0]` : f;
    }
    if (l.kind === "dyn-field") return `*ll_member_slot(${this.expr(l.object)}, ${JSON.stringify(l.fieldName)})`;
    // index store: a partial write into a vector or map.
    if (l.mode === "map") return `*ll_map_slot(${this.expr(l.base)}, ${this.expr(l.index)})`;
    // A BOXED base (e.g. the result of a dynamic member read) has no static container type, so it
    // cannot take `->items` -- the runtime picks the container by tag, as the read side already does
    // with ll_index_dyn. This case used to fall through to the vector spelling and fail to compile.
    if (l.mode === "boxed") return `*ll_index_slot(${this.expr(l.base)}, ${this.expr(l.index)})`;
    return `(${this.expr(l.base)})->items[${this.expr(l.index)}]`;
  }

  private expr(e: CExpr): string {
    switch (e.kind) {
      case "c-lit":
        switch (e.lit) {
          case "int": return e.value === "LL_END" ? "LL_END" : `INT64_C(${e.value})`;
          case "real":
            if (e.value === "NAN" || e.value === "INFINITY") return e.value; // math.h macros
            return /[.eE]/.test(e.value) ? e.value : `${e.value}.0`;
          case "bool": return e.value;
          case "char": return e.value;
          case "str": return cStr(e.value);
          case "nil": return "ll_nil()";
        }
        break;
      case "c-ref":
        return e.cell ? `ll_cell_get(${e.cName})` : e.cName;
      case "c-temp":
        return e.name;
      case "c-nil":
        return "ll_nil()";
      case "c-invoke-restart":
        // D47 (Cr-1a): a diverging transfer to the named restart. The name is a BARE C string (not an
        // ll_str); packedArgs is the boxed positional arg vector (P2 boxed it) or nil.
        return `ll_invoke_restart("${cEscape(e.name)}", ${this.expr(e.packedArgs)})`;
      case "c-signal":
        // D47 (Cr-1b): the in-place LL_HANDLER walk; nil on all-decline, diverges on a transfer.
        return `ll_signal(${this.expr(e.condition)})`;
      case "c-interp": {
        const parts = e.parts.map((p) =>
          typeof p === "string" ? `ll_box_str(${cStr(p)})` : this.expr(p)
        );
        return `ll_str_concat_n(${parts.length}, (ll_value[]){${parts.join(", ")}})`;
      }
      case "c-call": {
        const args = e.args.map((a) => this.expr(a));
        switch (e.callee.kind) {
          case "free":
            return `${e.callee.cName}(${args.join(", ")})`;
          case "intrinsic": {
            if (e.callee.variadic) {
              // With a SPREAD the argument count is not known here, so the list is built first and the
              // INTRINSIC is passed to a helper that can hold it -- `v->len, v->items` needs the vector
              // twice, which a C expression cannot express without a statement-expression.
              // Split on the return type rather than cast the function pointer: calling through an
              // incompatible pointer type is UB (C11 6.3.2.3p8), and `ll_console_log` returns void.
              if (e.spread?.some(Boolean)) {
                const mask = e.spread.map((s) => (s ? "1" : "0")).join(", ");
                const helper = e.callee.ret.k === "void" ? "ll_spread_intrinsic_void" : "ll_spread_intrinsic";
                return `${helper}(${e.callee.runtimeFn}, ${args.length}, (int[]){${mask}}, (ll_value[]){${args.join(", ")}})`;
              }
              return args.length
                ? `${e.callee.runtimeFn}(${args.length}, (ll_value[]){${args.join(", ")}})`
                : `${e.callee.runtimeFn}(0, (ll_value*)0)`;
            }
            // A host intrinsic ignores EXTRA args (JS semantics: `Math.random(0,100)` is valid and
            // returns [0,1)). Truncate to the declared arity so the C call type-checks.
            const fixed = args.slice(0, e.callee.params.length);
            return `${e.callee.runtimeFn}(${fixed.join(", ")})`;
          }
          case "closure": {
            // The uniform boxed convention: unbox the value to a closure, pass boxed args. P2 has
            // coerced `fn` to a boxed value and every arg to `value`.
            const fn = this.expr(e.callee.fn);
            // With a SPREAD the argument list is built first, because its length is not known here.
            if (e.spread?.some(Boolean)) {
              const mask = e.spread.map((s) => (s ? "1" : "0")).join(", ");
              return `ll_call_spread(${fn}, ${args.length}, (int[]){${mask}}, (ll_value[]){${args.join(", ")}})`;
            }
            return args.length
              ? `ll_call(${fn}, ${args.length}, (ll_value[]){${args.join(", ")}})`
              : `ll_call(${fn}, 0, (ll_value*)0)`;
          }
        }
        break;
      }
      case "c-binop": {
        const l = this.expr(e.lhs);
        const r = this.expr(e.rhs);
        switch (e.mode) {
          case "int":
            // `/` and `%` go through a guarded helper (D85). Raw `a / b` is undefined for b == 0 AND
            // for INT64_MIN / -1, and undefined is not a value: the same emitted unit answered 0 at
            // -O0 and 1 at -O2 on arm64, and traps on x86. `ll_idiv` panics on zero and spells the
            // INT_MIN case as the wrap D51 promises.
            //
            // ELIDED for a literal divisor that is neither 0 nor -1 -- the common `(/ n 2)` shape --
            // so the guard costs nothing where it provably cannot fire. A literal ZERO never reaches
            // here: `LL0244` rejects it at the type stage.
            if (e.op === "/" || e.op === "%") {
              const lit = e.rhs.kind === "c-lit" && e.rhs.lit === "int" ? e.rhs.value : undefined;
              const safe = lit !== undefined && lit !== "0" && lit !== "-1";
              if (!safe) return `${e.op === "/" ? "ll_idiv" : "ll_imod"}(${l}, ${r})`;
            }
            return `(${l} ${e.op} ${r})`;
          case "real":
            if (e.op === "%") return `fmod(${l}, ${r})`;
            return `(${l} ${e.op} ${r})`;
          case "bool":
            return `(${l} ${e.op} ${r})`;
          case "str-cmp":
            return `(ll_str_cmp(${l}, ${r}) ${e.op} 0)`;
          case "str-concat":
            return `ll_concat_vals(${l}, ${r})`;
          case "eq-deep":
            return e.op === "!=" ? `(!ll_deep_eq(${l}, ${r}))` : `ll_deep_eq(${l}, ${r})`;
          case "boxed": {
            const fn: Record<string, string> = {
              "+": "ll_op_add", "-": "ll_op_sub", "*": "ll_op_mul", "/": "ll_op_div", "%": "ll_op_mod",
              "<": "ll_op_lt", ">": "ll_op_gt", "<=": "ll_op_le", ">=": "ll_op_ge",
            };
            const name = fn[e.op];
            if (!name) throw new EmitRefusal(e.src, `boxed-op:${e.op}`);
            return `${name}(${l}, ${r})`;
          }
        }
        break;
      }
      case "c-unop":
        return `(${e.op}${this.expr(e.operand)})`;
      case "c-ternary":
        return `(${this.expr(e.test)} ? ${this.expr(e.then)} : ${this.expr(e.else)})`;
      case "c-seq":
        return `(${e.exprs.map((x) => this.expr(x)).join(", ")})`;
      case "c-vector": {
        const els = e.elements.map((el) => this.expr(el));
        // A vector carrying a SPREAD is built rather than laid out: the final length is not known
        // until the spread parts have been walked. Everything else keeps `ll_vec_of`, which is one
        // allocation and a copy.
        if (e.spread?.some(Boolean)) {
          const mask = e.spread.map((s) => (s ? "1" : "0")).join(", ");
          return `ll_vec_build(${els.length}, (int[]){${mask}}, (ll_value[]){${els.join(", ")}})`;
        }
        return els.length
          ? `ll_vec_of(${els.length}, (ll_value[]){${els.join(", ")}})`
          : "ll_vec_of(0, (ll_value*)0)";
      }
      case "c-map": {
        if (e.entries.length === 0) return "ll_map_of(0, (ll_str**)0, (ll_value*)0)";
        const keys = e.entries.map((en) =>
          typeof en.key === "string" ? cStr(en.key) : this.expr(en.key)
        );
        const vals = e.entries.map((en) => this.expr(en.value));
        return `ll_map_of(${e.entries.length}, (ll_str*[]){${keys.join(", ")}}, (ll_value[]){${vals.join(", ")}})`;
      }
      case "c-index": {
        const b = this.expr(e.base);
        const i = this.expr(e.index);
        switch (e.mode) {
          case "vec": return e.checked ? `ll_index_vec(${b}, ${i})` : `(${b})->items[${i}]`;
          case "map": return e.checked ? `ll_index_map(${b}, ${i})` : `ll_get_map(${b}, ${i})`;
          case "str": return `ll_index_str(${b}, ${i})`;
          case "boxed": return `ll_index_dyn(${b}, ${i})`;
        }
        break;
      }
      case "c-member":
        return e.needsName
          ? `${e.runtimeFn}(${this.expr(e.object)}, ${cStr(e.fieldName)})`
          : `${e.runtimeFn}(${this.expr(e.object)})`;
      case "c-box": {
        if (e.from.k === "value") return this.expr(e.inner);
        const fn = BOX_FN[e.from.k];
        if (!fn) throw new EmitRefusal(e.src, `box:${e.from.k}`);
        return `${fn}(${this.expr(e.inner)})`;
      }
      case "c-unbox": {
        if (e.to.k === "value") return this.expr(e.inner);
        const fn = UNBOX_FN[e.to.k];
        if (!fn) throw new EmitRefusal(e.src, `unbox:${e.to.k}`);
        return `${fn}(${this.expr(e.inner)})`;
      }
      case "c-cast": {
        const inner = this.expr(e.inner);
        // An IDENTITY cast is a no-op, and it reached here as a crash. Every arm below converts
        // between two DIFFERENT representations, so a same-kind cast fell off the end into
        // `no cast closure -> closure` -- an uncaught exception with a bare stack trace rather than a
        // diagnostic. P2 can legitimately produce one: it inserts a cast wherever the declared and
        // actual ctypes are not identical OBJECTS, and two structurally equal `closure` types are not.
        // Emitting the operand unchanged is correct for any kind, which is what makes this safe as a
        // blanket case rather than one more pair in the table.
        if (e.to.k === e.from.k) return inner;
        if (e.to.k === "real" && e.from.k === "int") return `(double)(${inner})`;
        if (e.to.k === "int" && e.from.k === "real") return `(int64_t)(${inner})`;
        if (e.to.k === "str") {
          if (e.from.k === "int") return `ll_int_to_str(${inner})`;
          if (e.from.k === "real") return `ll_real_to_str(${inner})`;
          if (e.from.k === "bool") return `ll_bool_to_str(${inner})`;
        }
        if (e.to.k === "bool" && e.from.k === "int") return `((${inner}) != 0)`;
        throw new EmitRefusal(e.src, `cast:${e.from.k}->${e.to.k}`);
      }
      case "c-construct": {
        const args = e.args.map((a) => this.expr(a));
        const make = args.length
          ? `ll_obj_new(&__ll_class_${e.className}, ${args.length}, (ll_value[]){${args.join(", ")}})`
          : `ll_obj_new(&__ll_class_${e.className}, 0, (ll_value*)0)`;
        if (!e.initMethods || !e.initMethods.length) return make;
        // `:ctor` initializer methods run on the fresh object (deriving fields) then it is the value:
        // a GNU statement-expression, `({ ll_obj* __o = make; init1(__o); ...; __o; })`.
        const calls = e.initMethods.map((cn) => `${cn}(__o);`).join(" ");
        return `({ ll_obj* __o = ${make}; ${calls} __o; })`;
      }
      case "c-field-get": {
        // The raw slot holds a boxed ll_value; P2 inserts the unbox to the field's static type.
        const f = `(${this.expr(e.object)})->fields[${e.slot}]`;
        // C2: a generator frame slot carrying a MUTABLE CAPTURE holds the cell object, not the value.
        return e.cell ? `ll_cell_get(${f})` : f;
      }
      case "c-copy":
        // CP3 materialization: a struct deep-copies (recursing struct fields); everything else is
        // shared/value. The runtime dispatches on the tag; ll_copy_obj keeps the typed obj shape.
        if (e.inner.ctype.k === "obj") return `ll_copy_obj(${this.expr(e.inner)})`;
        if (e.inner.ctype.k === "value") return `ll_copy(${this.expr(e.inner)})`;
        return this.expr(e.inner);
      case "c-closure-make": {
        const nm = `"${cEscape(e.name)}"`;
        if (!e.envStruct) {
          // No captures -> a NULL env.
          return `ll_closure_make(${e.liftedName}, (void*)0, ${e.arity}, ${nm})`;
        }
        // Allocate and fill the env, then build the closure. Uses a GNU statement-expression so a
        // closure-make is a single C expression (portable across gcc/clang; the corpus target).
        const alloc = `${e.envStruct}* __e = (${e.envStruct}*)ll_alloc(sizeof(${e.envStruct}))`;
        const fills = e.captures.map((c) => `__e->${c.field} = ${this.expr(c.value)}`).join("; ");
        return `({ ${alloc}; ${fills}; ll_closure_make(${e.liftedName}, __e, ${e.arity}, ${nm}); })`;
      }
      case "c-type-test":
        return `ll_is_type(${this.expr(e.operand)}, "${e.typeName}", ${e.primitive ? 1 : 0})`;
      case "c-bind":
        return `(${e.cName} = ${this.expr(e.value)})`;
      default: {
        const never: never = e;
        throw new EmitRefusal((never as any)?.src, `expression:${(never as any).kind}`);
      }
    }
    throw new Error("C emit: unreachable");
  }
}
