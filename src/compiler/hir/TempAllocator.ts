/**
 * A deterministic temp namer for HIR lowering. One instance per lowering pass (per program), so the
 * counter is monotonic across every body -- names are globally unique regardless of nesting, which
 * removes any need to reason about which JS scope a temp lands in.
 *
 * Why not the shared `uniqueIdentifier()`: that helper never writes its incremented counter back
 * (utils/uniqueIdentifier.ts), so every call returns `__ll_<prefix>_1`. The legacy match IIFE hid the
 * collision by giving each match its own arrow scope; de-IIFE-ing removes that shield, so a working
 * allocator is a correctness requirement, not a preference.
 *
 * Names are `__ll_hir_<n>`: only `_a-zA-Z0-9`, so `encodeIdentifier()` passes them through unchanged;
 * not in `SYMBOL_MAP`, so `isRuntimeReference()` is false; not a JS reserved word -- so they emit as
 * bare identifiers through visitIdentifier's unresolved-name fallback.
 */
export class TempAllocator {
  private n = 0;

  constructor(private readonly prefix: string = "__ll_hir") {}

  fresh(): string {
    return `${this.prefix}_${++this.n}`;
  }
}
