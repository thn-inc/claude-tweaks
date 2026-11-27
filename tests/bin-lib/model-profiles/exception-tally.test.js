'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  TALLY_FILE, LOCK_DIR, TALLY_LOCK_WAIT_MS, countUses, resolveUnderTally,
} = require('../../../plugin/bin/lib/model-profiles/exception-tally');

const made = [];
function sessionDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-tally-'));
  made.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const NAME = 'design-reader';
const win = () => ({ model: 'fable' });
const stepDown = () => ({ stepDown: { reason: 'limit' } });
const lines = (dir) => fs.readFileSync(path.join(dir, TALLY_FILE), 'utf8').split('\n').filter(Boolean);

test('countUses counts only name-prefixed lines', () => {
  const text = `${NAME}\tt1\nother\tt2\n${NAME}-x\tt3\n  ${NAME}\tt4\n${NAME}\tt5\n`;
  assert.strictEqual(countUses(text, NAME), 2);
  assert.strictEqual(countUses('', NAME), 0);
});

test('the default lock wait is TALLY_LOCK_WAIT_MS', () => {
  assert.strictEqual(TALLY_LOCK_WAIT_MS, 5000);
});

test('a missing session dir is reason tally and writes nothing', () => {
  const dir = sessionDir();
  const missing = path.join(dir, 'nope');
  let decided = false;
  const r = resolveUnderTally({ sessionDir: missing, name: NAME, decide: () => { decided = true; return win(); }, env: {} });
  assert.deepStrictEqual(r, { ok: false, reason: 'tally' });
  assert.strictEqual(decided, false);
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('a session path that is a file is reason tally', () => {
  const dir = sessionDir();
  const file = path.join(dir, 'f');
  fs.writeFileSync(file, '');
  assert.deepStrictEqual(resolveUnderTally({ sessionDir: file, name: NAME, decide: win, env: {} }), { ok: false, reason: 'tally' });
});

test('a successful decide appends one line, creating the tally from nothing', () => {
  const dir = sessionDir();
  const seen = [];
  const r = resolveUnderTally({ sessionDir: dir, name: NAME, decide: (n) => { seen.push(n); return win(); }, env: {} });
  assert.deepStrictEqual(r, { ok: true, result: { model: 'fable' } });
  assert.deepStrictEqual(seen, [0]);
  const l = lines(dir);
  assert.strictEqual(l.length, 1);
  assert.match(l[0], new RegExp(`^${NAME}\\t\\d{4}-\\d{2}-\\d{2}T`));
  assert.ok(!fs.existsSync(path.join(dir, LOCK_DIR)), 'lock released');
});

test('a stepped-down decide appends nothing', () => {
  const dir = sessionDir();
  const r = resolveUnderTally({ sessionDir: dir, name: NAME, decide: stepDown, env: {} });
  assert.deepStrictEqual(r, { ok: true, result: { stepDown: { reason: 'limit' } } });
  assert.ok(!fs.existsSync(path.join(dir, TALLY_FILE)));
});

test('an unwritable tally is reason tally', () => {
  const dir = sessionDir();
  const r = resolveUnderTally({
    sessionDir: dir, name: NAME, decide: win, env: {},
    appendTally: () => { throw Object.assign(new Error('EROFS'), { code: 'EROFS' }); },
  });
  assert.deepStrictEqual(r, { ok: false, reason: 'tally' });
  assert.ok(!fs.existsSync(path.join(dir, TALLY_FILE)));
  assert.ok(!fs.existsSync(path.join(dir, LOCK_DIR)), 'lock released');
});

test('a non-ENOENT read failure is reason tally', () => {
  const dir = sessionDir();
  let decided = false;
  const r = resolveUnderTally({
    sessionDir: dir, name: NAME, env: {},
    decide: () => { decided = true; return win(); },
    readTally: () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); },
  });
  assert.deepStrictEqual(r, { ok: false, reason: 'tally' });
  assert.strictEqual(decided, false);
});

test('an error thrown by decide is re-thrown, nothing appended, and the lock released', () => {
  const dir = sessionDir();
  fs.writeFileSync(path.join(dir, TALLY_FILE), `${NAME}\tt0\n`);
  assert.throws(
    () => resolveUnderTally({ sessionDir: dir, name: NAME, env: {}, decide: () => { throw new Error('unknown stance "bogus"'); } }),
    { message: 'unknown stance "bogus"' },
  );
  assert.deepStrictEqual(lines(dir), [`${NAME}\tt0`]);
  assert.ok(!fs.existsSync(path.join(dir, LOCK_DIR)), 'lock dir is gone');
  // waitMs: 0 — succeeds only if the lock is already free, with no wall-clock budget.
  const r = resolveUnderTally({ sessionDir: dir, name: NAME, decide: win, env: {}, waitMs: 0 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(lines(dir).length, 2);
});

// The lock seam (lock-race-test-seam): a two-process "concurrent append" test stays
// green with the lock deleted, so the second resolution is attempted in-process from
// inside the first call's read seam. Removing `withLock` from resolveUnderTally turns
// this red (the inner call then runs, appends, and is not refused) — proven once.
test('a second resolution attempted between the first call\'s read and its append is refused with LOCK_TIMEOUT', () => {
  const dir = sessionDir();
  let inner;
  const outer = resolveUnderTally({
    sessionDir: dir, name: NAME, env: {}, decide: win,
    readTally: (p) => {
      let text = '';
      try { text = fs.readFileSync(p, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      try {
        inner = resolveUnderTally({ sessionDir: dir, name: NAME, decide: win, env: {}, waitMs: 0 });
      } catch (e) {
        inner = { threw: e };
      }
      return text;
    },
  });
  assert.deepStrictEqual(inner, { ok: false, reason: 'tally' });
  assert.deepStrictEqual(outer, { ok: true, result: { model: 'fable' } });
  assert.strictEqual(lines(dir).length, 1);
  const seen = [];
  resolveUnderTally({ sessionDir: dir, name: NAME, env: {}, decide: (n) => { seen.push(n); return stepDown(); } });
  assert.deepStrictEqual(seen, [1]);
});
