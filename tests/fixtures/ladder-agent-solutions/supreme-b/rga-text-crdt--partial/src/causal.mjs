export class CausalBuffer {
  constructor(state) {
    this.state = state;
    this.queue = [];
  }

  size() {
    return this.queue.length;
  }

  pendingOps() {
    return [...this.queue];
  }

  blocker(op) {
    if (op.seq !== this.state.highest(op.site) + 1) return `f:${op.site}:${op.seq}`;
    const ref = op.type === 'insert' ? op.after : op.target;
    if (ref !== null && !this.state.has(ref)) return `e:${ref}`;
    return null;
  }

  receive(op) {
    if (op.seq <= this.state.highest(op.site)) return;
    if (this.queue.some((other) => other.site === op.site && other.seq === op.seq)) return;
    this.queue.push(op);
  }

  remove(op) {
    this.queue.splice(this.queue.indexOf(op), 1);
  }
}
