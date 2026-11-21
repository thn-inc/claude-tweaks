const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../../helpers/tmp-dir');
const {
  LENS_DISPATCH_FILE, LENS_IDS, entryProblem, readLensDispatch, appendLensDispatch,
} = require('../../../plugin/bin/lib/review-lens/dispatch-record');

const BASE = { lens: '3a', reviewers: 2, path: 'task', round: 1, status: 'completed' };

test('appends entries in order and reads them back', () => {
  const dir = scratchDir('lens-dispatch-');
  const e1 = BASE;
  const e2 = { ...BASE, lens: '3b', reviewers: 1, path: 'workflow', status: 'failed' };
  assert.strictEqual(appendLensDispatch({ runDir: dir, entry: e1 }).duplicate, false);
  appendLensDispatch({ runDir: dir, entry: e2 });
  assert.deepStrictEqual(readLensDispatch(dir), { state: 'ok', entries: [e1, e2] });
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, LENS_DISPATCH_FILE), 'utf8')).v, 1);
});

test('an identical entry is not appended twice', () => {
  const dir = scratchDir('lens-dispatch-');
  appendLensDispatch({ runDir: dir, entry: BASE });
  const second = appendLensDispatch({ runDir: dir, entry: { ...BASE } });
  assert.strictEqual(second.duplicate, true);
  assert.strictEqual(readLensDispatch(dir).entries.length, 1);
});

test('absent file reads absent', () => {
  assert.deepStrictEqual(readLensDispatch(scratchDir('lens-dispatch-')), { state: 'absent' });
});

test('malformed files are errors, never absence', () => {
  const cases = [
    'not json',
    '{"v":2,"entries":[]}',
    '{"v":1,"entries":{}}',
    '{"v":1,"entries":[{"lens":"3z","reviewers":2,"path":"task","round":1,"status":"completed"}]}',
  ];
  for (const text of cases) {
    const dir = scratchDir('lens-dispatch-');
    fs.writeFileSync(path.join(dir, LENS_DISPATCH_FILE), text);
    const got = readLensDispatch(dir);
    assert.strictEqual(got.state, 'error', text);
    assert.match(got.reason, /unparseable|v|entries|entry 0/, text);
  }
});

test('append refuses to overwrite a malformed file', () => {
  const dir = scratchDir('lens-dispatch-');
  const file = path.join(dir, LENS_DISPATCH_FILE);
  fs.writeFileSync(file, 'not json');
  assert.throws(() => appendLensDispatch({ runDir: dir, entry: BASE }));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'not json');
});

test('entryProblem refuses bad fields', () => {
  assert.strictEqual(entryProblem(BASE), null);
  for (const bad of [{ lens: '__proto__' }, { lens: 'unknown' }, { reviewers: 3 }, { path: 'agent' }, { round: 0 }, { status: 'done' }, { at: 'x' }]) {
    assert.strictEqual(typeof entryProblem({ ...BASE, ...bad }), 'string', JSON.stringify(bad));
  }
  assert.deepStrictEqual([...LENS_IDS], ['3a', '3b', '3c', '3d', '3e', '3f', '3g', '3h']);
});

test('append refuses a vanished run dir and does not create it', () => {
  const runDir = path.join(scratchDir('lens-dispatch-'), 'gone');
  assert.throws(() => appendLensDispatch({ runDir, entry: BASE }));
  assert.strictEqual(fs.existsSync(runDir), false);
});

test('append fails closed when the lock is held', () => {
  const dir = scratchDir('lens-dispatch-');
  const lock = path.join(dir, '.lens-dispatch.lock');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, '.owner'), String(process.pid));
  assert.throws(
    () => appendLensDispatch({ runDir: dir, entry: BASE, env: { CLAUDE_TWEAKS_LOCK_WAIT_MS: '0' } }),
    (err) => err.code === 'LOCK_TIMEOUT',
  );
  assert.strictEqual(fs.existsSync(path.join(dir, LENS_DISPATCH_FILE)), false);
});
