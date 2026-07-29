import * as ast from "../../frontend/ast";
import { Context } from "../../Context";
import { listNodes } from "../../analysis/listForm";
import { ComptimeInterpreter, ComptimeError } from "../../comptime/Interpreter";
import { report, SyntaxDiagnostics as SD } from "../../rules/diagnostics";
import { assignParentNodeReferences } from "../../frontend/AstProvider";

/**
 * THE `defsyntax` EXPANSION STAGE (D69 / D95).
 *
 * Runs between PARSE and SYNTAX -- the seam D95 rules for it, and the only place it can go. Later is
 * impossible: an expansion INTRODUCES code, and the symbol table is built over a tree that would no
 * longer exist. Earlier is impossible too: there is no tree yet.
 *
 * That placement decides two things about the tier, neither of them a choice:
 *
 *   * A handler is MODULE-LOCAL. Imports resolve in the symbols stage, two stages later, so nothing
 *     here can see an imported name -- a `defsyntax` cannot be exported or imported. `defmodifier`
 *     already carries the same limit for its own unsolved reason (D72); here it is a consequence.
 *   * A handler sees no TYPES. It receives forms and returns forms; what they mean is decided after
 *     it has finished.
 *
 * WHAT A HANDLER RECEIVES IS THE ARGUMENT FORM, UNEVALUATED. That is the whole difference from a
 * function, and it is what lets `unless` decline to evaluate its body: the handler is handed the AST
 * of each argument and decides where -- or whether -- to put it.
 */
export class ExpandSyntaxAstVisitor {
  /** name -> handler. Module-local by construction; see the class note. */
  private handlers = new Map<string, ast.SyntaxDefNode>();
  private expansions = 0;

  /**
   * Two budgets, because a macro can run away in two different directions and they need separate
   * numbers to be diagnosable. DEPTH catches `(defsyntax loop [] (loop))`, which expands into itself
   * forever at one site. TOTAL catches a handler that grows its output each round -- bounded depth,
   * unbounded work. Modelled on the interpreter's own MAX_STEPS/MAX_DEPTH pair, and for the same
   * reason it has them: a compiler that never returns is worse than one that refuses.
   */
  private static readonly MAX_DEPTH = 128;
  private static readonly MAX_EXPANSIONS = 10_000;

  constructor(private readonly context: Context) {}

  expand(root: ast.ASTNode): ast.ASTNode {
    this.collectHandlers(root);
    if (this.handlers.size === 0) return root; // nothing declared -> nothing to walk
    const out = this.rewrite(root, 0);
    // Every node an expansion introduced arrives with no `_parent`, and that chain is load-bearing:
    // `SymbolTable.scopeOf` climbs it, and `UnquoteNeedsQuasiquote` climbs it. Re-link before the
    // syntax stage, which is the first thing that reads it.
    assignParentNodeReferences(out);
    return out;
  }

  /**
   * COLLECTED BY WALKING THE AST, not the flattened top-level statements.
   *
   * The same correction D72's annotation registry carries and C1 had to make again: a hand-rolled scan
   * at the wrong depth fails SILENTLY by finding nothing, and a program is list-wrapped more than one
   * level deep. A `defsyntax` nested inside the program's outer list is the normal case, not the edge
   * one.
   */
  private collectHandlers(node: any): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const c of node) this.collectHandlers(c); return; }
    if (node._type === "syntax-def") {
      const d = node as ast.SyntaxDefNode;
      const prev = this.handlers.get(d.name);
      if (prev) {
        // A silent second definition is how `defmodifier` lost a decorator (D72/LL0031): the registry
        // is keyed by name, so the later one simply won and the earlier stopped applying.
        report(this.context, SD.SyntaxRedefined, node, { name: d.name });
        return;
      }
      this.handlers.set(d.name, d);
      return;
    }
    for (const k of Object.keys(node)) {
      if (k.startsWith("_")) continue;
      this.collectHandlers(node[k]);
    }
  }

  /** Rewrite the tree, expanding every `(name args…)` whose head names a handler. */
  private rewrite(node: any, depth: number): any {
    if (!node || typeof node !== "object") return node;
    if (Array.isArray(node)) return ast.mapChildArray(node, (c) => this.rewrite(c, depth));

    // A `defsyntax` DECLARATION is consumed by this stage -- it has done its job and nothing
    // downstream models it. Replaced by a comment rather than dropped: dropping a node from a body
    // shifts every position after it, which is the class of bug D83 was ruled for.
    if (node._type === "syntax-def") {
      return { _type: "comment", comment: `;; defsyntax ${(node as ast.SyntaxDefNode).name}`,
               _location: node._location, _parent: node._parent } as any;
    }

    // A quoted form is DATA. Expanding inside it would make `'(unless a b)` mean something other than
    // what it says, and quote's entire contract is that it means exactly what it says.
    if (node._type === "quote") return node;

    const expanded = this.tryExpand(node, depth);
    if (expanded !== null) return expanded;

    const out: any = { ...node };
    for (const key of ast.getNodeIterableKeys(node)) {
      const value = (node as any)[key];
      if (Array.isArray(value)) out[key] = ast.mapChildArray(value, (c) => this.rewrite(c, depth));
      else if (ast.isAstNode(value)) out[key] = this.rewrite(value, depth);
    }
    return out;
  }

  /** `(name args…)` where `name` is a handler -> its expansion, re-walked. Otherwise null. */
  private tryExpand(node: ast.ASTNode, depth: number): ast.ASTNode | null {
    if (node._type !== "list") return null;
    const items = listNodes(node as ast.ListNode).filter(Boolean);
    if (items.length === 0) return null;
    const head: any = items[0];
    if (head._type !== "simple-identifier") return null;
    const handler = this.handlers.get(head.id);
    if (!handler) return null;

    const args = items.slice(1);
    if (args.length !== handler.params.length) {
      report(this.context, SD.SyntaxArity, node, {
        name: handler.name, expected: handler.params.length, got: args.length,
      });
      return node;
    }
    if (depth >= ExpandSyntaxAstVisitor.MAX_DEPTH) {
      report(this.context, SD.SyntaxRunaway, node, { name: handler.name, limit: "depth" });
      return node;
    }
    if (++this.expansions > ExpandSyntaxAstVisitor.MAX_EXPANSIONS) {
      report(this.context, SD.SyntaxRunaway, node, { name: handler.name, limit: "total" });
      return node;
    }

    // The parameters are bound to the ARGUMENT FORMS -- the AST of each argument, not its value.
    const env = new Map<string, any>();
    handler.params.forEach((p, i) => {
      const n = (p.name as any)?.id ?? (p.name as any)?.name;
      if (n) env.set(n, args[i]);
    });

    let result: any;
    try {
      // The body is a block: its LAST expression is the handler's answer, exactly as a function's is.
      const interp = new ComptimeInterpreter(undefined);
      result = interp.evaluateWith(handler.body, env);
    } catch (e) {
      report(this.context, SD.SyntaxFailed, node, {
        name: handler.name,
        error: e instanceof ComptimeError ? e.message : String((e as any)?.message ?? e),
      });
      return node;
    }

    if (!ast.isAstNode(result)) {
      // A handler that answers 5 has not written a macro; it has written a function with the wrong
      // keyword. Refused by name rather than by whatever the raw value breaks downstream.
      report(this.context, SD.SyntaxNotAForm, node, {
        name: handler.name, got: result === null ? "nil" : typeof result,
      });
      return node;
    }

    // RE-WALK the expansion, at depth+1. A handler may legitimately expand into another handler's
    // form (that is what composition is), and the depth budget is what keeps it from being forever.
    return this.rewrite({ ...(result as any), _parent: node._parent }, depth + 1);
  }
}
