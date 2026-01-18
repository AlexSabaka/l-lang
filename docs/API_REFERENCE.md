# 🔌 l-lang API Reference

Complete API reference for the **l-lang** standard library and compiler introspection.

> Note: Standard library is under development. Core data manipulation functions are available; full stdlib coming in Phase 4.

---

## 📦 Built-in Functions (Core)

### Arithmetic & Math

| Function | Signature | Returns | Example |
|----------|-----------|---------|---------|
| `+` | `(+ ...nums)` | Sum of numbers | `(+ 1 2 3)` → `6` |
| `-` | `(- ...nums)` | Difference or negation | `(- 10 3)` → `7` |
| `*` | `(* ...nums)` | Product of numbers | `(* 2 3 4)` → `24` |
| `/` | `(/ ...nums)` | Quotient | `(/ 10 2)` → `5` |
| `%` | `(% a b)` | Modulo | `(% 10 3)` → `1` |
| `^` | `(^ a b)` | Power/exponent | `(^ 2 3)` → `8` |
| `inc` | `(inc n)` | Increment by 1 | `(inc 5)` → `6` |
| `dec` | `(dec n)` | Decrement by 1 | `(dec 5)` → `4` |
| `abs` | `(abs n)` | Absolute value | `(abs -5)` → `5` |
| `floor` | `(floor n)` | Round down | `(floor 3.7)` → `3` |
| `ceil` | `(ceil n)` | Round up | `(ceil 3.2)` → `4` |
| `round` | `(round n)` | Round nearest | `(round 3.5)` → `4` |
| `sqrt` | `(sqrt n)` | Square root | `(sqrt 9)` → `3` |
| `min` | `(min ...nums)` | Minimum value | `(min 5 2 8)` → `2` |
| `max` | `(max ...nums)` | Maximum value | `(max 5 2 8)` → `8` |

### Comparison & Logic

| Function | Signature | Returns | Example |
|----------|-----------|---------|---------|
| `=` | `(= a b)` | Equality check | `(= 5 5)` → `true` |
| `!=` | `(!= a b)` | Inequality | `(!= 5 3)` → `true` |
| `<` | `(< a b)` | Less than | `(< 3 5)` → `true` |
| `<=` | `(<= a b)` | Less or equal | `(<= 5 5)` → `true` |
| `>` | `(> a b)` | Greater than | `(> 5 3)` → `true` |
| `>=` | `(>= a b)` | Greater or equal | `(>= 5 5)` → `true` |
| `!` | `(! b)` | Logical NOT | `(! false)` → `true` |
| `&&` | `(&& ...bs)` | Logical AND | `(&& true true)` → `true` |
| `` | `( ...bs)` | Logical OR | `( true false)` → `true` |

### String Operations

| Function | Signature | Returns | Example |
|----------|-----------|---------|---------|
| `+` | `(+ str1 str2)` | String concatenation | `(+ "Hello" " World")` → `"Hello World"` |
| `strlen` | `(strlen s)` | String length | `(strlen "Hello")` → `5` |
| `substr` | `(substr s start end)` | Substring | `(substr "Hello" 1 3)` → `"el"` |
| `upcase` | `(upcase s)` | Uppercase | `(upcase "hello")` → `"HELLO"` |
| `downcase` | `(downcase s)` | Lowercase | `(downcase "HELLO")` → `"hello"` |
| `trim` | `(trim s)` | Remove whitespace | `(trim "  hello  ")` → `"hello"` |
| `split` | `(split s sep)` | Split into array | `(split "a,b,c" ",")` → `["a" "b" "c"]` |
| `join` | `(join arr sep)` | Join array to string | `(join ["a" "b"] ",")` → `"a,b"` |
| `contains` | `(contains s sub)` | Check if contains | `(contains "hello" "ell")` → `true` |
| `starts-with` | `(starts-with s prefix)` | Check prefix | `(starts-with "hello" "he")` → `true` |
| `ends-with` | `(ends-with s suffix)` | Check suffix | `(ends-with "hello" "lo")` → `true` |

### Collection Operations

| Function | Signature | Returns | Example |
|----------|-----------|---------|---------|
| `length` | `(length coll)` | Length/size | `(length [1 2 3])` → `3` |
| `first` | `(first coll)` | First element | `(first [1 2 3])` → `1` |
| `last` | `(last coll)` | Last element | `(last [1 2 3])` → `3` |
| `rest` | `(rest coll)` | All but first | `(rest [1 2 3])` → `[2 3]` |
| `push` | `(push coll ...items)` | Append items | `(push [1 2] 3)` → `[1 2 3]` |
| `pop` | `(pop coll)` | Remove last | `(pop [1 2 3])` → `[1 2]` |
| `at` | `(at coll index)` | Get by index | `(at [1 2 3] 1)` → `2` |
| `get` | `(get map key)` | Get from map | `(get {:a 1} :a)` → `1` |
| `has` | `(has coll key)` | Check if exists | `(has {:a 1} :a)` → `true` |
| `keys` | `(keys map)` | Get all keys | `(keys {:a 1 :b 2})` → `[:a :b]` |
| `values` | `(values map)` | Get all values | `(values {:a 1 :b 2})` → `[1 2]` |
| `map` | `(map fn coll)` | Transform each | `(map inc [1 2 3])` → `[2 3 4]` |
| `filter` | `(filter pred coll)` | Keep matching | `(filter (fn [x] (> x 2)) [1 2 3])` → `[3]` |
| `reduce` | `(reduce fn init coll)` | Aggregate | `(reduce + 0 [1 2 3])` → `6` |
| `flatten` | `(flatten coll)` | Flatten nested | `(flatten [[1 2] [3 4]])` → `[1 2 3 4]` |
| `reverse` | `(reverse coll)` | Reverse | `(reverse [1 2 3])` → `[3 2 1]` |
| `sort` | `(sort coll)` | Sort items | `(sort [3 1 2])` → `[1 2 3]` |
| `sort-by` | `(sort-by fn coll)` | Custom sort | `(sort-by length ["aaa" "a" "aa"])` → `["a" "aa" "aaa"]` |

### Type Operations

| Function | Signature | Returns | Example |
|----------|-----------|---------|---------|
| `type` | `(type x)` | Type of value | `(type 5)` → `Int` |
| `type-name` | `(type-name x)` | Type name as string | `(type-name [])` → `"Array"` |
| `is-int` | `(is-int x)` | Is integer? | `(is-int 5)` → `true` |
| `is-string` | `(is-string x)` | Is string? | `(is-string "hi")` → `true` |
| `is-array` | `(is-array x)` | Is array? | `(is-array [1 2])` → `true` |
| `is-map` | `(is-map x)` | Is map? | `(is-map {:a 1})` → `true` |
| `is-nil` | `(is-nil x)` | Is nil? | `(is-nil nil)` → `true` |
| `is-bool` | `(is-bool x)` | Is boolean? | `(is-bool true)` → `true` |

### I/O & Output

| Function | Signature | Returns | Example |
|----------|-----------|---------|---------|
| `print` | `(print ...items)` | Print to stdout | `(print "Hello")` → outputs `Hello` |
| `console.log` | `(console.log ...items)` | Print with newline | `(console.log "Hi")` → outputs `Hi\n` |
| `prn` | `(prn x)` | Print debug repr | `(prn [1 2 3])` → outputs `[1 2 3]` |
| `alert` | `(alert msg)` | Browser alert | `(alert "Warning!")` |
| `console.log` | `(console.log ...items)` | Console output | `(console.log "Debug")` |

### Misc

| Function | Signature | Returns | Example |
|----------|-----------|---------|---------|
| `identity` | `(identity x)` | Return unchanged | `(identity 5)` → `5` |
| `constantly` | `(constantly x)` | Return function | `((constantly 5))` → `5` |
| `partial` | `(partial fn ...args)` | Partial application | `(partial + 5)` → function |
| `compose` | `(compose ...fns)` | Function composition | `(compose inc (* 2))` |
| `apply` | `(apply fn args)` | Call with arg list | `(apply + [1 2 3])` → `6` |

---

## 📝 Control Flow

### Conditionals

```lisp
;; if/else
(if (> x 5)
    "greater"
    "less-or-equal")

;; when (no else)
(when (> x 5)
    (console.log "Greater!"))

;; cond (multiple branches)
(cond
    ((> x 10) "very high")
    ((> x 5)  "high")
    (else     "low"))
```

### Loops

```lisp
;; for loop
(for :init (mut i 0) :cond (< i 10) :step (inc i)
    (console.log i))

;; while loop
(while (< count 10) (
    (console.log count)
    (mut count (inc count))
))

```

### Pattern Matching

```lisp
(match value {
    0           => "zero"
    1           => "one"
    [1 2 3]     => "specific vector"
    [1 _ _]     => "vector starting with 1"
    [_ ...]     => "any vector"
    {:type Dog} => "dog object"
    _           => "anything else"
})
```

---

## 🏛️ Type System

### Primitive Types

```lisp
;; Numbers
(let x 42)              ;; Int
(let y 3.14)            ;; Float

;; Strings
(let msg "hello")       ;; String
(let interpolated '"value: {(x)}")

;; Booleans
(let flag true)         ;; Bool

;; Collections
(let vec [1 2 3])       ;; Array<Int>
(let map {:a 1 :b 2})   ;; Map<String, Int>
```

### Type Annotations

```lisp
;; Explicit type annotation
(let x <- Int 5)
(let name <- String "Alice")
(let nums <- Int[] [1 2 3])

;; Function parameter types
(fn add [x y] -> Int
    (+ x y))

;; Generics
(let names <- String[] ["a" "b"])
```

### User-Defined Types

```lisp
;; Type alias
(deftype UserId Int)
(let uid (as UserId 123))

;; Struct
(defstruct Person
    (let :stor name <- String)
    (let :ctor age <- Int)
)

;; Enum
(defenum Status
    Active
    Inactive
    Pending)
```

---

## 🏗️ Object-Oriented Programming

### Classes

```lisp
(defclass Animal
    ;; Constructor
    (let :ctor name)
    
    ;; Instance variable
    (let energy 100)
    
    ;; Method
    (fn speak [msg] (
        (+ this.name " says: " msg)
    ))
    
    ;; Computed property
    (fn :public is-tired [] (
        (< this.energy 50)
    ))
)

;; Create instance
(let dog (new Animal "Rex"))

;; Call method
(dog.speak "Woof!")

;; Access property
(console.log dog.energy)
```

### Inheritance

```lisp
(defclass Dog :inherits Animal
    ;; Override method
    (fn speak [msg] (
        (+ this.name " barks: " msg)
    ))
    
    ;; Call parent method
    (fn full-speak [msg] (
        (super.speak msg)
    ))
)

(let dog (new Dog "Buddy"))
(dog.speak "Bark!")  ;; Uses Dog's speak
```

### Visibility

```lisp
;; Public (default)
(fn :public get-value [] ...)

;; Internal (same module only)
(fn :internal helper [] ...)

;; Private (not yet supported)
(fn :private internal-only [] ...)
```

---

## 🔌 Metaprogramming

### `comptime` (Compile-time Execution)

```lisp
;; Evaluated at compile time
(fn :comptime max [a b]
    (if (> a b) a b))

;; Used in types
(let array <- Int[(max 10 20)] [])
```

### `defmacro` (Simple Rewrites)

```lisp
(defmacro when [test body]
    (list 'if test body nil))

(when (> x 5)
    (console.log "Greater!"))
;; Expands to: (if (> x 5) (console.log "Greater!") nil)
```

### `defsyntax` (DSL Building)

```lisp
(defsyntax my-dsl
    ;; Pattern matching on syntax
    (rule (my-rule x y) (do-something x y))
)

(my-dsl
    (my-rule 1 2)
)
```

---

## 🎯 Pipeline Operator

The `|>` operator chains function calls left-to-right:

```lisp
;; Traditional (right-to-left nesting)
(double (add 5 (double 3)))

;; Pipeline (left-to-right)
(3 |> double |> (add 5) |> double)

;; With method calls
(let data [1 2 3 4 5])
(data
    |> (map inc)
    |> (filter (fn [x] (> x 2))) 
    |> (reduce + 0))
```

**Translation**:
```lisp
(x |> f1 |> (f2 arg) |> f3)
;; → (f3 (f2 (f1 x) arg))
```

---

## 🔄 Async/Await

```lisp
;; Async function
(async fn fetch-data []
    (let result (await (fetch-from-api)))
    (return result))

;; Promise handling
(fn async-op []
    (Promise.resolve 42))

(async fn test []
    (let val (await (async-op)))
    (console.log val))
```

---

## 📦 Module System

### Define Module

```lisp
;; math-utils.lisp
(fn add [a b] (+ a b))
(fn multiply [a b] (* a b))

(export add multiply)
```

### Import Module

```lisp
;; main.lisp
(import { M as mu } from math-utils)
(import { max } math-utils)

(mu.add 5 3)
(add 5 3)  ;; Direct import
```

---

## 🛡️ Error Handling

### Try/Catch

```lisp
(try
    (do-something-risky)
catch e :of Error
    (console.log "Error:" (. e message))
finally
    (cleanup)
)
```

### Custom Errors

```lisp
(defclass Error CustomError
    (let :ctor message <- String)
    (let :ctor code <- Int))

(throw (new CustomError "Something failed" 500))
```

---

## 🎨 String Interpolation

```lisp
(let name "World")
(let msg "Hello, {name}!")
;; → "Hello, World!"

;; Expression interpolation
(let x 5)
(let result "Value: {(+ x 10)}")
;; → "Value: 15"
```

---

## 📊 JSON & Serialization

```lisp
;; Parse JSON
(let data (JSON.parse "{\"name\": \"Alice\"}"))

;; Stringify JSON
(let json (JSON.stringify {:name "Bob"}))
;; → "{\"name\": \"Bob\"}"
```

---

## ⚙️ Compiler Introspection

### At Runtime

```lisp
;; Get type info
(type 42)               ;; → "Int"
(type-name [1 2 3])     ;; → "Array"

;; Check type
(is-int 42)             ;; → true
(is-array [1 2 3])      ;; → true
```

### Compilation Artifacts

Inspect intermediate compilation stages:

```bash
# View parsed AST
cat FILE.parsed.json

# View symbol table
cat FILE.symbols.json

# View inferred types
cat FILE.types.json

# View generated JavaScript
cat FILE.js
```

---

## 🔗 Interop with JavaScript

l-lang compiles to JavaScript, enabling direct interop:

```lisp
;; Access global objects
(. window.location.href "https://example.com")
(console.log "Hello from JS!")

;; Call JS functions
(let result (Math.floor 3.7))

;; Create JS objects
(let obj {:name "test" :value 42})

;; Eval JavaScript (not recommended)
(let x (js-eval "34 + Math.cos(1)"))
```

---

## 📚 Related Resources

- **Language Reference**: [language/SYNTAX.md](language/SYNTAX.md)
- **Type System Details**: [compiler/TYPE_SYSTEM.md](compiler/TYPE_SYSTEM.md)
- **Examples**: [examples/](../examples/)
- **Test Suite**: Tests for all APIs in `src/test/`

---

## ⚡ Cheat Sheet

```lisp
;; Variables
(let x 5)               ;; Immutable
(mut y 10)              ;; Mutable
(mut y (+ y 5))         ;; Update

;; Functions
(fn add [a b] (+ a b))
(fn no-args [] 42)

;; Collections
(let arr [1 2 3])
(let map {:key "value"})
(arr[0])               ;; Get by index
(map["key"])            ;; Get by key

;; Control flow
(if cond true-val false-val)
(when cond body)
(match x {...})

;; Pipelines
(val |> f1 |> (f2 arg) |> f3)

;; Classes
(defclass Name
    (let :ctor field)
    (fn method [] ...))
(let obj (new Name val))
(obj.method)

;; Pattern matching
(match vec {
    [1 2 3] => "exact"
    [1 _ _] => "starts with 1"
    _ => "anything"
})
```

---

**Last Updated**: January 16, 2026

For more details, see [language/SYNTAX.md](language/SYNTAX.md) and [QUICK_START.md](QUICK_START.md).
