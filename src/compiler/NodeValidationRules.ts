import chalk from "chalk";
import * as ast from "./ast";
import { CompilationContext } from "./CompilationContext";

const tab = "    ";
const totalTerminalWidth = process.stdout.isTTY ? process.stdout.columns : 80;
function formatMessage(
  node: ast.ASTNode,
  rule: Rule<ast.ASTNode>,
  context: CompilationContext
) {
  const text = context.astProvider.getSource(node._location);
  const textLength = text.length;
  const trimmedStartText = text.trimStart();
  const startColumn =node._location.start.column + (textLength - trimmedStartText.length);
  const startLine = node._location.start.line;
  const lines = trimmedStartText
    .trimEnd()
    .split("\n")
    .filter((x) => x.trim().length > 0)
    .map((x) => tab + chalk.underline.italic(x));
  const exceptLastLine = lines.slice(0, -1).join("\n");
  const lastLine = lines.at(-1);
  const atSource = `at ${node._location.source}:${startLine}:${startColumn}`;
  const padding = " ".repeat(
    totalTerminalWidth - atSource.length - (lastLine?.length ?? 0)
  );

  return (
    `${chalk.inverse(`${rule.severity[0].toUpperCase()}${rule.code}`)} ${rule.message}\n` +
    `${exceptLastLine}${lines.length > 1 ? "\n" : ""}` +
    `${lastLine}${chalk.underline.dim.gray(padding)}${chalk.dim.underline(atSource)}\n`
  );
}

export interface Rule<T extends ast.ASTNode> {
  /**
   * The error message to display if the rule is violated.
   */
  message: string;
  /**
   * The error code to display if the rule is violated.
   */
  code: string;
  /**
   * The severity of the rule violation.
   */
  severity: "error" | "warning" | "message";
  /**
   * Tests if the node has a syntax error.
   * @param node The AST node to test
   * @returns true if an error is present, false if no errors
   */
  test: (node: T) => boolean;
}

// Generic function to create rules based on node types
function makeRule<T extends ast.ASTNode>(
  severity: "error" | "warning" | "message",
  code: string,
  message: string,
  test: (node: T) => boolean
): Rule<T> {
  return { message, code, severity, test };
}

// Function to check rules and return error messages
export function checkRules<T extends ast.ASTNode>(
  node: T,
  rules: Rule<T>[],
  context: CompilationContext
): string[] {
  return rules
    .map((rule) =>
      rule.test(node)
        ? formatMessage(node, rule as Rule<ast.ASTNode>, context)
        : null
    )
    .filter((x): x is string => x !== null); // Filter out null values cleanly
}

// Helper to make a rule based on node types
function makeTypeRule<T extends ast.ASTNode>(
  types: T["_type"][],
  severity: "error" | "warning" | "message",
  code: string,
  message: string,
  test: (node: T) => boolean,
  invert: boolean = false
): Rule<T> {
  const filter = invert
    ? (node: T) => !types.includes(node._type)
    : (node: T) => types.includes(node._type);
  return makeRule<T>(
    severity,
    code,
    message,
    (node) => filter(node) && test(node)
  );
}

const identifierHasNameRule = makeTypeRule<ast.IdentifierNode>(
  ["simple-identifier", "composite-identifier"],
  "error",
  "LL0001",
  "Identifier must have a name",
  (node) => !node.id
);

const fractionHasNonZeroDenominator = makeTypeRule<ast.FractionNumberNode>(
  ["fraction-number"],
  "error",
  "LL0002",
  "Fraction denominator cannot be zero",
  (node) => node.denominator === 0
);

const importHasSource = makeTypeRule<ast.ImportNode>(
  ["import"],
  "error",
  "LL0003",
  "Import must have a source",
  (node) =>
    node.imports.some(
      (x) =>
        (!x.source.file && !x.source.namespace) || x.source.file?.value === ""
    )
);

const importHasSymbols = makeTypeRule<ast.ImportNode>(
  ["import"],
  "error",
  "LL0004",
  "Import symbol must have a name",
  (node) => node.imports.some((x) => !x.symbols)
);

const variableHasNameRule = makeTypeRule<ast.VariableNode>(
  ["variable"],
  "error",
  "LL0005",
  "Variable declaration must have a name",
  (node) => !node.name
);

const mutableVariableMustHaveInitializerRule = makeTypeRule<ast.VariableNode>(
  ["variable"],
  "error",
  "LL0006",
  "Non-mutable variable must have an initializer",
  (node) => !node.mutable || !node.value
);

const tryCatchHasEitherCatchOrFinally = makeTypeRule<ast.TryCatchNode>(
  ["try-catch"],
  "error",
  "LL0007",
  "Try-Catch-Finally statement must have either catch or finally block",
  (node) => node.catch.length === 0 || !node.finally
);

const onlyOneDefaultCatchBlockAllowed = makeTypeRule<ast.TryCatchNode>(
  ["try-catch"],
  "error",
  "LL0008",
  "Only one default catch block is allowed",
  (node) =>
    node.catch.length > 0 && node.catch.filter((x) => !x.filter).length > 1
);

const invalidInterfaceMembers = makeTypeRule<ast.ASTNode>(
  ["variable", "function"],
  "error",
  "LL0009",
  "Invalid interface member",
  (node) => true,
  true
);

const interfaceMembersCannotHaveInitializers = makeTypeRule<ast.VariableNode>(
  ["variable"],
  "error",
  "LL0010",
  "Interface members cannot have initializers",
  (node) => !!node.value
);

const interfaceMembersCannotBeExtern = makeTypeRule<ast.FunctionNode>(
  ["function"],
  "error",
  "LL0011",
  "Interface members cannot be extern",
  (node) => node.extern
);

const interfaceMembersCannotHaveBodyDeclarations =
  makeTypeRule<ast.FunctionNode>(
    ["function"],
    "error",
    "LL0012",
    "Interface members cannot have body declarations",
    (node) => !!node.body && node.body.length > 0
  );

const externFunctionCannotHaveBody = makeTypeRule<ast.FunctionNode>(
  ["function"],
  "error",
  "LL0013",
  "Extern function cannot have a body",
  (node) => node.extern && node.body && node.body.length > 0
);

const functionParameterMustHaveNameRule =
  makeTypeRule<ast.FunctionParameterNode>(
    ["parameter"],
    "error",
    "LL0014",
    "Function parameter must have a name",
    (node) => !node.name
  );

const functionParameterAllowedModifiersRule = makeTypeRule<ast.ModifierNode>(
  ["modifier"],
  "error",
  "LL0015",
  "Function parameter modifier must be 'in', 'out' or 'ref'",
  (node) => !["in", "out", "ref"].includes(node.modifier)
);

const classMustHaveNameRule = makeTypeRule<ast.ClassNode>(
  ["class"],
  "error",
  "LL0016",
  "Class declaration must have a name",
  (node) => !node.name
);

const ifMustHaveCondition = makeTypeRule<ast.IfNode>(
  ["if"],
  "error",
  "LL0022",
  "If statement must have a condition",
  (node) => !node.condition
);

const ifMustHaveThenClause = makeTypeRule<ast.IfNode>(
  ["if"],
  "error",
  "LL0018",
  "If statement must have a 'then' clause",
  (node) => !node.then
);

const whenMustHaveCondition = makeTypeRule<ast.WhenNode>(
  ["when"],
  "error",
  "LL0017",
  "When statement must have a 'condition' clause",
  (node) => !node.condition
);

const whenMustHaveThenClause = makeTypeRule<ast.WhenNode>(
  ["when"],
  "error",
  "LL0019",
  "When statement must have a 'then' clause",
  (node) => !node.then || node.then.length === 0
);

const matchMustHaveCases = makeTypeRule<ast.MatchNode>(
  ["match"],
  "error",
  "LL0020",
  "Match statement must have at least one case",
  (node) => node.cases.length === 0
);

const identifierMustHaveName = makeTypeRule<ast.IdentifierNode>(
  ["simple-identifier", "composite-identifier"],
  "error",
  "LL0021",
  "Identifier must have a name",
  (node) => !node.id
);


export const Rules = {
  identifierHasNameRule,
  fractionHasNonZeroDenominator,
  importHasSource,
  importHasSymbols,
  variableHasNameRule,
  mutableVariableMustHaveInitializerRule,
  tryCatchHasEitherCatchOrFinally,
  onlyOneDefaultCatchBlockAllowed,
  invalidInterfaceMembers,
  interfaceMembersCannotHaveInitializers,
  interfaceMembersCannotBeExtern,
  interfaceMembersCannotHaveBodyDeclarations,
  externFunctionCannotHaveBody,
  functionParameterMustHaveNameRule,
  functionParameterAllowedModifiersRule,
  classMustHaveNameRule,
  ifMustHaveCondition,
  ifMustHaveThenClause,
  whenMustHaveCondition,
  whenMustHaveThenClause,
  matchMustHaveCases,
  identifierMustHaveName,
} as const;
