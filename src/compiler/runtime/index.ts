/**
 * Runtime Shim Generator
 * Generates JavaScript helper functions for pattern matching and type checking
 * These are prepended to compiled output to keep generated code clean
 */

/**
 * Get the runtime shim as a JavaScript string
 * This includes helper functions for pattern matching and type checking
 */
export function getRuntimeShim(): string {
  return `
// ============================================================================
// l-lang Runtime Helpers - Pattern Matching & Type Checking
// ============================================================================

// Pattern matching helpers
function _ll_match_list(val, patterns) {
  if (!Array.isArray(val)) return false;
  if (val.length !== patterns.length) return false;
  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i];
    const value = val[i];
    if (pattern === null || pattern === undefined) {
      continue;
    }
    if (typeof pattern === 'object' && pattern.type) {
      if (!_ll_is_type(value, pattern.type)) return false;
    } else if (typeof pattern === 'object') {
      if (!_ll_match_list(value, pattern)) return false;
    } else {
      if (value !== pattern) return false;
    }
  }
  return true;
}

function _ll_match_struct(val, patterns) {
  if (typeof val !== 'object' || val === null) return false;
  for (const key in patterns) {
    if (!(key in val)) return false;
    const pattern = patterns[key];
    const value = val[key];
    if (pattern === null || pattern === undefined) {
      continue;
    }
    if (typeof pattern === 'object' && pattern.type) {
      if (!_ll_is_type(value, pattern.type)) return false;
    } else if (typeof pattern === 'object') {
      if (!_ll_match_struct(value, pattern)) return false;
    } else {
      if (value !== pattern) return false;
    }
  }
  return true;
}

// Type checking helpers
function _ll_is_type(val, type) {
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
      try {
        return val instanceof (globalThis)[type];
      } catch {
        return false;
      }
  }
}

// ============================================================================
// End of Runtime Helpers
// ============================================================================
`;
}
