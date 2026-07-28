# 📜 Changelog

**What changed, in the order it changed, per release.**

This is the narrative record. It is deliberately *not* the same thing as:

| | |
|---|---|
| [`spec/DECISIONS.md`](spec/DECISIONS.md) | **why** — every ruling with the measurement that produced it, ordered by when it was taken |
| [`roadmap.md`](roadmap.md) | **what is left** — phases, and the known gaps |
| `src/test/{manifest,c-status,js-status}.ts` | **what is true right now** — read by the suite, so they cannot go stale |

Nothing here restates a count or a status; those go stale, and this file has been the proof of it.

---

## 🚀 July 2026

### The numeric tower — `Ring`, matrices, and units (D88–D90, 2026-07-28)
**Status**: ✅ Complete

Int – Rational – Real – Complex – Vector – Matrix, with tensors recorded as a planned phase.

- **D88** — the scalar floor: `1/2`, `3+4i`, `0xFF`/`0o17`/`0b1010`, promotion through an
  `:implicit` defcast at operand positions, and `..` binding by **adjacency** (a standalone `..` is
  LL0034; 16 corpus files migrated off the spaced form).
- **D89** — `Ring` joins the protocol family, a **primitive** can answer a protocol, and a matrix's
  cells must share one. Building it found that **no desugar had ever reached a matrix cell**:
  `MatrixNode.rows` is the only array-of-arrays field in the AST and every rewriting visitor mapped
  one level, so `1/2` inside a matrix reached both backends as a raw `fraction-number`.
- **D90** — units of measure. A `:satisfies` refinement can be a **dimension**; `*` and `/` compose
  exponents, `+`/`-` require equality, assignability compares dimensions rather than names, and the
  whole thing **erases** — a dimensioned newtype emits no `ll_refine_check_*` call site at all.
  The `:unit` marker exists because a refinement's *shape* cannot distinguish a bounded value from a
  measurement: the first attempt made every refined newtype a dimension and broke five corpus files,
  three on lines labelled `"widened:"`.

### C becomes the reference implementation (D85–D87, 2026-07-28)
**Status**: ✅ Complete

The polarity flip. **Where the backends disagree, C is the specification** unless C is shown wrong on
its own terms; JavaScript is a frozen second implementation whose remaining value is that a
disagreement is worth *looking at*. `manifest.ts` gained `oracleDivergent` — graded on C, skipped on
JS, with the measured JS defect recorded in the string — so a file where the oracle is wrong finally
had somewhere to live. D87 split the failure taxonomy into three layers (data / contract /
unrecoverable) and D85 ruled integer division by zero a panic, with a literal zero a compile error.

### The stdlib build-out (D76–D82, 2026-07-27)
**Status**: ✅ Complete

Six modules, each ruled before it was written: `std/core/builder` (D76 — `+` in a loop is quadratic),
`std/text/json` (D77 — the engine is l-lang, the escape table is pinned by the host),
`std/time/calendar` (D78 — proleptic Gregorian, UTC, **zero** floor entries), `std/log` (D79),
`std/cli` (D80). Alongside them, D81 made a base method's call to an overridden method virtual on C,
and D82 ruled that a **data** error is catchable while a contract violation is not — the rule that
makes the error tower usable rather than decorative.

### The language-surface round (D61–D75, 2026-07-23 → 07-26)
**Status**: ✅ Complete

- **D61** bit operators — Int only, 64-bit wrap, masked shifts, arithmetic `shr`.
- **D62** `std/core/errors` — a typed error tower on the ambient `Error`, with `cause`.
- **D63** the protocol family — `Comparable` / `Hashable` / `Formattable`.
- **D64/D65** `std/sys/path` (a value type, `/` canonical) and `std/math/random` (seeded
  determinism *is* the API).
- **D66** — the JavaScript backend is deprecated to an oracle. C/LLVM is the target.
- **D67** regex: the engine is **l-lang**, so one program runs on both backends; `r"…"` is a raw
  string and `f"…"` the formatted one, which sidesteps the `/…/` division ambiguity without
  touching `/`.
- **D68/D72** — `:foo` is **three roles**, not one (modifier, decorator, attribute), and the third
  gets `defattribute` plus an adjacency-gated `:name[args]` form.
- **D69** the metaprogramming tiers, distinguished by what the handler *receives*.
- **D70/D71** enum RTTI; numeric lexis (`_` separators, `0o`, and the octal contradiction).
- **D73** `:comptime` moves to an **in-house interpreter** — `node:vm` leaves the compiler.
- **D74** a match pattern's string decodes like every other string.
- **D75** `defmodifier`'s contract becomes **flat**, with a setup slot. Breaking, and migrated
  across the corpus, the games repo and `src/test/codegen.ts`.

### D47 conditions / restarts, native on C (Phase Cr, July 2026)
**Status**: ✅ Complete

A second, *resumable* exception mechanism beside `try`/`catch` — the Common Lisp condition system's
tractable subset. `restart-case` / `handle` / `signal` / `invoke-restart` lower natively on the C
backend; the JS backend refuses all four with **LL0108** (no native handler/restart stack), the exact
mirror of the C band's LL0105-07 coroutine/extern refusals.

Built in dependency order, the hard part first:

- **Cr-0 — the keystone.** `try`/`catch`/`finally` were unified onto ONE `ll_frame` handler stack
  walked by ONE `ll_unwind` primitive. This is what makes the rest sound: D47's stated hard part is
  that a restart transfer must run intervening `finally` cleanups, and hooking the *same* stack makes
  that true by construction rather than by a parallel mechanism that could silently skip them.
- **Cr-1a — the restart half.** `restart-case` becomes an `LL_RESTART` setjmp pad offering its arm
  names; `invoke-restart` packs its args and unwinds to the newest matching frame. Reusing Cr-0 cost a
  single `f == target` branch in `ll_unwind`.
- **Cr-1b — the condition half.** `handle` installs one bookkeeping `LL_HANDLER` frame (never a
  longjmp target, so no setjmp); `signal` walks those frames **in place** — an ordinary call, which is
  the property that makes resumption possible. Each clause closure-converts to a lifted
  `(void* env, ll_value cond) -> ll_value` handler, a new ABI alongside the argv one, with a single
  shared env per form.

**Conformance**: `examples/19-conditions/`, 21 programs. Expectations are hand-derived from D47 and
confirmed against C — JS refuses these, so it cannot serve as the oracle.

**Two correctness finds from adversarially probing the result**, both fixed:

- A declining handler skipped the remaining clauses of its own `handle` form and jumped straight
  outward. The design brief spells a handler's options as "invoke a restart / return (**decline → next
  handler**) / non-locally exit", and its own example form carries two clauses — so a specific clause
  must be able to fall back to a general one written after it.
- **C11 7.13.2.1p3**: a local of a `setjmp`-containing function that is modified between the `setjmp`
  and the `longjmp` is *indeterminate* unless `volatile`. This was **not** D47-specific — plain
  `try`/`catch` had it too, silently returning stale values at any `-O` above 0. The corpus only ever
  built `-O0`, the one level where the reads happen to work, which is why it went unseen. The emitter
  now `volatile`-qualifies exactly the at-risk locals (one variable across the whole corpus), and
  `npm run test:c:o2` runs the same goldens optimized as the permanent fence.

### Name-checking the dark bodies (July 2026)
**Status**: ✅ Complete

A few AST fields are **records** rather than nodes — no `_type`, so `ast.isAstNode` is false. Every
generic walk tested exactly that and stepped over them: `catch` bodies, `handle` clause bodies,
`restart-case` arm bodies, `deftype :where` constraints. Nothing inside was ever resolved or typed, so
an undefined name in a `catch` body reported **nothing at all** and reached run time. The blind spot
had been copied into three walkers (parent linkage, the shared tree walker, and the type pass's own),
each of which needed the same descent — parent linkage being load-bearing, since `_parent` is how
`SymbolTable.scopeOf` finds the enclosing scope for a binder.

## 🚀 Recent Major Changes (January 2026)

### Generics & Interfaces - Runtime Type Metadata (January 17, 2026)
**Status**: ✅ Complete

Implemented comprehensive generics and interface support with proper runtime type information (RTTI):

- **Generic Classes**: Full support for single and multiple type parameters (`Class<T>`, `Pair<T U>`)
- **Generic Interfaces**: Interface definitions can be generic (`Container<T>`) with implementation checking
- **Runtime Type Metadata**: Fixed critical bugs in `__ll_type_metadata` serialization:
  - Generics array now shows actual type parameter names instead of `[null]`
  - Interface implementations properly tracked in metadata
  - Conditional field inclusion (only add generics/implements when present)
- **Type System Integration**: Generic type parameters properly scoped in TypeEnvironment with `localIdentifiers` map
- **Covariance Syntax**: Parser support for variance modifiers (`:out`, `:in`) for future covariance/contravariance
- **Multiple Interface Implementation**: Classes can implement multiple interfaces with full metadata tracking

**Key Implementation Files**:
- [src/compiler/codegen/js-estree/visitors/JSTransformerAstVisitor.ts](../src/compiler/codegen/js-estree/visitors/JSTransformerAstVisitor.ts) - Fixed generics serialization and added interface tracking in `serializeTypeMetadata()`
- [src/compiler/analysis/SymbolTable.ts](../src/compiler/analysis/SymbolTable.ts) - InferredType structure with generics metadata
- [examples/08-generics/](../examples/08-generics/) - Complete test suite: 10_generics_basic, 11_interface_basic, 12-17 (advanced generics features)

**Example**:
```lisp
(definterface GenericContainer<T>
    (fn get [] -> T)
    (fn set [val <- T] -> Void))

(defclass Box<T> :implements GenericContainer<T>
    (let :ctor value <- T)
    (fn get [] -> T (return this.value))
    (fn set [val <- T] -> Void (this.value := val)))

;; Runtime type info:
(console.log (type (new Box<Int> 42)))
;; { name: "Box", generics: ["T"], implements: ["GenericContainer"], ... }
```

**Test Results**: ✅ 8/8 generics tests passing (58/92 total), zero regressions

**Known Limitations**:
- Generic type inference from call sites not yet implemented (requires explicit type parameters)
- Generic constraints (`:where T :extends Base`) parsed but not enforced
- Variance modifiers syntax-only (runtime checking planned for future)

---

### Performance Metrics System - Compiler Profiling & Optimization (January 17, 2026)
**Status**: ✅ Complete

Implemented comprehensive performance measurement system for the L-Lang compiler with detailed timing, memory usage tracking, and bottleneck identification:

- **--perf CLI Flag**: Added optional performance tracking flag for all commands (transform, run) with zero overhead when disabled
- **Pass-by-Pass Profiling**: Measures timing and memory usage for all 6 compilation passes (parse, syntax, symbols, desugar, types, codegen)
- **Granular Metrics**: Tracks node count, visitor operations, symbols count, dependencies, and pass-specific metadata
- **Performance Insights**: Identifies bottlenecks, memory-intensive passes, and provides optimization recommendations
- **Colored Reports**: Rich console output with emojis, percentages, and formatted metrics for easy analysis
- **Full Pipeline Integration**: Works with all compilation stages and intermediate outputs (--stage parse/types/etc.)

**Key Implementation Files**:
- [src/compiler/PerformanceMetrics.ts](../src/compiler/PerformanceMetrics.ts) - Complete rewrite with timing, memory tracking, and detailed reporting
- [src/compiler/Context.ts](../src/compiler/Context.ts) - Performance instrumentation around all compilation passes
- [src/compiler/BaseAstVisitor.ts](../src/compiler/BaseAstVisitor.ts) - Visit counting for granular operation tracking
- [src/cli/index.ts](../src/cli/index.ts) - CLI flag support and integration

**Example Usage**:
```bash
# Performance metrics for compilation
ts-node src/index.ts transform --perf examples/00-basics/00_vars.lisp

# Performance metrics with intermediate stage
ts-node src/index.ts transform --perf --stage types examples/09-oop/00_inheritance.lisp

# Performance metrics while running code
ts-node src/index.ts run --perf examples/01-functions/04_pipelines.lisp
```

**Sample Report Output**:
```
🔍 L-Lang Compiler Performance Report
============================================================
📊 Overall Summary
Total compilation time: 55.33ms
Total memory delta: +5.69MB
Total nodes processed: 6
Total visit operations: 877

⏱️ Pass-by-Pass Breakdown
------------------------------------------------------------
PARSE:     45.80ms (82.8%) | +4.25MB | 1 nodes
TYPES:      4.41ms (8.0%)  | +1.98MB | typesInferred: 0
CODEGEN:    2.12ms (3.8%)  | +415.9KB| outputSize: 7986
SYMBOLS:    1.25ms (2.3%)  | +2.30MB | symbolsCount: 5
SYNTAX:     970.2μs (1.8%) | +426.0KB| 83 visits
DESUGAR:    779.6μs (1.4%) | +1.21MB | nodesRemoved: 0

💡 Performance Insights
• Slowest pass: parse (82.8% of total time)
  ⚠️ This pass accounts for over 50% of compilation time
```

**Key Insights Discovered**:
- **Parsing bottleneck**: Parse stage consistently accounts for 60-90% of compilation time, indicating PEG.js grammar optimization opportunities
- **Memory usage patterns**: Symbol table and type inference are most memory-intensive passes
- **Visitor efficiency**: Desugar pass processes most AST nodes per unit time (3.1μs/visit vs 31.1μs/visit for codegen)

**Test Results**: ✅ 50/51 tests passing, zero performance overhead when --perf disabled, full backward compatibility maintained

---

### Spread Syntax in Function Parameters (January 17, 2026)
**Status**: ✅ Complete

Implemented proper support for spread/rest parameters in function definitions:

- **Spread Parameter Syntax**: Functions can now accept variable arguments using `...args <- Type[]` syntax
- **JavaScript Rest Parameters**: Generates correct JavaScript rest parameter syntax (`function name(param, ...args)`)
- **AST Processing**: Updated `JSTransformerAstVisitor.visitParameter` to create `RestElement` nodes for spread parameters
- **Type System Integration**: Spread parameters work correctly through the entire compilation pipeline (parsing → symbols → types → codegen)
- **Template String Support**: Enables advanced string interpolation patterns with variable argument counts

**Key Implementation Files**:
- [src/compiler/codegen/js-estree/visitors/JSTransformerAstVisitor.ts](../src/compiler/codegen/js-estree/visitors/JSTransformerAstVisitor.ts) - RestElement generation for spread parameters
- [lib/std/io/io.lisp](../lib/std/io/io.lisp) - Template string function using spread parameters
- [examples/16-stdlib/01_main.lisp](../examples/16-stdlib/01_main.lisp) - Test cases demonstrating spread parameter usage

**Example**:
```lisp
(fn print [msg <- String ...args <- Any[]] -> Void
    (for :each arg :from (zip args (range 0 args.length 1)) :then (
        (match arg {
            [value index] => (msg := (msg.replace (+ "{" index "}") (value.toString)))
        })
    ))
    (console.log msg)
)

;; Generated JavaScript:
;; function print(msg, ...args) { ... }

;; Usage:
(print "Hello, {0}!" "World")           ;; "Hello, World!"
(print "Format: {0} = {1} + {2}" "result" 2 3)  ;; "Format: result = 2 + 3"
```

**Test Results**: ✅ `examples/16-stdlib/01_main.lisp` now passes with correct spread parameter handling

---

### DefModifier System - User-Defined Function Modifiers (January 16, 2026)
**Status**: ✅ Complete — **contract later replaced by D75** (flat, with a setup slot).
Long-form implementation notes: [`_archive/impl-notes-2026-01.md`](_archive/impl-notes-2026-01.md).

Implemented a complete compile-time metaprogramming system for user-defined function modifiers:

- **DefModifier Syntax**: `(defmodifier name [])` defines custom function transformers applied via `(fn :modifier ...)`
- **Compile-Time Transformation**: Modifiers transform functions during compilation, generating optimized JavaScript with zero runtime overhead for the transformation mechanism
- **Multiple Modifier Support**: Functions can have multiple modifiers applied in sequence: `(fn :logged :memoized :timed ...)`
- **Automatic Memoization**: Current implementation generates memoization logic for all modifiers using Map-based caching with JSON.stringify keys
- **Symbol Table Integration**: Modifier definitions registered as `nodeType: "modifier-def"` with full symbol resolution
- **Type System Integration**: Modifiers processed through type inference pipeline with proper scope management

**Key Implementation Files**:
- [src/compiler/analysis/visitors/BuildSymbolTableAstVisitor.ts](../src/compiler/analysis/visitors/BuildSymbolTableAstVisitor.ts) - Symbol registration and resolution
- [src/compiler/types/visitors/InferTypesAstVisitor.ts](../src/compiler/types/visitors/InferTypesAstVisitor.ts) - Type inference for modifier scopes  
- [src/compiler/codegen/js-estree/visitors/JSTransformerAstVisitor.ts](../src/compiler/codegen/js-estree/visitors/JSTransformerAstVisitor.ts) - Code generation and function wrapping
- [examples/10-modifiers/](../examples/10-modifiers/) - Complete example suite with .expect files

**Example**:
```lisp
(defmodifier memoized [])

(fn :memoized fibonacci [n <- Int] -> Int
    (match n {
        0 => 1
        1 => 1
        _ => (+ (fibonacci (- n 1)) (fibonacci (- n 2)))
    })
)

;; Generated JavaScript:
;; const fibonacci = __ll_modifier_memoized()(function (n) { ... });
```

**Documentation**: Complete implementation guide at [docs/compiler/DEFMODIFIER_IMPLEMENTATION.md](spec/DECISIONS.md)

---

### Compile-Time Evaluation - `:comptime` Modifier (January 16, 2026)
**Status**: ✅ Complete

Implemented Zig-style compile-time evaluation for functions and constants:

- **Comptime Functions**: Functions marked with `:comptime` are evaluated at compile time and their definitions are removed from output
- **VM-Based Evaluation**: Uses Node.js `vm` module to execute transpiled L-Lang snippets in a sandbox
- **Recursive Support**: Handles recursive comptime functions (e.g., factorial, Fibonacci)
- **Dead Code Elimination**: Comptime function definitions are completely removed from compiled JavaScript output
- **Symbol Table Integration**: Tracks `isComptime` flag in symbol metadata for compile-time identification
- **Constant Inlining**: All comptime function calls are replaced with literal values at compile time

**Key Implementation Files**:
- [src/compiler/transformation/visitors/ComptimeEvaluationAstVisitor.ts](../src/compiler/transformation/visitors/ComptimeEvaluationAstVisitor.ts) - VM-based evaluation and AST node removal
- [src/compiler/analysis/SymbolTable.ts](../src/compiler/analysis/SymbolTable.ts) - Comptime metadata tracking
- [examples/11-comptime/00_comptime.lisp](../examples/11-comptime/00_comptime.lisp) - Test case with recursive factorial and addition

**Example**:
```lisp
(fn :comptime factorial [n]
  (if (<= n 1) 1 (* n (factorial (- n 1)))))

(let fact5 (factorial 5))  ;; Compiled to: const fact5 = 120;
;; factorial function definition not present in output
```

---

### Operator Overloading (January 16, 2026)
**Status**: ✅ Complete

Implemented comprehensive operator overloading support for both standalone functions and class/struct methods:

- **Standalone Overloading**: Functions marked with `:operator` are registered in a global `__ll_op_registry` and dispatched at runtime based on argument types.
- **Method Overloading**: Classes and structs can implement operators (e.g., `_2b` for `+`) which are called via dynamic dispatch when used as the left operand.
- **Dynamic Arity Support**: Handles both unary and binary operators (e.g., `-` for negation and subtraction) through arity-suffixed method names (e.g., `_2d_0`, `_2d_1`) to avoid prototype shadowing.
- **Runtime Dispatch Engine**: Updated `+`, `-`, `*`, `/`, and `==` runtime implementations to prioritize registry overloads, then method dispatch, then native JS operations.
- **Symbol Table Metadata**: Added `isOperator` and `operatorSymbol` tracking to `SymbolEntry`.

**Key Implementation Files**:
- [src/compiler/runtime/RuntimeProvider.ts](../src/compiler/runtime/RuntimeProvider.ts) - Global operator registry and revamped operator dispatchers
- [src/compiler/codegen/js-estree/visitors/JSTransformerAstVisitor.ts](../src/compiler/codegen/js-estree/visitors/JSTransformerAstVisitor.ts) - Operator registration hoisting and renaming
- [src/compiler/analysis/SymbolTable.ts](../src/compiler/analysis/SymbolTable.ts) - Operator metadata in symbol table

---

### Type System Extensions (January 3, 2026)
Long-form `deftype`/`defstruct` notes: [`_archive/impl-notes-2026-01.md`](_archive/impl-notes-2026-01.md).
**Status**: ✅ Complete

Added support for user-defined type-aliases and struct types through comprehensive type system extensions:

- **Recursive Type-Aliases**: `deftype Expr (Int | String | Expr)[]` now works correctly
- **Struct Types**: `defstruct vec2` with members and constructors fully supported
- **Type References**: Forward and circular type references properly resolved
- **Symbol Table Integration**: All type information stored in symbol entries

**Key Implementation Files**:
- [src/compiler/analysis/SymbolTable.ts](../src/compiler/analysis/SymbolTable.ts) - Type interface extensions
- [src/compiler/analysis/visitors/BuildSymbolTableAstVisitor.ts](../src/compiler/analysis/visitors/BuildSymbolTableAstVisitor.ts) - Symbol registration
- [src/compiler/types/visitors/InferTypesAstVisitor.ts](../src/compiler/types/visitors/InferTypesAstVisitor.ts) - Type inference implementation
- [src/compiler/types/TypeChecker.ts](../src/compiler/types/TypeChecker.ts) - Type compatibility rules

**Related Documentation**: See [DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md](spec/DECISIONS.md)

---

### Compiler Architecture Refactor (January 2, 2026)
**Status**: ✅ Complete - Phase 2.5

Major reorganization of compiler source code by compilation phase:

**Directory Changes**:
```
Before: src/compiler/visitors/ (flat)
After:  src/compiler/
        ├── frontend/
        ├── analysis/
        ├── transformation/
        ├── types/
        ├── codegen/
        ├── helpers/
        └── ... (organized by phase)
```

**Functional Changes**:
- Introduced `DesugarAstVisitor` for AST transformation (pipelines, implicit returns)
- Extracted runtime helpers into separate modules
- Standardized `ClassBuilder` for class code generation
- Simplified `JSTransformerAstVisitor` to pure codegen

**Compilation Pipeline Now**:
```
Parse → Syntax → Symbols → Desugar → Types → Codegen
                             ↑        ↑        ↑
                       Transform   Infer    Generate
                       Complex   & Check    JavaScript
                       Syntax      Types
```

**Related Documentation**: See [docs/architecture/COMPILER_ARCHITECTURE.md](language-compiler.md)

---

### Type Inference System Fixes (December 2025)
**Status**: ✅ Complete - Priority 4.5

Critical bug fixes for parameter type binding and complex expression type inference:

**Issues Fixed**:
1. Function parameters becoming "Unknown" when referenced in function body
   - Root cause: `BaseAstTreeWalker` double-traversal corrupting scope
   - Solution: Override `visit()` to prevent auto-recursion
   
2. Map type inference not working
   - Solution: Added `case "map"` to `inferExpressionType()`
   
3. Indexer operations (array[i], map[key]) not typed correctly
   - Solution: Implemented proper `case "indexer"` type inference

**Test Results**:
- ✅ [02_fn_types.lisp](../examples/07-types/01_type_reflection.lisp) - Type annotations and parameter resolution
- ✅ [06_flow_control.lisp](../examples/02-control-flow/04_flow_control.lisp) - Flow control with typed parameters
- ✅ [07_memoization.lisp](../examples/20-algorithms/09_memoization_intro.lisp) - Map literals and indexer operations

---

### OOP & Inheritance Implementation (November 2025)
**Status**: ✅ Complete - Priority 4

Proper class inheritance with constructor parameter passing:

**Features**:
- Parent class resolution via symbol table lookup
- Constructor parameter passing with `super(args)`
- Parameter shadowing (local vs inherited parameters)
- Implicit return statements in function bodies
- Complete cleanup of legacy string-based compiler

**Test Example**: [examples/09-oop/00_inheritance.lisp](../examples/09-oop/00_inheritance.lisp)

---

### Module System Fixes (October 2025)
**Status**: ✅ Complete - Priority 2

Fixed circular dependency handling in the module system:

**Changes**:
- Created `ModuleCache` in `Context` for flat module processing
- Refactored `DependencyGraph` from tree-based to cache-based
- Implemented proper symbol inlining with `InlineImportsAstVisitor`
- Fixed path resolution bugs

**Result**: All imported symbols now inline correctly in compiled output

---

### ESTree Code Generation (September 2025)
**Status**: ✅ Complete - Priority 0

Replaced string-based code generation with structured AST approach:

**Changes**:
- Created `JSTransformerAstVisitor` using ESTree nodes
- Integrated `astring` for code generation
- Removed `JSCompilerAstVisitor` and legacy visitors
- Fixed: formatted strings, function scoping, expression context, compound assignments

**Result**: Clean JavaScript AST generation instead of string concatenation

---

### Two-Pass Symbol Analysis (September 2025)
**Status**: ✅ Complete - Priority 1

Implemented forward references with two-pass symbol table:

**Changes**:
- Split `BuildSymbolTableAstVisitor` into `ScanPass` and `ResolvePass`
- Implemented O(1) symbol lookup with lazy cache
- Functions can now be called before definition

**Result**: Proper lexical scoping with forward reference support

---
