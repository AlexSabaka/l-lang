#!/usr/bin/env ts-node
/**
 * The documentation gate.
 *
 * Every other artifact in this repo is graded by something: the corpus hard-errors on an undeclared
 * file, `c-status` ratchets, `js-status` ratchets in reverse, the diagnostics registry integrity-tests
 * its own code allocation. Documentation alone was graded by nobody -- which is why a 2026-07 sweep
 * found `npm run parser` (deleted at D39) still documented in five files, `docs/architecture/` links
 * to a directory that never existed, and the corpus renumbering of 6df6f63 leaving dead example paths
 * across the spec.
 *
 * This checks the claims a document makes that a MACHINE can settle:
 *
 *   LINK    every relative markdown link resolves -- CASE-SENSITIVELY, against `git ls-files` rather
 *           than the filesystem, because macOS is case-insensitive and GitHub is not. `docs/INDEX.md`
 *           and `docs/index.md` are the same file here and a 404 there.
 *   CORPUS  every cited `examples/**.lisp` exists (bare decade-block paths too: `80-adversarial/x.lisp`)
 *   SCRIPT  every `npm run <x>` exists in src/package.json
 *   CODE    every LLxxxx resolves somewhere in src/ (the registry, or NodeValidationRules)
 *   GRAMMAR docs/spec/GRAMMAR.ebnf is not stale against the parser it is generated from
 *
 * What it deliberately does NOT check: prose. A sentence can be false and no tool will say so; that
 * is what review is for. This closes the mechanical half, which is the half that rotted silently.
 *
 * Two exemptions, both principled:
 *   - `docs/_archive/**` is skipped. An archived document describing the tree as it WAS is correct,
 *     and its banner says so. Checking it would force a choice between falsifying history and
 *     carrying permanent red.
 *   - a dead corpus path annotated with its current home ("`old/path.lisp` (now `new/path.lisp`)")
 *     is a true statement about a rename, not a broken reference.
 */
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

const ROOT = path.resolve(__dirname, "../..");

const git = (args: string[]) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const tracked = new Set(git(["ls-files"]).split("\n").filter(Boolean));
const untrackedMd = git(["ls-files", "-o", "--exclude-standard"])
  .split("\n")
  .filter((f) => f.endsWith(".md"));

/** Case-sensitive existence: the git index is the authority, not the filesystem. */
const exists = (p: string) => tracked.has(p) || fs.existsSync(path.join(ROOT, p));

const scripts = new Set(
  Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "src/package.json"), "utf8")).scripts)
);

const codes = new Set(
  (git(["grep", "-rhoE", "LL0[0-9]{3}", "--", "src/"]).match(/LL0\d{3}/g) ?? [])
);

const docs = [...new Set([...tracked, ...untrackedMd])]
  .filter((f) => f.endsWith(".md"))
  .filter((f) => !f.startsWith("docs/_archive/"))
  .filter((f) => fs.existsSync(path.join(ROOT, f)))
  .sort();

const problems: string[] = [];

for (const f of docs) {
  const dir = path.dirname(f);
  const raw = fs.readFileSync(path.join(ROOT, f), "utf8");
  // A path inside a code span or fence is prose ABOUT code, not a reference to follow.
  const prose = raw.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");

  for (const m of prose.matchAll(/\[[^\]]*\]\(([^)\s]+?)(?:#[^)]*)?\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const resolved = path.normalize(path.join(dir, target));
    if (!exists(resolved)) problems.push(`LINK    ${f}: ${target} -> ${resolved}`);
  }

  for (const m of raw.matchAll(
    /`(examples\/[A-Za-z0-9_./-]+\.lisp|[0-9]{2}-[A-Za-z0-9_-]+\/[A-Za-z0-9_./-]+\.lisp)`/g
  )) {
    const cited = m[1];
    const full = cited.startsWith("examples/") ? cited : `examples/${cited}`;
    if (exists(full)) continue;
    // "(now `examples/new/path.lisp`)" -- a recorded rename, not a dead link.
    const after = raw.slice(m.index! + m[0].length, m.index! + m[0].length + 90).trimStart();
    if (after.startsWith("(now ") || after.startsWith("(the stdlib has since")) continue;
    problems.push(`CORPUS  ${f}: ${cited} does not exist`);
  }

  for (const m of raw.matchAll(/npm run ([a-z0-9:_-]+)/g)) {
    if (!scripts.has(m[1])) problems.push(`SCRIPT  ${f}: npm run ${m[1]}`);
  }

  for (const m of raw.matchAll(/\bE?(LL0\d{3})\b/g)) {
    if (!codes.has(m[1])) problems.push(`CODE    ${f}: ${m[1]} is not raised anywhere in src/`);
  }
}

// The grammar is GENERATED from the parser, so it cannot be wrong -- but nothing made anyone run the
// generator, and the committed copy was three rulings stale (missing D88's ImaginaryNumber and all
// three of D90's dimension rules) when it was promoted out of the inbox.
const EBNF = "docs/spec/GRAMMAR.ebnf";
if (exists(EBNF)) {
  const committed = fs.readFileSync(path.join(ROOT, EBNF), "utf8");
  const before = fs.statSync(path.join(ROOT, EBNF)).mtimeMs;
  execFileSync("npx", ["ts-node", "test/export-grammar.ts"], {
    cwd: path.join(ROOT, "src"),
    stdio: "ignore",
  });
  const regenerated = fs.readFileSync(path.join(ROOT, EBNF), "utf8");
  if (committed !== regenerated) {
    problems.push(
      `GRAMMAR ${EBNF}: stale against the parser -- regenerated and it changed. ` +
        `Run \`npm run grammar:ebnf\` and commit the result.`
    );
    fs.writeFileSync(path.join(ROOT, EBNF), committed); // leave the tree as we found it
    fs.utimesSync(path.join(ROOT, EBNF), before / 1000, before / 1000);
  }
}

// The AST schema module is generated from `ast.ts` for the same reason and with the same failure mode:
// a node kind added to the compiler while the l-lang-side schema still describes the old set is a
// mirror that lies, and nothing else would notice. Same shape as the EBNF check above.
const ASTLISP = "lib/std/llang/ast.lisp";
if (exists(ASTLISP)) {
  const committed = fs.readFileSync(path.join(ROOT, ASTLISP), "utf8");
  const before = fs.statSync(path.join(ROOT, ASTLISP)).mtimeMs;
  execFileSync("npx", ["ts-node", "test/export-ast-stdlib.ts"], {
    cwd: path.join(ROOT, "src"),
    stdio: "ignore",
  });
  const regenerated = fs.readFileSync(path.join(ROOT, ASTLISP), "utf8");
  if (committed !== regenerated) {
    problems.push(
      `AST     ${ASTLISP}: stale against src/compiler/frontend/ast.ts -- regenerated and it changed. ` +
        `Run \`npm run ast:stdlib\` and commit the result.`
    );
    fs.writeFileSync(path.join(ROOT, ASTLISP), committed); // leave the tree as we found it
    fs.utimesSync(path.join(ROOT, ASTLISP), before / 1000, before / 1000);
  }
}

console.log("=== summary ===");
console.log(`  documents : ${docs.length}`);
console.log(`  problems  : ${problems.length}`);
console.log(`  (target: 0)`);
if (problems.length) {
  console.log();
  for (const p of [...new Set(problems)].sort()) console.log(`  ${p}`);
  process.exit(1);
}
console.log("\nALL DOC CLAIMS RESOLVE");
