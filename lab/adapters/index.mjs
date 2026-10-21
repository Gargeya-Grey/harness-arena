import claudeCode from './claude-code.mjs';
import codex from './codex.mjs';
import commandCode from './command-code.mjs';
import geminiCli from './gemini-cli.mjs';
import { anthropicApi, deepseekApi, openaiApi, openrouterApi } from './http-api.mjs';

/** Every harness the runner can drive, keyed by the name experiments use. */
export const ADAPTERS = Object.fromEntries(
  [claudeCode, codex, commandCode, geminiCli, anthropicApi, openaiApi, openrouterApi, deepseekApi].map((adapter) => [adapter.name, adapter]),
);

export function getAdapter(name) {
  const adapter = ADAPTERS[name];
  if (!adapter) {
    throw new Error(`Unknown harness "${name}". Known: ${Object.keys(ADAPTERS).join(', ')}`);
  }
  return adapter;
}
