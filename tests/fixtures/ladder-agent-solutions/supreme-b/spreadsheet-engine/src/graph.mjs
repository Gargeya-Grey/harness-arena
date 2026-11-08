import { orderKey, fromOrderKey } from './refs.mjs';

// A binary min-heap of numbers.
class MinHeap {
  constructor() {
    this.a = [];
  }

  get size() {
    return this.a.length;
  }

  push(value) {
    const a = this.a;
    a.push(value);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p] <= a[i]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l] < a[m]) m = l;
        if (r < a.length && a[r] < a[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Who depends on whom. Cells are order keys (see refs.mjs). */
export class Graph {
  constructor() {
    this.singles = new Map(); // cell key -> Set of formula keys that mention it
    this.deps = new Map(); // formula key -> { cells: key[], ranges: range[] }
    this.rangeOwners = new Set(); // formula keys that mention a range
  }

  /** Replaces the dependencies of a formula. refs: { cells: [{col,row}], ranges: [{c1,r1,c2,r2}] }. */
  set(formulaKey, refs) {
    this.remove(formulaKey);
    const cells = [...new Set(refs.cells.map(orderKey))];
    for (const key of cells) {
      const owners = this.singles.get(key);
      if (owners) owners.add(formulaKey);
      else this.singles.set(key, new Set([formulaKey]));
    }
    this.deps.set(formulaKey, { cells, ranges: refs.ranges });
    if (refs.ranges.length) this.rangeOwners.add(formulaKey);
  }

  remove(formulaKey) {
    const old = this.deps.get(formulaKey);
    if (!old) return;
    for (const key of old.cells) {
      const owners = this.singles.get(key);
      owners.delete(formulaKey);
      if (!owners.size) this.singles.delete(key);
    }
    this.deps.delete(formulaKey);
    this.rangeOwners.delete(formulaKey);
  }

  /** The formula keys that mention the cell directly. */
  dependents(key) {
    const out = new Set(this.singles.get(key));
    const { col, row } = fromOrderKey(key);
    for (const owner of this.rangeOwners) {
      if (this.deps.get(owner).ranges.some((r) => col >= r.c1 && col <= r.c2 && row >= r.r1 && row <= r.r2)) out.add(owner);
    }
    return out;
  }

  /** The cells a formula mentions, ranges expanded, sorted. */
  precedents(formulaKey) {
    const info = this.deps.get(formulaKey);
    if (!info) return [];
    const out = new Set(info.cells);
    for (const r of info.ranges) for (let row = r.r1; row <= r.r2; row += 1) for (let col = r.c1; col <= r.c2; col += 1) out.add(orderKey({ col, row }));
    return [...out].sort((a, b) => a - b);
  }

  /**
   * What a change of `origin` recomputes: { cyclic, order }, both lists of keys. cyclic: cells of the affected
   * set that depend on themselves, in reading order. order: the others in dependency order, the first in
   * reading order going first among the ready ones.
   */
  plan(origin, originIsFormula) {
    const memo = new Map();
    const succ = (key) => {
      let list = memo.get(key);
      if (!list) {
        list = [...this.dependents(key)];
        memo.set(key, list);
      }
      return list;
    };
    const affected = new Set();
    const queue = [];
    for (const d of succ(origin)) {
      affected.add(d);
      queue.push(d);
    }
    while (queue.length) {
      for (const d of succ(queue.pop())) {
        if (!affected.has(d)) {
          affected.add(d);
          queue.push(d);
        }
      }
    }
    if (originIsFormula) affected.add(origin);
    const inner = new Map();
    const within = (key) => {
      let list = inner.get(key);
      if (!list) {
        list = succ(key).filter((k) => affected.has(k));
        inner.set(key, list);
      }
      return list;
    };

    const cyclic = this.cyclicCells(affected, within, succ);
    const rest = [...affected].filter((k) => !cyclic.has(k));
    const waiting = new Map(rest.map((k) => [k, 0]));
    for (const u of rest) for (const w of within(u)) if (waiting.has(w)) waiting.set(w, waiting.get(w) + 1);
    const ready = new MinHeap();
    for (const [k, n] of waiting) if (n === 0) ready.push(k);
    const order = [];
    while (ready.size) {
      const k = ready.pop();
      order.push(k);
      for (const w of within(k)) {
        if (!waiting.has(w)) continue;
        const left = waiting.get(w) - 1;
        waiting.set(w, left);
        if (left === 0) ready.push(w);
      }
    }
    return { cyclic: [...cyclic].sort((a, b) => a - b), order };
  }

  /** Tarjan's strongly connected components, without recursion. */
  cyclicCells(nodes, within, succ) {
    const index = new Map();
    const low = new Map();
    const onStack = new Set();
    const stack = [];
    const cyclic = new Set();
    let counter = 0;
    for (const root of nodes) {
      if (index.has(root)) continue;
      const open = (v) => {
        index.set(v, counter);
        low.set(v, counter);
        counter += 1;
        stack.push(v);
        onStack.add(v);
      };
      open(root);
      const work = [[root, 0]];
      while (work.length) {
        const frame = work[work.length - 1];
        const v = frame[0];
        const next = within(v);
        if (frame[1] < next.length) {
          const w = next[frame[1]];
          frame[1] += 1;
          if (!index.has(w)) {
            open(w);
            work.push([w, 0]);
          } else if (onStack.has(w)) {
            low.set(v, Math.min(low.get(v), index.get(w)));
          }
          continue;
        }
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1][0];
          low.set(parent, Math.min(low.get(parent), low.get(v)));
        }
        if (low.get(v) === index.get(v)) {
          const component = [];
          let w;
          do {
            w = stack.pop();
            onStack.delete(w);
            component.push(w);
          } while (w !== v);
          if (component.length > 1 || succ(v).includes(v)) for (const c of component) cyclic.add(c);
        }
      }
    }
    return cyclic;
  }
}
