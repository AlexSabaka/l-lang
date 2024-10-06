import { question } from "readline-sync";
import { readFileSync, writeFileSync } from "node:fs";

import evaljs from "./evaljs";
import { JSCompilerAstVisitorGptVer } from "../compiler/visitors";
import { CompilationContext, LogLevel } from "../compiler/CompilationContext";
import { encodeIdentifier } from "../compiler/utils";
import { deepeq } from "./deepeq";


const basicOperators = {
  [encodeIdentifier('==')]: deepeq,
  [encodeIdentifier('!=')]: (a: any, b: any): boolean => !deepeq(a, b),

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
};

const stdlib = {
  std: {
    console: {
      log: console.log,
      read: () => question(">> "),
    },
    io: {
      "read-text": (file: string): string => readFileSync(file, { encoding: "utf-8" }),
      "write-text": (file: string, data: string): void => writeFileSync(file, data, { encoding: "utf-8" }),
    },
    math: Math,
    float: Number,
    string: String,
  },
};

const helpers = {
  call: (f: Function, a: any[]): any => f.call(globalScope, a),
  eval: (q: any): any => {
    const quoteAst = { ...q, _type: "list" };
    const compiler = new JSCompilerAstVisitorGptVer(new CompilationContext("eval", { logger: { level: LogLevel.Error } }));
    const js = compiler.compile(quoteAst);
    return evaljs(js, globalScope);
  },
  _throw: (a: any) => {
    throw a;
  },
};


export const evalInScope = evaljs;

export const globalScope = {
  ...listFunctions,
  ...basicOperators,
  ...stdlib,
  ...helpers,
};
