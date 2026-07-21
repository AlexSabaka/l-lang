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
  // 03-loops/01_for.lisp COMPILES since the `for :else` scope fix, but loops forever, so it times out
  // rather than failing to build. Cause is Phase B, not emission: a `fn` declared inside a `for :init`
  // is registered as a TOP-LEVEL C function (resolveAstStmt only asks `inFunctionBody`, and a for-init
  // at module level is not "in a function"), so it closes over a HOISTED GLOBAL `j` while the loop
  // body reads the same-named block local -- two storages, and the step never moves the one the
  // condition reads. Wants nested `fn` declarations lowered as closures.
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
  "06-value-semantics/05_interface_binding_copies.lisp",
  "06-value-semantics/06_interface_param_copies.lisp",
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
  "09-oop/00_inheritance.lisp",   // :extends field/method flattening + type/type-by-name reflection
  "07-types/02_runtime_type_info.lisp", // unlocked by type/type-by-name reflection
  "18-error-handling/00_errors.lisp",   // try/catch/throw via setjmp/longjmp + :of filter chain
  // Phase-0 finally-drop fix: `finally` runs on EVERY exit from a try (return / return-in-catch /
  // rethrow-propagation / nested), and a `return`-in-try restores ll_handler_top. Inline-finalizer
  // routing in EmitCirToC (no runtime rework). See examples' headers + DECISIONS D12/D47.
  "18-error-handling/03_finally_on_early_exit.lisp",
  "18-error-handling/04_finally_on_rethrow.lisp",
  "18-error-handling/05_finally_return_in_catch.lisp",
  "18-error-handling/06_nested_finally_return.lisp",
  "18-error-handling/07_return_in_try_then_outer_throw.lisp",
  // Cr-0 refactor safety net (all behavior-preserving, green on Phase-0): nested catch+finally rethrow,
  // finally return/throw superseding an in-flight throw, and the mutable-scalar setjmp-clobber pin
  // (11 -- now volatile-qualified, and fenced at every -O level by `npm run test:c:o2`).
  "18-error-handling/08_nested_catch_finally_rethrow.lisp",
  "18-error-handling/09_finally_return_supersedes_throw.lisp",
  "18-error-handling/10_finally_throw_supersedes.lisp",
  "18-error-handling/11_try_assign_finally.lisp",
  // Phase Cr-1a -- D47 restart-case + invoke-restart (the restart mechanism) on the native path;
  // JS refuses (LL0108). Includes the finally-runs-on-restart-transfer composition (Cr-0 + Cr-1a).
  "19-conditions/00_restart_value_substitution.lisp",
  "19-conditions/01_restart_crosses_finally.lisp",
  "19-conditions/02_return_in_restart_body.lisp",
  // Phase Cr-1b -- D47 handle + signal (the condition/handler mechanism): ll_signal's in-place walk
  // with the re-arm pad, lifted (void*,ll_value) clause handlers sharing one env, decline/re-entry/
  // cell semantics, and the full finally-during-signal->restart composition. Completes the Cr arc.
  "19-conditions/03_handle_signal_recover.lisp",
  "19-conditions/04_signal_no_handler_nil.lisp",
  "19-conditions/05_handler_declines_to_outer.lisp",
  "19-conditions/06_finally_runs_on_signal_transfer.lisp",
  "19-conditions/07_reentry_guard_inert_frame.lisp",
  "19-conditions/08_clause_reads_capture.lisp",
  // D47 conformance sweep -- adversarial compositions of the two mechanisms against each other and
  // against try/catch/finally, loops, recursion and D11 value semantics. Each pins one rule: signal
  // never consults CATCH frames (09), a restart unwind runs CLEANUPs but skips CATCHes (10), a handler
  // throws from the SIGNAL's context (11), frame-pop discipline on `return` (12) and on normal function
  // exit (19), :extends matching + decline-to-the-next-clause (13), a restart outside the handle (14),
  // a handle nested inside a handler (15), recovery on every loop iteration (16), depth (17),
  // signalling from inside a finally (18), and a value-copy across the raw jump (20).
  "19-conditions/09_signal_never_fires_catch.lisp",
  "19-conditions/10_restart_skips_catch_runs_finally.lisp",
  "19-conditions/11_handler_throws_from_signal_point.lisp",
  "19-conditions/12_return_out_of_handle_pops_frame.lisp",
  "19-conditions/13_clause_order_and_decline_chain.lisp",
  "19-conditions/14_restart_outside_the_handle.lisp",
  "19-conditions/15_nested_handle_inside_handler.lisp",
  "19-conditions/16_loop_recovers_every_iteration.lisp",
  "19-conditions/17_deep_recursion_restart.lisp",
  "19-conditions/18_signal_from_inside_finally.lisp",
  "19-conditions/19_handle_frame_dies_with_its_function.lisp",
  "19-conditions/20_struct_copy_survives_transfer.lisp",
  // cc-failure sweep -- examples where the backend emitted C that would not BUILD. A field-less class
  // (an interface-only hierarchy) emitted its field table as a `const char**` variable and then named
  // it in the descriptor's static initializer, which is not a constant expression.
  "08-generics/05_covariance.lisp",
  // A hoisted module global is file-scope storage: never a heap cell, never captured into a closure
  // env, and its DECLARED ctype wins at every reference site (store, receiver, and member-read head).
  "30-applications/05_snake_tick.lisp",
  // A `member` callee is a METHOD CALL: the pipeline `(x |> (.m a))` shape reached the generic
  // computed-callee path, which resolved the member as a VALUE and applied the args to its result.
  "04-pattern-matching/02_map_patterns.lisp",
  // An imported `let`/`mut` used as a value now hoists to a C global initialized at the top of main
  // (the value analog of on-demand imported-function/class lowering). 06_multiple_interfaces was an
  // EXAMPLE bug: a method written `(fn toJson [] Any` without the `->`, so the return type parsed as
  // a body statement -- harmless on JS only because the method is never called.
  "08-generics/06_multiple_interfaces.lisp",
  "15-modules/01_main.lisp",
  "20-algorithms/01_evaluator.lisp",    // unlocked by match binding patterns
  // Phase E broad sweep -- field mutation on boxed receivers (dyn-field store).
  "30-applications/04_flood_fill.lisp", // (c.mine := v) on an array-element struct -> ll_member_slot
  // Phase E broad sweep -- enums: members fold to compile-time constants, match arms are equality tests.
  "05-data-structures/04_enums.lisp",
  // Phase E broad sweep -- :extension methods devirtualized to free calls on the receiver (Q4 static case).
  "30-applications/01_vec2_operators.lisp",
  // Phase E broad sweep -- enum match + str.trimEnd native (tetromino spin states + board rendering).
  "30-applications/06_tetromino_rotation.lisp",
  // Cross-module class registration -- imported classes (std/math Vector3/Complex) registered +
  // methods lowered on demand, with the implicit-return desugar the symbol-table AST lacked.
  "16-stdlib/complex_math_test/main.lisp",
  "30-applications/08_vector_toolkit.lisp",
  // Non-ctor field defaults + `:ctor` initializer methods (derived fields computed at construction).
  "09-oop/02_classes.lisp",
  // Generic construction: ANF-hoisted class-name temp resolved back + Void method stays boxed.
  "30-applications/00_generic_inventory.lisp",
  // Dynamic method dispatch on statically-unknown receivers (runtime vtable/witness) + higher-order
  // vec methods (reduce/map/filter/forEach) that drive a closure per element.
  "15-modules/02_packages/main.lisp",
  "20-algorithms/07_tokenizer.lisp",
  "20-algorithms/08_state_machine.lisp",
];
