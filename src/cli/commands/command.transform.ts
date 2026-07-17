import fs from "node:fs";
import chalk from "chalk";
import highlight from "cli-highlight";

import { Command } from "commander";

import {
  Context,
  LogLevel,
  CompilationStage,
  logCompilationMessages,
} from "../../compiler/Context";
import { Scope } from "../../compiler/analysis/SymbolTable";
import { symbolName } from "../../compiler/frontend/ast";
import { getCompilerOptions } from "../getCompilerOptions";

const { stdout } = process;

/**
 * Serialize symbol table (with integrated type information) to JSON
 */
function serializeSymbolTable(scope: Scope | undefined): any {
  if (!scope) return null;

  // Track visited objects to prevent circular references
  const visited = new WeakSet();
  
  const serializeInferredType = (type: any): any => {
    if (!type) return null;
    
    // Handle circular references
    if (typeof type === 'object' && visited.has(type)) {
      return { kind: 'circular-reference', name: type.name || 'unknown' };
    }
    
    if (typeof type === 'object') {
      visited.add(type);
    }
    
    const serialized: any = {};
    
    // Copy basic properties while excluding problematic ones
    for (const [key, value] of Object.entries(type)) {
      // Skip problematic properties that cause circular references
      if (key === '_parent' || key === '_location' || key === 'parent' || key === 'node') {
        continue;
      }
      
      // Handle special properties
      if (key === 'name' && typeof value === 'object' && value !== null) {
        // Extract name from identifier objects
        serialized[key] = (value as any).name || (value as any).id || String(value);
        continue;
      }
      
      serialized[key] = value;
    }
    
    // Convert Map objects to plain objects
    if (type.methodSignatures && type.methodSignatures instanceof Map) {
      serialized.methodSignatures = {};
      for (const [key, value] of type.methodSignatures) {
        serialized.methodSignatures[key] = serializeInferredType(value);
      }
    }
    
    // Convert Set objects in detailed members
    if (type.detailedMembers) {
      serialized.detailedMembers = type.detailedMembers.map((member: any) => {
        const serializedMember = serializeInferredType(member);
        if (serializedMember.modifiers instanceof Set) {
          serializedMember.modifiers = Array.from(serializedMember.modifiers);
        }
        return serializedMember;
      });
    }
    
    // Convert interface implementation Map objects
    if (type.implementedInterfaces) {
      serialized.implementedInterfaces = type.implementedInterfaces.map((iface: any) => {
        const serializedIface = serializeInferredType(iface);
        if (serializedIface.methodMappings instanceof Map) {
          serializedIface.methodMappings = Object.fromEntries(serializedIface.methodMappings);
        }
        return serializedIface;
      });
    }
    
    // Handle codegen metadata
    if (type.codegenMetadata) {
      const metadata = serializeInferredType(type.codegenMetadata);
      
      // Convert methodSignatures Map in codegen metadata
      if (type.codegenMetadata.methodSignatures instanceof Map) {
        metadata.methodSignatures = {};
        for (const [key, value] of type.codegenMetadata.methodSignatures) {
          metadata.methodSignatures[key] = serializeInferredType(value);
        }
      }
      
      serialized.codegenMetadata = metadata;
    }
    
    // Recursively serialize nested types
    if (type.generics && Array.isArray(type.generics)) {
      serialized.generics = type.generics.map(serializeInferredType);
    }
    if (type.params && Array.isArray(type.params)) {
      serialized.params = type.params.map(serializeInferredType);
    }
    if (type.returns) {
      serialized.returns = serializeInferredType(type.returns);
    }
    if (type.alternatives && Array.isArray(type.alternatives)) {
      serialized.alternatives = type.alternatives.map(serializeInferredType);
    }
    if (type.keyType) {
      serialized.keyType = serializeInferredType(type.keyType);
    }
    if (type.valueType) {
      serialized.valueType = serializeInferredType(type.valueType);
    }
    if (type.inner) {
      serialized.inner = serializeInferredType(type.inner);
    }
    if (type.aliasedType) {
      serialized.aliasedType = serializeInferredType(type.aliasedType);
    }
    
    // Handle members array
    if (type.members && Array.isArray(type.members)) {
      serialized.members = type.members.map((member: any) => {
        const serializedMember = serializeInferredType(member);
        if (member.type) {
          serializedMember.type = serializeInferredType(member.type);
        }
        return serializedMember;
      });
    }
    
    // Handle constructor info
    if (type.ctorInfo && type.ctorInfo.params) {
      serialized.ctorInfo = {
        requiredCount: type.ctorInfo.requiredCount,
        params: type.ctorInfo.params.map((param: any) => {
          const serializedParam = serializeInferredType(param);
          if (param.type) {
            serializedParam.type = serializeInferredType(param.type);
          }
          return serializedParam;
        })
      };
    }
    
    return serialized;
  };

  const serializeScope = (s: Scope): any => {
    const entries: any = {};
    for (const [key, entry] of s.table.entries()) {
      entries[key] = {
        // MR3 (games): a synthetic/incomplete symbol entry can have a null `name` node, and
        // `symbolName` reads `._type` of it -> the debug serializer crashed `--stage types` on any real
        // program (minesweeper). The table is keyed BY the name, so `key` is the honest fallback.
        name: entry.name ? symbolName(entry.name) : key,
        nodeType: entry.nodeType,
        mutability: entry.mutability,
        visibility: entry.visibility,
        // Convert Set to Array for JSON serialization
        modifiers: Array.from(entry.modifiers || []),
        // Include inferred type if available with proper serialization
        ...(entry.inferredType && { inferredType: serializeInferredType(entry.inferredType) }),
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
    // Context.process() logs diagnostics after the syntax and types stages, but NOT after
    // codegen -- so a codegen error (LL0100/LL0101) was collected, correctly suppressed the
    // output file, correctly exited 1, and told the user nothing at all. Print whatever is in
    // results before bailing, whichever stage raised it.
    logCompilationMessages(context);
    process.exitCode = 1;
    return;
  }

  // Output performance report if enabled
  if (options.perf) {
    console.log(context.getPerformanceReport());
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
    fs.writeFileSync(file.replace(".lisp", ".js.map"), map.toString());
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

    const output = JSON.stringify(outputData, (k, v) => {
      // Filter out circular reference properties
      if (k === "_location" || k === "_parent" || k === "parent" || k === "node") {
        return undefined;
      }
      return v;
    }, 2);

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
