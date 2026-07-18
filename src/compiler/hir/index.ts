// The HIR subsystem: a typed, post-typecheck IR between the typed AST and ESTree, and its
// destination-driven lowering. See hir-brief.md (R1-R6) and nodes.ts for the design.

export * from "./nodes";
export * from "./HirModule";
export * from "./TempAllocator";
export * from "./LowerAstToHirVisitor";
export * from "./EmitHirToEstree";
