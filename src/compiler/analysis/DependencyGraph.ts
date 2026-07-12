import path from "path";
import { SymbolTable } from "./SymbolTable";
import { Context } from "../Context";

interface UnitName {
  fullName: string;
  baseDir: string;
  moduleName: string;
  shortName: string;
}

export interface ImportUnit {
  location: UnitName;
  dependencies: ImportUnit[];
  symbols: SymbolTable;
}

function createImportUnit(fileName: string): ImportUnit {
  const fullName = path.resolve(fileName);
  const shortName = path.basename(fileName);
  const moduleName = shortName.split(".")[0];
  const baseDir = path.dirname(fullName);
  return {
    location: {
      fullName,
      baseDir,
      moduleName,
      shortName,
    },
    dependencies: [],
    // Each import unit should have its own symbol table. The
    // dependency graph will consult the Context module cache for
    // processed module symbols when available.
    symbols: new SymbolTable(undefined),
  };
}

/**
 * DependencyGraph with Module Cache
 * 
 * Previously: Stored dependencies as a tree, allowing the same module
 *   to be loaded and processed multiple times.
 * 
 * Now: Uses a flat module cache (Map<path, ImportUnit>) to ensure each
 *   module is loaded only once. Dependencies are still tracked but resolved
 *   from the cache to avoid duplication.
 */
export class DependencyGraph {
  public rootUnit: ImportUnit;
  private moduleCache: Map<string, ImportUnit> = new Map();

  constructor(public rootFile: string) {
    this.rootUnit = createImportUnit(rootFile);
    // Cache the root unit
    this.moduleCache.set(this.rootUnit.location.fullName, this.rootUnit);
  }

  /**
   * Get the total number of cached modules
   */
  get size(): number {
    return this.moduleCache.size;
  }

  add(file: string, parentFile: string, context: Context) {
    const fullParentName = path.resolve(parentFile);
    let parentUnit = this.find(fullParentName);
    
    // If parent doesn't exist in the graph yet, create it
    // This happens when a file is being processed and its imports are being recorded
    if (!parentUnit) {
      parentUnit = createImportUnit(fullParentName);
      this.moduleCache.set(fullParentName, parentUnit);
    }

    // path.resolve, NOT path.join. The caller (BuildDependencyGraphAstVisitor.processFileImport)
    // has already resolved `file` against the importing file's directory, so it arrives ABSOLUTE.
    // path.join does not treat an absolute second argument as a reset, so joining it to the parent
    // directory produced `/a/b/c/a/b/c/lib.lisp` -- a path that does not exist. Every non-root node
    // in the graph was keyed by garbage. path.resolve handles both the absolute and relative cases:
    // an absolute argument resets, a relative one resolves against the parent's directory.
    const fullName = path.resolve(path.dirname(fullParentName), file);

    // First, check whether the Context already has the module cached
    // (Context keeps parsed AST + symbol table for processed modules).
    const cached = context.getModule(fullName);

    // Check dependency-graph cache next
    let importUnit = this.moduleCache.get(fullName);

    if (!importUnit) {
      // Create a new import unit placeholder
      importUnit = createImportUnit(fullName);
      // If the Context has already processed this module, attach its
      // symbol table to the import unit so consumers see the final
      // module symbols.
      if (cached) {
        importUnit.symbols = cached.symbols!;
      }

      // Add to dependency-graph cache
      this.moduleCache.set(fullName, importUnit);
    } else {
      // If an import unit exists but Context has processed the module
      // since then, prefer the Context symbol table (keeps single source).
      if (cached) {
        importUnit.symbols = cached.symbols!;
      }
    }

    // Add to parent's dependencies (if not already present)
    if (!parentUnit.dependencies.some(dep => dep.location.fullName === fullName)) {
      parentUnit.dependencies.push(importUnit);
    }
  }

  find(fileName: string): ImportUnit | undefined {
    const fullName = path.resolve(fileName);
    
    // Check cache first for O(1) lookup
    if (this.moduleCache.has(fullName)) {
      return this.moduleCache.get(fullName);
    }

    // Fallback: search the tree.
    //
    // This used `unit.dependencies.find(searchImportUnit)` -- but Array.find takes a BOOLEAN
    // predicate, and searchImportUnit returns an ImportUnit|undefined. Any truthy unit satisfied
    // it, so `find` returned the first DIRECT CHILD rather than the matching descendant. Wrong at
    // any depth beyond one. Also guards against cycles, which the graph now permits.
    const seen = new Set<ImportUnit>();
    const search = (unit: ImportUnit): ImportUnit | undefined => {
      if (seen.has(unit)) return undefined;
      seen.add(unit);
      if (unit.location.fullName === fullName) return unit;
      for (const dep of unit.dependencies) {
        const hit = search(dep);
        if (hit) return hit;
      }
      return undefined;
    };

    return search(this.rootUnit);
  }

  /**
   * Iterate through all loaded modules in dependency order
   * Returns unique modules in reverse topological order
   */
  iterate() {
    return [...new Set(this.iterateRec(this.rootUnit).reverse())];
  }

  private iterateRec(dep: ImportUnit, seen: Set<ImportUnit> = new Set()): string[] {
    if (seen.has(dep)) return [];
    seen.add(dep);
    const files: string[] = [ dep.location.fullName ];
    for (let d of dep.dependencies) {
      files.push(...this.iterateRec(d, seen));
    }
    return files;
  }

  /**
   * Get all modules in the cache (for analysis/debugging)
   */
  getModules(): ImportUnit[] {
    return Array.from(this.moduleCache.values());
  }

  /**
   * Get module count (for optimization verification)
   */
  getModuleCount(): number {
    return this.moduleCache.size;
  }
}
