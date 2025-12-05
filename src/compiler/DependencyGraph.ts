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

export class DependencyGraph {
  public rootUnit: ImportUnit;

  constructor(public rootFile: string) {
    this.rootUnit = createImportUnit(rootFile);
  }

  add(file: string, parentFile: string, context: Context) {
    const fullParentName = path.resolve(parentFile);
    const parentUnit = this.find(fullParentName);
    if (!parentUnit) {
      throw new Error(
        `File ${file} tried to be loaded from ${parentFile} but parent file not found in dependency graph`
      );
    }

    parentUnit.dependencies.push(createImportUnit(path.join(this.rootUnit.location.baseDir, file), context));
  }

  find(fileName: string): ImportUnit | undefined {
    const fullName = path.resolve(fileName);
    const searchImportUnit = (unit: ImportUnit): ImportUnit | undefined => {
      return unit.location.fullName !== fullName
        ? unit.dependencies.find(searchImportUnit)
        : unit;
    };

    return searchImportUnit(this.rootUnit);
  }

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
}
