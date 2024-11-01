import * as ast from "../../ast";
import { Context } from "../../Context";
import { ScopeType } from "../../SymbolTable";
import { JSCompilerAstVisitor } from "..";
import { SourceNode } from "source-map";
import { createSourceNode, joinArray } from "./helpers";

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
  private visitor: JSCompilerAstVisitor;

  constructor(
    node: ast.ClassNode,
    context: Context,
    visitor: JSCompilerAstVisitor
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
      this.extendsClause = [
        ` extends `,
        ...joinArray(
          node.extends.map((x) => createSourceNode(x, x.type.name)),
          ","
        ),
      ];
    }
  }

  private processImplements(node: ast.ClassNode): void {
    if (node.implements && node.implements.length > 0) {
      this.implementsClause = [
        ` implements `,
        ...joinArray(
          node.implements.map((x) => this.visitor.visit(x)),
          ","
        ),
      ];
    }
  }

  private processBody(body: any[]): void {
    for (let b of body.map((x: any) => x.nodes).flat(2)) {
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
    if (this.ctorVars.length === 0) return [];

    this.visitor.pushScope(ScopeType.variable);

    const ctorVariables = this.ctorVars.map((v) => {
      const fieldName = this.visitor.visit(v.name);
      const paramName = fieldName;
      const field = v.modifiers.some((x) => x.modifier === "private")
        ? ["#", fieldName]
        : [fieldName];
      return {
        param: fieldName,
        ctor: ["this.", ...field, " = ", paramName],
      };
    });

    this.visitor.popScope();

    return [
      `constructor(`,
      ...joinArray(
        ctorVariables.map((x) => x.param),
        ","
      ),
      `) {`,
      ...joinArray(
        ctorVariables.map((x) => x.ctor),
        ';'
      ),
      `}`,
    ];
  }

  private buildFields(): (SourceNode | string)[] {
    this.visitor.pushScope(ScopeType.variable);

    const fieldsCode = this.classFields
      .flatMap((v) => {
        const result: (SourceNode | string)[] = [];
        result.push(
          ...v.modifiers
            .filter(x => x.modifier !== "private")
            .map(x => createSourceNode(x, '/*', x.modifier, '*/'))
          );
        if (v.modifiers.some((x) => x.modifier === "private")) {
          result.push('#');
        }
        result.push(this.visitor.visit(v.name));
        if (!!v.value) {
          result.push('=');
          result.push(this.visitor.visit(v.value));
        }
        result.push(';');
        return result;
      });

    this.visitor.popScope();
    return fieldsCode;
  }

  private buildMethods(): (SourceNode | string)[] {
    this.visitor.pushScope(ScopeType.method);
    const methodsCode = this.methods
      .flatMap((m) => {
        const result: (SourceNode | string)[] = [];
        if (m.async) {
          result.push("async ");
        }
        result.push(
          this.visitor.visit(m.name),
          '(',
          ...m.params.map(x => this.visitor.visit(x)),
          ')',
          '{',
          ...m.body.map(x => this.visitor.visit(x)),
          '}'
        );
        return result;
      });
    this.visitor.popScope();
    return methodsCode;
  }

  private buildOtherBody(): (SourceNode | string)[] {
    return this.otherBody.map((b) => this.visitor.visit(b));
  }

  public build(): SourceNode {
    return createSourceNode(this.node,
      ...this.accessModifiers,
      ' class ',
      this.name,
      ...this.extendsClause,
      ...this.implementsClause,
      '{',
      ...this.buildFields(),
      ...this.buildConstructor(),
      ...this.buildMethods(),
      ...this.buildOtherBody(),
      '}'
    );
  }
}
