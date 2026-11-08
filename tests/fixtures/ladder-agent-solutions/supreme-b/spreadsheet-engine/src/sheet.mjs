import { splitRef, inGrid, formatRef, orderKey, fromOrderKey } from './refs.mjs';
import { makeError } from './values.mjs';
import { parseFormula, references } from './parser.mjs';
import { evaluate } from './evaluator.mjs';
import { Graph } from './graph.mjs';

const NUMBER = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;

function keyOf(ref) {
  const cell = splitRef(ref, false);
  if (!cell || !inGrid(cell)) throw new RangeError(`bad cell reference ${JSON.stringify(ref)}`);
  return orderKey(cell);
}

function interpret(input) {
  if (input === '') return null;
  if (input[0] === '=') return { formula: input.slice(1) };
  if (input[0] === "'") return { value: input.slice(1) };
  if (NUMBER.test(input)) return { value: Number(input) };
  const upper = input.toUpperCase();
  if (upper === 'TRUE' || upper === 'FALSE') return { value: upper === 'TRUE' };
  return { value: input };
}

const copy = (value) => (value !== null && typeof value === 'object' ? { error: value.error } : value);

export function createSheet() {
  const cells = new Map(); // key -> { input, value, ast?, parsed? }
  const graph = new Graph();
  let evaluations = 0;

  const getCell = ({ col, row }) => {
    const cell = cells.get(orderKey({ col, row }));
    return cell ? cell.value : null;
  };

  function recompute(key) {
    const cell = cells.get(key);
    evaluations += 1;
    cell.value = cell.ast ? evaluate(cell.ast, getCell) : makeError('#PARSE!');
  }

  return {
    set(ref, input) {
      const key = keyOf(ref);
      if (typeof input !== 'string') throw new TypeError('input must be a string');
      const what = interpret(input);
      graph.remove(key);
      if (!what) {
        cells.delete(key);
      } else if ('formula' in what) {
        const parsed = parseFormula(what.formula);
        cells.set(key, { input, value: null, ast: parsed.ok ? parsed.ast : null });
        if (parsed.ok) graph.set(key, references(parsed.ast));
      } else {
        cells.set(key, { input, value: what.value });
      }
      const plan = graph.plan(key, Boolean(what && 'formula' in what));
      for (const k of plan.cyclic) cells.get(k).value = makeError('#CYCLE!');
      for (const k of plan.order) recompute(k);
      return [...plan.cyclic, ...plan.order].map((k) => formatRef(fromOrderKey(k)));
    },
    get(ref) {
      const cell = cells.get(keyOf(ref));
      return cell ? copy(cell.value) : null;
    },
    input(ref) {
      const cell = cells.get(keyOf(ref));
      return cell ? cell.input : '';
    },
    cells() {
      return [...cells.keys()].sort((a, b) => a - b).map((k) => formatRef(fromOrderKey(k)));
    },
    precedents(ref) {
      return graph.precedents(keyOf(ref)).map((k) => formatRef(fromOrderKey(k)));
    },
    dependents(ref) {
      return [...graph.dependents(keyOf(ref))].sort((a, b) => a - b).map((k) => formatRef(fromOrderKey(k)));
    },
    evaluations: () => evaluations,
  };
}
