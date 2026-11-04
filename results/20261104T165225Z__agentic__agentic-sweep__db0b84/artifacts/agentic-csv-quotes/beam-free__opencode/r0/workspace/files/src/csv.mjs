// Parses CSV text into rows of string fields.
export function parseCsv(text) {
  if (text === undefined || text === null) text = '';
  let s = String(text);

  // Ignore one final trailing line end.
  if (s.endsWith('\r\n')) {
    s = s.slice(0, -2);
  } else if (s.endsWith('\n')) {
    s = s.slice(0, -1);
  }

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < n && s[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
    } else {
      if (c === '"' && field === '') {
        inQuotes = true;
        i += 1;
      } else if (c === ',') {
        row.push(field);
        field = '';
        i += 1;
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i += 1;
      } else if (c === '\r' && i + 1 < n && s[i + 1] === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i += 2;
      } else {
        field += c;
        i += 1;
      }
    }
  }

  // Push the final (possibly empty) record.
  row.push(field);
  rows.push(row);

  return rows;
}