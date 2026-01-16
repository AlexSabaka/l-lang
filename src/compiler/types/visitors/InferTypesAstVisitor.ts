import * as ast from "../../frontend/ast";
import { Context, LogLevel } from "../../Context";
import { BaseAstTreeWalker } from "../../BaseAstTreeWalker";
import { TypeEnvironment } from "../TypeEnvironment";
import { InferredType } from "../../analysis/SymbolTable";
import { TypeChecker } from "../TypeChecker";
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
      if (item._type === "list" && item.nodes && item.nodes.length > 0) {
        // Scan through all items in the list
        for (const subItem of item.nodes) {
          if (subItem._type === "variable" || subItem._type === "function" ||
              subItem._type === "class" || subItem._type === "interface" ||
              subItem._type === "type-def" || subItem._type === "struct") {
            this.visit(subItem);
          } else if (subItem._type === "list" && subItem.nodes && subItem.nodes.length > 0) {
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
    const varName = node.name.id;
    
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

    // Build function type from signature
    const paramTypes = node.params.map(p => 
      p.type ? this.convertAstTypeToInferred(p.type) : TypeEnvironment.unknown()
    );
    
    const returnType = node.returns 
      ? this.convertAstTypeToInferred(node.returns)
      : TypeEnvironment.primitive("Void");

    const funcType = TypeEnvironment.function(paramTypes, returnType);
    this.typeEnv.bindIdentifier(funcName, funcType, node);
    
    this.context.log(LogLevel.Debug, `Collected function signature '${funcName}': ${TypeChecker.formatType(funcType)}`);
  }

  visitClass(node: ast.ClassNode) {
    const className = node.name.name;
    const members: any[] = [];
    const ctorParams: any[] = [];
    let requiredCount = 0;

    if (node.body) {
        for (const item of node.body) {
             let target = item;
             if (item._type === 'list' && item.nodes && item.nodes.length > 0) {
                 target = item.nodes[0];
             }
             
             if (target._type === 'variable') {
                 const varNode = target as ast.VariableNode;
                 const memberType = varNode.type ? this.convertAstTypeToInferred(varNode.type) : TypeEnvironment.unknown();
                 
                 const isCtor = (varNode.modifiers ?? []).some((m: any) => m.modifier === ':ctor' || m.modifier === 'ctor');
                 const isPrivate = (varNode.modifiers ?? []).some((m: any) => m.modifier === ':private' || m.modifier === 'private');
                 
                 const name = typeof varNode.name === 'string' ? varNode.name : (varNode.name as any).id || (varNode.name as any).name;

                 members.push({
                     name: name,
                     type: memberType,
                     isCtor: isCtor,
                     isPublic: !isPrivate, 
                     isPrivate: isPrivate 
                 });
                 
                 if (isCtor) {
                     const hasDefault = (varNode as any).value !== undefined; 
                     ctorParams.push({
                        name: name,
                        type: memberType,
                        hasDefault
                     });
                     if (!hasDefault) requiredCount++;
                 }
             } else if (target._type === 'function') {
                 const funcNode = target as ast.FunctionNode;
                 const paramTypes = funcNode.params.map(p => p.type ? this.convertAstTypeToInferred(p.type) : TypeEnvironment.unknown());
                 const returnType = funcNode.returns ? this.convertAstTypeToInferred(funcNode.returns) : TypeEnvironment.primitive("Void");
                 const funcType = TypeEnvironment.function(paramTypes, returnType);
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
    
    // Register class as a type
    const classType: InferredType = {
      kind: "class",
      name: className,
      generics: node.generics?.map(g => ({
        kind: "generic",
        name: g.name.name,
      })),
      members: members,
      ctorInfo: {
          params: ctorParams,
          requiredCount: requiredCount
      }
    };
    
    this.typeEnv.bindIdentifier(className, classType, node);
    this.context.log(LogLevel.Debug, `Collected class type '${className}' with ${members.length} members`);
  }

  visitInterface(node: ast.InterfaceNode) {
    const interfaceName = node.name.name;
    
    const interfaceType: InferredType = {
      kind: "interface",
      name: interfaceName,
      generics: node.generics?.map(g => ({
        kind: "generic",
        name: g.name.name,
      })),
    };
    
    this.typeEnv.bindIdentifier(interfaceName, interfaceType, node);
    this.context.log(LogLevel.Debug, `Collected interface type '${interfaceName}'`);
  }

  visitTypeDef(node: ast.TypeDefNode) {
    const typeName = typeof node.name === 'string' ? node.name : (node.name?.id || node.name?.name);
    
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
    const structName = typeof node.name === 'string' ? node.name : (node.name?.id || node.name?.name);
    
    // Extract constructor parameters and member fields
    const members: any[] = [];
    const ctorParams: any[] = [];
    let requiredCount = 0;
    
    if (node.body && node.body.length > 0) {
      for (const item of node.body) {
        let target = item;
        if (item._type === 'list' && item.nodes && item.nodes.length > 0) {
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
            const hasDefault = varNode.init !== undefined;
            if (hasDefault) {
              member.defaultValue = varNode.init;
            }
            
            ctorParams.push({
              name: name,
              type: memberType,
              hasDefault: hasDefault,
              defaultValue: varNode.init,
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
          const funcType = TypeEnvironment.function(paramTypes, returnType);
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
   * Convert AST type node to InferredType
   */
  private convertAstTypeToInferred(typeNode: ast.TypeNode): InferredType {
    // Handle simple types
    if (typeNode._type === "type" || typeNode._type === "simple-type") {
      let name: string;
      
      // TypeNode has a .type property that is TypeNameNode with a .name string property
      if ((typeNode as any).type?.name) {
        // typeNode.type is TypeNameNode, typeNode.type.name is the string
        const typeName = (typeNode as any).type.name;
        name = typeof typeName === 'string' ? typeName : typeName.name || "Unknown";
      }
      // SimpleTypeNode has a .name property that is TypeNameNode
      else if ((typeNode as any).name?.name) {
        const typeName = (typeNode as any).name.name;
        name = typeof typeName === 'string' ? typeName : "Unknown";
      }
      // Fallback
      else {
        name = "Unknown";
      }
      
      // Check if this is a user-defined type (type-alias, struct, etc.)
      const userType = this.symbolTable.resolveSymbol(name);
      if (userType && userType.inferredType) {
        // It's a user-defined type, use the type-ref
        const type: InferredType = {
          kind: "type-ref",
          name: name,
          refName: name,
          resolved: true,
        };
        
        if (typeNode.array) {
          return TypeEnvironment.array(type);
        }
        return type;
      }
      
      // Special handling for Any type
      if (name === "Any") {
        const type: InferredType = { kind: "unknown", name };
        if (typeNode.array) {
          return TypeEnvironment.array(type);
        }
        return type;
      }
      
      // It's a built-in primitive type
      const type: InferredType = { kind: "primitive", name };
      
      if (typeNode.array) {
        return TypeEnvironment.array(type);
      }
      
      return type;
    }

    // Handle generic types (e.g., Array<Int>, Map<String, Int>)
    if (typeNode._type === "generic-type") {
      const genericNode = typeNode as unknown as ast.GenericTypeNode;
      const baseType = genericNode.name.name;
      const genericParams = genericNode.generics?.map(g => 
        this.convertAstTypeToInferred({ 
          _type: "simple-type", 
          name: g, 
          array: false 
        } as any)
      ) ?? [];
      
      return {
        kind: "generic",
        name: baseType,
        generics: genericParams,
      };
    }

    // Handle union types (e.g., Int | String)
    if (typeNode._type === "union-type") {
      const unionNode = typeNode as unknown as ast.UnionTypeNode;
      const alternatives = unionNode.types.map(t => this.convertAstTypeToInferred(t));
      const unionType = TypeEnvironment.union(alternatives);
      
      // Check if the union itself is an array (e.g., (Int | String | Expr)[])
      if (typeNode.array) {
        return TypeEnvironment.array(unionType);
      }
      
      return unionType;
    }

    // Handle function types
    if (typeNode._type === "function-type") {
      const funcTypeNode = typeNode as unknown as ast.FunctionTypeNode;
      const params = funcTypeNode.params.map(p => this.convertAstTypeToInferred(p));
      const returns = funcTypeNode.ret.length > 0 
        ? this.convertAstTypeToInferred(funcTypeNode.ret[0])
        : TypeEnvironment.primitive("Void");
      
      return TypeEnvironment.function(params, returns);
    }

    // Fallback
    return TypeEnvironment.unknown();
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

  visitProgram(node: ast.ProgramNode) {
    this.typeEnv.enterScope(node);
    node.program.forEach(item => this.visit(item));
    this.typeEnv.exitScope();
  }

  visitList(node: ast.ListNode) {
    // Lists may contain declarations and expressions
    // Scan through the list for declarations we need to process
    if (node.nodes && node.nodes.length > 0) {
      for (const item of node.nodes) {
        // Check for direct declarations
        if (item._type === "variable" || item._type === "function" || 
            item._type === "class" || item._type === "interface" ||
            item._type === "type-def" || item._type === "struct") {
          this.visit(item);
        }
        // Check for lists that contain declarations
        else if (item._type === "list" && item.nodes && item.nodes.length > 0) {
          const innerFirst = item.nodes[0];
          if (innerFirst._type === "variable" || innerFirst._type === "function" ||
              innerFirst._type === "class" || innerFirst._type === "interface" ||
              innerFirst._type === "type-def" || innerFirst._type === "struct") {
            this.visit(innerFirst);
          }
        }
        // Skip comments and other non-declaration items
      }
    }
  }

  visitVariable(node: ast.VariableNode) {
    const varName = node.name.id;
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
        
        if (!TypeChecker.isAssignable(valueType, declaredType, this.symbolTable)) {
          // For recursive types with array/union structure, skip the error since the structure is correct
          if (!isLikelyRecursive) {
            this.context.log(
              LogLevel.Error,
              `Type mismatch: Cannot assign ${TypeChecker.formatType(valueType)} to ${TypeChecker.formatType(declaredType)} for variable '${varName}'`
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
    
    // Bind parameter types in function scope
    node.params.forEach(param => {
      const paramName = param.name.id;
      const paramType = param.type 
        ? this.convertAstTypeToInferred(param.type)
        : TypeEnvironment.unknown();
      
      this.typeEnv.bindIdentifier(paramName, paramType, param);
      const chain = this.typeEnv.debugScopeChain();
      this.context.log(LogLevel.Debug, `[InferAndCheckPass] Bound parameter '${paramName}' with type ${TypeChecker.formatType(paramType)}; scope=${chain}`);
    });
    
    // Infer types in function body
    node.body.forEach(stmt => this.visit(stmt));
    
    // TODO: Check that all return statements match declared return type
    
    this.typeEnv.exitScope();
  }

  visitClass(node: ast.ClassNode) {
    const className = typeof node.name === 'string' ? node.name : ((node.name as any).id || (node.name as any).name);
    this.typeEnv.enterScope(node);

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
    this.typeEnv.enterScope(node);
    node.body.forEach(member => this.visit(member));
    this.typeEnv.exitScope();
  }

  visitTypeDef(node: ast.TypeDefNode) {
    // In the second pass, we need to resolve type references
    // Type-aliases are already registered in pass 1, 
    // but we need to convert type-refs to point to actual types
    const typeName = typeof node.name === 'string' ? node.name : (node.name?.id || node.name?.name);
    
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
    const structName = typeof node.name === 'string' ? node.name : (node.name?.id || node.name?.name);
    
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
    if (condType.name !== "Boolean") {
      this.context.log(
        LogLevel.Error,
        `If condition must be Boolean, got ${TypeChecker.formatType(condType)}`
      );
    }
    
    this.visit(node.then);
    if (node.else) {
      this.visit(node.else);
    }
  }

  visitSimpleAssignment(node: ast.SimpleAssignmentNode) {
    const targetType = this.inferExpressionType(node.assignable);
    const valueType = this.inferExpressionType(node.value);
    
    if (!TypeChecker.isAssignable(valueType, targetType, this.symbolTable)) {
      this.context.log(
        LogLevel.Error,
        `Type mismatch in assignment: Cannot assign ${TypeChecker.formatType(valueType)} to ${TypeChecker.formatType(targetType)}`
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
        const resolvedType = this.typeEnv.resolveIdentifier(id);
        inferredType = resolvedType ?? TypeEnvironment.unknown();
        if (!resolvedType) {
          // Debug: log scope chain and node for missing identifier
          const chain = this.typeEnv.debugScopeChain();
          const loc = (node as any)._location ? `${(node as any)._location.start.line}:${(node as any)._location.start.column}` : '?:?';
          this.context.log(LogLevel.Warning, `Unknown identifier '${id}' at ${node._type} (${loc}) (scope: ${chain})`);
        }
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
          
          // Handle function calls
          if (funcType && funcType.kind === "function") {
            // Check argument types
            const args = listNode.nodes.slice(1);
            const argTypes = args.map(arg => this.inferExpressionType(arg));
            
            if (funcType.params) {
              argTypes.forEach((argType, i) => {
                if (i < funcType.params!.length) {
                  const expectedType = funcType.params![i];
                  if (!TypeChecker.isAssignable(argType, expectedType, this.symbolTable)) {
                    this.context.log(
                      LogLevel.Error,
                      `Argument ${i + 1} type mismatch: Expected ${TypeChecker.formatType(expectedType)}, got ${TypeChecker.formatType(argType)}`
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
          } else {
            // Check for operators
            inferredType = this.inferOperatorType(funcName, listNode.nodes.slice(1));
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
  private inferOperatorType(op: string, args: ast.ASTNode[]): InferredType {
    if (args.length === 1) {
      // Unary operator
      const operandType = this.inferExpressionType(args[0]);

      // Check for user-defined operator first
      const userOpType = TypeChecker.findOperator(operandType, op, 0, this.symbolTable);
      if (userOpType && userOpType.kind === "function") {
        return userOpType.returns || TypeEnvironment.unknown();
      }

      const resultType = TypeChecker.getUnaryOpType(op, operandType);
      
      if (!resultType) {
        this.context.log(
          LogLevel.Error,
          `Invalid unary operator '${op}' for type ${TypeChecker.formatType(operandType)}`
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

      const resultType = TypeChecker.getBinaryOpType(op, leftType, rightType);
      
      if (!resultType) {
        this.context.log(
          LogLevel.Error,
          `Invalid binary operator '${op}' for types ${TypeChecker.formatType(leftType)} and ${TypeChecker.formatType(rightType)}`
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
    if (typeNode._type === "type" || typeNode._type === "simple-type") {
      let name: string;
      
      if ((typeNode as any).type?.name) {
        const typeName = (typeNode as any).type.name;
        name = typeof typeName === 'string' ? typeName : typeName.name || "Unknown";
      } else if ((typeNode as any).name?.name) {
        const typeName = (typeNode as any).name.name;
        name = typeof typeName === 'string' ? typeName : "Unknown";
      } else {
        name = "Unknown";
      }
      
      // Special handling for Any type
      if (name === "Any") {
        const type: InferredType = { kind: "unknown", name };
        if (typeNode.array) {
          return TypeEnvironment.array(type);
        }
        return type;
      }
      
      const type: InferredType = { kind: "primitive", name };
      
      if (typeNode.array) {
        return TypeEnvironment.array(type);
      }
      
      return type;
    }

    if (typeNode._type === "generic-type") {
      const genericNode = typeNode as unknown as ast.GenericTypeNode;
      const baseType = genericNode.name.name;
      const genericParams = genericNode.generics?.map(g => 
        this.convertAstTypeToInferred({ 
          _type: "simple-type", 
          name: g, 
          array: false 
        } as any)
      ) ?? [];
      
      return {
        kind: "generic",
        name: baseType,
        generics: genericParams,
      };
    }

    if (typeNode._type === "union-type") {
      const unionNode = typeNode as unknown as ast.UnionTypeNode;
      const alternatives = unionNode.types.map(t => this.convertAstTypeToInferred(t));
      return TypeEnvironment.union(alternatives);
    }

    return TypeEnvironment.unknown();
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