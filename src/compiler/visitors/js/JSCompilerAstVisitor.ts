import fs from "fs";
import peggy from "peggy";
import * as ast from "../../ast";

import { ScopeType } from "../../SymbolTable";

import { uniqueIdentifier, encodeIdentifier } from "../../utils";
import { BaseAstVisitor } from "../BaseAstVisitor";
import { LogLevel } from "../../Context";
import { ClassBuilder } from "./ClassBuilder";
import { SourceNode } from "source-map";
import { createSourceNode, joinArray, formatVariable, formatFunction } from "./helpers";
import path from "path";


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
  return Array.from(new Set(predefinedVariables));
}

export class JSCompilerAstVisitor extends BaseAstVisitor {
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
    return createSourceNode(root,
        `// Module: ${this.context.mainModule}\n` +
        `// File: ${this.context.dependencyGraph.rootUnit.location.fullName}\n` +
        `// Compiled at: ${new Date()}\n`,
        `"use strict"\n\n`,
        this.visit(root),
        `\n\n//# sourceMappingURL=${path.basename(root._location.source!, '.lisp')}.js.map`)
      .toStringWithSourceMap();
  }

  visitProgram(node: ast.ProgramNode) {
    // this.context.log(LogLevel.Verbose, node);
    return createSourceNode(node, ...joinArray(node.program.map(n => this.visit(n)), ';'));
  }

  visitFunctionCarrying(node: ast.FunctionCarryingNode) {
    const id = this.visit(node.identifier);
    let code = id;
    node.sequence.forEach((seqItem) => {
      const fn = this.visit(seqItem.function);
      const args = seqItem.arguments.map((a) => this.visit(a));
      if (seqItem.operator === "carrying-left") {
        if (seqItem.memberFunction) {
          code = `${code}.${fn}(${args.join(",")})`;
        } else {
          code = `${fn}(${code}${args.length ? "," + args.join(",") : ""})`;
        }
      } else if (seqItem.operator === "carrying-right") {
        if (seqItem.memberFunction) {
          code = `${code}.${fn}(${args.join(",")})`;
        } else {
          code = `${fn}(${args.join(",")}${args.length ? "," : ""}${code})`;
        }
      }
    });
    return createSourceNode(node, code);
  }

  visitClass(node: ast.ClassNode) {
    this.pushScope(ScopeType.class);

    const classBuilder = new ClassBuilder(node, this.context, this);
    const result = classBuilder.build();

    this.classes.push(node.name.name);
    this.popScope();

    return result;
  }

  visitInterface(node: ast.InterfaceNode) {
    this.pushScope(ScopeType.interface);

    const name = this.visit(node.name);
    const accessModifiers = node.modifiers
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

  visitMatchCase(node: ast.MatchCaseNode) {
    const pattern = this.visit(node.pattern);
    const body = this.visit(node.body);
    return { pattern, body };
  }

  visitListPattern(node: ast.ListPatternNode) {
    const elements = node.elements.map((e) => this.visit(e));
    return createSourceNode(node, '[', ...joinArray(elements, ','), ']');
    // return `[${elements.join(",")}]`;
  }

  visitVectorPattern(node: ast.VectorPatternNode) {
    const elements = node.elements.map((e) => this.visit(e));
    return createSourceNode(node, '[', ...joinArray(elements, ','), ']');
    // return `[${elements.join(",")}]`;
  }

  visitMapPattern(node: ast.MapPatternNode) {
    const pairs = node.pairs.map((p) => this.visit(p));
    return createSourceNode(node, '{', ...joinArray(pairs, ','), '}');
    // return `{ ${pairs.join(",")} }`;
  }

  visitFunctionalPattern(node: ast.FunctionalPatternNode) {
    return createSourceNode(node, '// not implemented');
  }

  visitTypePattern(node: ast.TypePatternNode) {
    return createSourceNode(node, '// not implemented');
  }

  visitMapPatternPair(node: ast.MapPatternPairNode) {
    const key = this.visit(node.key);
    const pattern = this.visit(node.pattern);
    return createSourceNode(node, key, ': ', pattern);
  }

  visitControlComment(node: ast.ControlCommentNode) {
    const mode = node.mode;
    const command = node.command;
    const options = node.options.join(" ");
    return createSourceNode(node, `// ${mode}${command} ${options}`);
  }

  visitString(node: ast.StringNode) {
    return createSourceNode(node, `"`, node.value, `"`);
  }

  visitFormattedString(node: ast.FormattedStringNode) {
    const value = node.value.map((x) =>
      x._type === "string" ? x.value : this.visit(x)
    );
    return createSourceNode(node, "`", ...value, "`");
  }

  visitFormatExpression(node: ast.FormatExpressionNode) {
    return createSourceNode(node, "${formatObjectToString(", this.visit(node.expression), ")}");
  }

  visitSimpleIdentifier(node: ast.SimpleIdentifierNode) {
    return this.visitIdentifier(node);
  }

  visitCompositeIdentifier(node: ast.CompositeIdentifierNode) {
    return this.visitIdentifier(node);
  }

  visitIdentifier(node: ast.IdentifierNode) {
    if (this.identifiers[node.id] !== undefined) {
      return this.identifiers[node.id];
    }
    const id = encodeIdentifier(node.id);
    this.identifiers[node.id] = id;

    return createSourceNode(node, id);
  }

  visitVariable(node: ast.VariableNode) {
    this.pushScope(ScopeType.variable);
    const name = this.visit(node.name);
    const value = !!node.value ? this.visit(node.value) : undefined;
    this.popScope();

    this.variables.push(name.toString());

    return createSourceNode(node,
      formatVariable(
        this.currentScope(),
        node,
        node.mutable,
        name,
        value,
        this.context!
      ));
  }

  visitFunction(node: ast.FunctionNode) {
    this.pushScope(
      this.inScope(ScopeType.class, ScopeType.interface) ? ScopeType.method : ScopeType.function
    );

    const name = node.name && this.visit(node.name);

    const params = node.params.map((x) => this.visit(x));
    const body = node.body.map((x) => this.visit(x));

    this.popScope();

    const result = formatFunction(
      this.currentScope(),
      node,
      node.async,
      name,
      params,
      body,
      this.context
    );

    if (node.name) {
      this.functions.push(name.toString());
    }

    return createSourceNode(node, result);
  }

  visitParameter(node: ast.ParameterNode) {
    return this.visit(node.name);
  }

  visitAwait(node: ast.AwaitNode) {
    return createSourceNode(node, `await `, this.visit(node.expression));
  }

  visitWhen(node: ast.WhenNode) {
    this.pushScope(ScopeType.when);

    const condition = this.visit(node.condition!);
    const whenExprs = node.then!.map((x) => this.visit(x));

    this.popScope();

    const result = this.inScope(ScopeType.variable)
      ? [`(`, condition, `) ? (`, ...joinArray(whenExprs, ','), `) : undefined`]
      : [`if (`, condition, `) {\n`, ...joinArray(whenExprs, ';'), `\n}`];

    return createSourceNode(node, ...result);
  }

  visitIf(node: ast.IfNode) {
    this.pushScope(ScopeType.if);

    const condition = this.visit(node.condition!);
    const thenExpr = this.visit(node.then!);
    const elseExpr = !!node.else ? this.visit(node.else!) : "undefined";

    this.popScope();

    const result = !this.inScope(ScopeType.variable, ScopeType.when, ScopeType.match)
      ? [`if (`, condition, `) {`, thenExpr, `}`, ...(!!node.else ? [` else {`, elseExpr, `}`] : [])]
      : [`(${condition}) ? (${thenExpr}) : (${elseExpr})`];

    return createSourceNode(node, ...result);
  }

  visitWhile(node: ast.WhileNode) {
    const condition = this.visit(node.condition);
    const body = this.visit(node.then);
    return createSourceNode(node, `while (`, condition, `) {`, body, `}`);
  }

  visitSimpleAssignment(node: ast.SimpleAssignmentNode) {
    const assignable = this.visit(node.assignable);
    const value = this.visit(node.value);

    return createSourceNode(node, assignable, ` = `, value);
  }

  visitCompoundAssignment(node: ast.CompoundAssignmentNode) {
    const assignable = this.visit(node.assignable);
    const operator = node.operator;
    const value = this.visit(node.value);

    return createSourceNode(node, assignable, ` = `, value);
  }

  visitBoolean(node: ast.BooleanNode) {
    return createSourceNode(node, node.value.toString());
  }

  visitTryCatch(node: ast.TryCatchNode) {
    const tryBlock = [ `try {`, this.visit(node.try), `}` ];
    const catchVar = uniqueIdentifier();
    const catchBlocks = node.catch?.filter(x => !!x.filter)?.map(x => {
      const catchFilterVar = this.visit(x.filter.name);
      const catchFilterType = this.visit(x.filter.type);
      const catchBody = this.visit(x.body);
      return [`if (`, catchVar, ` instanceof `, catchFilterType, `) {`, formatVariable(this.currentScope(), node, false, catchFilterVar, createSourceNode(node, catchVar), this.context), `;`, catchBody];
    });

    const defaultCatchBlock = node.catch?.filter(x => !x.filter).map(x => this.visit(x.body)) ?? [`throw `, catchVar];
    const catchBlock = !!node.catch ? [` catch (`, catchVar, `) {`, ...joinArray(catchBlocks, ' else '), ' ', !!catchBlocks ? "else" : "", ' ', defaultCatchBlock, `}}`] : [];
    const finallyBlock = !!node.finally ? [` finally {`, this.visit(node.finally), `}`] : [];

    return createSourceNode(node, ...tryBlock, ...catchBlock, ...finallyBlock);
  }

  visitMatch(node: ast.MatchNode) {
    this.pushScope(ScopeType.match);

    const matchVar = uniqueIdentifier();
    const matchVal = this.visit(node.expression);

    const matchCases = node.cases.map((x) => {
      return {
        p: x.pattern,
        b: this.visit(x.body),
      };
    });

    const ifExprs = matchCases.map((x, index) => {
      const condition = this.generateCondition(x.p, matchVar);
      return createSourceNode(x.p, '(', condition, ')', '?', '(', x.b, ')');
    });

    const predefinedVariables = findIdentifiersToDefine(node);
    const predefinedVarsCode = predefinedVariables.length > 0
      ? `let ${joinArray(predefinedVariables, ',')};`
      : '';

    this.popScope();

    return createSourceNode(node, `(function (`, matchVar, `) { `, predefinedVarsCode, 'return ', ...joinArray(ifExprs, ' : '), ' : undefined;', '})(', matchVal, `)`);
  }

  generateCondition(pattern: ast.PatternNode, value: string) {
    switch (pattern._type) {
      case "any-pattern":
        return createSourceNode(pattern, `true`);
      case "identifier-pattern":
        return createSourceNode(pattern, `(`, this.visit(pattern.id), '=', value, `,true)`);
      case "constant-pattern":
        return createSourceNode(pattern, value, ' === ', this.visit(pattern.constant));
      case "list-pattern":
        return createSourceNode(pattern, ...this.generateListPatternCondition(pattern, value));
      case "vector-pattern":
        return createSourceNode(pattern, ...this.generateVectorPatternCondition(pattern, value));
      case "map-pattern":
        return createSourceNode(pattern, this.generateMapPatternCondition(pattern, value));
      default:
        return createSourceNode(pattern, `/* pattern matching for ${pattern} not implemented */`);
    }
  }

  generateListPatternCondition(pattern: ast.ListPatternNode, value: string) {
    const conditions = [];
    const elements = pattern.elements;

    conditions.push(`Array.isArray(${value})`);
    conditions.push(`${value}.length === ${elements.length}`);

    elements.forEach((elem, idx) => {
      const elemValue = `${value}[${idx}]`;
      const condition = this.generateElementCondition(elem, elemValue);
      if (condition) {
        conditions.push(condition);
      }
    });

    return joinArray(conditions, " && ");
  }

  generateVectorPatternCondition(pattern: ast.VectorPatternNode, value: string) {
    // Vectors are similar to lists in this context
    return this.generateListPatternCondition(pattern as unknown as ast.ListPatternNode, value);
  }

  generateMapPatternCondition(pattern: ast.MapPatternNode, value: string) {
    const conditions = [];
    conditions.push(`typeof ${value} === 'object' && ${value} !==null`);

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
        return createSourceNode(pattern, 'true'); // Always true, no condition needed
      case "identifier-pattern":
        return createSourceNode(pattern, `(`, this.visit(pattern.id), ' = ', value, ',true)');
      case "constant-pattern":
        return createSourceNode(pattern, value, ' === ', this.visit(pattern.constant));
      case "list-pattern":
        return createSourceNode(pattern, ...this.generateListPatternCondition(pattern, value));
      case "vector-pattern":
        return createSourceNode(pattern, ...this.generateVectorPatternCondition(pattern, value));
      case "map-pattern":
        return createSourceNode(pattern, this.generateMapPatternCondition(pattern, value));
      default:
        return createSourceNode(pattern, `/* pattern matching for ${pattern} not implemented */`);
    }
  }

  visitAnyPattern(node: ast.AnyPatternNode) {
    return createSourceNode(node, "_");
  }

  visitIdentifierPattern(node: ast.IdentifierPatternNode) {
    return createSourceNode(node, this.visit(node.id));
  }

  visitConstantPattern(node: ast.ConstantPatternNode) {
    return createSourceNode(node, this.visit(node.constant));
  }

  visitIntegerNumber(node: ast.IntegerNumberNode) {
    return createSourceNode(node, node.value.toString());
  }

  visitFloatNumber(node: ast.FloatNumberNode) {
    return createSourceNode(node, node.value.toString());
  }

  visitFractionNumber(node: ast.FractionNumberNode) {
    return createSourceNode(node, `(${node.numerator}/${node.denominator})`);
  }

  visitHexNumber(node: ast.HexNumberNode) {
    return createSourceNode(node, `0x${node.value.toString(16)}`);
  }

  visitOctalNumber(node: ast.OctalNumberNode) {
    return createSourceNode(node, `0o${node.value.toString(8)}`);
  }

  visitBinaryNumber(node: ast.BinaryNumberNode) {
    return createSourceNode(node, `0b${node.value.toString(2)}`);
  }

  visitList(node: ast.ListNode) {
    if (node.nodes.length === 0) {
      return "";
    }

    const calleeType = node.nodes[0]._type;
    const nodes = node.nodes.map(x => this.visit(x));
    const [callee, ...args] = nodes;

    if (
      calleeType === "simple-identifier" ||
      calleeType === "composite-identifier"
    ) {
      if (this.functions.includes(callee.toString())) {
        return createSourceNode(node, callee, '(', ...joinArray(args, ","), ')');
      } else if (this.classes.includes(callee.toString())) {
        return createSourceNode(node, 'new ', callee, '(', ...joinArray(args, ","), ')');
      } else if (this.variables.includes(callee.toString())) {
        if (args.length === 0) {
          return createSourceNode(node, callee);
        } else {
          return createSourceNode(node, callee, '(', ...joinArray(args, ","), ')');
        }
      } else if (args.length === 0) {
        return createSourceNode(node, callee);
      } else {
        return createSourceNode(node, callee, '(', ...joinArray(args, ","), ')');
      }
    } else {
      if (this.inScope(ScopeType.variable)) {
        return createSourceNode(node, '(', ...joinArray(nodes.filter(x => !!x), ","), ')');
      }
        return createSourceNode(node, ...joinArray(nodes.filter(x => !!x), ";"));
    }
  }

  visitQuote(node: ast.QuoteNode) {
    if (node.mode !== "default") {
      return createSourceNode(node, `undefined`, `/* Quote mode '${node.mode}' unsupported */`)
    }

    return createSourceNode(node, JSON.stringify(node, (key, val) => ["_location", "_parent"].includes(key) ? undefined : val));
  }

  visitVector(node: ast.VectorNode) {
    return createSourceNode(node, '[', ...joinArray(node.values.map((x) => this.visit(x)), ","), ']');
  }

  visitMap(node: ast.MapNode) {
    return createSourceNode(node, '{', ...joinArray(node.values.map((x) => this.visit(x)), ","), '}');
  }

  visitKeyValue(node: ast.KeyValueNode) {
    return createSourceNode(node, this.visit(node.key), ': ', this.visit(node.value));
  }

  visitComment(node: ast.CommentNode) {
    return createSourceNode(node, `// ${node.comment}`, `\n`);
  }
};
