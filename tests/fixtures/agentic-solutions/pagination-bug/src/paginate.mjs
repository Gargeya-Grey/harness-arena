// Helpers that split a list into pages. Pages are numbered from 1.

// How many pages are needed to show `total` items, `pageSize` items per page.
// An empty list needs 0 pages.
export function pageCount(total, pageSize) {
  return Math.ceil(total / pageSize);
}

// The slice bounds of one page: items start..end-1 (end is exclusive).
// Page 1 starts at item 0.
export function pageRange(page, pageSize) {
  const start = (page - 1) * pageSize;
  return { start, end: start + pageSize };
}
