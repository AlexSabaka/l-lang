import path from "path";
import { SymbolTable } from "./SymbolTable";

interface UnitName {
  fullName: string;
  baseDir: string;
  moduleName: string;
  shortName: string;
}

export interface ImportUnit {
  name: UnitName;
  dependencies: ImportUnit[];
  symbols: SymbolTable;
}

function createImportUnit(fileName: string): ImportUnit {
  const fullName = path.resolve(fileName);
  const shortName = path.basename(fileName);
  const moduleName = shortName.split(".")[0];
  const baseDir = path.dirname(fullName);
  return {
    name: {
      fullName,
      baseDir,
      moduleName,
      shortName,
    },
    dependencies: [],
    symbols: new SymbolTable(),
  };
}

export class DependencyGraph {
  public rootUnit: ImportUnit;

  constructor(public rootFile: string) {
    this.rootUnit = createImportUnit(rootFile);
  }

  add(file: string, parentFile: string) {
    const fullParentName = path.resolve(parentFile);
    const parentUnit = this.find(fullParentName);
    if (!parentUnit) {
      throw new Error(
        `File ${file} tried to be loaded from ${parentFile} but parent file not found in dependency graph`
      );
    }

    parentUnit.dependencies.push(createImportUnit(file));
  }

  find(fileName: string): ImportUnit | undefined {
    const fullName = path.resolve(fileName);
    const searchImportUnit = (unit: ImportUnit): ImportUnit | undefined => {
      return unit.name.fullName !== fullName
        ? unit.dependencies.find(searchImportUnit)
        : unit;
    };

    return searchImportUnit(this.rootUnit);
  }
}
