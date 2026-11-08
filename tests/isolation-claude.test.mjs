// An isolated Claude Code call keeps every instruction file out. The flags alone do not:
// the call folder is under the home folder on Windows, so ~/.claude/CLAUDE.md is found as a
// parent folder's file.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTERS } from '../lab/adapters/index.mjs';

test('claude-code isolation turns off CLAUDE.md files and auto memory, and the run records it', () => {
  const { isolation } = ADAPTERS['claude-code'];
  assert.deepEqual(isolation.env, { CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
  assert.ok(isolation.args.includes('CLAUDE_CODE_DISABLE_CLAUDE_MDS=1') && isolation.args.includes('CLAUDE_CODE_DISABLE_AUTO_MEMORY=1'), isolation.args.join(' '));
  assert.ok(!isolation.flags.some((flag) => flag.startsWith('CLAUDE_CODE_')), 'an env var never goes on the command line');
  assert.match(isolation.note, /CLAUDE\.md files and auto memory/);
});
