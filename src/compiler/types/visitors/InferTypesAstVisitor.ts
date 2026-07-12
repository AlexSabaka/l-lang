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
import { SymbolTable } from "../../analysis";

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
function convertAstType(
  typeNode: ast.TypeNode,
  symbolTable: SymbolTable,
  typeEnv: TypeEnvironment
): InferredType {
  const recur = (t: ast.TypeNode) => convertAstType(t, symbolTable, typeEnv);

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

  // Generic types (Array<Int>, Map<String,Int>)
  if (typeNode._type === "generic-type") {
    const genericNode = typeNode as unknown as ast.GenericTypeNode;
    const baseType = genericNode.name.name;
    const genericParams =
      genericNode.generics?.map((g) =>
        recur({ _type: "simple-type", name: g, array: false } as any)
      ) ?? [];

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
      p.type ? this.convertAstTypeToInferred(p.type) : TypeEnvironment.unknown()
    );

    const returnType = node.returns
      ? this.convertAstTypeToInferred(node.returns)
      : TypeEnvironment.primitive("Void");

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

    const funcType = TypeEnvironment.function(paramTypes, returnType, isVariadicParams(node.params));
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
          const memberType = varNode.type ? this.convertAstTypeToInferred(varNode.type) : TypeEnvironment.unknown();
          
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
          const paramTypes = funcNode.params.map(p => p.type ? this.convertAstTypeToInferred(p.type) : TypeEnvironment.unknown());
          const returnType = funcNode.returns ? this.convertAstTypeToInferred(funcNode.returns) : TypeEnvironment.primitive("Void");
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
    
    // Extract interface implementations
    const implementedInterfaces: InterfaceImplementation[] = [];
    if (node.implements && node.implements.length > 0) {
      for (const impl of node.implements) {
        if (impl.type && impl.type.name) {
          implementedInterfaces.push({
            interfaceName: impl.type.name,
            interfaceType: { kind: 'interface', name: impl.type.name },
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
    const ctorParams: any[] = [];
    let requiredCount = 0;
    
    if (node.body && node.body.length > 0) {
      for (const item of node.body) {
        let target = item;
        if (ast.isListNode(item) && item.nodes.length > 0) {
          target = item.nodes[0];
        }

        if (target._type === "variable") {
          const varNode = target as ast.VariableNode;
          const isCtor = (varNode.modifiers ?? []).some((m: any) => m.modifier === "ctor" || m.modifier === ":ctor");
          const isPrivate = (varNode.modifiers ?? []).some((m: any) => m.modifier === "private" || m.modifier === ":private");
          const name = typeof varNode.name === 'string' ? varNode.name : (varNode.name as any).id || (varNode.name as any).name;

          const memberType = varNode.type 
            ? this.convertAstTypeToInferred(varNode.type)
            : TypeEnvironment.unknown();
          
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
          const paramTypes = funcNode.params.map(p => p.type ? this.convertAstTypeToInferred(p.type) : TypeEnvironment.unknown());
          const returnType = funcNode.returns ? this.convertAstTypeToInferred(funcNode.returns) : TypeEnvironment.primitive("Void");
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
    
    // Register struct type
    const structType: InferredType = {
      kind: "struct",
      name: structName,
      members: members,
      ctorInfo: {
        params: ctorParams,
        requiredCount: requiredCount,
      },
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
      const mods = varNode.modifiers.map((m: any) => m.modifier || m);
      
      for (const mod of mods) {
        modifiers.add(mod.replace(':', ''));
        
        if (mod === ':private') { visibility = 'private'; }
        else if (mod === ':public') { visibility = 'public'; }
        else if (mod === ':protected') { visibility = 'protected'; }
        else if (mod === ':internal') { visibility = 'internal'; }
        else if (mod === ':ctor') { isConstructorParam = true; }
        else if (mod === ':static') { isStatic = true; }
        else if (mod === ':operator') { isOperator = true; }
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
    
    const memberType = varNode.type ? this.convertAstTypeToInferred(varNode.type) : TypeEnvironment.unknown();
    
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
      const paramType = p.type ? this.convertAstTypeToInferred(p.type) : TypeEnvironment.unknown();
      
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
      TypeEnvironment.primitive("Void");
    
    // Extract modifiers
    const modifiers = new Set<string>();
    let visibility: 'public' | 'private' | 'protected' | 'internal' = 'public';
    let isOperatorOverload = false;
    let operatorSymbol: string | undefined;
    let arity: number | undefined;
    
    if (funcNode.modifiers) {
      const mods = funcNode.modifiers.map((m: any) => m.modifier || m);
      
      for (const mod of mods) {
        modifiers.add(mod.replace(':', ''));
        
        if (mod === ':private') { visibility = 'private'; }
        else if (mod === ':public') { visibility = 'public'; }
        else if (mod === ':protected') { visibility = 'protected'; }
        else if (mod === ':internal') { visibility = 'internal'; }
        else if (mod === ':operator') { isOperatorOverload = true; }
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

    for (const item of node.nodes) {
      if (this.isDeclaration(item)) {
        this.visit(item);
        continue;
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
        continue;
      }

      // Control flow, identifiers, literals. visit() routes to a real visitor where one exists
      // (visitIf), and otherwise to onUnhandled, which walks the children.
      this.visit(item);
    }
  }

  visitVariable(node: ast.VariableNode) {
    // See CollectTypesPass.visitVariable: destructuring bindings are not typed yet (D5/P8).
    if (ast.isBindingPattern(node.name)) {
      if (node.value) this.inferExpressionType(node.value);
      return;
    }
    const varName = (node.name as ast.IdentifierNode).id;
    this.context.log(LogLevel.Info, `[InferAndCheckPass.visitVariable] Processing variable: ${varName}`);

    
    // If value exists, infer its type
    if (node.value) {
      const valueType = this.inferExpressionType(node.value);
      this.context.log(LogLevel.Debug, `[InferAndCheckPass.visitVariable] Inferred value type structure: ${JSON.stringify(valueType).substring(0, 200)}`);
      
      // If explicit type annotation exists, check compatibility
      const declaredType = this.typeEnv.resolveIdentifier(varName);
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
        // Update symbol with inferred type (the actual value type) after validation
        this.symbolTable.bindType(varName, valueType);
      } else {
        // No explicit type - bind the inferred type
        this.typeEnv.bindIdentifier(varName, valueType, node);
        this.context.log(LogLevel.Info, `[InferAndCheckPass] Bound inferred type for '${varName}': ${TypeChecker.formatType(valueType)}`);
      }
      
      this.typeEnv.setType(node, valueType);
    } else {
      // No initial value - check if there's a declared type
      const declaredType = this.typeEnv.resolveIdentifier(varName);
      if (declaredType && declaredType.kind !== "unknown") {
        // Use the declared type
        this.symbolTable.bindType(varName, declaredType);
        this.context.log(LogLevel.Info, `[InferAndCheckPass] Bound declared type for '${varName}': ${TypeChecker.formatType(declaredType)}`);
      } else {
        // No explicit type - default to Any type
        this.typeEnv.bindIdentifier(varName, TypeEnvironment.unknown(), node);
        this.context.log(LogLevel.Info, `[InferAndCheckPass] No initializer for '${varName}', bound Any type`);
      }
    }
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
    
    // Infer types in function body
    node.body.forEach(stmt => this.visit(stmt));

    this.checkReturns(node);

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

    // A Void/nil declaration says nothing useful about the value's type here.
    if (declared.name === "Void" || declared.name === "Nil" || declared.name === "Null") return;

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
        // Bind 'this' in the class scope
        this.typeEnv.bindIdentifier("this", thisType, node);
    }

    node.body.forEach(member => this.visit(member));
    this.typeEnv.exitScope();
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

    node.body.forEach(member => this.visit(member));
    this.typeEnv.exitScope();
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

  visitStruct(node: ast.StructNode) {
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
    
    this.visit(node.then);
    if (node.else) {
      this.visit(node.else);
    }
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
        inferredType = { kind: "primitive", name: "Null", nullable: true };
        break;

      // Identifiers
      case "simple-identifier":
      case "composite-identifier": {
        const id = (node as ast.IdentifierNode).id;

        // TYPE comes from the type environment...
        const resolvedType = this.typeEnv.resolveIdentifier(id);
        inferredType = resolvedType ?? TypeEnvironment.unknown();

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
          const funcType = this.typeEnv.resolveIdentifier(funcName);

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
            if (funcType.params) {
              const declared = funcType.params.length;
              const required = funcType.isVariadic ? declared - 1 : declared;
              const tooFew = args.length < required;
              const tooMany = !funcType.isVariadic && args.length > declared;

              if (tooFew || tooMany) {
                const expected = funcType.isVariadic
                  ? `at least ${required}`
                  : `${declared}`;
                this.reportTypeError(
                  listNode,
                  "LL0211",
                  `'${funcName}' expects ${expected} argument${required === 1 && !funcType.isVariadic ? "" : "s"}, got ${args.length}.`
                );
              }
            }

            if (funcType.params) {
              argTypes.forEach((argType, i) => {
                if (i < funcType.params!.length) {
                  const expectedType = funcType.params![i];
                  // Gradual typing: an unannotated parameter accepts anything, and an argument we
                  // could not type tells us nothing. Reporting either way is noise -- this fired as
                  // "Expected Unknown, got ..." on every call to an unannotated function.
                  if (TypeChecker.isUnknown(expectedType) || TypeChecker.isUnknown(argType)) {
                    return;
                  }
                  if (!TypeChecker.isAssignable(argType, expectedType, this.symbolTable)) {
                    this.reportTypeError(
                      args[i] ?? listNode,
                      "LL0203",
                      `Argument ${i + 1} of '${funcName}': expected ${TypeChecker.formatType(expectedType)}, got ${TypeChecker.formatType(argType)}.`
                    );
                  }
                }
              });
            }
            
            inferredType = funcType.returns ?? TypeEnvironment.unknown();
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
        
        // Determine the element type based on container type
        if (containerType.kind === "map") {
          // Map indexing returns the value type
          inferredType = containerType.valueType ?? TypeEnvironment.unknown();
        } else if (containerType.isArray || (containerType.kind === "generic" && containerType.name === "Array")) {
          // Array indexing returns the element type
          inferredType = containerType.inner ?? containerType.generics?.[0] ?? TypeEnvironment.unknown();
        } else {
          // Unknown container type
          inferredType = TypeEnvironment.unknown();
        }
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
    const resolved = this.typeEnv.resolveIdentifier(name);

    if (resolved && (resolved.kind === "class" || resolved.kind === "struct")) {
      return { kind: "type-ref", name, refName: name, resolved: true };
    }

    // An unknown class is not an operator error; it is an unresolved identifier (P4c).
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
   * Every identifier a program can name without declaring it.
   *
   * `RuntimeProvider.isRuntimeReference` covers l-lang's own runtime helpers. This list is the JS
   * ambient environment -- the globals any emitted program may reach for. It is deliberately short
   * and explicit: a long, speculative list would silently swallow real typos.
   */
  private static readonly JS_GLOBALS = new Set([
    // Standard library
    "console", "Math", "JSON", "Object", "Array", "String", "Number", "Boolean", "Symbol",
    "Error", "TypeError", "RangeError", "Date", "RegExp", "Map", "Set", "WeakMap", "WeakSet",
    "Promise", "Proxy", "Reflect", "BigInt",
    "parseInt", "parseFloat", "isNaN", "isFinite", "NaN", "Infinity", "undefined", "globalThis",
    // Host environment. `window` is real: 20-stdlib/std/io.lisp reaches for it behind the
    // idiomatic `(if (&& (typeof window) (!= window undefined)) (window.alert msg))` guard.
    "window", "document", "navigator", "process",
    "setTimeout", "setInterval", "clearTimeout", "clearInterval", "fetch",
  ]);

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
    const head = id.split(".")[0];
    if (!head) return;

    if (
      TypeChecker.isOperatorName(head) ||
      InferAndCheckPass.SPECIAL_FORMS.has(head) ||
      InferAndCheckPass.JS_GLOBALS.has(head) ||
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
    if (symbols.resolveSymbol(head, node)) {
      return;
    }

    this.reportTypeError(
      node,
      "LL0210",
      `'${head}' is not defined.`
    );
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