# Triage — adversarial audit of 2026-07-27

Every one of the 29 Part I repros was extracted from the audit and re-run on both backends on the
current tree (`f316d27`), arm64 Darwin, Apple clang 17, with the corpus flags. This file records what
reproduced, what did not, and where the audit's *categorisation* differs from its own evidence.

**The audit is worth acting on.** It found two seams that account for most of its list, and both are
real: one is a hard `cc` failure, one is a silent wrong answer. What follows is not a rebuttal — it is
the adjudication the audit could not do for itself, because it was working from a premise the tree
does not hold.

## Two method issues, both checkable

**1. The oracle premise is inverted.** The audit opens: *"The JS backend is the oracle (decision D66):
where the two disagree, JS defines the intended behavior and the C result is the defect."*

D66 does not say that. It says the JS backend is **deprecated**, retained as a differential
cross-check, that **"JS may now DEGRADE or no-op on native-only features"**, that JS-only emitter gaps
are **WONTFIX**, and that "the C ratchet + hand-derived goldens become the **primary guard**". A
disagreement is a *signal to adjudicate*, not a verdict against C. The project already had four
recorded cases with **JS on the wrong side** before this audit ran — chained-call Int precision (D78),
the skipped `:ctor` initializer (D80), `hyphen_field_encoding`, and dropped constructor arguments — and
the roadmap's Round D entry says in as many words that a differential tool assuming the oracle is right
would misfile them. Five of the 29 are that misfiling.

**2. The harness differed from the corpus harness in exactly the flag D51 requires.** The audit ran
everything through `run --backend c`, which used `cc -w` — no `-fwrapv`, no `-std=c11`. `runner.ts:319`
has carried both since D51, with a comment saying `-fwrapv` "is required by D51, not a nicety". So the
numeric findings were measured under flags the project says are wrong. (Sabaka patched `run` to match
independently, while this audit was landing.)

## Scoreboard, re-derived

| | reports | distinct roots |
|---|---|---|
| **Confirmed C defects** | 19 | **11** |
| Does not reproduce | 2 | 1 |
| Shared gap (JS emitter fails too) | 1 | 1 |
| JS is the defective side | 2 | 2 |
| Needs a ruling; C is plausibly right | 5 | 4 |
| **Total** | **29** | |

The headline "29" counts one root cause up to five times, because the audit ran per-surface probes and
each surface reported the same seam independently. Its own prose says so — "7 of the 29 trace to
`EmitCirToC.ts:880`", "6 findings collide distinct source names" — but the scoreboard does not.

## Confirmed — 11 distinct defects

Ranked by what I would fix first.

1. **`mangleC` / `mangleBare` are not self-delimiting.** `_` and digits pass through unescaped, so
   `a-b` → `u_a` + `_2d` + `b` = `u_a_2db`, identical to `a_2db`. *Reported 4× (p05/p11/p19/p24).*
   Two manifestations, and the second is the dangerous one:
   - **hard `cc` failure** — `error: redefinition of 'u_a_2db'`;
   - **SILENT WRONG ANSWER** — `(let a-b 111)` with a parameter `a_2db` prints **10 on C, 116 on JS**,
     because the parameter shadows the global they both mangled onto. No diagnostic anywhere.

   Root cause and fix as the audit states them (`ResolveHirToCir.ts:52-63`), verified.

2. **Method C-name join is not injective** — `__ll_method_Foo_bar_baz_dyn` from two different
   class/method splits. `cc` redefinition. *(p10.)* Same family, separate join.

3. **Unguarded native int `/` and `%`.** `EmitCirToC.ts:880` emits raw `(l / r)` for statically-typed
   Int/Int; the boxed `ll_op_div` guards, but static Int/Int never routes there. *Reported 5×
   (p00/p01/p17/p21/p23).* Confirmed — with **different observations than the audit gives**, see below.

4. **Emitter throws instead of diagnosing: `no cast int -> closure`** — binding a method to a value.
   An uncaught TypeScript exception with a stack trace, not an LL-coded diagnostic. *(p09.)*

5. **Emitter throws instead of diagnosing: `no cast obj -> real`** — `:implicit` defcast at an
   arg-coercion site. Same class as 4; both at `EmitCirToC.ts:977`. *(p15.)*

6. **Embedded NUL truncates a string literal** (`ll_str_lit` uses `strlen`), and consequently **two
   distinct strings sharing a NUL prefix compare EQUAL** — `true` on C, `false` on JS. *(p25/p26.)*
   The equality half is security-relevant.

7. **Under-applied closure reads past `argv`** — prints `#<object>` where JS binds nil. *(p07.)*

8. **Deep structural equality has no cycle guard or pointer-identity short-circuit** — a
   self-referential vector crashes C (no output, rc=1) where JS answers `true`. *(p28.)*

9. **Stacked `...args` decorators trap** — `TypeError: expected a Vector` on C, correct on JS. *(p27.)*
   Not stale against D75: the flat contract landed, and two layers still break.

10. **Boxed int `/0` yields `Infinity`** rather than trapping, so the `catch` never fires. *(p18.)*
    Distinct code path from 3.

11. **Deep non-tail recursion SIGSEGVs** where JS raises a catchable stack-overflow. *(p08.)*

### On the division findings specifically

The seam, the root cause and the proposed fix are all correct. The **observations are not**:

| audit says | measured here |
|---|---|
| SIGFPE process-kill at -O0, exit 136 | no signal; `(/ 7 0)` returns **0**, rc=0 |
| `-O0` and `-O2` disagree | they **do** disagree — but **0 vs 1**, not crash-vs-0 |
| `Result: 140731274663864` (poison) at -O2 | `Result: 1` |
| INT_MIN/-1 SIGFPEs / gives wrong `0` | **-9223372036854775808 on both backends** — the D51 wrap value |

ARM64 `SDIV` returns 0 for a zero divisor and `INT_MIN` for `INT_MIN/-1`; it does not trap. SIGFPE on
integer division is **x86** behaviour, so the audit almost certainly ran on x86 despite its text saying
"Darwin ARM64".

**This makes the defect worse, not better.** The same emitted translation unit gives `0` at -O0 and `1`
at -O2 on this machine, and would abort on x86 — one program, three behaviours, decided by the host and
the optimiser. That is precisely what a portable backend must not do, and it is a stronger argument for
the guard than the crash the audit reported.

## Does not reproduce — 1 root, 2 reports

**INT_MIN / -1 "overflow not wrapped"** *(p02/p22).* Both backends print
`-9223372036854775808` — which **is** the D51 wrap value the audit says is missing. Nothing to fix.

## Shared, not a C defect — 1

**Kebab-case class name interpolated raw into a symbol position** *(p20).* Real, but the **JS emitter
fails too** (`ELL0101 … "class Shape-2d {"`). The audit labels it `SHARED` in the title and still
counts it in the C-backend total.

## JS is the defective side — 2

- **Hex / octal / binary literals** *(p03).* C prints `15`; **JS refuses** with
  `ELL0100 … visitOctalNumber is not implemented in the JS backend`. This is a JS-only emitter gap,
  which D66 declares **WONTFIX**. Filed as a C-backend defect; it is the opposite.
- **`:implicit` defcast as an arithmetic operand** *(p16).* C refuses cleanly with `ELL0106`; JS
  **runs and prints garbage** (`arith: [object Object]0.5`) — the audit's own words. A refusal that
  names the gap is the better behaviour; this is not a C defect.

## Needs a ruling — 4 roots, 5 reports

Each of these is a real divergence where **C is at least as defensible as JS**, so none should be
"fixed" before it is decided.

- **Non-exhaustive match fall-through** *(p12/p13/p14).* C traps a typed error; JS propagates **nil**
  into an `Int`- or `String`-typed slot. D9 exists to forbid exactly that in-band lie, so C looks
  right. The audit files C as the defect on all three.
- **Closure capture of a loop-mutated `mut`** *(p06).* JS `3 3 3` (shared cell), C `0 1 2`
  (per-iteration snapshot). The audit's **own Part II** says the mut-capture rule is undecided — so
  Part I should not score it as a miscompile. On the merits C's answer is the one most languages moved
  toward.
- **`Number("")`** *(p04).* `NaN` on C, `0` on JS. JS's `0` is a well-known JS wart, not a
  specification.

## What I would do next

1. **`mangleC` self-delimiting.** One function, closes 4 reports including the silent wrong answer,
   and it is the only confirmed defect here that gives a wrong ANSWER with no diagnostic.
2. **Guard native int `/` and `%`**, routing to `ll_trap` per D82. Closes 5 reports and makes the
   backend's arithmetic host- and optimiser-independent. Needs one ruling first: is divide-by-zero
   DATA (catchable) or a CONTRACT violation (panic)? D82's line — an index is data, a refinement is a
   contract — suggests catchable.
3. **The two `EmitCirToC.ts:977` throws** become diagnostics. Not a semantics change; a compiler that
   throws a stack trace at a user is a bug regardless of which backend is the oracle.
4. Everything under "Needs a ruling" goes to Sabaka as questions, not as work.
