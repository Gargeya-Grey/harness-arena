// A shopping cart. Prices are in dollars.
export class Cart {
  constructor() {
    this.items = [];
  }

  add(name, price, quantity = 1) {
    this.items.push({ name, price, quantity });
    return this;
  }

  subtotal() {
    return this.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  total() {
    return Math.round(this.subtotal() * 100) / 100;
  }
}
