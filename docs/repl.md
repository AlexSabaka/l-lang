# The REPL

```
cd src
npx ts-node cli/index.ts repl
```

```
  l-lang  ·  interactive
  .help for commands, .exit to quit

> (let x 5)
=> 5
> (fn double [] -> Int (* x 2))
=> [Function double]
> (double)
=> 10
```

## What a session is

**A session is a program that grows by one top-level form at a time.** Each input you accept becomes
a *cell*, and the session's program is the cells, in order, as sibling top-level forms.

Every input recompiles the whole session. In a statically typed language there is no alternative —
rebinding `x` has to be checked against everything that already uses `x`. But **only the new form is
ever executed.** History is compiled, never re-run; the values it produced are already there.

This is ruled in [`docs/spec/DECISIONS.md` § D23](spec/DECISIONS.md), which is the place to look if
you want the *why* rather than the *what*.

## One name, one type

```
> (let x 1)
=> 1
> (let x 2)
=> 2                        ← rebinding at the same type is fine
> (let x "hi")
error[REPL0001] 'x' is Int in this session and cannot become String.
                Anything already compiled against it would keep reading it as Int.
                Use `.delete x` first.
```

A name's type is fixed the first time you bind it. This is not pedantry — it is the difference
between a REPL and a liar. The session's cells are sibling forms, so a rebinding would put *two*
declarations of `x` at program scope with different types, while the generated JavaScript has *one*
`var x`. A function you defined earlier would keep type-checking against the old `x` and reading the
new one at run time — a function declared `-> Int` quietly returning `null`.

So: `.delete x`, then bind it again. Redefining a **function** or a **class** is always fine.

## Commands

| | |
|---|---|
| `.help` | show the list |
| `.exit` | leave (also `Ctrl+D`) |
| `.reset` | forget everything and start over |
| `.delete <name>` | remove a declaration — **the only way to change its type** |
| `.load <file>` | read a `.lisp` file's forms into this session |
| `.js [expr]` | the JavaScript it compiles to — no argument means the last form |
| `.type <expr>` | what it infers to, without running it |
| `.symbols` | what you have defined |
| `.types` | what you defined it *as* |
| `.history` | the forms that make up this session |
| `.clear` | clear the screen |

### `.js` — see what codegen did

The most useful command here, and the reason it exists. You are working on a compiler.

```
> (let n (add 2 3))
=> 5
> .js
var n = __ll_copy(add(2, 3));
```

### `.delete` — and what it takes with it

Deleting a declaration replays the rest of the session without it. A form that no longer compiles is
dropped, and **said out loud**:

```
> .delete x
removed 'x'
  dropped, it no longer compiles: (fn double [] -> Int (* x 2))
```

### `.load` — pull in a file

A `.lisp` file is written wrapped in one outer list. That outer list is a *block*, so loading it as a
single form would make every binding in it invisible at the prompt. `.load` unwraps the wrapper and
loads the forms as sibling cells.

```
> .load examples/01-basics/00_vars.lisp
loaded 15/15 forms
> .symbols
  variable
    m, nested-list, v, x, y
```

*Limit:* a relative `import` inside a loaded file resolves against your working directory, not the
file's own — the session compiles one program, and it lives where you launched the REPL.

## Multi-line

Keep typing; the prompt becomes `·` until the form closes.

```
> (fn add [a <- Int b <- Int] -> Int
·   (+ a b))
=> [Function add]
```

`Ctrl+C` cancels a half-typed form without leaving the REPL.

## Notes

- **Errors are shown.** Every compiler diagnostic reaches the prompt, pointing at the line *you*
  typed — not at a line in the assembled program you never see.
- **A refused form changes nothing.** If it does not compile, or its JavaScript throws, the session
  is exactly as it was. History only ever contains forms that compiled *and* ran.
- **Tab completion is derived from the language** — keywords from the lexer, modifiers from the D4
  whitelist the checker enforces, builtins from the runtime, members from the compiled type
  metadata. It cannot drift out of step with the compiler, because it is not a list.
- **Tests:** `npm run test:repl`. The session is driven directly, with no pty — which is the only
  reason the REPL is testable at all, and it is why it is tested now when it never was before.
