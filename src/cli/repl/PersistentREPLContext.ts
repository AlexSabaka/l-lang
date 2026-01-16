import * as vm from "node:vm";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { Context, CompilerOptions } from "../../compiler/Context";
import { RuntimeProvider } from "../../compiler/runtime/RuntimeProvider";

/**
 * Manages persistent state for the REPL
 * Maintains the symbol table and execution context across evaluations.
 */
export class PersistentREPLContext {
  private context: Context;
  private options: CompilerOptions;
  private vmContext: vm.Context;
  private history: string[] = [];
  private tempFile: string;

  constructor(options: CompilerOptions) {
    this.options = { 
      ...options,
      noIIFE: true,             // REPL needs top-level declarations to persist
      includeRuntimeShim: false // We load shim once manually
    };
    this.tempFile = path.resolve(tmpdir(), `llang-repl-${Date.now()}.lisp`);
    this.context = new Context(this.tempFile, this.options);
    
    // Create persistent VM context for REPL
    const consoleOutput: string[] = [];
    const customConsole = {
      log: (...args: any[]) => {
        const output = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ');
        consoleOutput.push(output);
        process.stdout.write(output + '\n');
      },
      error: (...args: any[]) => console.error(...args),
      warn: (...args: any[]) => console.warn(...args),
    };
    
    this.vmContext = vm.createContext({
      console: customConsole,
      __consoleOutput: consoleOutput,
      JSON,
      Math,
      process,
      require,
      // User requested runtime object 
      runtime: {}
    });
    
    // Load runtime shim once into global scope using `var`
    this.loadRuntimeShim();
  }

  /**
   * Load the runtime shim into the VM context
   */
  private loadRuntimeShim(): void {
    try {
      // Get the full shim with all symbols
      const shimCode = RuntimeProvider.getRuntimeShim()
        .replace(/const\s+/g, 'var ')
        .replace(/let\s+/g, 'var ');
      
      vm.runInContext(shimCode, this.vmContext);
    } catch (e) {
      console.error("Failed to load runtime shim:", e);
    }
  }

  eval(source: string): any {
    (this.vmContext as any).__consoleOutput.length = 0;
    const markerValue = `---boundary-${this.history.length}-${Math.random().toString(36).slice(2)}---`;
    const markerLisp = `(let __repl_marker "${markerValue}")`;
    const markerJs = `var __repl_marker = "${markerValue}";`;

    try {
      const programToCompile = [...this.history, markerLisp, source].join("\n\n");
      fs.writeFileSync(this.tempFile, programToCompile);
      
      this.context = new Context(this.tempFile, this.options);
      const result = this.context.process(this.tempFile, "codegen");
      
      if (!result.code) return undefined;
      const parts = result.code.split(markerJs);
      const newCode = parts[parts.length - 1].trim();
      if (!newCode) return undefined;

      const returnValue = vm.runInContext(newCode, this.vmContext);
      this.history.push(source);
      return (this.vmContext as any).__consoleOutput.length > 0 ? undefined : returnValue;
    } catch (error: any) {
      throw error;
    }
  }

  getContext(): Context { return this.context; }
  getHistory(): string[] { return [...this.history]; }
  reset(): void {
    this.history = [];
    this.context = new Context(this.tempFile, this.options);
    this.loadRuntimeShim();
  }
  dispose(): void {
    try { if (fs.existsSync(this.tempFile)) fs.rmSync(this.tempFile); } catch (e) {}
  }
  
  getSymbols(): Map<string, any> {
    const symbols = new Map<string, any>();
    const symbolTable = this.context.symbolTable;
    if (symbolTable) {
      const allEntries = symbolTable.getAllSymbols();
      for (const [name, entry] of allEntries.entries()) {
        symbols.set(name, {
          type: entry.nodeType,
          mutability: entry.mutability,
          visibility: entry.visibility,
          inferredType: entry.inferredType
        });
      }
    }
    return symbols;
  }
}
