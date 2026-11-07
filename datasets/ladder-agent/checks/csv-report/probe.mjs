// Hidden probes for ladder-agent-csv-report; expected.json holds the answers.
// Every probe goes through the public exports of src/index.mjs.
const lib = (load) => load('src/index.mjs');
const attempt = (fn) => {
  try {
    return fn();
  } catch {
    return 'threw';
  }
};
const round = (value) => (typeof value === 'number' ? Number(value.toFixed(9)) : value);
const clean = (summary) => ({
  rows: summary.rows,
  groups: summary.groups.map((g) => ({ ...g, avg: round(g.avg) })),
  total: { ...summary.total, avg: round(summary.total.avg) },
});
const OPTIONS = { groupBy: 'Region', value: 'Amount' };

// A file as a finance export writes it: BOM, CRLF, quoted notes with commas,
// doubled quotes and a line break inside a quoted field.
const EXPORT = '﻿Region, Amount ,Note\r\nEast,"1,234.50","bought ""big"" thing, twice"\r\nWest ,(12.00),"two\r\nlines"\r\n East,$5.25,\r\nEast,,missing\r\n\r\nWest,.5,x\r\n';

// Every way to cut `text` in two, and in pieces of one and of three characters.
const cuts = (text) => {
  const all = [];
  for (let i = 0; i <= text.length; i += 1) all.push([text.slice(0, i), text.slice(i)]);
  const ones = [...text];
  const threes = [];
  for (let i = 0; i < text.length; i += 3) threes.push(text.slice(i, i + 3));
  all.push(ones, threes);
  return all;
};
const parseInPieces = (createParser, pieces) => {
  const parser = createParser();
  const rows = [];
  for (const piece of pieces) rows.push(...parser.write(piece));
  rows.push(...parser.end());
  return rows;
};

export const probes = [
  {
    name: 'keeps plain files',
    run: async ({ load }) => {
      const { parseCsv } = await lib(load);
      return [parseCsv('a,b\n1,2\n3,4\n'), parseCsv('a,b\n1,2'), parseCsv('a,,c\n,\n'), parseCsv(''), parseCsv('one\n'), parseCsv(' a , b \n')];
    },
  },
  {
    name: 'quoted fields hold commas and doubled quotes',
    run: async ({ load }) => {
      const { parseCsv } = await lib(load);
      return [parseCsv('a,"b,c",d\n"x ""y"" z",1,""\n'), parseCsv('"",""\n'), parseCsv('"""",x\n'), parseCsv('"a"\n'), parseCsv('say "hi",x\n')];
    },
  },
  {
    name: 'quoted fields keep line breaks exactly',
    run: async ({ load }) => {
      const { parseCsv } = await lib(load);
      return [parseCsv('"line1\nline2",2\n"a\r\nb",3\r\n'), parseCsv('"\n"\n'), parseCsv('x,"end\n"\ny\n')];
    },
  },
  {
    name: 'CRLF and LF line ends give clean fields',
    run: async ({ load }) => {
      const { parseCsv } = await lib(load);
      return [parseCsv('a,b\r\n1,2\r\n3,4\r\n'), parseCsv('a,b\r\n1,2\n3,4\r\n'), parseCsv('a,b\r\n1,2'), parseCsv('a\r\n\r\nb\r\n')];
    },
  },
  {
    name: 'blank lines are skipped and nothing else is',
    run: async ({ load }) => {
      const { parseCsv } = await lib(load);
      return [parseCsv('a\n\nb\n\n\n'), parseCsv('\n\na\n'), parseCsv('""\n'), parseCsv(',\n'), parseCsv('  \n'), parseCsv('\n')];
    },
  },
  {
    name: 'an unclosed quote is reported',
    run: async ({ load }) => {
      const { parseCsv, createParser } = await lib(load);
      const parser = createParser();
      parser.write('a,"unfinished');
      return [attempt(() => parseCsv('a,"b\n')), attempt(() => parseCsv('a,"b"')), attempt(() => parser.end())];
    },
  },
  {
    name: 'the incremental parser gives the same rows wherever the text is cut',
    run: async ({ load }) => {
      const { parseCsv, createParser } = await lib(load);
      const doc = 'h1,h2\r\n"a,""b""\r\nc",x\r\n\r\n"q""",""\r\nlast,"end"';
      const want = parseCsv(doc);
      let wrong = 0;
      for (const pieces of cuts(doc)) {
        if (JSON.stringify(parseInPieces(createParser, pieces)) !== JSON.stringify(want)) wrong += 1;
      }
      const lf = 'a,"b""\nc"\nd,e\n';
      for (const pieces of cuts(lf)) {
        if (JSON.stringify(parseInPieces(createParser, pieces)) !== JSON.stringify(parseCsv(lf))) wrong += 1;
      }
      return { want, wrong };
    },
  },
  {
    name: 'a quote and the line break after it may arrive in different chunks',
    run: async ({ load }) => {
      const { createParser } = await lib(load);
      const a = createParser();
      const first = [a.write('x,"y"'), a.write('\r'), a.write('\n'), a.write('z,"w""'), a.write('"\r\n'), a.end()];
      const b = createParser();
      const second = [b.write('"p'), b.write('"'), b.write('"'), b.write('q"\n'), b.end()];
      return { first: first.flat(), second: second.flat() };
    },
  },
  {
    name: 'records drop the byte-order mark and the spaces around names',
    run: async ({ load }) => {
      const { parseCsv, toRecords } = await lib(load);
      return [toRecords(parseCsv('﻿Region, Amount \nEast,1\n')), toRecords(parseCsv('a,b\n1\n1,2,3\n')), toRecords([]), toRecords(parseCsv('a,b\n'))];
    },
  },
  {
    name: 'amounts are read the way people write them',
    run: async ({ load }) => {
      const { toNumber } = await lib(load);
      return ['12.5', '1,234.50', '$1,234.50', '(12.00)', '-3', '.5', '+7', ' 8 ', '€9.99', '£3', '-$5', '1,234,567.891', '0.10', '(0.5)'].map((s) => toNumber(s));
    },
  },
  {
    name: 'text that is no amount gives null',
    run: async ({ load }) => {
      const { toNumber } = await lib(load);
      return ['', '   ', 'n/a', '1,23', '1.2.3', '12abc', '$', '()', '--5', '(-5)', '1,2345', '€1.234,50'].map((s) => toNumber(s));
    },
  },
  {
    name: 'a finance export is summarized without losing a row or a cent',
    run: async ({ load }) => {
      const { summarize } = await lib(load);
      return clean(summarize(EXPORT, OPTIONS));
    },
  },
  {
    name: 'the same export read in pieces gives the same summary',
    run: async ({ load }) => {
      const { summarize, summarizeChunks } = await lib(load);
      const want = JSON.stringify(clean(summarize(EXPORT, OPTIONS)));
      let wrong = 0;
      for (const pieces of cuts(EXPORT)) if (JSON.stringify(clean(summarizeChunks(pieces, OPTIONS))) !== want) wrong += 1;
      return { wrong, again: JSON.stringify(clean(summarizeChunks([EXPORT], OPTIONS))) === want, bomAlone: JSON.stringify(clean(summarizeChunks(['﻿', EXPORT.slice(1)], OPTIONS))) === want };
    },
  },
  {
    name: 'sums are exact decimals',
    run: async ({ load }) => {
      const { summarize } = await lib(load);
      const tenths = `k,v\n${'a,0.1\n'.repeat(10)}b,0.1\nb,0.2\nc,19.99\nc,19.99\nc,19.99\nd,0.07\nd,0.14\nd,0.21\n`;
      const s = summarize(tenths, { groupBy: 'k', value: 'v' });
      return { sums: s.groups.map((g) => g.sum), total: s.total.sum, avgB: round(s.groups[1].avg), avgC: round(s.groups[2].avg) };
    },
  },
  {
    name: 'blank and non-numeric amounts count as rows but not as values',
    run: async ({ load }) => {
      const { summarize } = await lib(load);
      const csv = 'g,v\na,10\na,\na,n/a\na,20\nb,\nb,x\nc,(4)\nc,-2\n';
      return clean(summarize(csv, { groupBy: 'g', value: 'v' }));
    },
  },
  {
    name: 'group keys ignore the spaces around them but not their case',
    run: async ({ load }) => {
      const { summarize } = await lib(load);
      const csv = 'g,v\nEast,1\n East,2\nEast ,3\neast,4\n,5\n  ,6\n';
      return summarize(csv, { groupBy: 'g', value: 'v' }).groups.map((g) => [g.key, g.count, g.sum]);
    },
  },
  {
    name: 'column names match without regard to case or spaces, and a missing column is an error',
    run: async ({ load }) => {
      const { summarize } = await lib(load);
      const csv = '﻿ Region ,AMOUNT\nE,1\nE,2\n';
      const ok = summarize(csv, { groupBy: 'region', value: ' amount ' });
      return [ok.groups, attempt(() => summarize(csv, { groupBy: 'Country', value: 'Amount' })), attempt(() => summarize(csv, { groupBy: 'Region', value: 'Price' }))];
    },
  },
  {
    name: 'short and long rows do not break the summary',
    run: async ({ load }) => {
      const { summarize } = await lib(load);
      const csv = 'Region,Amount,Note\nE,5\nE,6,x,y,z\nW\n';
      return clean(summarize(csv, OPTIONS));
    },
  },
  {
    name: 'keeps renderTable',
    run: async ({ load }) => {
      const { summarize, renderTable } = await lib(load);
      const csv = 'Region,Amount\nEast,10\nWest,2.5\nEast,5.5\nNorth,4\n';
      const summary = summarize(csv, OPTIONS);
      return [renderTable(summary).split('\n'), renderTable(summary, { decimals: 0 }).split('\n')];
    },
  },
  {
    name: 'keeps a big export fast in small chunks',
    run: async ({ load }) => {
      const { summarizeChunks } = await lib(load);
      let text = 'Region,Amount,Note\r\n';
      for (let i = 0; i < 20000; i += 1) text += `R${i % 7},${(i % 100) + 0.25},"note ""${i}"", ok"\r\n`;
      const chunks = [];
      for (let i = 0; i < text.length; i += 512) chunks.push(text.slice(i, i + 512));
      const s = summarizeChunks(chunks, OPTIONS);
      return [s.rows, s.groups.length, s.total.sum];
    },
  },
  {
    name: 'keeps the public exports',
    run: async ({ load }) => {
      const mod = await lib(load);
      return ['createParser', 'parseCsv', 'findColumn', 'readHeader', 'toRecords', 'toNumber', 'summarize', 'summarizeChunks', 'renderTable'].filter((n) => typeof mod[n] !== 'function');
    },
  },
];
