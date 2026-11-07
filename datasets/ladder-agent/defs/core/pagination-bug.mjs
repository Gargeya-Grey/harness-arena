export default {
  slug: "pagination-bug",
  tier: {
    level: 2,
    human_minutes: 6,
    basis: "Reference changes about 20 lines in 2 files; five off-by-one and edge-case rules to find and fix.",
    origin: "agentic-pagination-bug",
  },
  tags: ["bugfix","multi-file"],
  task: "listItems in src/api.mjs returns the wrong pages, and `node --test` fails. The bugs are in more than one file (src/api.mjs and src/paginate.mjs). Rules: pages count from 1, so page 1 holds the first pageSize items. pageCount(total, pageSize) in src/paginate.mjs is the number of pages needed for all items (0 for an empty list), and pageRange(page, pageSize) is the slice bounds { start, end } of one page (end is exclusive). listItems returns { items, page, pages, hasNext }: pages is the page count, hasNext is true only when a later page exists, and a page below 1 or not a whole number counts as page 1 (the returned page is the one used). A page past the last page gives an empty items array and hasNext false. Fix the code so that all tests pass and the rules hold. Do not change the tests.",
};
