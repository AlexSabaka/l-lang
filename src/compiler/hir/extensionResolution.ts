// A3 ext-call: the channel-based `:extension` resolution subsystem.
//
// The SAME logic JSTransformer's extensionFor / memberKindOn / receiverConformsTo use, re-expressed
// against a bare Context so the lowering's `classifyCall` can resolve extension dispatch identically
// -- reading only the symbol table + types, never emitter state. The EMITTED extension name
// (import-inlining, encoding) stays a per-backend concern; this returns the SOURCE fnName.
//
// (Copied from the emitter and proven equal by cross-check; the emitter single-sourcing onto this is a
// follow-up cleanup.)

import * as ast from "../frontend/ast";
import { nativeMemberKind } from "../types/nativeMembers";

export interface ExtResCtx {
  symbolTable?: any;
}

/** A type node's runtime name, or undefined for the un-nameable (union / tuple / …). Pure. */
export function getTypeName(t: any): string | undefined {
  if (!t) return undefined;
  if (t.array === true) return "Array";
  if (t._type === "type") return t.type ? getTypeName(t.type) : undefined;
  if (t._type === "simple-type") return t.name ? getTypeName(t.name) : undefined;
  if (t._type === "type-name") return typeof t.name === "string" ? t.name : undefined;
  if (t._type === "generic-type") return t.name ? getTypeName(t.name) : undefined;
  if (t._type === "function-type") return "Function";
  if (typeof t.name === "string") return t.name;
  if (t.type && typeof t.type.name === "string") return t.type.name;
  return undefined;
}

/** Follow a type-ref (and a bare class name) to the full type carrying members/methods. */
export function unwrapReceiverType(ctx: ExtResCtx, typeInfo: any): any {
  if (typeInfo?.kind === "type-ref" && typeInfo.refName) {
    const typeSymbol = ctx.symbolTable?.resolveSymbol(typeInfo.refName);
    if (typeSymbol?.inferredType) typeInfo = typeSymbol.inferredType;
  }
  if (typeInfo?.name && (typeInfo.kind === "class" || typeInfo.kind === "struct" || typeInfo.kind === "unknown")) {
    const classSymbol = ctx.symbolTable?.resolveSymbol(typeInfo.name);
    if (classSymbol?.inferredType) typeInfo = classSymbol.inferredType;
  }
  return typeInfo;
}

/** Nominal conformance: the type IS `typeName`, `:implements` it (transitively), or an ancestor does. */
export function receiverConformsTo(ctx: ExtResCtx, typeInfo: any, typeName: string): boolean {
  const seen = new Set<string>();
  const visit = (t: any): boolean => {
    if (!t) return false;
    const name: string | undefined = typeof t.name === "string" ? t.name : undefined;
    if (name) {
      if (seen.has(name)) return false;
      seen.add(name);
    }
    if (t.name === typeName) return true;
    const declared = name ? ctx.symbolTable?.resolveSymbol(name)?.inferredType : undefined;
    const supersFrom = declared ? unwrapReceiverType(ctx, declared) : t;
    for (const i of supersFrom.implementedInterfaces ?? []) {
      if (i.interfaceName === typeName) return true;
      const sup = ctx.symbolTable?.resolveSymbol(i.interfaceName)?.inferredType;
      if (sup && visit(unwrapReceiverType(ctx, sup))) return true;
    }
    const parent =
      supersFrom.parentClass ??
      supersFrom.codegenMetadata?.parentClass ??
      t.parentClass ??
      t.codegenMetadata?.parentClass;
    if (parent) {
      const parentSym = ctx.symbolTable?.resolveSymbol(parent);
      if (parentSym?.inferredType && visit(unwrapReceiverType(ctx, parentSym.inferredType))) return true;
    }
    return false;
  };
  return visit(typeInfo);
}

/** Is `memberName` a method or field DIRECTLY on this type (no inheritance)? */
export function memberKindIn(typeInfo: any, memberName: string): "method" | "field" | undefined {
  if (typeInfo.methodSignatures?.has(memberName)) return "method";
  if (typeInfo.codegenMetadata?.methodSignatures?.has(memberName)) return "method";
  const member =
    typeInfo.members?.find((m: any) => m.name === memberName) ??
    typeInfo.detailedMembers?.find((m: any) => m.name === memberName);
  if (member) return member.type?.kind === "function" ? "method" : "field";
  const native = nativeMemberKind(typeInfo, memberName);
  if (native) return native;
  return undefined;
}

/** The class or struct that lexically encloses `node`, by name. Pure AST walk. */
export function enclosingTypeName(node?: ast.ASTNode): string | undefined {
  for (let n = node?._parent; n; n = n._parent) {
    if (n._type === "class" || n._type === "struct") {
      const name = (n as any).name;
      return typeof name === "string" ? name : name?.id ?? name?.name;
    }
  }
  return undefined;
}

/** The receiver's type, following type-refs and class names to the definition. */
export function receiverType(ctx: ExtResCtx, objectName: string, from?: ast.ASTNode): any | undefined {
  try {
    if (objectName === "this") {
      const owner = enclosingTypeName(from);
      if (!owner) return undefined;
      const ownerSymbol = ctx.symbolTable?.resolveSymbol(owner);
      return ownerSymbol?.inferredType;
    }
    const symbol = from
      ? ctx.symbolTable?.resolveSymbol(objectName, from)
      : ctx.symbolTable?.resolveSymbol(objectName);
    if (!symbol?.inferredType) return undefined;
    return unwrapReceiverType(ctx, symbol.inferredType);
  } catch {
    return undefined;
  }
}

/** `memberName` as method/field on `objectName`'s type, walking inheritance. undefined = not native. */
export function memberKindOn(ctx: ExtResCtx, objectName: string, memberName: string, from?: ast.ASTNode): "method" | "field" | undefined {
  let typeInfo = receiverType(ctx, objectName, from);
  const seen = new Set<any>();
  while (typeInfo && !seen.has(typeInfo)) {
    seen.add(typeInfo);
    const kind = memberKindIn(typeInfo, memberName);
    if (kind) return kind;
    const parent = typeInfo.parentClass ?? typeInfo.codegenMetadata?.parentClass;
    if (!parent) break;
    const parentSym = ctx.symbolTable?.resolveSymbol(parent);
    typeInfo = parentSym?.inferredType ? unwrapReceiverType(ctx, parentSym.inferredType) : undefined;
  }
  return undefined;
}

export interface ExtCandidate {
  fnName: string;
  receiverType: string;
}

/** The extension registry (name -> candidates) from the symbol-table forest. */
export function buildExtensionTable(ctx: ExtResCtx): Map<string, ExtCandidate[]> {
  const table = new Map<string, ExtCandidate[]>();
  const symbols = ctx.symbolTable?.getAllSymbols?.();
  if (symbols) {
    for (const [name, entry] of symbols) {
      if (entry.nodeType !== "function" || !entry.modifiers?.has("extension")) continue;
      const receiver = (entry.value as ast.FunctionNode)?.params?.[0]?.type;
      if (!receiver) continue;
      const rt = getTypeName(receiver);
      if (rt === undefined) continue;
      const list = table.get(name) ?? [];
      list.push({ fnName: name, receiverType: rt });
      table.set(name, list);
    }
  }
  return table;
}

/**
 * The SOURCE fnName of the `:extension` that conforms to `typeInfo` for `memberName`, or undefined.
 * (The EMITTED name -- import-inlining -- is a per-backend concern the caller applies.)
 */
export function conformingExtensionFn(ctx: ExtResCtx, table: Map<string, ExtCandidate[]>, typeInfo: any, memberName: string): string | undefined {
  const candidates = table.get(memberName);
  if (!candidates?.length) return undefined;
  const t = unwrapReceiverType(ctx, typeInfo);
  for (const c of candidates) {
    if (receiverConformsTo(ctx, t, c.receiverType)) return c.fnName;
  }
  return undefined;
}
