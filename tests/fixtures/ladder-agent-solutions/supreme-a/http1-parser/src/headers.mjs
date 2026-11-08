import { HTAB, SP, isTokenByte, isValueByte, latin1 } from './chars.mjs';

const lower = (text) => text.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32));

export function parseFieldLine(bytes) {
  if (bytes[0] === SP || bytes[0] === HTAB) return { code: 'bad-header' };
  const colon = bytes.indexOf(58);
  if (colon < 1) return { code: 'bad-header' };
  for (let i = 0; i < colon; i += 1) if (!isTokenByte(bytes[i])) return { code: 'bad-header' };
  for (let i = colon + 1; i < bytes.length; i += 1) if (!isValueByte(bytes[i])) return { code: 'bad-header' };
  let start = colon + 1;
  let end = bytes.length;
  while (start < end && (bytes[start] === SP || bytes[start] === HTAB)) start += 1;
  while (end > start && (bytes[end - 1] === SP || bytes[end - 1] === HTAB)) end -= 1;
  return { name: lower(latin1(bytes.slice(0, colon))), value: latin1(bytes.slice(start, end)) };
}

const values = (headers, name) => headers.filter(([key]) => key === name).map(([, value]) => value);

export function checkHeaderSection(headers, version, limits) {
  const hosts = values(headers, 'host');
  if (version === '1.1' && (hosts.length !== 1 || hosts[0] === '')) return { code: 'bad-host' };
  const encodings = values(headers, 'transfer-encoding');
  const lengths = values(headers, 'content-length');
  if (encodings.length) {
    if (version === '1.0' || lengths.length) return { code: 'bad-length' };
    const parts = encodings.join(',').split(',').map((part) => part.trim());
    if (parts.length !== 1 || parts[0].toLowerCase() !== 'chunked') return { code: 'unsupported-te' };
    return { kind: 'chunked' };
  }
  if (lengths.length) {
    if (!lengths.every((value) => /^[0-9]+$/.test(value))) return { code: 'bad-length' };
    const numbers = lengths.map((value) => BigInt(value));
    if (!numbers.every((n) => n === numbers[0])) return { code: 'bad-length' };
    if (numbers[0] > BigInt(limits.maxBodyBytes)) return { code: 'body-too-large' };
    return { kind: 'length', length: Number(numbers[0]) };
  }
  return { kind: 'none' };
}

export function keepAliveOf(headers, version) {
  const parts = values(headers, 'connection').join(',').split(',').map((part) => part.trim().toLowerCase());
  if (parts.includes('close')) return false;
  return version === '1.1' ? true : parts.includes('keep-alive');
}
