// Export the l-lang AST SCHEMA as an l-lang module, straight off `compiler/frontend/ast.ts` so it
// can never drift from the node types the parser actually builds.
//   npm run ast:stdlib   ->   lib/std/llang/ast.lisp
//
// WHY A SCHEMA AND NOT ACCESSORS. A quoted form is a MAP (M1/D3d), and l-lang reads a map field with
// ordinary member access -- `n._type`, `n.nodes` -- which is ALREADY TOTAL: an absent field answers
// `nil` on both backends rather than raising, measured. So the 80 field accessors a mirror of `ast.ts`
// would generate buy nothing; they would be ceremony over a working syntax. `std/llang/reflect` needs
// its accessors because a reflection descriptor's shape varies by kind and `t["extends"]` on a root
// class DOES raise. That argument does not transfer, and the shape of this module is different for it.
//
// What genuinely does not exist in l-lang is the SCHEMA: which node kinds the grammar can produce,
// what fields each declares, and which of those fields hold CHILD NODES rather than scalars. A form
// walker needs the third of those and cannot derive it -- and a macro author needs all three, which
// today are knowable only by reading TypeScript.
//
// The one heuristic, stated because it is the only place this can silently go stale: a field is
// CHILD-BEARING if its declared type mentions a node-bearing name. Node-bearing names are the
// interfaces that extend `ASTNode<...>`, plus every type ALIAS whose definition mentions one (that is
// what makes `BindingTarget = IdentifierNode | VectorPatternNode | MapPatternNode` resolve). A field
// typed by something node-bearing through a route this does not follow would be reported as a scalar.
//
// WHY THE SCHEMA IS EMITTED AS `match` ARMS AND NOT AS A MAP CONSTANT. The obvious shape is a
// module-level `(let AST-FIELDS { … })` and a `map-get`. Measured: a module-level MAP LITERAL in an
// IMPORTED module has no C lowering -- `ELL0106 Cannot generate C for 'map' (resolveAstExpr)` -- while
// the same literal inside a function body, and the same module on the JS backend, both work. So that
// shape would make this module JS-only, which for a module about the compiler's own AST would be
// absurd. Returning vector literals out of `match` arms lowers on both backends; it costs lines, and
// the lines are generated. The gap itself is recorded in roadmap rather than worked around silently.
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src/compiler/frontend/ast.ts");
const OUT = path.join(ROOT, "lib/std/llang/ast.lisp");

interface Field { name: string; type: string; child: boolean }
interface Kind { iface: string; kind: string; fields: Field[] }

const sf = ts.createSourceFile(SRC, fs.readFileSync(SRC, "utf8"), ts.ScriptTarget.Latest, true);

// --- pass 1: which type NAMES are node-bearing ------------------------------------------------
// The interfaces extending ASTNode, plus aliases that resolve (transitively) to them.
const nodeNames = new Set<string>(["ASTNode"]);
const aliases = new Map<string, string>();

sf.forEachChild((n) => {
  if (ts.isInterfaceDeclaration(n)) {
    const base = n.heritageClauses?.[0]?.types?.[0]?.expression.getText(sf);
    if (base === "ASTNode") nodeNames.add(n.name.text);
  } else if (ts.isTypeAliasDeclaration(n)) {
    aliases.set(n.name.text, n.type.getText(sf));
  }
});
// Fixed point over the aliases: an alias is node-bearing if its text mentions a node-bearing name.
for (let changed = true; changed; ) {
  changed = false;
  for (const [name, text] of aliases) {
    if (nodeNames.has(name)) continue;
    if ([...nodeNames].some((n) => new RegExp(`\\b${n}\\b`).test(text))) { nodeNames.add(name); changed = true; }
  }
}
const isChildType = (t: string) => [...nodeNames].some((n) => new RegExp(`\\b${n}\\b`).test(t));

// --- pass 2: the kinds and their fields --------------------------------------------------------
const kinds: Kind[] = [];
sf.forEachChild((n) => {
  if (!ts.isInterfaceDeclaration(n)) return;
  const heritage = n.heritageClauses?.[0]?.types?.[0];
  if (heritage?.expression.getText(sf) !== "ASTNode") return;
  const kind = (heritage.typeArguments?.[0]?.getText(sf) ?? "").replace(/^["']|["']$/g, "");
  if (!kind) return;
  const fields = n.members.filter(ts.isPropertySignature).map((m) => {
    const type = m.type?.getText(sf) ?? "unknown";
    return { name: m.name.getText(sf), type, child: isChildType(type) };
  });
  kinds.push({ iface: n.name.text, kind, fields });
});
kinds.sort((a, b) => a.kind.localeCompare(b.kind));

// --- emit ---------------------------------------------------------------------------------------
const vec = (xs: string[]) => `[${xs.map((x) => JSON.stringify(x)).join(" ")}]`;
// A kind name is not always a legal l-lang identifier tail, so predicates mangle exactly one way:
// `simple-identifier` -> `is-simple-identifier-node`. Kinds are already kebab-case, so the only
// transformation is the affixes.
//
// THE `-node` SUFFIX IS NOT DECORATION -- it settles a collision that produced a WRONG ANSWER.
//
// These predicates ask about an AST NODE (`n._type`). `std/llang/reflect`'s ask about a runtime TYPE
// DESCRIPTOR (`t.kind`). Five names were shared -- `is-class`, `is-struct`, `is-interface`,
// `is-function`, `is-enum` -- and the two modules are PACKAGE SIBLINGS, so both are injected into any
// importer of either and the winner is decided by module order. Measured, same descriptor, same
// question, zero diagnostics:
//
//     (import "std/llang/reflect")                 -> (is-class d)  true
//     (import "std/llang/ast")                     -> (is-class d)  false
//     (import ast) then (import reflect)           -> false
//     (import reflect) then (import ast)           -> true
//
// Two different questions cannot share one name in one package. The AST side moves because every
// caller in the tree uses the REFLECT meaning -- these had zero call sites -- and because a
// suffix that names the subject is what the collision was missing in the first place.
const predName = (kind: string) => `is-${kind}-node`;

const L: string[] = [];
L.push(";; std/llang/ast -- the l-lang AST SCHEMA, in l-lang.");
L.push(";;");
L.push(";; GENERATED FROM `src/compiler/frontend/ast.ts` BY `npm run ast:stdlib`. Do not edit by hand;");
L.push(";; `npm run test:docs` regenerates it and fails if the committed copy has drifted.");
L.push(";;");
L.push(";; A quoted form is a MAP (D3d) whose `_type` names its kind and whose other keys are that");
L.push(";; kind's declared fields. Reading a field is ordinary member access and is already TOTAL --");
L.push(";; `n.condition` on a `list` answers nil rather than raising -- so this module deliberately");
L.push(";; declares NO field accessors. What it declares is what member access cannot tell you:");
L.push(";;");
L.push(";;   * which kinds exist at all             -- `kinds`, and one predicate per kind");
L.push(";;   * what fields a kind declares          -- `fields-of`");
L.push(";;   * which of those hold CHILD NODES      -- `child-fields-of`, what a walker follows");
L.push(";;");
L.push(";; Every accessor is TOTAL: an unknown kind answers an empty vector, never an error.");
L.push(";;");
L.push(`;; ${kinds.length} node kinds.`);
L.push("(");

L.push("    ;; The kind of a datum, or nil if it is not a node.");
L.push("    (fn node-type [n <- Any] -> String? (return n._type))");
L.push("");
L.push("    ;; Every node kind the parser can build, sorted.");
L.push(`    (fn kinds [] -> String[] (return ${vec(kinds.map((k) => k.kind))}))`);
L.push("");
L.push("    ;; Is this the name of a kind the parser can build?");
L.push("    (fn kind-exists [k <- String] -> Boolean");
L.push("        (match k {");
for (const k of kinds) L.push(`            ${JSON.stringify(k.kind)} => (return true)`);
L.push("            _ => (return false)");
L.push("        }))");
L.push("");
L.push("    ;; The declared field names of a kind, in declaration order -- [] for an unknown kind,");
L.push("    ;; never an error.");
L.push("    (fn fields-of [k <- String] -> String[]");
L.push("        (match k {");
for (const k of kinds) L.push(`            ${JSON.stringify(k.kind)} => (return ${vec(k.fields.map((f) => f.name))})`);
L.push("            _ => (return [])");
L.push("        }))");
L.push("");
L.push("    ;; The fields of a kind that hold CHILD NODES -- what a walker follows. [] for unknown.");
L.push("    (fn child-fields-of [k <- String] -> String[]");
L.push("        (match k {");
for (const k of kinds) L.push(`            ${JSON.stringify(k.kind)} => (return ${vec(k.fields.filter((f) => f.child).map((f) => f.name))})`);
L.push("            _ => (return [])");
L.push("        }))");
L.push("");
L.push("    ;; -- one predicate per kind ----------------------------------------------------------");
L.push("");
for (const k of kinds) {
  L.push(`    (fn ${predName(k.kind)} [n <- Any] -> Boolean (return (== n._type ${JSON.stringify(k.kind)})))`);
}
L.push("");
L.push("    (export");
L.push("        node-type kinds kind-exists fields-of child-fields-of");
// Wrap the predicate export list so no line runs long.
let line = "       ";
for (const k of kinds) {
  const nm = " " + predName(k.kind);
  if (line.length + nm.length > 98) { L.push(line); line = "       "; }
  line += nm;
}
L.push(line + ")");
L.push(")");

fs.writeFileSync(OUT, L.join("\n") + "\n");
console.log(`ast:stdlib -> ${path.relative(ROOT, OUT)}  (${kinds.length} kinds, ${L.length} lines)`);
