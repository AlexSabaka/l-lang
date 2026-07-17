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

  // LL0103 -- a `return` the backend cannot honour from where it stands (D40).
  //
  // The RULE (D40) is that `return` returns from the enclosing FUNCTION, from any code path, with no
  // positional caveats. This is not that rule being narrowed: it is the JS BACKEND admitting it
  // cannot express the rule here yet, and saying so instead of quietly doing something else.
  //
  // A form that emits STATEMENTS (a `cond` clause, an `if` or `when` in statement position) already
  // honours D40 -- the `return` is a real JS `return`. A form that emits an IIFE (`match`, always; an
  // `if` in value position; a `||`/`&&` operand) makes the `return` return from the ARROW, so the
  // function it names keeps running. That silent swallow is what this refuses.
  //
  // Honouring D40 everywhere needs statement hoisting -- `(let x (if c (return 1) 2))` becoming
  // `let x; if (c) { return 1; } else { x = 2; }` -- which is ANF conversion and belongs in a real
  // lowering path (AST -> HIR -> ESTree), not bolted onto an emitter that has no notion of a block.
  // When that lands, this def and its call sites are DELETED and the refused cases start working;
  // they are HIR's acceptance test.
  ReturnInExpressionPosition: def<{ form: string }>(
    "LL0103",
    Error,
    (p) =>
      `'return' cannot be used inside ${p.form}, which compiles to an expression: the 'return' ` +
      `would exit only that expression, not the enclosing function. This is a limitation of the JS ` +
      `backend, not the language -- 'return' returns from the function (D40), and a lowering path ` +
      `that can express it is planned. For now, restructure so the 'return' sits in statement ` +
      `position: a 'cond' clause, or an 'if'/'when' that is not being used as a value.`
  ),
};
