import { readRecord } from './codec.mjs';
import { CorruptionError } from './errors.mjs';

export const segmentName = (number) => `seg-${String(number).padStart(6, '0')}.log`;
const SEGMENT = /^seg-(\d{6})\.log$/;

export function recover(disk) {
  const names = disk.list();
  let numbers = names
    .map((name) => SEGMENT.exec(name))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .filter((number) => number >= 1)
    .sort((a, b) => a - b);

  const cache = new Map();
  const read = (number) => {
    if (!cache.has(number)) cache.set(number, disk.read(segmentName(number)) ?? new Uint8Array(0));
    return cache.get(number);
  };



  const data = new Map();
  const segments = [];
  numbers.forEach((number, index) => {
    const bytes = read(number);
    let offset = 0;
    while (offset < bytes.length) {
      const record = readRecord(bytes, offset);
      if (!record.ok) {
        if (index < numbers.length - 1) throw new CorruptionError('invalid', { segment: number, offset });
        disk.write(segmentName(number), bytes.slice(0, offset));
        break;
      }
      for (const op of record.ops ?? []) {
        if (op.op === 'put') data.set(op.key, op.value);
        else data.delete(op.key);
      }
      offset = record.end;
    }
    segments.push({ number, size: offset });
  });
  return { segments, data };
}
