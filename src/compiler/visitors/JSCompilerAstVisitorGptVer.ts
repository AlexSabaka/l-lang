import fs from "fs";
import peggy from "peggy";

import * as ast from "../ast";
import { ScopeType } from "../SymbolTable";

import { randomIdentifier, encodeIdentifier } from "../utils";
import { BaseAstVisitor } from "./BaseAstVisitor";
import { CompilationContext, LogLevel } from "../CompilationContext";



function findIdentifiersToDefine(node: ast.MatchNode) {
  const predefinedVariables: string[] = [];
  const walkPattern = (p: ast.PatternNode): boolean => {
    switch (p._type) {
      case "identifier-pattern":
        return !!predefinedVariables.push(p.id.id);
  
      case "map-pattern":
        return (p as unknown as ast.MapPatternNode).pairs.every(x => walkPattern(x.pattern));
  
      case "list-pattern":
      case "vector-pattern":
        return (p as unknown as ast.ListPatternNode).elements.every(x => walkPattern(x));
  
      default:
        return true;
    }
  };
  node.cases.every(x => walkPattern(x.pattern));
  return predefinedVariables;
}


function formatVariable(scope: ScopeType, mut: boolean, name: string, value: string, context: CompilationContext) {
  const kw = mut ? "let" : "const";
  const va = !!value ? ` = ${value}` : "";
  const format = {
    [ScopeType.program]: () => `${kw} ${name}${va};`,
    [ScopeType.function]: () => `${kw} ${name}${va};`,
    [ScopeType.method]: () => `${kw} ${name}${va};`,
    [ScopeType.match]: () => `${name}${va}`,
    [ScopeType.when]: () => `${name}${va}`,
    [ScopeType.if]: () => `${name}${va}`,
    [ScopeType.class]: () => `${name}${va};`,
    [ScopeType.interface]: () => `${kw} ${name}${va};`,
    [ScopeType.variable]: () => `${name}${va}`,
  };

  if (!format[scope]) {
    throw new Error(`${scope} is not defined for variable formatting`);
  }

  context.log(LogLevel.Debug, `Formatting variable ${name} in the scope of ${scope}`);

  return format[scope]();
}

function formatFunction(scope: ScopeType, async: boolean, name: string, params: string, body: string[], context: CompilationContext) {
  const kw = async ? "async " : "";
  const arrowFuncName = !!name ? `const ${name} =` : "";

  const format = {
    [ScopeType.program]: () => `${kw} function ${name ?? ""}(${params}) {\n${body.join(";\n")}\n}`,
    [ScopeType.function]: () => `${arrowFuncName} ${kw} (${params}) => {\n${body.join(";\n")}\n}`,
    [ScopeType.method]: () => `${arrowFuncName} ${kw} (${params}) => {\n${body.join(";\n")}\n}`,
    [ScopeType.match]: () => `(${name} = ${kw} (${params}) => {\n${body.join(";\n")}\n})`,
    [ScopeType.when]: () => `(${name} = ${kw} (${params}) => {\n${body.join(";\n")}\n})`,
    [ScopeType.if]: () => `(${name} = ${kw} (${params}) => {\n${body.join(";\n")}\n})`,
    [ScopeType.class]: () => `${kw} ${name}(${params}) {\n${body.join(";\n")}\n}`,
    [ScopeType.interface]: () => `${kw} ${name}(${params});`,
    [ScopeType.variable]: () => `(${name} = ${kw} (${params}) => {\n${body.join(";\n")}\n})`,
  };

  if (!format[scope]) {
    throw new Error(`${scope} is not defined for function formatting`);
  }

  context.log(LogLevel.Debug, `Formatting function ${name} in the scope of ${scope}`);

  return format[scope]();
}

export class JSCompilerAstVisitorGptVer extends BaseAstVisitor {
  scope: ScopeType[] = [ ScopeType.program ];
  functions: string[] = [];
  classes: string[] = [];
  variables: string[] = [];
  identifiers: Record<string, string> = {};

  pushScope(nextScope: ScopeType) {
    this.context.log(LogLevel.Debug, `Scope pushed ${this.currentScope()} -> ${nextScope}`);
    this.scope.unshift(nextScope);
    this.context.log(LogLevel.Debug, this.scope);
  }

  popScope() {
    const val = this.scope.shift();
    this.context.log(LogLevel.Debug, `Scope popped ${val} -> ${this.currentScope()} `);
    this.context.log(LogLevel.Debug, this.scope);
    return val;
  }

  currentScope(): ScopeType {
    return this.scope.at(0)!;
  }

  inScope(...scope: ScopeType[]) {
    return scope.includes(this.currentScope());
  }

  compile(root: ast.ASTNode) {
    const compilationStart = new Date();
    const js = this.visit(root);

    return (
      `// Module: ${this.context.mainModule}\n` +
      `// File: ${this.context.dependencyGraph.rootUnit.path}\n` +
      `// Compiled at: ${compilationStart}\n` +
      `"use strict"\n\n` +
      `${js}`
    );
  }

  visitProgram(node: ast.ProgramNode) {
    // this.context.log(LogLevel.Verbose, node);
    return node.program.map(n => this.visit(n)).join(";\n");
  }

  visitImport(node: ast.ImportNode) {
    // TODO: ...
  }

  visitExport(node: ast.ExportNode) {
    // TODO: ...
  }

  visitTypeName(node: ast.TypeNameNode) {
    return node.name;
  }

  visitUnionType(node: ast.UnionTypeNode) {
    const types = node.types.map((t) => this.visit(t));
    return types.join(" | ");
  }

  visitIntersectionType(node: ast.IntersectionTypeNode) {
    const types = node.types.map((t) => this.visit(t));
    return types.join(" & ");
  }

  visitSimpleType(node: ast.SimpleTypeNode) {
    return this.visit(node.name);
  }

  visitGenericType(node: ast.GenericTypeNode) {
    const name = this.visit(node.name);
    const generic = this.visit(node.generic);
    return `${name}<${generic}>`;
  }

  visitMapType(node: ast.MapTypeNode) {
    const keys = node.keys.map((k) => this.visit(k)).join(",");
    return `{ ${keys} }`;
  }

  visitMappedType(node: ast.MappedTypeNode) {
    const mapping = this.visit(node.mapping);
    return `{ ${mapping} }`;
  }

  visitFieldModifier(node: ast.FieldModifierNode) {
    return node.modifier;
  }

  visitParameterModifier(node: ast.ParameterModifierNode) {
    return node.modifier;
  }

  visitFunctionCarrying(node: ast.FunctionCarryingNode) {
    const id = this.visit(node.identifier);
    let code = id;
    node.sequence.forEach((seqItem) => {
      const fn = this.visit(seqItem.function);
      const args = seqItem.arguments.map((a) => this.visit(a));
      if (seqItem._type === "function-carrying-left") {
        code = `${fn}(${code}${args.length ? "," + args.join(",") : ""})`;
      } else if (seqItem._type === "function-carrying-right") {
        code = `${fn}(${args.join(",")}${args.length ? "," : ""}${code})`;
      }
    });
    return code;
  }

  visitFunctionCarryingLeft(node: ast.FunctionCarryingLeftNode) {
    // This method might not be directly called as it's handled within visitFunctionCarrying
    return "";
  }

  visitFunctionCarryingRight(node: ast.FunctionCarryingRightNode) {
    // This method might not be directly called as it's handled within visitFunctionCarrying
    return "";
  }

  visitClass(node: ast.ClassNode) {
    this.pushScope(ScopeType.class);

    const name = this.visit(node.name);
    const accessModifiers = node.access
      .map((a) => this.visit(a))
      .join(" ");
    const extendsClause = node.extends
      ? ` extends ${this.visit(node.extends)}`
      : "";
    const implementsClause =
      node.implements && node.implements.length > 0
        ? ` implements ${node.implements
            .map((i) => this.visit(i))
            .join(",")}`
        : "";

    // Initialize arrays
    const ctorVars = [];
    const classFields = [];
    const methods = [];
    const otherBody = [];

    // Process body
    for (let b of node.body.map((x: any) => x.nodes).flat(2)) {
      if (b._type === "variable") {
        const accessModifiers = b.modifiers
          .filter((m: any) => m._type === "access-modifier")
          .map((m: any) => m.modifier);
        const fieldModifiers = b.modifiers
          .filter((m: any) => m._type === "field-modifier")
          .map((m: any) => m.modifier);
        if (fieldModifiers.includes("ctor")) {
          ctorVars.push({ ...b, accessModifiers, fieldModifiers });
        } else {
          classFields.push({ ...b, accessModifiers, fieldModifiers });
        }
      } else if (b._type === "function") {
        methods.push(b);
      } else {
        otherBody.push(b);
      }
    }

    // Generate constructor
    let constructorCode = "";
    if (ctorVars.length > 0) {
      const params = ctorVars.map((v) => this.visit(v.name)).join(",");
      const assignments = ctorVars
        .map((v) => {
          this.pushScope(ScopeType.variable);
          let fieldName = this.visit(v.name);
          const paramName = fieldName;
          if (v.accessModifiers.includes("private")) {
            fieldName = `#${fieldName}`;
          }
          this.popScope();
          return `this.${fieldName} = ${paramName};`;
        })
        .join("\n");
      constructorCode = `constructor(${params}) {\n${assignments}\n}`;
    }

    // Generate code for class fields
    this.pushScope(ScopeType.variable);
    const fieldsCode = classFields
      .map((v) => {
        let fieldName = this.visit(v.name);
        const accessModifiers = v.accessModifiers;
        if (accessModifiers.includes("private")) {
          fieldName = `#${fieldName}`;
        }
        let valueCode = v.value ? ` = ${this.visit(v.value)};` : ";";

        // Handle field modifiers
        let modifierComments = "";
        if (v.fieldModifiers.includes("readonly")) {
          modifierComments += "// readonly\n";
        }
        if (v.fieldModifiers.includes("nullable")) {
          modifierComments += "// nullable\n";
        }

        return `${modifierComments}${fieldName}${valueCode}`;
      })
      .join("\n");
    this.popScope();

    // Generate code for methods
    this.pushScope(ScopeType.method);
    const methodsCode = methods
      .map((m) => {
        const name = this.visit(m.name);
        return `${m.async ? "async " : ""}${name}(${m.params
          .map((x: any) => this.visit(x))
          .join(",")}) {\n${m.body
          .map((x: any) => this.visit(x))
          .join("\n")}\n}`;
      })
      .join("\n");
    this.popScope();

    // Generate code for other body elements
    const otherBodyCode = otherBody.map((b) => this.visit(b)).join("\n");

    // Combine all parts
    const classBodyCode = [
      fieldsCode,
      constructorCode,
      methodsCode,
      otherBodyCode,
    ]
      .filter((s) => s)
      .join("\n");

    this.classes.push(name);
    this.popScope();

    return `${
      accessModifiers ? accessModifiers + " " : ""
    }class ${name}${extendsClause}${implementsClause} {\n${classBodyCode}\n}`;
  }

  visitInterface(node: ast.InterfaceNode) {
    this.pushScope(ScopeType.interface);

    const name = this.visit(node.name);
    const accessModifiers = node.access
      .map((a) => this.visit(a))
      .join(" ");
    // TODO: Add implements
    // const implementsClause = node.implements
    //   ? ` implements ${this.visitAstNode(node.implements)}`
    //   : "";
    const implementsClause = "";
    const body = node.body.map((b) => this.visit(b)).join("\n");

    this.popScope();
    return `${accessModifiers} interface ${name}${implementsClause} {\n${body}\n}`;
  }

  visitAccessModifier(node: ast.AccessModifierNode) {
    return node.modifier;
  }

  visitImplements(node: any) {
    return this.visit(node.type);
  }

  visitExtends(node: any) {
    return this.visit(node.type);
  }

  visitConstraintImplements(node: ast.ConstraintImplementsNode) {
    const type = this.visit(node.type);
    return `/* implements ${type} */`;
  }

  visitConstraintInherits(node: ast.ConstraintInheritsNode) {
    const type = this.visit(node.type);
    return `/* inherits ${type} */`;
  }

  visitConstraintIs(node: ast.ConstraintIsNode) {
    const type = this.visit(node.type);
    return `/* is ${type} */`;
  }

  visitConstraintHas(node: ast.ConstraintHasNode) {
    const name = this.visit(node.name);
    return `/* has ${name} */`;
  }

  visitMatchCase(node: ast.MatchCaseNode) {
    const pattern = this.visit(node.pattern);
    const body = this.visit(node.body);
    return { pattern, body };
  }

  visitListPattern(node: ast.ListPatternNode) {
    const elements = node.elements.map((e) => this.visit(e));
    return `[${elements.join(",")}]`;
  }

  visitVectorPattern(node: ast.VectorPatternNode) {
    const elements = node.elements.map((e) => this.visit(e));
    return `[${elements.join(",")}]`;
  }

  visitMapPattern(node: ast.MapPatternNode) {
    const pairs = node.pairs.map((p) => this.visit(p));
    return `{ ${pairs.join(",")} }`;
  }

  visitMapPatternPair(node: ast.MapPatternPairNode) {
    const key = this.visit(node.key);
    const pattern = this.visit(node.pattern);
    return `${key}: ${pattern}`;
  }

  visitControlComment(node: ast.ControlCommentNode) {
    const mode = node.mode;
    const command = node.command;
    const options = node.options.join(" ");
    return `// ${mode}${command} ${options}`;
  }

  visitString(node: ast.StringNode) {
    return `"${node.value}"`;
  }

  visitFormattedString(node: ast.FormattedStringNode) {
    const value = node.value.map((x) =>
      x._type === "string" ? x.value : this.visit(x)
    );
    return "`" + value.join("") + "`";
  }

  visitFormatExpression(node: ast.FormatExpressionNode) {
    return "${" + this.visit(node.expression) + "}";
  }

  visitIdentifier(node: ast.IdentifierNode) {
    if (this.identifiers[node.id] !== undefined) {
      return this.identifiers[node.id];
    }
    const id = encodeIdentifier(node.id);
    this.identifiers[node.id] = id;
    return id;
  }

  visitVariable(node: ast.VariableNode) {
    this.pushScope(ScopeType.variable);
    const name = this.visit(node.name);
    const value = this.visit(node.value!);
    this.popScope();

    this.variables.push(name);

    return formatVariable(
      this.currentScope(),
      node.mutable,
      name,
      value,
      this.context!
    );
  }

  visitFunction(node: ast.FunctionNode) {
    this.pushScope(
      this.inScope(ScopeType.class, ScopeType.interface) ? ScopeType.method : ScopeType.function
    );

    const name = node.name && this.visit(node.name);

    const params = node.params.map((x) => this.visit(x)).join(",");
    const body = node.body.map((x) => this.visit(x));

    const result = formatFunction(
      this.currentScope(),
      node.async,
      name,
      params,
      body,
      this.context
    );

    this.functions.push(name);
    this.popScope();

    return result;
  }

  visitFunctionParameter(node: ast.FunctionParameterNode) {
    return this.visit(node.name);
  }

  visitAwait(node: ast.AwaitNode) {
    return `await ${this.visit(node.expression)}`;
  }

  visitWhen(node: ast.WhenNode) {
    this.pushScope(ScopeType.when);

    const condition = this.visit(node.condition);
    const whenExprs = node.then.map((x) => this.visit(x));

    this.popScope();

    if (this.inScope(ScopeType.variable)) {
      return `(${condition}) ? (${whenExprs.join(", ")}) : undefined`;
    }

    return `if (${condition}) {\n${whenExprs.join(";\n")}\n}`;
  }

  visitIf(node: ast.IfNode) {
    this.pushScope(ScopeType.if);

    const condition = this.visit(node.condition);
    const thenExpr = this.visit(node.then);
    const elseExpr = !!node.else ? this.visit(node.else) : "undefined";

    this.popScope();

    return !this.inScope(ScopeType.variable)
      ? `if (${condition}) {\n${thenExpr}\n}${
          !!node.else ? ` else {\n${elseExpr}\n}` : ""
        }`
      : `(${condition}) ? (${thenExpr}) : (${elseExpr})`;
  }

  visitAssignment(node: ast.AssignmentNode) {
    const assignable = this.visit(node.assignable);
    const value = this.visit(node.value);

    return `${assignable} = ${value}`;
  }

  visitTryCatch(node: ast.TryCatchNode) {
    const tryBlock = this.visit(node.try.body);
    // const catchBlock = this.visit()
    const finallyBlock = !!node.finally ? this.visit(node.finally.body) : "";

    try
    {

    }
    catch (e)
    {
      if (e instanceof Error) {

      } else if (e instanceof ErrorEvent) {

      } else if (e instanceof EvalError) {

      }
    }
    finally
    {

    }

    return ``;
  }

  visitMatch(node: ast.MatchNode) {
    this.pushScope(ScopeType.match);

    const matchVar = randomIdentifier();
    const matchVal = this.visit(node.expression);

    const matchCases = node.cases.map((x) => {
      return {
        p: x.pattern,
        b: this.visit(x.body),
      };
    });

    const ifExprs = matchCases.map((x, index) => {
      const condition = this.generateCondition(x.p, matchVar);
      return `(${condition}) ? (${x.b}) :`;
    });

    const predefinedVariables = findIdentifiersToDefine(node);

    this.popScope();

    return `(function (${matchVar}) { let ${predefinedVariables.join(",")}; return ${ifExprs.join(" ")} undefined; })(${matchVal})`;
  }

  generateCondition(pattern: ast.PatternNode, value: string) {
    switch (pattern._type) {
      case "any-pattern":
        return `true`;
      case "identifier-pattern":
        return `(${this.visit(pattern.id)}=${value},true)`;
      case "constant-pattern":
        return `${value} === ${this.visit(pattern.constant)}`;
      case "list-pattern":
        return this.generateListPatternCondition(pattern, value);
      case "vector-pattern":
        return this.generateVectorPatternCondition(pattern, value);
      case "map-pattern":
        return this.generateMapPatternCondition(pattern, value);
      default:
        return `/* pattern matching for ${pattern} not implemented */`;
    }
  }

  generateListPatternCondition(pattern: ast.ListPatternNode, value: string) {
    const conditions = [];
    const elements = pattern.elements;
    conditions.push(`Array.isArray(${value})`);
    conditions.push(`${value}.length===${elements.length}`);

    elements.forEach((elem, idx) => {
      const elemValue = `${value}[${idx}]`;
      const condition = this.generateElementCondition(elem, elemValue);
      if (condition) {
        conditions.push(condition);
      }
    });

    return conditions.join("&&");
  }

  generateVectorPatternCondition(pattern: ast.VectorPatternNode, value: string) {
    // Vectors are similar to lists in this context
    return this.generateListPatternCondition(pattern as unknown as ast.ListPatternNode, value);
  }

  generateMapPatternCondition(pattern: ast.MapPatternNode, value: string) {
    const conditions = [];
    conditions.push(`typeof ${value}==='object'&&${value}!==null`);

    pattern.pairs.forEach((pair) => {
      const key = this.visit(pair.key);
      const elemPattern = pair.pattern;
      const elemValue = `${value}[${key}]`;
      conditions.push(`'${key}' in ${value}`);
      const condition = this.generateElementCondition(elemPattern, elemValue);
      if (condition) {
        conditions.push(condition);
      }
    });

    return conditions.join("&&");
  }

  generateElementCondition(pattern: ast.PatternNode, value: string) {
    switch (pattern._type) {
      case "any-pattern":
        return null; // Always true, no condition needed
      case "identifier-pattern":
        return `(${this.visit(pattern.id)} = ${value}, true)`;
      case "constant-pattern":
        return `${value} === ${this.visit(pattern.constant)}`;
      case "list-pattern":
        return this.generateListPatternCondition(pattern, value);
      case "vector-pattern":
        return this.generateVectorPatternCondition(pattern, value);
      case "map-pattern":
        return this.generateMapPatternCondition(pattern, value);
      default:
        return `/* pattern matching for ${pattern} not implemented */`;
    }
  }

  visitAnyPattern(node: ast.AnyPatternNode) {
    return "_";
  }

  visitIdentifierPattern(node: ast.IdentifierPatternNode) {
    return this.visit(node.id);
  }

  visitConstantPattern(node: ast.ConstantPatternNode) {
    return this.visit(node.constant);
  }

  visitNumber(node: ast.NumberNode) {
    return node.value.toString();
  }

  visitList(node: ast.ListNode) {
    const [fname, ...fargs] = node.nodes;
    const callee = this.visit(fname);
    const args = fargs.map((x) => this.visit(x));
    if (
      fname._type === "simple-identifier" ||
      fname._type === "composite-identifier"
    ) {
      if (this.functions.includes(callee)) {
        return `${callee}(${args.join(",")})`;
      } else if (this.classes.includes(callee)) {
        return `new ${callee}(${args.join(",")})`;
      } else if (this.variables.includes(callee)) {
        if (args.length === 0) {
          return `${callee}`;
        } else {
          return `${callee}(${args.join(",")})`;
        }
      } else if (args.length === 0) {
        return `${callee}`;
      } else {
        return `${callee}(${args.join(",")})`;
      }
    } else {
      if (this.inScope(ScopeType.variable)) {
        return `(${callee}${args.length>0?",":""}${args.join(",")})`;
      }
      return `${callee}${args.length>0?";\n":""}${args.join(";\n")}`;
    }
  }

  visitQuote(node: ast.QuoteNode) {
    if (node.mode === "default") {
      return JSON.stringify(node, (key, val) => key === "_location" ? undefined : val);
    }

    // TODO: This should be a separate pass in the compiler
    const grammar = fs.readFileSync(`./compiler/grammar/extensions/${node.mode}.pegjs`, { encoding: "utf-8" });
    const parser = peggy.generate(grammar);
    const result = parser.parse(node.content!);
    if (!!result._type) {
      return this.visit(result);
    }

    return parser.parse(node.content!);
  }

  visitVector(node: ast.VectorNode) {
    return `[${node.values.map((x) => this.visit(x)).join(",")}]`;
  }

  visitMap(node: ast.MapNode) {
    const kvs = node.values.map((x) => this.visit(x));
    return `{ ${kvs.join(",")} }`;
  }

  visitKeyValue(node: ast.MapKeyValueNode) {
    return `${this.visit(node.key)}: ${this.visit(node.value)}`;
  }

  visitComment(node: ast.CommentNode) {
    return "//" + node.comment;
  }
};
