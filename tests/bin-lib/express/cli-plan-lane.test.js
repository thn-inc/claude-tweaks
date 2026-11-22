'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const { run, USAGE } = require(path.join(LIB, 'express', 'cli.js'));
const { POLICY_KEYS } = require(path.join(LIB, 'driver', 'plan-lane.js'));

const MICRO_FILES = ['plugin/bin/lib/plan-lane-fixture/m0.js', 'tests/plan-lane-fixture/m0.test.js'];
const LABELS = ['risk:low', 'size:low', 'ceremony:fast-lane', 'type:task'];

function body(keyFiles = MICRO_FILES) {
  return [
    'Surface: infra', 'Risk-flags: none', '',
    '## Current State', '', 'The fixture lacks a line.', '',
    '## Deliverables', '', '- Add the line.', '',
    '## Acceptance Criteria', '', '- The line is present.', '',
    '## Release Note', '', 'Adds a line.', '',
    '## Technical Approach', '', '### Key Files', '',
    ...keyFiles.map((p) => `- \`${p}\` (modify)`), '',
  ].join('\n');
}

const record = (number, labels = LABELS, b = body()) => ({ number, title: `record ${number}`, body: b, labels: labels.map((name) => ({ name })) });

// Express and driver lanes off, so the micro-plan gate is the lane that answers.
const POLICY = {
  'express-driver': 'off', 'express-driver-max-size': 'medium', 'express-driver-max-key-files': 5, 'express-driver-max-risk': 'low',
  'express-driver-review': 'beyond-express', 'express-lane': false, 'integration-model': 'pr-first', 'merge-sensitive-paths': [],
};

const DIRS = [];
test.after(() => { for (const d of DIRS) fs.rmSync(d, { recursive: true, force: true }); });
function recordFile(rec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-lane-cli-'));
  DIRS.push(dir);
  const file = path.join(dir, 'record.json');
  fs.writeFileSync(file, typeof rec === 'string' ? rec : JSON.stringify(rec));
  return file;
}

function harness(over = {}) {
  const out = [];
  const err = [];
  const calls = { gh: [], resolvePolicy: [] };
  const deps = {
    gh: (args) => { calls.gh.push(args); throw new Error(`unexpected gh ${args.join(' ')}`); },
    ghAvailable: () => true,
    readFile: (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    resolvePolicy: (keys, opts) => {
      calls.resolvePolicy.push({ keys, opts });
      return Object.fromEntries(keys.map((k) => [k, { value: POLICY[k], source: 'policy' }]));
    },
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    ...over,
  };
  return { deps, out, err, calls, json: () => JSON.parse(out.join('')) };
}

test('plan-lane --record-json prints the micro-plan lane and resolves exactly POLICY_KEYS', () => {
  const h = harness();
  assert.strictEqual(run(['plan-lane', '--record-json', recordFile(record(7))], h.deps), 0);
  assert.deepStrictEqual(h.json(), { number: 7, lane: 'micro-plan', reason: 'passes-micro-plan-gate' });
  assert.strictEqual(h.out.join('').split('\n').filter(Boolean).length, 1);
  assert.strictEqual(h.calls.resolvePolicy.length, 1);
  assert.deepStrictEqual(h.calls.resolvePolicy[0].keys, [...POLICY_KEYS]);
  assert.strictEqual(h.calls.gh.length, 0);
});

test('plan-lane exits 0 with lane null when no lane takes the record', () => {
  const h = harness();
  const rec = record(8, ['risk:high', 'size:high', 'type:feature']);
  assert.strictEqual(run(['plan-lane', '--record-json', recordFile(rec)], h.deps), 0);
  assert.deepStrictEqual(h.json(), { number: 8, lane: null, reason: 'outside-every-lane' });
});

test('plan-lane --record-json with no Key Files section prints key-files-missing', () => {
  const h = harness();
  const rec = record(9, LABELS, 'Surface: infra\nRisk-flags: none\n\n## Current State\n\nx\n');
  assert.strictEqual(run(['plan-lane', '--record-json', recordFile(rec)], h.deps), 0);
  assert.deepStrictEqual(h.json(), { number: 9, lane: null, reason: 'key-files-missing' });
});

test('plan-lane --record-json with a null or absent body prints body-unreadable; any other non-string body exits 2', () => {
  for (const rec of [{ ...record(10), body: null }, (({ body: _b, ...rest }) => rest)(record(10))]) {
    const h = harness();
    assert.strictEqual(run(['plan-lane', '--record-json', recordFile(rec)], h.deps), 0);
    assert.deepStrictEqual(h.json(), { number: 10, lane: null, reason: 'body-unreadable' });
  }
  const h = harness();
  assert.strictEqual(run(['plan-lane', '--record-json', recordFile({ ...record(10), body: 42 })], h.deps), 2);
  assert.strictEqual(h.out.join(''), '');
});

test('plan-lane --issue fetches the record live and passes --repo', () => {
  const h = harness();
  h.deps.gh = (args) => { h.calls.gh.push(args); return JSON.stringify(record(7)); };
  assert.strictEqual(run(['plan-lane', '--issue', '7', '--repo', 'acme/widgets'], h.deps), 0);
  assert.deepStrictEqual(h.calls.gh, [['issue', 'view', '--repo', 'acme/widgets', '--json', 'number,title,body,labels', '--', '7']]);
  assert.strictEqual(h.json().lane, 'micro-plan');
});

test('plan-lane: both flags or neither exits 2; --repo or an unknown flag alone is a usage error', () => {
  const file = recordFile(record(7));
  for (const argv of [['plan-lane'], ['plan-lane', '--issue', '7', '--record-json', file], ['plan-lane', '--repo', 'a/b'], ['plan-lane', '--issue', '7', '--run', 'x']]) {
    const h = harness();
    assert.strictEqual(run(argv, h.deps), 2, JSON.stringify(argv));
    assert.strictEqual(h.out.join(''), '');
  }
});

test('plan-lane --issue with gh absent exits 2; --record-json needs no gh', () => {
  const absent = harness({ ghAvailable: () => false });
  assert.strictEqual(run(['plan-lane', '--issue', '7'], absent.deps), 2);
  assert.strictEqual(absent.out.join(''), '');
  const mcp = harness({ ghAvailable: () => false });
  assert.strictEqual(run(['plan-lane', '--record-json', recordFile(record(7))], mcp.deps), 0);
});

test('plan-lane: an unreadable, missing or mis-shaped --record-json exits 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-lane-cli-'));
  DIRS.push(dir);
  for (const file of [path.join(dir, 'absent.json'), recordFile('not json'), recordFile({ number: 7 }), recordFile([record(7)])]) {
    const h = harness();
    assert.strictEqual(run(['plan-lane', '--record-json', file], h.deps), 2, file);
    assert.strictEqual(h.out.join(''), '');
  }
});

test('plan-lane: a failed fetch or a throwing policy read exits 1 with no stdout', () => {
  const fetchFail = harness({ gh: () => { throw new Error('HTTP 502'); } });
  assert.strictEqual(run(['plan-lane', '--issue', '7'], fetchFail.deps), 1);
  assert.strictEqual(fetchFail.out.join(''), '');

  const policyFail = harness({ resolvePolicy: () => { throw new Error('policy.yml unreadable'); } });
  assert.strictEqual(run(['plan-lane', '--record-json', recordFile(record(7))], policyFail.deps), 1);
  assert.strictEqual(policyFail.out.join(''), '');
  assert.match(policyFail.err.join(''), /policy/);
});

test('USAGE lists plan-lane', () => {
  assert.ok(USAGE.includes('express-lane.js plan-lane (--issue <n> | --record-json <file>) [--repo owner/name]'));
});
