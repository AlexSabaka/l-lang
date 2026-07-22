#!/usr/bin/env ts-node
/**
 * Regenerate `runtimeText.generated.ts` from `runtime.c`.
 *
 * `runtime.c` is the source of truth and stays a real `.c` file on purpose -- an editor and a C
 * compiler can both read it, which is the whole reason it is not a TypeScript string literal.
 *
 * But it was reaching the compiled output by `fs.readFileSync(__dirname + "/runtime/runtime.c")`,
 * and `tsc` does not copy `.c` files. So `npm run build` left whatever `dist/` happened to already
 * contain -- a STALE runtime, not a missing one. A published compiler would have silently built
 * every C program against a pre-Phase-F runtime (no codepoints, the 256-slot cycle set, the byte
 * leaks) while the test suite, which runs from source via ts-node, stayed green. Silence is the
 * failure mode this project spends most of its effort eliminating.
 *
 * So the text is generated into a `.ts` module instead: `tsc` compiles it like any other file, the
 * emitted package has no runtime file dependency at all, and `test:codegen` asserts the generated
 * module still matches `runtime.c` -- which makes drift a RED TEST rather than a silent ship. That
 * is the property a `cp` step in the build script cannot have, because nothing in the suite can
 * check a `dist/` that may not exist.
 *
 * JSON.stringify does the escaping. Not a template literal: `runtime.c` contains backticks in its
 * comments, and this session broke the JS-side shim on exactly that hazard five separate times.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const HERE = __dirname;
export const C_SOURCE = path.join(HERE, "runtime.c");
export const GENERATED = path.join(HERE, "runtimeText.generated.ts");

export function render(cSource: string): string {
  return [
    "// GENERATED FILE -- do not edit.",
    "//",
    "// Produced from `runtime.c` by `gen-runtime-text.ts` (npm run gen:c-runtime, which `build` runs).",
    "// `runtime.c` is the source of truth; edit that and rebuild. `test:codegen` fails if the two",
    "// drift, so this file cannot silently go stale the way the old `dist/` copy did.",
    "",
    `export const C_RUNTIME_TEXT: string = ${JSON.stringify(cSource)};`,
    "",
  ].join("\n");
}

if (require.main === module) {
  const text = fs.readFileSync(C_SOURCE, "utf8");
  fs.writeFileSync(GENERATED, render(text));
  console.log(`gen:c-runtime -- ${text.length} bytes of runtime.c -> runtimeText.generated.ts`);
}
