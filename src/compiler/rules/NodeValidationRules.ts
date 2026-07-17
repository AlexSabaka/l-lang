import * as ast from "../frontend/ast";
import { createRule, RuleSeverity } from "./RuleBuilder";

const IdentifierHasName = createRule<ast.IdentifierNode>()
  .addTypeFilter("simple-identifier", "composite-identifier")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0001")
  .addMessage("Identifier must have a name")
  .addTest((node) => !node.id)
  .build();

const FractionHasZeroDenominator = createRule<ast.FractionNumberNode>()
  .addTypeFilter("fraction-number")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0002")
  .addMessage("Fraction denominator cannot be zero")
  .addTest((node) => node.denominator === 0)
  .build();

const ImportMustHaveSource = createRule<ast.ImportNode>()
  .addTypeFilter("import")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0003")
  .addMessage("Import must have a source")
  .addTest((node) =>
       node.imports.map(x => x.source).filter(ast.isFileImportSource).some(x => !x.file)
    || node.imports.map(x => x.source).filter(ast.isNamespaceImportSource).some(x => !x.namespace))
  .build();

// LL0004 `ImportHasSymbols` was DELETED here (Sc3).
//
//     .addSeverity(Error).addCode("LL0004").addMessage("Import symbol must have a name")
//     .addTest((node) => node.imports.some((x) => !x.symbols))
//
// It was defined, exported from the rules barrel, and never wired into any visitor -- so it had
// never run. Which is fortunate, because it was WRONG in two independent ways:
//
//   1. It encoded a FALSE INVARIANT. A whole-module `(import "x.lisp")` legitimately names no
//      symbols; that is what makes it a whole-module import. The rule declared every one of them an
//      error.
//   2. It was FRONTEND-DIVERGENT. A whole-module import records `symbols: []` under grammar_v2 and
//      no `symbols` key at all under PEG, so `!x.symbols` is `false` in one frontend and `true` in
//      the other. Wired, it would have failed all 21 corpus imports under PEG and passed all 21
//      under grammar_v2.
//
// A rule that has never run is not load-bearing, but it is a claim -- and this one was a claim that
// the language works the opposite of the way it does. Deleted rather than fixed: the invariant it
// wanted does not exist.

const VariableMustHaveName = createRule<ast.VariableNode>()
  .addTypeFilter("variable")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0005")
  .addMessage("Variable declaration must have a name")
  .addTest((node) => !node.name)
  .build();

const ConstantVariableMustHaveInitializer = createRule<ast.VariableNode>()
  .addTypeFilter("variable")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0006")
  .addMessage("Constant variable must have an initializer")
  .addTest((node) => !node.mutable)
  .addTest((node) => !node.value)
  .addTest((node) => !node.modifiers.find((x) => x.modifier === "ctor"))
  // ...nor an EXTERN (Sd). An ambient global -- `mouseX`, `Infinity` -- is a promise about the host,
  // not a definition, so it has nothing to initialise. Without this exemption an extern `let` is
  // unwritable, exactly as LL0013 made an extern `fn` unwritable.
  .addTest((node) => !node.extern)
  .build();

const TryCatchHasEitherCatchOrFinally = createRule<ast.TryCatchNode>()
  .addTypeFilter("try-catch")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0007")
  .addMessage("Try-Catch-Finally statement must have either catch or finally block")
  .addTest((node) => node.catch.length === 0)
  .addTest((node) => !node.finally)
  .build();

const OnlyOneDefaultCatchBlockAllowed = createRule<ast.TryCatchNode>()
  .addTypeFilter("try-catch")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0008")
  .addMessage("Only one default catch block is allowed")
  .addTest((node) => node.catch.length > 0)
  .addTest((node) => node.catch.filter((x) => !x.filter).length > 1)
  .build();

const InvalidInterfaceMembers = createRule<ast.ASTNode>()
  .addInvertedTypeFilter("variable", "function")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0009")
  .addMessage("Invalid interface member")
  .addTest((node) => true)
  .build();

const InterfaceMembersCannotHaveInitializers = createRule<ast.VariableNode>()
  .addTypeFilter("variable")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0010")
  .addMessage("Interface members cannot have initializers")
  .addTest((node) => !!node.value)
  .build();

const InterfaceMembersCannotBeExtern = createRule<ast.FunctionNode>()
  .addTypeFilter("function")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0011")
  .addMessage("Interface members cannot be extern")
  .addTest((node) => node.extern)
  .build();

const InterfaceMembersCannotHaveBodyDeclarations = createRule<ast.FunctionNode>()
  .addTypeFilter("function")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0012")
  .addMessage("Interface members cannot have body declarations")
  .addTest((node) => !!node.body)
  .addTest((node) => node.body.length > 0)
  .build();

const ExternFunctionCannotHaveBody = createRule<ast.FunctionNode>()
  .addTypeFilter("function")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0013")
  .addMessage("Extern function cannot have a body")
  .addTest((node) => node.extern)
  // `.length > 0`, not `!!node.body`. A bodyless `fn` gets `body: []` in BOTH frontends, and `!![]`
  // is TRUE -- so this rule fired on every CORRECTLY written extern and rejected it for having the
  // body it did not have. `:extern` was not merely unwired; its own validation rule forbade the only
  // way to write it, which is why the corpus contains zero uses of a feature both grammars parse.
  //
  // Its sibling LL0012 (InterfaceMembersCannotHaveBodyDeclarations) has always had this line.
  .addTest((node) => node.body.length > 0)
  .build();

const FunctionParameterMustHaveName = createRule<ast.ParameterNode>()
  .addTypeFilter("parameter")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0014")
  .addMessage("Function parameter must have a name")
  .addTest((node) => !node.name)
  .build();

const FunctionAllowedParameterModifiers = createRule<ast.ModifierNode>()
  .addTypeFilter("modifier")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0024")
  .addMessage("Function parameter modifier must be 'in', 'out' or 'ref'")
  .addTest((node) => !["in", "out", "ref"].includes(node.modifier))
  .build();

const ClassMustHaveName = createRule<ast.ClassNode>()
  .addTypeFilter("class")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0025")
  .addMessage("Class declaration must have a name")
  .addTest((node) => !node.name)
  .build();

const IfMustHaveCondition = createRule<ast.IfNode>()
  .addTypeFilter("if")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0026")
  .addMessage("If statement must have a condition")
  .addTest((node) => !node.condition)
  .build();

const IfMustHaveThenClause = createRule<ast.IfNode>()
  .addTypeFilter("if")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0027")
  .addMessage("If statement must have a 'then' clause")
  .addTest((node) => !node.then)
  .build();

const WhenMustHaveCondition = createRule<ast.WhenNode>()
  .addTypeFilter("when")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0026")
  .addMessage("When statement must have a 'condition' clause")
  .addTest((node) => !node.condition)
  .build();

const WhenMustHaveThenClause = createRule<ast.WhenNode>()
  .addTypeFilter("when")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0028")
  .addMessage("When statement must have a 'then' clause")
  .addTest((node) => !node.then || node.then.length === 0)
  .build();

/**
 * `[a ...mid z]` -- a rest that is not the LAST element.
 *
 * D28 rules rest is TRAILING ONLY: "a rest in the middle (`[a ...mid z]`) is a separate, harder
 * feature". `ast.RestPatternNode`'s own doc says "only meaningful as the final element of a vector
 * pattern". The roadmap calls it unbuilt. Three statements of the invariant, and until Qe nothing
 * enforced it -- so a mid-list rest parsed, compiled, and FIRED, binding the rest to `[]` and the
 * tail to an index counted from the wrong end (AF-020).
 *
 * REJECTING is the fix rather than implementing, because the ruling already exists and its sibling
 * shows what it means: anonymous `[a ...]`, named in the same D28 sentence, is genuinely rejected.
 * "Unbuilt" means not-accepted. Building mid-rest would override a decision D28 took on purpose.
 *
 * Keys on POSITION, not on the presence of a rest -- D28's trailing rest is the supported case and
 * must be untouched.
 */
const RestPatternMustBeTrailing = createRule<ast.VectorPatternNode>()
  .addTypeFilter("vector-pattern")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0029")
  .addMessage(
    "A rest pattern must be the LAST element of a vector pattern. A rest in the middle " +
      "(`[a ...mid z]`) is not supported: it would have to count the tail from the right-hand end, " +
      "which is a separate feature (D28). Move the rest to the end, or match the tail explicitly."
  )
  .addTest((node) => {
    const rest = node.elements.findIndex((e) => e._type === "rest-pattern");
    return rest !== -1 && rest !== node.elements.length - 1;
  })
  .build();

const MatchMustHaveCases = createRule<ast.MatchNode>()
  .addTypeFilter("match")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0020")
  .addMessage("Match statement must have at least one case")
  .addTest((node) => node.cases.length === 0)
  .build();

const IdentifierMustHaveName = createRule<ast.IdentifierNode>()
  .addTypeFilter("simple-identifier", "composite-identifier")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0021")
  .addMessage("Identifier must have a name")
  .addTest((node) => !node.id)
  .build();

const OnlyOneVisibilityModifierAllowed = createRule<ast.VariableNode | ast.FunctionNode | ast.ClassNode | ast.InterfaceNode>()
  .addTypeFilter("class", "function", "interface", "variable")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0022")
  .addMessage("Only one visibility modifier is allowed: public | private | protected | internal")
  .addTest((node) =>
    1 < node.modifiers.filter(
      x => x.modifier === "public" ||
      x.modifier === "private" ||
      x.modifier === "protected" ||
      x.modifier === "internal").length)
  .build();

export const Rules = {
  IdentifierHasName,
  FractionHasZeroDenominator,
  ImportMustHaveSource,
  RestPatternMustBeTrailing,
  VariableMustHaveName,
  ConstantVariableMustHaveInitializer,
  TryCatchHasEitherCatchOrFinally,
  OnlyOneDefaultCatchBlockAllowed,
  OnlyOneVisibilityModifierAllowed,
  InvalidInterfaceMembers,
  InterfaceMembersCannotHaveInitializers,
  InterfaceMembersCannotBeExtern,
  InterfaceMembersCannotHaveBodyDeclarations,
  ExternFunctionCannotHaveBody,
  FunctionParameterMustHaveName,
  FunctionAllowedParameterModifiers,
  ClassMustHaveName,
  IfMustHaveCondition,
  IfMustHaveThenClause,
  WhenMustHaveCondition,
  WhenMustHaveThenClause,
  MatchMustHaveCases,
  IdentifierMustHaveName,
} as const;
