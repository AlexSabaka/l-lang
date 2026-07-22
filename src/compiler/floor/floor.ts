// The intrinsic floor -- the runtime contract BOTH backends read (D50, docs/spec/FLOOR.md).
//
// D48's governing rule A-0 says a decision both backends make must be modelled once so they cannot
// diverge. D50 applies it at the RUNTIME boundary. Before this file that boundary was two private,
// mutually-uncheckable halves:
//
//   * `codegen/c/intrinsics.ts` -- name -> C function, typed in C's own vocabulary. Only C read it.
//   * `lib/std/js/js.lisp`      -- 34 `:extern` names, all Unknown. Only the checker read it.
//
// Nothing compared them, and they really had drifted: `Math.floor` was `Real -> Real` in the C table
// and `-> Int` in `lib/std/math`, invisibly, for as long as both existed (see D51 amendment (b)).
//
// So the signatures here are stated in L-LANG types, not C types. The C backend DERIVES its CTypes
// through the existing `mapType`, which means there is no second table to keep in step -- a floor
// entry cannot say one thing to the checker and another to the code generator, because it only says
// it once.
//
// What belongs here: the irreducible operations of FLOOR.md 2 -- a syscall, a host facility, or a
// representation primitive l-lang cannot express. Everything else is l-lang written ON the floor and
// is therefore portable by construction. The floor is a cost (every entry is a divergence risk that
// must be conformance-tested), so it is kept minimal on purpose.

import { InferredType } from "../analysis/SymbolTable";

/** One floor operation: what it is called, what it takes and returns, and what implements it on C. */
export interface FloorEntry {
  /** The `runtime.c` function this lowers to on the native backend. */
  runtimeFn: string;
  /** Parameter types in l-lang terms. Ignored when `variadic` (varargs are boxed). */
  params: InferredType[];
  ret: InferredType;
  /** A true C varargs call: arity is unchecked and every argument is boxed. */
  variadic?: boolean;
}

// -- l-lang type shorthands. `Any` is the gradual box; `arr(t)` must use `kind:"array"` (mapType
//    reads `inner`), NOT the `generic`/`isArray` spelling nativeMembers uses -- that maps to a boxed
//    value, not a vector.
const Int: InferredType = { kind: "primitive", name: "Int" };
const Real: InferredType = { kind: "primitive", name: "Real" };
const Bool: InferredType = { kind: "primitive", name: "Boolean" };
const Void: InferredType = { kind: "primitive", name: "Void" };
const Str: InferredType = { kind: "primitive", name: "String" };
const Any: InferredType = { kind: "unknown", name: "Any" };
const arr = (t: InferredType): InferredType => ({ kind: "array", name: "Array", inner: t });
const Map_: InferredType = { kind: "map", name: "Map" };

const fn = (runtimeFn: string, params: InferredType[], ret: InferredType, variadic = false): FloorEntry =>
  ({ runtimeFn, params, ret, variadic });

/**
 * The floor, keyed by the SOURCE name a program writes (simple or dotted).
 *
 * Order is the C table's historical order, so the derived `INTRINSIC_CALLS` iterates identically --
 * emitted C is unchanged by construction.
 */
export const FLOOR: ReadonlyMap<string, FloorEntry> = new Map<string, FloorEntry>([
  // -- i/o sink. Formatting is NOT here: `print`'s `{N}` substitution is l-lang (lib/std/io), and
  //    these two are the raw sinks it writes through.
  ["console.log", fn("ll_console_log", [], Void, true)],
  ["console.error", fn("ll_console_error", [], Void, true)],

  // -- number parsing / predicates. `Any` in and out: these accept whatever the host would.
  ["Number", fn("ll_number", [Any], Any)],
  ["parseInt", fn("ll_parse_int", [Any], Any)],
  ["parseFloat", fn("ll_parse_float", [Any], Any)],
  ["isNaN", fn("ll_is_nan", [Any], Bool)],
  ["isFinite", fn("ll_is_finite", [Any], Bool)],

  // -- transcendentals and the float helpers: host libm on C, `Math` on JS, with a documented
  //    last-ULP tolerance (D51). EVERY one returns Real, including floor/ceil/round/trunc -- see
  //    D51 amendment (b): `truncate` is the sole Real -> Int door, and typing these `-> Int` would
  //    silently turn `(/ (round (* x 100)) 100)` into integer division under D49d.
  ["Math.sqrt", fn("ll_math_sqrt", [Real], Real)],
  ["Math.log", fn("ll_math_log", [Real], Real)],
  ["Math.exp", fn("ll_math_exp", [Real], Real)],
  ["Math.sin", fn("ll_math_sin", [Real], Real)],
  ["Math.cos", fn("ll_math_cos", [Real], Real)],
  ["Math.tan", fn("ll_math_tan", [Real], Real)],
  ["Math.asin", fn("ll_math_asin", [Real], Real)],
  ["Math.acos", fn("ll_math_acos", [Real], Real)],
  ["Math.atan", fn("ll_math_atan", [Real], Real)],
  ["Math.atan2", fn("ll_math_atan2", [Real, Real], Real)],
  ["Math.hypot", fn("ll_math_hypot", [Real, Real], Real)],
  ["Math.abs", fn("ll_math_abs", [Real], Real)],
  ["Math.floor", fn("ll_math_floor", [Real], Real)],
  ["Math.ceil", fn("ll_math_ceil", [Real], Real)],
  ["Math.round", fn("ll_math_round", [Real], Real)],
  ["Math.pow", fn("ll_math_pow", [Real, Real], Real)],
  ["Math.min", fn("ll_math_min", [Real, Real], Real)],
  ["Math.max", fn("ll_math_max", [Real, Real], Real)],
  ["Math.random", fn("ll_math_random", [], Real)],
  ["Math.sign", fn("ll_math_sign", [Real], Real)],
  // THE conversion. `Math.trunc` is the spelling programs write for D51's `truncate`, and it is the
  // one floor op that narrows: Real in, Int out. Everything else numeric stays Real-valued precisely
  // so that the narrowing has to be written down at the site that wants it (D51 amendment (b)), and
  // `lib/std/math`'s `truncate` wrapper is only honest about `-> Int` because of this line.
  ["Math.trunc", fn("ll_truncate", [Real], Int)],

  // -- the i/o SINK, and the only one. Raw bytes to the stream: no formatting, no newline, no
  //    join. Everything above it -- console.log's space-join, print's {N} substitution, the display
  //    formatter -- is a layer, not a primitive. Writing a partial line was simply impossible before
  //    this existed: every path out of the language appended a newline.
  // The renderer, exposed so l-lang code above the floor can use it. FLOOR.md 3.6 says print's {N}
  // substitution renders with display(); without this entry the only thing io.lisp could reach was
  // `+` concat, i.e. to-string, so a container came out `4,5` instead of `[4 5]`.
  ["display", fn("ll_display_str", [Any], Str)],
  ["write-string", fn("ll_write_string", [Str], Void)],
  ["write-string-err", fn("ll_write_string_err", [Str], Void)],

  // -- the MAP floor (D53): insertion-ordered, String keys.
  //
  // Named without the bang. D53 writes these as `map-set!`/`vec-push!`, but D21 rejects Scheme
  // spellings BY NAME -- "`nil?`, `set!` are rejected, including the ones the runtime shim itself
  // uses" -- and `set!`/`set?` were deleted from SYMBOL_MAP for exactly that reason. D21 is the
  // naming ruling; D53's spellings were illustrative. Amended there.
  //
  // The KEY parameter is `Any`, not String: D53's "String keys" describes the key SPACE, and both
  // runtimes stringify on the way in, which is what makes `(m[1] := v)` and `(map-get m 1)` agree.
  // No `map-new`: `{}` is already the empty-map literal, and a ZERO-ARGUMENT floor function is
  // unusable anyway -- D1 makes `(map-new)` a READ of the binding rather than a call, so it returned
  // the function object and every "new map" aliased the same one. `(call map-new)` would work and is
  // absurd. The literal is both idiomatic and unambiguous.
  ["map-get", fn("ll_map_get_v", [Map_, Any], Any)],
  ["map-set", fn("ll_map_set_v", [Map_, Any, Any], Void)],
  ["map-has", fn("ll_map_has", [Map_, Any], Bool)],
  ["map-delete", fn("ll_map_delete", [Map_, Any], Bool)],
  ["map-keys", fn("ll_map_keys", [Map_], arr(Str))],

  // -- container/sequence primitives the runtime provides (the SYMBOL_MAP surface).
  ["get", fn("ll_get", [Any, Any], Any)],
  ["head", fn("ll_head", [Any], Any)],
  ["tail", fn("ll_tail", [Any], arr(Any))],
  ["empty", fn("ll_empty", [Any], Bool)],
  ["elem", fn("ll_elem", [Any, Any], Any)],
  ["list", fn("ll_list", [], arr(Any), true)],

  // -- reflection: the backend emits the metadata graph, the accessor shape is spec (D54).
  ["type", fn("ll_type", [Any], Any)],
  ["type-by-name", fn("ll_type_by_name", [Any], Any)],
]);

/** Is this name a floor operation? (The question both the checker and the C backend ask.) */
export function floorEntry(name: string): FloorEntry | undefined {
  return FLOOR.get(name);
}

// `Int` is exported only so a future entry can use it without re-declaring the shorthand; it is not
// referenced by any current signature (the numeric floor is Real-valued -- D51 amendment (b)).
export const FLOOR_TYPES = { Int, Real, Str, Bool, Void, Any, arr };
