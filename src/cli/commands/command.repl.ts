import chalk from "chalk";
import path from "node:path";
import fs from "node:fs";
import { tmpdir } from "node:os";
import highlight from "cli-highlight";

import { Command } from "commander";

import { getCompilerOptions } from "../getCompilerOptions";

import { CompilerOptions, Context } from "../../compiler/Context";
import { checkBracketsBalance } from "../../compiler/utils";
import evalInScope from "../../compiler/runtime/evalInScope";

const { stdin, stdout } = process;

export function evalSource(source: string, options: CompilerOptions) {
  const file = path.resolve(tmpdir(), `tmp-llang-${Date.now()}.lisp`);
  fs.writeFileSync(file, source);

  const context = new Context(file, options);
  const js = context.compile(file);

  if (js) {
    evalInScope(js.code);
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

  const checkCode = (data: Buffer, codes: number[]) => Array.from(data).every((v, i) => codes[i] === v);
  const when = (keydata: number[], action: () => void): (data: Buffer) => void => {
    return (data) => checkCode(data, keydata) && action();
  };
  const whenString = (action: (data: string) => void): (data: Buffer) => void => {
    return (data) => data.every((v) => v > 32 && v < 126) && action(data.toString());
  };

  stdin.on("data", when([3], () => process.exit(0)));
  stdin.on("data", when([4], () => process.exit(0)));

  // Arrow-key debug logging removed
  // stdin.on("data", when([27, 91, 65], () => console.log("up")));
  // stdin.on("data", when([27, 91, 66], () => console.log("down")));
  // stdin.on("data", when([27, 91, 67], () => console.log("right")));
  // stdin.on("data", when([27, 91, 68], () => console.log("left")));

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
    stdout.write(input + "\n");

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
