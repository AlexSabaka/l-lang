import chalk from "chalk";
import * as readline from "node:readline";
import highlight from "cli-highlight";
import hljs from "highlight.js";

import { Command } from "commander";

import { getCompilerOptions } from "../getCompilerOptions";
import { checkBracketsBalance } from "../../compiler/utils";
import { PersistentREPLContext } from "../repl/PersistentREPLContext";
import { REPLCompleter } from "../repl/REPLCompleter";
import llangHighlighter from "../../compiler/frontend/highlighter/l-lang";
import { LogLevel } from "../../compiler/Context";

/**
 * Apply syntax highlighting to l-lang code
 */
function highlightLLang(code: string): string {
  try {
    // Register the language inline for this highlighting
    const tempHljs = hljs.newInstance();
    tempHljs.registerLanguage("l-lang", llangHighlighter);
    return tempHljs.highlight(code, { language: "l-lang", ignoreIllegals: true }).value;
  } catch (e) {
    // Fallback to unhighlighted if there's an error
    return code;
  }
}

/**
 * Print welcome message
 */
function printWelcome(): void {
  console.log(chalk.cyan.bold("\n╔════════════════════════════════════════╗"));
  console.log(chalk.cyan.bold("║  ") + chalk.white.bold("L-Lang REPL v0.0.1") + chalk.cyan.bold("                    ║"));
  console.log(chalk.cyan.bold("╚════════════════════════════════════════╝"));
  console.log(chalk.dim("Type .help for commands, .exit to quit\n"));
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(chalk.cyan.bold("\n📚 REPL Commands:"));
  console.log(chalk.green("  .help     ") + chalk.dim("- Show this help message"));
  console.log(chalk.green("  .exit     ") + chalk.dim("- Exit the REPL (or Ctrl+C, Ctrl+D)"));
  console.log(chalk.green("  .reset    ") + chalk.dim("- Clear context and start fresh"));
  console.log(chalk.green("  .symbols  ") + chalk.dim("- List all defined symbols"));
  console.log(chalk.green("  .types    ") + chalk.dim("- Show type information for symbols"));
  console.log(chalk.green("  .history  ") + chalk.dim("- Show command history"));
  console.log(chalk.green("  .clear    ") + chalk.dim("- Clear the screen"));
  
  console.log(chalk.cyan.bold("\n⌨️  Keyboard Shortcuts:"));
  console.log(chalk.green("  Tab       ") + chalk.dim("- Autocomplete"));
  console.log(chalk.green("  ↑/↓       ") + chalk.dim("- Navigate history"));
  console.log(chalk.green("  ←/→       ") + chalk.dim("- Move cursor"));
  console.log(chalk.green("  Ctrl+C    ") + chalk.dim("- Cancel current input or exit"));
  console.log();
}

/**
 * Main REPL function
 */
export function repl(command: Command) {
  const options = getCompilerOptions(command);
  const replContext = new PersistentREPLContext(options);
  const completer = new REPLCompleter(replContext.getContext());
  
  let multiLineBuffer: string[] = [];
  
  printWelcome();

  // Create readline interface with autocomplete
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green("> "),
    completer: (line: string) => {
      const [completions, originalLine] = completer.getCompletions(line);
      return [completions, originalLine];
    },
    terminal: true,
    historySize: 1000,
  });

  // Handle SIGINT (Ctrl+C)
  rl.on("SIGINT", () => {
    if (multiLineBuffer.length > 0) {
      // Cancel multi-line input
      multiLineBuffer = [];
      console.log(chalk.yellow("\n(Input cancelled)"));
      rl.setPrompt(chalk.green("> "));
      rl.prompt();
    } else {
      // Exit REPL
      console.log(chalk.cyan("\n👋 Goodbye!"));
      replContext.dispose();
      process.exit(0);
    }
  });

  // Handle line input
  rl.on("line", (input: string) => {
    const trimmed = input.trim();

    // Handle REPL commands
    if (trimmed.startsWith(".")) {
      handleCommand(trimmed, replContext, rl);
      return;
    }

    // Check bracket balance for multi-line support
    const fullInput = [...multiLineBuffer, input].join("\n");
    const balance = checkBracketsBalance(fullInput);

    if (balance !== true) {
      // Unbalanced - continue multi-line input
      multiLineBuffer.push(input);
      const indent = typeof balance === "number" ? balance * 2 : 2;
      rl.setPrompt(chalk.dim(".".repeat(indent) + " "));
      rl.prompt();
      return;
    }

    // Balanced - execute the code
    multiLineBuffer = [];

    if (fullInput.trim() === "") {
      rl.setPrompt(chalk.green("> "));
      rl.prompt();
      return;
    }

    try {
      // Execute in persistent context
      const result = replContext.eval(fullInput);
      
      // Update completer with new context
      completer.updateContext(replContext.getContext());

      // Print result if not undefined
      if (result !== undefined) {
        console.log(chalk.cyan("=> ") + formatResult(result));
      }
    } catch (error: any) {
      // Format and display errors
      if (error.name === "SyntaxError") {
        console.error(chalk.red("Syntax Error: ") + error.message);
        if (error.location) {
          console.error(chalk.dim(`  at line ${error.location.start.line}, column ${error.location.start.column}`));
        }
      } else if (error.name === "TypeError") {
        console.error(chalk.red("Type Error: ") + error.message);
      } else {
        console.error(chalk.red("Error: ") + error.message);
        if (options.minimumLogLevel === LogLevel.Debug || options.minimumLogLevel === LogLevel.Verbose) {
          console.error(chalk.dim(error.stack));
        }
      }
    }

    rl.setPrompt(chalk.green("> "));
    rl.prompt();
  });

  // Handle close
  rl.on("close", () => {
    console.log(chalk.cyan("\n👋 Goodbye!"));
    replContext.dispose();
    process.exit(0);
  });

  // Start the REPL
  rl.prompt();
}

/**
 * Handle REPL commands
 */
function handleCommand(cmd: string, replContext: PersistentREPLContext, rl: readline.Interface): void {
  switch (cmd) {
    case ".help":
      printHelp();
      break;

    case ".exit":
    case ".quit":
      console.log(chalk.cyan("\n👋 Goodbye!"));
      replContext.dispose();
      process.exit(0);
      break;

    case ".reset":
      replContext.reset();
      console.log(chalk.green("✓ Context cleared. Starting fresh."));
      break;

    case ".symbols":
      printSymbols(replContext);
      break;

    case ".types":
      printTypes(replContext);
      break;

    case ".history":
      const history = replContext.getHistory();
      if (history.length === 0) {
        console.log(chalk.yellow("No history yet."));
      } else {
        console.log(chalk.cyan.bold("\n📜 History:"));
        history.forEach((item: string, i: number) => {
          console.log(chalk.dim(`  ${i + 1}. `) + highlightLLang(item));
        });
        console.log();
      }
      break;

    case ".clear":
      console.clear();
      printWelcome();
      break;

    default:
      console.log(chalk.red(`Unknown command: ${cmd}`));
      console.log(chalk.dim("Type .help for available commands"));
      break;
  }

  rl.prompt();
}

/**
 * Print all defined symbols
 */
function printSymbols(replContext: PersistentREPLContext): void {
  const symbols = replContext.getSymbols();
  if (symbols.size === 0) {
    console.log(chalk.yellow("No symbols defined yet."));
    return;
  }

  console.log(chalk.cyan.bold("\n🔣 Defined Symbols:"));
  
  // Group by type
  const grouped: Record<string, string[]> = {
    variable: [],
    function: [],
    class: [],
  };

  for (const [name, entry] of symbols.entries()) {
    const type = entry.type || "variable";
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(name);
  }

  for (const [type, names] of Object.entries(grouped)) {
    if (names.length > 0) {
      console.log(chalk.white.bold(`  ${type.toUpperCase()}:`));
      console.log(chalk.dim(`    ${names.sort().join(", ")}`));
    }
  }
  console.log();
}

/**
 * Print types of all symbols
 */
function printTypes(replContext: PersistentREPLContext): void {
  const symbols = replContext.getSymbols();
  if (symbols.size === 0) {
    console.log(chalk.yellow("No symbols defined yet."));
    return;
  }

  console.log(chalk.cyan.bold("\n🏷️  Symbol Types:"));
  for (const [name, entry] of symbols.entries()) {
    const typeInfo = entry.inferredType;
    let typeStr = "unknown";
    
    if (typeInfo) {
      if (typeof typeInfo === 'string') typeStr = typeInfo;
      else if (typeInfo.name) typeStr = typeInfo.name;
    }
    
    console.log(`  ${chalk.white(name)}: ${chalk.green(typeStr)}`);
  }
  console.log();
}

/**
 * Format result for display
 */
function formatResult(result: any): string {
  if (result === null) return chalk.dim("null");
  if (result === undefined) return chalk.dim("undefined");
  if (typeof result === "string") return chalk.yellow(`"${result}"`);
  if (typeof result === "number") return chalk.blue(result.toString());
  if (typeof result === "boolean") return chalk.magenta(result.toString());
  if (typeof result === "function") return chalk.dim("[Function]");
  
  try {
    return highlight(JSON.stringify(result, null, 2), { language: "json", ignoreIllegals: true });
  } catch (e) {
    return String(result);
  }
}
