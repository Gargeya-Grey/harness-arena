// A stay runs from check-in to check-out; both are dates written 'YYYY-MM-DD'.
// It occupies the nights from check-in up to, but not including, check-out.
const DAY_MS = 24 * 60 * 60 * 1000;

// The number of nights of a stay { checkIn, checkOut }.
export function nights(stay) {
  return Math.round((Date.parse(stay.checkOut) - Date.parse(stay.checkIn)) / DAY_MS) + 1;
}

// True when the two stays share at least one night.
export function overlaps(a, b) {
  return a.checkIn <= b.checkOut && b.checkIn <= a.checkOut;
}
