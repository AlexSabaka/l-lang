import { def } from "./Diagnostic";
import { RuleSeverity } from "../RuleBuilder";

const { Error, Warning } = RuleSeverity;

/**
 * The type-stage diagnostics (LL0200-LL0230), migrated out of `InferTypesAstVisitor`.
 *
 * A code may back more than one message VARIANT -- the checker distinguishes cases a single sentence
 * cannot (LL0204 covers a unary and a binary "operator not defined"; LL0202 covers an assignment
 * mismatch and an assign-BACK mismatch) -- so the key is the diagnostic's NAME and the code is a
 * field. Where two sites produced a byte-identical sentence they now share ONE def (PrivateAccess,
 * AssignmentMismatch, OperatorNotDefinedBinary).
 *
 * Params are primitives; the call site pre-formats types via `TypeChecker.formatType`, keeping this a
 * leaf module (see `Diagnostic.ts`).
 */
export const TypeDiagnostics = {
  // LL0200
  VariableAssignMismatch: def<{ value: string; declared: string; variable: string }>(
    "LL0200",
    Error,
    (p) =>
      `Type mismatch: cannot assign ${p.value} to ${p.declared} for variable '${p.variable}'.`
  ),

  // LL0201
  IfConditionNotBoolean: def<{ got: string }>(
    "LL0201",
    Error,
    (p) => `'if' condition must be Boolean, got ${p.got}.`
  ),

  // LL0202 -- assignment mismatch (simple- and compound-assignment sites)
  AssignmentMismatch: def<{ value: string; target: string }>(
    "LL0202",
    Error,
    (p) => `Type mismatch in assignment: cannot assign ${p.value} to ${p.target}.`
  ),

  // LL0202 -- a compound operator produces a type that cannot go back into the target
  AssignBackMismatch: def<{ operator: string; produces: string; target: string }>(
    "LL0202",
    Error,
    (p) =>
      `'${p.operator}' produces ${p.produces}, which cannot be assigned back to ${p.target}.`
  ),

  // LL0203
  ArgumentMismatch: def<{ index: number; func: string; expected: string; got: string }>(
    "LL0203",
    Error,
    (p) => `Argument ${p.index} of '${p.func}': expected ${p.expected}, got ${p.got}.`
  ),

  // LL0204 -- binary "operator not defined" (compound-assignment site + call site)
  OperatorNotDefinedBinary: def<{ operator: string; left: string; right: string }>(
    "LL0204",
    Error,
    (p) => `Operator '${p.operator}' is not defined for ${p.left} and ${p.right}.`
  ),

  // LL0204 -- unary "operator not defined"
  OperatorNotDefinedUnary: def<{ operator: string; operand: string }>(
    "LL0204",
    Error,
    (p) => `Operator '${p.operator}' is not defined for ${p.operand}.`
  ),

  // LL0205
  PossiblyNil: def<{ what: string; type: string }>(
    "LL0205",
    Error,
    (p) =>
      `${p.what} is possibly nil (${p.type}). Check it against nil first, ` +
      `or use a non-optional value.`
  ),

  // LL0206 -- private member/name access from outside its class/module (two sites, identical text)
  PrivateAccess: def<{ name: string; owner: string }>(
    "LL0206",
    Error,
    (p) => `'${p.name}' is private to '${p.owner}' and cannot be accessed from here.`
  ),

  // LL0207
  OperatorMutatesThis: def<{ type: string }>(
    "LL0207",
    Error,
    (p) =>
      `An operator on the value type '${p.type}' may not mutate 'this'. A struct is passed ` +
      `BY VALUE, so the mutation would escape to the caller's struct. Build a new ` +
      `'${p.type}' and return it instead.`
  ),

  // LL0208
  OperatorArity: def<{ operator: string; type: string; arity: number }>(
    "LL0208",
    Error,
    (p) =>
      `The operator '${p.operator}' is declared inside '${p.type}' with ${p.arity} parameters. An ` +
      `operator declared inside a type takes ONE parameter -- 'this' is the left operand -- or ` +
      `NONE for a unary operator. For a two-operand form, declare it at top level: ` +
      `(fn :operator ${p.operator} [a <- ${p.type} b <- ${p.type}] ...).`
  ),

  // LL0209
  InterfaceNotSatisfied: def<{
    type: string;
    iface: string;
    plural: boolean;
    missing: string;
  }>(
    "LL0209",
    Error,
    (p) =>
      `'${p.type}' declares ':implements ${p.iface}' but does not ${
        p.plural ? "define the members" : "define the member"
      } ${p.missing}. Declaring an interface is a PROMISE that callers rely on -- ` +
      `${p.plural ? "define them" : "define it"}, or drop the ':implements ${p.iface}'.`
  ),

  // LL0210
  NotDefined: def<{ name: string }>(
    "LL0210",
    Error,
    (p) => `'${p.name}' is not defined.`
  ),

  // LL0211
  Arity: def<{ func: string; expected: string; plural: boolean; got: number }>(
    "LL0211",
    Error,
    (p) => `'${p.func}' expects ${p.expected} argument${p.plural ? "s" : ""}, got ${p.got}.`
  ),

  // LL0212
  AlreadyDeclared: def<{ name: string }>(
    "LL0212",
    Error,
    (p) => `'${p.name}' is already declared in this scope.`
  ),

  // LL0213
  ReturnMismatch: def<{ func: string; declared: string; got: string }>(
    "LL0213",
    Error,
    (p) => `'${p.func}' declares it returns ${p.declared}, but returns ${p.got}.`
  ),

  // LL0214 -- a covariant (:out) parameter appears where it is consumed
  CovariantInParam: def<{ name: string; method: string }>(
    "LL0214",
    Error,
    (p) =>
      `Covariant type parameter '${p.name}' cannot appear in the parameter position of '${p.method}'. ` +
      `':out' means '${p.name}' is only ever produced; a parameter consumes it.`
  ),

  // LL0214 -- a contravariant (:in) parameter appears where it is produced
  ContravariantInReturn: def<{ name: string; method: string }>(
    "LL0214",
    Error,
    (p) =>
      `Contravariant type parameter '${p.name}' cannot appear in the return position of '${p.method}'. ` +
      `':in' means '${p.name}' is only ever consumed; a return produces it.`
  ),

  // LL0215
  NotExported: def<{ name: string; where: string }>(
    "LL0215",
    Error,
    (p) =>
      `'${p.name}' is defined in '${p.where}' but is not exported. Add it to that module's (export ...) list to make it public.`
  ),

  // LL0216
  NotBound: def<{ name: string; where: string }>(
    "LL0216",
    Error,
    (p) =>
      `'${p.name}' is exported by '${p.where}', but this file's import does not bind it. Add it to the import list: (import { ${p.name} } from ...).`
  ),

  // LL0219
  UsedBeforeDeclared: def<{ name: string }>(
    "LL0219",
    Error,
    (p) =>
      `'${p.name}' is used before it is declared. A value must be declared before it is evaluated. ` +
      `(A function may be referenced ahead of its declaration; a value may not.)`
  ),

  // LL0220
  BlockNotCall: def(
    "LL0220",
    Error,
    () =>
      `This is a BLOCK, not a call: its value is the last form, and the function on the left is ` +
      `discarded. A callee that is not a name must be applied with \`call\` -- ` +
      `write \`(call <fn> <args>)\`. (D25)`
  ),

  // LL0221
  NotIterable: def<{ type: string }>(
    "LL0221",
    Error,
    (p) =>
      `${p.type} is not iterable. ` +
      `A '(for :each ...)' collection must be an array or a type that implements Iterable<T>.`
  ),

  // LL0222
  YieldOutsideGen: def(
    "LL0222",
    Error,
    () =>
      "'yield' is only valid inside a ':gen' function. Declare the function ':gen' to make it a generator."
  ),

  // LL0223
  GenReturnsValue: def(
    "LL0223",
    Error,
    () =>
      "a ':gen' function stops with a valueless '(return)'; it cannot '(return x)'. Produce values with '(yield x)'."
  ),

  // LL0224
  GenReturnType: def<{ func: string; declared: string }>(
    "LL0224",
    Error,
    (p) =>
      `a ':gen' function must return Iterator<T> (or Iterable<T>), but '${p.func}' declares ${p.declared}.`
  ),

  // LL0225
  GenYieldMismatch: def<{ produces: string; yields: string }>(
    "LL0225",
    Error,
    (p) => `this generator produces ${p.produces}, but yields ${p.yields}.`
  ),

  // LL0226 -- a warning: the program still compiles
  GenNeverYields: def<{ func: string }>(
    "LL0226",
    Warning,
    (p) =>
      `':gen' function '${p.func}' never yields -- it produces an empty sequence. Did you forget a '(yield ...)'?`
  ),

  // LL0227
  AwaitOutsideAsync: def(
    "LL0227",
    Error,
    () => "'await' is only valid inside an ':async' function. Declare the function ':async'."
  ),

  // LL0228
  AsyncReturnType: def<{ func: string; declared: string }>(
    "LL0228",
    Error,
    (p) =>
      `an ':async' function must return Task<T> (or Awaitable<T>), but '${p.func}' declares ${p.declared}.`
  ),

  // LL0229
  ExtensionNoReceiver: def(
    "LL0229",
    Error,
    () =>
      "an ':extension' function needs a receiver parameter -- the value it extends. With none it extends nothing and can never be reached as '(x.m ...)'."
  ),

  // LL0230
  ArrayLazyMember: def<{ member: string }>(
    "LL0230",
    Error,
    (p) =>
      `Array has no member '${p.member}'. It is a lazy sequence operator, and a bare array is not a nominal Iterable, so it cannot dispatch. Use the pipe '(xs |> (${p.member} ...))', or lift the array with 'seq': '((seq xs).${p.member} ...)'.`
  ),
};
