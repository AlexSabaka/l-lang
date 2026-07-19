// The gap ledger -- the C backend's PRIMARY deliverable.
//
// Every place the C pipeline must dip below the HIR (into raw AST children, `context.nodeTypes`, or
// the symbol table) is evidence that the HIR alone was not enough to compile the construct -- i.e.
// evidence for one of the consumption-spec assumptions A1-A8 (docs/inbox/hir-llvm-consumption-spec.md),
// or for a NEW assumption the spec missed (A9-extern: the std/js host-global boundary).
//
// The discipline that keeps this honest: ResolveHirToCir may not touch `h.src` children, `nodeTypes`,
// or the SymbolTable directly -- only via the dip* helpers on the resolver, each of which requires an
// (assumption, construct, note) and records here before returning. The ledger is therefore structural,
// not best-effort instrumentation.

import type * as ast from "../../frontend/ast";

export type Assumption =
  | "A1" // value nodes typed; Unknown boxed
  | "A2" // atoms modeled (literals, refs)
  | "A3" // dispatch resolved to call kinds with callee identity
  | "A4" // construction in the HIR
  | "A5" // stores/copies explicit
  | "A6" // coercions explicit
  | "A7" // pattern tests as IR facts
  | "A8" // coroutines modeled
  | "A9-extern" // NEW: the std/js host-global boundary (unmodeled by the spec)
  | "new"; // anything that fits none of the above -- a finding in itself

export interface GapEntry {
  assumption: Assumption;
  /** A short construct key: "atom-ref", "atom-literal", "call-free", "decl-structure", ... */
  construct: string;
  note: string;
  file: string;
  line: number;
  col: number;
}

interface Aggregate {
  assumption: Assumption;
  construct: string;
  note: string;
  count: number;
  examples: GapEntry[]; // <= 3
}

export class GapLedger {
  private readonly aggregates = new Map<string, Aggregate>();

  record(assumption: Assumption, construct: string, src: ast.ASTNode | undefined, note: string): void {
    const key = `${assumption}:${construct}`;
    const loc = src?._location;
    const entry: GapEntry = {
      assumption,
      construct,
      note,
      file: loc?.source ?? "<unknown>",
      line: loc?.start?.line ?? 0,
      col: loc?.start?.column ?? 0,
    };
    const agg = this.aggregates.get(key);
    if (agg) {
      agg.count++;
      if (agg.examples.length < 3) agg.examples.push(entry);
    } else {
      this.aggregates.set(key, { assumption, construct, note, count: 1, examples: [entry] });
    }
  }

  get size(): number {
    let n = 0;
    for (const a of this.aggregates.values()) n += a.count;
    return n;
  }

  /** Aggregates sorted by assumption, then count descending -- the shape the capstone report tables use. */
  sorted(): Aggregate[] {
    return [...this.aggregates.values()].sort(
      (a, b) => a.assumption.localeCompare(b.assumption) || b.count - a.count
    );
  }

  toJSON(): string {
    return JSON.stringify(this.sorted(), null, 2);
  }

  toMarkdown(): string {
    const rows = this.sorted().map(
      (a) =>
        `| ${a.assumption} | ${a.construct} | ${a.count} | ${a.note} | ${a.examples
          .map((e) => `${e.file.split("/").pop()}:${e.line}`)
          .join(", ")} |`
    );
    return [
      "| Assumption | Construct | Count | Note | Examples |",
      "|---|---|---|---|---|",
      ...rows,
    ].join("\n");
  }

  /** Merge another ledger (the runner aggregates per-file ledgers into one corpus summary). */
  merge(other: GapLedger): void {
    for (const [key, agg] of other.aggregates) {
      const mine = this.aggregates.get(key);
      if (mine) {
        mine.count += agg.count;
        for (const e of agg.examples) {
          if (mine.examples.length < 3) mine.examples.push(e);
        }
      } else {
        this.aggregates.set(key, { ...agg, examples: [...agg.examples] });
      }
    }
  }
}
