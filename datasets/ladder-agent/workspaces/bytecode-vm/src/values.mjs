// Run-time values (SPEC.md section 6): numbers, strings and booleans are JavaScript values, nil is null, an array
// is a JavaScript array, and a function is any object with a `callable` field: 'fn' for a function written in the
// language, 'native' for a builtin. Both carry `name` (a string, or null for an anonymous function).
// Equality is JavaScript's ===.

/** The text print() and str() give for a value (SPEC.md section 6). */
export function display(value) {
  return show(value, false, []);
}

function show(value, quoted, seen) {
  if (value === null) return 'nil';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Object.is(value, -0) ? '0' : String(value);
  if (typeof value === 'string') return quoted ? `"${value}"` : value;
  if (Array.isArray(value)) {
    if (seen.includes(value)) return '[...]';
    seen.push(value);
    const text = `[${value.map((item) => show(item, true, seen)).join(', ')}]`;
    seen.pop();
    return text;
  }
  if (value.callable === 'native') return `<native ${value.name}>`;
  return value.name === null ? '<fn>' : `<fn ${value.name}>`;
}

/** nil and false are false; everything else, also 0 and "", is true. */
export function isTruthy(value) {
  return value !== null && value !== false;
}

/** The name of the type, as type() returns it. */
export function typeName(value) {
  if (value === null) return 'nil';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number' || typeof value === 'string') return typeof value;
  return Array.isArray(value) ? 'array' : 'function';
}
