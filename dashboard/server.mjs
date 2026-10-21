// Local-only dashboard server. Serves dashboard/public and a read-only index of
// results/ at /api/state. The only writes are human annotations (append-only)
// and saved boards.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildState } from '../lab/lib/state.mjs';
import { labRoot, paths } from '../lab/lib/repo.mjs';
import { SchemaSet } from '../lab/lib/schema.mjs';
import { appendJsonl, isoNow, resolveInside, safeSegment, writeJson } from '../lab/lib/fsutil.mjs';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
};

const APP_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'";
// Generated documents run sandboxed: no network, no same-origin access.
const GENERATED_HTML_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline'; img-src data: blob:; media-src blob:; connect-src 'none'; sandbox allow-scripts";
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";

function send(res, status, body, type, extra = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(body);
}

const sendJson = (res, status, data) => send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    // Collect bytes and decode once: a character split across two chunks stays whole.
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  let data;
  try {
    data = JSON.parse(await readBody(req));
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error('Invalid JSON body'), { status: 400 });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Object.assign(new Error('The body must be a JSON object'), { status: 400 });
  return data;
}

// A page on another site can send a simple POST (text/plain, no preflight) to 127.0.0.1.
// Requiring JSON forces a preflight the server never grants; the Origin check refuses the rest.
function refuseCrossSite(req) {
  const origin = req.headers.origin;
  if (origin !== undefined) {
    const m = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::(\d+))?$/.exec(origin);
    if (!m || (m[2] && Number(m[2]) !== req.socket.localPort)) return [403, 'Cross-site request refused'];
  }
  if (req.method === 'POST' && !/^application\/json\b/i.test(req.headers['content-type'] || '')) return [415, 'Content-Type must be application/json'];
  return null;
}

function serveFile(req, res, abs, extraHeaders = {}) {
  const stat = fs.statSync(abs);
  const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes', ...extraHeaders };
  if (type.startsWith('text/html')) headers['Content-Security-Policy'] = GENERATED_HTML_CSP;
  if (type === 'image/svg+xml') headers['Content-Security-Policy'] = SVG_CSP;
  const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (match && (match[1] || match[2])) {
    let start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
    let end = match[1] && match[2] ? Number(match[2]) : stat.size - 1;
    end = Math.min(end, stat.size - 1);
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stat.size}` });
    fs.createReadStream(abs, { start, end }).on('error', () => res.destroy()).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  // The file can vanish or be locked between stat and read; end this response, not the server.
  fs.createReadStream(abs).on('error', () => res.destroy()).pipe(res);
}

export function createServer({ root = labRoot() } = {}) {
  const p = paths(root);
  const schemas = new SchemaSet(p.schemas);
  const annotationFile = path.join(p.annotations, 'human@1.jsonl');

  function serveArtifact(req, res, url) {
    const runId = url.searchParams.get('run_id') || '';
    const rel = url.searchParams.get('path') || '';
    const runDir = resolveInside(p.results, safeSegment(runId));
    const abs = runDir && rel ? resolveInside(runDir, rel) : null;
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      sendJson(res, 404, { error: 'Artifact not found' });
      return;
    }
    serveFile(req, res, abs);
  }

  function serveStatic(req, res, url) {
    let decoded = null;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      // A malformed escape names no file.
    }
    const abs = decoded == null ? null : resolveInside(PUBLIC_DIR, decoded === '/' ? 'index.html' : decoded.slice(1));
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      return;
    }
    const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
    const body = fs.readFileSync(abs);
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': APP_CSP,
    });
    res.end(body);
  }

  async function postAnnotation(req, res) {
    const data = await readJsonBody(req);
    const hasRating = data.value != null;
    const hasPair = ['A', 'B', 'tie'].includes(data.pair_choice);
    if (!hasRating && !hasPair) {
      sendJson(res, 400, { error: 'A rating or a pairwise choice is required' });
      return;
    }
    const record = {
      annotation_id: crypto.randomUUID(),
      run_id: String(data.run_id ?? ''),
      case_id: String(data.case_id ?? ''),
      config_id: String(data.config_id ?? ''),
      repeat: Number(data.repeat),
      reviewer: typeof data.reviewer === 'string' && data.reviewer ? data.reviewer : 'owner',
      created_at: isoNow(),
      scale: '1-5',
      value: hasRating ? Number(data.value) : null,
      notes: typeof data.notes === 'string' ? data.notes : '',
      pair_id: data.pair_id ? String(data.pair_id) : null,
      pair_choice: hasPair ? data.pair_choice : null,
      pair_config_id: data.pair_config_id ? String(data.pair_config_id) : null,
      revealed: true,
      supersedes: data.supersedes ? String(data.supersedes) : null,
    };
    const errors = schemas.validate('annotation.schema.json', record);
    if (!record.run_id || !record.case_id || !record.config_id) errors.push('run_id, case_id and config_id are required');
    if (errors.length) {
      sendJson(res, 400, { error: errors.join('; ') });
      return;
    }
    appendJsonl(annotationFile, record);
    sendJson(res, 201, record);
  }

  async function postBoard(req, res) {
    const data = await readJsonBody(req);
    // An update names its board_id. A new board gets an id from its title, made unique,
    // so two titles that map to the same id (or a title with no Latin letters) never overwrite.
    let boardId = data.board_id ? safeSegment(data.board_id).slice(0, 80) : null;
    if (!boardId) {
      const base = safeSegment(data.title || '').replace(/^[-.]+|[-.]+$/g, '').slice(0, 72) || 'board';
      boardId = base;
      for (let n = 2; fs.existsSync(path.join(p.boards, `${boardId}.json`)); n += 1) boardId = `${base}-${n}`;
    }
    const file = path.join(p.boards, `${boardId}.json`);
    let createdAt = isoNow();
    if (fs.existsSync(file)) {
      try {
        createdAt = JSON.parse(fs.readFileSync(file, 'utf8')).created_at || createdAt;
      } catch {
        // A corrupt board is replaced by the new save.
      }
    }
    const record = {
      board_id: boardId,
      title: String(data.title || boardId),
      created_at: createdAt,
      updated_at: isoNow(),
      context: data.context,
      treatment_axis: String(data.treatment_axis || 'model'),
      configs: Array.isArray(data.configs) ? data.configs.map(String) : [],
      view: data.view && typeof data.view === 'object' ? data.view : {},
    };
    const errors = schemas.validate('board.schema.json', record);
    if (errors.length) {
      sendJson(res, 400, { error: errors.join('; ') });
      return;
    }
    writeJson(file, record);
    sendJson(res, 201, record);
  }

  function deleteBoard(res, rawId) {
    let id = rawId;
    try {
      id = decodeURIComponent(rawId);
    } catch {
      // Keep the raw id; safeSegment makes it a plain file name.
    }
    const file = path.join(p.boards, `${safeSegment(id)}.json`);
    if (!fs.existsSync(file)) {
      sendJson(res, 404, { error: 'Board not found' });
      return;
    }
    fs.unlinkSync(file);
    sendJson(res, 200, { deleted: path.basename(file, '.json') });
  }

  return http.createServer(async (req, res) => {
    try {
      const host = req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) {
        sendJson(res, 403, { error: 'Local access only' });
        return;
      }
      const url = new URL(req.url || '/', `http://${host}`);
      const route = `${req.method} ${url.pathname}`;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const refused = refuseCrossSite(req);
        if (refused) return sendJson(res, refused[0], { error: refused[1] });
      }
      if (route === 'GET /api/health') return sendJson(res, 200, { ok: true, root: path.basename(root), generated_at: isoNow() });
      if (route === 'GET /api/state') return sendJson(res, 200, buildState(root));
      if (route === 'GET /api/artifact') return serveArtifact(req, res, url);
      if (route === 'POST /api/annotations') return await postAnnotation(req, res);
      if (route === 'POST /api/boards') return await postBoard(req, res);
      if (req.method === 'DELETE' && url.pathname.startsWith('/api/boards/')) {
        return deleteBoard(res, url.pathname.slice('/api/boards/'.length));
      }
      if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Unknown API route' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
      return serveStatic(req, res, url);
    } catch (error) {
      if (!error.status) console.error(error);
      if (!res.headersSent) sendJson(res, error.status || 500, { error: error.message || 'Internal server error' });
    }
  });
}

export function startServer({ port = Number(process.env.PORT || 4317), root = labRoot() } = {}) {
  const server = createServer({ root });
  server.listen(port, HOST, () => {
    console.log(`Model Lab dashboard: http://${HOST}:${port}`);
    console.log(`Data root: ${root}`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer();
}
