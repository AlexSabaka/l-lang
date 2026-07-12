import * as ast from "../../frontend/ast";
import { LogLevel, Context } from "../../Context";
import { BaseAstTreeWalker } from "../../BaseAstTreeWalker";
import { TypeEnvironment } from "../TypeEnvironment";
import { InferredType } from "../../analysis/SymbolTable";
import { TypeChecker } from "../TypeChecker";
import { SymbolTable } from "../../analysis";
import { createRule, RuleSeverity } from "../../rules";

/**
 * TypeCheckingValidatorAstVisitor - Validates type compatibility after inference
 * Uses the rule system to report type errors
 */
export class TypeCheckingValidatorAstVisitor extends BaseAstTreeWalker {
  private typeEnv: TypeEnvironment;
  private symbolTable: SymbolTable;

  constructor(context: Context, typeEnv: TypeEnvironment, symbolTable: SymbolTable) {
    super(context);
    this.typeEnv = typeEnv;
    this.symbolTable = symbolTable;
  }

  /**
   * Override visit to prevent double traversal by BaseAstTreeWalker
   * We manually control which children to visit in each visitXxx method
   */
  visit(node: ast.ASTNode): any {
    if (!node) return node;
    // Only call the visitXxx method, don't do automatic recursive traversal
    return (this as any)[`visit${node._type}`]?.(node) ?? node;
  }

  visitVariable(node: ast.VariableNode) {
    // Destructuring bindings declare N names; this validator is dead code anyway (its visit()
    // dispatch interpolates the kebab _type, so `visit${'simple-identifier'}` never resolves).
    if (ast.isBindingPattern(node.name)) return;
    const varName = (node.name as ast.IdentifierNode).id;

    if (node.value) {
      const valueType = this.inferExpressionType(node.value);
      const declaredType = this.typeEnv.resolveIdentifier(varName);

      if (declaredType && !TypeChecker.isAssignable(valueType, declaredType, this.symbolTable)) {
        this.reportTypeError(
          node.value,
          `Type mismatch: Cannot assign ${TypeChecker.formatType(valueType)} to ${TypeChecker.formatType(declaredType)}`
        );
      }
    }
  }

  visitList(node: ast.ListNode) {
    if (node.nodes.length === 0) return;

    const firstNode = node.nodes[0];

    // Check if it's a function call
    if (firstNode._type === "simple-identifier" || firstNode._type === "composite-identifier") {
      const funcName = (firstNode as ast.IdentifierNode).id;
      const funcType = this.typeEnv.resolveIdentifier(funcName);

      if (funcType && funcType.kind === "function") {
        // Validate argument types
        const args = node.nodes.slice(1);
        const argTypes = args.map(arg => this.inferExpressionType(arg));

        if (Array.isArray(funcType.params) && funcType.params.length > 0) {
          argTypes.forEach((argType, i) => {
            if (i < funcType.params!.length) {
              const expectedType = funcType.params![i];
              if (!TypeChecker.isAssignable(argType, expectedType, this.symbolTable)) {
                // Safely extract type name
                let expectedStr = "Unknown";
                if (expectedType && typeof expectedType === 'object' && 'name' in expectedType) {
                  expectedStr = (expectedType as any).name;
                }
                this.reportTypeError(
                  node.nodes[i + 1],
                  `Argument ${i + 1} type mismatch: Expected ${expectedStr}, got ${TypeChecker.formatType(argType)}`
                );
              }
            }
          });
        }
      }
    }
  }

  visitSimpleAssignment(node: ast.SimpleAssignmentNode) {
    const targetType = this.inferExpressionType(node.assignable);
    const valueType = this.inferExpressionType(node.value);

    if (!TypeChecker.isAssignable(valueType, targetType, this.symbolTable)) {
      this.reportTypeError(
        node.value,
        `Type mismatch in assignment: Cannot assign ${TypeChecker.formatType(valueType)} to ${TypeChecker.formatType(targetType)}`
      );
    }
  }

  visitIf(node: ast.IfNode) {
    const condType = this.inferExpressionType(node.condition);
    if (condType.name !== "Boolean" && condType.kind !== "unknown") {
      this.reportTypeError(
        node.condition,
        `If condition must be Boolean, got ${TypeChecker.formatType(condType)}`
      );
    }

    this.visit(node.then);
    if (node.else) {
      this.visit(node.else);
    }
  }

  /**
   * Core type inference for expressions
   */
  private inferExpressionType(node: ast.ASTNode): InferredType {
    const cached = this.typeEnv.getType(node);
    if (cached) {
      return cached;
    }

    let inferredType: InferredType;

    switch (node._type) {
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

      case "simple-identifier":
      case "composite-identifier": {
        const id = (node as ast.IdentifierNode).id;
        const resolvedType = this.typeEnv.resolveIdentifier(id);
        inferredType = resolvedType ?? TypeEnvironment.unknown();
        break;
      }

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

      case "list": {
        const listNode = node as ast.ListNode;
        if (listNode.nodes.length === 0) {
          inferredType = TypeEnvironment.unknown();
          break;
        }

        const firstNode = listNode.nodes[0];

        if (firstNode._type === "simple-identifier" || firstNode._type === "composite-identifier") {
          const funcName = (firstNode as ast.IdentifierNode).id;
          const funcType = this.typeEnv.resolveIdentifier(funcName);

          if (funcType && funcType.kind === "function") {
            inferredType = funcType.returns ?? TypeEnvironment.unknown();
          } else {
            inferredType = this.inferOperatorType(funcName, listNode.nodes.slice(1));
          }
        } else {
          inferredType = TypeEnvironment.unknown();
        }
        break;
      }

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
    }

    this.typeEnv.setType(node, inferredType);
    return inferredType;
  }

  /**
   * Infer type for operator expressions
   */
  private inferOperatorType(op: string, args: ast.ASTNode[]): InferredType {
    if (args.length === 1) {
      const operandType = this.inferExpressionType(args[0]);
      const resultType = TypeChecker.getUnaryOpType(op, operandType);
      return resultType ?? TypeEnvironment.unknown();
    } else if (args.length === 2) {
      const leftType = this.inferExpressionType(args[0]);
      const rightType = this.inferExpressionType(args[1]);
      const resultType = TypeChecker.getBinaryOpType(op, leftType, rightType);
      return resultType ?? TypeEnvironment.unknown();
    }

    return TypeEnvironment.unknown();
  }

  /**
   * Convert AST type to InferredType
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

  /**
   * Report a type error using the rule system
   */
  private reportTypeError(node: ast.ASTNode, message: string): void {
    // Create a dynamic rule for this type error
    const typeErrorRule = createRule<ast.ASTNode>()
      .addSeverity(RuleSeverity.Error)
      .addCode("LL0200")
      .addMessage(message)
      .addTest(() => true)
      .build();

    this.context.results.add(node, typeErrorRule, this.context);
  }
}
