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

/**
 * Every class name `ll_trap` can be called with that `ll_trap_as_error` will actually THROW.
 *
 * DERIVED, not listed, and that is the point. `ll_trap_as_error` does `ll_class_by_name(kind); if
 * (!cls) return;` and then falls through to `exit(70)` -- so a kind the emitter does not REGISTER is
 * silently fatal instead of catchable. The emitter registered `Error`/`TypeError`/`RangeError` and
 * the runtime traps with `ValueError` and `KeyError` too, so `(try m["zz"] catch e :of KeyError ...)`
 * exited 70 with the handler never running -- while THE SAME FILE plus one unrelated
 * `(new KeyError ...)` anywhere in it caught cleanly, because that mention registered the class.
 * The same source line, catchable in one program and fatal in another.
 *
 * D87 recorded this as "checked and NOT a contradiction", on evidence that generalised from
 * `RangeError` -- one of the three that happened to be baked in -- to the whole tower. Two lists,
 * one of them taught: the failure this project keeps finding. So the list is EXTRACTED from
 * `runtime.c` rather than written twice, and `test:codegen`'s existing "generated text matches
 * runtime.c" assertion makes drift red by construction.
 *
 * `OutOfMemory` and `ControlError` are excluded here because `ll_trap_as_error` excludes them BY
 * NAME -- D87 layer 3, never catchable: throwing needs an allocation, and a corrupted unwind stack
 * has nothing to unwind to.
 */
export function trappableKinds(cSource: string): string[] {
  const never = new Set(["OutOfMemory", "ControlError"]);
  const found = new Set<string>();
  for (const m of cSource.matchAll(/\bll_trap\s*\(\s*"([A-Za-z][A-Za-z0-9_]*)"/g)) {
    if (!never.has(m[1])) found.add(m[1]);
  }
  return [...found].sort();
}

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
    "/** Kinds `ll_trap` can throw as a catchable error -- see `trappableKinds` in the generator. */",
    `export const TRAPPABLE_KINDS: readonly string[] = ${JSON.stringify(trappableKinds(cSource))};`,
    "",
  ].join("\n");
}

if (require.main === module) {
  const text = fs.readFileSync(C_SOURCE, "utf8");
  fs.writeFileSync(GENERATED, render(text));
  console.log(`gen:c-runtime -- ${text.length} bytes of runtime.c -> runtimeText.generated.ts`);
}
