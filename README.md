# 🦥 l-lang

> **"We get there when we get there, but we do it right."**

**l-lang** is a statically typed Lisp that thinks it's C#. 

It bridges the gap between functional freedom and object-oriented structure. It combines the syntax of Lisp (S-expressions, macros, code-as-data) with the type safety, explicit hierarchy, and tooling of enterprise languages like C# and TypeScript.

If you love parentheses but hate runtime errors, you're in the right place.

## 🧐 What is this?

Most Lisps are dynamic. Most enterprise languages are verbose. **l-lang** asks: *Why not have both?*

It is a general-purpose language that currently transpiles to JavaScript (with an LLVM backend in the roadmap). It features:

*   **Homoiconic Syntax:** Everything is an expression.
*   **Strong Static Typing:** Generics, Interfaces, and Structs.
*   **Real OOP:** Classes, Inheritance, and Constructors, not just prototype hacking.
*   **Pipeline Operators:** Native `|>` support because nesting function calls is a sin.
*   **Pattern Matching:** Powerful `match` expressions that put `switch` statements to shame.

## ⚡ A Taste of l-lang

Here is what it looks like when you stop worrying and love the bracket:

```lisp
(defclass :internal FoodsController :inherits ControllerBase
    (let :ctor _repo <- IFoodsRepository<Food>)

    ;; Async method with strict return typing
    (async fn :public GetAll [query] -> IActionResult (do
        (query
            |> _repo.GetAll
            |> .Skip (* query.Page query.PageSize)
            |> .Take query.PageSize
            |> Ok)))
)

;; Pattern matching with vector destructuring
(fn analyze-vector [vec] (
    (match vec {
        [1 2 3] => "Basic count"
        [1 _ _] => "Starts with one"
        []      => "Empty"
        _       => "Unknown vector"
    })
))
```

## 🚧 Status: Pre-Alpha / Prototype

**Current State:** 🏗️ *Construction Zone*

The compiler currently transpiles to JavaScript. We are stabilizing the grammar and standard library.
*   **Working:** Basics, Variables, Functions, Pipelines, Simple OOP, Pattern Matching.
*   **In Progress:** Advanced Generics, Macros, LLVM IR generation.

See [ROADMAP.md](ROADMAP.txt) for the detailed plan towards World Domination (slowly).

## 🛠️ Installation & Usage

*Note: You need Node.js and TypeScript installed to build the compiler.*

1.  **Clone the repo:**
    ```bash
    git clone https://github.com/your-username/l-lang.git
    cd l-lang
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Build the compiler:**
    ```bash
    npm run build
    ```

4.  **Run a script:**
    ```bash
    node dist/cli.js run examples/01-basics/00_vars.lisp
    ```

## 🤝 Contributing

We welcome fellow sloths. If you see a bug, fix it. If you see a missing feature, propose it. Just don't rush us.

## 📜 License

MIT
