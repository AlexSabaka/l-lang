import { checkBracketsBalance } from "../../compiler/utils";

/**
 * What the buffer decided about a submitted line.
 *
 * A discriminated union, deliberately. The old REPL threaded this through `true | number` -- the
 * return type of `checkBracketsBalance` -- and there was no way for the caller to tell "you need
 * more input" from "that bracket is wrong": both arrive as a number. `command.repl.ts` therefore
 * treated EVERY non-`true` answer as "keep buffering", multiplied it by two, and fed it to
 * `".".repeat()`. For a stray `)` that is `".".repeat(-2)` -- a RangeError, thrown OUTSIDE the
 * line handler's try/catch, which killed the process.
 *
 * The states are what the REPL actually needs to distinguish, so make them unrepresentable
 * otherwise.
 */
export type FeedResult =
  | { kind: "complete"; source: string }
  | { kind: "incomplete"; depth: number }
  | { kind: "unbalanced"; message: string }
  | { kind: "empty" };

/**
 * Accumulates lines until they form one submittable form.
 *
 * Extracted from `command.repl.ts` so the multi-line decision can be tested without a pty. This is
 * the PHASE-1 version: it is a faithful copy of the current behaviour, RangeError and all, so that
 * the gate's B3 case fails for the real reason rather than because the seam is a stub. Phase 4
 * replaces the body with a REPL-local reader that understands string escapes and `;` comments.
 */
export class MultiLineBuffer {
  private lines: string[] = [];

  get pending(): boolean {
    return this.lines.length > 0;
  }

  cancel(): void {
    this.lines = [];
  }

  feed(line: string): FeedResult {
    const full = [...this.lines, line].join("\n");
    const balance = checkBracketsBalance(full);

    if (balance !== true) {
      this.lines.push(line);

      // PHASE 1: preserved verbatim from command.repl.ts:119-120, including the defect.
      // `checkBracketsBalance` returns -1 when there are more closers than openers, so a lone `)`
      // lands here with balance === -1 and `".".repeat(-2)` throws RangeError. Phase 4 fixes it.
      const indent = typeof balance === "number" ? balance * 2 : 2;
      const _prompt = ".".repeat(indent);

      return { kind: "incomplete", depth: typeof balance === "number" ? balance : 0 };
    }

    this.lines = [];
    return full.trim() === "" ? { kind: "empty" } : { kind: "complete", source: full };
  }
}
