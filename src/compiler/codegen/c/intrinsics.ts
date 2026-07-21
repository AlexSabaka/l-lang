// The C backend's view of the runtime boundary.
//
// `INTRINSIC_CALLS` is no longer a table here: it is DERIVED from the intrinsic floor
// (`compiler/floor/floor.ts`, D50), which states each signature once in l-lang types and is read by
// the checker too. That is the point -- this file used to be a private C-typed table that nothing
// could check against `lib/std/js`'s untyped externs, and the two had silently disagreed about
// `Math.floor`'s return type for as long as both existed.
//
// Native MEMBERS (String.length, Array.push, ...) still mirror src/compiler/types/nativeMembers.ts
// by hand -- the same duplication one layer down, and the next thing the floor should absorb.

import { CType, C_BOOL, C_INT, C_REAL, C_STR, C_VALUE, C_VOID, mapType } from "./ctype";
import { FLOOR } from "../../floor/floor";

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

/**
 * Free-call intrinsics, keyed by the SOURCE callee name (simple or dotted).
 *
 * DERIVED from the intrinsic floor (D50, `compiler/floor/floor.ts`) -- not a table in its own right.
 * The floor states each signature ONCE, in l-lang types; the CTypes below are `mapType`'d from it, so
 * the C backend and the checker cannot hold different opinions about what `Math.floor` returns. That
 * exact disagreement (Real here, `-> Int` in lib/std/math) sat unnoticed for as long as the two
 * halves were separate tables.
 */
export const INTRINSIC_CALLS: ReadonlyMap<string, IntrinsicDef> = new Map<string, IntrinsicDef>(
  [...FLOOR].map(([name, e]) => [
    name,
    { runtimeFn: e.runtimeFn, variadic: !!e.variadic, params: e.params.map(mapType), ret: mapType(e.ret) },
  ])
);

/**
 * Native member METHODS: `recv.m(args)`. Keyed `<base>.<name>` where base is "str" | "vec" | "dyn"
 * (dyn = boxed receiver -- runtime dispatches on the tag; the receiver is arg 0 in every case).
 */
export const NATIVE_METHODS: ReadonlyMap<string, IntrinsicDef> = new Map<string, IntrinsicDef>([
  // String methods (recv: ll_str*)
  ["str.toUpperCase", def("ll_str_upper", [C_STR], C_STR)],
  ["str.toLowerCase", def("ll_str_lower", [C_STR], C_STR)],
  ["str.trim", def("ll_str_trim", [C_STR], C_STR)],
  ["str.trimEnd", def("ll_str_trim_end", [C_STR], C_STR)],
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
