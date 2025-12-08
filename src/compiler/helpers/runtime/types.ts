/**
 * Runtime helpers for type checking
 * These functions are prepended to compiled JavaScript output
 */

/**
 * _ll_is_type - Runtime type check
 * @param val - Value to check
 * @param type - Type string to check against
 * @returns true if value is of the given type
 */
export function _ll_is_type(val: any, type: string): boolean {
  switch (type) {
    case 'number':
      return typeof val === 'number';
    case 'string':
      return typeof val === 'string';
    case 'boolean':
      return typeof val === 'boolean';
    case 'function':
      return typeof val === 'function';
    case 'array':
      return Array.isArray(val);
    case 'object':
      return typeof val === 'object' && val !== null && !Array.isArray(val);
    case 'null':
      return val === null;
    case 'undefined':
      return val === undefined;
    case 'any':
      return true;
    default:
      // For custom classes/types, check instanceof
      try {
        return val instanceof (globalThis as any)[type];
      } catch {
        return false;
      }
  }
}
