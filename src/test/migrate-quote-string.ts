// ONE-OFF MIGRATION: `'"…"` -> `f"…"` (D98). Delete after it has run.
//
// WHY THIS IS NOT A `sed`. `'"` is a formatted-string opener only when the `'` is not already inside
// something. Two real counter-examples exist in the tree right now:
//
//   (strlen "cafe'")          the `'` is INSIDE a plain string; `'"` is its last char + the closer.
//                             A blind rewrite yields `"cafef"` -- silently wrong, no diagnostic.
//   ;; `'"{(f 1 2 3)}"` on …  prose in a comment ABOUT the syntax, which is not source at all.
//
// The token comment that kept this alias named the trap exactly: sites are "embedded in TypeScript
// test sources (the trap that bit the P3a `<-` migration)". So the rewrite is driven by the LEXER,
// which is the only thing that already knows which `'"` is a `FormattedStringStart`. Token offsets
// are exact, so a false positive is not possible by construction.
//
// Comments and prose are NOT touched here -- they are edited by hand, because a comment explaining
// the old syntax often needs rewording rather than substitution.
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
let touched = 0, rewrites = 0, skipped = 0;

for (const file of roots.flatMap(lispFiles)) {
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes("'\"")) continue;
  const lexed = LLangLexer.tokenize(src);
  // Only a token the lexer itself called a FormattedStringStart, and only the `'` spelling of it.
  const hits = lexed.tokens
    .filter((t) => t.tokenType.name === "FormattedStringStart" && t.image.startsWith("'"))
    .map((t) => t.startOffset)
    .sort((a, b) => b - a); // right-to-left, so earlier offsets stay valid
  const total = (src.match(/'"/g) ?? []).length;
  skipped += total - hits.length;
  if (hits.length === 0) continue;
  let out = src;
  for (const at of hits) out = out.slice(0, at) + 'f"' + out.slice(at + 2);
  if (APPLY) fs.writeFileSync(file, out);
  touched++; rewrites += hits.length;
}

console.log(`${APPLY ? "APPLIED" : "DRY RUN"}  files: ${touched}  rewrites: ${rewrites}  ` +
            `non-token \`'"\` left alone: ${skipped}`);
