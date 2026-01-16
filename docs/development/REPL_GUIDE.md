# L-Lang REPL Guide

## Overview

The L-Lang REPL (Read-Eval-Print Loop) is a feature-rich interactive environment for exploring and testing l-lang code. It provides syntax highlighting, intelligent autocomplete, persistent context, and multiple helpful commands.

## Features

### 🎨 **Syntax Highlighting**
- Real-time syntax highlighting for l-lang code
- Color-coded keywords, strings, numbers, operators, and comments
- Distinct highlighting for functions, classes, and special forms

### 🔍 **Intelligent Autocomplete** (Tab Key)
- **Keyword completion**: After opening parenthesis, suggests keywords like `defclass`, `fn`, `let`, `match`
- **Symbol completion**: Autocompletes variable and function names from your session
- **Member access**: Suggests methods and properties after `.` (e.g., `obj.` shows completions)
- **Built-in functions**: Suggests common functions like `console.log`, `Math.sqrt`

### 💾 **Persistent Context**
- Definitions persist across multiple inputs
- Reference previously defined functions and variables
- Symbol table accumulates throughout the session
- Full type inference information available

### 📝 **Multi-line Input**
- Automatic detection of incomplete expressions
- Continuation prompt with indentation dots (`... `)
- Proper bracket balancing
- Ctrl+C to cancel multi-line input

### 🔧 **REPL Commands**

| Command | Description |
|---------|-------------|
| `.help` | Display help message with all commands |
| `.exit` or `.quit` | Exit the REPL |
| `.reset` | Clear context and start fresh |
| `.symbols` | List all defined symbols with types |
| `.types` | Show type information for all symbols |
| `.history` | Display command history |
| `.clear` | Clear the screen |

### ⌨️ **Keyboard Shortcuts**

| Shortcut | Action |
|----------|--------|
| **Tab** | Trigger autocomplete |
| **↑/↓** | Navigate command history (1000 entries) |
| **←/→** | Move cursor left/right |
| **Home/End** | Jump to start/end of line |
| **Ctrl+C** | Cancel input or exit REPL |
| **Ctrl+D** | Exit REPL |
| **Backspace** | Delete character |

## Usage Examples

### Basic Arithmetic
```lisp
> (+ 1 2 3)
=> 6

> (- 10 3)
=> 7

> (* 4 5)
=> 20
```

### Defining Functions
```lisp
> (fn add [a b] (+ a b))

> (add 10 20)
=> 30

> (fn factorial [n]
...   (if (<= n 1)
...     1
...     (* n (factorial (- n 1)))))

> (factorial 5)
=> 120
```

### Working with Variables
```lisp
> (let x 42)

> x
=> 42

> (mut y 10)

> (:= y 20)

> y
=> 20
```

### Classes and Objects
```lisp
> (defclass Dog [name breed]
...   (fn speak []
...     (console.log (+ "Woof! I'm " this.name))))

> (let buddy (new Dog "Buddy" "Golden Retriever"))

> (buddy.speak)
Woof! I'm Buddy
```

### Pattern Matching
```lisp
> (fn describe [x]
...   (match x
...     (0 "zero")
...     (1 "one")
...     (_ "many")))

> (describe 0)
=> "zero"

> (describe 5)
=> "many"
```

### Viewing Symbols and Types
```lisp
> (let name "Alice")
> (let age 30)
> (fn greet [] (console.log (+ "Hello " name)))

> .symbols
📦 Defined Symbols:
  name : String (let)
  age : Int (let)
  greet : () -> Void (let)

> .types
🏷️  Type Information:
  name : String
  age : Int
  greet : () -> Void
```

### Using History
```lisp
> (let x 100)
> (let y 200)
> (+ x y)
=> 300

> .history
📜 History:
  1. (let x 100)
  2. (let y 200)
  3. (+ x y)

# Use ↑ arrow to recall previous commands
```

### Resetting Context
```lisp
> (let x 42)
> x
=> 42

> .reset
✓ Context cleared. Starting fresh.

> x
Error: Undefined variable: x
```

## Autocomplete Examples

### Keyword Completion (after opening paren)
```lisp
> (def<TAB>
# Shows: defclass, definterface, deftype, defenum, defstruct

> (defcl<TAB>
# Completes to: defclass
```

### Symbol Completion
```lisp
> (let myVariable 42)
> (let myFunction (fn [] 100))

> my<TAB>
# Shows: myVariable, myFunction

> myV<TAB>
# Completes to: myVariable
```

### Member Access Completion
```lisp
> (let str "hello")

> str.<TAB>
# Shows: length, charAt, concat, indexOf, slice, split, toLowerCase, toUpperCase, trim

> str.len<TAB>
# Completes to: str.length
```

### Built-in Function Completion
```lisp
> (Math.<TAB>
# Shows: sqrt, random, floor, ceil, etc.

> (console.<TAB>
# Shows: log, error, warn
```

## Error Handling

The REPL provides helpful error messages with proper formatting:

### Syntax Errors
```lisp
> (let x 10
Syntax Error: Unbalanced parentheses
  at line 1, column 10
```

### Type Errors
```lisp
> (+ "hello" 42)
Type Error: Cannot add String and Int
```

### Runtime Errors
```lisp
> (undefined-function)
Error: undefined-function is not defined
```

## Tips & Best Practices

1. **Use Tab liberally**: Autocomplete helps discover available functions and avoid typos

2. **Check symbols frequently**: Use `.symbols` to see what's defined in your session

3. **Reset when stuck**: If context becomes cluttered, use `.reset` to start fresh

4. **Explore history**: Press ↑ to recall and modify previous commands

5. **Multi-line editing**: For complex expressions, spread across multiple lines for readability

6. **Test incrementally**: Define small functions first, test them, then build larger ones

7. **Use .history**: Review what you've done in the session

8. **Experiment safely**: The REPL is isolated - nothing affects your source files

## Advanced Usage

### Testing Code Before Saving
```lisp
# Test a function in the REPL first
> (fn fibonacci [n]
...   (if (<= n 1)
...     n
...     (+ (fibonacci (- n 1)) (fibonacci (- n 2)))))

> (fibonacci 10)
=> 55

# Once working, save to a .lisp file
```

### Interactive Debugging
```lisp
> (let data [1 2 3 4 5])
> data
=> [1, 2, 3, 4, 5]

> (map (fn [x] (* x 2)) data)
=> [2, 4, 6, 8, 10]
```

### Quick Type Checking
```lisp
> (let x 42)
> .types
# Check inferred type: x : Int

> (let result (+ x 10))
> .types
# Check: result : Int
```

## Troubleshooting

### REPL Won't Start
```bash
# Ensure project is built
cd src && npm run build

# Launch REPL
cd .. && ts-node src/index.ts repl
```

### Autocomplete Not Working
- Tab key should be configured in your terminal
- Try typing a few characters before pressing Tab
- Check that context has symbols defined (use `.symbols`)

### Multi-line Input Stuck
- Press Ctrl+C to cancel current input
- Check for unbalanced parentheses
- Use `.reset` if context becomes corrupted

### Colors Not Showing
- Ensure your terminal supports ANSI colors
- Check that chalk is installed: `npm ls chalk`
- Try a different terminal emulator

## Architecture Notes

### Components
- **command.repl.ts**: Main REPL orchestration
- **REPLCompleter.ts**: Autocomplete engine
- **PersistentREPLContext.ts**: Session state management
- **l-lang.ts**: Custom syntax highlighter

### Technical Details
- Uses Node.js `readline` module for input handling
- Syntax highlighting via `highlight.js` + custom language definition
- Symbol table integration for intelligent completion
- Persistent compilation context across evaluations
- ANSI escape codes for smooth terminal rendering

---

**Version**: L-Lang REPL v0.0.1  
**Last Updated**: January 15, 2026  
**Status**: Production-ready with all core features implemented
