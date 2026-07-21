import * as ast from "../../frontend/ast";
import { LogLevel } from "../../Context";
import { ScopeType, SymbolTable, SymbolTableBuilder } from "../SymbolTable";
import { BaseAstTreeWalker } from "../../BaseAstTreeWalker";
import { ModuleDiagnostics as MD } from "../../rules/diagnostics";

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

      if (item._type === "function" || item._type === "class" || item._type === "interface" || 
          item._type === "variable" || item._type === "type-def" || item._type === "struct" || 
          item._type === "modifier-def") {
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

  visitTypeDef(node: ast.TypeDefNode) {
    // ScanPass: Register type-def name so it's available for forward references
    // No body to scan
  }

  visitStruct(node: ast.StructNode) {
    // ScanPass: Register struct name
    // Don't scan body yet - that's for ResolvePass
  }

  visitModifierDef(node: ast.ModifierDefNode) {
    // ScanPass: Don't visit modifier body yet
    // This is handled in ResolvePass
  }

  visitSpread(node: ast.SpreadNode) {
    // ScanPass: Spread is not a top-level declaration, skip
  }
}

class ResolvePassVisitor extends BaseAstTreeWalker {
  private symbolTableBuilder: SymbolTableBuilder;

  /**
   * Nodes already visited. Without this, every node is visited TWICE -- and the second time is in
   * the WRONG SCOPE.
   *
   * BaseAstTreeWalker.visit() dispatches to visitX and THEN does a generic child walk. But
   * visitFunction (and visitClass, visitInterface, ...) already walk their own children, inside the
   * scope they just entered. So the generic walk revisits those same children AFTER exitScope --
   * i.e. with the PARENT scope active. Any definition made on that second pass lands in the wrong
   * table: a `let` inside a function body, or a for-each's loop variable, ends up in the module
   * ROOT, where codegen sees a module-level symbol of another file and inlines it as an export:
   *
   *     const __ll_inlined_arg_1 = { let arg; for (arg of ...) { ... } };   // not valid JS either
   *
   * This was previously masked: visitVariable simply refused to define anything while the program
   * scope was active. That hid the double-walk at the cost of never declaring a `let` nested inside
   * a top-level loop. Visiting each node once fixes the cause instead of the symptom.
   */
  private visited: Set<ast.ASTNode> = new Set();

  constructor(context: any, builder: SymbolTableBuilder) {
    super(context);
    this.symbolTableBuilder = builder;
  }

  visit(node: ast.ASTNode, defaultVisitor?: (node?: ast.ASTNode) => any): any {
    if (!node) return node;
    if (this.visited.has(node)) return node;
    this.visited.add(node);
    return super.visit(node, defaultVisitor);
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
    // This used to SKIP defining whenever the active scope was `program`, on the assumption that
    // ScanPass had already covered it. ScanPass only scans TOP-LEVEL items though (it unwraps the
    // wrapper list, but does not recurse into a `for` or an `if` body) -- so a `let` nested inside
    // a top-level loop was defined by nobody, and was unresolvable.
    //
    // Ask instead of assume: define it unless this scope already has every name it binds.
    const active = this.symbolTableBuilder.getActive();
    const names = ast.bindingNames(node.name);
    const alreadyDefined =
      names.length > 0 && names.every((n) => active?.table.has(n));

    if (!alreadyDefined) {
      this.symbolTableBuilder.defineSymbol(node);
    }

    if (node.value) {
      super.visit(node.value);
    }
  }

  /**
   * Loop, catch and match bindings were NEVER declared -- there was no visitor for any of these
   * node types, so `(for :each item :from xs ...)` put `item` nowhere at all.
   *
   * They are defined into the CURRENT scope rather than a fresh one. That is deliberately modest:
   * introducing real per-loop scopes interacts with the tree walker's generic child-walk (which
   * runs AFTER the visitor and would descend in the parent scope), and the only cost of the simpler
   * choice is that a loop variable stays resolvable after its loop -- a false NEGATIVE for the
   * unresolved-identifier check, never a false positive.
   */
  visitForEach(node: ast.ForEachNode) {
    this.symbolTableBuilder.defineBinding(node.variable, node);
    return node;
  }

  visitTryCatch(node: ast.TryCatchNode) {
    for (const clause of node.catch ?? []) {
      const name = clause?.filter?.name;
      if (name) this.symbolTableBuilder.defineBinding(name as any, node);
    }
    return node;
  }

  visitMatchCase(node: ast.MatchCaseNode) {
    // A pattern binds names: `[op _ _]`, `{:name n}`, a bare identifier. bindingIdentifiers walks
    // patterns already (it was written for destructuring, D16).
    this.symbolTableBuilder.defineBinding(node.pattern as any, node);
    return node;
  }

  // D47. A handle clause's `[c]` binds the condition, and a restart arm's `[params]` bind the invoke's
  // arguments -- both were never declared anywhere, which went unnoticed only because the walker never
  // reached the bodies that read them (see BaseAstTreeWalker.walkPlainObject). Same shape as the catch
  // binder above: declared into the enclosing scope, which is what `catch` has always done.
  visitHandle(node: ast.HandleNode) {
    for (const clause of node.clauses ?? []) {
      if (clause?.binder) this.symbolTableBuilder.defineBinding(clause.binder as any, node);
    }
    return node;
  }

  visitRestartCase(node: ast.RestartCaseNode) {
    for (const arm of node.arms ?? []) {
      for (const p of arm?.params ?? []) this.symbolTableBuilder.defineBinding(p as any, node);
    }
    return node;
  }

  /**
   * An ENUM was never defined as a symbol -- by anyone, anywhere. `(defenum HttpMethod :GET :POST)`
   * put nothing in the table, so `HttpMethod:GET` resolved to nothing and LL0210 called it undefined
   * on code that compiles and runs perfectly.
   *
   * ScanPass defines classes, structs, interfaces and type aliases. Enums were simply left off the
   * list, and nothing noticed because until LL0210 no check had ever asked whether an identifier
   * resolves to anything.
   */
  visitEnum(node: ast.EnumNode) {
    this.symbolTableBuilder.defineSymbol(node);
    return node;
  }

  visitFunction(node: ast.FunctionNode) {
    // Define the function in the ENCLOSING scope first, before descending into its own.
    //
    // This said "Function already defined in ScanPass" -- and ScanPass only scans TOP-LEVEL items.
    // So a NESTED function was defined by nobody:
    //
    //     (fn make-adder [n <- Int] (
    //         (fn adder [x <- Int] (+ x n))
    //         (return adder)))            ; LL0210: 'adder' is not defined
    //
    // which is the entire point of `14_closures.lisp`, and it is not a closure bug -- the name simply
    // was not in the symbol table. `visitVariable`, ten lines up, carries the SAME correction for the
    // same reason ("ScanPass only scans TOP-LEVEL items though"): someone hit this for `let`, fixed it
    // there, and left the identical assumption standing here.
    //
    // Ask instead of assume, exactly as `visitVariable` does: define it unless this scope already has
    // it -- which is how a top-level function stays ScanPass's, not defined twice.
    const active = this.symbolTableBuilder.getActive();
    const fnName = node.name ? ast.symbolName(node.name) : undefined;
    if (fnName && !active?.table.has(fnName)) {
      this.symbolTableBuilder.defineSymbol(node);
    }

    this.symbolTableBuilder.enterScope(node);

    // Define parameters as symbols in function scope
    node.params.forEach(param => {
      this.symbolTableBuilder.defineParameter(param);
    });
    
    // Visit parameters and body for any nested symbol resolution
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
      // Check for members wrapped in lists (e.g., constructor parameters)
      else if (ast.isListNode(member) && member.nodes.length > 0) {
        const innerFirst = member.nodes[0];
        if (innerFirst._type === "variable" || innerFirst._type === "function") {
          this.symbolTableBuilder.defineSymbol(innerFirst as any);
        }
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

  visitTypeDef(node: ast.TypeDefNode) {
    // Type-def already defined in ScanPass
    // No body to resolve - just the type expression
  }

  visitStruct(node: ast.StructNode) {
    // Struct already defined in ScanPass
    // Now enter its scope and resolve body members
    this.symbolTableBuilder.enterScope(node);
    if (node.body) {
      for (const member of node.body) {
        if (member._type === "list" && (member as any).nodes && (member as any).nodes.length > 0) {
          const firstNode = (member as any).nodes[0];
          if (firstNode._type === "variable" || firstNode._type === "function") {
            this.symbolTableBuilder.defineSymbol(firstNode as any);
          }
        } else if (member._type === "variable" || member._type === "function") {
          this.symbolTableBuilder.defineSymbol(member as any);
        }
      }
      node.body.map(x => this.visitIfNotNull(x));
    }
    this.symbolTableBuilder.exitScope();
  }

  visitModifierDef(node: ast.ModifierDefNode) {
    // Modifier already defined in ScanPass.
    //
    // Unconditionally scoped, not `if (params.length || body.length)`. That guard existed because an
    // enterScope on an unregistered node type was a silent no-op while the exitScope popped anyway,
    // so entering at all crashed the compiler -- and it is precisely why every defmodifier in the
    // corpus has no params and no body. Both are fixed: `modifier-def` is a registered scope, and
    // the enter/exit pair can no longer desync.
    this.symbolTableBuilder.enterScope(node);

    // DECLARE the parameters, do not merely visit them. `visitFunction` calls defineParameter and
    // this did not, so a modifier's own parameter -- the `times` of `(defmodifier retry [times])` --
    // resolved to nothing, and referencing it in the body was an unresolved identifier (LL0210).
    node.params.forEach((param) => {
      this.symbolTableBuilder.defineParameter(param);
    });

    [...node.params, ...node.body].map((x) => this.visitIfNotNull(x));
    this.symbolTableBuilder.exitScope();
  }

  visitSpread(node: ast.SpreadNode) {
    // ResolvePass: Visit the spread expression for symbol resolution
    this.visitIfNotNull(node.expression);
  }

  visitExport(node: ast.ExportNode) {
    // console.log("Resolving node:", node);
    // console.log("export 0:", node.exports[0]);
    // console.log("Symbol table:", this.symbolTableBuilder);
    node.exports.forEach(x => {
      const symbol = this.symbolTableBuilder.resolveSymbol(x.symbol);
      if (symbol === undefined) {
        // A located diagnostic, not a raw `throw` (Zl/reexport). Exporting a name this module does not
        // define -- a typo, or an attempt to RE-EXPORT an imported name (unsupported) -- crashed the
        // whole compile with a JS stack trace and no source location. `report` + continue, the same
        // shape the sibling BuildDependencyGraphAstVisitor uses for an unresolved import.
        this.report(MD.CannotExportUndefined, (x.symbol as any) ?? node, {
          name: ast.symbolName(x.symbol),
        });
        return;
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
