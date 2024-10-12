import * as ast from "./ast";
import { CompilationContext } from "./CompilationContext";
import { ScopeType } from "./SymbolTable";
import { JSCompilerAstVisitor } from "./visitors";

export class ClassBuilder {
  private name: string;
  private accessModifiers: string[];
  private extendsClause: string = "";
  private implementsClause: string = "";
  private ctorVars: ast.VariableNode[] = [];
  private classFields: ast.VariableNode[] = [];
  private methods: ast.FunctionNode[] = [];
  private otherBody: ast.ASTNode[] = [];
  private context: CompilationContext;
  private visitor: JSCompilerAstVisitor;

  constructor(
    node: ast.ClassNode,
    context: CompilationContext,
    visitor: JSCompilerAstVisitor
  ) {
    this.context = context;
    this.visitor = visitor;
    this.name = this.visitor.visit(node.name);
    this.accessModifiers = node.access.map((a) => a.modifier);

    this.processExtends(node);
    this.processImplements(node);
    this.processBody(node.body);
  }

  private processExtends(node: ast.ClassNode): void {
    if (node.extends && node.extends.length > 0) {
      this.extendsClause = ` extends ${node.extends
        .map((x) => x.name)
        .join(",")}`;
    }
  }

  private processImplements(node: ast.ClassNode): void {
    if (node.implements && node.implements.length > 0) {
      this.implementsClause = ` implements ${node.implements
        .map((x) => x.name)
        .join(",")}`;
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

  private processVariable(variable: any): void {
    const accessModifiers = variable.modifiers
      .filter((m: any) => m._type === "access-modifier")
      .map((m: any) => m.modifier);
    const fieldModifiers = variable.modifiers
      .filter((m: any) => m._type === "field-modifier")
      .map((m: any) => m.modifier);

    if (fieldModifiers.includes("ctor")) {
      this.ctorVars.push({ ...variable, accessModifiers, fieldModifiers });
    } else {
      this.classFields.push({ ...variable, accessModifiers, fieldModifiers });
    }
  }

  private buildConstructor(): string {
    if (this.ctorVars.length === 0) return "";

    this.visitor.pushScope(ScopeType.variable);
    const params = this.ctorVars
      .map((v) => this.visitor.visit(v.name))
      .join(",");

    const assignments = this.ctorVars
      .map((v) => {
        let fieldName = this.visitor.visit(v.name);
        const paramName = fieldName;
        if (v.modifiers.some(x => x.modifier === "private")) {
          fieldName = `#${fieldName}`;
        }
        return `this.${fieldName} = ${paramName};`;
      })
      .join("\n");
    this.visitor.popScope();

    return `constructor(${params}) {\n${assignments}\n}`;
  }

  private buildFields(): string {
    this.visitor.pushScope(ScopeType.variable);
    const fieldsCode = this.classFields
      .map((v) => {
        let fieldName = this.visitor.visit(v.name);
        if (v.modifiers.some(x => x.modifier === "private")) {
          fieldName = `#${fieldName}`;
        }
        let valueCode = v.value ? ` = ${this.visitor.visit(v.value)};` : ";";

        let modifierComments = "";
        if (v.modifiers.some(x => x.modifier === "readonly")) {
          modifierComments += "// readonly\n";
        }
        if (v.modifiers.some(x => x.modifier === "nullable")) {
          modifierComments += "// nullable\n";
        }

        return `${modifierComments}${fieldName}${valueCode}`;
      })
      .join("\n");
    this.visitor.popScope();
    return fieldsCode;
  }

  private buildMethods(): string {
    this.visitor.pushScope(ScopeType.method);
    const methodsCode = this.methods
      .map((m) => {
        const name = m.name ? this.visitor.visit(m.name) : "";
        return `${m.async ? "async " : ""}${name}(${m.params
          .map((x: any) => this.visitor.visit(x))
          .join(",")}) {\n${m.body
          .map((x: any) => this.visitor.visit(x))
          .join("\n")}\n}`;
      })
      .join("\n");
    this.visitor.popScope();
    return methodsCode;
  }

  private buildOtherBody(): string {
    return this.otherBody.map((b) => this.visitor.visit(b)).join("\n");
  }

  public build(): string {
    const classBodyCode = [
      this.buildFields(),
      this.buildConstructor(),
      this.buildMethods(),
      this.buildOtherBody(),
    ]
    .join("\n");

    return `${this.accessModifiers ? this.accessModifiers.join(" ") : ""}class ${
      this.name
    }${this.extendsClause}${this.implementsClause} {\n${classBodyCode}\n}`;
  }
}
