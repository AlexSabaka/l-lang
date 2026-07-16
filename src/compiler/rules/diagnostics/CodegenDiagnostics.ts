import { def } from "./Diagnostic";
import { RuleSeverity } from "../RuleBuilder";

const { Error } = RuleSeverity;

/**
 * The JS-backend diagnostics (LL0100-LL0102), migrated out of
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
};
