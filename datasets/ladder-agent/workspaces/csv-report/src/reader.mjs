// Reads CSV text into rows of strings.
const splitLine = (line) => line.split(',');

// An incremental parser: write(chunk) returns the rows that the chunk
// completed, end() returns the last row.
export function createParser() {
  let buffer = '';
  return {
    write(chunk) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      return lines.map(splitLine);
    },
    end() {
      const rest = buffer;
      buffer = '';
      return rest === '' ? [] : [splitLine(rest)];
    },
  };
}

export function parseCsv(text) {
  const lines = String(text).split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.map(splitLine);
}
