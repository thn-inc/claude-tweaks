'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { startServer, resolveSafe } = require('../../../plugin/bin/lib/visual-decide/server');
const { readText } = require('../../helpers/read-skill');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function request(port, reqPath, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: reqPath, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() });
        });
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function startTestServer(overrides = {}) {
  const dir = overrides.dir || mkTmp('vd-content-');
  const stateDir = overrides.stateDir || mkTmp('vd-state-');
  const handle = await startServer({ dir, stateDir, port: 0, idleMinutes: overrides.idleMinutes ?? 240 });
  return { ...handle, dir, stateDir };
}

test('AC5: binds 127.0.0.1 only', async () => {
  const h = await startTestServer();
  try {
    const addr = h.server.address();
    assert.equal(addr.address, '127.0.0.1');
  } finally {
    h.stop();
  }
});

test('AC2: no key -> 401, correct key -> 200 and serves file, traversal rejected, / resolves index.html, 404 when absent', async () => {
  const dir = mkTmp('vd-content-');
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>root</h1>');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
  const secretDir = mkTmp('vd-secret-');
  fs.writeFileSync(path.join(secretDir, 'secret.txt'), 'nope');
  const h = await startTestServer({ dir });
  try {
    const noKey = await request(h.info.port, '/a.txt');
    assert.equal(noKey.statusCode, 401);
    assert.equal(noKey.body.includes('hello'), false);

    const wrongKey = await request(h.info.port, '/a.txt?key=wrong');
    assert.equal(wrongKey.statusCode, 401);

    const withKey = await request(h.info.port, `/a.txt?key=${h.key}`);
    assert.equal(withKey.statusCode, 200);
    assert.equal(withKey.body, 'hello');
    assert.match(withKey.headers['set-cookie'][0], /vd_key=/);

    const rootReq = await request(h.info.port, `/?key=${h.key}`);
    assert.equal(rootReq.statusCode, 200);
    assert.equal(rootReq.body, '<h1>root</h1>');

    // relative path from secretDir's sibling — normalize() collapses it to
    // an absolute path outside dir; resolveSafe must reject it.
    const relEscape = path.relative(dir, path.join(secretDir, 'secret.txt'));
    const traversal = await request(h.info.port, `/${relEscape}?key=${h.key}`);
    assert.notEqual(traversal.statusCode, 200);

    const missing = await request(h.info.port, `/nope.txt?key=${h.key}`);
    assert.equal(missing.statusCode, 404);
  } finally {
    h.stop();
  }
});

test('AC2: cookie set on first keyed request authenticates a follow-up with no query param', async () => {
  const dir = mkTmp('vd-content-');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
  const h = await startTestServer({ dir });
  try {
    const first = await request(h.info.port, `/a.txt?key=${h.key}`);
    const cookie = first.headers['set-cookie'][0].split(';')[0];
    const second = await request(h.info.port, '/a.txt', { headers: { Cookie: cookie } });
    assert.equal(second.statusCode, 200);
    assert.equal(second.body, 'hello');
  } finally {
    h.stop();
  }
});

test('resolveSafe rejects escapes and accepts in-tree paths', () => {
  const root = '/srv/content';
  assert.equal(resolveSafe(root, '/a.txt'), path.join(root, 'a.txt'));
  assert.equal(resolveSafe(root, '/../etc/passwd'), null);
  assert.equal(resolveSafe(root, '/..%2f..%2fetc%2fpasswd'), null);
  assert.equal(resolveSafe(root, '/').replace(/\/$/, ''), root);
});

test('AC3: POST /events appends exactly one JSONL line per request; malformed body -> 400, file unchanged', async () => {
  const h = await startTestServer();
  try {
    const ok = await request(h.info.port, `/events?key=${h.key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'pick', variant: 'a', ts: 1 }),
    });
    assert.equal(ok.statusCode, 200);
    const eventsPath = path.join(h.stateDir, 'events');
    const before = fs.readFileSync(eventsPath, 'utf8');
    const lines = before.trim().split('\n');
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), { type: 'pick', variant: 'a', ts: 1 });

    const bad = await request(h.info.port, `/events?key=${h.key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json{{{',
    });
    assert.equal(bad.statusCode, 400);
    const after = fs.readFileSync(eventsPath, 'utf8');
    assert.equal(after, before);
  } finally {
    h.stop();
  }
});

test('AC4: GET /stream is text/event-stream and emits reload within 1s of a nested file change', async () => {
  const dir = mkTmp('vd-content-');
  fs.mkdirSync(path.join(dir, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'nested', 'f.txt'), 'v1');
  const h = await startTestServer({ dir });
  try {
    const reloadSeen = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: h.info.port, path: `/stream?key=${h.key}`, method: 'GET' },
        (res) => {
          assert.equal(res.statusCode, 200);
          assert.match(res.headers['content-type'], /text\/event-stream/);
          let buf = '';
          const timer = setTimeout(() => {
            req.destroy();
            resolve(false);
          }, 1000);
          res.on('data', (chunk) => {
            buf += chunk.toString();
            if (buf.includes('event: reload')) {
              clearTimeout(timer);
              req.destroy();
              resolve(true);
            }
          });
        },
      );
      req.on('error', () => {
        // destroying the request to end the test triggers this — ignore
      });
      req.end();
      setTimeout(() => {
        fs.writeFileSync(path.join(dir, 'nested', 'f.txt'), 'v2');
      }, 100);
    });
    assert.equal(reloadSeen, true);
  } finally {
    h.stop();
  }
});

test('AC6: idle timeout self-exits and writes server-stopped; any request resets it', async () => {
  const h = await startTestServer({ idleMinutes: 0.05 }); // ~3s
  try {
    // touch it once shortly before the timer would fire, to prove reset happens
    await new Promise((resolve) => {
      setTimeout(resolve, 1500);
    });
    await request(h.info.port, `/?key=${h.key}`);
    assert.equal(fs.existsSync(path.join(h.stateDir, 'server-stopped')), false);

    await new Promise((resolve) => {
      setTimeout(resolve, 3500);
    });
    assert.equal(fs.existsSync(path.join(h.stateDir, 'server-stopped')), true);
  } finally {
    h.stop();
  }
});

test('review fix: /events writes to the state dir never trigger their own SSE reload (state dir nested inside the served dir)', async () => {
  const dir = mkTmp('vd-content-');
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>root</h1>');
  const stateDir = path.join(dir, '.vd-state');
  fs.mkdirSync(stateDir, { recursive: true });
  const h = await startTestServer({ dir, stateDir });
  try {
    const reloadSeen = await new Promise((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port: h.info.port, path: `/stream?key=${h.key}`, method: 'GET' },
        (res) => {
          let buf = '';
          const timer = setTimeout(() => {
            req.destroy();
            resolve(false);
          }, 1200);
          res.on('data', (chunk) => {
            buf += chunk.toString();
            if (buf.includes('event: reload')) {
              clearTimeout(timer);
              req.destroy();
              resolve(true);
            }
          });
        },
      );
      req.on('error', () => {});
      req.end();
      setTimeout(async () => {
        await request(h.info.port, `/events?key=${h.key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'reroll', ts: 1 }),
        });
      }, 100);
    });
    assert.equal(reloadSeen, false, 'an /events POST must not trigger its own reload broadcast');
  } finally {
    h.stop();
  }
});

test('review fix: unauthenticated requests never reset the idle timer', async () => {
  const h = await startTestServer({ idleMinutes: 0.05 }); // ~3s
  try {
    await new Promise((resolve) => {
      setTimeout(resolve, 1500);
    });
    await request(h.info.port, '/'); // no key — 401, must not reset idle
    await new Promise((resolve) => {
      setTimeout(resolve, 1500);
    });
    assert.equal(fs.existsSync(path.join(h.stateDir, 'server-stopped')), true, 'idle timeout must fire on schedule despite unauthenticated traffic');
  } finally {
    h.stop();
  }
});

test('AC8: module has zero non-builtin imports', () => {
  const src = readText(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'visual-decide', 'server.js'));
  const requires = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
  assert.ok(requires.length > 0, 'expected at least one require');
  for (const spec of requires) {
    assert.match(spec, /^node:/, `unexpected non-builtin import: ${spec}`);
  }
});
