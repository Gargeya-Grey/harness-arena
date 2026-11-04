// A shopping cart. Prices are in dollars.
const DISCOUNTS = {
  // 10% off the subtotal.
  SAVE10: (subtotal) => subtotal * 0.9,
  // 5 off the subtotal, never below 0.
  FLAT5: (subtotal) => Math.max(0, subtotal - 5),
};

export class Cart {
  constructor() {
    this.items = [];
    this.discountCode = null;
  }

  add(name, price, quantity = 1) {
    this.items.push({ name, price, quantity });
    return this;
  }

  // Replaces any earlier code. An unknown code throws and leaves the current code unchanged.
  applyDiscount(code) {
    if (!Object.hasOwn(DISCOUNTS, code)) {
      throw new Error(`Unknown discount code: ${code}`);
    }
    this.discountCode = code;
    return this;
  }

  subtotal() {
    return this.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  total() {
    const subtotal = this.subtotal();
    const discounted = this.discountCode === null ? subtotal : DISCOUNTS[this.discountCode](subtotal);
    return Math.round(discounted * 100) / 100;
  }
}
