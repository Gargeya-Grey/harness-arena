import { readRecord } from './codec.mjs';
import { CorruptionError } from './errors.mjs';

export const segmentName = (number) => `seg-${String(number).padStart(6, '0')}.log`;
const SEGMENT = /^seg-(\d{6})\.log$/;

export function recover(disk) {
  const names = disk.list();
  if (names.includes('compact.tmp')) disk.remove('compact.tmp');
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

  for (let i = numbers.length - 1; i >= 0; i -= 1) {
    const first = readRecord(read(numbers[i]), 0);
    if (first.ok && first.supersede !== undefined) {
      const mine = numbers[i];
      for (const number of numbers) if (number <= first.supersede && number < mine) disk.remove(segmentName(number));
      numbers = numbers.filter((number) => !(number <= first.supersede && number < mine));
      break;
    }
  }

  for (let i = 1; i < numbers.length; i += 1) {
    if (numbers[i] !== numbers[i - 1] + 1) throw new CorruptionError('gap', { segment: numbers[i - 1] + 1 });
  }

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
