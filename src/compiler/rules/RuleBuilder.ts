import chalk from "chalk";
import * as ast from "../ast";
import { CompilationContext } from "../CompilationContext";

/**
 * The severity of the rule violation.
 */
export enum RuleSeverity {
  /**
   * Rule violation that should be displayed as an error.
   */
  Error = "error",
  /**
   * Rule violation that should be displayed as a warning.
   */
  Warning = "warning",
  /**
   * Rule violation that should be displayed as a message.
   */
  Message = "message",
  /**
   * Rule violation that should be ignored (displayed only in verbose mode).
   */
  None = "none",
}

/**
 * A rule that is used to validate the syntax of the language.
 */
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
  severity: RuleSeverity;
  /**
   * Tests if the node has a syntax error.
   * @param node The AST node to test
   * @returns true if an error is present, false if no errors
   */
  test: (node: T) => boolean;
}

/**
 * Creates a new rule builder.
 * @returns A new rule builder.
 */
export function createRule<T extends ast.ASTNode>(): RuleBuilder<T> {
  return new RuleBuilder<T>();
}

/**
 * Checks if the node violates any of the rules.
 * @param node The AST node to check
 * @param rules The rules to check
 * @param context The compilation context
 * @returns An array of error messages
 */
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

export class RuleBuilder<T extends ast.ASTNode> {
  private code: string = "";
  private severity: RuleSeverity = RuleSeverity.None;
  private message: string = "";
  private test: (node: T) => boolean = (node) => false;
  private filterTypes: T["_type"][] = [];
  private invertFilter: boolean = false;

  addCode(code: string | number): RuleBuilder<T> {
    this.code = typeof code === "string"
      ? code
      : "LL" + code.toString().padStart(4, "0");
    return this;
  }

  addSeverity(severity: RuleSeverity): RuleBuilder<T> {
    this.severity = severity;
    return this;
  }

  addMessage(message: string): RuleBuilder<T> {
    this.message = message;
    return this;
  }

  addTest(test: (node: T) => boolean): RuleBuilder<T> {
    this.test = test;
    return this;
  }

  addTypeFilter(...types: T["_type"][]): RuleBuilder<T> {
    this.filterTypes = types;
    return this;
  }

  addInvertedTypeFilter(...types: T["_type"][]): RuleBuilder<T> {
    this.filterTypes = types;
    this.invertFilter = true;
    return this;
  }

  build(): Rule<T> {
    return this.makeRule<T>(
      this.invertFilter
        ? (node) => !this.filterTypes.includes(node._type) && this.test(node)
        : (node) => this.filterTypes.includes(node._type) && this.test(node)
    );
  }

  private makeRule<T extends ast.ASTNode>(test: (node: T) => boolean): Rule<T> {
    return {
      message: this.message,
      code: this.code,
      severity: this.severity,
      test,
    };
  }
}

const tab = "    ";
const minimumPaddingLength = 10;
const totalTerminalWidth = process.stdout.isTTY ? process.stdout.columns : 80;

function formatMessage(
  node: ast.ASTNode,
  rule: Rule<ast.ASTNode>,
  context: CompilationContext
) {
  const text = context.astProvider.getSource(node._location);
  const textLength = text.length;
  const trimmedStartText = text.trimStart();
  const startColumn =
    node._location.start.column + (textLength - trimmedStartText.length);
  const startLine = node._location.start.line;
  const atSource = `at ${node._location.source}:${startLine}:${startColumn}`;
  const availableWidth = totalTerminalWidth - atSource.length - minimumPaddingLength - tab.length;
  const lines = trimmedStartText
    .trimEnd()
    .split("\n")
    .filter((x) => x.trim().length > 0)
    .map((x) => tab + chalk.italic(x.length > availableWidth ? x.slice(0, availableWidth - 3) + "..." : x));
  const exceptLastLine = lines.slice(0, -1).join("\n");
  const lastLine = lines.at(-1);
  const paddingLength =
    totalTerminalWidth - atSource.length - (lastLine?.length ?? 0);
  const padding = ".".repeat(
    paddingLength > 0 ? paddingLength : minimumPaddingLength
  );

  return (
    `${chalk.inverse(`${rule.severity[0].toUpperCase()}${rule.code}`)} ${
      rule.message
    }\n` +
    `${exceptLastLine}${lines.length > 1 ? "\n" : ""}` +
    `${lastLine}${chalk.dim.gray(padding)}${chalk.dim(atSource)}\n`
  );
}
