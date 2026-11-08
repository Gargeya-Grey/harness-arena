import { crc32 } from './crc32.mjs';

export const MAX_BODY = 16777216;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

const u16 = (n) => Uint8Array.of(n >>> 8, n & 0xff);
const u32 = (n) => Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);

export function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function frame(body) {
  return concat([u32(crc32(body)), u32(body.length), body]);
}

export const utf8 = (text) => encoder.encode(text);

export function putBody(key, value) {
  const k = utf8(key);
  return concat([Uint8Array.of(1), u16(k.length), k, utf8(value)]);
}

export function deleteBody(key) {
  const k = utf8(key);
  return concat([Uint8Array.of(2), u16(k.length), k]);
}

export function batchBody(ops) {
  const parts = [Uint8Array.of(3), u16(ops.length)];
  for (const op of ops) {
    const k = utf8(op.key);
    parts.push(Uint8Array.of(op.op === 'put' ? 1 : 2), u16(k.length), k);
    if (op.op === 'put') {
      const v = utf8(op.value);
      parts.push(u32(v.length), v);
    }
  }
  return concat(parts);
}

export const supersedeBody = (through) => concat([Uint8Array.of(4), u32(through)]);

function parseBody(body, first) {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const len = body.length;
  if (len < 1) return null;
  const key = (at) => {
    if (at + 2 > len) return null;
    const n = view.getUint16(at);
    if (n < 1 || n > 255 || at + 2 + n > len) return null;
    return { key: decoder.decode(body.subarray(at + 2, at + 2 + n)), next: at + 2 + n };
  };
  switch (body[0]) {
    case 1: {
      const k = key(1);
      return k ? [{ op: 'put', key: k.key, value: decoder.decode(body.subarray(k.next)) }] : null;
    }
    case 2: {
      const k = key(1);
      return k && k.next === len ? [{ op: 'delete', key: k.key }] : null;
    }
    case 3: {
      if (len < 3) return null;
      const count = view.getUint16(1);
      if (count < 1) return null;
      const ops = [];
      let at = 3;
      for (let i = 0; i < count; i += 1) {
        if (at >= len || (body[at] !== 1 && body[at] !== 2)) return null;
        const put = body[at] === 1;
        const k = key(at + 1);
        if (!k) return null;
        at = k.next;
        if (put) {
          if (at + 4 > len) return null;
          const n = view.getUint32(at);
          if (at + 4 + n > len) return null;
          ops.push({ op: 'put', key: k.key, value: decoder.decode(body.subarray(at + 4, at + 4 + n)) });
          at += 4 + n;
        } else ops.push({ op: 'delete', key: k.key });
      }
      return at === len ? ops : null;
    }
    case 4:
      return len === 5 && first ? { supersede: view.getUint32(1) } : null;
    default:
      return null;
  }
}

/** { ok: true, end, ops } | { ok: true, end, supersede } | { ok: false } for the record at `offset`. */
export function readRecord(bytes, offset) {
  if (offset + 8 > bytes.length) return { ok: false };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const crc = view.getUint32(offset);
  const length = view.getUint32(offset + 4);
  if (length > MAX_BODY || offset + 8 + length > bytes.length) return { ok: false };
  const body = bytes.subarray(offset + 8, offset + 8 + length);
  if (crc32(body) !== crc) return { ok: false };
  let parsed;
  try {
    parsed = parseBody(body, offset === 0);
  } catch {
    return { ok: false };
  }
  if (!parsed) return { ok: false };
  return Array.isArray(parsed) ? { ok: true, end: offset + 8 + length, ops: parsed } : { ok: true, end: offset + 8 + length, ...parsed };
}
