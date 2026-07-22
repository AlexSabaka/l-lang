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
  // 03-loops/01_for.lisp COMPILES but loops forever, so it times out rather than failing to build.
  //
  // Two causes, one left. The old note blamed a `fn` in a `for :init` being registered as a TOP-LEVEL
  // C function closing over a hoisted global -- that is FIXED, the nested `fn`s now lower as real
  // closures. And `(call check-j)` used to resolve to the closure VALUE rather than invoking it,
  // which is why it did not even emit ("no cast closure -> bool") -- also fixed.
  //
  // What remains is the CAPTURE MODE. `j` is a `mut` that the nested `inc-j` MUTATES, so D48/Q3 makes
  // it a by-REFERENCE capture (a heap cell). The cell analysis does not promote it inside a
  // `for :init`, so the env gets a copy:
  //     __e->u_j = u_j;                        /* env gets a copy   */
  //     int64_t u_j = __e->u_j; u_j = u_j + 1; /* increments a copy */
  // `j` never advances, `check-j` never goes false. Wants computeCellVars to see a for-init block.
  "03-loops/03_for_each.lisp",
  "03-loops/04_foreach.lisp",
  "03-loops/05_while.lisp",
  "17-strings/00_strings.lisp",
  // Ratcheted in by the first full-corpus run (passed without being targeted):
  "05-data-structures/03_matrices.lisp",
  "07-types/00_primitives.lisp",
  // Promoted from xfail 2026-07-22: its stale reason blamed a checker false-positive that had
  // stopped firing, so the file sat unrun on BOTH backends. It compiles clean and passes here too.
  "07-types/03_type_basics.lisp",
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
  // Promoted by the `call`/closure work. The comment here used to say "an xfail (parse failure, form
  // layer)", which had stopped being true -- it passes on JS and now on C. Two fixes reached it: the
  // identity cast (`closure -> closure` threw `no cast`, an uncaught exception rather than a
  // diagnostic) and the closure-call return convention (`ll_call` yields a boxed `ll_value`, so the
  // node may not claim the closure's declared return ctype).
  "01-functions/03_higher_order_functions.lisp",
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
  // A container-slot store now evaluates its value BEFORE taking the slot address: this one
  // recurses into `fib` on the right-hand side, which grows the memo map and reallocs the storage
  // the left-hand pointer was already aimed at.
  "20-algorithms/09_memoization_intro.lisp",
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
  // `(fn f [...] -> Void ... (return nil))`: D9 makes Void and nil the same bottom value, so a Void
  // function may legally return nil -- C may not, and P2 now drops the value instead of emitting
  // `return ll_nil();` from a `static void`.
  "18-error-handling/02_rpn_error_paths.lisp",
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
  // Rest patterns bind on C now that the pattern SHAPE is modeled once (HMatchTest): the two backends
  // used to disagree -- JS bound the tail slice, C declared the name and left it nil.
  "04-pattern-matching/05_rest_patterns.lisp",
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
  // REST-PARAMETER PACKING (packRestArgs in ResolveHirToCir) + `print`/`prn` off the intrinsic
  // table: C now lowers lib/std/io's ACTUAL body, so `print`'s {N} substitution is the same l-lang
  // source on both backends. §5.2 cluster 1, closed -- and the ratchet is what surfaced the other
  // two, which had been silently mis-printing `{0}` templates for as long as the table shadowed the
  // library.
  "80-adversarial/print_positional_format.lisp",
  "16-stdlib/01_main.lisp",
  "10-modifiers/06_extension_methods.lisp",
  // An imported module-level CONSTANT, read plainly (`PI`) and as a dotted head
  // (`(DIGITS.indexOf c)` inside a lowered imported body -- the shape that was broken).
  "80-adversarial/imported_module_constant.lisp",
  // Two imported modules whose MODULE-PRIVATE names collide (D20 makes them distinct bindings).
  // C has one global namespace, so each (defining module, name) pair now gets its own alias.
  "80-adversarial/module_private_collision/main.lisp",
  // The same collision on the function-as-VALUE path: `(apply-fn label)` never calls `label` by
  // name, so it resolves through `functionValue` and its boxed adapter rather than a direct call.
  "80-adversarial/module_private_fnvalue/main.lisp",
  // `(call f)` on a ZERO-ARG function value. D1 makes a bare `(f)` a read, so this is the only
  // spelling that invokes one -- and the C backend was re-applying the read rule to the core
  // CallNode the desugarer builds precisely to say "this is a call".
  "80-adversarial/call_zero_arg_closure.lisp",
  // The numeric floor's one narrowing door (D51 amendment (b)): floor/ceil/round are Real-valued,
  // `truncate` is the only Real -> Int conversion. Also pins JS `Math.round`'s NEGATIVE ZERO, which
  // C's floor(x+0.5) silently lost -- the guard caught it on its first run.
  "80-adversarial/numeric_floor_narrowing.lisp",
  // Fb -- `write-string`, the i/o SINK: raw bytes, no newline, on both backends. console.log and
  // print are layers over it, and a PARTIAL line is expressible for the first time.
  "80-adversarial/write_string_sink.lisp",
  // Fe (D51) -- the numeric floor's discriminating guards. C is the CONTROL here, and it only became
  // one in this commit: int literals were being round-tripped through an f64 (`String(v)` on a JS
  // number), `-fwrapv` was absent so INT64_MAX+1 was UB, and `ll_is_type` deliberately collapsed
  // Int/Real to mirror a JS limitation. All three are C bugs that predate Fe; the guards found them.
  "80-adversarial/int64_exact.lisp",
  "80-adversarial/int64_wrap.lisp",
  "80-adversarial/int_real_runtime_tag.lisp",
  // Fe -- number->string. `ll_fmt_double` had the shortest-round-trip DIGITS right and everything
  // around them wrong: `%g` chooses fixed-vs-exponential from a precision-derived threshold and pads
  // the exponent, so `0.000001` printed `1e-06` and `1e-7` printed `1e-07`. Rewritten to ECMA-262's
  // Number::toString, which D51 names as the spec.
  "80-adversarial/real_format_thresholds.lisp",
  // Fg -- Int equality is exact at 64 bits. `ll_deep_eq` and `ll_strict_eq` both widened an LL_INT to
  // a double before comparing, so two values differing above 2^53 compared EQUAL and a container
  // search found something that was not there. Reachable only because D51 gave Int a full 64-bit
  // range; Fe's guards pinned how an Int PRINTS and left the comparison path behind.
  "80-adversarial/equals_int64_exact.lisp",
  // Fg -- the map floor (D53): map-get/set/has/delete/keys, insertion-ordered with String keys.
  // C's ll_map is an assoc list appended at `len`, so insertion order is structural and C is the
  // reference here; map_insertion_order is listed in js-status.ts as a known JS gap.
  "80-adversarial/map_floor.lisp",
  "80-adversarial/map_insertion_order.lisp",
  // Fg -- `std/seq`'s functional operations collapse to l-lang, so C gains `sort`/`sort-by`/`flatten`
  // for the first time (they were absent from `ll_dyn_method`'s vec arm and trapped outright) and
  // both backends stop mutating the sequence they were handed. Two conversions that C is strict about
  // and JS silently forgives showed up here: `(/ len 2)` is REAL division, and JS's `slice` truncates
  // a fractional index where `ll_unbox_int` raises.
  "80-adversarial/seq_sort.lisp",
  "80-adversarial/seq_purity.lisp",
  // Fg-4 -- `std/seq`'s `index-of`/`includes` search by STRUCTURAL equality, routed through `==`
  // (already `ll_deep_eq`/`__ll_deep_eq` on both backends), so no `equals` floor entry was needed.
  // `native_search_numeric` is the mirror: C is the REFERENCE there and the gap is JS's, so it is
  // listed in js-status.ts too.
  "80-adversarial/seq_structural_search.lisp",
  "80-adversarial/native_search_numeric.lisp",
  // Ff (D52) -- the codepoint floor. Unlike Fg's containers this one HAD to grow the floor: nothing
  // in the language could ask what a string's third character is, because `.length`/`.charAt` answer
  // in bytes here and in UTF-16 code units on JS. Both backends were wrong -- 6 and 4 respectively
  // for a 3-codepoint string -- so this is a floor both are rebuilt onto, not C catching up.
  "80-adversarial/codepoint_floor.lisp",
  // Ff-2 -- `std/string` is l-lang on those primitives: codepoint measurement and indexing, and
  // ASCII-only case and trim. C was already ASCII-cased (`ll_str_upper` maps a-z and nothing else),
  // so this is JS narrowing to a stated rule rather than C growing to match a host library.
  "80-adversarial/string_codepoints.lisp",
  // Ff-3 -- the NATIVE string members move to codepoints on C: `.length`, `.charAt`, `.slice`,
  // `.indexOf`, `.padStart/End`, `.split ""` and the indexer `s[i]` all counted BYTES, which matches
  // neither JS nor D52. A codepoint count agrees with JS below U+10000 and with D52 always, so bytes
  // were strictly the worst of the three. The astral file is C-reference / JS-gap; see js-status.ts.
  "80-adversarial/native_string_codepoints.lisp",
  "80-adversarial/native_string_astral.lisp",
  // Ff-4 -- `format-args` scans codepoints. Ff-3 had made C's `.charAt` a walk, so the old scanner
  // became O(n^2) for every `print`; and it left `.length`/`.charAt` -- the one place the backends
  // still disagree -- in the middle of the language's most-used function.
  "80-adversarial/format_codepoints.lisp",
  // The formatter (D55) -- the four divergences Fc left unguarded: the ident-like key test (C
  // allowed $ and rejected -, JS the reverse; both now transcribe the tokenizer's Identifier
  // pattern), the class tag missing from C's width budget, C's 256-slot cycle set silently
  // capping, and JS reading __ll_name off the instance and printing the MANGLED name.
  // F.1 -- the checker consults the floor for SIMPLE names, not only dotted ones. 25 of 48 entries
  // contributed no types at all, so `(/ (codepoint-length s) 2)` typed Real: 2.5 here against 2 on
  // JS, where BigInt division truncated by accident. D49d decides division from the STATIC types.
  // F.3/F.5 -- the total accessors are total, and keys are not coerced. `head`/`tail` on a
  // non-vector used to TRAP and kill the process here (`(head (get m "missing"))` reaches it from
  // ordinary nil-propagating code); `(get v "1")` answered 20 on JS by host key stringification.
  "80-adversarial/container_accessors.lisp",
  "80-adversarial/floor_simple_name_types.lisp",
  // D50's boundary: a native member is the HOST's operation, not a floor op, so the host decides what
  // it MEANS -- `.slice` is shallow and its slots alias, where an l-lang collection store copies (D11).
  // C agreeing is the non-obvious half: `ll_dyn_method`'s vec arm is our code imitating a surface that
  // does not exist below it, and could as easily have copied.
  "80-adversarial/native_member_boundary.lisp",
  // An interpolation is an EXPRESSION: the checker's `formatted-string` case returned String without
  // descending, so no `{...}` segment was inferred and none was checked. Untyped nodes then made
  // `(/ 7 2)` REAL division inside a string and integer division outside it -- on BOTH backends, the
  // one class of bug cross-backend grading can never find.
  "80-adversarial/interp_is_an_expression.lisp",
  // `:as` on both sides of the boundary. The C half needed three fixes the JS half did not:
  // `ensureClassRegistered` short-circuited on the SPELLED name while registering under the
  // DEFINITION's, so an aliased class lowered again on every reference; the class list was emitted
  // from `values()`, writing one descriptor out twice; and the spelled alias reached the emitter as
  // `__ll_class_Gadget`, a name no declaration produces.
  "80-adversarial/import_export_aliases/main.lisp",
  // `call` -- D1's escape hatch -- reaching the native backend. Two fixes, neither about `call`: the
  // identity cast (`closure -> closure` threw, an uncaught exception rather than a diagnostic) and a
  // closure call claiming the closure's DECLARED return ctype where `ll_call` yields a boxed value.
  "80-adversarial/call_nullary_c.lisp",
  // The PROCESS floor (argv / environment) and `std/sys/process` over it. The offset is the point:
  // node's argv leads with the interpreter and the script, C's with the program name, and both drop
  // their own prefix so index 0 means the same argument on either backend.
  "80-adversarial/sys_process/main.lisp",
  // The native-member surface, after the checker's table and C's became ONE table. Seven members the
  // checker declared and C refused; three of them C could already do DYNAMICALLY, so typing the
  // receiver had been LOSING capability.
  "80-adversarial/native_member_surface.lisp",
  // D30's iteration protocol reaching C at all. `iter`/`next` were JS-only and on no floor, so
  // `for :each` here special-cased vec/str and the emitter wrote `ll_vec*` over everything else --
  // a String and a hand-written Iterable each CRASHED the emitter, and an `Iterable<T>` parameter
  // compiled clean and trapped on data.
  "80-adversarial/iteration_protocol.lisp",
  // `deep-copy` on the floor, and told apart from D11's STORE copy -- pointing it at `ll_copy` would
  // have shared a vector's elements here and copied them on JS.
  "80-adversarial/deep_copy_floor.lisp",
  // The FILE floor and `std/io/files` over it. The handle is an INT fd on both backends -- what both
  // hosts already hand out -- and the chunked-read lines pin the UTF-8 boundary extension, without
  // which a chunked read corrupts one codepoint per boundary on any non-ASCII file.
  "80-adversarial/file_io_floor.lisp",
  // `Writer`/`Reader`: one interface over a file and a standard stream. Also the proof that
  // INTERFACE-TYPED dispatch works here -- the ledger's "witness-table case, deferred" row cites an
  // example whose real blocker is an EXTENSION method on a class receiver, a different thing.
  "80-adversarial/stream_interfaces/main.lisp",
  // The formatter trio (F.6/F.7/F.8) -- all three are the same shape: JS read HOST reflection
  // (String.length, Object.keys, Function.name) where C read l-lang's own metadata.
  "80-adversarial/display_source_names/main.lisp",
  "80-adversarial/display_lambda_name.lisp",
  "80-adversarial/display_conformance.lisp",
  "80-adversarial/display_imported_class_tag/main.lisp",
  // Fd -- the reflection metadata GRAPH is emitted into the C module from the shared builder both
  // backends read (D54), so `type`/`type-by-name` answer with real properties, methods, constructor
  // params, generics and interfaces instead of a {name, extends} stub. Closes §5.2 cluster 3.
  "07-types/01_type_reflection.lisp",
  "08-generics/00_generics_basic.lisp",
  "09-oop/01_interfaces.lisp",
  "80-adversarial/reflection_metadata_depth.lisp",
  // ---------------------------------------------------------------------------------------------
  // PENDING PARITY GUARDS -- deliberately NOT listed above (they are soft `not-yet` under C on
  // purpose). Each is a minimal, JS-green guard in examples/80-adversarial/ that isolates one of the
  // §5.2 silent-divergence clusters from docs/inbox/c-backend-gap-ledger.md. They exist so the C fix
  // has a crisp target: when C reaches parity the ratchet turns RED ("newly passing -- add it"),
  // which is the signal to MOVE the corresponding line down into the array above.
  //   (cluster 1 -- print_positional_format -- PROMOTED above; the mechanism worked as designed.)
  //   80-adversarial/interp_container_format.lisp    -- cluster 2: container interpolation depth
  //                                                    (EmitCirToC routes interp through ToString, not ll_inspect_sb)
  //   (cluster 3 -- reflection_metadata_depth -- PROMOTED above; Fd emits the graph.)
  // Cluster 4 (modifier side effects) is intentionally absent: C REFUSES body-carrying defmodifiers
  // fail-closed, which is already the correct loud signal -- there is no silent-wrong to guard.
];
