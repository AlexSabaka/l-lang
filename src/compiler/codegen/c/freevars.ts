// Free-variable analysis for lambda lifting.
//
// A nested function's FREE variables are the names it references that it does not itself bind
// (params, inner lets/muts/fns, loop/match binders). The resolver intersects these with the
// enclosing local scopes to decide what a lifted closure must CAPTURE -- the env the HIR does not
// model (spec A3: callee identity, and the state it closes over, live below the HIR).
//
// Syntactic and conservative: it over-approximates references (a name that turns out to be a global
// or intrinsic is simply not in any enclosing scope, so the resolver drops it). That is the safe
// direction -- capturing a name that is actually global would be wrong, but the resolver's
// scope-membership test filters those out.

import * as ast from "../../frontend/ast";
import { classifyList } from "../../analysis/listForm";

/** Names a binding target introduces (a name, or a destructuring pattern's leaves). */
function targetNames(t: ast.ASTNode | undefined, into: Set<string>): void {
  if (!t) return;
  if (t._type === "simple-identifier" || t._type === "composite-identifier") {
    into.add(ast.symbolName(t as ast.IdentifierNode));
    return;
  }
  for (const n of ast.bindingNames(t as any) ?? []) into.add(n);
}

/** The names a match pattern binds. */
function patternNames(p: ast.PatternNode | undefined, into: Set<string>): void {
  if (!p) return;
  switch (p._type) {
    case "type-pattern":
      into.add(ast.symbolName((p as ast.TypePatternNode).id));
      return;
    case "identifier-pattern":
      into.add(ast.symbolName((p as ast.IdentifierPatternNode).id));
      return;
    case "vector-pattern":
      for (const el of (p as ast.VectorPatternNode).elements) patternNames(el, into);
      return;
    case "list-pattern":
      for (const el of (p as ast.ListPatternNode).elements) patternNames(el, into);
      return;
    case "map-pattern":
      for (const pr of (p as ast.MapPatternNode).pairs) patternNames(pr.pattern, into);
      return;
    case "rest-pattern":
      patternNames((p as any).pattern, into);
      return;
    default:
      return;
  }
}

/**
 * The free variables of a function: names read in the body that the function does not itself bind.
 * `bound` seeds the locally-bound set (the params + the function's own name for recursion).
 */
export function freeVariables(fn: ast.FunctionNode): Set<string> {
  const bound = new Set<string>();
  for (const p of fn.params) targetNames(p.name, bound);
  if (fn.name) bound.add(ast.symbolName(fn.name));
  const free = new Set<string>();
  collectBody(fn.body ?? [], bound, free);
  return free;
}

/** A statement sequence: declarations add to `bound` as we go (later statements see earlier binds). */
function collectBody(items: ast.ASTNode[], bound: Set<string>, free: Set<string>): void {
  const local = new Set(bound);
  // Two passes so a mutually-recursive / forward-referenced local fn is treated as bound.
  for (const item of items) declaredBy(item, local);
  for (const item of items) collect(item, local, free);
}

/** Names a single statement declares into the enclosing sequence. */
function declaredBy(node: ast.ASTNode, into: Set<string>): void {
  if (!node || typeof node !== "object") return;
  if (node._type === "variable") { targetNames((node as ast.VariableNode).name, into); return; }
  if (node._type === "function" && (node as ast.FunctionNode).name) {
    into.add(ast.symbolName((node as ast.FunctionNode).name));
    return;
  }
  if (node._type === "list") {
    const form = classifyList(node as ast.ListNode);
    if (form.kind === "block") for (const it of form.items) declaredBy(it, into);
    else if (form.kind === "grouping") declaredBy(form.inner, into);
  }
}

function collect(node: any, bound: Set<string>, free: Set<string>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const c of node) collect(c, bound, free);
    return;
  }
  switch (node._type) {
    case "simple-identifier": {
      const id = (node as ast.SimpleIdentifierNode).id;
      if (!bound.has(id)) free.add(id);
      return;
    }
    case "composite-identifier": {
      // `a.b.c` reads `a`; the tail parts are member names, not variables.
      const head = (node as ast.CompositeIdentifierNode).parts?.[0];
      if (head && !bound.has(head)) free.add(head);
      return;
    }
    case "function": {
      // A NESTED lambda: its own params/name shadow; its free vars are free HERE too (unless bound).
      const inner = freeVariables(node as ast.FunctionNode);
      for (const n of inner) if (!bound.has(n)) free.add(n);
      return;
    }
    case "for-each": {
      const fe = node as ast.ForEachNode;
      collect(fe.collection, bound, free);
      const inner = new Set(bound);
      targetNames(fe.variable, inner);
      collect(fe.then, inner, free);
      if (fe.else) collect(fe.else, bound, free);
      return;
    }
    case "for": {
      const f = node as ast.ForNode;
      const inner = new Set(bound);
      if (f.initial) declaredBy(f.initial, inner);
      collect(f.initial, inner, free);
      collect(f.condition, inner, free);
      collect(f.step, inner, free);
      collect(f.then, inner, free);
      if (f.else) collect(f.else, inner, free);
      return;
    }
    case "match": {
      const m = node as ast.MatchNode;
      collect(m.expression, bound, free);
      for (const c of m.cases ?? []) {
        const inner = new Set(bound);
        patternNames(c.pattern, inner);
        collect(c.guard, inner, free);
        collect(c.body, inner, free);
      }
      return;
    }
    case "list": {
      const form = classifyList(node as ast.ListNode);
      if (form.kind === "block") { collectBody(form.items, bound, free); return; }
      // A quoted datum is data, not evaluated.
      if (form.kind === "special" && form.name === "quote") return;
      break;
    }
    default:
      break;
  }
  // Generic recursion; a `variable`/`function` declaration binds its name for LATER siblings, which
  // collectBody already handled, so here we just descend into children.
  if (node._type === "variable") {
    // Descend into the initializer only (the name is a binder, not a read).
    collect((node as ast.VariableNode).value, bound, free);
    return;
  }
  for (const k of Object.keys(node)) {
    if (k.startsWith("_")) continue;
    if (k === "name" && node._type === "function") continue;
    collect(node[k], bound, free);
  }
}
