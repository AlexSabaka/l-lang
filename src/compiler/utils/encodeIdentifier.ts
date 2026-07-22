const JS_RESERVED = [
  "abstract",
  "arguments",
  "await",
  "boolean",
  "break",
  "byte",
  "case",
  "catch",
  // "char",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "double",
  "else",
  "enum",
  // "eval",
  "export",
  "extends",
  // "false",
  "final",
  "finally",
  // "float",
  // "for",
  "function",
  "goto",
  // "if",
  "implements",
  // "import",
  "in",
  "instanceof",
  "int",
  "interface",
  // "let",
  "long",
  "native",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  // "return",
  "short",
  "static",
  "super",
  "switch",
  "synchronized",
  // "this",
  // "throw",
  // "throws",
  // "transient",
  // "true",
  // "try",
  "typeof",
  "var",
  "void",
  "volatile",
  // "while",
  "with",
  "yield",
];

export function encodeIdentifier(id: string) {
  const r = /[^._a-zA-Z0-9]/gim;
  id = id.replace(r, (s) => s.charCodeAt(0).toString(16));
  if (JS_RESERVED.includes(id) || id.match(/^\d/)) {
    id = "_" + id;
  }
  return id;
}

/**
 * The same encoding for a MEMBER NAME -- a property key, not a binding.
 *
 * `encodeIdentifier` does two separable things, and only one of them belongs on a member. The hex
 * escape is REQUIRED either way: D21 makes kebab-case idiomatic, a field is DEFINED under the encoded
 * name, and a read has to spell it the same way. The RESERVED-WORD PREFIX is wrong here, because a
 * property key is not a binding -- `obj.class`, `obj.default` and `obj.new` have been legal
 * JavaScript since ES5, when reserved words were allowed as member names and in object literals.
 *
 * Applying it anyway made the two halves of a map DISAGREE WITH THEMSELVES, in opposite directions:
 *
 *   {:class "warrior"}   emits the key RAW ("class"), so `hero.class` -> `hero._class` -> nil
 *   (mut :ctor class)    emits the field ENCODED (_class), so `h["class"]` -> D9 KeyError
 *
 * Both silent-ish and both wrong, and the dotted read cannot be compiled two ways because the backend
 * often cannot tell a map receiver from a class instance statically. It surfaced through reflection:
 * `extends` is a reserved word and is also the edge D54's metadata graph uses to name a parent type,
 * so the graph was unwalkable through the D9 TOTAL accessor on JS.
 *
 * The leading-digit prefix STAYS: `obj.0` is a syntax error, not a legal member name, so that half is
 * doing real work in this position too.
 */
export function encodeMemberName(id: string) {
  const r = /[^._a-zA-Z0-9]/gim;
  id = id.replace(r, (s) => s.charCodeAt(0).toString(16));
  return id.match(/^\d/) ? "_" + id : id;
}

/**
 * Re-key an already-built member identifier as a MEMBER, given the source name node it came from.
 *
 * The member-DEFINITION sites (a class field, a method, a `this.<field>` store) all materialize their
 * key by visiting the name node, which runs `encodeIdentifier`. They must agree with the READ side or
 * the member is written under one name and looked up under another -- which is the half of this bug
 * that made `h["class"]` throw a D9 KeyError on a field the class demonstrably has.
 *
 * Typed loosely (`unknown`/`any`) on purpose: this lives in utils, which the ESTree-shaped emitters
 * import, not the other way round.
 *
 * The equality guard matters. A key can be legitimately RENAMED downstream after it is built --
 * arity overloads become `m_2` -- and re-deriving from the source name would silently undo that. So
 * this only rewrites a key that is still exactly what `encodeIdentifier` produced.
 */
export function asMemberKey<T>(nameNode: unknown, built: T): T {
  const raw = (nameNode as { id?: unknown; name?: unknown } | undefined)?.id
    ?? (nameNode as { id?: unknown; name?: unknown } | undefined)?.name;
  const node = built as unknown as { type?: string; name?: string };
  if (typeof raw !== "string" || node?.type !== "Identifier") return built;
  if (node.name !== encodeIdentifier(raw)) return built;
  const member = encodeMemberName(raw);
  return member === node.name ? built : ({ ...node, name: member } as unknown as T);
}
