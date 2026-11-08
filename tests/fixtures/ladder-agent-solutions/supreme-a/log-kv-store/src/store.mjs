import { MAX_BODY, batchBody, deleteBody, frame, putBody, supersedeBody, concat, utf8 } from './codec.mjs';
import { recover, segmentName } from './recovery.mjs';

const MAX_SEGMENT = 999999;

function checkText(value, label) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
}

function checkWell(value, label) {
  if (!value.isWellFormed()) throw new RangeError(`${label} has a lone surrogate`);
}

function checkKey(key) {
  checkText(key, 'key');
  checkWell(key, 'key');
  const size = utf8(key).length;
  if (size < 1 || size > 255) throw new RangeError('a key has 1 to 255 bytes');
}

export function openStore(disk, options = {}) {
  const max = options.maxSegmentBytes ?? 1048576;
  if (!Number.isInteger(max) || max < 64) throw new RangeError('maxSegmentBytes must be an integer >= 64');
  const recovered = recover(disk);
  const data = recovered.data;
  let segments = recovered.segments;

  const nextTarget = () => {
    const last = segments.at(-1);
    if (!last) return 1;
    return last.size >= max ? last.number + 1 : last.number;
  };

  function append(body) {
    if (body.length > MAX_BODY) throw new RangeError('record too large');
    const target = nextTarget();
    if (target > MAX_SEGMENT) throw new RangeError('no more segment numbers');
    const bytes = frame(body);
    disk.append(segmentName(target), bytes);
    if (segments.at(-1)?.number !== target) segments.push({ number: target, size: 0 });
    segments.at(-1).size += bytes.length;
  }

  const sortedKeys = (prefix) => {
    if (prefix !== undefined && typeof prefix !== 'string') throw new TypeError('prefix must be a string');
    return [...data.keys()].filter((key) => key.startsWith(prefix ?? '')).sort();
  };

  return {
    put(key, value) {
      checkText(key, 'key');
      checkText(value, 'value');
      checkWell(key, 'key');
      checkWell(value, 'value');
      checkKey(key);
      const body = putBody(key, value);
      append(body);
      data.set(key, value);
    },
    get: (key) => data.get(key),
    has: (key) => data.has(key),
    delete(key) {
      checkKey(key);
      if (!data.has(key)) return false;
      append(deleteBody(key));
      data.delete(key);
      return true;
    },
    batch(ops) {
      if (!Array.isArray(ops)) throw new TypeError('ops must be an array');
      if (ops.length < 1 || ops.length > 65535) throw new RangeError('a batch has 1 to 65535 operations');
      for (const op of ops) {
        if (op === null || typeof op !== 'object' || (op.op !== 'put' && op.op !== 'delete')) throw new TypeError('bad operation');
        checkText(op.key, 'key');
        if (op.op === 'put') checkText(op.value, 'value');
      }
      for (const op of ops) {
        checkWell(op.key, 'key');
        if (op.op === 'put') checkWell(op.value, 'value');
      }
      for (const op of ops) checkKey(op.key);
      append(batchBody(ops));
      for (const op of ops) {
        if (op.op === 'put') data.set(op.key, op.value);
        else data.delete(op.key);
      }
    },
    keys: (prefix) => sortedKeys(prefix),
    entries: (prefix) => sortedKeys(prefix).map((key) => [key, data.get(key)]),
    stats: () => ({ keys: data.size, segments: segments.length, bytes: segments.reduce((sum, s) => sum + s.size, 0), active: nextTarget() }),
    compact() {
      if (segments.length === 0) return { segmentsBefore: 0, bytesBefore: 0, bytesAfter: 0 };
      const top = segments.at(-1).number;
      if (top >= MAX_SEGMENT) throw new RangeError('no more segment numbers');
      const parts = [frame(supersedeBody(top))];
      for (const key of [...data.keys()].sort()) parts.push(frame(putBody(key, data.get(key))));
      const bytes = concat(parts);
      const before = { segmentsBefore: segments.length, bytesBefore: segments.reduce((sum, s) => sum + s.size, 0) };
      disk.write('compact.tmp', bytes);
      disk.rename('compact.tmp', segmentName(top + 1));
      for (const segment of segments) disk.remove(segmentName(segment.number));
      segments = [{ number: top + 1, size: bytes.length }];
      return { ...before, bytesAfter: bytes.length };
    },
  };
}
