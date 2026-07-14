import * as ast from "../frontend/ast";

/**
 * D25 -- what IS this list?
 *
 * `(a b c)` is the whole language, and until D25 the rule was never written down. So codegen decided
 * it, the type checker decided it AGAIN, and the desugarer decided it a THIRD time -- each from the
 * same proxy, `head._type === "simple-identifier"`, and each with its own subtly different set of
 * exceptions. Three answers to one question is how a compiler ends up disagreeing with itself: the
 * desugarer's copy once unwrapped `(gs[0].hi)` into a member READ while codegen emitted a CALL.
 *
 * This is the single answer. It is purely SYNTACTIC, and that is the point -- the classification is a
 * property of the tree, so every pass can ask it, including the ones that run before the symbol table
 * exists.
 *
 * What is NOT here, deliberately: everything that needs the symbol table.
 *
 *   - Is `(f)` a call or a value? (D1: iff `f` names a FUNCTION.)
 *   - Is `(Dog "rex")` a call or a CONSTRUCTION?
 *   - Is `(obj.m)` a method call or a property read?
 *
 * Those are refinements OF a `call`, not alternatives TO it, and they need to know what names mean.
 * They stay in codegen, where the symbol table is. Dragging them in here would mean this module could
 * not be used by the desugarer at all -- which runs first, precisely so the checker and codegen see
 * the same tree.
 */
export type ListForm =
  /** `()` */
  | { kind: "empty" }
  /** `(return x)`, `(new Dog)` -- an identifier head with reserved meaning. */
  | { kind: "special"; name: string; head: ast.IdentifierNode; args: ast.ASTNode[] }
  /** `(f x)`, `(obj.m)`, `(gs[0].hi)` -- a named callee. Whether it CALLS is D1's question. */
  | { kind: "call"; callee: ast.ASTNode; args: ast.ASTNode[] }
  /** `((fn [x] x) 21)` -- an applied lambda literal. */
  | { kind: "apply"; lambda: ast.FunctionNode; args: ast.ASTNode[] }
  /** `((+ 1 2))` -- redundant parens around one non-name. */
  | { kind: "grouping"; inner: ast.ASTNode }
  /** `( (console.log 1) (console.log 2) )` -- the file wrapper, and every body. */
  | { kind: "block"; items: ast.ASTNode[] };

/**
 * An identifier head whose meaning is reserved -- it is not a call to a function of that name.
 *
 * Routing one of these through call inference types `(return x)` as a call to a function named
 * `return`, which is Unknown -- and a `return` that infers as Unknown stops the enclosing function's
 * return type from propagating at all.
 */
export const SPECIAL_FORMS: ReadonlySet<string> = new Set([
  "return", "new", "throw", "quote", "await", "yield",
  "typeof", "delete", "in", "instanceof",
  "this", "super",
]);

function isName(node: ast.ASTNode | undefined): node is ast.IdentifierNode {
  return (
    node?._type === "simple-identifier" || node?._type === "composite-identifier"
  );
}

/**
 * `(gs[0].hi)` -- an indexer whose LAST step was written with a dot.
 *
 * D1: `(obj.m)` is always a call, and that does not stop being true because the object was reached
 * through an index. The three forms emit identical JavaScript, so the `members` flag is the only place
 * the distinction can live:
 *
 *     (gs[0].hi)      a call    -- exactly as `(g.hi)` is
 *     (gs[0])         a read    -- there is no member
 *     (gs["hi"])      a read    -- a string INDEX is not a member; D1 is about the `.m` form
 */
export function isDottedMemberIndexer(node: ast.ASTNode | undefined): boolean {
  if (node?._type !== "indexer") return false;
  const members = (node as ast.IndexerNode).members;
  return !!members?.length && members[members.length - 1] === true;
}

/**
 * The lambda literal at `node`, looking THROUGH the parens it arrived in.
 *
 * `(fn [x] x)` is itself a parenthesised form, so in `((fn [x] x) 21)` the head is not a `function`
 * node -- it is a one-element LIST wrapping one, and `head._type === "function"` finds nothing. The
 * tree you get is not the tree you wrote; peel until it stops being a wrapper.
 *
 * ANONYMOUS only, and that word carries the rule. A NAMED `(fn f ...)` in head position is a
 * DECLARATION, and a block that begins by declaring a function is most of the files in this repo.
 * Only a lambda LITERAL is unambiguous, because a block whose first form is a bare lambda literal is a
 * NO-OP -- it builds a closure and throws it away -- so that shape has no other meaning to protect.
 */
export function lambdaLiteralIn(
  node: ast.ASTNode | undefined
): ast.FunctionNode | undefined {
  let inner: ast.ASTNode | undefined = node;

  while (inner && ast.isListNode(inner) && (inner as ast.ListNode).nodes.length === 1) {
    inner = (inner as ast.ListNode).nodes[0];
  }

  return inner?._type === "function" && !(inner as ast.FunctionNode).name
    ? (inner as ast.FunctionNode)
    : undefined;
}

/** D25, in one place. */
export function classifyList(node: ast.ListNode): ListForm {
  const nodes = Array.isArray(node.nodes) ? node.nodes : [node.nodes];
  if (nodes.length === 0) return { kind: "empty" };

  const [head, ...args] = nodes;

  // Redundant parens around a single non-name: `((+ 1 2))` -> 3. A dotted member is the exception --
  // `(gs[0].hi)` is a call, and unwrapping it to a member READ is the bug this exception exists for.
  if (nodes.length === 1 && !isName(head) && !isDottedMemberIndexer(head)) {
    return { kind: "grouping", inner: head };
  }

  // An applied lambda literal. `args.length > 0` is required, and it is not a technicality: a
  // ONE-element list holding a lambda is the shape the desugarer produces for `(let f (fn [] 5))`.
  // Read that as a zero-arg call and `f` binds to 5 instead of to the function -- silently. Zero-arg
  // application is spelled `(call (fn [] 5))`.
  if (args.length > 0) {
    const lambda = lambdaLiteralIn(head);
    if (lambda) return { kind: "apply", lambda, args };
  }

  if (isDottedMemberIndexer(head)) {
    return { kind: "call", callee: head, args };
  }

  if (isName(head)) {
    const name = ast.symbolName(head);
    return SPECIAL_FORMS.has(name)
      ? { kind: "special", name, head, args }
      : { kind: "call", callee: head, args };
  }

  return { kind: "block", items: nodes };
}

/** Is this list a CALL (or a special form) rather than a block? The question all three passes asked. */
export function isCallList(node: ast.ASTNode | undefined): boolean {
  if (!ast.isListNode(node)) return false;
  const kind = classifyList(node as ast.ListNode).kind;
  return kind === "call" || kind === "apply";
}

/** Is this list a BLOCK of statements? */
export function isBlockList(node: ast.ASTNode | undefined): boolean {
  return (
    ast.isListNode(node) && classifyList(node as ast.ListNode).kind === "block"
  );
}

/**
 * Is this list's value its own TAIL -- so an implicit `return` belongs INSIDE it, on the last item,
 * rather than wrapped around the whole thing?
 *
 * True for a BLOCK, and true for redundant parens -- and the second half is not a detail. A
 * parenthesised FORM arrives as a one-element list around it: `(if c a b)` is `list{[if]}`, which
 * `classifyList` calls a `grouping`. The desugarer must recurse into it so the return lands on each
 * BRANCH of the `if`. Ask only "is it a block" and it does not, and every trailing `if` in the corpus
 * turns from
 *
 *     if (c) return 1; else return f(n);
 *
 * into `return __ll_copy(c ? (() => { return 1; })() : (() => { return f(n); })())`. Measured, on 24
 * corpus files, the moment this predicate was tightened by one word.
 *
 * FALSE for a call, an apply, or a special form: those ARE the value, and the return goes around them.
 * (The old spelling -- "the head is not a name" -- got `apply` wrong, and pushed the return onto an
 * applied lambda's ARGUMENT.)
 */
export function valueIsTail(node: ast.ASTNode | undefined): boolean {
  if (!ast.isListNode(node)) return false;
  const kind = classifyList(node as ast.ListNode).kind;
  return kind === "block" || kind === "grouping";
}
