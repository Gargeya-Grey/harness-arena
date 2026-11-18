import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { loadAdapters } from '../adapters/index.mjs';
import { jsonLines, resolveCommand, runProcess } from '../adapters/process.mjs';
import { catalogModelKey, readModelCatalog, saveModelCatalog } from './model-catalog-store.mjs';

const TIMEOUT = 25_000;
const MODEL_ID = /^[a-zA-Z0-9][\w.:/@+\[\]-]{0,199}$/;
const LEVEL = /^[a-z][a-z0-9-]{0,31}$/;
const clientInfo = { name: 'model-lab', version: '1' };

async function output(bin, args, input) {
  const result = await runProcess(bin, args, { cwd: os.tmpdir(), input, timeoutMs: TIMEOUT });
  if (result.code !== 0) throw new Error(result.error?.type === 'timeout' ? 'Catalog request timed out.' : 'The CLI did not return a catalog.');
  return result.stdout;
}

// Keep stdio open until the last metadata response. Closing it after writing can
// stop app-server before it answers, particularly on Windows.
async function rpc(bin, args, conversation) {
  const { command, prefix } = resolveCommand(bin);
  const child = spawn(command, [...prefix, ...args], {
    cwd: os.tmpdir(), windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  const closed = new Promise(resolve => child.once('close', resolve));
  const fail = message => {
    for (const { reject } of pending.values()) reject(new Error(message));
    pending.clear();
  };
  child.on('error', () => fail('The CLI could not start.'));
  child.on('close', () => fail('The CLI closed before returning a catalog.'));
  child.stdin.on('error', () => fail('The CLI closed its catalog connection.'));
  lines.on('line', line => {
    const [response] = jsonLines(line);
    const request = pending.get(response?.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.error) {
      const obsoleteGemini = bin === 'gemini' && /no longer supported for Gemini Code Assist/i.test(response.error.message);
      request.reject(new Error(obsoleteGemini ? 'Gemini Code Assist refused this version of Gemini CLI for the signed-in account.' : 'The CLI refused the catalog request. Check its sign-in and configuration.'));
    }
    else request.resolve(response.result);
  });
  const timer = setTimeout(() => {
    fail('Catalog request timed out. Check the CLI sign-in.');
    child.kill();
  }, TIMEOUT);
  const send = message => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  let id = 0;
  try {
    return await conversation(
      (method, params) => new Promise((resolve, reject) => {
        pending.set(++id, { resolve, reject });
        send({ id, method, params });
      }),
      method => send({ method }),
    );
  } finally {
    clearTimeout(timer);
    lines.close();
    child.stdin.end();
    child.kill();
    await closed;
  }
}

const route = (id, provider, name, efforts) => ({ id, provider, name, efforts });
const codex = bin => rpc(bin, ['app-server', '--stdio'], async (request, notify) => {
  await request('initialize', { clientInfo });
  notify('initialized');
  const models = [];
  let cursor;
  do {
    const page = await request('model/list', { limit: 100, cursor });
    for (const item of page.data) {
      if (!item.hidden) models.push(route(item.model, 'openai', item.displayName, item.supportedReasoningEfforts?.map(level => level.reasoningEffort)));
    }
    cursor = page.nextCursor;
  } while (cursor);
  return models;
});

async function claude(bin) {
  const request = { type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } };
  const lines = jsonLines(await output(bin, [
    '--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--strict-mcp-config', '--no-session-persistence',
  ], JSON.stringify(request) + '\n'));
  const models = lines.find(item => item.response?.request_id === 'models')?.response?.response?.models;
  return models?.filter(model => model.value !== 'default').map(model =>
    route(model.value, 'anthropic', model.displayName, model.supportsEffort === false ? [] : model.supportedEffortLevels));
}

async function openCode(bin) {
  const { data } = JSON.parse(await output(bin, ['api', '--standalone', 'model.list']));
  return data?.filter(model => model.enabled !== false && (!model.type || model.type === 'chat')).map(model =>
    route(`${model.providerID}/${model.modelID ?? model.id}`, model.providerID, model.name, model.variants?.map(item => item.id)));
}

async function commandCode(bin) {
  const text = await output(bin, ['--no-auto-update', '--list-models']);
  const index = resolveCommand(bin)?.prefix[0];
  const reference = index && path.join(path.dirname(index), 'bundled', 'command-code-knowledge', 'reference', 'models.md');
  const facts = new Map();
  if (reference && fs.existsSync(reference)) {
    for (const [, id, label, levels] of fs.readFileSync(reference, 'utf8').matchAll(/^\| `([^`]+)` \| ([^|]+) \| [^|]+ \| ([^|]+) \|/gm)) {
      const effort = levels.trim();
      facts.set(id.toLowerCase(), { label: label.trim(), levels: effort === '\u2014' ? [] : effort.split(/,\s*/) });
    }
  }
  const table = text.split(/^Docs:/m, 1)[0];
  const ids = [...table.matchAll(/^(\S+)[ \t]{2,}\S/gm)].map(match => match[1]).filter(id => MODEL_ID.test(id));
  return ids.map(id => {
    const fact = facts.get(id.toLowerCase());
    const provider = id.includes('/') ? id.split('/')[0] : id.startsWith('claude-') ? 'anthropic' : id.startsWith('gpt-') ? 'openai' : 'commandcode';
    return route(id, provider, fact?.label, fact?.levels);
  });
}

const gemini = bin => rpc(bin, ['--acp', '--skip-trust'], async request => {
  await request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo });
  const session = await request('session/new', { cwd: os.tmpdir(), mcpServers: [] });
  const models = session.models?.availableModels;
  if (models) return models.map(model => route(model.modelId, 'google', model.name, []));
  const option = session.configOptions?.find(item => item.category === 'model');
  return option?.options?.flatMap(item => item.options ?? [item]).map(model => route(model.value, 'google', model.name, []));
});

const sources = { codex, opencode: openCode, 'claude-code': claude, 'command-code': commandCode, 'gemini-cli': gemini };

function registryEntry(harness, item) {
  if (typeof item.id !== 'string' || !MODEL_ID.test(item.id) || typeof item.provider !== 'string' || !MODEL_ID.test(item.provider)) return null;
  const levels = item.efforts;
  const verified = Array.isArray(levels) && levels.every(level => typeof level === 'string' && LEVEL.test(level) && !['default', 'unavailable'].includes(level));
  return {
    provider: item.provider, model: item.id, display_name: typeof item.name === 'string' ? item.name.slice(0, 160) : item.id,
    harness_models: { [harness]: item.id }, params: {}, pinned: false, catalog_harness: harness,
    ...(verified ? { effort_levels: [...new Set(levels)] } : {}),
  };
}

export async function refreshModelCatalog(root) {
  const adapters = Object.values(loadAdapters(root));
  const scanned = await Promise.all(adapters.map(async ({ name, bin }) => {
    if (!bin || !resolveCommand(bin)) return [name, { status: 'missing', message: 'CLI is missing from PATH.' }];
    if (!Object.hasOwn(sources, name)) return [name, { status: 'unsupported', message: 'This harness has no automatic catalog connector.' }];
    try {
      const rows = await sources[name](bin);
      const entries = Object.fromEntries((rows ?? []).flatMap(item => {
        const entry = registryEntry(name, item);
        return entry ? [[catalogModelKey(name, item.id), entry]] : [];
      }));
      if (!Object.keys(entries).length) throw new Error('The CLI returned no model IDs.');
      return [name, { status: 'ready', entries }];
    } catch (error) {
      const message = error instanceof SyntaxError || error instanceof TypeError ? 'The CLI returned an unrecognized catalog format.' : error.message;
      return [name, { status: 'failed', message }];
    }
  }));
  const catalog = readModelCatalog(root);
  for (const [name, { entries, ...status }] of scanned) {
    if (entries) Object.assign(catalog.models, entries);
    const keys = entries ? Object.keys(entries) : catalog.sources[name]?.keys ?? [];
    catalog.sources[name] = { ...status, keys };
  }
  catalog.refreshed_at = new Date().toISOString();
  saveModelCatalog(root, catalog);
  return catalog;
}
