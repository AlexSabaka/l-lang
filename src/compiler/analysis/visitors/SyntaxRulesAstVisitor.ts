import * as ast from "../../frontend/ast";
import { BaseAstTreeWalker } from "../../BaseAstTreeWalker";
import { checkRules, Rule, Rules as r } from "../../rules";
import { SyntaxDiagnostics as SD } from "../../rules/diagnostics";
import {
  builtinModifiersFor,
  collectDefinedModifiers,
  suggestModifier,
  RESERVED_NATIVE_MODIFIERS,
} from "../../helpers/modifiers";

export class SyntaxRulesAstVisitor extends BaseAstTreeWalker {
  /**
   * Modifier names defined in this module by `(defmodifier name ...)`. Populated in visitProgram,
   * which the tree walker runs before it descends into the children -- see D4 enforcement in
   * visitModifier below.
   */
  private definedModifiers: Set<string> = new Set();

  visitProgram(node: ast.ProgramNode) {
    this.definedModifiers = collectDefinedModifiers(node);
    this.refinedTypeNames = collectRefinedTypeNames(node);
    return node;
  }

  /**
   * D3: `defmacro` / `defsyntax` are OUT for 1.0, and the keywords are RESERVED --
   * "a hard 'not implemented in 0.x' error, never a silent call."
   *
   * Never a silent call, and equally never an UNLOCATED one. `DefMacroKw` was lexed by both
   * frontends and consumed by no rule, so `(defmacro foo [x] ...)` gave you either a bewildering
   * parse error about an unexpected `)` (grammar_v2) or -- worse, and exactly what D3 complains of --
   * a parse as a CALL to an undefined function named `defmacro` (PEG). Both frontends now parse the
   * form, purely so that it can be refused here, by name, with a location.
   */
  visitMacroDef(node: ast.MacroDefNode) {
    const name = (node.name as any)?.id;
    this.report(SD.MacroNotImplemented, node, {
      keyword: node.keyword,
      name,
    });
    return node;
  }

  /**
   * D4: an unknown `:modifier` is a hard error, whitelisted per construct, with a did-you-mean.
   *
   * This replaces two blocks that sat commented out here for a long time. They could never have
   * worked: they were written against `FunctionModifierNode` and `AccessModifierNode`, node types
   * that do not exist -- the AST has one `ModifierNode`, and the construct it modifies is its
   * `_parent`. That is presumably why they were switched off rather than fixed.
   *
   * The valid set is per-construct builtins UNION the modifiers this module defines itself.
   * `defmodifier` makes modifiers user-extensible, so a constant whitelist is not merely
   * incomplete -- it is wrong by construction, and would reject `:logged` / `:retry` / `:timed` /
   * `:identity`, i.e. the four `examples/06-modifiers` tests that pass today.
   */
  visitModifier(node: ast.ModifierNode) {
    const name = node.modifier.replace(/^:/, "").toLowerCase();

    // Parameter modifiers keep their own, more specific diagnostic (below); don't double-report.
    const construct = (node._parent as ast.ASTNode | undefined)?._type;
    if (construct === "parameter") return node;

    if ((RESERVED_NATIVE_MODIFIERS as readonly string[]).includes(name)) {
      this.report(SD.ReservedNativeModifier, node, { name });
      return node;
    }

    const builtins = builtinModifiersFor(construct);
    if (builtins.includes(name) || this.definedModifiers.has(name)) {
      return node;
    }

    const valid = [...builtins, ...this.definedModifiers];
    const suggestion = suggestModifier(name, valid);
    const on = construct ? ` on ${construct}` : "";

    this.report(SD.UnknownModifier, node, {
      name,
      on,
      suggestion,
    });

    return node;
  }

  /**
   * Declarations must be parenthesized: `(let x 5)`, never a bare `let x 5`.
   *
   * The parser accepts a bare declaration because `expression` is shared between `program`
   * (top level) and `list` (inside parens) -- a declaration is a legal expression either way.
   * The distinction is visible only on the AST: a parenthesized declaration is wrapped in a
   * `list` node, so its parent is a list. A declaration whose parent is the `program` itself was
   * never parenthesized.
   *
   * This matters because a bare `fn` greedily swallows whatever follows it -- the next top-level
   * form becomes its body -- which is a silent misparse, not a syntax error.
   */
  private requireParens(node: ast.ASTNode, form: string): void {
    if ((node._parent as ast.ASTNode | undefined)?._type === "program") {
      this.report(SD.UnparenthesizedForm, node, { form });
    }
  }

  /** Refined newtype names declared in this module -- see the LL0243 check in `visitFunction`. */
  private refinedTypeNames: Set<string> = new Set();

  visitFunction(node: ast.FunctionNode) {
    // A defcast reaches here as the function the AstBuilder rewrote it into, marked by `castOf`.
    // `requireParens` is skipped for it: the form the author wrote is `(defcast …)`, and reporting
    // "fn must be parenthesized" at it would name a keyword that is not in their source.
    if (node.castOf) {
      const kinds = (node.modifiers ?? [])
        .map((m) => m.modifier)
        .filter((m) => m === "implicit" || m === "explicit");
      if (kinds.length !== 1) {
        this.report(SD.CastNeedsOneKind, node, {
          found: kinds.length === 0 ? "it carries neither" : `it carries both`,
        });
      } else if (kinds[0] === "implicit" && this.refinedTypeNames.has(node.castOf.target)) {
        // The one losslessness rule the compiler can check for itself -- see LL0243.
        this.report(SD.ImplicitCastToRefined, node, { target: node.castOf.target });
      }
      return;
    }
    this.requireParens(node, "fn");
    checkRules(node, [r.ExternFunctionCannotHaveBody], this.context);
  }

  visitFunctionParameter(node: ast.ParameterNode) {
    checkRules(node, [r.FunctionParameterMustHaveName], this.context);
    node.modifiers.forEach((modifier) =>
      checkRules(modifier, [r.FunctionAllowedParameterModifiers], this.context)
    );
  }

  visitInterface(node: ast.InterfaceNode) {
    this.requireParens(node, "definterface");
    const body = node.body.flatMap((x) => (x as ast.ListNode)?.nodes ?? [x]);

    body.forEach((member) =>
      checkRules(
        member,
        [
          r.InvalidInterfaceMembers as Rule<ast.ASTNode>,
          r.InterfaceMembersCannotHaveInitializers as Rule<ast.ASTNode>,
          r.InterfaceMembersCannotBeExtern as Rule<ast.ASTNode>,
          r.InterfaceMembersCannotHaveBodyDeclarations as Rule<ast.ASTNode>,
        ],
        this.context
      )
    );
  }

  visitTryCatch(node: ast.TryCatchNode) {
    checkRules(
      node,
      [r.TryCatchHasEitherCatchOrFinally, r.OnlyOneDefaultCatchBlockAllowed],
      this.context
    );
  }

  visitVariable(node: ast.VariableNode) {
    this.requireParens(node, node.mutable ? "mut" : "let");
    checkRules(
      node,
      [r.VariableMustHaveName, r.ConstantVariableMustHaveInitializer],
      this.context
    );
  }

  visitClass(node: ast.ClassNode) {
    this.requireParens(node, "defclass");
    checkRules(node, [r.ClassMustHaveName], this.context);
  }

  visitStruct(node: ast.StructNode) {
    this.requireParens(node, "defstruct");
    return node;
  }

  visitEnum(node: ast.EnumNode) {
    this.requireParens(node, "defenum");
    return node;
  }

  visitTypeDef(node: ast.TypeDefNode) {
    this.requireParens(node, "deftype");
    return node;
  }

  /**
   * D12: unknown, duplicate, or missing-required `for` clauses are hard errors.
   *
   * Unknown clauses are already impossible -- the parser's clause bag simply has no alternative
   * for `:i` or `:of`, so it errors at parse time naming the clauses it does accept. What survives
   * to here is duplication (`:then` twice) and omission.
   */
  visitFor(node: ast.ForNode) {
    this.checkForClauses(node, node.duplicateClauses, [
      [node.condition, ":cond", "a `for` with no condition would never terminate"],
    ]);
    return node;
  }

  visitForEach(node: ast.ForEachNode) {
    this.checkForClauses(node, node.duplicateClauses, [
      [node.collection, ":from", "a `for :each` has nothing to iterate over without it"],
    ]);
    return node;
  }

  private checkForClauses(
    node: ast.ASTNode,
    duplicates: string[] | undefined,
    required: [unknown, string, string][]
  ): void {
    for (const kind of duplicates ?? []) {
      this.report(SD.DuplicateForClause, node, { kind });
    }

    for (const [slot, name, why] of required) {
      if (slot === null || slot === undefined) {
        this.report(SD.MissingForClause, node, { name, why });
      }
    }
  }

  visitWhen(node: ast.WhenNode) {
    checkRules(
      node,
      [r.WhenMustHaveCondition, r.WhenMustHaveThenClause],
      this.context
    );
  }

  visitIf(node: ast.IfNode) {
    checkRules(
      node,
      [r.IfMustHaveCondition, r.IfMustHaveThenClause],
      this.context
    );
  }

  visitMatch(node: ast.MatchNode) {
    checkRules(node, [r.MatchMustHaveCases], this.context);
  }

  // `visitVectorPattern`, spelled to match BaseAstVisitor's dispatch table ("vector-pattern" ->
  // visitVectorPattern) and NOT invented. A rule wired to a method the table never calls is silently
  // dead -- which is exactly what happened to `visitFunctionParameter` and its LL0014/LL0024 (see
  // AF-008), and a dead rule looks identical to a passing one from outside.
  visitVectorPattern(node: ast.VectorPatternNode) {
    checkRules(node, [r.RestPatternMustBeTrailing], this.context);
  }

  visitIdentifier(node: ast.IdentifierNode) {
    checkRules(node, [r.IdentifierMustHaveName], this.context);
  }

  visitImport(node: ast.ImportNode) {
    checkRules(node, [r.ImportMustHaveSource], this.context);
  }

  visitFractionNumber(node: ast.FractionNumberNode) {
    checkRules(
      node,
      [r.FractionHasZeroDenominator],
      this.context
    );
  }

  visitComment(node: ast.CommentNode) {
    // Optionally, we could check for TODOs or FIXMEs
  }
}

/** `(deftype X <- T :satisfies …)` names declared anywhere in the tree. */
function collectRefinedTypeNames(root: ast.ASTNode): Set<string> {
  const out = new Set<string>();
  const walk = (n: any): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n._type === "type-def" && n.refinement && n.name) out.add(ast.symbolName(n.name));
    for (const k of ast.getNodeIterableKeys(n)) walk((n as any)[k]);
  };
  walk(root);
  return out;
}
