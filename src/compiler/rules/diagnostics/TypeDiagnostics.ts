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

  // LL0249 -- `:implements` naming something that is not a reachable interface.
  //
  // THE SIBLING OF LL0209, and the half that was missing. LL0209 asks "is this claim TRUE?"; nothing
  // asked "is there anything here to claim?". `checkDeclaredInterfaces` skipped on
  // `required.length === 0` with the comment `// unresolvable, or genuinely empty` -- two different
  // facts collapsed into one `continue`, so `(defstruct C :implements Bogusable<Int>)` compiled
  // silently, with no diagnostic on either backend.
  //
  // That is not a typo-catcher. `:implements` is only checked when the name RESOLVES, and an
  // interface resolves only if its module is imported -- so a MISSING IMPORT silently turned every
  // conformance guarantee off: LL0209 stopped firing, `:of` transitivity stopped holding, and
  // nominal extension dispatch stopped resolving, all with a green build. Measured on the same file
  // with and without `(import "std/iter")`: `isIterable` false, then true.
  //
  // Which is why this had to land BEFORE any contract moved between modules: relocating an interface
  // and missing one import is otherwise indistinguishable from success.
  UnresolvedInterface: def<{ type: string; iface: string }>(
    "LL0249",
    Error,
    (p) =>
      `'${p.type}' declares ':implements ${p.iface}', but '${p.iface}' does not name an interface ` +
      `that is reachable here. Either it is misspelled, or the module declaring it is not imported ` +
      `-- and an unresolved ':implements' is not checked at all, so the conformance it promises is ` +
      `silently not enforced.`
  ),

  // LL0236 -- `eval` names a feature that does not exist.
  //
  // A dedicated message rather than LL0210's "'eval' is not defined", because the name LOOKS like it
  // should exist: it was in the runtime shim's surface for the whole life of the project, and on JS
  // it compiled to bare `eval(...)` -- the HOST's, evaluating JAVASCRIPT source. An l-lang program
  // asking to evaluate l-lang got a JavaScript evaluator, silently, on one backend only.
  EvalNotImplemented: def<{}>(
    "LL0236",
    Error,
    () =>
      `'eval' is not implemented. It needs a runtime AST interpreter, which the language does not ` +
      `have -- it is a phase of its own, not a stdlib function. It used to compile to the HOST's ` +
      `eval on the JS backend (evaluating JavaScript, not l-lang) and was refused outright on the ` +
      `native one. Use ':comptime' for compile-time evaluation (D3).`
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

  // LL0237 (D58) -- a valueless `(yield)` has no meaning in this protocol.
  //
  // D31 originally said `(yield)` yields nil. D30 says nil MEANS DONE -- it is the whole reason the
  // protocol needs no `{value, done}` pair. Through the `iter`/`next` cursor those are the same
  // value, so a bare `(yield)` does not produce an empty element: it TRUNCATES the sequence, and
  // silently. C# closes this syntactically (`yield return` requires an operand); D58 closes it here.
  GenYieldNoValue: def(
    "LL0237",
    Error,
    () =>
      `'(yield)' needs a value. nil MEANS DONE in the iteration protocol (D30), so a valueless ` +
      `yield does not produce an empty element -- it ends the sequence. Write '(yield x)', or ` +
      `'(return)' to stop.`
  ),

  // LL0238 (D58) -- the deeper form of the same bug as LL0237.
  //
  // A valueless yield is only the syntactic case; `(yield maybe-nil)` truncates just as silently.
  // Since nil means done, a NULLABLE element type is incoherent rather than merely risky -- one rule
  // on the element type closes both, and it rides on D9's existing optional machinery.
  GenNullableElement: def<{ func: string; declared: string }>(
    "LL0238",
    Error,
    (p) =>
      `':gen' function '${p.func}' declares ${p.declared}, but a generator's element type cannot ` +
      `admit nil: nil MEANS DONE in the iteration protocol (D30), so a nil element would end the ` +
      `sequence instead of appearing in it. Drop the '?'.`
  ),

  // LL0239 (D58) -- no suspension inside a protected region, on BOTH backends.
  //
  // Language-wide rather than C-only, deliberately. The native lowering is a state machine, and its
  // C activation RETURNS at every suspend -- so a `setjmp` taken inside the generator names a frame
  // that is gone by the time anything could `longjmp` to it (C11 7.13.2.1: undefined). Supporting it
  // means re-establishing control structure on resume (nested state dispatch inside each protected
  // region, a fresh setjmp per enclosing try per resume -- the Roslyn shape), which is the single
  // biggest multiplier in the feature. JS would get this free from `function*`, but taking it there
  // too keeps ONE rule instead of a mid-feature backend split, and a restriction is liftable while
  // the reverse breaks code. The lift is C#'s: extract finally blocks into methods `dispose` invokes
  // by state, so try/FINALLY becomes legal while try/CATCH stays out.
  //
  // Scoped to `yield` -- NOT to `await`. `:async` has no native lowering to constrain (D60 keeps it
  // C-refused and JS handles it natively), and `14-async/01_async_pipeline` awaits inside a `try`
  // today as a green golden.
  GenYieldInProtected: def<{ region: string }>(
    "LL0239",
    Error,
    (p) =>
      `'yield' cannot appear inside a '${p.region}' (D58). A generator suspends by returning, which ` +
      `destroys the frame an enclosing handler landed in, so the native lowering cannot re-enter it. ` +
      `Move the yield out of the protected region, or drive the resource with a hand-written ` +
      `iterator implementing 'Disposable'.`
  ),

  // LL0242 (D46/B-3) -- an explicit cast with no conversion behind it.
  //
  // `(cast<T> x)` does not COERCE by fiat; it runs a `defcast` the program declared. With none
  // declared for the pair there is nothing to run, and inventing one -- a bit-reinterpretation, a
  // stringification -- is how a cast becomes a lie. RFC-0001 §5.6 refuses narrowing casts for the
  // same reason: the runtime carries no evidence for them.
  NoSuchCast: def<{ source: string; target: string }>(
    "LL0242",
    Error,
    (p) =>
      `no conversion from '${p.source}' to '${p.target}'. '(cast<${p.target}> x)' runs a user-defined ` +
      `conversion; declare one with '(defcast :explicit [v <- ${p.source}] -> ${p.target} …)'. To TEST ` +
      `a type rather than convert, use ':of' -- a narrowing cast is refused on purpose.`
  ),

  // LL0240 (S1c) -- two DIRECTLY imported packages offer the same name.
  //
  // The gate Dove's stdlib roadmap asks for "before the module count doubles", and the warning shot
  // it names was already fired: `Number` defined twice. S1b made resolution deterministic -- a
  // directly-imported declaration now beats a transitively-reached one -- but determinism is not the
  // same as unambiguous. When TWO directly-imported packages each export the name, S1b picks the
  // first root in the forest, and that order is still an accident of processing.
  //
  // WARNING, not Error, and the reason is measured rather than cautious: 25 exported names are
  // already owned by more than one stdlib module. Most are same-PACKAGE re-exports (`math/math`
  // re-exports `math/constants`), which is a package publishing a union of its files and entirely
  // deliberate -- so those are excluded by the cross-package test rather than by lowering severity.
  // What is left (`map`/`filter`/`zip`/`reduce` across `std/iter/linq` and `std/seq`) is real,
  // legal, and something the corpus does on purpose under D33's two conventions. Erroring would
  // break working programs to warn about a hazard.
  //
  // The advice is the fix that always works and never guesses: name the module you meant.
  AmbiguousImport: def<{ name: string; a: string; b: string; chosen: string }>(
    "LL0240",
    Warning,
    (p) =>
      `'${p.name}' is offered by both '${p.a}' and '${p.b}', which this file both imports. ` +
      `Resolution takes '${p.chosen}', and which one that is depends on module processing order -- ` +
      `so a program that reads correctly today can change meaning when an import is added. ` +
      `Import it selectively from the one you mean: (import { ${p.name} } from "..."), or rename ` +
      `with ':as'.`
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

  // LL0218
  TypeOfStringLiteral: def<{ name: string; kind: string }>(
    "LL0218",
    Warning,
    (p) =>
      `'type' reflects a VALUE, and a string literal's type is always String -- so this reports ` +
      `String, not the ${p.kind} '${p.name}'. If you meant to look the ${p.kind} up by name, that is ` +
      `'(type-by-name "${p.name}")'.`
  ),

  // LL0233
  ImmutableAssignment: def<{ name: string; kind: "binding" | "parameter" }>(
    "LL0233",
    Error,
    (p) =>
      `'${p.name}' is immutable and cannot be reassigned. A ${
        p.kind === "parameter" ? "parameter" : "'let' binding"
      } is bound once (D10). ${
        p.kind === "parameter"
          ? `Bind a mutable copy -- '(mut ${p.name}2 ${p.name})' -- and rebind that`
          : `Declare it '(mut ${p.name} ...)' to rebind`
      }. Mutating what it points AT -- '${p.name}.field := ...', '${p.name}[i] := ...' -- ` +
      `stays allowed; this is about the binding itself.`
  ),

  // LL0234
  ExtensionNeedsNominalImplements: def<{ type: string; iface: string; member: string }>(
    "LL0234",
    Error,
    (p) =>
      `'${p.type}' satisfies '${p.iface}' structurally but does not declare ':implements ${p.iface}', ` +
      `so the ':extension ${p.member}' cannot be dispatched -- extension dispatch is nominal (D34), ` +
      `and codegen would emit a call to a method that was never installed. Add ':implements ${p.iface}' ` +
      `to '${p.type}'. (Passing a '${p.type}' where a '${p.iface}' is expected still works structurally.)`
  ),

  // LL0231
  UnknownTypeName: def<{ name: string }>(
    "LL0231",
    Error,
    (p) =>
      `'${p.name}' is not a type. An annotation naming a type that does not exist does not just lose ` +
      `information -- it turns CHECKING OFF for the declaration, because an unknown type is ` +
      `assignable to and from everything. Declare it, import it, or use one of the six primitives ` +
      `(Int, Real, String, Char, Boolean, Void).`
  ),

  // LL0245 -- D88. The name resolved only because a numeric literal elsewhere in the file pulled its
  // module in. Warning, not error: the program works today, and the point is that it works by
  // accident -- deleting the literal breaks a line that never mentioned it.
  SyntaxModuleNameUnimported: def<{ name: string; module: string }>(
    "LL0245",
    Warning,
    (p) =>
      `'${p.name}' resolved only because a numeric literal in this file pulled in '${p.module}'. ` +
      `A literal implies its own import, but a NAME does not -- delete the literal and this line ` +
      `stops compiling. Write '(import "${p.module}")' to say what you are using.`
  ),

  // LL0244 -- a zero divisor the compiler can see (D85). Int only: `(/ 1.0 0.0)` is Infinity by
  // IEEE 754 and legal on both backends, so only the INTEGER operators are wrong at zero.
  DivisionByZeroLiteral: def<{ op: string }>(
    "LL0244",
    Error,
    (p) =>
      `Integer '${p.op}' by a literal zero. At run time this PANICS (D85) -- a zero divisor is a ` +
      `contract the caller broke, not data to recover from -- so a zero written directly in the ` +
      `source is a program that cannot do anything but abort. Reported here instead. ` +
      `(Real division is unaffected: '(/ 1.0 0.0)' is Infinity by IEEE 754.)`
  ),

  // LL0246 -- D89. A matrix's cells must share ONE Ring. Two message variants, one identity: the
  // cells disagree about their type at all, or they agree on a type that is not a Ring. A vector is
  // the general container and may hold a union; a matrix exists for linear algebra, and `*` over
  // mixed or non-algebraic elements means nothing.
  MatrixElementsNotUniform: def<{ found: string; expected: string }>(
    "LL0246",
    Error,
    (p) =>
      `A matrix cell is '${p.found}', but the matrix's other cells are '${p.expected}'. A matrix's ` +
      `elements must share one type (D89) -- a vector '[a b c]' is the container that may hold a ` +
      `union; a matrix is for linear algebra, and there is no '*' across two different types.`
  ),

  MatrixElementNotRing: def<{ element: string }>(
    "LL0246",
    Error,
    (p) =>
      `A matrix of '${p.element}' has no arithmetic: the element type must be a Ring -- closed ` +
      `under '+' and '*' (D89). Int, Real, Rational and Complex are; String is not (it has '+' and ` +
      `no '*'). Use a vector of vectors '[[a b] [c d]]' for a grid of values that is not a matrix.`
  ),

  // LL0247 -- D90. `+`/`-` across two different dimensions. The one class of bug units exist to catch,
  // and the reason a plain `Real` is DIMENSIONLESS rather than "unknown": `(+ metres 2.0)` is the Mars
  // Climate Orbiter shape, and waving it through would leave the feature catching nothing.
  OperandDimensionMismatch: def<{ operator: string; left: string; right: string }>(
    "LL0247",
    Error,
    (p) =>
      `Operator '${p.operator}' needs both operands in the SAME dimension, and these are '${p.left}' ` +
      `and '${p.right}'. Adding two quantities of different kinds has no meaning. Multiply or divide ` +
      `them instead -- '*' and '/' COMPOSE dimensions -- or give the dimensionless side its unit at a ` +
      `declared boundary: a typed binding '(let x <- Meter 2.0)' or a typed parameter both coerce there.`
  ),

  // LL0248 -- D90. A `:satisfies` DIMENSION that does not resolve to a set of base units. Reported at
  // the DECLARATION and in the second pass, so a derived unit may name a type declared later in the
  // file -- resolving at declaration time would make the answer depend on source order.
  DimensionUnresolved: def<{ type: string; reason: string; name: string }>(
    "LL0248",
    Error,
    (p) =>
      p.reason === "cycle"
        ? `The dimension of '${p.type}' is CIRCULAR: normalizing it reaches '${p.name}' again. A ` +
          `derived unit must reduce to base units, and one defined in terms of itself never does.`
        : `The dimension of '${p.type}' names '${p.name}', which is not a unit. A dimension's operands ` +
          `must be units -- '(deftype :unit ${p.name} <- Real)' declares a base one. A plain alias, a ` +
          `merely refined newtype or an undeclared name would make the dimension silently wrong, which ` +
          `is the failure units exist to remove.`
  ),

  // LL0230
  ArrayLazyMember: def<{ member: string }>(
    "LL0230",
    Error,
    (p) =>
      `Array has no member '${p.member}'. It is a lazy sequence operator, and a bare array is not a nominal Iterable, so it cannot dispatch. Use the pipe '(xs |> (${p.member} ...))', or lift the array with 'seq': '((seq xs).${p.member} ...)'.`
  ),
};
