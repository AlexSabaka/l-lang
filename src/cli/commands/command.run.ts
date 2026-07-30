import chalk from "chalk";
import highlight from "cli-highlight";

import { Command } from "commander";

import { Context, LogLevel, logCompilationMessages } from "../../compiler/Context";

import { getCompilerOptions } from "../getCompilerOptions";
import evalInScope from "../../compiler/runtime/evalInScope";
import { getTemporaryStdinFile } from "../getStdinTempFile";

import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { ccArgs } from "../../compiler/codegen/c/ccFlags";

const { stdout } = process;

export function run(file: string, command: Command) {
  const options = getCompilerOptions(command);

  if (options.stdin) {
    // Read from stdin and write to a temporary file
    file = getTemporaryStdinFile();
  }

  if (!file) {
    console.error("No input file specified. Please provide a l-lang file to transform.");
    process.exit(1);
  }

  const context = new Context(file, options);

  const { code } = context.process(file, "codegen");

  if (context.results.hasErrors) {
    // Same gap as `transform`: codegen-stage diagnostics are never printed by Context.process().
    logCompilationMessages(context);
    process.exitCode = 1;
    return;
  }

  // Output performance report if enabled
  if (options.perf) {
    console.log(context.getPerformanceReport());
  }

  if (code) {
    if (options.stdout) {
      context.log(LogLevel.Info, chalk.strikethrough.dim(" ".repeat(stdout.columns)));
      // The highlighter follows the BACKEND. `command.transform.ts` already did this (`isC`); this
      // site did not, and hardcoded "javascript" -- latent while JS was the default, wrong the
      // moment D104 flipped it. The sibling site knew the rule and this one did not.
      console.log(highlight(code, { language: options.language === "c" ? "c" : "javascript" }));
      context.log(LogLevel.Info, chalk.strikethrough.dim(" ".repeat(stdout.columns)));
    }
    if (options.language === "js") {
      // Evaluate the compiled code in a sandboxed scope.
      evalInScope(code);
    }
    else if (options.language === "c") {
      // The C backend has no interpreter to hand the code to, so `run` is compile-and-execute.
      //
      // The artifacts go in a PRIVATE TEMP DIRECTORY, and that is a correctness requirement rather
      // than tidiness. This used to write `<base>.c` and `<base>.out` into `process.cwd()` and then
      // `rmSync` both -- so running `f.lisp` in a directory containing a hand-written `f.c`
      // OVERWROTE it and then DELETED it. Measured, with the user's file gone and exit 0. That was
      // survivable while `--backend c` was opt-in; D104 made it the default, which would have
      // promoted a data-loss path to the thing that happens when you type `l-lang run`.
      //
      // A fresh `mkdtemp` also makes two concurrent runs of the same basename independent, which
      // the cwd scheme could not be.
      const baseName = path.basename(file, ".lisp");
      const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "llang-run-"));
      const cFile = path.join(workDir, `${baseName}.c`);
      const executable = path.join(workDir, `${baseName}.out`);
      const cleanup = () => fs.rmSync(workDir, { recursive: true, force: true });
      fs.writeFileSync(cFile, code, { encoding: "utf-8" });
      // The flags come from ONE place (`ccFlags.ts`) because they had drifted: every test harness
      // used `-std=c11 -fwrapv` and this call used neither, so the gate graded a program built with
      // different semantics than the one a user gets. `-w` stays local -- silencing warnings about
      // generated code the user did not write is a UX choice, not a semantic one.
      //
      // `spawnSync` with an ARGV, not `exec` with a shell string: the args reach `cc` verbatim, so a
      // path containing a space no longer needs quoting that was never applied.
      const cc = spawnSync("cc", ccArgs(cFile, executable, ["-w"]), { encoding: "utf-8" });
      // `cc.error` is set and `cc.status` is NULL when the compiler is not on PATH. Reading only
      // `status` printed "cc exited with null", which under D104 is the message every user without a
      // toolchain gets from a plain `l-lang run` -- so it has to name the actual problem.
      if (cc.error) {
        const missing = (cc.error as NodeJS.ErrnoException).code === "ENOENT";
        console.error(
          missing
            ? "Error: no C compiler found. `l-lang run` compiles through `cc` (D104); install one, " +
              "or use `--backend js` for the deprecated oracle."
            : `Error invoking cc: ${cc.error.message}`
        );
        process.exitCode = 1;
        cleanup();
        return;
      }
      if (cc.status !== 0) {
        console.error(`Error compiling C code: cc exited with ${cc.status}`);
        if (cc.stderr) process.stderr.write(cc.stderr);
        process.exitCode = 1;
        cleanup();
        return;
      }
      // A successful `cc` may still have said something (notes, remarks) -- forward, don't abort.
      if (cc.stderr) process.stderr.write(cc.stderr);
      // `stdio: "inherit"` is the whole fix, and it repairs two defects at once. `exec` opened a
      // stdin PIPE it never wrote to and never closed, so any program that read stdin blocked
      // forever -- `echo hi | l-lang run --backend c` hung rather than answering. And `exec`
      // buffers: a long-running program's output appeared only at exit, never streamed. Inheriting
      // gives the child the real stdin, stdout and stderr, which is what a `run` command means.
      //
      // The child inherits the CWD, so the program still resolves its own relative paths against
      // the directory the user is standing in -- only the build artifacts moved.
      const proc = spawnSync(executable, [], { stdio: "inherit" });
      // A signal-killed child reports `status === null` and `signal` set; testing `status` alone let
      // a SIGSEGV exit 0. `status === 0` is falsy too, which the old test got right only by luck.
      if (proc.signal) process.exitCode = 128 + (os.constants.signals[proc.signal] ?? 0);
      else if (proc.status !== null) process.exitCode = proc.status;
      cleanup();
    }
  }
}
