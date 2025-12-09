# 🦥 l-lang Language Reference

This document covers the syntax, keywords, and core concepts of **l-lang**. 

*Note: This language is in active development. Syntax subject to change.*

---

## 1. Basics & Comments

**l-lang** uses S-expressions (parenthesized lists) for code structure.

### Comments
```lisp
;; This is a standard comment
(let x 10) ; Inline comment

;@ +perf inline   ;; Control comments (compiler directives)
```

### Literals
```lisp
10          ;; Integer
3.14        ;; Float
1/3         ;; Fraction
10+2i       ;; Complex Number
0xFF        ;; Hex
"Hello"     ;; String
'"Count: {(x)}" ;; Formatted String (Interpolation)
true / false    ;; Booleans
nil             ;; Null/None
```

---

## 2. Variables & State

Variables are immutable by default (`let`). Mutable variables must be declared with `mut`.

### Immutable
```lisp
(let pi 3.14159)
(let name "Sloth")
```

### Mutable
```lisp
(mut counter 0)
(counter := (+ counter 1)) ;; Reassignment uses :=
```

### Type Annotations
You can (and should) strictly type your variables using the `<-` operator.
```lisp
(let x <- Number 10)
(mut list <- List<String> ["a" "b"])
```

---

## 3. Data Structures

### Vectors & Lists
```lisp
(let v [1 2 3])      ;; Vector (Array)
(let l (1 2 3))      ;; List (Linked List / AST Node)
(let v-access v[0])  ;; Indexer
```

### Maps (Dictionaries)
Keys can be keywords (starting with `:`) or strings.
```lisp
(let user { 
    :name "Sid" 
    :age 30 
    "is-admin" false 
})
(std.console.log user.name)
(std.console.log user["is-admin"])
```

### Matrices
A unique native type for mathematical operations. Rows are separated by `|`.
```lisp
(let identity 
    [ 1, 0, 0 
    | 0, 1, 0 
    | 0, 0, 1 ])

;; 2D Access
(let val matrix[row, col])
```

---

## 4. Functions & Pipelines

### Definition
Functions are defined with `fn`. Return types are specified with `->`.
```lisp
(fn add [a <- Number, b <- Number] -> Number (
    (return (+ a b))
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
The pipe operator passes the result of the previous expression as the *first* argument to the next function.
```lisp
;; Logic: square(add(10, 5))
(5 
 |> (add 10) 
 |> square)

;; Object method chaining
(query
 |> .Skip 10
 |> .Take 5)
```

---

## 5. Flow Control

### If / Else
Standard conditional branching.
```lisp
(if (> x 10)
    (print "Big")
    (print "Small"))
```

### When (One-liner)
Great for guards or single returns.
```lisp
(when is-loading :then "Please wait...")
```

### Cond (Switch-like)
Evaluates multiple conditions in order.
```lisp
(cond
    ((>= score 90) "A")
    ((>= score 80) "B")
    (true          "F")) ;; Default
```

### Loops
**l-lang** uses explicit keywords for loop construction.

**While Loop:**
```lisp
(while (> i 0) (
    (i := (- i 1))
))
```

**For Loop (C-Style):**
Requires named arguments `:init`, `:cond`, `:step`.
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

The `match` expression is highly powerful. It supports constants, types, vectors, maps, and logic guards.

```lisp
(match value {
    0            => "Zero"
    val :is int  => "It's an integer"
    [1 2 _]      => "Vector starting with 1, 2"
    { :type "A" } => "Map with type A"
    _            => "Default/Catch-all"
})
```

---

## 7. Object Oriented Programming

**l-lang** treats OOP as a first-class citizen with specific keywords for classes, inheritance, and encapsulation.

### Classes
Use `defclass`. Properties marked `:ctor` are automatically initialized via the constructor.
```lisp
(defclass Dog :extends Animal
    (let :public :ctor name)  ;; Public field, set in constructor
    (let :private age 0)      ;; Private field, default 0

    (fn :public speak [] (
        (print '"{(this.name)} says Woof!")
    ))
)

(let d (new Dog "Buddy"))
```

### Structs
Value types (passed by copy).
```lisp
(defstruct Point
    (let :public x 0)
    (let :public y 0))
```

### Interfaces
```lisp
(definterface IRepository<T>
    (async fn GetAll [] -> List<T>)
    (async fn GetById [id] -> T))
```

### Enums
```lisp
(defenum HttpMethod :GET :POST :PUT :DELETE)
```

---

## 8. Modules & Imports

### Exporting
```lisp
(fn calc [] (...))
(export calc)
```

### Importing
```lisp
(import "math-lib.lisp")
(import { sin, cos } from "math.lisp")
```
