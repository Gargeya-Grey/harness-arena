// The amount in a cell as a number, or null.
export function toNumber(text) {
  const number = parseFloat(String(text).replace(/[$,]/g, ''));
  return Number.isNaN(number) ? null : number;
}
