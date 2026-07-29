import * as ast from "../../frontend/ast";
import { BaseAstTreeWalker } from "../../BaseAstTreeWalker";
import { checkRules, Rule, Rules as r } from "../../rules";
import { SyntaxDiagnostics as SD } from "../../rules/diagnostics";
import {
  builtinModifiersFor,
  collectDefinedModifiers,
  collectAnnotationDeclarations,
  collectDeclaredAnnotations,
  suggestModifier,
  RESERVED_NATIVE_MODIFIERS,
} from "../../helpers/modifiers";
import { literalValueOf } from "../../helpers/literals";

export class SyntaxRulesAstVisitor extends BaseAstTreeWalker {
  /**
   * Modifier names defined in this module by `(defmodifier name ...)`. Populated in visitProgram,
   * which the tree walker runs before it descends into the children -- see D4 enforcement in
   * visitModifier below.
   */
  private definedModifiers: Set<string> = new Set();

  /** D72: this module's `defmodifier` / `defattribute` names, with role and declared arity. */
  private declaredAnnotations: Map<string, { kind: "decorator" | "attribute"; arity: number }> =
    new Map();

  visitProgram(node: ast.ProgramNode) {
    this.definedModifiers = collectDefinedModifiers(node);
    this.declaredAnnotations = collectDeclaredAnnotations(node);
    this.refinedTypeNames = collectRefinedTypeNames(node);
    this.checkAnnotationCollisions(node);
    return node;
  }

  /**
   * D72/LL0031 -- one `:name`, one meaning.
   *
   * The three roles share a namespace on purpose, so that reading `:tag` at a use site tells you
   * whether it transforms the declaration or merely describes it. Nothing enforced that: two
   * declarations of one name simply collapsed to the last, which silently turned a working decorator
   * into an attribute that wraps nothing. Reported at the SECOND declaration, where the conflict is
   * introduced.
   */
  /**
   * The two ways a USE of a declared `:name` can be wrong (D72). Builtins are neither -- they take no
   * arguments, and the compiler decides for itself where each is legal.
   *
   * A DECORATOR ON A CLASS is deliberately NOT among these, having been tried and withdrawn. The
   * refusal looked obviously right -- a `defmodifier` returning `(fn [original] (fn [...args] …))`
   * hands back a plain arrow, so `new` on the result throws -- but the corpus disproves the
   * generalisation: `Qf/AF-019` pins a PASS-THROUGH decorator, `(fn [original] (console.log …)
   * original)`, which returns the class untouched and works. So a class decorator is wrong only for
   * SOME shapes, and which one a `defmodifier` returns is not decidable in general; a hard error
   * built on a heuristic would break code that runs today. The runtime `TypeError` stands for the
   * wrapping shape, and `defattribute` is the portable answer for annotating a declaration.
   */
  private checkAnnotationUse(node: ast.ModifierNode, name: string, construct: string | undefined) {
    const declared = this.declaredAnnotations.get(name);
    if (!declared) return;
    const args = node.args ?? [];

    // LL0033 -- declared arguments, none supplied. Overwhelmingly a SPACED bracket, which D68-a's
    // adjacency gate stopped silently absorbing; without this the author gets a parse error pointing
    // at whatever the spaced vector collided with instead.
    if (declared.arity > 0 && args.length === 0) {
      this.report(SD.ModifierArgsNotAdjacent, node, { name, arity: declared.arity });
      return;
    }

    // LL0036 -- a DECORATOR is unfolded at compile time (D75), so what it is given must be known
    // then. Two ways that fails, and they are the same failure: the argument is computed, or the
    // decoration itself is inside a function body and so happens afresh on every call.
    if (declared.kind === "decorator") {
      const computed = args.find((a) => literalValueOf(a) === undefined);
      if (computed) {
        this.report(SD.DecoratorArgNotConstant, computed, {
          name,
          why: `an argument is computed rather than a literal`,
        });
        return;
      }
      if (this.insideFunctionBody(node)) {
        this.report(SD.DecoratorArgNotConstant, node, {
          name,
          why: `the decoration is inside a function body, so it happens again on every call`,
        });
        return;
      }
    }

    // LL0032 -- an attribute argument that has to be evaluated. An attribute is data; the metadata
    // table is emitted as data and never runs. A decorator's arguments are deliberately NOT checked:
    // they may be any expression, as they always could, and only the literal ones are reflected.
    if (declared.kind === "attribute" && args.some((a) => literalValueOf(a) === undefined)) {
      this.report(SD.AttributeArgNotLiteral, node, { name });
    }
  }

  /**
   * Is the declaration carrying this modifier nested inside a FUNCTION?
   *
   * A module-level decoration happens once; one inside a function body happens per call, each time
   * needing its own setup state, which is exactly what a compile-time unfold cannot give it.
   */
  private insideFunctionBody(node: ast.ModifierNode): boolean {
    let cur: any = (node as any)._parent;         // the decorated declaration
    cur = cur?._parent;                            // start the walk above it
    for (let i = 0; i < 64 && cur; i++) {
      if (cur._type === "function") return true;
      if (cur._type === "program") return false;
      cur = cur._parent;
    }
    return false;
  }

  private checkAnnotationCollisions(node: ast.ProgramNode) {
    const describe = (k: "decorator" | "attribute") =>
      k === "attribute" ? "an attribute (defattribute)" : "a decorator (defmodifier)";
    const seen = new Map<string, "decorator" | "attribute">();

    for (const d of collectAnnotationDeclarations(node)) {
      const first = seen.get(d.name);
      if (first === undefined) {
        seen.set(d.name, d.kind);
        continue;
      }
      this.report(SD.DuplicateAnnotation, d.node, {
        name: d.name,
        first: describe(first),
        second: describe(d.kind),
      });
    }
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
  /**
   * D71 -- a leading zero names no radix, so it is refused rather than guessed at.
   *
   * Both number kinds that can carry one are checked, against the digits BEFORE any `.` or exponent:
   * `007`, `0_1` and `00.5` all fire; `0`, `0.5`, `0e3` and `0.0` do not. `match` has already had its
   * digit separators stripped by the builder, which is what makes `0_1` fire -- it arrives as `01`,
   * and the leading zero the author wrote is still the leading zero the rule sees.
   *
   * The prefixed radices never reach here: `0x`, `0b` and `0o` lex as their own token kinds, so their
   * leading zero is part of a prefix rather than a digit.
   */
  private checkLeadingZero(node: ast.ASTNode, text: string | undefined) {
    if (!text) return;
    const digits = text.replace(/^[+-]/, "").split(/[.eE]/)[0];
    if (digits.length < 2 || digits[0] !== "0") return;
    const trimmed = digits.replace(/^0+/, "") || "0";
    this.report(SD.LeadingZeroNumber, node, {
      literal: text,
      suggestion: text.replace(digits, trimmed),
    });
  }

  /**
   * D67/LL0035 -- a `r"…"` pattern that survived to here is a NESTED one.
   *
   * `matchCase` rewrites a regex pattern at the match arm, so a top-level one is gone by now. Only a
   * pattern nested inside a vector or map pattern still carries the marker, and there is no subject
   * there to guard on -- the element is being destructured, not tested.
   */
  visitConstantPattern(node: ast.ConstantPatternNode) {
    if ((node as any).regexSugar) this.report(SD.RegexPatternNested, node, {});
    return node;
  }

  visitIntegerNumber(node: ast.IntegerNumberNode) {
    this.checkLeadingZero(node, (node as any).match);
    return node;
  }

  visitFloatNumber(node: ast.FloatNumberNode) {
    this.checkLeadingZero(node, (node as any).match);
    return node;
  }

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
      this.checkAnnotationUse(node, name, construct);
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

  /**
   * The two DOT OPERATORS, both of which bind by adjacency and neither of which `AstBuilder` can
   * report on, because it has no diagnostics channel:
   *
   *   D88/N4 -- a standalone `..`, the span/wildcard, which is not implemented (LL0034);
   *   D93    -- a spaced `...`, which is not a spread (LL0037).
   *
   * A spaced one is deliberately left in the tree as its own element, and has to be reported from
   * the first stage that can report anything. These are the only identifiers this visitor inspects.
   */
  visitSimpleIdentifier(node: ast.SimpleIdentifierNode) {
    checkRules(
      node,
      [
        r.RangeSpanNotImplemented as Rule<ast.ASTNode>,
        r.SpreadMustBeAdjacent as Rule<ast.ASTNode>,
      ],
      this.context
    );
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
