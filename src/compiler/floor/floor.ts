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
const StrOpt: InferredType = { kind: "primitive", name: "String", optional: true };
const Any: InferredType = { kind: "unknown", name: "Any" };
const arr = (t: InferredType): InferredType => ({ kind: "array", name: "Array", inner: t });
const Map_: InferredType = { kind: "map", name: "Map" };
// The KEY type: the two key spaces the language has. Used by the total accessors, so the checker
// rejects `(get xs (Math.floor i))` at the call site instead of both backends inventing an answer
// for it -- JS coerced (20), C answered nil. D51 amendment (b) types every `Math.*` but `trunc` as
// `-> Real` precisely so a narrowing is written down; this is that rule reaching the accessors.
// `mapType` boxes a union (ctype.ts: "an Int|String IS dynamic at this level"), so the C signature
// is unchanged.
const Key: InferredType = { kind: "union", name: "Int | String", alternatives: [Int, Str] };

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

  // -- the CODEPOINT floor (D52): a String is a sequence of Unicode SCALAR VALUES.
  //
  // Unlike Fg's containers, this one genuinely had to grow the floor. `flatten` was rescued by
  // `(x :of Array)` and `includes` by `==` -- both already portable primitives under another name --
  // but nothing in the language could ask what a string's third CHARACTER is. Every spelling that
  // exists answers in the host's units: `.length` is bytes here and UTF-16 code units on JS, so
  // `(strlen "a<emoji>b")` is 6 / 4 where D52 says 3. Neither backend was right, so this is a floor
  // both are rebuilt onto rather than one catching up with the other.
  //
  // `codepoint-at` answers with an INT, not a Char (planning ruling). A Char has no agreed rendering
  // -- the display formatter still has no JS arm for one -- and after D51 an Int is already
  // distinguishable from a Real on both backends. One less representation to converge.
  //
  // Out of range is `-1`, not nil: a codepoint is non-negative by definition, so -1 is out of band
  // rather than the in-band lie D9 objects to, and it lets l-lang do bounds-free lookahead the way
  // `io.lisp`'s format scanner already leans on `charAt` returning "".
  ["codepoint-length", fn("ll_cp_length", [Str], Int)],
  ["codepoint-at", fn("ll_cp_at", [Str, Int], Int)],
  ["string-from-codepoints", fn("ll_string_from_codepoints", [arr(Int)], Str)],
  // The inverse, and the reason `std/string` above is LINEAR. Every operation up there decodes once
  // into an Int[], works on it with ordinary vector code, and encodes once. Built out of repeated
  // `codepoint-at` instead, each of those loops re-walks the string per character -- O(n^2) on a
  // representation that is a walk on both backends (UTF-8 here, `[...s]` there).
  ["string-to-codepoints", fn("ll_string_to_codepoints", [Str], arr(Int))],

  // -- container/sequence primitives the runtime provides (the SYMBOL_MAP surface).
  ["get", fn("ll_get", [Any, Key], Any)],
  ["head", fn("ll_head", [Any], Any)],
  ["tail", fn("ll_tail", [Any], arr(Any))],
  ["empty", fn("ll_empty", [Any], Bool)],
  ["elem", fn("ll_elem", [Any, Key], Any)],
  ["list", fn("ll_list", [], arr(Any), true)],

  // -- `call`: D1's escape hatch, and a floor entry because BOTH backends need it.
  //
  // D1 rules that `(x)` is a READ of `x` rather than a zero-argument call, which makes `call` the
  // only way to invoke a nullary function from source. That is a LANGUAGE primitive, not a host
  // convenience -- and it lived only in the JS shim's SYMBOL_MAP, unmodelled, so every nullary API
  // was simply unreachable on the native backend (`ELL0107: 'call' resolves to a JavaScript host
  // global`). Exactly the unchecked, single-backend boundary D50 exists to close.
  //
  // `ll_call` was already in `runtime.c` -- the machinery was there, nothing named it.
  //
  // Variadic, so `(call f)` and `(call f [a b])` both work; `Any` in and out, because the callee's
  // signature is not knowable here. Typing it more precisely would need a function type the caller
  // does not have.
  ["call", fn("ll_call_dyn", [], Any, true)],

  // -- the PROCESS floor: argv, the environment, and the exit status.
  //
  // Irreducible by D50's test -- each is a host facility with no l-lang expression -- and the first
  // floor entries that are neither a computation nor a stream write: they are how a program learns
  // what it was ASKED to do. Before these, an l-lang program could not read its own command line on
  // either backend, which is why the whole corpus is input-free.
  //
  // Named `sys-*` rather than `args`/`env`/`exit` because a floor name is the name a program WRITES,
  // and these are the primitive under `std/sys/process`'s API, not the API. The same separation
  // `codepoint-length` has from `std/string`'s `strlen`. It also keeps `exit` free: an unprefixed
  // `exit` on the floor would be unshadowable in every program in the language.
  //
  // `sys-env` answers `nil` for an unset variable rather than "" -- absent and empty are different
  // questions, and D9 has exactly one bottom value to say the first with.
  // UNARY, BY INDEX, and that shape is forced rather than chosen.
  //
  // The obvious entry is a nullary `sys-args` returning the whole list, and it cannot be called. D1
  // makes `(sys-args)` a READ of the binding rather than a call -- the trap the map floor above
  // records as the reason there is no `map-new` -- so a nullary floor entry is unreachable from
  // source. All three ways around it were tried and two of them failed on a real backend:
  //
  //   (call sys-args)   needs a FLOOR FUNCTION AS A VALUE. C has no representation for one: it emits
  //                     a reference to a `u_`-prefixed symbol no declaration produces.
  //   (sys.args)        a DOTTED head is a call by syntax, and works on C -- but on JS a dotted head
  //                     is host MEMBER ACCESS, so it compiled to `__ll_member(sys, "args")` and threw
  //                     `ReferenceError: sys is not defined`. `console.log` and `Math.random` only
  //                     work there because those objects genuinely exist in the host.
  //   (sys-arg i)       unary, so it is a call on both, with no new mechanism anywhere.
  //
  // So the floor exposes the INDEXED accessor and `std/sys/process` assembles the vector in l-lang,
  // which is the D50-shaped answer anyway: the irreducible part is "ask the host for argument i", and
  // the loop around it is portable by construction. `nil` past the end is what terminates it -- an
  // argument count would be a second nullary entry with the same problem.
  ["sys-arg", fn("ll_sys_arg", [Int], StrOpt)],
  ["sys-env", fn("ll_sys_env", [Str], StrOpt)],
  ["sys-exit", fn("ll_sys_exit", [Int], Void)],

  // -- D30's ITERATION PROTOCOL. `iter` gives a cursor, `next` advances it, nil means done.
  //
  // These were JS-only, in the shim, on no floor -- and that is not a bookkeeping detail: the C
  // backend therefore had no protocol AT ALL. `resolveForEach` special-cased vec and str and boxed
  // everything else, and the emitter wrote `ll_vec*` over it unconditionally, so a hand-written
  // `Iterable` struct CRASHED the emitter with `no cast obj -> vec` (an uncaught exception, not a
  // diagnostic) and an `Iterable<T>`-typed parameter compiled to `ll_unbox_vec` and trapped at run
  // time. D29's own ruling warned about exactly this shape: "`for :each` was hardcoded to emit
  // `for...of`, with no protocol behind it." The C backend had reproduced it.
  //
  // `Any` in and out. A cursor has no expressible type -- it is a closure on the built-in sequences
  // and the user's own object otherwise -- and `next` answers `T?` for a T the floor cannot name.
  ["iter", fn("ll_iter", [Any], Any)],
  ["next", fn("ll_next", [Any], Any)],

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
