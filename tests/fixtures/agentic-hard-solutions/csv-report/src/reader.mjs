// Reads CSV (RFC 4180) into rows of strings.
//   - a field may be quoted; inside quotes a comma or a line break is data and
//     "" stands for one quote
//   - a line ends with \n or \r\n; a blank line is skipped; the last line may
//     lack its line end
//   - a quote in the middle of an unquoted field is an ordinary character
//   - a quote that is never closed is an error

// An incremental parser: write(chunk) returns the rows that the chunk
// completed, end() returns the last row and checks that no quote is open.
export function createParser() {
  let rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let quoteSeen = false;
  let rowStarted = false;
  let skipLineFeed = false;
  let atStart = true;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    if (rowStarted) {
      endField();
      rows.push(row);
    }
    row = [];
    field = '';
    rowStarted = false;
  };

  const feed = (text) => {
    for (const c of text) {
      if (atStart) {
        atStart = false;
        if (c === '﻿') continue;
      }
      if (skipLineFeed) {
        skipLineFeed = false;
        if (c === '\n') continue;
      }
      if (inQuotes) {
        if (quoteSeen) {
          quoteSeen = false;
          if (c === '"') {
            field += '"';
            continue;
          }
          inQuotes = false;
        } else if (c === '"') {
          quoteSeen = true;
          continue;
        } else {
          field += c;
          continue;
        }
      }
      if (c === '"' && field === '' && !inQuotes) {
        inQuotes = true;
        rowStarted = true;
      } else if (c === ',') {
        rowStarted = true;
        endField();
      } else if (c === '\n') {
        endRow();
      } else if (c === '\r') {
        endRow();
        skipLineFeed = true;
      } else {
        rowStarted = true;
        field += c;
      }
    }
  };

  const take = () => {
    const done = rows;
    rows = [];
    return done;
  };

  return {
    write(chunk) {
      feed(String(chunk));
      return take();
    },
    end() {
      if (inQuotes && !quoteSeen) throw new Error('unterminated quoted field');
      inQuotes = false;
      quoteSeen = false;
      endRow();
      return take();
    },
  };
}

export function parseCsv(text) {
  const parser = createParser();
  return [...parser.write(text), ...parser.end()];
}
