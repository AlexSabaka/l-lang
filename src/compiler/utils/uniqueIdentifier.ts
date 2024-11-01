
const identifierPrefix = "__ll_tmp_id_";
let lastIdentifierNumber = 1;

export function uniqueIdentifier() {
  return `${identifierPrefix}${lastIdentifierNumber++}`;
}