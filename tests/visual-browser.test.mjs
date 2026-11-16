import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, chromePath, serve } from '../tools/visual-web/browser.mjs';
import { inspectPage } from '../tools/visual-web/checks.mjs';
import { reportDestination, observationKey } from '../tools/visual-web/inspect.mjs';

let available = false;
try { chromePath(); available = true; } catch { /* CI can run the source tests without a local browser. */ }

test('browser proof accepts a real event page and rejects broken semantics and overflow', { skip: !available, timeout: 45000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-visual-browser-test-'));
  const good = '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Event</title><style>body{margin:1rem;font-family:system-ui}section{margin-top:5rem}a:focus-visible{outline:3px solid blue}</style><header>Forma</header><main><h1>Open House Evening</h1><time datetime="2026-12-05T18:00:00">5 December at 18:00</time><p>Welcome</p><a href="#tickets">Reserve a ticket</a><section id="tickets">Tickets are free.</section></main><footer>Forma</footer></html>';
  fs.writeFileSync(path.join(root, 'index.html'), good);
  const server = await serve(root);
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.page();
    await page.navigate(server.url);
    const valid = await inspectPage(page, { case_id: 'visual-web-event-page' });
    assert.deepEqual(valid.filter((item) => !item.passed), []);
    fs.writeFileSync(path.join(root, 'index.html'), good.replace('<header>', '<div>').replace('</header>', '</div>').replace('href="#tickets"', 'href="#missing"').replace('body{', 'body{min-width:1800px;'));
    await page.navigate(server.url);
    const broken = await inspectPage(page, { case_id: 'visual-web-event-page' });
    for (const name of ['semantic landmarks and title', 'ticket destination', 'ticket link works', 'no document overflow at 390px']) assert.equal(broken.find((item) => item.name === name).passed, false, name);
    await page.close();
  } finally {
    try { await browser?.close(); } finally {
      await server.close();
      assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('blank canvas and fake scene hooks cannot pass Three render checks', { skip: !available, timeout: 45000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-visual-blank-test-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><h1>Room</h1><canvas></canvas><script>window.__scene={scene:{},camera:{},renderer:{}}</script>');
  const server = await serve(root);
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.page();
    await page.navigate(server.url);
    const checks = await inspectPage(page, { case_id: 'visual-web-three-room' });
    for (const name of ['real Three scene and renderer', 'furnished room geometry and light', 'nonblank WebGL render', 'night mode changes rendered lighting', 'rotate view moves camera']) assert.equal(checks.find((item) => item.name === name).passed, false, name);
    await page.close();
  } finally {
    try { await browser?.close(); } finally {
      await server.close();
      assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('reports cannot write anywhere inside an immutable run store and repeated configurations have distinct keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-visual-report-test-'));
  try {
    fs.mkdirSync(path.join(root, 'results', 'unrelated-run'), { recursive: true });
    assert.throws(() => reportDestination(root, path.join(root, 'results', 'unrelated-run', 'new-report')), /outside every immutable run store/);
    assert.equal(fs.existsSync(path.join(root, 'results', 'unrelated-run', 'new-report')), false);
    assert.equal(reportDestination(root, path.join(root, '.cache', 'report')), path.join(root, '.cache', 'report'));
    const row = { run_id: 'run-a', model_key: 'same-model', case_id: 'same-case', repeat: 0 };
    assert.notEqual(observationKey(row), observationKey({ ...row, run_id: 'run-b' }));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('accessible labels and formatted headings work and pre-reload console errors are retained', { skip: !available, timeout: 45000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-visual-label-test-'));
  fs.writeFileSync(path.join(root, 'index.html'), `<!doctype html><meta name="viewport" content="width=device-width"><h1>Spaces for\n slower living</h1><nav><a href="#projects">Projects</a><a href="#about">About</a><a href="#contact">Contact</a></nav><section id="projects"><span id="label">Project type</span><select aria-labelledby="label"><option value="all">All</option><option value="homes">Homes</option><option value="work">Workspaces</option></select><article data-type="homes">Courtyard home</article><article data-type="homes">Harbor loft</article><article data-type="work">Cedar workspace</article></section><section id="about">About</section><section id="contact">Contact</section><script>document.querySelector('select').onchange=e=>document.querySelectorAll('article').forEach(a=>a.hidden=e.target.value!=='all'&&a.dataset.type!==e.target.value);if(!sessionStorage.seen){console.error('before reload sentinel');sessionStorage.seen='1';}</script>`);
  const server = await serve(root);
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.page();
    await page.navigate(server.url);
    await page.navigate(server.url);
    const checks = await inspectPage(page, { case_id: 'visual-web-interior-studio' });
    assert.deepEqual(checks.filter((item) => !item.passed).map((item) => item.name), ['no JavaScript or WebGL console errors']);
    assert.ok(page.errors.includes('before reload sentinel'));
    await page.close();
  } finally {
    try { await browser?.close(); } finally {
      await server.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('a stopped browser reports a retained profile separately when deletion fails', {skip:!available,timeout:45000},async(t)=>{
  const browser=await launchBrowser();
  const original=fs.rmSync;
  const replacement=t.mock.method(fs,'rmSync',()=>{throw Object.assign(new Error('Synthetic profile cleanup denial'),{code:'EPERM'});});
  let cleanup;
  try {
    cleanup=await browser.close();
    assert.equal(cleanup.browser_closed,true);
    assert.equal(cleanup.profile_removed,false);
    assert.ok(fs.existsSync(cleanup.retained_profile));
    assert.match(cleanup.profile_cleanup_error,/Synthetic profile cleanup denial/);
  } finally {
    replacement.mock.restore();
    if(cleanup?.retained_profile) {
      assert.equal(path.dirname(cleanup.retained_profile),fs.realpathSync(os.tmpdir()));
      original(cleanup.retained_profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});
    }
  }
});
