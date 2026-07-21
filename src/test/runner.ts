#!/usr/bin/env ts-node
/**
 * L-Lang Compiler Test Suite
 * 
 * Unified test runner that compiles and executes all .lisp examples
 * and compares output against .expect files.
 * 
 * Usage:
 *   npm test                     # Run all tests
 *   ts-node src/test/runner.ts   # Run directly
 *   npm test -- --verbose        # Show diffs on failure
 */

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { spawnSync } from 'child_process';
import { Context, CompilerOptions, LogLevel } from '../compiler/Context';
import { MANIFEST, ExampleStatus } from './manifest';
import { CHILD_ENV } from './childEnv';
import { C_PASSING } from './c-status';

// Backend under test. `--backend=c` compiles to C, builds with cc, runs the binary against the
// SAME .expect goldens, with ratchet semantics from c-status.ts. Default `js` is byte-for-byte
// the historical behavior.
const BACKEND: 'js' | 'c' = process.argv.includes('--backend=c') ? 'c' : 'js';
const GAP_LEDGER_ARG = (() => {
  const i = process.argv.indexOf('--gap-ledger');
  return i >= 0 ? process.argv[i + 1] : undefined;
})();

// Configuration
const EXAMPLES_DIR = path.join(__dirname, '../../examples');
const COMPILED_DIR = path.join(__dirname, BACKEND === 'c' ? '.compiled-c' : '.compiled');
const LEDGER_DIR = path.join(COMPILED_DIR, '.ledgers');
// node_modules is defense-in-depth only; nothing should ever place one under examples/.
// (Previously also skipped any directory path containing "p5js" -- a substring match against
// the FULL path, so checking the repo out under a path containing "p5js" anywhere would have
// skipped the entire suite. That directory's files are now declared in manifest.ts instead.)
const SKIP_DIRS = ['node_modules'];
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');
const RUN_TIMEOUT_MS = 5000;

// Mirrors examples/'s directory structure under a gitignored scratch dir, instead of writing
// generated .js/.js.map next to the .lisp source -- the suite must not dirty the tracked corpus.
function compiledPathFor(lispPath: string): string {
  const ext = BACKEND === 'c' ? '.c' : '.js';
  const rel = path.relative(EXAMPLES_DIR, lispPath).replace(/\.lisp$/, ext);
  return path.join(COMPILED_DIR, rel);
}

// Mirrors the CLI's defaults for `transform <file>` with no flags (see getCompilerOptions.ts).
// logger is a no-op: the old execSync-based runner discarded the compile step's own stdout/stderr
// entirely (stdio: ['ignore','pipe','pipe']), so warnings never surfaced through the test suite.
const COMPILE_OPTIONS: CompilerOptions = {
  minimumLogLevel: LogLevel.Warning,
  logger: () => {},
  includeRuntimeShim: true,
  stdout: false,
  stage: 'codegen',
  language: BACKEND,
};

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip' | 'error' | 'not-yet' | 'refused' | ExampleStatus;
  message?: string;
  expected?: string;
  actual?: string;
  stderr?: string;
}

type Classification = { status: ExampleStatus | 'undeclared'; reason?: string; codes?: string[] };

// Every .lisp is either declared in the manifest, or has a matching .expect (implicitly
// 'test'), or it's undeclared -- a hard error, not a silent skip.
function classify(lispPath: string): Classification {
  const relPath = path.relative(EXAMPLES_DIR, lispPath).split(path.sep).join('/');
  const expectPath = lispPath.replace(/\.lisp$/, '.expect');
  const entry = MANIFEST[relPath];

  if (entry) {
    if (entry.status === 'test' && !fs.existsSync(expectPath)) {
      return {
        status: 'undeclared',
        reason: `manifest declares 'test' but no matching .expect exists`
      };
    }
    return entry;
  }

  if (fs.existsSync(expectPath)) {
    return { status: 'test' };
  }

  return { status: 'undeclared', reason: 'not in manifest and no matching .expect' };
}

function walkDir(dir: string, callback: (filePath: string) => void) {
  fs.readdirSync(dir).forEach(f => {
    const dirPath = path.join(dir, f);
    const isDirectory = fs.statSync(dirPath).isDirectory();
    
    // Skip specific directories
    if (isDirectory && SKIP_DIRS.some(skip => dirPath.includes(skip))) {
      return;
    }
    
    if (isDirectory) {
      walkDir(dirPath, callback);
    } else {
      callback(dirPath);
    }
  });
}

function normalizeOutput(output: string): string {
  return output
    .replace(/\r\n/g, '\n')  // Normalize line endings
    .trim();                  // Remove trailing whitespace
}

/**
 * A file that is SUPPOSED to fail. It must not compile, and it must report every code it advertises.
 *
 * Without this, such a file has nowhere to live. `02-errors/01_errors.lisp` demonstrates LL0002 /
 * LL0006 / LL0007 on purpose -- it CANNOT produce stdout, because it never compiles -- and it was
 * being run as a POSITIVE test, so it read as a permanent ERROR for the whole audit. Its `.expect`
 * was a captured stderr dump with absolute filesystem paths baked into it, which could never have
 * matched on another machine anyway.
 *
 * Asserting the CODES is what makes this a test rather than an excuse: mark it 'fixture' and it would
 * be skipped, and a corpus file whose entire purpose is to demonstrate a diagnostic would assert
 * nothing. If one of these diagnostics silently stops firing, this goes red.
 */
function runNegativeTest(lispPath: string, codes: string[]): TestResult {
  const fileName = path.basename(lispPath);

  let reported: string[] = [];
  try {
    const context = new Context(lispPath, COMPILE_OPTIONS);
    context.process(lispPath);
    reported = context.results.all
      .map((m: any) => String(m.code))
      .filter((c) => c.startsWith('LL'));

    if (!context.results.hasErrors) {
      return {
        name: fileName,
        status: 'fail',
        message: `expected it to FAIL with ${codes.join(', ')}, but it compiled clean`,
      };
    }
  } catch (e: any) {
    // A parse CRASH is not a located diagnostic, and this file's whole point is that they ARE.
    return {
      name: fileName,
      status: 'fail',
      message: `expected ${codes.join(', ')}, but the compiler THREW: ${String(e.message).split('\n')[0]}`,
    };
  }

  const missing = codes.filter((c) => !reported.includes(c));
  if (missing.length) {
    return {
      name: fileName,
      status: 'fail',
      message: `expected ${missing.join(', ')} -- not reported. Got: ${reported.join(', ') || '(none)'}`,
    };
  }

  return { name: fileName, status: 'pass' };
}

/** The C-backend refusal codes: an HONEST "not modeled" answer, not a bug. */
const C_REFUSAL_CODES = ['LL0105', 'LL0106', 'LL0107'];

/**
 * Compile-to-C -> cc -> run -> diff the SAME golden. Ratchet semantics: a listed file must pass;
 * an unlisted failure is `not-yet` (the backend is phased); an unlisted PASS is red until the
 * list is updated -- a ratchet without teeth decays.
 */
function runCTest(lispPath: string): TestResult {
  const fileName = path.basename(lispPath);
  const relPath = path.relative(EXAMPLES_DIR, lispPath).split(path.sep).join('/');
  const listed = C_PASSING.includes(relPath);
  const expectPath = lispPath.replace(/\.lisp$/, '.expect');
  const cPath = compiledPathFor(lispPath);
  const binPath = cPath.replace(/\.c$/, '.bin');
  const softStatus = listed ? undefined : ('not-yet' as const);

  if (!fs.existsSync(expectPath)) {
    return { name: fileName, status: 'skip', message: 'No .expect file found' };
  }

  // Step 1: compile to C in-process. The per-file gap ledger lands in LEDGER_DIR for aggregation.
  process.env.LL_GAP_LEDGER = path.join(LEDGER_DIR, relPath.replace(/\//g, '__') + '.json');
  let code = '';
  try {
    const context = new Context(lispPath, COMPILE_OPTIONS);
    const result = context.process(lispPath);
    if (context.results.hasErrors) {
      const codes = [...new Set(context.results.all.map((m: any) => String(m.code)).filter((c) => c.startsWith('LL')))];
      const refusal = codes.find((c) => C_REFUSAL_CODES.includes(c));
      if (refusal && !listed) {
        return { name: fileName, status: 'refused', message: codes.join(', ') };
      }
      return { name: fileName, status: softStatus ?? 'error', message: `C compile refused: ${codes.join(', ')}` };
    }
    code = result.code || '';
  } catch (e: any) {
    return { name: fileName, status: softStatus ?? 'error', message: `C compile threw: ${String(e.message).split('\n')[0]}` };
  } finally {
    delete process.env.LL_GAP_LEDGER;
  }

  fs.mkdirSync(path.dirname(cPath), { recursive: true });
  fs.writeFileSync(cPath, code);

  // Step 2: cc. A cc failure is a FINDING (usually a missed coercion), surfaced not hidden.
  const cc = spawnSync('cc', ['-std=c11', cPath, '-o', binPath, '-lm'], { encoding: 'utf-8', timeout: 30000 });
  if (cc.status !== 0) {
    const firstErr = (cc.stderr || '').split('\n').find((l) => l.includes('error')) ?? (cc.stderr || '').split('\n')[0];
    return { name: fileName, status: softStatus ?? 'error', message: `cc failed: ${firstErr}`, stderr: cc.stderr };
  }

  // Step 3: run the binary against the same golden the JS suite uses.
  const run = spawnSync(binPath, [], { encoding: 'utf-8', timeout: RUN_TIMEOUT_MS, env: CHILD_ENV });
  if (run.error || run.status !== 0) {
    const why = run.error
      ? (run.error as any).code === 'ETIMEDOUT' ? `timeout after ${RUN_TIMEOUT_MS}ms` : run.error.message
      : `exit code ${run.status}`;
    return { name: fileName, status: softStatus ?? 'error', message: `runtime: ${why}`, actual: run.stdout, stderr: run.stderr };
  }

  const expected = normalizeOutput(fs.readFileSync(expectPath, 'utf-8'));
  const actual = normalizeOutput(run.stdout);
  if (actual !== expected) {
    return {
      name: fileName,
      status: softStatus ?? 'fail',
      message: 'Output mismatch',
      expected, actual, stderr: run.stderr,
    };
  }
  if (!listed) {
    return { name: fileName, status: 'fail', message: `RATCHET: newly passing -- add "${relPath}" to src/test/c-status.ts` };
  }
  return { name: fileName, status: 'pass', stderr: run.stderr };
}

function runTest(lispPath: string): TestResult {
  const fileName = path.basename(lispPath);
  const dirName = path.dirname(lispPath);
  const expectPath = path.join(dirName, fileName.replace('.lisp', '.expect'));
  const jsPath = compiledPathFor(lispPath);
  
  // Check if .expect file exists
  if (!fs.existsSync(expectPath)) {
    return {
      name: fileName,
      status: 'skip',
      message: 'No .expect file found'
    };
  }
  
  try {
    // Step 1: Compile the .lisp file in-process (was: spawning `ts-node src/index.ts
    // transform` per file, the bulk of the suite's wall-clock time).
    try {
      const context = new Context(lispPath, COMPILE_OPTIONS);
      const result = context.process(lispPath);

      if (context.results.hasErrors) {
        // D47 conditions/restarts are refused on the JS backend with LL0108 (the mirror of the C
        // backend's LL0105-07 refusals). A C-only positive example reports `refused` here, not a hard
        // error, so `npm test` stays green while `npm run test:c` runs it. Only LL0108-and-nothing-else
        // qualifies -- a real type/syntax error alongside it is still an error.
        const codes = [...new Set(context.results.all.map((m: any) => String(m.code)).filter((c: string) => c.startsWith('LL')))];
        if (codes.length > 0 && codes.every((c) => c === 'LL0108')) {
          return { name: fileName, status: 'refused', message: codes.join(', ') };
        }
        return {
          name: fileName,
          status: 'error',
          message: 'Compilation error: type/syntax errors reported'
        };
      }

      fs.mkdirSync(path.dirname(jsPath), { recursive: true });
      fs.writeFileSync(jsPath, result.code || '');
      fs.writeFileSync(jsPath + '.map', (result.map || '').toString());
    } catch (compileError: any) {
      return {
        name: fileName,
        status: 'error',
        message: `Compilation error: ${compileError.message}`
      };
    }

    // Step 2: Check if .js file was generated
    if (!fs.existsSync(jsPath)) {
      return {
        name: fileName,
        status: 'error',
        message: 'No .js file generated'
      };
    }

    // Step 3: Execute the generated JavaScript. spawnSync (not execSync) so a nonzero exit
    // doesn't depend on throwing, stderr is captured even when the process succeeds, and a
    // hung process (e.g. an infinite loop in generated code) is killed instead of hanging
    // the whole suite forever.
    const run = spawnSync('node', [jsPath], {
      encoding: 'utf-8',
      timeout: RUN_TIMEOUT_MS,
      // CHILD_ENV, not process.env: FORCE_COLOR makes node colourise its own console.log through a
      // PIPE, so every golden with a number in it fails on a machine that sets it. See childEnv.ts.
      env: CHILD_ENV
    });

    if (run.error) {
      const timedOut = (run.error as any).code === 'ETIMEDOUT';
      return {
        name: fileName,
        status: 'error',
        message: timedOut
          ? `Timeout: process did not exit within ${RUN_TIMEOUT_MS}ms`
          : `Runtime error: ${run.error.message}`,
        actual: run.stdout,
        stderr: run.stderr
      };
    }

    if (run.status !== 0) {
      return {
        name: fileName,
        status: 'error',
        message: `Runtime error: process exited with code ${run.status}`,
        actual: run.stdout,
        stderr: run.stderr
      };
    }

    // Step 4: Compare output
    const expected = fs.readFileSync(expectPath, 'utf-8');
    const actual = normalizeOutput(run.stdout);
    const normalizedExpected = normalizeOutput(expected);

    if (actual === normalizedExpected) {
      return {
        name: fileName,
        status: 'pass',
        stderr: run.stderr
      };
    } else {
      return {
        name: fileName,
        status: 'fail',
        message: 'Output mismatch',
        expected: normalizedExpected,
        stderr: run.stderr,
        actual: actual
      };
    }
    
  } catch (error: any) {
    return {
      name: fileName,
      status: 'error',
      message: error.message
    };
  }
}

function printTestResult(result: TestResult, index: number, total: number) {
  const testLabel = `[${index.toString().padStart(2)}/${total}] ${result.name}`;
  const padding = Math.max(0, 60 - testLabel.length);
  process.stdout.write(`${testLabel} ${'·'.repeat(padding)} `);
  
  switch (result.status) {
    case 'pass':
      console.log(chalk.green('✅ PASS'));
      if (VERBOSE && result.stderr) {
        console.log(chalk.gray(`  stderr: ${result.stderr.trim()}\n`));
      }
      break;
    case 'fail':
      console.log(chalk.red('❌ FAIL') + (result.message && !result.expected ? chalk.gray(`  (${result.message})`) : ''));
      if (VERBOSE && result.expected && result.actual) {
        console.log(chalk.gray('\n  Expected:'));
        console.log(chalk.yellow(result.expected.split('\n').map(l => `    ${l}`).join('\n')));
        console.log(chalk.gray('  Actual:'));
        console.log(chalk.cyan(result.actual.split('\n').map(l => `    ${l}`).join('\n')));
        if (result.stderr) {
          console.log(chalk.gray('  stderr:'));
          console.log(chalk.gray(result.stderr.trim().split('\n').map(l => `    ${l}`).join('\n')));
        }
        console.log();
      }
      break;
    case 'skip':
      console.log(chalk.yellow('⚠️  SKIP'));
      if (VERBOSE && result.message) {
        console.log(chalk.gray(`  ${result.message}\n`));
      }
      break;
    case 'error':
      console.log(chalk.red('💥 ERROR'));
      if (result.message) {
        console.log(chalk.red(`  ${result.message}\n`));
      }
      if (VERBOSE && result.stderr) {
        console.log(chalk.gray(`  stderr: ${result.stderr.trim()}\n`));
      }
      break;
    case 'library':
      console.log(chalk.cyan('📚 LIBRARY'));
      break;
    case 'fixture':
      console.log(chalk.magenta('🧪 FIXTURE') + (result.message ? chalk.gray(`  (${result.message})`) : ''));
      break;
    case 'xfail':
      console.log(chalk.yellow('⏳ XFAIL') + (result.message ? chalk.gray(`  (${result.message})`) : ''));
      break;
    case 'not-yet':
      console.log(chalk.gray('🚧 NOT-YET') + (result.message ? chalk.gray(`  (${result.message.slice(0, 100)})`) : ''));
      break;
    case 'refused':
      console.log(chalk.blue('🚫 REFUSED') + (result.message ? chalk.gray(`  (${result.message})`) : ''));
      break;
  }
}

/** Aggregate the per-file gap ledgers the C compiles dropped, print a summary, optionally save. */
function summarizeGapLedgers() {
  if (!fs.existsSync(LEDGER_DIR)) return;
  const totals = new Map<string, number>();
  const merged: any[] = [];
  for (const f of fs.readdirSync(LEDGER_DIR)) {
    try {
      const rows = JSON.parse(fs.readFileSync(path.join(LEDGER_DIR, f), 'utf-8'));
      for (const row of rows) {
        merged.push(row);
        const key = `${row.assumption}:${row.construct}`;
        totals.set(key, (totals.get(key) ?? 0) + (row.count ?? 1));
      }
    } catch { /* a partial write is telemetry loss, not a failure */ }
  }
  if (totals.size === 0) return;
  console.log(chalk.bold('\n  Gap ledger (spec-assumption evidence, corpus-wide)'));
  console.log(chalk.bold('  --------------------------------------------------'));
  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  for (const [key, count] of rows.slice(0, 20)) {
    console.log(`  ${String(count).padStart(6)}  ${key}`);
  }
  if (rows.length > 20) console.log(chalk.gray(`  ... and ${rows.length - 20} more rows`));
  if (GAP_LEDGER_ARG) {
    fs.writeFileSync(GAP_LEDGER_ARG, JSON.stringify(merged, null, 2));
    console.log(chalk.gray(`\n  full ledger written to ${GAP_LEDGER_ARG}`));
  }
}

// Main test runner
function main() {
  console.log(chalk.bold('\n================================'));
  console.log(chalk.bold('  L-Lang Compiler Test Suite'));
  console.log(chalk.bold('================================\n'));

  // Fresh scratch dir each run so a renamed/deleted example can't leave a stale compiled
  // artifact behind.
  fs.rmSync(COMPILED_DIR, { recursive: true, force: true });

  const testFiles: string[] = [];
  walkDir(EXAMPLES_DIR, (filePath) => {
    if (filePath.endsWith('.lisp')) {
      testFiles.push(filePath);
    }
  });

  // Sort files for consistent ordering
  testFiles.sort();

  // Preflight: every .lisp must be declared -- either it has a matching .expect, or it's
  // classified in manifest.ts. An undeclared file is a hard error, not a silent skip.
  const classifications = testFiles.map(filePath => ({ filePath, ...classify(filePath) }));
  const undeclared = classifications.filter(c => c.status === 'undeclared');

  if (undeclared.length > 0) {
    console.log(chalk.red.bold(`💥 ${undeclared.length} undeclared example(s):\n`));
    undeclared.forEach(u => {
      const rel = path.relative(EXAMPLES_DIR, u.filePath);
      console.log(chalk.red(`  ${rel}`) + chalk.gray(u.reason ? ` -- ${u.reason}` : ''));
    });
    console.log(chalk.gray('\nAdd a .expect file, or classify it in src/test/manifest.ts.\n'));
    process.exit(1);
  }

  const results: TestResult[] = [];
  const total = testFiles.length;

  classifications.forEach(({ filePath, status, reason, codes }, index) => {
    // 'undeclared' already exited above -- everything reaching here is a real ExampleStatus.
    let result: TestResult;
    if (status === 'test') {
      result = BACKEND === 'c' ? runCTest(filePath) : runTest(filePath);
    } else if (status === 'negative') {
      result = BACKEND === 'c'
        ? { name: path.basename(filePath), status: 'skip', message: 'negative tests are frontend-only (JS suite covers them)' }
        : runNegativeTest(filePath, codes ?? []);
    } else {
      result = { name: path.basename(filePath), status: status as ExampleStatus, message: reason };
    }
    results.push(result);
    printTestResult(result, index + 1, total);
  });

  // Summary
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const errors = results.filter(r => r.status === 'error').length;
  const library = results.filter(r => r.status === 'library').length;
  const fixture = results.filter(r => r.status === 'fixture').length;
  const xfail = results.filter(r => r.status === 'xfail').length;
  const notYet = results.filter(r => r.status === 'not-yet').length;
  const refused = results.filter(r => r.status === 'refused').length;

  console.log(chalk.bold('\n================================'));
  console.log(chalk.bold(BACKEND === 'c' ? '  Test Results (C backend)' : '  Test Results'));
  console.log(chalk.bold('================================'));
  console.log(chalk.green(`✅ Passed:   ${passed}`));
  console.log(chalk.red(`❌ Failed:   ${failed}`));
  console.log(chalk.red(`💥 Errors:   ${errors}`));
  if (BACKEND === 'c') {
    console.log(chalk.gray(`🚧 Not yet:  ${notYet}`));
    console.log(chalk.blue(`🚫 Refused:  ${refused}`));
  }
  console.log(chalk.cyan(`📚 Library:  ${library}`));
  console.log(chalk.magenta(`🧪 Fixture:  ${fixture}`));
  console.log(chalk.yellow(`⏳ XFail:    ${xfail}`));
  console.log(chalk.bold(`📊 Total:    ${total}\n`));

  if (BACKEND === 'c') summarizeGapLedgers();
  
  if (failed === 0 && errors === 0) {
    console.log(chalk.green.bold('🎉 All tests passed!\n'));
    process.exit(0);
  } else {
    console.log(chalk.red.bold('⚠️  Some tests failed\n'));
    if (!VERBOSE) {
      console.log(chalk.gray('💡 Run with --verbose to see detailed output\n'));
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { runTest, TestResult };