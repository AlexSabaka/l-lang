import chalk from "chalk";
import * as readline from "node:readline";
import { Command } from "commander";

import { getCompilerOptions } from "../getCompilerOptions";
import { ReplSession } from "../repl/ReplSession";
import { ReplRenderer } from "../repl/ReplRenderer";
import { MultiLineBuffer } from "../repl/MultiLineBuffer";
import { REPLCompleter } from "../repl/REPLCompleter";

/**
 * The REPL's readline plumbing. Nothing else.
 *
 * It reads lines, hands them to `ReplSession`, and prints what `ReplRenderer` gives back. It does
 * not compile, does not format, and does not decide anything about the language. The old command did
 * all three, which is why none of it could be tested without a terminal -- and so none of it ever was.
 */
export function repl(command: Command) {
  const session = new ReplSession(getCompilerOptions(command));
  const render = new ReplRenderer();
  const buffer = new MultiLineBuffer();
  const completer = new REPLCompleter(session.getContext());

  const PROMPT = chalk.green("> ");
  const CONTINUE = chalk.dim("· ");

  console.log(render.welcome());

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: PROMPT,
    completer: (line: string) => completer.getCompletions(line),
    terminal: true,
    historySize: 1000,
  });

  const ready = () => {
    rl.setPrompt(buffer.pending ? CONTINUE : PROMPT);
    rl.prompt();
  };

  const goodbye = () => {
    console.log(chalk.dim("\nbye"));
    session.dispose();
    process.exit(0);
  };

  rl.on("SIGINT", () => {
    if (buffer.pending) {
      buffer.cancel();
      console.log(chalk.dim("\ncancelled"));
      ready();
    } else {
      goodbye();
    }
  });

  rl.on("line", (line: string) => {
    const trimmed = line.trim();

    if (trimmed.startsWith(".") && !buffer.pending) {
      if (dotCommand(trimmed, session, render) === "exit") return goodbye();
      return ready();
    }

    const fed = buffer.feed(line);

    if (fed.kind === "incomplete" || fed.kind === "empty") return ready();

    if (fed.kind === "unbalanced") {
      // The old REPL turned this into `".".repeat(-2)` -- a RangeError thrown outside the handler's
      // try/catch, which killed the process. It is just a message.
      console.error(chalk.red("error: ") + fed.message);
      return ready();
    }

    const result = session.eval(fed.source);
    completer.updateContext(session.getContext());

    switch (result.kind) {
      case "value":
        for (const out of result.output) console.log(out);
        for (const w of result.warnings) console.error(render.diagnostic(w));
        if (result.value !== undefined) console.log(render.value(result.value));
        break;

      case "refused":
        // B2, the thing the old REPL never did: it dropped every compiler diagnostic on the floor
        // and returned a bare prompt, so a type error looked exactly like a form that produced
        // nothing.
        for (const d of result.diagnostics) console.error(render.diagnostic(d));
        break;

      case "runtime-error":
        for (const out of result.output) console.log(out);
        console.error(chalk.red("error: ") + result.error.message);
        break;
    }

    ready();
  });

  rl.on("close", goodbye);

  rl.prompt();
}

/** Returns "exit" when the session should end. */
function dotCommand(input: string, session: ReplSession, render: ReplRenderer): "exit" | void {
  const [name, ...rest] = input.split(/\s+/);
  const arg = rest.join(" ").trim();

  switch (name) {
    case ".help":
      console.log(render.help());
      return;

    case ".exit":
    case ".quit":
      return "exit";

    case ".reset":
      session.reset();
      console.log(chalk.green("reset"));
      return;

    case ".delete":
      if (!arg) {
        console.error(chalk.red("error: ") + ".delete needs a name, e.g. `.delete x`");
        return;
      }
      console.log(render.deleted(arg, session.delete(arg)));
      return;

    case ".symbols":
      console.log(render.symbols(session.symbols()));
      return;

    case ".types":
      console.log(render.types(session.symbols()));
      return;

    case ".history":
      console.log(render.history(session.cells));
      return;

    case ".clear":
      console.clear();
      console.log(render.welcome());
      return;

    default:
      console.error(chalk.red("error: ") + `unknown command \`${name}\``);
      console.error(chalk.dim("  .help lists them"));
      return;
  }
}
