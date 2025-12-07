import * as ast from "../../frontend/ast";
import { Context } from "../../Context";
import { BaseAstVisitor } from "../../BaseAstVisitor";
import path from "node:path";

/**
 * InlineImportsAstVisitor - Processes imports and inlines exported definitions
 * 
 * This visitor:
 * 1. Finds all import statements
 * 2. Gets the AST of the imported files
 * 3. Extracts exported symbols and their definitions
 * 4. Inlines them into the program's AST
 * 5. Removes the import statements
 */
export class InlineImportsAstVisitor extends BaseAstVisitor {
  private importedDefinitions: ast.ASTNode[] = [];
  private importsToRemove: number[] = [];

  visitProgram(node: ast.ProgramNode): ast.ProgramNode {
    this.importedDefinitions = [];
    this.importsToRemove = [];

    // Process all imports and collect definitions
    for (let i = 0; i < node.program.length; i++) {
      const item = node.program[i];
      if (item && item._type === "list") {
        const listNode = item as ast.ListNode;
        if (listNode.nodes && listNode.nodes.length > 0) {
          const firstNode = listNode.nodes[0];
          if (firstNode && firstNode._type === "import") {
            this.processImportNode(firstNode as ast.ImportNode, node._location.source ?? "");
            this.importsToRemove.push(i);
          }
        }
      } else if (item && item._type === "import") {
        this.processImportNode(item as ast.ImportNode, node._location.source ?? "");
        this.importsToRemove.push(i);
      }
    }

    // Create new program without imports, but with inlined definitions
    const newProgram = node.program.filter((_, i) => !this.importsToRemove.includes(i));
    
    // Prepend imported definitions to the program
    const combinedProgram = [...this.importedDefinitions, ...newProgram];

    return {
      ...node,
      program: combinedProgram,
    };
  }

  private processImportNode(node: ast.ImportNode, currentFile: string): void {
    for (const importDef of node.imports) {
      if (ast.isFileImportSource(importDef.source)) {
        const file = importDef.source.file.value;
        const resolvedFile = path.resolve(path.dirname(currentFile), file);
        this.inlineImportedFile(resolvedFile, importDef);
      }
    }
  }

  private inlineImportedFile(filePath: string, importDef: ast.ImportDefinition): void {
    // Get the imported file's AST from the context's cache
    const importedAst = this.context.astProvider.getAst(filePath);
    if (!importedAst) {
      this.context.log(1, `Could not find imported file: ${filePath}`);
      return;
    }

    // Extract exported symbols from the imported file
    const exportedDefinitions = this.extractExportedDefinitions(importedAst, filePath);
    this.importedDefinitions.push(...exportedDefinitions);
  }

  private extractExportedDefinitions(ast: ast.ProgramNode, sourceFile: string): ast.ASTNode[] {
    const definitions: ast.ASTNode[] = [];
    const exportedSymbols = new Set<string>();

    // First pass: find all exported symbols
    for (const item of ast.program) {
      if (item && item._type === "list") {
        const listNode = item as ast.ListNode;
        if (listNode.nodes && listNode.nodes.length > 0) {
          const firstNode = listNode.nodes[0];
          if (firstNode && firstNode._type === "export") {
            const exportNode = firstNode as ast.ExportNode;
            for (const exp of exportNode.exports) {
              if (exp.symbol && exp.symbol._type === "simple-identifier") {
                exportedSymbols.add((exp.symbol as ast.SimpleIdentifierNode).id);
              }
            }
          }
        }
      } else if (item && item._type === "export") {
        const exportNode = item as ast.ExportNode;
        for (const exp of exportNode.exports) {
          if (exp.symbol && exp.symbol._type === "simple-identifier") {
            exportedSymbols.add((exp.symbol as ast.SimpleIdentifierNode).id);
          }
        }
      }
    }

    // Second pass: collect definitions of exported symbols
    for (const item of ast.program) {
      if (!item) continue;

      let nodeToAdd: ast.ASTNode | null = null;

      if (item._type === "list") {
        const listNode = item as ast.ListNode;
        if (listNode.nodes && listNode.nodes.length > 0) {
          const firstNode = listNode.nodes[0];
          
          // Skip import and export statements
          if (firstNode && (firstNode._type === "import" || firstNode._type === "export")) {
            continue;
          }

          // Check if this is a function/variable definition
          if (firstNode && (firstNode._type === "function" || firstNode._type === "variable")) {
            const def = firstNode as any;
            const name = def.name?.id || def.name;
            if (name && exportedSymbols.has(name)) {
              // Add the actual definition (function/variable), not the list wrapper
              nodeToAdd = firstNode;
            }
          }
        }
      } else if (item._type === "function" || item._type === "variable") {
        const def = item as any;
        const name = def.name?.id || def.name;
        if (name && exportedSymbols.has(name)) {
          nodeToAdd = item;
        }
      }

      if (nodeToAdd) {
        definitions.push(nodeToAdd);
      }
    }

    return definitions;
  }
}
