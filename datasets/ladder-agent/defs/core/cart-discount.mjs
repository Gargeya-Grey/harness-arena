export default {
  slug: "cart-discount",
  tier: {
    level: 2,
    human_minutes: 4,
    basis: "Reference adds one short method plus its tests to a 19-line class; the rules are listed in the task and need no design.",
    origin: "agentic-cart-discount",
  },
  tags: ["feature"],
  task: "Add a method applyDiscount(code) to the Cart class in src/cart.mjs. 'SAVE10' takes 10% off the subtotal. 'FLAT5' takes 5 off the subtotal, but the total never goes below 0. Any other code throws an Error. Applying a code replaces any earlier code. total() keeps rounding to cents. Keep the existing tests passing, and add tests for applyDiscount to test/cart.test.mjs.",
};
