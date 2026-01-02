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
    // 1. Direct declarations (variable, function, class, interface)
    // 2. Lists containing declarations (e.g., (var x 10))
    // 3. Nested lists of expressions containing declarations
    for (const item of node.program) {
      if (item._type === "list" && item.nodes && item.nodes.length > 0) {
        // Scan through all items in the list
        for (const subItem of item.nodes) {
          if (subItem._type === "variable" || subItem._type === "function" ||
              subItem._type === "class" || subItem._type === "interface") {
            this.visit(subItem);
          } else if (subItem._type === "list" && subItem.nodes && subItem.nodes.length > 0) {
            // Check nested lists for declarations
            const nestedFirst = subItem.nodes[0];
            if (nestedFirst._type === "variable" || nestedFirst._type === "function" ||
                nestedFirst._type === "class" || nestedFirst._type === "interface") {
              this.visit(nestedFirst);
            }
          }
        }
      } else if (item._type === "function" || item._type === "class" || 
                 item._type === "interface" || item._type === "variable") {
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
    
    // Register class as a type
    const classType: InferredType = {
      kind: "class",
      name: className,
      generics: node.generics?.map(g => ({
        kind: "generic",
        name: g.name.name,
      })),
    };
    
    this.typeEnv.bindIdentifier(className, classType, node);
    this.context.log(LogLevel.Debug, `Collected class type '${className}'`);
    
    // Don't scan class body yet - that's for pass 2
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
      return TypeEnvironment.union(alternatives);
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
    this.context.log(LogLevel.Debug, `[InferAndCheckPass.visit] Calling ${methodName} for node type: ${node._type}`);
    // Only call the visitXxx method, don't do automatic recursive traversal
    return (this as any)[methodName]?.(node) ?? node;
  }

  visitProgram(node: ast.ProgramNode) {
    this.typeEnv.enterScope(node);
    this.context.log(LogLevel.Debug, `[InferAndCheckPass.visitProgram] Processing ${node.program.length} program items`);
    node.program.forEach((item, idx) => {
      this.context.log(LogLevel.Debug, `[InferAndCheckPass.visitProgram] Item ${idx}: type=${item._type}`);
      this.visit(item);
    });
    this.typeEnv.exitScope();
  }

  visitList(node: ast.ListNode) {
    // Lists may contain declarations and expressions
    // Scan through the list for declarations we need to process
    if (node.nodes && node.nodes.length > 0) {
      this.context.log(LogLevel.Debug, `[InferAndCheckPass.visitList] Processing list with ${node.nodes.length} nodes`);
      for (let i = 0; i < node.nodes.length; i++) {
        const item = node.nodes[i];
        this.context.log(LogLevel.Debug, `[InferAndCheckPass.visitList] Node ${i}: type=${item._type}`);
        // Check for direct declarations
        if (item._type === "variable" || item._type === "function" || 
            item._type === "class" || item._type === "interface") {
          this.context.log(LogLevel.Debug, `[InferAndCheckPass.visitList] Found direct declaration: ${item._type}`);
          this.visit(item);
        }
        // Check for lists that contain declarations
        else if (item._type === "list" && item.nodes && item.nodes.length > 0) {
          const innerFirst = item.nodes[0];
          if (innerFirst._type === "variable" || innerFirst._type === "function" ||
              innerFirst._type === "class" || innerFirst._type === "interface") {
            this.context.log(LogLevel.Debug, `[InferAndCheckPass.visitList] Found nested declaration: ${innerFirst._type}`);
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
      
      // If explicit type annotation exists, check compatibility
      const declaredType = this.typeEnv.resolveIdentifier(varName);
      if (declaredType) {
        if (!TypeChecker.isAssignable(valueType, declaredType)) {
          this.context.log(
            LogLevel.Error,
            `Type mismatch: Cannot assign ${TypeChecker.formatType(valueType)} to ${TypeChecker.formatType(declaredType)} for variable '${varName}'`
          );
        }
      } else {
        // No explicit type - bind the inferred type
        this.typeEnv.bindIdentifier(varName, valueType, node);
        this.context.log(LogLevel.Info, `[InferAndCheckPass] Bound inferred type for '${varName}': ${TypeChecker.formatType(valueType)}`);
      }
      
      this.typeEnv.setType(node, valueType);
    } else {
      // No initial value - default to Any type
      this.typeEnv.bindIdentifier(varName, TypeEnvironment.unknown(), node);
      this.context.log(LogLevel.Info, `[InferAndCheckPass] No initializer for '${varName}', bound Any type`);
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
    this.typeEnv.enterScope(node);
    node.body.forEach(member => this.visit(member));
    this.typeEnv.exitScope();
  }

  visitInterface(node: ast.InterfaceNode) {
    this.typeEnv.enterScope(node);
    node.body.forEach(member => this.visit(member));
    this.typeEnv.exitScope();
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
    
    if (!TypeChecker.isAssignable(valueType, targetType)) {
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
          const commonType = TypeChecker.findCommonType(elementTypes);
          inferredType = TypeEnvironment.array(commonType ?? TypeEnvironment.unknown());
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
          
          if (funcType && funcType.kind === "function") {
            // Check argument types
            const args = listNode.nodes.slice(1);
            const argTypes = args.map(arg => this.inferExpressionType(arg));
            
            if (funcType.params) {
              argTypes.forEach((argType, i) => {
                if (i < funcType.params!.length) {
                  const expectedType = funcType.params![i];
                  if (!TypeChecker.isAssignable(argType, expectedType)) {
                    this.context.log(
                      LogLevel.Error,
                      `Argument ${i + 1} type mismatch: Expected ${TypeChecker.formatType(expectedType)}, got ${TypeChecker.formatType(argType)}`
                    );
                  }
                }
              });
            }
            
            inferredType = funcType.returns ?? TypeEnvironment.unknown();
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