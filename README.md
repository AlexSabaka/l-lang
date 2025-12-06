
# l-lang 🦥

A statically typed Lisp that thinks it's C#.

**l-lang** bridges the gap between functional freedom and object-oriented structure. It combines the syntax of Lisp (S-expressions, macros) with the type safety and hierarchy of enterprise languages like C# and TypeScript.

"We get there when we get there, but we do it right."

## Key Features

*   **OOP & Types:** Full support for Classes, Interfaces, Enums, and Generics.
*   **Functional Core:** Immutable by default, with native pipeline operators (`|>`) to kill nesting hell.
*   **Homoiconic:** It's Lisp. Code is data. Macros are powerful.
*   **Modern Tooling:** Written in TypeScript, currently transpiling to JavaScript.

## Example

```lisp
(defclass :internal FoodsController :inherits ControllerBase
    (let :ctor _repo <- IFoodsRepository<Food>)

    (async fn :public GetAll [query] -> IActionResult (do
        (query
            |> _repo.GetAll
            |> .Skip (* query.Page query.PageSize)
            |> .Take query.PageSize
            |> Ok)))
```

## Status

Prototype / Pre-Alpha.

## License

MIT
