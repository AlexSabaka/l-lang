# Language ideas — a wishlist, rescued from W99

**Status:** raw design ideas, not decisions. Rescued verbatim-in-spirit from
`examples/W99_L_sloth_design_v1.lisp` (a C#-WebAPI-port scratchpad) before that file was deleted.
Staged here for a later Sabaka⇄Dove design round — to be triaged into `docs/roadmap.md` /
`docs/spec/DECISIONS.md` when picked up. Syntax below is the *scratchpad's* spelling; treat it as
intent, not ratified grammar. Where a piece already partly exists or is already blocked in the
corpus, that's noted.

---

## Type system

### Refinement / range types
```lisp
(deftype uint8 Int :where Int :is (0 .. 255))
```
A base type narrowed by a predicate/range. Needs the `..` **range operator**, which neither frontend
lexes today (this is exactly what blocks `04-data-types/07_structs.lisp`, per the manifest). Opens
the door to `uint8[256]` **sized array types** too (grammar_v2 rejects sized arrays today).

### `deftype` compositions — unions & intersections
```lisp
(deftype Vegetable :is Carrot | Potato | Cabbage)                 ; union
(deftype Borsch :extends Food :is Carrot & Potato & Cabbage & …)  ; intersection
```
`deftype` as type algebra: unions (`|`), intersections (`&`), and `:extends` on the composition.

### `:where` constraint kinds (the three relations)
```lisp
:where T :is A            ; strict — T == A
:where T :extends A       ; T is A or any subtype of A
:where T :implements IA   ; STRUCTURAL — T matches IA's shape even without an explicit :implements
```
Structural conformance is the interesting one (TS-style duck typing alongside nominal). The
dungeon extraction (`entity.lisp`) already probes structural-vs-nominal at runtime; this is the
type-annotation surface for it.

### Generic `new()` / ctor constraints
```lisp
(definterface IRepository<TEntity> :where TEntity :is class new() …)
(defclass EntityUtils<T> :where T :has ctor :implements IEntity :inherits BaseEntity …)
```
Constrain a type parameter to be constructible / to inherit / to implement — combinable.

### Mapped types & key selectors (TS-style)
```lisp
(deftype ReadOnly<T> { (let :readonly [P keyof T] <- T[P]) })         ; over each key P of T
(deftype IsAvailable<T> {
    (let :readonly ['"IsAvailable{P}" :where P keyof T] <- T[P])      ; string-formatted NEW key names
    (let :readonly ['"{P}WithMetadata" :where P keyof T] <- { data <- T[P], meta <- Meta<T[P]> })
})
```
`keyof`, indexed access `T[P]`, and key remapping via string-interpolated names. The `:readonly`
member modifier rides along (noted as ".NET compatibility" in the scratchpad).

### Type-guard patterns & `typeof`
```lisp
(fn isString [x <- Any] -> Boolean (match x { s -> String => true  _ => false }))
```
A `pattern -> Type =>` arm as a type guard; a `typeof` operator for guards. Also the note that
`Any` must NOT be the same as `Object` (System.Object) even though they look alike.

### `implicit` / `explicit` cast-operator overloading (C#-style)  *(added 2026-07-20)*
```csharp
// C# shape being stolen:
public static implicit operator Celsius(Fahrenheit f) => new Celsius((f.V - 32) * 5 / 9);
public static explicit operator int(Money m)         => (int)m.Amount;   // requires (int)m at the call site
```
User-defined conversions attached to a type: `implicit` ones fire automatically wherever the target
type is expected (assignment, argument passing, return); `explicit` ones fire only under an explicit
cast. This is the **overloadable-conversion** surface — the dual of operator overloading, which
l-lang already models (see `06-value-semantics`). **Sabaka's framing:** this ties directly back to
our open **type-narrowing / casting** question — an `explicit` operator is exactly a checked,
user-authored narrowing, and an `implicit` operator is a widening the checker may insert silently.
Design questions to settle when picked up: the l-lang spelling (a `:implicit`/`:explicit` modifier on
an `operator`/`cast` member? a `defcast`?), how it interacts with the coercion-insertion pass (the C
backend's `InsertCoercions` P2 is the natural home on the native side), and ambiguity rules when
several implicit paths exist. **Deferred until HIR is implemented** — revisit alongside the
narrowing/casting work.

---

## Functions & generics

### Generic functions
```lisp
(fn ?<T> [cond :default false <- Boolean | String  a <- T  b <- T] -> T
    :where T :is class, ctor
    (match cond { #t => a  #f => b }))
```
Type-parameterized free functions with `:where` constraints and a **default parameter value**
(`:default false`) and a **union-typed parameter** (`Boolean | String`).

### Predicate / function match arms
```lisp
(match age {
    (s <- string)                 => ()
    (1  2  3)                     => ()                       ; list/tuple pattern
    (fn [x] (& (> x 0) (< x 10)))  => "just a baby"           ; a lambda predicate as a pattern
    _                             => "…"
})
```
Match arms that are **predicate lambdas**, plus the full pattern zoo the scratchpad enumerates:
constant, identifier, type, list, vector, map, expression, and function patterns.

---

## Metaprogramming & DSLs

### Quoted-AST as a typed query DSL
```lisp
(fn :async sql<T> [query <- ASTQuote] -> T[] ())
(sql<Product> '(SELECT p.Id, p.Price FROM dbo.Warehouse WHERE p.Quantity > 0 ORDER BY p.Price DESC))
```
A quoted form (`ASTQuote`) passed to a generic function that interprets it — LINQ-to-SQL shaped.
Ties into the homoiconicity question already open in `04-data-types/01_quoting.lisp` (what a quote
*is*: cons-list vs AST datum) and the missing runtime `eval`.

---

## Modifiers / attributes / visibility

### C#-style attributes (via modifiers)
```lisp
[ApiController]                                    ; bracket-attribute form
[Route "api/v{version:apiVersion}/[controller]"]
(defclass :internal FoodsController :inherits ControllerBase
    :with ApiController
    :with Route "api/v{version:apiVersion}/[controller]"     ; :with modifier form
    (let :ctor _foodRepo <- IFoodsRepository<Food>) …)
```
Two spellings of attributes: bracket `[Attr args]` and `:with Attr args`. **Sabaka's note: this is
achievable with custom modifiers in l-lang** — an attribute is a decorator carrying metadata. The
`:with` form composes cleanly with existing modifiers.

### Field / member modifiers seen in the scratchpad
`:readonly`, `:ctor` (constructor-injected field), `:private`/`:public`/`:internal` visibility,
`:static` classes & methods, `:stack` (stack allocation — currently a `RESERVED_NATIVE_MODIFIER`,
a hard error on the JS target, per manifest `04-data-types/07_structs.lisp`), `:async`, and
`:with JsonIgnore`-style member attributes.

---

## Data & misc

- **`defstruct` / `defrecord`** — value structs and records (defstruct exists; `defrecord` named,
  unbuilt).
- **Flags enums** — `(defenum :public SomeEnum :with Flags …)`.
- **Tuples** — `(return (tuple avg rms))` and tuple destructuring.
- **`|>` pipeline with `.method` selectors** — `(|> numList sq .Sum)`,
  `(… |> .skip N |> .take M |> .to-list)`; a leading-dot method selector in pipe position.
- **`infix`** — `(Int32 (infix foods-query.Count / query-params.PageSize))` for an infix escape
  hatch inside prefix code.
- **Instance-vs-static method distinction by dot** — the scratchpad muses that instance methods
  start with `.` and static/free methods don't.
