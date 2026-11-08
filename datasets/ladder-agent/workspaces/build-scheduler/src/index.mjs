import { analyze } from './graph.mjs';
import { simulate } from './scheduler.mjs';

export { GraphError } from './errors.mjs';
export { contentHash, hashParts } from './hash.mjs';

export function build(graph, options = {}) {
  const { slots = 1, cache = {}, run, goals = null, keepGoing = true } = options;
  if (!Number.isInteger(slots) || slots < 1) throw new RangeError('slots must be a positive integer');
  if (typeof run !== 'function') throw new TypeError('run must be a function');
  const model = analyze(graph, goals);
  return simulate(model, { slots, run, cache, keepGoing });
}
