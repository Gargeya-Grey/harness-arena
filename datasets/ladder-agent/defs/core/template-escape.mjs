export default {
  slug: "template-escape",
  tier: {
    level: 3,
    human_minutes: 20,
    basis: "Six separate bugs in a 294-line template engine of 13 files; reference rewrites about 130 lines in 4 files. About 6 min to read the code and 2 to 3 min per bug.",
    origin: "agentic-hard-template-escape",
  },
  tags: ["bugfix"],
  task: "Our email and page templates render wrong in a few cases.\n- A value with an apostrophe breaks out of attributes written with single quotes: <a title='{{t}}'> with t = it's. The apostrophe must be escaped as &#39; like the other special characters.\n- A partial used without an argument inside {{#each}} shows data from the page instead of the current item. Without an argument a partial gets the current context, whatever block it is used in, and ../ inside a partial means the same as at the place where the partial is used.\n- A partial that is a function (partials: { badge: (ctx) => '<b>' + ctx.n + '</b>' }) comes out escaped, as text. Partials are the template author's own markup, whether they are template strings or functions, and are written out as they are.\n- Inside {{#each items}}, {{#if show}}{{../title}}{{/if}} prints nothing. ../ must still reach the context outside the loop, because {{#if}} and {{#unless}} do not change the context and do not add a level.\n- In nested loops, the {{@index}} of the outer loop is wrong after the inner loop has run. Each loop must keep its own @index, @key, @first and @last.\n- {{#if list}} renders its body for an empty list. False values are false, null, undefined, 0, NaN, the empty string and the empty array. Everything else, an empty object included, is true. The existing tests must keep passing and must not be edited; put any new tests in new files.",
};
