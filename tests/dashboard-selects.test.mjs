import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from '../dashboard/server.mjs';
import { chromePath, launchBrowser } from '../tools/visual-web/browser.mjs';

let available = true;
try { chromePath(); } catch { available = false; }

async function waitFor(page, predicate) {
  const deadline = Date.now() + 10000;
  while (!(await page.evaluate(predicate))) {
    assert(Date.now() < deadline, 'The dashboard did not reach its expected state');
    await delay(50);
  }
}

async function key(page, name) {
  const code = { ArrowDown: 40, ArrowUp: 38, Enter: 13, Escape: 27, Tab: 9, Home: 36, End: 35 }[name];
  const key = { key: name, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
}

async function pickerBounds(page, id) {
  const tree = (await page.send('DOM.getDocument', { depth: -1, pierce: true })).root;
  const children = node => [...(node.children || []), ...(node.shadowRoots || []), ...(node.pseudoElements || [])];
  const find = (node, predicate) => predicate(node) ? node : children(node).map(child => find(child, predicate)).find(Boolean);
  const select = find(tree, node => node.nodeName === 'SELECT' && node.attributes?.some((value, index, values) => value === 'id' && values[index + 1] === id));
  const picker = find(select, node => node.attributes?.includes('picker(select)'));
  assert(picker, 'The open native picker is available for geometry inspection');
  const { model } = await page.send('DOM.getBoxModel', { nodeId: picker.nodeId });
  return { left: Math.min(...model.border.filter((_, index) => index % 2 === 0)), right: Math.max(...model.border.filter((_, index) => index % 2 === 0)),
    top: Math.min(...model.border.filter((_, index) => index % 2 === 1)), bottom: Math.max(...model.border.filter((_, index) => index % 2 === 1)) };
}

test('native Ladder filters retain focus, pair choices and summary scope through keyboard use', { skip: !available, timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-selects-'));
  fs.cpSync(fileURLToPath(new URL('./fixtures/repo', import.meta.url)), root, { recursive: true });
  const server = createServer({ root });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  let page;
  try {
    browser = await launchBrowser();
    page = await browser.page();
    await page.navigate(`http://127.0.0.1:${server.address().port}/ladder.html`);
    await waitFor(page, () => Boolean(document.querySelector('#tasks table')));
    assert.equal(await page.evaluate(() => document.querySelector('.ld-setups thead th:nth-child(2)').textContent), 'Counted tasks');
    assert.match(await page.evaluate(() => document.getElementById('ld-coverage').textContent), /Unfinished, lost or excluded attempts may exist outside these counts/);
    const controls = await page.evaluate(() => [...document.querySelectorAll('#tools [data-sel], #pair-pick [data-sel]')].map(element => ({
      tag: element.tagName, name: element.name, labelled: element.labels?.[0]?.textContent.trim(), id: element.id,
    })));
    assert.equal(controls.length, 6);
    assert(controls.every(control => control.tag === 'SELECT' && control.name && control.labelled), 'Every Ladder choice uses a labelled native select');
    const summary = await page.evaluate(() => document.getElementById('answer').textContent);
    await page.click('#sel-tier');
    await key(page, 'ArrowDown');
    await key(page, 'Enter');
    await waitFor(page, () => document.getElementById('sel-tier').value === '1');
    assert.deepEqual(await page.evaluate(() => ({ focus: document.activeElement.id, rows: document.querySelectorAll('#tasks tr[data-case]').length,
      summary: document.getElementById('answer').textContent, tier: new URLSearchParams(location.hash.slice(1)).get('tier') })), {
      focus: 'sel-tier', rows: 2, summary, tier: '1',
    });
    await key(page, 'Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'sel-info', 'Native Tab advances to the next field');
    for (const selector of ['#sel-a', '#sel-b']) {
      await page.click(selector);
      await key(page, 'ArrowDown');
      await key(page, 'Enter');
      assert.equal(await page.evaluate(() => document.activeElement.id), selector.slice(1));
    }
    const chosen = await page.evaluate(() => ({ a: document.getElementById('sel-a').value, b: document.getElementById('sel-b').value,
      card: Boolean(document.querySelector('[data-pair-card]')), summary: document.getElementById('answer').textContent }));
    assert(chosen.a && chosen.b && chosen.a !== chosen.b && chosen.card);
    assert.equal(chosen.summary, summary);
    await page.navigate(`http://127.0.0.1:${server.address().port}/ladder.html${await page.evaluate(() => location.hash)}`);
    await waitFor(page, () => Boolean(document.querySelector('[data-pair-card]')));
    assert.deepEqual(await page.evaluate(() => [document.getElementById('sel-a').value, document.getElementById('sel-b').value]), [chosen.a, chosen.b]);
    await page.click('#tasks details > summary');
    const disclosure = await page.evaluate(() => document.querySelector('#tasks details').id);
    await page.click('#ld-search');
    await page.send('Input.insertText', { text: 'fx' });
    await page.evaluate(() => {
      document.getElementById('ld-search').setSelectionRange(1, 1);
      window.beforeSelectRefresh = document.getElementById('ld-search');
      window.dispatchEvent(new Event('lab:job-finished'));
    });
    await waitFor(page, () => document.getElementById('ld-search') !== window.beforeSelectRefresh);
    assert.deepEqual(await page.evaluate(id => ({ focus: document.activeElement.id, value: document.getElementById('ld-search').value,
      caret: document.getElementById('ld-search').selectionStart, open: document.getElementById(id).open }), disclosure), {
      focus: 'ld-search', value: 'fx', caret: 1, open: true,
    });
    const colors = new Map();
    for (const theme of ['light', 'dark']) {
      for (const [width, height] of [[1440, 900], [390, 900], [390, 380]]) {
        await page.viewport(width, height);
        await page.evaluate(mode => {
          document.documentElement.dataset.theme = mode;
          const select = document.getElementById('sel-a');
          select.options[select.options.length - 1].textContent = 'Long setup ' + 'M'.repeat(96);
          select.selectedIndex = select.options.length - 1;
        }, theme);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.click('#sel-a');
        const popup = await page.evaluate(() => {
          const select = document.getElementById('sel-a');
          const picker = getComputedStyle(select, '::picker(select)');
          const option = select.options[select.options.length - 1];
          const range = document.createRange();
          range.selectNodeContents(option);
          return { open: select.matches(':open'), appearance: getComputedStyle(select).appearance,
            width: innerWidth, document: document.documentElement.scrollWidth, triggerHeight: select.getBoundingClientRect().height,
            pickerFont: picker.fontFamily, bodyFont: getComputedStyle(document.body).fontFamily, background: picker.backgroundColor,
            option: option.getBoundingClientRect().toJSON(), text: [...range.getClientRects()].map(rect => rect.toJSON()),
            minimumOptionHeight: Math.min(...[...select.options].map(item => item.getBoundingClientRect().height)) };
        });
        assert(popup.open && popup.appearance === 'base-select', `The native branded popup is actually open: ${JSON.stringify(popup)}`);
        assert.equal(popup.pickerFont, popup.bodyFont);
        assert.notEqual(popup.background, 'rgba(0, 0, 0, 0)');
        colors.set(theme, popup.background);
        assert(popup.document <= width + 1 && popup.triggerHeight === 44 && popup.minimumOptionHeight >= 44);
        assert(popup.option.left >= 0 && popup.option.right <= width, `${width}px picker stays within the viewport`);
        assert(popup.text.every(rect => rect.left >= popup.option.left && rect.right <= popup.option.right), 'Long unbroken option text wraps inside the popup');
        const bounds = await pickerBounds(page, 'sel-a');
        assert(bounds.left >= 0 && bounds.right <= width && bounds.top >= 0 && bounds.bottom <= height,
          `The ${width}x${height} popup stays inside the viewport: ${JSON.stringify(bounds)}`);
        await key(page, 'Home');
        await key(page, 'End');
        const last = await page.evaluate(() => document.getElementById('sel-a').options[document.getElementById('sel-a').options.length - 1].getBoundingClientRect().toJSON());
        assert(last.top >= bounds.top && last.bottom <= bounds.bottom, 'Keyboard scrolls the long last option into view');
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: last.x + last.width / 2, y: last.y + last.height / 2 });
        assert(await page.evaluate(() => {
          const select = document.getElementById('sel-a');
          const option = select.options[select.options.length - 1];
          return option.matches(':hover') && getComputedStyle(option).backgroundColor !== 'rgba(0, 0, 0, 0)';
        }), 'The native popup supplies its themed hover feedback');
        await key(page, 'Escape');
        assert.equal(await page.evaluate(() => document.getElementById('sel-a').matches(':open')), false, 'Native Escape closes the popup');
      }
    }
    assert.notEqual(colors.get('light'), colors.get('dark'), 'The open picker changes with the theme');
    await page.evaluate(() => {
      const sort = document.getElementById('sel-sort');
      sort.options[1].disabled = true;
      sort.selectedIndex = 0;
    });
    await page.click('#sel-sort');
    await key(page, 'ArrowDown');
    await key(page, 'Enter');
    assert.equal(await page.evaluate(() => document.getElementById('sel-sort').value), 'time', 'Native keyboard skips unavailable options');
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = 'select, select::picker(select) { appearance: auto !important; }';
      document.head.append(style);
      const select = document.getElementById('sel-tier');
      select.focus();
    });
    await key(page, 'ArrowDown');
    assert.deepEqual(await page.evaluate(() => ({ value: document.getElementById('sel-tier').value,
      appearance: getComputedStyle(document.getElementById('sel-tier')).appearance, focus: document.activeElement.id })), {
      value: '2', appearance: 'auto', focus: 'sel-tier',
    }, 'The OS-select fallback retains native keyboard selection and focus');
    assert.deepEqual(page.errors, []);
  } finally {
    await page?.close();
    const closed = browser ? await browser.close() : null;
    if (closed) assert(closed.browser_closed);
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    assert(path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('lab-selects-'));
    const bytesAt = directory => fs.readdirSync(directory, { withFileTypes: true }).reduce((sum, entry) => {
      const file = path.join(directory, entry.name);
      return sum + (entry.isDirectory() ? bytesAt(file) : fs.statSync(file).size);
    }, 0);
    const bytes = bytesAt(root);
    fs.rmSync(root, { recursive: true, force: true });
    t.diagnostic(JSON.stringify({ fixtureRemoved: !fs.existsSync(root), fixtureBytes: bytes, browser: closed }));
  }
});
