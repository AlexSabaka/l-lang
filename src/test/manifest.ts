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
  "16-stdlib/complex_math_test/math_utils.lisp": { status: "library" },
  "80-adversarial/module_private_collision/alpha.lisp": { status: "library" },
  "80-adversarial/module_private_collision/beta.lisp": { status: "library" },
  "80-adversarial/display_imported_class_tag/money.lisp": { status: "library" },
  "80-adversarial/display_source_names/lib.lisp": { status: "library" },
  "80-adversarial/module_private_fnvalue/alpha.lisp": { status: "library" },
  "80-adversarial/module_private_fnvalue/beta.lisp": { status: "library" },
  "99-fixtures/p5-bindings.lisp": { status: "library" },

  // --- fixture: not a plain-`node` language-conformance test ---
  "99-fixtures/main.lisp": {
    status: "fixture",
    reason: "requires a p5.js/browser runtime, not plain `node`",
  },

  // --- negative: the file MUST fail, with exactly these diagnostics ---
  "90-diagnostics/01_type_errors.lisp": {
    status: "negative",
    codes: ["LL0203"],
    reason:
      "The tail of 00_primitives.lisp, split out in P6. Its own comments said 'Shouldn't compile " +
      "because of type mismatch' -- and it compiled: the golden recorded the results, '23' and " +
      "'Help me!', as though they were right, so the file asserted the exact bug it was written to " +
      "warn about. The checker could not see a call ARGUMENT (the membersChecksOnly guard, removed " +
      "in P6g). Asserting the CODE is what the file always meant.",
  },
  "90-diagnostics/00_errors.lisp": {
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
  "00-basics/06_grouping.lisp": {
    status: "test",
  },
  "04-pattern-matching/03_pattern_kinds.lisp": {
    status: "xfail",
    reason: "match-guard misparse, see Phase 3 (form layer)",
  },
  "20-algorithms/10_memoization_modifier.lisp": {
    status: "xfail",
    reason:
      "NOT D3 -- the old reason (':comptime/defmodifier metaprogramming broken') is stale; both work " +
      "now. This is D4 doing its job: the file applies `:memoized` at :29 while declaring no such " +
      "modifier (LL0015), and its own comment says 'Future: Using custom :memoized modifier " +
      "(placeholder for now)'. The example is at fault. Fixing it means adding a real " +
      "(defmodifier memoized ...) -- which examples/06-modifiers/ now has -- and authoring a golden.",
  },
  "03-loops/02_more_for_loops.lisp": {
    status: "xfail",
    reason:
      "D12 landed and the for-loops now PARSE. Blocked instead on ':inline' (LL0015) -- an " +
      "undeclared modifier that appears nowhere else in the corpus and has no (defmodifier " +
      "inline ...). The example is at fault, not the compiler.",
  },
  // Was xfail "parse failure, see Phase 3 (form layer)" -- and that diagnosis was wrong. There is no
  // form-layer gap here; the FILE was never valid l-lang. Three syntax typos (a stray `]` closing the
  // param list of `reduce-array` early, and `[a <- Int :b Int]` twice where the second parameter is
  // simply misspelled), `[Int]` where the array type is `Int[]`, `Bool` where the primitive is
  // `Boolean`, `-> nil` where the type of no-value is `Void` (D9: nil is the VALUE), and a `let`
  // rebound with `:=` in violation of D10. Fixed; the golden is hand-verified arithmetic.
  //
  // It compiles and runs on JS only. The C backend CRASHES on it -- `Error: C emit: no cast closure
  // -> closure`, a raw stack trace out of EmitCirToC rather than a clean ELL0106 refusal -- when a
  // function declared `-> (fn [Int] -> Int)` returns a closure. That is a backend gap AND a
  // fail-loudly-but-cleanly gap; it is why this file is not in c-status.ts.
  "04-pattern-matching/04_destructuring.lisp": {
    status: "xfail",
    reason:
      "Re-measured 2026-07-22: parses and type-checks past the old blockers; its `-> nil` returns " +
      "were corrected to `-> Void`. Now blocked on FOUR ELL0212s -- `a`, `b`, `r` and `name` are each " +
      "declared twice in the one top-level scope, because the sections reuse names " +
      "(`[r g b]` at :18 vs `[q r]` at :90, `{:name :age}` at :29 vs the nested `{:user {:name :id}}` " +
      "at :43). Three of those are mechanical renames. The fourth is not: :76-80 does `(let a 1) " +
      "(let b 2) (let [a b] [b a])` to demonstrate a SWAP, and D10 says a `let` binds once. Whether " +
      "l-lang wants destructuring ASSIGNMENT is a language question.",
  },
  "00-basics/03_optional_and_mutability.lisp": {
    status: "test",
  },
  "00-basics/02_scope.lisp": {
    status: "xfail",
    reason:
      "Re-measured 2026-07-22: compiles with zero diagnostics, and dies at RUNTIME with " +
      "'ReferenceError: Cannot access count before initialization'. :69 `(let count (+ count 10))` " +
      "shadows an outer `count` and reads it in its own initializer, which emits `const count = " +
      "count + 10` -- a self-referential const, i.e. a TDZ read. TWO defects hide here: the emitter " +
      "produces it, and the checker does not report the LL0219 that would have caught it. The file " +
      "also carries two commented-out lines (`; (let x 2)`, `; (let count 0)`) that disable the very " +
      "shadowing it is titled after, so 'Inner x (shadowed)' currently prints the OUTER x.",
  },
  "00-basics/04_nil_handling.lisp": {
    status: "test",
  },
  "18-error-handling/01_try_catch.lisp": {
    status: "xfail",
    reason:
      "Re-measured 2026-07-22: the stack-trace objection no longer applies (the file catches `:of " +
      "Error` and prints fixed literals), and its `-> nil` return type was corrected to `-> Void`. " +
      "It now fails to COMPILE, on ELL0205: section 5 does `(let data nil)` and then reads " +
      "`data.property` to demonstrate a runtime null access, which D9's non-nullable-by-default " +
      "checker refuses statically. The type system preventing the bug IS the feature; what an " +
      "example of type-specific catch should fail WITH instead is a decision, not a fix.",
  },
  // 07-types/03_type_basics.lisp was xfail "D5: convertAstTypeToInferred false-positives on this
  // exact file". Re-measured 2026-07-22: it compiles with ZERO diagnostics and runs. The blocker was
  // real once and went away without anyone re-checking, so the file sat unrun for the whole of the
  // interval. It has a golden now (two lines, both hand-checked against the source) and is an
  // ordinary test.
    "12-quote-macros/00_quoting.lisp": {
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
  "05-data-structures/02_maps.lisp": {
    status: "xfail",
    reason:
      "Re-measured 2026-07-22: this now COMPILES with zero diagnostics and fails at RUNTIME. Two " +
      "causes, both real features rather than checker bugs: (1) `settings.entries` in a for-each " +
      "emits a call to `__ll_map_copy_each`, which RuntimeProvider defines but the tree-shaken " +
      "prelude does not include -- a shim-SELECTION bug, not a missing helper; (2) `.keys`, " +
      "`.values` and `.hasKey` on a map do not exist. The map FLOOR (Fg-2) gave the language " +
      "map-get/set/has/delete/keys, so the accessors this file wants are expressible now and the " +
      "remaining work is surface, not semantics. The earlier colon-path note (D39, `map:key` is not " +
      "a feature) was settled and is no longer why this is here.",
  },
  "06-value-semantics/00_structs.lisp": {
    status: "test",
  },
  "06-value-semantics/01_structs_refinement.lisp": {
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
  "07-types/04_argument_types.lisp": {
    status: "xfail",
    reason: "D5: array/generic argument type-checking",
  },
  "20-algorithms/00_bfs.lisp": {
    status: "xfail",
    reason:
      "Re-measured 2026-07-22: `new` expressions ARE typed now -- the diagnostic names `Point?`, " +
      "which is the inferred type doing its job. The live blocker is nil-safety: ELL0205 " +
      "'current is possibly nil (Point?)', from reading a field off a queue-shift result without " +
      "checking it. D9 friction on a real algorithm, not a missing feature.",
  },
  "20-algorithms/02_game_of_life.lisp": {
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
  "16-stdlib/test_stdlib.lisp": { status: "test" },
  // (Root files modifiers_demo.lisp / modifiers_test.lisp DELETED: both broken and redundant with the
  //  modifiers suite -- empty-body modifier that demonstrates nothing, and undeclared :memoized/:cached
  //  (LL0015). Modifier-with-arguments is properly shown by the retry-modifier example. The design
  //  scratchpad W99_L_sloth_design_v1.lisp is DELETED too; its wishlist is in docs/inbox/language-ideas.md.)

  // ===========================================================================
  // ADVERSARIAL CORPUS INTEGRATION (l-lang-post-audit + l-lang-ex)
  // Three external sources folded in as feature + adversarial coverage. Green
  // additions carry their own .expect and need no entry here; everything below
  // is quarantined with a reason (xfail), pinned to codes (negative), or is an
  // imported unit (library) / non-node program (fixture). See
  // docs/inbox/adversarial-corpus-integration.md for the full writeup.
  // ===========================================================================

  // --- proposed-examples: multi-file package, imported units (compiled via main) ---
  "15-modules/02_packages/format.lisp": { status: "library" },
  "15-modules/02_packages/geometry/shapes.lisp": { status: "library" },
  "15-modules/02_packages/geometry/measure.lisp": { status: "library" },

  // 11-comptime/01_comptime_table.lisp was an xfail here: a `:comptime` helper called by another
  // `:comptime` fn, folded more than once, emitted a duplicate `const __ll_inlined_<f>_1` into one
  // eval scope and threw LL0099. The cause was not the inliner but `uniqueIdentifier`, which advanced
  // its counter on a local and never wrote it back, so every call returned `_1`. Fixed there; the
  // example now folds and runs, and has a hand-verified golden, so it is an ordinary test.

  // --- l-lang-ex games: DROPPED (not node-runnable) after their runnable parts were extracted ---
  // The 7 full games (5 terminal, 2 p5) compiled clean but could never run under the golden harness
  // (raw-mode TTY / browser p5). Rather than keep them as inert fixtures, their self-contained,
  // deterministic feature logic was lifted into runnable examples under 30-applications/ (generic
  // Inventory<T>, Vec2 operator overloading, interface conformance, the :undoable modifier + snapshot,
  // minesweeper flood-fill, snake tick, tetromino rotation, line-clear, boids vector toolkit). The
  // full games live on in the separate l-lang-ex repo; the bug repros they exposed live in
  // 90-adversarial/. See docs/inbox/adversarial-corpus-integration.md.

  // --- 90-adversarial: minimal repros extracted from the audit's p5-friction probes ---
  // The four GREEN siblings (spread_in_literals, return_in_logical_operand, hex_string_escape,
  // paren_absorption) carry goldens and pin bugs FIXED since the audit commit -- CP1 (spread
  // dropped all but the first element), CF1 (return inside ||/&& was swallowed by an IIFE), PR3
  // (\xHH degraded to the bare char). Only PR4 below is still live.
  "80-adversarial/hyphen_field_encoding.lisp": {
    status: "xfail",
    reason:
      "STILL BROKEN -- silent wrong answer (finding PR4, l-lang-ex snake). A hyphenated map field " +
      "encodes inconsistently: the `:next-dir` map key stays literal, but DOT access mangles the " +
      "hyphen (`.next-dir` -> `.next2ddir`). So `w.next-dir` reads a key that was never written " +
      "(undefined), `(w.next-dir := \"down\")` writes a SECOND mangled `next2ddir` key, and " +
      "`(w[\"next-dir\"])` bracket-reads the original -- the three spellings disagree on one field. " +
      "No golden: current output is wrong and a golden would bless it. Expected-vs-actual is in the " +
      "file header and the writeup.",
  },

  // --- 02-errors/diagnostics: negative tests (p1-matrix ll* probes) ---
  // Each is a minimal program that MUST fail with the pinned code. These fill the coverage
  // hole COVERAGE-MATRIX flagged: 21 registered diagnostics with zero test asserting them.
  // Dropped from the probe set: ll0003/ll0020 (parse THROWS, not a located diagnostic, so
  // runNegativeTest can't assert them); ll0014/ll0024 (compile CLEAN -- dead wiring confirmed,
  // COVERAGE-MATRIX:126); ll0007 (already asserted by 02-errors/01_errors.lisp).
  "90-diagnostics/ll0005_nameless_let.lisp": {
    status: "negative", codes: ["LL0005"],
    reason: "`(let)` with no binding. Reports LL0005 (+LL0006); pins the never-exercised LL0005.",
  },
  "90-diagnostics/ll0108_restarts_refused.lisp": {
    status: "negative", codes: ["LL0108"],
    reason: "D47 restart forms are refused on the JS backend (no native handler/restart stack). Pins " +
      "LL0108 -- the mirror of the C band's LL0105-07 refusals. Compile with --language c to use them.",
  },
  // The record-shaped-field blind spot: `catch` clauses, `handle` clauses and restart `arms` carry no
  // `_type`, so every AST walker stepped over them and NOTHING in those bodies was ever name-checked.
  // Three tests because the three shapes are three separate records; one passing does not imply another.
  "90-diagnostics/ll0210_undefined_in_catch.lisp": {
    status: "negative", codes: ["LL0210"],
    reason: "An undefined name in a CATCH body. Reported nothing at all until the walkers learned to " +
      "descend into record-shaped fields -- try/catch is shipped, so this was the widest half of the gap.",
  },
  "90-diagnostics/ll0210_undefined_in_handle_clause.lisp": {
    status: "negative", codes: ["LL0210"],
    reason: "An undefined name in a D47 `handle` clause body. Also pins the other half: the clause " +
      "binder `c` is a legitimate binding and must NOT be reported alongside it.",
  },
  "90-diagnostics/ll0210_undefined_in_restart_arm.lisp": {
    status: "negative", codes: ["LL0210"],
    reason: "An undefined name in a D47 `restart-case` arm body; the arm's params must NOT be reported.",
  },
  "90-diagnostics/ll0008_two_default_catch.lisp": {
    status: "negative", codes: ["LL0008"],
    reason:
      "FINDING: two default `catch` blocks -> LL0008 fires cleanly at HEAD, CONTRADICTING " +
      "COVERAGE-MATRIX:127 which recorded LL0008 as an 'unreachable predicate' that 'can never fire'. " +
      "Reachable now; pinned so it stays so.",
  },
  "90-diagnostics/ll0009_iface_invalid_member.lisp": {
    status: "negative", codes: ["LL0009"],
    reason: "a `defclass` inside a `definterface` body -> LL0009. Never-exercised code.",
  },
  "90-diagnostics/ll0010_iface_init.lisp": {
    status: "negative", codes: ["LL0010"],
    reason: "an initialized `let` in a `definterface` -> LL0010. Never-exercised code.",
  },
  "90-diagnostics/ll0011_iface_extern.lisp": {
    status: "negative", codes: ["LL0011"],
    reason: "`:extern` method in a `definterface` -> LL0011. Never-exercised code.",
  },
  "90-diagnostics/ll0012_iface_body.lisp": {
    status: "negative", codes: ["LL0012"],
    reason: "a method WITH a body in a `definterface` -> LL0012. Never-exercised code.",
  },
  "90-diagnostics/ll0019_bare_let.lisp": {
    status: "negative", codes: ["LL0019"],
    reason: "a bare top-level `let x 5` (not wrapped in a form) -> LL0019. Never-exercised code.",
  },
  "90-diagnostics/ll0025_nameless_class.lisp": {
    status: "negative", codes: ["LL0025"],
    reason:
      "`(defclass)` with no name -> LL0025 under the runner frontend. (COVERAGE-MATRIX:135: peg " +
      "diverges to LL0210; the runner's frontend gives LL0025.) Never-exercised code.",
  },
  "90-diagnostics/ll0026_if_no_cond.lisp": {
    status: "negative", codes: ["LL0026"],
    reason: "`(if)` with no condition -> LL0026 (+LL0027). Never-exercised code.",
  },
  "90-diagnostics/ll0028_when_no_then.lisp": {
    status: "negative", codes: ["LL0028"],
    reason: "`(when)` with no then-branch -> LL0028 (+LL0026). Never-exercised code.",
  },
  "90-diagnostics/ll0212_dup_decl.lisp": {
    status: "negative", codes: ["LL0212"],
    reason:
      "two `(let d ...)` in one scope -> LL0212. COVERAGE-MATRIX:128 flagged the diagnostics.ts " +
      "snapshot as pinning LL0212's NON-firing shape; this asserts it actually fires.",
  },
  "90-diagnostics/ll0217_import_empty.lisp": {
    status: "negative", codes: ["LL0217"],
    reason:
      "`(import \"\")` empty source -> LL0217 from the dependency-graph builder (NOT LL0003, which " +
      "COVERAGE-MATRIX:129 shows is masked/unobservable).",
  },
  "90-diagnostics/ll0203_real_container_key.lisp": {
    status: "negative", codes: ["LL0203"],
    reason:
      "D53/F.5: a key is an Int or a String, and `get`/`elem` declare that on the floor. This was a " +
      "silent cross-backend divergence -- (get v (Math.floor 1.7)) answered 20 on JS and nil on C -- " +
      "and NO runtime could converge it, because JS cannot distinguish an Int from an integral Real " +
      "at runtime (D51: a literal is a BigInt only where the checker typed it). So it is a checker " +
      "question, and this pins the diagnostic. `(get v (Math.trunc 1.7))` is the supported spelling.",
  },
  "90-diagnostics/ll0100_hex_number.lisp": {
    status: "negative", codes: ["LL0100"],
    reason:
      "a hex literal `0xFF` lexes but has no JS emitter -> LL0100. Representative of the numeric " +
      "tower (hex/octal/binary/complex/fraction all no-emitter). Pins LL0100, which had 0 assertions.",
  },
};
