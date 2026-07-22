// The C runtime, shipped the way the JS shim is shipped: as TEXT prepended to every compiled
// program (single self-contained translation unit).
//
// `runtime/runtime.c` is the source of truth and stays a real `.c` file on purpose -- an editor and
// a C compiler can both read it, which is why it is not written as a TypeScript string literal.
//
// It used to be read with `fs.readFileSync(path.join(__dirname, "runtime", "runtime.c"))`, and that
// was broken in the SHIPPED package: `tsc` does not copy `.c` files, so `npm run build` left
// whatever `dist/` already contained. Not a missing file -- a STALE one, which is worse. A published
// compiler would have silently built every C program against a pre-Phase-F runtime (no codepoint
// surface, the 256-slot cycle set, the byte leaks) while the test suite, which runs from source via
// ts-node, stayed green over all of it.
//
// So the text now comes from a GENERATED module (`npm run gen:c-runtime`, which `build` runs first).
// The compiled package has no runtime file dependency at all -- no `__dirname`, no fs, nothing for a
// bundler to lose -- and `test:codegen` asserts the generated module still matches `runtime.c`, so
// drift is a red test rather than a silent ship. That is the property a `cp` step in the build
// script cannot have: nothing in the suite can check a `dist/` that may not exist yet.
import { C_RUNTIME_TEXT } from "./runtime/runtimeText.generated";

export class CRuntimeProvider {
  static runtimeText(): string {
    return C_RUNTIME_TEXT;
  }
}
