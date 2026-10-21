// bin/lib/visual-decide/server.js — the actual loopback HTTP server: key gate,
// static serve with traversal rejection, event capture, SSE reload, idle timeout.
// Runs inside the detached daemon child (see cli.js's runDaemon) or directly
// in-process for tests. Node builtins only (#1202 AC 8).
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const WATCH_INTERVAL_MS = 500;
const SSE_KEEPALIVE_MS = 15000;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.txt': 'text/plain; charset=utf-8',
};

function contentTypeFor(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

// Resolves a request path against rootDir, rejecting any escape (encoded or
// not) via path.relative — normalize() already collapses internal '..'
// segments, so the relative-check below is the single source of truth for
// "did this stay inside rootDir". Containment is decided by the first path
// segment being exactly '..' (or a cross-drive absolute rel), mirroring
// path-guard's isAncestorOrSelf, which this module cannot import because it is
// Node builtins only (#1202 AC 8). So a child named like '..foo' is served
// (#3642).
function resolveSafe(rootDir, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const full = path.normalize(path.join(rootDir, decoded));
  const rel = path.relative(rootDir, full);
  if (rel === '') return full;
  if (rel.split(path.sep)[0] === '..' || path.isAbsolute(rel)) return null;
  return full;
}

// Cheap recursive-mtime signature — a string that changes iff any file's
// mtime, path set, or count changed under rootDir. Polling over fs.watch:
// fs.watch is unreliable/coalescing on macOS, and this repo's tests run on
// macOS + Linux CI (spec Gotchas).
//
// `excludeDir`, when given, skips that subtree entirely — a consumer that
// nests its own state dir (events/server-info/server-stopped) inside the
// served dir would otherwise have every /events POST change that file's
// mtime and trigger a reload of its own resulting page (review finding).
function watchSignature(rootDir, excludeDir) {
  let sig = '';
  const resolvedExclude = excludeDir ? path.resolve(excludeDir) : null;
  (function walk(dir) {
    if (resolvedExclude && path.resolve(dir) === resolvedExclude) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        try {
          sig += `${full}:${fs.statSync(full).mtimeMs};`;
        } catch {
          // file disappeared mid-walk — ignore, next poll settles
        }
      }
    }
  })(rootDir);
  return sig;
}

/**
 * Starts the server. Returns a promise resolving to { server, info, key, stop }.
 * `stop` is idempotent and writes the server-stopped marker before closing.
 */
function startServer({ dir, stateDir, port, idleMinutes }) {
  const key = crypto.randomBytes(24).toString('hex');
  const eventsPath = path.join(stateDir, 'events');
  const infoPath = path.join(stateDir, 'server-info');
  const stoppedPath = path.join(stateDir, 'server-stopped');

  let idleTimer = null;
  let watchTimer = null;
  let lastSig = watchSignature(dir, stateDir);
  let stopped = false;
  const sseClients = new Set();

  function resetIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    const ms = Math.max(1, Math.round(idleMinutes * 60 * 1000));
    idleTimer = setTimeout(stop, ms);
    if (idleTimer.unref) idleTimer.unref();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (idleTimer) clearTimeout(idleTimer);
    if (watchTimer) clearInterval(watchTimer);
    for (const client of sseClients) {
      try {
        client.end();
      } catch {
        // already gone
      }
    }
    try {
      fs.writeFileSync(stoppedPath, '');
    } catch {
      // best-effort — a failed marker write must not prevent shutdown
    }
    server.close();
  }

  function authenticate(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.searchParams.get('key') === key) {
      res.setHeader('Set-Cookie', `vd_key=${key}; HttpOnly; SameSite=Strict; Path=/`);
      return true;
    }
    const cookieHeader = req.headers.cookie || '';
    const found = cookieHeader
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('vd_key='));
    return found === `vd_key=${key}`;
  }

  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://127.0.0.1');

    if (!authenticate(req, res)) {
      // Idle timer resets only on authenticated traffic — an unauthenticated
      // prober (wrong/no key) must not be able to defeat the idle-timeout
      // backstop by hammering the port with no key (review finding).
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('unauthorized');
      return;
    }
    resetIdle();

    if (req.method === 'POST' && pathname === '/events') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('not a JSON object');
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('bad request');
          return;
        }
        try {
          fs.appendFileSync(eventsPath, `${JSON.stringify(parsed)}\n`, { mode: 0o600 });
        } catch {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('write failed');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      sseClients.add(res);
      const keepalive = setInterval(() => {
        try {
          res.write(': keepalive\n\n');
        } catch {
          // client gone — the close handler below cleans up
        }
      }, SSE_KEEPALIVE_MS);
      if (keepalive.unref) keepalive.unref();
      req.on('close', () => {
        clearInterval(keepalive);
        sseClients.delete(res);
      });
      return;
    }

    if (req.method === 'GET') {
      let target = resolveSafe(dir, pathname);
      if (target === null) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('forbidden');
        return;
      }
      try {
        let st = fs.statSync(target);
        if (st.isDirectory()) {
          target = path.join(target, 'index.html');
          st = fs.statSync(target);
        }
        res.writeHead(200, { 'Content-Type': contentTypeFor(target) });
        res.end(fs.readFileSync(target));
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
      }
      return;
    }

    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('method not allowed');
  });

  watchTimer = setInterval(() => {
    if (sseClients.size === 0) return; // nothing to notify — skip the walk entirely
    const sig = watchSignature(dir, stateDir);
    if (sig !== lastSig) {
      lastSig = sig;
      for (const client of sseClients) {
        try {
          client.write('event: reload\ndata: {}\n\n');
        } catch {
          // client gone — the close handler cleans it up on its own turn
        }
      }
    }
  }, WATCH_INTERVAL_MS);
  if (watchTimer.unref) watchTimer.unref();

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port || 0, '127.0.0.1', () => {
      // Any throw in here (e.g. stateDir doesn't exist) must reject rather
      // than leave this promise permanently pending — an unguarded listener
      // body previously left a hung caller with an already-bound, never-
      // stoppable listening socket and no way to detect the failure.
      try {
        const info = {
          url: `http://127.0.0.1:${server.address().port}/?key=${key}`,
          port: server.address().port,
          pid: process.pid,
          startedAt: Date.now(),
          key,
        };
        try {
          fs.unlinkSync(stoppedPath);
        } catch {
          // absent is the common case
        }
        fs.writeFileSync(infoPath, JSON.stringify(info), { mode: 0o600 });
        resetIdle();
        resolve({ server, info, key, stop });
      } catch (err) {
        if (watchTimer) clearInterval(watchTimer);
        server.close();
        reject(err);
      }
    });
  });
}

module.exports = { startServer, resolveSafe, watchSignature, contentTypeFor };
