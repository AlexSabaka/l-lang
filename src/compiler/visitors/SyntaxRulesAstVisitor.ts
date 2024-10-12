import chalk from "chalk";

import * as ast from "../ast";
import { BaseAstVisitor } from "./BaseAstVisitor";
import { LogLevel } from "../CompilationContext";

function formatMessage(node: ast.ASTNode, code: string, message: string) {
  const textLength = node._location.text?.length ?? 0;
  const trimmedStartText = node._location.text?.trimStart() ?? "";
  const startColumn = node._location.start.column + (textLength - trimmedStartText.length);
  const startLine = node._location.start.line;
  const tab = '    ';
  const lines = trimmedStartText.trimEnd().split('\n')
    .filter(x => x.trim().length > 0)
    .map(x => tab + chalk.redBright(x));
  const exceptLastLine = lines.slice(0, -1).join('\n');
  const lastLine = lines.at(-1);
  const totalLineLength = process.stdout.columns;
  const atSource = `at ${node._location.source}:${startLine}:${startColumn}`;
  const padding = '.'.repeat(totalLineLength - atSource.length - (lastLine?.length ?? 0));

  return (
    `${code}: ${message}\n` +
    `${exceptLastLine}${lines.length > 1 ? '\n' : ''}` +
    `${lastLine}${chalk.dim.gray(padding)}${atSource}`
  );
}

function isFunctionNode(node: ast.ASTNode): node is ast.FunctionNode {
  return node._type === "function";
}

function isVariableNode(node: ast.ASTNode): node is ast.VariableNode {
  return node._type === "variable";
}

export class SyntaxRulesAstVisitor extends BaseAstVisitor {
  public errors: number = 0;
  public warnings: number = 0;

  private error(node: ast.ASTNode | string, code?: string | undefined, message?: string | undefined) {
    this.errors++;
    if (typeof node === 'string' && code === undefined && message === undefined) {
      this.context.log(LogLevel.Error, node);
    } else {
      this.context.log(LogLevel.Error, formatMessage(node as ast.ASTNode, code!, message!));
    }
  }

  private warning(node: ast.ASTNode, code: string, message: string) {
    this.warnings++;
    this.context.log(LogLevel.Warning, formatMessage(node, code, message));
  }

  visitProgram(node: ast.ProgramNode) {
    node.program.forEach((x) => this.visit(x));
  }

  visitList(node: ast.ListNode) {
    node.nodes.forEach((x) => this.visit(x));
  }

  visitFunction(node: ast.FunctionNode) {
    if (node.extern && node.body && node.body.length > 0) {
      this.error(node, "LL0012", "Extern function cannot have a body");
    }
    // Visit parameters
    node.params.forEach((param) => this.visit(param));
    // Visit return type
    if (node.ret) {
      this.visit(node.ret);
    }
    // Visit function modifiers
    node.modifiers.forEach((modifier) => this.visit(modifier));
    // Visit function body
    node.body.forEach((stmt) => this.visit(stmt));
  }

  visitFunctionParameter(node: ast.FunctionParameterNode) {
    if (!node.name) {
      this.error(node, "LL0008", "Function parameter must have a name.");
    }
    // Visit parameter type
    if (node.type) {
      this.visit(node.type);
    }
    // Visit parameter modifiers
    node.modifiers.forEach((modifier) => this.visit(modifier));
  }

  // visitFunctionModifier(node: ast.FunctionModifierNode) {
  //   const validModifiers = ["extern", "override", "extension", "operator"];
  //   if (!validModifiers.includes(node.modifier)) {
  //     this.error(node, "LL0015", `Invalid function modifier '${node.modifier}'.`);
  //   }
  // }

  visitInterface(node: ast.InterfaceNode) {
    const body = node.body.flatMap((x) => (x as ast.ListNode)?.nodes ?? [x]);

    [
      ...body
        .filter((x) => !ast.isNode<ast.VariableNode>(x)
                    && !ast.isNode<ast.FunctionNode>(x))
        .map(
          (x) =>
            [
              x._location.start.offset,
              formatMessage(
                x,
                "LL0015",
                "Invalid interface member."
              ),
            ] as [number, string]
        ),
      ...body
        .filter((x) => ast.isNode<ast.VariableNode>(x) && !!x.value)
        .map(
          (x) =>
            [
              x._location.start.offset,
              formatMessage(
                x,
                "LL0011",
                "Interface members cannot have initializers."
              ),
            ] as [number, string]
        ),
      ...body
        .filter((x) => ast.isNode<ast.FunctionNode>(x) && x.extern)
        .map(
          (x) =>
            [
              x._location.start.offset,
              formatMessage(x, "LL0012", "Interface members cannot be extern."),
            ] as [number, string]
        ),
      ...body
        .filter((x) => ast.isNode<ast.FunctionNode>(x) && !!x.body && x.body.length > 0)
        .map(
          (x) =>
            [
              x._location.start.offset,
              formatMessage(
                x,
                "LL0013",
                "Interface members cannot have body declarations."
              ),
            ] as [number, string]
        ),
    ]
    .sort((a, b) => a[0] - b[0])
    .forEach((x) => this.error(x[1]));

    // Visit interface body members
    body.forEach((member) => this.visit(member));
  }

  visitTryCatch(node: ast.TryCatchNode) {
    if (node.catch.length === 0 && !node.finally) {
      this.error(
        node,
        "LL0003",
        "Try-Catch-Finally statement must have either catch or finally block."
      );
    }

    if (node.catch.length > 0 && node.catch.filter((x) => !x.filter).length > 1) {
      this.error(node, "LL0004", "Only one default catch block is allowed.");
    }

    // Visit try block
    this.visit(node.try.body);

    // Visit catch blocks
    node.catch.forEach((catchBlock) => {
      if (catchBlock.filter) {
        // Visit catch filter
        if (catchBlock.filter.type) {
          this.visit(catchBlock.filter.type);
        }
      }
      // Visit catch body
      this.visit(catchBlock.body);
    });

    // Visit finally block
    if (node.finally) {
      this.visit(node.finally.body);
    }
  }

  visitVariable(node: ast.VariableNode) {
    // Variable declaration must have a name
    if (!node.name) {
      this.error(node, "LL0005", "Variable declaration must have a name.");
    }

    // Mutable variable must have an initializer
    if (node.mutable && !node.value) {
      this.error(node, "LL0021", "Mutable variable must have an initializer.");
    }

    // Visit variable modifiers
    node.modifiers.forEach((modifier) => this.visit(modifier));

    // Visit variable type
    if (node.type) {
      this.visit(node.type);
    }

    // Visit variable value
    if (node.value) {
      this.visit(node.value);
    }
  }

  visitFieldModifier(node: ast.FieldModifierNode) {
    const validModifiers = ["readonly", "nullable", "ctor"];
    if (!validModifiers.includes(node.modifier)) {
      this.error(node, "LL0012", `Invalid field modifier '${node.modifier}'.`);
    }
  }

  visitParameterModifier(node: ast.ParameterModifierNode) {
    const validModifiers = ["in", "out", "ref"];
    if (!validModifiers.includes(node.modifier)) {
      this.error(node, "LL0014", `Invalid parameter modifier '${node.modifier}'.`);
    }
  }

  visitClass(node: ast.ClassNode) {
    if (!node.name) {
      this.error(node, "LL0006", "Class declaration must have a name.");
    }
    // Visit access modifiers
    node.access.forEach((accessModifier) => this.visit(accessModifier));
    // Visit implements and extends
    node.implements.forEach((impl) => this.visit(impl));
    node.extends.forEach((ext) => this.visit(ext));
    // Visit generics
    node.generics?.forEach((generic) => this.visit(generic));
    // Visit class body
    node.body.forEach((member) => this.visit(member));
  }

  visitAccessModifier(node: ast.AccessModifierNode) {
    const validModifiers = ["public", "private", "static", "internal"];
    if (!validModifiers.includes(node.modifier)) {
      this.error(node, "LL0013", `Invalid access modifier '${node.modifier}'.`);
    }
  }

  visitImplements(node: ast.ImplementsNode) {
    this.visit(node.type);
  }

  visitExtends(node: ast.ExtendsNode) {
    this.visit(node.type);
  }

  visitAssignment(node: ast.AssignmentNode) {
    // Visit assignable
    this.visit(node.assignable);
    // Visit value
    this.visit(node.value);
  }

  visitIndexer(node: ast.IndexerNode) {
    // Visit identifier and index
    this.visit(node.id);
    this.visit(node.index);
  }

  visitAwait(node: ast.AwaitNode) {
    // Visit expression
    this.visit(node.expression);
  }

  visitWhen(node: ast.WhenNode) {
    this.visit(node.condition);
    if (node.then.length === 0) {
      this.error(node, "LL0016", "When statement must have a 'then' clause.");
    }
    node.then.forEach((stmt) => this.visit(stmt));
  }

  visitIf(node: ast.IfNode) {
    this.visit(node.condition);
    if (!node.then) {
      this.error(node, "LL0017", "If statement must have a 'then' clause.");
    }
    this.visit(node.then);
    if (node.else) {
      this.visit(node.else);
    }
  }

  visitMatch(node: ast.MatchNode) {
    this.visit(node.expression);
    if (node.cases.length === 0) {
      this.error(node, "LL0018", "Match statement must have at least one case.");
    }
    node.cases.forEach((matchCase) => this.visit(matchCase));
  }

  visitMatchCase(node: ast.MatchCaseNode) {
    this.visit(node.pattern);
    this.visit(node.body);
  }

  visitAnyPattern(node: ast.AnyPatternNode) {
    // Nothing to visit
  }

  visitListPattern(node: ast.ListPatternNode) {
    node.elements.forEach((element) => this.visit(element));
  }

  visitVectorPattern(node: ast.VectorPatternNode) {
    node.elements.forEach((element) => this.visit(element));
  }

  visitMapPattern(node: ast.MapPatternNode) {
    node.pairs.forEach((pair) => this.visit(pair));
  }

  visitMapPatternPair(node: ast.MapPatternPairNode) {
    this.visit(node.key);
    this.visit(node.pattern);
  }

  visitIdentifierPattern(node: ast.IdentifierPatternNode) {
    // Visit identifier
    this.visit(node.id);
  }

  visitConstantPattern(node: ast.ConstantPatternNode) {
    // Visit constant value
    this.visit(node.constant);
  }

  visitString(node: ast.StringNode) {
    // Nothing to do for raw strings
  }

  visitFormattedString(node: ast.FormattedStringNode) {
    node.value.forEach((item) => this.visit(item));
  }

  visitFormatExpression(node: ast.FormatExpressionNode) {
    this.visit(node.expression);
  }

  visitIdentifier(node: ast.IdentifierNode) {
    if (!node.id) {
      this.error(node, "LL0019", "Identifier must have a name.");
    }
  }

  visitImport(node: ast.ImportNode) {
    node.imports.forEach((importDef) => {
      if (importDef.symbols) {
        importDef.symbols.forEach((symbol) => {
          if (!symbol.symbol) {
            this.error(node, "LL0009", "Import symbol must have a name.");
          }
          if (symbol.as) {
            this.visit(symbol.as);
          }
        });
      }
      if (!importDef.source) {
        this.error(node, "LL0010", "Import must have a source.");
      } else {
        // Visit import source
        if (importDef.source.file) {
          this.visit(importDef.source.file);
        } else if (importDef.source.namespace) {
          this.visit(importDef.source.namespace);
        }
      }
    });
  }

  visitExport(node: ast.ExportNode) {
    node.names.forEach((name) => {
      this.visit(name);
    });
  }

  visitTypeName(node: ast.TypeNameNode) {
    if (!node.name) {
      this.error(node, "LL0011", "Type name must have a name.");
    }
  }

  visitUnionType(node: ast.UnionTypeNode) {
    node.types.forEach((type) => this.visit(type));
  }

  visitIntersectionType(node: ast.IntersectionTypeNode) {
    node.types.forEach((type) => this.visit(type));
  }

  visitSimpleType(node: ast.SimpleTypeNode) {
    this.visit(node.name);
  }

  visitGenericType(node: ast.GenericTypeNode) {
    this.visit(node.name);
    if (node.generic) {
      this.visit(node.generic);
    }
    // Visit constraints if any
    node.constraints?.forEach((constraint) => this.visit(constraint));
  }

  visitConstraintImplements(node: ast.ConstraintImplementsNode) {
    this.visit(node.type);
  }

  visitConstraintInherits(node: ast.ConstraintInheritsNode) {
    this.visit(node.type);
  }

  visitConstraintIs(node: ast.ConstraintIsNode) {
    this.visit(node.type);
  }

  visitConstraintHas(node: ast.ConstraintHasNode) {
    this.visit(node.member);
  }

  visitFunctionCarrying(node: ast.FunctionCarryingNode) {
    this.visit(node.identifier);
    node.sequence.forEach((seqItem) => {
      this.visit(seqItem);
    });
  }

  visitFunctionCarryingLeft(node: ast.FunctionCarryingLeftNode) {
    this.visit(node.function);
    node.arguments.forEach((arg) => this.visit(arg));
  }

  visitFunctionCarryingRight(node: ast.FunctionCarryingRightNode) {
    this.visit(node.function);
    node.arguments.forEach((arg) => this.visit(arg));
  }

  visitTypeMapping(node: ast.TypeMappingNode) {
    // NOTE: Implement validation for type mapping if needed
  }

  visitMappedType(node: ast.MappedTypeNode) {
    // TODO: Implement validation for mapped type
    // node.mapping.forEach((mapping) => this.visit(mapping));
  }

  visitMapType(node: ast.MapTypeNode) {
    node.keys.forEach((keyDef) => this.visit(keyDef));
  }

  visitKeyValue(node: ast.MapKeyValueNode) {
    this.visit(node.key);
    this.visit(node.value);
  }

  visitKeyDefinition(node: ast.MapKeyValueNode) {
    this.visit(node.key);
    this.visit(node.value);
  }

  visitQuote(node: ast.QuoteNode) {
    if (node.nodes) {
      node.nodes.forEach((n) => this.visit(n));
    }
  }

  visitVector(node: ast.VectorNode) {
    node.values.forEach((value) => this.visit(value));
  }

  visitMap(node: ast.MapNode) {
    node.values.forEach((value) => this.visit(value));
  }

  visitNumber(node: ast.NumberNode) {
    // Nothing to do for numbers
  }

  visitComment(node: ast.CommentNode) {
    // Optionally, we could check for TODOs or FIXMEs
  }

  visitControlComment(node: ast.ControlCommentNode) {
    // NOTE: Implement validation for control comments if needed
  }
};
