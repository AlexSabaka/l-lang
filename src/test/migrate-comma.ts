// ONE-OFF MIGRATION: drop `,` as a separator (D99). Delete after it has run.
//
// Lexer-driven for the reason D98's migration was: a `,` inside a string literal or a comment is not
// a separator, and only the lexer knows the difference. `(console.log "a, b")` and `;; one, two` are
// both live in the tree, and a regex would eat both.
//
// A Comma TOKEN is exactly what has to go, so this is more direct than D98's case: find every one,
// delete it. The comma is replaced by a SPACE when it is not already followed by whitespace, so
// `[a,b]` becomes `[a b]` rather than `[ab]` -- which would silently fuse two elements into one name.
import * as fs from "fs";
import * as path from "path";
import { LLangLexer } from "../compiler/frontend/grammar_v2/tokens";

const ROOT = path.resolve(__dirname, "../..");
const APPLY = process.argv.includes("--apply");
const EXTRA = process.argv.filter((a) => a.startsWith("--root=")).map((a) => a.slice(7));

function lispFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".git") walk(p); }
      else if (e.name.endsWith(".lisp")) out.push(p);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

const roots = [path.join(ROOT, "examples"), path.join(ROOT, "lib"), ...EXTRA];
let touched = 0, removed = 0, nonToken = 0;

for (const file of roots.flatMap(lispFiles)) {
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes(",")) continue;
  const lexed = LLangLexer.tokenize(src);
  const hits = lexed.tokens
    .filter((t) => t.tokenType.name === "Comma")
    .map((t) => t.startOffset!)
    .sort((a, b) => b - a); // right-to-left keeps earlier offsets valid
  nonToken += (src.match(/,/g) ?? []).length - hits.length;
  if (hits.length === 0) continue;
  let out = src;
  for (const at of hits) {
    const next = out[at + 1];
    const fuses = next !== undefined && !/\s/.test(next);
    out = out.slice(0, at) + (fuses ? " " : "") + out.slice(at + 1);
  }
  if (APPLY) fs.writeFileSync(file, out);
  touched++; removed += hits.length;
}

console.log(`${APPLY ? "APPLIED" : "DRY RUN"}  files: ${touched}  commas removed: ${removed}  ` +
            `non-token commas left alone: ${nonToken}`);
