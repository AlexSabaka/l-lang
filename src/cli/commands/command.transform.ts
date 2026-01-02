import fs from "node:fs";
import chalk from "chalk";
import highlight from "cli-highlight";

import { Command } from "commander";

import { Context, LogLevel, CompilationStage } from "../../compiler/Context";
import { Scope } from "../../compiler/analysis/SymbolTable";
import { getCompilerOptions } from "../getCompilerOptions";

const { stdout } = process;

/**
 * Serialize symbol table (with integrated type information) to JSON
 */
function serializeSymbolTable(scope: Scope | undefined): any {
  if (!scope) return null;

  const serializeScope = (s: Scope): any => {
    const entries: any = {};
    for (const [key, entry] of s.table.entries()) {
      entries[key] = {
        name: entry.name.name ?? entry.name.id,
        nodeType: entry.nodeType,
        mutability: entry.mutability,
        visibility: entry.visibility,
        // Include inferred type if available
        ...(entry.inferredType && { inferredType: entry.inferredType }),
      };
    }
    return {
      scopeType: s.type,
      entries,
      children: s.scopes.map(serializeScope),
    };
  };

  return serializeScope(scope);
}

/**
 * Get root scope from symbol table
 */
function getRootScope(symbolTable: any): Scope | undefined {
  return (symbolTable as any).scopes?.[0];
}

export function transform(file: string, command: Command) {
  const options = getCompilerOptions(command);
  const context = new Context(file, options);
  
  // Validate stage
  const validStages: CompilationStage[] = ["parse", "syntax", "symbols", "desugar", "types", "codegen"];
  if (!validStages.includes(options.stage)) {
    console.error(`Invalid stage: ${options.stage}. Valid stages are: ${validStages.join(", ")}`);
    process.exit(1);
  }

  const result = context.process(file);
  const ast = result.ast;
  const symbols = result.symbols;
  const code = result.code || '';
  const map = result.map || '';

  if (context.results.hasErrors) {
    return;
  }

  // Output based on stage
  if (options.stage === "codegen") {
    // Final stage: output JavaScript
    if (options.stdout) {
      console.log(chalk.strikethrough.dim(" ".repeat(stdout.columns)));
      console.log(highlight(code, { language: "javascript" }));
      console.log(chalk.strikethrough.dim(" ".repeat(stdout.columns)));
    }
    fs.writeFileSync(file.replace(".lisp", ".js"), code);
    fs.writeFileSync(file.replace(".lisp", ".lisp.map"), map.toString());
  } else {
    // Intermediate stage: output AST with unified symbol table (with type info)
    const astOutput = JSON.stringify(
      ast,
      (k, v) => (k === "_location" || k === "_parent" ? undefined : v),
      2
    );

    // Build output object with AST and optional symbol table
    const outputData: any = {
      ast: JSON.parse(astOutput),
    };

    // Include symbol table starting from symbols stage onwards
    const includeSymbols = ["symbols", "desugar", "types", "codegen"].includes(options.stage);
    if (symbols && includeSymbols) {
      const rootScope = getRootScope(symbols);
      const serializedSymbols = serializeSymbolTable(rootScope);
      if (serializedSymbols) {
        outputData.symbols = serializedSymbols;
      }
    }

    const output = JSON.stringify(outputData, null, 2);

    if (options.stdout) {
      context.log(LogLevel.Info, chalk.strikethrough.dim(" ".repeat(stdout.columns)));
      context.log(LogLevel.Info, highlight(output, { language: "json" }));
      context.log(LogLevel.Info, chalk.strikethrough.dim(" ".repeat(stdout.columns)));
    }

    // Determine output filename based on stage
    const stageExtension = options.stage === "parse" ? ".parsed.json" : `.${options.stage}.json`;
    fs.writeFileSync(
      file.replace(".lisp", stageExtension),
      output
    );
  }
}
