import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export function chromePath() {
  const choices = [process.env.LAB_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'];
  const found = choices.find((file) => file && fs.existsSync(file));
  if (!found) throw new Error('Set LAB_CHROME to a Chromium executable. No browser is installed by this command.');
  return found;
}

export async function serve(root) {
  const base = fs.realpathSync(root);
  const server = http.createServer((req, res) => {
    try {
      if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || '')) { res.writeHead(403).end(); return; }
      const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.resolve(base, rel);
      const inside = (item) => item.startsWith(base + path.sep);
      if (!inside(file) || !inside(fs.realpathSync(file))) { res.writeHead(403).end(); return; }
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }) };
}

export async function launchBrowser() {
  const executable = chromePath();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-visual-chrome-'));
  const child = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  const exited = new Promise((resolve) => { child.once('exit', () => resolve(true)); child.once('close', () => resolve(true)); child.once('error', () => resolve(true)); });
  let spawnError;
  child.once('error', (error) => { spawnError = error; });
  let browserSocket;
  const sockets = new Set();
  const pending = new Map();
  let nextId = 0;
  async function connect(url) {
    const socket = new WebSocket(url);
    sockets.add(socket);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('DevTools WebSocket did not connect within 10 seconds')); }, 10000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('DevTools WebSocket connection failed')); }, { once: true });
      socket.addEventListener('close', () => { clearTimeout(timer); reject(new Error('DevTools WebSocket closed before connecting')); }, { once: true });
    });
    const listeners = new Map();
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.id) {
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
      } else for (const listener of listeners.get(message.method) || []) listener(message.params);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 20000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
    return { send, on: (method, fn) => listeners.set(method, [...(listeners.get(method) || []), fn]) };
  }
  const close = async () => {
    try { await browserSocket?.send('Browser.close'); } catch { /* Chrome may close its socket before replying. */ }
    for (const socket of sockets) socket.close();
    const isRunning = () => {
      if (child.exitCode !== null || child.signalCode !== null) return false;
      try { process.kill(child.pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
    };
    let stopped = !isRunning() || await Promise.race([exited, delay(5000).then(() => false)]);
    if (!stopped) { child.kill(); stopped = await Promise.race([exited, delay(5000).then(() => false)]); }
    stopped = stopped || !isRunning();
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Browser closed')); }
    pending.clear();
    if (!stopped) throw new Error(`Browser did not stop; retained its profile at ${profile}`);
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      return { browser_closed: true, profile_removed: true };
    } catch (error) {
      const cleanup = { browser_closed: true, profile_removed: false, retained_profile: profile, profile_cleanup_error: error.message };
      console.warn(`Browser stopped; retained its profile after cleanup failed: ${profile} (${error.code || error.message})`);
      return cleanup;
    }
  };
  try {
    const active = path.join(profile, 'DevToolsActivePort');
    const deadline = Date.now() + 15000;
    while (!fs.existsSync(active)) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`Chromium exited ${child.exitCode}`);
      if (Date.now() > deadline) throw new Error('Chromium did not open its debugging port');
      await delay(50);
    }
    const [port, socketPath] = fs.readFileSync(active, 'utf8').trim().split('\n');
    browserSocket = await connect(`ws://127.0.0.1:${port}${socketPath}`);
    const version = await browserSocket.send('Browser.getVersion');
    return {
      version,
      close,
      async page() {
          const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT', signal: AbortSignal.timeout(10000) })).json();
        const cdp = await connect(target.webSocketDebuggerUrl);
        const errors = [];
        cdp.on('Runtime.exceptionThrown', (event) => errors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text));
        cdp.on('Runtime.consoleAPICalled', (event) => { if (event.type === 'error') errors.push(event.args.map((arg) => arg.value || arg.description || '').join(' ')); });
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        const evaluate = async (fn, arg) => {
          const expression = typeof fn === 'function' ? `(${fn.toString()})(${JSON.stringify(arg) ?? ''})` : fn;
          const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
          if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
          return result.result.value;
        };
        return {
          errors,
          evaluate,
          send: cdp.send,
          async viewport(width, height) {
            await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
            await evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          },
          async navigate(url) {
            const result = await cdp.send('Page.navigate', { url });
            if (result.errorText) throw new Error(result.errorText);
            const deadline = Date.now() + 20000;
            while (!(await evaluate(() => document.readyState === 'complete'))) {
              if (Date.now() > deadline) throw new Error('Page did not finish loading');
              await delay(50);
            }
            await evaluate(() => document.fonts.ready.then(() => true));
          },
          async click(selector) {
            const box = await evaluate((sel) => {
              const el = document.querySelector(sel);
              if (!el) throw new Error(`Missing ${sel}`);
              el.scrollIntoView({ block: 'center' });
              const b = el.getBoundingClientRect();
              return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
            }, selector);
            await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...box, button: 'left', clickCount: 1 });
            await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...box, button: 'left', clickCount: 1 });
            await delay(100);
          },
          async screenshot(file, fullPage = false) {
            const { cssContentSize } = fullPage ? await cdp.send('Page.getLayoutMetrics') : {};
            const clip = cssContentSize ? { x: 0, y: 0, width: cssContentSize.width, height: Math.min(cssContentSize.height, 6000), scale: 1 } : null;
            const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage, ...(clip ? { clip } : {}) });
            fs.writeFileSync(file, Buffer.from(data, 'base64'));
          },
          async close() { await browserSocket.send('Target.closeTarget', { targetId: target.id }); },
        };
      },
    };
  } catch (error) { await close(); throw error; }
}
