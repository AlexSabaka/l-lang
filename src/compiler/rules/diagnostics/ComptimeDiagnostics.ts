import { def } from "./Diagnostic";
import { RuleSeverity } from "../RuleBuilder";

const { Error } = RuleSeverity;

/**
 * The compile-time-evaluation diagnostics (LL0099), migrated out of
 * `ComptimeEvaluationAstVisitor.reportUnfoldable` -- which was the one reporter that bypassed
 * `createRule` and pushed a raw object literal at `results.add`. Three message variants share LL0099,
 * so the registry keys on name.
 */
export const ComptimeDiagnostics = {
  // LL0099 -- a :comptime variable that could not be evaluated
  ComptimeVariable: def<{ name: string; error: string }>(
    "LL0099",
    Error,
    (p) => `Cannot evaluate comptime variable '${p.name}' at compile time: ${p.error}`
  ),

  // LL0099 -- a :comptime call given a non-literal argument
  ComptimeArgNotLiteral: def<{ name: string; type: string }>(
    "LL0099",
    Error,
    (p) =>
      `Cannot evaluate '${p.name}' at compile time: argument is a '${p.type}', ` +
      `not a compile-time constant. A ':comptime' function can only be called with literals ` +
      `-- that is what asking for compile-time evaluation means.`
  ),

  // LL0099 -- a :comptime call that failed to evaluate
  ComptimeEval: def<{ name: string; error: string }>(
    "LL0099",
    Error,
    (p) => `Cannot evaluate '${p.name}' at compile time: ${p.error}`
  ),
};
