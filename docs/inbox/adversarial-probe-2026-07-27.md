# l-lang Adversarial Audit — C backend defects & RFC design critique (2026-07-27)

**Method.** Every probe is a minimal, self-contained l-lang program run on both backends via `npx ts-node index.ts run --backend {js,c}` from `src/`. The JS backend is the **oracle** (decision D66): where the two disagree, JS defines the intended behavior and the C result is the defect. Each finding below was independently re-run by a second agent to confirm it reproduces on the pinned tree and is **not** already covered by an existing gap-ledger / dedup entry (D49d int-division, D51 int-wrap-int64, D52 codepoint counting, D82 catchable data-traps, etc.); where a finding sits near such a ruling, the "Why" states precisely why it is out of that ruling's scope. Severities are taken as verified and not inflated: **crash** = process death or emitter/cc abort; **miscompile** = wrong value or wrong control flow silently produced; **divergence** = both backends "work" but observably differ; nothing here is dressed up beyond what the repro shows.

## Scoreboard

| Surface | # findings | Worst severity |
|---|---|---|
| numeric | 5 | crash |
| closures | 4 | crash |
| oop | 3 | crash |
| patterns | 3 | divergence |
| refinements | 2 | crash |
| errors | 2 | crash |
| modules | 2 | crash |
| stdlib | 2 | crash |
| codegen | 2 | crash |
| strings | 2 | miscompile |
| modifiers | 1 | crash |
| value-semantics | 1 | crash |
| **Part I total** | **29** | **crash** |
| Part II — design (RFC/DECISIONS) | 22 | contradiction |

A dominant theme: **native int `/` and `%` are emitted with no divisor guard** (7 of the 29 C findings trace to `EmitCirToC.ts:880-881`), and **`mangleC` / `mangleBare` are not self-delimiting** (6 findings collide distinct source names onto one C symbol). Fixing those two seams closes almost half the C-backend list.

---

## Part I — C backend defects

### numeric

#### Int `/` and `%` by zero: no divisor guard → SIGFPE process-kill at -O0, silent `0` at -O2 (JS throws a catchable error) — `crash`

**Repro**
```lisp
((let a 7)(let b 0)(console.log (/ a b)))
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c <file>`

**Observed (C):** The prescribed `run --backend c` harness (`cc -w`, i.e. -O0 on Darwin ARM64) produces NO stdout and exits 1; the emitted binary is killed by SIGFPE (exit 136 when run directly). Recompiling the SAME emitted translation unit with `cc -w -O2` (the corpus mode) instead prints `0` and exits 0. `(% a b)` behaves identically. The two C optimization levels disagree with each other. • **Expected (JS oracle):** `RangeError: Division by zero` — thrown, and critically **catchable** by l-lang try/catch.

**Why:** `EmitCirToC.ts:880` `case "int": return `(${l} ${e.op} ${r})`` emits raw native int64 `/` and `%` for statically-typed Int/Int with zero divisor guard. The boxed fallback `ll_op_div`/`ll_op_mod` (`runtime.c:2437/2441`) DOES guard, but static Int/Int never routes there. Integer `/0` and `%0` are C UB: clang -O0 traps (SIGFPE), clang -O2 folds the UB to 0. Not covered by `int-division` (D49d) or `int-wrap-int64` (D51) — those cover division-is-integer and overflow-wraps, not the unguarded `/0` crash.

**Fix:** In the `mode:"int"` arm of c-binop, for `/` and `%` emit a guarded form that calls the catchable `ll_trap("DivideByZero", ...)` (per D82 data-traps are catchable) when the divisor is 0, instead of raw `(l / r)`. This also makes the two -O levels agree.

#### Divide-by-zero is uncatchable on C and, at -O2, silently fabricates a garbage result and skips the `catch` entirely — `miscompile`

**Repro**
```lisp
((let x 10)
 (let y 0)
 (try (
    (let r (/ x y))
    (console.log "Result:" r)
 )
 catch err :of Error (
    (console.log "Caught")
 ))
 (console.log "after"))
```
**Command:** `cc -w -O2 emitted.c -o a.out && ./a.out` (vs `npx ts-node index.ts run --backend js <file>`)

**Observed (C):** -O0: SIGFPE — the whole process dies inside the try body, so neither `Caught` nor `after` prints (the setjmp/longjmp handler is never reached). -O2: prints `Result: 140731274663864` (an uninitialized/poison stack value) then `after` — the catch branch is NOT taken and a garbage number is presented as the division result. • **Expected (JS oracle):** `Caught` / `after` (the thrown RangeError is caught by `catch err :of Error`).

**Why:** Same root as the div-guard finding (`EmitCirToC.ts:880`): because the native `/` raises no `ll_trap`, no longjmp fires, so the try/catch machinery is bypassed. At -O0 the raw SIGFPE kills the process; at -O2 the UB divide yields a poison value that flows past the handler. A program that safely catches division errors on JS either crashes uncatchably or silently returns junk on C.

**Fix:** Route native int `/0` and `%0` through `ll_trap`; the existing setjmp/longjmp handler then lands the catch on both -O levels, matching JS.

#### INT_MIN / -1 (and INT_MIN % -1): overflow not wrapped — SIGFPE at -O0, wrong `0` at -O2 instead of the D51 wrap value — `miscompile`

**Repro**
```lisp
((let a -9223372036854775808)(let b -1)(console.log (/ a b)))
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c <file>`

**Observed (C):** `run --backend c` (-O0) produces no stdout and exits 1 (SIGFPE, exit 136 direct). The same emitted TU at `cc -w -O2` prints `0`. `(% a b)` is the same (SIGFPE at -O0, `0` at -O2 — 0 is coincidentally the right modulo answer, but reached via UB). • **Expected (JS oracle):** `-9223372036854775808` (JS masks with `BigInt.asIntN(64)`: INT_MIN/-1 wraps back to INT_MIN).

**Why:** `EmitCirToC.ts:880` native int `/` has no INT_MIN/-1 special-case. INT_MIN/-1 is signed-overflow UB in C — and `-fwrapv` (the D51 wrapping-int64 contract) does NOT cover division overflow, only `+ - *`. So even under the intended flags this traps/miscompiles. The `int-wrap-int64` dedup entry rules that overflow *wraps* to INT_MIN; here C fails to produce that wrap value at all (crash or 0), so it is a hole in that contract, not the documented intentional wrap.

**Fix:** Special-case `a == INT64_MIN && b == -1` in the emitted native `/` (return `a`) and `%` (return `0`), matching the BigInt wrap the oracle produces.

#### hex / octal / binary literals compile and run on C but the JS oracle refuses them (ELL0100) — divergent refusal frontier — `divergence`

**Repro**
```lisp
((console.log 0o17))
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend {js,c} <file>`

**Observed (C):** Prints `15`. (`0xFF` → 255, `0b1010` similarly fold and run.) Digit separators `1_000_000` agree on both backends (1000000). • **Expected (JS oracle):** Refuses: `ELL0100 Cannot generate JavaScript for 'octal-number': visitOctalNumber is not implemented in the JS backend.` RFC-0001 D71 rules hex/octal/binary as "ruled, not built," meeting an LL0100-class refusal — the oracle honors that; C does not.

**Why:** `ResolveHirToCir.ts:2177-2183` handles `hex-number`/`octal-number`/`binary-number` by folding to a c-lit Int, so the C backend silently implements the numeric-tower literal surface the JS oracle refuses. Same source, one backend errors, the other prints a value. C is arguably more correct here, but it violates the D66 oracle-parity contract and the D71 "not built" ruling.

**Fix:** For oracle parity either refuse these on C too (emit the same LL0100-class diagnostic) or implement the visitors on JS; pick one so both backends agree on whether the program is legal.

#### `Number("")` → NaN on C but 0 on JS (empty-string coercion divergence) — `divergence`

**Repro**
```lisp
((console.log (Number "")))
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend {js,c} <file>`

**Observed (C):** `NaN` (identical at -O0 and -O2). • **Expected (JS oracle):** `0`.

**Why:** `runtime.c:2603` `*ok = end && *end == '\0' && s->len > 0;` — the trailing `s->len > 0` clause makes `ll_str_to_double` reject the empty string, so `ll_number` returns NaN. JS `Number("")` (and any whitespace-only string) coerces to 0; `strtod("",&end)` already yields d=0 with `end==buf`, so the length guard is the only thing forcing NaN. The comment just above it even states whitespace strings should coerce like JS.

**Fix:** Drop the `s->len > 0` clause (or special-case `len==0 → ok=true, d=0`). `strtod` on an empty/whitespace-only buffer already returns 0, matching JS `Number()` for `""` and `"   "`.

---

### closures

#### mangleC hex-escape is not self-delimiting: `a-b` and `a_2db` collide onto one C symbol (cc redefinition) — `crash`

**Repro**
```lisp
(
    (let a-b 111)
    (let a_2db 222)
    (console.log a-b a_2db)
)
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c <file>`

**Observed (C):** `Error compiling C code: cc ... error: redefinition of 'u_a_2db'` — `int64_t u_a_2db = INT64_C(222);` collides with the previous `int64_t u_a_2db = INT64_C(111);` (hard cc failure, no executable produced). • **Expected (JS oracle):** `111 222`.

**Why:** `mangleC` (`ResolveHirToCir.ts:52-58`) escapes each non-`[A-Za-z0-9_]` char to `_<hex>` but lets literal underscores and digits pass through unchanged, so the escape is not self-delimiting: `a-b` → `u_a` + `_2d` + `b` = `u_a_2db`, identical to `a_2db` → `u_a_2db`. Two distinct bindings become one C identifier. JS's `encodeIdentifier` keeps them distinct (`a2db` vs `a_2db`). `mangleBare` (line 61) has the identical defect for class/method names.

**Fix:** Make the escape self-delimiting: also escape `_` (e.g. `_5f`, or a delimiter the hex run cannot contain such as `_x2d_`), matching the JS backend's reversible encoding.

#### Closure created inside a loop snapshots a captured module-global mutable by VALUE instead of sharing the cell — `miscompile`

**Repro**
```lisp
(
    (mut fns <- Any[] [])
    (mut i <- Int 0)
    (while (< i 3) (
        (fns.push (fn [] (return i)))
        (i := (+ i 1))
    ))
    (for :each g :from fns :then (console.log (call g)))
)
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c <file>`

**Observed (C):** `0` / `1` / `2`. • **Expected (JS oracle):** `3` / `3` / `3`.

**Why:** C snapshots a loop-created closure's captured module-level mutable BY VALUE instead of sharing one cell. Verified in emitted C: env struct `__ll_env___ll_lam_lam_0 { int64_t u_i; }`, body `int64_t u_i = __e->u_i;`, closure-make `__e->u_i = u_i;` inside the while loop, while module mut `i` is a plain `int64_t` local. Root cause is a gap between two sets in `ResolveHirToCir.ts`: a module-level mut hits `isModuleGlobal` (~line 1075-1076) forcing `cell=false`, yet it is NOT in `globalDeclared`, so the capture guard at line 4086 (`if (this.globalDeclared.has(cName)) continue;`) does not fire and the free var is captured by value. A function-LOCAL mut in the same shape is correctly promoted to a shared cell via `computeCellVars`.

**Fix:** Reconcile the two sets: a module-level mut captured by any closure must either be hoisted to a real file-scope `ll_value*` cell recorded in `globalDeclared` (so line 4086's direct-reference path applies) OR be allowed a heap cell despite `isModuleGlobal`.

#### Under-applied closure reads past argv (OOB), yielding garbage where JS binds nil — `miscompile`

**Repro**
```lisp
(
    (fn apply1 [g] (return (g 7)))
    (fn make [] (return (fn [a b] (return [a b]))))
    (console.log "got:" (apply1 (make)))
)
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c <file>`

**Observed (C):** `got: [7 #<object>]`. • **Expected (JS oracle):** `got: [7 nil]`.

**Why:** Passing the 2-ary closure through the untyped HOF param `g` bypasses the frontend arity check (ELL0211), so the call reaches the boxed convention. `emitLifted` unpacks every fixed param with an unconditional `__argv[i]` (`EmitCirToC.ts:289-290`) and `ll_call` does no arity check (`return c->fn(c->env, argc, argv)`, `runtime.c:573`), so param `b` reads `__argv[1]` past the 1-element argv — an OOB read of stack garbage, boxed and printed as `#<object>` (UB; could equally segfault or leak a live pointer). JS binds the missing param to nil.

**Fix:** Clamp fixed-param unpacking against `__argc` in `emitLifted` (bind `__argv[i]` for `i<argc` else `LL_NIL`), mirroring the existing rest-param clamp, or have `ll_call` zero-fill/short-circuit under-application to nil.

#### Deep non-tail recursion segfaults on C (SIGSEGV) where JS raises a stack-overflow error — `divergence`

**Repro**
```lisp
(
    (fn sum-to [n <- Int acc <- Int] -> Int (
        (if (== n 0) (return acc) (return (sum-to (- n 1) (+ acc n))))
    ))
    (console.log (sum-to 1000000 0))
)
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c <file>`

**Observed (C):** No output; process terminates with SIGSEGV (exit 139). • **Expected (JS oracle):** `RangeError: Maximum call stack size exceeded` (a controlled runtime error).

**Why:** Neither backend does TCO, so deep self-recursion exhausts the stack on both; the FAILURE MODE diverges — the C native stack overflow is an uncatchable SIGSEGV while the JS oracle raises a catchable-shaped RangeError. Lower severity because both fail, but segfault vs controlled error is a robustness divergence at the recursion/stack boundary.

**Fix:** Not clearly a bug given no TCO on either side; if worth hardening, implement TCO for self/mutual tail recursion on C, or install a stack-guard that converts overflow into a catchable `ll_trap`. Alternatively, document the intended contract (uncatchable stack exhaustion on C) to resolve the divergence expectation.

---

### oop

#### Binding a method to a value crashes the C emitter (uncaught `no cast int -> closure`) — `crash`

**Repro**
```lisp
(
  (defclass Doubler
    (fn apply [x <- Int] -> Int (return (* x 2))))
  (let d (new Doubler))
  (let f d.apply)
  (console.log (f 5))
)
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c oop_23.lisp`

**Observed (C):** C codegen aborts with an UNCAUGHT JS exception and a bare stack trace (nonzero exit, no `.c` emitted): `Error: C emit: no cast int -> closure` at `EmitCirToC.ts:977:15` (called from `emitStmt` at `EmitCirToC.ts:443:90`). • **Expected (JS oracle):** `10`.

**Why:** Binding a method reference (`d.apply`) to a value makes InsertCoercions mint a coercion whose (from,to) pair is `int -> closure`. The c-cast blanket-throw in `EmitCirToC.ts` (~line 977: `throw new Error(`C emit: no cast ${e.from.k} -> ${e.to.k}`)`) only hand-lists int↔real / numeric→str / int→bool, so any other minted pair escapes as an unhandled internal exception. The JS oracle runs the same program fine — a clean divergence AND a compiler-robustness defect (raw stack trace, not an ELL error).

**Fix:** Emit a method-reference-to-closure adapter (wrap the bound method in an `ll_closure`, same shape as the deferred floor-fn-as-value fix) so no `X -> closure` coercion is minted; at minimum, route unhandled cast pairs through a proper ELL0106-style diagnostic rather than `throw new Error`.

#### Method C-name join is not injective: two classes collide onto one `__ll_method_*` symbol (cc redefinition) — `crash`

**Repro**
```lisp
(
  (defclass Foo
    (fn bar_baz [] (return "Foo.bar_baz")))
  (defclass Foo_bar
    (fn baz [] (return "Foo_bar.baz")))
  (let a (new Foo))
  (let b (new Foo_bar))
  (console.log (a.bar_baz))
  (console.log (b.baz))
)
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c oop_1.lisp`

**Observed (C):** cc fails: `error: redefinition of '__ll_method_Foo_bar_baz'` and `redefinition of '__ll_method_Foo_bar_baz_dyn'` (2 errors). • **Expected (JS oracle):** `Foo.bar_baz` / `Foo_bar.baz`.

**Why:** Method C names are built as `__ll_method_${mangleBare(class)}_${mangleBare(method)}` (`ResolveHirToCir.ts:601`), and `mangleBare` (`ResolveHirToCir.ts:61`) passes literal `_` through unchanged. The single-underscore join is ambiguous: class `Foo`+method `bar_baz` and class `Foo_bar`+method `baz` both mangle to `__ll_method_Foo_bar_baz`, so both bodies (and `_dyn` adapters) get the same C symbol. The same defect fires within ONE class when an inherited method and an own method collide (verified as oop_18).

**Fix:** Make the class/method join self-delimiting: have `mangleBare` also escape `_` (e.g. `_5f`), or separate the class and method segments with a delimiter that cannot appear in `mangleBare` output, so distinct (class,method) pairs can never alias.

#### mangleC hex-escape is not self-delimiting: `a-b` and `a_2db` collide onto `u_a_2db` (cc redefinition) — `miscompile`

**Repro**
```lisp
(
  (let a-b 111)
  (let a_2db 222)
  (console.log a-b)
  (console.log a_2db)
)
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c oop_9.lisp`

**Observed (C):** cc fails: `error: redefinition of 'u_a_2db'` (`int64_t u_a_2db = INT64_C(222);` vs previous `= INT64_C(111);`, 1 error). • **Expected (JS oracle):** `111` / `222`.

**Why:** `mangleC` (`ResolveHirToCir.ts:52-57`) escapes only characters outside `[A-Za-z0-9_]` as `_<hex>`, leaving literal `_` and hex digits verbatim, so it is not self-delimiting against a source name that already contains an underscore followed by hex digits: `a-b` → `u_a_2db`, and the distinct identifier `a_2db` → the same `u_a_2db`. Two different bindings share one C symbol (or, in value position, silently shared linkage). Value-name analogue of the method-name collision above.

**Fix:** Escape `_` too (e.g. map `_` → `_5f`) so the `_<hex>` escape sequences can no longer be spoofed by a literal underscore adjacent to hex-digit characters; this restores injectivity of `mangleC`.

---

### patterns

#### Non-exhaustive match into a native-typed return flips control flow (C traps a catchable TypeError on nil fall-through; JS propagates nil) — `divergence`

**Repro**
```lisp
(
    (fn f [x <- Int] -> String (
        (match x {
            1 => "one"
        })
    ))
    (try (
        (console.log '"got=[{(f 99)}]")
    )
    catch e (
        (console.log "caught")
    ))
    (console.log "done")
)
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c /path/patterns_24.lisp`

**Observed (C):** `caught` / `done` (exit 0). • **Expected (JS oracle):** `got=[nil]` / `done` (exit 0).

**Why:** A `match` with no matching arm and no `_` yields nil (LL_NIL) on both backends. The enclosing fn is declared `-> String`, so C treats the return channel as native `ll_str*` and inserts an unbox on the fall-through result; `ll_unbox_str(nil)` fires `ll_trap("TypeError","expected a String")` (`runtime.c:635`). Because `ll_trap` TypeErrors are catchable (D82), the surrounding try/catch on C takes the CATCH branch, while JS inserts no return coercion — nil flows through untouched and the SUCCESS branch runs. This is NOT a channel-vs-layout bug: the declared return type IS correctly String; the class is a legitimately-nil value being unboxed at the native return-coercion boundary. Isolation confirmed: with an unannotated (Any) return, both backends return nil and agree.

**Fix:** Make the C non-exhaustive-match fall-through match the oracle: either (a) do not unbox a nil match result against a declared non-nullable native return type (carry the box, mirroring JS), or (b) if a non-exhaustive match should be an error, make BOTH backends raise the SAME diagnostic at the SAME point (a dedicated 'non-exhaustive match' trap at the match site). Root the fix where the match lowering picks its default/fall-through value in `ResolveHirToCir`.

#### Uncaught non-exhaustive match fall-through: C aborts (exit 70) with truncated stdout while JS prints nil and completes — `divergence`

**Repro**
```lisp
(
    (fn f [x <- Int] -> String (
        (match x {
            1 => "one"
            2 => "two"
        })
    ))
    (console.log "before")
    (console.log (f 99))
    (console.log "after")
)
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c /path/patterns_1.lisp`

**Observed (C):** stdout: `before` only, then process exits 70 (the "TypeError: expected a String" line is on STDERR); `after` never prints. • **Expected (JS oracle):** stdout `before` / `nil` / `after`, exit 0.

**Why:** A non-exhaustive `match` yields nil for the unmatched arm. The `-> String` return channel coerces that nil through `ll_unbox_str` (`runtime.c:633-636`), which on a non-LL_STR tag calls `ll_trap("TypeError","expected a String")`. With no handler installed, `ll_trap` (`runtime.c:65-69`) falls through `ll_trap_as_error` and reaches `exit(70)`, killing the process mid-output. JS silently returns nil and completes. The observable divergence (process death + truncated stdout vs full completion) is real; the deeper issue is that neither backend statically rejects the non-exhaustive match, and JS's silent nil is itself arguably unsound.

**Fix:** Reconcile non-exhaustive-match fall-through across backends: ideally reject a non-exhaustive `match` at compile time (or require an explicit catch-all). Absent that, define one agreed fall-through semantics — either both return nil (drop the C return-channel coercion trap for the no-match case) or both trap/throw catchably — so C does not `exit(70)` where JS completes.

#### Int-typed non-exhaustive match: both backends fail but with different error class and exit code — `divergence`

**Repro**
```lisp
(
    (fn f [x <- Int] -> Int (
        (match x {
            1 => 10
            2 => 20
        })
    ))
    (console.log "before")
    (console.log (+ (f 99) 1))
    (console.log "after")
)
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c /path/patterns_17.lisp`

**Observed (C):** `before` / `TypeError: expected an Int` (exit 70, from `ll_unbox_int(nil)`). • **Expected (JS oracle):** `before` / `TypeError: Cannot mix BigInt and other types...` (exit 1).

**Why:** The `-> Int` variant of the same nil-fall-through hits `ll_unbox_int(nil)` (`runtime.c:617` neighbourhood) and traps 'expected an Int' at exit 70; JS propagates nil and only fails later when nil is added to a BigInt Int ('Cannot mix BigInt and other types', exit 1). Both fail, so this is weaker than the String case, but the failure point, error class, and exit code all diverge — a catch filter keyed on error type would behave differently. (Not novel: same class as the other pattern findings.)

**Fix:** Covered by the primary fix — unifying non-exhaustive-match fall-through behavior across backends removes all three manifestations.

---

### refinements

#### `:implicit` defcast from a class to a primitive at an arg-coercion site crashes the C emitter (unhandled `no cast obj -> real`) — `crash`

**Repro**
```lisp
(
    (defclass Celsius (let :ctor degrees <- Real))
    (defcast :implicit [c <- Celsius] -> Real c.degrees)
    (fn ident [x <- Real] -> Real x)
    (let t (Celsius 21.0))
    (console.log "arg:" (ident t))
)
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c <file>`

**Observed (C):** Compiler crash — uncaught JS exception with a bare stack trace, no diagnostic: `Error: C emit: no cast obj -> real` at `EmitCirToC.ts:977:15` (exit 1, mid-emit). • **Expected (JS oracle):** Compiles and runs to completion, exit 0: `arg: Celsius{:degrees 21}` (the implicit cast does not actually fire on JS — the raw object is passed through — but it never crashes).

**Why:** When a Celsius value is passed where a Real param is declared, InsertCoercions records the implicit-defcast coercion, but the C lowering emits it as a primitive c-cast with `from=obj/to=real` instead of a call to the user conversion function. That pair has no arm in the c-cast table, so it falls through to the blanket throw at `EmitCirToC.ts:977`. Root: the implicit defcast is never routed to its conversion-fn call at the coercion point; it is lowered as a raw representation cast.

**Fix:** At the coercion site (P2/InsertCoercions or ResolveHirToCir), when a coercion corresponds to a registered `:implicit` defcast, lower it to a CALL of the generated conversion function (the same lowering `(cast<T> x)` uses) rather than a primitive c-cast. Failing that, the c-cast blanket arm at line 977 should emit an ELL0106/ELL0242-style diagnostic with source location instead of throwing a raw Error.

#### `:implicit` defcast to a primitive used as an arithmetic operand: C refuses (ELL0106) while JS runs and prints garbage — `divergence`

**Repro**
```lisp
(
    (defclass Celsius (let :ctor degrees <- Real))
    (defcast :implicit [c <- Celsius] -> Real c.degrees)
    (let t (Celsius 21.0))
    (console.log "arith:" (+ t 0.5))
)
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c <file>`

**Observed (C):** Compile refusal, exit 1: `ELL0106 Cannot generate C for 'arith-on-obj/real': no CIR lowering exists (binopMode).` • **Expected (JS oracle):** Runs to completion, exit 0: `arith: [object Object]0.5`.

**Why:** Same root cause as the arg-site crash: the `:implicit` defcast Celsius→Real never fires as a conversion at the coercion point. At an arithmetic operand the C backend reaches binopMode with an obj/real operand pair and issues a clean ELL0106 refusal, whereas JS silently string-concatenates the raw object producing the nonsensical `[object Object]0.5`. A genuine stdout divergence: JS compiles+runs, C refuses. (The JS output is itself nonsensical — the RFC says `:implicit` should fire at coercion sites; neither backend actually fires it here — so C's honest refusal is arguably more defensible, but the backends still diverge on an oracle-accepted program.)

**Fix:** Route the implicit defcast to its conversion-fn call before it reaches binopMode/c-cast (see companion finding). Independently, unify the two divergent failure modes for the identical root defect (clean ELL0106 at an arithmetic site vs raw emitter crash at an arg site) so both surface a diagnostic.

---

### errors

#### Native Int division/modulo by zero (and INT_MIN/-1) crashes the C process with SIGFPE — uncatchable by an enclosing try/catch — `crash`

**Repro**
```lisp
(
    (fn safe [a <- Int b <- Int] -> Int (
        (try (
            (return (/ a b))
        )
        catch e :of Error (
            (console.log "caught")
            (return -1)
        ))
    ))
    (console.log (safe 10 0))
    (console.log "after")
)
```
**Command:** `cd src && npx ts-node index.ts run --backend c errors_1.lisp` (JS oracle: `npx ts-node index.ts run --backend js errors_1.lisp`)

**Observed (C):** No stdout at all; the process is killed by SIGFPE (wait-status 136 = 128+8). The surrounding try/catch cannot intercept it. Same crash (exit 136, confirmed by compiling the emitted `.c` and running the binary directly) for `(% a b)` with b=0 and for `(/ -9223372036854775808 -1)` (INT_MIN/-1). • **Expected (JS oracle):** `caught` / `-1` / `after`.

**Why:** `EmitCirToC.ts:880-881` — for `mode:"int"` the binop emits raw `(${l} ${e.op} ${r})`, so `/` and `%` become C `(l / r)` / `(l % r)` with NO divisor-zero guard and NO INT_MIN/-1 guard, both UB → SIGFPE. JS represents Int as BigInt, and BigInt `/0` throws a catchable RangeError. This is a hole in the D82 catchability model: D82 made *data* errors (index-out-of-bounds) throw a catchable `ll_trap` instance, but division-by-zero was never routed through `ll_trap`, so it stays a fatal, uncatchable crash. Internally inconsistent with the runtime's own boxed `ll_op_mod`, which deliberately guards `b.as.i != 0`.

**Fix:** Guard the native int `/` and `%` emission: before dividing, check for a zero divisor (and the INT_MIN/-1 special case) and raise the catchable data-error trap (the same `ll_trap` path D82 uses), so a `try/catch` can recover exactly as on JS. Cleanest is to route native int `/`,`%` through a runtime helper `ll_idiv`/`ll_imod` that performs the checks, instead of emitting a bare C operator at `EmitCirToC.ts:881`.

#### Boxed (Unknown-typed) Int division/modulo by zero silently yields Infinity/NaN on C — the catch clause never fires — `miscompile`

**Repro**
```lisp
(
    (fn g [a b] (
        (try (return (/ a b)) catch e :of Error (console.log "caught") (return -1))
    ))
    (console.log (g 10 0))
    (console.log "after")
)
```
**Command:** `cd src && npx ts-node index.ts run --backend c errors_21.lisp` (JS oracle: `npx ts-node index.ts run --backend js errors_21.lisp`)

**Observed (C):** `Infinity` / `after` (the division produces IEEE +Infinity; the `catch` clause is dead code on C and never runs). The `%` variant with b=0 prints `NaN` / `after` the same way. • **Expected (JS oracle):** `caught` / `-1` / `after`.

**Why:** When operands are statically Unknown (untyped params), the checker routes `/` to the boxed runtime op. `runtime.c:2437-2439` `ll_op_div` does floating-point division `ll_box_real(ll_as_num(a) / ll_as_num(b))` with the comment `/* JS: division always yields a Real */` — but that comment is wrong for Int/Int: JS represents Int as BigInt, does integer division (D49d), and BigInt `/0` THROWS a RangeError. So C returns +Infinity where JS throws. `ll_op_mod` falls through to `fmod(...)` for a zero divisor, returning NaN. The boxed path never raises, so a surrounding `try/catch` that recovers on JS becomes unreachable on C — a silent divergence in both value and control flow. Distinct root cause and symptom from the native-path SIGFPE crash (that path dies; this path silently succeeds with a wrong value).

**Fix:** In `ll_op_div` / `ll_op_mod` (`runtime.c` ~2437-2443), when both operands are Int and the divisor is 0, raise the catchable data-error trap (`ll_trap`) to mirror JS's thrown RangeError and D82's catchable model, instead of returning IEEE Infinity/NaN. This fix and the native-path fix should agree on the same catchable error so typed and untyped operands behave identically.

---

### modules

#### mangleC hex-escape is not self-delimiting: source names `a_2db` and `a-b` collide onto one C symbol → cc `redefinition` crash — `crash`

**Repro**
```lisp
(
    (fn a_2db [] -> Int (return 111))
    (fn a-b [] -> Int (return 222))
    (console.log (a_2db))
    (console.log (a-b))
)
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c /path/modules_5.lisp`

**Observed (C):** `Error compiling C code: cc ... error: redefinition of 'u_a_2db'` (`static int64_t u_a_2db(void)` defined twice; process exits 1, nothing runs). • **Expected (JS oracle):** `111` / `222`.

**Why:** `ResolveHirToCir.ts:52-56` `mangleC` does `name.replace(/[^A-Za-z0-9_]/g, ch => `_${ch.codePointAt(0).toString(16)}`)`. Because `_` and digits pass through unchanged, the hex escape is not self-delimiting: `a_2db` → `u_a_2db`, and `a-b` (`-`→`_2d`) → `u_a_2db`. Both names compile fine in isolation (verified: `a-b` alone → 222 on C), so it is purely the collision that trips cc. Same defect predicted for `mangleBare` (`ResolveHirToCir.ts:61-62`). Cross-module the per-module aliasing masks it (peer imports get `#2` suffixes and do NOT collide — verified), so it is confined to two colliding names inside ONE module.

**Fix:** Make the escape self-delimiting: escape `_` itself (and/or use a delimiter that cannot appear in the payload), e.g. map `_` → `_5f` in `mangleC`/`mangleBare` so `a_2db` and `a-b` produce distinct symbols (`ResolveHirToCir.ts:56` and `:62`).

#### Kebab-case class name interpolated raw into C symbol positions (`__ll_class_Shape-2d`) → malformed C, cc rejects (SHARED gap: JS emitter also fails) — `crash`

**Repro**
```lisp
(
    (defclass Shape-2d
        (fn area [] -> Int (return 42)))
    (let s (new Shape-2d))
    (console.log (s.area))
)
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c /path/modules_9.lisp`

**Observed (C):** cc errors (4, exit 1): `static const ll_method_entry __ll_methods_Shape-2d[] = ...` expected `;` after top level declarator; `static ll_class __ll_class_Shape-2d = ...` same; `&__ll_class_Shape-2d` in the registry → invalid digit 'd' in decimal constant; `ll_obj_new(&__ll_class_Shape-2d, 0, (ll_value*)0)` → invalid digit 'd'. • **Expected (JS oracle):** JS ORACLE ALSO FAILS: ELL0101 at emitted line `class Shape-2d {` — 'a bug in the code generator, not the source'. So NOT a C divergence; both backends' codegens mishandle a frontend-accepted kebab class name. Flagged as a shared codegen gap, surfaced via the standalone 'cc compile error = candidate bug' rule.

**Why:** `EmitCirToC.ts` interpolates raw `c.name`/`e.className` into C identifier positions: 132/134 `__ll_fields_`, 138 `__ll_methods_`, 145 `__ll_ifaces_`, 155 `static ll_class __ll_class_`, 163 registry `&__ll_class_`, 982-983 `ll_obj_new(&__ll_class_)`. Comment 149-152 acknowledges kebab-case is not a C identifier, but the C-safe tag is only ensured for the generator path (sourceName/synthesized tag); a plain `defclass` lands the source name raw. The `2d` after the hyphen additionally triggers 'invalid digit d in decimal constant'.

**Fix:** Give EVERY class a C-safe `c.name` tag (`mangleC`/`mangleBare`) with the human name kept in sourceName/display, so all `__ll_class_`/`__ll_methods_`/`__ll_ifaces_`/`__ll_fields_`/registry positions and `ll_obj_new` see the mangled tag (`EmitCirToC.ts:132,134,138,145,155,163,982-983`). To fully close the shape the JS emitter's `class ${name}` needs the same mangling (it fails with ELL0101 too) — OR, if kebab class names are meant to be illegal, reject them at the frontend.

---

### stdlib

#### Int division/modulo by zero SIGFPEs on C (uncatchable, defeats try/catch) where JS throws a recoverable RangeError — `crash`

**Repro**
```lisp
(
  (let a 7)
  (let b 0)
  (try
    (console.log "result:" (/ a b))
   catch e (console.log "caught:" (e.message)))
  (console.log "survived")
)
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c strings_11.lisp` *(as recorded)*

**Observed (C):** No output at all. The raw compiled binary aborts with SIGFPE (exit 136); run under the `run` wrapper (`cc -w`, `command.run.ts:68`) it exits 1 with empty stdout. The try/catch does NOT catch it and 'survived' never prints. Emitted C is `ll_box_int((u_a / u_b))` with `u_b = 0` — a raw hardware divide, so setjmp/longjmp can never intercept the trap. `(% a b)` behaves identically. • **Expected (JS oracle):** `caught: Division by zero` / `survived` (JS throws a catchable RangeError whose `.message` is 'Division by zero', confirmed via `e.constructor.name = RangeError`).

**Why:** `EmitCirToC.ts:876` case 'c-binop', mode 'int' returns `(${l} ${e.op} ${r})` at line 881 — a raw C `/`/`%` with no divisor guard. Integer division by zero is C UB and traps as SIGFPE, killing the process below the l-lang error tower. Notably the same c-binop's real mode routes `%` through fmod and its boxed mode routes through `ll_op_div`/`ll_op_mod` — only the unboxed int fast-path skips a guard. The JS backend routes Int math through BigInt, which throws a catchable RangeError. Not in the dedup index (int-division/D49d is semantics-only; data-trap-catchable/D82 never covered arithmetic div-by-zero).

**Fix:** In `EmitCirToC.ts` c-binop int-mode, emit a guarded form for `/` and `%` (e.g. runtime helpers `ll_idiv(l,r)`/`ll_imod(l,r)` that raise a catchable `ll_trap` on `r==0`), matching the JS backend's throwing semantics — and matching what real-mode and boxed-mode already do.

#### INT_MIN / -1 (and INT_MIN % -1) crash C with a NONZERO divisor; JS wraps to a defined value and continues — `crash`

**Repro**
```lisp
(
  (let a -9223372036854775807)
  (let b -1)
  (let c (- a 1))
  (console.log "before")
  (console.log (/ c b))
  (console.log "after")
)
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c <file>`

**Observed (C):** SIGFPE crash (binary exit 136; `run` wrapper exit 1). No output — the buffered `before` line is lost. Emitted C is `ll_box_int((u_c / u_b))` where `u_c=INT64_MIN`, `u_b=-1`; the quotient +2^63 is not representable in int64 and the CPU raises the same divide-overflow trap as divide-by-zero. UB even under `-fwrapv` (the run harness uses plain `cc -w` with no `-fwrapv` anyway). • **Expected (JS oracle):** `before` / `-9223372036854775808` / `after`.

**Why:** Same root as the divide-by-zero finding — `EmitCirToC.ts:880` emits an unguarded native int64 `/`/`%`. Sharper because the divisor is nonzero (-1), so a naive `r==0` guard would miss it, and both operands can be runtime-derived. JS's BigInt path computes 2^63 then `BigInt.asIntN(64, ...)` wraps to INT64_MIN and keeps running; C traps and dies. Flagged in the soft-target seam map ('INT_MIN/-1 ... also UB'); not covered by the D51 int-wrap dedup, which is about `+/-/*` wraparound, not division-overflow.

**Fix:** Guard int-mode `/` and `%` against both `r==0` and the (INT_MIN, -1) pair in the same `ll_idiv`/`ll_imod` helper; for INT_MIN/-1 return INT_MIN (two's-complement wrap) to match the JS `BigInt.asIntN` result, or raise a catchable trap — either way, don't emit the bare hardware divide.

---

### codegen

#### Int division/modulo by zero is an uncatchable SIGFPE process crash on C, even inside try/catch (and INT_MIN/-1 traps where JS wraps) — `crash`

**Repro**
```lisp
(
  (let a 10)
  (let b 0)
  (try (console.log (/ a b)) catch e (console.log "caught"))
  (console.log "after")
)
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c <file>` *(empty stdout, process dies with SIGFPE)*

**Observed (C):** C binary (default `cc -w`, i.e. -O0) terminates by SIGFPE — direct binary exit code 136 — for `(/ a 0)`, `(% a 0)`, and INT_MIN/-1. A wrapping try/catch does NOT recover: the setjmp/longjmp machinery cannot intercept the hardware signal, so the program prints nothing and dies. Through the `run` wrapper the reported exit is 1, not 136 (`command.run.ts:82` `runError.code ?? 1` maps a signal-null to 1). At `-O2` the same emitted `.c` silently prints `0` and exits 0 (UB folded away) — a silent miscompile rather than a crash. • **Expected (JS oracle):** For `(/ a 0)`/`(% a 0)` JS raises a catchable RangeError ("Division by zero") and, wrapped in try/catch, prints `caught` / `after`. For INT_MIN/-1 JS does NOT throw — it WRAPS to `-9223372036854775808` and prints it. So INT_MIN/-1 is a value-vs-crash divergence, while by-zero is a throw-vs-crash divergence.

**Why:** `EmitCirToC.ts:876-881`: the c-binop "int" mode arm returns `(${l} ${e.op} ${r})` for both `/` and `%` with NO divisor-zero or INT_MIN/-1 guard (the "real" arm routes `%` through fmod but that arm too is unguarded — `fmod` by 0 is NaN, harmless). Signed divide-by-zero and INT_MIN/-1 are C UB → SIGFPE at -O0; `-fwrapv` does NOT rescue division overflow. The signal cannot be intercepted by setjmp/longjmp, so a program that recovers on JS is an unrecoverable process kill on C.

**Fix:** In the c-binop "int" arm for `/` and `%`, emit a guarded helper (`ll_idiv`/`ll_imod`) that checks `divisor==0` and routes to the catchable D82 `ll_trap` ArithmeticError path (matching JS's throwable RangeError). For INT_MIN/-1, WRAP to INT_MIN rather than throwing, to match the JS/`-fwrapv` oracle value.

#### mangleC hex-escape is not self-delimiting: `a-b` and `a_2db` collide onto one C symbol — silent wrong answer, or cc redefinition error — `miscompile`

**Repro**
```lisp
(
  (let a-b 111)
  (fn f [a_2db <- Int] -> Int (+ a-b a_2db))
  (console.log (f 5))
)
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c <file>`

**Observed (C):** Prints `10`. The C emitter mangles source name `a-b` to `u_a_2db` (`-`→`_2d`) and parameter `a_2db` ALSO to `u_a_2db`. Emitted: `static int64_t u_a_2db = 0;` (the global) and `static int64_t u_f(int64_t u_a_2db) { return (u_a_2db + u_a_2db); }` — inside `f` the parameter shadows the global, so `a-b` silently reads the parameter (5) instead of 111, giving 5+5=10. A same-scope variant `((let a-b 111) (let a_2db 222) (console.log a-b a_2db))` instead fails cc with `error: redefinition of 'u_a_2db'`. • **Expected (JS oracle):** `116` (JS keeps `a-b=111` and `a_2db=5` distinct; the two-binding variant prints `111 222`).

**Why:** `ResolveHirToCir.ts:56` `mangleC` does `name.replace(/[^A-Za-z0-9_]/g, ch => `_${hex}`)` — literal underscores and digits in the source name are NOT escaped, so the escape is not self-delimiting: `a-b`→`u_a_2db` and `a_2db`→`u_a_2db` are indistinguishable. Depending on scope this is either a silent wrong binding (nested case, no diagnostic at all) or a cc-level `redefinition` compile failure (same-scope case). Distinct from the known cross-module/flat-namespace collision entries, which are about module-private aliasing, not intra-module identifier encoding.

**Fix:** Make the escape self-delimiting: escape `_` itself (and/or use a delimiter the passthrough charset cannot produce, e.g. `_x<hex>_`) in both `mangleC` (line 56) and `mangleBare` (line 62) so no two distinct source names can ever map to the same C identifier.

---

### strings

#### Embedded NUL in a string LITERAL truncates the whole string on the C backend (`ll_str_lit` uses `strlen`) — `miscompile`

**Repro**
```lisp
(
    (let s "x\x00y\x00z")
    (console.log s.length)
    (console.log (s.indexOf "z"))
)
```
*(The probe uses literal U+0000 bytes between the letters; `\x00` is the equivalent escape the front-end unescaper accepts, and both forms reproduce.)*

**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c strings_11.lisp`

**Observed (C):** `1` / `-1`. • **Expected (JS oracle):** `5` / `4`.

**Why:** The front-end unescaper (`AstBuilder.ts:424-427`) turns `\0` / `\x00` into a real U+0000 char in the compile-time string, and the C emitter's `cEscape` (`EmitCirToC.ts:65`) faithfully emits it into the C literal as the octal byte `\000`. But that literal is wrapped by `ll_str_lit`, defined at `runtime.c:219` as `ll_str_from(cstr, strlen(cstr))` — `strlen` stops at the first NUL, so the `ll_str` is built with a truncated length even though the `ll_str{len,data}` repr can hold NULs. So `"x\0y\0z"` becomes just `"x"` (length 1). This is NOT the documented D52 codepoint divergence — it is a distinct byte-length-vs-strlen bug confined to the literal path. Isolation proof: the RUNTIME codepoint path preserves NUL correctly — `(string-from-codepoints [97 0 98])` gives length 3 / `indexOf("b")=2` on BOTH backends.

**Fix:** Give string literals an explicit byte length instead of recovering it with `strlen`. Emit `ll_str_lit_n("x\000y\000z", 5)` (the emitter already knows the UTF-8 byte length via `Buffer.byteLength`) and define `ll_str_lit_n(const char* p, size_t n){ return ll_str_from(p, n); }`. `cEscape` already round-trips every byte including `\000`, so only the length source needs fixing.

#### Two DISTINCT strings sharing an embedded-NUL prefix compare EQUAL on C (silent, security-relevant) — `miscompile`

**Repro**
```lisp
(
    (let a "secret\x00admin")
    (let b "secret\x00guest")
    (console.log (== a b))
)
```
*(Literal U+0000 between `secret` and the suffix; `\x00` shown for legibility.)*

**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c strings_13.lisp`

**Observed (C):** `true`. • **Expected (JS oracle):** `false`.

**Why:** Direct consequence of the same `ll_str_lit`/`strlen` truncation (`runtime.c:219`): both literals truncate to `"secret"` at the first NUL, so string equality sees two identical 6-byte strings and returns true, while JS keeps the full 12-code-unit strings and returns false. Reported separately because the failure mode is worse than a wrong length: it is a silent equality collision — any auth token, path, key, or dedup check carrying a NUL past the sixth byte aliases to a different value on the C target with no error. Not covered by any known-issues entry (D52 concerns codepoint COUNTING, not NUL truncation or equality).

**Fix:** Fixed by the same change as the previous finding — carry the literal's true byte length into `ll_str_lit_n` instead of recovering it with `strlen`; once the `ll_str` holds the full bytes the existing byte-wise equality distinguishes them.

---

### modifiers

#### Stacked (2+) `defmodifier` decorators using `...args` trap at runtime on C (`ll_unbox_vec` on a non-vector, exit 70) while JS composes them correctly — `crash`

**Repro**
```lisp
(
  (defmodifier a [] (fn [original ...args] (original ...args)))
  (defmodifier b [] (fn [original ...args] (original ...args)))
  (fn :a :b f [n <- Int] -> Int (return n))
  (console.log "f(5):" (f 5))
)
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c <file>` (vs `--backend js`)

**Observed (C):** `TypeError: expected a Vector` (process exits 70 via `ll_trap`; nothing printed). • **Expected (JS oracle):** `f(5): 5`.

**Why:** The D75 static decorator unfold (`ResolveHirToCir.ts:3480` `collectDecorated` / `3515` `emitLayer`) lowers each decorator layer to a C function whose `...args` rest param is one packed vec (`registerTopLevel` VEC_OF_VALUE, restAt=0, lines 3566/3584). A layer's body `(original ...args)` is lowered as a SPREAD call: `ll_call_spread(original, 1, (int[]){1}, {ll_box_vec(u_args)})` (`EmitCirToC.ts:867`), which UNPACKS the args vec into positional argv. `original` is the previous layer bound as a closure VALUE (`emitLayer:3540-3542`), invoked through its boxed adapter. But the boxed adapter (`EmitCirToC.ts:318-330` `emitAdapter`) is emitted from an adapter record that carries only `{forCName, params, ret, arity}` and NO `restAt` (`ResolveHirToCir.ts:113` and the registration at 2840), so it blindly emits `u_f__w1(ll_unbox_vec(__argv[0]))`. After the outer layer spreads `[5]` into individual positional args, `__argv[0]` is the boxed Int 5, not the packed rest vec → `ll_unbox_vec` traps (`runtime.c:641`). The OUTERMOST layer is called directly with the packed vec, so its rest-ness is fine — which is why a SINGLE decorator and a fixed-arity stacked pair both work, and only stacking 2+ rest-taking wrappers traps. `packRestArgs` (`ResolveHirToCir.ts:3989`) repacks rest args for DIRECT top-level call sites but the closure/adapter path has no equivalent.

**Fix:** Thread `restAt` into the adapter record (`ResolveHirToCir.ts:113/2840`) and have `emitAdapter` (`EmitCirToC.ts:318`) repack the variadic argv into the rest vec for a `restAt` function — e.g. bind fixed params from `__argv[0..restAt)` and pass `ll_list(__argc-restAt, __argv+restAt)` as the trailing vec — instead of `ll_unbox_vec(__argv[0])`. Alternatively, `emitLayer` should not lower `(original ...args)` as a spread when `prev` is itself a rest-taking wrapper, and should hand the packed args vec directly.

---

### value-semantics

#### Deep structural equality (`==` / `ll_deep_eq`) has no cycle guard or pointer-identity short-circuit: a self-referential vector or map segfaults the C backend where JS returns true — `crash`

**Repro**
```lisp
(
    (mut v [1 2])
    (v.push v)
    (console.log "before eq")
    (console.log (== v v))
    (console.log "after eq")
)
```
**Command:** `cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend js <file>` (before/true/after) ; `npx ts-node index.ts transform --backend c -o /tmp/b <file> && cc -O0 -fwrapv -o /tmp/bin /tmp/b/<file>.c && /tmp/bin ; echo $?` (→ 139, SIGSEGV)

**Observed (C):** C process crashes with SIGSEGV (exit 139) and prints NOTHING — not even the "before eq" line (stdout is block-buffered when not a TTY, so the pending buffer is lost when the stack overflows). Via `run --backend c` the harness reports a bare exit 1 with empty output; compiling the emitted `.c` directly gives exit 139. A self-referential MAP (`(mut m {}) (m.self := m) (== m m)`) crashes identically (exit 139). • **Expected (JS oracle):** `before eq` / `true` / `after eq` (JS returns true and never crashes — it short-circuits on reference identity or carries a visited-set).

**Why:** `ll_deep_eq` in `runtime.c:1219` recurses element-wise into containers — vectors at 1241, maps at 1251, objects at 1263 — with (a) NO `a.as.v == b.as.v` pointer-identity short-circuit at the container arms and (b) NO visited-set / depth guard. A container that transitively holds itself drives infinite recursion → C stack overflow → SIGSEGV. Reachable TODAY because vectors and maps are mutable reference types that can contain themselves, unlike structs which cannot self-hold by value. Not in the dedup index; the seam map only flagged `ll_deep_eq`'s quadratic map cost and the `ll_copy` cycle hazard (not constructible today) — this crash on ordinary mutable containers is a distinct, reachable case.

**Fix:** At the top of `ll_deep_eq` add a pointer-identity short-circuit for the container tags — `if (a.tag==b.tag && (a.tag==LL_VEC||a.tag==LL_MAP||a.tag==LL_OBJ) && a.as.v==b.as.v) return true;` (covers the self-compare, matching JS). For two DISTINCT mutually-cyclic structures, thread a visited-pair set (or a recursion-depth cap that converts to a catchable `ll_trap`) through `ll_deep_eq` so a cyclic graph terminates instead of overflowing the C stack.

---

## Part II — Language / RFC design critique

This section is deliberately kept separate from the backend defects. Each item is a documentation- or design-level issue in RFC-0001 / DECISIONS.md, not a runtime bug. Grouped by kind. Severity is not implied by ordering.

### Contradiction

**Bounded generics: the constraint keyword is spelled four incompatible ways, and §5.5's example uses `:of` — which §5.6 explicitly reserves against for type-level bounds** (§5.5 Generics / §5.6 Type guards / §5.9 Protocols)
*Claim:* §5.5 writes a generic bound as `:where T :of Comparable`, but §5.6 rules that `:of` is the value-level test and `:is` is reserved for type-level bounds; a type-parameter bound is a type-level bound, so §5.5's own example contradicts §5.6. DECISIONS.md compounds this by spelling the bound four different ways. *Evidence:* §5.5 line 938 `:where T :of Comparable`; §5.6 line 989 "`:of` is the value-level test; `:is` is reserved for type-level bounds. They are not aliases." DECISIONS.md line 106 `:where T :extends`; line 983 `:where T :inherits Base`; line 2453 `:where T :of Comparable`; line 2857 `:where T :is class` (D27). DECISIONS line 2456 says the grammar's real constraint keyword set is `implements | inherits | is | has` and "`:of` is not even a constraint keyword." *Impact:* §5.9 ships `Comparable<T>`/`Hashable`/`Formattable` as the interfaces that drive sorting/hashing, but the mechanism to require one on a generic — a bound — has no agreed spelling and, per DECISIONS 2453, "does not parse in grammar_v2 at all." The most ordinary generic (`(fn sort<T> [xs <- T[]] ...)` needing `T : Comparable`) cannot express or check its constraint. §5.5 already files this under 'Known holes' and calls it 'a bug rather than a missing feature', so it is NOT presented as working; the defect is the keyword inconsistency. *Suggestion:* Pick one keyword — D27 implies `:is` for a type-level bound — and correct §5.5 from `:of` to `:is`. Reconcile the four DECISIONS spellings against the grammar's actual keyword set, and cross-reference §5.9.

**No substring `replace` (literal or regex) exists — yet FLOOR advertises it as on-the-floor / built** (§11.2 / §12.2 std/core/string / §12.5 regex)
*Claim:* FLOOR.md presents `replace` as pure l-lang 'on the floor' under an 'As built (Phase F)' heading — yet FLOOR's own Ff-2 amendment says `replace` is 'deliberately still missing,' RFC §12.2's std/core/string export table omits it, and §12.5 says the regex captures 'which replace and split need before they can be real' are 'not built.' (index-of is a weaker case: absent only for substrings — it IS exported by std/seq per §12.2 L2247.) *Evidence:* FLOOR.md L85-86 lists `replace` under std/string; Ff-2 amendment L222-223 says `replace` would import JS's `$&/$1/$$` syntax "which C's `ll_str_replace` does not have. Both need their own ruling." §12.2 L2241 std/core/string: no `replace`. §12.5 L2359: "Not built... captures — which replace and split need before they can be real." *Impact:* There is no substring replace in l-lang: not literal (absent from std/core/string) and not regex (captures unbuilt). A programmer trusting FLOOR's on-the-floor list writes code against `replace` and gets an unresolved-name error. Search-and-replace is table stakes for text munging. *Suggestion:* Rule the `replace` replacement-string semantics (blocked only on choosing JS `$1` vs. a plainer form), ship it, and reconcile FLOOR.md's 'as built' list with its own Ff-2 amendment. Until then, mark `replace` explicitly unbuilt in the §12.2 table the way §12.5 marks the regex gaps.

**How-done-is-this is unanswerable: the corpus pass/size numbers contradict between the §13 body and Appendix C** (§13.3 vs §13.6 vs Appendix C.1/C.2)
*Claim:* The document's central 'is it real?' metric — corpus size and C pass count — is stated in two mutually exclusive states. *Evidence:* §13.3 (line 2427): "Status: Built — 203 of 270 corpus programs." §13.6 (line 2535): "Built. 270 programs, 222 goldens." Appendix C.1 (line 2820): "The C11 backend — Built — 223 / 299 corpus programs." Appendix C.2 (line 2835): "C11 — 223 of 299 corpus programs pass." So the corpus total is simultaneously 270 (§13) and 299 (Appendix C), and the C pass count is simultaneously 203 (§13.3) and 223 (Appendix C). The two blocks are each internally consistent, and the '222' in §13.6 is a goldens count (a different metric) — so this is a two-way §13-vs-Appendix-C contradiction, not three. *Impact:* The single number a prospective user most wants — what fraction actually works on the supported backend — has no consistent answer (203/270 vs 223/299; the ratio coincidentally both ≈75%, but the absolute counts differ by 29 total / 20 passing). It undermines the document's own credibility discipline ("a specification that cannot be distinguished from a wishlist is useless"). *Suggestion:* Pick the current numbers from the ratchet at the pinned commit and use them in both §13 and Appendix C, or replace every inline count with a single line the corpus runner emits — the same 'do not capture, derive' logic the RFC applies to goldens.

**Appendix C.1 labels async "Built on JS" — reusing the §0.2 reserved marker "Built" for a feature the vocabulary places in the separate "Compatibility-only — JS" class** (§9.4 / Appendix C.1 vs §0.2)
*Claim:* §0.2 reserves "Built" for features implemented on the supported backend (C), and gives async its own dedicated marker, "Compatibility-only — JS." §9.4 correctly uses that marker. But Appendix C.1's table renders async "Built on JS; refused on C (D60)," reusing the reserved word "Built" for a status the vocabulary excludes from it. *Evidence:* §0.2 line 45: "Compatibility-only — JS | Exists on the deprecated backend and is refused on C. Not available on the supported target." §9.4 line 1792 matches. Appendix C.1 line 2812: "| :async / await | Built on JS; refused on C (D60) |" — and C.1 uses exact markers elsewhere (e.g. "Built — C only" on line 2810), so this is a real marker slip. *Impact:* A reader skimming only the C.1 status table sees the reserved word "Built" next to async and may read it as a supported-backend feature, when the sole supported target (C, per D66) refuses it (LL0105). The refusal is not hidden (the same cell says "refused on C"), so the harm is a labeling ambiguity for a table-only skim. *Suggestion:* Change the entry to the exact §0.2 marker "Compatibility-only — JS; refused on C (D60)."

**The "cannot drift" grammar has drifted: §3.2 octal terminal is the exact dangerous form §2.3 brags about deleting, and no numeric terminal shows the D71 digit separator** (§3 intro, §3.2, §2.3)
*Claim:* §3 opens: the grammar is "generated from the parser… guaranteed to describe the parser that ships, not a parallel document that drifts." §2.3 then says the octal lexer "is now `/0o[0-7]+/`" and that digit separators let `1_000_000`, `0xDEAD_BEEF`, `0o1_7` lex (D71). *Evidence:* §3.2 still prints `<OctalNumber> ::= /0[0-7]+/` — the bare leading-zero form §2.3 says was removed as LL0030. The shipped token (`tokens.ts:330-333`) is `/0o[0-7]+(?:_[0-7]+)*/`. Likewise §3.2 prints `<IntegerNumber> ::= /[+-]?[0-9]+/` and `<HexNumber> ::= /0x[0-9a-fA-F]+/` with NO `_` group, while the shipped tokens carry `(?:_[0-9]+)*`. Read literally, `1_000_000` does not lex. *Impact:* A reader who trusts the RFC's own guarantee and works from §3.2 concludes `017` is legal octal (it is a hard error) and that `1_000_000` is illegal (it is legal). *Suggestion:* Regenerate §3.2's terminal block from `tokens.ts` as part of `grammar:ebnf`, or state plainly that §3.2 terminals are illustrative and `tokens.ts` governs. At minimum fix the octal and digit-separator regexes.

**The canonical `f"…"` interpolation prefix is absent from the grammar terminal, which only admits `'"`** (§2.4, §3.2)
*Claim:* §2.4's prefix table lists `f"…"` as "a formatted (interpolated) string" and demotes `'"…"` to "the formatted string's retained alias" — i.e. `f"` is primary. *Evidence:* §3.2's generated terminal is `<FormattedStringStart> ::= /'"/` — no `f`. The shipped token (`tokens.ts:376-379`) is `/(?:'|f)"/`. Taken at face value `f"Hello, {name}!"` lexes as the identifier `f` applied to a plain, non-interpolated string — a different program. *Impact:* Someone reading the grammar to write a highlighter or formatter will treat `f"…"` as broken and `'"…"` as the only interpolation, which is backwards from what §2.4 teaches as idiomatic. *Suggestion:* Update the §3.2 terminal to `/(?:'|f)"/`. Same root cause as the octal drift: the terminal block is a hand-maintained parallel document.

**Escape set diverges between plain and interpolated strings at the lexer: `"\x41"` lexes, `f"\x41"` is a lex error, and no escape table is specified** (§2.4, §3.2)
*Claim:* §2.4 (line 275) states only that plain strings are "double-quoted with backslash escapes"; no escape/decode table is given anywhere in §2.4. *Evidence:* Plain `<StringLiteral> ::= /"(?:[^"\\]|\\.)*"/` (line 563) accepts `\\.` — ANY escaped char. Interpolated `<StringContent>` (line 562) accepts only a fixed whitelist (`\" \\ \/ \b \f \n \r \t \u \{`). So `"\x41"`, `"\p"`, `"\0"`, and `"\}"` all lex as plain strings but fail as `f"…"`/`'"…"`; the whitelist includes `\{` but omits `\}`. (Distinct from the separately-recorded runtime gap that plain-string escapes aren't decoded — DECISIONS.md 1329/2344 — a different layer.) *Impact:* The most common real edit — adding one `{expr}` to a message and prefixing it with `f`/`'` — can turn a file that lexed yesterday into a lex error today, for an escape the plain form quietly accepted. And the accepted set is never written down, so users can't predict which escapes lex. *Suggestion:* Specify the canonical escape table once in §2.4 and make both terminals use it (add `\}` if `\{` is escapable), and decide/document what an unknown escape does.

### Underdelivers

**Compound-assignment surface is inconsistent across D2, §2.2, the lexer, and the parser; `**=` silently miscompiles and four `?=` tokens are dead** (§2.2, §2.3, §3.2)
*Claim:* §2.2's table lists compound assignment as exactly `+= -= *= /= %=`. §2.3 admits `**=` "was enumerated among the compound assignments" by D2 but "no token was ever built, and `(a **= 3)` currently parses as a call rather than reporting an error," adding that if built it "should probably be `^=`." *Evidence:* The `assignmentOp` production (§3.2 and `Parser.ts:254-288`) consumes only `:= += -= *= /= %=`. Yet the lexer defines and mode-includes `AmpersandEq`(`&=`), `PipeEq`(`|=`), `CaretEq`(`^=`), `TildeEq`(`~=`) tokens (`tokens.ts:205-208, 433`) that NO production consumes — so the very `^=` §2.3 nominates is a token with no grammar rule, and `&= |= ~=` are dead assign-shaped tokens. `**=` has no token, lexes as `*` + `*=`, and mis-parses instead of erroring. *Impact:* A user writing `(a ^= 2)` or `(a **= 2)` gets either a confusing parse error or a silently different program (a call), not "that operator isn't built" — violating the refuse-loudly principle (§1.2) exactly here. *Suggestion:* Either wire `assignmentOp` to the four dangling tokens (and add `**=`/`^=`) with real semantics, or delete `AmpersandEq/PipeEq/CaretEq/TildeEq` and give `**=`/`^=`/`&=`/`|=`/`~=` a named refusal (an LLxxxx). Reconcile the §2.2 table, §2.3 prose, and D2's enumeration.

### Incomplete

**Compound assignment double-evaluates a side-effecting target — a silent correctness bug undisclosed in the spec** (§6.1 Bindings)
*Claim:* §6.1 (line 1098) presents compound assignment as a caveat-free, Built binding operation alongside `:=` — `(counter += 1)` — and §2.2 lists the whole `+= -= *= /= %=` family, with no warning that a side-effecting target is evaluated twice. *Evidence:* DECISIONS.md lines 1297-1299, verbatim: "A compound assignment evaluates a side-effecting target TWICE. `xs[f()] += 1` now calls `f()` twice, because `+=` desugars to `xs[f()] = (+ xs[f()] 1)`. Avoiding it needs a temporary, which needs statement context, which an assignment in expression position does not have." The RFC discloses this NOWHERE — not in §6.1, and not in its own C.4 'Open defects' ledger (lines 2863-2900). The §5.x note ('Compound assignment is the one write still unguarded', line 1028) is about refinement checking, a different issue. *Impact:* When the index/target has SIDE EFFECTS, the most natural uses corrupt results with no diagnostic: `grid[next()] += 1` advances the cursor twice, `cache[key()] += cost` fires `key()`'s effects twice. (A pure index is only double-EVALUATED — a performance cost, not corruption. The corruption is specific to effectful targets.) *Suggestion:* Disclose the limitation in §6.1 and add it to C.4, and either lower the target to a temporary during IR lowering or refuse `+=` on a side-effecting target with a diagnostic until it can be lowered correctly.

**The resumable condition kernel has no must-be-handled form: unhandled `signal` yields `nil`-and-continues, and there is no `error`-equivalent short of abandoning resumability via `throw`** (§8.3 Conditions and restarts; D47, §9.1)
*Claim:* §8.3 ships "the Common Lisp condition system, restricted to a tractable subset (D47)" as exactly four forms (restart-case, signal, handle, invoke-restart), pitched so a handler "can decide to resume rather than merely to recover" (line 1609). *Evidence:* §8.3's own rule (line 1666): "signal with no handler yields nil and execution continues at the signal point." D47 scopes the feature to "the resumable kernel" and skips "the full CL apparatus" (DECISIONS.md 4179-4180) — it does not name error/cerror, but no error-equivalent (a raise that MUST be handled or abort) exists among the four forms. The only non-returning mechanism is `throw`, which abandons the resumability §8.3 exists to provide. Secondary/milder: because D9 makes nil the single bottom value and §9.1 uses nil as the iterator-done sentinel while §5.3 refuses forced unwrap (LL0205), an unhandled signal in value position returns nil indistinguishable from absence/done — though signal's return value is idiomatically ignored. *Impact:* A library author who signals a recoverable condition expecting the application to install policy gets, un-configured, nil-and-continue rather than a loud failure. There is no kernel form that forces handle-or-abort short of `throw`, which forgoes resumption. *Suggestion:* Either add a non-returning must-handle form (a CL-style error) to the kernel, or state explicitly in §8.3 that unhandled signal is intentionally best-effort and mandatory failures must use throw. Do not claim D47 'deliberately omits error/cerror' — its stated scope-cut is only the debugger and compute-restarts.

**Module initialisation is unspecified — module-level state and effects have no defined behaviour** (§10.1)
*Claim:* The RFC states outright that whether, when, and how often a module's top-level code runs is unanswered: "whether top-level initialisers evaluate at import; whether they evaluate once per module, once per package, or once per importer; whether effectful top-level code is permitted at all." *Evidence:* §10.1: "is this evaluated on import? ... is this ever printed? ... Open questions the specification owes an answer to..." and "the file wrapper runs when a module is imported or only when it is the entry point." Import cycles are only a warning (LL0300) with undefined initialisation order. *Impact:* Any real module with state — a lazily-built lookup table, a loaded config, a module-level counter/ID generator, a logger holding a Clock (which D79's std/log now needs), a memo cache — sits on undefined behaviour. This is the difference between a module system you can build a 400-line multi-file program on and one where you must push every initializer into an explicit `main`. *Suggestion:* Rule the three questions §10.1 itself enumerates (evaluate-at-import? once-per-what? effects allowed?) even if the answer is the restrictive "top-level must be pure definitions; effects only in the entry module." A stated restriction is buildable; silence is not. D79's Clock-holding logger makes this urgent.

**No filesystem manipulation — cannot list, create, rename, or delete anything** (§12.2 std/io/files, std/sys/path)
*Claim:* `std/io/files` covers only reading and writing file contents; `std/sys/path` is a pure value type with "Filesystem operations are out of scope for that module." There is no directory listing, no mkdir, no rename, no delete, no stat. *Evidence:* §12.2 `std/io/files` exports `CHUNK exists open try-open close read-chunk write-chunk read-file try-read-file write-file append-file read-lines` — content I/O only. §12.3: "std/sys/path defines Path as a struct... Filesystem operations are out of scope." A grep for readdir/mkdir/rename/delete/stat returns nothing. *Impact:* Any program that walks a directory of inputs, writes outputs into a folder it must create, renames a temp file into place, or deletes stale artifacts cannot be written. "Read every .lisp under this dir and process it" — a natural shape for a tool over the language's own corpus — is impossible. *Suggestion:* Add a directory/filesystem-operations surface (list-dir, make-dir, rename, remove, stat) to `std/io/files` or a sibling `std/sys/fs`, on the floor where a syscall is irreducible. Even a minimal readdir + mkdir + remove unlocks the common tool shape.

**A raw string cannot end in a lone (odd-count) backslash — an unstated inheritance of Python's raw-string limitation** (§2.4)
*Claim:* §2.4 introduces raw strings because "doubling every backslash is the single largest ergonomic cost of writing regular expressions as ordinary strings," and states "A raw string is Python's" (`r"\d+"` = the three chars `\`, `d`, `+`). *Evidence:* The shipped token is `/r"(?:[^"\\]|\\.)*"/` (line 564). `\"` matches the `\\.` alternative and survives, so a raw string cannot end in a lone backslash: `r"C:\"` consumes the closing quote as an escaped quote and runs on. An EVEN count works — `r"\\"` lexes fine. This is precisely Python's constraint (`r"\"` is a SyntaxError), consistent with "A raw string is Python's," but §2.4 never states the consequence. *Impact:* A string ending in a single backslash — most notably a Windows path separator like `C:\` — is unrepresentable in raw form and must fall back to a doubled plain string `"C:\\"`. Regexes are largely unaffected (a literal-backslash regex is `\\`, even, representable as `r"...\\"`), so the limitation bites path-like strings, not the regex use case the section motivates. *Suggestion:* State the limitation explicitly in §2.4 ("a raw string may not end in an odd number of backslashes — identical to Python"), and note the plain-string fallback. A Rust-style `r#"…"#` delimiter would make it expressible, but this is additive, not blocking.

**Five of seven numeric literal forms don't compile — you cannot write a hex, binary, octal, rational, or complex literal — yet complex/rational stdlib modules ship** (§2.3 / Appendix C.1 vs §12.2)
*Claim:* Seven numeric literal forms lex (D8), but only integer and float reach code generation; hex/binary/octal/rational/complex all hit `LL0100`. Meanwhile §12.2 ships `std/math/complex` and `std/math/rational` as Built modules. *Evidence:* §2.3: "Only integer and float literals reach code generation. This remains the largest single unbuilt area... Every other form lexes and then meets LL0100." §12.2 lists `std/math/complex | Complex rect polar scale I real-fixed` and `std/math/rational | Rational from-int from-real` in the 'Built (32 modules)' stdlib. So the language ships complex/rational types you construct only through function calls (`(rect 3 4)`), while the natural literal `3+4i` and even `0xFF`/`0b1011` are hard refusals. *Impact:* Real programs reach for hex and binary constantly — byte masks, colour values, bit-flag tables, file-format magic numbers — and the language has full bit operators (`band`, `shl`, ...) but no way to write `0xFF` for their operands; you must hand-convert to decimal. Complex/rational math is advertised as available yet you can never write a literal of it. *Suggestion:* At minimum wire hex/binary/octal literals to codegen (they are int64 values that already lex, with raw-text preservation already in place per D71). Until rational/complex literals codegen, footnote the `std/math/complex`/`std/math/rational` rows in §12.2 with "constructors only; `3+4i` literals are LL0100."

### Ambiguity

**Generics status label diverges: §5.5 'Partial' vs Appendix C.1 'Built'; the constraint gap is described one-sidedly, not falsely** (§5.5 Generics / Appendix C.1)
*Claim:* The same feature carries two status words — 'Partial' in the §5.5 body (line 922) and 'Built, erased; two erasure holes' in Appendix C.1 (line 2806). Separately, §5.5's 'a bug rather than a missing feature' framing is accurate for the PEG frontend but omits that grammar_v2 has no constraint rule at all. *Evidence:* §5.5 line 922 "Status: Partial." vs Appendix C.1 line 2806 "| Generics | Built, erased; two erasure holes |". DECISIONS.md 2453-2455: constraints "do not parse in grammar_v2 at all; in PEG they parse and are then silently discarded by two independent bugs." So the record supports BOTH 'a bug' (PEG) and 'unbuilt' (grammar_v2). *Impact:* A reader scanning the appendix sees 'Built' next to generics and may assume parity with fully-built features; the body's 'Partial' is the more honest word. A reader who only reads §5.5 won't learn that in the current default frontend (grammar_v2) the syntax does not parse at all. *Suggestion:* Align both labels on 'Partial'. For the constraint note, state both frontends: e.g. "constraint syntax parses but is silently discarded in PEG (a bug) and has no rule in grammar_v2 (unbuilt) — either way constraints are unenforced." Do not adopt a bare 'does not parse,' which is false for PEG.

**`T?` vs `T | Nil`: two spellings of optionality with unspecified legality, layout, and assignability between them** (§5.3 Nullability / §5.4 Composite types)
*Claim:* §5.3 insists `T?` is a tagged memory-layout flag and 'not sugar for `T | Nil`', while §5.4 admits arbitrary unions and `Nil` is a first-class type — so `Int | Nil` is grammatical, but its legality, layout, and relationship to `Int?` are never stated. *Evidence:* §5.3 line 889-891: "Optionality is also a **flag**, not sugar for `T | Nil` — because `T?` is a memory-layout decision ... `T?` is tagged." §5.4 line 907-908 lists 'Animal | Dog union' with no restriction, and §5.2 line 827 makes `Nil` a type. The §5.3 assignment table (871-876) covers only `T` and `T?`; it says nothing about `nil -> (Int | Nil)` or whether `Int | Nil` is assignable to/from `Int?`. *Impact:* A programmer will naturally write a return type `-> Int | Nil` (unions are advertised as first-class). It is unspecified whether that is accepted, whether it gets the tagged `T?` layout, and whether it interoperates with `Int?` returned elsewhere — so nil-handling, the single most common everyday concern, rests on undefined behavior at module boundaries. *Suggestion:* Rule explicitly on unions containing `Nil`: either refuse them in favor of `T?` (with a diagnostic and a canonicalization note), or define `T | Nil` as canonicalizing to `T?` so layout and assignability are single-valued.

**`mut`-capture semantics are genuinely undecided — the evaluation model has no answer for what a closure over a mutable binding observes** (§4 / §6.1 Bindings)
*Claim:* §6.1 defines `mut`/`:=` and §4 treats functions as first-class values, but neither ever states what a closure capturing a `mut` binding sees — a snapshot at capture time (by value) or the live cell (by reference). *Evidence:* The RFC is silent, and DECISIONS.md D48 Q3 confirms it is undecided: "a real D10/D11 decision (capture by value vs reference; how a captured `mut` becomes a heap cell — mut-capture-cell)." *Impact:* The canonical loop-counter-closure case has no defined answer (and, per Part I, the C backend currently snapshots-by-value while JS shares the cell — an observable divergence flowing directly from this undecided rule). A memoization or callback pattern that reads a mutable accumulator is unspecified. A 300-500 line program hits this within the first few higher-order-function uses. *Suggestion:* Make an explicit ruling in §4/§6.1: capture-by-reference of the binding cell (matching "let does not freeze the object" and Rust/JS intuition) or by-value with an opt-in cell. Whichever — it must be stated before closures can be called Built.

**§6.2's unqualified "Parameter defaults do not exist" reads as contradicting constructor-parameter defaults, which are real** (§6.2 Functions vs §6.5/§6.8)
*Claim:* §6.2 (line 1133) states, unqualified: "Parameter defaults do not exist — the syntax is not there." §6.5 (line 1249): "`:ctor` on a field makes it a constructor parameter" — and §6.8's Vec2 gives such a parameter a default: `(let :ctor x <- Real 0.0)`. *Evidence:* §6.2 line 1133-1134, §6.5 line 1249, §6.8 lines 1311-1313. DECISIONS.md names ctor defaults as shipped: LL0102 "a defaulted constructor parameter followed by a required one" (line 690) / table row "DefaultBeforeRequired" (line 2723); the dropped-`:ctor`-defaults fix (681-685, live in std/math.lisp Complex/Vector3). RFC line 2892 already scopes the gap to "`fn` parameter defaults", so the RFC globally is consistent — the defect is only §6.2's local dropped qualifier, which is why this is an ambiguity, not a true contradiction. *Impact:* A reader who stops at §6.2 concludes defaults are unavailable everywhere, then meets `(let :ctor x <- Real 0.0)` in §6.8 with no stated rule for why a `:ctor` field defaults but `(fn f [x <- Int 0] …)` is illegal. *Suggestion:* Reword §6.2 to scope the statement the way line 2892 already does: "**function/lambda** parameter defaults do not exist yet... (Constructor-parameter defaults, via `:ctor` field initializers, do exist — see §6.5/§6.8, with ordering enforced by LL0102.)"

**Whitespace around `-`/`+` silently changes a vector's element count, because sign is absorbed into numbers but binds into identifiers** (§2.1, §2.3)
*Claim:* Hyphen is an identifier character (§2.1: `read-line` is one name), numeric literals carry an optional leading sign (§2.3: `<IntegerNumber> ::= /[+-]?[0-9]+/`), and "a comma is whitespace… carry no meaning anywhere." *Evidence:* Those three rules make `-N` bind three ways by context. `[3-4]` lexes as two elements `3` and `-4`; `[3 -4]` is also `[3, -4]`; `[3 - 4]` is THREE elements `3`, the `-` operator-value, `4`. Meanwhile `count-1` is a single identifier (continuation class `[a-zA-Z0-9_\-…]`), not `count` minus `1`. So `3-1` means `[3, -1]` but `count-1` means one undefined name — opposite readings of the same suffix. Nothing in §2 warns of this. *Impact:* Anyone building numeric data literals or porting infix arithmetic hits silent wrong element counts and undefined-identifier errors. `(- count 1)` is required; `count-1`, `[a -b]`, `[x - y]` all do surprising things with no diagnostic. *Suggestion:* Add an explicit §2 note that leading sign is part of a number token and is absorbed, with the `[3-4]` vs `[3 - 4]` vs `count-1` trio spelled out. Consider requiring a space after a value before a bare operator-as-value, or dropping the leading sign from numeric literals (parse unary minus instead) so `[3-4]` and `[3 - 4]` agree.

**Module initialisation for effectful top-level code is under-specified; the stated working rule (no execution on import) is only provisional and doesn't cover the general case** (§10.1)
*Claim:* A file is a module (D20) and a package is the compilation unit (D35). §10.1 states a working rule — a module body does not execute on import beyond establishing its definitions — but then lists the general semantics of effectful top-level code as open questions the spec owes an answer to. *Evidence:* §10.1 line 1888: "The working rule is that a module body does not execute on import beyond establishing its definitions. That is enough for the corpus... but it does not answer what a module with effectful top-level code does." Lines 1900-1904 park the general case (evaluate at import? once per module/package/importer? permitted at all? cyclic order, currently only LL0300 warning? does the file wrapper run on import or only as entry point?). *Impact:* For definitions-only modules the working rule suffices. The wall appears the moment a module wants effectful top-level setup — a computed lookup table used for a side effect, a registered singleton, a configured logger, a one-time init — where the rule either forbids the pattern or leaves timing/frequency unspecified, and cyclic init is only a warning with unstated ordering. So the undefined case is 'effectful top-level code in an imported module,' not 'all top-level code.' *Suggestion:* Promote the working rule to a ruling and extend it to the effectful case: e.g. "a module body establishes definitions on import and does not otherwise execute; non-definition top-level forms in a non-entry module are refused (LL-xxxx)." If effectful init is instead to be allowed, rule it explicitly (evaluate once, in dependency order, first import; cyclic effectful init an error not a warning) and note that this *reverses* the current working rule.

---

## Appendix — Reproducing any item

Every `.lisp` probe above is minimal and self-contained: paste the Repro block into a file and run the two commands below. The JS run is the oracle; a disagreement (different stdout, different exit, a crash on one side) is the finding.

```
# 1) Oracle (intended behavior):
cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend js <file>

# 2) C backend (the target under audit):
cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts run --backend c <file>
```

For findings whose behavior depends on the C optimization level, or where the `run` wrapper masks a signal exit as `1`, emit and compile the translation unit directly to observe the raw exit status:

```
cd /Users/alexsabaka/Documents/repos/l-lang/src && npx ts-node index.ts transform --backend c -o /tmp/b <file>
cc -w -O0 -fwrapv -o /tmp/bin /tmp/b/<file>.c && /tmp/bin ; echo $?   # -O0: SIGFPE=136, SIGSEGV=139
cc -w -O2          -o /tmp/bin /tmp/b/<file>.c && /tmp/bin ; echo $?   # -O2 (corpus mode): UB may fold to a silent value
```

Notes: exit 136 = 128+SIGFPE(8) (integer divide trap); exit 139 = 128+SIGSEGV(11) (stack overflow); exit 70 = an uncaught `ll_trap`. When stdout looks truncated before a crash, it is block-buffered (non-TTY) and the pending buffer is lost on abnormal termination — the missing lines were computed, not skipped. The two embedded-NUL string probes use literal U+0000 bytes; the `\x00` escape shown in their Repro blocks is the front-end-accepted equivalent and reproduces identically.