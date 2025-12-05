import { deepStrictEqual as strictEqual, notDeepStrictEqual as notStrictEqual } from 'node:assert';

export function deepStrictEqual(a: any, b: any): boolean {
  try
  {
    strictEqual(a, b);
    return true;
  }
  catch
  {
    return false;
  }
}

export function notDeepStrictEqual(a: any, b: any): boolean {
  try
  {
    notStrictEqual(a, b);
    return true;
  }
  catch
  {
    return false;
  }
}
