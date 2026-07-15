# 🤝 Contributing to l-lang

Thanks for being interested in contributing to l-lang! This guide explains how to get started, how the compiler works, and patterns for adding features.

---

## 📋 Before You Start

1. **Read the philosophy**: l-lang is about **static typing** + **Lisp elegance** + **pragmatism**. Not every feature request will fit.
2. **Check [TODO.md](roadmap.md)** for planned work
3. **Check [open issues](https://github.com/AlexSabaka/l-lang/issues)** for what's being worked on
4. **Review [recent fixes](spec/DECISIONS.md)** to understand current state

---

## 🚀 Getting Started

### 1. Clone & Setup

```bash
git clone https://github.com/AlexSabaka/l-lang.git
cd l-lang

# Install dependencies
cd src && npm install

# Build compiler
npm run parser    # Generate parser from grammar
npm run build     # Compile TypeScript

# Verify everything works
npm test          # Should see: ✅ 36/39 passing
```

### 2. Understand the Pipeline

Read [docs/architecture/COMPILER_ARCHITECTURE.md](language-compiler.md) (15 min) to understand the **6-stage compilation pipeline**:

```
Input (.lisp) → [Parse] → [Syntax] → [Symbols] → [Desugar] → [Types] → [Codegen] → Output (.js)
```

Each stage is a visitor that transforms the AST.

### 3. Learn the Codebase

- **Start**: [docs/QUICK_START.md](quick-start.md)
- **Deep dive**: [docs/development/IMPLEMENTATION_GUIDE.md](spec/DECISIONS.md)
- **Architecture details**: [docs/architecture/COMPILER_ARCHITECTURE.md](language-compiler.md)
- **Type system**: [docs/compiler/TYPE_SYSTEM.md](spec/DECISIONS.md)

---

## 📝 How to Contribute

### Finding Work

**Easy starter issues** (good first contribution):
- Bug fixes flagged in [BUG_FIXES_SUMMARY.md](spec/DECISIONS.md)
- Grammar improvements in [l-lang.pegjs](src/compiler/frontend/grammar/l-lang.pegjs)
- Test coverage in `examples/` directory
- Documentation & examples

**Medium difficulty**:
- Add new type kinds (see [TYPE_SYSTEM.md](docs/compiler/TYPE_SYSTEM.md#adding-new-type-kinds))
- Implement syntax transformations (see [IMPLEMENTATION_GUIDE.md](docs/development/IMPLEMENTATION_GUIDE.md#pattern-adding-transformations-in-desugaring))
- Add standard library functions

**Hard / Ambitious**:
- LLVM backend (Phase 4)
- High-level IR (Phase 3)
- Performance optimizations
- Advanced metaprogramming features

### Contributing Code

#### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
```

**Branch naming**:
- `feature/...` - New feature
- `fix/...` - Bug fix
- `docs/...` - Documentation
- `refactor/...` - Code refactoring

#### 2. Make Your Changes

**Minimal changes**: Only modify what's necessary. See [code change instructions](CONTRIBUTING.md#code-changes-are-minimal).

**Follow patterns**:
- Study existing implementations in `docs/compiler/`
- Follow the pattern from [IMPLEMENTATION_GUIDE.md](spec/DECISIONS.md)
- Use the same style as existing code

**Common patterns**:

**Adding a new type kind**:
```typescript
// 1. Update InferredType in types/TypeChecker.ts
export interface InferredType {
  kind: "primitive" | "array" | "yourtype"; // ADD HERE
  // ...
}

// 2. Add visitor method in InferTypesAstVisitor.ts
visitYourConstruct(node) {
  // Infer type logic
  return { kind: "yourtype", ... };
}

// 3. Add type checking in TypeChecker.ts
if (type1.kind === "yourtype") {
  // Compatibility logic
}

// 4. Add test in examples/
```

**Adding a syntax transformation**:
```typescript
// In DesugarAstVisitor.ts
visitYourSyntax(node) {
  // Transform to simpler form
  return transformedNode;
}
```

#### 3. Test Your Changes

```bash
# Run full test suite
npm test

# Run specific test file
npm test -- examples/YOUR_EXAMPLE.lisp

# Verbose mode (see all output)
npm test -- --verbose

# Test compilation stages
ts-node src/index.ts transform --stage types examples/YOUR_FILE.lisp
cat examples/YOUR_FILE.types.json | jq '.'  # Inspect result
```

**Add tests**:
- Add `.lisp` file to `examples/XX-category/`
- Add `.expect` file with expected output
- Run `npm test` to verify

#### 4. Document Your Changes

**In code**:
- Add TSDoc comments for complex logic
- Reference related issues/PRs
- Update docstrings if changing APIs

**In docs**:
- Update [CHANGELOG.md](changelog.md) with your changes
- Update [TODO.md](roadmap.md) to mark items complete
- Update [ROADMAP.md](roadmap.md) if scope changed
- Add implementation details if adding major feature (see [DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md](spec/DECISIONS.md) as example)

#### 5. Commit & Push

```bash
git add .
git commit -m "feat: add your feature

- What you did
- Why it matters
- Any gotchas or notes

Fixes #123 (if fixing an issue)
"
git push origin feature/your-feature-name
```

**Commit message style**:
- Use imperative mood: "add feature" not "added feature"
- First line ~50 chars, then blank line, then details
- Reference issues: "Fixes #123" or "Related to #456"

#### 6. Create a Pull Request

1. Go to GitHub and click "New Pull Request"
2. Fill in the PR template (describe what, why, how)
3. Link related issues
4. Request reviewers if you know who to ask
5. Wait for CI to pass and feedback

---

## ✅ Code Quality Standards

### TypeScript Style

```typescript
// ✅ Good
export class SymbolTable {
  private entries: Map<string, SymbolEntry> = new Map();
  
  addSymbol(name: string, entry: SymbolEntry): void {
    this.entries.set(name, entry);
  }
}

// ❌ Avoid
export class SymbolTable {
  entries = new Map();  // No type annotation
  addSymbol(name, entry) { // No param types
    this.entries.set(name, entry);
  }
}
```

### Comments

**Only comment non-obvious logic**:

```typescript
// ✅ Good - explains WHY
// We need to resolve symbols in two passes: first collect all top-level
// declarations, then resolve references. This enables forward references.
const buildSymbolTableVisitor = new BuildSymbolTableAstVisitor(this);

// ❌ Bad - obvious what it does
// Create build symbol table visitor
const buildSymbolTableVisitor = new BuildSymbolTableAstVisitor(this);
```

### Testing

- **Must pass**: All existing tests
- **Should add**: Tests for new functionality
- **Coverage target**: 80%+ for new code
- **Format**: Example-based (`.lisp` + `.expect` files)

### Documentation

- Update [docs/](docs/) if changing APIs
- Add examples if adding new syntax
- Update [INDEX.md](docs/INDEX.md) with new sections
- Keep markdown well-formatted and readable

---

## 🔍 Code Review Checklist

When reviewing PRs, check:

- [ ] Follows [code change rules](CONTRIBUTING.md#code-changes-are-minimal) (minimal, surgical changes)
- [ ] All tests pass (`npm test`)
- [ ] New code has tests
- [ ] Documentation updated (if needed)
- [ ] Commit messages are clear
- [ ] No merge conflicts
- [ ] No debug console.log statements left
- [ ] No unnecessary dependencies added

---

## 🐛 Reporting Bugs

Found a bug? Great! Please:

1. **Check if it's already reported**: Search [issues](https://github.com/AlexSabaka/l-lang/issues)
2. **Create a minimal example**: Small `.lisp` file that reproduces the bug
3. **Include context**:
   - l-lang version (`ts-node src/index.ts --version`)
   - Node.js version (`node --version`)
   - Operating system
   - Expected vs actual output
4. **Provide compilation artifacts**:
   ```bash
   # Run with --stage flag to see where it breaks
   ts-node src/index.ts transform --stage types your_file.lisp
   ```

**Example bug report**:
```markdown
### Bug: String interpolation breaks with nested expressions

**Reproduction**:
```lisp
(let x 5)
(let msg "Value: {(+ x 10)}")
(println msg)
```

**Expected**: "Value: 15"
**Actual**: Error: Unexpected token...

**Environment**:
- Node 20.18.0
- l-lang 0.0.1
- macOS
```

---

## 💡 Design Philosophy

When adding features, ask:

1. **Does it fit l-lang's vision?**
   - Marries Lisp elegance with static typing
   - Pragmatic, not over-engineered
   - Clear benefits over existing syntax

2. **Is it orthogonal to existing features?**
   - Doesn't duplicate functionality
   - Composes well with other features
   - Doesn't break existing code

3. **Is it testable?**
   - Can add example in `examples/`
   - Can verify with tests
   - Has clear expected behavior

4. **Is it documented?**
   - Added to grammar if syntax
   - Documented in [SYNTAX.md](language-syntax.md)
   - Examples provided

---

## 📚 Key Documentation Files

**Must read**:
- [docs/QUICK_START.md](quick-start.md) - Setup & overview
- [docs/architecture/COMPILER_ARCHITECTURE.md](language-compiler.md) - Pipeline & design
- [docs/development/IMPLEMENTATION_GUIDE.md](spec/DECISIONS.md) - How to add features
- [docs/compiler/TYPE_SYSTEM.md](spec/DECISIONS.md) - Type system design

**Reference**:
- [docs/API_REFERENCE.md](language-reference.md) - Built-in functions
- [docs/language/SYNTAX.md](language-syntax.md) - Complete syntax
- [docs/development/BUG_FIXES_SUMMARY.md](spec/DECISIONS.md) - Recent patterns

**Example implementations**:
- [docs/compiler/DEFTYPE_DEFSTRUCT_IMPLEMENTATION.md](spec/DECISIONS.md) - Type aliases & structs
- [docs/compiler/DEFMODIFIER_IMPLEMENTATION.md](spec/DECISIONS.md) - User-defined modifiers

---

## 🆘 Getting Help

- **Questions about architecture?** → Read [COMPILER_ARCHITECTURE.md](language-compiler.md)
- **Stuck on implementation?** → Check [IMPLEMENTATION_GUIDE.md](docs/development/IMPLEMENTATION_GUIDE.md#debugging-tools)
- **Need to understand types?** → Read [TYPE_SYSTEM.md](spec/DECISIONS.md)
- **Want to see patterns?** → Check existing implementations in `docs/compiler/`
- **Issues?** → Open a GitHub issue with details

---

## 📖 Code Change Rules

See [code change instructions in README](../README.md) - summary:
- ✅ Make minimal modifications
- ✅ Change only what's necessary
- ✅ Don't fix unrelated bugs
- ✅ Update docs if relevant
- ✅ Run tests after changes
- ❌ Don't break existing behavior
- ❌ Don't remove/modify working code unless necessary

---

## 🎓 Learning Path

### Week 1: Understand the Basics
- [ ] Read [QUICK_START.md](quick-start.md)
- [ ] Run a few examples
- [ ] Try the REPL
- [ ] Read [SYNTAX.md](language-syntax.md) (first 3 sections)

### Week 2: Understand the Compiler
- [ ] Read [COMPILER_ARCHITECTURE.md](language-compiler.md)
- [ ] Run `npm test` and understand test structure
- [ ] Test compilation stages: `ts-node src/index.ts transform --stage types examples/01-basics/00_vars.lisp`
- [ ] Inspect `.json` artifacts with `jq`

### Week 3: Make Your First Change
- [ ] Pick an easy issue from [TODO.md](roadmap.md)
- [ ] Read [IMPLEMENTATION_GUIDE.md](spec/DECISIONS.md)
- [ ] Make a small change
- [ ] Run tests
- [ ] Submit PR

### Week 4+: Deeper Work
- [ ] Choose feature from [ROADMAP.md](roadmap.md)
- [ ] Study related code
- [ ] Implement & test
- [ ] Document & submit PR

---

## 🙏 Thank You

Thanks for contributing! You're helping build a language that combines elegance, safety, and pragmatism. We appreciate:

- Code contributions
- Bug reports
- Documentation improvements
- Examples & tutorials
- Feedback & ideas

---

**Questions?** → Create an issue or discussion on GitHub

**Ready to contribute?** → Start with [QUICK_START.md](quick-start.md) and pick an issue!
