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

`NOTE: … overloaded with declarative rules` flags codes shared between a migrated diagnostic and a
declarative rule (currently LL0015–LL0019 — a known finding, see D38).
