/**
 * Is this input a finished form, does it need another line, or is it simply wrong?
 *
 * The only bracket reader in the codebase, and the reason the other one is gone.
 *
 * `compiler/utils/checkBracketsBalance` returned `true | number` and crammed three different answers
 * into it: `true` for balanced, a count for unclosed, `-1` for too many closers -- and, worst,
 * `stack.length` (which can be 0) for a MISMATCHED bracket, making "that `]` is wrong"
 * indistinguishable from "balanced". A caller cannot act correctly on an answer it cannot tell apart,
 * and the old REPL didn't: it treated every non-`true` answer as "keep buffering", multiplied it by
 * two, and fed it to `".".repeat()`. A stray `)` became `".".repeat(-2)` -- a RangeError thrown
 * outside the line handler's try/catch, which killed the process. It also mis-counted `\"` escapes and
 * `;` comments, both of which a REPL meets immediately.
 *
 * This file replaced it, and once it did, that function had ZERO callers anywhere in the repo -- dead
 * AND wrong, still exported from the utils barrel for anyone to find. It has been deleted
 * (docs/inbox/compiler-notes-from-repl.md #2).
 *
 * It lives here, not in `compiler/utils`, because the REPL is its only consumer. Promoting it would
 * be building a shared abstraction for a second caller that does not exist. If an LSP ever wants one,
 * that is the moment to move it.
 */

export type Readiness =
  /** A complete, submittable form. */
  | { kind: "complete" }
  /** Needs more input. `depth` is how many brackets are still open. */
  | { kind: "incomplete"; depth: number }
  /** Not a form, and no amount of further typing will make it one. */
  | { kind: "unbalanced"; message: string };

const CLOSER: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const OPENERS = new Set(Object.keys(CLOSER));
const CLOSERS = new Set(Object.values(CLOSER));

export function classify(source: string): Readiness {
  const expected: string[] = [];

  let inString = false;
  let escaped = false;
  let inComment = false;

  for (const ch of source) {
    if (inComment) {
      if (ch === "\n") inComment = false;
      continue;
    }

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === ";") {
      inComment = true;
      continue;
    }

    if (OPENERS.has(ch)) {
      expected.push(CLOSER[ch]);
      continue;
    }

    if (CLOSERS.has(ch)) {
      if (expected.length === 0) {
        return { kind: "unbalanced", message: `unexpected \`${ch}\` -- nothing is open` };
      }
      const want = expected.pop();
      if (want !== ch) {
        return { kind: "unbalanced", message: `expected \`${want}\`, found \`${ch}\`` };
      }
    }
  }

  // An unterminated string is not an error yet -- l-lang strings may span lines, and in a REPL the
  // user is simply mid-sentence. Ask for another line rather than refusing.
  if (inString) return { kind: "incomplete", depth: Math.max(expected.length, 1) };

  return expected.length === 0 ? { kind: "complete" } : { kind: "incomplete", depth: expected.length };
}
