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
  //
  // `library` means COMPILED, NEVER EXECUTED -- and `test:type-errors` excludes it from the corpus
  // count entirely, so a diagnostic in one of these files is invisible twice over. That is not a
  // footnote; it is the reason the std/ tree could sit here green while calling four functions that
  // do not exist, deftyping `Number` twice, and leaking nine unexported symbols.
  //
  // The std/ entries are GONE from this list because the stdlib is no longer an example: Sc2 moved it
  // to `lib/std/`, where it is imported BY NAME -- `(import "std/math")`. `test:type-errors` walks
  // `lib/` alongside `examples/`, so it did not leave the diagnostic harness on the way out. Sf gives
  // it goldens. See STDLIB.md.
  "20-stdlib/complex_math_test/math_utils.lisp": { status: "library" },
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
  "08-types/01_type_errors.lisp": {
    status: "negative",
    codes: ["LL0203"],
    reason:
      "The tail of 00_primitives.lisp, split out in P6. Its own comments said 'Shouldn't compile " +
      "because of type mismatch' -- and it compiled: the golden recorded the results, '23' and " +
      "'Help me!', as though they were right, so the file asserted the exact bug it was written to " +
      "warn about. The checker could not see a call ARGUMENT (the membersChecksOnly guard, removed " +
      "in P6g). Asserting the CODE is what the file always meant.",
  },
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
      "Tuples (Phase U) and records (Phase R) BOTH work now. The :97 match-arm blocker is GONE (Pa): " +
      "the `[(pattern match) (body)]` form was stale syntax only the PEG accepted; rewritten to the " +
      "ruled `(match x { pat => body })`. The file now PARSES on grammar_v2. " +
      "Blocked now at :19 on LL0219 'r'/'b' 'used before it is declared', both bound at :18 by " +
      "`(let [r g b] rgb)` -- note `g`, bound by the SAME form, is not flagged, so this is not a " +
      "plain destructuring-binding miss. `b` is separately re-declared at :78 and :80 in the same " +
      "scope (an example bug: `(let [a b] [b a])` is a genuine TDZ read). The `r` report has no " +
      "measured root cause yet -- it is a false positive on valid code and wants a probe.",
  },
  "01-basics/19_optional_and_mutability.lisp": {
    status: "test",
  },
  "01-basics/20_scope.lisp": {
    status: "xfail",
    reason:
      "The :68 `for` blocker is GONE (Pa): `:i`/`:<` are not D12 clauses, rewritten to " +
      "`:init (mut i 0) :cond (< i 3) :step (i := (+ i 1))`. Three more stale forms went with it: " +
      "`(Fn [] Int)` -> `(fn [] -> Int)` (v2's functionType rule takes lowercase `fn` + `->`; the " +
      "capital-`Fn` spelling never parsed on EITHER frontend and appears nowhere else in the corpus), " +
      "the `[(pat match) (body)]` match arms -> `{pat => body}`, and `(let [f1 f2] <- (make-functions))` " +
      "-> `(let [f1 f2] (make-functions))` (`<-` is the type arrow, so the old LL0006 was correct). " +
      "The file now PARSES on grammar_v2. Blocked at :27 on LL0219 'x' 'used before declared': `x` is " +
      "declared at :26 AND re-declared at :103 in the same top-level scope -- two `const x` in one " +
      "block, an EXAMPLE bug. Fix the duplicate before re-judging the diagnostic.",
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
      "The colon-path blocker is GONE (Pa). It was flagged here as needing a ruling, and it got one: " +
      "`map:key:key` is NOT a language feature (D39) -- maps use dot-path. grammar_v2's rejection was " +
      "correct all along; the PEG's acceptance was the defect (it mangled the path to a junk identifier " +
      "that reached codegen -- audit AF-029). Every `person:name`/`nested:user:name`/`config:host` is now " +
      "dot-access, and `(data.hasKey :a)` -> `\"a\"` per D13 (keys are strings). File now PARSES. " +
      "Blocked at :72 on LL0202 'cannot assign Int to Map' for `(user[\"profile\"][\"score\"] := 1500)`: " +
      "the checker drops the SECOND index in assignment position. A REAL CHECKER BUG -- the read form " +
      "`nested[\"user\"][\"contact\"][\"email\"]` on :31 works fine. Unfiled by the audit. It also has no golden.",
  },
  "04-data-types/06_structs.lisp": {
    status: "test",
  },
  "04-data-types/07_structs.lisp": {
    status: "xfail",
    reason:
      "NOT defstruct, and NOT unblockable by D11 -- the old reason ('D11: defstruct value-type " +
      "semantics (parse failure)') named the wrong cause entirely. It dies at :2:42, on line TWO, " +
      "inside `(deftype uint8 Int :where Int :is (0 .. 255))`: the `..` RANGE operator, which neither " +
      "frontend has ever lexed. Behind that sit three more things it wants and nothing has: " +
      "`uint8[256]` SIZED array types (grammar_v2 rejects them, PEG accepts -- a divergence), `:stack` " +
      "on a field (a D15 RESERVED_NATIVE_MODIFIER, hard error on a JS target, correctly), and " +
      "`(fn :operator * [...] (return this))` which returns `this` -- the one thing in the corpus that " +
      "by-copy value semantics would actually change. Its struct declaration is the least of it.",
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
      "The for-OF blocker is GONE (Pa): the old reason offered 'either add a :of clause to D12 or " +
      "rewrite the example' -- the example was rewritten, to `:each dy :from offsets :then`. Pa also " +
      "had to replace its `(not (and ...))` / `(or ...)` with `!`/`&&`/`||`, because the word-forms " +
      "did not exist (`(and a b)` was LL0210 'and' is not defined). That is RESOLVED: D39 ruled the " +
      "aliases in and Qd built them, so the example's ORIGINAL word-forms are restored -- the " +
      "workaround outlived its cause by four commits. " +
      "The file now COMPILES CLEAN and RUNS -- no diagnostics, exit 0 up to the throw. It fails at " +
      "RUNTIME: `RangeError: IndexOutOfRange: -1 (length 3)`, because count-neighbors reads " +
      "`grid[(+ y dy)]` with dy=-1 at y=0. The COMPILER IS CORRECT -- that is its emitted bounds " +
      "check firing. The EXAMPLE is unfinished: its own comment at :10 says 'Simplified for brevity: " +
      "assuming 3x3 grid without bounds check error'. Needs the bounds logic actually written.",
  },
  // THE STDLIB RUNS. It has a golden, it is executed on every `npm test`, in both frontends.
  //
  // It was xfail because it called `length`, `first`, `last` and `at` -- four functions that existed
  // NOWHERE -- and nothing ever found out, because a `library`/`xfail` file is compiled and never RUN.
  // That is the hole Sa was written to expose, and this entry closing it is what Sf is FOR.
  //
  // Running it found three real bugs the moment it executed: an inlined function's PARAMETER being
  // replaced by a same-named top-level symbol (`(pow 2 3)` was NaN), a `deftype` being inlined as if
  // it had a runtime value (`is-int` threw ReferenceError), and a zero-arg call to a local function
  // value emitting a bare reference. See DECISIONS.md.
  "20-stdlib/test_stdlib.lisp": { status: "test" },
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
