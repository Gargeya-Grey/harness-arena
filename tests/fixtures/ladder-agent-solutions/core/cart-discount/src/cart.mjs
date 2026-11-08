// A shopping cart. Prices are in dollars.
const DISCOUNTS = {
  SAVE10: (subtotal) => subtotal * 0.9,
  FLAT5: (subtotal) => Math.max(0, subtotal - 5),
};

export class Cart {
  constructor() {
    this.items = [];
    this.code = null;
  }

  add(name, price, quantity = 1) {
    this.items.push({ name, price, quantity });
    return this;
  }

  applyDiscount(code) {
    if (!Object.hasOwn(DISCOUNTS, code)) throw new Error(`Unknown discount code: ${code}`);
    this.code = code;
    return this;
  }

  subtotal() {
    return this.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  total() {
    const subtotal = this.subtotal();
    return Math.round((this.code ? DISCOUNTS[this.code](subtotal) : subtotal) * 100) / 100;
  }
}
