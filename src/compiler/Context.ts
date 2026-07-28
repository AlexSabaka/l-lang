import path from "node:path";

import { RuleSeverity, RuleValidationResultsCollection } from "./rules";
import { report, ModuleDiagnostics, TypeDiagnostics } from "./rules/diagnostics";

import {
  BaseAstTreeWalker,
  BuildDependencyGraphAstVisitor,
  BuildSymbolTableAstVisitor,
  ComptimeEvaluationAstVisitor,
  DesugarAstVisitor,
  InlineImportsAstVisitor,
  SyntaxRulesAstVisitor,
  InferTypesAstVisitor,
} from "./index";

import {
  JSTransformerAstVisitorEstree,
  LlangTransformerAstVisitor,
  CTransformer
} from "./codegen";

import { ASTNode } from "./frontend/ast";
import { HirModule, LowerAstToHirVisitor } from "./hir";
import { SymbolTable, InferredType } from "./analysis/SymbolTable";
import { AstProvider } from "./frontend/AstProvider";
import { DependencyGraph } from "./analysis/DependencyGraph";
import { ModuleResolver } from "./analysis/ModuleResolver";
import { PackageRegistry } from "./analysis/PackageRegistry";
import { formatLogMessage, getCaller } from "./utils";
import chalk from "chalk";
import { PerformanceMetrics } from "./PerformanceMetrics";

import packageJson from "../package.json";

export const VERSION = packageJson.version;

export enum LogLevel {
  Verbose,
  Debug,
  Info,
  Warning,
  Error,
}

export type CompilationStage = "parse" | "syntax" | "symbols" | "desugar" | "types" | "codegen";

export type CompilationLanguage = "llang" | "js" | "c";

export interface CompilerOptions {
  logger?: (msg: any, ...args: any[]) => void;
  minimumLogLevel: LogLevel;
  includeRuntimeShim: boolean;
  stdout: boolean;
  stdin?: boolean;
  stage: CompilationStage;
  language: CompilationLanguage;
  noMap?: boolean; // Disable source map generation
  noIIFE?: boolean; // For REPL and other use cases
  /** Extra roots for `(import "std/…")`, after the importer's own directory. `-I`. Defaults to the shipped `lib/`. */
  libPaths?: string[];
  /** Directory every emitted artifact is written to. Defaults to the input file's own directory. */
  output?: string;
  perf?: boolean; // Performance tracking flag
  strictPhases?: boolean; // Enforce strict separation between compilation phases
  validateMetadata?: boolean; // Validate completeness of type metadata before codegen
  shortErrors?: boolean; // Collapse a diagnostic onto a single line
}

export function logCompilationMessages(context: Context) {
  const all = context.results.all.sort((a, b) => a.line - b.line);

  const logLevel = {
    [RuleSeverity.Error]: LogLevel.Error,
    [RuleSeverity.Warning]: LogLevel.Warning,
    [RuleSeverity.Message]: LogLevel.Info,
    [RuleSeverity.None]: LogLevel.Info,
  };

  const { errors, warnings, messages } = all.reduce((p, c) => {
    context.log(logLevel[c.severity], c.message, getCaller(6));
    return {
      errors: p.errors + (c.severity === RuleSeverity.Error ? 1 : 0),
      warnings: p.warnings + (c.severity === RuleSeverity.Warning ? 1 : 0),
      messages: p.messages + (c.severity === RuleSeverity.Message ? 1 : 0),
    };
  }, { errors: 0, warnings: 0, messages: 0 });

  context.log(
    LogLevel.Info,
    `${chalk.red(`${errors} errors`)}, ${chalk.yellow(`${warnings} warnings`)}, ${chalk.blueBright(`${messages} messages`)}`,
    getCaller(3)
  );

  return { errors, warnings, messages } as const;
}


export class Context {
  public mainModule: string;
  public options: CompilerOptions;
  public dependencyGraph: DependencyGraph;
  public astProvider: AstProvider;
  public symbolTable: SymbolTable = new SymbolTable(undefined);

  /**
   * What type does THIS expression node have? The types stage fills it; codegen reads it.
   *
   * Empty before the types stage runs -- and empty is a legitimate answer, not an error: gradual
   * typing means codegen must still work when it knows nothing. Every consumer has to treat "no entry"
   * as "I do not know", never as "it is not a struct".
   */
  public nodeTypes: ReadonlyMap<ASTNode, InferredType> = new Map();

  /**
   * The HIR lowering's output for this compilation -- lowered function/program bodies, keyed by node
   * identity -- or undefined when the HIR path is off. Filled by the lowering stage in processModule,
   * read by the codegen body seam. A missing body is the always-correct legacy fallback.
   */
  public hir?: HirModule;

  /**
   * Register the type of a node the HIR lowering SYNTHESIZED (a temp identifier) or REBUILT (a parent
   * whose operand was hoisted to a temp). `nodeTypes` is identity-keyed, so a fresh node object has no
   * entry and the legacy emitter's copy / dispatch / primitive-fold decisions would silently degrade
   * to "unknown". The lowering's single substitution helper calls this so those decisions keep
   * answering correctly for substituted receivers and arguments. This is the one sanctioned mutation
   * seam; `nodeTypes` stays ReadonlyMap to every other reader.
   */
  public recordSynthesizedNodeType(node: ASTNode, type: InferredType): void {
    (this.nodeTypes as Map<ASTNode, InferredType>).set(node, type);
  }

  public performanceMetrics: PerformanceMetrics =
    new PerformanceMetrics();
  public results: RuleValidationResultsCollection =
    new RuleValidationResultsCollection();

  /**
   * Where `(import "std/math")` is looked up, after the importing file's own directory (D19).
   *
   * Defaults to the `lib/` the compiler ships with; `-I` appends. Never consulted for an explicitly
   * relative spec -- see ModuleResolver.
   */
  public libPaths: string[];

  /**
   * D20, the IMPORT side: importing file -> imported module -> the names it asked for.
   *
   * `null` means "the whole module". The EXPORT side (`SymbolEntry.exportName`, Sb) answers *does
   * that module offer this name?*; this answers the symmetric question, *did this file ask for it?*
   * Two questions, two codes -- LL0215 and LL0216.
   *
   * Keyed by absolute path on both sides.
   */
  private importBindings: Map<string, Map<string, Set<string> | null>> = new Map();

  /**
   * The names an import BINDS, when the local name differs from the module's -- `:as`, on either side.
   *
   * `(import { a :as b } from "m")` has to make `b` resolve, in THIS file, to the symbol `m` declares
   * as `a`. Resolution is a flat union over module root scopes keyed by DECLARED name, so there was
   * nowhere for a rename to live and both aliases were silently discarded -- `:as` parsed, was stored
   * in one case and dropped in the other, and had zero readers either way.
   *
   * This is that missing binding site. It is recorded by the dependency-graph pass (which is where an
   * import is resolved) and applied by `bindImportAliases` after this module's own scope exists, one
   * pass later. Importer -> [{ local, source, from }], absolute paths.
   */
  private importAliases: Map<string, { local: string; source: string; from: string }[]> = new Map();

  /**
   * The modules every module implicitly imports, in order. Resolved against `libPaths`, like any other.
   *
   * `std/js` is the host interop prelude (D50). `std/core/errors` joined it (F1) so the l-lang `Error`
   * tower is ambient the way the host `:extern Error` used to be -- a program writes `(throw (Error …))`
   * and `catch :of ValueError` with no import. Both are host-free leaves (the errors module uses only
   * `defclass`/`String`), so their order relative to each other does not matter; each guards its own
   * self-import.
   */
  private static readonly PRELUDES = ["std/js", "std/core/errors"];

  /**
   * Import the prelude into `file`, implicitly.
   *
   * Two things have to be true, and D20 is what makes both necessary:
   *
   *   - the prelude's names must be EXPORTED, or every one of them trips LL0215 (Sb). `std/js` has an
   *     `(export ...)` list, like any module.
   *   - the import must be RECORDED, or every one of them trips LL0216 (Sc) -- "this file's import
   *     does not bind it" -- which would be true, since no file writes the import. Hence
   *     `recordImport(..., null)`: a whole-module import, made on the file's behalf.
   *
   * Absent a `lib/` (a bare checkout, or a `-I`-less embed) `resolve` returns undefined and this is a
   * no-op: no prelude, no diagnostic, and programs that touch no JS global still compile. The prelude
   * is a library, and a missing library is not a compiler error.
   */
  /** Is `file` one of the ambient prelude modules? (Preludes are self-contained -- no cross-prelude
   *  injection, no package-sibling drag-in.) */
  private isPreludeModule(file: string): boolean {
    const here = path.resolve(file);
    return Context.PRELUDES.some((n) => {
      const p = ModuleResolver.resolve(n, file, this.libPaths);
      return !!p && path.resolve(p) === here;
    });
  }

  private injectPrelude(file: string): void {
    const here = path.resolve(file);
    const preludePaths = Context.PRELUDES.map((n) => ModuleResolver.resolve(n, file, this.libPaths))
      .filter((p): p is string => !!p)
      .map((p) => path.resolve(p));

    // A PRELUDE gets no preludes injected into it. Preludes are foundational and must not depend on
    // each other -- `std/js` and `std/core/errors` are both host-free leaves. Injecting each into the
    // other created a mutual load-in-progress cycle (LL0300 on EVERY file: std/js -> errors -> std/js
    // while errors is still loading). This also subsumes the old self-import guard.
    if (preludePaths.includes(here)) return;

    for (const name of Context.PRELUDES) {
      const prelude = ModuleResolver.resolve(name, file, this.libPaths);
      if (!prelude || path.resolve(prelude) === here) continue;
      this.recordImport(file, prelude, null);
      this.process(prelude, "types");
    }
  }

  /**
   * Modules a file needs because of SYNTAX it used, injected only when that syntax is present (D88).
   *
   * The unconditional `PRELUDES` above are the language's floor -- host interop and the ambient Error
   * tower. These are different: a numeric-tower literal DESUGARS into a construction of a stdlib type,
   * so `1/2` is a request for `std/math` in the same way `(throw (Error …))` is a request for the
   * tower. The user never writes the name, so there is nothing to warn about and nothing to remedy;
   * the literal IS the import (Sabaka's ruling). Writing the bare name `Rational` still warns.
   *
   * DEMAND-DRIVEN rather than a plain prelude, because the stdlib does not go ambient. It costs
   * nothing when unused anyway -- measured, an unused `import "std/math/rational"` emits a
   * byte-identical translation unit, because C lowers imported bodies on demand -- but the point is
   * the rule, not the bytes.
   *
   * ONE entry covers `Rational` AND `Complex`: importing a module co-processes its package siblings,
   * and both live in `std/math`.
   */
  private static readonly SYNTAX_MODULES: { module: string; nodeTypes: string[]; names: string[] }[] = [
    { module: "std/math/rational", nodeTypes: ["fraction-number", "complex-number"], names: ["Rational", "Complex"] },
  ];

  private injectSyntaxModules(file: string, ast: ASTNode): void {
    const here = path.resolve(file);
    for (const { module, nodeTypes, names } of Context.SYNTAX_MODULES) {
      if (!Context.astUsesAny(ast, nodeTypes)) continue;
      const resolved = ModuleResolver.resolve(module, file, this.libPaths);
      // A missing lib/ is not a compiler error -- same rule as the prelude. The literal then fails as
      // an ordinary undefined-name, which is the honest answer when the library is genuinely absent.
      if (!resolved || path.resolve(resolved) === here) continue;
      this.recordImport(file, resolved, null);
      this.process(resolved, "types");
      this.warnOnUnimportedSyntaxName(file, ast, module, names);
    }
  }

  /**
   * LL0245: the file wrote a syntax module's TYPE NAME, and did not import it.
   *
   * The literal implies its own import and warns about nothing -- that is the ruling. But a bare
   * `(Rational 3 4)` is a different act: it resolves ONLY because some literal elsewhere in the file
   * pulled the module in, so deleting that literal breaks a line that never mentioned it. Without a
   * literal anywhere the name does not resolve at all (`LL0210`), which is what keeps the stdlib from
   * going ambient -- so this warning covers the one genuinely fragile case and nothing else.
   *
   * Asked SYNTACTICALLY, against the parsed tree, because this runs before the symbols stage: an
   * `(import "std/math/…")` written by the author is right there in the AST.
   */
  private warnOnUnimportedSyntaxName(file: string, ast: ASTNode, module: string, names: string[]): void {
    const pkg = module.split("/").slice(0, -1).join("/");
    if (Context.astImportsFrom(ast, pkg)) return;
    for (const name of names) {
      const site = Context.findIdentifier(ast, name);
      if (site) report(this, TypeDiagnostics.SyntaxModuleNameUnimported, site, { name, module });
    }
  }

  /** Does the tree contain an `(import "<pkg>/…")`? */
  private static astImportsFrom(root: ASTNode, pkg: string): boolean {
    let found = false;
    const walk = (n: any): void => {
      if (found || !n || typeof n !== "object") return;
      if (Array.isArray(n)) { for (const c of n) walk(c); return; }
      if (n._type === "import" && typeof n.source === "string" && n.source.startsWith(pkg)) { found = true; return; }
      for (const k of Object.keys(n)) {
        if (k === "_parent" || k === "_location") continue;
        walk(n[k]);
      }
    };
    walk(root);
    return found;
  }

  /** The first `simple-identifier` in the tree spelled `name`, for the diagnostic's location. */
  private static findIdentifier(root: ASTNode, name: string): ASTNode | undefined {
    let hit: ASTNode | undefined;
    const walk = (n: any): void => {
      if (hit || !n || typeof n !== "object") return;
      if (Array.isArray(n)) { for (const c of n) walk(c); return; }
      if (n._type === "simple-identifier" && n.id === name) { hit = n as ASTNode; return; }
      for (const k of Object.keys(n)) {
        if (k === "_parent" || k === "_location") continue;
        walk(n[k]);
      }
    };
    walk(root);
    return hit;
  }

  /** Does the tree contain any node of these types? Walks the raw AST -- this runs before the HIR. */
  private static astUsesAny(root: ASTNode, types: string[]): boolean {
    const want = new Set(types);
    let found = false;
    const walk = (n: any): void => {
      if (found || !n || typeof n !== "object") return;
      if (Array.isArray(n)) { for (const c of n) walk(c); return; }
      if (typeof n._type === "string" && want.has(n._type)) { found = true; return; }
      for (const k of Object.keys(n)) {
        if (k === "_parent" || k === "_location") continue; // `_parent` would walk back up forever
        walk(n[k]);
      }
    };
    walk(root);
    return found;
  }

  /**
   * Co-process the rest of `file`'s PACKAGE (Phase M / Mb). A package is one compilation unit, so
   * processing any of its files pulls in the others -- which is what makes a name in one file visible
   * to another WITHOUT an import between them (the package-scoped boundary, in checkSymbolVisible), and
   * what makes importing the package expose the UNION of its files' exports.
   *
   * A single-file package (every stdlib package today) has no siblings, so this is a no-op until a
   * package is genuinely split. Re-entry is bounded by the same `processing`/cache guards as the
   * prelude: a package with A<->B cross-references does not loop.
   */
  private injectPackageSiblings(file: string): void {
    // A PRELUDE does not drag in its package siblings (F1). `std/core/errors` is ambient, and it lives
    // in the `std/core` package next to `string`/`types`/`async` -- co-processing those would JOIN
    // their symbols into every module's forest, where `std/core/string`'s `join`/`split` then shadow
    // the native array/string methods a program calls as `(xs.join " ")`. The errors module is
    // host-free and needs none of its siblings, so a prelude stays self-contained; an EXPLICIT import
    // of a sibling still co-processes normally (this only affects the implicit prelude path).
    if (this.isPreludeModule(file)) return;

    const registry = PackageRegistry.forPaths(this.libPaths);
    const pkgName = registry.packageOf(file);
    if (!pkgName) return;
    const pkg = registry.get(pkgName);
    if (!pkg) return;

    const self = path.resolve(file);
    for (const sibling of pkg.files) {
      if (path.resolve(sibling) === self) continue;
      // A same-package sibling reaches this file's names by BELONGING to the unit, not by name-binding;
      // recording a whole-module import keeps the dependency graph honest (codegen inlining order) and
      // leaves importBinds permissive, while the actual visibility is decided package-scoped.
      this.recordImport(file, sibling, null);
      this.process(sibling, "types");
    }
  }

  /** Called once per resolved `(import ...)`, from the dependency-graph pass. */
  recordImport(importer: string, imported: string, names: Set<string> | null): void {
    const byModule = this.importBindings.get(path.resolve(importer)) ?? new Map();

    // A module imported TWICE widens: `(import {a} from "m")` and `(import "m")` in one file means
    // the whole module. Narrowing on a re-import would make import order significant, which it is not.
    const existing = byModule.get(path.resolve(imported));
    if (existing === null) return; // already whole-module; nothing can narrow it
    const merged = names === null ? null : new Set([...(existing ?? []), ...names]);

    byModule.set(path.resolve(imported), merged);
    this.importBindings.set(path.resolve(importer), byModule);
  }

  /** Called per named symbol in an import, from the dependency-graph pass. See `importAliases`. */
  recordImportAlias(importer: string, imported: string, local: string, source: string): void {
    const key = path.resolve(importer);
    const list = this.importAliases.get(key) ?? [];
    if (list.some((a) => a.local === local && a.source === source && a.from === path.resolve(imported))) {
      return;
    }
    list.push({ local, source, from: path.resolve(imported) });
    this.importAliases.set(key, list);
  }

  /**
   * Bind each of `file`'s imported names into its own top-level scope.
   *
   * Runs after the module's symbol table is built and joined, because both halves have to exist: the
   * IMPORTED module's symbols (joined by the dependency-graph pass, one stage earlier) and THIS
   * module's root scope (the thing being written into).
   *
   * Only a name that would not already resolve is bound. An unaliased `(import { a } from "m")` needs
   * nothing -- `a` is `m`'s declared name and the flat root-union already finds it -- so the common
   * case adds no entries at all and the forest is untouched. The two cases that DO need a binding are
   * the two spellings of a rename: `:as` on the import, and `(export a :as b)` on the module, which
   * makes `b` a name no scope declares.
   *
   * A local declaration WINS: this never overwrites a name the module defines itself, because an
   * import must not silently displace a definition. That collision is a diagnostic's business (and
   * currently nobody's -- flagged, not fixed here).
   */
  private bindImportAliases(file: string, moduleSymbols: SymbolTable): void {
    const aliases = this.importAliases.get(path.resolve(file));
    if (!aliases || aliases.length === 0) return;

    for (const { local, source, from } of aliases) {
      if (moduleSymbols.hasOwnTopLevel(file, local)) continue; // a local definition owns the name
      const target = this.symbolTable.moduleOffering(from, source);
      if (!target) continue; // unresolvable -> LL0235 already reported it; do not invent a binding
      moduleSymbols.bindTopLevel(file, local, target);
    }
  }

  /**
   * Did `importer` bind `name` from `declaredIn`?
   *
   * `true` when there is no record of a direct import at all -- the symbol reached this file some
   * other way (transitively, or it is not really cross-module), and inventing a diagnostic from
   * missing information is exactly what a gradual checker must never do.
   */
  importBinds(importer: string | undefined, declaredIn: string | undefined, name: string): boolean {
    if (!importer || !declaredIn) return true;
    const names = this.importBindings.get(path.resolve(importer))?.get(path.resolve(declaredIn));
    if (names === undefined) return true; // no direct import recorded
    if (names === null) return true;      // whole module
    return names.has(name);
  }

  /**
   * Which modules does `importer` DIRECTLY import? Absolute paths (S1b).
   *
   * The same `importBindings` graph `importBinds` reads, asked the other way round: not "did this file
   * bind that name" but "which modules is this file entitled to see first". `SymbolTable` uses it to
   * prefer a directly-imported declaration over one that is merely reachable through the flat root
   * union, which is what stops a stdlib module from outranking the file next door.
   *
   * The prelude and package siblings are in here, both by way of `recordImport` -- deliberately. The
   * prelude must resolve `console`, and a package is one compilation unit whose files see each other
   * without an import between them.
   */
  directImportsOf(importer: string): Set<string> | undefined {
    const byModule = this.importBindings.get(path.resolve(importer));
    if (!byModule) return undefined;
    return new Set(byModule.keys());
  }

  private moduleCache: Map<string, { ast: ASTNode; symbols: SymbolTable }> = new Map();

  /**
   * Modules whose `process()` is currently on the stack.
   *
   * The only re-entry guard used to be `moduleCache`, but `cacheModule` runs at the END of
   * process() -- long after the symbols stage, which is where imports recurse
   * (BuildDependencyGraphAstVisitor.processFileImport -> context.process). So for A -> B -> A,
   * A was not yet cached when B re-entered it, and the recursion never terminated:
   * `RangeError: Maximum call stack size exceeded`, on every import cycle.
   */
  private processing: Set<string> = new Set();

  constructor(mainFile: string, options: CompilerOptions) {
    this.dependencyGraph = new DependencyGraph(mainFile);
    this.mainModule = path.basename(mainFile, ".lisp");
    this.options = options;
    this.astProvider = new AstProvider();
    this.libPaths = options.libPaths ?? ModuleResolver.defaultLibPaths();
    // Initialize performance metrics with enabled flag from options
    this.performanceMetrics = new PerformanceMetrics(options.perf || false);
  }

  /**
   * Get or load a module
   * Returns cached version if already loaded
   */
  getModule(filePath: string): { ast: ASTNode; symbols?: SymbolTable } | undefined {
    const fullPath = path.resolve(filePath);
    return this.moduleCache.get(fullPath);
  }

  /**
   * Cache a loaded module
   */
  cacheModule(filePath: string, ast: ASTNode, symbols: SymbolTable): void {
    const fullPath = path.resolve(filePath);
    this.moduleCache.set(fullPath, { ast, symbols });
  }

  /**
   * Helper method to count AST nodes
   */
  private countNodes(ast: ASTNode): number {
    let count = 1;
    
    // Count nodes based on AST structure
    if ('nodes' in ast && Array.isArray(ast.nodes)) {
      for (const node of ast.nodes) {
        if (node) count += this.countNodes(node);
      }
    }
    
    if ('body' in ast && Array.isArray(ast.body)) {
      for (const node of ast.body) {
        if (node) count += this.countNodes(node);
      }
    }

    // Handle other node properties that contain child nodes
    const childProps = ['condition', 'then', 'else', 'left', 'right', 'value', 'target', 'args', 'params'];
    for (const prop of childProps) {
      if (prop in ast && ast[prop as keyof ASTNode]) {
        const child = ast[prop as keyof ASTNode];
        if (Array.isArray(child)) {
          for (const node of child) {
            if (node && typeof node === 'object' && '_type' in node) {
              count += this.countNodes(node);
            }
          }
        } else if (typeof child === 'object' && child !== null && '_type' in child) {
          count += this.countNodes(child);
        }
      }
    }

    return count;
  }

  /**
   * Get performance report
   */
  public getPerformanceReport(): string {
    return this.performanceMetrics.generateReport();
  }

  log(level: LogLevel, msg: any, caller?: string) {
    if (level >= this.options.minimumLogLevel) {
      this.options.logger?.call(null, formatLogMessage(level, msg, caller));
    }
  }

  process(file: string, stopAt?: CompilationStage): { ast: ASTNode; symbols?: SymbolTable, code?: string, map?: any } {
    stopAt ??= this.options.stage || "codegen";

    const fullPath = path.resolve(file);

    // If module already processed and cached, reuse its symbol table.
    //
    // `join` is keyed by the module and idempotent, so re-joining a module already in the forest is a
    // no-op -- which is all this path ever needed. It used to call `joinWithoutDuplication`, a second
    // join keyed by `scope.node`; here the scopes ARE the same objects (cacheModule stores the very
    // SymbolTable that was joined below), so it was already a no-op, and its different key was doing
    // nothing but making it look as though the two paths needed different merge semantics.
    const cached = this.getModule(fullPath);
    if (cached) {
      this.symbolTable.join(cached.symbols!);
      return cached;
    }

    // An import cycle: this module is already being processed further up the stack. Break the
    // recursion and hand back the parsed AST.
    //
    // A cycle is NOT fatal under the module-init ruling (imports bring in definitions, not
    // execution -- see DECISIONS.md), so there is no initialisation-order hazard to guard against.
    // It is reported as a warning rather than an error: the code compiles and runs correctly, but a
    // cycle is usually a design smell and should be visible rather than silent.
    if (this.processing.has(fullPath)) {
      this.reportImportCycle(fullPath);
      return { ast: this.astProvider.getAst(fullPath) as ASTNode };
    }

    this.processing.add(fullPath);
    try {
      return this.processModule(file, fullPath, stopAt);
    } finally {
      this.processing.delete(fullPath);
    }
  }

  /** Report an import cycle. See the guard in process(). */
  private reportImportCycle(fullPath: string): void {
    const ast = this.astProvider.getAst(fullPath) as ASTNode;
    report(this, ModuleDiagnostics.ImportCycle, ast, {
      name: path.basename(fullPath),
    });
  }

  private processModule(
    file: string,
    fullPath: string,
    stopAt: CompilationStage
  ): { ast: ASTNode; symbols?: SymbolTable, code?: string, map?: any } {

    // PARSE STAGE
    this.performanceMetrics.startTimer("parse");
    let ast = this.astProvider.getAst(fullPath) as ASTNode;
    const nodeCount = this.countNodes(ast);
    this.performanceMetrics.endTimer("parse", nodeCount, undefined, { file: fullPath });

    // Store parse stage AST
    if (stopAt === "parse") {
      return { ast: ast as ASTNode };
    }

    // SYNTAX STAGE
    this.performanceMetrics.startTimer("syntax");
    const syntaxRulesVisitor = new SyntaxRulesAstVisitor(this);
    syntaxRulesVisitor.visit(ast as ASTNode);
    this.performanceMetrics.endTimer("syntax", nodeCount, (syntaxRulesVisitor as any).getVisitCount?.() || 0);

    // THIS module's errors, not the whole build's.
    //
    // It was `this.results.hasErrors` -- and `results` is a single Context-wide collection shared by
    // every module in the build. So once ANY module reported an error, every module imported AFTER it
    // returned right here, before its symbols stage, and its symbol table was never built or joined.
    //
    // The effect is a cascade of phantom diagnostics that point at the innocent file. Measured:
    //
    //     (import "./broken.lisp")     ;; has one LL0210
    //     (import "std/math")          ;; never gets its symbols built
    //     (floor 3.7)                  ;; -> LL0210 'floor' is not defined      <- A LIE
    //
    // `std/math` exports `floor` and resolves perfectly well on its own. This is exactly why the p5js
    // example appeared to have an undefined `floor`, `abs` and `map`: `p5-bindings.lisp` is imported
    // first and errors, so `std/math` and `std/enumerable` were silently never processed at all.
    //
    // A module's own errors stop that module. Somebody else's do not. Same rule as the LL0217 gate
    // below -- and the same underlying bug, which is worth naming: a Context-wide collection used as
    // a PER-MODULE signal will keep producing this shape until every such gate is per-module.
    //
    // Deliberately does NOT log here. The CLI (command.transform / command.run) logs whatever is in
    // `results` before exiting 1, and it does so for EVERY stage -- including codegen, which this
    // method never covered. Logging in both places printed every diagnostic twice.
    if (this.results.all.some((m) => m.severity === RuleSeverity.Error && m.source === fullPath)) {
      return { ast: ast as ASTNode };
    }

    // Store syntax stage AST
    if (stopAt === "syntax") {
      return { ast: ast as ASTNode };
    }

    // THE PRELUDE -- `std/js`, imported implicitly by every module.
    //
    // This is what lets `JS_GLOBALS` die. That was a hardcoded 37-name allowlist INSIDE THE TYPE
    // CHECKER, waved through untyped; `console` alone went through it 579 times. It is now an
    // ordinary l-lang library of `:extern` declarations, which is the whole point of "hide the JS":
    // interop belongs behind a library boundary, not inside the compiler.
    //
    // Injected here, before the symbols stage, so the prelude's symbols are joined before this module
    // resolves anything.
    this.injectPrelude(fullPath);
    this.injectSyntaxModules(fullPath, ast as ASTNode);

    // SYMBOLS STAGE
    this.performanceMetrics.startTimer("symbols");
    const buildDependencyGraphVisitor = new BuildDependencyGraphAstVisitor(this);
    buildDependencyGraphVisitor.visit(ast as ASTNode);

    const buildSymbolTableVisitor = new BuildSymbolTableAstVisitor(this);
    buildSymbolTableVisitor.scanAndResolve(ast as ASTNode);

    const moduleSymbols = buildSymbolTableVisitor.buildSymbolTable();
    this.symbolTable.join(moduleSymbols);

    // Let resolution ask what a file actually IMPORTED (S1b). The import graph lives here -- the
    // dependency-graph pass fills `importBindings` and `importBinds` already reads it -- so the table
    // gets a reader rather than a copy, and cannot go stale as more modules are processed. Installed
    // on BOTH tables because the checker is handed the joined one while some paths still resolve
    // against the module's own. See `SymbolTable.resolveByImportPriority`.
    const directImports = (importer: string) => this.directImportsOf(importer);
    this.symbolTable.directImportsOf = directImports;
    moduleSymbols.directImportsOf = directImports;

    // The `:as` bindings, after BOTH halves exist: the imported modules' symbols (joined by the
    // dependency-graph pass above) and this module's own root scope (just built). The join is first
    // so `moduleOffering` can see the whole forest, and the entries land in `moduleSymbols`, which
    // `join` has already placed by reference -- so the forest picks them up without a second join.
    this.bindImportAliases(fullPath, moduleSymbols);
    
    const symbolsVisitCount = ((buildDependencyGraphVisitor as any).getVisitCount?.() || 0) + 
                             ((buildSymbolTableVisitor as any).getVisitCount?.() || 0);
    this.performanceMetrics.endTimer("symbols", nodeCount, symbolsVisitCount, {
      symbolsCount: moduleSymbols.size,
      dependenciesCount: this.dependencyGraph.size
    });
    
    // Cache HERE, as soon as the symbols exist -- not at the end of the method.
    //
    // The cache is what stops a diamond (A -> B,C -> D) from re-processing D, and what makes the
    // `getModule` early-return work. Caching only at the very end meant any stopAt short of
    // "codegen" left the module uncached, which is why imported modules were compiled all the way
    // through codegen and had their output thrown away: it was the only path that cached them.
    this.cacheModule(fullPath, ast as ASTNode, moduleSymbols);

    // Store symbols stage AST and symbols
    if (stopAt === "symbols") {
      return { ast: ast as ASTNode, symbols: moduleSymbols };
    }

    // The rest of this file's PACKAGE (Mb) -- co-processed AFTER this file's own symbols are joined and
    // cached (above), so a sibling that references THIS file resolves it, and re-entry back to this file
    // hits the cache. A single-file package makes this a no-op. Only for a types+ pass: a symbols-only
    // scan does not need siblings, and running it there would recurse before the cache exists.
    this.injectPackageSiblings(fullPath);

    // STOP HERE if an import did not RESOLVE (LL0217) -- and only then.
    //
    // Why the gate exists: `results` is one Context-wide collection, so an error raised while
    // resolving an import does reach `hasErrors` and does stop codegen -- but the next gate is not
    // until after the type checker. Without this one, a single misspelled import runs TreeShake,
    // Comptime, Desugar and the whole checker against a module whose symbols were never loaded, and
    // buries the one diagnostic that explains everything under a flood of spurious LL0210s
    // ("'print' is not defined", x N). The first error should be the true one.
    //
    // Why it tests for LL0217 SPECIFICALLY, and not `hasErrors`: `hasErrors` is global and this
    // collection is shared across every module in the build. Gating on it meant that an error in any
    // IMPORTED module skipped the IMPORTING module's type checking entirely -- measured, and caught
    // only because the number moved: `99-p5js/main.lisp` went from 60 diagnostics to 44, because
    // `p5-bindings.lisp` (44 ambient-global LL0210s, a known gap) tripped the gate and main.lisp was
    // never checked at all. Sixteen diagnostics did not get fixed; they went SILENT.
    //
    // A missing symbol table is a reason to stop. Somebody else's type error is not.
    if (this.results.all.some((m) => m.code === "LL0217")) {
      return { ast: ast as ASTNode, symbols: moduleSymbols };
    }

    // const inlineImportsVisitor = new InlineImportsAstVisitor(this);
    // ast = inlineImportsVisitor.visit(ast) as ASTNode;

    // DESUGAR STAGE
    this.performanceMetrics.startTimer("desugar");
    const comptimeVisitor = new ComptimeEvaluationAstVisitor(this);
    ast = comptimeVisitor.visit(ast) as ASTNode;

    // THE DESUGARER. It has existed since v0.3.5 and was NEVER CALLED -- this stage ran TreeShake and
    // Comptime and nothing else, so codegen desugared pipelines itself and the type checker never saw
    // the rewrite. The two halves of the compiler read different programs.
    //
    // It goes HERE -- after symbols, before types. Not earlier: the symbol table indexes the
    // PRE-desugar tree, and `SymbolTable.scopeOf` finds a node's scope by climbing `_parent` back
    // into it. Rebuilding the tree before the table is built, or re-parenting it afterwards, points
    // every node at objects the scope index has never seen -- resolution then falls back silently to
    // the flat root search, and P6 is undone. Measured: 0 lexical misses when the original parent is
    // preserved, 1056 when the chain is rebuilt.
    const desugarVisitor = new DesugarAstVisitor(this, true);
    ast = desugarVisitor.visit(ast) as ASTNode;

    // The desugarer REBUILT the tree, so this module's top-level symbols now point at nodes nothing
    // downstream will ever see again (S1a / N14). Re-point them before the types stage runs, so that
    // `SymbolEntry.value` and `Context.nodeTypes` agree about which objects the module is made of.
    //
    // This is what makes an IMPORTED body carry its types: the JS inliner emits `resolved.value`, and
    // until now that was the pre-desugar copy, whose nodes were never typed. See
    // `SymbolTable.repointAfterDesugar` for the measurement and the matching rule.
    this.symbolTable.repointAfterDesugar(fullPath, ast as ASTNode);
    moduleSymbols.repointAfterDesugar(fullPath, ast as ASTNode);

    const desugaredNodeCount = this.countNodes(ast);
    const desugarVisitCount = (comptimeVisitor as any).getVisitCount?.() || 0;
    this.performanceMetrics.endTimer("desugar", desugaredNodeCount, desugarVisitCount, {
      nodesRemoved: nodeCount - desugaredNodeCount
    });
    
    // Store desugar stage AST and symbols
    if (stopAt === "desugar") {
      return { ast: ast as ASTNode, symbols: moduleSymbols };
    }

    // TYPES STAGE - Type Inference and Checking
    //
    // The JOINED table, not `moduleSymbols`.
    //
    // The checker used to be handed the module's OWN table -- its root and its nested scopes, and
    // nothing else. Imported symbols live in the other roots that `join` spliced into THIS table a
    // few lines up (and which codegen has always resolved against). So an imported function had no
    // type at all: no arity check, no argument check, and an imported class annotation degraded to
    // Unknown, where gradual typing then forgave everything downstream of it. Every call across a
    // module boundary was unchecked.
    //
    // `checkIdentifierResolves` already reached past this, with `this.context.symbolTable ??
    // this.symbolTable` and a comment explaining that asking the module-local table alone flags every
    // imported symbol as undefined. That workaround is what the whole pass needed.
    this.performanceMetrics.startTimer("types");
    const inferTypesVisitor = new InferTypesAstVisitor(this, this.symbolTable);
    inferTypesVisitor.inferTypes(ast);
    // THE TYPE CHANNEL, finally read.
    //
    // This line has existed, assigned and NEVER READ, for the whole life of the type system -- codegen
    // says so itself: "Codegen has no type information (there is no per-node type channel; `typeEnv`
    // is a dead local in Context.ts)". So codegen guessed: source-order lists of what it had visited
    // so far, a hardcoded blacklist of field names lifted from the example corpus, and a `__ll_copy`
    // wrapped around EVERY value on the chance it might be a struct.
    //
    // It can ask now.
    //
    // ACCUMULATED, NOT REPLACED (S1a / N14), and the difference is a silent wrong answer.
    //
    // `getNodeTypes()` returns the types of the module JUST inferred, and this used to assign them
    // over the channel. But imports are processed EARLIER, in the symbols stage a hundred lines up:
    // `BuildDependencyGraphAstVisitor` recurses into each imported module's `process(..., "types")`,
    // which publishes ITS node types here -- and then this line threw them away when the importer's
    // own types stage arrived. By codegen, only the root module's types existed.
    //
    // Codegen still needs them. An INLINED imported function body is lowered on demand (the body seam
    // in JSTransformerAstVisitor: "Any function body the root-module lowering never walked"), and that
    // lowering reads this channel for every decision it makes. With the map emptied of the imported
    // module's nodes, `isIntDivision` saw two untyped operands and `(/ Int Int)` -- integer division
    // by D49d -- fell back to the generic `/` shim. A function declared `-> Int` returned 3.5, on JS,
    // with no diagnostic; C re-coerced at the next typed parameter and got the right answer by
    // accident, so the two backends disagreed. The same channel loses the Int literal's BigInt-ness,
    // which is why the emitted call was `_2f(n, 2)` and not `__ll_intdiv(n, 2n)`.
    //
    // Merging is sound because the map is IDENTITY-KEYED by AST node and each module owns distinct
    // node objects: two modules cannot collide on a key, so accumulation cannot overwrite an answer,
    // only add ones that were previously missing. (A re-processed module in a reused Context yields a
    // fresh parse and therefore fresh nodes; its stale entries are unreachable rather than wrong --
    // the same property `SymbolTable.join` relies on, one key per module.)
    const inferred = inferTypesVisitor.getTypeEnvironment()?.getNodeTypes();
    if (inferred) {
      const channel = this.nodeTypes as Map<ASTNode, InferredType>;
      for (const [node, type] of inferred) channel.set(node, type);
    }

    // TypeCheckingValidatorAstVisitor used to run here. It was deleted: its dispatch built
    // `visit${node._type}` with no capitalisation at all, so even "variable" resolved to
    // `visitvariable` and matched nothing. It did zero work, and because that visit() override
    // also suppressed the inherited child-walk, it never even recursed. Its four visitors
    // duplicated InferAndCheckPass's, so repairing it would only have double-reported. The real
    // checks live in InferAndCheckPass, which has the working dispatch; their diagnostics route
    // through the centralized `report()` (rules/diagnostics) -- the type system's path to hasErrors.
    const typesVisitCount = (inferTypesVisitor as any).getVisitCount?.() || 0;
    
    this.performanceMetrics.endTimer("types", desugaredNodeCount, typesVisitCount, {
      typesInferred: (moduleSymbols as any).countTypedSymbols?.() || 0
    });
    
    // Store types stage AST and symbols (types are now part of symbol table)
    if (stopAt === "types") {
      return { ast: ast as ASTNode, symbols: moduleSymbols };
    }

    if (this.results.hasErrors) {
      // Deliberately does NOT log here. The CLI (command.transform / command.run) logs whatever
      // is in `results` before exiting 1, and it does so for EVERY stage -- including codegen,
      // which this method never covered. Logging in both places printed every diagnostic twice.
      return { ast: ast as ASTNode };
    }

    // METADATA VALIDATION (if enabled)
    if (this.options.validateMetadata) {
      this.performanceMetrics.startTimer("validate-metadata");
      const missingMetadata = moduleSymbols.validateCodegenMetadata();
      
      if (missingMetadata.length > 0) {
        this.log(LogLevel.Error, `Missing codegen metadata for symbols: ${missingMetadata.join(', ')}`);
        if (this.options.strictPhases) {
          throw new Error(`Codegen metadata validation failed. Missing metadata for ${missingMetadata.length} symbols.`);
        } else {
          this.log(LogLevel.Warning, `Codegen will attempt to proceed without complete metadata (non-strict mode)`);
        }
      } else {
        this.log(LogLevel.Debug, `Codegen metadata validation passed for ${moduleSymbols.size} symbols`);
      }
      
      this.performanceMetrics.endTimer("validate-metadata", 0, 0, {
        symbolsValidated: moduleSymbols.size,
        missingMetadata: missingMetadata.length
      });
    }

    if (stopAt !== "codegen") {
      return { ast: ast as ASTNode, symbols: moduleSymbols };
    }

    // CODEGEN STAGE
    this.performanceMetrics.startTimer("codegen");
    let transformer = undefined;
    if (this.options.language === "js") {
      // D66: the JS backend is DEPRECATED -- oracle-only, C/LLVM is the sole supported target. A
      // LogLevel.Warning (not a located LLxxxx diagnostic): the notice is compilation-global, must not
      // set hasErrors (JS still compiles) and must not churn the diagnostics snapshot. Fires once per
      // JS codegen; the test runner's no-op logger suppresses it, so the oracle stays clean.
      this.log(
        LogLevel.Warning,
        "The JavaScript backend is DEPRECATED (D66): it is retained as a differential-testing oracle " +
          "only -- no longer fixed or extended, and it may now degrade or no-op on native-only features. " +
          "Compile with --language c for the supported target (C today, LLVM next)."
      );
      // HIR LOWERING STAGE. Typed AST -> HIR side-table (destination-driven lowering), consumed by the
      // emitter's per-body seam. Runs after the type channel is published and only when the program is
      // error-free (we are past the hasErrors gate above). The HIR is the only JS codegen path now.
      this.hir = new LowerAstToHirVisitor(this).lower(ast as ASTNode);
      transformer = new JSTransformerAstVisitorEstree(this);
    } else if (this.options.language === "llang") {
      // Use l-lang to l-lang transformer
      transformer = new LlangTransformerAstVisitor(this);
    } else if (this.options.language === "c") {
      // The C backend consumes the same HIR the JS emitter does -- that is the point (the adversarial
      // probe of the HIR contract). The lowering is backend-neutral; only the pipelines differ.
      this.hir = new LowerAstToHirVisitor(this).lower(ast as ASTNode);
      transformer = new CTransformer(this);
    } else {
      throw new Error(`Unknown compilation target language: '${this.options.language}'`);
    }

    const result = transformer.compile(ast);
    const codegenVisitCount = (transformer as any).getVisitCount?.() || 0;
    
    this.performanceMetrics.endTimer("codegen", desugaredNodeCount, codegenVisitCount, {
      outputSize: result.code?.length || 0,
      language: this.options.language
    });

    return { ast: ast as ASTNode, symbols: moduleSymbols, code: result.code, map: result.map };
  }
}
