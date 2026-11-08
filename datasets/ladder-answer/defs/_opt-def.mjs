// A round-2 definition: the family's definition() plus the proof duties of the ladder brief.
// It throws when a case has fewer than three shortcuts, fewer than two of them miss the answer,
// or a shortcut has no number to compare.

import { definition } from './_families.mjs';

export function optDefinition(args) {
  const def = definition(args);
  const list = def.metadata.shortcuts;
  if (list.length < 3) throw new Error(`${args.slug}: needs at least three shortcuts, has ${list.length}`);
  if (list.some((s) => !Number.isInteger(s.answer))) throw new Error(`${args.slug}: every shortcut must give a whole number`);
  const misses = list.filter((s) => s.answer !== def.answer).length;
  if (misses < 2) throw new Error(`${args.slug}: only ${misses} shortcut(s) miss the answer ${def.answer}`);
  return def;
}
