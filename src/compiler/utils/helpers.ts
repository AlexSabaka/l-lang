import * as ast from "../frontend/ast";

import { globalScope } from "../lib/std";

import { Context, LogLevel } from "../Context";
import { ScopeType } from "../analysis/SymbolTable";
import { SourceNode } from "source-map";

export function isStandardLibReference(id: string): boolean {
  const parts = id.split('.');
  let obj = globalScope as any;
  for (let p of parts) {
    if (p in obj) {
      obj = obj[p];
    } else {
      return false;
    }
  }
  return !!obj;
}

export function getStandardLibReferenceSource(id: string): string {
  const parts = id.split('.');
  let obj = globalScope as any;
  for (let p of parts) {
    if (p in obj) {
      obj = obj[p];
    } else {
      return "";
    }
  }
  return obj.toString();
}

export function joinArray(array: any[], value: any): any[] {
  return array.flatMap((x) => [x, value]).slice(0, -1);
}

export function createSourceNode(
  node: ast.ASTNode,
  ...chunks: (string | SourceNode)[]
): SourceNode {
  const line = node && node._location && node._location.start ? node._location.start.line : 1;
  const column = node && node._location && node._location.start ? node._location.start.column - 1 : 0;
  const source = node && node._location && node._location.source ? node._location.source : null;
  return new SourceNode(
    line,
    column,
    source,
    chunks.filter((x) => !!x)
  );
}

export function formatVariable(
  scope: ScopeType,
  node: ast.ASTNode,
  mut: boolean,
  name: SourceNode | string,
  value: SourceNode | undefined,
  context: Context
) {
  const kw = createSourceNode(node, mut ? "let " : "const ");
  const va = !!value ? [` = `, value] : [];
  const format = {
    [ScopeType.program]: () => createSourceNode(node, kw, name, ...va),
    [ScopeType.function]: () => createSourceNode(node, kw, name, ...va),
    [ScopeType.method]: () => createSourceNode(node, kw, name, ...va),
    [ScopeType.match]: () => createSourceNode(node, name, ...va),
    [ScopeType.when]: () => createSourceNode(node, name, ...va),
    [ScopeType.if]: () => createSourceNode(node, kw, name, ...va),
    [ScopeType.class]: () => createSourceNode(node, name, ...va),
    [ScopeType.interface]: () => createSourceNode(node, kw, name, ...va),
    [ScopeType.variable]: () => createSourceNode(node, name, ...va),
  };

  if (!format[scope]) {
    throw new Error(`${scope} is not defined for variable formatting`);
  }

  context.log(
    LogLevel.Debug,
    `Formatting variable ${name} in the scope of ${scope}`
  );

  return format[scope]();
}

export function formatFunction(
  scope: ScopeType,
  node: ast.ASTNode,
  async: boolean,
  name: SourceNode | string,
  params: (SourceNode | string)[],
  body: (SourceNode | string)[],
  context: Context
) {
  const kw = async ? [createSourceNode(node, "async ")] : [];
  const arrowFuncName = !!name ? [`const `, name, ` = `] : [];

  const format = {
    [ScopeType.program]: () =>
      createSourceNode(node, ...kw, `function `, ...(!!name ? [name] : []), "(", ...joinArray(params, ","), ") {", ...body, `}`),
    [ScopeType.function]: () =>
      createSourceNode(node, ...arrowFuncName, ` `, ...kw, ` (`, ...joinArray(params, ","), ") => {", ...body, `}`),
    [ScopeType.method]: () =>
      createSourceNode(node, ...arrowFuncName, ` `, ...kw, " (", ...joinArray(params, ","), ") => {", ...body, `}`),
    [ScopeType.match]: () =>
      createSourceNode(node, `(`, name, ` = `, ...kw, ` (`, ...joinArray(params, ","), ") => {", ...body, `})`),
    [ScopeType.when]: () =>
      createSourceNode(node, `(`, name, ` = `, ...kw, ` (`, ...joinArray(params, ","), ") => {", ...body, "})"),
    [ScopeType.if]: () =>
      createSourceNode(node, `(`, name, ` = `, ...kw, ` (`, ...joinArray(params, ","), `) => {`, ...body, `})`),
    [ScopeType.class]: () =>
      createSourceNode(node, ...kw, name, "(", ...joinArray(params, ","), ") {", ...body, "}"),
    [ScopeType.interface]: () =>
      createSourceNode(node, ...kw, name, "(", ...joinArray(params, ","), ");"),
    [ScopeType.variable]: () =>
      createSourceNode(node, `(`, ...kw, " (", ...joinArray(params, ","), ") => {", ...body, `})`),
  };

  if (!format[scope]) {
    throw new Error(`${scope} is not defined for function formatting`);
  }

  context.log(
    LogLevel.Debug,
    `Formatting function ${name} in the scope of ${scope}`
  );

  return format[scope]();
}
