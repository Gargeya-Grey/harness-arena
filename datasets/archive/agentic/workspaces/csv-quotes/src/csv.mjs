// Parses CSV text into rows of string fields.
export function parseCsv(text) {
  return text.split('\n').map((line) => line.split(','));
}
