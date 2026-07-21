const identifiersInUse = new Map<string, number>();

/**
 * A fresh `__ll_<prefix>_<n>` identifier, unique per prefix.
 *
 * The counter used to be advanced with `n++` on a LOCAL, so the incremented value was never written
 * back to the map and every call with a given prefix returned `_1` -- for the whole process. Callers
 * that mint one name per site were fine by luck; anything minting two collided silently. The comptime
 * evaluator did exactly that: it builds a fresh transformer per fold (and another when collecting
 * dependencies), each of which inlines a called `:comptime` helper under the same prefix, then
 * concatenates both streams into ONE `vm.runInContext` scope -- two `const __ll_inlined_<f>_1`, and
 * the evaluator throws "already been declared" (LL0099). See TempAllocator, which exists because of
 * this and says so.
 */
export function uniqueIdentifier(identifierPrefix: string = "tmp_id"): string {
  const next = (identifiersInUse.get(identifierPrefix) ?? 0) + 1;
  identifiersInUse.set(identifierPrefix, next);
  return `__ll_${identifierPrefix}_${next}`;
}
