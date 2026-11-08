// Hidden probes for ladder-agent-text-table; expected.json holds the answers.
const lib = (load) => load('src/index.mjs');
const attempt = (fn) => {
  try {
    return fn();
  } catch (error) {
    return error.constructor.name;
  }
};
const text = (column = {}) => ({ key: 'a', title: 'A', ...column });
// One column, no border, no header: the lines of the cells as they are written.
const cells = async (load, values, column = {}) => {
  const { renderTable } = await lib(load);
  return renderTable({ columns: [text(column)], rows: values.map((a) => ({ a })), border: 'none', header: false, padding: 0 }).split('\n');
};
const table = async (load, options) => {
  const { renderTable } = await lib(load);
  return attempt(() => renderTable(options).split('\n'));
};

export const probes = [
  {
    name: 'keeps an ascii table and a unicode table with their header rule',
    run: async ({ load }) => {
      const columns = [text({ key: 'name', title: 'Name' }), text({ key: 'qty', title: 'Qty', type: 'number' })];
      const rows = [{ name: 'apple', qty: 3 }, { name: 'fig', qty: 12 }];
      return [await table(load, { columns, rows }), await table(load, { columns, rows, border: 'unicode', padding: 2 }), await table(load, { columns, rows, header: false })];
    },
  },
  {
    name: 'wide characters take two columns: Hangul, kana, Chinese, full-width forms and emoji',
    run: async ({ load }) => {
      const { displayWidth } = await lib(load);
      return ['한국어', 'ひらがな', 'カタカナ', '日本語', 'ＡＢＣ１２', '😀', '🚀', '🍕🍔', '😀a', 'a日b', '　'].map((s) => displayWidth(s));
    },
  },
  {
    name: 'a cluster takes the width of its widest part: marks, joiners, flags, skin tones and emoji style',
    run: async ({ load }) => {
      const { displayWidth } = await lib(load);
      return ['é', 'ñ́', 'a​b', '​', '👨‍👩‍👧', '🇯🇵', '🇯🇵🇺🇸', '👍🏽', '❤️', '❤', '☺', '☺️', '한́', '👩🏽‍💻'].map((s) => displayWidth(s));
    },
  },
  {
    name: 'colour codes take no column and are never split',
    run: async ({ load }) => {
      const { displayWidth, truncate } = await lib(load);
      const red = '\u001b[1;31mhello world\u001b[0m';
      return {
        widths: [displayWidth('\u001b[31mred\u001b[0m'), displayWidth(red), displayWidth('\u001b[0m'), displayWidth('a\u001b[7mb')],
        cut: [truncate(red, 8, '…'), truncate(red, 20, '…'), truncate('\u001b[32m日本語です\u001b[0m', 6, '…'), truncate('x\u001b[31mabc\u001b[0my\u001b[1mz', 3, '.')],
      };
    },
  },
  {
    name: 'truncate counts the ellipsis by its own width and leaves it out when it does not fit',
    run: async ({ load }) => {
      const { truncate } = await lib(load);
      return [
        truncate('abcdefghij', 6, '...'),
        truncate('abcdefghij', 3, '...'),
        truncate('abcdef', 2, '...'),
        truncate('abcdef', 1, '…'),
        truncate('abcdef', 0, '…'),
        truncate('abcdef', 5, ''),
        truncate('日本語です', 5, '…'),
        truncate('日本語です', 4, '…'),
        truncate('日本語です', 3, '…'),
        truncate('日本語です', 10, '…'),
        truncate('abcdef', 6, '…'),
        truncate('abcdefg', 6, '…'),
        truncate('ab日本', 4, '日'),
      ];
    },
  },
  {
    name: 'truncate never cuts a cluster in two',
    run: async ({ load }) => {
      const { truncate } = await lib(load);
      return [
        truncate('ééé', 2, '…'),
        truncate('👨‍👩‍👧x👨‍👩‍👧', 4, '…'),
        truncate('🇯🇵🇺🇸🇫🇷', 5, '…'),
        truncate('a👍🏽b👍🏽', 5, '…'),
        truncate('ñ̃ñ̃ñ̃ñ̃', 3, '…'),
      ];
    },
  },
  {
    name: 'a tab goes to the next multiple of 4 columns, counted from the start of the line',
    run: async ({ load }) => cells(load, ['a\tb', 'ab\tc', 'abcd\te', '\tx', '日\tx', 'a\t\tb', 'é\tx'], { width: 12 }),
  },
  {
    name: 'empty and plain values: null, undefined, numbers, booleans, dates, objects, big integers',
    run: async ({ load }) => cells(load, [null, undefined, 0, -0, false, true, 12n, 'x', new Date(Date.UTC(2024, 0, 2, 3, 4, 5)), { a: 1, b: [2, null] }, [1, 'two'], NaN], { width: 24 }),
  },
  {
    name: 'line breaks and control characters in a cell',
    run: async ({ load }) => cells(load, ['a\r\nb', 'a\rb', 'a\nb\nc', 'bell\u0007here', 'nul\u0000x', 'del\u007fx', 'c1\u0085x', 'stray\u001bx', '\u001b[31mred\u001b[0m\u001b[2Kx', 'trail\n', '\n'], { width: 10 }),
  },
  {
    name: 'numbers are rounded half away from zero on their decimal digits',
    run: async ({ load }) => {
      const { formatNumber } = await lib(load);
      return [
        [1.005, 2], [2.5, 0], [-2.5, 0], [0.125, 2], [1.45, 1], [-1.005, 2], [8.345, 2], [1.255, 2], [0.5, 0], [1.5, 0], [0.45, 1], [10.075, 2],
        [1e21, 0], [1.5e-7, 8], [123456789.125, 2], [0.000001234, 8], [5e-7, 6], [0.1 + 0.2, 2], [99.995, 2], [999.5, 0], [1.1, 3], [100, 0], [12345.6789, 1],
      ].map(([value, decimals]) => formatNumber(value, { decimals }));
    },
  },
  {
    name: 'thousands separators go in the whole part only, and a zero result has no minus sign',
    run: async ({ load }) => {
      const { formatNumber } = await lib(load);
      return [
        formatNumber(1234567.891, { decimals: 2, thousands: ',' }),
        formatNumber(-1234.5, { decimals: 1, thousands: ',' }),
        formatNumber(1234.5678, { decimals: 4, thousands: ' ' }),
        formatNumber(123456.789012, { decimals: 6, thousands: ',' }),
        formatNumber(999999.995, { decimals: 2, thousands: ',' }),
        formatNumber(-0.001, { decimals: 2 }),
        formatNumber(-0.5, { decimals: 0 }),
        formatNumber(-0, { decimals: 2 }),
        formatNumber(0, { decimals: 3 }),
        formatNumber(1000, { thousands: '.' }),
        formatNumber(100, { thousands: ',' }),
        formatNumber(NaN, { decimals: 2 }),
        formatNumber(Infinity, { decimals: 2 }),
        formatNumber(-Infinity),
        formatNumber('12', { decimals: 2 }),
        formatNumber(1e21, { thousands: ',' }),
      ];
    },
  },
  {
    name: 'decimals must be a whole number from 0 to 20',
    run: async ({ load }) => {
      const { formatNumber } = await lib(load);
      return [-1, 1.5, 21, NaN, '2'].map((decimals) => attempt(() => formatNumber(1.5, { decimals }))).concat([formatNumber(1.5, { decimals: 20 }), formatNumber(1.5, { decimals: 0 })]);
    },
  },
  {
    name: 'a number column is right-aligned, takes decimals and thousands, and leaves other values as text',
    run: async ({ load }) => {
      const columns = [text({ key: 'n', title: 'Amount', type: 'number', decimals: 2, thousands: ',' }), text({ key: 'm', title: 'Left', type: 'number', align: 'left' })];
      const rows = [{ n: 3, m: 1 }, { n: 1234567.891, m: 22 }, { n: '12', m: null }, { n: -0.001, m: 'n/a' }, { n: undefined, m: 5 }];
      return table(load, { columns, rows, border: 'unicode' });
    },
  },
  {
    name: 'an odd gap in a centred column leaves the extra column on the right',
    run: async ({ load }) => {
      const columns = [text({ title: 'xxxxxxx', align: 'center' }), text({ key: 'b', title: 'yyyyyy', align: 'center' })];
      return table(load, { columns, rows: [{ a: 'ab', b: 'c' }, { a: 'abc', b: 'ab' }, { a: '日', b: '' }, { a: 'abcdefg', b: 'abcdef' }] });
    },
  },
  {
    name: 'wrapLine keeps the spaces inside a line and the indent, and drops the spaces at a break',
    run: async ({ load }) => {
      const { wrapLine } = await lib(load);
      return [
        wrapLine('  aa  bb cc', 6),
        wrapLine('aa bb   ', 5),
        wrapLine('aa     bb', 5),
        wrapLine('aa   bb', 7),
        wrapLine('aaaa bbbbbbbbbb', 4),
        wrapLine('日本語です', 4),
        wrapLine('ab 日本 cd', 5),
        wrapLine('a b c d e', 3),
        wrapLine('    ', 3),
        wrapLine('abcdefgh', 8),
        wrapLine('abcdefghi', 8),
        wrapLine('hello world', 5),
        wrapLine('ééé x', 2),
      ];
    },
  },
  {
    name: 'a wrapping column wraps its title too, a truncating column cuts it',
    run: async ({ load }) => {
      const wrap = text({ title: 'Long header text', overflow: 'wrap', maxWidth: 8 });
      const cut = text({ key: 'b', title: 'Long header text', maxWidth: 8 });
      return table(load, { columns: [wrap, cut], rows: [{ a: 'some words that wrap', b: 'some words that wrap' }] });
    },
  },
  {
    name: 'a row is as tall as its tallest cell and the other cells are filled with blank lines',
    run: async ({ load }) => {
      const columns = [text({ key: 'a', title: 'A' }), text({ key: 'b', title: 'B', overflow: 'wrap', maxWidth: 6 }), text({ key: 'c', title: 'C' })];
      const rows = [{ a: 'x', b: 'one two three four', c: 'a\nb' }, { a: '1\n2\n3', b: 'z', c: 'q' }];
      return table(load, { columns, rows, border: 'unicode' });
    },
  },
  {
    name: 'a table wider than maxWidth shrinks its widest column first, never one with a fixed width',
    run: async ({ load }) => {
      const wide = [text({ key: 'a', title: 'A' }), text({ key: 'b', title: 'B' }), text({ key: 'c', title: 'C' })];
      const rows = [{ a: 'abcdefghij', b: 'abcdefghij', c: 'abc' }];
      const fixed = [text({ key: 'a', title: 'A', width: 10 }), text({ key: 'b', title: 'B' }), text({ key: 'c', title: 'C' })];
      return {
        loose: await table(load, { columns: wide, rows }),
        tight: await table(load, { columns: wide, rows, maxWidth: 22 }),
        tighter: await table(load, { columns: wide, rows, maxWidth: 16 }),
        fixed: await table(load, { columns: fixed, rows, maxWidth: 24 }),
        none: await table(load, { columns: wide, rows, maxWidth: 17, border: 'none' }),
      };
    },
  },
  {
    name: 'minWidth, maxWidth and width hold a column, and a table that cannot fit is refused',
    run: async ({ load }) => {
      const rows = [{ a: 'ab', b: 'abcdefghij' }];
      return {
        min: await table(load, { columns: [text({ minWidth: 6 }), text({ key: 'b', title: 'B', maxWidth: 4 })], rows }),
        fixed: await table(load, { columns: [text({ width: 3 }), text({ key: 'b', title: 'B', width: 12 })], rows }),
        shrinkMin: await table(load, { columns: [text({ key: 'b', title: 'B', minWidth: 8 })], rows, maxWidth: 10 }),
        nofit: await table(load, { columns: [text({ key: 'b', title: 'B', minWidth: 8 }), text({ width: 5 })], rows, maxWidth: 10 }),
        nofit2: await table(load, { columns: [text({ key: 'b', title: 'B', width: 20 })], rows, maxWidth: 10 }),
        exact: await table(load, { columns: [text({ key: 'b', title: 'B' })], rows, maxWidth: 14 }),
      };
    },
  },
  {
    name: 'a table with wide and combined characters stays aligned',
    run: async ({ load }) => {
      const { displayWidth } = await lib(load);
      const columns = [text({ key: 'n', title: 'Name' }), text({ key: 'c', title: 'Note', maxWidth: 6 }), text({ key: 'q', title: 'Qty', type: 'number' })];
      const rows = [
        { n: '한국어', c: 'ééééééé', q: 1 },
        { n: 'ASCII', c: '🇯🇵🇺🇸🇫🇷🇩🇪', q: 22 },
        { n: '日本語', c: '\u001b[31mred red red red\u001b[0m', q: 333 },
        { n: 'x', c: '👨‍👩‍👧 family', q: 4 },
      ];
      const lines = (await table(load, { columns, rows, border: 'unicode' }));
      return { lines, widths: lines.map(displayWidth) };
    },
  },
  {
    name: 'padding, ellipsis and borders are options',
    run: async ({ load }) => {
      const columns = [text({ key: 'a', title: 'Alpha', maxWidth: 6 }), text({ key: 'b', title: 'B' })];
      const rows = [{ a: 'abcdefghijkl', b: 1 }];
      return {
        zero: await table(load, { columns, rows, padding: 0 }),
        two: await table(load, { columns, rows, padding: 2, border: 'unicode', ellipsis: '...' }),
        none: await table(load, { columns, rows, border: 'none', padding: 2 }),
        noEllipsis: await table(load, { columns, rows, border: 'none', ellipsis: '' }),
      };
    },
  },
  {
    name: 'keeps bad options refused',
    run: async ({ load }) => {
      const base = [text()];
      return [
        await table(load, { columns: [], rows: [] }),
        await table(load, { columns: base, rows: [], border: 'double' }),
        await table(load, { columns: base, rows: [], padding: -1 }),
        await table(load, { columns: base, rows: [], padding: 1.5 }),
        await table(load, { columns: base, rows: [] }),
      ];
    },
  },
];
