#!/usr/bin/env ts-node
/**
 * Differential harness: parse every example with BOTH frontends and compare the ASTs.
 *
 * This is a triage tool, not a pass/fail gate. grammar_v2 is *supposed* to disagree with the PEG
 * frontend wherever the PEG is wrong -- `(let nullable 1)` misparses under the PEG as `let` +
 * `null` + `able`, and grammar_v2 getting that right shows up here as a "divergence". A strict
 * golden-diff would flag our own bug fixes as regressions.
 *
 * So: this reports and classifies. The actual cutover gate is the real test suite
 * (`npm test`) reproducing its PEG baseline under grammar_v2.
 *
 * Divergences fall into three buckets, and every one has to land in a bucket deliberately:
 *   - intentional fix  -- the PEG was wrong, v2 is right. Documented, kept.
 *   - benign           -- location/wrapping noise with no semantic content.
 *   - real v2 bug      -- fix it in Parser.ts / AstBuilder.ts.
 *
 * Usage:
 *   npm run test:diff-frontends            # full AST diff
 *   npm run test:diff-frontends -- --lex-only    # tokenize only (no parser construction)
 *   npm run test:diff-frontends -- --file 05-oop/02_classes.lisp   # one file, verbose
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as ast from "../compiler/frontend/ast";
import { MANIFEST } from "./manifest";
import { parse as pegParse } from "../compiler/frontend/grammar/l-lang";
import { LLangLexer } from "../compiler/frontend/grammar_v2/tokens";
import { parser as v2Parser } from "../compiler/frontend/grammar_v2/Parser";
import { LLangAstBuilder } from "../compiler/frontend/grammar_v2/AstBuilder";

const EXAMPLES = path.resolve(__dirname, "../../examples");

const argv = process.argv.slice(2);
const LEX_ONLY = argv.includes("--lex-only");
const ONLY_FILE = argv.includes("--file") ? argv[argv.indexOf("--file") + 1] : undefined;

type Outcome = "identical" | "divergent" | "peg-only-failure" | "v2-only-failure" | "both-fail";

interface Result {
  file: string;
  status: string; // manifest status
  outcome: Outcome;
  pegError?: string;
  v2Error?: string;
  diffs: string[];
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".lisp")) out.push(p);
  }
  return out;
}

function parsePeg(source: string, file: string): ast.ProgramNode {
  return pegParse(source, { startRule: "Program", grammarSource: file, cache: true }) as any;
}

function parseV2(source: string, file: string): ast.ProgramNode {
  const lex = LLangLexer.tokenize(source);
  if (lex.errors.length > 0) {
    const e = lex.errors[0];
    throw new Error(`lex: line ${e.line}:${e.column} ${e.message}`);
  }
  v2Parser.input = lex.tokens;
  const cst = v2Parser.program();
  if (v2Parser.errors.length > 0) {
    throw new Error(`parse: ${v2Parser.errors[0].message}`);
  }
  return new LLangAstBuilder(file).visit(cst) as any;
}

/**
 * Structural diff on semantic content only. `getNodeIterableKeys` (ast.ts) already excludes
 * _type/_location/_parent, so byte offsets (which legitimately differ between a scannerless PEG
 * and a token-based parser) and the cyclic _parent backref are both ignored by construction.
 */
function diff(a: any, b: any, p: string, out: string[], depth = 0): void {
  if (out.length >= 12 || depth > 40) return; // cap: we want the shape, not a novel

  if (ast.isAstNode(a) && ast.isAstNode(b)) {
    if (a._type !== b._type) {
      out.push(`${p}: _type peg=${a._type} v2=${b._type}`);
      return;
    }
    const ka = ast.getNodeIterableKeys(a).sort();
    const kb = ast.getNodeIterableKeys(b).sort();
    for (const k of new Set([...ka, ...kb])) {
      if (!ka.includes(k as any)) { out.push(`${p}.${String(k)}: missing in peg (v2 has it)`); continue; }
      if (!kb.includes(k as any)) { out.push(`${p}.${String(k)}: missing in v2 (peg has it)`); continue; }
      diff((a as any)[k], (b as any)[k], `${p}.${String(k)}`, out, depth + 1);
    }
    return;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push(`${p}: length peg=${a.length} v2=${b.length}`);
      // still compare the common prefix -- length mismatch alone rarely explains the cause
    }
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      diff(a[i], b[i], `${p}[${i}]`, out, depth + 1);
    }
    return;
  }

  if (ast.isAstNode(a) !== ast.isAstNode(b) || Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${p}: kind peg=${kindOf(a)} v2=${kindOf(b)}`);
    return;
  }

  if (a !== b) {
    // null vs undefined is not a semantic difference worth 95 lines of noise
    if ((a ?? null) === null && (b ?? null) === null) return;
    out.push(`${p}: peg=${JSON.stringify(a)} v2=${JSON.stringify(b)}`);
  }
}

function kindOf(v: any): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) return "array";
  if (ast.isAstNode(v)) return `node(${v._type})`;
  return typeof v;
}

function main() {
  let files = walk(EXAMPLES).sort();
  if (ONLY_FILE) files = files.filter((f) => path.relative(EXAMPLES, f) === ONLY_FILE);
  if (files.length === 0) {
    console.error(`no examples matched${ONLY_FILE ? ` --file ${ONLY_FILE}` : ""}`);
    process.exit(2);
  }

  // ---- lex-only mode: no parser construction at all ----
  if (LEX_ONLY) {
    let clean = 0;
    const bad: string[] = [];
    for (const f of files) {
      const r = LLangLexer.tokenize(fs.readFileSync(f, "utf-8"));
      if (r.errors.length === 0) clean++;
      else bad.push(`  ${path.relative(EXAMPLES, f)} -- ${r.errors.length} error(s), first: line ${r.errors[0].line}`);
    }
    console.log(`grammar_v2 lex: ${clean}/${files.length} clean`);
    if (bad.length) console.log(bad.join("\n"));
    process.exit(bad.length === 0 ? 0 : 1);
  }

  const results: Result[] = [];

  for (const f of files) {
    const rel = path.relative(EXAMPLES, f);
    const source = fs.readFileSync(f, "utf-8");
    const status = MANIFEST[rel]?.status ?? "test";

    let pegAst: any, v2Ast: any, pegError: string | undefined, v2Error: string | undefined;
    try { pegAst = parsePeg(source, f); } catch (e: any) { pegError = String(e.message).split("\n")[0].slice(0, 100); }
    try { v2Ast = parseV2(source, f); } catch (e: any) { v2Error = String(e.message).split("\n")[0].slice(0, 100); }

    let outcome: Outcome;
    const diffs: string[] = [];
    if (pegError && v2Error) outcome = "both-fail";
    else if (pegError) outcome = "peg-only-failure";
    else if (v2Error) outcome = "v2-only-failure";
    else {
      diff(pegAst, v2Ast, "program", diffs);
      outcome = diffs.length === 0 ? "identical" : "divergent";
    }

    results.push({ file: rel, status, outcome, pegError, v2Error, diffs });
  }

  // ---- report ----
  const by = (o: Outcome) => results.filter((r) => r.outcome === o);

  if (ONLY_FILE) {
    const r = results[0];
    console.log(`${r.file}  [${r.status}]  -> ${r.outcome}`);
    if (r.pegError) console.log(`  PEG failed: ${r.pegError}`);
    if (r.v2Error) console.log(`  v2  failed: ${r.v2Error}`);
    for (const d of r.diffs) console.log(`  ${d}`);
    process.exit(0);
  }

  console.log(`=== frontend differential: ${results.length} examples ===\n`);
  console.log(`  identical         ${by("identical").length}`);
  console.log(`  divergent         ${by("divergent").length}`);
  console.log(`  v2-only failure   ${by("v2-only-failure").length}   <-- real v2 bugs, must be 0 to cut over`);
  console.log(`  peg-only failure  ${by("peg-only-failure").length}   <-- v2 parses what the PEG can't`);
  console.log(`  both fail         ${by("both-fail").length}   <-- pre-existing shared gaps\n`);

  const show = (title: string, rs: Result[], withDiffs: boolean) => {
    if (rs.length === 0) return;
    console.log(`--- ${title} ---`);
    for (const r of rs) {
      console.log(`  ${r.file}  [${r.status}]`);
      if (r.v2Error) console.log(`      v2:  ${r.v2Error}`);
      if (r.pegError) console.log(`      peg: ${r.pegError}`);
      if (withDiffs) for (const d of r.diffs) console.log(`      ${d}`);
    }
    console.log();
  };

  show("v2-only failures (BLOCKING)", by("v2-only-failure"), false);
  show("both fail (pre-existing)", by("both-fail"), false);
  show("peg-only failures (v2 is better)", by("peg-only-failure"), false);
  show("divergent (triage each)", by("divergent"), true);

  // Exit non-zero only on v2-only failures: those are unambiguously v2 bugs.
  // Divergences need human triage and are not, by themselves, failures.
  process.exit(by("v2-only-failure").length === 0 ? 0 : 1);
}

main();
