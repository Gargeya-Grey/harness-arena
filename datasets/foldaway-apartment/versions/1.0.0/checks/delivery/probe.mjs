import fs from 'node:fs';

export const probes = [{
  name: 'index.html is nonempty',
  run() {
    try { return fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8').trim().length > 0; }
    catch { return false; }
  },
}];
