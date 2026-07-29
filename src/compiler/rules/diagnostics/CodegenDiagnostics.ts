import { def } from "./Diagnostic";
import { RuleSeverity } from "../RuleBuilder";

const { Error } = RuleSeverity;

/**
 * The JS-backend diagnostics (LL0100-LL0103), migrated out of
 * `JSTransformerAstVisitor.reportCodegenError` (which `JSClassBuilder` also called -- hence it was
 * public). LL0102 backs two message variants (a bad destructuring position; a constructor default
 * before a required parameter), so it is keyed by name with the code as a field.
 */
export const CodegenDiagnostics = {
  // LL0100 -- a construct the JS backend has no generator for
  Unhandled: def<{ type: string; method: string }>(
    "LL0100",
    Error,
    (p) =>
      `Cannot generate JavaScript for '${p.type}': ${p.method} is not implemented in the ` +
      `JS backend. The construct parses, but there is no code generator for it.`
  ),

  // LL0101 -- the backend emitted text that does not parse as JS (a codegen bug)
  InvalidEmittedJs: def<{ at: string; error: string }>(
    "LL0101",
    Error,
    (p) =>
      `The JS backend emitted code that is not valid JavaScript${p.at}. ` +
      `${p.error}. This is a bug in the code generator, not in the source.`
  ),

  // LL0102 -- a non-name in a destructuring binding position
  BindingPositionInvalid: def<{ type: string }>(
    "LL0102",
    Error,
    (p) =>
      `'${p.type}' cannot appear in a binding position. A destructuring binding may ` +
      `only contain names, nested [..] / {..} patterns, '...rest', or '_'.`
  ),

  // LL0102 -- a constructor parameter with a default is followed by a required one
  DefaultBeforeRequired: def<{
    className: string;
    param: string;
    plural: boolean;
    required: string;
  }>(
    "LL0102",
    Error,
    (p) =>
      `Constructor of '${p.className}': parameter ` +
      `'${p.param}' has a default but is followed by ` +
      `required parameter${p.plural ? "s" : ""} ` +
      `${p.required}. The default can never be used -- ` +
      `every parameter after it must still be supplied. Move the defaulted parameters last.`
  ),

  // LL0103 (ReturnInExpressionPosition) was RETIRED with the HIR cut (D45): the HIR lowers every
  // value-position `return` to a real return from the enclosing function, so there is nothing left to
  // refuse. Its def and call sites were the acceptance test, deleted the moment they started working.
  //
  // LL0104 -- a type the RUNTIME cannot test, asked to be tested.
  //
  // `:of` and `:operator` dispatch both compile to `__ll_is_type(v, "<name>")`, so a type with no
  // runtime name has no test. This used to emit `"Any"`, and `__ll_is_type` answered `true` to it --
  // so `(d :of Int | String)` matched a Dog, and an `[a <- Int | String]` operator param matched every
  // argument. It failed OPEN, which is the bug class this compiler spent a year removing.
  //
  // The governing precedent is `functional-pattern`: "a closure does not carry its parameter types at
  // run time, so there is nothing to test against. Left dead." Where the runtime carries no evidence,
  // refuse and say so.
  //
  // Not permanent for every kind: a UNION is decidable (test each member) and is restored in Zd.
  // Tuple/map/record need shape tests. This def marks the boundary of what the runtime can honour
  // TODAY, and shrinks as that grows.
  UntestableType: def<{ type: string; position: string }>(
    "LL0104",
    Error,
    (p) =>
      `'${p.type}' cannot be tested at run time, so it cannot be used ${p.position}. The compiled ` +
      `program has no representation of this type to check a value against. Use a type with a ` +
      `runtime identity -- a primitive, a class, a struct, or a generic base like 'Iterable<T>' ` +
      `(whose arguments are erased).`
  ),

  // LL0108 -- D47 conditions/restarts refused on the JS backend. The exact MIRROR of C-refuses-coroutines
  // (LL0105): a native-feature refusal, so it lives in the JS band (LL0100-04). JS has no resumable
  // exceptions -- signal / restart-case / handle / invoke-restart need a native handler+restart stack
  // (setjmp/longjmp on C) JS cannot express. Severity Error is MANDATORY: `hasErrors` counts only Error,
  // and a Warning would fail OPEN (the silent-wrong outcome D47 warns of -- the placeholder emit
  // "succeeds"). LL0103 is RETIRED and must not be reused; LL0105-07 are the C band; LL0108 is next-free.
  RestartsRefused: def<{ form: string }>(
    "LL0108",
    Error,
    (p) =>
      `'${p.form}' -- the JavaScript backend has no resumable conditions/restarts. ` +
      `signal / restart-case / handle / invoke-restart need a native handler+restart stack ` +
      `(setjmp/longjmp on C) that JS cannot express (D47); the backend refuses. Compile with --language c.`
  ),

  // LL0109 (D94) -- a DECLARATION used as a value, on the JS backend.
  //
  // `asExpression` used to end in a bare `throw new Error(...)`, on the argument that the HIR lowers
  // every value-position control-flow construct, so reaching it was "an internal invariant violation,
  // not a user-reachable state". Measured: it is reachable two ways -- `(let f (fn named [] 1))` and
  // `(let x (defclass C …))` both landed there, and both handed the user a raw Node stack trace out of
  // the compiler. CONTRIBUTING is explicit that a bare throw is a defect regardless of what it was
  // refusing, so the invariant keeps its meaning and gains a location.
  //
  // The named-`fn` half is not refused at all any more -- it emits a FunctionExpression and yields the
  // function, which is what the C reference already did (D94). This code is what is left: a class,
  // struct or enum declaration in a value slot, which C refuses too (ELL0106).
  DeclarationNotAValue: def<{ type: string }>(
    "LL0109",
    Error,
    (p) =>
      `a '${p.type}' declaration cannot be used as a value on the JavaScript backend. ` +
      `Declare it at statement position and refer to it by name. (The C backend refuses this too, ` +
      `as ELL0106.)`
  ),

};
