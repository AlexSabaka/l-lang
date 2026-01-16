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

### Async / Await

```lisp
(async fn fetch-data [id] (
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
    x :is Int      => "Some integer"
    [1 2 _]        => "Vector: [1, 2, anything]"
    { :type "A" }  => "Map with key :type = 'A'"
    _              => "Default case (matches everything)"
})
```

### Type Matching with RTTI

Runtime type introspection via `typeof`:

```lisp
(fn describe [obj] (
    (match (typeof obj) {
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
    (async fn GetAll [] -> List<T>)
    (async fn GetById [id] -> T))
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

Evaluate code at compile-time. Types are values. Functions can run during compilation.

```lisp
;; Generic function via comptime
(fn :comptime max [a b] (if (> a b) a b))

;; Usage - compiler specializes
(max 5 10)     ;; Generates max_int
(max 3.14 2.7) ;; Generates max_float
```

**Comptime Parameters:**

```lisp
(fn create-array [comptime T, size <- Int] -> Array<T> (
    ;; T is known at compile time, size at runtime
    (Array<T>.new size)
))
```

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
    (match (typeof input) {
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
(let t (typeof obj))
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
