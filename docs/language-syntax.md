# 🦥 l-lang Language Reference

*Note: This language is in active development. Syntax is subject to change when better ideas materialize.*

---

## 0. Core Philosophy

**Everything is an expression. Every expression is data.**

l-lang steals from Lisp, TypeScript, C#, Zig, and Go, because they are good at solving their problems.

### Design Principles

- **Homoiconicity First:** goal is to have every language construct to be a S-expressions.
- **Static Types, Dynamic Spirit:** TypeScript-style structural typing with union types.
- **Metaprogramming in Layers:** Choose your tool—comptime for generics, defmacro for rewrites, defsyntax for DSLs.

---

## 1. Basics & Comments

l-lang uses S-expressions (Lisp-style parenthesized lists).

### Comments

```lisp
;; Standard comment - immutable variable x set to 10
(let x 10) 
```

### Literals

```lisp
10          ;; Integer
3.14        ;; Float
1/3         ;; Fraction (exact rational)
10+2i       ;; Complex number (because math people exist)
0xFF        ;; Hexadecimal
"Hello"     ;; String
'"Count: {(x)}" ;; Formatted string (interpolation)
true / false    ;; Booleans (not truthy/falsy nonsense)
nil             ;; The void
```

---

## 2. Variables & State

Variables are **immutable by default** (`let`). Mutation must be explicit (`mut`).

### Immutable

```lisp
(let pi 3.14159)
(let name "Sloth")
```

### Mutable

```lisp
(mut counter 0)
(counter := (+ counter 1)) ;; := for reassignment (not =)
(counter *= (+ counter 2)) ;; *= same as counter = counter * (counter + 2)
;; etc
```

### Type Annotations

Use `<-` to annotate types. The compiler will infer when it can, but explicit is better.

```lisp
(let x <- Number 10)
(mut list <- List<String> ["a" "b"])
```

**Union Types:** When you need "this OR that":

```lisp
(let status <- String | Int "loading")
(status := 200) ;; Valid - Int is in the union
```

---

## 3. Data Structures

### Vectors & Lists

```lisp
(let v [1 2 3])      ;; Vector (contiguous array)
(let l (1 2 3))      ;; List (linked list / AST node)
(let item v[0])      ;; Zero-indexed access
```

### Maps (Dictionaries)

Keys can be keywords (`:name`) or strings. Keyword keys are preferred.

```lisp
(let user { 
    :name "Sid" 
    :age 30 
    :"is-admin" false 
})
(std.console.log user.name)          ;; Dot access for keywords
(std.console.log user["is-admin"])   ;; Bracket access for strings
```

### Matrices

Native type for 2D math operations. Rows separated by `|`.

```lisp
(let identity 
    [ 1, 0, 0 
    | 0, 1, 0 
    | 0, 0, 1 ])

(let val identity[1, 2]) ;; 2D indexing: row, column
```

---

## 4. Functions & Pipelines

### Definition

Functions use `fn`. Return types with `->` are optional but recommended.

```lisp
(fn add [a <- Number b <- Number] -> Number (
    (return (+ a b))
))

;; Implicit return (last expression)
(fn add [a <- Number b <- Number] (
    (+ a b)
))
```

### Spread Parameters

Functions can accept variable numbers of arguments using spread syntax:

```lisp
(fn print [msg <- String ...args <- Any[]] -> Void (
    ;; args is an array containing all additional arguments
    (for :each arg :from args :then (
        (console.log arg)
    ))
))

;; Usage
(print "Hello" "world" 42 true)  ;; msg="Hello", args=["world", 42, true]
```

**Key Features**:
- Use `...paramName` to collect remaining arguments into an array
- Type annotation follows normal pattern: `...args <- Type[]`  
- Generates efficient JavaScript rest parameters: `function print(msg, ...args)`
- Can be combined with regular parameters (spread parameter must be last)

### Async / Await

```lisp
(fn :async fetch-data [id] (
    (let result (await (db.get id)))
    (return result)
))
```

### Pipelines (`|>`)

Pass results forward. First argument by default.

```lisp
;; Instead of: square(add(5, 10))
(5 
 |> (add 10) 
 |> square)

;; Method chaining
(query
 |> .Skip 10
 |> .Take 5)
```

---

## 4.5. Function Modifiers

### Built-in Modifiers

l-lang includes several built-in modifiers for functions:

```lisp
(fn :operator + [a <- Int, b <- Int] -> Int ...)  ;; Operator overloading (dispatch modifier)
(fn :async fetch-data [url] ...)                  ;; Async function (body modifier)
(fn :gen count-up [n <- Int] -> Iterator<Int> ...) ;; Generator: function*, produces via (yield x)
(fn :extension area [self <- Rectangle] -> Int ...) ;; Extension method: (rect.area) -> area(rect)
```

Modifiers split into **dispatch** (`:operator`, `:extension` — govern the call site) and **body**
(`:gen`, `:async` — govern the emitted function); one of each composes, e.g. `:extension :gen` is a lazy
extension method. `:extension` dispatch is compile-time and nominal: `(x.m a)` lowers to the free call
`m(x, a)` when `x`'s type conforms to the extension's receiver and has no native `m`.

### Custom Modifiers with `defmodifier`

Define custom function modifiers that transform functions at compile time:

```lisp
;; Define a memoization modifier
(defmodifier memoized [])

;; Apply to functions with :modifier syntax
(fn :memoized fibonacci [n <- Int] -> Int
    (match n {
        0 => 1
        1 => 1
        _ => (+ (fibonacci (- n 1)) (fibonacci (- n 2)))
    })
)
```

The memoized modifier automatically adds caching to functions, dramatically improving performance for recursive algorithms.

### Multiple Modifiers

Functions can have multiple modifiers applied:

```lisp
(defmodifier logged [])
(defmodifier timed [])

;; Function with logging, timing, and memoization
(fn :logged :timed :memoized complex-calculation [x] -> Int
    ;; Expensive computation here
    (fibonacci (+ x 10))
)
```

Modifiers are applied in order, creating nested transformations.

### How Modifiers Work

- `defmodifier` creates a higher-order function that transforms other functions
- Currently generates memoization logic (extensible in future versions)
- Applied at compile time, not runtime
- Zero performance overhead for the transformation itself

### Examples

See `examples/10-modifiers/` for comprehensive examples including:
- Basic modifier usage
- Logging and timing modifiers  
- Retry logic modifiers
- Multiple modifier combinations

---

## 5. Flow Control

### If / Else

```lisp
(if (> x 10)
    (print "Big")
    (print "Small"))
```

### When (Guard Syntax)

```lisp
(when is-loading :then "Please wait...")
```

### Cond (Multi-Branch)

```lisp
(cond
    ((>= score 90) "A")
    ((>= score 80) "B")
    (true "F")) ;; Default case
```

### Loops

**While:**

```lisp
(while (> i 0) (
    (i := (- i 1))
))
```

**For (C-Style):**
Optional named arguments: `:init`, `:cond`, `:step`, `:then`. If skipped C-style `for` is inferred.

```lisp
(for 
    :init (mut i 0)
    :cond (< i 5)
    :step (i := (+ i 1))
    :then (print i))
```

**For-Each:**

```lisp
(for :each item :from list :then (
    (print item)
))
```

---

## 6. Pattern Matching

`match` handles constants, types, destructuring, and guards.

```lisp
(match value {
    0              => "Literal zero"
    x :of Int      => "Some integer"
    [1 2 _]        => "Vector: [1, 2, anything]"
    { :type "A" }  => "Map with key :type = 'A'"
    _              => "Default case (matches everything)"
})
```

### Type Matching with RTTI

Runtime type introspection via `type`:

```lisp
(fn describe [obj] (
    (match (type obj) {
        Int      => "An integer"
        String   => "Text"
        Dog      => "A dog instance"
        _        => "Something else"
    })
))
```

---

## 7. Object-Oriented Programming

### Classes

```lisp
(defclass Dog :extends Animal
    (let :public :ctor name)  ;; Constructor param + public field
    (let :private age 0)      ;; Private field, default value

    (fn :public speak [] (
        (print '"(this.name) says Woof!")
    ))
)

(let d (new Dog "Buddy"))
(d.speak)
```

**Memory Management Hints:**

```lisp
(defclass :gc Texture      ;; GC-managed (default)
    (let buffer <- Buffer))

(defclass :stack Point     ;; Stack-allocated (opt-in)
    (let x <- Float)
    (let y <- Float))
```

### Structs

Value types. Passed by copy. Stack-allocated by default.

```lisp
(defstruct Point
    (let :public x 0)
    (let :public y 0))
```

### Operator Overloading

You can define custom behavior for operators using the `:operator` modifier. The function name must be the operator symbol.

```lisp
(defstruct Vector2
    (let :ctor x <- Real)
    (let :ctor y <- Real)

    ;; Binary + operator
    (fn :operator + [other <- Vector2] -> Vector2
        (return (new Vector2 (+ this.x other.x) (+ this.y other.y)))
    )

    ;; Unary - operator (negation)
    (fn :operator - [] -> Vector2
        (return (new Vector2 (- 0 this.x) (- 0 this.y)))
    )
)

(let v1 (new Vector2 1 2))
(let v2 (new Vector2 3 4))
(let v3 (+ v1 v2))  ;; Vector2(4, 6)
(let v4 (- v1))     ;; Vector2(-1, -2)
```

Supported operators: `+`, `-`, `*`, `/`, `==`, `!=` etc.

### Interfaces

```lisp
(definterface IRepository<T>
    (fn :async GetAll [] -> List<T>)
    (fn :async GetById [id] -> T))
```

### Generics

Generics enable type-safe parameterization of classes, interfaces, and functions. Function generics
work via **call-site inference**: `(fn first<T> [coll <- T[]] -> T? ...)` and `(first [1 2 3])` infers
`Int?`, solving `T` from the argument and substituting into the return (optional flag and all).

**Generic Classes:**

```lisp
;; Single type parameter
(defclass Box<T>
    (let :ctor value <- T)
    (fn get [] -> T (return this.value))
    (fn set [val <- T] -> Void (this.value := val)))

;; Multiple type parameters
(defclass Pair<T U>
    (let :ctor first <- T)
    (let :ctor second <- U)
    (fn getFirst [] -> T (return this.first))
    (fn getSecond [] -> U (return this.second)))

;; Usage
(let box (new Box<Int> 42))
(let pair (new Pair<String Int> "age" 25))
```

**Generic Interfaces:**

```lisp
(definterface Container<T>
    (fn get [] -> T)
    (fn set [val <- T] -> Void))

;; Implementation
(defclass Box<T> :implements Container<T>
    (let :ctor value <- T)
    (fn get [] -> T (return this.value))
    (fn set [val <- T] -> Void (this.value := val)))
```

**Runtime Type Information (RTTI):**

Generic types expose metadata at runtime via the `type()` function:

```lisp
(let box (new Box<Int> 42))
(console.log (type box))
;; Output: { name: "Box", generics: ["T"], implements: ["Container"], ... }
```

**Covariance/Contravariance (Syntax-Only, Future Feature):**

```lisp
;; Covariant type parameter (output positions only)
(definterface Producer<:out T>
    (fn produce [] -> T))

;; Contravariant type parameter (input positions only)
(definterface Consumer<:in T>
    (fn consume [item <- T] -> Void))
```

**Generic Constraints (Planned):**

```lisp
;; Future syntax for bounded type parameters
(defclass SortedList<T> :where T :extends Comparable
    (fn add [item <- T] -> Void ...))
```

### Enums

```lisp
;; With auto values 0..3
(defenum HttpMethod
    :GET
    :POST
    :PUT
    :DELETE)

;; Inferred values 200..204
(defenum HttpStatusCode
    :OK => 200
    :Created
    :Accepted
    :Non-Authoritative-Information
    :No-Content)
```

---

## 8. Metaprogramming: The Three Tiers

l-lang gives you three levels of code manipulation.

### Level 1: Comptime (Zig-Style)

**Status**: ✅ Implemented (January 16, 2026)

Evaluate code at compile-time. Functions marked with `:comptime` are executed during compilation and their results are inlined as constants.

```lisp
;; Comptime function - evaluated at compile time
(fn :comptime factorial [n]
  (if (<= n 1) 1 (* n (factorial (- n 1)))))

;; Usage - compiler evaluates and inlines result
(let fact5 (factorial 5))  ;; Compiles to: const fact5 = 120;
;; The factorial function definition does NOT appear in compiled output
```

**Key Features**:
- **VM-Based Execution**: Comptime functions are transpiled to JavaScript and executed in a Node.js `vm` sandbox
- **Recursive Support**: Handles recursive functions (factorial, Fibonacci, etc.)
- **Dead Code Elimination**: Function definitions marked `:comptime` are removed from output after evaluation
- **Constant Propagation**: All comptime calls are replaced with their computed literal values

**Example with Multiple Comptime Functions**:
```lisp
(fn :comptime add [a b] (+ a b))
(fn :comptime multiply [a b] (* a b))

(let x (multiply 5 6))     ;; const x = 30;
(let y (add 7 3))          ;; const y = 10;
;; add and multiply functions not in output
```

**Comptime Parameters** (Planned):

```lisp
(fn create-array [comptime T, size <- Int] -> Array<T> (
    ;; T is known at compile time, size at runtime
    (Array<T>.new size)
))
```

*Note: Type-level comptime parameters are planned for future implementation. Currently supported for function execution only.*

### Level 2: Defmacro (Simple Rewrites)

Pattern-match and template-substitute. Auto-gensym prevents variable capture.

```lisp
;; Macro definition
(defmacro unless [condition body] `(
    (if (not ,condition) ,body)
))

;; Usage
(unless (> x 10) (print "Small"))
;; Expands to: (if (not (> x 10)) (print "Small"))
```

**Auto-Gensym:** Variables defined in macros are automatically renamed to avoid shadowing.

```lisp
(defmacro swap [a b] `(
    (let temp ,a)  ;; Becomes temp_G1234 internally
    (,a := ,b)
    (,b := temp)
))
```

### Level 3: Defsyntax (Full Power)

Racket-style hygienic macros for building DSLs.

```lisp
(defsyntax for-each [pattern] (
    ;; Pattern match on input syntax
    ;; Manipulate AST nodes
    ;; Return transformed syntax
))
```

---

## 9. Type System

### Structural Typing

Like TypeScript: types are defined by their shape, not their name.

```lisp
(definterface Nameable
    (fn get-name [] -> String))

(defclass Dog
    (let :public name <- String)
    (fn :public get-name [] -> String (return this.name)))

;; Dog satisfies Nameable implicitly (duck typing)
```

### Generics

```lisp
(defclass List<T>
    (let :private items <- Array<T>)
    
    (fn :public add [item <- T] (
        (items.push item)
    )))
```

### Union Types

Explicit "or" relationships:

```lisp
(fn process [input <- String | Int] (
    (match (type input) {
        String => (print "Got text")
        Int    => (print "Got number")
    })
))
```

### Type Guards

Runtime type checks with `is` and `as`:

```lisp
(if (obj is Dog) (
    (let d (obj as Dog))
    (d.bark)
))
```

---

## 10. Operator Overloading

L-lang supports operator overloading for both standalone functions and class/struct methods using the `:operator` modifier.

### Standalone Operators

Define overloads for specific types at the module level:

```lisp
(fn :operator + [a <- Complex b <- Complex] -> Complex (
    (new Complex (+ a.real b.real) (+ a.imag b.imag))
))
```

### Method-Style Operators

Implement operators directly inside a struct or class:

```lisp
(defstruct Vector2
    (let :ctor x <- Real 0)
    (let :ctor y <- Real 0)

    (fn :operator + [other <- Vector2] (
        (new Vector2 (+ x other.x) (+ y other.y))
    ))

    ;; Unary negation
    (fn :operator - [] (
        (new Vector2 (- x) (- y))
    ))
)
```

Operators supported: `+`, `-`, `*`, `/`, `==`, `!=`, `<`, `>`, `<=`, `>=`.

---

## 11. Modules & Imports

### Exporting

```lisp
(fn calculate [] (...))
(export calculate)
```

### Importing

```lisp
(import "math-lib.lisp")               ;; Import all
(import { sin, cos } from "math.lisp") ;; Import specific
```

---

## 11. Runtime Type Information (RTTI)

Trimmed reflection—enough to inspect, not enough to break encapsulation.

### Type Introspection

```lisp
(let t (type obj))
(print t.name)           ;; "Dog"
(print t.parent)         ;; Animal (if exists)
(print t.fields)         ;; [{ name: "name", type: String }]
(print t.methods)        ;; ["bark", "speak"]
```

### Runtime Type Checks

```lisp
(if (obj is Dog) ...)         ;; Type check
(let d (obj as Dog))          ;; Downcast
(let maybe (obj as? Dog))     ;; Safe cast (returns nil if fails)
```

---

## 12. Memory Management

**Default:** Garbage collected (Go-style tracing GC with escape analysis).

**Opt-in Fine Control:**

```lisp
(defclass :gc User ...)      ;; GC-managed (default)
(defclass :stack Point ...)  ;; Stack-allocated
(defclass :manual Buffer     ;; Manually allocated and freed memory
    (fn :destructor cleanup [] (
        ;; Called on explicit free
    )))
```

---

## 13. Conventions

### Preferred Naming

- **Functions:** `kebab-case` (e.g., `get-user-by-id`)
- **Classes:** `PascalCase` (e.g., `UserController`)
- **Constants:** `CAPS_SNAKE_CASE` (e.g., `MAX_CONNECTIONS`)

---

*Last Updated: January 2026*
