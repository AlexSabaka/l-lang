import * as ast from "../frontend/ast";
import { Context, LogLevel } from "../Context";
import { createSourceNode, joinArray } from "../helpers/utils/helpers";
import { SourceNode } from "source-map";

/**
 * Helper function to extract constructor parameters from a class node
 */
function getCtorParamsFromClassNode(classNode: ast.ClassNode): string[] {
  const result: string[] = [];

  // Flatten body (handle nested arrays)
  const bodyNodes = classNode.body
    .map((x: any) => (x.nodes ? x.nodes : [x]))
    .flat(2);

  for (const node of bodyNodes) {
    if (node._type === "variable") {
      const variable = node as ast.VariableNode;
      const fieldModifiers = variable.modifiers.map((m) => m.modifier);

      if (fieldModifiers.includes("ctor")) {
        const paramName = (variable.name as any).id ?? (variable.name as any).name;
        result.push(paramName);
      }
    }
  }

  return result;
}

/**
 * ClassBuilder - Generates ES6 class declarations from l-lang AST nodes
 *
 * Handles:
 * - Constructor parameter passing and inheritance
 * - Field declarations (public/private)
 * - Method definitions
 * - Parent class resolution via symbol table
 * - Proper super() call generation
 */
export class ClassBuilder {
  private name: SourceNode;
  private node: ast.ClassNode;

  private accessModifiers: (SourceNode | string)[] = [];
  private extendsClause: (SourceNode | string)[] = [];
  private implementsClause: (SourceNode | string)[] = [];

  private ctorVars: ast.VariableNode[] = [];
  private classFields: ast.VariableNode[] = [];

  private methods: ast.FunctionNode[] = [];
  private otherBody: ast.ASTNode[] = [];

  private context: Context;
  private visitor: any; // JSTransformerAstVisitor (to avoid circular dependency)

  constructor(
    node: ast.ClassNode,
    context: Context,
    visitor: any
  ) {
    this.context = context;
    this.visitor = visitor;
    this.node = node;
    this.name = createSourceNode(node.name, node.name.name);

    this.processExtends(node);
    this.processImplements(node);
    this.processBody(node.body);
  }

  private processExtends(node: ast.ClassNode): void {
    if (node.extends && node.extends.length > 0) {
      const parentClass = node.extends[0];
      this.extendsClause = [
        ` extends `,
        createSourceNode(parentClass, parentClass.type.name)
      ];
    }
  }

  private processImplements(node: ast.ClassNode): void {
    if (node.implements && node.implements.length > 0) {
      this.implementsClause = [
        ` /* implements `,
        ...joinArray(node.implements.map((x) => this.visitor.visit(x)), ", "),
        ` */`
      ];
    }
  }

  private processBody(body: any[]): void {
    const nodes = body.map((x: any) => (x.nodes ? x.nodes : [x])).flat(2);

    for (let b of nodes) {
      if (b._type === "variable") {
        this.processVariable(b);
      } else if (b._type === "function") {
        this.methods.push(b);
      } else {
        this.otherBody.push(b);
      }
    }
  }

  private processVariable(variable: ast.VariableNode): void {
    const fieldModifiers = variable.modifiers.map((m) => m.modifier);
    if (fieldModifiers.includes("ctor")) {
      this.ctorVars.push(variable);
    } else {
      this.classFields.push(variable);
    }
  }

  private buildConstructor(): (SourceNode | string)[] {
    // 1. Resolve Parent Class Logic
    let parentClassName: string | null = null;
    let parentArgs: string[] = [];

    if (this.node.extends && this.node.extends.length > 0) {
      // The AST structure for extends is usually [TypeNode] -> type -> name (Identifier)
      const parentTypeNode = this.node.extends[0];
      parentClassName = parentTypeNode.type.name;

      // --- THE FIX: USE SYMBOL TABLE ---
      // We look up the symbol for the parent class.
      // Since BuildSymbolTable ran before this, the symbol should exist.
      const parentSymbol = this.context.symbolTable.resolveSymbol(
        parentTypeNode.type
      );

      if (parentSymbol && parentSymbol.value && parentSymbol.value._type === "class") {
        // We have the AST node for the parent class!
        // We can now see what its :ctor variables are.
        parentArgs = getCtorParamsFromClassNode(
          parentSymbol.value as ast.ClassNode
        );
      } else {
        // Fallback: If we extend a native JS class or external lib we haven't parsed,
        // we assume 0 arguments for super() to be safe, or we could warn.
        // context.log(LogLevel.Warning, `Could not resolve parent class ${parentClassName}`);
      }
    }

    // 2. Identify Local Constructor Variables
    const localCtorArgNames = this.ctorVars.map(
      (v) => (v.name as any).id ?? (v.name as any).name
    );

    // 3. Calculate Final Constructor Parameters & Super Arguments
    const finalConstructorParams: string[] = [];
    const superCallArgs: string[] = [];

    // A. Handle Parent Requirements (Pass-through)
    for (const pArg of parentArgs) {
      if (localCtorArgNames.includes(pArg)) {
        // Shadowing: We have the value locally, pass it to super
        superCallArgs.push(pArg);
      } else {
        // Missing: We need to ask for it in our constructor, then pass it to super
        finalConstructorParams.push(pArg);
        superCallArgs.push(pArg);
      }
    }

    // B. Handle Local Requirements
    for (const localArg of localCtorArgNames) {
      // Add all local :ctor vars to the signature
      finalConstructorParams.push(localArg);
    }

    // --- Code Generation ---

    const paramNodes = finalConstructorParams.map((p) =>
      createSourceNode(this.node, p)
    );

    const assignments = this.ctorVars.map((v) => {
      const fieldName = this.visitor.visit(v.name);
      const isPrivate = v.modifiers.some((x) => x.modifier === "private");
      const targetField = isPrivate ? ["#", fieldName] : [fieldName];
      return createSourceNode(
        v,
        "this.",
        ...targetField,
        " = ",
        fieldName
      );
    });

    const superCall = parentClassName
      ? [
          "super(",
          ...joinArray(superCallArgs, ", "),
          "); // Implicit super call\n"
        ]
      : [];

    // If implicit constructor is empty (no extends, no ctor vars), skip generating it
    if (
      finalConstructorParams.length === 0 &&
      !parentClassName &&
      assignments.length === 0
    ) {
      return [];
    }

    return [
      `constructor(`,
      ...joinArray(paramNodes, ", "),
      `) {`,
      ...superCall,
      ...joinArray(assignments, ";"),
      `}`
    ];
  }

  private buildFields(): (SourceNode | string)[] {
    return this.classFields.flatMap((v) => {
      const result: (SourceNode | string)[] = [];
      const isPrivate = v.modifiers.some((x) => x.modifier === "private");

      if (isPrivate) result.push("#");
      result.push(this.visitor.visit(v.name));

      if (v.value) {
        result.push(" = ");
        result.push(this.visitor.visit(v.value));
      }
      result.push(";");
      return result;
    });
  }

  private buildMethods(): (SourceNode | string)[] {
    return this.methods.map((m) => this.visitor.visit(m));
  }

  private buildOtherBody(): (SourceNode | string)[] {
    return this.otherBody.map((b) => this.visitor.visit(b));
  }

  public build(): SourceNode {
    return createSourceNode(
      this.node,
      ...this.accessModifiers,
      "class ",
      this.name,
      ...this.extendsClause,
      ...this.implementsClause,
      " {\n",
      ...this.buildFields(),
      "\n",
      ...this.buildConstructor(),
      "\n",
      ...this.buildMethods(),
      "\n",
      ...this.buildOtherBody(),
      "\n}"
    );
  }
}
