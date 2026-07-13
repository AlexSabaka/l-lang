/**
 * Is this input a finished form, does it need another line, or is it simply wrong?
 *
 * A REPL-local reader, deliberately NOT `compiler/utils/checkBracketsBalance`. That function
 * returns `true | number` and crams three different answers into it: `true` for balanced, a count
 * for unclosed, `-1` for too many closers -- and, worst, `stack.length` (which can be 0) for a
 * MISMATCHED bracket, making "that `]` is wrong" indistinguishable from "balanced". The REPL cannot
 * act correctly on an answer it cannot tell apart, and it didn't: `command.repl.ts` treated every
 * non-`true` answer as "keep buffering", multiplied it by two, and fed it to `".".repeat()`. A
 * stray `)` became `".".repeat(-2)` -- a RangeError thrown outside the line handler's try/catch,
 * which killed the process.
 *
 * It also handles two things the shared util does not, and which a REPL meets immediately:
 * `\"` escapes inside strings, and `;` line comments. Without those, `(print "a\")b")` and a `)`
 * inside a comment both mis-count.
 *
 * The shared util's defects are written up in docs/inbox/compiler-notes-from-repl.md; this refactor
 * is scoped REPL-side and does not touch it.
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
