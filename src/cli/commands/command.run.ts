import chalk from "chalk";
import highlight from "cli-highlight";

import { Command } from "commander";

import { Context, LogLevel, logCompilationMessages } from "../../compiler/Context";

import { getCompilerOptions } from "../getCompilerOptions";
import evalInScope from "../../compiler/runtime/evalInScope";
import { getTemporaryStdinFile } from "../getStdinTempFile";

import { exec } from "child_process";
import fs from "fs";
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
      console.log(highlight(code, { language: "javascript" }));
      context.log(LogLevel.Info, chalk.strikethrough.dim(" ".repeat(stdout.columns)));
    }
    if (options.language === "js") {
      // Evaluate the compiled code in a sandboxed scope.
      evalInScope(code);
    }
    else if (options.language === "c") {
      // The C backend has no interpreter to hand the code to, so `run` is compile-and-execute:
      // drop a translation unit next to the cwd, `cc` it, run it, then clear both artifacts.
      const baseName = path.basename(file, ".lisp");
      const cFile = `${baseName}.c`;
      const executable = `${baseName}.out`;
      const cleanup = () => {
        fs.rmSync(cFile, { force: true });
        fs.rmSync(executable, { force: true });
      };
      fs.writeFileSync(cFile, code, { encoding: "utf-8" });
      // The flags come from ONE place (`ccFlags.ts`) because they had drifted: every test harness
      // used `-std=c11 -fwrapv` and this call used neither, so the gate graded a program built with
      // different semantics than the one a user gets. `-w` stays local -- silencing warnings about
      // generated code the user did not write is a UX choice, not a semantic one.
      exec(`cc ${ccArgs(cFile, executable, ["-w"]).join(" ")}`, (ccError, _ccOut, ccErr) => {
        if (ccError) {
          console.error(`Error compiling C code: ${ccError.message}`);
          if (ccErr) process.stderr.write(ccErr);
          process.exitCode = 1;
          cleanup();
          return;
        }
        // A successful `cc` may still have said something (notes, remarks) -- forward, don't abort.
        if (ccErr) process.stderr.write(ccErr);
        exec(path.join(process.cwd(), executable), (runError, runOut, runErr) => {
          // Write raw: the program's own output already carries its newlines.
          process.stdout.write(runOut);
          process.stderr.write(runErr);
          if (runError) process.exitCode = runError.code ?? 1;
          cleanup();
        });
      });
    }
  }
}
