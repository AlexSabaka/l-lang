import { createHash, hash } from "crypto";

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

/**
 * Narrow an ASTNode to a ListNode.
 *
 * `ASTNode<T>` is a generic interface, not a discriminated union, so a bare `node._type === "list"`
 * check does NOT narrow it -- `.nodes` was only reachable because of the `[key: string]: any`
 * index signature. Six separate sites open-coded that check while unwrapping the
 * "list-wrapped declaration" shape (a `(let :ctor x 0)` in a class body arrives as
 * `list{nodes:[variable]}`), and every one of them was leaning on the escape hatch.
 */
export function isListNode(node: ASTNode | undefined): node is ListNode {
  return node?._type === "list";
}

/** Same reason as isListNode: `_type === "string"` does not narrow a generic ASTNode. */
export function isStringNode(node: ASTNode | undefined): node is StringNode {
  return node?._type === "string";
}

export function isIterableAstNode(node: any): node is ASTNode[] {
  return Array.isArray(node); 
}

export function isFileImportSource(source: FileImportSource | NamespaceImportSource): source is FileImportSource {
  return Object.keys(source).includes("file");
}

export function isNamespaceImportSource(source: FileImportSource | NamespaceImportSource): source is NamespaceImportSource {
  return Object.keys(source).includes("namespace");
}

export function getNodeHash(node: ASTNode): string {
  const nodeLocation = `${node._type}_${node._location.start.offset}_${node._location.end.offset}_${node._location.source}`;
  return hash('sha1', nodeLocation, "hex");
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
  | "modifier-def"
  | "macro-def"
  | "variable"
  | "function"
  | "parameter"
  | "class"
  | "enum"
  | "enum-key"
  | "struct"
  | "type-def"
  | "interface"
  | "implements"
  | "extends"
  | "type-constraint"
  | "spread"
  | "await"
  | "simple-assignment"
  | "compound-assignment"
  | "indexer"
  | "call"
  | "member"
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
  | "rest-pattern"
  | "constant-pattern"
  | "string"
  | "formatted-string"
  | "format-expression"
  | "boolean"
  | "null"
  | "hex-number"
  | "octal-number"
  | "binary-number"
  | "complex-number"
  | "fraction-number"
  | "integer-number"
  | "float-number"
  | "simple-identifier"
  | "composite-identifier"
  | "comment"
  ;

export interface ASTNode<T extends NodeType = NodeType> {
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

/**
 * `'(+ 1 2)`, `'sym`.
 *
 * `nodes` is the quoted DATUM -- ONE node. In a Lisp, quote returns the datum: `'(a b)` is a list,
 * `'x` is a symbol. So `'(+ 1 2)` carries a `list` node, not the list's elements.
 *
 * It was declared `ASTNode[]` and was an array in neither frontend consistently: grammar_v2 UNWRAPPED
 * the list (yielding an array for `'(a b)` and a bare node for `'x`), while PEG kept the list node.
 * Another declared-type-is-a-lie, in the same family as `TypeDefNode` (Phase 2) and `ClassNode.generics`
 * (P7a). Normalised to PEG's shape, which is the one that preserves the structure.
 *
 * NOTE `'"Hello {(name)}"` is NOT a quote -- it is a `formatted-string`, split off by a negative
 * lookahead (`/'(?!")/`) in both frontends. Quote and string interpolation share a leading `'` and
 * nothing else.
 */
export interface QuoteNode extends ASTNode<"quote"> {
  nodes: ASTNode;
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
  symbol: IdentifierNode | TypeNameNode;
  as: IdentifierNode | undefined;
}

export interface ImportNode extends ASTNode<"import"> {
  imports: ImportDefinition[];
}

export interface ImportDefinition {
  symbols: ImportExportAlias[];
  source: FileImportSource | NamespaceImportSource;
}

export interface FileImportSource {
  file: StringNode;
}

export interface NamespaceImportSource {
  namespace: IdentifierNode;
}

/**
 * A type NAME -- `Int`, `Container`, `T`. Note `name` is a plain STRING, not a nested node.
 *
 * In a declaration's generics list a type-name IS the type PARAMETER, and may carry variance:
 * `(definterface Producer<:out T>)`. Everywhere else `variance` is absent. Both frontends emit a
 * type-name here; the AST used to declare these lists as `GenericTypeNode[]` (whose `name` is a
 * nested TypeNameNode), so every consumer read `generic.name.name` and got `undefined`.
 */
export interface TypeNameNode extends ASTNode<"type-name"> {
  name: string;
  /** Declaration-site variance. Only ever set on an element of a `generics` list. */
  variance?: TypeVariance;
}

/** Declaration-site variance: `:out` is covariant, `:in` contravariant, absent is invariant. */
export type TypeVariance = "in" | "out";

export interface TypeNode extends ASTNode<"type"> {
  type: TypeNameNode;
  array: boolean;
  /**
   * `String?` -- the type admits nil (D9).
   *
   * Like `array`, this can sit on EITHER this wrapper or the inner node, because both `type` and
   * `basicType` carry the suffix: `(A | B)?` lands here, a plain `String?` lands on the inner
   * simple-type. `convertAstType` reads both positions. Optionality binds OUTSIDE the array suffix,
   * so `T[]?` is an optional array and an array of optionals is `(T?)[]`.
   *
   * Non-nullable is the default and always was -- nothing ever set `nullable` on a target type, so
   * `(let x <- String nil)` has always been an error. This is the flag that lets a declaration OPT
   * IN, which is the thing that did not exist.
   */
  optional?: boolean;
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
  mapping: ASTNode[];
}

export interface ModifierNode extends ASTNode<"modifier"> {
  modifier: string;
  args?: ASTNode[];
}

export interface VariableNode extends ASTNode<"variable"> {
  /** A name, or a destructuring pattern: `(let [x y] point)`, `(let {:name :age} person)`. */
  name: BindingTarget;
  mutable: boolean;
  /**
   * `:extern` -- an ambient global. DECLARED, never defined (Sd).
   *
   * `mouseX`, `frameCount`, `Infinity`: names the host provides and l-lang must not emit. The flag
   * lived only on FunctionNode, while `:extern` was already LEGAL on a `let` (the modifier whitelist
   * admits it) and meant nothing at all -- so an ambient VALUE was unsayable, silently.
   */
  extern: boolean;
  modifiers: ModifierNode[];
  type: TypeNode;
  value: ASTNode;
}

export interface FunctionNode extends ASTNode<"function"> {
  name: IdentifierNode;
  async: boolean;
  /** `:gen` (D31). The function lowers to a JS `function*`; `(yield x)` in its body produces. */
  generator: boolean;
  extern: boolean;
  modifiers: ModifierNode[];
  params: ParameterNode[];
  returns: TypeNode;
  body: ASTNode[];
  /**
   * Optional, and NEVER populated by either frontend: a generic function declaration
   * (`(fn identity<T> [x <- T] -> T ...)`) is not parseable -- only classes and interfaces have a
   * generics slot. InferTypesAstVisitor.visitFunction binds these, so the code exists and is
   * inert; it is kept, and typed honestly, rather than deleted, so that it works the day the
   * grammar grows generic functions.
   */
  generics?: TypeNameNode[];
}

export interface ParameterNode extends ASTNode<"parameter"> {
  /** A name, or a destructuring pattern: `(fn f [[x y]] ...)`. */
  name: BindingTarget;
  modifiers: ModifierNode[];
  type: TypeNode;
  spread?: boolean;
  /**
   * NO DEFAULT SLOT, deliberately -- see the open finding in DECISIONS.md.
   *
   * `(fn greet [name <- String "World"])` cannot work: a parameter list is space-separated, so
   * `[a b]` is unresolvably "two parameters" or "a defaulting to b". Measured, not assumed --
   * `[a <- Int b <- Int]` parsed as `a` defaulting to `b`, plus a parameter named `<-`.
   *
   * Common Lisp hit the same wall and solved it with a MARKER (`&optional (name "World")`), which is
   * what l-lang will need too. Deferred until after D9: a defaulted parameter is OMITTABLE WITHOUT
   * BEING NULLABLE, so how it composes with `T?` optionals is a question best answered once those
   * exist. It also needs LL0211 taught the difference between required and total arity.
   */
}

export interface ClassNode extends ASTNode<"class"> {
  name: TypeNameNode;
  modifiers: ModifierNode[];
  implements: ImplementsNode[];
  extends: ExtendsNode[];
  /** The declared type PARAMETERS: the `T` of `(defclass Container<T>)`. See TypeNameNode. */
  generics: TypeNameNode[];
  body: ASTNode[];
}

export interface EnumNode extends ASTNode<"enum"> {
  name: TypeNameNode;
  modifiers: ModifierNode[];
  body: EnumKeyNode[];
}

export interface EnumKeyNode extends ASTNode<"enum-key"> {
  key: IdentifierNode | StringNode;
  value: ASTNode;
}

export interface StructNode extends ASTNode<"struct"> {
  name: TypeNameNode;
  modifiers: ModifierNode[];
  /**
   * `:implements` / `:extends` on a struct (D11).
   *
   * A struct had NO class surface at all -- no inheritance clauses in either the AST or the grammar.
   * grammar_v2 refused `(defstruct Rect :implements Shape ...)` outright; the PEG parsed it and
   * dumped the clause into `body` as two junk bare identifiers, so the interface was forgotten and the
   * program ran.
   *
   * No `generics` yet: `(defstruct Box<T> ...)` is still a parse error in both frontends, and nothing
   * in the corpus asks for it.
   */
  implements: ImplementsNode[];
  extends: ExtendsNode[];
  body: ASTNode[];
}

export interface TypeDefNode extends ASTNode<"type-def"> {
  name: IdentifierNode;
  type: TypeNode;
  modifiers: ModifierNode[];
}

export interface ModifierDefNode extends ASTNode<"modifier-def"> {
  name: string;
  params: ParameterNode[];
  body: ASTNode[];
}

/**
 * `(defmacro ...)` / `(defsyntax ...)`.
 *
 * D3 rules macros OUT for 1.0, and reserves the keywords: `(defmacro ...)` is a hard
 * "not implemented in 0.x" error, NEVER a silent call. So the form is PARSED -- that is what
 * "reserved" means -- and then rejected by name (LL0023), which is the only way to give it a located
 * diagnostic rather than a mystifying parse error about an unexpected `)`.
 *
 * Nothing consumes this node beyond that check. It exists to be refused clearly.
 */
export interface MacroDefNode extends ASTNode<"macro-def"> {
  /** `defmacro` or `defsyntax` -- so the diagnostic can quote what was actually written. */
  keyword: string;
  name?: IdentifierNode;
  body: ASTNode[];
}

export interface InterfaceNode extends ASTNode<"interface"> {
  name: TypeNameNode;
  /** Same shape as ClassNode.generics -- an interface's `T` may carry `:in`/`:out` variance. */
  generics: TypeNameNode[];
  modifiers: ModifierNode[];
  implements: ImplementsNode;
  body: ASTNode[];
}

/**
 * `:implements Producer<Animal>` / `:extends Container<Int>`.
 *
 * `generics` are the type ARGUMENTS -- the `<Animal>`. Both frontends used to consume only the bare
 * `TypeName` and drop them, which made `16_covariance.lisp` (whose every line is
 * `:implements Producer<Animal>` / `:implements Producer<Dog>`) unrepresentable, and use-site
 * variance impossible to check.
 */
export interface ImplementsNode extends ASTNode<"implements"> {
  type: TypeNameNode;
  generics?: TypeNode[];
}

export interface ExtendsNode extends ASTNode<"extends"> {
  type: TypeNameNode;
  generics?: TypeNode[];
}

export interface TypeConstraintNode extends ASTNode<"type-constraint"> {
  where: TypeNameNode;
  constraints: { constraint: string; value: ASTNode }[];
}

export interface SpreadNode extends ASTNode<"spread"> {
  expression: ASTNode;
}

// D14 (docs/spec/DECISIONS.md#d14): grammar_v2 is the first frontend that can lex/parse
// `await` at all (AwaitKw doesn't exist in the current PEG grammar). No pass downstream
// reads this node type yet -- await semantics (type-checking, codegen) land in a later phase.
export interface AwaitNode extends ASTNode<"await"> {
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

/**
 * CORE NODES — `call` and `member`.
 *
 * These have no surface syntax and no parser rule. Nothing in either frontend produces them; they
 * exist so that a DESUGARED form can say what the sugar meant, and they are the reason a pipeline can
 * become one tree that both the type checker and codegen read.
 *
 * The existing nodes cannot express it:
 *
 *   - a `list` is a call ONLY when its head is an identifier or a dotted-member indexer, so
 *     `((fn [x] (* x 2)) 21)` -- calling a function EXPRESSION -- does not compile at all (LL0101).
 *   - an `indexer`'s base is an `IdentifierNode`, so the object of a member access must be a NAME.
 *     `(x |> .length)` needs the member of a COMPUTED value.
 *
 * A pipeline stage is precisely "call this expression with the piped value" and "take this member of
 * a computed value". Without these two nodes, the desugared form is inexpressible and the transform
 * has to live in codegen -- which is exactly how the type checker ended up never seeing it.
 */
export interface CallNode extends ASTNode<"call"> {
  /** Any expression. Not restricted to a name, which is the whole point. */
  callee: ASTNode;
  arguments: ASTNode[];
}

export interface MemberNode extends ASTNode<"member"> {
  /** Any expression. */
  object: ASTNode;
  property: ASTNode;
  /** `obj[expr]` vs `obj.name`. The two emit identically in JavaScript; the flag records intent. */
  computed: boolean;
}

export interface IndexerNode extends ASTNode<"indexer"> {
  id: IdentifierNode;
  /** The suffix chain, in source order. `xs[0].name` -> [[0], ["name"]]. */
  indices: ASTNode[][];
  /**
   * Parallel to `indices`: true where the suffix was written `.name` rather than `[expr]`.
   *
   * The two EMIT identically -- `obj.name` and `obj["name"]` are the same thing in JavaScript -- but
   * they do not MEAN the same thing to D1, which rules that `(obj.m)` is always a CALL while
   * `(obj["m"])` is a read. Erasing the distinction would silently turn every `(xs["key"])` into a
   * call, which is the opposite of what D1 is for.
   */
  members?: boolean[];
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
  /**
   * D12: clause kinds that appeared more than once. Present ONLY when the form is malformed, so
   * a well-formed `for` carries no extra field. Missing-required clauses need no bookkeeping --
   * they are visible as a null slot.
   */
  duplicateClauses?: string[];
}

export interface ForEachNode extends ASTNode<"for-each"> {
  /** D16: `(for :each [key val] :from settings.entries ...)` destructures. */
  variable: BindingTarget;
  collection: ASTNode;
  then: ASTNode;
  else: ASTNode;
  duplicateClauses?: string[];
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
  /** `:when <expr>` (D26). The pattern binds; this reads those bindings and gates the arm. */
  guard?: ASTNode;
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
  | RestPatternNode
  | ConstantPatternNode
  ;

/**
 * What a `let`/`mut` or a parameter may bind: a plain name, or a destructuring pattern.
 * `(let x 5)` / `(let [x y] point)` / `(let {:name :age} person)`.
 */
export type BindingTarget = IdentifierNode | VectorPatternNode | MapPatternNode;

/** `...rest` -- only meaningful as the final element of a vector pattern. */
export interface RestPatternNode extends ASTNode<"rest-pattern"> {
  id: IdentifierNode;
}

/** Is this binding target a destructuring pattern rather than a plain name? */
export function isBindingPattern(
  target: BindingTarget | undefined
): target is VectorPatternNode | MapPatternNode {
  return target?._type === "vector-pattern" || target?._type === "map-pattern";
}

/**
 * Every identifier a binding target introduces into scope.
 *
 * `x` -> [x]; `[x y]` -> [x, y]; `{:name :age}` -> [name, age];
 * `[a ...rest]` -> [a, rest]; nested patterns flatten.
 *
 * The symbol table and codegen both need this: a destructuring `let` declares N names, not one,
 * so every pass that used to read `node.name.id` has to ask this instead.
 */
export function bindingIdentifiers(target: BindingTarget | undefined): IdentifierNode[] {
  const ids: IdentifierNode[] = [];

  const walk = (n: any): void => {
    if (!n) return;
    switch (n._type) {
      case "simple-identifier":
      case "composite-identifier":
        ids.push(n as IdentifierNode);
        return;
      case "identifier-pattern":
      case "rest-pattern":
        walk(n.id);
        return;
      case "vector-pattern":
      case "list-pattern":
        (n.elements ?? []).forEach(walk);
        return;
      case "map-pattern":
        // The bound name is the PATTERN side, not the key: `{:firstName first-name}` binds
        // `first-name`. The shorthand `{:name}` is normalised to an identifier-pattern on the key
        // by the AST builder, so this stays uniform.
        (n.pairs ?? []).forEach((pair: any) => walk(pair.pattern));
        return;
      case "any-pattern":
        return; // `_` binds nothing
      default:
        return;
    }
  };

  walk(target);
  return ids;
}

/** Convenience: the bound names as strings. */
export function bindingNames(target: BindingTarget | undefined): string[] {
  return bindingIdentifiers(target).map((i) => (i as any).id).filter(Boolean);
}

/**
 * The textual name of a symbol, whichever node kind carries it: identifiers keep it in `id`,
 * type names in `name`.
 *
 * Call sites used to write `node.name ?? node.id`, which only compiled because ASTNode carried an
 * `[key: string]: any` index signature. That made the wrong field silently yield `undefined`
 * rather than fail to typecheck -- which is the whole reason the index signature is gone.
 */
export function symbolName(node: IdentifierNode | TypeNameNode): string {
  return node._type === "type-name" ? node.name : node.id;
}

/** The textual key of a map/enum key node: a string literal's `value`, an identifier's `id`. */
export function keyName(node: StringNode | IdentifierNode): string {
  return node._type === "string" ? node.value : node.id;
}

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
  /**
   * Always present. The shorthand `{:name :age}` -- which binds each key under its own name --
   * is normalised by the AST builder into an explicit identifier-pattern, so every consumer
   * (match codegen, destructuring codegen) sees one uniform shape.
   */
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
  | ComplexNumberNode
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

export interface ComplexNumberNode extends ASTNode<"complex-number"> {
  match: string;
  real: number;
  imaginary: number;
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
  headless: boolean;
  parts: string[];
}

export interface CommentNode extends ASTNode<"comment"> {
  comment: string;
}
