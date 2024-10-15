// NodeType definitions
export type NodeType = AllNodeTypes | CommentType | IdentifierType | NumberType;

export type AllNodeTypes =
  | "program"
  | "list"
  | "quote"
  | "vector"
  | "matrix"
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
  | "modifier"
  | "function"
  | "parameter"
  | "function-carrying"
  | "generic-type"
  | "class"
  | "type-def"
  | "interface"
  | "implements"
  | "indexer"
  | "extends"
  | "type-constraint"
  | "await"
  | "when"
  | "cond"
  | "cond-case"
  | "if"
  | "for"
  | "for-each"
  | "try-catch"
  | "simple-assignment"
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
  | "format-expression";

export type CommentType = "comment" | "control-comment";

export type IdentifierType = "simple-identifier" | "composite-identifier";

export type NumberType =
  | "octal-number"
  | "binary-number"
  | "hex-number"
  | "integer-number"
  | "float-number"
  | "fraction-number";

export interface Location {
  source: string | undefined;
  start: Position;
  end: Position;
}

export interface Position {
  offset: number;
  line: number;
  column: number;
}

export function getNodeIterableKeys(node: ASTNode): (keyof ASTNode)[] {
  return Object.keys(node).filter(
    (key) =>
      key !== "_type" && key !== "_location" && key !== "_parent"
  ) as (keyof ASTNode)[];
}

export function isAstNode(node: any): node is ASTNode {
  return node && typeof node === "object" && "_type" in node;
}

export function isIterableAstNode(node: any): node is ASTNode[] {
  return (
    Array.isArray(node) &&
    node.length > 0 &&
    typeof node[0] === "object" &&
    node[0] !== null &&
    "_type" in node[0]
  );
}

// Base AST Node class
export interface ASTNode<T extends NodeType = NodeType> {
  [key: string]: any;

  _type: T;
  _location: Location;
  _parent: ASTNode | undefined;
}

// Program Node
export interface ProgramNode extends ASTNode<"program"> {
  program: ASTNode[];
}

// List Node
export interface ListNode extends ASTNode<"list"> {
  nodes: ASTNode[];
}

// Quote Node
export interface QuoteNode extends ASTNode<"quote"> {
  mode: string;
  content: string | null;
  nodes: ASTNode[] | null;
}

// Vector Node
export interface VectorNode extends ASTNode<"vector"> {
  values: ASTNode[];
}

// Matrix Node
export interface MatrixNode extends ASTNode<"matrix"> {
  rows: ASTNode[][];
}

// Map Node
export interface MapNode extends ASTNode<"map"> {
  values: MapKeyValueNode[];
}

// Map Key-Value Node
export interface MapKeyValueNode extends ASTNode<"key-value"> {
  key: IdentifierNode | StringNode;
  value: ASTNode;
}

// Variable Node
export interface VariableNode extends ASTNode<"variable"> {
  mutable: boolean;
  name: IdentifierNode;
  modifiers: ModifierNode[];
  type: TypeNode | undefined;
  value: ASTNode | undefined;
}

// Function Node
export interface FunctionNode extends ASTNode<"function"> {
  name: IdentifierNode | undefined;
  async: boolean;
  extern: boolean;
  modifiers: ModifierNode[];
  params: FunctionParameterNode[];
  returns: TypeNode | undefined;
  body: ASTNode | undefined;
}

// Function Parameter Node
export interface FunctionParameterNode extends ASTNode<"parameter"> {
  name: IdentifierNode;
  modifiers: ModifierNode[];
  type: TypeNode | undefined;
}

// Modifier Node
export interface ModifierNode extends ASTNode<"modifier"> {
  modifier: string;
}

// Base Type Node
export interface TypeNode extends ASTNode<"type"> {
  name: string;
}

// Type Name Node
export interface TypeNameNode extends ASTNode<"type-name"> {
  name: string;
}

// Union Type Node
export interface UnionTypeNode extends ASTNode<"union-type"> {
  types: TypeNode[];
}

// Intersection Type Node
export interface IntersectionTypeNode extends ASTNode<"intersection-type"> {
  types: TypeNode[];
}

// Simple Type Node
export interface SimpleTypeNode extends ASTNode<"simple-type"> {
  name: TypeNameNode;
}

// Generic Type Node
export interface GenericTypeNode extends ASTNode<"generic-type"> {
  name: TypeNameNode;
  generic: TypeNode;
  constraints?: ConstraintNode[];
}

// Mapped Type Node
export interface MappedTypeNode extends ASTNode<"mapped-type"> {
  mapping: ASTNode;
}

// Type Mapping Node
export interface TypeMappingNode extends ASTNode<"type-mapping"> {}

// Map Type Node
export interface MapTypeNode extends ASTNode<"map-type"> {
  keys: KeyDefinitionNode[];
}

// Key Definition Node
export interface KeyDefinitionNode extends ASTNode<"map-key-type"> {
  key: SimpleIdentifierNode | StringNode;
  type: TypeNode;
}

// Export Node
export interface ExportNode extends ASTNode<"export"> {
  names: IdentifierNode[];
}

// Import Node
export interface ImportNode extends ASTNode<"import"> {
  imports: ImportDefinition[];
}

export interface ImportDefinition {
  source: ImportSource;
  symbols?: SymbolAlias[];
}

export interface SymbolAlias {
  symbol: TypeNameNode;
  as?: TypeNameNode;
}

export interface ImportSource {
  file?: StringNode;
  namespace?: IdentifierNode;
}

// Class Node
export interface ClassNode extends ASTNode<"class"> {
  name: TypeNameNode;
  generics: GenericTypeNode[];
  access: ModifierNode[];
  extends: TypeNode[];
  implements: TypeNode[];
  body: ASTNode[];
}

// Interface Node
export interface InterfaceNode extends ASTNode<"interface"> {
  name: TypeNameNode;
  generics: InterfaceGenericTypeNameNode[];
  modifiers: ModifierNode[];
  implements: TypeNode[];
  body: ASTNode[];
}

// Implements Node
export interface ImplementsNode extends ASTNode<"implements"> {
  type: TypeNode;
}

// Extends Node
export interface ExtendsNode extends ASTNode<"extends"> {
  type: TypeNode;
}

// Interface Generic Type Name Node
export interface InterfaceGenericTypeNameNode extends ASTNode<"interface"> {
  covariance: "in" | "out" | undefined;
  name: TypeNameNode;
}

export interface ConstraintNode extends ASTNode<"type-constraint"> {
  where: TypeNameNode;
  constraint: string;
  value: IdentifierNode;
}

// Try-Catch Node
export interface TryCatchNode extends ASTNode<"try-catch"> {
  try: ASTNode;
  catch: CatchBlockNode[];
  finally: ASTNode | null;
}

export interface CatchBlockNode {
  filter: CatchFilterNode;
  body: ASTNode;
}

export interface CatchFilterNode {
  name: SimpleIdentifierNode;
  type: TypeNameNode;
}

// Await Node
export interface AwaitNode extends ASTNode<"await"> {
  expression: ASTNode;
}

// Assignment Node
export interface SimpleAssignmentNode extends ASTNode<"simple-assignment"> {
  assignable: IndexerNode | IdentifierNode | ListNode;
  value: ASTNode;
}

// Compound Assignment Node
export interface CompoundAssignmentNode extends ASTNode<"compound-assignment"> {
  assignable: IndexerNode | IdentifierNode | ListNode;
  operator: string;
  value: ASTNode;
}

// Indexer Node
export interface IndexerNode extends ASTNode<"indexer"> {
  id: IdentifierNode;
  index: ASTNode;
}

// When Node
export interface WhenNode extends ASTNode<"when"> {
  condition: ASTNode | undefined;
  then: ASTNode[] | undefined;
}

// Cond Node
export interface CondNode extends ASTNode<"cond"> {
  cases: CondCaseNode[];
}

// Cond Case Node
export interface CondCaseNode extends ASTNode {
  _type: "cond-case";
}

// If Node
export interface IfNode extends ASTNode<"if"> {
  condition: ASTNode | undefined;
  then: ASTNode | undefined;
  else: ASTNode | undefined;
}

// For Node
export interface ForNode extends ASTNode<"for"> {
  initial: ASTNode;
  condition: ASTNode;
  step: ASTNode;
  then: ASTNode;
}

// For Node
export interface ForEachNode extends ASTNode<"for-each"> {
  variable: SimpleIdentifierNode;
  collection: ASTNode;
  then: ASTNode;
}

// While Node
export interface WhileNode extends ASTNode<"while"> {
  condition: ASTNode;
  then: ASTNode;
}

// Match Node
export interface MatchNode extends ASTNode<"match"> {
  expression: ASTNode;
  cases: MatchCaseNode[];
}

// Match Case Node
export interface MatchCaseNode extends ASTNode<"match-case"> {
  pattern: PatternNode;
  body: ASTNode;
}

// Base Pattern Node
export type PatternNode =
  | AnyPatternNode
  | ListPatternNode
  | VectorPatternNode
  | MapPatternNode
  | IdentifierPatternNode
  | ConstantPatternNode;

// Any Pattern Node
export interface AnyPatternNode extends ASTNode<"any-pattern"> {}

// List Pattern Node
export interface ListPatternNode extends ASTNode<"list-pattern"> {
  elements: PatternNode[];
}

// Vector Pattern Node
export interface VectorPatternNode extends ASTNode<"vector-pattern"> {
  elements: PatternNode[];
}

// Map Pattern Node
export interface MapPatternNode extends ASTNode<"map-pattern"> {
  pairs: MapPatternPairNode[];
}

// Map Pattern Pair Node
export interface MapPatternPairNode extends ASTNode<"map-pattern-pair"> {
  key: IdentifierNode | StringNode;
  pattern: PatternNode;
}

// Identifier Pattern Node
export interface IdentifierPatternNode extends ASTNode<"identifier-pattern"> {
  id: IdentifierNode;
}

// Constant Pattern Node
export interface ConstantPatternNode extends ASTNode<"constant-pattern"> {
  constant: StringNode | NumberNode;
}

// Base Number Node
export type NumberNode =
  | IntegerNumberNode
  | FloatNumberNode
  | FractionNumberNode
  | HexNumberNode
  | OctalNumberNode
  | BinaryNumberNode;

// Integer Number Node
export interface IntegerNumberNode extends ASTNode<"integer-number"> {
  value: number;
  match: string;
}

// Float Number Node
export interface FloatNumberNode extends ASTNode<"float-number"> {
  value: number;
  match: string;
}

// Fraction Number Node
export interface FractionNumberNode extends ASTNode<"fraction-number"> {
  numerator: number;
  denominator: number;
}

// Hex Number Node
export interface HexNumberNode extends ASTNode<"hex-number"> {
  value: number;
  match: string;
}

// Binary Number Node
export interface BinaryNumberNode extends ASTNode<"binary-number"> {
  value: number;
  match: string;
}

// Octal Number Node
export interface OctalNumberNode extends ASTNode<"octal-number"> {
  value: number;
  match: string;
}

// String Node
export interface StringNode extends ASTNode<"string"> {
  value: string;
}

// Formatted String Node
export interface FormattedStringNode extends ASTNode<"formatted-string"> {
  value: (StringNode | FormatExpressionNode)[];
}

// Format Expression Node
export interface FormatExpressionNode extends ASTNode<"format-expression"> {
  expression: ASTNode;
}

// Identifier Node
export type IdentifierNode = SimpleIdentifierNode | CompositeIdentifierNode;

// Simple Identifier Node
export interface SimpleIdentifierNode extends ASTNode<"simple-identifier"> {
  id: string;
}

// Composite Identifier Node
export interface CompositeIdentifierNode
  extends ASTNode<"composite-identifier"> {
  parts: string[];
  id: string;
}

// Comment Node
export interface CommentNode extends ASTNode<"comment"> {
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

export interface ControlCommentNode extends ASTNode<"control-comment"> {
  mode: ControlCommentMode;
  command: ControlCommentCommand;
  options: any[];
}

// Function Carrying Node
export interface FunctionCarryingNode extends ASTNode<"function-carrying"> {
  identifier: IdentifierNode;
  sequence: FunctionCarryingSequence[];
}

export interface FunctionCarryingSequence {
  operator: string;
  function: IdentifierNode;
  memberFunction: boolean;
  arguments: ASTNode[];
}
