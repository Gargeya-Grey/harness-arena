import fs from 'node:fs';
import path from 'node:path';
import claudeCode from './claude-code.mjs';
import codex from './codex.mjs';
import commandCode from './command-code.mjs';
import geminiCli from './gemini-cli.mjs';
import opencode from './opencode.mjs';
import { checkDeclared, declaredAdapter } from './declared.mjs';
import { parseYaml } from '../lib/yaml.mjs';

/** The built-in harnesses, keyed by the name experiments use. Tests add fakes here. */
export const ADAPTERS = Object.fromEntries([claudeCode, codex, commandCode, geminiCli, opencode].map((adapter) => [adapter.name, adapter]));

export function harnessesFile(root) {
  return path.join(root, 'configs', 'harnesses.yaml');
}

/** configs/harnesses.yaml entries and their problems. A missing file is no harnesses. */
export function readDeclared(root) {
  const file = harnessesFile(root);
  if (!fs.existsSync(file)) return { entries: {}, problems: [] };
  const parsed = parseYaml(fs.readFileSync(file, 'utf8'), 'configs/harnesses.yaml') || {};
  const entries = parsed.harnesses || {};
  if (typeof entries !== 'object' || Array.isArray(entries)) return { entries: {}, problems: ['"harnesses" must be a map of name to settings'] };
  const builtIn = new Set(Object.keys(ADAPTERS));
  const problems = Object.entries(entries).flatMap(([name, entry]) => checkDeclared(name, entry, builtIn).map((problem) => `harness ${name}: ${problem}`));
  return { entries, problems };
}

/** Built-in harnesses plus every valid declared one for this data root. */
export function loadAdapters(root) {
  const adapters = { ...ADAPTERS };
  if (!root) return adapters;
  let entries = {};
  try {
    entries = readDeclared(root).entries;
  } catch {
    // A broken harnesses.yaml must not stop runs on built-in harnesses; validate and doctor report it.
  }
  const builtIn = new Set(Object.keys(ADAPTERS));
  for (const [name, entry] of Object.entries(entries)) {
    if (!checkDeclared(name, entry, builtIn).length) adapters[name] = declaredAdapter(name, entry);
  }
  return adapters;
}

export function getAdapter(name, root) {
  const adapters = loadAdapters(root);
  const adapter = adapters[name];
  if (!adapter) {
    throw new Error(`Unknown harness "${name}". Known: ${Object.keys(adapters).join(', ')}. Add a new CLI in configs/harnesses.yaml.`);
  }
  return adapter;
}
