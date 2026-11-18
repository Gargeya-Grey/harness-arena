import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from '../dashboard/server.mjs';
import { chromePath, launchBrowser } from '../tools/visual-web/browser.mjs';

let available = true;
try { chromePath(); } catch { available = false; }

async function closeFixture(page, browser, server, root) {
  try {
    await page?.close();
    if (browser) assert((await browser.close()).browser_closed);
  } finally {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('Run edits individual and shared efforts, previews exactly the selected setups, and preserves the store', { skip: !available, timeout: 60000 }, async () => {
  const root = execFileSync(process.execPath, [fileURLToPath(new URL('../.agents/skills/verify-model-lab/scripts/temp-root.mjs', import.meta.url))], { encoding: 'utf8' }).trim();
  const before = fs.readdirSync(path.join(root, 'results')).sort();
  const server = createServer({ root });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  let page;
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await launchBrowser();
    page = await browser.page();
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('lab-exp', 'ladder-code-repaired-explicit-effort.yaml');" });
    await page.navigate(origin + '/#run');
    for (let i = 0; i < 100 && !(await page.evaluate(() => document.querySelector('#setup-effort-2'))); i++) await delay(50);
    const select = (id, value) => page.evaluate(([id, value]) => {
      const input = document.getElementById(id);
      if (![...input.options].some(option => option.value === value)) throw new Error(`${value} is missing from ${id}`);
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, [id, value]);
    const values = id => page.evaluate(id => [...document.getElementById(id).options].map(option => option.value), id);
    assert((await values('setup-effort-2')).includes('ultra'));
    assert(!(await values('setup-effort-0')).includes('ultra'));
    assert(!(await values('effort-select')).includes('ultra'));
    await select('effort-select', 'medium');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-row-effort]')].map(item => item.value)), ['medium', 'medium', 'medium']);
    await select('suite-select', 'visual-web');
    await select('exp-select', 'visual-web-terra-recovery.yaml');
    await page.click('#one-call-btn');
    await select('setup-harness', 'opencode');
    await select('setup-provider', 'opencode');
    await select('setup-model', 'beam-free');
    await select('setup-new-effort', 'low');
    await page.click('#add-setup');
    await select('setup-harness', 'codex');
    await select('setup-provider', 'openai');
    await select('setup-model', 'gpt-6.1-terra');
    await select('setup-new-effort', 'ultra');
    await page.click('#add-setup');
    await select('setup-effort-0', 'max');
    assert.equal(await page.evaluate(() => document.getElementById('plan-n').textContent), '3');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
      for (const width of [390, 1440]) {
        await page.viewport(width, 880);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      }
    }
    await page.click('#start-btn');
    assert.match(await page.evaluate(() => document.getElementById('start-btn').textContent), /Start 3 calls with edits\?/);
    assert.equal((await (await fetch(origin + '/api/jobs')).json()).running, null);
    await page.click('#preview-btn');
    let job;
    for (let i = 0; i < 100; i++) {
      const data = await (await fetch(origin + '/api/jobs')).json();
      job = data.jobs?.[0];
      if (job && !data.running) break;
      await delay(100);
    }
    const detail = await (await fetch(origin + '/api/jobs/' + job.id)).json();
    const log = JSON.stringify(detail);
    assert.match(log, /3 call\(s\) in 3 run\(s\)/);
    assert.match(log, /opencode: beam-free/);
    for (const effort of ['max', 'low', 'ultra']) assert.match(log, new RegExp(`effort[ =]+${effort}`, 'i'));
    assert.match(log, /nothing was called or written/);
    assert.deepEqual(fs.readdirSync(path.join(root, 'results')).sort(), before);
    await page.click('#clear-setups');
    assert(await page.evaluate(() => document.getElementById('preview-btn').disabled && document.getElementById('start-btn').disabled));
    assert.deepEqual(page.errors, []);
  } finally {
    await closeFixture(page, browser, server, root);
  }
});

test('ladder no-result disclosure keeps wide tables contained across tablet layouts', { skip: !available, timeout: 60000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-premium-browser-'));
  fs.cpSync(fileURLToPath(new URL('./fixtures/repo', import.meta.url)), root, { recursive: true });
  const server = createServer({ root });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  let page;
  try {
    browser = await launchBrowser();
    page = await browser.page();
    await page.navigate(`http://127.0.0.1:${server.address().port}/ladder.html`);
    for (let i = 0; i < 100 && !(await page.evaluate(() => Boolean(document.querySelector('#tasks table')))); i++) await delay(50);
    assert(await page.evaluate(() => Boolean(document.querySelector('#ld-no-counted'))));
    for (const width of [768, 900, 1024, 1100, 390, 320]) {
      await page.viewport(width, 900);
      for (const open of [false, true]) {
        const geometry = await page.evaluate(expanded => {
          document.getElementById('ld-no-counted').open = expanded;
          return { width: innerWidth, document: document.documentElement.scrollWidth,
            overflow: getComputedStyle(document.getElementById('tasks')).overflowX,
            name: document.getElementById('tasks').getAttribute('aria-label'),
            focusable: document.getElementById('tasks').tabIndex };
        }, open);
        assert(geometry.document <= width + 1, `${width}px expanded=${open}: document width ${geometry.document}`);
        if (width > 720) assert.equal(geometry.overflow, 'auto', 'Nested explanatory text cannot remove table containment');
        assert.equal(geometry.focusable, 0);
        assert.equal(geometry.name, 'Task evidence tables');
      }
    }
    assert.deepEqual(page.errors, []);
  } finally {
    await closeFixture(page, browser, server, root);
  }
});

test('long setup identities remain readable without widening Results or its phone cards', { skip: !available, timeout: 60000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-premium-browser-'));
  fs.cpSync(fileURLToPath(new URL('./fixtures/repo', import.meta.url)), root, { recursive: true });
  const server = createServer({ root });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  let page;
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const data = await (await fetch(origin + '/api/state')).json();
    const context = data.contexts.find(item => item.suite.id === 'smoke' && item.config_ids.length === 6);
    assert(context);
    browser = await launchBrowser();
    page = await browser.page();
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${(() => {
      const request = window.fetch;
      window.fetch = async (...args) => {
        const response = await request(...args);
        if (new URL(args[0], location.href).pathname !== '/api/state') return response;
        const state = await response.json();
        for (const [index, config] of Object.values(state.configs).entries()) config.display_name = index % 2 ? 'Model' + 'M'.repeat(59) : 'ExperimentalReasonerVersion20261116'.repeat(2);
        return new Response(JSON.stringify(state), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    }).toString()})();` });
    await page.navigate(origin + '/results.html#ctx=' + encodeURIComponent(context.key));
    for (let i = 0; i < 100 && !(await page.evaluate(() => Boolean(document.querySelector('#setups table')))); i++) await delay(50);
    assert(await page.evaluate(() => document.querySelector('.who-name')?.textContent.length > 60));
    for (const width of [1440, 768, 390, 320]) {
      await page.viewport(width, 900);
      await delay(220);
      const geometry = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth,
        clipped: [...document.querySelectorAll('.who-name, .who-text, .cell-who')].filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 1).map(element => element.className),
        chartLabelsOutside: [...document.querySelectorAll('.chart-identity text')].filter(element => {
          const text = element.getBoundingClientRect(), svg = element.closest('svg').getBoundingClientRect();
          return text.left < svg.left - 1 || text.right > svg.right + 1;
        }).map(element => element.textContent) }));
      assert(geometry.document <= width + 1, `${width}px long identities widen document to ${geometry.document}`);
      assert.deepEqual(geometry.clipped, [], `${width}px clipped identities`);
      assert.deepEqual(geometry.chartLabelsOutside, [], `${width}px chart identities exceed plot bounds`);
    }
    assert.deepEqual(page.errors, []);
  } finally {
    await closeFixture(page, browser, server, root);
  }
});

test('phone navigation accommodates doubled label text and keeps focused content clear', { skip: !available, timeout: 60000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-premium-browser-'));
  fs.cpSync(fileURLToPath(new URL('./fixtures/repo', import.meta.url)), root, { recursive: true });
  const server = createServer({ root });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  let page;
  try {
    browser = await launchBrowser();
    page = await browser.page();
    const origin = `http://127.0.0.1:${server.address().port}`;
    const state = await (await fetch(origin + '/api/state')).json();
    const smoke = state.contexts.find(context => context.suite.id === 'smoke' && context.config_ids.length === 6);
    assert(smoke);
    let attempt = 0;
    for (const [route, ready] of [['/#home', '#latest .recent-result'], ['/#run', '#exp-select option'], ['/#lab', '#harness-list .row'], [`/results.html#ctx=${encodeURIComponent(smoke.key)}`, '#setups table'], ['/ladder.html', '#tasks table']]) {
      for (const [width, height] of [[320, 844], [390, 844], [390, 380]]) {
        await page.viewport(width, height);
        const url = new URL(origin + route);
        url.searchParams.set('nav-stress', String(attempt++));
        await page.navigate(url.href);
        for (let i = 0; i < 100 && !(await page.evaluate(selector => Boolean(document.querySelector(selector)), ready)); i++) await delay(50);
        await page.evaluate(() => {
          for (const label of document.querySelectorAll('.nav-label')) {
            const style = getComputedStyle(label);
            label.style.fontSize = `${parseFloat(style.fontSize) * 2}px`;
            label.style.lineHeight = `${parseFloat(style.lineHeight) * 2}px`;
          }
        });
        await delay(80);
        const geometry = await page.evaluate(() => {
          const labels = [...document.querySelectorAll('.nav-label')].map(element => {
            const text = element.getBoundingClientRect(), target = element.closest('.nav-item').getBoundingClientRect();
            return { name: element.textContent, left: text.left, right: text.right, top: text.top, bottom: text.bottom,
              inside: text.left >= target.left - 1 && text.right <= target.right + 1 && text.top >= target.top - 1 && text.bottom <= target.bottom + 1 };
          });
          return { labels, width: innerWidth, document: document.documentElement.scrollWidth };
        });
        assert(geometry.document <= width + 1, `${route}/${width} document overflow`);
        assert(geometry.labels.every(label => label.inside), `${route}/${width} labels exceed their targets`);
        for (let i = 1; i < geometry.labels.length; i++) assert(geometry.labels[i - 1].right <= geometry.labels[i].left + 1, `${route}/${width} adjacent navigation labels intersect`);
        const focus = await page.evaluate(async () => {
          const last = [...document.querySelectorAll('main button:not([disabled]), main input, main summary')].filter(element => element.getClientRects().length).at(-1);
          document.activeElement?.blur();
          last?.focus();
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return last ? { bottom: last.getBoundingClientRect().bottom, navTop: document.querySelector('.nav').getBoundingClientRect().top } : null;
        });
        if (focus) assert(focus.bottom <= focus.navTop + 1, `${route}/${width} focus obscured by enlarged navigation`);
        if (route.startsWith('/results.html')) {
          await page.click('#choose-btn');
          const dialog = await page.evaluate(() => {
            const button = document.getElementById('choose-apply');
            button.focus();
            const box = button.getBoundingClientRect();
            return { modal: document.getElementById('pick-setups').matches(':modal'), bottom: box.bottom, height: innerHeight,
              unobscured: document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === button };
          });
          assert(dialog.modal && dialog.unobscured && dialog.bottom <= dialog.height, `Dialog footer remains above enlarged navigation: ${JSON.stringify(dialog)}`);
          await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
        }
      }
    }
    assert.deepEqual(page.errors, []);
  } finally {
    await closeFixture(page, browser, server, root);
  }
});
