// Hidden probes for ladder-agent-pagination-bug; expected.json holds the answers.
const ITEMS = Array.from({ length: 25 }, (_, i) => i + 1);
const list = async (load, items, options) => (await load('src/api.mjs')).listItems(items, options);
const paginate = (load) => load('src/paginate.mjs');

export const probes = [
  { name: 'page 1 holds the first ten items', run: async ({ load }) => (await list(load, ITEMS, { page: 1, pageSize: 10 })).items },
  { name: 'page 2 holds items 11 to 20', run: async ({ load }) => (await list(load, ITEMS, { page: 2, pageSize: 10 })).items },
  { name: 'the last page holds the rest', run: async ({ load }) => (await list(load, ITEMS, { page: 3, pageSize: 10 })).items },
  { name: 'pages for 25 items of 10', run: async ({ load }) => (await list(load, ITEMS, { pageSize: 10 })).pages },
  { name: 'pages for exactly 20 items of 10', run: async ({ load }) => (await list(load, ITEMS.slice(0, 20), { pageSize: 10 })).pages },
  { name: 'an empty list has 0 pages and no next page', run: async ({ load }) => { const r = await list(load, [], {}); return { items: r.items, pages: r.pages, hasNext: r.hasNext }; } },
  { name: 'hasNext on page 1 of 3', run: async ({ load }) => (await list(load, ITEMS, { page: 1, pageSize: 10 })).hasNext },
  { name: 'hasNext on page 2 of 3', run: async ({ load }) => (await list(load, ITEMS, { page: 2, pageSize: 10 })).hasNext },
  { name: 'hasNext on the last page', run: async ({ load }) => (await list(load, ITEMS, { page: 3, pageSize: 10 })).hasNext },
  { name: 'hasNext on the last page of an exact fit', run: async ({ load }) => (await list(load, ITEMS.slice(0, 20), { page: 2, pageSize: 10 })).hasNext },
  { name: 'a page past the last is empty', run: async ({ load }) => { const r = await list(load, ITEMS, { page: 4, pageSize: 10 }); return { items: r.items, hasNext: r.hasNext }; } },
  { name: 'page 0 counts as page 1', run: async ({ load }) => { const r = await list(load, ITEMS, { page: 0, pageSize: 10 }); return { page: r.page, first: r.items[0] }; } },
  { name: 'a fractional page counts as page 1', run: async ({ load }) => { const r = await list(load, ITEMS, { page: 2.5, pageSize: 10 }); return { page: r.page, first: r.items[0] }; } },
  { name: 'the defaults are page 1 and ten items', run: async ({ load }) => { const r = await list(load, ITEMS); return { page: r.page, count: r.items.length, first: r.items[0] }; } },
  { name: 'a page size larger than the list', run: async ({ load }) => { const r = await list(load, ITEMS, { pageSize: 100 }); return { pages: r.pages, count: r.items.length, hasNext: r.hasNext }; } },
  { name: 'pageCount of 25 items by 10 and of none', run: async ({ load }) => { const { pageCount } = await paginate(load); return [pageCount(25, 10), pageCount(20, 10), pageCount(0, 10), pageCount(1, 10)]; } },
  { name: 'pageRange of pages 1 and 2', run: async ({ load }) => { const { pageRange } = await paginate(load); return [pageRange(1, 10), pageRange(2, 10)]; } },
];
