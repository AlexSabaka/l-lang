/**
 * The l-lang display formatter, JS side -- FLOOR.md 3.5 (D55).
 *
 * Emitted verbatim into every module's runtime prelude. It replaces node's util.inspect, which was
 * never a decision: it made l-lang print JavaScript's notation for l-lang's values -- "[ 1, 2, 3 ]"
 * for a vector you wrote [1 2 3], and "null" for a bottom value the spec says is spelled nil.
 *
 * String.raw on purpose. The body below is JavaScript SOURCE, so a two-character backslash-n has to
 * reach the output as two characters. Inside an ordinary template literal every escape would need
 * doubling and the file would be unreadable; with String.raw it passes through exactly as written.
 * The two sequences that would still break out are a backtick and a dollar-brace, so the body uses
 * neither -- including in its comments, which is how the first draft of this file broke.
 *
 * Kept in step with runtime.c's ll_inspect_sb by conformance guards, not by inspection -- the two are
 * separate implementations of one written rule, which is the whole point of D55.
 */
export const LL_INSPECT_JS: string = String.raw`
/* -- l-lang display (FLOOR.md 3.5) ------------------------------------------------------------- */
var __LL_WIDTH = 80;
function __ll_ident_like(k) { return /^[A-Za-z_][A-Za-z0-9_\-]*$/.test(k); }
function __ll_esc(s) {
  var out = "";
  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    if (ch === "\\") out += "\\\\";
    else if (ch === "\"") out += "\\\"";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\r") out += "\\r";
    else out += ch;
  }
  return out;
}
/* Shortest round-trip, and the one thing String() gets wrong for us: negative zero. A BigInt prints
   as digits with no trailing n (D51 amendment (a)) -- automatic, because this formatter is ours. */
function __ll_num(n) {
  if (typeof n === "bigint") return n.toString();
  if (Object.is(n, -0)) return "-0";
  return String(n);
}
function __ll_class_tag(v) {
  var proto = Object.getPrototypeOf(v);
  if (proto === Object.prototype || proto === null) return "";
  return v.__ll_name || (v.constructor && v.constructor.name) || "";
}
/* flat forces the one-line form: the layout rule renders a container flat FIRST to measure it, then
   decides. prefixLen is the ":key " that shares the line, which counts toward the budget. */
function __ll_inspect(v, indent, prefixLen, seen, flat) {
  if (v === null || v === undefined) return "nil";
  var t = typeof v;
  if (t === "boolean") return v ? "true" : "false";
  if (t === "number" || t === "bigint") return __ll_num(v);
  if (t === "string") return "\"" + __ll_esc(v) + "\"";
  if (t === "function") return v.name ? "#<fn " + v.name + ">" : "#<fn>";
  if (t !== "object") return String(v);
  if (seen.indexOf(v) !== -1) return "#<circular>";
  seen.push(v);
  try {
    var isArr = Array.isArray(v);
    var tag = isArr ? "" : __ll_class_tag(v);
    var open = isArr ? "[" : "{";
    var close = isArr ? "]" : "}";
    var keys = isArr ? null : Object.keys(v).filter(function (k) { return k !== "__ll_name"; });
    if ((isArr ? v.length : keys.length) === 0) return tag + open + close;
    var heads = [];
    var vals = [];
    if (isArr) {
      for (var i = 0; i < v.length; i++) { heads.push(""); vals.push(v[i]); }
    } else {
      for (var j = 0; j < keys.length; j++) {
        var k = keys[j];
        heads.push((__ll_ident_like(k) ? ":" + k : "\"" + __ll_esc(k) + "\"") + " ");
        vals.push(v[k]);
      }
    }
    var flatParts = [];
    for (var a = 0; a < vals.length; a++) {
      flatParts.push(heads[a] + __ll_inspect(vals[a], 0, 0, seen, true));
    }
    var oneLine = tag + open + flatParts.join(" ") + close;
    if (flat || indent + prefixLen + oneLine.length <= __LL_WIDTH) return oneLine;
    /* Broken: the newline IS the separator -- there is no comma to place. */
    var pad = "";
    for (var p = 0; p < indent + 2; p++) pad += " ";
    var outerPad = "";
    for (var q = 0; q < indent; q++) outerPad += " ";
    var lines = [];
    for (var b = 0; b < vals.length; b++) {
      lines.push(pad + heads[b] + __ll_inspect(vals[b], indent + 2, heads[b].length, seen, false));
    }
    return tag + open + "\n" + lines.join("\n") + "\n" + outerPad + close;
  } finally {
    seen.pop();
  }
}
/* A String at the TOP level prints bare -- that is what keeps (print "Hello, {0}!" "World") from
   putting quotes around World. Nested, it is quoted like any other datum. */
function __ll_display(v) {
  return typeof v === "string" ? v : __ll_inspect(v, 0, 0, [], false);
}
function __ll_format_object(obj) { return __ll_display(obj); }
/* Shadows the host console for all emitted code, so console.log renders through OUR formatter rather
   than node's. Same join and same top-level-bare rule as runtime.c's ll_console_write. The real one
   is reached through globalThis: "var console" hoists, so the bare identifier is already shadowed
   (and undefined) by the time this line runs. */
var __ll_host_console = globalThis.console;
var console = {
  log: function () {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(__ll_display(arguments[i]));
    __ll_host_console.log(parts.join(" "));
  },
  error: function () {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(__ll_display(arguments[i]));
    __ll_host_console.error(parts.join(" "));
  }
};
`;
