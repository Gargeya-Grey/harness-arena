import { pageCount, pageRange } from './paginate.mjs';

const DEFAULT_PAGE_SIZE = 10;

// One page of `items`, as { items, page, pages, hasNext }.
// `pages` is the total number of pages; `hasNext` says whether a later page exists.
// A page that is below 1 or not a whole number counts as page 1.
export function listItems(items, { page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  if (!Number.isInteger(page) || page < 1) page = 1;
  const pages = pageCount(items.length, pageSize);
  const { start, end } = pageRange(page, pageSize);
  return { items: items.slice(start, end), page, pages, hasNext: page < pages };
}
