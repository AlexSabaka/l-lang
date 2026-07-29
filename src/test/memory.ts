/**
 * The bounded-RSS acceptance test for D59's collector.
 *
 * D59 requires this to land RED, before any collector exists: "nothing in the corpus measures memory
 * today, and a collector without a failing test is precisely the silent-failure shape this project
 * was rebuilt to kill." So it is written first, it fails first, and the failure is the specification.
 *
 * WHAT IT MEASURES. `fixtures/memory/garbage_loop.lisp` allocates a vector and a map per iteration
 * and drops both immediately, so the live set is constant and peak RSS should be a FLAT function of
 * the iteration count. The assertion is the RATIO `RSS(2N) / RSS(N)`:
 *
 *     no collector   ~2.0   (malloc-and-never-free -- a straight line through the origin)
 *     a collector    ~1.0   (the live set is what it is, regardless of how much garbage passed through)
 *
 * A ratio rather than a byte budget, deliberately: neither endpoint depends on the machine, on the
 * allocator's page behaviour, or on the size of the runtime's fixed overhead. A budget would have to
 * be retuned on every host and would fail for reasons that are not about memory.
 *
 * THE JS SIDE IS THE CONTROL, not a second subject. V8 collects, so its ratio is already ~1.0 -- which
 * is what makes the target a measured number rather than an assumption, and proves the workload
 * really does drop its garbage rather than accidentally retaining it.
 *
 * EXPECTED-RED BOOKKEEPING. While `EXPECT_RED` is true a failing C ratio is reported and the suite
 * still exits 0, so the gate stays green on a defect that is deliberately not fixed yet. When the
 * collector lands, flip it to false in the same commit: the suite then has teeth, and a regression
 * that reintroduces unbounded growth turns it red.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { Context, CompilerOptions, LogLevel, CompilationLanguage } from "../compiler/Context";
import { ccArgs } from "../compiler/codegen/c/ccFlags";

/** Flip to false in the commit that lands the collector. */
const EXPECT_RED = true;

/** The ratio above which growth is "unbounded". 1.0 is perfect; 2.0 is no collector at all. */
const MAX_RATIO = 1.30;

/** N and 2N. Large enough that the garbage dominates the runtime's fixed overhead. */
const N = 200_000;

const HERE = __dirname;
const FIXTURE = path.join(HERE, "fixtures", "memory", "garbage_loop.lisp");
const OUT_DIR = path.join(HERE, ".compiled-c");

function baseOptions(language: CompilationLanguage): CompilerOptions {
  return {
    minimumLogLevel: LogLevel.Warning,
    logger: () => {},
    includeRuntimeShim: true,
    stdout: false,
    stage: "codegen",
    language,
  };
}

interface Run {
  rss: number | null;
  /** The heap census `ll_gc_report` dumps under LL_GC_STATS (D59 step 1). */
  blocks: number | null;
  bytes: number | null;
}

/** Peak RSS in bytes for one run, via `/usr/bin/time -l` (BSD) or `-v` (GNU). */
function peakRssBytes(cmd: string, args: string[], iterations: number): number | null {
  return runOnce(cmd, args, iterations).rss;
}

function runOnce(cmd: string, args: string[], iterations: number): Run {
  const r = spawnSync("/usr/bin/time", ["-l", cmd, ...args], {
    encoding: "utf-8",
    timeout: 120_000,
    env: { ...process.env, LL_GC_N: String(iterations), LL_GC_STATS: "1" },
  });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  // BSD/macOS: "  12345678  maximum resident set size" (BYTES).
  const bsd = text.match(/(\d+)\s+maximum resident set size/);
  // GNU: "Maximum resident set size (kbytes): 12345".
  const gnu = text.match(/Maximum resident set size \(kbytes\):\s*(\d+)/);
  const census = text.match(/ll_gc: blocks=(\d+) bytes=(\d+)/);
  return {
    rss: bsd ? Number(bsd[1]) : gnu ? Number(gnu[1]) * 1024 : null,
    blocks: census ? Number(census[1]) : null,
    bytes: census ? Number(census[2]) : null,
  };
}

function compile(language: CompilationLanguage): string {
  const context = new Context(FIXTURE, baseOptions(language));
  const result = context.process(FIXTURE);
  if (context.results.hasErrors) {
    const codes = [...new Set(context.results.all.map((m: any) => String(m.code)))].join(", ");
    throw new Error(`compile refused: ${codes}`);
  }
  return result.code || "";
}

function mb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function main(): void {
  console.log("=== bounded-RSS acceptance (D59) ===\n");
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let failures = 0;
  let expectedRed = 0;

  // -- C: the subject ------------------------------------------------------------------------------
  const cPath = path.join(OUT_DIR, "gc_garbage_loop.c");
  const binPath = path.join(OUT_DIR, "gc_garbage_loop.bin");
  fs.writeFileSync(cPath, compile("c"));
  const cc = spawnSync("cc", ccArgs(cPath, binPath, ["-O2"]), {
    encoding: "utf-8",
    timeout: 60_000,
  });
  if (cc.status !== 0) {
    console.log(`  FAIL  cc: ${String(cc.stderr).split("\n")[0]}`);
    process.exit(1);
  }

  const r1 = runOnce(binPath, [], N);
  const r2 = runOnce(binPath, [], 2 * N);
  const c1 = r1.rss;
  const c2 = r2.rss;
  if (c1 === null || c2 === null) {
    console.log("  SKIP  no `/usr/bin/time` RSS reporting on this host");
    process.exit(0);
  }
  const cRatio = c2 / c1;
  console.log(`  C   N=${N}   ${mb(c1)}`);
  console.log(`  C   N=${2 * N}   ${mb(c2)}`);
  console.log(`  C   ratio RSS(2N)/RSS(N) = ${cRatio.toFixed(2)}   (target <= ${MAX_RATIO})`);
  if (cRatio > MAX_RATIO) {
    if (EXPECT_RED) {
      expectedRed++;
      console.log(`  XFAIL C memory is UNBOUNDED -- every allocation leaks (D59's collector is not built).`);
    } else {
      failures++;
      console.log(`  FAIL  C memory grows with the garbage, not the live set.`);
    }
  } else if (EXPECT_RED) {
    failures++;
    console.log(`  FAIL  C ratio is already bounded -- the collector landed, so flip EXPECT_RED to false.`);
  } else {
    console.log(`  PASS  C memory is bounded by the live set.`);
  }

  // -- the heap census (D59 step 1) ----------------------------------------------------------------
  //
  // Every GC allocation is headered and threaded onto one list, so the runtime can say exactly what
  // it is holding and of what kind. Asserted here rather than merely printed, because the census is
  // what the mark phase will be checked against: a collector that frees 90% of the heap is only
  // provable if the heap was countable first.
  //
  // The check is that the census SCALES WITH THE WORK -- doubling the iterations doubles the blocks.
  // That is the same unbounded growth the RSS ratio reports, measured at the allocator instead of at
  // the OS, and it is the number that should collapse to ~1.0 when the collector lands.
  if (r1.blocks !== null && r2.blocks !== null) {
    const ratio = r2.blocks / r1.blocks;
    console.log(`\n  heap  N=${N}   ${r1.blocks} blocks / ${mb(r1.bytes!)}`);
    console.log(`  heap  N=${2 * N}   ${r2.blocks} blocks / ${mb(r2.bytes!)}`);
    console.log(`  heap  ratio blocks(2N)/blocks(N) = ${ratio.toFixed(2)}`);
    if (Math.abs(ratio - cRatio) > 0.25) {
      failures++;
      console.log(`  FAIL  the census and RSS disagree about growth (${ratio.toFixed(2)} vs ${cRatio.toFixed(2)}).`);
      console.log(`        One of them is not measuring the heap -- most likely an allocation site`);
      console.log(`        that still bypasses ll_gc_alloc, so the census under-counts.`);
    } else {
      console.log(`  PASS  the census agrees with RSS -- every allocation is accounted for.`);
    }
  } else {
    failures++;
    console.log(`\n  FAIL  no heap census in the output -- LL_GC_STATS / ll_gc_report is not wired up.`);
  }

  // -- JS: the control -----------------------------------------------------------------------------
  const jsPath = path.join(OUT_DIR, "gc_garbage_loop.js");
  fs.writeFileSync(jsPath, compile("js"));
  const j1 = peakRssBytes(process.execPath, [jsPath], N);
  const j2 = peakRssBytes(process.execPath, [jsPath], 2 * N);
  if (j1 !== null && j2 !== null) {
    const jRatio = j2 / j1;
    console.log(`\n  JS  ratio RSS(2N)/RSS(N) = ${jRatio.toFixed(2)}   (control -- V8 collects)`);
    if (jRatio > MAX_RATIO) {
      failures++;
      console.log(`  FAIL  the JS control is unbounded too, so the WORKLOAD retains its garbage.`);
      console.log(`        Fix the fixture before trusting the C number: the ratio is measuring the`);
      console.log(`        wrong thing on both backends.`);
    } else {
      console.log(`  PASS  the control is bounded -- the workload really does drop what it allocates.`);
    }
  }

  console.log(`\n=== summary ===`);
  console.log(`  failures      : ${failures}   (target: 0)`);
  console.log(`  expected-red  : ${expectedRed}   (D59: the acceptance test lands before the collector)`);
  process.exit(failures > 0 ? 1 : 0);
}

main();
