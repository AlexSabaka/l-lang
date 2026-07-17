#!/usr/bin/env ts-node
/**
 * AST INVARIANTS -- things that must be true of the tree, at every stage, for every program.
 *
 * WHY THIS EXISTS. A node whose `_type` disagrees with its SHAPE has no behavioural symptom: every
 * pass dispatches on `_type`, reads the fields that type declares, and never touches the strays. It
 * works, right up until something reads a field it did not expect to be there -- and then the bug is
 * ten passes away from whatever minted it.
 *
 * That is not hypothetical. `(fn [] -> Int (return 5))` in expression position reached codegen as
 * `_type: "list"` carrying a FUNCTION's entire field set (`params`, `returns`, `body`, ...):
 * `TreeShakeAstVisitor.visitList` returned the inner function to unwrap the grouping, and
 * `BaseAstTreeWalker.visit` -- which builds `{...super.visit(node), _type: node._type}` -- spread that
 * function's fields and stamped `"list"` back over them. The unwrap was silently undone AND the node
 * corrupted. It survived because it works by luck; the first code to read a list's non-`nodes` keys
 * (LL0103's return scan, a year later) walked straight into a lambda's body.
 *
 * The other harnesses cannot catch this class. `smoke-grammar-v2` stops at the parser; `codegen` and
 * `runner` compare OUTPUT, and the output was right. A structural lie needs a structural test.
 *
 * Usage:  npm run test:ast-invariants
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Context, CompilerOptions, CompilationStage, LogLevel } from "../compiler/Context";
import * as ast from "../compiler/frontend/ast";

const STAGES: CompilationStage[] = ["parse", "syntax", "symbols", "desugar"];

/**
 * The fields a node kind OWNS. A node carrying a field from another kind's list is a chimera --
 * something built it out of two different nodes and only one of them is reflected in `_type`.
 *
 * Deliberately partial: these are the kinds that have actually collided. A full schema belongs in
 * ast.ts, not in a test.
 */
const FOREIGN_FIELDS: Record<string, string[]> = {
  // A list's content is `nodes`, and only `nodes`. `params`/`body`/`returns` mean a function got
  // spread onto it.
  list: ["params", "returns", "body", "generics", "async"],
  // A function has no `nodes`; that is a list's field.
  function: ["nodes"],
  vector: ["params", "returns", "body", "nodes"],
};

interface Case {
  name: string;
  source: string;
}

const CASES: Case[] = [
  {
    // THE CASE THIS HARNESS WAS BUILT FOR. A lambda in expression position is a one-element list
    // wrapping a function -- exactly the shape TreeShake tried to unwrap.
    name: "a lambda in expression position",
    source: `((let g (fn [] -> Int (return 5))))`,
  },
  {
    name: "a lambda inside a match arm",
    source: `((fn f [x <- Int] -> Int ((let g (match x { 1 => (fn [] -> Int (return 5)) _ => (fn [] -> Int (return 9)) })) (return 0))))`,
  },
  {
    // D1: `(gs[0].hi)` is a CALL, not a grouping to unwrap. A one-element list that must SURVIVE.
    name: "a D1 dotted-member call",
    source: `((defclass G (fn hi [] -> String (return "hello"))) (let gs [(G)]) (console.log (gs[0].hi)))`,
  },
  {
    name: "an ordinary grouping",
    source: `((console.log ((+ 1 2))))`,
  },
];

function violations(root: any): string[] {
  const found: string[] = [];
  const seen = new Set<any>();

  const walk = (n: any): void => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);

    if (ast.isAstNode(n)) {
      const foreign = FOREIGN_FIELDS[n._type as string];
      if (foreign) {
        const strays = foreign.filter((f) => f in n);
        if (strays.length) {
          found.push(
            `_type="${n._type}" carries [${strays.join(", ")}] -- ` +
              `all keys: [${Object.keys(n).filter((k) => !k.startsWith("_")).join(", ")}]`
          );
        }
      }
    }

    for (const k of Object.keys(n)) {
      if (k === "_parent") continue; // cyclic, and not content
      const v = (n as any)[k];
      (Array.isArray(v) ? v.flat(Infinity) : [v]).forEach(walk);
    }
  };

  walk(root);
  return found;
}

function run(): number {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llang-ast-inv-"));
  let failed = 0;
  let checked = 0;

  console.log("=== AST invariants ===\n");

  for (const c of CASES) {
    const file = path.join(dir, `${c.name.replace(/[^a-z0-9]+/gi, "_")}.lisp`);
    fs.writeFileSync(file, c.source + "\n");

    for (const stage of STAGES) {
      const opts: CompilerOptions = {
        minimumLogLevel: LogLevel.Error,
        logger: () => {},
        includeRuntimeShim: false,
        stdout: false,
        stage,
        language: "js",
      } as unknown as CompilerOptions;

      let res: any;
      try {
        res = new Context(file, opts).process(file, stage);
      } catch (e: any) {
        console.log(`  FAIL  ${c.name} @ ${stage}: threw -- ${e?.message}`);
        failed++;
        continue;
      }

      checked++;
      const bad = violations(res?.ast);
      if (bad.length) {
        failed++;
        console.log(`  FAIL  ${c.name} @ ${stage}`);
        for (const b of bad) console.log(`          ${b}`);
      }
    }
  }

  console.log(`\n=== summary ===`);
  console.log(`  cases   : ${CASES.length} x ${STAGES.length} stages = ${checked} checks`);
  console.log(`  failed  : ${failed}   (target: 0)`);
  return failed === 0 ? 0 : 1;
}

process.exit(run());
