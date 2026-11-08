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
    let i = after === null ? 0 : this.nodes.indexOf(this.byId.get(after)) + 1;
    // Everything with a greater stamp here is a younger sibling or inside its subtree.
    while (i < this.nodes.length && compareStamps(this.nodes[i].stamp, stamp) > 0) i += 1;
    this.nodes.splice(i, 0, node);
    this.byId.set(id, node);
    this.visible += 1;
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
