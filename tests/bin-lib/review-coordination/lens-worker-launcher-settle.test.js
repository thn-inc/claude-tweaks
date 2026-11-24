'use strict';
// #6003 AC2/AC3/AC7: the worker path end to end. The reply is produced by the real launcher
// (plugin/bin/review-lens-workers.js, in-process through runCli, fake runner) — never hand-written
// launcher JSON — then merged and settled through review-coordination.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { runCli, runCliSync } = require('../../helpers/run-cli');
const { scratchDir } = require('../../helpers/tmp-dir');
const { committedRepo, cleanGitEnv } = require('../../helpers/git-fixtures');

const LAUNCHER = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'review-lens-workers.js');
const COORD = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'review-coordination.js');
const RUN_ID = '2026-11-24T120000-record-6003';
const ENV = cleanGitEnv();
const TABLE = (note) => `<!-- ${note} -->\nNo findings.\n\nSTATUS: DONE\n`;
const resultOut = (text) => ({ code: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0, usage: {}, permission_denials: [], session_id: 's', structured_output: { text } }) });
const FAIL = { code: 1, stdout: '' };
const lens = (name) => ({ lens: name, brief: `brief for ${name}`, model: 'haiku', reviewers: 2 });

function fixture(t, lenses) {
  const main = committedRepo({ prefix: 'ct-lens-settle-' });
  t.after(() => fs.rmSync(main.dir, { recursive: true, force: true }));
  const dir = fs.realpathSync(main.dir);
  const runDir = path.join(dir, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  const inputs = path.join(dir, '.claude-tweaks', 'inputs');
  fs.mkdirSync(inputs, { recursive: true });
  fs.writeFileSync(path.join(inputs, 'lenses.json'), JSON.stringify({ lenses }));
  fs.writeFileSync(path.join(inputs, 'bundle.md'), 'BUNDLE\n');
  const plain = committedRepo({ prefix: 'ct-lens-plain-' });
  t.after(() => fs.rmSync(plain.dir, { recursive: true, force: true }));
  return { main: dir, reviewed: fs.realpathSync(plain.dir), runDir, lensesFile: path.join(inputs, 'lenses.json'), bundle: path.join(inputs, 'bundle.md') };
}

// `plan(lens, side)` -> the runner outcome for that side; the lens comes from the brief text the
// launcher puts on the worker's input, the side from the launch order within the lens (A then B).
function fakeRunner(plan) {
  const calls = [];
  const seen = {};
  const runner = (call) => {
    const name = /brief for (\S+)$/.exec(call.input)[1];
    seen[name] = (seen[name] || 0) + 1;
    const side = seen[name] === 1 ? 'A' : 'B';
    calls.push(`${name}${side}`);
    return { pid: 5000 + calls.length, kill() {}, exited: Promise.resolve({ signal: null, stderr: '', ...plan(name, side) }) };
  };
  return { runner, calls };
}

async function launch(t, lenses, plan, over = {}) {
  const fx = fixture(t, lenses);
  const { runner, calls } = fakeRunner(plan);
  const o = { '--run': fx.runDir, '--lenses-file': fx.lensesFile, '--cwd': fx.reviewed, '--bundle': fx.bundle, ...over };
  const res = await runCli(LAUNCHER, Object.entries(o).flat(), {
    env: ENV,
    cwd: fx.main,
    deps: { runner, platform: 'darwin', gitHonoursAttrSource: () => true, resolvePolicy: () => ({}), onSignal: () => () => {}, locateTranscripts: () => [] },
  });
  const dir = scratchDir('lens-settle-');
  const file = path.join(dir, 'reply.json');
  fs.writeFileSync(file, res.stdout);
  return { res, calls, dir, file };
}

const cli = (args, dir) => runCliSync(COORD, args, { env: { ...process.env, TMPDIR: dir } });
const textFile = (dir, name, text) => {
  const f = path.join(dir, name);
  fs.writeFileSync(f, text);
  return f;
};
const mergeTask = (dir, file, name, a, b) => cli(['merge-lens-replies', '--into', file, '--out', file, '--lens', name, '--reviewers', '2',
  '--side-a', textFile(dir, `${name}a.txt`, a), '--side-b', textFile(dir, `${name}b.txt`, b)], dir);
const settle = (dir, file) => cli(['settle-lens-replies', file, '--ctx-id', 't'], dir);
const settledLenses = (s) => JSON.parse(s.stdout).settled.map((x) => x.lens).sort();
const good = (name, side) => resultOut(TABLE(`${name}${side} worker`));

test('AC3.1/AC3.2: one lens failed — only that lens is merged from the Task path, one settle call settles all', async (t) => {
  const { res, calls, dir, file } = await launch(t, [lens('3a'), lens('3b')], (n, s) => (n === '3b' ? FAIL : good(n, s)));
  assert.strictEqual(res.code, 0, res.stderr);
  const reply = JSON.parse(res.stdout);
  assert.deepStrictEqual(reply.reviewers.filter((r) => r.failed).map((r) => `${r.lens}${r.side}`), ['3bA', '3bB']);
  assert.deepStrictEqual([...calls].sort(), ['3aA', '3aB', '3bA', '3bB']);
  const m = mergeTask(dir, file, '3b', TABLE('3bA task'), TABLE('3bB task'));
  assert.strictEqual(m.code, 0, m.stderr);
  const merged = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(merged.reviewers.filter((r) => r.lens === '3a'), reply.reviewers.filter((r) => r.lens === '3a'));
  assert.deepStrictEqual(merged.reviewers.filter((r) => r.lens === '3b').map((r) => [r.side, r.text, r.failed]), [['A', TABLE('3bA task'), false], ['B', TABLE('3bB task'), false]]);
  const s = settle(dir, file);
  assert.strictEqual(s.code, 0, s.stderr);
  assert.deepStrictEqual(settledLenses(s), ['3a', '3b']);
  assert.strictEqual(calls.length, 4, 'no worker re-ran');
});

test('AC3.1: one side failed — the whole lens is replaced, never a half pair', async (t) => {
  const { res, dir, file } = await launch(t, [lens('3a'), lens('3b')], (n, s) => (n === '3b' && s === 'B' ? FAIL : good(n, s)));
  const reply = JSON.parse(res.stdout);
  assert.deepStrictEqual(reply.reviewers.filter((r) => r.failed).map((r) => `${r.lens}${r.side}`), ['3bB']);
  assert.strictEqual(mergeTask(dir, file, '3b', TABLE('3bA task'), TABLE('3bB task')).code, 0);
  const merged = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(merged.reviewers.filter((r) => r.lens === '3b').map((r) => r.text), [TABLE('3bA task'), TABLE('3bB task')]);
  assert.ok(merged.reviewers.every((r) => !r.failed));
  const s = settle(dir, file);
  assert.strictEqual(s.code, 0, s.stderr);
  assert.deepStrictEqual(settledLenses(s), ['3a', '3b']);
});

test('AC2.2: every side failed — the reply reads as every worker failed and settles nothing', async (t) => {
  const { res, dir, file } = await launch(t, [lens('3a'), lens('3b')], () => FAIL);
  assert.strictEqual(res.code, 0, res.stderr);
  const reply = JSON.parse(res.stdout);
  assert.strictEqual(reply.reviewers.length, 4);
  assert.ok(reply.reviewers.every((r) => r.failed === true));
  const s = settle(dir, file);
  assert.strictEqual(s.code, 0, s.stderr);
  const out = JSON.parse(s.stdout);
  assert.deepStrictEqual(out.settled, []);
  assert.deepStrictEqual(out.needsSession.map((x) => x.lens || x).sort(), ['3a', '3b']);
});

test('AC2.2: nothing on stdout — the reply reads as a launch error', async (t) => {
  const { res, calls, dir, file } = await launch(t, [lens('3a')], good, { '--bundle': '/nonexistent/bundle.md' });
  assert.strictEqual(res.code, 2);
  assert.strictEqual(res.stdout, '');
  assert.strictEqual(calls.length, 0);
  const out = path.join(dir, 'merged.json');
  const m = cli(['merge-lens-replies', '--into', file, '--out', out, '--lens', '3f', '--reviewers', '1', '--side-a', textFile(dir, 'a.txt', TABLE('f'))], dir);
  assert.strictEqual(m.code, 2);
  assert.strictEqual(fs.existsSync(out), false);
  assert.strictEqual(settle(dir, file).code, 2);
});

test('AC7.1: mixed review — 3f from the Task path beside worker lenses in one settle call', async (t) => {
  const { res, dir, file } = await launch(t, [lens('3a'), lens('3b')], good);
  assert.strictEqual(res.code, 0, res.stderr);
  const m = mergeTask(dir, file, '3f', TABLE('3fA task'), TABLE('3fB task'));
  assert.strictEqual(m.code, 0, m.stderr);
  assert.strictEqual(JSON.parse(m.stdout).replaced, false);
  const s = settle(dir, file);
  assert.strictEqual(s.code, 0, s.stderr);
  assert.deepStrictEqual(settledLenses(s), ['3a', '3b', '3f']);
});
