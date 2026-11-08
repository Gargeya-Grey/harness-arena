import { compareStamps } from './stamp.mjs';

export class Sequence {
  constructor() {
    this.nodes = [];
    this.byId = new Map();
    this.visible = 0;
    this.tombstones = 0;
  }

  has(id) {
    return this.byId.has(id);
  }

  /** Adds an element after `after` (an id, or null for the start); the parent must exist. */
  insert({ id, after, stamp, char }) {
    const node = { id, char, stamp, deleted: false };
    const ids = this.nodes.map((n) => n.id);
    let i = after === null ? 0 : ids.indexOf(after) + 1;
    // Everything with a greater stamp here is a younger sibling or inside its subtree.
    while (i < this.nodes.length && compareStamps(this.nodes[i].stamp, stamp) > 0) i += 1;
    this.nodes = [...this.nodes.slice(0, i), node, ...this.nodes.slice(i)];
    this.byId.set(id, node);
    this.visible = this.nodes.filter((n) => !n.deleted).length; // counted again after every insert
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
    return this.nodes.filter((node) => !node.deleted).slice(index, index + count).map((node) => node.id);
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
