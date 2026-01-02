import fs from "node:fs";
import path from "node:path";

import { Command } from "commander";

function walkDir(dir: string, callback: (filePath: string) => void) {
  if (!fs.existsSync(dir)) {
    return;
  }

  try {
    fs.readdirSync(dir).forEach((f) => {
      const dirPath = path.join(dir, f);
      if (fs.existsSync(dirPath)) {
        const isDirectory = fs.statSync(dirPath).isDirectory();
        if (isDirectory) {
          walkDir(dirPath, callback);
        } else {
          callback(dirPath);
        }
      }
    });
  } catch (e) {
    // Ignore errors when reading directory
  }
}

export function clean(folder: string, command: Command) {
  const targetFolder = path.resolve(folder);

  if (!fs.existsSync(targetFolder)) {
    console.error(`Folder not found: ${targetFolder}`);
    process.exit(1);
  }

  let cleanedCount = 0;

  walkDir(targetFolder, (filePath) => {
    if (!filePath.endsWith(".lisp")) return;

    // For each .lisp file, delete associated compiled files
    const basePath = filePath.replace(".lisp", "");
    const filesToDelete = [
      `${basePath}.js`,
      `${basePath}.lisp.map`,
      `${basePath}.parsed.json`,
      `${basePath}.symbols.json`,
      `${basePath}.syntax.json`,
      `${basePath}.desugar.json`,
      `${basePath}.types.json`,
    ];

    filesToDelete.forEach((fileToDelete) => {
      if (fs.existsSync(fileToDelete)) {
        fs.unlinkSync(fileToDelete);
        console.log(`Deleted: ${fileToDelete}`);
        cleanedCount++;
      }
    });
  });

  console.log(`\nCleaned ${cleanedCount} files.`);
}

