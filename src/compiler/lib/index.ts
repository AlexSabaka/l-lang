import { question } from "readline-sync";
import { formatWithOptions } from "node:util"
import { readFileSync, writeFileSync } from "node:fs";

import evaljs from "./evaljs";
import { JSCompilerAstVisitor } from "../visitors";
import { Context, LogLevel } from "../Context";
import { encodeIdentifier } from "../utils";
import { deepeq } from "./deepeq";


const basicOperators = {
  [encodeIdentifier('==')]: deepeq,
  [encodeIdentifier('!=')]: (a: any, b: any): boolean => !deepeq(a, b),
  [encodeIdentifier('≠')] : (a: any, b: any): boolean => !deepeq(a, b),

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
  [encodeIdentifier('set!')]: (a: any, i: number | string, v: any) => a[i] = v,
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
    const compiler = new JSCompilerAstVisitor(new Context("eval", { minimumLogLevel: LogLevel.Error }));
    const js = compiler.compile(quoteAst);
    return evaljs(js.code, globalScope);
  },
  throw: (a: any) => {
    throw a;
  },
  formatObjectToString: (a: any) => {
    return formatWithOptions({ depth: null, colors: false }, a);
  },
};


export const evalInScope = evaljs;

export const globalScope = {
  ...listFunctions,
  ...basicOperators,
  ...stdlib,
  ...helpers,
};
