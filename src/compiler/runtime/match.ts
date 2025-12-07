/**
 * Runtime helpers for pattern matching
 * These functions are prepended to compiled JavaScript output
 */

/**
 * _ll_match_list - Test if value matches a list pattern
 * @param val - Value to test
 * @param patterns - Array of pattern descriptors
 * @returns true if value matches the pattern
 */
export function _ll_match_list(val: any, patterns: any[]): boolean {
  if (!Array.isArray(val)) return false;
  if (val.length !== patterns.length) return false;

  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i];
    const value = val[i];

    if (pattern === null || pattern === undefined) {
      // Wildcard pattern
      continue;
    }

    if (typeof pattern === 'object' && pattern.type) {
      // Type pattern
      if (!matchType(value, pattern.type)) return false;
    } else if (typeof pattern === 'object') {
      // Recursive pattern
      if (!_ll_match_list(value, pattern)) return false;
    } else {
      // Constant pattern
      if (value !== pattern) return false;
    }
  }

  return true;
}

/**
 * _ll_match_struct - Test if value matches a destructuring pattern
 * @param val - Value to test
 * @param patterns - Object with pattern descriptors
 * @returns true if value matches the pattern
 */
export function _ll_match_struct(val: any, patterns: any): boolean {
  if (typeof val !== 'object' || val === null) return false;

  for (const key in patterns) {
    if (!(key in val)) return false;

    const pattern = patterns[key];
    const value = val[key];

    if (pattern === null || pattern === undefined) {
      continue;
    }

    if (typeof pattern === 'object' && pattern.type) {
      if (!matchType(value, pattern.type)) return false;
    } else if (typeof pattern === 'object') {
      if (!_ll_match_struct(value, pattern)) return false;
    } else {
      if (value !== pattern) return false;
    }
  }

  return true;
}

/**
 * Helper: Match a value against a type
 */
function matchType(value: any, type: string): boolean {
  switch (type) {
    case 'number':
      return typeof value === 'number';
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null;
    case 'null':
      return value === null;
    case 'undefined':
      return value === undefined;
    default:
      return false;
  }
}
