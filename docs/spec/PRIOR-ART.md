# Prior art

l-lang's decisions are mostly **chosen** from existing designs rather than invented, and the sources
are worth naming — both to give credit and because a ruling's ancestry is the fastest way to
understand what it is trying to buy.

Extracted from RFC-0001's Appendix E on 2026-07-28, when that document was archived. It is kept
because nothing else in the tree records this: `DECISIONS.md` names a source inside the ruling that
used it, but there is no single page that answers *"where did this language come from?"*

## Language design

| Source | What was taken |
|---|---|
| **Go** | Nominal types with structural interfaces (D42); no `protected` — the implementation-inheritance leak Go and Rust both drop (D11) |
| **C#** | The class surface, generators as `IEnumerable`, LINQ (D33), `string.Format` positional substitution, extension methods (D34) |
| **Rust** | `let` as a binding-immutability rule (D10); the crate as compilation unit (D35) |
| **Zig** | `comptime` as the metaprogramming tier (D3c, D69) |
| **Common Lisp** | The condition system — `restart-case`, `handle`, `signal`, `invoke-restart` (D47) |
| **Scheme** | Considered and *departed from* on naming (D21) |
| **TypeScript** | Union and intersection types; narrowing by type guard (D41) |
| **Swift / Kotlin** | Optionality as a type-level flag rather than a union (D9) |
| **F#** | Units of measure as dimensions on a numeric type (D90) — stopping deliberately short of unit-polymorphic functions |

## Compiler architecture

| Source | What was taken |
|---|---|
| **rustc MIR**, `rustc_codegen_ssa` | A neutral typed core plus per-backend pipelines (D45, D48) |
| **Kotlin IR**, **Swift SIL** | The same shape, arrived at independently — three precedents for one decision |
| **Rustlantis** | Differential fuzzing as the correctness instrument a feature corpus cannot be |
| **Grift / Siek** | Coercions as a distinct checked layer, and blame calculus (D46) |
| **Val / Hylo** | Value semantics as a language rule rather than a convention (D11) |
| **Dart `rti`**, **PureScript** | Erasure and the cost of runtime type checks — PureScript's deleted checks informed refusing the narrowing cast form |

## Runtime and library

| Source | What was taken |
|---|---|
| **Russ Cox, RE1/RE2** | The linear-time matching property targeted by `std/text/regex` (D67) |
| **xoshiro256\*\* / SplitMix64** | The seeded generator behind `std/math/random` (D65) |
| **Ryū**, and shortest-round-trip printing | `Real` rendering (`FLOOR.md` §3.5) |
| **Howard Hinnant, civil-time** | The shape of `std/time/calendar` — proleptic Gregorian, UTC (D78) |
| **C11 §7.13.2.1p3** | The `setjmp` clobber rule — which turned out to affect plain `try`/`catch` too, silently, at any `-O` above zero |
| **JEP 421**, `SafeHandle`, Go's `SetFinalizer`, Rust's `Drop` | Why there are no finalizers, ever (D59) |

## A watch-item worth carrying forward

Recorded during the native-backend design work, and it has held up:

> Several arguments lean on *"LLVM has types, so this gets easier."* It is sometimes **backwards** —
> a native target makes you pay explicitly for things a dynamic runtime gave away for free.
