import { LogLevel } from "./compiler/CompilationContext";
import { default as compile } from "./compiler/compile";
import { globalScope, evalInScope } from "./lib/std";

import { appendFileSync } from "fs";
function logToFile(msg: any, args: any[]) {
  appendFileSync("./compilation-log.jsonl", `${JSON.stringify({ msg, args })}\n`, { encoding: "utf-8" });
}

const js = compile("./../examples/test003.lisp", {
  logger: {
    level: LogLevel.Verbose,
    // log: logToFile,
    log: console.log,
  }
});

console.log("––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––");

console.log(js);

console.log("––––––––––––––––––––––––––––––––––––––––––––––––––––––––––––");

evalInScope(js, globalScope);
