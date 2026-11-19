const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { FIXTURE_RECORDS } = require('./fixtures');
const { runCliSync, spawnCli } = require('../../helpers/run-cli');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'record-graph.js');

// In-process call; maps the helper's `code` onto the `status` field the assertions use.
function cli(args, opts = {}) {
  const { code, stdout, stderr } = runCliSync(CLI, args, opts);
  return { status: code, stdout, stderr };
}

function tmpJson(records) {
  const dir = scratchDir('record-graph-cli-');
  const file = path.join(dir, 'records.json');
  fs.writeFileSync(file, JSON.stringify(records));
  return file;
}

test('AC5.1: require() of record-graph.js prints nothing and leaves process.exitCode undefined', () => {
  const jsonPath = tmpJson(FIXTURE_RECORDS);
  // fresh: true re-requires the CLI inside the helper's snapshot, so a require-time
  // stdout/stderr write or process.exitCode change fails this call.
  const res = cli(['render', jsonPath, '--format', 'd2', '--work-links', 'native', '--generated-at', 'X'], { fresh: true });
  assert.strictEqual(res.status, 0);
  assert.strictEqual(process.exitCode, undefined);
});

test('AC9.1: a relative <json> path and --out resolve against the injected cwd', () => {
  const dir = scratchDir('record-graph-cli-cwd-');
  assert.notStrictEqual(fs.realpathSync(dir), fs.realpathSync(process.cwd()));
  fs.writeFileSync(path.join(dir, 'records.json'), JSON.stringify(FIXTURE_RECORDS));
  const res = cli(
    ['render', 'records.json', '--format', 'd2', '--work-links', 'native', '--out', 'out.d2', '--generated-at', 'X'],
    { cwd: dir },
  );
  assert.strictEqual(res.status, 0);
  assert.ok(fs.existsSync(path.join(dir, 'out.d2')));
});

test('render takes the default generatedAt from the injected now', () => {
  const jsonPath = tmpJson(FIXTURE_RECORDS);
  const res = cli(['render', jsonPath, '--format', 'd2', '--work-links', 'native'], {
    deps: { now: () => new Date('2026-01-02T03:04:05.000Z') },
  });
  assert.strictEqual(res.status, 0);
  assert.match(res.stdout, /# Generated 2026-01-02T03:04:05\.000Z — /);
});

// real process: proves the script entry and exit code
test('script entry: render writes D2 to stdout and exits 0', () => {
  const jsonPath = tmpJson(FIXTURE_RECORDS);
  const res = spawnCli(CLI, ['render', jsonPath, '--format', 'd2', '--work-links', 'native', '--generated-at', 'X']);
  assert.strictEqual(res.code, 0);
  assert.match(res.stdout, /backlog: "Backlog" \{/);
});

// real process: proves the script entry and exit code
test('AC6.1: no arguments exits 2 with the unknown-command line on stderr', () => {
  assert.deepStrictEqual(spawnCli(CLI, []), {
    code: 2,
    stdout: '',
    stderr: 'record-graph: unknown command "undefined" (expected: render)\n',
  });
});

test('render --format d2 writes valid-looking D2 source to stdout', () => {
  const jsonPath = tmpJson(FIXTURE_RECORDS);
  const out = cli([
    'render', jsonPath, '--format', 'd2', '--work-links', 'body-text', '--generated-at', '2026-08-03T12:00:00.000Z',
  ]).stdout;
  assert.match(out, /backlog: "Backlog" \{/);
  assert.match(out, /ready\.n20 -> backlog\.n10/);
});

test('render --format svg writes an svg fragment to stdout', () => {
  const jsonPath = tmpJson(FIXTURE_RECORDS);
  const out = cli([
    'render', jsonPath, '--format', 'svg', '--work-links', 'body-text', '--generated-at', '2026-08-03T12:00:00.000Z',
  ]).stdout;
  assert.match(out, /<svg class="vz-record-graph"/);
});

test('render --out writes the file instead of stdout', () => {
  const jsonPath = tmpJson(FIXTURE_RECORDS);
  const outDir = scratchDir('record-graph-cli-out-');
  const outPath = path.join(outDir, 'record-graph.d2');
  const result = cli([
    'render', jsonPath, '--format', 'd2', '--work-links', 'body-text', '--out', outPath,
  ]);
  assert.strictEqual(result.status, 0);
  assert.ok(fs.existsSync(outPath));
  assert.match(fs.readFileSync(outPath, 'utf8'), /backlog: "Backlog" \{/);
  assert.match(result.stderr, /wrote .*record-graph\.d2 \(3 records, 1 edges\)/);
});

// A deleted working directory makes the real cwd() throw; absolute <json> and --out never needed it.
test('render with absolute <json> and --out succeeds with an unreadable cwd, as before the entry contract', () => {
  const jsonPath = tmpJson(FIXTURE_RECORDS);
  const outPath = path.join(scratchDir('record-graph-cli-nocwd-'), 'record-graph.d2');
  const args = ['render', jsonPath, '--format', 'd2', '--work-links', 'body-text', '--generated-at', 'X'];
  const expected = cli(args).stdout;
  const result = cli([...args, '--out', outPath], {
    deps: { cwd: () => { throw Object.assign(new Error('ENOENT: process.cwd failed'), { code: 'ENOENT' }); } },
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '');
  assert.strictEqual(result.stderr, `render: wrote ${outPath} (3 records, 1 edges)\n`);
  assert.strictEqual(fs.readFileSync(outPath, 'utf8'), expected);
});

test('render sets truncated when record count equals --fetch-limit', () => {
  const jsonPath = tmpJson(FIXTURE_RECORDS);
  const out = cli([
    'render', jsonPath, '--format', 'd2', '--work-links', 'body-text', '--fetch-limit', '3',
  ]).stdout;
  assert.match(out, /Showing the fetch cap.s worth of records/);
});

// assert.throws(/Command failed/) would pass for ANY nonzero exit code — this
// returns the result so the status and stderr can both be checked directly.
function runExpectingFailure(args) {
  const res = cli(args);
  assert.notStrictEqual(res.status, 0, `expected a nonzero exit for: ${args.join(' ')}`);
  return res;
}

test('render rejects an unrecognized --format with exit code 2', () => {
  const jsonPath = tmpJson(FIXTURE_RECORDS);
  const error = runExpectingFailure(['render', jsonPath, '--format', 'png', '--work-links', 'body-text']);
  assert.strictEqual(error.status, 2);
  assert.match(error.stderr, /--format must be "d2" or "svg"/);
});

test('render rejects an unrecognized --work-links with exit code 2', () => {
  const jsonPath = tmpJson(FIXTURE_RECORDS);
  const error = runExpectingFailure(['render', jsonPath, '--format', 'd2', '--work-links', 'bogus']);
  assert.strictEqual(error.status, 2);
  assert.match(error.stderr, /--work-links must be "native" or "body-text"/);
});

test('render exits 2 with a clear message when the input file is missing', () => {
  const missing = path.join(os.tmpdir(), 'record-graph-does-not-exist-12345.json');
  const error = runExpectingFailure(['render', missing, '--format', 'd2', '--work-links', 'body-text']);
  assert.strictEqual(error.status, 2);
  assert.match(error.stderr, /could not read faceted-record JSON/);
  assert.ok(!/at Object\.<anonymous>/.test(error.stderr), 'leaked a raw Node stack trace');
});

test('render exits 2 with a clear message when the input file is not valid JSON', () => {
  const dir = scratchDir('record-graph-cli-bad-');
  const file = path.join(dir, 'records.json');
  fs.writeFileSync(file, '{not json at all');
  const error = runExpectingFailure(['render', file, '--format', 'd2', '--work-links', 'body-text']);
  assert.strictEqual(error.status, 2);
  assert.match(error.stderr, /could not read faceted-record JSON/);
  assert.ok(!/at Object\.<anonymous>/.test(error.stderr), 'leaked a raw Node stack trace');
});

test('render exits 2 when the input JSON is not an array of records', () => {
  const jsonPath = tmpJson({ number: 10 });
  const error = runExpectingFailure(['render', jsonPath, '--format', 'd2', '--work-links', 'body-text']);
  assert.strictEqual(error.status, 2);
  assert.match(error.stderr, /expected an array of faceted records/);
});

test('render exits 2 on a non-numeric --fetch-limit instead of silently disabling truncation', () => {
  const jsonPath = tmpJson(FIXTURE_RECORDS);
  const error = runExpectingFailure(['render', jsonPath, '--format', 'd2', '--work-links', 'body-text', '--fetch-limit', 'abc']);
  assert.strictEqual(error.status, 2);
  assert.match(error.stderr, /--fetch-limit must be a number/);
});

test('render exits 2 when --fetch-limit is given no value at all', () => {
  const jsonPath = tmpJson(FIXTURE_RECORDS);
  const error = runExpectingFailure(['render', jsonPath, '--format', 'd2', '--work-links', 'body-text', '--fetch-limit']);
  assert.strictEqual(error.status, 2);
  assert.match(error.stderr, /--fetch-limit must be a number/);
});

test('unknown command exits with code 2 and a usage message on stderr', () => {
  const error = cli(['bogus']);
  assert.strictEqual(error.status, 2);
  assert.match(error.stderr, /unknown command "bogus"/);
});
