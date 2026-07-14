import * as ast from "../../frontend/ast";
import { Context, LogLevel } from "../../Context";
import { BaseAstTreeWalker } from "../../BaseAstTreeWalker";
import { TypeEnvironment } from "../TypeEnvironment";
import { 
  InferredType, 
  DetailedMember, 
  MethodSignature, 
  ParameterInfo, 
  OperatorOverload, 
  InterfaceImplementation, 
  TypeParameter, 
  CodegenMetadata 
} from "../../analysis/SymbolTable";
import { TypeChecker } from "../TypeChecker";
import { createRule, RuleSeverity } from "../../rules/RuleBuilder";
import { RuntimeProvider } from "../../runtime";
import { SymbolTable, SymbolEntry } from "../../analysis";
import * as path from "node:path";

/**
 * Convert kebab-case or lowercase node type to camelCase method name
 * e.g., "simple-identifier" → "visitSimpleIdentifier", "program" → "visitProgram"
 */
function toCamelCase(str: string): string {
  return str
    .split("-")
    .map((part, i) => i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function getVisitMethodName(nodeType: string): string {
  return `visit${toCamelCase(nodeType).charAt(0).toUpperCase() + toCamelCase(nodeType).slice(1)}`;
}

/**
 * CollectTypesPass - First pass: Collect explicit type annotations
 * - Records function signatures
 * - Records class/interface declarations
 * - Records variable declarations with explicit types
 * - Does NOT enter function bodies yet
 */
/**
 * The ONE conversion from a syntactic type annotation to an InferredType.
 *
 * This used to be declared THREE times -- CollectTypesPass, InferAndCheckPass, and the (now
 * deleted) TypeCheckingValidator -- and the copies disagreed:
 *
 *   - Only the CollectTypesPass copy consulted the SYMBOL TABLE. The others made every
 *     user-defined type a *primitive with the same name*, so `(let c <- Complex (Complex 1 2))`
 *     compared `{kind:"primitive", name:"Complex"}` against `{kind:"type-ref", name:"Complex"}`
 *     and reported `Cannot assign Complex to Complex`.
 *   - Only the InferAndCheckPass copy knew about generic type PARAMETERS (`T` inside a generic
 *     class), via the type environment.
 *   - Only the CollectTypesPass copy handled function types, and only it kept array-ness on a
 *     union -- so `(Int | String)[]` silently became a bare union in pass 2.
 *
 * Each copy therefore knew something the others didn't; deleting either one alone would have lost
 * information. This is the union of all three, and the only one left.
 */
/**
 * Every type NAME a type annotation mentions, at any depth.
 *
 * `T` mentions T. So do `T[]`, `Box<T>`, `T | Int`, `Map<String, T>` and `(Int) -> T`. The variance
 * check needs all of them: a covariant `T` is just as illegal buried inside `Box<T>` in a parameter
 * as it is standing alone, because the parameter still consumes a T either way.
 */
function collectTypeNames(typeNode: ast.ASTNode | undefined): Set<string> {
  const names = new Set<string>();
  const walk = (n: any): void => {
    if (!n || typeof n !== "object") return;
    if (n._type === "type-name" && typeof n.name === "string") {
      names.add(n.name);
      return;
    }
    for (const key of Object.keys(n)) {
      if (key === "_parent" || key === "_location") continue;
      const value = n[key];
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value);
    }
  };
  walk(typeNode);
  return names;
}

/**
 * `String?` -- the annotation admits nil (D9e).
 *
 * Applied OUTSIDE the conversion rather than inside its branches, for one concrete reason: the
 * compound-unwrap below returns EARLY (`return recur(inner)`), so `(A | B)?` and `Box<T>?` would have
 * skipped any per-branch handling entirely and silently dropped the `?`.
 *
 * The flag can sit on the wrapper OR the inner node, exactly as `array` can, because both the `type`
 * and `basicType` grammar rules carry the suffix: `(A | B)?` lands on the wrapper, a plain `String?`
 * on the inner simple-type.
 */
function convertAstType(
  typeNode: ast.TypeNode,
  symbolTable: SymbolTable,
  typeEnv: TypeEnvironment
): InferredType {
  const converted = convertAstTypeCore(typeNode, symbolTable, typeEnv);
  const isOptional =
    !!(typeNode as any)?.optional || !!(typeNode as any)?.type?.optional;
  return isOptional ? TypeEnvironment.optional(converted) : converted;
}

function convertAstTypeCore(
  typeNode: ast.TypeNode,
  symbolTable: SymbolTable,
  typeEnv: TypeEnvironment
): InferredType {
  const recur = (t: ast.TypeNode) => convertAstType(t, symbolTable, typeEnv);

  // A COMPOUND type nested inside the `type` wrapper.
  //
  // `Box<Animal>` parses as
  //   { _type:"type", array:false, type:{ _type:"generic-type", name:Box, generics:[Animal] } }
  // -- the generic-type is INSIDE the wrapper. The "type"/"simple-type" branch below reads only
  // `typeNode.type.name`, so it saw `Box`, resolved it, and threw the `<Animal>` away. The
  // `generic-type` branch further down was therefore unreachable from any ANNOTATION, and every
  // `Box<Dog>` / `Producer<Animal>` in the language collapsed to a bare `Box` / `Producer`.
  //
  // Exactly the shape bug the array flag has (see `isArray` below): the outer node is a wrapper and
  // the inner node carries the information. Unwrap first, and the branches below get what they were
  // written to handle.
  if (typeNode._type === "type") {
    const inner = (typeNode as any).type;
    const isCompound =
      inner &&
      inner._type !== "simple-type" &&
      inner._type !== "type-name";
    if (isCompound) {
      const converted = recur(inner);
      return typeNode.array ? TypeEnvironment.array(converted) : converted;
    }
  }

  // Simple types
  if (typeNode._type === "type" || typeNode._type === "simple-type") {
    let name: string;
    if ((typeNode as any).type?.name) {
      const typeName = (typeNode as any).type.name;
      name = typeof typeName === "string" ? typeName : typeName.name || "Unknown";
    } else if ((typeNode as any).name?.name) {
      const typeName = (typeNode as any).name.name;
      name = typeof typeName === "string" ? typeName : "Unknown";
    } else {
      name = "Unknown";
    }

    // The array flag can sit on EITHER node. `Int[]` parses as
    //   { _type:"type", array:false, type:{ _type:"simple-type", name:"Int", array:TRUE } }
    // because the grammar's inner `basicType` rule consumes the `[]` before the outer `type` rule
    // gets a chance. Reading only `typeNode.array` therefore dropped the array-ness of EVERY `T[]`
    // annotation, silently degrading it to a scalar `T` -- which is why the stdlib's
    // `(fn range [...] -> Int[])` was reported as "declares it returns Int".
    const isArray = !!typeNode.array || !!(typeNode as any).type?.array;
    const withArray = (t: InferredType) => (isArray ? TypeEnvironment.array(t) : t);

    // A generic type PARAMETER in scope (the `T` of a generic class) -- was only in copy 2.
    const genericParam = typeEnv.resolveIdentifier(name);
    if (genericParam && genericParam.kind === "generic") {
      return withArray(genericParam);
    }

    // A user-defined type (class/struct/interface/alias) -- was only in copy 1. Without this,
    // every class annotation degraded into a primitive of the same name.
    const userType = symbolTable.resolveSymbol(name);
    if (userType && userType.inferredType) {
      return withArray({ kind: "type-ref", name, refName: name, resolved: true });
    }

    if (name === "Any") {
      return withArray({ kind: "unknown", name });
    }

    // A name that is none of the above -- not a generic parameter, not a declared type, not a
    // built-in primitive -- is a type we do not know. Stamping it `{kind:"primitive", name}` (the
    // old fallback) invented a type that is equal to nothing, so anything annotated with it became
    // unassignable from everything.
    //
    // The corpus has a live example: `Bool`. Annotations use it 6 times and `Boolean` 15 times,
    // and the type system only knows `Boolean` -- so `(fn withdraw [...] -> Bool (return true))`
    // "returns Boolean but declares Bool". Nobody noticed, because nothing was ever checked.
    // Whether `Bool` is a legal spelling of `Boolean` is a LANGUAGE decision (a D-ruling), not one
    // to make silently inside a type converter, so this reports nothing and defers.
    //
    // Unknown TYPE names deserve their own diagnostic, the type-level analogue of the unresolved
    // IDENTIFIER check -- and it is blocked on the same thing: scope-and-import resolution (P6).
    if (!TypeEnvironment.isKnownPrimitive(name)) {
      return withArray(TypeEnvironment.unknown());
    }

    return withArray({ kind: "primitive", name });
  }

  // Generic types (Array<Int>, Box<Dog>, Map<String,Int>)
  if (typeNode._type === "generic-type") {
    const genericNode = typeNode as unknown as ast.GenericTypeNode;
    const baseType = genericNode.name.name;
    // Each argument is already a TypeNode. It used to be re-wrapped in a synthetic
    // `{_type:"simple-type", name: g}` -- but a TypeNode has no `.name`, so the simple-type branch
    // read `undefined` and produced `Unknown`. Latent: this branch was unreachable from any
    // annotation (see the wrapper unwrap at the top), so the bug never fired.
    const genericParams = genericNode.generics?.map((g) => recur(g as any)) ?? [];

    const generic: InferredType = { kind: "generic", name: baseType, generics: genericParams };
    return typeNode.array ? TypeEnvironment.array(generic) : generic;
  }

  // Union types
  if (typeNode._type === "union-type") {
    const unionNode = typeNode as unknown as ast.UnionTypeNode;
    const unionType = TypeEnvironment.union(unionNode.types.map(recur));
    return typeNode.array ? TypeEnvironment.array(unionType) : unionType;
  }

  // Function types
  if (typeNode._type === "function-type") {
    const funcTypeNode = typeNode as unknown as ast.FunctionTypeNode;
    const params = funcTypeNode.params.map(recur);
    const returns =
      funcTypeNode.ret.length > 0 ? recur(funcTypeNode.ret[0]) : TypeEnvironment.primitive("Void");
    return TypeEnvironment.function(params, returns);
  }

  return TypeEnvironment.unknown();
}

/** Does this parameter list end in a rest/spread parameter? `(fn print [msg ...args])` */
function isVariadicParams(params: ast.ParameterNode[]): boolean {
  return params.length > 0 && !!params[params.length - 1].spread;
}

class CollectTypesPass extends BaseAstTreeWalker {
  private typeEnv: TypeEnvironment;
  private symbolTable: SymbolTable;

  constructor(context: Context, symbolTable: SymbolTable) {
    super(context);
    this.typeEnv = new TypeEnvironment(symbolTable);
    this.symbolTable = symbolTable;
  }

  getTypeEnvironment(): TypeEnvironment {
    return this.typeEnv;
  }

  /**
   * Override visit to prevent double traversal by BaseAstTreeWalker
   * We manually control which children to visit in each visitXxx method
   */
  visit(node: ast.ASTNode): any {
    if (!node) return node;
    // Convert node type to camelCase method name
    const methodName = getVisitMethodName(node._type);
    // Only call the visitXxx method, don't do automatic recursive traversal
    return (this as any)[methodName]?.(node) ?? node;
  }

  visitProgram(node: ast.ProgramNode) {
    this.typeEnv.enterScope(node);
    
    // Scan top-level declarations
    // The program might contain:
    // 1. Direct declarations (variable, function, class, interface, type-def, struct)
    // 2. Lists containing declarations (e.g., (var x 10))
    // 3. Nested lists of expressions containing declarations
    for (const item of node.program) {
      if (ast.isListNode(item) && item.nodes.length > 0) {
        // Scan through all items in the list
        for (const subItem of item.nodes) {
          if (subItem._type === "variable" || subItem._type === "function" ||
              subItem._type === "class" || subItem._type === "interface" ||
              subItem._type === "type-def" || subItem._type === "struct") {
            this.visit(subItem);
          } else if (ast.isListNode(subItem) && subItem.nodes.length > 0) {
            // Check nested lists for declarations
            const nestedFirst = subItem.nodes[0];
            if (nestedFirst._type === "variable" || nestedFirst._type === "function" ||
                nestedFirst._type === "class" || nestedFirst._type === "interface" ||
                nestedFirst._type === "type-def" || nestedFirst._type === "struct") {
              this.visit(nestedFirst);
            }
          }
        }
      } else if (item._type === "function" || item._type === "class" || 
                 item._type === "interface" || item._type === "variable" ||
                 item._type === "type-def" || item._type === "struct") {
        this.visit(item);
      }
    }
    
    this.typeEnv.exitScope();
  }

  visitVariable(node: ast.VariableNode) {
    // A destructuring binding declares N names, and the type system has no notion of one yet:
    // typing `(let [x y] point)` needs tuple/element types, which is D5/P8 work. Skipping is
    // honest -- this pass reports nothing today anyway (zero results.add calls) -- and it beats
    // crashing on `node.name.id`, which is undefined for a pattern.
    if (ast.isBindingPattern(node.name)) {
      if (node.value) this.visit(node.value);
      return;
    }
    const varName = (node.name as ast.IdentifierNode).id;
    
    // If explicit type annotation exists, bind it
    if (node.type) {
      const inferredType = this.convertAstTypeToInferred(node.type);
      this.typeEnv.bindIdentifier(varName, inferredType, node);
      // this.symbolTable
      this.context.log(LogLevel.Debug, `Collected type for variable '${varName}': ${TypeChecker.formatType(inferredType)}`);
    }
    // If no explicit type, we'll infer it in pass 2
  }

  visitFunction(node: ast.FunctionNode) {
    const funcName = node.name.id;
    
    // Debug: log parameter type nodes (non-circular)
    const simplifiedParams = node.params.map(p => {
      const t = p.type as any | undefined;
      if (!t) return null;
      const inner = t.type ? { _type: t.type._type, name: typeof t.type.name === 'string' ? t.type.name : (t.type.name?.name || null) } : (t.name ? { _type: t.name._type, name: t.name.name } : null);
      return { _type: t._type, array: !!t.array, inner };
    });
    this.context.log(LogLevel.Debug, `Function '${funcName}' param types: ${JSON.stringify(simplifiedParams)}`);

    // Inert today -- neither frontend populates FunctionNode.generics, because `(fn f<T> [...])` is
    // not parseable. Bound anyway, next to the conversions it would govern, so a generic function
    // works the day the grammar grows one rather than silently typing every `T` as Unknown.
    this.typeEnv.enterScope(node);
    this.bindTypeParameters(node.generics);

    // Build function type from signature
    const paramTypes = node.params.map(p =>
      p.type ? this.convertAstTypeToInferred(p.type) : TypeEnvironment.any()
    );

    const returnType = node.returns
      ? this.convertAstTypeToInferred(node.returns)
      : TypeEnvironment.any();

    // Build method signature for complete metadata -- still inside the scope, it converts the same
    // parameter and return types over again.
    const methodSignature = this.buildMethodSignature(node);

    this.typeEnv.exitScope();

    // Build complete codegen metadata for function
    const codegenMetadata: CodegenMetadata = {
      typeName: funcName,
      kind: 'function',
      methodSignatures: new Map([[funcName, methodSignature]]),
      operatorOverloads: methodSignature.isOperatorOverload && methodSignature.operatorSymbol && methodSignature.arity !== undefined ? 
        [{
          symbol: methodSignature.operatorSymbol,
          arity: methodSignature.arity,
          parameterTypes: methodSignature.parameters.map(p => p.type),
          returnType: methodSignature.returnType,
          methodName: methodSignature.name
        }] : [],
      requiresRuntimeMetadata: methodSignature.isOperatorOverload
    };

    // The function's own `<T>` (Phase 5). A call site cannot solve for a type variable it does not
    // know is one -- `T` and a class actually named `T` are indistinguishable in the signature.
    const typeParameters: TypeParameter[] | undefined = node.generics?.length
      ? node.generics.map((g) => ({
          name: g.name,
          constraints: [], // `:where T :of C` does not parse in either frontend; a separate item
          variance: g.variance,
        }))
      : undefined;

    const funcType = TypeEnvironment.function(
      paramTypes,
      returnType,
      isVariadicParams(node.params),
      typeParameters
    );
    // Enhance function type with metadata
    const enhancedFuncType: InferredType = {
      ...funcType,
      methodSignatures: new Map([[funcName, methodSignature]]),
      operatorOverloads: codegenMetadata.operatorOverloads,
      requiresRuntimeMetadata: codegenMetadata.requiresRuntimeMetadata,
      codegenMetadata
    };
    
    this.typeEnv.bindIdentifier(funcName, enhancedFuncType, node);
    
    this.context.log(LogLevel.Debug, `Collected function signature '${funcName}': ${TypeChecker.formatType(funcType)}`);
  }

  /**
   * Bind a declaration's type PARAMETERS, so that `T` inside it resolves to `T`.
   *
   * Without this, `convertAstType`'s `typeEnv.resolveIdentifier("T")` finds nothing and every
   * `<- T` annotation degrades to `Unknown` -- which, under gradual typing, silently disables every
   * check that touches it, and makes the class report `type: 'Unknown'` for a member it declared as
   * `T`. InferAndCheckPass DOES bind them (visitClass, visitInterface, visitFunction) -- it just
   * runs SECOND, long after this pass has already built the metadata that codegen and `(type x)`
   * report. Binding has to happen wherever the types are converted, and they are converted here.
   *
   * Requires an open scope: bindTypeParameter writes into the innermost one and is a silent no-op
   * when the stack is empty.
   */
  private bindTypeParameters(generics: ast.TypeNameNode[] | undefined): void {
    for (const g of generics ?? []) {
      this.typeEnv.bindTypeParameter(g.name, {
        kind: "generic",
        name: g.name,
        variance: g.variance,
      });
    }
  }

  visitClass(node: ast.ClassNode) {
    const className = node.name.name;
    this.typeEnv.enterScope(node);
    this.bindTypeParameters(node.generics);
    const members: any[] = [];
    const detailedMembers: DetailedMember[] = [];
    const methodSignatures = new Map<string, MethodSignature>();
    const operatorOverloads: OperatorOverload[] = [];
    const ctorParams: any[] = [];
    let requiredCount = 0;

    if (node.body) {
      this.context.log(LogLevel.Debug, `Analyzing class ${className}: body has ${node.body.length} items`);
      
      for (let i = 0; i < node.body.length; i++) {
        const item = node.body[i];
        let target = item;
        if (ast.isListNode(item) && item.nodes.length > 0) {
          target = item.nodes[0];
        }
        
        // Handle variables (properties)
        if (target._type === 'variable') {
          const varNode = target as ast.VariableNode;
          const memberType = varNode.type ? this.convertAstTypeToInferred(varNode.type) : TypeEnvironment.any();
          
          const isCtor = (varNode.modifiers ?? []).some((m: any) => m.modifier === ':ctor' || m.modifier === 'ctor');
          const isPrivate = (varNode.modifiers ?? []).some((m: any) => m.modifier === ':private' || m.modifier === 'private');
          const isOperator = (varNode.modifiers ?? []).some((m: any) => m.modifier === 'operator' || m.modifier === ':operator');
          
          const name = typeof varNode.name === 'string' ? varNode.name : (varNode.name as any).id || (varNode.name as any).name;

          // Add to members (legacy format)
          members.push({
            name: name,
            type: memberType,
            isCtor: isCtor,
            isPublic: !isPrivate, 
            isPrivate: isPrivate,
            isOperator,
            operatorSymbol: isOperator ? name : undefined,
            defaultValue: varNode.value ?? undefined
          });
          
          // Add to detailed members (enhanced format)
          const detailedMember = this.buildDetailedMember(item, i);
          if (detailedMember) {
            detailedMembers.push(detailedMember);
          }
          
          // Track constructor parameters
          if (isCtor) {
            // `value` is null (not undefined) when a member has no default -- the AST
            // builder writes `ctx.expression ? ... : null`. `!== undefined` was therefore
            // true for EVERY member, so requiredCount never incremented and every ctor
            // parameter looked optional. Use a null-safe test.
            const hasDefault = varNode.value != null;
            ctorParams.push({
              name: name,
              type: memberType,
              hasDefault,
              defaultValue: hasDefault ? this.extractDefaultValue(varNode) : undefined
            });
            if (!hasDefault) requiredCount++;
          }
        } 
        
        // Handle functions (methods)
        else if (target._type === 'function') {
          const funcNode = target as ast.FunctionNode;
          const paramTypes = funcNode.params.map(p => p.type ? this.convertAstTypeToInferred(p.type) : TypeEnvironment.any());
          const returnType = funcNode.returns ? this.convertAstTypeToInferred(funcNode.returns) : TypeEnvironment.any();
          const funcType = TypeEnvironment.function(paramTypes, returnType, isVariadicParams(funcNode.params));
          const name = typeof funcNode.name === 'string' ? funcNode.name : (funcNode.name as any).id || (funcNode.name as any).name;
          
          const isOperator = (funcNode.modifiers ?? []).some((m: any) => m.modifier === 'operator' || m.modifier === ':operator');

          // Add to members (legacy format)
          members.push({
            name: name,
            type: funcType,
            isCtor: false,
            isPublic: true,
            isPrivate: false,
            isOperator: isOperator,
            operatorSymbol: isOperator ? name : undefined
          });
          
          // Build method signature (enhanced format)
          const methodSignature = this.buildMethodSignature(funcNode);
          methodSignatures.set(methodSignature.name, methodSignature);
          
          // Track operator overloads
          if (methodSignature.isOperatorOverload && methodSignature.operatorSymbol && methodSignature.arity !== undefined) {
            operatorOverloads.push({
              symbol: methodSignature.operatorSymbol,
              arity: methodSignature.arity,
              parameterTypes: methodSignature.parameters.map(p => p.type),
              returnType: methodSignature.returnType,
              methodName: methodSignature.name
            });
          }
        }
      }
    }
    
    // Extract inheritance information
    let parentClass: string | undefined;
    if (node.extends && node.extends.length > 0) {
      const parentRef = node.extends[0];
      if (parentRef && parentRef.type) {
        parentClass = parentRef.type.name;
      }
    }
    
    // Extract interface implementations, WITH their type arguments.
    //
    // `interfaceType` used to be `{kind:'interface', name}` -- the bare name, no arguments -- which
    // was all it could be, since both frontends dropped the `<Dog>` of `:implements Producer<Dog>`
    // (fixed in P7a). Without the arguments, "is a DogProducer a Producer<Animal>?" is unanswerable:
    // you know it implements *some* Producer and nothing more.
    //
    // Converted inside the class's type-parameter scope, so a generic class implementing a generic
    // interface (`(defclass Wrap<T> :implements Producer<T>)`) resolves its own `T`.
    const implementedInterfaces: InterfaceImplementation[] = [];
    if (node.implements && node.implements.length > 0) {
      for (const impl of node.implements) {
        if (impl.type && impl.type.name) {
          const typeArgs = (impl.generics ?? []).map((g) => this.convertAstTypeToInferred(g));
          implementedInterfaces.push({
            interfaceName: impl.type.name,
            interfaceType: {
              kind: 'interface',
              name: impl.type.name,
              ...(typeArgs.length ? { generics: typeArgs } : {}),
            },
            methodMappings: new Map() // TODO: Build actual mappings
          });
        }
      }
    }
    
    // Extract generics/type parameters
    const typeParameters: TypeParameter[] = [];
    if (node.generics && node.generics.length > 0) {
      for (const generic of node.generics) {
        typeParameters.push({
          name: generic.name,
          variance: generic.variance,
          constraints: [], // TODO: Extract constraints
          defaultType: undefined // TODO: Extract default types
        });
      }
    }
    
    // Build complete codegen metadata
    const codegenMetadata: CodegenMetadata = {
      typeName: className,
      kind: 'class',
      detailedMembers,
      methodSignatures,
      operatorOverloads,
      implementedInterfaces,
      typeParameters,
      parentClass,
      requiresRuntimeMetadata: operatorOverloads.length > 0 || implementedInterfaces.length > 0,
      constructorSignature: ctorParams.length > 0 ? {
        parameters: ctorParams.map(p => ({
          name: p.name,
          type: p.type,
          hasDefault: p.hasDefault,
          defaultValue: p.defaultValue,
          isRest: false
        })),
        requiredCount
      } : undefined
    };
    
    // Register class type with complete metadata
    const classType: InferredType = {
      kind: "class",
      name: className,
      generics: node.generics?.map(g => ({
        kind: "generic",
        name: g.name,
        variance: g.variance,
      })),
      members: members,
      ctorInfo: {
        params: ctorParams,
        requiredCount: requiredCount
      },
      // Enhanced metadata
      detailedMembers,
      methodSignatures,
      operatorOverloads,
      implementedInterfaces,
      typeParameters,
      parentClass,
      requiresRuntimeMetadata: codegenMetadata.requiresRuntimeMetadata,
      codegenMetadata
    };
    
    // The type parameters were only ever in scope for converting THIS class's member, parameter and
    // return types. `bindIdentifier` writes to the symbol table, not the scope, so it is safe here.
    this.typeEnv.exitScope();

    this.typeEnv.bindIdentifier(className, classType, node);
    this.context.log(LogLevel.Debug, `Collected class type '${className}' with ${members.length} members, ${methodSignatures.size} methods, ${operatorOverloads.length} operator overloads`);
  }

  visitInterface(node: ast.InterfaceNode) {
    const interfaceName = node.name.name;

    const interfaceType: InferredType = {
      kind: "interface",
      name: interfaceName,
      generics: node.generics?.map(g => ({
        kind: "generic",
        name: g.name,
        variance: g.variance,
      })),
    };
    
    this.typeEnv.bindIdentifier(interfaceName, interfaceType, node);
    this.context.log(LogLevel.Debug, `Collected interface type '${interfaceName}'`);
  }

  visitTypeDef(node: ast.TypeDefNode) {
    const typeName = ast.symbolName(node.name);
    
    // Phase 1: Register placeholder to allow forward/recursive references
    const placeholderType: InferredType = {
      kind: "unknown",
      name: typeName,
    };
    this.typeEnv.bindIdentifier(typeName, placeholderType, node);
    
    // Phase 2: Convert the actual type
    const aliasedType = this.convertAstTypeToInferred(node.type);
    
    // Check if type is recursive (references itself)
    const typeReferences = this.extractTypeReferences(aliasedType);
    const isRecursive = typeReferences.includes(typeName);
    
    // Phase 3: Register the complete type
    const typeAliasType: InferredType = {
      kind: "type-alias",
      name: typeName,
      aliasedType: aliasedType,
      isRecursive: isRecursive,
      typeReferences: typeReferences,
    };
    
    this.typeEnv.bindIdentifier(typeName, typeAliasType, node);
    this.context.log(LogLevel.Debug, `Collected type alias '${typeName}'${isRecursive ? ' (recursive)' : ''}`);
  }

  visitStruct(node: ast.StructNode) {
    const structName = ast.symbolName(node.name);

    // Extract constructor parameters and member fields
    const members: any[] = [];
    const detailedMembers: DetailedMember[] = [];
    const methodSignatures = new Map<string, MethodSignature>();
    const ctorParams: any[] = [];
    let requiredCount = 0;

    if (node.body && node.body.length > 0) {
      for (let i = 0; i < node.body.length; i++) {
        const item = node.body[i];
        let target = item;
        if (ast.isListNode(item) && item.nodes.length > 0) {
          target = item.nodes[0];
        }

        // A struct's type carried `members` and nothing else -- no detailedMembers, no
        // methodSignatures, no codegenMetadata (D11d). The consequence was invisible until you asked
        // for it: `getAllClassMetadata()` requires codegenMetadata, so a struct never appeared in
        // __ll_type_metadata at all, and `(type p)` fell through to the runtime's constructor-name
        // guess and answered `kind: 'object'`.
        const detailed = this.buildDetailedMember(item, i);
        if (detailed) detailedMembers.push(detailed);
        if (target._type === "function") {
          const sig = this.buildMethodSignature(target as ast.FunctionNode);
          methodSignatures.set(sig.name, sig);
        }

        if (target._type === "variable") {
          const varNode = target as ast.VariableNode;
          const isCtor = (varNode.modifiers ?? []).some((m: any) => m.modifier === "ctor" || m.modifier === ":ctor");
          const isPrivate = (varNode.modifiers ?? []).some((m: any) => m.modifier === "private" || m.modifier === ":private");
          const name = typeof varNode.name === 'string' ? varNode.name : (varNode.name as any).id || (varNode.name as any).name;

          const memberType = varNode.type 
            ? this.convertAstTypeToInferred(varNode.type)
            : TypeEnvironment.any();
          
          const member: any = {
            name: name,
            type: memberType,
            isCtor: isCtor,
            isPublic: !isPrivate,
            isPrivate: isPrivate,
          };
          
          if (isCtor) {
            // VariableNode has no `init` -- the field is `value`. Reading `.init` meant this
            // was `undefined !== undefined`, i.e. ALWAYS false: struct ctor defaults were
            // silently dropped. (visitClass above had the mirror-image bug, always true.)
            const hasDefault = varNode.value != null;
            if (hasDefault) {
              member.defaultValue = varNode.value;
            }

            ctorParams.push({
              name: name,
              type: memberType,
              hasDefault: hasDefault,
              defaultValue: varNode.value ?? undefined,
            });
            
            if (!hasDefault) {
              requiredCount++;
            }
          }
          members.push(member);
        } else if (target._type === "function") {
          const funcNode = target as ast.FunctionNode;
          const paramTypes = funcNode.params.map(p => p.type ? this.convertAstTypeToInferred(p.type) : TypeEnvironment.any());
          const returnType = funcNode.returns ? this.convertAstTypeToInferred(funcNode.returns) : TypeEnvironment.any();
          const funcType = TypeEnvironment.function(paramTypes, returnType, isVariadicParams(funcNode.params));
          const name = typeof funcNode.name === 'string' ? funcNode.name : (funcNode.name as any).id || (funcNode.name as any).name;
          
          const isOperator = (funcNode.modifiers ?? []).some((m: any) => m.modifier === 'operator' || m.modifier === ':operator');

          members.push({
            name: name,
            type: funcType,
            isCtor: false,
            isPublic: true,
            isPrivate: false,
            isOperator: isOperator,
            operatorSymbol: isOperator ? name : undefined
          });
        }
      }
    }
    
    // `:implements` / `:extends` on a struct (D11d).
    //
    // Two independent gaps, and fixing the grammar alone fixes neither. `isSubtype` WALKS
    // `implementedInterfaces` and `parentClass` -- and a struct's InferredType never had either --
    // so a struct could never satisfy an interface even once `:implements Shape` parsed. The clause
    // would have been accepted and then ignored, which is the same class of lie D11 exists to end.
    const implementedInterfaces: InterfaceImplementation[] = [];
    for (const impl of node.implements ?? []) {
      if (impl.type && impl.type.name) {
        const typeArgs = (impl.generics ?? []).map((g) => this.convertAstTypeToInferred(g));
        implementedInterfaces.push({
          interfaceName: impl.type.name,
          interfaceType: {
            kind: "interface",
            name: impl.type.name,
            ...(typeArgs.length ? { generics: typeArgs } : {}),
          },
          methodMappings: new Map(),
        });
      }
    }

    const parentClass = node.extends?.[0]?.type?.name;

    const codegenMetadata: CodegenMetadata = {
      typeName: structName,
      kind: "struct",
      detailedMembers,
      methodSignatures,
      operatorOverloads: [],
      implementedInterfaces,
      typeParameters: [],
      parentClass,
      requiresRuntimeMetadata: true,
      constructorSignature: {
        parameters: ctorParams.map((p) => ({
          name: p.name,
          type: p.type,
          hasDefault: p.hasDefault,
          defaultValue: p.defaultValue,
          isRest: false,
        })),
        requiredCount,
      },
    };

    // Register struct type
    const structType: InferredType = {
      kind: "struct",
      name: structName,
      members: members,
      ctorInfo: {
        params: ctorParams,
        requiredCount: requiredCount,
      },
      detailedMembers,
      methodSignatures,
      implementedInterfaces,
      parentClass,
      requiresRuntimeMetadata: true,
      codegenMetadata,
    };

    this.typeEnv.bindIdentifier(structName, structType, node);
    this.context.log(LogLevel.Debug, `Collected struct type '${structName}' with ${members.length} members`);
  }

  /**
   * Extract all type names referenced in an InferredType
   */
  private extractTypeReferences(type: InferredType): string[] {
    const refs: Set<string> = new Set();
    
    const extract = (t: InferredType): void => {
      if (!t) return;
      
      // Add this type name if it's a type-ref or user-defined type
      if (t.kind === "type-ref" || (t.kind === "primitive" && !["Int", "Real", "String", "Bool", "Void", "Any"].includes(t.name))) {
        refs.add(t.name);
      }
      
      // Recurse into container types
      if (t.generics) {
        t.generics.forEach(extract);
      }
      if (t.alternatives) {
        t.alternatives.forEach(extract);
      }
      if (t.inner) {
        extract(t.inner);
      }
      if (t.params) {
        t.params.forEach(extract);
      }
      if (t.returns) {
        extract(t.returns);
      }
      if (t.aliasedType) {
        extract(t.aliasedType);
      }
      if (t.keyType) {
        extract(t.keyType);
      }
      if (t.valueType) {
        extract(t.valueType);
      }
    };
    
    extract(type);
    return Array.from(refs);
  }

  /**
   * Build detailed member information from AST node
   */
  private buildDetailedMember(item: ast.ASTNode, index: number): DetailedMember | null {
    let varNode: ast.VariableNode | undefined;
    
    if (item._type === 'variable') {
      varNode = item as ast.VariableNode;
    } else if (ast.isListNode(item) && item.nodes[0]?._type === 'variable') {
      varNode = item.nodes[0] as ast.VariableNode;
    }
    
    if (!varNode) return null;
    
    const propName = typeof varNode.name === 'string' ? varNode.name : 
                    (varNode.name as any).id || (varNode.name as any).name;
    
    // Extract modifiers and visibility
    const modifiers = new Set<string>();
    let visibility: 'public' | 'private' | 'protected' | 'internal' = 'public';
    let isConstructorParam = false;
    let isStatic = false;
    let isOperator = false;
    let operatorSymbol: string | undefined;
    let arity: number | undefined;
    
    if (varNode.modifiers) {
      // NORMALISE, then compare (D11b).
      //
      // These comparisons used to read `mod === ':private'` -- WITH a colon -- against a value both
      // parsers strip it from (AstBuilder:593 stores `nameToken.image`; l-lang.pegjs:348 matches the
      // ":" as a literal and captures only the name). All seven were DEAD, so `visibility`,
      // `isStatic`, `isConstructorParam` and `isOperator` never left their defaults.
      //
      // The visible consequence: reflection reported every `:private` field as `isPublic: true` while
      // CODEGEN emitted `#field` for the same declaration -- the two halves of the compiler disagreed
      // about the same word. (D11's own text says the disagreement is `:static` false-vs-true. It is
      // neither; that is why the gate asserts the real thing.)
      //
      // The line below (`modifiers.add(mod.replace(':', ''))`) stripped defensively and was the only
      // one that worked, which is what kept the bug invisible.
      const mods = varNode.modifiers.map((m: any) =>
        String(m.modifier ?? m).replace(/^:/, "")
      );

      for (const mod of mods) {
        modifiers.add(mod);

        if (mod === 'private') { visibility = 'private'; }
        else if (mod === 'public') { visibility = 'public'; }
        else if (mod === 'protected') { visibility = 'protected'; }
        else if (mod === 'internal') { visibility = 'internal'; }
        else if (mod === 'ctor') { isConstructorParam = true; }
        else if (mod === 'static') { isStatic = true; }
        else if (mod === 'operator') { isOperator = true; }
      }
    }

    // Extract operator information
    if (isOperator && propName) {
      // Parse operator symbol and arity from method name
      // e.g., "_2b_1" -> symbol="+", arity=1
      const operatorMatch = propName.match(/^_([a-z0-9]+)_([0-9]+)$/);
      if (operatorMatch) {
        operatorSymbol = this.decodeOperatorSymbol(operatorMatch[1]);
        arity = parseInt(operatorMatch[2]);
      }
    }
    
    const memberType = varNode.type ? this.convertAstTypeToInferred(varNode.type) : TypeEnvironment.any();
    
    return {
      name: propName,
      type: memberType,
      visibility,
      modifiers,
      defaultValue: (varNode as any).value ? this.extractDefaultValue(varNode) : undefined,
      isConstructorParam,
      parameterIndex: isConstructorParam ? index : undefined,
      isStatic,
      isOperator,
      operatorSymbol,
      arity
    };
  }
  
  /**
   * Build method signature from function node
   */
  private buildMethodSignature(funcNode: ast.FunctionNode): MethodSignature {
    const methodName = typeof funcNode.name === 'string' ? funcNode.name : 
                      (funcNode.name as any)?.id || (funcNode.name as any)?.name || 'unknown';
    
    const parameters: ParameterInfo[] = funcNode.params.map(p => {
      const paramName = (p.name as any).id || (p.name as any).name || 'unknown';
      const paramType = p.type ? this.convertAstTypeToInferred(p.type) : TypeEnvironment.any();
      
      return {
        name: paramName,
        type: paramType,
        hasDefault: (p as any).defaultValue !== undefined,
        defaultValue: (p as any).defaultValue,
        isRest: (p as any).rest || false
      };
    });
    
    const returnType = funcNode.returns ? 
      this.convertAstTypeToInferred(funcNode.returns) : 
      TypeEnvironment.any();
    
    // Extract modifiers
    const modifiers = new Set<string>();
    let visibility: 'public' | 'private' | 'protected' | 'internal' = 'public';
    let isOperatorOverload = false;
    let operatorSymbol: string | undefined;
    let arity: number | undefined;

    if (funcNode.modifiers) {
      // Normalised, for the same reason as the variable path above (D11b): these compared against
      // `':private'` while the parser stores `'private'`, so every one of them was dead and a
      // method's `visibility` never left `'public'`.
      //
      // A method has no `isStatic` at all -- `MethodSignature` has no such field. That is D11e's.
      const mods = funcNode.modifiers.map((m: any) =>
        String(m.modifier ?? m).replace(/^:/, "")
      );

      for (const mod of mods) {
        modifiers.add(mod);

        if (mod === 'private') { visibility = 'private'; }
        else if (mod === 'public') { visibility = 'public'; }
        else if (mod === 'protected') { visibility = 'protected'; }
        else if (mod === 'internal') { visibility = 'internal'; }
        else if (mod === 'operator') { isOperatorOverload = true; }
      }
    }
    
    // Extract operator information for operator overloads
    if (isOperatorOverload) {
      const operatorMatch = methodName.match(/^_([a-z0-9]+)_([0-9]+)$/);
      if (operatorMatch) {
        operatorSymbol = this.decodeOperatorSymbol(operatorMatch[1]);
        arity = parseInt(operatorMatch[2]);
      }
    }
    
    return {
      name: methodName,
      parameters,
      returnType,
      modifiers,
      isOperatorOverload,
      operatorSymbol,
      arity,
      visibility
    };
  }

  /**
   * Decode operator symbol from encoded name
   */
  private decodeOperatorSymbol(encoded: string): string {
    const decodingMap: Record<string, string> = {
      '2b': '+',
      '2d': '-',
      '2a': '*',
      '2f': '/',
      '3d': '=',
      '21': '!',
      '3c': '<',
      '3e': '>',
      '26': '&',
      '7c': '|'
    };
    
    return decodingMap[encoded] || encoded;
  }
  
  /**
   * Extract default value from variable node
   */
  private extractDefaultValue(varNode: ast.VariableNode): any {
    const valueNode = (varNode as any).value;
    if (!valueNode) return undefined;
    
    // Simple literal extraction
    if (valueNode._type === 'string') return valueNode.value;
    if (valueNode._type === 'integer-number') return valueNode.value;
    if (valueNode._type === 'float-number') return valueNode.value;
    if (valueNode._type === 'boolean') return valueNode.value;
    if (valueNode._type === 'null') return null;
    
    // For complex expressions, store as string representation
    return `<expression>`;
  }

  /**
   * Convert AST type node to InferredType
   */
  private convertAstTypeToInferred(typeNode: ast.TypeNode): InferredType {
    return convertAstType(typeNode, this.symbolTable, this.typeEnv);
  }

  visitModifierDef(node: ast.ModifierDefNode) {
    const modifierName = node.name;
    
    // Register modifier as a function transformer type
    const paramTypes = node.params.map(p => 
      p.type ? this.convertAstTypeToInferred(p.type) : TypeEnvironment.unknown()
    );
    
    const transformerType: InferredType = {
      kind: "function",
      name: `${modifierName}_modifier_transformer`,
      params: paramTypes,
      returns: {
        kind: "function", 
        name: "transformed_function",
        params: [TypeEnvironment.unknown()],
        returns: TypeEnvironment.unknown()
      }
    };
    
    this.typeEnv.bindIdentifier(modifierName, transformerType, node);
  }

  visitSpread(node: ast.SpreadNode) {
    // CollectTypesPass: Visit the spread expression
    this.visit(node.expression);
  }
}

/**
 * InferAndCheckPass - Second pass: Infer types and check compatibility
 * - Enters function bodies
 * - Infers expression types
 * - Validates assignments
 * - Checks function call arguments
 */
class InferAndCheckPass extends BaseAstTreeWalker {
  private typeEnv: TypeEnvironment;
  private symbolTable: SymbolTable;

  /**
   * The type system's ONLY route to `hasErrors` -- and therefore the only way a type error can
   * block codegen and exit 1.
   *
   * It used to live in TypeCheckingValidatorAstVisitor, a 360-line class that could never run:
   * its dispatch built `visit${node._type}` with no capitalisation, so even "variable" resolved
   * to `visitvariable` and matched nothing. Every check in the type system was therefore either
   * unreachable (there) or print-only (here, via context.log, which touches the logger and
   * nothing else). Moved to the pass that actually runs.
   *
   * Nothing calls this yet -- the six existing checks still log. Arming them is P4b, and it must
   * not happen until the false positives are gone, or 19 passing tests break at once.
   */
  protected reportTypeError(node: ast.ASTNode, code: string, message: string): void {
    const rule = createRule<ast.ASTNode>()
      .addSeverity(RuleSeverity.Error)
      .addCode(code)
      .addMessage(message)
      .addTest(() => true)
      .build();

    this.context.results.add(node, rule, this.context);
  }

  /**
   * Type the arguments of a call whose CALLEE we could not resolve -- `(console.log h.length)`, a
   * member call, a JS global. The callee tells us nothing; the ARGUMENTS still have to be checked.
   *
   * They were once not visited at all, so every check living in inferExpressionType silently skipped
   * anything handed to `console.log` -- which is most of the corpus's I/O. Then they were visited
   * behind `membersChecksOnly`, which reported LL0205 and LL0206 from in here and DROPPED everything
   * else, because the rest produced a 16-diagnostic false-positive flood that was blocked on scope
   * resolution.
   *
   * P6 is that scope resolution. The guard is gone.
   */
  private inferArguments(args: ast.ASTNode[]): void {
    args.forEach((arg) => this.inferExpressionType(arg));
  }


  constructor(context: any, typeEnv: TypeEnvironment, symbolTable: SymbolTable) {
    super(context);
    this.typeEnv = typeEnv;
    this.symbolTable = symbolTable;
  }

  getTypeEnvironment(): TypeEnvironment {
    return this.typeEnv;
  }

  /**
   * Override visit to prevent double traversal by BaseAstTreeWalker
   * We manually control which children to visit in each visitXxx method
   */
  visit(node: ast.ASTNode): any {
    if (!node) return node;
    const methodName = getVisitMethodName(node._type);
    // Only call the visitXxx method, don't do automatic recursive traversal
    return (this as any)[methodName]?.(node) ?? node;
  }

  /**
   * LL0205 -- a possibly-nil value, USED as though it were not (D9g).
   *
   * This is the error the whole ruling exists to produce. Everything before it made `T?` sayable,
   * producible and unassignable-to-`T`; without this, a program could still take an optional and
   * dereference it, which is the null-dereference D9 is meant to make unsayable.
   *
   * It is a DEREFERENCE check, not an assignability one. The assignability sites (`let`, argument,
   * return) already refuse `T? -> T` and report LL0200/LL0203/LL0213; adding LL0205 there would just
   * be a second name for the same error. What had no check at all is USING the thing: reading a
   * member off it, indexing into it, doing arithmetic with it.
   */
  private checkNotNil(
    type: InferredType | undefined,
    node: ast.ASTNode,
    what: string
  ): boolean {
    if (!type?.optional) return true;
    this.reportTypeError(
      node,
      "LL0205",
      `${what} is possibly nil (${TypeChecker.formatType(type)}). Check it against nil first, ` +
        `or use a non-optional value.`
    );
    return false;
  }

  /**
   * The class we are lexically inside, if any. A stack, because a class body can contain another
   * class declaration.
   *
   * The type pass had no notion of this at all -- codegen has `runInScope(ScopeType.class)`, and the
   * checker had nothing. Without it LL0206 cannot be written: "is this access from OUTSIDE the
   * declaring class" is the entire question.
   */
  private classStack: string[] = [];

  /**
   * LL0206 -- a `:private` member, reached from outside the class that declared it (D11c).
   *
   * `:private` was enforced NOWHERE. `Symbol.visibility` is computed correctly (SymbolTable.ts:661,
   * via the colon-tolerant getVisibility) and read by literally nothing -- D10's `mutable: false`
   * pathology, verbatim. The only visibility diagnostic that existed was LL0022, which merely rejects
   * TWO visibility modifiers on one declaration.
   *
   * D11 rules visibility TYPE-CHECK-ONLY: the `#` is erased at codegen (D11b), so this check is the
   * only thing that makes `:private` mean anything at all. Without it, D11b would have been a pure
   * downgrade -- swapping a wrong ANSWER (NaN) for no enforcement whatsoever.
   *
   * `this.secret` inside the class is fine; so is `other.secret` inside the class, where `other` is
   * another instance of the SAME class -- privacy is per-CLASS, not per-instance, which is the rule in
   * C#, Java and TypeScript alike.
   */
  private checkMemberVisibility(id: string, node: ast.ASTNode): void {
    const parts = id.split(".");
    if (parts.length < 2) return;

    const [baseName, memberName] = parts;

    // A base we cannot type tells us nothing -- `console.log`, `Math.floor`, an import. Gradual
    // typing holds here exactly as everywhere else.
    const baseType = this.typeEnv.resolveIdentifier(baseName, node);
    if (!baseType) return;

    const owner = TypeChecker.unwrapType(baseType, this.symbolTable);
    if (!owner?.members?.length) return;

    const member = owner.members.find((m: any) => m.name === memberName);
    if (!member?.isPrivate) return;

    // Inside the declaring class. `this.secret` is the overwhelmingly common case.
    if (this.classStack[this.classStack.length - 1] === owner.name) return;

    this.reportTypeError(
      node,
      "LL0206",
      `'${memberName}' is private to '${owner.name}' and cannot be accessed from here.`
    );
  }

  /**
   * `(!= x nil)` / `(== x nil)` -- the only conditions that narrow (D9g).
   *
   * Deliberately SYNTACTIC, and deliberately small. There is no flow analysis anywhere in this
   * compiler, and inventing one here would be a phase of its own (D5 owns narrowing proper). What
   * this recognises is exactly the shape the corpus already writes by hand, everywhere it touches a
   * nil -- and it has to exist, because LL0205 without an escape hatch does not make `T?` unsafe, it
   * makes it UNUSABLE: the nil-check you just wrote would not be believed.
   *
   * Returns the identifier proved NON-nil when the condition is true, or when it is false.
   */
  private nilGuard(cond: ast.ASTNode): { name: string; nonNilWhen: boolean } | undefined {
    if (!cond || cond._type !== "list") return undefined;
    const nodes = (cond as ast.ListNode).nodes;
    if (nodes.length !== 3) return undefined;

    const head = nodes[0];
    if (head._type !== "simple-identifier") return undefined;
    const op = (head as ast.IdentifierNode).id;
    if (op !== "==" && op !== "!=" && op !== "≠") return undefined;

    // `(!= x nil)` or `(!= nil x)` -- either order.
    //
    // A MEMBER counts, not just a bare name: `(== this.cache nil)`, `(== cfg.host nil)`. It used to
    // accept `simple-identifier` only, so an optional FIELD could be reported as possibly-nil and
    // then could not be GUARDED -- the checker refused to believe the very check it was demanding.
    // That is precisely the trap the note above this function is about, and it stayed invisible until
    // P6 gave a field a type to be optional WITH.
    //
    // Narrowing is keyed on the identifier TEXT ("this.cache"), which is what `resolveIdentifier`
    // already resolves through its dot path, so nothing else has to change. It is textual, so
    // reassigning `this` or `cfg` would strand the narrowing -- exactly as true for a plain local,
    // and no more wrong here than there.
    const isGuardable = (n: ast.ASTNode) =>
      n._type === "simple-identifier" || n._type === "composite-identifier";

    const [a, b] = [nodes[1], nodes[2]];
    const idNode =
      b._type === "null" && isGuardable(a)
        ? a
        : a._type === "null" && isGuardable(b)
          ? b
          : undefined;
    if (!idNode) return undefined;

    return { name: (idNode as ast.IdentifierNode).id, nonNilWhen: op !== "==" };
  }

  /**
   * Visit `body` with `name` narrowed to its non-optional type.
   *
   * The mechanism already existed: `resolveIdentifier` consults the type environment's scope stack
   * BEFORE the symbol table, so a binding pushed into a fresh scope simply shadows the declaration --
   * exactly how P7b bound generic type parameters. Narrowing needed no new machinery, only a scope.
   */
  private withNarrowed(name: string, at: ast.ASTNode, body: () => void): void {
    const current = this.typeEnv.resolveIdentifier(name, at);
    if (!current?.optional) {
      body();
      return;
    }
    this.typeEnv.enterScope(at);
    this.typeEnv.bindInScope(name, { ...current, optional: false });
    try {
      body();
    } finally {
      this.typeEnv.exitScope();
    }
  }

  /** Does this statement leave the block unconditionally? `(return x)` / `(throw e)`. */
  private alwaysExits(node: ast.ASTNode | undefined): boolean {
    if (!node || !ast.isListNode(node)) return false;
    const nodes = (node as ast.ListNode).nodes;
    if (!nodes.length) return false;

    const head = nodes[0];
    if (head._type === "simple-identifier") {
      const id = ast.symbolName(head as ast.IdentifierNode);
      if (id === "return" || id === "throw") return true;
    }
    // A block: its LAST statement decides.
    return this.alwaysExits(nodes[nodes.length - 1]);
  }

  /**
   * `(if (== h nil) (return 0))` -- after this statement, `h` is not nil for the REST of the block.
   *
   * The guard-and-return is the shape the corpus actually writes, everywhere it touches an optional
   * (19_optional_and_mutability, 21_nil_handling). Recognising only the `if`-BRANCH form would have
   * left the idiom people reach for first unsupported, and LL0205 would have read as the compiler
   * refusing to believe a check that is right there on the line above.
   *
   * Note the direction. We reach the code after the `if` only when the condition was FALSE -- so it
   * is `(== h nil)` that proves non-nil here, not `(!= h nil)`. An `else` disqualifies it: both paths
   * continue, so nothing is proven.
   */
  private provenNonNilAfter(item: ast.ASTNode): string | undefined {
    const ifNode: ast.IfNode | undefined =
      item._type === "if"
        ? (item as ast.IfNode)
        : ast.isListNode(item) && (item as ast.ListNode).nodes[0]?._type === "if"
          ? ((item as ast.ListNode).nodes[0] as ast.IfNode)
          : undefined;
    if (!ifNode || ifNode.else) return undefined;

    const guard = this.nilGuard(ifNode.condition);
    if (!guard || guard.nonNilWhen) return undefined;
    if (!this.alwaysExits(ifNode.then)) return undefined;

    return guard.name;
  }

  /** What you get OUT of a container: a map's value type, or an array's element type. */
  private containerElementType(container: InferredType): InferredType | undefined {
    if (!container) return undefined;
    if (container.kind === "map") return container.valueType;
    if (
      container.isArray ||
      (container.kind === "generic" && container.name === "Array")
    ) {
      return container.inner ?? container.generics?.[0];
    }
    return undefined;
  }

  /**
   * `(get c k)`, `(elem xs i)`, `(head xs)` -- the TOTAL container accessors, and the only things in
   * the language that PRODUCE a `T?` (D9f).
   *
   * This is what stops optionals shipping inert. `c[k]` is partial and yields a plain `T`, so before
   * this an optional could only ever arise where a programmer typed a `?` by hand -- and LL0205 would
   * have had nothing to catch. `head` is the canonical case: DECISIONS.md:84 flagged it years before
   * this phase ("optionals, so `first`/`last` can be typed honestly").
   *
   * A user-defined `get` still wins: these are runtime helpers, not keywords, and shadowing one is
   * the programmer's business.
   *
   * An unknown container gives `Unknown`, not `Unknown?` -- gradual typing has to keep holding. We do
   * not know what is in an untyped `{}`, and refusing to unwrap a value we cannot type would turn the
   * feature into noise on exactly the code that is least annotated.
   */
  private inferTotalAccessorType(
    funcName: string,
    args: ast.ASTNode[]
  ): InferredType | undefined {
    if (funcName !== "get" && funcName !== "elem" && funcName !== "head") return undefined;
    if (this.symbolTable.resolveSymbol(funcName)) return undefined;
    if (!args.length) return undefined;

    const container = this.inferExpressionType(args[0] as any);
    const element = this.containerElementType(container);
    if (!element || TypeChecker.isUnknown(element)) return TypeEnvironment.unknown();

    return TypeEnvironment.optional(element);
  }

  /**
   * The type checker had never looked inside a loop body, a match arm, or a try block.
   *
   * The dispatch above calls `visitFor` for a `for` node -- and `visitFor` DOES exist, inherited
   * from BaseAstVisitor as a stub that returns the node untouched. So the dispatch "succeeded",
   * the children were silently dropped, and every control-flow form was a dead end. This pass
   * defines visitors for 12 node types; `for`, `for-each`, `while`, `match`, `when`, `cond`,
   * `try-catch` and `compound-assignment` are not among them.
   *
   * BaseAstVisitor routes every un-overridden visitor through `onUnhandled`, so overriding it here
   * is the whole fix: having no visitor for a node type does not make its CHILDREN uninteresting.
   */
  protected onUnhandled(node: ast.ASTNode, _method: string): any {
    this.visitChildren(node);
    return node;
  }

  /** Visit every AST child of a node, whatever shape the node is. */
  private visitChildren(node: ast.ASTNode): void {
    for (const key of ast.getNodeIterableKeys(node)) {
      const value = (node as any)[key];

      if (Array.isArray(value)) {
        for (const item of value) {
          if (Array.isArray(item)) {
            for (const nested of item) {
              if (ast.isAstNode(nested)) this.visit(nested);
            }
          } else if (ast.isAstNode(item)) {
            this.visit(item);
          }
        }
      } else if (ast.isAstNode(value)) {
        this.visit(value);
      }
    }
  }


  visitProgram(node: ast.ProgramNode) {
    this.typeEnv.enterScope(node);
    node.program.forEach(item => this.visit(item));
    this.typeEnv.exitScope();
  }

  private static readonly DECLARATIONS = [
    "variable", "function", "class", "interface", "type-def", "struct",
  ];

  private isDeclaration(node: ast.ASTNode | undefined): boolean {
    return !!node && InferAndCheckPass.DECLARATIONS.includes(node._type);
  }

  /**
   * A list is a block (a bag of declarations and statements) or a call. It used to be treated as
   * ONLY the former, and only partially: everything that was not a declaration was dropped, with
   * the comment "Skip comments and other non-declaration items".
   *
   * So a call at statement level -- `(console.log x)`, `(bogus-fn x)` -- was never visited, and
   * neither was any control-flow form. Combined with the dead-end dispatch (see onUnhandled), the
   * type checker only ever looked at declarations and their initialisers. `(if "str" 1 2)`
   * produced NOTHING, even though visitIf exists and checks exactly that.
   */
  visitList(node: ast.ListNode) {
    if (!node.nodes || node.nodes.length === 0) return;

    // Is this list a CALL rather than a block?
    //
    // A block's items are themselves lists or declarations -- `((console.log 1) (console.log 2))`
    // has a list at nodes[0]. A list with an IDENTIFIER at its head is a call: `(bogus-fn x)`.
    // That is the same test the statement loop below applies to each item, applied one level up.
    //
    // Without it, a call only got checked when it arrived WRAPPED in an enclosing block -- which is
    // true at statement level, and false for the single-expression bodies of the control-flow forms:
    // a `for :then` body, a match arm, a `when` branch. Those lists were walked as if they were
    // blocks, so their head -- the callee -- was visited as if it were a statement, and the call was
    // never inferred. Calls to undefined functions inside a loop body went unreported.
    // A SPECIAL FORM is headed by an identifier and is NOT a call: `(return x)`, `(new Box 1)`,
    // `(throw e)`. Routing one through inferExpressionType types it as a call to a function named
    // `return`, which is Unknown -- and a `return` that infers as Unknown stops the function's
    // return type from propagating. Leave them to the statement loop, which walks their children,
    // so a call NESTED in one -- `(return (bogus-fn x))` -- is still reached and still checked.
    const listHead = node.nodes[0];
    if (
      !this.isDeclaration(listHead) &&
      (listHead._type === "simple-identifier" || listHead._type === "composite-identifier") &&
      !InferAndCheckPass.SPECIAL_FORMS.has(ast.symbolName(listHead as ast.IdentifierNode))
    ) {
      this.inferExpressionType(node);
      return;
    }

    // Duplicate declarations in the SAME block. Shadowing in a nested scope is legal and common
    // (`n` as a parameter, then `n` in an inner loop); redeclaring the same name in the same block
    // is not, and nothing anywhere in the compiler checked for it.
    //
    // Done syntactically, per-list, rather than through the symbol table -- deliberately. Symbol
    // resolution is top-level-only and cannot see nested scopes (the audit's P6), so asking it
    // "was this name already declared HERE" would get an answer about the wrong scope.
    const declaredHere = new Map<string, ast.ASTNode>();

    for (const item of node.nodes) {
      const decl = this.isDeclaration(item)
        ? item
        : ast.isListNode(item) && this.isDeclaration(item.nodes[0])
          ? item.nodes[0]
          : undefined;

      if (decl) {
        const declName = (decl as any).name;
        const name =
          typeof declName === "string"
            ? declName
            : declName && !ast.isBindingPattern(declName)
              ? ast.symbolName(declName)
              : undefined;

        // Operator declarations OVERLOAD -- that is the point of them. 09_operators.lisp declares
        // `-` twice on purpose: binary `(fn :operator - [c1 c2])` and unary `(fn :operator - [c1])`.
        // They share a name and are distinguished by arity, so they are not duplicates.
        const isOperatorDecl =
          decl._type === "function" &&
          ((decl as ast.FunctionNode).modifiers ?? []).some(
            (m) => m.modifier === "operator" || m.modifier === ":operator"
          );

        if (name && !isOperatorDecl) {
          if (declaredHere.has(name)) {
            this.reportTypeError(
              decl,
              "LL0212",
              `'${name}' is already declared in this scope.`
            );
          } else {
            declaredHere.set(name, decl);
          }
        }
      }
    }

    this.visitBlock(node.nodes, (item) => this.visitStatement(item));
  }

  /**
   * Visit a sequence of statements as a BLOCK: an early-return nil-guard proved by one of them holds
   * for every statement after it.
   *
   * This was inlined in `visitList`, and a function BODY is not a list -- `visitFunction` walks
   * `node.body` directly. So the guard idiom D9g exists to support
   *
   *     (fn describe [c <- String?] -> String
   *         (if (== c nil) (return "empty"))
   *         (return (+ "holding: " c)))
   *
   * was believed at top level and NOWHERE ELSE. It read as working only because a parameter had no
   * type to narrow: before P6c `c` resolved to nothing, so LL0205 could not fire and there was
   * nothing for the missing narrowing to be wrong about. Giving parameters their real types is what
   * made an always-broken guard start reporting.
   *
   * Narrowings stay open until the block ends, and are counted and unwound in a `finally` so an
   * exception mid-block cannot desync enterScope/exitScope -- the failure mode SymbolTable had to be
   * fixed for in D3b.
   */
  private visitBlock(
    items: ast.ASTNode[],
    visitItem: (item: ast.ASTNode) => void,
    afterBlock?: () => void
  ): void {
    let openNarrowings = 0;
    try {
      for (const item of items) {
        visitItem(item);

        // `(if (== h nil) (return 0))` -- from here to the end of the block, `h` is not nil.
        const proven = this.provenNonNilAfter(item);
        if (proven) {
          const current = this.typeEnv.resolveIdentifier(proven, item);
          if (current?.optional) {
            this.typeEnv.enterScope(item);
            this.typeEnv.bindInScope(proven, { ...current, optional: false });
            openNarrowings++;
          }
        }
      }

      // Runs while the narrowings are still OPEN. `checkReturns` re-infers each `(return e)` from
      // scratch, so without this it would judge `e` under the declaration rather than under what the
      // block proved -- and every check inside inferExpressionType would fire a SECOND time, from
      // outside the guard that makes it safe. That is the duplicate LL0205 on
      // `(if (== c nil) (return "empty")) (return (+ "holding: " c))`.
      afterBlock?.();
    } finally {
      for (let i = 0; i < openNarrowings; i++) this.typeEnv.exitScope();
    }
  }

  /**
   * The statements of a function body, whether or not the body is wrapped in parentheses.
   *
   * Both forms are legal and the corpus uses both:
   *
   *     (fn f [c <- String?] -> String (if (== c nil) (return "e")) (return c))     ; body = 2 items
   *     (fn f [c <- String?] -> String ( (if (== c nil) (return "e")) (return c) )) ; body = ONE list
   *
   * Unwrapped, they are the same block. Left wrapped, they are not: the guard's narrowing opens
   * inside the WRAPPER's block and closes when that block ends -- which is before `checkReturns` runs
   * at the function level. So the return was judged against the declaration rather than against what
   * the guard proved, and the corpus's own `(if (== c nil) (return "empty")) (return (+ "..." c))`
   * reported LL0205 on code that is correct by construction.
   *
   * A single-element body is a BLOCK only if its head is not an identifier; `(fn f [] (console.log
   * "x"))` is a body of one CALL, and unwrapping that would read `console.log` and `"x"` as two
   * separate statements. Same test `visitStatement` uses.
   */
  private blockItems(body: ast.ASTNode[]): ast.ASTNode[] {
    if (body.length !== 1) return body;

    const only = body[0];
    if (!ast.isListNode(only) || only.nodes.length === 0) return body;

    const head = only.nodes[0];
    if (head._type === "simple-identifier" || head._type === "composite-identifier") return body;

    return only.nodes;
  }

  /**
   * The type an UNANNOTATED binding takes from its initializer.
   *
   * `nil` is the one value whose own type is the wrong answer. `(mut cache nil)` binds `Nil`, and
   * then every later `(cache := "x")` is "cannot assign String to Nil" -- an LL0202 false positive on
   * the single most ordinary use of a mutable optional there is. It stayed hidden only because a
   * local had no type at all; P6 is what makes it fire.
   *
   * RULING (P6): an unannotated `nil` initializer is `T?` with an UNKNOWN payload. Assignable FROM
   * anything, because we genuinely do not know what it will hold -- and still OPTIONAL, so D9's
   * forced unwrap keeps applying and a dereference before a guard is still LL0205. The alternative,
   * plain `Unknown`, would throw away the one thing the program did tell us: that it can be nil.
   *
   * An annotation still wins outright -- `(mut cache <- String? nil)` is `String?`, not this.
   */
  private initializerType(valueType: InferredType): InferredType {
    return TypeChecker.isNil(valueType)
      ? TypeEnvironment.optional(TypeEnvironment.unknown())
      : valueType;
  }

  /** One statement of a block. Extracted from visitList so the narrowing loop has a single exit. */
  private visitStatement(item: ast.ASTNode): void {
    if (this.isDeclaration(item)) {
      this.visit(item);
      return;
    }

    if (ast.isListNode(item) && item.nodes.length > 0) {
      const head = item.nodes[0];

      // The list-wrapping quirk: a parenthesised form arrives wrapped in a `list`. `(let x 5)`
      // is list{[variable]}, and `(if c a b)` is list{[if]}. Look at the head to tell what the
      // list actually IS:
      if (this.isDeclaration(head)) {
        this.visit(head);
      } else if (head._type === "simple-identifier" || head._type === "composite-identifier") {
        // A real call: `(console.log x)`. Inferring it runs the argument and operator checks.
        this.inferExpressionType(item);
      } else {
        // A wrapped special form -- if / for / while / match / when / cond / try. Visiting it
        // reaches its own visitor (visitIf) or onUnhandled, which walks its children. Treating
        // these as call expressions is what made `(if "str" 1 2)` report nothing at all.
        this.visit(head);
      }
      return;
    }

    // Control flow, identifiers, literals. visit() routes to a real visitor where one exists
    // (visitIf), and otherwise to onUnhandled, which walks the children.
    this.visit(item);
  }

  visitVariable(node: ast.VariableNode) {
    // See CollectTypesPass.visitVariable: destructuring bindings are not typed yet (D5/P8).
    if (ast.isBindingPattern(node.name)) {
      if (node.value) this.inferExpressionType(node.value);
      return;
    }
    const varName = (node.name as ast.IdentifierNode).id;
    this.context.log(LogLevel.Info, `[InferAndCheckPass.visitVariable] Processing variable: ${varName}`);

    // D20: `(let x <- Priv nil)` names Priv just as surely as `(new Priv)` does.
    this.checkAnnotationVisible(node.type);

    // If value exists, infer its type
    if (node.value) {
      const valueType = this.inferExpressionType(node.value);
      this.context.log(LogLevel.Debug, `[InferAndCheckPass.visitVariable] Inferred value type structure: ${JSON.stringify(valueType).substring(0, 200)}`);
      
      // If explicit type annotation exists, check compatibility.
      //
      // From the NODE, not from a name lookup. `resolveIdentifier(varName)` asks "what type is
      // already recorded for this name" -- and for a nested `let` the answer is NOBODY'S:
      // CollectTypesPass, the only thing that turns an annotation into a symbol type, never enters a
      // function body. So `(fn f [] (let x <- Int "hello"))` had no declared type to check against
      // and was checked by nothing at all, and a class field's annotation never reached its symbol
      // either. Worse, where a top-level homonym existed the lookup answered with ITS type, so the
      // annotation being enforced was some other variable's.
      //
      // The annotation is written right here on the node. Read it from there.
      const declaredType = node.type
        ? this.convertAstTypeToInferred(node.type)
        : undefined;
      if (declaredType) {
        this.context.log(LogLevel.Debug, `[InferAndCheckPass.visitVariable] Declared type: ${JSON.stringify(declaredType).substring(0, 200)}`);
        
        // Check if both types are arrays and have unions as elements - for recursive types, be lenient
        const isLikelyRecursive = declaredType.kind === "type-ref" && 
          valueType.kind === "generic" && valueType.name === "Array" &&
          valueType.generics?.[0]?.kind === "union";
        
        // Gradual typing: if we could not type the value, or the declaration resolved to nothing
        // we understand, we have no basis to call the assignment wrong.
        const unknownEither =
          TypeChecker.isUnknown(valueType) || TypeChecker.isUnknown(declaredType);

        if (!unknownEither && !TypeChecker.isAssignable(valueType, declaredType, this.symbolTable)) {
          // For recursive types with array/union structure, skip the error since the structure is correct
          if (!isLikelyRecursive) {
            this.reportTypeError(
              node,
              "LL0200",
              `Type mismatch: cannot assign ${TypeChecker.formatType(valueType)} to ${TypeChecker.formatType(declaredType)} for variable '${varName}'.`
            );
          } else {
            // Log as warning instead for recursive types
            this.context.log(
              LogLevel.Info,
              `[Recursive type match] Array<union> assigned to recursive type ${declaredType.refName || declaredType.name}`
            );
          }
        }
        // The DECLARED type wins (D9d).
        //
        // This bound `valueType`: the annotation was checked, and then thrown away. `(mut pet <-
        // Animal (Dog))` bound `Dog`, so a later `(pet := (Cat))` was "Cat is not a Dog" -- an
        // LL0202 FALSE POSITIVE against a declaration that explicitly permits any Animal. Annotating
        // a binding is precisely how you ask for the WIDER type; discarding it made the annotation a
        // no-op, and the wider it was, the more wrong the binding became.
        //
        // It is also what would have killed optionals on their own declaration line: `(let x <-
        // String? nil)` binds the value's type, `Null` -- so the `?` evaporated one line after it was
        // written, and `T?` could not survive to be used, let alone unwrapped.
        //
        // The no-initializer path below has ALWAYS bound the declared type. The two disagreed.
        //
        // Gradual typing still holds at the same place it always did: an annotation naming a type we
        // cannot resolve is Unknown, and Unknown must not ERASE a value type we did manage to infer.
        this.symbolTable.bindType(
          varName,
          TypeChecker.isUnknown(declaredType) ? valueType : declaredType,
          node
        );
      } else {
        // No explicit type - bind the inferred type
        this.typeEnv.bindIdentifier(varName, this.initializerType(valueType), node);
        this.context.log(LogLevel.Info, `[InferAndCheckPass] Bound inferred type for '${varName}': ${TypeChecker.formatType(valueType)}`);
      }
      
      this.typeEnv.setType(node, valueType);
    } else {
      // No initial value - check if there's a declared type. From the NODE; see above.
      const declaredType = node.type
        ? this.convertAstTypeToInferred(node.type)
        : undefined;
      if (declaredType && declaredType.kind !== "unknown") {
        // Use the declared type
        this.symbolTable.bindType(varName, declaredType, node);
        this.context.log(LogLevel.Info, `[InferAndCheckPass] Bound declared type for '${varName}': ${TypeChecker.formatType(declaredType)}`);
      } else {
        // No explicit type - default to Any type
        this.typeEnv.bindIdentifier(varName, TypeEnvironment.unknown(), node);
        this.context.log(LogLevel.Info, `[InferAndCheckPass] No initializer for '${varName}', bound Any type`);
      }
    }
  }

  /**
   * D20, the ANNOTATION door.
   *
   * A `visitTypeName` override would have been the obvious shape -- one method, every annotation --
   * and it is dead code in this pass. `InferAndCheckPass.visit` (and `CollectTypesPass.visit`)
   * deliberately OVERRIDE BaseAstTreeWalker to disable the automatic child walk: "we manually
   * control which children to visit in each visitXxx method". Nothing visits a type node, so
   * `visitTypeName` is never dispatched. It looked right, ran never, and reported nothing -- the
   * exact failure mode this phase keeps finding.
   *
   * So the annotation door is explicit, and this is the one helper the annotation-owning visitors
   * call. It walks the whole type subtree, because `Priv`, `Priv[]`, `Box<Priv>` and `Priv | Int`
   * all mention Priv (same reasoning as `collectTypeNames`, which P7 needed for variance).
   *
   * Primitives (`Int`) and generic parameters (`T`) pass through it harmlessly: they resolve to no
   * symbol, and `checkNameVisible` fires only on a POSITIVE identification.
   */
  private checkAnnotationVisible(typeNode: ast.ASTNode | undefined): void {
    if (!typeNode) return;
    const walk = (n: any): void => {
      if (!n || typeof n !== "object") return;
      if (n._type === "type-name" && typeof n.name === "string") {
        this.checkNameVisible(n, n.name);
        return;
      }
      for (const key of Object.keys(n)) {
        if (key === "_parent" || key === "_location") continue;
        const value = n[key];
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === "object") walk(value);
      }
    };
    walk(typeNode);
  }

  visitFunction(node: ast.FunctionNode) {
    this.typeEnv.enterScope(node);

    // Bind generic type parameters to the scope
    if (node.generics && node.generics.length > 0) {
      for (const generic of node.generics) {
        const genericName = generic.name;
        const genericType: InferredType = {
          kind: "generic",
          name: genericName,
        };
        this.typeEnv.bindTypeParameter(genericName, genericType);
        const funcName = typeof node.name === 'string' ? node.name : ((node.name as any).id || (node.name as any).name);
        this.context.log(LogLevel.Debug, `[InferAndCheckPass.visitFunction] Bound generic parameter '${genericName}' in function '${funcName}'`);
      }
    }
    
    // D20: the annotations a function writes down -- its parameters and its return type.
    node.params.forEach(param => this.checkAnnotationVisible(param.type));
    this.checkAnnotationVisible(node.returns);

    // Bind parameter types in function scope
    node.params.forEach(param => {
      // Destructuring parameters bind N names; not typed yet (D5/P8).
      if (ast.isBindingPattern(param.name)) return;
      const paramName = (param.name as ast.IdentifierNode).id;
      const paramType = param.type
        ? this.convertAstTypeToInferred(param.type)
        : TypeEnvironment.unknown();
      
      this.typeEnv.bindIdentifier(paramName, paramType, param);
      const chain = this.typeEnv.debugScopeChain();
      this.context.log(LogLevel.Debug, `[InferAndCheckPass] Bound parameter '${paramName}' with type ${TypeChecker.formatType(paramType)}; scope=${chain}`);
    });
    
    // Infer types in function body -- as a BLOCK, so an early-return nil-guard on a PARAMETER is
    // believed for the rest of the body. `forEach(stmt => this.visit(stmt))` skipped the narrowing
    // loop entirely; see visitBlock.
    // `visitStatement`, the same dispatch a top-level block gets.
    //
    // P6c used `this.visit` here instead, and had to: visitStatement routes `(return e)` -- a plain
    // list headed by the identifier `return` -- through inferExpressionType, which lands in the
    // unresolved-callee branch, and THAT was behind `membersChecksOnly`, which dropped every check
    // from inside the returned expression. The guard is gone (P6g), so the reason is gone.
    //
    // And `this.visit` was quietly WORSE: it sends `(return e)` to visitList, which treats it as a
    // BLOCK and walks `return` and `e` as two separate statements -- so a bare `(return multiply)`
    // never had its operand inferred at all, and LL0210 stopped seeing it. A check that goes quiet is
    // not a check that passed.
    this.visitBlock(
      this.blockItems(node.body),
      (stmt) => this.visitStatement(stmt),
      () => this.checkReturns(node)
    );

    this.typeEnv.exitScope();
  }

  /**
   * Every explicit `(return x)` in a function body must match its declared return type.
   *
   * This was a `// TODO` -- return types were collected and used to type CALL expressions, but no
   * one ever compared a body's actual returns against the declaration.
   *
   * `return` has no AST node: `(return x)` is a plain list whose head is the identifier `return`,
   * which is exactly how codegen recognises it (JSTransformerAstVisitor's `headId === "return"`).
   *
   * Only EXPLICIT returns are checked. l-lang also allows an expression body with no `return` at
   * all (`(fn add [a b] (+ a b))`), and deciding whether that implicitly returns -- and therefore
   * whether a missing return is an error -- is a language question, not a checking one. Silence
   * there is deliberate, not an oversight.
   */
  private checkReturns(node: ast.FunctionNode): void {
    if (!node.returns) return;

    const declared = this.convertAstTypeToInferred(node.returns);
    if (TypeChecker.isUnknown(declared)) return;

    // A Void/nil declaration says nothing useful about the value's type here. `Void` and `Nil` are
    // the same type (D9e) -- see TypeChecker.isNil.
    if (TypeChecker.isNil(declared)) return;

    const funcName = node.name ? ast.symbolName(node.name) : "<anonymous>";

    for (const ret of this.collectReturns(node.body)) {
      if (!ret.value) continue;

      const valueType = this.inferExpressionType(ret.value);
      if (TypeChecker.isUnknown(valueType)) continue;

      if (!TypeChecker.isAssignable(valueType, declared, this.symbolTable)) {
        this.reportTypeError(
          ret.node,
          "LL0213",
          `'${funcName}' declares it returns ${TypeChecker.formatType(declared)}, but returns ${TypeChecker.formatType(valueType)}.`
        );
      }
    }
  }

  /** The `(return x)` forms belonging to THIS function -- a nested function owns its own. */
  private collectReturns(body: ast.ASTNode[]): { node: ast.ASTNode; value?: ast.ASTNode }[] {
    const found: { node: ast.ASTNode; value?: ast.ASTNode }[] = [];

    const walk = (n: any): void => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) {
        n.forEach(walk);
        return;
      }
      if (!n._type) return;

      // Do not descend into a nested function: its returns are checked against ITS declaration.
      if (n._type === "function") return;

      if (ast.isListNode(n) && n.nodes.length > 0) {
        const head = n.nodes[0];
        if (head?._type === "simple-identifier" && (head as ast.SimpleIdentifierNode).id === "return") {
          found.push({ node: n, value: n.nodes[1] });
          return;
        }
      }

      for (const key of ast.getNodeIterableKeys(n)) walk((n as any)[key]);
    };

    body.forEach(walk);
    return found;
  }

  visitClass(node: ast.ClassNode) {
    const className = typeof node.name === 'string' ? node.name : ((node.name as any).id || (node.name as any).name);
    this.checkOperatorMethodArity(className, node.body);

    // D20: you cannot extend, or claim to implement, something another module keeps to itself.
    node.extends?.forEach(e => this.checkAnnotationVisible(e as unknown as ast.ASTNode));
    node.implements?.forEach(i => this.checkAnnotationVisible(i as unknown as ast.ASTNode));

    this.typeEnv.enterScope(node);
    this.classStack.push(className);

    // Bind generic type parameters to the scope
    if (node.generics && node.generics.length > 0) {
      for (const generic of node.generics) {
        const genericName = generic.name;
        const genericType: InferredType = {
          kind: "generic",
          name: genericName,
        };
        this.typeEnv.bindTypeParameter(genericName, genericType);
        this.context.log(LogLevel.Debug, `[InferAndCheckPass.visitClass] Bound generic parameter '${genericName}' in class '${className}'`);
      }
    }

    // Bind 'this' to the class type instance
    // We look up the class type we registered in pass 1
    const classSymbol = this.typeEnv.resolveIdentifier(className); // or symbolTable directly
    if (classSymbol) {
        const thisType: InferredType = {
            kind: "type-ref",
            name: className,
            refName: className,
            resolved: true
        };
        // Bind 'this' in the class SCOPE -- `bindInScope`, not `bindIdentifier`.
        //
        // `bindIdentifier` writes through to the symbol table, and there is no symbol named `this`:
        // BuildSymbolTableAstVisitor defines variables, parameters, functions, classes and loop
        // bindings, and never `this`. So the write had nowhere to land and did nothing -- it is all
        // 26 of P6b's lexical write misses, in one line. `this.x` therefore typed as Unknown, and
        // every check on a field access passed by knowing nothing.
        //
        // `this` is not a program symbol; it is a name that means something only inside this scope.
        // That is exactly what bindInScope is for, and what narrowing and generic type parameters
        // already use.
        this.typeEnv.bindInScope("this", thisType);
    }

    try {
      node.body.forEach(member => this.visit(member));
    } finally {
      this.classStack.pop();
      this.typeEnv.exitScope();
    }
  }

  visitInterface(node: ast.InterfaceNode) {
    const interfaceName = typeof node.name === 'string' ? node.name : ((node.name as any).id || (node.name as any).name);
    this.typeEnv.enterScope(node);

    // Bind generic type parameters to the scope
    if (node.generics && node.generics.length > 0) {
      for (const generic of node.generics) {
        const genericName = generic.name;
        const genericType: InferredType = {
          kind: "generic",
          name: genericName,
        };
        this.typeEnv.bindTypeParameter(genericName, genericType);
        this.context.log(LogLevel.Debug, `[InferAndCheckPass.visitInterface] Bound generic parameter '${genericName}' in interface '${interfaceName}'`);
      }
    }

    this.checkVariancePositions(node);

    node.body.forEach(member => this.visit(member));
    this.typeEnv.exitScope();
  }

  /**
   * LL0214 -- declaration-site variance. A type parameter may only appear where its variance allows.
   *
   *   :out T   COVARIANT      T is produced, never consumed -- return positions only
   *   :in  T   CONTRAVARIANT  T is consumed, never produced -- parameter positions only
   *   T        INVARIANT      anywhere; the default, and unrestricted
   *
   * The rule is what makes the use-site rule SOUND, not a style preference. If `:out T` could sit in
   * a parameter, then `Producer<Dog>` -- which we now accept wherever a `Producer<Animal>` is wanted
   * -- would expose a method taking a `Dog`, and the caller, holding what it believes is a
   * `Producer<Animal>`, would hand it a `Cat`. Covariance is only safe because `T` never comes IN.
   */
  private checkVariancePositions(node: ast.InterfaceNode | ast.ClassNode): void {
    const variances = new Map<string, ast.TypeVariance>();
    for (const g of node.generics ?? []) {
      if (g.variance) variances.set(g.name, g.variance);
    }
    if (variances.size === 0) return;

    const offenders = (typeNode: ast.TypeNode | undefined, illegal: ast.TypeVariance): string[] =>
      [...collectTypeNames(typeNode)].filter((n) => variances.get(n) === illegal);

    for (const member of node.body ?? []) {
      const fn = ast.isListNode(member) ? member.nodes[0] : member;
      if (!fn || fn._type !== "function") continue;
      const method = fn as ast.FunctionNode;
      const methodName = ast.symbolName(method.name);

      for (const param of method.params ?? []) {
        // A parameter is an INPUT, so it may not mention a covariant (`:out`) parameter.
        for (const name of offenders(param.type, "out")) {
          this.reportTypeError(
            param,
            "LL0214",
            `Covariant type parameter '${name}' cannot appear in the parameter position of '${methodName}'. ` +
              `':out' means '${name}' is only ever produced; a parameter consumes it.`
          );
        }
      }

      // A return type is an OUTPUT, so it may not mention a contravariant (`:in`) parameter.
      for (const name of offenders(method.returns, "in")) {
        this.reportTypeError(
          method,
          "LL0214",
          `Contravariant type parameter '${name}' cannot appear in the return position of '${methodName}'. ` +
            `':in' means '${name}' is only ever consumed; a return produces it.`
        );
      }
    }
  }

  visitTypeDef(node: ast.TypeDefNode) {
    // In the second pass, we need to resolve type references
    // Type-aliases are already registered in pass 1,
    // but we need to convert type-refs to point to actual types
    const typeName = ast.symbolName(node.name);
    
    // Get the registered type from pass 1
    const registeredType = this.typeEnv.resolveIdentifier(typeName);
    
    if (registeredType && registeredType.kind === "type-alias" && registeredType.aliasedType) {
      // Resolve type references within the aliased type
      const resolvedType = this.resolveTypeReferences(registeredType.aliasedType);
      
      // Update the type with resolved references
      const finalType: InferredType = {
        ...registeredType,
        aliasedType: resolvedType,
      };
      
      this.typeEnv.bindIdentifier(typeName, finalType, node);
      this.context.log(LogLevel.Debug, `[InferAndCheckPass] Resolved type-alias '${typeName}'`);
    }
  }

  /**
   * Does this subtree assign to a member of `this`?
   *
   * Both `(this.n := 1)` and `(this.bytes[0] := 1)` count -- the second is an INDEXER whose head is a
   * `this` path, and it is the form 07_structs actually uses, so checking only the plain member form
   * would have found nothing.
   */
  private assignsToThis(node: ast.ASTNode | undefined): boolean {
    if (!node || typeof node !== "object") return false;

    if (node._type === "simple-assignment" || node._type === "compound-assignment") {
      const target: any = (node as ast.SimpleAssignmentNode).assignable;
      const base: string | undefined =
        target?._type === "indexer"
          ? (target.id?.id ?? target.id?.name)
          : (target?.id ?? target?.name);
      if (typeof base === "string" && (base === "this" || base.startsWith("this."))) {
        return true;
      }
    }

    for (const key of Object.keys(node)) {
      if (key === "_parent" || key === "_location") continue;
      const child = (node as any)[key];
      if (Array.isArray(child)) {
        if (child.some((c) => this.assignsToThis(c))) return true;
      } else if (child && typeof child === "object" && (child as any)._type) {
        if (this.assignsToThis(child)) return true;
      }
    }

    return false;
  }

  /**
   * LL0208 -- an `:operator` declared INSIDE a type takes one parameter, or none.
   *
   * There are exactly two ways to declare an operator, and both work:
   *
   *   inside a type, ONE param   `(fn :operator + [other <- C])`   -- `this` IS the left operand.
   *                              (or ZERO, for a unary operator: `(fn :operator - [])`)
   *   at top level, TWO params   `(fn :operator + [a <- C b <- C])` -- registered in __ll_op_registry.
   *
   * A two-param METHOD is a third form that compiled, emitted `+_2` (name + arity), and was NEVER
   * CALLED -- the runtime shim probes `+_1` for a binary and `+_0` for a unary, and nothing on earth
   * looks for `+_2`. Silently dead code.
   *
   * It is refused rather than made to work, because it is genuinely ambiguous: `this` is bound and
   * meaningless inside it, and which of the three names is the left operand is anybody's guess. The
   * arity suffix itself cannot simply be dropped -- 08_operators declares both `- [other]` (binary) and
   * `- []` (unary), which without it collide on one JS key.
   */
  private checkOperatorMethodArity(
    typeName: string,
    body: ast.ASTNode[] | undefined
  ): void {
    for (const item of body ?? []) {
      const target = ast.isListNode(item) && item.nodes.length ? item.nodes[0] : item;
      if (target._type !== "function") continue;

      const fn = target as ast.FunctionNode;
      const isOperator = (fn.modifiers ?? []).some(
        (m: any) => m.modifier === "operator" || m.modifier === ":operator"
      );
      if (!isOperator) continue;

      const arity = fn.params?.length ?? 0;
      if (arity <= 1) continue;

      const opName = fn.name ? ast.symbolName(fn.name as ast.IdentifierNode) : "<operator>";
      this.reportTypeError(
        fn,
        "LL0208",
        `The operator '${opName}' is declared inside '${typeName}' with ${arity} parameters. An ` +
          `operator declared inside a type takes ONE parameter -- 'this' is the left operand -- or ` +
          `NONE for a unary operator. For a two-operand form, declare it at top level: ` +
          `(fn :operator ${opName} [a <- ${typeName} b <- ${typeName}] ...).`
      );
    }
  }

  /**
   * LL0207 -- a struct `:operator` may not mutate `this`.
   *
   * A struct is a VALUE TYPE (D11), so an operator receives its operands BY VALUE. In C# an operator
   * is `static` for exactly this reason: `a * b` cannot mutate `a`, because `a` was copied on the way
   * in. A mutating operator is not a feature that is merely discouraged -- it is not a coherent thing
   * to write.
   *
   * And it does not merely not-work; it ESCAPES. The runtime routes `(* w 2)` to `w['*_1'](2)`, so
   * `this` inside the method IS the caller's struct -- copy-on-entry cannot reach it, because the
   * receiver is not a parameter. Without this diagnostic the mutation silently lands on the original,
   * which is the exact failure value semantics exists to prevent.
   *
   * The whole corpus already complies: Complex and Vector3 build a FRESH result and return it. Only
   * `07_structs` violates it, and that file is unblockable anyway (a `..` range operator neither
   * frontend has).
   */
  private checkStructOperatorsArePure(node: ast.StructNode): void {
    const structName = ast.symbolName(node.name);

    for (const item of node.body ?? []) {
      const target = ast.isListNode(item) && item.nodes.length ? item.nodes[0] : item;
      if (target._type !== "function") continue;

      const fn = target as ast.FunctionNode;
      const isOperator = (fn.modifiers ?? []).some(
        (m: any) => m.modifier === "operator" || m.modifier === ":operator"
      );
      if (!isOperator) continue;

      if (fn.body?.some((b) => this.assignsToThis(b))) {
        this.reportTypeError(
          fn,
          "LL0207",
          `An operator on the value type '${structName}' may not mutate 'this'. A struct is passed ` +
            `BY VALUE, so the mutation would escape to the caller's struct. Build a new ` +
            `'${structName}' and return it instead.`
        );
      }
    }
  }

  visitStruct(node: ast.StructNode) {
    this.checkStructOperatorsArePure(node);
    this.checkOperatorMethodArity(ast.symbolName(node.name), node.body);

    // Similar to visitTypeDef, resolve any type references in struct members
    const structName = ast.symbolName(node.name);

    const registeredType = this.typeEnv.resolveIdentifier(structName);
    
    if (registeredType && registeredType.kind === "struct" && registeredType.members) {
      // Resolve type references in each member
      const resolvedMembers = registeredType.members.map(member => ({
        ...member,
        type: this.resolveTypeReferences(member.type),
      }));
      
      const finalType: InferredType = {
        ...registeredType,
        members: resolvedMembers,
      };
      
      this.typeEnv.bindIdentifier(structName, finalType, node);
      this.context.log(LogLevel.Debug, `[InferAndCheckPass] Resolved struct '${structName}'`);
    }
  }

  /**
   * Resolve type-ref nodes to actual types
   * This is needed for forward references and type lookups
   */
  private resolveTypeReferences(type: InferredType): InferredType {
    if (!type) return type;
    
    // If this is a primitive that might be a user-defined type, check symbol table
    if (type.kind === "primitive") {
      const resolved = this.symbolTable.resolveSymbol(type.name);
      if (resolved && resolved.inferredType) {
        // It's actually a user-defined type
        return {
          kind: "type-ref",
          name: type.name,
          refName: type.name,
          resolved: true,
        };
      }
    }
    
    // If this is already a type-ref, mark as resolved if symbol exists
    if (type.kind === "type-ref") {
      const resolved = this.symbolTable.resolveSymbol(type.refName || type.name);
      return {
        ...type,
        resolved: !!resolved,
      };
    }
    
    // Recurse into container types
    const result = { ...type };
    
    if (type.generics) {
      result.generics = type.generics.map(g => this.resolveTypeReferences(g));
    }
    if (type.alternatives) {
      result.alternatives = type.alternatives.map(a => this.resolveTypeReferences(a));
    }
    if (type.inner) {
      result.inner = this.resolveTypeReferences(type.inner);
    }
    if (type.params) {
      result.params = type.params.map(p => this.resolveTypeReferences(p));
    }
    if (type.returns) {
      result.returns = this.resolveTypeReferences(type.returns);
    }
    if (type.aliasedType) {
      result.aliasedType = this.resolveTypeReferences(type.aliasedType);
    }
    if (type.keyType) {
      result.keyType = this.resolveTypeReferences(type.keyType);
    }
    if (type.valueType) {
      result.valueType = this.resolveTypeReferences(type.valueType);
    }
    
    return result;
  }

  visitIf(node: ast.IfNode) {
    // Check condition is boolean
    const condType = this.inferExpressionType(node.condition);
    // Gradual typing, as everywhere else: a condition we could not type is not a condition we
    // can call wrong. (This check only started firing once visitList stopped skipping non-
    // declarations -- it had never run before, so it had never needed the guard.)
    if (!TypeChecker.isUnknown(condType) && condType.name !== "Boolean") {
      this.reportTypeError(
        node,
        "LL0201",
        `'if' condition must be Boolean, got ${TypeChecker.formatType(condType)}.`
      );
    }

    // `(if (!= h nil) (h.length))` -- inside the branch the guard proves, `h` is not optional (D9g).
    const guard = this.nilGuard(node.condition);

    const visitBranch = (branch: ast.ASTNode | undefined, proven: boolean) => {
      if (!branch) return;
      if (guard && guard.nonNilWhen === proven) {
        this.withNarrowed(guard.name, branch, () => this.visit(branch));
      } else {
        this.visit(branch);
      }
    };

    visitBranch(node.then, true);
    visitBranch(node.else, false);
  }

  /**
   * `(x := 5)` and `(x += 1)` -- the ONLY assignment form grammar_v2 produces.
   *
   * There was no visitor for it in either type pass, so it fell through to the onUnhandled stub:
   * `(x := "str")` on an Int was completely invisible to the type system. (`visitSimpleAssignment`
   * below does check -- but grammar_v2's assignmentOp always builds a compound-assignment node, so
   * the checked form is the one that is never produced.)
   *
   * Immutability -- rejecting an assignment to a non-`mut` binding -- is D10, and D10 is
   * explicitly P8. Not smuggled in here.
   */
  visitCompoundAssignment(node: ast.CompoundAssignmentNode) {
    const targetType = this.inferExpressionType(node.assignable);
    const valueType = this.inferExpressionType(node.value);

    if (TypeChecker.isUnknown(targetType) || TypeChecker.isUnknown(valueType)) {
      return node;
    }

    if (node.operator === ":=") {
      if (!TypeChecker.isAssignable(valueType, targetType, this.symbolTable)) {
        this.reportTypeError(
          node,
          "LL0202",
          `Type mismatch in assignment: cannot assign ${TypeChecker.formatType(valueType)} to ${TypeChecker.formatType(targetType)}.`
        );
      }
      return node;
    }

    // `x += y` means `x = x + y`: the underlying binary operator has to be defined for the pair,
    // and its result has to be assignable back to the target.
    const op = node.operator.replace(/=$/, "");
    const resultType = TypeChecker.getBinaryOpType(op, targetType, valueType);

    if (!resultType) {
      // Same rule as inferOperatorType: only judge operands we actually model.
      if (this.canJudgeOperator(targetType, valueType)) {
        this.reportTypeError(
          node,
          "LL0204",
          `Operator '${node.operator}' is not defined for ${TypeChecker.formatType(targetType)} and ${TypeChecker.formatType(valueType)}.`
        );
      }
      return node;
    }

    if (!TypeChecker.isAssignable(resultType, targetType, this.symbolTable)) {
      this.reportTypeError(
        node,
        "LL0202",
        `'${node.operator}' produces ${TypeChecker.formatType(resultType)}, which cannot be assigned back to ${TypeChecker.formatType(targetType)}.`
      );
    }

    return node;
  }

  visitSimpleAssignment(node: ast.SimpleAssignmentNode) {
    const targetType = this.inferExpressionType(node.assignable);
    const valueType = this.inferExpressionType(node.value);

    // Gradual typing, as everywhere else. (This form is only reachable via the PEG frontend --
    // grammar_v2 always builds a compound-assignment.)
    if (TypeChecker.isUnknown(targetType) || TypeChecker.isUnknown(valueType)) {
      return;
    }

    if (!TypeChecker.isAssignable(valueType, targetType, this.symbolTable)) {
      this.reportTypeError(
        node,
        "LL0202",
        `Type mismatch in assignment: cannot assign ${TypeChecker.formatType(valueType)} to ${TypeChecker.formatType(targetType)}.`
      );
    }
  }

  /**
   * Core type inference for expressions
   */
  private inferExpressionType(node: ast.ASTNode): InferredType {
    // Check if type already computed
    const cached = this.typeEnv.getType(node);
    if (cached) {
      return cached;
    }

    let inferredType: InferredType;

    switch (node._type) {
      // Literals
      case "integer-number":
        inferredType = TypeEnvironment.primitive("Int");
        break;
      
      case "float-number":
        inferredType = TypeEnvironment.primitive("Real");
        break;
      
      case "string":
      case "formatted-string":
        inferredType = TypeEnvironment.primitive("String");
        break;
      
      case "boolean":
        inferredType = TypeEnvironment.primitive("Boolean");
        break;
      
      case "null":
        // `Nil`, not `Null` (D9e). The old name was invented at this one site and known NOWHERE else
        // -- `isKnownPrimitive("Null")` is false, and `typesEqual` compares by NAME -- so a function
        // declared `-> nil` and returning `nil` was "declares Void, returns Null". It survived only
        // because checkReturns bailed out on both names before comparing them.
        inferredType = TypeEnvironment.nil();
        break;

      // Identifiers
      case "simple-identifier":
      case "composite-identifier": {
        const id = (node as ast.IdentifierNode).id;

        // TYPE comes from the type environment...
        const resolvedType = this.typeEnv.resolveIdentifier(id, node);
        inferredType = resolvedType ?? TypeEnvironment.unknown();

        // `h.length` where `h` is `String?` -- the null dereference (D9g). The BASE of a dot path is
        // the thing being dereferenced, so that is what has to be non-nil. `resolveIdentifier` walks
        // the path and returns undefined when it cannot, which is why this had to be checked here
        // rather than inferred from the result: the failure is silent and looks exactly like an
        // ordinary un-inferable member.
        if (id.includes(".")) {
          const base = id.slice(0, id.indexOf("."));
          this.checkNotNil(this.typeEnv.resolveIdentifier(base, node), node, `'${base}'`);
          // The same dot path, asked a different question: may we SEE this member? (D11c)
          this.checkMemberVisibility(id, node);
        }

        // ...but EXISTENCE comes from the symbol table, which is the thing that actually knows
        // about scopes. The type environment has its own, shallower notion of scope and fails on
        // 178 identifiers across the corpus -- overwhelmingly parameters and locals -- so a check
        // built on it would be pure noise. See checkIdentifierResolves.
        this.checkIdentifierResolves(node as ast.IdentifierNode, id);
        break;
      }

      // Collections
      case "vector": {
        const vecNode = node as ast.VectorNode;
        if (vecNode.values.length === 0) {
          inferredType = TypeEnvironment.array(TypeEnvironment.unknown());
        } else {
          const elementTypes = vecNode.values.map(v => this.inferExpressionType(v));
          // For heterogeneous vectors, create a union of the element types
          // This ensures we get Array<T1 | T2 | ...> not T1 | T2 | ...[]
          let elementType: InferredType;
          if (elementTypes.length === 1) {
            elementType = elementTypes[0];
          } else if (elementTypes.every(t => TypeChecker.typesEqual(t, elementTypes[0]))) {
            // All same type
            elementType = elementTypes[0];
          } else {
            // Heterogeneous - create union
            elementType = TypeEnvironment.union(elementTypes);
          }
          inferredType = TypeEnvironment.array(elementType);
        }
        break;
      }

      // List (function call)
      // The CORE nodes, produced by the desugarer. A pipeline is a chain of these.
      //
      // This is what REPLACES the pipeline band-aid: the checker used to special-case a `list` that
      // "looks like a pipeline" and type it Unknown, because it read `(account |> (.apply evt))` as a
      // standalone call to the free `apply` -- ONE argument against TWO parameters -- and reported a
      // phantom LL0211. Once the piped value is a REAL argument, the arity is simply correct. The
      // error does not need suppressing; it does not exist.
      case "call": {
        const callNode = node as ast.CallNode;
        const callee = callNode.callee;
        const argTypes = callNode.arguments.map((a) => this.inferExpressionType(a));

        const calleeIsName =
          callee._type === "simple-identifier" || callee._type === "composite-identifier";
        const funcName = calleeIsName ? (callee as ast.IdentifierNode).id : undefined;
        const funcType = funcName
          ? this.typeEnv.resolveIdentifier(funcName, callee)
          : this.inferExpressionType(callee);

        if (funcName && funcType && funcType.kind === "function") {
          this.checkCallArguments(funcType, funcName, callNode.arguments, argTypes, callNode);
          // Phase 5: solve the function's type variables from the arguments. The core `call` node is
          // the SECOND call site, and it gets this for the same reason the first one does.
          inferredType = this.instantiateReturn(funcType, argTypes);
        } else {
          // A callee we cannot type -- an imported member, a JS global, a computed expression.
          // Its EXISTENCE is still worth asserting when it is a name.
          if (calleeIsName) {
            this.checkIdentifierResolves(callee as ast.IdentifierNode, funcName!);
          }
          inferredType = TypeEnvironment.unknown();
        }
        break;
      }

      case "member": {
        const memberNode = node as ast.MemberNode;
        this.inferExpressionType(memberNode.object);
        // The member of a value we may know nothing about. Typing it needs the object's type and a
        // member table -- that is the type channel's job (Tg), not this one.
        inferredType = TypeEnvironment.unknown();
        break;
      }

      case "list": {
        const listNode = node as ast.ListNode;
        if (listNode.nodes.length === 0) {
          inferredType = TypeEnvironment.unknown();
          break;
        }

        const firstNode = listNode.nodes[0];

        // Check if it's a function call
        if (firstNode._type === "simple-identifier" || firstNode._type === "composite-identifier") {
          const funcName = (firstNode as ast.IdentifierNode).id;
          const funcType = this.typeEnv.resolveIdentifier(funcName, firstNode);

          // D20, and it has to be asked HERE -- before the dispatch below, not inside it.
          //
          // `checkIdentifierResolves` is only reached on the ELSE branch, i.e. when the head did NOT
          // resolve. A call to an unexported function resolves perfectly well: it takes the
          // `funcType.kind === "function"` branch, gets its arity checked, and is never asked whether
          // it was allowed to be seen at all. Visibility is a question about a name that RESOLVED --
          // which is exactly the question nothing in this compiler was asking (D20).
          this.checkNameVisible(firstNode, funcName);

          // The TOTAL container accessors are the ONLY things in the language that PRODUCE a `T?`.
          const totalAccessor = this.inferTotalAccessorType(funcName, listNode.nodes.slice(1));
          if (totalAccessor) {
            inferredType = totalAccessor;
            break;
          }

          // OPERATORS FIRST -- before the plain-function branch below.
          //
          // A user-defined overload (`(fn :operator + [c1 <- Complex, c2 <- Complex] -> Complex)`)
          // is registered in the type environment as an ordinary symbol NAMED "+". So resolving the
          // head as a function made every `+` in the file resolve to the Complex overload, and
          // `(+ c1.real c2.real)` -- adding two Reals -- reported
          //     Argument 1 type mismatch: Expected Complex, got Real
          // An operator is not a function you can shadow; which overload applies depends on the
          // OPERAND types, which is exactly what inferOperatorType/TypeChecker.findOperator does.
          if (TypeChecker.isOperatorName(funcName)) {
            inferredType = this.inferOperatorType(funcName, listNode.nodes.slice(1));
          }
          // Handle function calls
          else if (funcType && funcType.kind === "function") {
            // Check argument types
            const args = listNode.nodes.slice(1);
            const argTypes = args.map(arg => this.inferExpressionType(arg));

            // ARITY. There was no check at all: the loop below iterates the ARGUMENTS with an
            // `i < params.length` guard, so extra arguments were silently skipped and missing ones
            // were never noticed.
            //
            // A variadic function absorbs the tail, so its declared params are a MINIMUM, not an
            // exact count -- the corpus really does have `(fn print [msg <- String ...args])`,
            // `compose` and `partial`.
            this.checkCallArguments(funcType, funcName, args, argTypes, listNode);

            // Phase 5: `funcType.returns` was handed back RAW, so a declared `-> T?` reached the
            // caller as a literal `{kind:"generic", name:"T", optional:true}` -- a type no check knows
            // what to do with, and the reason a generic optional never fired.
            inferredType = this.instantiateReturn(funcType, argTypes);
          }
          // Handle struct constructors
          else if (funcType && funcType.kind === "struct") {
            // Calling a struct returns an instance of that struct
            inferredType = {
              kind: "type-ref",
              name: funcName,
              refName: funcName,
              resolved: true,
            };
          }
          // Handle class constructors
          else if (funcType && funcType.kind === "class") {
            // Calling a class returns an instance of that class
            inferredType = {
              kind: "type-ref",
              name: funcName,
              refName: funcName,
              resolved: true,
            };
          } else if (funcName === "new") {
            // `(new Box 5)` -- there is no `new` AST node; the head is just the identifier `new`,
            // which resolves to nothing. It used to fall into inferOperatorType and emit a
            // spurious "Invalid binary operator 'new' for types ...". Model it the way the bare
            // `(Box 5)` form above already is: an instance of the named class/struct.
            inferredType = this.inferNewExpression(listNode.nodes.slice(1));
          } else {
            // A call head we could not resolve, and which is not an operator: a JS global
            // (`Math.log`), a member call (`s.indexOf`), or a genuinely undefined function.
            //
            // Its TYPE is Unknown -- routing it through the operator tables and complaining that it
            // is not a valid operator was the single biggest source of false positives in this pass.
            // But its EXISTENCE is exactly the thing worth checking: "silently degrades into a call
            // to an undefined function" is the audit's headline bug class, and a call head is the
            // reference position where it bites hardest.
            //
            // Checked here rather than in inferExpressionType's identifier case, because a call
            // head never passes through it -- the list dispatch reads `funcName` directly.
            this.checkIdentifierResolves(firstNode as ast.IdentifierNode, funcName);

            // The arguments were never visited at all, so a member access INSIDE one was invisible --
            // `(let z h.length)` reported LL0205 while `(console.log h.length)`, the same expression,
            // reported nothing. Member checks only; see inferArgumentsForMembersOnly.
            this.inferArguments(listNode.nodes.slice(1));

            inferredType = TypeEnvironment.unknown();
          }
        } else {
          inferredType = TypeEnvironment.unknown();
        }
        break;
      }

      // If expression
      case "if": {
        const ifNode = node as ast.IfNode;
        const thenType = this.inferExpressionType(ifNode.then);
        const elseType = ifNode.else 
          ? this.inferExpressionType(ifNode.else)
          : TypeEnvironment.primitive("Void");
        
        inferredType = TypeChecker.findCommonType([thenType, elseType]) ?? TypeEnvironment.unknown();
        break;
      }

      // Map literal
      case "map": {
        const mapNode = node as ast.MapNode;
        if (mapNode.values.length === 0) {
          // Empty map - unknown key and value types
          inferredType = TypeEnvironment.map(
            TypeEnvironment.unknown(),
            TypeEnvironment.unknown()
          );
        } else {
          // Extract key-value pairs from values array
          const keyTypes: InferredType[] = [];
          const valueTypes: InferredType[] = [];
          
          for (const item of mapNode.values) {
            if (item._type === "key-value") {
              const kvNode = item as ast.KeyValueNode;
              keyTypes.push(this.inferExpressionType(kvNode.key));
              valueTypes.push(this.inferExpressionType(kvNode.value));
            }
          }
          
          const commonKeyType = keyTypes.length > 0 
            ? TypeChecker.findCommonType(keyTypes) ?? TypeEnvironment.unknown()
            : TypeEnvironment.unknown();
          const commonValueType = valueTypes.length > 0
            ? TypeChecker.findCommonType(valueTypes) ?? TypeEnvironment.unknown()
            : TypeEnvironment.unknown();
          
          inferredType = TypeEnvironment.map(commonKeyType, commonValueType);
        }
        break;
      }

      // Indexer (e.g., array[i], map[key])
      case "indexer": {
        const indexerNode = node as ast.IndexerNode;
        const containerType = this.inferExpressionType(indexerNode.id as any);

        // Indexing into a possibly-nil container is a dereference like any other (D9g).
        this.checkNotNil(containerType, indexerNode.id, "the indexed value");

        // NOT optional, deliberately (D9f). `c[k]` is PARTIAL: it asserts the thing is there, and
        // throws if it is not. That is what lets `xs[i]` be a plain `Int` and stay honest -- it used
        // to be a plain `Int` that handed back `undefined`, which is a hole straight through the type
        // system. The question "is it there?" is asked with the TOTAL form, `(get c k)`, below.
        inferredType =
          this.containerElementType(containerType) ?? TypeEnvironment.unknown();
        break;
      }

      default:
        inferredType = TypeEnvironment.unknown();
        this.context.log(LogLevel.Debug, `No type inference for node type: ${node._type}`);
    }

    // Cache the result
    this.typeEnv.setType(node, inferredType);
    return inferredType;
  }

  /**
   * Infer type for operator expressions
   */
  /**
   * `(new Box 5)` -> an instance of Box.
   *
   * There is no `new` AST node: the form is a plain list whose head is the identifier `new`
   * (codegen recognises it the same way, JSTransformerAstVisitor's `headId === "new"`). Its first
   * argument names the class or struct.
   */
  private inferNewExpression(args: ast.ASTNode[]): InferredType {
    const target = args[0];
    if (!target || (target._type !== "simple-identifier" && target._type !== "composite-identifier")) {
      return TypeEnvironment.unknown();
    }

    const name = (target as ast.IdentifierNode).id;

    // D20, and THE door that makes the difference between enforcing the boundary and appearing to.
    //
    // `new` never reaches checkIdentifierResolves -- it lands here, and a miss here just returns
    // Unknown. So an Sb wired only into the obvious door passes every gate while a private class
    // still leaks, and the corpus is the proof: the ONLY leaked reference in
    // `20-stdlib/complex_math_test/main.lisp` -- a LIVE golden test -- is `Complex`, and it appears
    // solely as `(new Complex 1.0 2.0)`.
    this.checkNameVisible(target, name);

    const resolved = this.typeEnv.resolveIdentifier(name);

    if (resolved && (resolved.kind === "class" || resolved.kind === "struct")) {
      return { kind: "type-ref", name, refName: name, resolved: true };
    }

    // An unknown class is not an operator error; it is an unresolved identifier (P4c). Still a hole:
    // Sb adds the PRIVATE case, not the MISSING one. Different bug, different code.
    return TypeEnvironment.unknown();
  }

  /**
   * May we say an operator is INVALID for these operands?
   *
   * Only if we fully understand them. TypeChecker's operator tables model PRIMITIVES (Int, Real,
   * Char, Boolean, String) and nothing else, so a user-defined type reaching them proves only that
   * our overload model came up empty -- not that the code is wrong.
   *
   * And it does come up empty, for a real reason. `TypeChecker.findOperator` looks for a MEMBER
   * method of the class/struct with arity 1 (`this` plus one operand), which is how
   * 20-stdlib/std/math.lisp declares them:
   *
   *     (defclass Complex ... (fn :operator + [c2 <- Complex] -> Complex ...))
   *
   * But examples/04-data-types/09_operators.lisp declares the same operators as FREE FUNCTIONS
   * taking both operands:
   *
   *     (defstruct Complex ...)
   *     (fn :operator + [c1 <- Complex c2 <- Complex] -> Complex ...)
   *
   * Both conventions are in the corpus; findOperator models only the first. Deciding which is
   * canonical -- and resolving overloads properly -- is D5/P8 type-system work. Until then,
   * reporting "Invalid binary operator '+' for types Complex and Complex" on code that runs
   * correctly is a false positive, and this is the guard that stops it.
   */
  private canJudgeOperator(...types: InferredType[]): boolean {
    return types.every((t) => t.kind === "primitive" && !t.isArray);
  }

  /**
  /**
   * The RESIDUAL. Three names, where there were thirty-seven.
   *
   * `JS_GLOBALS` is gone (Sd3) -- a hardcoded 37-name allowlist that lived inside the type checker and
   * waved raw JavaScript through untyped. It was never a standard library; it was a hole in the type
   * system, and `console` alone went through it 579 times. It is now `lib/std/js.lisp`: ordinary
   * l-lang `:extern` declarations, imported implicitly (Context.injectPrelude). That is the whole of
   * "hide the JS" -- interop belongs behind a library boundary, not inside the compiler -- and it
   * makes the set EXTENSIBLE, which a hardcoded set could never be.
   *
   * These three could not go with it, and the reason is a real defect in the language rather than an
   * oversight: **l-lang resolves types and values from ONE namespace**, and each of these is BOTH an
   * l-lang type and a JS value.
   *
   *     String, Boolean   PRIMITIVES. Used as values ZERO times in the corpus.
   *     Number            a `deftype` in std/types. Used as a value twice: `(Number str)` coerces,
   *                       and `(== (type tree) Number)` compares against the constructor.
   *
   * Declaring `Number` in the prelude was tried, and it produced **11 new LL0203s** -- *expected
   * Number, got Int*. Inside std/math, `<- Number` resolves LEXICALLY to that file's own
   * `deftype Number Int | Real`; but when another module checks a CALL to one of math's functions, the
   * parameter's type-ref is resolved in the CALLER's scope, the lexical walk misses, and the flat
   * cross-module fallback finds the extern -- a variable, not a union. `Int` stops being assignable.
   *
   * So they are named here, and named as a defect. The real fix is to stop resolving types and values
   * from one namespace (or to prefer a type-kind symbol when resolving a type name); until then, a
   * three-name shim is the honest answer, and a thirty-seven-name allowlist was not.
   *
   * NO `undefined`, and there must never be (D9). It is the second bottom value; dropping it from
   * `NilKw` while leaving it in an ambient set would simply re-admit it, still emitting the JS
   * `undefined`, with zero diagnostics. LL0210 refuses it by name.
   */
  private static readonly TYPE_NAMED_GLOBALS = new Set(["String", "Boolean", "Number"]);

  /**
   * Special forms. These are not functions and are never declared: the parser hands them through
   * as a plain list whose head is an identifier, exactly as codegen recognises them.
   */
  private static readonly SPECIAL_FORMS = new Set([
    "return", "new", "throw", "quote", "await", "yield",
    "typeof", "delete", "in", "instanceof",
    "this", "super",
  ]);

  /**
   * LL0210 -- an identifier in REFERENCE position that resolves to nothing.
   *
   * The audit's starred finding: no unresolved-identifier check existed anywhere in the compiler,
   * so `(bogus-fn 1)` compiled clean and became a call to an undefined function at runtime. It
   * could not be written before P6 made resolution scope-aware -- resolveSymbol was a flat search
   * of module-root tables and could not see a parameter or a local at all.
   *
   * It is asked HERE, in inferExpressionType, and that placement is the whole trick. This is
   * reference position by construction: an identifier being used as a VALUE. Trying to check every
   * identifier NODE instead flags map keys (`{:name "x"}`), enum keys (`:GET`), a function's own
   * name, and generic type parameters -- none of which are references to anything.
   */
  private checkIdentifierResolves(node: ast.IdentifierNode, id: string): void {
    // A map or enum KEY is a literal, not a reference. `{ :name "Alice" :age 30 }` names nothing;
    // it is the identifier `name` only in the sense that `"name"` is a string. Inference walks into
    // the key slot, so the guard belongs here rather than in the traversal.
    // Compared by LOCATION, not identity: this pass runs on the DESUGARED AST while `_parent`
    // points at the pre-desugar node (BaseAstTreeWalker copies the original parent reference), so
    // `parent.key === node` is never true. Offsets survive desugar; node identity does not.
    const parent = node._parent as ast.ASTNode | undefined;
    const isKeySlot =
      parent !== undefined &&
      (parent._type === "key-value" ||
        parent._type === "enum-key" ||
        parent._type === "map-pattern-pair") &&
      (parent as any).key?._location?.start?.offset === node._location?.start?.offset;

    if (isKeySlot) return;

    // A member expression only asserts the existence of its HEAD: `x.foo.bar` says nothing about
    // `foo` or `bar`, which are JS property lookups on a value we may know nothing about.
    //
    // `:` separates too. `HttpMethod:POST` is an ENUM MEMBER -- the symbol is `HttpMethod`, and
    // `POST` is a key inside it, no more a reference than `bar` is in `x.foo.bar`. Splitting on `.`
    // alone left the whole string as the head, which of course resolved to nothing, so every enum
    // member in the corpus read as an undefined identifier.
    const head = id.split(/[.:]/)[0];
    if (!head) return;

    // A JS global is now an ordinary SYMBOL, declared `:extern` in `lib/std/js.lisp` and resolved
    // through the symbol table below like every other name -- so `console` is subject to the same
    // rules as `my-function`, which is the point. TYPE_NAMED_GLOBALS is the three-name residual that
    // could not make the move; see its note.
    if (
      TypeChecker.isOperatorName(head) ||
      InferAndCheckPass.SPECIAL_FORMS.has(head) ||
      InferAndCheckPass.TYPE_NAMED_GLOBALS.has(head) ||
      RuntimeProvider.isRuntimeReference(head)
    ) {
      return;
    }

    // The CONTEXT's symbol table, not this pass's `this.symbolTable`.
    //
    // The pass is handed the MODULE's own table (buildSymbolTable()'s result), which contains only
    // that module's root and its nested scopes. Imported modules are joined into the CONTEXT's
    // table (`this.symbolTable.join(moduleSymbols)` in Context.process), which is also what codegen
    // resolves against. Asking the module-local table alone flags every imported symbol -- `log`,
    // `print`, `double`, `dot-product` -- as undefined.
    const symbols = this.context.symbolTable ?? this.symbolTable;
    const entry = symbols.resolveSymbol(head, node);
    if (entry) {
      // It resolves. That used to be the end of the question -- and it is why `(export ...)` meant
      // nothing: a name from another module resolved whether or not that module offered it (D20).
      this.checkSymbolVisible(node, head, entry);
      return;
    }

    this.reportTypeError(
      node,
      "LL0210",
      `'${head}' is not defined.`
    );
  }

  /**
   * LL0215 (D20) -- the symbol resolves, but the module that owns it does not export it.
   *
   * "Resolves" and "is visible" are different questions, and until Sb the compiler only asked the
   * first. The distinction is worth the extra code: telling someone `'secret-fn' is not defined` when
   * it plainly IS defined, in a file they are looking at, is a worse answer than the truth. So a
   * private symbol stays RESOLVABLE and is refused by name, rather than being hidden and reported as
   * a typo.
   *
   * `SymbolTable.isVisibleFrom` is the single implementation of the rule. This is its only reporter.
   */
  private checkSymbolVisible(node: ast.ASTNode, name: string, entry: SymbolEntry): void {
    const askingFile = node._location?.source;
    const declaredIn = (entry.value as any)?._location?.source;
    const where = declaredIn ? path.basename(declaredIn) : "another module";

    // The EXPORT side (Sb): does that module offer this name?
    if (!SymbolTable.isVisibleFrom(entry, askingFile)) {
      this.reportTypeError(
        node,
        "LL0215",
        `'${name}' is defined in '${where}' but is not exported. Add it to that module's (export ...) list to make it public.`
      );
      return;
    }

    // The IMPORT side (Sc): did THIS file ask for it?
    //
    // The symmetric question, and until now nobody asked it either -- `ImportDefinition.symbols` was
    // built by both AST builders and read by nobody, so `(import { a } from "m")` behaved exactly
    // like importing the whole of `m`. An operator is exempt here for the same reason it is exempt
    // from LL0215 (W): it is not a name, so it cannot appear in an import list.
    if (
      !entry.isOperator &&
      declaredIn !== askingFile &&
      !this.context.importBinds(askingFile, declaredIn, name)
    ) {
      this.reportTypeError(
        node,
        "LL0216",
        `'${name}' is exported by '${where}', but this file's import does not bind it. Add it to the import list: (import { ${name} } from ...).`
      );
    }
  }

  /**
   * The same question, for a door that has only a NAME and a node -- `new`, and type annotations.
   */
  private checkNameVisible(node: ast.ASTNode, name: string): void {
    const head = name.split(/[.:]/)[0];
    if (!head) return;
    const symbols = this.context.symbolTable ?? this.symbolTable;
    const entry = symbols.resolveSymbol(head, node);
    if (!entry) return; // unresolved is LL0210's business, and only where LL0210 is asked
    this.checkSymbolVisible(node, head, entry);
  }

  /**
   * PHASE 5 -- SOLVE for the type variables, from the arguments.
   *
   * `unify(param, arg, subst)` reads a declared parameter type against the actual argument type and
   * records what that implies about each free variable. `T[]` against `Int[]` recurses into the
   * element and learns `T = Int`.
   *
   * `free` is the set of names that are actually this function's OWN type parameters. Without it,
   * every `{kind:"generic"}` in a signature looks like a variable to solve -- including a class
   * genuinely named `T`, and including a type parameter belonging to an ENCLOSING generic class, which
   * is bound in the environment and must NOT be re-solved per call.
   *
   * First binding wins. `(fn pair<T> [a <- T b <- T])` called as `(pair 1 "x")` binds `T = Int` and
   * then leaves the `String` to be REPORTED by checkCallArguments as an LL0203 -- rather than silently
   * widening `T` to `Int | String`, which would make a wrong call typecheck. A generic call that does
   * not agree with itself is an error, not a union.
   */
  private unify(
    param: InferredType | undefined,
    arg: InferredType | undefined,
    free: Set<string>,
    subst: Map<string, InferredType>
  ): void {
    if (!param || !arg) return;

    if (TypeChecker.isBareTypeParameter(param) && free.has(param.name)) {
      if (subst.has(param.name)) return; // first binding wins; the mismatch is LL0203's to report
      // The `?` on the PARAMETER belongs to the signature, not to what T stands for:
      // `(fn f<T> [x <- T?])` called with an `Int?` learns `T = Int`, not `T = Int?`.
      subst.set(param.name, param.optional ? { ...arg, optional: false } : arg);
      return;
    }

    // Gradual typing: an argument we could not type teaches us nothing about T. Binding `Unknown` to
    // it would be worse than leaving it free -- it would silence every downstream check, permanently.
    if (TypeChecker.isUnknown(arg)) return;

    // Structural recursion. `T[]` vs `Int[]`, `Box<T>` vs `Box<Int>`, `Map<String,T>` vs
    // `Map<String,Int>`, `(T) -> U` vs `(Int) -> String`.
    if (param.generics && arg.generics) {
      const n = Math.min(param.generics.length, arg.generics.length);
      for (let i = 0; i < n; i++) this.unify(param.generics[i], arg.generics[i], free, subst);
    }
    if (param.inner) this.unify(param.inner, arg.inner ?? arg.generics?.[0], free, subst);
    if (param.keyType) this.unify(param.keyType, arg.keyType, free, subst);
    if (param.valueType) this.unify(param.valueType, arg.valueType, free, subst);
    if (param.params && arg.params) {
      const n = Math.min(param.params.length, arg.params.length);
      for (let i = 0; i < n; i++) this.unify(param.params[i], arg.params[i], free, subst);
    }
    if (param.returns) this.unify(param.returns, arg.returns, free, subst);
  }

  /**
   * PHASE 5 -- APPLY the solution. `T?` with `T = Int` becomes `Int?`.
   *
   * Modelled on `resolveTypeReferences`, which is the same shape of deep structural map.
   *
   * **`optional` is a FLAG, not a wrapper** (D9), and carrying it is the whole point of this function.
   * Lose it and `-> T?` quietly becomes `Int` instead of `Int?`: LL0205 never fires, every gate stays
   * green, and the feature looks finished while doing nothing. Same for `isArray`.
   *
   * Returns the input unchanged when there is nothing to substitute, so a non-generic call pays
   * nothing and -- more importantly -- cannot be perturbed by this code path at all.
   */
  private substitute(type: InferredType, subst: Map<string, InferredType>): InferredType {
    if (!type || subst.size === 0) return type;

    if (TypeChecker.isBareTypeParameter(type) && subst.has(type.name)) {
      const solved = subst.get(type.name)!;
      // The `?` on the PARAMETER survives the substitution: `T?` where `T = Int` is `Int?`. If the
      // solution is itself optional, it stays optional -- `?` does not stack, it is a flag.
      return type.optional || solved.optional ? { ...solved, optional: true } : solved;
    }

    const result = { ...type };
    if (type.generics) result.generics = type.generics.map((g) => this.substitute(g, subst));
    if (type.alternatives) result.alternatives = type.alternatives.map((a) => this.substitute(a, subst));
    if (type.inner) result.inner = this.substitute(type.inner, subst);
    if (type.params) result.params = type.params.map((p) => this.substitute(p, subst));
    if (type.returns) result.returns = this.substitute(type.returns, subst);
    if (type.keyType) result.keyType = this.substitute(type.keyType, subst);
    if (type.valueType) result.valueType = this.substitute(type.valueType, subst);
    return result;
  }

  /**
   * The return type of a call, with the function's type variables solved from the arguments.
   *
   * This is the ONE place a call's result type is computed, and it is called from BOTH call sites --
   * the `list` branch and the core `call` node. Wiring only one is the exact shape of Sb's `new`-door
   * half-fix: every gate green, the feature half-blind.
   */
  private instantiateReturn(funcType: InferredType, argTypes: InferredType[]): InferredType {
    const returns = funcType.returns ?? TypeEnvironment.unknown();
    const tps = funcType.typeParameters;
    if (!tps?.length || !funcType.params?.length) return returns;

    const free = new Set(tps.map((t) => t.name));
    const subst = new Map<string, InferredType>();
    const n = Math.min(funcType.params.length, argTypes.length);
    for (let i = 0; i < n; i++) this.unify(funcType.params[i], argTypes[i], free, subst);

    return this.substitute(returns, subst);
  }

  /**
   * LL0211 (arity) and LL0203 (argument types), for ANY call -- a `list` headed by a name, or a core
   * `call` node.
   *
   * Extracted rather than duplicated: a desugared pipeline is a call, and a call is a call. Writing
   * the rule twice is how the compiler ended up with three different answers to "is this a call".
   *
   * A variadic function absorbs the tail, so its declared params are a MINIMUM, not an exact count --
   * the corpus really does have `(fn print [msg <- String ...args])`, `compose` and `partial`.
   */
  private checkCallArguments(
    funcType: InferredType,
    funcName: string,
    args: ast.ASTNode[],
    argTypes: InferredType[],
    reportNode: ast.ASTNode
  ): void {
    if (!funcType.params) return;

    const declared = funcType.params.length;
    const required = funcType.isVariadic ? declared - 1 : declared;
    const tooFew = args.length < required;
    const tooMany = !funcType.isVariadic && args.length > declared;

    if (tooFew || tooMany) {
      const expected = funcType.isVariadic ? `at least ${required}` : `${declared}`;
      this.reportTypeError(
        reportNode,
        "LL0211",
        `'${funcName}' expects ${expected} argument${required === 1 && !funcType.isVariadic ? "" : "s"}, got ${args.length}.`
      );
    }

    argTypes.forEach((argType, i) => {
      if (i >= funcType.params!.length) return;
      const expectedType = funcType.params![i];
      // Gradual typing: an unannotated parameter accepts anything, and an argument we could not type
      // tells us nothing. Reporting either way is noise.
      if (TypeChecker.isUnknown(expectedType) || TypeChecker.isUnknown(argType)) return;
      if (!TypeChecker.isAssignable(argType, expectedType, this.symbolTable)) {
        this.reportTypeError(
          args[i] ?? reportNode,
          "LL0203",
          `Argument ${i + 1} of '${funcName}': expected ${TypeChecker.formatType(expectedType)}, got ${TypeChecker.formatType(argType)}.`
        );
      }
    });
  }

  private inferOperatorType(op: string, args: ast.ASTNode[]): InferredType {
    if (args.length === 1) {
      // Unary operator
      const operandType = this.inferExpressionType(args[0]);

      // Check for user-defined operator first
      const userOpType = TypeChecker.findOperator(operandType, op, 0, this.symbolTable);
      if (userOpType && userOpType.kind === "function") {
        return userOpType.returns || TypeEnvironment.unknown();
      }

      // Gradual typing: if we do not know the operand's type, we cannot know the operator is
      // wrong. Reporting against Unknown is how a checker becomes a noise generator.
      if (TypeChecker.isUnknown(operandType)) {
        return TypeEnvironment.unknown();
      }

      const resultType = TypeChecker.getUnaryOpType(op, operandType);

      if (!resultType && !this.canJudgeOperator(operandType)) {
        return TypeEnvironment.unknown();
      }

      if (!resultType) {
        this.reportTypeError(
          args[0],
          "LL0204",
          `Operator '${op}' is not defined for ${TypeChecker.formatType(operandType)}.`
        );
        return TypeEnvironment.unknown();
      }
      
      return resultType;
    } else if (args.length === 2) {
      // Binary operator
      const leftType = this.inferExpressionType(args[0]);
      const rightType = this.inferExpressionType(args[1]);

      // An optional OPERAND (D9g) -- but never for equality, which is how you DISCHARGE the
      // obligation. If `(== h nil)` were itself an error the feature would eat its own tail: the
      // only way to satisfy LL0205 would be the one expression LL0205 forbids.
      //
      // Needed because `Int?` is still NAMED `Int`, so `isNumeric` says yes and `(+ h 1)` sailed
      // straight through getBinaryOpType to produce "null1" or NaN at run time.
      if (op !== "==" && op !== "!=" && op !== "≠") {
        this.checkNotNil(leftType, args[0], `the left operand of '${op}'`);
        this.checkNotNil(rightType, args[1], `the right operand of '${op}'`);
      }

      // Check for user-defined operator first on the left operand
      const userOpType = TypeChecker.findOperator(leftType, op, 1, this.symbolTable);
      if (userOpType && userOpType.kind === "function") {
        // We SHOULD also check if rightType is assignable to the first parameter of userOpType
        const firstParamType = userOpType.params?.[0];
        if (firstParamType && TypeChecker.isAssignable(rightType, firstParamType, this.symbolTable)) {
          return userOpType.returns || TypeEnvironment.unknown();
        }
      }

      // Gradual typing -- see the unary case above.
      if (TypeChecker.isUnknown(leftType) || TypeChecker.isUnknown(rightType)) {
        return TypeEnvironment.unknown();
      }

      const resultType = TypeChecker.getBinaryOpType(op, leftType, rightType);

      if (!resultType && !this.canJudgeOperator(leftType, rightType)) {
        return TypeEnvironment.unknown();
      }

      if (!resultType) {
        this.reportTypeError(
          args[0],
          "LL0204",
          `Operator '${op}' is not defined for ${TypeChecker.formatType(leftType)} and ${TypeChecker.formatType(rightType)}.`
        );
        return TypeEnvironment.unknown();
      }
      
      return resultType;
    }
    
    return TypeEnvironment.unknown();
  }

  /**
   * Convert AST type to InferredType (same as CollectTypesPass)
   */
  private convertAstTypeToInferred(typeNode: ast.TypeNode): InferredType {
    return convertAstType(typeNode, this.symbolTable, this.typeEnv);
  }

  visitModifierDef(node: ast.ModifierDefNode) {
    // Enter modifier scope and infer body types
    this.typeEnv.enterScope(node);
    
    // Process parameters
    node.params.forEach(param => this.visit(param));
    
    // Process body statements
    node.body.forEach(stmt => this.visit(stmt));
    
    this.typeEnv.exitScope();
  }

  visitSpread(node: ast.SpreadNode) {
    // InferAndCheckPass: Infer type of the spread expression
    const exprType = this.visit(node.expression);
    // For spread in function parameters, we typically expect array types
    // The spread should preserve the element type of the array
    return exprType;
  }
}

/**
 * InferTypesAstVisitor - Main visitor implementing two-pass type inference
 */
export class InferTypesAstVisitor extends BaseAstTreeWalker {
  private typeEnv: TypeEnvironment | undefined;
  private symbolTable: SymbolTable;

  constructor(context: any, symbolTable: SymbolTable) {
    super(context);
    this.symbolTable = symbolTable;
  }

  /**
   * Get the type environment after inference completes
   */
  getTypeEnvironment(): TypeEnvironment | undefined {
    return this.typeEnv;
  }

  /**
   * This should not be called directly
   */
  visit(node: ast.ASTNode, defaultVisitor?: (node?: ast.ASTNode) => any): any {
    throw new Error("InferTypesAstVisitor should use inferTypes() method");
  }

  /**
   * Two-pass type inference:
   * 1. Collect: Scan declarations and explicit type annotations
   * 2. Infer & Check: Enter function bodies, infer expression types, validate
   */
  inferTypes(ast: ast.ASTNode): void {
    this.context.log(LogLevel.Info, "=== Pass 1: Collecting type annotations ===");
    
    // Pass 1: Collect explicit types
    const collectPass = new CollectTypesPass(this.context, this.symbolTable);
    collectPass.visit(ast);
    this.typeEnv = collectPass.getTypeEnvironment();

    this.context.log(LogLevel.Info, "=== Pass 2: Inferring and checking types ===");
    
    // Pass 2: Infer and validate
    const inferPass = new InferAndCheckPass(this.context, this.typeEnv, this.symbolTable);
    inferPass.visit(ast);

    this.context.log(LogLevel.Info, "=== Type inference complete ===");
  }
}