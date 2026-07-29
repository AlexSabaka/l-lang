import type { IToken } from "chevrotain";
import { LLangLexer } from "./grammar_v2/tokens";
import { ComptimeInterpreter, ComptimeError, CTValue } from "../comptime/Interpreter";
import type * as ast from "./ast";

/**
 * `defmacro` -- THE TOKEN TIER (D69 / D95 / D101).
 *
 * Runs between LEX and PARSE, which is the seam D95 rules for it and the only one that makes the tier
 * different from `defsyntax`. A handler receives its arguments as TOKENS and returns tokens, so it can
 * rewrite text the grammar would refuse -- which is the whole reason the tier exists. D95 measured the
 * limit it lifts: of 28 keyword-headed productions only **5** have a surface a user could reproduce,
 * because `:keyword` clauses are welded to known heads. An AST-level tier can only recombine surfaces
 * the parser already accepts; this one runs before the parser has an opinion.
 *
 * ## What a handler actually receives, and why it is a vector of strings
 *
 * D101 names three representations and warns against conflating them: the AST datum, the cons VIEW of
 * it, and a TOKEN list. This is the third. A token here is its **image** -- the source text it
 * matched -- and an argument is a vector of those. That is a cons list of tokens in the sense that
 * matters: a handler can inspect them, count them, reorder them and build new ones, using the vector
 * and string operations the comptime interpreter already has. It needs no new `CTValue` case, no new
 * primitive, and no token object model that would then have to be kept in step with the lexer.
 *
 * The cost is stated rather than hidden: a handler sees `":then"` as a string and cannot ask a token
 * what KIND it is. Adding that is a strictly later question, and doing it now would invent a token
 * datatype nobody has ruled.
 *
 * ## Why this works on source TEXT with token-derived spans
 *
 * Splicing a returned image list into a token array means lexing those images anyway, and every
 * downstream consumer wants offsets that point into a real string. So an expansion rewrites the
 * SOURCE, and the result is re-lexed. `AstProvider` then parses the rewritten text by its ordinary
 * path -- no second parser entry point, and a syntax error in an expansion is reported against text
 * that actually exists.
 *
 * ## Errors here are parse-stage errors
 *
 * They are thrown as located `Error`s, matching how the lexer and the parser already report at this
 * seam (`file:line:col: …`). That is deliberately NOT an `LLxxxx`: parse-stage diagnostics are not
 * coded as a class -- D99 records the same for a stray comma -- and coding this one alone would say
 * macros are special. `AstProvider` prefixes the file and position, as it does for the other two.
 */

/** Two budgets, matching `ExpandSyntaxAstVisitor`'s, and for the same reason: a macro runs away in
 *  two directions. Depth catches a handler that expands into its own call; total catches one whose
 *  output grows each round. A compiler that never returns is worse than one that refuses. */
const MAX_ROUNDS = 64;
const MAX_EXPANSIONS = 10_000;

interface MacroDef {
  name: string;
  params: string[];
  /** The handler body, as SOURCE text -- parsed on demand by the caller-supplied parser. */
  bodySrc: string;
  /** The source span of the whole `(defmacro …)` form, so it can be removed. */
  from: number;
  to: number;
}

/** Where a `(name …)` call sits, and the source text of each argument. */
interface CallSite {
  def: MacroDef;
  from: number;
  to: number;
  args: string[][];
}

const isLParen = (t: IToken) => t.tokenType.name === "LParen";
const isRParen = (t: IToken) => t.tokenType.name === "RParen";
const isLBracket = (t: IToken) => t.tokenType.name === "LBracket";
const isRBracket = (t: IToken) => t.tokenType.name === "RBracket";

/** The index of the token closing the bracket that OPENS at `open`, or -1. */
function matchBracket(toks: IToken[], open: number): number {
  const opens = new Set(["LParen", "LBracket", "LBrace"]);
  const closes = new Set(["RParen", "RBracket", "RBrace"]);
  let depth = 0;
  for (let i = open; i < toks.length; i++) {
    const n = toks[i].tokenType.name;
    if (opens.has(n)) depth++;
    else if (closes.has(n)) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * Collect every `(defmacro name [p…] body…)` in the stream, by BRACKET MATCHING rather than by
 * parsing -- the whole point of the tier is that a file using a macro may not parse until after the
 * expansion, so nothing here may depend on the grammar accepting the file.
 */
function collectMacros(toks: IToken[], src: string): MacroDef[] {
  const out: MacroDef[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].tokenType.name !== "DefMacroKw") continue;
    if (i === 0 || !isLParen(toks[i - 1])) continue;
    const open = i - 1;
    const close = matchBracket(toks, open);
    if (close < 0) continue;

    const nameTok = toks[i + 1];
    if (!nameTok || nameTok.tokenType.name !== "Identifier") continue;

    let k = i + 2;
    const params: string[] = [];
    if (toks[k] && isLBracket(toks[k])) {
      const rb = matchBracket(toks, k);
      // A PARAMETER NAME MUST BE AN IDENTIFIER, and a non-identifier is REFUSED rather than skipped.
      //
      // Filtering silently on `Identifier` was the first attempt and it is worse than it looks: a name
      // that collides with a keyword lexes as that keyword -- `cond` is `CondKw` -- so it was dropped,
      // the handler was declared with fewer parameters than it was written with, and the ARITY refusal
      // then fired on a correct call site. Measured: `[ki init kc cond ks step kt body]` reported
      // "takes 7" for eight names.
      //
      // Accepting them is no better: a keyword cannot be REFERENCED in the body either -- `(let cond 1)`
      // is a parse error in ordinary l-lang -- so it would declare a parameter that can never be used.
      // Saying so is the only outcome that is not a puzzle.
      for (let p = k + 1; p < rb; p++) {
        const tk = toks[p];
        if (tk.tokenType.name !== "Identifier") {
          throw new Error(
            `'${tk.image}' cannot be a macro parameter name: it lexes as a keyword, and a keyword ` +
            `cannot be referenced as a variable anywhere in l-lang. Rename it.`
          );
        }
        params.push(tk.image);
      }
      k = rb + 1;
    }
    const bodyFrom = toks[k]?.startOffset;
    const bodyTo = toks[close - 1]?.endOffset;
    if (bodyFrom === undefined || bodyTo === undefined || k >= close) continue;

    out.push({
      name: nameTok.image,
      params,
      bodySrc: src.slice(bodyFrom, bodyTo + 1),
      from: toks[open].startOffset,
      to: toks[close].endOffset! + 1,
    });
  }
  return out;
}

/** Every `(name …)` whose head names a macro, outermost-first, with each argument's source text. */
function findCalls(toks: IToken[], src: string, defs: Map<string, MacroDef>): CallSite[] {
  const out: CallSite[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (!isLParen(toks[i])) continue;
    const head = toks[i + 1];
    if (!head || head.tokenType.name !== "Identifier") continue;
    const def = defs.get(head.image);
    if (!def) continue;
    const close = matchBracket(toks, i);
    if (close < 0) continue;

    // Arguments split at DEPTH ONE: each is a balanced run of tokens.
    const args: string[][] = [];
    let depth = 0;
    let cur: string[] = [];
    for (let j = i + 2; j < close; j++) {
      const n = toks[j].tokenType.name;
      const opens = n === "LParen" || n === "LBracket" || n === "LBrace";
      const closes = n === "RParen" || n === "RBracket" || n === "RBrace";
      if (opens) depth++;
      if (depth === 0 && !opens && !closes && cur.length && isTopLevelBoundary(toks, j)) {
        args.push(cur); cur = [];
      }
      cur.push(toks[j].image);
      if (closes) depth--;
      if (depth === 0 && (closes || isAtomEnd(toks, j))) { args.push(cur); cur = []; }
    }
    if (cur.length) args.push(cur);

    out.push({ def, from: toks[i].startOffset, to: toks[close].endOffset! + 1, args });
    i = close; // outermost-first: an inner call is found on the next round
  }
  return out;
}

/** A single-token argument ends immediately; a bracketed one ends at its closer. */
function isAtomEnd(toks: IToken[], j: number): boolean {
  const n = toks[j].tokenType.name;
  return !(n === "LParen" || n === "LBracket" || n === "LBrace");
}
function isTopLevelBoundary(_toks: IToken[], _j: number): boolean {
  return false; // arguments are delimited by balance, not by a separator (D99)
}

/**
 * Expand every `defmacro` in `src`, returning the rewritten source.
 *
 * `parseBody` is supplied by the caller so this module never imports the parser -- it runs BEFORE
 * parsing and must not create a cycle with the thing it runs before.
 */
export function expandTokenMacros(
  src: string,
  parseBody: (text: string) => ast.ASTNode[]
): string {
  if (!src.includes("defmacro")) return src; // the overwhelmingly common case, for free
  let text = src;
  let expansions = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const lexed = LLangLexer.tokenize(text);
    if (lexed.errors.length) return text; // let the ordinary lexer error reporting speak
    const defs = collectMacros(lexed.tokens, text);
    if (defs.length === 0) return text;

    const byName = new Map<string, MacroDef>();
    for (const d of defs) {
      if (byName.has(d.name)) {
        // A silent second definition is how `defmodifier` lost a decorator (D72/LL0031): keyed by
        // name, the later one simply wins and every earlier use site changes meaning.
        throw new Error(`'${d.name}' is already declared as a 'defmacro' in this module`);
      }
      byName.set(d.name, d);
    }

    const calls = findCalls(lexed.tokens, text, byName);
    if (calls.length === 0) {
      // Nothing left to expand: strip the declarations and hand the text on.
      return spliceOut(text, defs.map((d) => ({ from: d.from, to: d.to })));
    }

    const edits: { from: number; to: number; text: string }[] = [];
    for (const c of calls) {
      if (++expansions > MAX_EXPANSIONS) {
        throw new Error(`expanding '${c.def.name}' did not terminate (total budget exhausted)`);
      }
      if (c.args.length !== c.def.params.length) {
        throw new Error(
          `the macro '${c.def.name}' takes ${c.def.params.length} ` +
          `form${c.def.params.length === 1 ? "" : "s"}, but ${c.args.length} ` +
          `${c.args.length === 1 ? "was" : "were"} given -- a 'defmacro' is matched on shape, so the ` +
          `count is part of the form it accepts`
        );
      }
      const env = new Map<string, CTValue>();
      c.def.params.forEach((p, i) => env.set(p, c.args[i] as unknown as CTValue));

      let result: CTValue;
      try {
        result = new ComptimeInterpreter(undefined).evaluateWith(parseBody(c.def.bodySrc), env);
      } catch (e) {
        const why = e instanceof ComptimeError ? e.message : String((e as any)?.message ?? e);
        throw new Error(`expanding '${c.def.name}' failed: ${why}`);
      }
      if (!Array.isArray(result) || result.some((x) => typeof x !== "string")) {
        // A handler that answers 5 has written a function with the wrong keyword. Refused by name
        // rather than by whatever a raw value breaks in the lexer downstream.
        throw new Error(
          `the macro '${c.def.name}' must expand to a vector of TOKEN strings, but it answered ` +
          `${result === null ? "nil" : typeof result}`
        );
      }
      edits.push({ from: c.from, to: c.to, text: (result as string[]).join(" ") });
    }
    text = applyEdits(text, edits);
  }
  throw new Error("macro expansion did not reach a fixed point (round budget exhausted)");
}

/** Apply non-overlapping edits right-to-left, so earlier offsets stay valid. */
function applyEdits(src: string, edits: { from: number; to: number; text: string }[]): string {
  let out = src;
  for (const e of [...edits].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, e.from) + e.text + out.slice(e.to);
  }
  return out;
}

/** Remove spans, right-to-left. Replaced by a NEWLINE rather than deleted so line numbers hold. */
function spliceOut(src: string, spans: { from: number; to: number }[]): string {
  let out = src;
  for (const s of [...spans].sort((a, b) => b.from - a.from)) {
    const removed = out.slice(s.from, s.to);
    const newlines = (removed.match(/\n/g) ?? []).join("");
    out = out.slice(0, s.from) + newlines + out.slice(s.to);
  }
  return out;
}
