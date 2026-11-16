import { compareStamps } from './stamp.mjs';

export class Sequence {
  constructor() {
    this.nodes = [];
    this.byId = new Map();
    this.children = new Map([[null, []]]);
    this.visible = 0;
    this.tombstones = 0;
  }

  has(id) {
    return this.byId.has(id);
  }

  /** Adds an element after `after` (an id, or null for the start); the parent must exist. */
  insert({ id, after, stamp, char }) {
    const siblings = this.children.get(after);
    let low = 0;
    let high = siblings.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (compareStamps(siblings[middle].stamp, stamp) > 0) low = middle + 1;
      else high = middle;
    }
    const nextSibling = siblings[low] ?? null;
    const node = { id, after, char, stamp, nextSibling, deleted: false };
    let next = nextSibling;
    if (next === null && after !== null && this.nodes.at(-1)?.id !== after) {
      let ancestor = this.byId.get(after);
      while (ancestor && ancestor.nextSibling === null) ancestor = this.byId.get(ancestor.after);
      next = ancestor?.nextSibling ?? null;
    }
    const i = next === null ? this.nodes.length : this.nodes.indexOf(next);
    if (low > 0) siblings[low - 1].nextSibling = node;
    siblings.splice(low, 0, node);
    this.children.set(id, []);
    this.nodes = [...this.nodes.slice(0, i), node, ...this.nodes.slice(i)];
    this.byId.set(id, node);
    this.visible = this.nodes.filter((item) => !item.deleted).length;
  }

  markDeleted(id) {
    const node = this.byId.get(id);
    if (node.deleted) return;
    node.deleted = true;
    this.visible -= 1;
    this.tombstones += 1;
  }

  /** The ids of `count` visible elements from visible index `index`. */
  visibleIds(index, count) {
    const out = [];
    if (count === 0) return out;
    let seen = 0;
    for (const node of this.nodes) {
      if (node.deleted) continue;
      if (seen >= index) {
        out.push(node.id);
        if (out.length === count) break;
      }
      seen += 1;
    }
    return out;
  }

  text() {
    let out = '';
    for (const node of this.nodes) if (!node.deleted) out += node.char;
    return out;
  }

  elements() {
    return this.nodes.map((node) => ({ id: node.id, char: node.char, deleted: node.deleted }));
  }
}
