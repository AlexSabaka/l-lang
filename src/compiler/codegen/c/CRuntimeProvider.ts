// The C runtime, shipped the way the JS shim is shipped: as TEXT prepended to every compiled
// program (single self-contained translation unit). Unlike the JS RuntimeProvider the source lives
// in a real .c file (runtime/runtime.c) for editor/compiler support, read once per process here.

import * as fs from "node:fs";
import * as path from "node:path";

export class CRuntimeProvider {
  private static cached: string | undefined;

  static runtimeText(): string {
    if (this.cached === undefined) {
      this.cached = fs.readFileSync(path.join(__dirname, "runtime", "runtime.c"), "utf8");
    }
    return this.cached;
  }
}
