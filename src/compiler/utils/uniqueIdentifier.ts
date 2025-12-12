const identifiersInUse = new Map<string, number>();

export function uniqueIdentifier(identifierPrefix: string = "tmp_id"): string {
  let lastIdentifierNumber = identifiersInUse.get(identifierPrefix);
  if (!lastIdentifierNumber) {
    identifiersInUse.set(identifierPrefix, 1);
    lastIdentifierNumber = 1;
  }
  return `__ll_${identifierPrefix}_${lastIdentifierNumber++}`;
}
