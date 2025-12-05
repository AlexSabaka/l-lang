import path from "path";
import { SymbolTable } from "./SymbolTable";
import { Context } from "./Context";

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

function createImportUnit(fileName: string, context?: Context): ImportUnit {
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
    symbols: context?.symbolTable ?? new SymbolTable(undefined),
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

  add(file: string, parentFile: string, context: Context) {
    const fullParentName = path.resolve(parentFile);
    const parentUnit = this.find(fullParentName);
    if (!parentUnit) {
      throw new Error(
        `File ${file} tried to be loaded from ${parentFile} but parent file not found in dependency graph`
      );
    }

    const resolvedFile = path.join(path.dirname(fullParentName), file);
    const fullName = path.resolve(resolvedFile);

    // Check module cache first
    let importUnit = this.moduleCache.get(fullName);
    
    if (!importUnit) {
      // Module not yet loaded, create it
      importUnit = createImportUnit(fullName, context);
      // Add to cache
      this.moduleCache.set(fullName, importUnit);
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

    // Fallback: search tree (for backwards compatibility)
    const searchImportUnit = (unit: ImportUnit): ImportUnit | undefined => {
      return unit.location.fullName !== fullName
        ? unit.dependencies.find(searchImportUnit)
        : unit;
    };

    return searchImportUnit(this.rootUnit);
  }

  /**
   * Iterate through all loaded modules in dependency order
   * Returns unique modules in reverse topological order
   */
  iterate() {
    return [...new Set(this.iterateRec(this.rootUnit).reverse())];
  }

  private iterateRec(dep: ImportUnit): string[] {
    const files: string[] = [ dep.location.fullName ];
    for (let d of dep.dependencies) {
      files.push(...this.iterateRec(d));
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
