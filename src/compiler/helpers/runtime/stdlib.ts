import { question } from "readline-sync";
import { formatWithOptions } from "node:util"
import { readFileSync, writeFileSync } from "node:fs";

import evaljs from "./evaljs";
import { JSTransformerAstVisitor } from "../../codegen/visitors/JSTransformerAstVisitor";
import { Context, LogLevel } from "../../Context";
import { encodeIdentifier } from "../utils/encodeIdentifier";
import { deepStrictEqual, notDeepStrictEqual } from "./deepeq";
import * as astring from "astring";

const basicOperators = {
  [encodeIdentifier('==')]: (a: any, b: any): boolean => deepStrictEqual(a, b),
  [encodeIdentifier('!=')]: (a: any, b: any): boolean => notDeepStrictEqual(a, b),
  [encodeIdentifier('≠')] : (a: any, b: any): boolean => notDeepStrictEqual(a, b),

  [encodeIdentifier('+')]: (...a: number[]) => a.reduce((res, b) => res + b),
  [encodeIdentifier('-')]: (...a: number[]) => a.reduce((res, b) => res - b),
  [encodeIdentifier('*')]: (...a: number[]) => a.reduce((res, b) => res * b),
  [encodeIdentifier('/')]: (...a: number[]) => a.reduce((res, b) => res / b),

  [encodeIdentifier('||')]: (...a: boolean[]) => a.reduce((res, b) => res || b),
  [encodeIdentifier('&&')]: (...a: boolean[]) => a.reduce((res, b) => res && b),

  [encodeIdentifier('<')]: (a: number, b: number) => a < b,
  [encodeIdentifier('>')]: (a: number, b: number) => a > b,
  [encodeIdentifier('<=')]: (a: number, b: number) => a <= b,
  [encodeIdentifier('>=')]: (a: number, b: number) => a >= b,
};

const listFunctions = {
  empty: (a: any) => a === undefined || Array.isArray(a) && a.length === 0,
  head: (a: any) => Array.isArray(a) && a.length > 0 ? a[0] : a,
  tail: (a: any) => Array.isArray(a) && a.length > 0 ? a.slice(1) : a,
  elem: (a: any, i: number | string) => a[i],
  cons: (...args: any[]) => args.reduce((res, a) => Array.isArray(a) ? [...res, ...a] : [...res, a], []),

  [encodeIdentifier('set!')]: (array: any[], index: number, value: any): any => {
    array[index] = value;
    return value;
  },
};

const mapFunctions = {
  "get": (map: any, key: string) => map[key],
  "set": (map: any, key: string, value: any) => { map[key] = value; return value; },
};

const stdlib = {
  std: {
    console: console as any,
    process: process as any,
    io: {
       "read-text": (file: string): string => readFileSync(file, { encoding: "utf-8" }),
      "write-text": (file: string, data: string): void => writeFileSync(file, data, { encoding: "utf-8" }),
    },
    math: Math,
    float: Number,
    string: String,
  },
};

stdlib.std.console.print = (...a: string[]) => process.stdout.write(a.join(""));
stdlib.std.console.println = (...a: string[]) => process.stdout.write(a.join("") + "\n");
stdlib.std.console.read = (q: string | undefined) => question(q ?? ">> ");
stdlib.std.console.readln = stdlib.std.console.read;

const helpers = {
  call: (f: Function, a: any[]): any => f.call(globalScope, a),
  eval: (q: any): any => {
    const quoteAst = { ...q, _type: "list" };
    const context = new Context("eval", { minimumLogLevel: LogLevel.Error, includeRuntimeShim: false });
    const transformer = new JSTransformerAstVisitor(context);
    const code = transformer.compile(quoteAst);
    return evaljs(code.code, globalScope);
  },
  throw: (a: any) => {
    throw a;
  },
  __ll_format_object: (a: any) => {
    return formatWithOptions({ depth: null, colors: false }, a ?? "");
  },
};

export const evalInScope = evaljs;

export const globalScope = {
  ...listFunctions,
  ...mapFunctions,
  ...basicOperators,
  ...stdlib,
  ...helpers,
};
