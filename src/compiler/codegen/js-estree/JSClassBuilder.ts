import * as ESTree from "estree";
import * as ast from "../../frontend/ast";
import { Context } from "../../Context";
import { encodeIdentifier } from "../../utils";
import { hasModifier } from "../../helpers/modifiers";
import { report, CodegenDiagnostics } from "../../rules/diagnostics";

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
  /**
   * The declared type, when there is one.
   *
   * Carried purely so the value-copy prologue (D11) can skip a parameter that is declared a known
   * PRIMITIVE and therefore cannot possibly be a struct. Without it every `(let :ctor real <- Real 0)`
   * emits `real = __ll_copy(real)` -- correct, and provably incapable of doing anything.
   *
   * A parent's pass-through parameters have no type here; they are wrapped, which is safe.
   */
  type?: ast.TypeNode;
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
        result.push({
          name: paramName,
          defaultValue: (variable as any).value ?? undefined,
          type: variable.type,
        });
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
      type: v.type,
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
        report(this.visitor.context, CodegenDiagnostics.DefaultBeforeRequired, this.node, {
          className: this.node.name.name,
          param: finalConstructorParams[firstDefaulted].name,
          plural: required.length > 1,
          required: required.map((p) => `'${p.name}'`).join(", "),
        });
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

    // A struct is passed BY VALUE (D11), and a constructor's parameters are parameters. This body is
    // SYNTHESIZED here rather than emitted by visitFunction, so the prologue that visitFunction adds
    // never reaches it -- the constructor is the one function in the language the visitor cannot see.
    //
    // Before `super(...)`: assigning to a parameter does not touch `this`, so it is legal there, and
    // the parent must receive the COPIES too.
    bodyStatements.push(
      ...this.visitor.parameterCopyPrologue(
        params,
        finalConstructorParams.map((p) => p.type)
      )
    );

    // Add super() call if needed -- modeled as an HSuperCall, emitted through the HIR path (A4).
    if (parentClassName) {
      bodyStatements.push(this.visitor.buildSuperCall(superCallArgs, this.node));
    }

    // Add field assignments `this.<field> = <param>` (A4). Modeled as an HFieldInit and emitted through
    // the single HIR-emit path (the store shape lives there now, not as raw ESTree here). Visibility is
    // ERASED (D11) -- a plain `this.x`, never `this.#x`; see buildFields.
    for (const v of this.ctorVars) {
      const paramNameRaw = (v.name as any).id ?? (v.name as any).name;
      bodyStatements.push(this.visitor.buildFieldInit(v.name, paramNameRaw, v));
    }

    // Run each `:ctor` initializer method `this.<method>()` -- modeled as an HCtorMethodCall (A4).
    const ctorMethods = this.methods.filter(x => x.modifiers.some(m => m.modifier === "ctor"));
    for (const m of ctorMethods) {
      bodyStatements.push(this.visitor.buildCtorMethodCall(m.name, this.node));
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
      // Correct as written, and deliberately left alone: a constructor is never static. Of the three
      // hardcoded `static: false` in the backend, only the other two were bugs.
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

      // A FIELD is a new home for a value (D11), so an initializer that names an existing struct
      // stores a copy of it. `(let vel <- Vector3 (new Vector3 0 0 0))` is a fresh construction and is
      // not copied; `(let vel <- Vector3 other)` is.
      const value = v.value
        ? (this.visitor.asValue(
            this.visitor.visit(v.value) as ESTree.Expression,
            v.value
          ) as ESTree.Expression)
        : null;

      return {
        type: "PropertyDefinition",
        key,
        value,
        computed: false,
        // `:static` (D11e) -- was a hardcoded `false`, and the modifier was never read.
        static: hasModifier(v.modifiers ?? [], "static"),
        loc: loc(v)
      } as ESTree.PropertyDefinition;
    });
  }

  private buildMethods(): ESTree.MethodDefinition[] {
    return this.methods.map(m => this.visitor.visit(m) as ESTree.MethodDefinition);
  }

  /**
   * `[Symbol.iterator]() { return __ll_js_iter(this.iterator()); }`, injected when the type
   * `:implements Iterable` (D30/Gc).
   *
   * The type declares an `iterator()` method (the l-lang `Iterable<T>` contract) whose result has a
   * `next() -> T?`. JS `for...of` looks for `[Symbol.iterator]` and expects a `{value, done}` iterator,
   * so without this a hand-written iterable threw `... is not iterable`. The bridge delegates to the
   * user's `iterator()` and hands the result to `__ll_js_iter`, which adapts `T?` to `{value, done}`.
   * Only ONE bridge per type, even under diamond conformance.
   */
  private buildIterableBridge(): ESTree.MethodDefinition[] {
    const implementsIterable = (this.node.implements ?? []).some(
      (impl: any) => impl?.type?.name === "Iterable"
    );
    if (!implementsIterable) return [];

    const call = (callee: ESTree.Expression, args: ESTree.Expression[] = []): ESTree.CallExpression => ({
      type: "CallExpression",
      callee,
      arguments: args,
      optional: false,
    });
    const ident = (name: string): ESTree.Identifier => ({ type: "Identifier", name });
    const member = (obj: ESTree.Expression, prop: string): ESTree.MemberExpression => ({
      type: "MemberExpression",
      object: obj,
      property: ident(prop),
      computed: false,
      optional: false,
    });

    // return __ll_js_iter(this.iterator());
    const bridgeBody: ESTree.ReturnStatement = {
      type: "ReturnStatement",
      argument: call(ident("__ll_js_iter"), [
        call(member({ type: "ThisExpression" }, "iterator")),
      ]),
    };

    const method: ESTree.MethodDefinition = {
      type: "MethodDefinition",
      // computed `[Symbol.iterator]`
      key: member(ident("Symbol"), "iterator"),
      computed: true,
      kind: "method",
      static: false,
      value: {
        type: "FunctionExpression",
        id: null,
        params: [],
        body: { type: "BlockStatement", body: [bridgeBody] },
        generator: false,
        async: false,
      },
      loc: loc(this.node),
    };
    return [method];
  }

  private buildOtherBody(): any[] {
    return this.otherBody.map(b => this.visitor.visit(b));
  }

  /**
   * `static __ll_struct = true` -- the marker that makes a struct a VALUE TYPE at run time.
   *
   * The whole of by-copy turns on one question the code generator cannot otherwise answer: "is this
   * object a struct?" Codegen has NO per-node type information (`typeEnv` is a dead local at
   * Context.ts:345), so it cannot know the type of an arbitrary expression -- the discrimination has
   * to happen at RUN TIME, and it needs a mark on the object.
   *
   * INTRINSIC to the class, and deliberately not any of the alternatives:
   *
   *   - NOT `__ll_type_metadata`, which already records `kind: 'struct'` and is the obvious choice.
   *     It is conditional on `includeRuntimeShim`, so value semantics would vanish under a codegen
   *     option -- and, fatally, the import inliner RENAMES structs (`class inlined_Vector3_7`,
   *     ensureSymbolInlined), so a name-keyed lookup silently misses EVERY IMPORTED STRUCT. That is
   *     all of std/math.lisp, which is the passing golden complex_math_test.
   *   - NOT a sibling statement (`Point.prototype.__ll_struct = true`). visitClass returns a single
   *     ClassDeclaration; the only precedent for a sibling UNSHIFTS to the front of the program,
   *     which for a class is a TDZ ReferenceError.
   *   - NOT an INSTANCE field: it would be own+enumerable, and show up in Object.keys, console.log,
   *     and the runtime's `properties` reflection.
   *
   * A STATIC field survives renaming (it rides on the class object itself), stays off the instance,
   * and is inherited by subclasses. `v.constructor.__ll_struct` is the test.
   */
  private buildValueTypeMarker(): ESTree.PropertyDefinition[] {
    // The cast is unavoidable, and it documents a lie the compiler already tells: `visitStruct` is
    // `this.visitClass(node as unknown as ast.ClassNode)`, so this builder's `node` is DECLARED
    // ClassNode and is at RUN TIME sometimes a StructNode. TypeScript therefore insists `_type` can
    // only ever be "class". It cannot; that is the entire premise of this phase.
    if ((this.node as ast.ASTNode)._type !== "struct") return [];
    return [
      {
        type: "PropertyDefinition",
        key: { type: "Identifier", name: "__ll_struct" },
        value: { type: "Literal", value: true },
        computed: false,
        static: true,
        loc: loc(this.node),
      } as ESTree.PropertyDefinition,
    ];
  }

  /**
   * `static __ll_name = "Money"` -- the type's SOURCE name, which the JS binding's name is not.
   *
   * The import inliner renames a class to keep two modules' `Point` apart (`class __ll_inlined_Point_3`).
   * That is correct for the BINDING and wrong for the TYPE: `__ll_is_type` and `__ll_op_registry` both
   * ask "is this a Money?" by comparing `constructor.name`, and after inlining that answers
   * `"__ll_inlined_Money_1"`. So an overload registered on `["Money","Money"]` never matched an imported
   * Money, and `(x of Money)` never matched one either.
   *
   * The register has carried this as an open finding since D11 ("__ll_is_type and the operator registry
   * are keyed on constructor.name, and the inliner renames structs"). It only became load-bearing once
   * an imported operator could reach the registry at all.
   *
   * A static field, for the same reasons as `__ll_struct`: it rides on the class object, survives the
   * rename, stays off the instance, and is inherited.
   */
  private buildTypeNameMarker(): ESTree.PropertyDefinition[] {
    const sourceName =
      (this.node as any).__ll_source_name ?? this.node.name?.name;
    if (!sourceName) return [];

    return [
      {
        type: "PropertyDefinition",
        key: { type: "Identifier", name: "__ll_name" },
        value: { type: "Literal", value: sourceName },
        computed: false,
        static: true,
        loc: loc(this.node),
      } as ESTree.PropertyDefinition,
    ];
  }

  /**
   * The class-body MEMBERS, in source order: markers, fields, constructor, methods, the iterable bridge,
   * and any other valid members. The class SHELL (id / superClass / ClassDeclaration wrap) is assembled
   * by the HIR emitter now (A4 step 2) from the modeled `HClass.name` / `superName`; this is the seam the
   * emitter drives through the `emitClassBody` hook. `build()` still wraps these for any legacy caller.
   */
  public buildBodyMembers(): (ESTree.MethodDefinition | ESTree.PropertyDefinition)[] {
    const body: (ESTree.MethodDefinition | ESTree.PropertyDefinition)[] = [];

    // The metadata markers (`__ll_name` / `__ll_struct`) are modeled on HClass now (A4 step 3) and built
    // by the HIR emitter, first, from `sourceName` / `isStruct`. `build()` (the legacy fallback) still
    // prepends them via the marker methods below so a direct `visit(classNode)` stays correct.

    // Add fields
    body.push(...this.buildFields());

    // Add constructor if needed
    const constructor = this.buildConstructor();
    if (constructor) {
      body.push(constructor);
    }

    // Add methods
    body.push(...this.buildMethods());

    // D30/Gc: if this type `:implements Iterable`, give it a real JS `[Symbol.iterator]` so `for...of`
    // (and spread, and everything else) can drive it. A generator needs none of this; this is for the
    // HAND-WRITTEN iterable.
    body.push(...this.buildIterableBridge());

    // Add other body elements (if they're valid class members)
    // Note: otherBody items need to be compatible with class body
    const otherElements = this.buildOtherBody();
    for (const elem of otherElements) {
      if (elem && (elem.type === 'MethodDefinition' || elem.type === 'PropertyDefinition')) {
        body.push(elem);
      }
    }

    return body;
  }

  public build(): ESTree.ClassDeclaration {
    // The legacy fallback path: prepend the markers the HIR emitter now models (step 3), so a direct
    // `visit(classNode)` still produces the byte-identical declaration.
    const body = [
      ...this.buildTypeNameMarker(),
      ...this.buildValueTypeMarker(),
      ...this.buildBodyMembers(),
    ];
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