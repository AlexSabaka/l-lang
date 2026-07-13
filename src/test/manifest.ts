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
 * - 'negative': the file is SUPPOSED to fail. It must not compile, and it must report every
 *   code in `codes`. Without this status such a file has nowhere to live: run as a positive
 *   test it is a permanent ERROR (which is how 02-errors/01_errors.lisp spent the whole audit),
 *   and marked 'fixture' it would be skipped -- so a corpus file whose entire purpose is to
 *   demonstrate a diagnostic would assert nothing at all. Asserting the CODES is what makes it
 *   a test rather than an excuse: if a diagnostic silently stops firing, this goes red.
 */

export type ExampleStatus = "test" | "library" | "fixture" | "xfail" | "negative";

export interface ManifestEntry {
  status: ExampleStatus;
  reason?: string;
  /** 'negative' only: every diagnostic code the file must report. */
  codes?: string[];
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

  // --- negative: the file MUST fail, with exactly these diagnostics ---
  "02-errors/01_errors.lisp": {
    status: "negative",
    codes: ["LL0002", "LL0006", "LL0007"],
    reason:
      "It demonstrates diagnostics ON PURPOSE -- the codes are written in its own comments -- so it " +
      "can never produce stdout, and running it as a POSITIVE test made it a permanent ERROR for the " +
      "entire audit. Its .expect was a captured stderr DUMP with this machine's absolute paths baked " +
      "in (/Volumes/2TB/repos/l-lang/...), so it could not have matched anywhere else either; it is " +
      "deleted in favour of asserting the CODES, which is machine-independent and strictly stronger.",
  },

  // --- xfail: real examples, no golden authored yet ---
  "00-tests/00_tree_shake.lisp": {
    status: "test",
  },
  "01-basics/05_pattern_matching.lisp": {
    status: "xfail",
    reason: "match-guard misparse, see Phase 3 (form layer)",
  },
  "01-basics/07_memoization_fixed.lisp": {
    status: "xfail",
    reason:
      "NOT D3 -- the old reason (':comptime/defmodifier metaprogramming broken') is stale; both work " +
      "now. This is D4 doing its job: the file applies `:memoized` at :29 while declaring no such " +
      "modifier (LL0015), and its own comment says 'Future: Using custom :memoized modifier " +
      "(placeholder for now)'. The example is at fault. Fixing it means adding a real " +
      "(defmodifier memoized ...) -- which examples/06-modifiers/ now has -- and authoring a golden.",
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
    status: "test",
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
    status: "test",
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
    reason:
      "Quote is no longer 'broken (compiles to a JSON string)' -- D3d fixed that, and this file now " +
      "compiles and runs. It is blocked on two things it asks for that do not exist. (1) It wants a " +
      "CONS/LIST representation -- its own comment says `'(+ 1 2)` should be `[\"+\", 1, 2]` -- and " +
      "quote emits the AST datum, `{_type:'list', nodes:[...]}`. Which of those homoiconicity means " +
      "is a language decision, not a bug. (2) It wants `(eval logic)`, which needs a runtime AST " +
      "interpreter: `RuntimeProvider` registers `\"eval\": \"\"`, so it falls through to host JS eval. " +
      "Both are out of scope for D3, whose ruling is ':comptime + defmodifier'.",
  },
  "04-data-types/02_maps.lisp": {
    status: "xfail",
    reason:
      "The string-key gap is FIXED (P8d): `{\"host\" \"localhost\"}` parses now, which was the last " +
      "reason given. It is blocked one line further on, at :30 `nested:user:name` -- a COLON-PATH map " +
      "access. grammar_v2 rejects it; PEG parses it and then type-errors, so the frontends diverge. " +
      "Note the very NEXT line uses `nested[\"user\"][\"contact\"][\"email\"]`, which works (P8b), so " +
      "the file does not need the colon form. Whether `map:key:key` is a language feature at all is a " +
      "ruling, not a bug. It also has no golden.",
  },
  "04-data-types/06_structs.lisp": {
    status: "xfail",
    reason: "D11: defstruct value-type semantics",
  },
  "04-data-types/07_structs.lisp": {
    status: "xfail",
    reason: "D11: defstruct value-type semantics (parse failure)",
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
    reason:
      "D7: real stdlib not yet implemented. (Its LL0101 -- the inliner splicing a type-def's " +
      "`const Number = undefined;` into an initializer -- is fixed in P5c, and it now compiles " +
      "clean. It is blocked on the stdlib's own behaviour, not on codegen.)",
  },
  "modifiers_demo.lisp": {
    status: "xfail",
    reason:
      "It COMPILES AND RUNS clean now -- the old reason ('__ll_modifier_memoized not implemented') is " +
      "stale. But it must not be given a golden as it stands: it declares `(defmodifier memoized [])` " +
      "with an EMPTY body, which after D3b is an identity pass-through, so its 'memoized' fibonacci " +
      "recomputes every call. A golden recorded from that output would certify a test that " +
      "demonstrates nothing -- which is exactly the bug D3b found in four other modifier goldens. It " +
      "needs a real modifier body, as examples/06-modifiers/ now has, and is largely redundant with " +
      "06-modifiers/05_multiple_modifiers.lisp, which demonstrates memoization properly.",
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
