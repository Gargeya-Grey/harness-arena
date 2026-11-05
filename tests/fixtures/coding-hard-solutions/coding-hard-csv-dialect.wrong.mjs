function parseDialectCsv(text) {
  const records = [];
  let rec = [];
  let field = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuote) {
      if (ch === "'") {
        if (text[i + 1] === "'") {
          field += "'";
          i += 1;
        } else {
          inQuote = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === "'") {
      inQuote = true;
    } else if (ch === ';') {
      rec.push(field);
      field = '';
    } else if (ch === '\n') {
      rec.push(field);
      records.push(rec);
      rec = [];
      field = '';
    } else {
      field += ch;
    }
  }
  rec.push(field);
  records.push(rec);
  return records;
}
