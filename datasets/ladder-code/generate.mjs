// Builds datasets/ladder-code/cases.jsonl from the definitions in defs/ (lab/lib/ladder.mjs).
// A definition adds name, signature, task, edges and tests ({ args, returns?, edge }).
// A test without `returns` gets it from the reference solution
// tests/fixtures/ladder-code-solutions/<defs subfolder>/<case_id>.mjs (plain function declarations,
// no exports). Run with --write to store, --check to compare.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleCases, casesText, loadDefinitions, loadLadder, loadRetired } from '../../lab/lib/ladder.mjs';
import { generateMain } from '../../lab/lib/ladder-cli.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
export const SOLUTIONS = path.join(ROOT, 'tests', 'fixtures', 'ladder-code-solutions');

export function loadSolution(file, name) {
  return new Function(`${fs.readFileSync(file, 'utf8')}\nreturn ${name};`)();
}

const clone = (value) => JSON.parse(JSON.stringify(value));

// includeRetired: also the tasks in defs/_retired.mjs (for the tests that prove them).
export async function buildCases({ includeRetired = false } = {}) {
  const defs = await loadDefinitions(path.join(HERE, 'defs'));
  return assembleCases({
    suiteId: 'ladder-code',
    defs,
    ladder: loadLadder(ROOT),
    retired: await loadRetired(path.join(HERE, 'defs')),
    includeRetired,
    toCase: (def) => {
      const caseId = `ladder-code-${def.slug}`;
      let reference;
      const tests = def.tests.map((test) => {
        if ('returns' in test) return { args: test.args, returns: test.returns };
        reference ??= loadSolution(path.join(SOLUTIONS, path.dirname(def.file), `${caseId}.mjs`), def.name);
        return { args: test.args, returns: clone(reference(...clone(test.args))) };
      });
      return {
        input: { name: def.name, signature: def.signature, task: def.task },
        expected: { tests },
        metadata: { ...(def.metadata || {}), edges: def.edges, test_edges: def.tests.map((test) => test.edge) },
      };
    },
  });
}

export const buildText = async () => casesText(await buildCases());
await generateMain(import.meta.url, buildText);
