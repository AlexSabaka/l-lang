// The C backend's view of the runtime boundary.
//
// `INTRINSIC_CALLS` is no longer a table here: it is DERIVED from the intrinsic floor
// (`compiler/floor/floor.ts`, D50), which states each signature once in l-lang types and is read by
// the checker too. That is the point -- this file used to be a private C-typed table that nothing
// could check against `lib/std/js`'s untyped externs, and the two had silently disagreed about
// `Math.floor`'s return type for as long as both existed.
//
// Native MEMBERS (String.length, Array.push, ...) are now DERIVED from
// src/compiler/types/nativeMembers.ts too, so the checker and the code generator read one table. They
// used to be hand-mirrored, and the mirror had drifted in COVERAGE -- seven members the checker
// declared and C refused.

import { CType, C_BOOL, C_INT, C_REAL, C_STR, C_VALUE, C_VOID, mapType } from "./ctype";
import { FLOOR } from "../../floor/floor";
import { nativeMemberTable } from "../../types/nativeMembers";

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
 * Native member METHODS and FIELDS, DERIVED from `types/nativeMembers.ts` (the same move Fa made for
 * `INTRINSIC_CALLS`). Keyed `<base>.<name>` where base is "str" | "vec" | "dyn".
 *
 * These used to be two hand-mirrored tables, and the mirroring had drifted -- not in BEHAVIOUR (all
 * 27 shared members were measured byte-identical on both backends) but in COVERAGE: the checker
 * declared `trimStart`, `charCodeAt`, `flat`, and array `lastIndexOf`/`map`/`filter`/`reduce`, and C
 * refused every one of them. Four of those seven were already implemented by `ll_dyn_method`, so a
 * STATICALLY-typed receiver refused where a BOXED one worked -- typing the receiver lost capability.
 *
 * One table now, so a member cannot be declared to the checker and unknown to the code generator.
 * An entry with no `c` lowering is not a hole: `resolveNativeMethod` routes it to the dynamic arm.
 */
const MEMBERS = nativeMemberTable();

export const NATIVE_METHODS: ReadonlyMap<string, IntrinsicDef> = new Map<string, IntrinsicDef>([
  ...MEMBERS.filter((m) => m.kind === "method" && m.c).map(
    (m) => [m.key, def(m.c!.runtimeFn, m.c!.cParams.map(mapType), mapType(m.c!.cRet))] as [string, IntrinsicDef]
  ),
  // Dynamic receiver (boxed): runtime dispatches on the tag. A3 evidence every time. Not a member of
  // any declared type, so it is stated here rather than derived.
  ["dyn.method", def("ll_dyn_method", [], C_VALUE, true)],
]);

/** Native member FIELD reads: `recv.f`. Same keying as methods. */
export const NATIVE_FIELDS: ReadonlyMap<string, { runtimeFn: string; ret: CType }> = new Map([
  ...MEMBERS.filter((m) => m.kind === "field" && m.c).map(
    (m) => [m.key, { runtimeFn: m.c!.runtimeFn, ret: mapType(m.c!.cRet) }] as [string, { runtimeFn: string; ret: CType }]
  ),
  // A boxed receiver's `.length`: the runtime picks str-vs-vec from the tag.
  ["dyn.length", { runtimeFn: "ll_dyn_length", ret: C_INT }],
]);
