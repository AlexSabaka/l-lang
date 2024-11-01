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
    (key) => key !== "_type" && key !== "_location" && key !== "_parent"
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

export function isFileImportSource(source: FileImportSource | NamespaceImportSource): source is FileImportSource {
  return Object.keys(source).includes("file");
}

export function isNamespaceImportSource(source: FileImportSource | NamespaceImportSource): source is NamespaceImportSource {
  return Object.keys(source).includes("namespace");
}


export type NodeType =
  | "program"
  | "list"
  | "quote"
  | "vector"
  | "matrix"
  | "map"
  | "key-value"
  | "export"
  | "import"
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
  | "modifier"
  | "variable"
  | "function"
  | "parameter"
  | "function-carrying"
  | "class"
  | "enum"
  | "struct"
  | "type-def"
  | "interface"
  | "implements"
  | "extends"
  | "type-constraint"
  | "await"
  | "spread"
  | "simple-assignment"
  | "compound-assignment"
  | "indexer"
  | "try-catch"
  | "when"
  | "if"
  | "cond"
  | "cond-case"
  | "for"
  | "for-each"
  | "while"
  | "match"
  | "match-case"
  | "any-pattern"
  | "functional-pattern"
  | "type-pattern"
  | "list-pattern"
  | "vector-pattern"
  | "map-pattern"
  | "map-pattern-pair"
  | "identifier-pattern"
  | "constant-pattern"
  | "string"
  | "formatted-string"
  | "format-expression"
  | "boolean"
  | "null"
  | "octal-number"
  | "binary-number"
  | "hex-number"
  | "fraction-number"
  | "integer-number"
  | "float-number"
  | "simple-identifier"
  | "composite-identifier"
  | "comment"
  | "control-comment"
  ;

export interface ASTNode<T extends NodeType = NodeType> {
  [key: string]: any;
  _type: T;
  _location: Location;
  _parent: ASTNode | undefined;
}

export interface ProgramNode extends ASTNode<"program"> {
  program: ASTNode[];
}

export interface ListNode extends ASTNode<"list"> {
  nodes: ASTNode[];
}

export interface QuoteNode extends ASTNode<"quote"> {
  mode: string;
  nodes: ASTNode[];
}

export interface VectorNode extends ASTNode<"vector"> {
  values: ASTNode[];
}

export type MatrixNodeRow = ASTNode[];

export interface MatrixNode extends ASTNode<"matrix"> {
  rows: MatrixNodeRow[];
}

export interface MapNode extends ASTNode<"map"> {
  values: ASTNode[];
}

export interface KeyValueNode extends ASTNode<"key-value"> {
  key: SimpleIdentifierNode | StringNode;
  value: ASTNode;
}

export interface ExportNode extends ASTNode<"export"> {
  exports: ImportExportAlias[];
}

export interface ImportExportAlias {
  symbol: IdentifierNode | TypeNode;
  as: IdentifierNode;
}

export interface ImportNode extends ASTNode<"import"> {
  imports: ImportDefinition[];
}

export interface ImportDefinition {
  symbols: ImportExportAlias;
  source: FileImportSource | NamespaceImportSource;
}

export interface FileImportSource {
  file: StringNode;
}

export interface NamespaceImportSource {
  namespace: IdentifierNode;
}

export interface TypeNameNode extends ASTNode<"type-name"> {
  name: string;
}

export interface TypeNode extends ASTNode<"type"> {
  type: TypeNameNode;
  array: boolean;
}

export interface UnionTypeNode extends ASTNode<"union-type"> {
  types: TypeNode[];
}

export interface IntersectionTypeNode extends ASTNode<"intersection-type"> {
  types: TypeNode[];
}

export interface FunctionTypeNode extends ASTNode<"function-type"> {
  params: TypeNode[];
  ret: TypeNode[];
}

export interface SimpleTypeNode extends ASTNode<"simple-type"> {
  name: TypeNameNode;
}

export interface GenericTypeNode extends ASTNode<"generic-type"> {
  name: TypeNameNode;
  generics: TypeNameNode[];
  // constraints;
}

export interface MapTypeNode extends ASTNode<"map-type"> {
  keys: MapKeyTypeNode[];
}

export interface MapKeyTypeNode extends ASTNode<"map-key-type"> {
  key: IdentifierNode | StringNode;
  type: TypeNode;
}

export interface MappedTypeNode extends ASTNode<"mapped-type"> {
  // mapping;
}

export interface ModifierNode extends ASTNode<"modifier"> {
  modifier: string;
}

export interface VariableNode extends ASTNode<"variable"> {
  name: IdentifierNode;
  mutable: boolean;
  modifiers: ModifierNode[];
  type: TypeNode;
  value: ASTNode;
}

export interface FunctionNode extends ASTNode<"function"> {
  name: IdentifierNode;
  async: boolean;
  extern: boolean;
  modifiers: ModifierNode[];
  params: ParameterNode[];
  returns: TypeNode;
  body: ASTNode[];
}

export interface ParameterNode extends ASTNode<"parameter"> {
  name: IdentifierNode;
  modifiers: ModifierNode[];
  type: TypeNode;
}

export interface FunctionCarryingNode extends ASTNode<"function-carrying"> {
  identifier: IdentifierNode;
  sequence: FunctionCarryingApply[];
}

export type FunctionCarryingOperator =
  | "carrying-left"
  | "carrying-right"
  ;

export interface FunctionCarryingApply {
  operator: FunctionCarryingOperator;
  function: IdentifierNode;
  memberFunction: boolean;
  arguments: ASTNode[];
}

export interface ClassNode extends ASTNode<"class"> {
  name: TypeNameNode;
  modifiers: ModifierNode[];
  implements: ImplementsNode[];
  extends: ExtendsNode[];
  generics: GenericTypeNode[];
  body: ASTNode[];
}

export interface EnumNode extends ASTNode<"enum"> {
  name: TypeNameNode;
  modifiers: ModifierNode[];
  body: ASTNode[];
}

export interface StructNode extends ASTNode<"struct"> {
  name: TypeNameNode;
  modifiers: ModifierNode[];
  body: ASTNode[];
}

export interface TypeDefNode extends ASTNode<"type-def"> {}

export interface InterfaceNode extends ASTNode<"interface"> {
  name: TypeNameNode;
  generics: InterfaceGenericType[];
  modifiers: ModifierNode[];
  implements: ImplementsNode;
  body: ASTNode[];
}

export type InterfaceGenericTypeCovariance =
  | "in"
  | "out"
  ;

export interface InterfaceGenericType {
  name: TypeNameNode;
  covariance: InterfaceGenericTypeCovariance;
}

export interface ImplementsNode extends ASTNode<"implements"> {
  type: TypeNameNode;
}

export interface ExtendsNode extends ASTNode<"extends"> {
  type: TypeNameNode;
}

export interface TypeConstraintNode extends ASTNode<"type-constraint"> {
  where: TypeNameNode;
  constraints: { constraint: string; value: ASTNode }[];
}

export interface AwaitNode extends ASTNode<"await"> {
  expression: ASTNode;
}

export interface SpreadNode extends ASTNode<"spread"> {
  expression: ASTNode;
}

export type AssignmentNode =
  | SimpleAssignmentNode
  | CompoundAssignmentNode
  ;

export type AssignableNode =
  | ListNode
  | VectorNode
  | MapNode
  | MatrixNode
  | IndexerNode
  | IdentifierNode
  ;

export interface SimpleAssignmentNode extends ASTNode<"simple-assignment"> {
  assignable: AssignableNode;
  value: ASTNode;
}

export interface CompoundAssignmentNode extends ASTNode<"compound-assignment"> {
  assignable: AssignableNode;
  value: ASTNode;
  operator: string;
}

export interface IndexerNode extends ASTNode<"indexer"> {
  id: IdentifierNode;
  indices: ASTNode[][];
}

export interface TryCatchNode extends ASTNode<"try-catch"> {
  try: ASTNode;
  catch: TryCatchFilter[];
  finally: ASTNode | null;
}

export interface TryCatchFilter {
  filter: {
    name: SimpleIdentifierNode;
    type: TypeNameNode;
  };
  body: ASTNode;
}

export interface WhenNode extends ASTNode<"when"> {
  condition: ASTNode;
  then: ASTNode[];
}

export interface IfNode extends ASTNode<"if"> {
  condition: ASTNode;
  then: ASTNode;
  else: ASTNode;
}

export interface CondNode extends ASTNode<"cond"> {
  cases: CondCaseNode[];
}

export interface CondCaseNode extends ASTNode<"cond-case"> {
  condition: ASTNode;
  body: ASTNode;
}

export interface ForNode extends ASTNode<"for"> {
  initial: ASTNode;
  condition: ASTNode;
  step: ASTNode;
  then: ASTNode;
  else: ASTNode;
}

export interface ForEachNode extends ASTNode<"for-each"> {
  variable: IdentifierNode;
  collection: ASTNode;
  then: ASTNode;
}

export interface WhileNode extends ASTNode<"while"> {
  condition: ASTNode;
  then: ASTNode;
}

export interface MatchNode extends ASTNode<"match"> {
  expression: ASTNode;
  cases: MatchCaseNode[];
}

export interface MatchCaseNode extends ASTNode<"match-case"> {
  pattern: PatternNode;
  body: ASTNode;
}

export type PatternNode =
  | AnyPatternNode
  | FunctionalPatternNode
  | ListPatternNode
  | VectorPatternNode
  | MapPatternNode
  | TypePatternNode
  | IdentifierPatternNode
  | ConstantPatternNode
  ;

export interface AnyPatternNode extends ASTNode<"any-pattern"> {}

export interface FunctionalPatternNode extends ASTNode<"functional-pattern"> {
  params: TypeNode[];
  ret: TypeNode;
}

export interface TypePatternNode extends ASTNode<"type-pattern"> {
  id: IdentifierNode;
  type: TypeNode;
}

export interface ListPatternNode extends ASTNode<"list-pattern"> {
  elements: PatternNode[];
}

export interface VectorPatternNode extends ASTNode<"vector-pattern"> {
  elements: PatternNode[];
}

export interface MapPatternNode extends ASTNode<"map-pattern"> {
  pairs: MapPatternPairNode[];
}

export interface MapPatternPairNode extends ASTNode<"map-pattern-pair"> {
  key: SimpleIdentifierNode | StringNode;
  pattern: PatternNode;
}

export interface IdentifierPatternNode extends ASTNode<"identifier-pattern"> {
  id: IdentifierNode;
}

export interface ConstantPatternNode extends ASTNode<"constant-pattern"> {
  constant: StringNode | NumberNode;
}

export interface StringNode extends ASTNode<"string"> {
  value: string;
}

export interface FormattedStringNode extends ASTNode<"formatted-string"> {
  value: ASTNode[];
}

export interface FormatExpressionNode extends ASTNode<"format-expression"> {
  expression: ASTNode;
}

export interface BooleanNode extends ASTNode<"boolean"> {
  value: boolean;
}

export interface NullNode extends ASTNode<"null"> {
  keyword: string;
}

export type NumberNode =
  | OctalNumberNode
  | BinaryNumberNode
  | HexNumberNode
  | FractionNumberNode
  | IntegerNumberNode
  | FloatNumberNode
  ;

export interface OctalNumberNode extends ASTNode<"octal-number"> {
  match: string;
  value: number;
}

export interface BinaryNumberNode extends ASTNode<"binary-number"> {
  match: string;
  value: number;
}

export interface HexNumberNode extends ASTNode<"hex-number"> {
  match: string;
  value: number;
}

export interface FractionNumberNode extends ASTNode<"fraction-number"> {
  match: string;
  numerator: number;
  denominator: number;
}

export interface IntegerNumberNode extends ASTNode<"integer-number"> {
  match: string;
  value: number;
}

export interface FloatNumberNode extends ASTNode<"float-number"> {
  match: string;
  value: number;
}

export type IdentifierNode =
  | SimpleIdentifierNode
  | CompositeIdentifierNode
  ;

export interface SimpleIdentifierNode extends ASTNode<"simple-identifier"> {
  id: string;
}

export interface CompositeIdentifierNode extends ASTNode<"composite-identifier"> {
  id: string;
  parts: string[];
}

export interface CommentNode extends ASTNode<"comment"> {
  comment: string;
}

export type ControlCommentCommand =
  | "compiler-attribute"
  | "performance-optimization"
  | "linter-option"
  | "linker-option"
  | "warning"
  | "define"
  | "conditional"
  ;

export type ControlCommentMode =
  | "enable"
  | "disable"
  ;

export interface ControlCommentNode extends ASTNode<"control-comment"> {
  command: ControlCommentCommand;
  mode: ControlCommentMode;
  options: string[];
}
