import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from '../dashboard/server.mjs';
import { resetHistory, deleteRun, storageSummary } from '../lab/lib/storage.mjs';
import { chromePath, launchBrowser } from '../tools/visual-web/browser.mjs';

let available = true;
try { chromePath(); } catch { available = false; }
const fixture = fileURLToPath(new URL('./fixtures/repo', import.meta.url));
async function until(check) {
  const deadline = Date.now() + 10000;
  while (!(await check())) { assert(Date.now() < deadline, 'the visible action settles'); await delay(50); }
}

test('successful and partial history deletion invalidate old evidence even when every refresh fails', { skip: !available, timeout: 120000 }, async () => {
  for (const mode of ['reset', 'partial-reset', 'partial-delete']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-history-browser-'));
    fs.cpSync(fixture, root, { recursive: true });
    const server = createServer({ root });
    const handler = server.listeners('request')[0];
    let changed = false;
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      if (req.url === '/api/state' && changed) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Synthetic refresh failure after physical deletion' }));
        return;
      }
      if (mode.startsWith('partial') && req.url === `/api/storage/${mode === 'partial-reset' ? 'reset' : 'delete'}`) {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const request = JSON.parse(body);
          const partial = mode === 'partial-reset' ? resetHistory(root, request) : deleteRun(root, request.run_id, request);
          changed = true;
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Synthetic failure after deleted files', partial }));
        });
        return;
      }
      if (req.url === '/api/storage/reset') res.on('finish', () => { if (res.statusCode === 200) changed = true; });
      handler(req, res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    let page;
    try {
      browser = await launchBrowser();
      page = await browser.page();
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (mode === 'partial-delete') {
        const data = await (await fetch(origin + '/api/state')).json();
        const context = data.contexts.find(item => item.suite.id === 'smoke');
        await page.navigate(origin + '/results.html#ctx=' + encodeURIComponent(context.key));
        await until(() => page.evaluate(() => Boolean(document.querySelector('[data-act="delete-run"]'))));
        await page.click('[data-section="runs"]');
        await page.click('[data-act="delete-run"]');
        await until(() => page.evaluate(() => document.getElementById('delete-run').open));
        await page.click('#delete-run-confirm');
        await until(() => page.evaluate(() => document.getElementById('delete-run-status').textContent.includes('Deletion did not finish')));
        const visible = await page.evaluate(() => ({ answer: document.getElementById('answer').textContent, charts: document.getElementById('charts-main').textContent, error: document.getElementById('empty').textContent }));
        assert.equal(visible.answer, '', mode + ' clears the old verdict');
        assert.equal(visible.charts, '', mode + ' clears old graphs');
        assert.match(visible.error, /did not load|refresh failure/i);
      } else {
        await page.navigate(origin + '/#lab');
        await until(() => page.evaluate(() => !document.getElementById('storage-reset').disabled && document.getElementById('latest').textContent.includes('Suite')));
        await page.evaluate(() => { document.getElementById('storage').open = true; });
        await page.click('#storage-reset');
        await until(() => page.evaluate(() => document.getElementById('reset-dialog').open));
        await page.evaluate(() => { const input = document.getElementById('reset-confirm'); input.value = 'DELETE ALL RUNS'; input.dispatchEvent(new Event('input', { bubbles: true })); });
        await page.click('#reset-submit');
        await until(() => page.evaluate(() => !document.getElementById('reset-dialog').open || document.getElementById('reset-error').textContent.includes('could not')));
        const latest = await page.evaluate(() => document.getElementById('latest').textContent);
        assert(!latest.includes('Suite'), mode + ' clears old Home verdicts');
        assert.match(latest, /unavailable|did not load/i);
        assert.equal(storageSummary(root).run_count, 0);
      }
      assert(changed, mode + ' really changed the disposable store');
    } finally {
      try { await page?.close(); if (browser) assert((await browser.close()).browser_closed); }
      finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); fs.rmSync(root, { recursive: true, force: true }); }
    }
  }
});
