import { contentHash } from './hash.mjs';

const wellFormed = (entry) =>
  entry !== null &&
  typeof entry === 'object' &&
  typeof entry.recipe === 'string' &&
  typeof entry.output === 'string' &&
  Array.isArray(entry.deps) &&
  true;

export function staleReason(node, entry, depHashes) {
  if (!wellFormed(entry)) return 'new';
  if (entry.recipe !== contentHash(node.recipe)) return 'recipe';
  for (let i = 0; i < node.deps.length; i += 1) if (entry.deps[i][1] !== depHashes[i]) return `dep:${node.deps[i]}`;
  return null;
}

export function makeEntry(node, depHashes, output) {
  return { recipe: contentHash(node.recipe), deps: node.deps.map((name, i) => [name, depHashes[i]]), output };
}
