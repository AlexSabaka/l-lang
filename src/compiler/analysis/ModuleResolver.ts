import * as fs from "node:fs";
import * as path from "node:path";
import { PackageRegistry } from "./PackageRegistry";

/**
 * Turning `(import "…")` into a file on disk. The ONLY place that does.
 *
 * Before Sc there was no resolver -- resolution was one line, `path.resolve(dirname(importer),
 * literal)`, open-coded in three places (the live one in BuildDependencyGraphAstVisitor, a defensive
 * re-resolve in DependencyGraph, and a dead copy in the disabled InlineImportsAstVisitor). There was
 * no search path, no extension inference, and NO FAILURE PATH: a missing import reached
 * `fs.readFileSync` unguarded and came back as a raw Node ENOENT stack trace.
 *
 * `std/` only ever resolved because every importing file happened to sit one directory above it.
 */
export class ModuleResolver {
  static readonly EXTENSION = ".lisp";

  /**
   * Where the compiler keeps the stdlib it ships with (D19).
   *
   * Found by ASCENDING until a directory holds a `lib/`, rather than by counting `..` from
   * `__dirname` -- because the two layouts do not agree on depth. Under ts-node this file is
   * `src/compiler/analysis/`; compiled, `outDir` puts it at `src/dist/compiler/analysis/`. A fixed
   * `../../..` is correct in exactly one of those, and the failure is invisible: the stdlib simply
   * stops resolving, in one of the two ways the project is run.
   */
  static defaultLibPaths(): string[] {
    const isDir = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory();

    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, "lib");
      if (isDir(candidate)) return [candidate];

      // THE ASCENT IS BOUNDED AT THE PROJECT ROOT, and that bound is load-bearing.
      //
      // An unbounded climb reaches `/` -- and `/lib` EXISTS on Linux. The compiler would have
      // silently adopted the operating system's shared-library directory as its standard library:
      // on one platform, with no error, and only when its own lib/ was missing. That is not a
      // tidiness concern; it is the difference between "the stdlib was not found" and "the stdlib
      // is /lib".
      //
      // `.git`, not `package.json`: this project's package.json lives in `src/`, one level BELOW
      // the repo root where `lib/` sits, so stopping at the package would stop one level too soon.
      if (isDir(path.join(dir, ".git"))) break;

      const parent = path.dirname(dir);
      if (parent === dir) break; // filesystem root
      dir = parent;
    }

    return [];
  }

  /**
   * Resolve `spec` as written in `(import "spec")`, from `importerFile`.
   *
   * Order, and the reason for it:
   *
   *   1. the IMPORTER'S OWN DIRECTORY  -- every one of the corpus's imports lands here, and it must
   *                                       keep landing here. A file's own neighbours win.
   *   2. the search paths              -- the shipped `lib/`, then any `-I` roots.
   *
   * Importer-first is a deliberate anti-shadowing rule: if the search path were consulted first, a
   * project's own `std/io.lisp` sitting next to its source would be silently displaced by the
   * compiler's. A name resolves to the thing nearest to whoever asked.
   *
   * An EXPLICITLY relative spec (`./x`, `../x`) or an absolute one never consults the search path at
   * all. "./config" means the one next to me; it is not a request the stdlib may answer.
   *
   * Each root is tried bare and with `.lisp` appended, so `(import "std/math")` and
   * `(import "std/math.lisp")` both work -- the corpus writes the second, D19 wants the first.
   */
  static resolve(spec: string, importerFile: string, searchPaths: string[] = []): string | undefined {
    const explicitlyRelative =
      spec.startsWith("./") || spec.startsWith("../") || path.isAbsolute(spec);

    const tryPath = (root: string): string | undefined => {
      for (const form of [spec, spec + ModuleResolver.EXTENSION]) {
        const candidate = path.resolve(root, form);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      }
      return undefined;
    };

    // 1. The IMPORTER'S OWN DIRECTORY, always first (the anti-shadowing rule: a file's neighbours win,
    //    so a project's own `std/io.lisp` is never displaced by the shipped one). A relative spec stops
    //    here -- "./config" is not a request the search path or a package may answer.
    const nearby = tryPath(path.dirname(importerFile));
    if (nearby || explicitlyRelative) return nearby;

    // 2. A PACKAGE by name (Phase M). At search-path priority -- after the importer's neighbours, before
    //    a bare path scan -- so `(import "std/linq")` finds the package `std/linq` wherever its manifest
    //    lives. Additive: an empty registry (no manifests) resolves nothing and falls through unchanged.
    const viaPackage = PackageRegistry.forPaths(searchPaths).resolve(spec);
    if (viaPackage) return viaPackage;

    // 3. A bare PATH under a search root -- the fallback for files that are not (yet) in any package.
    for (const root of searchPaths) {
      const hit = tryPath(root);
      if (hit) return hit;
    }

    return undefined;
  }
}
