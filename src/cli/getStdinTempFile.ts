import fs from "node:fs";
import process from "node:process";

export function getTemporaryStdinFile(): string {
  const tmpFilePath = `/tmp/${process.pid}-stdin-${Date.now()}.lisp`;
  const stdinBuffer = fs.readFileSync(0);
  fs.writeFileSync(tmpFilePath, stdinBuffer);
  return tmpFilePath;
}