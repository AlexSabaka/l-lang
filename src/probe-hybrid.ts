import { Context, CompilerOptions, LogLevel } from "./compiler/Context";
import * as fs from "node:fs";

const SRC = "/tmp/hybrid.lisp";
fs.writeFileSync(SRC, `((let g (fn [] -> Int (return 5))))\n`);

function shapeOf(stage: any): string {
  const opts = {
    minimumLogLevel: LogLevel.Error,
    logger: () => {},
    includeRuntimeShim: false,
    stdout: false,
    stage,
    language: "js",
  } as unknown as CompilerOptions;
  const ctx = new Context(SRC, opts);
  const res: any = ctx.process(SRC, stage);
  let found = "not found";
  const walk = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (n._type === "list" || n._type === "function") {
      const keys = Object.keys(n).filter((k) => !k.startsWith("_"));
      if (keys.includes("params") || keys.includes("body")) {
        found = `_type=${n._type} keys=[${keys.join(",")}]`;
        return;
      }
    }
    for (const k of Object.keys(n)) {
      if (k.startsWith("_")) continue;
      const v = n[k];
      (Array.isArray(v) ? v.flat(9) : [v]).forEach(walk);
    }
  };
  walk(res.ast);
  return found;
}

for (const stage of ["parse", "syntax", "symbols", "desugar"]) {
  console.log(`${stage.padEnd(8)} -> ${shapeOf(stage)}`);
}
