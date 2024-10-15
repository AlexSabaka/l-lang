// l-lang grammar v.0.1.0
// copyright Alex Sabaka 2024

{
  function makeNode(type, rest) {
    return {
      _type: type,
      _location: location(),
      ...(rest ?? {}),
    }
  }

  function foldStringFormat(items) {
    return items.reduce((acc, item) => {
        if (typeof item === 'string') {
          if (typeof acc[acc.length - 1] === 'string') {
            acc[acc.length - 1] += item;
          } else {
            acc.push(item);
          }
        } else {
          acc.push(item);
        }
        return acc;
      }, [])
      .map(x => typeof x !== 'string' ? x : makeNode("string", { value: x }));
  }
}

Program "program"
  = program:Expression* EOF? {
    return makeNode("program", { program });
  }


Expression "expression"
  =
    Comment

  // Import and export
  / Import
  / Export

  // Declarations
  / Variable
  / Function

  // Data types declarations
  / Interface
  / TypeDef
  / Class
  / Struct
  / Enum

  // Await operator
  / Await

  // Control flow expressions
  / When
  / If
  / Cond
  / For
  / ForEach
  / While
  / TryCatchFinally
  / FunctionCarrying
  / Match

  // 
  / Assignment
  / Indexer
  / Spread

  // Data structures
  / List
  / Map
  / Vector
  / Matrix
  / Quote

  // Literals
  / Identifier
  / Number
  / String
  / Boolean
  / Nil


// Lists
List "list"
  = _ "(" _ nodes:Expression* _ ")" _ {
    return makeNode("list", { nodes });
  }


// Quotes
Quote "quote"
  = _ "'" (! '"') _ nodes:Expression _ {
    const content = text().slice(1).trim();
    return makeNode("quote", { mode: "default", content, nodes });
  }
  / _ "'(" _ nodes:Expression* _ ")" _ {
    const content = text().slice(2, -1).trim();
    return makeNode("quote", { mode: "default", content, nodes });
  }
  / _ mode:Identifier "'(" _ content:QuoteContent? _ ")" _ {
    return makeNode("quote", { mode: mode.id, content, nodes: null });
  }

QuoteContent
  = $QuotedExpression*

QuotedExpression
  = "(" _ QuoteContent _ ")"     // Match nested expressions within parentheses
  / [^()]+                       // Match any content without parentheses


// Unquoted expression
Unquoted
  = _

// Vectors
Vector "vector"
  = _ "[" _ values:(!"|" @Expression)* _ "]" _ {
    return makeNode("vector", { values });
  }

// Matrices
Matrix "matrix"
  = _ "[" _ rows:MatrixRow|1.., "|"| _ "]" _ {
    return makeNode("matrix", { rows });
  }

MatrixRow
  = _ values:(!"|" @Expression)|1.., ","?| _ {
    return values;
  }

// Maps
Map "map"
  = _ "{" _ values:MapBody|.., ","?| _ "}" _ {
    return makeNode("map", { values });
  }

MapBody
  = KeyValue
  / Comment

KeyValue "key-value"
  = _ ":" _ key:Key _ value:Expression? _ {
    return makeNode("key-value", { key, value });
  }

Key "key"
  = SimpleIdentifier / String


// Export definition
// 
// Singleline example:     | S-form
// export a                | (export a)
// export a :as b          | (export (a b))
// 
// Multiline example:      |
// export a :as d          | (export (a d)
//        b :as c          |         (b c)
//        f e r            |         f e r)
// 
Export "export"
  = _ ExportKw __ exports:ExportAlias|1.., ","?| {
    return makeNode("export", { exports })
  }

ExportAlias
  = symbol:(Identifier / Type) _ as:(AsModKw __ @Identifier)? _ {
    return { symbol, as };
  }


// Import definition
// 
// Singleline examples:                        | S-form
// import "file.lisp"                          | (import "file.lisp")
// import module.namespace                     | (import module.namespace)
// import { a, b :as c } from "file.lisp"      | (import (a (b c)) 'from "file.lisp")
// import { a :as b, c } from module.namespace | (import (a b) c 'from module.namespace)
// 
// Multiline example:                          |
// import "file.lisp"                          |
//        module.namespace                     |
//        { a b :as c } from "file.lisp"       |
//        { a :as b c } from module.namespace  |
Import "import"
  = _ ImportKw __ imports:ImportDefinition|1.., ","?| {
    return makeNode("import", { imports });
  }

ImportDefinition
  = ImportSymbolsDefinition
  / ImportSource

ImportSymbolsDefinition
  = "{" symbols:SymbolAlias|1.., ","? | "}" _ FromKw __ source:ImportSource {
    return { ...source, symbols };
  }

SymbolAlias
  = _ symbol:TypeName _ as:(AsModKw __ @TypeName)? _ {
    return { symbol, as };
  }

ImportSource
  = file:RawString {
    return { source: { file }};
  }
  / namespace:Identifier {
    return { source: { namespace }};
  }


// Type definitions
TypeName "type name"
  = _ name:$(Alpha (Alpha / Digit)*) _ {
    return makeNode("type-name", { name });
  }

Type "type"
  = type:UnionType {
    return makeNode("type", { type, array: false });
  }
  / "(" _ type:UnionType _ ")" _ array:"[]"? _ {
    return makeNode("type", { ...type, array: !!array });
  }

UnionType
  // = types:IntersectionType|1.., "|"| {
  = head:IntersectionType _ tail:("|" _ @IntersectionType)* {
    const types = [head, ...tail];
    if (types.length === 1) {
      return types[0];
    }

    return makeNode("union-type", { types });
  }

IntersectionType
  // = types:IntersectionType|1.., "&"| {
  = head:BasicTypes _ tail:("&" _ @BasicTypes)* {
    const types = [head, ...tail];
    if (types.length === 1) {
      return types[0];
    }

    return makeNode("intersection-type", { types: [head, ...tail] });
  }

BasicTypes
  = _ type:(FunctionType / MapType / GenericType / SimpleType) array:"[]"? _ {
    return makeNode("", { ...type, array: !!array });
  }


// Function types
FunctionType
  = _ async:(AsyncKw __)? _ FunctionKw _ "[" params:Type* "]" _ RightArrowKw _ ret:Type _ {
    return makeNode("function-type", { params, ret });
  }


// Simple types
SimpleType
  = _ name:TypeName _ {
    return makeNode("simple-type", { name });
  }


// Generic types
GenericType
  = _ name:TypeName "<" generics:Type|1.., ","?| ">" _ {
    return makeNode("generic-type", { name, generics });
  }


// Map types
MapType
  = _ "{" keys:KeyDefinition|.., ","?| "}" _ {
    return makeNode("map-type", { keys });
  }

KeyDefinition
  = _ ":" _ key:MapKey _ LeftArrowKw _ type:Type _ {
    return makeNode("map-key-type", { key, type });
  }

MapKey
  = Identifier
  / String


// Mapped types
MappedType
  = _ "{" _ mapping:FieldsMapping+ _ "}" _ {
    return makeNode("mapped-type", { mapping });
  }

FieldsMapping
  = _ "("
    _ mutable:LetMutMode __ modifiers:Modifier*
    _ name:(KeySelector / Identifier)
    _ type:(LeftArrowKw _ @(TypeSelector / Type))
    _ ")" _ {
    // TODO: complete
    return makeNode("type-mapping", {
      
    });
  }

KeySelector
  = _ "[" _ key:Identifier __ KeyOfKw __ type:TypeName _ "]" _ {
    return { key, type };
  }

TypeSelector
  = _ type:TypeName _ "[" _ key:Identifier _ "]" _ {
    return { type, key };
  }


// Modifier
Modifier
  = ":" modifier:ModifierKw _ {
    return makeNode("modifier", { modifier });
  }

// Variable definition
Variable
  = _ mutable:LetMutMode __ modifiers:Modifier* _ name:Identifier? _ type:(LeftArrowKw _ @Type)?
    _ value:Expression? {
    return makeNode("variable", { name, mutable, modifiers, type, value });
  }

LetMutMode
  = LetKw { return false; }
  / MutKw { return true; }


// Function definition
Function
  = _ async:(AsyncKw __)? _ FunctionKw __ modifiers:(@Modifier _)*
    _ name:Identifier? _ "[" _ params:FunctionParameter|.. , ","?| _ "]" _ returns:(RightArrowKw _ @Type)?
    _ body:Expression? _
  {
    const extern = !!modifiers.find(x => x.modifier === "extern");
    return makeNode("function", { name, async: !!async, extern, modifiers, params, returns, body });
  }

FunctionParameter
  = _ name:Identifier _ modifiers:(@Modifier _)* _ type:(LeftArrowKw _ @Type)? {
    return makeNode("parameter", { name, modifiers, type });
  }


// Function carrying
FunctionCarrying
  = _ id:Identifier _ seq:(
    _ operator:CarryingOperator _ fn:("."? Identifier) _ args:(!CarryingOperator @Expression)* _ {
      return { operator, function: fn[1], memberFunction: !!fn[0], arguments: args };
    }
  )+ _ {
    return makeNode("function-carrying", { identifier: id, sequence: seq });
  }

CarryingOperator
  = "|>" { return "carrying-left"; }
  / "<|" { return "carrying-right"; }


// Class
ClassGenerics
  = _ "<" head:TypeName _ tail:("," _ @TypeName)* ">" _ {
    return [head, ...tail];
  }

ClassName
  = _ name:TypeName _ generics:ClassGenerics? _ {
    return {
      name,
      generics
    }
  }

Class
  = _ DefClassKw __ modifiers:(@Modifier _)* _ className:ClassName? _ ext:(Implements / Extends)* constraints:GenericTypeConstraints* _ body:ClassBodyDefinition* {
    const { name, generics } = className;
    const genericsWithConstraints = (generics ?? []).map(x => {
      const genericConstraints = (constraints ?? [])
        .filter(c => c.where.name === x.name)
        .map(c => c.clause);

      return makeNode("generic-type", { ...x, constraints: genericConstraints });
    });

    const _implements = ext.filter(x => x._type === "implements").map(x => { return { ...x.type } });
    const _extends = ext.filter(x => x._type === "extends").map(x => { return { ...x.type } });
    return makeNode("class", { name, modifiers, implements: _implements, extends: _extends, generics: genericsWithConstraints, body });
  }

ClassBodyDefinition
  = Expression


// Enum
Enum
  = _ DefEnumKw __ modifiers:(@Modifier _)* _ name:Identifier? _ body:EnumBody* {
    return makeNode("enum", { name, modifiers, body });
  }

EnumBody
  = Expression


// Struct
Struct
  = _ DefStructKw __ modifiers:(@Modifier _)* _ name:Identifier? _ body:StructBody* {
    return makeNode("struct", { name, modifiers, body });
  }

StructBody
  = Expression


// Typedef
TypeDef
  = _ DefTypeKw __ modifiers:(@Modifier _)* _ name:Identifier? _ {
    // Continue...
    return makeNode("type-def", { });
  }


// Interface
InterfaceGenericCovariance
  = _ ":" covariant:("in" / "out") _ {
    return covariant;
  }

InterfaceGenericTypeName
  = _ covariance:(@InterfaceGenericCovariance _)? name:TypeName _ {
    return {
      name,
      covariance,
    };
  }

InterfaceGenerics
  = _ "<" head:InterfaceGenericTypeName _ tail:("," _ @InterfaceGenericTypeName)* ">" _ {
    return [head, ...tail];
  }

InterfaceName
  = _ name:TypeName _ generics:InterfaceGenerics? _ {
    return {
      name,
      generics
    }
  }

Interface
  = _ DefInterfaceKw _ modifiers:(@Modifier _)* _ name:InterfaceName? _ impl:Implements? _ body:InterfaceBody* {
    return makeNode("interface", { ...name, modifiers, implements: impl, body });
  }

InterfaceBody
  = Expression


Implements
  = _ ImplementsModKw _ type:TypeName _ {
    return makeNode("implements", { type });
  }

Extends
  = _ ExtendsModKw _ type:TypeName _ {
    return makeNode("extends", { type });
  }


// Generics type constraints
GenericTypeConstraints
  = _ where:Where _ constraints:TypeConstraint* {
    return makeNode("type-constraint", { where, ...constraints });
  }

Where
  = _ WhereModKw _ name:TypeName _ {
    return name;
  }

// Constraints
TypeConstraint
  = _ ":" constraint:ConstraintKw _ value:Expression _ {
    return { constraint, value };
  }


// Await keyword
Await
  = _ AwaitKw __ expression:Expression _ {
    return makeNode("await", { expression });
  }


// Spread operator
Spread
  = _ SpreadKw expression:Expression _ {
    return makeNode("spread", { expression });
  }

// Assignment statement
Assignment
  = SimpleAssignment
  / CompoundAssignment

SimpleAssignment
  = _ assignable:Assignable _ AssignmentOperatorKw _ value:Expression _ {
    return makeNode("simple-assignment", { assignable, value });
  }

CompoundAssignment
  = _ assignable:Assignable _ operator:$CompoundAssignmentOperator _ value:Expression _ {
    return makeNode("compound-assignment", { assignable, value, operator });
  }

CompoundAssignmentOperator
  = Control AssignmentOperatorKw

Assignable
  = List
  / Vector
  / Map
  / Matrix
  / Indexer
  / Identifier

Indexer
  = id:Identifier indicies:("[" @Expression|1.., ","?| "]")|1..| {
    return makeNode("indexer", { id, indicies })
  }


// Try-Catch-Finally block
TryCatchFinally
  = tryBlock:Try
    catchBlocks:Catch*
    finallyBlock:Finally? {
    return makeNode("try-catch", { try: tryBlock, catch: catchBlocks, finally: finallyBlock });
  }

Try
  = TryKw _ body:Expression? {
    return body;
  }

Catch
  = CatchKw _ filter:CatchFilter? _ body:Expression? {
    return { filter, body };
  }

CatchFilter
  = name:SimpleIdentifier _ type:(OfModKw _ @TypeName)? {
    return { name, type };
  }

Finally
  = "finally" _ body:Expression {
    return body;
  }


// Control flow statements
When
  = _ WhenKw __ cond:((CondModKw __)? @Expression)?
              _ then:((ThenModKw __)? @Expression)? {
    return makeNode("when", { condition: cond, then });
  }

If
  = _ IfKw __ cond:((CondModKw __)? @Expression)?
            _ then:((ThenModKw __)? @Expression)?
        _ elseThen:((ElseModKw __)? @Expression)? {
    return makeNode("if", { condition: cond, then, else: elseThen });
  }

Cond
  = _ CondKw __ cases:CondCase+ _ {
    return makeNode("cond", { cases });
  }

CondCase
  = "(" _ cond:((CondModKw __)? @Expression)?
        _ body:((ThenModKw __)? @Expression)? _ ")" {
    return makeNode("cond-case", { condition: cond, body });
  }


// Loop statements
For
  = _ ForKw __ init:((InitModKw __)? @Expression)?
             _ cond:((CondModKw __)? @Expression)?
             _ step:((StepModKw __)? @Expression)?
             _ then:((ThenModKw __)? @Expression)?
          _ elseFor:((ElseModKw __)? @Expression)? {
    return makeNode("for", { initial: init, condition: cond, step, then, else: elseFor });
  }

ForEach
  = _ ForKw __ var_:((EachModKw __)? @Identifier)?
             _ coll:((FromModKw __)? @Expression)?
             _ then:((ThenModKw __)? @Expression)? {
    return makeNode("for-each", { variable: var_, collection: coll, then });
  }

While
  = _ WhileKw __ cond:((CondModKw __)? @Expression)?
               _ then:((ThenModKw __)? @Expression)? {
    return makeNode("while", { condition: cond, then });
  }


// Pattern matching
Match
  = _ MatchKw __ expression:Expression _ "{" _ cases:MatchCase+ _ "}" _ {
    return makeNode("match", { expression, cases });
  }

MatchCase
  = _ pattern:Pattern _ RightDoubleArrowKw _ body:Expression _ {
    return makeNode("match-case", { pattern, body });
  }

Pattern
  = AnyPattern
  / FunctionalPattern
  / ListPattern
  / VectorPattern
  / MapPattern
  / IdentifierPattern
  / ConstantPattern

AnyPattern
  = "_" _ { return makeNode("any-pattern"); }

FunctionalPattern
  = "(" _ params:Pattern* _ ")" _ RightArrowKw _ ret:Pattern _ {
    return makeNode("functional-pattern", { params, ret });
  }

ListPattern
  = "(" _ elements:Pattern* _ ")" _ {
    return makeNode("list-pattern", { elements });
  }

VectorPattern
  = "[" _ elements:Pattern* _ "]" _ {
    return makeNode("vector-pattern", { elements });
  }

MapPattern
  = "{" _ pairs:(@MapPatternPair _ ","?)* _ "}" _ {
    return makeNode("map-pattern", { pairs });
  }

MapPatternPair
  = _ ":" _ key:Key __ pattern:Pattern _ {
    return makeNode("map-pattern-pair", { key, pattern });
  }

IdentifierPattern
  = id:Identifier {
    return makeNode("identifier-pattern", { id });
  }

ConstantPattern
  = constant:(String / Number) {
    return makeNode("constant-pattern", { constant });
  }


// Strings
String
  = RawString / FormattedString

RawString
  = _ '"' value:$Char* '"' _ {
    return makeNode("string", { value });
  }

FormattedString
  = _ '\'"' items:(Format / Char)* '"' _ {
    return makeNode("formatted-string", { value: foldStringFormat(items) });
  }

Format
  = "{" expression:Expression? "}" {
    return makeNode("format-expression", { expression });
  }

Char
  = unescaped
  / "\\" sequence:(
        '"'
      / "\\"
      / "/"
      / "b" { return "\b"; }
      / "f" { return "\f"; }
      / "n" { return "\n"; }
      / "r" { return "\r"; }
      / "t" { return "\t"; }
      / "u" digits:$(HexDigit HexDigit HexDigit HexDigit) {
          return String.fromCharCode(parseInt(digits, 16));
        }
    )
    { return sequence; }

unescaped
  = [^\0-\x1F\x22\x5C]


// Booleans
Boolean
  = _ TrueKw _ { return makeNode("boolean", { value: true }); }
  / _ FalseKw _ { return makeNode("boolean", { value: false }); }


// Nil (null, undefined, nil, none, void, empty)
Nil
  = _ kw:NilKw _ { return makeNode("null", { keyword: kw }); }


// Numbers
Number
  = HexNumber / BinNumber / OctNumber / FractionNumber / IntegerNumber / FloatNumber

OctNumber
  = _ "0" match:$[0-7]+ _ {
    return makeNode("octal-number", { match, value: parseInt(match, 8) });
  }

BinNumber
  = _ "0b" match:$[0-1]+ _ {
    return makeNode("binary-number", { match, value: parseInt(match, 2) });
  }

HexNumber
  = _ "0x" match:$(HexDigit+) _ {
    return makeNode("hex-number", { match, value: parseInt(match, 16) });
  }

FractionNumber
  = _ a:$([+-]? DigitSequence) "/" b:$DigitSequence _ {
    return makeNode("fraction-number", { numerator: parseInt(a), denominator: parseInt(b) });
  }

IntegerNumber
  = _ match:$([+-]? DigitSequence) _ {
    return makeNode("integer-number", { match, value: parseInt(match) });
  }

FloatNumber
  = _ match:$([+-]? DigitSequence ("." [0-9]+)? ("e" [+-]? [0-9]+)?) _ {
    return makeNode("float-number", { match, value: parseFloat(match) });
  }


// Identifier
Identifier
  = CompositeIdentifier
  / SimpleIdentifier

SimpleIdentifier
  = _ id:Ident {
    return makeNode("simple-identifier", { id });
  }

CompositeIdentifier
  = _ head:Ident tail:( "." @Ident )+ {
    const id = `${head}.${tail.join(".")}`;
    return makeNode("composite-identifier", { id, parts: [ head, ...tail ] });
  }

Ident
  = id:$((NonControl / Control) (NonControl / Control / Digit)*) { return id; }


// Comments
Comment
  = ControlComment / SimpleComment 

SimpleComment
  = _ ';' comment:$ANY* {
    return makeNode("comment", { comment });
  }

ControlComment
  = _ ';@' WS* control:(
      mode:[+-] WS* command:ControlCommentCommandKw options:(WS+ @ID)+ WS*{
          return {
            command: command,
            mode: mode === "+" ? "enable" : "disbale",
            options: options,
          };
        }
    ) EOL {
    return makeNode("control-comment", { ...control });
  }

ID = $[.,?'"|@:`~;^&*%$#=+!()\[\]/\\\\-_0-9a-zA-Z]+
WS = [ \t]
EOL = [\n\r]
ANY = [^\n]


// Keywords
ControlCommentCommandKw
  = "attr"i { return "compiler-attribute"; }
  / "perf"i { return "performance-optimization"; }
  / "lint"i { return "linter-option"; }
  / "link"i { return "linker-option"; }
  / "warn"i { return "warning"; }
  / "def"i { return "define"; }
  / "if"i { return "conditional"; }

MatchKw = "match"i
WhileKw = "while"i
ForKw = "for"i
CondKw = "cond"i
IfKw = "if"i
WhenKw = "when"i
FinallyKw = "finally"i
CatchKw = "catch"i
TryKw = "try"i
AwaitKw = "await"i
AsyncKw = "async"i
DefInterfaceKw = "definterface"i
DefClassKw = "defclass"i
DefTypeKw = "deftype"i
DefEnumKw = "defenum"i
DefMacroKw = "defmacro"i
DefStructKw = "defstruct"i
DefTraitKw = "deftrait"i
FunctionKw = "fn"i
LetKw = "let"i
MutKw = "mut"i
KeyOfKw = "keyof"i
ImportKw = "import"i
ExportKw = "export"i
FromKw = "from"i

TrueKw
  = "true"i !NonControl
  / "#t"i !NonControl

FalseKw
  = "false"i !NonControl
  / "#f"i !NonControl

SpreadKw
  = "..."i
  / "…"i

ImplementsModKw = ":implements"i
ExtendsModKw = ":extends"i
WhereModKw = ":where"i

NilKw
  = "nil"i
  / "null"i
  / "none"i
  / "void"i
  / "undefined"i
  / "nothing"i
  / "empty"i
  / "ø"i

ConstraintKw
  = (
      "implements"i
    / "inherits"i
    / "is"i
    / "has"i
  ) {
    return text().toLowerCase();
  }

AsModKw = ":as"i
OfModKw = ":of"i

CondModKw = ":cond"i
ThenModKw = ":then"i
ElseModKw = ":else"i
InitModKw = ":init"i
StepModKw = ":step"i
EachModKw = ":each"i
FromModKw = ":from"i

LeftArrowKw = "<-"i
RightArrowKw = "->"i

LeftDoubleArrowKw = "<="i
RightDoubleArrowKw = "=>"i

AssignmentOperatorKw = "="i

ModifierKw
  = (
      "public"i
    / "private"i
    / "static"i
    / "internal"i
    / "extern"i
    / "override"i
    / "explicit-cast"i
    / "implicit-cast"i
    / "extension"i
    / "operator"i
    / "in"i
    / "out"i
    / "ref"i
    / "readonly"i
    / "nullable"i
    / "ctor"i
  ) {
    return text().toLowerCase();
  }


// Misc
// NOTE: Under review to get cut coz almost identical
Control "control" = [_\-*+\\/^&%$#@!~=|<>\`:?]
NonControl "non-control" = [^ \t\n\r.,?'"|@:`~;^&*%$#=+!()\[\]/\\-_0-9]

// NOTE: Under review to get cut
Alpha "alphabetical" = [_a-zA-Z]

HexDigit "hex" = [0-9a-fA-F]
DigitSequence "digit sequence" = [0] / [1-9][0-9]*
Digit "digit" = [0-9]

__ "whitespace" = [ \t\n\r]+
_ "whitespace" = [ \t\n\r]*

EOF = !.