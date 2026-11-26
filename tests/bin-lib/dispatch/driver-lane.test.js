'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  readDriverRunner, driverLaneExclusions, spawnCommentReader, LIVE_FETCH_AUDIT,
} = require('../../../plugin/bin/lib/dispatch/driver-lane');
const { ADMISSION_REASONS } = require('../../../plugin/bin/lib/driver/admission');
const { REASONS, BOUND_REASONS } = require('../../../plugin/bin/lib/express/eligibility');

const MARKER_TRUSTED = (() => {
  const { DRIVER_ESCALATION_MARKER } = require('../../../plugin/bin/lib/driver/settle');
  return { body: `escalated\n${DRIVER_ESCALATION_MARKER}`, authorAssociation: 'OWNER', url: 'u', author: 'a' };
})();
const MARKER_UNTRUSTED = { ...MARKER_TRUSTED, authorAssociation: 'NONE' };

const collector = () => { const lines = []; return { lines, stderr: { write: (s) => { lines.push(s); } } }; };
const policy = (over = {}) => ({ driverOn: true, routing: 'on', driverRoutable: (i) => i.routable === true, ...over });
const reader = (byNumber) => { const calls = []; const fn = (nums) => { calls.push(nums); return { ok: true, byNumber }; }; fn.calls = calls; return fn; };
const rec = (number, routable) => ({ number, routable });

test('AC1.1 script excludes a driver-routable singleton and keeps a standard record', () => {
  const { lines, stderr } = collector();
  const out = driverLaneExclusions({
    groups: [[rec(1, true)], [rec(2, false)]], policy: policy(), runner: 'script', stderr,
    readComments: reader({ 1: { comments: [], complete: true } }),
  });
  assert.deepEqual(out, [{ reason: 'driver-lane', records: [1], detail: { runner: 'script' } }]);
  assert.deepEqual(lines, ['driver-lane: left to the script job: #1\n']);
});

test('runner session excludes nothing, silently', () => {
  const { lines, stderr } = collector();
  const rc = reader({});
  assert.deepEqual(driverLaneExclusions({ groups: [[rec(1, true)]], policy: policy(), runner: 'session', stderr, readComments: rc }), []);
  assert.deepEqual(lines, []);
  assert.equal(rc.calls.length, 0);
});

test('AC3.1 a trusted marker keeps the record selectable', () => {
  const { stderr } = collector();
  const out = driverLaneExclusions({
    groups: [[rec(1, true)], [rec(3, true)]], policy: policy(), runner: 'script', stderr,
    readComments: reader({ 1: { comments: [MARKER_TRUSTED], complete: true }, 3: { comments: [], complete: true } }),
  });
  assert.deepEqual(out.map((e) => e.records), [[3]]);
});

test('AC3.2 a failed comment read keeps every candidate', () => {
  const { lines, stderr } = collector();
  const out = driverLaneExclusions({
    groups: [[rec(1, true)]], policy: policy(), runner: 'script', stderr,
    readComments: () => ({ ok: false, cause: 'boom' }),
  });
  assert.deepEqual(out, []);
  assert.deepEqual(lines, ['Warning: driver-lane comment read failed — no driver-lane exclusions this pull: boom\n']);
});

test('incomplete comments keep the record', () => {
  const { stderr } = collector();
  const out = driverLaneExclusions({
    groups: [[rec(1, true)]], policy: policy(), runner: 'script', stderr,
    readComments: reader({ 1: { comments: [], complete: false } }),
  });
  assert.deepEqual(out, []);
});

test('an absent comment entry keeps the record', () => {
  const { stderr } = collector();
  assert.deepEqual(driverLaneExclusions({ groups: [[rec(1, true)]], policy: policy(), runner: 'script', stderr, readComments: reader({}) }), []);
});

test('untrusted marker does not spare', () => {
  const { stderr } = collector();
  const out = driverLaneExclusions({
    groups: [[rec(1, true)]], policy: policy(), runner: 'script', stderr,
    readComments: reader({ 1: { comments: [MARKER_UNTRUSTED], complete: true } }),
  });
  assert.deepEqual(out.map((e) => e.records), [[1]]);
});

test('bundle group never excluded', () => {
  const { stderr } = collector();
  const rc = reader({});
  const out = driverLaneExclusions({ groups: [[rec(1, true), rec(2, true)]], policy: policy(), runner: 'script', stderr, readComments: rc });
  assert.deepEqual(out, []);
  assert.equal(rc.calls.length, 0);
});

test('AC5.1 express-driver off: script excludes nothing and prints one line', () => {
  const off = collector();
  assert.deepEqual(driverLaneExclusions({ groups: [[rec(1, true)]], policy: policy({ driverOn: false, routing: 'off' }), runner: 'script', stderr: off.stderr, readComments: reader({}) }), []);
  assert.deepEqual(off.lines, ['express-driver-runner: script ignored while express-driver is off; driver-routable records stay with the session drain\n']);
  const sess = collector();
  driverLaneExclusions({ groups: [[rec(1, true)]], policy: policy({ driverOn: false, routing: 'off' }), runner: 'session', stderr: sess.stderr, readComments: reader({}) });
  assert.deepEqual(sess.lines, []);
});

test('driver half unavailable under on prints the unavailable Warning, not the off line', () => {
  const { lines, stderr } = collector();
  assert.deepEqual(driverLaneExclusions({ groups: [[rec(1, true)]], policy: policy({ driverOn: false, routing: 'on' }), runner: 'script', stderr, readComments: reader({}) }), []);
  assert.deepEqual(lines, ['Warning: driver-lane: the driver predicate is unavailable this pull — no driver-lane exclusions\n']);
});

test('readDriverRunner: a throwing resolver reads session with one Warning', () => {
  const { lines, stderr } = collector();
  assert.equal(readDriverRunner({ resolvePolicy: () => { throw new Error('no policy'); }, stderr }), 'session');
  assert.deepEqual(lines, ['Warning: express-driver-runner unreadable — treated as session this pull: no policy\n']);
});

test('readDriverRunner: reads script and session, one resolver call with runDir null', () => {
  const calls = [];
  const mk = (value) => (keys, opts) => { calls.push([keys, opts]); return { 'express-driver-runner': { value, source: 'policy' } }; };
  const { stderr } = collector();
  assert.equal(readDriverRunner({ resolvePolicy: mk('script'), stderr }), 'script');
  assert.equal(readDriverRunner({ resolvePolicy: mk('session'), stderr }), 'session');
  assert.deepEqual(calls[0], [['express-driver-runner'], { runDir: null }]);
  assert.equal(calls.length, 2);
});

test('AC9.1 the left-to-the-script-job line names every excluded record', () => {
  const { lines, stderr } = collector();
  driverLaneExclusions({
    groups: [[rec(4, true)], [rec(9, true)], [rec(5, false)]], policy: policy(), runner: 'script', stderr,
    readComments: reader({ 4: { comments: [], complete: true }, 9: { comments: [], complete: true } }),
  });
  assert.deepEqual(lines, ['driver-lane: left to the script job: #4, #9\n']);
});

test('no candidates makes no comment read', () => {
  const { lines, stderr } = collector();
  const rc = reader({});
  assert.deepEqual(driverLaneExclusions({ groups: [[rec(2, false)]], policy: policy(), runner: 'script', stderr, readComments: rc }), []);
  assert.equal(rc.calls.length, 0);
  assert.deepEqual(lines, []);
});

test('spawnCommentReader: comma-joins numbers, parses stdout, maps failures to a cause', () => {
  const seen = [];
  const ok = spawnCommentReader({ spawnCli: (name, args) => { seen.push([name, args]); return { status: 0, stdout: '{"1":{"comments":[],"complete":true}}', stderr: '' }; }, cwd: '/x', env: {} });
  assert.deepEqual(ok([1, 2]), { ok: true, byNumber: { 1: { comments: [], complete: true } } });
  assert.deepEqual(seen[0], ['resolve-record-comments.js', ['1,2']]);
  const bad = spawnCommentReader({ spawnCli: () => ({ status: 3, stdout: '', stderr: 'fetch failed' }), cwd: '/x', env: {} })([1]);
  assert.equal(bad.ok, false);
  assert.match(bad.cause, /fetch failed|3/);
  const junk = spawnCommentReader({ spawnCli: () => ({ status: 0, stdout: 'nope', stderr: '' }), cwd: '/x', env: {} })([1]);
  assert.equal(junk.ok, false);
});

test('AC8.1 every eligibility and admission refusal reason is classified', () => {
  const WORDS = new Set(['driverRoutable', 'pull', 'self-clearing', 'live-check']);
  const keys = [...Object.keys(ADMISSION_REASONS), ...Object.keys(REASONS), ...Object.keys(BOUND_REASONS)];
  for (const k of keys) assert.ok(WORDS.has(LIVE_FETCH_AUDIT[k]), `reason ${k} is unclassified in LIVE_FETCH_AUDIT`);
  const known = new Set(keys);
  for (const k of Object.keys(LIVE_FETCH_AUDIT)) assert.ok(known.has(k), `LIVE_FETCH_AUDIT has a stale key ${k}`);
  assert.ok(Object.isFrozen(LIVE_FETCH_AUDIT));
  assert.equal(LIVE_FETCH_AUDIT.escalatedByDriver, 'live-check');
  assert.equal(LIVE_FETCH_AUDIT.commentsUnreadable, 'live-check');
});

test('self-clearing rows: live-only unreadable facts and the open blocker', () => {
  for (const k of ['openBlocker', 'blockerFactsUnreadable', 'prFactsUnreadable', 'stateUnreadable', 'labelsUnreadable']) assert.equal(LIVE_FETCH_AUDIT[k], 'self-clearing', k);
  for (const k of ['noBuildGrant', 'parked', 'blocked', 'openPR', 'notOpen']) assert.equal(LIVE_FETCH_AUDIT[k], 'pull', k);
});

test('a throwing readComments takes the comment-read-failed Warning, nothing excluded', () => {
  const { lines, stderr } = collector();
  const out = driverLaneExclusions({ groups: [[rec(1, true)]], policy: policy(), runner: 'script', stderr, readComments: () => { throw new Error('reader blew up'); } });
  assert.deepEqual(out, []);
  assert.deepEqual(lines, ['Warning: driver-lane comment read failed — no driver-lane exclusions this pull: reader blew up\n']);
});

test('a reader returning no result or no cause prints the fixed cause, never null or undefined', () => {
  for (const bad of [undefined, null, { ok: false }]) {
    const { lines, stderr } = collector();
    driverLaneExclusions({ groups: [[rec(1, true)]], policy: policy(), runner: 'script', stderr, readComments: () => bad });
    assert.deepEqual(lines, ['Warning: driver-lane comment read failed — no driver-lane exclusions this pull: no result\n']);
  }
});

test('readDriverRunner: an invalid entry reads session', () => {
  const { stderr } = collector();
  assert.equal(readDriverRunner({ resolvePolicy: () => ({ 'express-driver-runner': { value: 'script', source: 'default', invalid: true } }), stderr }), 'session');
});

// ---- runFromFiles through its injectable deps ----

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runFromFiles } = require('../../../plugin/bin/lib/dispatch/driver-lane');

const BODY = ['## Current State', '', 'x.', '', '## Deliverables', '', '- Add.', '', '## Acceptance Criteria', '', '- Present.', '',
  '## Release Note', '', 'Adds.', '', '## Technical Approach', '', '### Key Files', '',
  '- `plugin/skills/init/claude-md-template.md` (modify)', '- `plugin/skills/init/rules-template.md` (modify)', ''].join('\n');
const issueOf = (number, labels) => ({ number, body: BODY, labels: labels.map((name) => ({ name })) });
const ROUTABLE = ['risk:low', 'size:medium', 'ceremony:fast-lane', 'type:task'];
const VALUES = {
  'express-driver-runner': 'script', 'express-lane': false, 'express-driver': 'on', 'dispatch-fastlane-bundle-cap': 3, 'work-links': 'body-text',
  'integration-model': 'pr-first', 'merge-sensitive-paths': [], 'express-driver-max-size': 'medium', 'express-driver-max-key-files': 3, 'express-driver-review': 'beyond-express',
};
const resolver = (values = VALUES) => (keys) => Object.fromEntries(keys.map((k) => [k, { value: values[k], source: 'policy' }]));

function fixture(groups) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'driver-lane-'));
  const groupsPath = path.join(dir, 'groups.json');
  fs.writeFileSync(groupsPath, JSON.stringify(groups));
  return { dir, groupsPath, exclusionsPath: path.join(dir, 'exclusions.json') };
}

test('runFromFiles happy path appends a driver-lane entry through appendExclusion', () => {
  const f = fixture([[issueOf(20, ROUTABLE)], [issueOf(21, ['risk:low', 'size:high', 'ceremony:fast-lane', 'type:task'])]]);
  const { lines, stderr } = collector();
  const calls = [];
  const spawnCli = (name, args) => { calls.push([name, args]); return { status: 0, stdout: '{"20":{"comments":[],"complete":true}}', stderr: '' }; };
  const out = runFromFiles({ groupsPath: f.groupsPath, exclusionsPath: f.exclusionsPath, transport: 'gh', stderr, deps: { resolvePolicy: resolver(), spawnCli } });
  assert.deepEqual(out, [{ reason: 'driver-lane', records: [20], detail: { runner: 'script' } }]);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.exclusionsPath, 'utf8')), out);
  assert.deepEqual(calls, [['resolve-record-comments.js', ['20']]]);
  assert.deepEqual(lines, ['driver-lane: left to the script job: #20\n']);
});

test('runFromFiles: a failed second read prints the Warning, does not throw, appends nothing', () => {
  const f = fixture([[issueOf(20, ROUTABLE)]]);
  const { lines, stderr } = collector();
  const out = runFromFiles({ groupsPath: f.groupsPath, exclusionsPath: f.exclusionsPath, transport: 'gh', stderr, deps: { resolvePolicy: resolver(), spawnCli: () => ({ status: 3, stdout: '', stderr: 'fetch failed\n' }) } });
  assert.deepEqual(out, []);
  assert.equal(fs.existsSync(f.exclusionsPath), false);
  assert.deepEqual(lines, ['Warning: driver-lane comment read failed — no driver-lane exclusions this pull: fetch failed\n']);
});

test('runFromFiles: the files transport never spawns and reports the read failed', () => {
  const f = fixture([[issueOf(20, ROUTABLE)]]);
  const { lines, stderr } = collector();
  const out = runFromFiles({ groupsPath: f.groupsPath, exclusionsPath: f.exclusionsPath, transport: 'files', stderr, deps: { resolvePolicy: resolver(), spawnCli: () => { throw new Error('spawned'); } } });
  assert.deepEqual(out, []);
  assert.deepEqual(lines, ['Warning: driver-lane comment read failed — no driver-lane exclusions this pull: comment read unavailable on the files transport\n']);
});

test('runFromFiles: a policy-layer warning path writes through a function, never throws', () => {
  const f = fixture([[issueOf(20, ROUTABLE)]]);
  const { lines, stderr } = collector();
  const failing = (keys) => {
    if (keys.length === 1 && keys[0] === 'express-driver-runner') return { 'express-driver-runner': { value: 'script', source: 'policy' } };
    throw new Error('policy boom');
  };
  const out = runFromFiles({ groupsPath: f.groupsPath, exclusionsPath: f.exclusionsPath, transport: 'gh', stderr, deps: { resolvePolicy: failing, spawnCli: () => { throw new Error('spawned'); } } });
  assert.deepEqual(out, []);
  assert.ok(lines.some((l) => l.startsWith('express-lane: policy read failed')), lines.join('|'));
});
