// The default size of a value, in bytes. A string is its length; binary
// data is its byte length; other values are counted by what they hold.
export function sizeOf(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return 0;
  switch (typeof value) {
    case 'string':
      return value.length;
    case 'number':
    case 'bigint':
      return 8;
    case 'boolean':
      return 4;
    case 'object': {
      if (ArrayBuffer.isView(value)) return value.byteLength;
      if (seen.has(value)) return 0;
      seen.add(value);
      if (Array.isArray(value)) return value.reduce((sum, item) => sum + sizeOf(item, seen), 0);
      return Object.entries(value).reduce((sum, [key, item]) => sum + sizeOf(key, seen) + sizeOf(item, seen), 0);
    }
    default:
      return 0;
  }
}
