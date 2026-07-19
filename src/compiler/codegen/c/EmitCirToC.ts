// P3 -- CIR -> C source. Mechanical (the EmitHirToEstree posture): exhaustive switches, hard-throw
// default. Consumes ONLY the CIR -- no AST, no nodeTypes, no symbol table. If a case here would need
// a judgment call, that judgment belongs in P1/P2.

import { CBlock, CExpr, CStmt, CFunction, CModule, CLValue } from "./cir";
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
    // Forward declarations, so definition order never matters.
    for (const f of m.functions) this.line(this.signature(f) + ";");
    if (m.functions.length) this.line("");
    for (const f of m.functions) this.emitFunction(f);
    this.line("int main(void) {");
    this.indent++;
    this.emitBlockStmts(m.main);
    this.line("return 0;");
    this.indent--;
    this.line("}");
    return this.out.join("\n") + "\n";
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
        this.line(`${cType(s.declCType)} ${s.cName} = ${s.init ? this.expr(s.init) : defaultInit(s.declCType)};`);
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
      default: {
        const never: never = s;
        throw new Error(`C emit: unhandled statement kind '${(never as any).kind}'`);
      }
    }
  }

  private lvalue(l: CLValue): string {
    if (l.kind === "name") return l.cName;
    throw new Error("C emit: index lvalue not implemented (Phase C)");
  }

  private expr(e: CExpr): string {
    switch (e.kind) {
      case "c-lit":
        switch (e.lit) {
          case "int": return e.value === "LL_END" ? "LL_END" : `INT64_C(${e.value})`;
          case "real": return /[.eE]/.test(e.value) ? e.value : `${e.value}.0`;
          case "bool": return e.value;
          case "char": return e.value;
          case "str": return `ll_str_lit("${cEscape(e.value)}")`;
          case "nil": return "ll_nil()";
        }
        break;
      case "c-ref":
      case "c-temp":
        return e.kind === "c-ref" ? e.cName : e.name;
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
          case "intrinsic":
            if (e.callee.variadic) {
              return args.length
                ? `${e.callee.runtimeFn}(${args.length}, (ll_value[]){${args.join(", ")}})`
                : `${e.callee.runtimeFn}(0, (ll_value*)0)`;
            }
            return `${e.callee.runtimeFn}(${args.join(", ")})`;
          case "closure":
            throw new Error("C emit: closure calls not implemented (Phase B)");
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
      case "c-copy":
        return e.inner.ctype.k === "value" ? `ll_copy(${this.expr(e.inner)})` : this.expr(e.inner);
      default: {
        const never: never = e;
        throw new Error(`C emit: unhandled expression kind '${(never as any).kind}'`);
      }
    }
    throw new Error("C emit: unreachable");
  }
}
