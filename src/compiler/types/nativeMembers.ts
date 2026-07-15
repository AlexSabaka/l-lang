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

const opt = (t: InferredType): InferredType => (t.optional ? t : { ...t, optional: true });
const arrOf = (t: InferredType): InferredType => ({ kind: "generic", name: "Array", generics: [t], isArray: true });

/** `element` is the receiver's element type for `Array<T>` members; Unknown for a String receiver. */
type MemberType = (element: InferredType) => InferredType;
interface NativeMember {
  kind: "field" | "method";
  type: MemberType;
}
const field = (t: InferredType): NativeMember => ({ kind: "field", type: () => t });
const method = (t: InferredType): NativeMember => ({ kind: "method", type: () => t });
const methodOf = (f: MemberType): NativeMember => ({ kind: "method", type: f });

const STRING_MEMBERS: Record<string, NativeMember> = {
  length: field(Int),
  toUpperCase: method(Str),
  toLowerCase: method(Str),
  trim: method(Str),
  trimStart: method(Str),
  trimEnd: method(Str),
  substring: method(Str),
  slice: method(Str),
  replace: method(Str),
  replaceAll: method(Str),
  repeat: method(Str),
  padStart: method(Str),
  padEnd: method(Str),
  charAt: method(Str),
  concat: method(Str),
  indexOf: method(Int),
  lastIndexOf: method(Int),
  charCodeAt: method(Int),
  split: method(arrOf(Str)),
  includes: method(Bool),
  startsWith: method(Bool),
  endsWith: method(Bool),
};

const ARRAY_MEMBERS: Record<string, NativeMember> = {
  length: field(Int),
  push: method(Int),
  unshift: method(Int),
  pop: methodOf((el) => opt(el)),
  shift: methodOf((el) => opt(el)),
  reverse: methodOf((el) => arrOf(el)),
  slice: methodOf((el) => arrOf(el)),
  concat: methodOf((el) => arrOf(el)),
  flat: method(arrOf(Unknown)),
  join: method(Str),
  indexOf: method(Int),
  lastIndexOf: method(Int),
  includes: method(Bool),
};

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
