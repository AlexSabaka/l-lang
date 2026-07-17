# rules/diagnostics

Every *imperative* compiler diagnostic — an error/warning the compiler DECIDES to raise, as opposed to the
self-checking declarative rules in `../NodeValidationRules.ts` — lives here. One category file per emitting
domain: `TypeDiagnostics`, `SyntaxDiagnostics`, `CodegenDiagnostics`, `ModuleDiagnostics`, `ComptimeDiagnostics`.
See DECISIONS **D38**.

## Adding a diagnostic

1. **Pick a free code.** Run `npm run test:diagnostics` and read the allocator:

   ```
   LL02xx: 29 taken, next free LL0209
   ```

   Codes are banded: `00xx` structural/syntax · `0099` comptime · `01xx` codegen · `02xx` type · `03xx` module.

2. **Add a def** to the matching category file:

   ```ts
   MyDiagnostic: def<{ name: string }>("LL0209", Error, (p) => `'${p.name}' is not allowed here.`),
   ```

   Params are **primitives only** — pre-format any type at the call site with `TypeChecker.formatType(...)`,
   so this stays a leaf module (no compiler-internal imports). A code may back several named variants
   (keep the code, vary the name).

3. **Report it.** From a visitor (anything extending `BaseAstVisitor`):

   ```ts
   this.report(TypeDiagnostics.MyDiagnostic, node, { name });
   ```

   From `Context` / `JSClassBuilder` (not visitors), use the free function:

   ```ts
   report(ctx, ModuleDiagnostics.X, node, { ... });
   ```

4. **Add a probe** to `src/test/diagnostics.ts` that triggers it (set `stage: "codegen"` for LL01xx), then
   `npm run test:diagnostics -- --update` to capture it. The snapshot now pins that diagnostic's exact
   `(code, severity, text)` — a reword becomes a deliberate `--update`, never a silent drift.

## The gate

`npm run test:diagnostics` — registry integrity (one severity per code, `LLdddd` shape) + the free-code
allocator + the characterization snapshot. It must stay green; a diff means a code/severity/message changed.

`NOTE: … overloaded with declarative rules` flags any code shared between a migrated diagnostic and a
declarative rule. It is currently empty — the one such overlap (LL0015–LL0019) was resolved in D38 by moving
the declarative colliders to LL0024–LL0028.

## Adding a DECLARATIVE rule instead

A structural rule that a node can self-check (`NodeValidationRules.ts`) needs no registry entry — but it
still needs a code, and it must come from the same allocator. Nothing else to do: the allocator reads
`Rules` directly, so a declarative code counts as taken because the rule **exists**.

That was not always true. It used to read a hand-written `EXTERNAL_CODES` array, which drifted within one
phase of its own creation (Qe took LL0029 and did not update it, so the allocator kept offering LL0029).
Deleted in Vc — a hand-maintained list of codes inside a registry built so codes are not hand-maintained
is the LL0015–LL0019 collision waiting to happen again.

Two traps the allocator now handles, both found the hard way:

- **`LL0000` is never offered.** A code of all zeros reads as a sentinel, not a diagnostic.
- **Retired codes are never offered.** `LL0004` (`ImportHasSymbols`, deleted in Sc3) is still named as
  deleted by DECISIONS/roadmap/STDLIB. A new rule wearing it would make that history document the wrong
  thing. Add any future deletion to `RETIRED_CODES` in `test/diagnostics.ts`.

And the wiring trap, which the allocator cannot catch: a declarative rule only runs where a visitor calls
`checkRules` for that node type, and the method name must match `BaseAstVisitor`'s dispatch table exactly.
`SyntaxRulesAstVisitor.visitFunctionParameter` does not (the table says `visitParameter`), so LL0014 and
LL0024 have never fired — see AF-008. **Take the rule RED first**: a rule that has never fired looks
exactly like a rule that passes.
