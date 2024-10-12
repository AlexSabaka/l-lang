// l-lang grammar v.0.1.0
// copyright Alex Sabaka 2024

{
  function makeNode(type, rest) {
    return {
      _type: type,
      _location: {
        ...location(),
        text: text(), // TODO: Replace with AspProvider source text caching
      },
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

// ProgramBody
//   = Import
//   / Function
//   / Variable
//   / Class
//   / Interface
//   / Comment



Expression "expression"
  = Assignment

  / Import

  / List
  / Map
  / Vector
  / Quote

  / Variable
  / Function

  / Interface
  / Typedef
  / Class

  / Await
  / When
  / If
  / For
  / ForEach
  / While
  / Match
  / TryCatchFinally

  / FunctionCarrying

  / Number
  / String
  / IndexerAccess
  / Identifier 
  / Comment

// Lists
List "list"
  = _ "(" _ "list"i _ nodes:Expression* _ ")" _ {
    return makeNode("list", { nodes });
  }
  / _ "(" _ nodes:Expression* _ ")" _ {
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




// Vectors
Vector "vector"
  = _ "[" _ values:Expression* _ "]" _ {
    return makeNode("vector", { values });
  }




// Maps
Map "map"
  = _ "{" _ values:MapBody|.., _ / ","| _ "}" _ {
    return makeNode("map", { values });
  }

MapBody
  = KeyValue
  / Comment

KeyValue "key-value"
  = _ ":" _ key:Key _ value:Expression _ {
    return makeNode("key-value", { key, value });
  }

Key "key"
  = SimpleIdentifier / String




// Export definition
Export "export"
  = _ "export" __ names:Identifier|1.., _ / ","| {
    return makeNode("export", { names })
  }




// Import definition
Import "import"
  = _ "import" __ imports:ImportDefinition|1.., _ / ","| {
    return makeNode("import", { imports });
  }

ImportDefinition
  = ImportSymbolsDefinition
  / ImportSource

ImportSymbolsDefinition
  = "{" symbols:SymbolAlias|1.., _ / "," | "}" _ "from" __ source:ImportSource {
    return { ...source, symbols };
  }

SymbolAlias
  = _ symbol:TypeName _ as:("as" __ @TypeName)? _ {
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
  = _ "fn" _ "[" params:Type* "]" _ "->" _ ret:Type _ {
    return makeNode("function-type", { params, ret });
  }


// Simple types
SimpleType
  = _ name:TypeName _ {
    return makeNode("simple-type", { name });
  }


// Generic types
GenericType
  = _ name:TypeName "<" generic:Type ">" _ {
    return makeNode("generic-type", { name, generic });
  }


// Map types
MapType
  = _ "{" keys:KeyDefinition|.., _ / ","| "}" _ {
    return makeNode("map-type", { keys });
  }

KeyDefinition
  = _ ":" _ key:(Identifier / String) _ "<-" _ type:Type _ {
    return makeNode("map-key-type", { key, type });
  }


// Mapped types
MappedType
  = _ "{" _ mapping:FieldsMapping+ _ "}" _ {
    return makeNode("mapped-type", { mapping });
  }

FieldsMapping
  = _ "(" _ mutable:VariableMutableMode __ modifiers:VariableModifier* _ name:(KeySelector / Identifier) _ type:("<-" _ @(TypeSelector / Type))  _ ")" _ {
    // TODO: complete
    return makeNode("type-mapping", {
      
    });
  }

KeySelector
  = _ "[" _ key:Identifier __ "keyof" __ type:TypeName _ "]" _ {
    return { key, type };
  }

TypeSelector
  = _ type:TypeName _ "[" _ key:Identifier _ "]" _ {
    return { type, key };
  }





// Variable definition
Variable
  = _ mutable:VariableMutableMode __ modifiers:VariableModifier* _ name:Identifier? _ type:("<-" _ @Type)? _ value:Expression? {
    return makeNode("variable", { name, mutable, modifiers, type, value });
  }

VariableMutableMode
  = "let" { return false; }
  / "mut" { return true; }

VariableModifier
  = AccessModifier / FieldModifier

FieldModifier
  = _ ":" modifier:("readonly" / "nullable" / "ctor") _ {
    return makeNode("field-modifier", { modifier });
  }





// Function definition
Function
  = _ async:("async" __)? _ "fn" __ modifiers:(@FunctionModifier _)* _ name:Identifier? _
    _ "[" _ params:(@FunctionParameter _ ","?)* _ "]" _ ret:("->" _ @Type)? _ body:Expression* _
  {
    const extern = !!modifiers.find(x => x.modifier === "extern");
    return makeNode("function", { name, async: !!async, extern, modifiers, params, ret, body });
  }

FunctionParameter
  = _ name:Identifier _ modifiers:(@ParameterModifier _)* _ type:("<-" _ @Type)? {
    return makeNode("parameter", { name, modifiers, type });
  }

FunctionModifier
  = _ ":" modifier:("extern" / "override" / "extension" / "operator") _ {
    return makeNode("function-modifier", { modifier });
  }

ParameterModifier
  = _ ":" modifier:("in" / "out" / "ref") _ {
    return makeNode("parameter-modifier", { modifier });
  }





// Function carrying
FunctionCarrying
  = _ id:Identifier _ seq:(
    _ operator:CarryingOperator _ fn:("."? Identifier) _ args:(!CarryingOperator @Expression)* _ {
      return makeNode(operator._type, { function: fn[1], memberFunction: !!fn[0], arguments: args });
    }
  )+ _ {
    return makeNode("function-carrying", { identifier: id, sequence: seq });
  }

CarryingOperator
  = "|>" { return makeNode("function-carrying-left"); }
  / "<|" { return makeNode("function-carrying-right"); }






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
  = _ "defclass" __ access:(@AccessModifier _)* _ className:ClassName? _ ext:(Implements / Extends)* constraints:GenericTypeConstraints* _ body:ClassBodyDefinition* {
    const { name, generics } = className;
    const genericsWithConstraints = (generics ?? []).map(x => {
      const genericConstraints = (constraints ?? [])
        .filter(c => c.where.name === x.name)
        .map(c => c.clause);

      return makeNode("generic-type", { ...x, constraints: genericConstraints });
    });

    const _implements = ext.filter(x => x._type === "implements").map(x => { return { ...x.type } });
    const _extends = ext.filter(x => x._type === "extends").map(x => { return { ...x.type } });
    return makeNode("class", { name, access, implements: _implements, extends: _extends, generics: genericsWithConstraints, body });
  }

ClassBodyDefinition
  = Import
  / Class
  / Interface
  / Function
  / Variable
  / Comment






// Typedef
Typedef
  = _ "deftype" _ name:ClassName {
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
  = _ "definterface" _ access:(@AccessModifier _)* _ name:InterfaceName? _ impl:Implements? _ body:InterfaceBody* {
    return makeNode("interface", { ...name, access, implements: impl, body });
  }

InterfaceBody
  = Expression




// Access modifiers
AccessModifier
  = _ ":" modifier:("public" / "private" / "static" / "internal") _ {
    return makeNode("access-modifier", { modifier });
  }






Implements
  = _ ":implements" _ type:TypeName _ {
    return makeNode("implements", { type });
  }

Extends
  = _ ":extends" _ type:TypeName _ {
    return makeNode("extends", { type });
  }





// Generics type constraints
GenericTypeConstraints
  = _ where:Where _ clause:(HasConstraint / IsConstraint / InheritsConstraint / ImplementsConstraint) {
    return {
      where, clause,
    }
  }

Where
  = _ ":where" _ name:TypeName _ {
    return name;
  }


ImplementsConstraint
  = _ ":implements" _ type:Type _ {
    return makeNode("constraint-implements", { type });
  }

InheritsConstraint
  = _ ":inherits" _ type:Type _ {
    return makeNode("constraint-inherits", { type });
  }

IsConstraint
  = _ ":is" _ type:Type _ {
    return makeNode("constraint-is", { type });
  }

// when you want to check if type has a member
HasConstraint
  = _ ":has" _ member:Identifier _ {
    return makeNode("constraint-has", { member });
  }





// Await keyword
Await
  = _ "await" __ expression:Expression _ {
    return makeNode("await", { expression });
  }





// Assignment statement
Assignment
  = _ assignable:Assignable _ operator:Control? "=" _ value:Expression _ {
    return makeNode(!!operator ? "compound-assignment" : "assignment", { assignable, value, compoundOperator: operator ?? undefined });
  }

Assignable
  = List
  / IndexerAccess
  / Identifier

IndexerAccess
  = id:Identifier _ "[" index:Expression "]" {
    return makeNode("indexer", { id, index })
  }






// Try-Catch-Finally block
TryCatchFinally
  = tryBlock:Try catchBlocks:Catch* finallyBlock:Finally? {
    return makeNode("try-catch", { try: tryBlock, catch: catchBlocks, finally: finallyBlock });
  }

Try
  = "try" _ body:Expression {
    return { body };
  }

Catch
  = "catch" _ filter:CatchFilter? _ body:Expression {
    return { filter, body };
  }

CatchFilter
  = name:SimpleIdentifier _ type:(":of" _ @TypeName)? {
    return { name, type };
  }

Finally
  = "finally" _ body:Expression {
    return { body };
  }




// Control flow statements
When
  = _ "when" __ (":cond" __)? condition:Expression
              _ (":then" __)? then:Expression* {
    return makeNode("when", { condition, then });
  }

If
  = _ "if" __ (":cond" __)? condition:Expression
            _ (":then" __)? then:Expression
            _ (":else" __)? elseThen:Expression? {
    return makeNode("if", { condition, then, else: elseThen });
  }

Cond
  = _ "cond" __ cases:CondCase+ _ {
    return makeNode("cond", { cases });
  }

CondCase
  = _ condition:Expression _ body:Expression _ {
    return makeNode("cond-case", { condition, body });
  }


// Loop statements
For
  = _ "for" __ (":init" __)? initial:Expression
             _ (":cond" __)? condition:Expression
             _ (":step" __)? step:Expression
             _ (":then" __)? then:Expression {
    return makeNode("for", { initial, condition, step, then });
  }

ForEach
  = _ "for" __ (":each" __)? variable:SimpleIdentifier
             _ (":from" __)? collection:Expression
             _ (":then" __)? then:Expression {
    return makeNode("for-each", { variable, collection, then });
  }

While
  = _ "while" __ (":cond" __)? condition:Expression
               _ (":then" __)? then:Expression {
    return makeNode("while", { condition, then });
  }






// Pattern matching
Match
  = _ "match" __ expression:Expression _ "{" _ cases:MatchCase+ _ "}" _ {
    return makeNode("match", { expression, cases });
  }

MatchCase
  = _ pattern:Pattern _ "=>" _ body:Expression _ {
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
  = "(" _ params:Pattern* _ ")" _ "->" _ ret:Pattern _ {
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




// Numbers
Number "number"
  = HexNumber / BinNumber / OctNumber / IntegerNumber / FloatNumber

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

IntegerNumber
  = _ match:$("-"? ("0" / [1-9][0-9]*)) _ {
    return makeNode("integer-number", { match, value: parseInt(match) });
  }

FloatNumber
  = _ match:$("-"? ("0" / [1-9][0-9]*) ("." [0-9]+)? ("e" "-"? [0-9]+)?) _ {
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
      mode:[+-] WS* command:CMD options:(WS+ @ID)+ WS*{
          return {
            command: command,
            mode: mode === "+" ? "enable" : "disbale",
            options: options,
          };
        }
    ) EOL {
    return makeNode("control-comment", { ...control });
  }

CMD = "attr" / "perf" / "lint" / "link" / "warn" / "use" / "def" / "if"
ID = $[.,?'"|@:`~;^&*%$#=+!()\[\]/\\\\-_0-9a-zA-Z]+
WS = [ \t]
EOL = [\n\r]
ANY = [^\n]




// Misc
Control "control" = [_\-*+\\/^&%$#@!~=|<>\`:?]
NonControl "non-control" = [^ \t\n\r.,?'"|@:`~;^&*%$#=+!()\[\]/\\-_0-9]

Alpha "alphabetical" = [_a-zA-Z]

HexDigit "hex" = [0-9a-fA-F]
Digit "digit" = [0-9]

__ "whitespace" = [ \t\n\r]+
_ "whitespace" = [ \t\n\r]*

EOF = !.