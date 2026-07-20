// Export the l-lang Chevrotain grammar (grammar_v2/Parser) as EBNF, straight off the
// serialized GAST so it can never drift from the real parser.
//   npm run grammar:ebnf   ->   docs/inbox/l-lang.grammar.ebnf
import * as fs from "fs";
import * as path from "path";
import { parser } from "../compiler/frontend/grammar_v2/Parser";

type G = any;
const gast: G[] = parser.getSerializedGastProductions();

// --- terminal rendering -------------------------------------------------------
// A token pattern is an INLINE LITERAL (keyword / punctuation) unless it looks like a
// regex character-class / escape / group -- those are the lexical categories, shown as
// <UPPERCASE> names and collected into a legend.
const isRegexy = (p: string) => /\\|\[[^\]]*\]|\(\?/.test(p);
const lexicals = new Map<string, string>(); // TokenName -> pattern (for the legend)
const CATEGORY = "(category / programmatic token)";

function renderTerminal(t: G): string {
  const pat: string = t.pattern ?? "";
  const inlineable = pat && pat !== "NOT_APPLICABLE" && !isRegexy(pat) && !/["']/.test(pat);
  if (inlineable) {
    // keyword / punctuation, possibly a `a|b` alias set -> quote each top-level branch
    const branches = pat.split("|").map((b) => `"${b}"`);
    return branches.length > 1 ? `( ${branches.join(" | ")} )` : branches[0];
  }
  // category token (Lexer.NA), regex lexical, or quote-bearing delimiter -> a named terminal
  lexicals.set(t.name, pat && pat !== "NOT_APPLICABLE" ? pat : CATEGORY);
  return `<${t.name}>`;
}

// --- structural rendering -----------------------------------------------------
function render(node: G): string {
  switch (node.type) {
    case "Terminal":
      return renderTerminal(node);
    case "NonTerminal":
      return node.nonTerminalName ?? node.name;
    case "Alternative":
    case "Flat":
      return (node.definition ?? []).map(render).filter(Boolean).join(" ");
    case "Alternation": {
      const alts = (node.definition ?? []).map(render);
      return `( ${alts.join(" | ")} )`;
    }
    case "Option":
      return `${wrap(node)}?`;
    case "Repetition":
      return `${wrap(node)}*`;
    case "RepetitionMandatory":
      return `${wrap(node)}+`;
    case "RepetitionWithSeparator":
      return `${wrap(node)}*   /* sep: ${sepName(node)} */`;
    case "RepetitionMandatoryWithSeparator":
      return `${wrap(node)}+   /* sep: ${sepName(node)} */`;
    default:
      return `/*?${node.type}*/`;
  }
}
const sepName = (n: G) => (n.separator ? renderTerminal(n.separator) : "?");
// A repetition/option body is a Flat list; wrap in ( ) when it has >1 element or is an alternation.
function wrap(node: G): string {
  const body = (node.definition ?? []).map(render).filter(Boolean);
  if (body.length === 1 && !/[ |]/.test(body[0])) return body[0];
  return `( ${body.join(" ")} )`;
}

// --- assemble -----------------------------------------------------------------
const ruleLine = (r: G) => `${r.name.padEnd(22)} ::= ${(r.definition ?? []).map(render).join(" ")} ;`;

// start symbol first, then declaration order
const ordered = [...gast].sort((a, b) =>
  a.name === "program" ? -1 : b.name === "program" ? 1 : 0
);

const out: string[] = [];
out.push("(* l-lang grammar -- EBNF, auto-generated from grammar_v2/Parser.ts serialized GAST. *)");
out.push("(* DO NOT hand-edit: regenerate with `npm run grammar:ebnf`.                          *)");
out.push("(* CAVEAT: 31 semantic GATEs in the parser are NOT expressible in a CFG -- the grammar *)");
out.push("(* below is therefore OVER-PERMISSIVE at matrix/vector, adjacency chains, and composite*)");
out.push("(* identifiers. It describes the SHAPE, not the exact accepted language.               *)");
out.push("");
out.push("(* ===== productions ===== *)");
out.push("");
for (const r of ordered) out.push(ruleLine(r));

out.push("");
out.push("(* ===== lexical terminals (regex tokens; keywords/punct are inlined above) ===== *)");
out.push("");
for (const [name, pat] of [...lexicals].sort()) {
  const rhs = pat === CATEGORY ? `${CATEGORY} -- a token CATEGORY (Lexer.NA)` : `/${pat}/`;
  out.push(`<${name}>`.padEnd(24) + `::= ${rhs}`);
}

const dest = path.join(__dirname, "../../docs/inbox/l-lang.grammar.ebnf");
fs.writeFileSync(dest, out.join("\n") + "\n", "utf8");
console.log(`grammar:ebnf -> ${dest} (${gast.length} productions, ${lexicals.size} lexical terminals)`);
