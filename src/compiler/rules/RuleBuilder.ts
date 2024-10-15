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


const tab = "\t    ";
const minimumPaddingLength = 10;
const totalTerminalWidth = process.stdout.isTTY ? process.stdout.columns : 80;

function formatMessage(node: ast.ASTNode, rule: Rule<ast.ASTNode>, context: CompilationContext) {
  const text = context.astProvider.getSource(node._parent?._location ?? node._location);
  const textLength = text.length;
  const startColumn =
    node._location.start.column + (textLength - text.length);
  const startLine = node._location.start.line;
  const atSource = `at ${node._location.source}:${startLine}:${startColumn}`;
  const availableWidth =
    totalTerminalWidth - atSource.length - minimumPaddingLength - tab.length;
  const lines = text.trim().split("\n")
    .filter((x) => x.trim().length > 0)
    .map(
      (x) =>
        tab +
        chalk.italic(
          x.length > availableWidth ? x.slice(0, availableWidth - 3) + "..." : x
        )
    );
  const exceptLastLine = lines.slice(0, -1).join("\n");
  const lastLine = lines.at(-1);
  const paddingLength =
    totalTerminalWidth - atSource.length - (lastLine?.length ?? 0);
  const padding = ".".repeat(
    paddingLength > 0 ? paddingLength : minimumPaddingLength
  );

  return (
    `\n\t${chalk.inverse(`${rule.severity[0].toUpperCase()}${rule.code}`)} ${
      rule.message
    }\n` +
    `${exceptLastLine}${lines.length > 1 ? "\n" : ""}` +
    `${lastLine}${chalk.dim.gray(padding)}${chalk.dim(atSource)}\n`
  );
}


export interface RuleValidationMessage {
  code: string;
  severity: RuleSeverity;
  source: string;
  line: number;
  get message(): string;
}

export class RuleValidationResultsCollection {
  private collection: RuleValidationMessage[] = [];

  public add(node: ast.ASTNode, rule: Rule<ast.ASTNode>, context: CompilationContext): RuleValidationMessage {
    const message = {
      code: rule.code,
      severity: rule.severity,
      source: node._location.source ?? "<unknown>",
      line: node._location.start.line,
      get message() {
        return formatMessage(node, rule, context);
      },
    };
    this.collection.push(message);
    return message;
  }

  public get hasErrors(): boolean {
    return this.collection.some((x) => x.severity === RuleSeverity.Error);
  }

  public get errors(): RuleValidationMessage[] {
    return this.collection.filter((x) => x.severity === RuleSeverity.Error);
  }

  public get warnings(): RuleValidationMessage[] {
    return this.collection.filter((x) => x.severity === RuleSeverity.Warning);
  }

  public get messages(): RuleValidationMessage[] {
    return this.collection.filter((x) => x.severity === RuleSeverity.Message);
  }

  public get all(): RuleValidationMessage[] {
    return this.collection;
  }
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
): RuleValidationMessage[] {
  return rules
    .map((rule) =>
      rule.test(node)
        ? context.results.add(node, rule as Rule<ast.ASTNode>, context)
        : null
    )
    .filter((x) => x !== null); // Filter out null values cleanly
}

export interface NodeTestFunction<T extends ast.ASTNode> {
  (node: T): boolean;
}

export class RuleBuilder<T extends ast.ASTNode> {
  private code: string = "";
  private severity: RuleSeverity = RuleSeverity.None;
  private message: string = "";
  private tests: NodeTestFunction<T>[] = [];
  private filterTypes: T["_type"][] = [];
  private invertFilter: boolean = false;

  addCode(code: string | number): RuleBuilder<T> {
    this.code =
      typeof code === "string" ? code : "LL" + code.toString().padStart(4, "0");
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
    this.tests.push(test);
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
        ? this.applyTests((node) => !this.filterTypes.includes(node._type))
        : this.applyTests((node) => this.filterTypes.includes(node._type))
    );
  }

  private applyTests(filter: NodeTestFunction<T>): NodeTestFunction<T> {
    return (node) => filter(node) && this.tests.every((test) => test(node));
  }

  private makeRule<T extends ast.ASTNode>(test: NodeTestFunction<T>): Rule<T> {
    return {
      message: this.message,
      code: this.code,
      severity: this.severity,
      test,
    };
  }
}
