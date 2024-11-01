import chalk from "chalk";
import path from "node:path";
import fs from "node:fs";
import { tmpdir } from "node:os";

import { RuleSeverity } from "./rules";

import { JSCompilerAstVisitor } from "./visitors";

import * as lib from "./lib";

import { ASTNode } from "./ast";
import highlight from "cli-highlight";
import { CompilerOptions, Context, LogLevel } from "./Context";
import { checkBracketsBalance, getCaller } from "./utils";
import { Command } from "commander";

const { stdin, stdout } = process;

function printMessages(context: Context) {
  const all = context.results.all.sort((a, b) => a.line - b.line);

  const logLevel = {
    [RuleSeverity.Error]: LogLevel.Error,
    [RuleSeverity.Warning]: LogLevel.Warning,
    [RuleSeverity.Message]: LogLevel.Info,
    [RuleSeverity.None]: LogLevel.Info,
  };

  let errors = 0,
    warnings = 0,
    messages = 0;
  all.forEach((error) => {
    context.log(logLevel[error.severity], error.message);

    errors += error.severity === RuleSeverity.Error ? 1 : 0;
    warnings += error.severity === RuleSeverity.Warning ? 1 : 0;
    messages += error.severity === RuleSeverity.Message ? 1 : 0;
  });

  context.log(
    LogLevel.Info,
    chalk.red(`${errors} errors`) +
      ", " +
      chalk.yellow(`${warnings} warnings`) +
      ", " +
      chalk.blueBright(`${messages} messages`),
    getCaller(3)
  );

  return { errors, warnings, messages } as const;
}

export function parse(file: string, command: Command) {
  const options = getCompilerOptions(command, file, ".ast.json");
  const context = new Context(file, options);

  context.process(file);

  const { errors } = printMessages(context);

  if (errors > 0) {
    return;
  }

  const ast = context.astProvider.getAst(file) as ASTNode;

  if (options.outputFile) {
    fs.writeFileSync(
      options.outputFile,
      JSON.stringify(
        ast,
        (k, v) => (k === "_location" || k === "_parent" ? undefined : v),
        2
      )
    );
  } else {
    context.log(LogLevel.Info, ast);
  }
}

function compileJS(file: string, options: CompilerOptions) {
  const context = new Context(file, options);
  context.process(file);
  const { errors } = printMessages(context);
  if (errors > 0) {
    return;
  }
  const jsCompilerVisitor = new JSCompilerAstVisitor(context);
  const js = jsCompilerVisitor.compile(
    context.astProvider.getAst(file) as ASTNode
  );
  return js;
}

export function compile(file: string, command: Command) {
  const options = getCompilerOptions(command, file, ".js");
  const js = compileJS(file, options);
  if (js && options.outputFile) {
    fs.writeFileSync(options.outputFile, js.code);
    fs.writeFileSync(options.outputFile + ".map", js.map.toString());
  }
}

export function evalFile(
  file: string,
  command: Command) {
  const options = getCompilerOptions(command, file);
  const js = compileJS(file, options);

  if (js) {
    if (options.minimumLogLevel < LogLevel.Debug) {
      console.log(chalk.underline.dim(" ".repeat(stdout.columns)));
      console.log(highlight(js.code, { language: "javascript" }));
      console.log(chalk.underline.dim(" ".repeat(stdout.columns)));
    }

    lib.evalInScope(js.code, lib.globalScope);
  }
}

export function evalSource(source: string, options: CompilerOptions) {
  const file = path.resolve(tmpdir(), `tmp-llang-${Date.now()}.lisp`);
  fs.writeFileSync(file, source);

  const js = compileJS(file, options);

  if (js) {
    lib.evalInScope(js.code, lib.globalScope);
  }

  fs.rmSync(file);
}

export function repl(command: Command) {
  const options = getCompilerOptions(command);

  let input = "";
  let indent = 0;
  stdin.setRawMode(true);
  stdin.resume();
  stdout.write("> ");

  const checkCode = (data: Buffer, ...codes: number[]) => Array.from(data).every((v, i) => codes[i] === v);
  const when = (keydata: number[], action: () => void): (data: Buffer) => void => {
    return (data) => checkCode(data, ...keydata) && action();
  };
  const whenString = (action: (data: string) => void): (data: Buffer) => void => {
    return (data) => data.every((v) => v > 32 && v < 126) && action(data.toString());
  };

  stdin.on("data", when([3], () => process.exit(0)));
  stdin.on("data", when([4], () => process.exit(0)));

  stdin.on("data", when([27, 91, 65], () => console.log("up")));
  stdin.on("data", when([27, 91, 66], () => console.log("down")));
  stdin.on("data", when([27, 91, 67], () => console.log("right")));
  stdin.on("data", when([27, 91, 68], () => console.log("left")));

  stdin.on("data", when([127], () => {
    input = input.slice(0, -1);
    stdout.write("\b \b");
  }));

  stdin.on("data", whenString((data) => {
    const str = data.toString();
    input += str;
    stdout.write(str);
    return;
  }));

  stdin.on("data", when([13], () => {
    stdout.write("\n");
    console.log(input);

    const balance = checkBracketsBalance(input);
    if (typeof balance === "number") {
      indent = 4 * balance;
    } else {
      indent = 0;
    }
    if (indent > 0) {
      stdout.write(chalk.dim(".".repeat(indent)));
      return;
    }
    if (input === "") {
      stdout.write("> ");
      return;
    }

    try {
      evalSource(input, options);
    } catch (e) {
      console.error(e);
    }

    input = "";
    stdout.write("> ");
  }));
}

export interface CLICompilerOptions {
  output?: string;
  watch?: boolean;
  debug?: boolean;
  silent?: boolean;
  verbose?: boolean;
  version?: boolean;
  logLevel?: LogLevel;
  logFile?: string;
}

export function createFileLogger(file: string) {
  const stream = fs.createWriteStream(file, { flags: "a" });
  return (...data: any[]) => stream.write(`${data.join(" ")}\n`);
}

export function getCompilerOptions(
  command: Command,
  input?: string,
  ext?: string
): CompilerOptions {
  const opts = command.opts() as CLICompilerOptions;
  const logLevel =
    opts.logLevel ?? opts.verbose
      ? LogLevel.Verbose
      : opts.debug
      ? LogLevel.Debug
      : opts.silent
      ? LogLevel.Error
      : LogLevel.Warning;
  return {
    minimumLogLevel: logLevel,
    logger: opts.logFile ? createFileLogger(opts.logFile) : console.log,
    outputFile: opts.output ?? input?.replace(/\.\w+$/, ext ?? ".js"),
  };
}
