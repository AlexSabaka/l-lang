import * as ast from "../../frontend/ast";
import { classifyList } from "../../analysis/listForm";
import { assignParentNodeReferences } from "../../frontend/AstProvider";

/**
 * D100 -- A LOOP BOUND TO A NAME IS A LAZY SEQUENCE, and one iteration yields its BODY's value.
 *
 *     (let ys (for :each x :from xs :then (* x 2)))
 *
 *  becomes
 *
 *     (fn :gen __ll_seq_0 [] (for :each x :from xs :then (yield (* x 2))))
 *     (let ys (__ll_seq_0))
 *
 * so `ys` is the doubled sequence, computed on demand.
 *
 * ## Why this runs where it runs, which is not where it was first written
 *
 * It belongs at D95's seam -- between PARSE and SYMBOLS -- for D95's reason, and the first attempt
 * put it in the desugarer and failed with `LL0210 '__ll_seq_0' is not defined`. The symbol table is
 * built in the symbols stage; desugar runs AFTER it. A pass that INTRODUCES a declaration therefore
 * cannot live there, because nothing will ever give the new name a symbol.
 *
 * That is the same rule D95 states for `defsyntax` and the same reason `:comptime` may run late: a
 * comptime fold only ever DELETES declarations and replaces expressions with constants, so the table
 * it was built against stays true. This rewrite adds a function, so it goes where additions go.
 *
 * ## Elision is why this is safe, and it is free
 *
 * Measured across corpus and stdlib: **367 loops, of which 3 are in value position.** Rewriting every
 * loop into a coroutine would allocate 364 frames nobody asked for. Only a loop whose value is BOUND
 * is rewritten. Every other loop is untouched and still emits a plain loop, which keeps D94's ruling
 * that a statement-position loop's value is `nil`.
 *
 * ## Two layers of wrapping, and missing either matches nothing
 *
 * A block statement arrives as `list{nodes:[variable]}` -- a `grouping` to `classifyList` -- and the
 * variable's VALUE arrives as `list{nodes:[for-each]}` in turn. Neither the statement nor the loop is
 * ever the bare node it reads as in source, and a first attempt that unwrapped only one of them
 * matched nothing at all.
 */
export class LoopsToSequencesAstVisitor {
  private seq = 0;

  rewrite(root: ast.ASTNode): ast.ASTNode {
    const out = this.walk(root);
    // Everything synthesized here arrives with no `_parent`, and the chain is load-bearing --
    // `SymbolTable.scopeOf` climbs it. Re-link before the symbols stage, which is the first reader.
    assignParentNodeReferences(out as ast.ASTNode);
    return out as ast.ASTNode;
  }

  private walk(node: any): any {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((c) => this.walk(c));

    let items: ast.ASTNode[] | null = null;
    if (node._type === "program") items = node.program;
    else if (node._type === "list" && classifyList(node as ast.ListNode).kind === "block") items = node.nodes;

    const out: any = { ...node };
    if (items) {
      const expanded: ast.ASTNode[] = [];
      for (const it of items) {
        const pair = this.loopBound(it);
        if (pair) expanded.push(...pair);
        else expanded.push(it);
      }
      if (node._type === "program") out.program = expanded.map((n) => this.walk(n));
      else out.nodes = expanded.map((n) => this.walk(n));
      return out;
    }

    for (const k of ast.getNodeIterableKeys(node)) {
      const v = (node as any)[k];
      if (Array.isArray(v)) out[k] = ast.mapChildArray(v, (c) => this.walk(c));
      else if (ast.isAstNode(v)) out[k] = this.walk(v);
    }
    return out;
  }

  /** The single node a one-element list wraps, or the node itself. */
  private static unwrap(n: any): any {
    return n?._type === "list" && n.nodes?.length === 1 ? n.nodes[0] : n;
  }

  /** `(let x <loop>)` -> [the `:gen` declaration, `(let x (<gen>))`]; null when not that shape. */
  private loopBound(item: ast.ASTNode): ast.ASTNode[] | null {
    const v: any = LoopsToSequencesAstVisitor.unwrap(item);
    if (v?._type !== "variable" || !v.value) return null;
    const loop: any = LoopsToSequencesAstVisitor.unwrap(v.value);
    if (!loop || !["while", "for", "for-each"].includes(loop._type)) return null;
    if (!loop.then) return null; // a loop with no body has no iteration value to yield

    const name = `__ll_seq_${this.seq++}`;
    const loc = item._location;
    const n = (o: any) => ({ ...o, _location: loc, _parent: undefined });
    const id = (s: string) => n({ _type: "simple-identifier", id: s });
    const wrap = (x: any) => n({ _type: "list", nodes: [x] });

    // The body yields its own value once per iteration -- the comprehension reading, which is what
    // makes `(for :each x :from xs :then (* x 2))` the doubled sequence rather than a unit one.
    const yielded = n({ _type: "list", nodes: [id("yield"), loop.then] });

    // A C-STYLE `for` IS ROTATED INTO A `while`, and it has to be.
    //
    //     (for :init i :cond c :step s :then b)   ==   i; (while c (b s))
    //
    // The `:step` cannot survive as a `for` update once the body yields: coroutine lowering splits
    // the body across resume labels, and the update slot of a C `for(...)` takes ONE expression or
    // simple assignment. Measured -- without this the emitter refuses outright, "for update must be
    // an expression or a simple assignment". The rotation is the same identity the hand-written proof
    // of this design used, and it puts the step where a state machine can reach it: in the body.
    const isCFor = loop._type === "for" && (loop.initial || loop.step);
    const body: any[] = isCFor
      ? [
          loop.initial,
          n({
            _type: "while",
            condition: loop.condition,
            then: n({ _type: "list", nodes: loop.step ? [yielded, loop.step] : [yielded] }),
          }),
        ].filter(Boolean)
      : [n({ ...loop, then: yielded })];

    const fn = n({
      _type: "function",
      name: id(name),
      async: false, generator: true, extern: false,
      modifiers: [n({ _type: "modifier", modifier: "gen" })],
      params: [], returns: undefined, body,
    });

    return [wrap(fn), wrap({ ...v, value: wrap(id(name)) })];
  }
}
