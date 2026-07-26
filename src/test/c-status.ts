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
  // The Tier-0 string shelf: ASCII char classes + integer parsing with its try- twin. Pure l-lang
  // over codepoints, so both backends must agree -- the interesting lines are the four INT64
  // overflow boundaries, where D51's wrap would make a naive parser diverge. The overflow check is
  // division-free on purpose (ledger 15.7: an imported body's Int/Int is real division on C).
  "17-strings/01_parse_and_classes.lisp",
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
  // Greened by the Formattable display rewire: it splices an Int[] into a string (`{squares}`), which
  // C used to comma-join (`1,4,9`) where JS inspects (`[ 1, 4, 9 ]`) -- §5.2 #4. Interp now renders via
  // ll_display_str on both.
  "20-algorithms/03_functional.lisp",
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
  // E1: catching an IMPORTED error class by type across a module boundary. The catch filter now uses
  // `__ll_is_type` (by name, chain-walking) instead of `instanceof <bareName>` -- which was a
  // ReferenceError on JS once the import inliner renamed the class. C single-level already worked.
  "18-error-handling/20_imported_error_catch.lisp",
  // E2: a TWO-LEVEL imported error hierarchy (IndexError -> ValueError -> Error), constructed with
  // structured data, thrown, caught by precise/base/root type. JS was broken (inlined child emitted
  // `extends <bareParent>`); C was broken (`ensureClassRegistered` never registered the imported
  // parent, so the class chain was incomplete). Both fixed.
  "18-error-handling/21_imported_error_tower.lisp",
  // E3: the std/core/errors module itself -- the typed-error tower imported and exercised the way a
  // program uses it (subtype catch, structured fields, one broad :of Error handler). D62.
  "18-error-handling/22_typed_errors.lisp",
  // F1: the typed errors are AMBIENT -- Error is an l-lang class in a second prelude, not a host
  // extern, so this program uses the whole tower with no import.
  "18-error-handling/23_ambient_errors.lisp",
  // Error carries a `cause` field, set via `caused-by`. On C the message-only runtime builtin Error is
  // retired, so C emits the l-lang Error (with cause). Also guards §9.2 on the REAL tower: KeyError
  // inherits the plain `cause` field AND declares its own ctor `key`.
  "18-error-handling/24_error_cause.lisp",
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
  // D68's adjacency gate. Pure grammar, so C is byte-identical to JS. The destructuring half of the
  // fix is in 08 and is NOT pinned: a destructuring declaration has no CIR lowering (ELL0106).
  "10-modifiers/07_modifier_adjacency.lisp",
  // D71 digit separators, and the 2^53 case that makes stripping them a precision requirement
  // rather than a cosmetic one -- C is where the raw-text path is read.
  "00-basics/09_digit_separators.lisp",
  "80-adversarial/digit_separator_precision.lisp",
  // D73: a comptime fold past 2^53 agrees with the runtime and the literal. Pinned on C too --
  // the old vm path was identically wrong on both, so one backend could not have caught it.
  "80-adversarial/comptime_int_precision.lisp",
  // An escape sequence in a MATCH PATTERN decodes like every other string. It did not, silently,
  // so a `match` over escaped characters fell to its catch-all -- which is what a regex engine
  // hits first, since `\` is the character it must be able to match on.
  "80-adversarial/match_escaped_pattern.lisp",
  // D67: the regex engine is l-lang, so both backends run the SAME program -- which is the entire
  // argument for not binding POSIX <regex.h> on one side and JS RegExp on the other.
  "16-stdlib/20_regex.lisp",
  // D68 modifier reflection. One shared metadata entry, so C answers identically. The CUSTOM arm is
  // in 06 and is NOT pinned: applying a `defmodifier` on C is ELL0106, so a decorator cannot be
  // attached there at all, never mind reflected on.
  "07-types/05_modifier_reflection.lisp",
  // D72 attributes. C-pinned deliberately: "an attribute is portable" is the claim the split makes,
  // and this is where it is checked -- including on a CLASS, which a decorator cannot do on either
  // backend.
  "07-types/08_attributes.lisp",
  // D72 attribute reflection -- the half that makes attaching them worth it. C-pinned because
  // "readable on both backends" is the claim; the DECORATOR twin (06) cannot be, since C has no
  // decorator lowering to reflect on.
  "07-types/09_attribute_reflection.lisp",
  // D70 enum RTTI. Also pins that the metadata's member-value rule agrees with the fold both
  // emitters apply -- including an implicit member after an explicit one, which takes its ORDINAL
  // here rather than C#'s previous-plus-one.
  "07-types/07_enum_reflection.lisp",
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
  // §5.2 cluster 2: interpolating a container/object rendered `[object]` / comma-joined vec / `null` on
  // C vs JS's inspect form. The Formattable display rewire routes interpolation through ll_display_str.
  "80-adversarial/interp_container_format.lisp",
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
  // The `Iterable<T>` PARAMETER the line above claims and does not test. Written expecting red (the
  // prediction was `mapType`'s shared class|struct|interface arm giving the slot `{k:"obj"}`, so an
  // array reaching it would need a `c-cast vec -> obj` the emitter cannot write) and came back green:
  // the arm is never reached, because neither the symbol table nor `typeNodeToCType` resolves an
  // erased interface, so `declareParam` falls through to boxed. Right answer, reached by two lookups
  // failing rather than by a decision -- which is exactly why it wants a guard. Phase G4 leans on it:
  // every std/iter/linq terminal takes `coll <- Iterable<T>`, so a generator reaches C through here.
  "80-adversarial/interface_typed_slot.lisp",
  // D16's destructuring `for :each`, which C refused outright (ELL0106 foreach-destructuring) and now
  // lowers: the element is held in a temp and each name reads one slot. Two things it pins beyond
  // "it works" -- the read is BOUNDS-GUARDED, because `ll_index_vec` traps out of range while JS's
  // `let [a,b,c] = [1,2]` leaves `c` nil; and the names are declared beside the element variable
  // rather than in the loop body, because `:else` runs after the loop and may read them.
  "80-adversarial/foreach_destructuring.lisp",
  // Phase G4c -- D58's coroutine state machine. A `:gen` becomes a synthesized frame class (its
  // fields ARE the frame), a step function re-entered through a `switch`/`goto` prologue, and a
  // factory keeping the original name and modifiers. `13-generators/00` is the flagship: an INFINITE
  // `fibs` consumed finitely through `take`, a `filter`/`take-while` chain over it, `zip` pulling a
  // generator and a hand-written struct in lockstep -- byte-identical to the JS golden.
  "13-generators/00_generators_and_iteration.lisp",
  "30-applications/07_line_clear.lisp",
  "80-adversarial/generator_identity.lisp",
  // The state machine's own adversarial guard: two-level loop nesting, a suspend inside an `if`
  // branch over an infinite source, two live instances pulled interleaved (the frame is
  // per-instance), `(return)` ending a sequence, and pulling past exhaustion -- which without
  // PARKING would dispatch back to the last suspend and re-run the tail forever.
  "80-adversarial/generator_state_machine.lisp",
  // D33's METHOD SURFACE -- `(coll.filter p)` as well as `(coll |> (filter p))`. An `:extension` is a
  // FREE FUNCTION, so on a boxed receiver `ll_dyn_method` searched a method table that by
  // construction never holds it and trapped. Both receiver shapes are guarded (a bound name, which
  // the HIR models as `ext-call` and whose resolved `fnName` is now consumed; and a chained
  // expression, which `classifyCall` leaves opaque and which resolves off the receiver's inferred
  // type), plus the precedence control: a type's OWN method still beats a same-named extension.
  "80-adversarial/extension_method_surface.lisp",
  // The BIT OPERATORS (S2). Six floor entries, so six operations implemented twice -- and the two
  // clauses that can diverge pull in opposite directions: 64-bit WRAP is the one JS cannot get for
  // free (a BigInt is unbounded, so the shim must mask with `asIntN(64)`), and MASKED SHIFT COUNTS is
  // the one C cannot get for free (a shift by >= the width is UNDEFINED, C11 6.5.7p3, and the answer
  // would otherwise change with the target CPU). Graded at -O2 as well, which is where a UB
  // disagreement would actually surface.
  "80-adversarial/bit_operators.lisp",
  // ushr -- the LOGICAL right shift (D61's deferred twin, consumer arrived: std/math/random). Zero-fills
  // where shr sign-fills; only visible on a top-bit-set value. `(uint64_t)a >> n` on C, asUintN on JS.
  "80-adversarial/ushr.lisp",
  // §20: an :operator overload with a UNION operand. The method boxes the union param; the call site
  // must box the arg to match. C declared the concrete operand ctype and passed it unboxed (cc error);
  // mkBinop now declares the operator's real (boxed) param, so InsertCoercions boxes the arg.
  "80-adversarial/union_operator.lisp",
  // What a CURSOR is, and that both backends agree (S2b, ledger 14.3). Two JS-only defects made
  // D30's `Iterator<T> :implements Iterable<T>` untrue: the `[Symbol.iterator]` bridge tested the
  // literally-written `:implements` list, so declaring the MORE PRECISE interface got no bridge at
  // all; and `iter` wrapped unconditionally, so a JS cursor had no identity, no dispose and no type
  // where C's `ll_iter` hands back the object itself. Pins identity, the strong form of it (pulling
  // through the returned value advances the original), and the container arm that always agreed.
  "80-adversarial/iterator_identity.lisp",
  // D58's disposal (Phase G5). Two amendments to that ruling are pinned here, both forced by
  // measurement: recognition is DUCK-TYPED (`(x :of SomeInterface)` answers false on both backends,
  // so the type test D58 named does not exist), and what gets disposed is the COLLECTION rather than
  // the cursor (C's `iter` returns the object, JS's returns a fresh wrapper -- disposing the cursor
  // would work on one backend and silently no-op on the other). Line 7 is the load-bearing negative:
  // `dispose` must be TOTAL, or every lazy chain over an ordinary array would die in `take`.
  "80-adversarial/disposal.lisp",
  // `(x :of SomeInterface)` answering at run time. It used to be false ALWAYS, on both backends, even
  // for a `:implements` the checker had verified -- D24 erases interfaces, so the prototype/`:extends`
  // walk both tests perform had nothing to find (ledger §14.1). Conformance is now carried as the
  // transitive closure on the class. Includes the negative half, because a `:of` that failed OPEN
  // would silently widen every `match` type-pattern and every operator overload dispatching on it.
  "80-adversarial/interface_conformance_runtime.lisp",
  // Unblocked by the above: the corpus's only method-surface site, and the last of the three files
  // Phase G4 set out to green.
  "16-stdlib/02_linq_pipeline.lisp",
  // Also unblocked, and found by the ratchet rather than aimed at -- its whole subject is
  // `:extension` dispatch over an interface (`(fn :extension passable [self <- Entity] ...)`), which
  // is exactly the boxed-receiver case that had no path.
  "30-applications/02_interface_conformance.lisp",
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
  // Line-buffered reading. NO new floor entries: stdin is fd 0 and the file floor already read it, so
  // the buffering and splitting are l-lang. Reads a FILE rather than stdin on purpose -- the runner
  // inherits stdio, and `fs.readSync` on a live TTY can raise EAGAIN.
  "80-adversarial/line_reader.lisp",
  // A `while` whose CONDITION contains a call -- refused by the HIR as "(rare)" and broken in the
  // legacy fallback it deferred to. Rotated now; the guard also pins the const-assignment miscompile
  // in the lazy-logical lowering that rotation made reachable.
  "80-adversarial/while_call_condition.lisp",
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
  // Lb -- the OTHER half of reflection: what `(type v)` answers for a value the graph does not
  // describe. Nil, Array, Map and Function are seeded in the shared builder, so neither backend
  // invents a name from its own fallback any more, and C's `ll_type` reads a closure's source name.
  "80-adversarial/reflection_value_type.lisp",
  // Lb, found by the above: C reads a map key that is a JS reserved word; JS mangles it to `_class`
  // and answers nil. C is the correct backend here -- see js-status.ts, where JS is listed red.
  "80-adversarial/reserved_word_map_keys.lisp",
  // Lc -- `std/llang/reflect`, the typed surface over the D54 graph. A library over an existing
  // floor: no backend change, and it runs byte-identically on both from the first commit.
  "16-stdlib/03_reflect.lisp",
  // Ld -- `std/sys/timers`. The time floor (`clock-ns`/`sleep-ns`) plus Clock/Stopwatch/Ticker/
  // Scheduler in l-lang. Deterministic because a `Clock` owns sleeping, so a ManualClock advances
  // when something waits on it -- the whole example is exact except the three real-clock bounds.
  "16-stdlib/04_timers.lisp",
  // std/core/protocols -- Comparable/Hashable/Formattable + the generic `compare`/`hash-of` dispatchers.
  // `compare-to` dispatches on an Any narrowed by `:of`; the djb2 hash uses D61 bit ops, identical on
  // both backends.
  "16-stdlib/05_protocols.lisp",
  // Formattable drives the display path: a type that :implements it renders via its `format` in
  // console.log, interpolation, and nested. The interp arm also aligned C's `{x}` with JS's display
  // (was `[object]` / comma-joined vec / `null`; gap ledger §5.2 #4, §12.3).
  "16-stdlib/06_formattable.lisp",
  // Comparable drives std/seq sort/min/max/min-by/max-by: a user type sorts by its compare-to;
  // primitives keep their `<` order (byte-identical).
  "16-stdlib/07_comparable_sort.lisp",
  // std/test -- assert/assert-eq/assert-ne over `==` (D53), a module-level test registrar + run-tests
  // that prints a summary and makes the exit code the pass/fail bit (std/sys/process).
  "16-stdlib/08_test.lisp",
  // std/debug -- dbg (print-to-stderr + return), inspect (type-tag via reflect), and the
  // unreachable/todo/unimplemented FatalError panics. The [dbg] output goes to stderr, so the stdout
  // golden checks the return-through + inspect + caught panics.
  "16-stdlib/09_debug.lisp",
  // std/sys/path -- a Path value type: `/` join operator (String segments, absolute resets), POSIX
  // accessors (dirname/basename/extension/stem/parent/segments/is-absolute/normalize), and Formattable
  // display + Comparable sort (D63). Pure split-on-'/' string work.
  "16-stdlib/10_path.lisp",
  // std/math/random -- xoshiro256** over SplitMix64, seeded determinism. The reference stream matches
  // the published splitmix64(0)=0xE220A8397B1DCDAF and an independent BigInt reference; byte-identical
  // JS/C via D51 wrap + D61 bit ops (incl. ushr). Guards next/real/int-in/bool/shuffle/choice.
  "16-stdlib/11_random.lisp",
  // std/iter Range (D46/B-0, P3b) -- the `..` operator: inclusive integer ranges, a lazy Iterable<Int>
  // desugared to a `(Range lo hi nil true)` construction. Guards ascending/descending/stepped(.by)/
  // exclusive iteration, permissive `0..2` spacing, and re-iteration (fresh cursor). Int-only v1.
  "16-stdlib/12_range.lisp",
  // `:satisfies` NOMINAL newtypes (D46 amend, P3c-1b) -- a refined deftype is distinct BY NAME (Kelvin
  // != Meter, the units pattern), laid out as its base and widening to it for arithmetic; open-ended
  // bounds `(0 ..)` too. Range CHECKS (rejecting out-of-range values) are the next increment. Guards
  // that valid refined-type programs run byte-identically on both backends.
  "16-stdlib/13_refinement.lisp",
  // The SAD path of the same feature, and the corpus's first `.panic` example: an out-of-range value
  // kills the process on both backends with the same message (JS throws, C fprintf + exit 1). Until
  // this landed, the panic was only ever verified by hand -- the happy path was the only thing graded.
  "80-adversarial/refinement_panic.lisp",
  // P3c-1c-ii closed the other two boundaries a value can enter a refined newtype through. The
  // parameter check is a PROLOGUE (every caller, not just resolvable ones); the return check is
  // placed by the same rule codegen uses for the implicit return, so the `if`-tail case lands on
  // each branch. Both panic identically on the two backends.
  "16-stdlib/14_refinement_boundaries.lisp",
  "80-adversarial/refinement_panic_param.lisp",
  "80-adversarial/refinement_panic_return.lisp",
  // P3c-1c-iii, the last boundary: a `:ctor` field takes its value from a constructor argument, so
  // there is no annotated initializer to wrap. The check rides a synthesized `:ctor` METHOD, which
  // both backends already invoke after the field stores -- so an INHERITED refined field is checked
  // by the class that declared it, via super, with no positional reasoning anywhere.
  "16-stdlib/15_refinement_fields.lisp",
  "80-adversarial/refinement_panic_field.lisp",
  // P3c-2b, the last unguarded write. An assignment TARGET carries no annotation, so its type comes
  // off the type channel after inference -- which is why this check sits at the HIR coercion point
  // and not in the desugar with the binding guards. Local and field targets are distinct emitter
  // paths, so both get a panic guard.
  "16-stdlib/16_refinement_assignment.lisp",
  "80-adversarial/refinement_panic_assign.lisp",
  "80-adversarial/refinement_panic_assign_field.lisp",
  // D46/B-3 `defcast` (P3d-a): a user-defined CONVERSION, keyed by (source, target) rather than by a
  // name, invoked at `(cast<T> x)`. Rewritten into an ordinary named function at parse time, so both
  // backends emit it as the plain call it is. Converting INTO a refined newtype runs that type's
  // range check through the same coercion point every other site uses -- guarded by the panic file.
  "16-stdlib/17_defcast.lisp",
  "80-adversarial/defcast_refined_panic.lisp",
  // P3d-b: the `:implicit` half -- a conversion the compiler applies at let-init, return and
  // assignment with nothing written at the site. Its rules are all refusals (`:explicit` never fires,
  // one hop only, subtype preferred, no refined target), and those are gated in test/type-errors.ts
  // rather than here, because a refusal has no output to compare.
  "16-stdlib/18_defcast_implicit.lisp",
  // Real-based refinements: the bounds are now ENFORCED, not just nominally distinct. A separate
  // floor check (`ll_refine_check_real`) because value and bounds are doubles -- the Int signature
  // would truncate the bound being tested. C prints the value with %g, so the panic message agrees
  // with JS and one .panic file grades both.
  "16-stdlib/19_refinement_real.lisp",
  "80-adversarial/refinement_panic_real.lisp",
  // Lf -- `std/core/types` rewritten onto the reflection floor. It was three JavaScript spellings
  // (Array.isArray / typeof / constructor.name) and therefore JS-only; nothing caught that, because
  // everything under lib/ is `library` -- compiled, never run.
  "80-adversarial/portable_type_predicates.lisp",
  // Lg -- a `:ctor` field inherited through 2+ `:extends` levels was nil on JS; C flattened the
  // whole chain and was right. Fixed in the HIR lowering; this pins the multi-level forwarding.
  "80-adversarial/inherited_ctor_fields.lisp",
  // §9.2 -- the COMPLEMENT of the above: a PLAIN default field interleaved among ctor fields across
  // 2+ levels made C's construction fill slots by raw index and drop a ctor arg (`ll_unbox_int(nil)`
  // trapped). JS was right. Fixed in `buildConstruct` (ctor args map to ctor fields in slot order).
  "80-adversarial/inherited_plain_field_layout.lisp",
  // std/math FOUNDATION (D57). Six modules that depend on nothing but the floor and each other's
  // types: constants, elementary (the libm gaps + integer helpers), and the three algebras --
  // Complex, Rational, Vec2/Vec3/Vec -- plus the symbolic-expression PoC. Every golden is DERIVED
  // from mathematics (a 3-4-5 hypotenuse is 5; (1+i)^8 = 16; gcd 1071 462 = 21), never captured from
  // a run, and transcendental results are rounded to 6dp so node's libm and clang's cannot split the
  // digit. These run byte-identically on both backends. The NUMERICS layer (stats, special, random,
  // fft, integrate) is held back -- its workflow agents died at verify; it lands per-module.
  "40-math/00_constants.lisp",
  "40-math/01_elementary.lisp",
  "40-math/02_complex.lisp",
  "40-math/03_rational.lisp",
  "40-math/04_vector.lisp",
  "40-math/10_symbolic_expr.lisp",
  // std/math NUMERICS, landing per-module as each is verified on both backends.
  //   integrate -- quadrature (trapezoid/Simpson/adaptive) + root-finding (bisect/newton/secant)
  //   over a RealFn interface object (l-lang's `(call f)` does not spread, so the integrand is a
  //   one-method class, not a bare function value). Goldens are exact closed forms with the
  //   trapezoid error PREDICTED from Euler-Maclaurin, so the coarse values are derived not observed.
  "40-math/09_integrate.lisp",
  //   stats -- descriptive stats + OLS regression on the canonical [2 4 4 4 5 5 7 9] set (pop
  //   variance exactly 4), a two-pass variance that survives catastrophic cancellation
  //   ([1e8+4..1e8+16] -> 22.5), and a bottom-up mergesort behind median/percentile/quartiles. The
  //   merge is nested `if`, not `cond`: `cond` in a lowered library module hits an unimplemented
  //   visitCondCase on the JS leaf path (works at top level and on C) -- a real gap tracked in the
  //   ledger. Regression outputs round to 6dp; everything else is byte-identical.
  "40-math/06_stats.lisp",
  //   special -- gamma/lgamma, beta/lbeta, erf/erfc, and factorial/binomial-real for the regime past
  //   int64. Goldens are closed forms: gamma(5)=24, gamma(1/2)=sqrt(pi), B(1/2,1/2)=pi, erf(1)=0.842701,
  //   erf(x)+erfc(x)=1. The Numerical-Recipes erf is ~-3e-8 at 0 (rounds to -0); the example's r6
  //   normalizes the signed zero so erf(0) prints 0. Byte-identical on both backends.
  "40-math/07_special.lisp",
  // ---------------------------------------------------------------------------------------------
  // PENDING PARITY GUARDS -- deliberately NOT listed above (they are soft `not-yet` under C on
  // purpose). Each is a minimal, JS-green guard in examples/80-adversarial/ that isolates one of the
  // §5.2 silent-divergence clusters from docs/inbox/c-backend-gap-ledger.md. They exist so the C fix
  // has a crisp target: when C reaches parity the ratchet turns RED ("newly passing -- add it"),
  // which is the signal to MOVE the corresponding line down into the array above.
  //   (cluster 1 -- print_positional_format -- PROMOTED above; the mechanism worked as designed.)
  //   (cluster 2 -- interp_container_format + 20-algorithms/03_functional -- PROMOTED above; the
  //    Formattable display rewire routed interpolation through ll_display_str/ll_inspect, not ToString.)
  //   (cluster 3 -- reflection_metadata_depth -- PROMOTED above; Fd emits the graph.)
  // Cluster 4 (modifier side effects) is intentionally absent: C REFUSES body-carrying defmodifiers
  // fail-closed, which is already the correct loud signal -- there is no silent-wrong to guard.
];
