import { InferredType } from "../analysis/SymbolTable";

/**
 * Native member types (Phase T / Ja) -- the JS interop surface the checker cannot otherwise know.
 *
 * A `String` receiver is `{kind:"primitive"}` and an `Int[]` is `{kind:"generic", isArray}`; neither
 * carries `members`/`methodSignatures`, so `(s.toUpperCase)`/`(arr.shift)` degrade to Unknown and, in
 * codegen, to `__ll_member`. This table is the member analogue of `inferTotalAccessorType`: a small,
 * hardcoded map of what the host runtime provides, keyed by receiver KIND/NAME + member, consulted by
 * BOTH resolvers (the checker's field-read path and method-call path, and codegen's `memberKindIn`).
 *
 * It is a SIDE TABLE, never a nominal `String`/`Array` symbol -- introducing such a symbol flips every
 * `<- String` annotation to a type-ref and breaks primitive assignability project-wide (the documented
 * LL0203 conflict). Types are plain `InferredType` literals (not via `TypeEnvironment`) to avoid a
 * circular import.
 *
 * A member is a FIELD (its value type: `length` -> `Int`) or a METHOD, and a method records its RETURN
 * type only -- never a function type. Modelling a method as a `() -> R` function makes the arity check
 * fire (`csv.split(",")` -> "expects 0 arguments, got 1"); the method-call path takes the return type
 * directly and ignores the args, exactly like `inferTotalAccessorType`. For `Array<T>` members the
 * element `T` comes from the RECEIVER's `generics[0]`.
 */

const Int: InferredType = { kind: "primitive", name: "Int" };
const Str: InferredType = { kind: "primitive", name: "String" };
const Bool: InferredType = { kind: "primitive", name: "Boolean" };
const Unknown: InferredType = { kind: "unknown", name: "Any" };

const Real: InferredType = { kind: "primitive", name: "Real" };
const Void: InferredType = { kind: "primitive", name: "Void" };
const Any: InferredType = { kind: "unknown", name: "Any" };
const anyArr: InferredType = { kind: "array", name: "Array", inner: Any };
const strArr: InferredType = { kind: "array", name: "Array", inner: Str };

const opt = (t: InferredType): InferredType => (t.optional ? t : { ...t, optional: true });
const arrOf = (t: InferredType): InferredType => ({ kind: "generic", name: "Array", generics: [t], isArray: true });

/** `element` is the receiver's element type for `Array<T>` members; Unknown for a String receiver. */
type MemberType = (element: InferredType) => InferredType;

/**
 * One native member. The checker reads `kind`/`type`; the C backend reads `c`.
 *
 * `c` IS OPTIONAL, AND ITS ABSENCE MEANS SOMETHING. Present: C lowers a statically-typed receiver
 * straight to that `runtime.c` function. Absent: C has no static lowering and routes the call through
 * `ll_dyn_method`, which dispatches on the runtime tag. Absent AND unimplemented dynamically is the
 * only case that refuses -- so a member declared here is a promise BOTH backends keep, which is the
 * whole reason this table and the C one became a single table.
 *
 * The C signature is stated in L-LANG types and `mapType`'d by `codegen/c/intrinsics.ts`, exactly as
 * the intrinsic floor does. That keeps this file out of the C backend's imports and makes it
 * impossible for the two to disagree about a type: there is only one place it is written.
 *
 * `cParams` includes the RECEIVER as its first element -- `ll_str_index_of(recv, needle)` -- because
 * that is the calling convention every one of these uses.
 */
interface NativeMemberC {
  runtimeFn: string;
  /** Receiver FIRST, then the declared arguments. In l-lang types; mapType'd for C. */
  cParams: InferredType[];
  /** The C return type, which is NOT always the checker's: `pop` is `T?` to the checker and boxed here. */
  cRet: InferredType;
}
interface NativeMember {
  kind: "field" | "method";
  type: MemberType;
  c?: NativeMemberC;
}
const field = (t: InferredType, c?: NativeMemberC): NativeMember => ({ kind: "field", type: () => t, c });
const method = (t: InferredType, c?: NativeMemberC): NativeMember => ({ kind: "method", type: () => t, c });
const methodOf = (f: MemberType, c?: NativeMemberC): NativeMember => ({ kind: "method", type: f, c });
/** Shorthand for a C lowering: `cfn(runtimeFn, [receiver, ...args], ret)`. */
const cfn = (runtimeFn: string, cParams: InferredType[], cRet: InferredType): NativeMemberC =>
  ({ runtimeFn, cParams, cRet });

const STRING_MEMBERS: Record<string, NativeMember> = {
  length: field(Int, cfn("ll_str_len", [Str], Int)),
  toUpperCase: method(Str, cfn("ll_str_upper", [Str], Str)),
  toLowerCase: method(Str, cfn("ll_str_lower", [Str], Str)),
  trim: method(Str, cfn("ll_str_trim", [Str], Str)),
  // One of the three members that needed WRITING rather than routing -- `trim` and `trimEnd` existed
  // and `trimStart` was declared to the checker and implemented nowhere. See runtime.c.
  trimStart: method(Str, cfn("ll_str_trim_start", [Str], Str)),
  trimEnd: method(Str, cfn("ll_str_trim_end", [Str], Str)),
  // 1-arg form: P1 pads `end` with the LL_END sentinel.
  substring: method(Str, cfn("ll_str_slice", [Str, Int, Int], Str)),
  slice: method(Str, cfn("ll_str_slice", [Str, Int, Int], Str)),
  replace: method(Str, cfn("ll_str_replace", [Str, Str, Str], Str)),
  replaceAll: method(Str, cfn("ll_str_replace_all", [Str, Str, Str], Str)),
  repeat: method(Str, cfn("ll_str_repeat", [Str, Int], Str)),
  padStart: method(Str, cfn("ll_str_pad_start", [Str, Int, Str], Str)),
  padEnd: method(Str, cfn("ll_str_pad_end", [Str, Int, Str], Str)),
  charAt: method(Str, cfn("ll_str_char_at", [Str, Int], Str)),
  concat: method(Str, cfn("ll_str_concat2", [Str, Str], Str)),
  indexOf: method(Int, cfn("ll_str_index_of", [Str, Str], Int)),
  lastIndexOf: method(Int, cfn("ll_str_last_index_of", [Str, Str], Int)),
  charCodeAt: method(Int, cfn("ll_str_char_code_at", [Str, Int], Int)),
  split: method(arrOf(Str), cfn("ll_str_split", [Str, Str], strArr)),
  includes: method(Bool, cfn("ll_str_includes", [Str, Str], Bool)),
  startsWith: method(Bool, cfn("ll_str_starts_with", [Str, Str], Bool)),
  endsWith: method(Bool, cfn("ll_str_ends_with", [Str, Str], Bool)),
};

const ARRAY_MEMBERS: Record<string, NativeMember> = {
  length: field(Int, cfn("ll_vec_len", [anyArr], Int)),
  push: method(Int, cfn("ll_vec_push", [anyArr, Any], Int)),
  unshift: method(Int, cfn("ll_vec_unshift", [anyArr, Any], Int)),
  // The C RETURN is boxed `Any` where the checker says `T?`: a vec holds boxed values, and the
  // element type is a checker-side fact the runtime does not carry.
  pop: methodOf((el) => opt(el), cfn("ll_vec_pop", [anyArr], Any)),
  shift: methodOf((el) => opt(el), cfn("ll_vec_shift", [anyArr], Any)),
  reverse: methodOf((el) => arrOf(el), cfn("ll_vec_reverse", [anyArr], anyArr)),
  slice: methodOf((el) => arrOf(el), cfn("ll_vec_slice", [anyArr, Int, Int], anyArr)),
  concat: methodOf((el) => arrOf(el), cfn("ll_vec_concat", [anyArr, anyArr], anyArr)),
  join: method(Str, cfn("ll_vec_join", [anyArr, Str], Str)),
  indexOf: method(Int, cfn("ll_vec_index_of", [anyArr, Any], Int)),
  includes: method(Bool, cfn("ll_vec_includes", [anyArr, Any], Bool)),
  // Below here, `map`/`filter`/`reduce` carry NO `c` DELIBERATELY: `ll_dyn_method`'s vec branch
  // already implements them, so C routes them through the dynamic arm rather than refusing. Before
  // the tables were merged a STATICALLY-typed vec receiver refused (ELL0106) while a BOXED one
  // worked -- typing the receiver LOST capability, which is exactly backwards.
  // NOT routable, despite `ll_dyn_method` having a `lastIndexOf` arm -- that arm is in the STRING
  // branch, and the vec branch has none. Routing it would have traded a compile-time refusal for a
  // runtime trap. Found by running it, not by reading the table.
  lastIndexOf: method(Int, cfn("ll_vec_last_index_of", [anyArr, Any], Int)),
  // `flat` is the same story: no `ll_dyn_method` arm either, so routing it would have
  // turned a compile-time refusal into a runtime trap -- fail-closed into fail-open, which is worse.
  // Written instead, one level deep, matching JS's default.
  flat: method(arrOf(Unknown), cfn("ll_vec_flat", [anyArr], anyArr)),
  // The higher-order methods that share a NAME with a lazy `std/iter/linq` operator (Ne). Modelling them keeps
  // `(arr.map f)` a native EAGER method call -- its natural JS meaning -- rather than mistaking it for the
  // lazy `map` extension a bare array cannot dispatch, and (the point) it keeps these OUT of the LL0230
  // "arrays lack this lazy operator" diagnostic. `map`'s element changes (Any); `filter` preserves it;
  // `reduce` folds to an unknown accumulator. The linq ops arrays genuinely lack -- `take`, `skip`,
  // `enumerate`, `zip`, `to-list`, `for-each` (≠ JS `forEach`), `flat-map` (≠ `flatMap`)... -- stay absent.
  map: method(arrOf(Unknown)),
  filter: methodOf((el) => arrOf(el)),
  reduce: method(Unknown),
  // `reduceRight` follows `reduce`: no `c`, because `ll_dyn_method`'s vec branch implements it. The
  // ARM WAS ADDED FIRST -- this table's rule is that declaring without an arm trades a compile-time
  // refusal for a runtime trap, which `lastIndexOf` and `flat` above are here to remember.
  //
  // It has exactly one user, `std/fn`'s `compose`, and that one user was enough to refuse
  // `16-stdlib/test_stdlib` outright on C.
  reduceRight: method(Unknown),
};

/** Every declared member, keyed the way the C backend keys them (`str.x` / `vec.x`). */
export function nativeMemberTable(): { key: string; kind: "field" | "method"; c?: NativeMemberC }[] {
  const out: { key: string; kind: "field" | "method"; c?: NativeMemberC }[] = [];
  for (const [n, m] of Object.entries(STRING_MEMBERS)) out.push({ key: `str.${n}`, kind: m.kind, c: m.c });
  for (const [n, m] of Object.entries(ARRAY_MEMBERS)) out.push({ key: `vec.${n}`, kind: m.kind, c: m.c });
  return out;
}

/** Is `member` declared for this receiver kind at all? The question the C backend asks before it
 *  refuses: a DECLARED member with no static lowering is routed dynamically, not rejected. */
export function nativeMemberDeclared(base: "str" | "vec", member: string): boolean {
  return base === "str" ? member in STRING_MEMBERS : member in ARRAY_MEMBERS;
}

function isArrayType(t: InferredType): boolean {
  return !!t.isArray || (t.kind === "generic" && t.name === "Array");
}

/** The native member entry for a String/Array receiver, plus the receiver's element type. */
function lookup(
  receiver: InferredType | undefined,
  memberName: string
): { member: NativeMember; element: InferredType } | undefined {
  if (!receiver) return undefined;
  if (receiver.kind === "primitive" && receiver.name === "String") {
    const member = STRING_MEMBERS[memberName];
    return member ? { member, element: Unknown } : undefined;
  }
  if (isArrayType(receiver)) {
    const member = ARRAY_MEMBERS[memberName];
    return member ? { member, element: receiver.generics?.[0] ?? Unknown } : undefined;
  }
  return undefined;
}

/** "field" | "method" | undefined -- for codegen's `memberKindIn` (Jb). */
export function nativeMemberKind(
  receiver: InferredType | undefined,
  memberName: string
): "field" | "method" | undefined {
  return lookup(receiver, memberName)?.member.kind;
}

/** The value type of a native FIELD (`s.length` -> `Int`), for a value-position read. */
export function nativeFieldType(
  receiver: InferredType | undefined,
  memberName: string
): InferredType | undefined {
  const r = lookup(receiver, memberName);
  return r && r.member.kind === "field" ? r.member.type(r.element) : undefined;
}

/** The RETURN type of a native METHOD (`(s.toUpperCase)` -> `String`, `(arr.shift)` -> `T?`). */
export function nativeMethodReturn(
  receiver: InferredType | undefined,
  memberName: string
): InferredType | undefined {
  const r = lookup(receiver, memberName);
  return r && r.member.kind === "method" ? r.member.type(r.element) : undefined;
}
