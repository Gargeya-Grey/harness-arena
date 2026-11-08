import { isSite, elementId } from './stamp.mjs';
import { checkOps, copyOp } from './ops.mjs';
import { Sequence } from './sequence.mjs';
import { CausalBuffer } from './causal.mjs';

class Replica {
  constructor(site) {
    if (!isSite(site)) throw new TypeError(`bad site name ${String(site)}`);
    this.site = site;
    this.clock = 0;
    this.sequence = new Sequence();
    this.vector = new Map();
    this.log = [];
    this.buffer = new CausalBuffer({ highest: (s) => this.vector.get(s) || 0, has: (id) => this.sequence.has(id) });
  }

  get length() {
    return this.sequence.visible;
  }

  text() {
    return this.sequence.text();
  }

  apply(op) {
    if (op.type === 'insert') {
      this.sequence.insert({ id: elementId(op.site, op.seq), after: op.after, stamp: { clock: op.clock, site: op.site }, char: op.char });
    } else {
      this.sequence.markDeleted(op.target);
    }
    this.log.push(op);
    this.vector.set(op.site, op.seq);
    if (op.clock > this.clock) this.clock = op.clock;
  }

  local(type, rest) {
    const op = { type, site: this.site, seq: (this.vector.get(this.site) || 0) + 1, clock: this.clock + 1, ...rest };
    this.apply(op);
    return copyOp(op);
  }

  insertAt(index, text) {
    if (typeof text !== 'string') throw new TypeError('text must be a string');
    if (!Number.isInteger(index) || index < 0 || index > this.length) throw new RangeError(`index ${index} is outside 0..${this.length}`);
    let after = index === 0 ? null : this.sequence.visibleIds(index - 1, 1)[0];
    const out = [];
    for (const char of text) {
      const op = this.local('insert', { after, char });
      out.push(op);
      after = elementId(op.site, op.seq);
    }
    return out;
  }

  deleteAt(index, count = 1) {
    if (!Number.isInteger(index) || !Number.isInteger(count) || index < 0 || count < 0 || index + count > this.length) {
      throw new RangeError(`cannot delete ${count} from ${index} in a text of ${this.length}`);
    }
    return this.sequence.visibleIds(index, count).map((target) => this.local('delete', { target }));
  }

  receive(ops) {
    checkOps(ops);
    for (const op of ops) this.buffer.receive(copyOp(op));
    const out = [];
    for (let op = this.buffer.next(); op; op = this.buffer.next()) {
      this.apply(op);
      this.buffer.applied(op);
      out.push(copyOp(op));
    }
    return out;
  }

  stateVector() {
    return Object.fromEntries(this.vector);
  }

  opsSince(vector = {}) {
    return this.log.filter((op) => op.seq > (Object.hasOwn(vector, op.site) ? vector[op.site] : 0)).map(copyOp);
  }

  merge(other) {
    if (!(other instanceof Replica)) throw new TypeError('merge needs a replica');
    return this.receive(other.opsSince(this.stateVector()));
  }

  pendingCount() {
    return this.buffer.size();
  }

  elements() {
    return this.sequence.elements();
  }

  tombstoneCount() {
    return this.sequence.tombstones;
  }

  serialize() {
    return { site: this.site, ops: this.opsSince({}), pending: this.buffer.pendingOps().map(copyOp) };
  }
}

export const createReplica = (site) => new Replica(site);

export function restoreReplica(data) {
  if (data === null || typeof data !== 'object' || !isSite(data.site) || !Array.isArray(data.ops) || !Array.isArray(data.pending)) {
    throw new TypeError('bad saved replica');
  }
  const replica = new Replica(data.site);
  replica.receive(data.ops);
  replica.receive(data.pending);
  return replica;
}
