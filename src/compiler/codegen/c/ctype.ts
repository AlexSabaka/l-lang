// The C backend's type lattice and the InferredType -> CType map.
//
// The discipline THIS WHOLE EXPERIMENT rests on: a concrete static type gets a concrete C type
// (Int -> int64_t, Real -> double, ...); ONLY a static `Unknown` is boxed (`ll_value`, the fat
// two-word tagged union). If everything were boxed we would have rebuilt JS in C syntax and the
// probe would measure nothing.
//
// `undefined` (no type on the node at all) is DISTINCT from `unknown`: per spec A1, undefined is a
// bug in the channel ("it should have gotten a type") -- we box it to keep compiling, but the caller
// must record an A1 ledger entry. `unknown` is the legitimate gradual answer -- boxed, no entry.

import type { InferredType } from "../../analysis/SymbolTable";

export type CType =
  | { k: "int" }
  | { k: "real" }
  | { k: "bool" }
  | { k: "char" }
  | { k: "str" }
  | { k: "vec"; elem: CType }
  | { k: "map" }
  | { k: "obj"; className: string }
  | { k: "closure"; params: CType[]; ret: CType }
  | { k: "value" } // boxed ll_value -- the ONLY home of static Unknown
  | { k: "void" };

export const C_INT: CType = { k: "int" };
export const C_REAL: CType = { k: "real" };
export const C_BOOL: CType = { k: "bool" };
export const C_STR: CType = { k: "str" };
export const C_VALUE: CType = { k: "value" };
export const C_VOID: CType = { k: "void" };

export function ctypeEquals(a: CType, b: CType): boolean {
  if (a.k !== b.k) return false;
  switch (a.k) {
    case "vec":
      return ctypeEquals(a.elem, (b as any).elem);
    case "obj":
      return a.className === (b as any).className;
    case "closure": {
      const bb = b as Extract<CType, { k: "closure" }>;
      return (
        a.params.length === bb.params.length &&
        a.params.every((p, i) => ctypeEquals(p, bb.params[i])) &&
        ctypeEquals(a.ret, bb.ret)
      );
    }
    default:
      return true;
  }
}

/** Is this a native unboxed numeric? (The operands a native C binop can take directly.) */
export function isNumeric(t: CType): boolean {
  return t.k === "int" || t.k === "real";
}

export function show(t: CType): string {
  switch (t.k) {
    case "vec":
      return `vec<${show(t.elem)}>`;
    case "obj":
      return `obj(${t.className})`;
    case "closure":
      return `closure(${t.params.map(show).join(",")})->${show(t.ret)}`;
    default:
      return t.k;
  }
}

/**
 * InferredType -> CType. Pure -- the A1 ledger decision (undefined vs unknown) belongs to the CALLER,
 * because only the caller knows which node the type came from; this function just answers
 * "was the type missing?" via `mapTypeIsMissing`.
 */
export function mapType(t: InferredType | undefined): CType {
  if (t === undefined) return C_VALUE; // A1: the caller ledgers this
  switch (t.kind) {
    case "primitive":
      switch (t.name) {
        case "Int":
          return t.optional ? C_VALUE : C_INT;
        case "Real":
          return t.optional ? C_VALUE : C_REAL;
        case "Boolean":
        case "Bool":
          return t.optional ? C_VALUE : C_BOOL;
        case "String":
          return t.optional ? C_VALUE : C_STR;
        case "Char":
          return t.optional ? C_VALUE : { k: "char" };
        case "Void":
          return C_VOID;
        default:
          return C_VALUE;
      }
    case "unknown":
      return C_VALUE; // the legitimate gradual box -- NOT an A1 entry
    case "array": {
      // An optional vector (T[]?) admits nil -> boxed.
      if (t.optional) return C_VALUE;
      return { k: "vec", elem: mapType(t.inner) };
    }
    case "tuple":
      // v0: a tuple is a fixed-shape vector with per-slot types erased to boxed elements.
      return t.optional ? C_VALUE : { k: "vec", elem: C_VALUE };
    case "map":
    case "record":
      return t.optional ? C_VALUE : { k: "map" };
    case "function":
      return {
        k: "closure",
        params: (t.params ?? []).map((p) => mapType(p)),
        ret: mapType(t.returns),
      };
    case "class":
    case "struct":
    case "interface":
      return t.optional ? C_VALUE : { k: "obj", className: t.name };
    case "type-alias":
      return mapType(t.aliasedType);
    case "type-ref":
      // A forward reference carries only `refName` (resolution state is a boolean); without the type
      // environment there is nothing to chase here -- boxed.
      return C_VALUE;
    case "union":
      // A union has no single unboxed repr -- boxed. (An Int|String IS dynamic at this level.)
      return C_VALUE;
    case "generic":
      // An un-instantiated type parameter reaching codegen is a dynamic slot.
      return C_VALUE;
    default:
      return C_VALUE;
  }
}
