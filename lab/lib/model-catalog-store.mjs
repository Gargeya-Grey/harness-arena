import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256, writeJson } from './fsutil.mjs';

const fileFor = root => path.join(root, '.lab-model-catalog.json');
export const catalogModelKey = (harness, id) => `catalog.${harness}.${sha256(id).slice(0, 20)}`;

export function readModelCatalog(root) {
  try {
    const value = JSON.parse(fs.readFileSync(fileFor(root), 'utf8'));
    if (value?.version === 1 && value.models && value.sources) return value;
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  return { version: 1, models: {}, sources: {} };
}

export function saveModelCatalog(root, catalog) {
  const file = fileFor(root);
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    writeJson(temp, catalog); // not a run file: stages the checkout-local model catalog
    fs.renameSync(temp, file); // not a run file: replaces the checkout-local model catalog
  } finally {
    fs.rmSync(temp, { force: true }); // not a run file: removes this refresh's staging file
  }
}
