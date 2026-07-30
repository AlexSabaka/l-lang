# 🏗️ Compiler architecture

How a `.lisp` file becomes a native binary, and where to put a change.

> This document was three concatenated documents until 2026-07-28 — an architecture guide, a type
> system guide, and two dated implementation summaries — and the architecture third described a
> PEG.js frontend and a `js-legacy` backend, both deleted at D39. The implementation summaries moved
> to [`changelog.md`](changelog.md), where a dated record belongs.

---

## The pipeline

```
  hello.lisp
      │
 ┌────▼─────────────────────────────────────────────────────────┐
 │ frontend/            Lexer → Parser → AstBuilder             │  Chevrotain (grammar_v2)
 │                      AstProvider caches parsed ASTs          │
 ├──────────────────────────────────────────────────────────────┤
 │ analysis/            SyntaxRulesAstVisitor                   │  form-level rules, modifier legality
 │                      BuildSymbolTableAstVisitor              │  scope tree, imports/exports
 ├──────────────────────────────────────────────────────────────┤
 │ transformation/      DesugarAstVisitor                       │  pipelines, implicit returns
 │                      ComptimeEvaluationAstVisitor            │  :comptime folding (in-house interp)
 │                      InlineImportsAstVisitor                 │  honours the export list
 ├──────────────────────────────────────────────────────────────┤
 │ types/               InferTypesAstVisitor (2-pass)           │  collect, then infer
 │                      TypeChecker                             │  assignability, conformance, coercion
 ├──────────────────────────────────────────────────────────────┤
 │ hir/                 LowerAstToHirVisitor                    │  the NEUTRAL TYPED CORE
 └───────────┬──────────────────────────────┬───────────────────┘
             │                              │
   ┌─────────▼──────────┐        ┌──────────▼───────────┐
   │ codegen/c/         │        │ codegen/js-estree/   │
   │  ResolveHirToCir   │        │  EmitHirToEstree     │
   │  InsertCoercions   │        │  → astring           │
   │  EmitCirToC → cc   │        │                      │
   │  ── THE REFERENCE  │        │  ── THE ORACLE       │
   └────────────────────┘        └──────────────────────┘
```

`Context.ts` orchestrates it. `CompilationStage` is `"parse" | "syntax" | "symbols" | "desugar" |
"types" | "codegen"`, and `--stage` stops anywhere.

### Why there is an HIR

The governing rule is **D48/A-0**: *a decision **both** backends make must be modelled so they
cannot diverge; a pass leaves core only if it is genuinely single-backend.*

Before it, each backend re-derived the same facts — where a value is needed, whether a form is a
statement or an expression, when a struct must be copied — and they disagreed. The HIR is
**destination-driven**: the consumer owns the slot and the producer emits one canonical shape, so
the "is this an expression here?" question that used to be answered by ambient state is answered
positionally instead (D45).

**C is the reference implementation** (D86). The JavaScript backend is frozen and kept as a
differential oracle: both compile the same corpus and are graded against the *same* golden, so a
disagreement surfaces instead of hiding.

---

## Where to put a change

| you are adding | touch |
|---|---|
| a new token or literal form | `frontend/grammar_v2/tokens.ts`, then `Parser.ts`, then `AstBuilder.ts` |
| a new AST node | `frontend/ast.ts` — and check every *rewriting* visitor walks it |
| a form-level rule / refusal | `analysis/visitors/SyntaxRulesAstVisitor.ts` + a diagnostic |
| a desugaring | `transformation/visitors/DesugarAstVisitor.ts` |
| type inference for a form | `types/visitors/InferTypesAstVisitor.ts` |
| an assignability or conformance rule | `types/TypeChecker.ts` |
| something both backends must agree on | `hir/nodes.ts` + `LowerAstToHirVisitor.ts` |
| C emission | `codegen/c/{ResolveHirToCir,InsertCoercions,EmitCirToC}.ts` |
| a runtime primitive | `compiler/floor/floor.ts` **and** both runtimes — see [FLOOR.md](spec/FLOOR.md) |
| a diagnostic | `rules/diagnostics/` — see its [README](../src/compiler/rules/diagnostics/README.md) |

### The trap that has caught this project nine times

A visitor that **reads** the tree and a visitor that **rewrites** it walk differently. A rewriting
visitor cannot use `BaseAstTreeWalker`'s walk, and if it maps children one level it will silently
skip anything nested deeper.

That is not hypothetical. `MatrixNode.rows` is the language's only array-of-arrays field, and **every
rewriting visitor mapped one level** — so no desugar had ever reached a matrix cell. `1/2` inside a
matrix reached both backends as a raw `fraction-number`; a `:comptime` fold inside one silently did
not happen. The reading passes saw matrix cells and the rewriting passes did not: two halves of the
compiler disagreeing about whether a matrix had children.

So when you add a node with a container-shaped field, check that `ast.mapChildArray` handles it.

---

## The type system

### Two passes, then a check

`InferTypesAstVisitor` runs **collect** then **infer**: declarations are registered before any body
is walked, so forward references work. The rule is *solve, then check against the solution* — a
generic is inferred by solving constraints, and only then is the call checked against what was
solved. Generics are **real, not erased** (Phase 5).

### The rules that decide most questions

| | |
|---|---|
| **Nominal types, structural interfaces** (D42) | `Meter` and `Second` are distinct even if both wrap `Real`; a class satisfies an interface by having the members, no `:implements` needed — *for assignability*. |
| **…but the runtime is nominal** (D63) | `(x :of I)`, `display`, `compare` and `hash-of` all consult a declared `:implements`. So structural conformance and `:of` can disagree; catalogued under D42's banner. |
| **Int vs Real is static** (D43) | The runtime cannot decide it, so the checker must. |
| **Coercion is a layer** (D46) | Refinements, `defcast`, `(cast<T> x)` — every checked conversion is inserted at a typed↔typed edge, carrying its kind and its target. |
| **Promotion** (D88) | An operand promotes through an `:implicit` defcast, so `(+ 1 1/2)` is `3/2`. |
| **Dimensions** (D90) | A `:satisfies` refinement can be a dimension; assignability then compares **maps, not names**. |
| **Nullability** (D9) | `T?` admits nil; dereferencing without a guard is LL0205, and the guard narrows for the rest of the block. |

`TypeChecker.isAssignable` is where most of this meets. `formatType` is what makes the diagnostics
readable — if you add a type kind, teach it there too.

---

## Debugging

```bash
npx ts-node index.ts run --stage parse   FILE   # the raw AST
npx ts-node index.ts run --stage symbols FILE   # the symbol table, with types
npx ts-node index.ts run --stage types   FILE   # after inference
npx ts-node index.ts transform FILE             # the emitted C (C is the default, D104)
npx ts-node index.ts run --perf FILE            # per-phase timings -- compile only; `cc` and the
                                                # binary's own runtime are outside the report
```

**`__ll_member` is a thermometer.** Where the checker cannot type a receiver, `(obj.m)` dispatches at
run time rather than guessing. Every site that reaches it is a receiver inference failed on, so the
count is the cheapest available measure of the "does not infer every expression" gap. Watching it
fall is how three mechanical inference bugs were found.

**A refusal is not a crash.** The C backend is fail-closed: it emits `LL0105`–`LL0107` saying what it
cannot do. If you get a Node stack trace instead, that is a bug in its own right — every user-facing
refusal is supposed to carry a code and a location.

---

## Further reading

- [spec/DECISIONS.md](spec/DECISIONS.md) — every ruling, with the measurement. Start at the topic index.
- [spec/FLOOR.md](spec/FLOOR.md) — the runtime contract the two backends must not diverge on.
- [spec/C-BACKEND-FINDINGS.md](spec/C-BACKEND-FINDINGS.md) — the reference backend's dated defect log.
- [spec/GRAMMAR.ebnf](spec/GRAMMAR.ebnf) — generated from the parser.
- [inbox/hir-brief.md](inbox/hir-brief.md) — the HIR's R1–R6 requirements, cited by name from the source.
