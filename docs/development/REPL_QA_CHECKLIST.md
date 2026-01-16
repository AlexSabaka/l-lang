# L-Lang REPL - Manual QA Checklist

**Date**: January 15, 2026  
**Version**: L-Lang REPL v0.0.1  
**Tester**: _____________

## Pre-Test Setup

- [ ] Built project: `cd src && npm run build`
- [ ] Launch REPL: `cd .. && ts-node src/index.ts repl`
- [ ] Welcome message displays with version number
- [ ] Terminal supports ANSI colors

---

## 1. Basic Functionality

### Simple Expressions
- [ ] Arithmetic: `(+ 1 2 3)` returns `6`
- [ ] Subtraction: `(- 10 3)` returns `7`
- [ ] Multiplication: `(* 4 5)` returns `20`
- [ ] Division: `(/ 10 2)` returns `5`

### Variables
- [ ] Define variable: `(let x 42)` - no error
- [ ] Access variable: `x` returns `42`
- [ ] Define mutable: `(mut y 10)` - no error
- [ ] Reassign: `(:= y 20)` - no error
- [ ] Check reassignment: `y` returns `20`

### Functions
- [ ] Define function: `(fn add [a b] (+ a b))` - no error
- [ ] Call function: `(add 10 20)` returns `30`
- [ ] Zero-arg function: `(fn get-ten [] 10)` - no error
- [ ] Call zero-arg: `(get-ten)` returns `10`

---

## 2. Multi-line Input

### Bracket Balancing
- [ ] Start expression: `(fn factorial [n]` → shows continuation dots `.. `
- [ ] Continue: `(if (<= n 1)` → shows more dots `.... `
- [ ] Continue: `1` → still in continuation
- [ ] Complete: `(* n (factorial (- n 1)))))` → executes

### Cancel Multi-line
- [ ] Start expression: `(fn test [x]`
- [ ] Press Ctrl+C → shows "(Input cancelled)"
- [ ] Prompt returns to `> ` (normal mode)

---

## 3. Syntax Highlighting

**Visual Check** (colors should appear):
- [ ] Keywords highlighted: `(fn`, `let`, `mut`, `if`, `match`
- [ ] Strings highlighted: `"hello world"`
- [ ] Numbers highlighted: `42`, `3.14`
- [ ] Comments dimmed: `; this is a comment`
- [ ] Operators visible: `+`, `-`, `*`, `/`, `->`, `|>`

**Test Input**:
```lisp
> (fn greet [name] (console.log (+ "Hello " name)))
```
- [ ] `fn` is colored (keyword)
- [ ] `greet` is colored (function name)
- [ ] `"Hello "` is colored (string)
- [ ] Brackets are visible

---

## 4. Autocomplete (Tab Key)

### Keyword Completion
- [ ] Type `(def` → Press Tab → shows: `defclass`, `definterface`, `deftype`, `defenum`, `defstruct`
- [ ] Type `(fn` → Press Tab → completes or shows `fn`
- [ ] Type `(le` → Press Tab → completes to `let`

### Symbol Completion
- [ ] Define: `(let myVariable 42)`
- [ ] Define: `(fn myFunction [] 100)`
- [ ] Type `my` → Press Tab → shows both `myVariable` and `myFunction`
- [ ] Type `myV` → Press Tab → completes to `myVariable`

### Built-in Completion
- [ ] Type `console.` → Press Tab → shows: `log`, `error`, `warn`
- [ ] Type `Math.` → Press Tab → shows: `sqrt`, `random`, `floor`, etc.

### Member Access Completion
- [ ] Type `(let str "hello")`
- [ ] Type `str.` → Press Tab → shows: `length`, `charAt`, `concat`, etc.
- [ ] Type `str.len` → Press Tab → completes to `str.length`

---

## 5. Command History

### Navigation
- [ ] Type `(+ 1 2)` → Enter
- [ ] Type `(* 3 4)` → Enter
- [ ] Press ↑ once → shows `(* 3 4)`
- [ ] Press ↑ again → shows `(+ 1 2)`
- [ ] Press ↓ once → shows `(* 3 4)`
- [ ] Press ↓ again → clears to empty line

### Editing
- [ ] Press ↑ to recall previous command
- [ ] Use ← and → arrows to move cursor
- [ ] Modify text and press Enter → executes modified version

---

## 6. REPL Commands

### .help
- [ ] Type `.help` → displays help with all commands
- [ ] Shows keyboard shortcuts table
- [ ] Returns to prompt after

### .symbols
- [ ] Define some symbols: `(let a 1)`, `(let b 2)`, `(fn f [] 3)`
- [ ] Type `.symbols` → shows all three symbols with types
- [ ] Format: `name : Type (mutability)`

### .types
- [ ] Type `.types` → shows type information for defined symbols
- [ ] Format: `name : Type`

### .history
- [ ] Type `.history` → shows numbered list of previous inputs
- [ ] Each line is syntax highlighted

### .reset
- [ ] Define: `(let x 100)`
- [ ] Type `.reset` → shows "Context cleared"
- [ ] Type `x` → should error (undefined)

### .clear
- [ ] Type `.clear` → clears screen
- [ ] Welcome message reappears
- [ ] Context is NOT reset (symbols still defined)

### .exit
- [ ] Type `.exit` → displays "👋 Goodbye!"
- [ ] REPL exits gracefully

---

## 7. Persistent Context

### Cross-Evaluation State
- [ ] Define: `(let globalVar 42)`
- [ ] Define: `(fn useGlobal [] globalVar)`
- [ ] Call: `(useGlobal)` → returns `42`
- [ ] Verify symbol persists across evaluations

### Function References
- [ ] Define: `(fn double [x] (* x 2))`
- [ ] Define: `(fn quadruple [x] (double (double x)))`
- [ ] Call: `(quadruple 5)` → returns `20`

---

## 8. Error Handling

### Syntax Errors
- [ ] Type `(let x 10` → Press Enter multiple times to complete brackets
- [ ] OR: Incomplete expression shows continuation dots (not error)

### Undefined Variables
- [ ] Type `undefinedVar` → shows error message
- [ ] Error is red colored
- [ ] REPL continues (doesn't crash)

### Type Errors
- [ ] Type `(+ "hello" 42)` → shows type error (if type checking enabled)
- [ ] Error message is clear and red colored

### Runtime Errors
- [ ] Type `(nonexistent-function)` → shows error
- [ ] REPL continues working after error

---

## 9. Advanced Features

### Classes
- [ ] Define class:
```lisp
(defclass Dog [name]
  (fn speak [] (console.log (+ "Woof! I'm " this.name))))
```
- [ ] Instantiate: `(let buddy (new Dog "Buddy"))`
- [ ] Call method: `(buddy.speak)` → prints "Woof! I'm Buddy"

### Pattern Matching
- [ ] Define:
```lisp
(fn describe [x]
  (match x
    (0 "zero")
    (1 "one")
    (_ "many")))
```
- [ ] Test: `(describe 0)` → returns `"zero"`
- [ ] Test: `(describe 5)` → returns `"many"`

### Pipelines
- [ ] Define: `(let nums [1 2 3 4 5])`
- [ ] Pipeline: `(nums |> (map (fn [x] (* x 2))))` → returns `[2, 4, 6, 8, 10]`

---

## 10. Terminal Behavior

### Keyboard Shortcuts
- [ ] **Home** key → cursor jumps to start of line
- [ ] **End** key → cursor jumps to end of line
- [ ] **Ctrl+C** (in empty line) → exits REPL
- [ ] **Ctrl+C** (in multi-line) → cancels input
- [ ] **Ctrl+D** → exits REPL

### Screen Rendering
- [ ] No flickering during typing
- [ ] Colors render correctly
- [ ] Multi-line continuation dots align properly
- [ ] Long lines wrap correctly

---

## 11. Performance & Stability

### Load Testing
- [ ] Define 20+ variables rapidly → no crashes
- [ ] Define 10+ functions → no slowdown
- [ ] Access `.symbols` with many definitions → displays quickly

### Long Sessions
- [ ] Run REPL for 5+ minutes with various operations
- [ ] No memory leaks observed (monitor system resources)
- [ ] History works after many commands (1000 entry limit)

### Edge Cases
- [ ] Empty input (just press Enter) → returns to prompt
- [ ] Very long input (200+ characters) → handles correctly
- [ ] Unicode characters: `(let emoji "🦥")` → handles correctly
- [ ] Special characters in strings: `(let str "Hello\nWorld")` → handles correctly

---

## Issues Found

**Critical Issues** (prevent usage):
- 

**Major Issues** (significant problems):
-

**Minor Issues** (cosmetic or rare):
-

**Suggestions for Improvement**:
-

---

## Sign-off

- [ ] All critical functionality works
- [ ] No crashes or data loss
- [ ] Error messages are helpful
- [ ] Performance is acceptable
- [ ] Ready for production use

**Tested by**: _____________  
**Date**: _____________  
**Overall Status**: ✅ PASS / ⚠️ PASS WITH ISSUES / ❌ FAIL

**Notes**:


