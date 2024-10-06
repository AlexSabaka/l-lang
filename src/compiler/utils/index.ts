import { JS_RESERVED } from "./JS_RESERVED";

export function randomIdentifier() {
  const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_";
  const alphanum =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";

  let varName = letters[Math.floor(Math.random() * letters.length)]; // First char: letter or '_'

  for (let i = 1; i < 5; i++) {
    varName += alphanum[Math.floor(Math.random() * alphanum.length)];
  }

  return varName;
}

export function encodeIdentifier(id: string) {
  const r = /[^._a-zA-Z0-9]/gim;
  id = id.replace(r, (s) => s.charCodeAt(0).toString(16));
  if (JS_RESERVED.includes(id) || id.match(/^\d/)) {
    id = "_" + id;
  }
  return id;
}
