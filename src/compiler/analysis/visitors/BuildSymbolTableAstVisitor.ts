import * as ast from "../../frontend/ast";
import { LogLevel } from "../../Context";
import { ScopeType, SymbolTable, SymbolTableBuilder } from "../SymbolTable";
import { BaseAstTreeWalker } from "../../BaseAstTreeWalker";

/**
 * BuildSymbolTableAstVisitor - Two-Pass Implementation
 * 
 * Pass 1 (ScanPass): Walks the AST and records all top-level definitions
 *   - Records Class names, Function names, Variable names
 *   - Does NOT enter function bodies or class bodies
 *   - Allows forward references: functions can call functions defined later
 * 
 * Pass 2 (ResolvePass): Walks the AST again to validate symbol usage
 *   - Enters function and class bodies
 *   - Validates that all used identifiers exist in the symbol table
 *   - Tracks symbol usage for later optimization passes
 */

class ScanPassVisitor extends BaseAstTreeWalker {
  private symbolTableBuilder: SymbolTableBuilder;

  constructor(context: any) {
    super(context);
    this.symbolTableBuilder = new SymbolTableBuilder();
  }

  getBuilder(): SymbolTableBuilder {
    return this.symbolTableBuilder;
  }

  visitProgram(node: ast.ProgramNode) {
    this.symbolTableBuilder.enterScope(node);
    // Only scan top-level definitions, don't recurse into bodies
    const scanItem = (item: ast.ASTNode) => {
      if (!item) return;
      // Some source files wrap top-level forms in a `list` node; unwrap it
      if (item._type === "list") {
        const nodes = (item as any).nodes || [];
        for (const n of nodes) scanItem(n);
        return;
      }

      if (item._type === "function" || item._type === "class" || item._type === "interface" || item._type === "variable") {
        this.symbolTableBuilder.defineSymbol(item as any);
      }
    };

    for (const item of node.program) {
      scanItem(item as any);
    }
  }

  visitFunction(node: ast.FunctionNode) {
    // ScanPass: Don't visit function body yet
    // This is handled in ResolvePass
  }

  visitClass(node: ast.ClassNode) {
    // ScanPass: Don't visit class body yet
    // This is handled in ResolvePass
  }

  visitInterface(node: ast.InterfaceNode) {
    // ScanPass: Don't visit interface body yet
    // This is handled in ResolvePass
  }
}

class ResolvePassVisitor extends BaseAstTreeWalker {
  private symbolTableBuilder: SymbolTableBuilder;

  constructor(context: any, builder: SymbolTableBuilder) {
    super(context);
    this.symbolTableBuilder = builder;
  }

  getBuilder(): SymbolTableBuilder {
    return this.symbolTableBuilder;
  }

  visitProgram(node: ast.ProgramNode) {
    this.symbolTableBuilder.enterScope(node);
    node.program.map(x => super.visit(x));
    // this.symbolTableBuilder.exitScope();
  }

  visitVariable(node: ast.VariableNode) {
    // Variable already defined in ScanPass, now resolve its value
    if (node.value) {
      super.visit(node.value);
    }
  }

  visitFunction(node: ast.FunctionNode) {
    // Function already defined in ScanPass, now enter its scope and resolve body
    this.symbolTableBuilder.enterScope(node);
    [...node.params, ...node.body].map(x => this.visitIfNotNull(x));
    this.symbolTableBuilder.exitScope();
  }

  visitClass(node: ast.ClassNode) {
    // Class already defined in ScanPass, now enter its scope and resolve body
    this.symbolTableBuilder.enterScope(node);
    // Scan class members first (similar to program scan)
    for (const member of node.body) {
      if (member._type === "function" || member._type === "variable") {
        this.symbolTableBuilder.defineSymbol(member as any);
      }
    }
    // Then resolve them
    node.body.map(x => this.visitIfNotNull(x));
    this.symbolTableBuilder.exitScope();
  }

  visitInterface(node: ast.InterfaceNode) {
    this.symbolTableBuilder.enterScope(node);
    node.body.map(x => this.visitIfNotNull(x));
    this.symbolTableBuilder.exitScope();
  }

  visitExport(node: ast.ExportNode) {
    // console.log("Resolving node:", node);
    // console.log("export 0:", node.exports[0]);
    // console.log("Symbol table:", this.symbolTableBuilder);
    node.exports.forEach(x => {
      const symbol = this.symbolTableBuilder.resolveSymbol(x.symbol);
      if (symbol === undefined) {
        this.context.log(LogLevel.Error, `Cannot export undefined symbol: ${x.symbol.name ?? x.symbol.id}`);
        throw new Error(`Export error: symbol not found`);
      }
      symbol.exportName = x.as ?? x.symbol;
    });
  }

  private visitIfNotNull(node: ast.ASTNode | null | undefined): any {
    return node !== undefined && node !== null ? super.visit(node) : undefined;
  }
}

export class BuildSymbolTableAstVisitor extends BaseAstTreeWalker {
  private symbolTableBuilder: SymbolTableBuilder = new SymbolTableBuilder();

  buildSymbolTable(): SymbolTable {
    return this.symbolTableBuilder.build();
  }

  visit(node: ast.ASTNode, defaultVisitor?: (node?: ast.ASTNode) => any): any {
    // This should not be called directly
    throw new Error("BuildSymbolTableAstVisitor should use scanAndResolve() method");
  }

  /**
   * Two-pass compilation:
   * 1. Scan: Record all top-level definitions
   * 2. Resolve: Validate usage and enter function/class bodies
   */
  scanAndResolve(ast: ast.ASTNode): void {
    // Pass 1: Scan for definitions
    const scanVisitor = new ScanPassVisitor(this.context);
    scanVisitor.visit(ast);
    this.symbolTableBuilder = scanVisitor.getBuilder();

    // Pass 2: Resolve usage
    const resolveVisitor = new ResolvePassVisitor(this.context, this.symbolTableBuilder);
    resolveVisitor.visit(ast);
  }
};
