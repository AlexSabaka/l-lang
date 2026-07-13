import chalk from "chalk";
import highlight from "cli-highlight";

import { ReplDiagnostic, DeleteOutcome, Cell } from "./ReplSession";

/**
 * Everything the user sees. The ONLY place chalk is allowed.
 *
 * `ReplSession` returns plain data and `command.repl.ts` moves lines around; neither one formats.
 * That is what lets the session be driven by `test/repl.ts` without a terminal -- the old REPL
 * printed from inside its eval path, so testing it meant scraping stdout, which meant it was never
 * tested at all.
 */
export class ReplRenderer {
  /**
   * Echo l-lang source with ANSI colour.
   *
   * NOT via `highlight.js` directly. `hljs.highlight(...).value` returns **HTML** -- the old REPL
   * registered the project's `l-lang` grammar on an hljs instance and printed the result straight to
   * the terminal, so `.history` emitted literal `<span class="hljs-title">` markup. `cli-highlight`
   * is the ANSI-emitting wrapper, and `lisp` is close enough for echoing a form back: the project's
   * own l-lang grammar is an hljs definition and cannot be handed to cli-highlight's built-in themes.
   */
  code(source: string): string {
    try {
      return highlight(source, { language: "lisp", ignoreIllegals: true });
    } catch {
      return source;
    }
  }

  welcome(): string {
    return [
      "",
      chalk.cyan.bold("  l-lang") + chalk.dim("  ·  interactive"),
      chalk.dim("  .help for commands, .exit to quit"),
      "",
    ].join("\n");
  }

  help(): string {
    const row = (cmd: string, what: string) => `  ${chalk.green(cmd.padEnd(16))}${chalk.dim(what)}`;
    return [
      "",
      chalk.bold("Commands"),
      row(".help", "show this"),
      row(".exit", "leave (also Ctrl+D)"),
      row(".reset", "forget everything and start over"),
      row(".delete <name>", "remove a declaration -- the only way to CHANGE ITS TYPE"),
      row(".symbols", "what is defined"),
      row(".types", "what it is defined as"),
      row(".history", "the forms that make up this session"),
      row(".clear", "clear the screen"),
      "",
      chalk.bold("Keys"),
      row("Tab", "complete"),
      row("Up / Down", "history"),
      row("Ctrl+C", "cancel the current input, or exit"),
      "",
    ].join("\n");
  }

  /**
   * `=> value`.
   *
   * Strings are quoted so `1` and `"1"` are distinguishable -- a REPL that renders them the same is
   * lying about the type, which in a statically typed language is the one thing it must not do.
   */
  value(v: unknown): string {
    const body =
      v === null
        ? chalk.dim("nil")
        : v === undefined
          ? chalk.dim("undefined")
          : typeof v === "string"
            ? chalk.yellow(JSON.stringify(v))
            : typeof v === "number"
              ? chalk.blue(String(v))
              : typeof v === "boolean"
                ? chalk.magenta(String(v))
                : typeof v === "function"
                  ? chalk.dim(`[Function ${(v as any).name || "anonymous"}]`)
                  : this.json(v);

    return chalk.cyan("=> ") + body;
  }

  /**
   * A diagnostic, pointing at the line the USER typed.
   *
   * The compiler reports against the assembled program -- history plus the new input -- so a raw
   * line number refers to a file the user has never seen. `ReplSession` has already mapped it back;
   * this just says where.
   */
  diagnostic(d: ReplDiagnostic): string {
    const tag =
      d.severity === "error"
        ? chalk.red.bold(`error[${d.code}]`)
        : d.severity === "warning"
          ? chalk.yellow.bold(`warning[${d.code}]`)
          : chalk.blue.bold(`note[${d.code}]`);

    const where =
      d.origin.kind === "input"
        ? chalk.dim(`  at line ${d.origin.line}:${d.origin.column}`)
        : d.origin.kind === "history"
          ? "\n" +
            chalk.dim(`  in a form you entered earlier:`) +
            "\n" +
            chalk.dim(`    ${this.code(d.origin.source.split("\n")[0])}`)
          : chalk.dim(`  at ${d.origin.file}:${d.origin.line}:${d.origin.column}`);

    return `${tag} ${d.text}${where}`;
  }

  /** What a `.delete` took with it. Loud on purpose: it removes code the user wrote. */
  deleted(name: string, outcome: DeleteOutcome): string {
    if (outcome.kind === "not-found") {
      return chalk.yellow(`nothing named '${name}' is defined`);
    }

    const lines = [chalk.green(`removed '${name}'`)];

    if (outcome.alsoRemoved.length > 0) {
      lines.push(
        chalk.yellow(
          `  that form also declared ${outcome.alsoRemoved.map((n) => `'${n}'`).join(", ")} -- ` +
            `${outcome.alsoRemoved.length === 1 ? "it is" : "they are"} gone too`
        )
      );
    }

    for (const source of outcome.broke) {
      lines.push(chalk.yellow(`  dropped, it no longer compiles: `) + this.code(source.split("\n")[0]));
    }

    return lines.join("\n");
  }

  symbols(symbols: Map<string, any>): string {
    if (symbols.size === 0) return chalk.dim("nothing defined yet");

    const grouped = new Map<string, string[]>();
    for (const [name, entry] of symbols) {
      const kind = entry.type || "value";
      if (!grouped.has(kind)) grouped.set(kind, []);
      grouped.get(kind)!.push(name);
    }

    return [...grouped.entries()]
      .map(
        ([kind, names]) =>
          chalk.bold(`  ${kind}`) + "\n" + chalk.dim(`    ${names.sort().join(", ")}`)
      )
      .join("\n");
  }

  types(symbols: Map<string, any>): string {
    if (symbols.size === 0) return chalk.dim("nothing defined yet");

    const width = Math.max(...[...symbols.keys()].map((n) => n.length));
    return [...symbols.entries()]
      .map(([name, entry]) => {
        const t = entry.inferredType;
        const shown = typeof t === "string" ? t : (t?.name ?? "?");
        return `  ${name.padEnd(width)}  ${chalk.green(shown)}`;
      })
      .join("\n");
  }

  history(cells: readonly Cell[]): string {
    if (cells.length === 0) return chalk.dim("nothing yet");
    return cells
      .map((c, i) => chalk.dim(`  ${String(i + 1).padStart(3)}  `) + this.code(c.source))
      .join("\n");
  }

  private json(v: unknown): string {
    try {
      return highlight(JSON.stringify(v, null, 2), { language: "json", ignoreIllegals: true });
    } catch {
      return String(v);
    }
  }
}
