import * as ast from "../ast";
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
    node.imports.some(
      (x) => !x.source.file && !x.source.namespace
          || x.source.file?.value === ""
    )
  )
  .build();

const ImportHasSymbols = createRule<ast.ImportNode>()
  .addTypeFilter("import")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0004")
  .addMessage("Import symbol must have a name")
  .addTest((node) => node.imports.some((x) => !x.symbols))
  .build();

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
  .addTest((node) => !node.mutable && !node.value)
  .build();

const TryCatchHasEitherCatchOrFinally = createRule<ast.TryCatchNode>()
  .addTypeFilter("try-catch")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0007")
  .addMessage("Try-Catch-Finally statement must have either catch or finally block")
  .addTest((node) => node.catch.length === 0 && !node.finally)
  .build();

const OnlyOneDefaultCatchBlockAllowed = createRule<ast.TryCatchNode>()
  .addTypeFilter("try-catch")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0008")
  .addMessage("Only one default catch block is allowed")
  .addTest((node) =>
    node.catch.length > 0 && node.catch.filter((x) => !x.filter).length > 1
  )
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
  .addTest((node) => !!node.body && node.body.length > 0)
  .build();

const ExternFunctionCannotHaveBody = createRule<ast.FunctionNode>()
  .addTypeFilter("function")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0013")
  .addMessage("Extern function cannot have a body")
  .addTest((node) => node.extern && node.body && node.body.length > 0)
  .build();

const FunctionParameterMustHaveName = createRule<ast.FunctionParameterNode>()
  .addTypeFilter("parameter")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0014")
  .addMessage("Function parameter must have a name")
  .addTest((node) => !node.name)
  .build();

const FunctionAllowedParameterModifiers = createRule<ast.ModifierNode>()
  .addTypeFilter("modifier")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0015")
  .addMessage("Function parameter modifier must be 'in', 'out' or 'ref'")
  .addTest((node) => !["in", "out", "ref"].includes(node.modifier))
  .build();

const ClassMustHaveName = createRule<ast.ClassNode>()
  .addTypeFilter("class")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0016")
  .addMessage("Class declaration must have a name")
  .addTest((node) => !node.name)
  .build();

const IfMustHaveCondition = createRule<ast.IfNode>()
  .addTypeFilter("if")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0017")
  .addMessage("If statement must have a condition")
  .addTest((node) => !node.condition)
  .build();

const IfMustHaveThenClause = createRule<ast.IfNode>()
  .addTypeFilter("if")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0018")
  .addMessage("If statement must have a 'then' clause")
  .addTest((node) => !node.then)
  .build();

const WhenMustHaveCondition = createRule<ast.WhenNode>()
  .addTypeFilter("when")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0017")
  .addMessage("When statement must have a 'condition' clause")
  .addTest((node) => !node.condition)
  .build();

const WhenMustHaveThenClause = createRule<ast.WhenNode>()
  .addTypeFilter("when")
  .addSeverity(RuleSeverity.Error)
  .addCode("LL0019")
  .addMessage("When statement must have a 'then' clause")
  .addTest((node) => !node.then || node.then.length === 0)
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


export const Rules = {
  IdentifierHasName,
  FractionHasZeroDenominator,
  ImportMustHaveSource,
  ImportHasSymbols,
  VariableMustHaveName,
  ConstantVariableMustHaveInitializer,
  TryCatchHasEitherCatchOrFinally,
  OnlyOneDefaultCatchBlockAllowed,
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
