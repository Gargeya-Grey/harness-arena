// Builds datasets/ladder-answer/cases.jsonl from the definitions in defs/ (lab/lib/ladder.mjs).
// A definition adds `question` (the text the model sees) and `answer` (a number, one
// word or an ISO date, computed in code). Run with --write to store, --check to compare.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleCases, casesText, loadDefinitions, loadLadder } from '../../lab/lib/ladder.mjs';
import { generateMain } from '../../lab/lib/ladder-cli.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

export async function buildCases() {
  const defs = await loadDefinitions(path.join(HERE, 'defs'));
  return assembleCases({
    suiteId: 'ladder-answer',
    defs,
    ladder: loadLadder(ROOT),
    toCase: (def) => {
      if (typeof def.question !== 'string' || def.answer == null) throw new Error(`${def.file}: needs question and answer`);
      return { input: { question: def.question }, expected: def.answer, metadata: def.metadata };
    },
  });
}

export const buildText = async () => casesText(await buildCases());
await generateMain(import.meta.url, buildText);
