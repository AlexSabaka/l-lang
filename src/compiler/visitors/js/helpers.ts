import * as ast from "../../ast";
import { Context, LogLevel } from "../../Context";
import { ScopeType } from "../../SymbolTable";
import { SourceNode } from "source-map";

export function joinArray(array: any[], value: any): any[] {
  return array.flatMap((x) => [x, value]).slice(0, -1);
}

export function createSourceNode(
  node: ast.ASTNode,
  ...chunks: (string | SourceNode)[]
): SourceNode {
  return new SourceNode(
    node._location.start.line,
    node._location.start.column - 1,
    node._location.source!,
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
