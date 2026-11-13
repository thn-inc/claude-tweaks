'use strict';

// tools/run-tests.js --shard / --record-durations: CI's parallel shard jobs (.github/workflows/test.yml)
// each run one slice of the suite, so the slices must partition the whole file set (nothing dropped,
// nothing run twice) identically in every job, and balance by the committed durations.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { slotEnv } = require('./helpers/suite-slot-env');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const RUNNER = path.join(ROOT, 'tools', 'run-tests.js');
const {
  parseShard, readDurations, assignShards, extractRunFlags, listTestFiles, durationsPartialPath, finishRecording,
  DURATIONS_FILE, PER_FILE_OVERHEAD_MS,
} = require(RUNNER);
const reporter = require(path.join(ROOT, 'tools', 'test-durations-reporter.js'));

const files = (n) => Array.from({ length: n }, (_, i) => `tests/f${String(i).padStart(3, '0')}.test.js`);
const flat = (shards) => shards.flatMap((s) => s.files);

test('parseShard accepts <index>/<total> and rejects everything else', () => {
  assert.deepStrictEqual(parseShard('2/4'), { index: 2, total: 4 });
  assert.deepStrictEqual(parseShard('1/1'), { index: 1, total: 1 });
  for (const bad of ['0/4', '5/4', '1/0', '01/4', '1/04', 'a/b', '1', '1/2/3', '-1/4', ' 1/4', '']) {
    assert.throws(() => parseShard(bad), /--shard/, bad);
  }
});

test('assignShards partitions the files exactly: every file in one shard, none twice', () => {
  const all = files(37);
  const durations = new Map(all.map((f, i) => [f, (i * 7919) % 3000]));
  for (const total of [1, 2, 3, 4, 7, 37, 50]) {
    const shards = assignShards(all, durations, total);
    assert.strictEqual(shards.length, total);
    assert.deepStrictEqual(flat(shards).sort(), [...all].sort(), `total ${total}`);
    for (const s of shards) assert.deepStrictEqual(s.files, [...s.files].sort(), 'each shard lists its files sorted');
  }
});

test('assignShards is the same partition whatever order the files arrive in', () => {
  const all = files(25);
  // Every weight ties, so only the path tie-break can make the partition independent of input order.
  const durations = new Map(all.map((f) => [f, 1000]));
  const a = assignShards(all, durations, 4).map((s) => s.files);
  const b = assignShards([...all].reverse(), durations, 4).map((s) => s.files);
  assert.deepStrictEqual(a, b);
});

test('assignShards balances by duration: a heavy file gets a shard to itself', () => {
  const all = files(9);
  const durations = new Map(all.map((f) => [f, 1000]));
  durations.set(all[4], 8000);
  const shards = assignShards(all, durations, 2);
  const heavy = shards.find((s) => s.files.includes(all[4]));
  assert.deepStrictEqual(heavy.files, [all[4]]);
  assert.strictEqual(shards.find((s) => s !== heavy).files.length, 8);
  // Count-based slicing (node's own --test-shard) would put 4 or 5 files with the heavy one.
});

test('assignShards weighs an unmeasured file as the median measured one, and counts it', () => {
  const measured = files(4);
  const durations = new Map([[measured[0], 100], [measured[1], 200], [measured[2], 900], [measured[3], 5000]]);
  const shards = assignShards([...measured, 'tests/new.test.js'], durations, 1);
  assert.strictEqual(shards[0].unmeasured, 1);
  // Median of [100, 200, 900, 5000] at index 2 is 900; every file also carries the startup cost.
  assert.strictEqual(shards[0].ms, 100 + 200 + 900 + 5000 + 900 + 5 * PER_FILE_OVERHEAD_MS);
});

test('assignShards with no durations at all deals the files evenly', () => {
  const shards = assignShards(files(10), new Map(), 4);
  assert.deepStrictEqual(shards.map((s) => s.files.length).sort(), [2, 2, 3, 3]);
});

test('assignShards looks files up by their posix path, so a win32-separated list still matches', () => {
  const durations = new Map([['tests/a.test.js', 9000], ['tests/b.test.js', 10]]);
  const shards = assignShards(['tests\\a.test.js', 'tests\\b.test.js'], durations, 1);
  assert.strictEqual(shards[0].unmeasured, 0);
});

test('readDurations reads the files map and rejects any other shape', () => {
  assert.deepStrictEqual([...readDurations('{"files":{"tests/a.test.js":12}}')], [['tests/a.test.js', 12]]);
  for (const bad of ['[]', '{}', '{"files":[]}', '{"files":{"a":"12"}}', '{"files":{"a":-1}}', 'not json']) {
    assert.throws(() => readDurations(bad), bad);
  }
});

test('the committed durations file parses and names only test files that exist', () => {
  const durations = readDurations(readText(path.join(ROOT, DURATIONS_FILE)));
  const known = new Set(listTestFiles(ROOT).map((f) => path.relative(ROOT, f).split(path.sep).join('/')));
  assert.ok(durations.size > 0, 'the durations file is empty');
  const stale = [...durations.keys()].filter((f) => !known.has(f));
  assert.deepStrictEqual(stale, [], 'refresh it: node tools/run-tests.js --record-durations tools/test-durations.json');
});

test('extractRunFlags pulls --shard and --record-durations out and keeps the roots', () => {
  assert.deepStrictEqual(extractRunFlags(['--shard', '1/4']), { rest: [], shard: '1/4', recordDurations: null });
  assert.deepStrictEqual(extractRunFlags(['perf', '--shard=2/3']), { rest: ['perf'], shard: '2/3', recordDurations: null });
  assert.deepStrictEqual(extractRunFlags(['--record-durations', 'out.json', 'tests']), { rest: ['tests'], shard: null, recordDurations: 'out.json' });
  assert.throws(() => extractRunFlags(['--shard']), /--shard needs a value/);
  assert.throws(() => extractRunFlags(['--record-durations', '--shard', '1/2']), /--record-durations needs a value/);
});

test('the durations reporter records each test file\'s summary, relative and sorted, ignoring per-test events', () => {
  const totals = new Map();
  for (const e of [
    { type: 'test:summary', data: { file: '/r/tests/b.test.js', duration_ms: 15.4 } },
    // A test declared in a shared helper reports the helper as its file; only the summary names the test file.
    { type: 'test:pass', data: { file: '/r/tests/helpers/shared.js', nesting: 0, details: { duration_ms: 999 } } },
    { type: 'test:summary', data: { file: '/r/tests/a.test.js', duration_ms: 1.6 } },
    { type: 'test:summary', data: { duration_ms: 5000 } }, // the run-wide summary has no file
  ]) reporter.addEvent(totals, e);
  const doc = JSON.parse(reporter.renderDurations(totals, '/r'));
  assert.deepStrictEqual(doc.files, { 'tests/a.test.js': 2, 'tests/b.test.js': 15 });
  assert.deepStrictEqual(Object.keys(doc.files), ['tests/a.test.js', 'tests/b.test.js']);
});

// node truncates a reporter destination when the run starts, and the suite itself reads the committed
// durations file, so a recording lands only when the run ends.
test('finishRecording replaces the file only for a finished run that wrote something', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tests-record-'));
  try {
    const out = path.join(tmp, 'durations.json');
    const partial = durationsPartialPath(out, 4242);
    assert.strictEqual(partial, `${out}.partial-4242`);
    const cases = [
      { partial: 'new', signalled: false, want: 'new', line: /recorded test durations/ },
      { partial: 'new', signalled: true, want: 'old', line: /left unchanged — the run was interrupted/ },
      { partial: '', signalled: false, want: 'old', line: /left unchanged — the durations reporter wrote nothing/ },
      { partial: null, signalled: false, want: 'old', line: /left unchanged/ },
    ];
    for (const c of cases) {
      fs.writeFileSync(out, 'old');
      if (c.partial !== null) fs.writeFileSync(partial, c.partial);
      assert.match(finishRecording(out, 4242, { signalled: c.signalled }), c.line, JSON.stringify(c));
      assert.strictEqual(fs.readFileSync(out, 'utf8'), c.want, JSON.stringify(c));
      assert.strictEqual(fs.existsSync(partial), false, `partial left behind: ${JSON.stringify(c)}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the durations reporter refuses to write an empty file', () => {
  assert.throws(() => reporter.renderDurations(new Map(), '/r'), /no per-file test:summary/);
});

// End to end through the CLI: a fixture root of tiny test files, run as two shards, each writes the
// name of the file that ran; together they ran every file exactly once.
test('run-tests.js --shard runs a disjoint slice per shard that together covers the root', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tests-shard-'));
  try {
    const root = path.join(tmp, 'suite');
    const out = path.join(tmp, 'ran');
    fs.mkdirSync(root);
    fs.mkdirSync(out);
    const names = ['a', 'b', 'c', 'd', 'e'];
    for (const n of names) {
      fs.writeFileSync(path.join(root, `${n}.test.js`),
        `require('node:test')('${n}', () => { require('fs').writeFileSync(${JSON.stringify(path.join(out, n))}, ''); });\n`);
    }
    const env = slotEnv(path.join(tmp, 'slots'), { CT_TEST_CONCURRENCY: '2' });
    const ran = [];
    for (const shard of ['1/2', '2/2']) {
      const before = new Set(fs.readdirSync(out));
      const r = spawnSync(process.execPath, [RUNNER, '--shard', shard, root], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
      assert.strictEqual(r.status, 0, `${shard}: ${r.stderr}`);
      assert.match(r.stderr, new RegExp(`run-tests\\.js: shard ${shard.replace('/', '\\/')} — \\d+ of 5 files`));
      ran.push(fs.readdirSync(out).filter((f) => !before.has(f)));
    }
    assert.ok(ran.every((slice) => slice.length > 0), JSON.stringify(ran));
    assert.deepStrictEqual(ran.flat().sort(), names);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('run-tests.js refuses --shard with --files-from, and --record-durations with a partial run', () => {
  for (const args of [['--shard', '1/2', '--files-from', 'x'], ['--record-durations', 'o.json', '--shard', '1/2'], ['--shard', '3/2']]) {
    const r = spawnSync(process.execPath, [RUNNER, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
    assert.strictEqual(r.status, 1, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, /^run-tests\.js: /, args.join(' '));
  }
});
