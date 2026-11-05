import { createGroup } from './aggregate.mjs';
import { toNumber } from './coerce.mjs';
import { createParser, parseCsv } from './reader.mjs';
import { findColumn, readHeader } from './records.mjs';

// Feeds rows one by one: the first row is the header, the others are data.
// summary = { rows, groups: [{ key, count, sum, avg, min, max }], total: { count, sum, avg, min, max } }
function createSummarizer({ groupBy, value }) {
  let columns = null;
  let rows = 0;
  const groups = new Map();
  const total = createGroup();
  return {
    add(row) {
      if (columns === null) {
        const names = readHeader(row);
        columns = { key: findColumn(names, groupBy), value: findColumn(names, value) };
        if (columns.key < 0) throw new Error(`no column named ${groupBy}`);
        if (columns.value < 0) throw new Error(`no column named ${value}`);
        return;
      }
      const key = row[columns.key] ?? '';
      const amount = toNumber(row[columns.value] ?? '');
      if (!groups.has(key)) groups.set(key, createGroup());
      groups.get(key).add(amount);
      total.add(amount);
      rows += 1;
    },
    result() {
      return {
        rows,
        groups: [...groups].map(([key, group]) => ({ key, ...group.result() })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
        total: total.result(),
      };
    },
  };
}

// summarize(csvText, { groupBy: 'Region', value: 'Amount' })
export function summarize(text, options) {
  const summarizer = createSummarizer(options);
  for (const row of parseCsv(text)) summarizer.add(row);
  return summarizer.result();
}

// The same for text that arrives in pieces (any iterable of strings).
export function summarizeChunks(chunks, options) {
  const summarizer = createSummarizer(options);
  const parser = createParser();
  for (const chunk of chunks) for (const row of parser.write(chunk)) summarizer.add(row);
  for (const row of parser.end()) summarizer.add(row);
  return summarizer.result();
}
