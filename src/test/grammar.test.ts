import fs from "fs";
import peggy from "peggy";

const grammar = fs.readFileSync("./compiler/grammar/l-lang.pegjs", {
  encoding: "utf-8",
});
const parser = peggy.generate(grammar, {
  allowedStartRules: [
    "List",
    "Quote",
    "QuoteContent",
    "QuotedExpression",
    "Vector",
    "Map",
    "KeyValue",
    "Key",
    "Using",
    "UsingSingle",
    "UsingMultiple",
    "ClassUsingDefinition",
    "SymbolUsingDefinition",
    "NamespaceUsingDefinition",
    "TypeName",
    "Type",
    "UnionType",
    "IntersectionType",
    "BasicTypes",
    "FunctionType",
    "SimpleType",
    "GenericType",
    "MapType",
    "KeyDefinition",
    "MappedType",
    "TypeMapping",
    "KeySelector",
    "TypeSelector",
    "Variable",
    "VariableMode",
    "FieldModifier",
    "Function",
    "FunctionModifier",
    "FunctionParameter",
    "ParameterModifier",
    "FunctionCarrying",
    "CarryingOperator",
    "ClassGenerics",
    "ClassName",
    "Class",
    "ClassBodyDefinition",
    "Typedef",
    "InterfaceGenericCovariance",
    "InterfaceGenericTypeName",
    "InterfaceGenerics",
    "InterfaceName",
    "Interface",
    "AccessModifiers",
    "Implements",
    "Extends",
    "GenericTypeConstraints",
    "Where",
    "ImplementsConstraint",
    "InheritsConstraint",
    "IsConstraint",
    "HasConstraint",
    "Await",
    "When",
    "If",
    "Match",
    "MatchCase",
    "Pattern",
    "AnyPattern",
    "ListPattern",
    "VectorPattern",
    "MapPattern",
    "MapPatternPair",
    "IdentifierPattern",
    "ConstantPattern",
    "String",
    "RawString",
    "FormattedString",
    "Format",
    "Char",
    "Number",
    "OctNumber",
    "BinNumber",
    "HexNumber",
    "IntegerNumber",
    "FloatNumber",
    "Identifier",
    "SimpleIdentifier",
    "CompositeIdentifier",
    "Comment",
    "SimpleComment",
    "ControlComment",
  ],
});

describe("l-lang grammar", () => {
  // Helper functions to parse and check the result
  const formatParserResult = (ast: any): any =>
    JSON.parse(
      JSON.stringify(ast, (k, v) => (k === "_location" ? undefined : v))
    );

  const expectParsed = (
    rule: string,
    input: string,
    expectedType: string,
    additionalChecks: any = {}
  ) => {
    const result = parser.parse(input, { startRule: rule, cache: true });
    expect(result._type).toBe(expectedType);
    Object.entries(additionalChecks).forEach(([key, value]) => {
      expect(formatParserResult(result[key])).toEqual(value);
    });
    return result;
  };

  test("List", () => {
    expectParsed("List", "(1 2 3)", "list", {
      nodes: [
        { _type: "integer-number", match: "1", value: 1 },
        { _type: "integer-number", match: "2", value: 2 },
        { _type: "integer-number", match: "3", value: 3 },
      ],
    });
  });
});
