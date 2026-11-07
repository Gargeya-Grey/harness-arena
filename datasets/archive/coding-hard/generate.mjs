// Builds datasets/archive/coding-hard/cases.jsonl from the case definitions in defs/.
//
//   node datasets/archive/coding-hard/generate.mjs           prints the file to stdout
//   node datasets/archive/coding-hard/generate.mjs --write   writes cases.jsonl next to this file
//
// A definition holds the spec text and the hidden tests. A test that has no
// `returns` gets its expected value from the reference solution in
// tests/fixtures/coding-hard-solutions/<case_id>.mjs. Those solutions are the only
// place the answers come from, so tests/coding-hard.test.mjs scores every one of
// them through the real js-function evaluator and checks that this output is
// byte for byte what cases.jsonl holds.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOLUTIONS = path.join(HERE, '..', '..', '..', 'tests', 'fixtures', 'coding-hard-solutions');

export const SLUGS = [
  'recurrence-sum',
  'digit-neighbours',
  'not-divisible',
  'grid-paths',
  'kth-plain',
  'square-digit',
  'shuffle-power',
  'closest-fraction',
  'csv-dialect',
  'expr-eval',
  'semver-range',
  'repeating-sum',
  'interval-union',
  'rect-coverage',
  'polygon-points',
  'round-robin',
  'order-book',
  'ttl-cache',
  'coupon-path',
  'early-labels',
];

// Loads a solution file (plain function declarations, no exports) as a function.
export function loadSolution(file, name) {
  const source = fs.readFileSync(file, 'utf8');
  return new Function(`${source}\nreturn ${name};`)();
}

const clone = (value) => JSON.parse(JSON.stringify(value));

export async function buildCases() {
  const cases = [];
  for (const slug of SLUGS) {
    const def = (await import(`./defs/${slug}.mjs`)).default;
    const caseId = `coding-hard-${slug}`;
    const reference = loadSolution(path.join(SOLUTIONS, `${caseId}.mjs`), def.name);
    const tests = def.tests.map((test) => {
      const returns = 'returns' in test ? test.returns : clone(reference(...clone(test.args)));
      return { args: test.args, returns };
    });
    cases.push({
      case_id: caseId,
      input: { name: def.name, signature: def.signature, task: def.task },
      expected: { tests },
      tags: [def.kind, 'hard'],
      metadata: { edges: def.edges, test_edges: def.tests.map((test) => test.edge) },
    });
  }
  return cases;
}

export async function buildText() {
  return `${(await buildCases()).map((item) => JSON.stringify(item)).join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = await buildText();
  if (process.argv.includes('--write')) fs.writeFileSync(path.join(HERE, 'cases.jsonl'), text);
  else process.stdout.write(text);
}
