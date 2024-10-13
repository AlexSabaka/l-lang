import chalk from "chalk";
import { LogLevel } from "./compiler/CompilationContext";
import { default as compile } from "./compiler/compile";
import { globalScope, evalInScope } from "./lib/std";

import { highlight } from "cli-highlight";

const js = compile("./../examples/test007.lisp", {
  logger: {
    level: LogLevel.Verbose,
    log: console.log,
  },
});

console.log(chalk.underline.dim(" ".repeat(process.stdout.columns)));

if (js) {
  console.log(highlight(js!, { language: "javascript" }));
  console.log(chalk.underline.dim(" ".repeat(process.stdout.columns)));
  evalInScope(js, globalScope);
}
