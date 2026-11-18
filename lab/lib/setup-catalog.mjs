import fs from 'node:fs';
import path from 'node:path';
import { loadYamlFile, paths, resolveExperiment } from './repo.mjs';
import { readModelCatalog } from './model-catalog-store.mjs';

export const setupKey = ({ model, harness }) => `${harness}|${model}`;

function describeSetup({ model, harness }, registry, adapters) {
  const entry = registry[model];
  const adapter = adapters[harness];
  const id = entry.harness_models?.[harness] ?? entry.model;
  const provider = ['opencode', 'command-code'].includes(harness) && id?.includes('/') ? id.split('/')[0] : entry.provider;
  const levels = adapter.supports_effort ? entry.effort_levels : [];
  const verified = Array.isArray(levels) && levels.every(level => typeof level === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(level) && !['default', 'unavailable'].includes(level));
  return { model, harness, provider, model_id: id, display_name: entry.display_name || model, discovered: Boolean(entry.catalog_harness),
    effort_levels: verified ? levels : [], choices: verified ? levels.length ? levels : ['unavailable'] : [] };
}

// A model is routable where the registry maps it explicitly or a preset declares the pair.
export function setupCatalog(root, registry, adapters) {
  const pairs = new Map();
  const activeModels = new Set(Object.values(readModelCatalog(root).sources).flatMap(source => source.keys ?? []));
  const add = (target) => {
    if (Object.hasOwn(registry, target.model) && Object.hasOwn(adapters, target.harness)) {
      if (registry[target.model].catalog_harness && !activeModels.has(target.model)) return;
      pairs.set(setupKey(target), describeSetup(target, registry, adapters));
    }
  };
  for (const [model, entry] of Object.entries(registry)) {
    for (const harness of Object.keys(entry.harness_models ?? {})) add({ model, harness });
  }
  const active = paths(root).experiments;
  for (const dir of [active, path.join(active, 'archive')]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
      try {
        const { targets } = resolveExperiment(loadYamlFile(path.join(dir, entry.name)), registry);
        targets.forEach(add);
      } catch {
        // A broken preset is reported by validate and cannot contribute routable pairs.
      }
    }
  }
  return pairs;
}

export function selectedTargets(root, registry, adapters, selection) {
  if (!Array.isArray(selection) || !selection.length) throw new Error('Select at least one setup');
  const available = setupCatalog(root, registry, adapters);
  return selection.map((target) => {
    if (!target || !['harness', 'model', 'effort'].every(key => typeof target[key] === 'string')) {
      throw new Error('Each setup needs a harness, model and explicit effort');
    }
    const setup = available.get(setupKey(target));
    if (!setup || setup.harness !== target.harness || setup.model !== target.model) throw new Error('Choose a registered model and harness combination');
    if (!setup.choices.includes(target.effort)) throw new Error(`${setup.display_name} on ${setup.harness}: effort ${target.effort} is not a verified supported level`);
    return { model: setup.model, harness: setup.harness, effort: target.effort };
  });
}
