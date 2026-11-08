// Scaffolds one test case: the cases.jsonl line, and for an agent task the starter
// workspace and the hidden check. Every value to write by hand is the marker
// FILL_IN; `node lab validate` reports each one left, so a half-made case
// never runs.

import fs from 'node:fs';
import path from 'node:path';
import { freezeSuite, loadPrompt, loadSuite, paths, suiteDir as findSuiteDir } from '../lib/repo.mjs';

export const FILL_IN = '<<FILL IN>>';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** The patch bump of a suite.yaml, or null when its version is not x.y.z. */
function patchBump(file) {
  const text = fs.readFileSync(file, 'utf8');
  const match = /^version:\s*"?(\d+)\.(\d+)\.(\d+)"?\s*$/m.exec(text);
  if (!match) return null;
  const next = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
  return { from: `${match[1]}.${match[2]}.${match[3]}`, to: next, text: text.replace(match[0], `version: "${next}"`) };
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

/** Returns the files it wrote, relative to the data root. */
export function newCase(root, suiteId, slug, { agent = false, prompt = null, log = console.log } = {}) {
  if (!suiteId || !slug) throw new Error('Usage: node lab new-case <suite> <slug> [--agent] [--prompt <id>]');
  if (!SLUG.test(slug)) throw new Error(`slug "${slug}" must be lowercase letters, digits and dashes`);
  const suiteDir = findSuiteDir(root, suiteId);
  if (!suiteDir) throw new Error(`No suite "${suiteId}": datasets/${suiteId}/suite.yaml does not exist`);
  if (suiteDir.startsWith(paths(root).datasetsArchive + path.sep)) throw new Error(`Suite "${suiteId}" is archived (datasets/archive/${suiteId}); an archived suite takes no new case`);
  const suite = loadSuite(root, suiteId);
  const caseId = `${suiteId}-${slug}`;
  if (suite.cases.some((item) => item.case_id === caseId)) throw new Error(`${caseId} already exists in datasets/${suiteId}/cases.jsonl`);
  const isAgent = agent || suite.cases.some((item) => item.input?.workspace != null);
  // The input fields: the prompt's variables, else those of the suite's first case.
  let fields = prompt ? loadPrompt(root, prompt).variables : Object.keys(suite.cases[0]?.input || {});
  if (!fields.length) throw new Error(`Suite ${suiteId} has no case to copy fields from; name its prompt with --prompt <id>`);
  fields = fields.filter((name) => name !== 'workspace');
  const input = Object.fromEntries(fields.map((name) => [name, FILL_IN]));
  if (isAgent) input.workspace = slug;
  const item = { case_id: caseId, input, expected: isAgent ? { check: slug } : FILL_IN, tags: [] };

  const workspace = path.join(suiteDir, 'workspaces', slug);
  const check = path.join(suiteDir, 'checks', slug);
  if (isAgent && (fs.existsSync(workspace) || fs.existsSync(check))) throw new Error(`workspaces/${slug} or checks/${slug} already exists`);

  const rel = (file) => path.relative(root, file).replace(/\\/g, '/');
  const written = [];
  // The old version is frozen before any file changes, so its runs still score and show.
  const suiteFile = path.join(suiteDir, 'suite.yaml');
  const bump = patchBump(suiteFile);
  if (!bump) throw new Error(`${rel(suiteFile)}: version "${suite.version}" is not x.y.z, so new-case cannot bump it; add the case by hand and follow AGENTS.md`);
  const frozen = freezeSuite(root, suiteId);
  const casesFile = path.join(suiteDir, 'cases.jsonl');
  const existing = fs.existsSync(casesFile) ? fs.readFileSync(casesFile, 'utf8') : '';
  fs.writeFileSync(casesFile, `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${JSON.stringify(item)}\n`, 'utf8');
  written.push(rel(casesFile));
  if (isAgent) {
    write(path.join(workspace, 'package.json'), `${JSON.stringify({ name: slug, private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`);
    write(path.join(workspace, 'src', `${slug}.mjs`), `// ${FILL_IN}: the starter code the agent gets. It must fail the hidden check until the task is done.\nexport function example() {}\n`);
    write(
      path.join(check, 'probe.mjs'),
      [
        '// Hidden check: each probe loads a file from the final workspace and returns a value.',
        '// expected.json holds the value each probe must return. The agent never sees this folder.',
        'export const probes = [',
        '  {',
        `    name: '${FILL_IN}',`,
        `    async run({ load }) {`,
        `      const mod = await load('src/${slug}.mjs');`,
        `      return mod.example(); // ${FILL_IN}`,
        '    },',
        '  },',
        '];',
        '',
      ].join('\n'),
    );
    write(path.join(check, 'expected.json'), `${JSON.stringify({ probes: { [FILL_IN]: FILL_IN }, files: {} }, null, 2)}\n`);
    written.push(rel(path.join(workspace, 'package.json')), rel(path.join(workspace, 'src', `${slug}.mjs`)), rel(path.join(check, 'probe.mjs')), rel(path.join(check, 'expected.json')));
  }
  fs.writeFileSync(suiteFile, bump.text, 'utf8');
  log(`Added ${caseId}${isAgent ? ' (agent task)' : ''}:`);
  for (const file of written) log(`  ${file}`);
  log(`  ${rel(suiteFile)}: version ${bump.from} -> ${bump.to}`);
  log(`  ${rel(frozen.dir)}/: ${frozen.created ? 'frozen copy' : 'frozen copy, already there'} of ${bump.from}`);
  log(`\nReplace every ${FILL_IN}, then run: node lab validate`);
  if (isAgent) log('Prove the case can be won: add a known-good solution under tests/fixtures/agentic-solutions/ and run npm test.');
  return written;
}

/** Every FILL_IN marker left in a suite: cases.jsonl lines, and the agent tasks' checks and workspaces. */
export function unfilled(files) {
  const found = [];
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    text.split('\n').forEach((line, index) => {
      if (line.includes(FILL_IN)) found.push({ file, line: index + 1 });
    });
  }
  return found;
}
