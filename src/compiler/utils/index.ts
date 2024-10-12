import { JS_RESERVED } from "./JS_RESERVED";

const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_";
const alphanumeric = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";

const usedRandomIdentifiers: string[] = [];

export function randomIdentifier(length: number = 5) {
  let varName = letters[Math.floor(Math.random() * letters.length)];
  for (let i = 1; i < length; i++) {
    varName += alphanumeric[Math.floor(Math.random() * alphanumeric.length)];
  }

  if (!usedRandomIdentifiers.includes(varName)) {
    usedRandomIdentifiers.push(varName);
    return varName;
  }

  return randomIdentifier(length);
}

export function encodeIdentifier(id: string) {
  const r = /[^._a-zA-Z0-9]/gim;
  id = id.replace(r, (s) => s.charCodeAt(0).toString(16));
  if (JS_RESERVED.includes(id) || id.match(/^\d/)) {
    id = "_" + id;
  }
  return id;
}
