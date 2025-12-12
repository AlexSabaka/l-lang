import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';

const EXAMPLES_DIR = path.join(__dirname, '../../examples');
const COMPILER_CMD = 'ts-node src/index.ts run'; 

function walkDir(dir: string, callback: (filePath: string) => void) {
  fs.readdirSync(dir).forEach(f => {
    const dirPath = path.join(dir, f);
    const isDirectory = fs.statSync(dirPath).isDirectory();
    if (isDirectory) {
      walkDir(dirPath, callback);
    } else {
      callback(dirPath);
    }
  });
}

function normalizeOutput(output: string): string {
    return output.replace(/\r\n/g, '\n').trim();
}

console.log("🚀 Starting Snapshot Tests...\n");

let passed = 0;
let failed = 0;
let skipped = 0;

walkDir(EXAMPLES_DIR, (filePath) => {
  if (!filePath.endsWith('.lisp')) return;

  // Skip p5js or specific folders if needed
  if (filePath.includes('p5js')) return;

  const fileName = path.basename(filePath);
  const dirName = path.dirname(filePath);
  const expectPath = path.join(dirName, fileName.replace('.lisp', '.expect'));

  // 1. Check if .expect file exists
  if (!fs.existsSync(expectPath)) {
    skipped++;
    console.warn(`⚠️  Skipping ${fileName}: No .expect file found.`);
    return;
  }

  const testLabel = `Testing ${fileName}`;
  process.stdout.write(`${testLabel} ${"".padEnd(40 - testLabel.length, ".")} `);

  try {
    // 2. Run the compiler CLI directly (Integration Test)
    // We capture stdout from the run command
    // Note: This assumes 'run' compiles AND executes. 
    // If your CLI logs compilation info to stdout, you might need to adjust flags to -q (quiet)
    const stdout = execSync(`${COMPILER_CMD} "${filePath}"`, { 
        encoding: 'utf-8', 
        stdio: ['ignore', 'pipe', 'ignore'] // Ignore stdin/stderr
    });

    // 3. Compare
    const expected = fs.readFileSync(expectPath, 'utf-8');
    const actual = normalizeOutput(stdout);
    const normalizedExpected = normalizeOutput(expected);

    // Filter out Compiler Info logs if they are polluting stdout
    // (A better way is to make the compiler write logs to stderr and program output to stdout)
    // For now, let's assume actual contains just the program output or we clean it.
    // Hack: remove lines starting with "Info" or "Debug"
    const cleanActual = actual
        .split('\n')
        .filter(line => !line.match(/^(Info|Debug|Warn)\s+/))
        .join('\n')
        .trim();

    if (cleanActual === normalizedExpected) {
      console.log(chalk.green("PASS"));
      passed++;
    } else {
      console.log(chalk.red("FAIL"));
      console.log(`\nExpected:\n${normalizedExpected}`);
      console.log(`\nActual:\n${cleanActual}\n`);
      failed++;
    }

  } catch (e: any) {
    console.log(chalk.red("ERROR"));
    console.log(e.message);
    failed++;
  }
});

console.log(`\nSummary: ${chalk.green(passed + " Passed")}, ${chalk.red(failed + " Failed")}, ${chalk.yellow(skipped + " Skipped")}`);

if (failed > 0) process.exit(1);