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

  // Custom modifier definitions
  / DefModifier

  // Reserved, and refused: see Macro above
  / Macro

  // Control flow expressions
  / When
  / If
  / Cond
  / For
  / While
  / TryCatchFinally
  / Match

  // Assignments
  / Assignment
  / Indexer
  / Await
  / Spread

  // Data structures
  / List
  / Map
  / Vector
  / Matrix
  / Quote

  // Literals
  / Nil
  / Boolean
  / Number
  / String
  / Identifier


// Lists
List "list"
  = _ "(" _ nodes:Expression* _ ")" _ {
    return makeNode("list", { nodes });
  }


// Quotes
Quote "quote"
  = _ "'" (! '"') _ nodes:Expression _ {
    return makeNode("quote", { mode: "default", nodes });
  }
  / _ "'(" _ nodes:Expression* _ ")" _ {
    return makeNode("quote", { mode: "default", nodes });
  }


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

// `{ :name "x" }` -- the colon form -- and `{ "host" "localhost" }` -- a bare STRING key.
//
// Only the colon form existed, so `{"host" "localhost"}` was a parse error. That, not codegen, is
// what actually blocked 04-data-types/02_maps.lisp: its old xfail blamed a "D13 map-key codegen
// crash", but D13's codegen half was fixed in P5b and the file never reached codegen at all.
//
// A string key needs no colon to be unambiguous: the colon form exists to let a BARE IDENTIFIER be a
// key (`:name` rather than `name`, which would be a variable reference). A string literal is already
// unmistakably a key.
KeyValue "key-value"
  = _ ":" _ key:Key _ value:Expression? _ {
    return makeNode("key-value", { key, value });
  }
  / _ key:String _ value:Expression _ {
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
  = "{" _ symbols:SymbolAlias|1.., ","? | "}" _ FromKw __ source:ImportSource {
    return { ...source, symbols };
  }

SymbolAlias
  = _ symbol:SymbolName _ as:(AsModKw __ @SymbolName)? _ {
    return { symbol, as };
  }

// A name in an `{ ... }` import list, and NOT `TypeName`.
//
// `TypeName` is `Alpha (Alpha / Digit)*` with `Alpha = [_a-zA-Z]` -- NO HYPHEN. grammar_v2's
// equivalent consumes an `Identifier`, which allows one. So `(import { starts-with } from "...")`
// parsed under grammar_v2 and, under PEG, did something far worse than fail: SymbolAlias could not
// take the hyphen, the whole ImportSymbolsDefinition backtracked, and `ImportSource / namespace:
// Identifier` picked up the pieces -- `Ident` is permissive enough to lex `{` itself as an
// identifier. The result was a SILENT MISPARSE into four separate NAMESPACE imports (`{`,
// `starts-with`, `}`, `from`), with no error at all.
//
// Essentially every exported name in the corpus is hyphenated (`starts-with`, `sort-by`,
// `dot-product`), so no real selective import was expressible in this frontend. A frontend
// divergence is a bug, and LL0216 would have been meaningless without this.
SymbolName "symbol name"
  = name:$(Alpha (Alpha / Digit / "-")*) {
    return makeNode("type-name", { name });
  }

ImportSource
  = file:RawString {
    return { source: { file }};
  }
  / namespace:Identifier {
    return { source: { namespace }};
  }


// Type definitions
//
// TypeName does NOT consume trailing whitespace (D9e). It used to, and that single `_` was why the
// PEG could never gate a type SUFFIX: by the time BasicTypes looked for `[]`, the space was already
// gone, so `Expr []` was an array type here and a vector VALUE in grammar_v2. `T?` turns on exactly
// that distinction -- `String?` is optional, `String ?` is a String and then something else -- so it
// had to go. Every call site below re-adds its own `_`; the two that RELIED on the trailing one
// (SimpleType, GenericType) are noted where they changed.
TypeName "type name"
  = name:$(Alpha (Alpha / Digit)*) {
    return makeNode("type-name", { name });
  }

Type "type"
  = type:UnionType {
    return makeNode("type", { type, array: false });
  }
  // `(A | B)[]`, `(A | B)?` -- the suffixes must butt against the `)`, as in grammar_v2.
  / "(" _ type:UnionType _ ")" array:"[]"? optional:"?"? _ {
    return makeNode("type", { ...type, array: !!array, optional: !!optional });
  }

UnionType
  // = types:IntersectionType|1.., "|"| {
  = head:IntersectionType _ tail:(_ "|" _ @IntersectionType)* {
    const types = [head, ...tail];
    if (types.length === 1) {
      return types[0];
    }

    return makeNode("union-type", { types });
  }

IntersectionType
  // = types:IntersectionType|1.., "&"| {
  = head:BasicTypes _ tail:(_ "&" _ @BasicTypes)* {
    const types = [head, ...tail];
    if (types.length === 1) {
      return types[0];
    }

    return makeNode("intersection-type", { types: [head, ...tail] });
  }

BasicTypes
  // `array` then `optional`, in that order and both un-spaced: `T[]?` is an OPTIONAL ARRAY, and an
  // array of optionals is `(T?)[]`. This is the site that fires for a plain `String?`, and it is
  // adjacency-gated for free now that TypeName no longer eats the whitespace before it.
  = _ type:(FunctionType / MapType / GenericType / SimpleType) array:"[]"? optional:"?"? _ {
    return makeNode("", { ...type, array: !!array, optional: !!optional });
  }


// Function types
FunctionType
  = _ async:(AsyncKw __)? _ FunctionKw _ "[" params:Type* "]" _ RightArrowKw _ ret:Type _ {
    return makeNode("function-type", { params, ret });
  }


// Simple types
// NO trailing `_`: BasicTypes' `[]` / `?` suffixes must see whether whitespace intervened.
SimpleType
  = _ name:TypeName {
    return makeNode("simple-type", { name });
  }


// Generic types
// The `_` before `<` is re-added explicitly -- TypeName used to supply it, and `Foo <Int>` parses in
// grammar_v2 (Chevrotain discards whitespace), so tightening it here would be a NEW divergence in the
// other direction. No trailing `_`, for the same reason as SimpleType: `Box<Int>?` must be gateable.
GenericType
  = _ name:TypeName _ "<" generics:Type|1.., ","?| ">" {
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
  = ":" modifier:ModifierName _ args:ModifierArgs? _ {
    return makeNode("modifier", { modifier, args });
  }

ModifierName
  = [a-zA-Z_][a-zA-Z0-9_-]* { return text().toLowerCase(); }

ModifierArgs
  = "[" _ args:Expression|.., ","?| _ "]" _ { return args; }

// Variable definition
//
// The binding target is a NAME or a DESTRUCTURING PATTERN (D16). This rule was `name:Identifier?` --
// so `(let [a b] point)` failed here with LL0005 ("Variable declaration must have a name"), and
// destructuring, which the register records as landed, existed in grammar_v2 ONLY. An undocumented
// frontend divergence, found by a value-semantics gate case that could not pass under the PEG.
//
// VectorPattern / MapPattern already existed for `match`, and already build the `vector-pattern` /
// `map-pattern` nodes that ast.isBindingPattern looks for. They just were not reachable from here.
//
// Pattern-before-Identifier: a `[` or `{` in the NAME slot -- immediately after let/mut and its
// modifiers, before any value -- can only be a destructuring pattern. A vector or map VALUE always
// follows a name (`(let resources [])`), so there is nothing to be ambiguous with.
Variable
  = _ mutable:LetMutMode __ modifiers:Modifier* _ name:(VectorPattern / MapPattern / Identifier)?
    _ type:(LeftArrowKw _ @Type)? _ value:Expression? {
    // `:extern` -- an ambient global, DECLARED and never defined (Sd). Derived from the generic
    // modifier list, exactly as the Function rule below derives its own, because modifiers cannot be
    // fixed tokens: `defmodifier` lets a program mint new ones.
    const extern = !!modifiers.find(x => x.modifier === "extern");
    return makeNode("variable", { name, mutable, extern, modifiers, type, value });
  }

LetMutMode
  = LetKw { return false; }
  / MutKw { return true; }


// Function definition
Function
  = _ FunctionKw __ modifiers:(@Modifier _)*
    _ name:Identifier? _ "[" _ params:FunctionParameter|.. , ","?| _ "]" _ returns:(RightArrowKw _ @Type)?
    _ body:Expression* _
  {
    const extern = !!modifiers.find(x => x.modifier === "extern");
    const async = !!modifiers.find(x => x.modifier === "async");
    return makeNode("function", { name, async, extern, modifiers, params, returns, body });
  }

FunctionParameter
  = _ spread:SpreadKw? _ name:Identifier _ modifiers:(@Modifier _)* _ type:(LeftArrowKw _ @Type)? {
    return makeNode("parameter", { name, modifiers, type, spread: !!spread });
  }


// A declared type PARAMETER: `T`, or `:out T` / `:in T`.
//
// One rule for classes AND interfaces. They used to have two, emitting two different shapes:
// a class parameter was a bare TypeName, an interface parameter was `{name, covariance}` -- and
// grammar_v2 emitted a bare TypeName for both, so the frontends disagreed and every consumer that
// read `generic.name.name` got `undefined`. The variance now rides ON the type-name.
GenericVariance
  = _ ":" variance:("in" / "out") _ {
    return variance;
  }

GenericParam
  = _ variance:(@GenericVariance _)? name:TypeName _ {
    return variance ? { ...name, variance } : name;
  }

// Class
ClassGenerics
  = _ "<" head:GenericParam _ tail:("," _ @GenericParam)* ">" _ {
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
    // NOT makeNode("generic-type", ...): `x` is already a `type-name` node, and makeNode spreads
    // `rest` LAST -- so `{...x}` overwrote `_type` straight back to "type-name" anyway. The node it
    // claimed to build was never built. A type parameter IS a type-name; say so.
    const genericsWithConstraints = (generics ?? []).map(x => {
      const genericConstraints = (constraints ?? [])
        .filter(c => c.where.name === x.name)
        .map(c => c.clause);

      return { ...x, constraints: genericConstraints };
    });

    const _implements = ext.filter(x => x._type === "implements").map(x => { return x });
    const _extends = ext.filter(x => x._type === "extends").map(x => { return x });
    return makeNode("class", { name, modifiers, implements: _implements, extends: _extends, generics: genericsWithConstraints, body });
  }

ClassBodyDefinition
  = Expression


// Enum
Enum
  = _ DefEnumKw __ modifiers:(@Modifier _)* _ name:TypeName? _ body:EnumKey* {
    return makeNode("enum", { name, modifiers, body });
  }

EnumKey
  = EnumKeyValue
  / Comment

EnumKeyValue
  = _ ":" _ key:EnumKeyName _ value:(RightDoubleArrowKw _ @Expression)? _ {
    return makeNode("enum-key", { key, value })
  }

EnumKeyName
  = Identifier
  / String

// Struct
//
// `:implements` / `:extends` are D11. Without them this rule fell straight through to StructBody,
// which is `Expression` -- so `(defstruct Rect :implements Shape ...)` PARSED, and dumped the clause
// into the body as two junk bare identifiers (`:implements` and `Shape`). The interface was simply
// forgotten and the program ran. grammar_v2 refused the same source outright; the LOUD frontend was
// the correct one, and this silent acceptance is what made the divergence dangerous.
Struct
  = _ DefStructKw __ modifiers:(@Modifier _)* _ name:TypeName? _ ext:(Implements / Extends)* _ body:StructBody* {
    const _implements = ext.filter(x => x._type === "implements");
    const _extends = ext.filter(x => x._type === "extends");
    return makeNode("struct", { name, modifiers, implements: _implements, extends: _extends, body });
  }

StructBody
  = Expression


// Typedef
TypeDef
  = _ DefTypeKw __ modifiers:(@Modifier _)* _ name:Identifier? _ type:Type? {
    return makeNode("type-def", { name, type, modifiers });
  }

// Custom modifier definition
// `(defmacro ...)`. D3 rules macros OUT for 1.0 and RESERVES the keyword: it must be a hard
// "not implemented in 0.x" error, never a silent call. Reserving it means PARSING it, so the
// compiler can refuse it BY NAME with a location.
//
// PEG had no rule, so `defmacro` fell through to Identifier and `(defmacro foo ...)` parsed as a CALL
// to an undefined function -- which is how it "compiled with zero errors into syntactically invalid
// JavaScript" (D3's words). Deliberately permissive about what follows: the form is rejected, so
// there is nothing to gain by being strict about the shape of something we will not compile.
Macro
  = _ DefMacroKw __ name:Identifier? _ body:Expression* {
    return makeNode("macro-def", { keyword: "defmacro", name, body });
  }

DefModifier
  = _ DefModifierKw __ name:ModifierName _ params:("[" _ @FunctionParameter|.., ","?| _ "]" _)?
    _ body:Expression* _ {
    return makeNode("modifier-def", { name, params: params || [], body });
  }


// Interface -- same GenericParam as a class, so the two declaration forms agree on one shape.
InterfaceGenerics
  = _ "<" head:GenericParam _ tail:("," _ @GenericParam)* ">" _ {
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
    // `generics: []` rather than null when there are none -- grammar_v2 emits `[]` too, and every
    // consumer tests `node.generics && node.generics.length`.
    return makeNode("interface", {
      name: name?.name ?? null,
      generics: name?.generics ?? [],
      modifiers,
      implements: impl,
      body
    });
  }

InterfaceBody
  = Expression


// The type ARGUMENTS of an `:extends` / `:implements` clause: the `<Animal>` of
// `:implements Producer<Animal>`. Both clauses used to consume a bare TypeName and drop them, so
// `16_covariance.lisp` -- whose every line is `:implements Producer<Animal>` -- lost every type
// argument it had, and use-site variance had nothing to check.
TypeRefGenerics
  = _ "<" generics:Type|1.., ","?| ">" _ {
    return generics;
  }

Implements
  = _ ImplementsModKw _ type:TypeName _ generics:TypeRefGenerics? _ {
    return makeNode("implements", { type, generics: generics ?? [] });
  }

Extends
  = _ ExtendsModKw _ type:TypeName _ generics:TypeRefGenerics? _ {
    return makeNode("extends", { type, generics: generics ?? [] });
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

// Await. `(await (fetch-data 42))`.
//
// PEG had no rule for it at all, so `(await X)` parsed as a CALL to an identifier named `await`
// and emitted `_await(...)` -> ReferenceError. grammar_v2 has had an awaitExpr since D14; this is
// the frontend divergence that gap left behind.
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

// An identifier followed by a SUFFIX CHAIN: `xs[0]`, `xs[0].name`, `m.rows[0][1].v`.
//
// This used to accept only `[...]` suffixes, so the `.name` of `xs[0].name` fell out and was parsed
// as a HEADLESS composite-identifier (`.bar` is a legal form -- 05_matching.lisp pipes with
// `(.apply evt)`). It became a separate argument: `console.log(xs[0], name)`, a ReferenceError at run
// time with no diagnostic at all.
//
// A MEMBER suffix is a computed index with a string key -- `obj.name` and `obj["name"]` are the same
// thing in JavaScript -- so no new AST shape is needed. But `members` records which suffixes were
// written `.name`, because D1 rules `(obj.m)` a CALL and `(obj["m"])` a read, and they emit
// identically: the AST is the only place that distinction can survive.
IndexerSuffix
  = "[" indices:Expression|1.., ","?| "]" {
    return { member: false, values: indices };
  }
  / "." name:Ident {
    return { member: true, values: [ makeNode("string", { value: name }) ] };
  }

Indexer
  = id:Identifier suffixes:IndexerSuffix|1..| {
    return makeNode("indexer", {
      id,
      indices: suffixes.map(s => s.values),
      members: suffixes.map(s => s.member),
    })
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
  // The trailing `_` is explicit now -- TypeName no longer consumes it (D9e).
  = name:SimpleIdentifier _ type:(OfModKw _ @TypeName)? _ {
    return { name, type };
  }

Finally
  = "finally" _ body:Expression {
    return body;
  }


// Control flow statements
When
  = _ WhenKw __ cond:((CondModKw __)? @Expression)?
              _ then:((ThenModKw __)? @Expression*)? {
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
  = _ "(" _ cond:((CondModKw __)? @Expression)?
          _ body:((ThenModKw __)? @Expression)? _ ")" {
    return makeNode("cond-case", { condition: cond, body });
  }


// Loop statements
//
// The `:each` loop variable is a NAME or a DESTRUCTURING PATTERN (D16), same as a `let` binding --
// `(for :each [k v] :from settings.entries ...)`. It was `@Identifier` only, so the pattern form
// existed in grammar_v2 alone.
For
  = _ ForKw __ init:((InitModKw __)? @Expression)?
             _ var_:((EachModKw __)? @(VectorPattern / MapPattern / Identifier))?
             _ cond:((CondModKw __)? @Expression)?
             _ coll:((FromModKw __)? @Expression)?
             _ step:((StepModKw __)? @Expression)?
             _ then:((ThenModKw __)? @Expression)?
          _ elseFor:((ElseModKw __)? @Expression)? {
    if (init?.id?.toLowerCase() === ":each") {
      return makeNode("for-each", { variable: var_, collection: coll, then, else: elseFor });
    } else {
      return makeNode("for", { initial: init, condition: cond, step, then, else: elseFor });
    }
  }

// The body is EVERY expression after the condition, not just the first.
//
// This took a single `@Expression`, so
//
//     (while c (a) (b) (c))
//
// put `(a)` inside the loop and left `(b)` and `(c)` OUTSIDE it -- they ran once, after the loop had
// finished. A silent miscompile, and a divergence from grammar_v2, whose whileExpr has always taken
// MANY. `When` two rules up already does it correctly (`@Expression*`); `While` was simply missed.
//
// Multiple expressions are wrapped in a `list`, exactly as AstBuilder.whileExpr does, so both
// frontends hand codegen the same shape.
While
  = _ WhileKw __ cond:((CondModKw __)? @Expression)?
               _ body:((ThenModKw __)? @Expression*)? {
    const exprs = body ?? [];
    const then = exprs.length === 0
      ? null
      : exprs.length === 1
        ? exprs[0]
        : makeNode("list", { nodes: exprs });
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

// ConstantPattern BEFORE IdentifierPattern (D9). `nil` is a legal identifier character sequence here,
// so IdentifierPattern got it first and `[nil 2]` bound a VARIABLE NAMED `nil` -- which matched
// ANYTHING and shadowed the literal, silently. grammar_v2 had the opposite bug and simply refused to
// parse it. The reorder is safe: a Number cannot start an identifier, a String cannot either, and
// NilKw is boundary-guarded (D9c), so `nilish` is still an identifier.
Pattern
  = AnyPattern
  / FunctionalPattern
  / ListPattern
  / VectorPattern
  / MapPattern
  / TypePattern
  / ConstantPattern
  / IdentifierPattern

AnyPattern
  = "_" _ { return makeNode("any-pattern"); }

FunctionalPattern
  = "(" _ params:Pattern* _ ")" _ RightArrowKw _ ret:Pattern _ {
    return makeNode("functional-pattern", { params, ret });
  }

TypePattern
  = id:Identifier OfModKw type:Type {
    return makeNode("type-pattern", { id, type });
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
  = constant:(String / Number / Nil) {
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


// Nil. `nil`, and `null` as the JS-interop alias. Both are the same value (D9).
Nil
  = _ NilKw _ { return makeNode("null", { keyword: "nil" }); }


// Numbers
Number
  = _ @HexNumber _       // 0x1234ABCD
  / _ @BinNumber _       // 0b01011001
  / _ @OctNumber _       // 0o75632711
  / _ @ComplexNumber _   // 12.1+2i
  / _ @FractionNumber _  // 3/4
  / _ @FloatNumber _     // 123.456
  / _ @IntegerNumber _   // 123

OctNumber
  = "0" match:$[0-7]+ {
    return makeNode("octal-number", { match, value: parseInt(match, 8) });
  }

BinNumber
  = "0b" match:$[0-1]+ {
    return makeNode("binary-number", { match, value: parseInt(match, 2) });
  }

HexNumber
  = "0x" match:$(HexDigit+) {
    return makeNode("hex-number", { match, value: parseInt(match, 16) });
  }

ComplexNumber
  = r:(FloatNumber _ [+-])? _ i:FloatNumber [ij]i {
    const real = !!r ? r[0].value : 0;
    const imaginary = i.value * (!!r && r[2] === "-" ? -1 : 1);
    return makeNode("complex-number", { match: text().trim(), real, imaginary });
  }

FractionNumber
  = a:$([+-]? DigitSequence) "/" b:$DigitSequence {
    return makeNode("fraction-number", { match: text().trim(), numerator: parseInt(a), denominator: parseInt(b) });
  }

FloatNumber
  = match:$([+-]? DigitSequence "." [0-9]*) {
    return makeNode("float-number", { match, value: parseFloat(match) });
  }
  / match:$([+-]? DigitSequence ("." [0-9]+)? ("e" [+-]? [0-9]+)) {
    return makeNode("float-number", { match, value: parseFloat(match) });
  }

IntegerNumber
  = match:$([+-]? DigitSequence) {
    return makeNode("integer-number", { match, value: parseInt(match) });
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
  = _ head:Ident? tail:( "." @Ident )+ {
    const id = !!head ? `${head}.${tail.join(".")}` : tail.join(".");
    return makeNode("composite-identifier", { id, headless: !head, parts: [ head, ...tail ] });
  }

Ident
  = id:$((NonControl / Control) (NonControl / Control / Digit)*) { return id; }


// Comments
Comment
  = _ ';' comment:$ANY* {
    return makeNode("comment", { comment });
  }


ID = $[.,?'"|@:`~;^&*%$#=+!()\[\]/\\\\-_0-9a-zA-Z]+
WS = [ \t]
EOL = [\n\r]
ANY = [^\n]

// Keywords
MatchKw = "match"i
WhileKw = "while"i
ForKw = "for"i
CondKw = "cond"i
IfKw = "if"i
WhenKw = "when"i
FinallyKw = "finally"i
CatchKw = "catch"i
TryKw = "try"i
AsyncKw = "async"i
AwaitKw = "await"i
DefInterfaceKw = "definterface"i
DefClassKw = "defclass"i
DefTypeKw = "deftype"i
DefEnumKw = "defenum"i
DefMacroKw = "defmacro"i
DefStructKw = "defstruct"i
DefModifierKw = "defmodifier"i
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

SpreadKw = "..."i

ImplementsModKw = ":implements"i
ExtendsModKw = ":extends"i
WhereModKw = ":where"i

// Nil. ONE bottom value (D9). `none` / `void` / `undefined` are deleted as spellings; `null` survives
// only as the JS-interop alias.
//
// Case-SENSITIVE now, and boundary-guarded. Both were bugs, and both were live:
//   - `"void"i` meant `Void` -- the TYPE, used across 08-types/ and std/io.lisp -- lexed as a nil
//     KEYWORD in the PEG while grammar_v2 (case-sensitive since D14) read it as an Identifier.
//   - with no trailing guard, `nullable` lexed as `null` + `able`. That is the exact misparse D14
//     fixed in grammar_v2 via `longer_alt`, recorded in diff-frontends.ts, and never fixed here.
//
// The guard is the identifier-CONTINUATION set (Alpha covers `_`, and `-` is legal mid-identifier),
// which is tighter than the `!NonControl` used by TrueKw/FalseKw -- those still admit `true-x`.
NilKw
  = "nil" !(Alpha / Digit / "-")
  / "null" !(Alpha / Digit / "-")

ConstraintKw
  = (
      "implements"i
    / "inherits"i
    / "is"i
    / "has"i
  ) {
    return text().toLowerCase();
  }

IsModKw = ":is"i
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