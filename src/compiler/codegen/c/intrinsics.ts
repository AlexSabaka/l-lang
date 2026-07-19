// The extern/stdlib intercept table (v0 stdlib strategy).
//
// The JS backend resolves `console.log` / `Math.*` against HOST GLOBALS (the std/js prelude of
// `:extern` declarations) and inlines imported l-lang stdlib bodies. The C pipeline has no host --
// every name below is provided by runtime.c instead. EACH hit that shadows a host global or an
// l-lang stdlib body is A9-extern evidence: the consumption spec has no assumption covering this
// boundary, which is precisely why the table exists.
//
// Native MEMBERS (String.length, Array.push, ...) mirror src/compiler/types/nativeMembers.ts -- the
// side-table the checker already assumes -- resolved here to typed C runtime functions.

import { CType, C_BOOL, C_INT, C_REAL, C_STR, C_VALUE, C_VOID } from "./ctype";

export interface IntrinsicDef {
  runtimeFn: string;
  variadic: boolean;
  params: CType[]; // expected arg types (ignored when variadic: varargs are boxed)
  ret: CType;
}

const VEC_VALUE: CType = { k: "vec", elem: C_VALUE };

function def(runtimeFn: string, params: CType[], ret: CType, variadic = false): IntrinsicDef {
  return { runtimeFn, variadic, params, ret };
}

/** Free-call intrinsics, keyed by the SOURCE callee name (simple or dotted). */
export const INTRINSIC_CALLS: ReadonlyMap<string, IntrinsicDef> = new Map<string, IntrinsicDef>([
  // -- the std/js host boundary (A9) --
  ["console.log", def("ll_console_log", [], C_VOID, true)],
  ["console.error", def("ll_console_error", [], C_VOID, true)],
  // -- lib/std/io (l-lang bodies shadowed in v0; A9) --
  ["print", def("ll_console_log", [], C_VOID, true)],
  ["prn", def("ll_console_log", [], C_VOID, true)],
  // -- number parsing / predicates (host globals, A9) --
  ["Number", def("ll_number", [C_VALUE], C_VALUE)],
  ["parseInt", def("ll_parse_int", [C_VALUE], C_VALUE)],
  ["parseFloat", def("ll_parse_float", [C_VALUE], C_VALUE)],
  ["isNaN", def("ll_is_nan", [C_VALUE], C_BOOL)],
  ["isFinite", def("ll_is_finite", [C_VALUE], C_BOOL)],
  // -- Math.* host globals (A9) --
  ["Math.sqrt", def("ll_math_sqrt", [C_REAL], C_REAL)],
  ["Math.log", def("ll_math_log", [C_REAL], C_REAL)],
  ["Math.exp", def("ll_math_exp", [C_REAL], C_REAL)],
  ["Math.sin", def("ll_math_sin", [C_REAL], C_REAL)],
  ["Math.cos", def("ll_math_cos", [C_REAL], C_REAL)],
  ["Math.tan", def("ll_math_tan", [C_REAL], C_REAL)],
  ["Math.abs", def("ll_math_abs", [C_REAL], C_REAL)],
  ["Math.floor", def("ll_math_floor", [C_REAL], C_REAL)],
  ["Math.ceil", def("ll_math_ceil", [C_REAL], C_REAL)],
  ["Math.round", def("ll_math_round", [C_REAL], C_REAL)],
  ["Math.pow", def("ll_math_pow", [C_REAL, C_REAL], C_REAL)],
  ["Math.min", def("ll_math_min", [C_REAL, C_REAL], C_REAL)],
  ["Math.max", def("ll_math_max", [C_REAL, C_REAL], C_REAL)],
  // -- runtime builtins (the SYMBOL_MAP surface; the runtime is the backend's own contract, but the
  //    callee-identity-by-name resolution is A3 evidence) --
  ["get", def("ll_get", [C_VALUE, C_VALUE], C_VALUE)],
  ["head", def("ll_head", [C_VALUE], C_VALUE)],
  ["tail", def("ll_tail", [C_VALUE], VEC_VALUE)],
  ["empty", def("ll_empty", [C_VALUE], C_BOOL)],
  ["elem", def("ll_elem", [C_VALUE, C_VALUE], C_VALUE)],
  ["list", def("ll_list", [], VEC_VALUE, true)],
]);

/**
 * Native member METHODS: `recv.m(args)`. Keyed `<base>.<name>` where base is "str" | "vec" | "dyn"
 * (dyn = boxed receiver -- runtime dispatches on the tag; the receiver is arg 0 in every case).
 */
export const NATIVE_METHODS: ReadonlyMap<string, IntrinsicDef> = new Map<string, IntrinsicDef>([
  // String methods (recv: ll_str*)
  ["str.toUpperCase", def("ll_str_upper", [C_STR], C_STR)],
  ["str.toLowerCase", def("ll_str_lower", [C_STR], C_STR)],
  ["str.trim", def("ll_str_trim", [C_STR], C_STR)],
  ["str.slice", def("ll_str_slice", [C_STR, C_INT, C_INT], C_STR)], // 1-arg form: P1 pads end with INT64_MAX sentinel
  ["str.substring", def("ll_str_slice", [C_STR, C_INT, C_INT], C_STR)],
  ["str.indexOf", def("ll_str_index_of", [C_STR, C_STR], C_INT)],
  ["str.lastIndexOf", def("ll_str_last_index_of", [C_STR, C_STR], C_INT)],
  ["str.includes", def("ll_str_includes", [C_STR, C_STR], C_BOOL)],
  ["str.startsWith", def("ll_str_starts_with", [C_STR, C_STR], C_BOOL)],
  ["str.endsWith", def("ll_str_ends_with", [C_STR, C_STR], C_BOOL)],
  ["str.replace", def("ll_str_replace", [C_STR, C_STR, C_STR], C_STR)],
  ["str.replaceAll", def("ll_str_replace_all", [C_STR, C_STR, C_STR], C_STR)],
  ["str.repeat", def("ll_str_repeat", [C_STR, C_INT], C_STR)],
  ["str.split", def("ll_str_split", [C_STR, C_STR], { k: "vec", elem: C_STR })],
  ["str.charAt", def("ll_str_char_at", [C_STR, C_INT], C_STR)],
  ["str.concat", def("ll_str_concat2", [C_STR, C_STR], C_STR)],
  ["str.padStart", def("ll_str_pad_start", [C_STR, C_INT, C_STR], C_STR)],
  ["str.padEnd", def("ll_str_pad_end", [C_STR, C_INT, C_STR], C_STR)],
  // Array methods (recv: ll_vec*)
  ["vec.push", def("ll_vec_push", [VEC_VALUE, C_VALUE], C_INT)],
  ["vec.pop", def("ll_vec_pop", [VEC_VALUE], C_VALUE)],
  ["vec.shift", def("ll_vec_shift", [VEC_VALUE], C_VALUE)],
  ["vec.unshift", def("ll_vec_unshift", [VEC_VALUE, C_VALUE], C_INT)],
  ["vec.reverse", def("ll_vec_reverse", [VEC_VALUE], VEC_VALUE)],
  ["vec.slice", def("ll_vec_slice", [VEC_VALUE, C_INT, C_INT], VEC_VALUE)],
  ["vec.concat", def("ll_vec_concat", [VEC_VALUE, VEC_VALUE], VEC_VALUE)],
  ["vec.join", def("ll_vec_join", [VEC_VALUE, C_STR], C_STR)],
  ["vec.indexOf", def("ll_vec_index_of", [VEC_VALUE, C_VALUE], C_INT)],
  ["vec.includes", def("ll_vec_includes", [VEC_VALUE, C_VALUE], C_BOOL)],
  // Dynamic receiver (boxed): runtime dispatches on the tag. A3 evidence every time.
  ["dyn.method", def("ll_dyn_method", [], C_VALUE, true)],
]);

/** Native member FIELD reads: `recv.f`. Same keying as methods. */
export const NATIVE_FIELDS: ReadonlyMap<string, { runtimeFn: string; ret: CType }> = new Map([
  ["str.length", { runtimeFn: "ll_str_len", ret: C_INT }],
  ["vec.length", { runtimeFn: "ll_vec_len", ret: C_INT }],
  ["dyn.length", { runtimeFn: "ll_dyn_length", ret: C_INT }],
]);
