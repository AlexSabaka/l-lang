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
import { execSync } from 'child_process';
import { Context, CompilerOptions, LogLevel } from '../compiler/Context';

// Configuration
const EXAMPLES_DIR = path.join(__dirname, '../../examples');
const SKIP_DIRS = ['p5js', 'node_modules'];
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');

// Mirrors the CLI's defaults for `transform <file>` with no flags (see getCompilerOptions.ts).
// logger is a no-op: the old execSync-based runner discarded the compile step's own stdout/stderr
// entirely (stdio: ['ignore','pipe','pipe']), so warnings never surfaced through the test suite.
const COMPILE_OPTIONS: CompilerOptions = {
  minimumLogLevel: LogLevel.Warning,
  logger: () => {},
  includeRuntimeShim: true,
  stdout: false,
  stage: 'codegen',
  language: 'js',
};

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip' | 'error';
  message?: string;
  expected?: string;
  actual?: string;
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

function runTest(lispPath: string): TestResult {
  const fileName = path.basename(lispPath);
  const dirName = path.dirname(lispPath);
  const expectPath = path.join(dirName, fileName.replace('.lisp', '.expect'));
  const jsPath = path.join(dirName, fileName.replace('.lisp', '.js'));
  
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
        return {
          name: fileName,
          status: 'error',
          message: 'Compilation error: type/syntax errors reported'
        };
      }

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

    // Step 3: Execute the generated JavaScript
    let stdout: string;
    try {
      stdout = execSync(`node "${jsPath}"`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (runError: any) {
      return {
        name: fileName,
        status: 'error',
        message: `Runtime error: ${runError.message}`,
        actual: runError.stdout || runError.stderr
      };
    }
    
    // Step 4: Compare output
    const expected = fs.readFileSync(expectPath, 'utf-8');
    const actual = normalizeOutput(stdout);
    const normalizedExpected = normalizeOutput(expected);
    
    if (actual === normalizedExpected) {
      return {
        name: fileName,
        status: 'pass'
      };
    } else {
      return {
        name: fileName,
        status: 'fail',
        message: 'Output mismatch',
        expected: normalizedExpected,
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
      break;
    case 'fail':
      console.log(chalk.red('❌ FAIL'));
      if (VERBOSE && result.expected && result.actual) {
        console.log(chalk.gray('\n  Expected:'));
        console.log(chalk.yellow(result.expected.split('\n').map(l => `    ${l}`).join('\n')));
        console.log(chalk.gray('  Actual:'));
        console.log(chalk.cyan(result.actual.split('\n').map(l => `    ${l}`).join('\n')));
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
      break;
  }
}

// Main test runner
function main() {
  console.log(chalk.bold('\n================================'));
  console.log(chalk.bold('  L-Lang Compiler Test Suite'));
  console.log(chalk.bold('================================\n'));
  
  const testFiles: string[] = [];
  walkDir(EXAMPLES_DIR, (filePath) => {
    if (filePath.endsWith('.lisp')) {
      testFiles.push(filePath);
    }
  });
  
  // Sort files for consistent ordering
  testFiles.sort();
  
  const results: TestResult[] = [];
  const total = testFiles.length;
  
  testFiles.forEach((filePath, index) => {
    const result = runTest(filePath);
    results.push(result);
    printTestResult(result, index + 1, total);
  });
  
  // Summary
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const errors = results.filter(r => r.status === 'error').length;
  const skipped = results.filter(r => r.status === 'skip').length;
  
  console.log(chalk.bold('\n================================'));
  console.log(chalk.bold('  Test Results'));
  console.log(chalk.bold('================================'));
  console.log(chalk.green(`✅ Passed:  ${passed}`));
  console.log(chalk.red(`❌ Failed:  ${failed}`));
  console.log(chalk.red(`💥 Errors:  ${errors}`));
  console.log(chalk.yellow(`⚠️  Skipped: ${skipped}`));
  console.log(chalk.bold(`📊 Total:   ${total}\n`));
  
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