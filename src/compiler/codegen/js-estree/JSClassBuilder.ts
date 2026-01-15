import * as ESTree from "estree";
import * as ast from "../../frontend/ast";
import { Context } from "../../Context";
import { encodeIdentifier } from "../../utils";

/**
 * Helper function to extract constructor parameters from a class node
 */
function getCtorParamsFromClassNode(classNode: ast.ClassNode): string[] {
  const result: string[] = [];

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
 * ESTree location helper
 */
function loc(node: ast.ASTNode): ESTree.SourceLocation | null {
  if (!node._location) return null;
  return {
    source: node._location.source,
    start: { 
      line: node._location.start.line, 
      column: node._location.start.column 
    },
    end: { 
      line: node._location.end.line, 
      column: node._location.end.column 
    }
  };
}

/**
 * ClassBuilder - Generates ESTree ClassDeclaration from l-lang AST nodes
 *
 * Handles:
 * - Constructor parameter passing and inheritance
 * - Field declarations (public/private)
 * - Method definitions
 * - Parent class resolution via symbol table
 * - Proper super() call generation
 */
export class ClassBuilder {
  private name: ESTree.Identifier;
  private node: ast.ClassNode;

  private superClass: ESTree.Identifier | null = null;
  
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
    this.name = {
      type: "Identifier",
      name: node.name.name,
      loc: loc(node.name)
    };

    this.processExtends(node);
    this.processBody(node.body);
  }

  private processExtends(node: ast.ClassNode): void {
    if (node.extends && node.extends.length > 0) {
      const parentClass = node.extends[0];
      this.superClass = {
        type: "Identifier",
        name: parentClass.type.name,
        loc: loc(parentClass)
      };
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

  private buildConstructor(): ESTree.MethodDefinition | null {
    // 1. Resolve Parent Class Logic
    let parentClassName: string | null = null;
    let parentArgs: string[] = [];

    if (this.node.extends && this.node.extends.length > 0) {
      const parentTypeNode = this.node.extends[0];
      parentClassName = parentTypeNode.type.name;

      const parentSymbol = this.context.symbolTable.resolveSymbol(
        parentTypeNode.type
      );

      if (parentSymbol && parentSymbol.value && parentSymbol.value._type === "class") {
        parentArgs = getCtorParamsFromClassNode(
          parentSymbol.value as ast.ClassNode
        );
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
        superCallArgs.push(pArg);
      } else {
        finalConstructorParams.push(pArg);
        superCallArgs.push(pArg);
      }
    }

    // B. Handle Local Requirements
    for (const localArg of localCtorArgNames) {
      finalConstructorParams.push(localArg);
    }

    // If implicit constructor is empty, skip generating it
    if (
      finalConstructorParams.length === 0 &&
      !parentClassName &&
      this.ctorVars.length === 0
    ) {
      return null;
    }

    // --- Code Generation ---
    const params: ESTree.Identifier[] = finalConstructorParams.map(p => ({
      type: "Identifier",
      name: encodeIdentifier(p),
      loc: loc(this.node)
    }));

    const bodyStatements: ESTree.Statement[] = [];

    // Add super() call if needed
    if (parentClassName) {
      const superArgs: ESTree.Identifier[] = superCallArgs.map(arg => ({
        type: "Identifier",
        name: encodeIdentifier(arg)
      }));

      bodyStatements.push({
        type: "ExpressionStatement",
        expression: {
          type: "CallExpression",
          callee: { type: "Super" } as ESTree.Super,
          arguments: superArgs,
          optional: false
        }
      });
    }

    // Add field assignments (fields use encoded names)
    for (const v of this.ctorVars) {
      const isPrivate = v.modifiers.some((x) => x.modifier === "private");
      // fieldName should already be encoded via visitor
      const fieldName = this.visitor.visit(v.name) as ESTree.Identifier;
      
      // The parameter name matches the unencoded field name logic, so we must encode it too
      // to match constructor params
      const paramNameRaw = (v.name as any).id ?? (v.name as any).name;
      const paramRefName = encodeIdentifier(paramNameRaw);

      const targetField: ESTree.MemberExpression = {
        type: "MemberExpression",
        object: { type: "ThisExpression" },
        property: isPrivate 
          ? { type: "PrivateIdentifier", name: fieldName.name } as any
          : fieldName,
        computed: false,
        optional: false
      };

      bodyStatements.push({
        type: "ExpressionStatement",
        expression: {
          type: "AssignmentExpression",
          operator: "=",
          left: targetField as any,
          right: { type: "Identifier", name: paramRefName } // Use encoded param name
        }
      });
    }

    return {
      type: "MethodDefinition",
      key: { type: "Identifier", name: "constructor" },
      value: {
        type: "FunctionExpression",
        id: null,
        params,
        body: {
          type: "BlockStatement",
          body: bodyStatements
        },
        generator: false,
        async: false
      },
      kind: "constructor",
      computed: false,
      static: false,
      loc: loc(this.node)
    };
  }

  private buildFields(): ESTree.PropertyDefinition[] {
    return this.classFields.map(v => {
      const isPrivate = v.modifiers.some((x) => x.modifier === "private");
      const key = this.visitor.visit(v.name) as ESTree.Identifier;
      
      const fieldKey = isPrivate
        ? { type: "PrivateIdentifier", name: key.name } as any
        : key;

      const value = v.value 
        ? this.visitor.visit(v.value) as ESTree.Expression
        : null;

      return {
        type: "PropertyDefinition",
        key: fieldKey,
        value,
        computed: false,
        static: false,
        loc: loc(v)
      } as ESTree.PropertyDefinition;
    });
  }

  private buildMethods(): ESTree.MethodDefinition[] {
    return this.methods.map(m => this.visitor.visit(m) as ESTree.MethodDefinition);
  }

  private buildOtherBody(): any[] {
    return this.otherBody.map(b => this.visitor.visit(b));
  }

  public build(): ESTree.ClassDeclaration {
    const body: (ESTree.MethodDefinition | ESTree.PropertyDefinition)[] = [];

    // Add fields
    body.push(...this.buildFields());

    // Add constructor if needed
    const constructor = this.buildConstructor();
    if (constructor) {
      body.push(constructor);
    }

    // Add methods
    body.push(...this.buildMethods());

    // Add other body elements (if they're valid class members)
    // Note: otherBody items need to be compatible with class body
    const otherElements = this.buildOtherBody();
    for (const elem of otherElements) {
      if (elem && (elem.type === 'MethodDefinition' || elem.type === 'PropertyDefinition')) {
        body.push(elem);
      }
    }

    return {
      type: "ClassDeclaration",
      id: this.name,
      superClass: this.superClass,
      body: {
        type: "ClassBody",
        body
      },
      loc: loc(this.node)
    };
  }
}