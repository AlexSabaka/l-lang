// P3 -- CIR -> C source. Mechanical (the EmitHirToEstree posture): exhaustive switches, hard-throw
// default. Consumes ONLY the CIR -- no AST, no nodeTypes, no symbol table. If a case here would need
// a judgment call, that judgment belongs in P1/P2.

import { CBlock, CExpr, CStmt, CFunction, CModule, CLValue, CLifted, CParam } from "./cir";
import { CType } from "./ctype";

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

export class EmitCirToC {
  private out: string[] = [];
  private indent = 0;
  private fresh = 0;

  emitModule(m: CModule): string {
    this.out = [];
    // Forward declarations FIRST: the class method-table adapters (below) call the method functions,
    // so those must be declared before the class descriptors.
    for (const f of m.functions) this.line(this.signature(f) + ";");
    for (const l of m.lifted) this.line(`static ll_value ${l.liftedName}(void* __env, int __argc, ll_value* __argv);`);
    for (const a of m.adapters) this.line(`static ll_value __ll_adapter_${a.forCName}(void* __env, int __argc, ll_value* __argv);`);
    if (m.functions.length || m.lifted.length || m.adapters.length) this.line("");
    // Struct/class descriptors (ll_class): field names in slot order, is_struct, `:extends` parent, and
    // a dynamic-dispatch method table (boxed adapters) for statically-unknown receivers.
    for (const c of m.classes) {
      const fieldsArr = c.fields.length
        ? `static const char* __ll_fields_${c.name}[] = {${c.fields.map((f) => `"${f.name}"`).join(", ")}};`
        : `static const char** __ll_fields_${c.name} = 0;`;
      this.line(fieldsArr);
      for (const mm of c.methods) this.emitMethodAdapter(mm);
      if (c.methods.length) {
        this.line(`static const ll_method_entry __ll_methods_${c.name}[] = {${c.methods.map((mm) => `{${JSON.stringify(mm.name)}, ${mm.cName}_dyn}`).join(", ")}};`);
      }
      const methodsPtr = c.methods.length ? `__ll_methods_${c.name}` : "0";
      this.line(`static ll_class __ll_class_${c.name} = {"${c.name}", ${c.isStruct ? "true" : "false"}, ${c.fields.length}, __ll_fields_${c.name}, ${c.parent ? `"${c.parent}"` : "0"}, ${c.methods.length}, ${methodsPtr}};`);
    }
    // A registry of every class, for `type-by-name` reflection. External linkage so the prepended
    // runtime's reflection helpers (which forward-declare it `extern`) can reach it in this one TU.
    const regEntries = m.classes.length ? m.classes.map((c) => `&__ll_class_${c.name}`).join(", ") : "0";
    this.line(`ll_class* __ll_class_registry[] = {${regEntries}};`);
    this.line(`size_t __ll_class_count = ${m.classes.length};`);
    this.line("");
    // Module-level bindings referenced by functions -> file-scope globals. A file-scope initializer
    // must be a compile-time constant, so use a zero-init (ll_value {0} == LL_NIL); the real value is
    // assigned in main at the binding's original position.
    for (const g of m.globals) this.line(`static ${cType(g.ctype)} ${g.cName} = ${staticZero(g.ctype)};`);
    if (m.globals.length) this.line("");
    // Env struct definitions for lifted closures that capture.
    for (const l of m.lifted) {
      if (!l.envStruct) continue;
      this.line(`typedef struct ${l.envStruct} {`);
      this.indent++;
      for (const c of l.captures) this.line(`${c.cell ? "ll_value*" : cType(c.ctype)} ${c.field};`);
      this.indent--;
      this.line(`} ${l.envStruct};`);
    }
    if (m.lifted.some((l) => l.envStruct)) this.line("");
    for (const f of m.functions) this.emitFunction(f);
    for (const l of m.lifted) this.emitLifted(l);
    for (const a of m.adapters) this.emitAdapter(a);
    this.line("int main(void) {");
    this.indent++;
    this.emitBlockStmts(m.main);
    this.line("return 0;");
    this.indent--;
    this.line("}");
    return this.out.join("\n") + "\n";
  }

  /** A lifted closure body: unpack params from argv, captures from env, then the resolved body. */
  private emitLifted(l: CLifted): void {
    this.line(`static ll_value ${l.liftedName}(void* __env, int __argc, ll_value* __argv) {`);
    this.indent++;
    this.line("(void)__argc;");
    if (l.envStruct) this.line(`${l.envStruct}* __e = (${l.envStruct}*)__env; (void)__e;`);
    else this.line("(void)__env;");
    l.params.forEach((p, i) => {
      if (p.ctype.k === "value") this.line(`ll_value ${p.cName} = __argv[${i}];`);
      else this.line(`${cType(p.ctype)} ${p.cName} = ${UNBOX_FN[p.ctype.k]}(__argv[${i}]);`);
    });
    for (const c of l.captures) {
      this.line(`${c.cell ? "ll_value*" : cType(c.ctype)} ${c.field} = __e->${c.field};`);
    }
    this.emitBlockStmts(l.body);
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
    const argParts = m.params.map((t, i) => (t.k === "value" ? `__argv[${i}]` : `${UNBOX_FN[t.k]}(__argv[${i}])`));
    const call = `${m.cName}(ll_unbox_obj(__self)${argParts.length ? ", " + argParts.join(", ") : ""})`;
    if (m.ret.k === "void") this.line(`${call}; return ll_nil();`);
    else if (m.ret.k === "value") this.line(`return ${call};`);
    else this.line(`return ${BOX_FN[m.ret.k]}(${call});`);
    this.indent--;
    this.line("}");
  }

  /** A boxed-convention adapter for a top-level function used as a value: unbox, call, box. */
  private emitAdapter(a: { forCName: string; params: CType[]; ret: CType; arity: number }): void {
    this.line(`static ll_value __ll_adapter_${a.forCName}(void* __env, int __argc, ll_value* __argv) {`);
    this.indent++;
    this.line("(void)__env; (void)__argc;");
    const callArgs = a.params.map((t, i) => (t.k === "value" ? `__argv[${i}]` : `${UNBOX_FN[t.k]}(__argv[${i}])`));
    const call = `${a.forCName}(${callArgs.join(", ")})`;
    if (a.ret.k === "void") this.line(`${call}; return ll_nil();`);
    else if (a.ret.k === "value") this.line(`return ${call};`);
    else this.line(`return ${BOX_FN[a.ret.k]}(${call});`);
    this.indent--;
    this.line("}");
    this.line("");
  }

  private signature(f: CFunction): string {
    const params = f.params.length
      ? f.params.map((p) => `${cType(p.ctype)} ${p.cName}`).join(", ")
      : "void";
    return `static ${cType(f.ret)} ${f.cName}(${params})`;
  }

  private emitFunction(f: CFunction): void {
    this.line(`${this.signature(f)} {`);
    this.indent++;
    this.emitBlockStmts(f.body);
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
          this.line(`ll_value* ${s.cName} = ll_cell(${s.init ? this.expr(s.init) : "ll_nil()"});`);
        } else {
          this.line(`${cType(s.declCType)} ${s.cName} = ${s.init ? this.expr(s.init) : defaultInit(s.declCType)};`);
        }
        return;
      case "c-assign":
        this.line(`${this.lvalue(s.target)} = ${this.expr(s.value)};`);
        return;
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
        this.line(s.value ? `return ${this.expr(s.value)};` : "return;");
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
            update = `${s.update.target.cName} = ${this.expr(s.update.value)}`;
          } else throw new Error("C emit: for update must be an expression or a simple assignment");
        }
        this.line(`for (; ${test}; ${update}) {`);
        this.indent++;
        this.emitBlockStmts(s.body);
        this.indent--;
        this.line("}");
        this.indent--;
        this.line("}");
        return;
      }
      case "c-foreach": {
        // The loop variable is declared OUTSIDE the loop: the `:else` block runs after completion and
        // may read the variable's last value (the corpus golden proves this semantic).
        const v = `__c${this.fresh++}`;
        const i = `__i${this.fresh++}`;
        this.line("{");
        this.indent++;
        this.line(`ll_vec* ${v} = ${this.expr(s.collection)};`);
        this.line(`${cType(s.varCType)} ${s.varCName} = ${defaultInit(s.varCType)};`);
        this.line(`for (size_t ${i} = 0; ${i} < ${v}->len; ${i}++) {`);
        this.indent++;
        const elem = `ll_copy(${v}->items[${i}])`; // D11 per-iteration copy (identity for non-structs)
        if (s.varCType.k === "value") {
          this.line(`${s.varCName} = ${elem};`);
        } else {
          this.line(`${s.varCName} = ${UNBOX_FN[s.varCType.k]}(${elem});`);
        }
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
        const f = `__t${this.fresh++}`;
        this.line("{");
        this.indent++;
        this.line(`ll_try_frame ${f}; ${f}.prev = ll_handler_top; ll_handler_top = &${f};`);
        this.line(`if (setjmp(${f}.buf) == 0) {`);
        this.indent++;
        this.emitBlockStmts(s.tryBlock);
        this.line(`ll_handler_top = ${f}.prev;`);
        this.indent--;
        this.line("} else {");
        this.indent++;
        this.line(`ll_handler_top = ${f}.prev;`);
        this.line(`ll_value ${s.errVar} = ${f}.err;`);
        this.emitCatchChain(s, s.catches, 0);
        this.indent--;
        this.line("}");
        if (s.finalizer) this.emitBlockStmts(s.finalizer);
        this.indent--;
        this.line("}");
        return;
      }
      case "c-restart-case":
      case "c-handle":
        // D47 SCAFFOLD (TODO restart-stage2). ResolveHirToCir refuses restart forms today, so these CIR
        // nodes are never actually produced -- this case exists as plumbing for the stage-2 lowering, and
        // as the exhaustiveness anchor keeping the `never` check honest once the union carries them. When
        // stage-2 lands, this emits the setjmp-pad inline arms (restart-case) / ordered handler frame
        // (handle) against the runtime.c handler stack. Emitting a TODO marker keeps any accidental
        // reach loud rather than silently wrong.
        this.line(`/* TODO(restart-stage2): emit ${s.kind} -- D47 setjmp/handler-stack lowering */`);
        return;
      default: {
        const never: never = s;
        throw new Error(`C emit: unhandled statement kind '${(never as any).kind}'`);
      }
    }
  }

  /** The catch filter chain: try each filtered catch by type, then the default; no match rethrows. */
  private emitCatchChain(s: Extract<CStmt, { kind: "c-try" }>, catches: Extract<CStmt, { kind: "c-try" }>["catches"], i: number): void {
    if (i >= catches.length) {
      this.line(`ll_throw(${s.errVar});`); // no arm matched -> rethrow
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
    if (l.kind === "name") return l.cell ? `(*${l.cName})` : l.cName;
    if (l.kind === "field") return `(${this.expr(l.object)})->fields[${l.slot}]`;
    if (l.kind === "dyn-field") return `*ll_member_slot(${this.expr(l.object)}, ${JSON.stringify(l.fieldName)})`;
    // index store: a partial write into a vector or map.
    if (l.mode === "map") return `*ll_map_slot(${this.expr(l.base)}, ${this.expr(l.index)})`;
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
          case "str": return `ll_str_lit("${cEscape(e.value)}")`;
          case "nil": return "ll_nil()";
        }
        break;
      case "c-ref":
        return e.cell ? `(*${e.cName})` : e.cName;
      case "c-temp":
        return e.name;
      case "c-nil":
        return "ll_nil()";
      case "c-interp": {
        const parts = e.parts.map((p) =>
          typeof p === "string" ? `ll_box_str(ll_str_lit("${cEscape(p)}"))` : this.expr(p)
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
            if (!name) throw new Error(`C emit: no boxed runtime op for '${e.op}'`);
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
        return els.length
          ? `ll_vec_of(${els.length}, (ll_value[]){${els.join(", ")}})`
          : "ll_vec_of(0, (ll_value*)0)";
      }
      case "c-map": {
        if (e.entries.length === 0) return "ll_map_of(0, (ll_str**)0, (ll_value*)0)";
        const keys = e.entries.map((en) =>
          typeof en.key === "string" ? `ll_str_lit("${cEscape(en.key)}")` : this.expr(en.key)
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
          ? `${e.runtimeFn}(${this.expr(e.object)}, ll_str_lit("${cEscape(e.fieldName)}"))`
          : `${e.runtimeFn}(${this.expr(e.object)})`;
      case "c-box": {
        if (e.from.k === "value") return this.expr(e.inner);
        const fn = BOX_FN[e.from.k];
        if (!fn) throw new Error(`C emit: no box for ${e.from.k}`);
        return `${fn}(${this.expr(e.inner)})`;
      }
      case "c-unbox": {
        if (e.to.k === "value") return this.expr(e.inner);
        const fn = UNBOX_FN[e.to.k];
        if (!fn) throw new Error(`C emit: no unbox for ${e.to.k}`);
        return `${fn}(${this.expr(e.inner)})`;
      }
      case "c-cast": {
        const inner = this.expr(e.inner);
        if (e.to.k === "real" && e.from.k === "int") return `(double)(${inner})`;
        if (e.to.k === "int" && e.from.k === "real") return `(int64_t)(${inner})`;
        if (e.to.k === "str") {
          if (e.from.k === "int") return `ll_int_to_str(${inner})`;
          if (e.from.k === "real") return `ll_real_to_str(${inner})`;
          if (e.from.k === "bool") return `ll_bool_to_str(${inner})`;
        }
        if (e.to.k === "bool" && e.from.k === "int") return `((${inner}) != 0)`;
        throw new Error(`C emit: no cast ${e.from.k} -> ${e.to.k}`);
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
      case "c-field-get":
        // The raw slot holds a boxed ll_value; P2 inserts the unbox to the field's static type.
        return `(${this.expr(e.object)})->fields[${e.slot}]`;
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
        throw new Error(`C emit: unhandled expression kind '${(never as any).kind}'`);
      }
    }
    throw new Error("C emit: unreachable");
  }
}
