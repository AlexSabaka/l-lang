// Build a self-contained railroad-diagram viewer for the l-lang grammar.
// Inlines chevrotain's vendored railroad-diagrams lib + builder + behavior, plus the
// precomputed serialized GAST, so the page needs zero external resources (Artifact-CSP safe).
//   npm run grammar:diagrams   ->   docs/inbox/l-lang.grammar.html  (open in a browser)
import * as fs from "fs";
import * as path from "path";
import { parser } from "../compiler/frontend/grammar_v2/Parser";

const OUT = path.join(__dirname, "../../docs/inbox/l-lang.grammar.html");
const DIA = path.join(__dirname, "../node_modules/chevrotain/diagrams");

const read = (p: string) => fs.readFileSync(path.join(DIA, p), "utf8");
const safeJs = (s: string) => s.replace(/<\/script>/gi, "<\\/script>");

const railroadJs = safeJs(read("vendor/railroad-diagrams.js"));
const builderJs = safeJs(read("src/diagrams_builder.js"));
const behaviorJs = safeJs(read("src/diagrams_behavior.js"));

const gast = parser.getSerializedGastProductions();
// escape `<` so no stray </script> / <!-- can appear inside the embedded JSON
const grammarJson = JSON.stringify(gast).replace(/</g, "\\u003c");

// meaningful navigation groups (language domains). Any rule not listed falls to "Other".
const GROUPS: { label: string; rules: string[] }[] = [
  { label: "Program & expressions", rules: ["program", "expression", "primaryExpr", "assignmentOrExpr", "assignmentOp", "spreadExpr", "awaitExpr", "quoteExpr"] },
  { label: "Literals", rules: ["nil", "boolean", "number", "string", "formattedString", "formatExpr", "comment"] },
  { label: "Identifiers & access", rules: ["identifier", "simpleIdentifier", "compositeIdentifier", "memberSuffix", "indexerSuffix"] },
  { label: "Collections", rules: ["list", "vector", "matrix", "matrixRow", "map", "keyValue", "key"] },
  { label: "Declarations", rules: ["variable", "functionExpr", "parameter", "modifier", "macroDecl", "modifierDefDecl"] },
  { label: "Types & generics", rules: ["type", "unionType", "intersectionType", "basicType", "simpleType", "typeName", "typeRef", "genericType", "genericParam", "functionType", "mapType", "mapKeyType", "keyTypeDefinition", "tupleType"] },
  { label: "Classes · structs · enums · interfaces", rules: ["classDecl", "classOrInterfaceName", "structDecl", "enumDecl", "enumKey", "interfaceDecl", "typeDefDecl"] },
  { label: "Modules", rules: ["importExpr", "importDefinition", "importSymbols", "symbolAlias", "importSource", "exportExpr", "exportAlias"] },
  { label: "Control flow", rules: ["ifExpr", "whenExpr", "condExpr", "condCase", "forExpr", "forClause", "forEachBinding", "whileExpr", "tryCatchExpr", "catchClause", "catchFilter", "finallyClause", "matchExpr", "matchCase"] },
  { label: "Patterns", rules: ["pattern", "anyPattern", "identifierPattern", "constantPattern", "typePattern", "listPattern", "vectorPattern", "mapPattern", "mapPatternPair", "restPattern", "functionalPattern"] },
];
const groupsJson = JSON.stringify(GROUPS).replace(/</g, "\\u003c");

const ruleCount = gast.length;

const CSS = `
:root{
  --bg:#e8ecf3; --panel:#ffffff; --sheet:#fbfcfe;
  --ink:#14202f; --ink-2:#41506a; --muted:#6f7d92; --line:#d6dde8; --line-2:#e6ebf2;
  --accent:#0c7c9e; --accent-ink:#075063; --accent-soft:#d8eef4;
  --sheet-ink:#16202e; --sheet-muted:#6a7686; --sheet-line:#e4e9f0;
  --term:hsl(189 66% 87%); --nonterm:hsl(224 62% 91%); --stroke:#243449; --usage:#ffd27a;
  --focus:#0c7c9e;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#0b111c; --panel:#121a28; --sheet:#f8fafc;
    --ink:#e7eef8; --ink-2:#b4c1d5; --muted:#7f8da4; --line:#26344a; --line-2:#1b2635;
    --accent:#37b7d8; --accent-ink:#8fdcee; --accent-soft:#123240;
    --focus:#37b7d8;
  }
}
:root[data-theme="light"]{
  --bg:#e8ecf3; --panel:#ffffff; --sheet:#fbfcfe;
  --ink:#14202f; --ink-2:#41506a; --muted:#6f7d92; --line:#d6dde8; --line-2:#e6ebf2;
  --accent:#0c7c9e; --accent-ink:#075063; --accent-soft:#d8eef4; --focus:#0c7c9e;
}
:root[data-theme="dark"]{
  --bg:#0b111c; --panel:#121a28; --sheet:#f8fafc;
  --ink:#e7eef8; --ink-2:#b4c1d5; --muted:#7f8da4; --line:#26344a; --line-2:#1b2635;
  --accent:#37b7d8; --accent-ink:#8fdcee; --accent-soft:#123240; --focus:#37b7d8;
}

*{box-sizing:border-box}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{
  margin:0; background:var(--bg); color:var(--ink);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  font-size:14px; line-height:1.5; -webkit-font-smoothing:antialiased;
}
.mono{font-family:ui-monospace,"SF Mono","JetBrains Mono","Fira Code",Menlo,Consolas,monospace}
a{color:var(--accent)}

.app{display:grid; grid-template-columns:288px minmax(0,1fr); align-items:start}

/* ---- sidebar ---- */
.rail{
  position:sticky; top:0; height:100vh; display:flex; flex-direction:column;
  background:var(--panel); border-right:1px solid var(--line);
}
.rail-top{padding:18px 18px 12px; border-bottom:1px solid var(--line-2); display:flex; flex-direction:column; gap:12px}
.brand{display:flex; flex-direction:column; gap:2px}
.brand .name{font-family:ui-monospace,"SF Mono",Menlo,monospace; font-weight:700; font-size:19px; letter-spacing:-.02em; color:var(--ink)}
.brand .name b{color:var(--accent); font-weight:700}
.brand .kicker{font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--muted)}
.search{position:relative}
.search input{
  width:100%; padding:9px 30px 9px 30px; border:1px solid var(--line); border-radius:8px;
  background:var(--bg); color:var(--ink); font:13px/1 ui-monospace,Menlo,monospace;
}
.search input::placeholder{color:var(--muted)}
.search input:focus{outline:2px solid var(--focus); outline-offset:1px; border-color:transparent}
.search .ico{position:absolute; left:9px; top:50%; transform:translateY(-50%); color:var(--muted); display:flex; pointer-events:none}
.search .ico svg{width:15px; height:15px}
.search kbd{position:absolute; right:8px; top:50%; transform:translateY(-50%); font:11px ui-monospace,monospace; color:var(--muted); border:1px solid var(--line); border-radius:4px; padding:1px 5px; background:var(--panel)}
.count{font-size:12px; color:var(--muted)} .count b{color:var(--ink-2); font-variant-numeric:tabular-nums}

.nav{flex:1; overflow:auto; padding:8px 10px 24px}
.nav .g{font-size:10.5px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); padding:14px 8px 4px}
.nav a{
  display:block; padding:3px 8px; border-radius:6px; text-decoration:none;
  color:var(--ink-2); font:12.5px/1.5 ui-monospace,Menlo,monospace;
}
.nav a:hover{background:var(--line-2); color:var(--ink)}
.nav a.active{background:var(--accent-soft); color:var(--accent-ink); font-weight:600}
.nav a.hide,.nav .g.hide{display:none}

/* ---- main ---- */
.main{padding:0 clamp(16px,3vw,40px) 80px; max-width:1120px}
.hero{padding:34px 2px 10px}
.hero h1{margin:0; font-family:ui-monospace,"SF Mono",Menlo,monospace; font-size:clamp(22px,3vw,30px); line-height:1.08; letter-spacing:-.02em; color:var(--ink); text-wrap:balance}
.hero h1 b{color:var(--accent)}
.hero p{margin:10px 0 0; color:var(--ink-2); max-width:66ch}
.meta{display:flex; flex-wrap:wrap; gap:8px; margin-top:16px}
.chip{display:inline-flex; align-items:center; gap:7px; padding:5px 11px; border:1px solid var(--line); border-radius:999px; background:var(--panel); font-size:12.5px; color:var(--ink-2)}
.chip b{color:var(--ink); font-variant-numeric:tabular-nums}
.chip .sw{width:12px; height:12px; border-radius:3px; border:1.5px solid var(--stroke)}
.sw.term{background:var(--term)} .sw.nonterm{background:var(--nonterm)}

.note{
  margin:20px 2px 8px; padding:13px 15px; border:1px solid var(--line);
  border-left:3px solid var(--accent); border-radius:8px; background:var(--panel);
  color:var(--ink-2); font-size:13px; max-width:80ch;
}
.note b{color:var(--ink)} .note code{font-family:ui-monospace,Menlo,monospace; font-size:12px; color:var(--accent-ink); background:var(--accent-soft); padding:1px 5px; border-radius:4px}

.group-head{
  display:flex; align-items:center; gap:12px; margin:34px 2px 4px;
  font-size:11.5px; font-weight:700; letter-spacing:.13em; text-transform:uppercase; color:var(--muted);
  scroll-margin-top:14px;
}
.group-head::after{content:""; flex:1; height:1px; background:var(--line)}
.group-head.hide{display:none}

/* ---- diagram card ---- */
.rule{
  background:var(--sheet); border:1px solid var(--sheet-line); border-radius:11px;
  padding:12px 16px 6px; margin-top:12px; scroll-margin-top:14px;
  box-shadow:0 1px 2px rgba(20,32,47,.05);
}
.rule[hidden]{display:none}
.rule-head{display:flex; align-items:baseline; gap:9px}
h2.diagramHeader{margin:0; font-family:ui-monospace,"SF Mono",Menlo,monospace; font-weight:600; font-size:15px; letter-spacing:-.01em; color:var(--sheet-ink)}
h2.diagramHeader.diagramHeaderDef{color:var(--accent-ink)}
.rule-link{font:600 13px ui-monospace,monospace; color:var(--accent); text-decoration:none; opacity:0; transition:opacity .12s}
.rule:hover .rule-link,.rule-link:focus{opacity:1}
.svg-wrap{overflow-x:auto; overflow-y:hidden; padding:2px 0 6px}
@keyframes flashring{0%{box-shadow:0 0 0 3px var(--accent)}100%{box-shadow:0 1px 2px rgba(20,32,47,.05)}}
.rule.flash{animation:flashring 1.1s ease-out}
@media (prefers-reduced-motion:reduce){.rule.flash{animation:none; outline:2px solid var(--accent)}}

/* ---- railroad SVG (own styles, on-palette; replaces chevrotain diagrams.css) ---- */
svg.railroad-diagram{width:auto!important; height:auto; max-width:none}
svg.railroad-diagram path{stroke-width:2.5; stroke:var(--stroke); fill:none}
svg.railroad-diagram text{font:bold 14px ui-monospace,"SF Mono",Menlo,monospace; fill:var(--sheet-ink); text-anchor:middle; -webkit-user-select:text; user-select:text}
svg.railroad-diagram text.label{text-anchor:start}
svg.railroad-diagram text.comment{font:italic 12px ui-monospace,Menlo,monospace}
svg.railroad-diagram rect{stroke-width:2; stroke:var(--stroke); fill:var(--term); rx:2; ry:2}
svg.railroad-diagram g.non-terminal rect{fill:var(--nonterm)}
svg.railroad-diagram g.non-terminal text{cursor:pointer}
svg.railroad-diagram g.non-terminal:hover rect{fill:#c7d6f7}
svg.railroad-diagram rect.diagramRectUsage{fill:var(--usage)}

footer{color:var(--muted); font-size:12px; margin:40px 2px 0; padding-top:16px; border-top:1px solid var(--line)}

@media (max-width:920px){
  .app{grid-template-columns:1fr}
  .rail{position:sticky; top:0; height:auto; max-height:60vh; z-index:5}
  .nav{max-height:38vh}
  .main{max-width:none}
}
`;

const BODY = `
<div class="app">
  <aside class="rail">
    <div class="rail-top">
      <div class="brand">
        <span class="name">l&#8209;lang <b>grammar</b></span>
        <span class="kicker">railroad &middot; grammar_v2</span>
      </div>
      <div class="search">
        <span class="ico"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="4.2"></circle><line x1="10.2" y1="10.2" x2="14" y2="14"></line></svg></span>
        <input id="filter" type="text" placeholder="filter rules&hellip;" spellcheck="false" autocomplete="off" aria-label="Filter rules">
        <kbd>/</kbd>
      </div>
      <div class="count" id="count"></div>
    </div>
    <nav class="nav" id="nav" aria-label="Rule index"></nav>
  </aside>

  <main class="main">
    <header class="hero">
      <h1><b>l-lang</b> grammar &mdash; railroad diagrams</h1>
      <p>Every production of the Chevrotain parser (<span class="mono">grammar_v2/Parser.ts</span>),
         rendered straight from its serialized grammar AST. Hover a box to highlight every use of that
         rule; click a blue non&#8209;terminal to jump to its definition.</p>
      <div class="meta">
        <span class="chip"><b>${ruleCount}</b>&nbsp;productions</span>
        <span class="chip"><span class="sw term"></span>terminal</span>
        <span class="chip"><span class="sw nonterm"></span>non&#8209;terminal</span>
        <span class="chip mono">auto&#8209;generated from GAST</span>
      </div>
      <div class="note">
        <b>Reads shape, not the exact accepted language.</b> The parser carries <b>31 semantic
        <code>GATE</code>s</b> (adjacency, <code>LA(1)</code> look&#8209;ahead, <code>isMatrix</code>&hellip;)
        that no context&#8209;free grammar can express &mdash; so these diagrams are deliberately
        <em>over&#8209;permissive</em> at <code>matrix</code>/<code>vector</code>, adjacency chains, and
        <code>compositeIdentifier</code>. Great for talking through constructs; not a validator.
      </div>
    </header>
    <div id="diagrams"></div>
    <footer class="mono">generated from parser.getSerializedGastProductions() &middot; self-contained &middot; no external resources</footer>
  </main>
</div>
`;

const BOOT = `
<script>${railroadJs}</script>
<script>${builderJs}</script>
<script>${behaviorJs}</script>
<script>
(function(){
  var GRAMMAR = JSON.parse("${grammarJson.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}");
  var GROUPS = JSON.parse("${groupsJson.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}");

  // build all diagrams once, then index by rule name
  var html = window.diagrams_builder.buildSyntaxDiagramsText(GRAMMAR);
  var tpl = document.createElement("template"); tpl.innerHTML = html;
  var byName = {}; var kids = Array.prototype.slice.call(tpl.content.childNodes);
  for (var i=0;i<kids.length;i++){
    var n = kids[i];
    if (n.nodeType===1 && n.tagName==="H2" && n.classList.contains("diagramHeader")){
      var name = n.textContent;
      var svg = n.nextElementSibling;
      byName[name] = {h2:n, svg:svg};
    }
  }

  var diagrams = document.getElementById("diagrams");
  var nav = document.getElementById("nav");
  var placed = {};

  function card(name){
    var pair = byName[name]; if(!pair) return null;
    var sec = document.createElement("section");
    sec.className="rule"; sec.id="r-"+name; sec.setAttribute("data-name", name.toLowerCase());
    var head = document.createElement("div"); head.className="rule-head";
    head.appendChild(pair.h2);
    var link = document.createElement("a"); link.className="rule-link"; link.href="#r-"+name;
    link.textContent="#"; link.setAttribute("aria-label","Permalink to "+name);
    head.appendChild(link);
    var wrap = document.createElement("div"); wrap.className="svg-wrap";
    if(pair.svg) wrap.appendChild(pair.svg);
    sec.appendChild(head); sec.appendChild(wrap);
    placed[name]=true;
    return sec;
  }
  function navLink(name){
    var a=document.createElement("a"); a.href="#r-"+name; a.textContent=name;
    a.setAttribute("data-name", name.toLowerCase()); a.id="n-"+name; return a;
  }
  function groupHead(label){
    var h=document.createElement("div"); h.className="group-head"; h.textContent=label; return h;
  }

  function renderGroup(label, names){
    var real = names.filter(function(n){return byName[n] && !placed[n];});
    if(!real.length) return;
    diagrams.appendChild(groupHead(label));
    var gh=document.createElement("div"); gh.className="g"; gh.textContent=label; nav.appendChild(gh);
    real.forEach(function(n){
      var c=card(n); if(c) diagrams.appendChild(c);
      nav.appendChild(navLink(n));
    });
  }

  GROUPS.forEach(function(g){ renderGroup(g.label, g.rules); });
  // safety net: any rule not in a group
  var leftover = Object.keys(byName).filter(function(n){return !placed[n];});
  if(leftover.length) renderGroup("Other", leftover);

  // hover cross-highlight ON, built-in click-scroll OFF (we do our own, container-agnostic)
  window.diagrams_behavior.initDiagramsBehavior(false);

  // our own jump-to-definition on non-terminal click
  function flash(el){ el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); }
  Array.prototype.forEach.call(document.querySelectorAll("#diagrams svg .non-terminal text"), function(t){
    t.style.cursor="pointer";
    t.addEventListener("click", function(){
      var name = t.getAttribute("rulename") || t.textContent;
      var target = document.getElementById("r-"+name);
      if(target){ target.scrollIntoView({behavior:"smooth", block:"start"}); flash(target); }
    });
  });

  // filter
  var input=document.getElementById("filter"), count=document.getElementById("count");
  var rules=Array.prototype.slice.call(document.querySelectorAll(".rule"));
  var groupHeads=Array.prototype.slice.call(document.querySelectorAll(".group-head"));
  var navGroups=Array.prototype.slice.call(document.querySelectorAll(".nav .g"));
  var navLinks=Array.prototype.slice.call(document.querySelectorAll(".nav a"));
  var total=rules.length;
  function setCount(n){ count.innerHTML = "<b>"+n+"</b> of <b>"+total+"</b> rules"; }
  function apply(){
    var q=input.value.trim().toLowerCase(); var shown=0;
    rules.forEach(function(r){ var m=r.getAttribute("data-name").indexOf(q)>=0; r.hidden=!m; if(m)shown++; });
    navLinks.forEach(function(a){ var m=a.getAttribute("data-name").indexOf(q)>=0; a.classList.toggle("hide",!m); });
    // hide empty group separators (main + nav)
    groupHeads.forEach(function(h){
      var el=h.nextElementSibling, any=false;
      while(el && !el.classList.contains("group-head")){ if(el.classList.contains("rule") && !el.hidden){any=true;break;} el=el.nextElementSibling; }
      h.classList.toggle("hide",!any);
    });
    navGroups.forEach(function(g){
      var el=g.nextElementSibling, any=false;
      while(el && !el.classList.contains("g")){ if(el.tagName==="A" && !el.classList.contains("hide")){any=true;break;} el=el.nextElementSibling; }
      g.classList.toggle("hide",!any);
    });
    setCount(shown);
  }
  input.addEventListener("input", apply);
  setCount(total);

  // keyboard: "/" focuses search, Esc clears
  document.addEventListener("keydown", function(e){
    if(e.key==="/" && document.activeElement!==input){ e.preventDefault(); input.focus(); input.select(); }
    else if(e.key==="Escape" && document.activeElement===input){ input.value=""; apply(); input.blur(); }
  });

  // scrollspy: mark active nav link
  var linkFor={}; navLinks.forEach(function(a){ linkFor[a.id]=a; });
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if(en.isIntersecting){
        var a=document.getElementById("n-"+en.target.id.slice(2));
        if(a){ navLinks.forEach(function(x){x.classList.remove("active");}); a.classList.add("active");
          a.scrollIntoView({block:"nearest"}); }
      }
    });
  }, {rootMargin:"-38% 0px -56% 0px"});
  rules.forEach(function(r){ io.observe(r); });
})();
</script>
`;

const OUTPUT = `<style>${CSS}</style>\n${BODY}\n${BOOT}\n`;
fs.writeFileSync(OUT, OUTPUT, "utf8");
console.log("wrote", OUT, "(" + OUTPUT.length + " bytes, " + ruleCount + " rules)");
