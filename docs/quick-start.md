# ⚡ Quick Start Guide

Get l-lang running, and get a program onto the **reference backend**, in about five minutes.

> **There are two backends.** C is the reference implementation and, since D104, the **default** —
> that's what gets fixed and extended. JavaScript is kept as a differential-testing oracle and is
> **deprecated**: reach it with `--backend js` and it prints a warning saying so. See
> [DECISIONS.md](spec/DECISIONS.md) D66, D86 and D103 for why.

---

## 🎯 Installation

**`package.json` lives in `src/`, not at the repo root.** Every `npm` command below is run from
there.

```bash
git clone https://github.com/AlexSabaka/l-lang.git
cd l-lang/src

npm install
npm run build
```

**You need a working C compiler on your PATH** (Apple clang, gcc and clang are all fine). C is the
default backend as of D104, so `run` and `transform` both go through `cc` unless you ask otherwise.
`--backend js` opts out and needs no compiler — but it is the deprecated path (D66) and says so.

---

## 🎨 Your First Program

### 1. Create `hello.lisp`

```lisp
(
    (console.log "Hello, l-lang! 👋")
)
```

### 2. Run it

```bash
npx ts-node index.ts run hello.lisp
```

```
Hello, l-lang! 👋
```

Behind that: l-lang → AST → symbols → desugar → types → HIR → C, then `cc`, then the binary runs.
The translation unit and the executable are built in a private temp directory and removed after —
`run` leaves nothing behind and overwrites nothing you own.

### 3. Or look at the C it emits

```bash
npx ts-node index.ts transform hello.lisp   # writes hello.c
```

Add `--backend js` to either command and you get JavaScript instead — plus a deprecation warning,
which is the compiler telling you the truth rather than a bug.

---

## 📚 Learn by Example

`examples/` holds **357 programs**, and every one of them is a test: compiled and run against a
hand-derived golden. They are the most reliable documentation in the repo, because a wrong one turns
the build red.

| you want | look at |
|---|---|
| variables, calls, control flow | `00-basics/`, `02-control-flow/` |
| functions, pipelines, closures | `01-functions/` |
| pattern matching, guards, type patterns | `04-pattern-matching/` |
| classes, interfaces, dispatch | `09-oop/` |
| generics and constraints | `08-generics/` |
| refinement types and units | `07-types/`, `16-stdlib/26_units.lisp` |
| errors, and conditions/restarts | `18-error-handling/`, `19-conditions/` |
| the standard library | `16-stdlib/` |
| things that are *supposed* to fail | `90-diagnostics/` |
| edge cases that once broke the compiler | `80-adversarial/` |

Run any of them:

```bash
npx ts-node index.ts run ../examples/01-functions/04_pipelines.lisp
```

---

## 🔧 Common Commands

All from `src/`.

| command | what it does |
|---|---|
| `npx ts-node index.ts run FILE` | compile to C, build with `cc`, execute — the default |
| `npx ts-node index.ts run --backend js FILE` | run on the deprecated oracle instead |
| `npx ts-node index.ts transform FILE` | emit `FILE.c` and stop |
| `npx ts-node index.ts run --stage types FILE` | stop after a stage (`parse`, `syntax`, `symbols`, `desugar`, `types`, `codegen`) |
| `npx ts-node index.ts run --perf FILE` | per-phase timings |
| `npm run test:c` | the corpus on the C reference |
| `npm test` | the corpus on the JS oracle — an instrument, not a gate (D103) |
| `npm run grammar:ebnf` | regenerate `docs/spec/GRAMMAR.ebnf` from the parser |

---

## 📊 Compilation Pipeline

```
hello.lisp
    │
    ├─ PARSE      Chevrotain grammar (grammar_v2) → AST
    ├─ SYNTAX     form-level rules, modifier legality
    ├─ SYMBOLS    scope tree, imports, exports, visibility
    ├─ DESUGAR    pipelines, implicit returns, comptime folding
    ├─ TYPES      inference (2-pass) + checking; coercions decided here
    ├─ HIR        a typed, destination-driven IR — the neutral core
    │
    ├──► C        ResolveHirToCir → InsertCoercions → EmitCirToC → cc     ← the reference
    └──► JS       ESTree → astring                                        ← the oracle
```

Stop anywhere with `--stage`:

```bash
npx ts-node index.ts run --stage parse   hello.lisp   # raw AST
npx ts-node index.ts run --stage symbols hello.lisp   # symbol table with types
npx ts-node index.ts run --stage types   hello.lisp   # after inference
```

---

## 🎯 Next Steps

| I want to... | go to |
|---|---|
| see every form the language has | **[Language Syntax](language-syntax.md)** |
| find a built-in or a stdlib function | **[Language Reference](language-reference.md)** |
| understand *why* something is the way it is | **[DECISIONS.md](spec/DECISIONS.md)** — start at the topic index |
| know what's broken or unbuilt | **[Roadmap](roadmap.md)**, Known gaps |
| work on the compiler | **[Contributing](CONTRIBUTING.md)** and **[CLAUDE.md](../CLAUDE.md)** |
| read the exact grammar | **[GRAMMAR.ebnf](spec/GRAMMAR.ebnf)** |

---

## 🆘 Troubleshooting

**"Command not found: ts-node"** — you skipped `npm install`, or you are not in `src/`. `npx`
resolves it from the local `node_modules`.

**A deprecation warning on a compile** — you passed `--backend js`. That is the JavaScript backend
telling you it is the oracle, not the target. Drop the flag and you are on C.

**`cc` not found, or a compile error in the emitted C** — the C backend needs a C compiler on your
PATH. If `cc` is present and the emitted C fails to build, that is a compiler bug worth reporting:
the backend is *fail-closed* and is supposed to refuse (LL0105–LL0107) rather than emit something
that will not compile.

**`ELL0106 Cannot generate C for '…'`** — a construct the C backend refuses on purpose. It is being
honest; `src/test/c-status.ts` carries the current list.

**Type errors not showing** — check the stage: `npx ts-node index.ts run --stage types FILE`.

---

## 🎓 Philosophy

> **"We get there when we get there, but we do it right."**

Static typing is a basic necessity, not a ceremony. Lisp's expressiveness is worth keeping. Native
compilation is the point — the JavaScript backend was the scaffolding, and it now exists to
*disagree* with C so that disagreements get looked at.

Every language decision is written down with the measurement that produced it, in
**[DECISIONS.md](spec/DECISIONS.md)**. Nothing is decided by taste alone, and no claim about the
compiler is made here without having been run.
