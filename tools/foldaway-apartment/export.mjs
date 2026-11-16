import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { labRoot } from '../../lab/lib/repo.mjs';
import { reportDestination } from '../visual-web/inspect.mjs';

const root = fileURLToPath(new URL('../../examples/foldaway-apartment/',import.meta.url));

export function standaloneApartment() {
  const modules = new Map();
  const visiting = new Set();
  const bundle = (file) => {
    if (modules.has(file)) return modules.get(file);
    if (!file.startsWith(path.resolve(root)+path.sep) || path.extname(file) !== '.mjs') throw new Error('Reference modules must stay inside the example');
    if (visiting.has(file)) throw new Error('The reference export does not support circular imports');
    visiting.add(file);
    const source = fs.readFileSync(file,'utf8').replace(/\b(from\s*|import\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\2/g, (match,prefix,quote,relative) => `${prefix}${quote}${bundle(path.resolve(path.dirname(file),relative))}${quote}`);
    const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    visiting.delete(file); modules.set(file,url); return url;
  };
  const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
  if (!html.includes('<link rel="stylesheet" href="./style.css">') || !html.includes('<script type="module" src="./app.mjs"></script>')) throw new Error('Reference entry points changed; update the export');
  return html.replace('<link rel="stylesheet" href="./style.css">',`<style>${fs.readFileSync(path.join(root,'style.css'),'utf8')}</style>`).replace('<script type="module" src="./app.mjs"></script>',`<script type="module">import('${bundle(path.join(root,'app.mjs'))}');</script>`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if (!args.includes('--out')) throw new Error('Usage: node tools/foldaway-apartment/export.mjs --out <new-html-path>');
  const output = reportDestination(labRoot(),args[args.indexOf('--out')+1]);
  if (fs.existsSync(output)) throw new Error('Choose a new HTML path');
  fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,standaloneApartment()); console.log(output);
}
