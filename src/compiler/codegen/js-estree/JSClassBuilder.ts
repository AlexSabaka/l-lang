import * as ESTree from "estree";
import * as ast from "../../frontend/ast";
import { Context } from "../../Context";
import { encodeIdentifier } from "../../utils";

/**
 * A constructor parameter: its name, and the AST node of its DEFAULT, if it declared one.
 *
 * This used to be a bare `string[]`, and that was the whole `:ctor` default bug -- the parameter was
 * reduced to a name before the parameter list was ever built, so `(let :ctor x <- Int 7)` had nowhere
 * to put the `7` and emitted `constructor(x)`. `(Vec)` then produced `{ x: undefined }`, silently.
 *
 * The default is carried as the raw AST NODE, deliberately. The type system also records a
 * `defaultValue` (on `constructorSignature` / `DetailedMember`), but that one goes through
 * `extractDefaultValue`, which is a lossy REFLECTION artifact: it flattens a literal to a JS scalar
 * and returns the string `"<expression>"` for anything else. It cannot be turned back into code. The
 * AST node can -- `buildFields` already emits one with `this.visitor.visit(v.value)`.
 */
interface CtorParam {
  name: string;
  /** The default's AST node. Emitted as an ESTree AssignmentPattern. */
  defaultValue?: ast.ASTNode;
}

/**
 * Helper function to extract constructor parameters from a class node
 */
function getCtorParamsFromClassNode(classNode: ast.ClassNode): CtorParam[] {
  const result: CtorParam[] = [];

  const bodyNodes = classNode.body
    .map((x: any) => (x.nodes ? x.nodes : [x]))
    .flat(2);

  for (const node of bodyNodes) {
    if (node._type === "variable") {
      const variable = node as ast.VariableNode;
      const fieldModifiers = variable.modifiers.map((m) => m.modifier);

      if (fieldModifiers.includes("ctor")) {
        const paramName = (variable.name as any).id ?? (variable.name as any).name;
        result.push({ name: paramName, defaultValue: (variable as any).value ?? undefined });
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
    let parentArgs: CtorParam[] = [];

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

    // 2. Identify Local Constructor Variables -- as PARAMETERS, carrying their defaults, not names.
    const localCtorParams: CtorParam[] = this.ctorVars.map((v) => ({
      name: (v.name as any).id ?? (v.name as any).name,
      defaultValue: (v as any).value ?? undefined,
    }));
    const localCtorArgNames = localCtorParams.map((p) => p.name);

    // 3. Calculate Final Constructor Parameters & Super Arguments
    const finalConstructorParams: CtorParam[] = [];
    const superCallArgs: string[] = [];

    // A. Handle Parent Requirements (Pass-through). The parent's default travels with it -- a
    // pass-through param used to be pushed by name, so an inherited default was dropped as well.
    for (const pArg of parentArgs) {
      if (localCtorArgNames.includes(pArg.name)) {
        superCallArgs.push(pArg.name);
      } else {
        finalConstructorParams.push(pArg);
        superCallArgs.push(pArg.name);
      }
    }

    // B. Handle Local Requirements
    for (const localParam of localCtorParams) {
      finalConstructorParams.push(localParam);
    }

    // If implicit constructor is empty, skip generating it
    if (
      finalConstructorParams.length === 0 &&
      !parentClassName &&
      this.ctorVars.length === 0
    ) {
      return null;
    }

    // A defaulted parameter followed by a required one is legal JavaScript and a trap: the default
    // can never be taken without also passing every parameter after it. `constructor(a = 1, b)` can
    // only be called as `new C(1, 2)`. Report it rather than silently reordering -- the parameter
    // ORDER is the source's, and a code generator that shuffles it is worse than one that complains.
    //
    // It can arise from inheritance without either class looking wrong on its own: parent
    // pass-through params come first, so a defaulted parent field ahead of a required local one
    // produces it.
    const firstDefaulted = finalConstructorParams.findIndex((p) => p.defaultValue != null);
    if (firstDefaulted !== -1) {
      const required = finalConstructorParams
        .slice(firstDefaulted + 1)
        .filter((p) => p.defaultValue == null);
      if (required.length > 0) {
        this.visitor.reportCodegenError(
          this.node,
          "LL0102",
          `Constructor of '${this.node.name.name}': parameter ` +
            `'${finalConstructorParams[firstDefaulted].name}' has a default but is followed by ` +
            `required parameter${required.length > 1 ? "s" : ""} ` +
            `${required.map((p) => `'${p.name}'`).join(", ")}. The default can never be used -- ` +
            `every parameter after it must still be supplied. Move the defaulted parameters last.`
        );
      }
    }

    // --- Code Generation ---
    const params: ESTree.Pattern[] = finalConstructorParams.map((p) => {
      const id: ESTree.Identifier = {
        type: "Identifier",
        name: encodeIdentifier(p.name),
        loc: loc(this.node),
      };
      if (p.defaultValue == null) {
        return id;
      }
      return {
        type: "AssignmentPattern",
        left: id,
        right: this.visitor.visit(p.defaultValue) as ESTree.Expression,
        loc: loc(this.node),
      } as ESTree.AssignmentPattern;
    });

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
      // fieldName should already be encoded via visitor
      const fieldName = this.visitor.visit(v.name) as ESTree.Identifier;

      // The parameter name matches the unencoded field name logic, so we must encode it too
      // to match constructor params
      const paramNameRaw = (v.name as any).id ?? (v.name as any).name;
      const paramRefName = encodeIdentifier(paramNameRaw);

      // Visibility is ERASED (D11) -- a plain `this.x`, never `this.#x`. See buildFields.
      const targetField: ESTree.MemberExpression = {
        type: "MemberExpression",
        object: { type: "ThisExpression" },
        property: fieldName,
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

    const ctorMethods = this.methods.filter(x => x.modifiers.some(m => m.modifier === "ctor"));
    for (const m of ctorMethods) {
      // Insert a method call to the constructor body
      bodyStatements.push({
        type: "ExpressionStatement",
        expression: {
          type: "CallExpression",
          callee: {
            type: "MemberExpression",
            object: { type: "ThisExpression" },
            property: this.visitor.visit(m.name) as ESTree.Identifier,
            computed: false,
            optional: false
          },
          arguments: [],
          optional: false
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

  /**
   * Visibility is ERASED at codegen (D11). A `:private` field emits a PLAIN field name.
   *
   * It used to emit a `PrivateIdentifier` -- a JS `#name` -- and that was a silent wrong answer, not
   * a hardening. Nothing else in the compiler knows about `#`: every read and write of the field goes
   * through `visitCompositeIdentifier`, which emits `this.count` and has no idea the declaration said
   * `:private`. So the `#count` slot kept its initializer forever, `this.count` was `undefined`, and
   * `(this.count := (+ this.count 1))` produced NaN with zero diagnostics. Two declaration-side sites
   * decided privacy; the entire reference side never heard about it.
   *
   * Erasure is the ruling, and it is also the only coherent option: `#` is a RUNTIME enforcement
   * mechanism, and D11 puts enforcement in the TYPE CHECKER (LL0206, D11c) where it can produce a
   * located error instead of a wrong number.
   */
  private buildFields(): ESTree.PropertyDefinition[] {
    return this.classFields.map(v => {
      const key = this.visitor.visit(v.name) as ESTree.Identifier;

      const value = v.value
        ? this.visitor.visit(v.value) as ESTree.Expression
        : null;

      return {
        type: "PropertyDefinition",
        key,
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