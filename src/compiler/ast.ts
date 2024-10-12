// NodeType definitions
export type NodeType =
  | "program"
  | "list"
  | "quote"
  | "vector"
  | "map"
  | "key-value"
  | "import"
  | "export"
  | "type-name"
  | "type"
  | "union-type"
  | "intersection-type"
  | "function-type"
  | "simple-type"
  | "generic-type"
  | "map-type"
  | "map-key-type"
  | "mapped-type"
  | "type-mapping"
  | "variable"
  | "field-modifier"
  | "function"
  | "function-modifier"
  | "parameter"
  | "parameter-modifier"
  | "function-carrying"
  | "function-carrying-left"
  | "function-carrying-right"
  | "generic-type"
  | "class"
  | "type-def"
  | "interface"
  | "access-modifier"
  | "implements"
  | "indexer"
  | "extends"
  | "constraint-implements"
  | "constraint-inherits"
  | "constraint-is"
  | "constraint-has"
  | "await"
  | "when"
  | "if"
  | "for"
  | "for-each"
  | "try-catch"
  | "assignment"
  | "compound-assignment"
  | "while"
  | "match"
  | "match-case"
  | "any-pattern"
  | "list-pattern"
  | "vector-pattern"
  | "map-pattern"
  | "map-pattern-pair"
  | "identifier-pattern"
  | "constant-pattern"
  | "string"
  | "formatted-string"
  | "format-expression"
  | "octal-number"
  | "binary-number"
  | "hex-number"
  | "integer-number"
  | "float-number"
  | "simple-identifier"
  | "composite-identifier"
  | "comment"
  | "control-comment";

export function isNode<T extends ASTNode>(node?: ASTNode | null): node is T {
  if (!node) return false;
  switch (node._type) {
    case 'variable':
      return (node as T)._type === 'variable';
    case 'program':
      return (node as T)._type === 'program';
    case 'list':
      return (node as T)._type === 'list';
    case 'quote':
      return (node as T)._type === 'quote';
    case 'vector':
      return (node as T)._type === 'vector';
    case 'map':
      return (node as T)._type === 'map';
    case 'function':
      return (node as T)._type === 'function';
    case 'function-modifier':
      return (node as T)._type === 'function-modifier';
    case 'parameter':
      return (node as T)._type === 'parameter';
    case 'parameter-modifier':
      return (node as T)._type === 'parameter-modifier';
    case 'function-carrying':
      return (node as T)._type === 'function-carrying';
    case 'function-carrying-left':
      return (node as T)._type === 'function-carrying-left';
    case 'function-carrying-right':
      return (node as T)._type === 'function-carrying-right';
    case 'generic-type':
      return (node as T)._type === 'generic-type';
    case 'class':
      return (node as T)._type === 'class';
    case 'type-def':
      return (node as T)._type === 'type-def';
    case 'interface':
      return (node as T)._type === 'interface';
    case 'access-modifier':
      return (node as T)._type === 'access-modifier';
    case 'implements':
      return (node as T)._type === 'implements';
    case 'indexer':
      return (node as T)._type === 'indexer';
    case 'extends':
      return (node as T)._type === 'extends';
    case 'constraint-implements':
      return (node as T)._type === 'constraint-implements';
    case 'constraint-inherits':
      return (node as T)._type === 'constraint-inherits';
    case 'constraint-is':
      return (node as T)._type === 'constraint-is';
    case 'constraint-has':
      return (node as T)._type === 'constraint-has';
    case 'await':
      return (node as T)._type === 'await';
    case 'when':
      return (node as T)._type === 'when';
    case 'if':
      return (node as T)._type === 'if';
    case 'for':
      return (node as T)._type === 'for';
    case 'for-each':
      return (node as T)._type === 'for-each';
    case 'try-catch':
      return (node as T)._type === 'try-catch';
    case 'assignment':
      return (node as T)._type === 'assignment';
    case 'compound-assignment':
      return (node as T)._type === 'compound-assignment';
    case 'while':
      return (node as T)._type === 'while';
    case 'match':
      return (node as T)._type === 'match';
    case 'match-case':
      return (node as T)._type === 'match-case';
    case 'any-pattern':
      return (node as T)._type === 'any-pattern';
    case 'list-pattern':
      return (node as T)._type === 'list-pattern';
    case 'vector-pattern':
      return (node as T)._type === 'vector-pattern';
    case 'map-pattern':
      return (node as T)._type === 'map-pattern';
    case 'map-pattern-pair':
      return (node as T)._type === 'map-pattern-pair';
    case 'identifier-pattern':
      return (node as T)._type === 'identifier-pattern';
    case 'constant-pattern':
      return (node as T)._type === 'constant-pattern';
    case 'string':
      return (node as T)._type === 'string';
    case 'formatted-string':
      return (node as T)._type === 'formatted-string';
    case 'format-expression':
      return (node as T)._type === 'format-expression';
    case 'octal-number':
      return (node as T)._type === 'octal-number';
    case 'binary-number':
      return (node as T)._type === 'binary-number';
    case 'hex-number':
      return (node as T)._type === 'hex-number';
    case 'integer-number':
      return (node as T)._type === 'integer-number';
    case 'float-number':
      return (node as T)._type === 'float-number';
    case 'simple-identifier':
      return (node as T)._type === 'simple-identifier';
    case 'composite-identifier':
      return (node as T)._type === 'composite-identifier';
    case 'comment':
      return (node as T)._type === 'comment';
    case 'control-comment':
      return (node as T)._type === 'control-comment';
    default:
      return false;
  }
}

export interface Location {
  source: string | undefined;
  text: string | undefined;
  start:  Position;
  end:    Position;
}

export interface Position {
  offset: number;
  line:   number;
  column: number;
}


export interface BodyBlock {
  body: ASTNode;
}

// Base AST Node class
export interface ASTNode {
  readonly _type: NodeType;
  readonly _location: Location;
}

// Program Node
export interface ProgramNode extends ASTNode {
  _type: "program"
  program: ASTNode[];
}

// List Node
export interface ListNode extends ASTNode {
  _type: "list";
  nodes: ASTNode[];
}

// Quote Node
export interface QuoteNode extends ASTNode {
  _type: "quote";
  mode: string;
  content: string | null;
  nodes: ASTNode[] | null;
}

// Vector Node
export interface VectorNode extends ASTNode {
  _type: "vector";
  values: ASTNode[];
}

// Map Node
export interface MapNode extends ASTNode {
  _type: "map";
  values: MapKeyValueNode[];
}

// Map Key-Value Node
export interface MapKeyValueNode extends ASTNode {
  _type: "key-value";
  key: IdentifierNode | StringNode;
  value: ASTNode;
}

// Variable Node
export interface VariableNode extends ASTNode {
  mutable: boolean;
  name: IdentifierNode;
  modifiers: ModifierNode[];
  type: TypeNode | undefined;
  value: ASTNode | undefined;
}

// Function Node
export interface FunctionNode extends ASTNode {
  name: IdentifierNode | undefined;
  async: boolean;
  extern: boolean;
  modifiers: ModifierNode[];
  params: FunctionParameterNode[];
  ret: TypeNode | undefined;
  body: ASTNode[];


}

// Function Parameter Node
export interface FunctionParameterNode extends ASTNode {
  name: IdentifierNode;
  modifiers: ModifierNode[];
  type: TypeNode | undefined;
}

export type ModifierNode = AccessModifierNode | FieldModifierNode | ParameterModifierNode;

// Access Modifier Node
export interface AccessModifierNode extends ASTNode {
  _type: "access-modifier";
  modifier: "public" | "private" | "static" | "internal";
}

// Field Modifier Node
export interface FieldModifierNode extends ASTNode {
  _type: "field-modifier";
  modifier: "readonly" | "nullable" | "ctor";
}

// Parameter Modifier Node
export interface ParameterModifierNode extends ASTNode {
  _type: "parameter-modifier";
  modifier: "in" | "out" | "ref";
}

// Base Type Node
export interface TypeNode extends ASTNode {
  _type: "type";
  name: string;
}

// Type Name Node
export interface TypeNameNode extends ASTNode {
  _type: "type-name";
  name: string;
}

// Union Type Node
export interface UnionTypeNode extends ASTNode {
  _type: "union-type";
  types: TypeNode[];
}

// Intersection Type Node
export interface IntersectionTypeNode extends ASTNode {
  _type: "intersection-type";
  types: TypeNode[];
}

// Simple Type Node
export interface SimpleTypeNode extends ASTNode {
  _type: "simple-type";
  name: TypeNameNode;
}

// Generic Type Node
export interface GenericTypeNode extends ASTNode {
  _type: "generic-type";
  name: TypeNameNode;
  generic: TypeNode;
  constraints?: ConstraintNode[];
}

// Mapped Type Node
export interface MappedTypeNode extends ASTNode {
  _type: "mapped-type";
  mapping: ASTNode;
}

// Type Mapping Node
export interface TypeMappingNode extends ASTNode {
  _type: "type-mapping";
}

// Map Type Node
export interface MapTypeNode extends ASTNode {
  _type: "map-type";
  keys: KeyDefinitionNode[];
}

// Key Definition Node
export interface KeyDefinitionNode extends ASTNode {
  _type: "map-key-type";
  key: SimpleIdentifierNode | StringNode;
  type: TypeNode;
}

// Export Node
export interface ExportNode extends ASTNode {
  _type: "export";
  names: IdentifierNode[];
}

// Import Node
export interface ImportNode extends ASTNode {
  _type: "import";
  imports: ImportDefinition[];
}

export interface ImportDefinition {
  source:   ImportSource;
  symbols?: SymbolAlias[];
}

export interface SymbolAlias {
  symbol: TypeNameNode;
  as?: TypeNameNode;
}

export interface ImportSource {
  file?:      StringNode;
  namespace?: IdentifierNode;
}


// Class Node
export interface ClassNode extends ASTNode {
  _type: "class";
  name: TypeNameNode;
  generics: GenericTypeNode[];
  access: ModifierNode[];
  extends: TypeNode[];
  implements: TypeNode[];
  body: ASTNode[];
}

// Interface Node
export interface InterfaceNode extends ASTNode {
  _type: "interface";
  name: TypeNameNode;
  generics: InterfaceGenericTypeNameNode[];
  access: AccessModifierNode[];
  implements: TypeNode[];
  body: ASTNode[];
}

// Implements Node
export interface ImplementsNode extends ASTNode {
  _type: "implements";
  type: TypeNode;
};

// Extends Node
export interface ExtendsNode extends ASTNode {
  _type: "extends";
  type: TypeNode;
};

// Interface Generic Type Name Node
export interface InterfaceGenericTypeNameNode extends ASTNode {
  covariance: "in" | "out" | undefined;
  name: TypeNameNode;
}

// Constraint Node
export interface ConstraintNode extends ASTNode {}

// Constraint Implements Node
export interface ConstraintImplementsNode extends ASTNode {
  type: TypeNode;
}

// Constraint Inherits Node
export interface ConstraintInheritsNode extends ASTNode {
  type: TypeNode;
}

// Constraint Is Node
export interface ConstraintIsNode extends ASTNode {
  type: TypeNode;
}

// Constraint Has Node
export interface ConstraintHasNode extends ASTNode {
  member: IdentifierNode;
}

// Try-Catch Node
export interface TryCatchNode extends ASTNode {
  _type: "try-catch";
  try: BodyBlock;
  catch: CatchBlockNode[];
  finally: BodyBlock | null;
}

export interface CatchBlockNode extends BodyBlock {
  filter: CatchFilterNode;
}

export interface CatchFilterNode {
  name: SimpleIdentifierNode;
  type: TypeNameNode;
}


// Await Node
export interface AwaitNode extends ASTNode {
  _type: "await";
  expression: ASTNode;
}

// Assignment Node
export interface AssignmentNode extends ASTNode {
  _type: "assignment";
  assignable: IndexerNode | IdentifierNode | ListNode;
  value: ASTNode;
}

// Compound Assignment Node
export interface CompoundAssignmentNode extends ASTNode {
  _type: "compound-assignment";
  assignable: IndexerNode | IdentifierNode | ListNode;
  compoundOperator: string;
}

// Indexer Node
export interface IndexerNode extends ASTNode {
  _type: "indexer";
  id: IdentifierNode;
  index: ASTNode;
}

// When Node
export interface WhenNode extends ASTNode {
  _type: "when";
  condition: ASTNode;
  then: ASTNode[];
}

// If Node
export interface IfNode extends ASTNode {
  _type: "if";
  condition: ASTNode;
  then: ASTNode;
  else: ASTNode | undefined;
}

// For Node
export interface ForNode extends ASTNode {
  _type: "for";
  initial: ASTNode;
  condition: ASTNode;
  step: ASTNode;
  then: ASTNode;
}

// For Node
export interface ForEachNode extends ASTNode {
  _type: "for-each";
  variable: SimpleIdentifierNode;
  collection: ASTNode;
  then: ASTNode;
}

// While Node
export interface WhileNode extends ASTNode {
  _type: "while";
  condition: ASTNode;
  then: ASTNode;
}

// Match Node
export interface MatchNode extends ASTNode {
  _type: "match";
  expression: ASTNode;
  cases: MatchCaseNode[];
}

// Match Case Node
export interface MatchCaseNode extends ASTNode, BodyBlock {
  _type: "match-case";
  pattern: PatternNode;
}

// Base Pattern Node
export type PatternNode = AnyPatternNode | ListPatternNode | VectorPatternNode | MapPatternNode | IdentifierPatternNode | ConstantPatternNode;

// Any Pattern Node
export interface AnyPatternNode extends ASTNode {
  _type: "any-pattern";
}

// List Pattern Node
export interface ListPatternNode extends ASTNode {
  _type: "list-pattern";
  elements: PatternNode[];
}

// Vector Pattern Node
export interface VectorPatternNode extends ASTNode {
  _type: "vector-pattern";
  elements: PatternNode[];
}

// Map Pattern Node
export interface MapPatternNode extends ASTNode {
  _type: "map-pattern";
  pairs: MapPatternPairNode[];
}

// Map Pattern Pair Node
export interface MapPatternPairNode extends ASTNode {
  _type: "map-pattern-pair";
  key: IdentifierNode | StringNode;
  pattern: PatternNode;
}

// Identifier Pattern Node
export interface IdentifierPatternNode extends ASTNode {
  _type: "identifier-pattern";
  id: IdentifierNode;
}

// Constant Pattern Node
export interface ConstantPatternNode extends ASTNode {
  _type: "constant-pattern";
  constant: StringNode | NumberNode;
}

// Base Number Node
export type NumberNode = IntegerNumberNode | FloatNumberNode | HexNumberNode | OctalNumberNode | BinaryNumberNode;

// Integer Number Node
export interface IntegerNumberNode extends ASTNode {
  _type: "integer-number";
  value: number;
  match: string;
}

// Float Number Node
export interface FloatNumberNode extends ASTNode {
  _type: "float-number";
  value: number;
  match: string;
}

// Hex Number Node
export interface HexNumberNode extends ASTNode {
  _type: "hex-number";
  value: number;
  match: string;
}

// Binary Number Node
export interface BinaryNumberNode extends ASTNode {
  _type: "binary-number";
  value: number;
  match: string;
}

// Octal Number Node
export interface OctalNumberNode extends ASTNode {
  _type: "octal-number";
  value: number;
  match: string;
}

// String Node
export interface StringNode extends ASTNode {
  _type: "string";
  value: string;
}

// Formatted String Node
export interface FormattedStringNode extends ASTNode {
  _type: "formatted-string";
  value: (StringNode | FormatExpressionNode)[];
}

// Format Expression Node
export interface FormatExpressionNode extends ASTNode {
  _type: "format-expression";
  expression: ASTNode;
}

// Identifier Node
export type IdentifierNode = SimpleIdentifierNode | CompositeIdentifierNode;

// Simple Identifier Node
export interface SimpleIdentifierNode extends ASTNode {
  _type: "simple-identifier";
  id: string;
}

// Composite Identifier Node
export interface CompositeIdentifierNode extends ASTNode {
  _type: "composite-identifier";
  parts: string[];
  id: string;
}

// Comment Node
export interface CommentNode extends ASTNode {
  _type: "comment";
  comment: string;
}

// Control Comment Node
export type ControlCommentCommand =
  | "attr"
  | "perf"
  | "lint"
  | "link"
  | "warn"
  | "def"
  | "if";

export type ControlCommentMode = "enable" | "disable";

export interface ControlCommentNode extends ASTNode {
  _type: "control-comment";
  mode: ControlCommentMode;
  command: ControlCommentCommand;
  options: any[];
}

// Function Carrying Node
export interface FunctionCarryingNode extends ASTNode {
  _type: "function-carrying";
  identifier: IdentifierNode;
  sequence: (FunctionCarryingLeftNode | FunctionCarryingRightNode)[];
}

// Function Carrying Left Node
export interface FunctionCarryingLeftNode extends ASTNode {
  _type: "function-carrying-left";
  function: IdentifierNode;
  memberFunction: boolean;
  arguments: ASTNode[];
}

// Function Carrying Right Node
export interface FunctionCarryingRightNode extends ASTNode {
  _type: "function-carrying-right";
  function: IdentifierNode;
  memberFunction: boolean;
  arguments: ASTNode[];
}
