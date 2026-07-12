/**
 * Every .lisp under examples/ must be accounted for here or by having a matching .expect --
 * an undeclared file with no golden is a hard error in the runner, not a silent skip.
 *
 * - 'library' / 'fixture': never executed as a standalone test, no .expect required.
 *   'library' = imported by another example. 'fixture' = not verifiable this way at all
 *   (needs a non-node runtime, or isn't a feature demonstration in the first place).
 * - 'xfail': a real feature example with no golden yet. `reason` cites the D-number
 *   (docs/spec/DECISIONS.md) it's blocked on where applicable, or states plainly that it's
 *   just not authored yet. Deliberately not golden-tested now: authoring goldens against
 *   current, soon-to-change, occasionally-buggy output freezes bugs into "expected" --
 *   the exact mistake this manifest exists to stop repeating.
 * - 'test': redundant for a file that already has a matching .expect (that's the default),
 *   but declaring it explicitly forces a hard error if the golden ever goes missing.
 */

export type ExampleStatus = "test" | "library" | "fixture" | "xfail";

export interface ManifestEntry {
  status: ExampleStatus;
  reason?: string;
}

// Keyed by path relative to examples/.
export const MANIFEST: Record<string, ManifestEntry> = {
  // --- library: imported by other examples, never run standalone ---
  "20-stdlib/complex_math_test/math_utils.lisp": { status: "library" },
  "20-stdlib/std/enumerable.lisp": { status: "library" },
  "20-stdlib/std/functional.lisp": { status: "library" },
  "20-stdlib/std/io.lisp": { status: "library" },
  "20-stdlib/std/math.lisp": { status: "library" },
  "20-stdlib/std/strings.lisp": { status: "library" },
  "20-stdlib/std/types.lisp": { status: "library" },
  "99-p5js/p5-bindings.lisp": { status: "library" },

  // --- fixture: not a plain-`node` language-conformance test ---
  "99-p5js/main.lisp": {
    status: "fixture",
    reason: "requires a p5.js/browser runtime, not plain `node`",
  },
  "W99_L_sloth_design_v1.lisp": {
    status: "fixture",
    reason: "design scratchpad, not a feature demonstration",
  },

  // --- xfail: real examples, no golden authored yet ---
  "00-tests/00_tree_shake.lisp": {
    status: "test",
  },
  "01-basics/04_when.lisp": {
    status: "xfail",
    reason:
      "D12 landed and this now PARSES. It is blocked one stage later: codegen emits invalid " +
      "JavaScript for it (LL0101), which the acorn check now catches instead of writing to disk. " +
      "A codegen bug (P5), not a form-layer one.",
  },
  "01-basics/05_pattern_matching.lisp": {
    status: "xfail",
    reason: "match-guard misparse, see Phase 3 (form layer)",
  },
  "01-basics/07_memoization_fixed.lisp": {
    status: "xfail",
    reason: "D3: :comptime/defmodifier metaprogramming broken",
  },
  "01-basics/09_more_for_loops.lisp": {
    status: "xfail",
    reason:
      "D12 landed and the for-loops now PARSE. Blocked instead on ':inline' (LL0015) -- an " +
      "undeclared modifier that appears nowhere else in the corpus and has no (defmodifier " +
      "inline ...). The example is at fault, not the compiler.",
  },
  "01-basics/17_higher_order_functions.lisp": {
    status: "xfail",
    reason: "parse failure, see Phase 3 (form layer)",
  },
  "01-basics/18_destructuring.lisp": {
    status: "xfail",
    reason:
      "destructuring itself now works (D16) -- every binding line in this file parses and runs. " +
      "It is now blocked one line further on, at :48 `(fn print-point [[x y] <- [Int Int]])`, " +
      "which needs a TUPLE TYPE. Neither frontend has ever supported `[Int Int]` as a type; that " +
      "is D5/P8 type-system work, not the form layer.",
  },
  "01-basics/19_optional_and_mutability.lisp": {
    status: "xfail",
    reason: "D9: T? optional-type syntax not real yet",
  },
  "01-basics/20_scope.lisp": {
    status: "xfail",
    reason:
      "destructuring itself now works (D16). Blocked earlier in the file, at :68 " +
      "`(for :i 0 :< 3 :step 1 :then ...)`: `:i` and `:<` are not `for` clauses, and under D12 " +
      "`for` is named-clause-only, so this is now a located parse error rather than a silent " +
      "slot-drift misparse. The example is at fault; it never reaches its destructuring on :112.",
  },
  "01-basics/21_nil_handling.lisp": {
    status: "xfail",
    reason: "D9: nil/optional-type semantics",
  },
  "02-errors/01_try_catch.lisp": {
    status: "xfail",
    reason:
      "not goldenable as written: it does `(console.log \"Caught error:\" err)` on raw Error " +
      "objects, so node prints a full stack trace with ABSOLUTE paths and line numbers into the " +
      "generated .js -- a golden would bake one machine's filesystem into the repo. (Its old " +
      "reason, 'needs a golden authored', was wrong: it compiles and runs fine.) Fix is to print " +
      "err.message, but that edits the corpus and needs a call.",
  },
  "03-types/00_type_basics.lisp": {
    status: "xfail",
    reason: "D5: convertAstTypeToInferred false-positives on this exact file",
  },
  "04-data-types/01_quoting.lisp": {
    status: "xfail",
    reason: "D3: homoiconicity/quote is broken (compiles to a JSON string)",
  },
  "04-data-types/02_maps.lisp": {
    status: "xfail",
    reason: "D13: map-key codegen crash",
  },
  "04-data-types/06_structs.lisp": {
    status: "xfail",
    reason: "D11: defstruct value-type semantics",
  },
  "04-data-types/07_structs.lisp": {
    status: "xfail",
    reason: "D11: defstruct value-type semantics (parse failure)",
  },
  "07-async/00.lisp": {
    status: "xfail",
    reason:
      "await has no codegen (LL0100: visitAwait is not implemented in the JS backend). The old " +
      "reason -- 'D14: await is unwritable, no AwaitKw in the current grammar' -- is stale: D14 " +
      "landed and it now parses. Blocked on the codegen phase, not the frontend.",
  },
  "08-types/01_arguments.lisp": {
    status: "xfail",
    reason: "D5: array/generic argument type-checking",
  },
  "10-algorithms/00_bfs.lisp": {
    status: "xfail",
    reason: "D5: `new` expressions are untyped",
  },
  "10-algorithms/02_game_of_life.lisp": {
    status: "xfail",
    reason:
      "uses `(for (let dy :of offsets) ...)`, a for-OF form that D12 does not have: `for` takes " +
      "named clauses (:init/:each/:cond/:from/:step/:then/:else) and nothing else. Neither " +
      "frontend ever supported it -- the PEG's For rule has no :of either. Aspirational syntax; " +
      "either add a :of clause to D12 or rewrite the example.",
  },
  "20-stdlib/test_stdlib.lisp": {
    status: "xfail",
    reason: "D7: real stdlib not yet implemented",
  },
  "modifiers_demo.lisp": {
    status: "xfail",
    reason: "D3: __ll_modifier_memoized not implemented (its old .expect was two literal prose lines, not real expected stdout -- deleted)",
  },
  "modifiers_test.lisp": {
    status: "xfail",
    reason:
      "D4 is now enforced, and this file is what it catches: it applies ':memoized' and ':cached' " +
      "while declaring neither (LL0015). Both are user-defined modifiers -- 05_memoization.lisp " +
      "and 05_multiple_modifiers.lisp declare ':memoized' with (defmodifier memoized []) and pass. " +
      "The example is at fault, not the compiler; fixing it edits the corpus and needs a call.",
  },
};
