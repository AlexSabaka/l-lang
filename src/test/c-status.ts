/**
 * The C backend's ratchet allowlist.
 *
 * Paths (relative to examples/) that MUST pass under `npm run test:c`. Semantics enforced by the
 * runner's C mode:
 *   - listed and failing        -> red (a regression)
 *   - unlisted and failing      -> `not-yet` (dim; expected -- the backend is phased)
 *   - unlisted and PASSING      -> red, "RATCHET" (add it here; a ratchet without teeth decays)
 *   - refused (LL0105-LL0107)   -> `refused` (informational; the backend said so on purpose)
 *
 * A separate file rather than a manifest field: manifest.ts classifies the corpus
 * backend-independently, while this list is per-backend and churns every phase.
 */
export const C_PASSING: readonly string[] = [
  // Phase A -- core imperative: literals, vars, calls, control flow, loops, strings, print parity.
  "00-basics/00_vars.lisp",
  "00-basics/01_calls.lisp",
  "00-basics/03_optional_and_mutability.lisp",
  "00-basics/04_nil_handling.lisp",
  "00-basics/05_whitespace.lisp",
  "00-basics/06_grouping.lisp",
  "02-control-flow/00_if_else.lisp",
  "02-control-flow/01_when.lisp",
  "02-control-flow/02_flow_if_when.lisp",
  "02-control-flow/03_flow_cond.lisp",
  "02-control-flow/04_flow_control.lisp",
  "03-loops/00_for_loop.lisp",
  // 03-loops/01_for.lisp needs closures + the `call` builtin -- Phase B.
  "03-loops/03_for_each.lisp",
  "03-loops/04_foreach.lisp",
  "03-loops/05_while.lisp",
  "17-strings/00_strings.lisp",
  // Ratcheted in by the first full-corpus run (passed without being targeted):
  "05-data-structures/03_matrices.lisp",
  "07-types/00_primitives.lisp",
  "10-modifiers/00_memoization.lisp", // :comptime folds to constants before codegen
  "11-comptime/00_comptime.lisp",
  "80-adversarial/cond_dangling_else.lisp",
  "80-adversarial/paren_absorption.lisp",
  "80-adversarial/return_in_logical_operand.lisp",
  // Phase B -- functions, closures (env capture + mutable cells), higher-order, pipelines,
  // recursion, type guards, on-demand lowering of imported l-lang bodies.
  "01-functions/00_function_types.lisp",
  "01-functions/01_closures.lisp",
  "01-functions/02_recursion.lisp",
  // 01-functions/03_higher_order_functions.lisp is an xfail (parse failure, form layer).
  "01-functions/04_pipelines.lisp",
  "15-modules/00_main.lisp", // unlocked by on-demand imported-body lowering (a real multi-module program)
  // Phase C -- structs/classes, CP3 value semantics (struct copies, class aliases, recursive-into-
  // struct-fields), operator overloading (top-level + method + unary, devirtualized), maps, index
  // assignment, defmodifier (desugars away).
  "05-data-structures/01_arrays.lisp",
  "06-value-semantics/00_structs.lisp",
  "06-value-semantics/02_value_semantics.lisp",
  "06-value-semantics/03_operators_vector.lisp",
  "06-value-semantics/04_operators_complex.lisp",
  "08-generics/01_interface_basic.lisp",  // generics erase at runtime (D24); the classes/interfaces compile
  "08-generics/02_multiple_generics.lisp",
  "08-generics/03_generic_constraints.lisp",
  "08-generics/04_generic_interface.lisp",
  "10-modifiers/01_basic_modifier.lisp",  // defmodifier desugars before codegen
  "05-data-structures/00_data.lisp",       // maps, dynamic member access
  "20-algorithms/04_mutual_recursion.lisp",
  "20-algorithms/05_memoization.lisp",
  "20-algorithms/06_memoization_manual.lisp", // module-global memo cache + index assignment
  // Phase D -- match binding patterns (A7 decomposition): identifier/type/vector patterns, guards.
  "04-pattern-matching/00_guards.lisp",
  "04-pattern-matching/01_vector_patterns.lisp",
  "80-adversarial/match_arm_bare_if.lisp",
];
