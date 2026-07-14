import { allTokens } from "../../compiler/frontend/grammar_v2/tokens";
import { BUILTIN_MODIFIERS, RESERVED_NATIVE_MODIFIERS } from "../../compiler/helpers/modifiers";
import { RuntimeProvider } from "../../compiler/runtime/RuntimeProvider";
import { ReplSession } from "./ReplSession";

/**
 * Tab completion, DERIVED rather than declared.
 *
 * The old completer carried four hand-maintained arrays, and every one of them had drifted:
 *
 *   - it offered `:cond`, `:then`, `:else`, `:each`, `:from`, `:init`, `:step` -- none of which are
 *     modifiers. Since D4 an unknown `:modifier` is a HARD ERROR with a did-you-mean, so the
 *     completer was actively proposing forms that cannot compile.
 *   - it never learned `defmodifier` -- nor that `defmodifier` makes the modifier set
 *     USER-EXTENSIBLE, so a session's own `(defmodifier retry ...)` could not be completed.
 *   - it offered `print`, which is not defined, and `#t` / `#f`, which are not l-lang.
 *   - it guessed member names from a hardcoded list of JavaScript methods.
 *
 * A list that must be kept in step with a language under active development will not be. So this one
 * reads the language instead: keywords from the lexer's own token table, modifiers from the D4
 * whitelist the checker actually enforces, builtins from the runtime shim, and members from the type
 * metadata the program actually compiled.
 */

/** Every keyword the lexer knows, taken from the lexer. */
const KEYWORDS: string[] = allTokens
  .map((t) => {
    const p: any = (t as any).PATTERN;
    return p instanceof RegExp ? p.source : "";
  })
  // A keyword token's pattern is its literal spelling. Identifier and operator patterns are
  // character classes, so they never match this and fall out for free.
  .filter((src) => /^[a-z][a-z0-9-]*$/.test(src))
  // D3: `defmacro` is reserved and refused BY NAME. It is a keyword, but completing it only spends
  // the user a keystroke on their way to an error.
  .filter((kw) => kw !== "defmacro")
  .sort();

/** The runtime shim's symbols -- `map`, `filter`, `head`, ... Operators are omitted as noise. */
const BUILTINS: string[] = Object.keys((RuntimeProvider as any).SYMBOL_MAP ?? {})
  .filter((n) => /^[a-zA-Z]/.test(n))
  .sort();

/** The D4 whitelist, minus those reserved for a backend that does not exist yet (D15). */
const MODIFIERS: string[] = (BUILTIN_MODIFIERS as readonly string[])
  .filter((m) => !(RESERVED_NATIVE_MODIFIERS as readonly string[]).includes(m))
  .map((m) => `:${m}`)
  .sort();

export class ReplCompleter {
  constructor(private session: ReplSession) {}

  /** readline's contract: [matches, the substring they replace]. */
  complete(line: string): [string[], string] {
    const token = lastToken(line);

    if (token.startsWith(":")) {
      return [prefixed(this.modifiers(), token), token];
    }

    if (token.includes(".")) {
      const dot = token.lastIndexOf(".");
      const target = token.slice(0, dot);
      const members = this.session.membersOf(target).map((m) => `${target}.${m}`);
      return [prefixed(members, token), token];
    }

    const pool = [...KEYWORDS, ...BUILTINS, ...this.session.symbols().keys()];
    return [prefixed([...new Set(pool)].sort(), token), token];
  }

  /** Builtins UNION whatever this session has defined with `(defmodifier ...)`. */
  private modifiers(): string[] {
    const defined = [...this.session.symbols()]
      .filter(([, s]) => s.kind === "modifier")
      .map(([name]) => `:${name}`);

    return [...new Set([...MODIFIERS, ...defined])].sort();
  }
}

function prefixed(pool: string[], token: string): string[] {
  // readline offers the WHOLE pool when nothing matches, which is worse than offering nothing.
  return pool.filter((c) => c.startsWith(token));
}

function lastToken(line: string): string {
  // String and comment contents are not code, and must not be completed as though they were.
  const code = line.replace(/"(\\.|[^"\\])*"/g, "").replace(/;.*$/, "");
  return /[a-zA-Z0-9_.:><=+*/-]+$/.exec(code)?.[0] ?? "";
}
