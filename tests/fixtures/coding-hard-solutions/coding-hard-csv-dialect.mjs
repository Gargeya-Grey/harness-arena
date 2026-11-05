function parseDialectCsv(text) {
  const n = text.length;
  if (n === 0) return [];
  const records = [];
  let record = [];
  let i = 0;
  const atRecordEnd = (at) => text[at] === '\n' || (text[at] === '\r' && text[at + 1] === '\n');
  for (;;) {
    let value;
    if (text[i] === "'") {
      i += 1;
      value = '';
      for (;;) {
        if (i >= n) return null;
        const ch = text[i];
        if (ch === "'") {
          if (text[i + 1] === "'") {
            value += "'";
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        value += ch;
        i += 1;
      }
      if (i < n && text[i] !== ';' && !atRecordEnd(i)) return null;
    } else {
      const start = i;
      while (i < n && text[i] !== ';' && !atRecordEnd(i)) i += 1;
      value = text.slice(start, i);
    }
    record.push(value);
    if (i >= n) {
      records.push(record);
      return records;
    }
    if (text[i] === ';') {
      i += 1;
      continue;
    }
    i += text[i] === '\r' ? 2 : 1;
    records.push(record);
    record = [];
    if (i >= n) return records;
  }
}
