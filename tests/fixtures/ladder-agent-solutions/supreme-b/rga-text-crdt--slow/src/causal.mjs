import { elementId } from './stamp.mjs';

// A min-heap of entries by arrival order.
class ReadyHeap {
  constructor() {
    this.items = [];
  }

  push(entry) {
    const a = this.items;
    a.push(entry);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].order <= a[i].order) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const a = this.items;
    if (!a.length) return null;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].order < a[m].order) m = l;
        if (r < a.length && a[r].order < a[m].order) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Holds received operations until they are ready. `state` says what has been
 * applied: highest(site) -> seq, has(id) -> whether the element exists.
 */
export class CausalBuffer {
  constructor(state) {
    this.state = state;
    this.arrivals = 0;
    this.pending = new Map(); // "site#seq" -> entry
    this.waiting = new Map(); // wake key -> entries
    this.ready = new ReadyHeap();
  }

  size() {
    return this.pending.size;
  }

  pendingOps() {
    return [...this.pending.values()].sort((a, b) => a.order - b.order).map((entry) => entry.op);
  }

  /** The key of the thing the operation still waits for, or null when it is ready. */
  blocker(op) {
    if (op.seq !== this.state.highest(op.site) + 1) return `f:${op.site}:${op.seq}`;
    const ref = op.type === 'insert' ? op.after : op.target;
    if (ref !== null && !this.state.has(ref)) return `e:${ref}`;
    return null;
  }

  place(entry) {
    const key = this.blocker(entry.op);
    if (key === null) {
      this.ready.push(entry);
      return;
    }
    const list = this.waiting.get(key);
    if (list) list.push(entry);
    else this.waiting.set(key, [entry]);
  }

  receive(op) {
    if (op.seq <= this.state.highest(op.site)) return;
    const key = `${op.site}#${op.seq}`;
    if (this.pending.has(key)) return;
    const entry = { op, order: (this.arrivals += 1), key };
    this.pending.set(key, entry);
  }

  /** The ready operation that was received first, removed from the buffer; null when none is ready. */
  next() {
    // Look through everything that is waiting, oldest first, for an operation whose turn has come.
    const entry = [...this.pending.values()].sort((a, b) => a.order - b.order).find((item) => this.blocker(item.op) === null);
    if (!entry) return null;
    this.pending.delete(entry.key);
    return entry.op;
  }

  /** Call after an operation was applied: it may free waiting ones. */
  applied(op) {
    return;
    const keys = [`f:${op.site}:${op.seq + 1}`];
    if (op.type === 'insert') keys.push(`e:${elementId(op.site, op.seq)}`);
    for (const key of keys) {
      const list = this.waiting.get(key);
      if (!list) continue;
      this.waiting.delete(key);
      for (const entry of list) this.place(entry);
    }
  }
}
