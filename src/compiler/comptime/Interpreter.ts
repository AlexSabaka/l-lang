import * as ast from "../frontend/ast";
import { listNodes } from "../analysis/listForm";
import { SymbolTable } from "../analysis/SymbolTable";
import { FLOOR } from "../floor/floor";

/**
 * THE COMPTIME INTERPRETER -- l-lang evaluated by l-lang's own compiler, with no host in the path.
 *
 * `:comptime` used to be evaluated by lowering the expression to JavaScript and running it in
 * `node:vm`. That made the JS backend the compiler's own EVALUATOR rather than merely a target (D69),
 * which is why deleting it was impossible, and it cost correctness in a way nobody had measured: the
 * fold's result came back as a JS `number`, so `(inc 9007199254740992)` folded to 9007199254740992 --
 * the `+1` silently gone -- while the same call at run time, and the same literal written directly,
 * were both exact. This evaluates the AST instead, and carries an Int as a BIGINT throughout.
 *
 * WHAT MAKES THIS TRACTABLE, and it is worth stating because "write an interpreter" sounds unbounded:
 * a comptime call's arguments are already required to be LITERALS (LL0099, enforced before anything
 * gets here). So there is no runtime state to model, no closure capture, no mutation across a
 * suspension -- every evaluation starts from constants and ends in one. The subset is small because
 * the language already made it small.
 *
 * WHAT IT IS NOT: a general l-lang VM. The REPL executes arbitrary user code and is a different
 * problem wearing the same word. Anything outside the subset below is refused BY NAME rather than
 * quietly declining to fold -- a silent failure ships a call to a `:comptime` function whose
 * declaration was already deleted, which is a `ReferenceError` at run time with no diagnostic.
 */

/** A comptime value. `bigint` is an Int and `number` is a Real -- D51's split, kept end to end. */
const ZERO = BigInt(0);

/**
 * A comptime value. `bigint` is an Int and `number` is a Real -- D51's split, kept end to end.
 *
 * `ast.ASTNode` is here as of M3, and it is what makes a SYNTAX tier possible at all. Until it was
 * added this type ran `bigint | number | string | boolean | null | CTValue[]` -- scalars and arrays --
 * so the evaluator could not hold a form even in principle, and D69's `defsyntax` ("receives a full
 * AST") could not have been written in it.
 *
 * It does NOT weaken what makes this interpreter tractable. The header above credits the literal-only
 * argument rule (LL0099) for that, and a QUOTED FORM IS A LITERAL in exactly the sense meant: it needs
 * no evaluation, it IS the constant. `'(+ 1 2)` is as finished a value as `3` is -- more so, since 3
 * had to be computed. So the subset stays "every evaluation starts from constants and ends in one".
 */
export type CTValue = bigint | number | string | boolean | null | CTValue[] | ast.ASTNode;

/** Raised for anything the interpreter declines to evaluate. Carries the node so the caller can locate it. */
export class ComptimeError extends Error {
  constructor(message: string, readonly node?: ast.ASTNode) {
    super(message);
  }
}

/**
 * The evaluation budget.
 *
 * `vm.runInContext` was called with no timeout, so a `:comptime` function that does not terminate
 * hung the COMPILER -- no diagnostic, no location, no output. A step counter is the first thing here
 * that can see that, and a compile that fails loudly beats one that never returns.
 */
const MAX_STEPS = 2_000_000;
const MAX_DEPTH = 512;

/**
 * Floor operations that are REFUSED at compile time rather than unimplemented.
 *
 * A fold replaces an expression with the answer one particular compilation produced. For anything
 * nondeterministic that turns the same source into a different program each build -- `Math.random`
 * would be a constant chosen once, at the compiler's whim, and then shipped. Reproducible builds are
 * the property being defended, and refusing is the only way to keep it.
 *
 * The vm path could not have enforced this: the sandbox simply had the host's `Math` in scope, so
 * `(let :comptime r (Math.random))` folded to a number and nothing anywhere noticed.
 */
const NONDETERMINISTIC_FLOOR: ReadonlySet<string> = new Set([
  "Math.random",
  "Date.now",
  "read-file",
  "try-read-file",
  "write-file",
  "clock-ms",
  "clock-ns",
]);

type Env = Map<string, CTValue>;

export class ComptimeInterpreter {
  private steps = 0;
  private depth = 0;

  constructor(private readonly symbolTable: SymbolTable | undefined) {}

  /** Evaluate an expression to a value, or throw ComptimeError naming what stopped it. */
  evaluate(node: ast.ASTNode): CTValue {
    this.steps = 0;
    this.depth = 0;
    return this.evalNode(node, new Map());
  }

  /**
   * Evaluate a BODY with parameters already bound -- the `defsyntax` entry point (D95).
   *
   * The difference from `evaluate` is entirely in the environment: a syntax handler is called with its
   * parameters bound to the ARGUMENT FORMS, unevaluated. That is what makes it a macro rather than a
   * function, and it is why the bindings have to arrive from outside rather than being computed here.
   *
   * The body is a block, so its LAST expression is the answer -- the same rule a function body follows.
   */
  evaluateWith(body: ast.ASTNode[], bindings: Map<string, CTValue>): CTValue {
    this.steps = 0;
    this.depth = 0;
    const env: Env = new Map(bindings);
    let last: CTValue = null;
    for (const stmt of body) {
      if (!stmt || stmt._type === "comment") continue;
      last = this.evalNode(stmt, env);
    }
    return last;
  }

  private tick(node: ast.ASTNode) {
    if (++this.steps > MAX_STEPS) {
      throw new ComptimeError(
        `evaluation did not finish within ${MAX_STEPS} steps -- a ':comptime' computation must terminate`,
        node
      );
    }
  }

  private evalNode(node: ast.ASTNode, env: Env): CTValue {
    this.tick(node);
    const n = node as any;

    switch (node._type) {
      case "integer-number":
        // Through the raw matched TEXT, not `value`. `value` is a JS number and has already rounded
        // anything past 2^53; `match` is the lossless copy, which is exactly the property D71 relies
        // on for the C backend's big-literal path.
        return typeof n.match === "string" && /^[+-]?\d+$/.test(n.match.trim())
          ? BigInt(n.match.trim())
          : BigInt(Math.trunc(n.value));
      case "float-number":
        return Number(n.value);
      case "string":
        return String(n.value);
      case "boolean":
        return Boolean(n.value);
      case "null":
        return null;
      case "vector":
        return (n.values ?? []).map((v: ast.ASTNode) => this.evalNode(v, env));
      case "simple-identifier":
        return this.lookup(n.id, node, env);
      case "if":
        return truthy(this.evalNode(n.condition, env))
          ? this.evalNode(n.then, env)
          : n.else
          ? this.evalNode(n.else, env)
          : null;
      case "match":
        return this.evalMatch(node as ast.MatchNode, env);
      case "list":
        return this.evalList(node as ast.ListNode, env);

      // `'(+ 1 2)` -- THE OPERAND IS NOT EVALUATED. That is the whole of quote (D3d), and it is why a
      // quoted form costs this interpreter nothing: there is no work to do, only a datum to hand back.
      case "quote":
        return (n as ast.QuoteNode).nodes;

      // `` `(if ~c nil ~body) `` -- a TEMPLATE (D96). Everything is data, as in quote, EXCEPT the
      // unquotes: each one is evaluated and its value spliced in as a node. This is the operation
      // quote alone cannot express -- `'(if c nil body)` NAMES `c`, it does not carry what `c` holds --
      // and without it a handler could inspect forms but never build one.
      case "quasiquote":
        return this.fillTemplate((n as ast.QuasiquoteNode).nodes, env);

      // Reached only OUTSIDE a quasiquote, since `fillTemplate` consumes the ones inside it. A hole
      // with no template around it has nothing to be a hole in.
      case "unquote":
        throw new ComptimeError(
          "'~' is an unquote and only means anything inside a quasiquote (D96)",
          node
        );

      // `expr._type`, `expr.nodes` -- a dotted read. The head is resolved as a binding and the
      // remaining parts are walked as FIELDS, which for an AST value is the same map-shaped access the
      // emitted backends give it (M1).
      case "composite-identifier": {
        const parts: string[] = (n as ast.CompositeIdentifierNode).parts ?? [];
        if (parts.length === 0) throw new ComptimeError("an empty dotted name", node);
        let cur: CTValue = this.lookup(parts[0], node, env);
        for (const p of parts.slice(1)) cur = this.field(cur, p, node);
        return cur;
      }

      // `xs[0]` -- an index into a vector, or into a node's array-valued field.
      case "indexer":
        return this.evalIndexer(node as ast.IndexerNode, env);
    }

    throw new ComptimeError(`'${node._type}' cannot be evaluated at compile time`, node);
  }

  /**
   * Walk a quasiquoted template, replacing every `unquote` with the VALUE of its expression (D96).
   *
   * The template is COPIED, never mutated: a `defsyntax` handler is called once per use site, and a
   * template that filled its own holes in place would come back already-filled the second time. That
   * is the same class of bug as a shared mutable default argument, and it would only show on the
   * second expansion -- so the copy is structural rather than defended by a flag.
   *
   * A spliced value has to become a NODE, because what surrounds it is a tree: an Int becomes an
   * `integer-number`, a String a `string`, and an AST value goes in as itself. That is what makes
   * `` `(+ ~a ~b) `` with `a = 1` a form that means `(+ 1 b)` rather than a tree with a raw JS number
   * hanging off it, which nothing downstream could type or emit.
   */
  private fillTemplate(node: ast.ASTNode, env: Env): ast.ASTNode {
    if (!node || typeof node !== "object") return node;

    if (node._type === "unquote") {
      const v = this.evalNode((node as ast.UnquoteNode).expression, env);
      return this.valueToNode(v, node);
    }

    const out: any = { ...(node as any) };
    for (const key of ast.getNodeIterableKeys(node)) {
      const value = (node as any)[key];
      if (Array.isArray(value)) {
        out[key] = ast.mapChildArray(value, (item: any) =>
          ast.isAstNode(item) ? this.fillTemplate(item, env) : item
        );
      } else if (ast.isAstNode(value)) {
        out[key] = this.fillTemplate(value, env);
      }
    }
    return out as ast.ASTNode;
  }

  /** A comptime VALUE, as the AST node that carries it -- the splice half of `fillTemplate`. */
  private valueToNode(v: CTValue, at: ast.ASTNode): ast.ASTNode {
    const loc = { _location: at._location, _parent: (at as any)._parent };
    if (ast.isAstNode(v)) return v as ast.ASTNode;
    if (v === null) return { _type: "null", ...loc } as any;
    if (typeof v === "bigint") {
      // The exact decimal text, not a JS number: `match` is the lossless copy every downstream reader
      // wants, and rounding past 2^53 here is the bug the old vm path shipped.
      return { _type: "integer-number", value: Number(v), match: v.toString(), ...loc } as any;
    }
    if (typeof v === "number") {
      return Number.isInteger(v)
        ? ({ _type: "integer-number", value: v, match: String(v), ...loc } as any)
        : ({ _type: "float-number", value: v, match: String(v), ...loc } as any);
    }
    if (typeof v === "boolean") return { _type: "boolean", value: v, ...loc } as any;
    if (typeof v === "string") return { _type: "string", value: v, ...loc } as any;
    if (Array.isArray(v)) {
      return { _type: "vector", values: v.map((e) => this.valueToNode(e, at)), ...loc } as any;
    }
    throw new ComptimeError("a value of this kind cannot be spliced into a template", at);
  }

  /**
   * One FIELD read off a comptime value -- `n._type`, `n.nodes`.
   *
   * TOTAL, and deliberately: an absent field answers nil rather than raising, which is exactly what
   * the two backends already do for the same read on a quoted form (measured on both, M2). A syntax
   * handler branching on shape asks for fields a given kind does not have on every other line, and a
   * raising read would make that unwritable.
   *
   * `_parent` is refused rather than answered. It is CYCLIC -- the quote lowering drops it for that
   * reason -- and returning it would let a handler walk out of its own form and into the enclosing
   * program, which is not a thing a macro should be able to do by accident.
   */
  private field(recv: CTValue, name: string, node: ast.ASTNode): CTValue {
    if (recv === null || recv === undefined) return null;
    if (name === "_parent") {
      throw new ComptimeError("'_parent' is not readable at compile time -- it is cyclic", node);
    }
    if (Array.isArray(recv)) {
      // `.length` is the one field a vector answers; anything else is not a field of a vector.
      return name === "length" ? BigInt(recv.length) : null;
    }
    if (typeof recv === "object") {
      const v = (recv as any)[name];
      return v === undefined ? null : (v as CTValue);
    }
    return null;
  }

  /** `xs[0]`, `n.nodes[1]` -- the suffix chain, walked left to right. */
  private evalIndexer(node: ast.IndexerNode, env: Env): CTValue {
    let cur: CTValue = this.evalNode(node.id as ast.ASTNode, env);
    const members = (node as any).members as boolean[] | undefined;
    node.indices.forEach((step, i) => {
      for (const idx of step) {
        // A `.name` suffix is a FIELD; a `[expr]` suffix is an INDEX. They emit identically on the
        // backends and mean different things here, which is the same distinction D1 draws.
        if (members?.[i] && (idx as any)._type === "string") {
          cur = this.field(cur, String((idx as any).value), node);
          continue;
        }
        const k = this.evalNode(idx, env);
        if (typeof k === "string") { cur = this.field(cur, k, node); continue; }
        if (typeof k !== "bigint" && typeof k !== "number") {
          throw new ComptimeError(`an index must be an Int or a field name, got ${typeof k}`, node);
        }
        const at = Number(k);
        if (!Array.isArray(cur)) {
          throw new ComptimeError("indexing something that is not a vector at compile time", node);
        }
        cur = at >= 0 && at < cur.length ? cur[at] : null;
      }
    });
    return cur;
  }

  private lookup(name: string, node: ast.ASTNode, env: Env): CTValue {
    if (env.has(name)) return env.get(name)!;

    // Not a local binding, so it must be a module-level one -- INCLUDING an imported one. The JS path
    // reached these by draining `getInlinedDefinitions()` after a rename; here it is an ordinary
    // symbol lookup followed by evaluating whatever the binding was declared with (AF-046).
    const sym = this.tryResolve(name);
    const value = (sym?.value as any)?.value;
    if (sym && sym.nodeType === "variable" && value) return this.evalNode(value, new Map());

    throw new ComptimeError(`'${name}' is not available at compile time`, node);
  }

  private tryResolve(name: string) {
    try {
      return this.symbolTable?.resolveSymbol(name);
    } catch {
      return undefined;
    }
  }

  private evalMatch(node: ast.MatchNode, env: Env): CTValue {
    const subject = this.evalNode(node.expression, env);
    for (const arm of node.cases ?? []) {
      const bound = this.matchPattern(arm.pattern, subject, env);
      if (!bound) continue;
      if (arm.guard && !truthy(this.evalNode(arm.guard, bound))) continue;
      return this.evalNode(arm.body, bound);
    }
    throw new ComptimeError("no match arm applied at compile time", node);
  }

  /** The pattern kinds a constant subject can meet. Anything else is refused rather than half-matched. */
  private matchPattern(pattern: ast.PatternNode, subject: CTValue, env: Env): Env | undefined {
    switch (pattern._type) {
      case "any-pattern":
        return env;
      case "constant-pattern": {
        const want = this.evalNode((pattern as any).constant, env);
        return equal(want, subject) ? env : undefined;
      }
      case "identifier-pattern": {
        const next = new Map(env);
        next.set(ast.symbolName((pattern as any).id), subject);
        return next;
      }
    }
    throw new ComptimeError(`a '${pattern._type}' cannot be matched at compile time`, pattern);
  }

  private evalList(node: ast.ListNode, env: Env): CTValue {
    // Comments occupy no slot (D25/`listNodes`) -- a `:comptime` body is a block like any other, so a
    // trailing `;;` would otherwise be its VALUE and fold the function to nil.
    const nodes = listNodes(node).filter(Boolean);
    if (nodes.length === 0) return null;

    const head: any = nodes[0];

    // `(return e)` -- a special form, and the only one the subset needs. The desugarer injects these
    // as implicit returns, so a `:comptime` body's tail arrives here as one.
    if (head._type === "simple-identifier" && head.id === "return") {
      return nodes.length > 1 ? this.evalNode(nodes[1], env) : null;
    }

    if (head._type === "simple-identifier" || head._type === "composite-identifier") {
      const name = ast.symbolName(head);
      const args = nodes.slice(1);

      const op = OPERATORS[name];
      if (op) return op(args.map((a) => this.evalNode(a, env)), node);

      const floorFn = FLOOR_BUILTINS[name];
      if (floorFn) return floorFn(args.map((a) => this.evalNode(a, env)), node);

      // A floor entry that is deliberately REFUSED, as opposed to one merely not implemented. The
      // two read the same to a compiler and completely differently to an author, so they are
      // separate messages: one is a policy, the other is a gap.
      if (NONDETERMINISTIC_FLOOR.has(name)) {
        throw new ComptimeError(
          `'${name}' is nondeterministic and cannot run at compile time -- folding it would bake ` +
            `one run's answer into the artefact, so the same source would stop producing the same ` +
            `program. Call it at run time instead`,
          node
        );
      }

      if (FLOOR.has(name)) {
        throw new ComptimeError(
          `'${name}' is a floor operation the compile-time evaluator does not implement`,
          node
        );
      }

      return this.callFunction(name, args.map((a) => this.evalNode(a, env)), node);
    }

    // A BLOCK: evaluate in order, the last value wins. This is what a multi-expression function body
    // is once the head is not a name.
    let last: CTValue = null;
    for (const item of nodes) last = this.evalNode(item, env);
    return last;
  }

  private callFunction(name: string, args: CTValue[], node: ast.ASTNode): CTValue {
    const sym = this.tryResolve(name);
    const fn = sym?.value as ast.FunctionNode | undefined;
    if (!sym || sym.nodeType !== "function" || !fn) {
      throw new ComptimeError(`'${name}' is not available at compile time`, node);
    }

    if (++this.depth > MAX_DEPTH) {
      this.depth--;
      throw new ComptimeError(
        `':comptime' recursion went deeper than ${MAX_DEPTH} calls in '${name}'`,
        node
      );
    }

    try {
      const env: Env = new Map();
      (fn.params ?? []).forEach((p, i) => {
        env.set(ast.symbolName(p.name as any), i < args.length ? args[i] : null);
      });

      let last: CTValue = null;
      for (const stmt of fn.body ?? []) last = this.evalNode(stmt, env);
      return last;
    } finally {
      this.depth--;
    }
  }
}

function truthy(v: CTValue): boolean {
  if (typeof v === "bigint") return v !== ZERO;
  return !(v === false || v === null || v === 0 || v === "");
}

function equal(a: CTValue, b: CTValue): boolean {
  if (typeof a === "bigint" || typeof b === "bigint") {
    // An Int and a Real compare by VALUE across the representation split, so a `0` pattern still
    // matches a subject that arrived as a Real.
    if (typeof a === "bigint" && typeof b === "bigint") return a === b;
    if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
    return false;
  }
  return a === b;
}

/** Both operands as Reals -- the promotion rule for a mixed Int/Real operation. */
function asReal(v: CTValue): number {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  throw new ComptimeError(`a ${typeof v} is not a number`);
}

const bothInt = (a: CTValue, b: CTValue) => typeof a === "bigint" && typeof b === "bigint";

/**
 * Arithmetic that STAYS in Int when both operands are Int, and promotes to Real otherwise.
 *
 * The Int path is the whole point: `+` on two bigints is exact at any magnitude, which is what the
 * `node:vm` path lost on its way back through a JS number.
 */
function arith(
  name: string,
  int: (a: bigint, b: bigint) => bigint,
  real: (a: number, b: number) => number
) {
  return (args: CTValue[], node: ast.ASTNode): CTValue => {
    if (args.length === 0) throw new ComptimeError(`'${name}' needs at least one operand`, node);
    // VARIADIC, deliberately: `(+ 1 2 3)` is one call with three arguments, and the vm shim once
    // dropped everything after the second -- folded to 3 where the runtime answered 6.
    return args.reduce((a, b) =>
      bothInt(a, b) ? int(a as bigint, b as bigint) : real(asReal(a), asReal(b))
    );
  };
}

function compare(name: string, cmp: (a: number, b: number) => boolean) {
  return (args: CTValue[], node: ast.ASTNode): CTValue => {
    if (args.length < 2) throw new ComptimeError(`'${name}' needs two operands`, node);
    for (let i = 0; i < args.length - 1; i++) {
      const a = args[i];
      const b = args[i + 1];
      const ok = bothInt(a, b)
        ? cmp(Number(a as bigint), Number(b as bigint))
        : cmp(asReal(a), asReal(b));
      if (!ok) return false;
    }
    return true;
  };
}

type Builtin = (args: CTValue[], node: ast.ASTNode) => CTValue;

const OPERATORS: Record<string, Builtin> = {
  "+": (args, node) => {
    // String concatenation shares the spelling, and the corpus uses it: `(+ "squares: " s)`.
    if (args.some((a) => typeof a === "string")) return args.map(display).join("");
    return arith("+", (a, b) => a + b, (a, b) => a + b)(args, node);
  },
  "-": (args, node) =>
    args.length === 1
      ? typeof args[0] === "bigint"
        ? -(args[0] as bigint)
        : -asReal(args[0])
      : arith("-", (a, b) => a - b, (a, b) => a - b)(args, node),
  "*": arith("*", (a, b) => a * b, (a, b) => a * b),
  "/": (args, node) => {
    // Int / Int is INTEGER division (D51), which is why this cannot just promote to Real: the corpus
    // rounds with `(/ (round (* x 100)) 100)` and expects the Real answer, while `(/ 7 2)` on two
    // Ints is 3. Both backends agree on that split and so does this.
    if (args.length < 2) throw new ComptimeError("'/' needs two operands", node);
    return args.reduce((a, b) => {
      if (bothInt(a, b)) {
        if ((b as bigint) === ZERO) throw new ComptimeError("division by zero at compile time", node);
        return (a as bigint) / (b as bigint);
      }
      return asReal(a) / asReal(b);
    });
  },
  "%": (args, node) => {
    if (args.length < 2) throw new ComptimeError("'%' needs two operands", node);
    const [a, b] = args;
    if (bothInt(a, b)) {
      if ((b as bigint) === ZERO) throw new ComptimeError("modulo by zero at compile time", node);
      return (a as bigint) % (b as bigint);
    }
    return asReal(a) % asReal(b);
  },
  "==": (args) => equal(args[0], args[1]),
  "!=": (args) => !equal(args[0], args[1]),
  "<": compare("<", (a, b) => a < b),
  "<=": compare("<=", (a, b) => a <= b),
  ">": compare(">", (a, b) => a > b),
  ">=": compare(">=", (a, b) => a >= b),
  "&&": (args) => args.every(truthy),
  "||": (args) => args.some(truthy),
  "!": (args) => !truthy(args[0]),
};

/**
 * THE FLOOR, at compile time.
 *
 * These are not host reaches. `Math.cos` is a FLOOR entry (`floor.ts`), declared `[Real] -> Real` and
 * implemented by `ll_math_cos` on C -- the floor is the language's spec'd portable surface, and this
 * is a third implementation of the same contract rather than a fourth opinion. That is what lets a
 * comptime fold and a runtime call agree, which the corpus asserts directly.
 *
 * DETERMINISTIC ONLY. `Math.random` is a floor entry and is deliberately absent: a fold that is not
 * reproducible makes the BUILD not reproducible, and baking a random constant into an artefact is
 * worse than refusing to. It falls to the "floor operation not available at compile time" refusal
 * above, by name and with a location -- a rule the vm could never have enforced, since it simply had
 * the host's `Math` in scope.
 */
const FLOOR_BUILTINS: Record<string, Builtin> = {
  "Math.abs": (a) => (typeof a[0] === "bigint" ? (a[0] < ZERO ? -a[0] : a[0]) : Math.abs(asReal(a[0]))),
  "Math.sqrt": (a) => Math.sqrt(asReal(a[0])),
  "Math.log": (a) => Math.log(asReal(a[0])),
  "Math.exp": (a) => Math.exp(asReal(a[0])),
  "Math.sin": (a) => Math.sin(asReal(a[0])),
  "Math.cos": (a) => Math.cos(asReal(a[0])),
  "Math.tan": (a) => Math.tan(asReal(a[0])),
  "Math.asin": (a) => Math.asin(asReal(a[0])),
  "Math.acos": (a) => Math.acos(asReal(a[0])),
  "Math.atan": (a) => Math.atan(asReal(a[0])),
  "Math.atan2": (a) => Math.atan2(asReal(a[0]), asReal(a[1])),
  "Math.hypot": (a) => Math.hypot(...a.map(asReal)),
  "Math.pow": (a) => Math.pow(asReal(a[0]), asReal(a[1])),
  "Math.sign": (a) => Math.sign(asReal(a[0])),
  // These four answer an INTEGER, and say so in bigint -- `(/ (Math.round x) 100)` must not silently
  // become Int division, so the corpus's rounding idiom depends on getting this split right.
  "Math.floor": (a) => Math.floor(asReal(a[0])),
  "Math.ceil": (a) => Math.ceil(asReal(a[0])),
  "Math.round": (a) => Math.round(asReal(a[0])),
  "Math.trunc": (a) => Math.trunc(asReal(a[0])),
  "Math.min": (a) => (a.every((x) => typeof x === "bigint")
    ? (a as bigint[]).reduce((x, y) => (y < x ? y : x))
    : Math.min(...a.map(asReal))),
  "Math.max": (a) => (a.every((x) => typeof x === "bigint")
    ? (a as bigint[]).reduce((x, y) => (y > x ? y : x))
    : Math.max(...a.map(asReal))),
};

/** How a value reads when concatenated into a string. Ints print without a `n` suffix. */
function display(v: CTValue): string {
  if (v === null) return "nil";
  if (Array.isArray(v)) return v.map(display).join(" ");
  return String(v);
}
