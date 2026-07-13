import { classify } from "./readiness";

export type FeedResult =
  | { kind: "complete"; source: string }
  | { kind: "incomplete"; depth: number }
  | { kind: "unbalanced"; message: string }
  | { kind: "empty" };

/**
 * Accumulates lines until they form one submittable form.
 *
 * Extracted from `command.repl.ts` so the multi-line decision can be tested without a pty. It
 * carries no display concerns -- the caller decides what a continuation prompt looks like. The old
 * code computed the prompt string HERE, from a bracket count, which is how a stray `)` turned into
 * `".".repeat(-2)` and killed the process.
 *
 * On `unbalanced` the buffer DROPS what it was holding. There is no recovering a form from a
 * mis-bracketed prefix, and silently keeping it would make the next line fail for a reason the user
 * can no longer see.
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
    const source = [...this.lines, line].join("\n");
    const state = classify(source);

    if (state.kind === "unbalanced") {
      this.lines = [];
      return state;
    }

    if (state.kind === "incomplete") {
      this.lines.push(line);
      return state;
    }

    this.lines = [];
    return source.trim() === "" ? { kind: "empty" } : { kind: "complete", source };
  }
}
