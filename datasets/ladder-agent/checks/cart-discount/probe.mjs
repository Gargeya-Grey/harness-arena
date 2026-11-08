// Hidden probes for ladder-agent-cart-discount; expected.json holds the answers.
const cart = async (load, ...items) => {
  const { Cart } = await load('src/cart.mjs');
  const c = new Cart();
  for (const [name, price, quantity] of items) c.add(name, price, quantity);
  return c;
};
const standard = (load) => cart(load, ['pen', 10, 2], ['book', 5, 1]);
const after = async (c, ...codes) => {
  for (const code of codes) c.applyDiscount(code);
  return c.total();
};

export const probes = [
  { name: 'no code keeps the total', run: async ({ load }) => (await standard(load)).total() },
  { name: 'SAVE10 takes 10 percent off', run: async ({ load }) => after(await standard(load), 'SAVE10') },
  { name: 'FLAT5 takes 5 off', run: async ({ load }) => after(await standard(load), 'FLAT5') },
  { name: 'FLAT5 never goes below 0', run: async ({ load }) => after(await cart(load, ['gum', 3, 1]), 'FLAT5') },
  { name: 'a later code replaces the earlier one', run: async ({ load }) => after(await standard(load), 'SAVE10', 'FLAT5') },
  {
    name: 'an unknown code throws an Error',
    run: async ({ load }) => {
      const c = await standard(load);
      try {
        c.applyDiscount('FREE');
        return 'did not throw';
      } catch (error) {
        return error instanceof Error ? 'Error' : 'threw a non-Error';
      }
    },
  },
  // 59.97 less 10% is 53.973: no half-cent tie, so any sane rounding gives 53.97.
  { name: 'the total is rounded to cents', run: async ({ load }) => after(await cart(load, ['a', 19.99, 3]), 'SAVE10') },
];
