import path from "node:path";

import { RuleSeverity, RuleValidationResultsCollection } from "./rules";
import { report, ModuleDiagnostics } from "./rules/diagnostics";

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
  LlangTransformerAstVisitor
} from "./codegen";

import { ASTNode } from "./frontend/ast";
import { SymbolTable, InferredType } from "./analysis/SymbolTable";
import { AstProvider } from "./frontend/AstProvider";
import { DependencyGraph } from "./analysis/DependencyGraph";
import { ModuleResolver } from "./analysis/ModuleResolver";
import { PackageRegistry } from "./analysis/PackageRegistry";
import { formatLogMessage, getCaller } from "./utils";
import chalk from "chalk";
import { PerformanceMetrics } from "./PerformanceMetrics";

export const VERSION = "0.0.1";

export enum LogLevel {
  Verbose,
  Debug,
  Info,
  Warning,
  Error,
}

export type CompilationStage = "parse" | "syntax" | "symbols" | "desugar" | "types" | "codegen";

export type CompilationLanguage = "llang" | "js";

export interface CompilerOptions {
  logger?: (msg: any, ...args: any[]) => void;
  minimumLogLevel: LogLevel;
  includeRuntimeShim: boolean;
  stdout: boolean;
  stage: CompilationStage;
  language: CompilationLanguage;
  noIIFE?: boolean; // For REPL and other use cases
  /** Extra roots for `(import "std/…")`, after the importer's own directory. `-I`. Defaults to the shipped `lib/`. */
  libPaths?: string[];
  perf?: boolean; // Performance tracking flag
  strictPhases?: boolean; // Enforce strict separation between compilation phases
  validateMetadata?: boolean; // Validate completeness of type metadata before codegen
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

  /** The module every module implicitly imports. Resolved against `libPaths`, like any other. */
  private static readonly PRELUDE = "std/js";

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
  private injectPrelude(file: string): void {
    const prelude = ModuleResolver.resolve(Context.PRELUDE, file, this.libPaths);
    if (!prelude) return;

    // The prelude does not import itself. Without this the recursion is unbounded -- and `processing`
    // would merely turn it into a silent no-op rather than a stack overflow, which is worse.
    if (path.resolve(prelude) === path.resolve(file)) return;

    this.recordImport(file, prelude, null);
    this.process(prelude, "types");
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

    // SYMBOLS STAGE
    this.performanceMetrics.startTimer("symbols");
    const buildDependencyGraphVisitor = new BuildDependencyGraphAstVisitor(this);
    buildDependencyGraphVisitor.visit(ast as ASTNode);

    const buildSymbolTableVisitor = new BuildSymbolTableAstVisitor(this);
    buildSymbolTableVisitor.scanAndResolve(ast as ASTNode);

    const moduleSymbols = buildSymbolTableVisitor.buildSymbolTable();
    this.symbolTable.join(moduleSymbols);
    
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
    this.nodeTypes =
      inferTypesVisitor.getTypeEnvironment()?.getNodeTypes() ?? new Map();

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
      // Use the ESTree-based transformer (default)
      transformer = new JSTransformerAstVisitorEstree(this);
    } else if (this.options.language === "llang") {
      // Use l-lang to l-lang transformer
      transformer = new LlangTransformerAstVisitor(this);
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
