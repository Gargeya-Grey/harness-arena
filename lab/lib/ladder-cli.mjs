// The shared tail of each ladder suite's generate.mjs:
//   node datasets/<suite>/generate.mjs           prints cases.jsonl to stdout
//   node datasets/<suite>/generate.mjs --write   writes cases.jsonl next to generate.mjs
//   node datasets/<suite>/generate.mjs --check   exits 1 when cases.jsonl differs from the output

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function generateMain(metaUrl, buildText) {
  if (!process.argv[1] || path.resolve(process.argv[1]) !== fileURLToPath(metaUrl)) return;
  const file = path.join(path.dirname(fileURLToPath(metaUrl)), 'cases.jsonl');
  const text = await buildText();
  if (process.argv.includes('--write')) fs.writeFileSync(file, text);
  else if (process.argv.includes('--check')) {
    const stored = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (stored !== text) {
      console.error(`${path.relative(process.cwd(), file)} is not what generate.mjs prints; run it with --write`);
      process.exit(1);
    }
  } else process.stdout.write(text);
}
