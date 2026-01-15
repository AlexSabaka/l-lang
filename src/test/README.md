# L-Lang Test Suite

Unified test runner for the l-lang compiler that validates code generation and runtime behavior against expected outputs.

## Usage

### Run All Tests
```bash
# From project root
npm test

# Or directly
./test_all.sh

# Or with ts-node
ts-node src/test/runner.ts
```

### Verbose Mode
Show detailed output diff when tests fail:
```bash
npm test -- --verbose

# Or
./test_all.sh --verbose
```

## Test Structure

Each test consists of:
- **Source file**: `examples/folder/test.lisp` - L-lang source code
- **Expected output**: `examples/folder/test.expect` - Expected stdout
- **Generated file**: `examples/folder/test.js` - Generated JavaScript (auto-created)

### Example

```
examples/01-basics/00_vars.lisp       # Source
examples/01-basics/00_vars.expect     # Expected output
examples/01-basics/00_vars.js         # Generated (auto)
```

## Test Process

For each `.lisp` file with a corresponding `.expect` file:

1. **Compile**: `ts-node src/index.ts transform file.lisp`
2. **Execute**: `node file.js`
3. **Compare**: stdout vs `.expect` file content
4. **Report**: Pass ✅ / Fail ❌ / Skip ⚠️ / Error 💥

## Test Results

- **✅ PASS**: Output matches expected
- **❌ FAIL**: Output differs from expected (use --verbose to see diff)
- **💥 ERROR**: Compilation or runtime error
- **⚠️  SKIP**: No `.expect` file found

## Adding New Tests

1. Create a `.lisp` file in `examples/`
2. Run it manually to verify output:
   ```bash
   ts-node src/index.ts transform examples/your-test.lisp
   node examples/your-test.js
   ```
3. Save expected output:
   ```bash
   node examples/your-test.js > examples/your-test.expect
   ```
4. Run test suite to verify:
   ```bash
   npm test
   ```

## Test Categories

Current test coverage across 65 files:

- **01-basics/** - Core language features (27 tests)
  - Variables, functions, closures
  - Control flow (if/when/cond/for/while)
  - Pattern matching
  - Pipelines
  - Memoization

- **02-errors/** - Error handling (1 test)
  - Try/catch/finally

- **04-data-types/** - Data structures (3 tests)
  - Vectors, maps, matrices
  - Enums, structs

- **05-oop/** - Object-oriented (1 test)
  - Classes, inheritance

- **06-import/** - Module system (6 tests)
  - Import/export

- **10-algorithms/** - Complex examples (2 tests)
  - Evaluator, recursion

## Continuous Integration

The test suite is designed for CI/CD integration:

```yaml
# Example GitHub Actions
- name: Run tests
  run: |
    npm install
    npm run parser
    npm run build
    npm test
```

## Troubleshooting

### All tests skipped
- Ensure `.expect` files exist alongside `.lisp` files
- Check file naming: `test.lisp` requires `test.expect`

### Compilation errors
- Run `npm run build` to rebuild TypeScript
- Run `npm run parser` if grammar changed

### Runtime errors
- Check generated `.js` files for correctness
- Run individual tests: `node examples/path/test.js`

### Output mismatches
- Use `--verbose` flag to see diff
- Check for trailing newlines or whitespace issues
- Regenerate `.expect` if intended behavior changed

## Architecture

The test runner (`src/test/runner.ts`) is a TypeScript program that:

1. Walks the `examples/` directory tree
2. Finds all `.lisp` files with `.expect` pairs
3. Compiles and executes each test
4. Compares output with normalization
5. Reports results with colored output

### Key Features

- **Unified runner**: Single codebase for all platforms
- **Colored output**: Chalk for visual feedback
- **Normalized comparison**: Handles newline differences
- **Sorted execution**: Consistent test order
- **Verbose mode**: Detailed failure diagnostics
- **Exit codes**: CI-friendly (0 = success, 1 = failure)

## Statistics

**Current Status** (as of Jan 15, 2026):
- ✅ **27/27 core tests passing** (100%)
- ⚠️ 38 examples without `.expect` files
- 📊 65 total `.lisp` files

## Contributing

When adding features:
1. Add example in appropriate `examples/` subfolder
2. Create corresponding `.expect` file
3. Ensure test passes before PR
4. Update this README if adding new test category
