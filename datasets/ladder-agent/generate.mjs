// Builds datasets/ladder-agent/cases.jsonl from the definitions in defs/ (lab/lib/ladder.mjs).
// A definition adds `task` (the issue text the agent sees). Its starter project is
// workspaces/<slug>/ and its hidden check is checks/<slug>/ (probe.mjs + expected.json).
// Run with --write to store, --check to compare.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleCases, casesText, loadDefinitions, loadLadder } from '../../lab/lib/ladder.mjs';
import { generateMain } from '../../lab/lib/ladder-cli.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');

export async function buildCases() {
  const defs = await loadDefinitions(path.join(HERE, 'defs'));
  return assembleCases({
    suiteId: 'ladder-agent',
    defs,
    ladder: loadLadder(ROOT),
    toCase: (def) => {
      for (const part of ['workspaces', 'checks']) {
        if (!fs.existsSync(path.join(HERE, part, def.slug))) throw new Error(`${def.file}: ${part}/${def.slug} not found`);
      }
      return { input: { workspace: def.slug, task: def.task }, expected: { check: def.slug }, metadata: def.metadata };
    },
  });
}

export const buildText = async () => casesText(await buildCases());
await generateMain(import.meta.url, buildText);
