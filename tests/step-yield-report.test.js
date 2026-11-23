// tests/step-yield-report.test.js
//
// #5556: tools/step-yield-report.js totals the review counters of every run directory under a
// pipelines root and its archive/. Two runs: one derived in memory from events.jsonl and decisions.md
// (built through the real writers, as tests/bin-lib/timing/step-yield.test.js does), one carrying a
// step-yield.json whose numbers differ from what deriving its directory would give. The archive on the
// maintainer's machine is not an automated test; the AC7 comparison is a measurement.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { run, listRunDirs } = require(path.join(ROOT, 'tools', 'step-yield-report.js'));
const { formatEntry, hms } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'log-decision', 'append'));
const { resolveTiebreak } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'tiebreak'));
const { appendEvent } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'hooks', 'context'));
const { SCHEMA_VERSION } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'timing', 'step-yield'));

const BASE = Date.UTC(2026, 10, 12, 9, 0, 0);
const at = (sec) => new Date(BASE + sec * 1000);

function atClock(when, fn) {
  const Real = Date;
  class Frozen extends Real {
    constructor(...args) { if (args.length === 0) super(when.getTime()); else super(...args); }
    static now() { return when.getTime(); }
  }
  global.Date = Frozen;
  try { return fn(); } finally { global.Date = Real; }
}

const entry = (sec, status, step, text) => formatEntry({ status, now: at(sec), step, text, reversibility: 'high' });
const QUOTE_FILE = 'line one\nconst quoteTextHere = 1;\nline three\n'.repeat(30);
const verdictLine = (lens, file, line, reply, sec) => `- ${resolveTiebreak(
  { lens, path: file, line, claim: 'claim', kind: 'unconfirmed', reporterSeverity: 'medium' }, reply,
  { readFile: () => QUOTE_FILE, now: at(sec) }).logLine}`;

// A derived run: review lasts 1200..2400s; two pair lines (one both, one one), one confirmed and one
// refuted tiebreak, and one review-marked line no reader recognises.
function buildDerivedRun(dir, extraLines = []) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [sec, type, data] of [
    [0, 'skill_invoked', { skill: 'claude-tweaks:build' }],
    [1200, 'skill_invoked', { skill: 'claude-tweaks:review' }],
    [2400, 'skill_invoked', { skill: 'claude-tweaks:wrap-up' }],
    [2700, 'close-run', {}],
  ]) atClock(at(sec), () => appendEvent(dir, type, data));
  fs.writeFileSync(path.join(dir, 'decisions.md'), [
    '# Decisions', '',
    entry(1210, 'AUTO', 'Reproduction', 'lens "3a" finding plugin/a.js:10 reproduced. Confirmed.'),
    entry(1220, 'STAGED', 'Reproduction', 'lens "3b" finding plugin/b.js:20 not reproduced. Staged to Review Console as low-confidence.'),
    verdictLine('3b', 'plugin/b.js', 20, 'Verdict: confirmed\nEvidence: plugin/b.js:20 `quoteTextHere`\nSeverity: medium\nSTATUS: DONE', 1230),
    entry(1240, 'STAGED', 'Reproduction', 'lens "3b" finding plugin/b.js:30 not reproduced. Staged to Review Console as low-confidence.'),
    verdictLine('3b', 'plugin/b.js', 30, 'Verdict: refuted\nEvidence: plugin/b.js:30 `quoteTextHere`\nSeverity: low\nSTATUS: DONE', 1250),
    `- AUTO ${hms(at(1280))} — Reproduction: lens "3a" mystery shape.`,
    ...extraLines,
    '',
  ].join('\n'));
}

// A precomputed yield whose numbers no derivation of its (empty) directory would give.
const bucket = (over = {}) => ({ decisions: { AUTO: 0 }, findings: null, unparsed: { count: 0, samples: [] }, ...over });
function precomputed(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const counters = (raised, both, one, conf, ref) => ({
    raised, both, one, relabeled: 0,
    tiebreak: { byVerdict: { confirmed: conf, refuted: ref, 'cant-tell': 0, unsettled: 0 }, byOutcome: { confirmed: conf, drop: ref, digest: 0, console: 0, none: 0 } },
  });
  const f = { ...counters(10, 4, 6, 5, 2), byLens: { '3f': counters(10, 4, 6, 5, 2) } };
  fs.writeFileSync(path.join(dir, 'step-yield.json'), JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    steps: [{ phase: 'review', ...bucket({ decisions: { AUTO: 18, STAGED: 2 }, findings: f, unparsed: { count: 1, samples: ['x'] } }) }],
    unattributed: bucket(),
    unparsed: { count: 0, samples: [] },
  }));
}

function treeSnapshot(root) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else out.push(`${p}:${fs.statSync(p).size}`);
    }
  };
  walk(root);
  return out.sort();
}

// Every temp root this file makes, removed once the file's tests are done.
const CREATED = [];
after(() => { for (const dir of CREATED) fs.rmSync(dir, { recursive: true, force: true }); });

function setup(extraLines = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-step-yield-report-'));
  CREATED.push(root);
  buildDerivedRun(path.join(root, '2026-11-12T090000-record-1'), extraLines);
  precomputed(path.join(root, 'archive', '2026-11-10T090000-record-2'));
  return root;
}

function runCli(argv) {
  const out = []; const errs = [];
  const code = run(argv, { log: (s) => out.push(s), err: (s) => errs.push(s) });
  return { code, out: out.join('\n'), errs: errs.join('\n') };
}

test('totals add a derived run and a precomputed yield, the precomputed file wins for its run', () => {
  const root = setup();
  const { code, out } = runCli([root, '--json']);
  assert.equal(code, 0);
  const s = JSON.parse(out);
  assert.equal(s.runDirsScanned, 2);
  assert.equal(s.runsWithReviewFindings, 2);
  assert.equal(s.runsReadFromFile, 1);
  // derived run: both 1 (reproduced), one 2 (two not-reproduced); precomputed: both 4, one 6.
  assert.equal(s.findings.both, 5);
  assert.equal(s.findings.one, 8);
  assert.equal(s.findings.raised, 13);
  assert.equal(s.findings.byVerdict.confirmed, 6, 'derived 1 + precomputed 5');
  assert.equal(s.findings.byVerdict.refuted, 3, 'derived 1 + precomputed 2');
  assert.deepEqual(Object.keys(s.byLens).sort(), ['3a', '3b', '3f']);
  assert.equal(s.byLens['3f'].raised, 10);
  assert.equal(s.byLens['3b'].byVerdict.confirmed, 1);
});

test('a lens named like an Object.prototype member keeps its counts and does not abort the report', () => {
  const root = setup([
    entry(1290, 'AUTO', 'Reproduction', 'lens "constructor" finding plugin/a.js:11 reproduced. Confirmed.'),
    entry(1295, 'STAGED', 'Reproduction', 'lens "__proto__" finding plugin/b.js:21 not reproduced. Staged to Review Console as low-confidence.'),
    entry(1296, 'STAGED', 'Reproduction', 'lens "toString" finding plugin/b.js:22 not reproduced. Staged to Review Console as low-confidence.'),
  ]);
  const json = runCli([root, '--json']);
  assert.equal(json.code, 0);
  assert.equal(json.errs, '');
  const s = JSON.parse(json.out);
  assert.equal(s.runsFailed, 0);
  const own = (k) => Object.getOwnPropertyDescriptor(s.byLens, k).value;
  assert.deepEqual(Object.keys(s.byLens).sort(), ['3a', '3b', '3f', '__proto__', 'constructor', 'toString']);
  assert.deepEqual({ raised: own('constructor').raised, both: own('constructor').both }, { raised: 1, both: 1 });
  assert.deepEqual({ raised: own('__proto__').raised, one: own('__proto__').one }, { raised: 1, one: 1 });
  assert.deepEqual({ raised: own('toString').raised, one: own('toString').one }, { raised: 1, one: 1 });
  assert.equal(s.findings.raised, 13 + 3, 'no count lost');
  const text = runCli([root]);
  assert.equal(text.code, 0);
  assert.match(text.out, /^constructor\s+1\s+1\s+0/m);
});

test('the unparsed share counts the review step only, then adds the unattributed bucket', () => {
  const root = setup();
  const s = JSON.parse(runCli([root, '--json']).out);
  // derived review step: 6 entry lines (5 recognised, 1 unrecognised); precomputed: 20 decisions.
  assert.equal(s.reviewLines.total, 26);
  assert.equal(s.reviewLines.unparsed, 2);
  assert.equal(s.reviewLines.unparsedShare, 2 / 26);
  assert.ok(s.reviewLines.withUnattributed.total >= s.reviewLines.total);
});

test('the text report names every total and exits 0', () => {
  const root = setup();
  const { code, out } = runCli([root]);
  assert.equal(code, 0);
  assert.match(out, /run dirs scanned 2 \| runs with review findings 2/);
  assert.match(out, /findings raised 13 \| reported by both reviewers 5 \| reported by one reviewer 8/);
  assert.match(out, /tiebreak by verdict: confirmed 6 \| refuted 3/);
  assert.match(out, /^3f\s+10\s+4\s+6\s+5\s+2$/m);
  assert.match(out, /unparsed share \d+\.\d\d%/);
});

test('the report writes nothing under the root', () => {
  const root = setup();
  const before = treeSnapshot(root);
  runCli([root]);
  runCli([root, '--json']);
  assert.deepEqual(treeSnapshot(root), before);
});

test('a present but corrupt step-yield.json derives instead and is counted, never read as absent', () => {
  const root = setup();
  const bad = path.join(root, 'archive', '2026-11-09T090000-record-3');
  fs.mkdirSync(bad, { recursive: true });
  fs.writeFileSync(path.join(bad, 'step-yield.json'), '{ not json');
  const wrong = path.join(root, 'archive', '2026-11-09T090000-record-4');
  fs.mkdirSync(wrong, { recursive: true });
  fs.writeFileSync(path.join(wrong, 'step-yield.json'), JSON.stringify({ steps: 'nope' }));
  const s = JSON.parse(runCli([root, '--json']).out);
  assert.equal(s.runsFileUnreadable, 2);
  assert.equal(s.runsReadFromFile, 1, 'only the valid precomputed file counts as read');
  assert.match(runCli([root]).out, /step-yield\.json present but unreadable or not a yield \(derived instead\) 2/);
  // an absent file is not counted
  assert.equal(JSON.parse(runCli([setup(), '--json']).out).runsFileUnreadable, 0);
});

test('a step-yield.json of another schemaVersion is derived over in memory and counted as stale, printed', () => {
  const root = setup();
  const other = path.join(root, 'archive', '2026-11-09T090000-record-5');
  precomputed(other);
  const yieldFile = path.join(other, 'step-yield.json');
  fs.writeFileSync(yieldFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(yieldFile, 'utf8')), schemaVersion: SCHEMA_VERSION + 1 }));
  const noVersion = path.join(root, 'archive', '2026-11-09T090000-record-6');
  precomputed(noVersion);
  const bare = JSON.parse(fs.readFileSync(path.join(noVersion, 'step-yield.json'), 'utf8'));
  delete bare.schemaVersion;
  fs.writeFileSync(path.join(noVersion, 'step-yield.json'), JSON.stringify(bare));
  const s = JSON.parse(runCli([root, '--json']).out);
  assert.equal(s.runsFileStale, 2);
  assert.equal(s.runsFileUnreadable, 0, 'stale is its own count');
  assert.equal(s.runsReadFromFile, 1, 'only the one current-version file is read as written');
  // the stale files' 10 precomputed findings are not added: the current file contributes 10, the derived run 3 (1 both + 2 one) ... and the two stale dirs derive to nothing
  assert.equal(s.findings.raised, 10 + 3);
  assert.match(runCli([root]).out, /step-yield\.json of another schemaVersion than \d+ \(derived instead\) 2/);
  assert.equal(JSON.parse(runCli([setup(), '--json']).out).runsFileStale, 0);
});

test('no root exits 2; a root that does not exist scans nothing', () => {
  const none = runCli([]);
  assert.equal(none.code, 2);
  assert.match(none.errs, /usage/);
  // A root that cannot be read is named on stderr and exits 2, never read as an empty archive.
  const noRoot = path.join(os.tmpdir(), 'ct-no-such-root-xyz');
  const bad = runCli([noRoot, '--json']);
  assert.equal(bad.code, 2);
  assert.match(bad.errs, /cannot read .*ct-no-such-root-xyz/);
  const missing = JSON.parse(bad.out);
  assert.equal(missing.runDirsScanned, 0);
  assert.equal(missing.reviewLines.unparsedShare, null);
  assert.equal(missing.rootsUnreadable.length, 1);
  // A readable root beside it still reports, and a root without archive/ is not an error.
  assert.equal(runCli([setup()]).code, 0);
});

test('listRunDirs reads a root and its archive, skipping a directory named archive', () => {
  const root = setup();
  const dirs = listRunDirs([root], fs).map((d) => path.relative(root, d)).sort();
  assert.deepEqual(dirs, [path.join('2026-11-12T090000-record-1'), path.join('archive', '2026-11-10T090000-record-2')].sort());
});

// ---- #5580: per-run rows, the lane rule, the window and the per-lane step table ----

const T = require(path.join(ROOT, 'tools', 'step-yield-report.js'));
const { deriveStepYield } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'timing', 'step-yield'));
const mkTmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-step-yield-lane-')); CREATED.push(d); return d; };
const write = (dir, name, text) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), text); };
const jl = (...objs) => `${objs.map((o) => (typeof o === 'string' ? o : JSON.stringify(o))).join('\n')}\n`;

test('laneOf: driver events win, then an express proceed line, then config.yml, then none', () => {
  const root = mkTmp();
  const proceed = entry(10, 'AUTO', 'Express lane check', '#7 proceed — small and green.');
  const escalate = entry(20, 'AUTO', 'Express lane', 'escalated #7 to /flow (reason: scope) — grew.');
  const d1 = path.join(root, 'a'); write(d1, 'driver-events.jsonl', jl({ step: 'worker', ms: 1 })); write(d1, 'decisions.md', `${proceed}\n`); write(d1, 'config.yml', 'ceremony-profile: standard\n');
  const d2 = path.join(root, 'b'); write(d2, 'decisions.md', `# Decisions\n\n${proceed}\n`); write(d2, 'config.yml', 'ceremony-profile: standard\n');
  const d3 = path.join(root, 'c'); write(d3, 'config.yml', 'ceremony-profile: fast-lane\n');
  const d4 = path.join(root, 'd'); fs.mkdirSync(d4);
  const d5 = path.join(root, 'e'); write(d5, 'decisions.md', `${entry(10, 'AUTO', 'Express lane check', '#1 escalate — too big.')}\n`); write(d5, 'config.yml', 'ceremony-profile: standard\n');
  const d6 = path.join(root, 'f'); write(d6, 'decisions.md', `${proceed}\n${escalate}\n`); write(d6, 'config.yml', 'ceremony-profile: standard\n');
  assert.deepEqual(T.laneOf(d1, fs), { lane: 'driver', source: 'driver-events' });
  assert.deepEqual(T.laneOf(d2, fs), { lane: 'express', source: 'express-check' });
  assert.deepEqual(T.laneOf(d3, fs), { lane: 'fast-lane', source: 'config' });
  assert.deepEqual(T.laneOf(d4, fs), { lane: 'none', source: 'none' });
  assert.deepEqual(T.laneOf(d5, fs), { lane: 'standard', source: 'config' });
  assert.deepEqual(T.laneOf(d6, fs), { lane: 'standard', source: 'config' }, 'an escalation after the proceed cancels it');
  // an escalation of another record does not cancel record 7's proceed
  const d7 = path.join(root, 'g'); write(d7, 'decisions.md', `${proceed}\n${entry(20, 'AUTO', 'Express lane', 'escalated #8 to /flow (reason: scope) — grew.')}\n`);
  assert.deepEqual(T.laneOf(d7, fs), { lane: 'express', source: 'express-check' });
});

test('lane and closed state degrade; start time comes from the run id', () => {
  const root = mkTmp();
  const bare = path.join(root, 'bare'); fs.mkdirSync(bare);
  assert.equal(T.closedOf(bare, fs), false);
  assert.deepEqual(T.laneOf(bare, fs), { lane: 'none', source: 'none' });
  const clean = path.join(root, 'clean'); write(clean, 'run-state.json', '{"status":"clean"}');
  assert.equal(T.closedOf(clean, fs), true);
  const open = path.join(root, 'open'); write(open, 'run-state.json', '{"status":"running"}');
  assert.equal(T.closedOf(open, fs), false);
  const corrupt = path.join(root, 'corrupt'); write(corrupt, 'run-state.json', '{ nope');
  assert.equal(T.closedOf(corrupt, fs), false);
  assert.equal(T.startedAtOf('2026-11-17T060227-record-5580'), '2026-11-17T06:02:27.000Z');
  assert.equal(T.startedAtOf('wrap-up-standalone'), null);
  assert.equal(T.startedAtOf('2026-13-17T060227-record-1'), null, 'a month that does not exist is not a time');
  assert.equal(T.startedAtOf('2026-11-17T250227-record-1'), null);
});

test('a run with a much later last event still sorts by its id timestamp', () => {
  const root = mkTmp();
  const oldRun = path.join(root, '2026-11-01T000000-record-1');
  const newRun = path.join(root, '2026-11-10T000000-record-2');
  for (const dir of [oldRun, newRun]) { write(dir, 'run-state.json', '{"status":"clean","updatedAt":"2026-11-05T00:00:00.000Z"}'); write(dir, 'config.yml', 'ceremony-profile: standard\n'); }
  write(oldRun, 'events.jsonl', jl({ ts: '2026-12-31T00:00:00.000Z', type: 'worktree-reap' }));
  const s = JSON.parse(runCli([root, '--runs', '--window', '1', '--json']).out);
  assert.deepEqual(s.window.runs.map((r) => r.runId), ['2026-11-10T000000-record-2']);
  assert.equal(s.window.newest, '2026-11-10T00:00:00.000Z');
  assert.equal(s.window.oldest, '2026-11-10T00:00:00.000Z');
  assert.equal(Object.hasOwn(s.runs[0], 'closedAt'), false);
});

test('each run dir derives once when --runs and --window are both given', () => {
  const root = setup();
  let calls = 0;
  const out = [];
  const code = run([root, '--runs', '--window', '5', '--json'], { log: (x) => out.push(x), err: () => {}, derive: (...a) => { calls++; return deriveStepYield(...a); } });
  assert.equal(code, 0);
  assert.equal(JSON.parse(out.join('\n')).runs.length, 2);
  assert.equal(calls, 1, 'two run dirs, one of which has a step-yield.json: one derive, not two');
});

test('driver steps sum ms and usage per step, tokens null without usage, malformed lines unparsed', () => {
  const root = mkTmp();
  const usage = { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 };
  write(root, 'driver-events.jsonl', jl(
    { step: 'worker', ms: 60000, status: 'ok', usage }, { step: 'worker', ms: 120000, status: 'ok', usage },
    { step: 'test', ms: 30000, status: 'fail' }, { step: 'final', ms: 5, status: 'ok' }, { step: 'budget', status: 'ok' }, 'not json', { nostep: 1 },
  ));
  const r = T.driverStepsOf(root, fs);
  assert.deepEqual(r.steps.map((s) => s.name), ['worker', 'test']);
  assert.deepEqual(r.steps[0], { name: 'worker', count: 2, minutes: 3, tokens: 20, failed: 0 });
  assert.equal(r.steps[1].tokens, null);
  assert.equal(r.steps[1].failed, 1);
  assert.equal(r.unparsed, 2);
  assert.equal(T.driverStepsOf(path.join(root, 'absent'), fs), null);
});

test('#5997: step-yield counts the relaunch\'s worker, commit and test lines in their rows', () => {
  const usage = { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 };
  const byName = (r) => Object.fromEntries(r.steps.map((s) => [s.name, s]));
  // A relaunch on cannot-complete: the first worker stops, the relaunch's worker, commit and test follow.
  const a = mkTmp();
  write(a, 'driver-events.jsonl', jl(
    { step: 'worker', ms: 60000, status: 'stop', usage }, { step: 'worker', ms: 120000, status: 'ok', usage, attempt: 2, trigger: 'cannot-complete' },
    { step: 'commit', ms: 10, status: 'ok' }, { step: 'test', ms: 30000, status: 'ok' },
  ));
  const ra = byName(T.driverStepsOf(a, fs));
  assert.deepEqual(ra.worker, { name: 'worker', count: 2, minutes: 3, tokens: 20, failed: 1 });
  assert.equal(ra.commit.count, 1);
  assert.equal(ra.test.count, 1);
  // A relaunch on red tests: a second commit and a second test line.
  const b = mkTmp();
  write(b, 'driver-events.jsonl', jl(
    { step: 'worker', ms: 60000, status: 'ok' }, { step: 'commit', ms: 10, status: 'ok' }, { step: 'test', ms: 30000, status: 'stop' },
    { step: 'worker', ms: 60000, status: 'ok', attempt: 2, trigger: 'red-tests' }, { step: 'commit', ms: 10, status: 'ok' }, { step: 'test', ms: 30000, status: 'ok' },
  ));
  const rb = byName(T.driverStepsOf(b, fs));
  assert.deepEqual([rb.test.count, rb.test.failed, rb.commit.count, rb.worker.count], [2, 1, 2, 2]);
});

test('runRow maps a derived yield to step rows', () => {
  const root = mkTmp();
  const dir = path.join(root, '2026-11-12T090000-record-1');
  buildDerivedRun(dir);
  write(dir, 'run-state.json', '{"status":"clean"}');
  const row = T.runRow(dir, { fs, derive: deriveStepYield });
  assert.equal(row.runId, '2026-11-12T090000-record-1');
  assert.equal(row.closed, true);
  assert.equal(row.yieldSource, 'derived');
  assert.deepEqual([row.lane, row.laneSource, row.driverSteps], ['none', 'none', null]);
  const review = row.steps.find((s) => s.name === 'review');
  assert.equal(review.ran, true);
  assert.equal(review.raised, 3);
  assert.equal(review.confirmed, 2, 'one reported by both reviewers plus one confirmed tiebreak');
  assert.equal(review.tokens, null, 'no timing.json, no cost');
});

test('runRow carries the driver lines that did not parse', () => {
  const dir = path.join(mkTmp(), '2026-11-12T090000-drive-1');
  write(dir, 'driver-events.jsonl', jl({ step: 'worker', ms: 60000, status: 'ok' }, 'not json'));
  const derive = () => ({ steps: [], unattributed: {} });
  const row = T.runRow(dir, { fs, derive });
  assert.equal(row.lane, 'driver');
  assert.equal(row.driverUnparsed, 1);
  assert.equal(T.runRow(path.join(mkTmp(), 'x'), { fs, derive }).driverUnparsed, null, 'no driver events, no count');
});

test('a tokens object whose four fields are all null is unknown cost, not 0', () => {
  const step = (phase, tokens) => ({ phase, minutes: 1, tokens, agents: null, commits: {}, events: {}, decisions: {}, findings: null, verify: { fail: 0 } });
  const derive = () => ({ steps: [
    step('review', { input: null, output: null, cacheRead: null, cacheCreate: null }),
    step('test', { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 }),
    step('build', { input: 1, output: null, cacheRead: 2, cacheCreate: null }),
  ], unattributed: {} });
  const by = Object.fromEntries(T.runRow(path.join(mkTmp(), 'x'), { fs, derive }).steps.map((s) => [s.name, s.tokens]));
  assert.deepEqual(by, { review: null, test: 0, build: 3 });
});

test('commits count the commit action only, and only after the build is a fix', () => {
  const step = (phase, commits) => ({ phase, minutes: 1, tokens: null, agents: null, commits, events: {}, decisions: {}, findings: null, verify: { fail: 0 } });
  const derive = () => ({ steps: [step('build', { commit: 2, push: 1 }), step('review', { commit: 1, push: 1, rm: 1 })], unattributed: {} });
  const row = T.runRow(path.join(mkTmp(), 'x'), { fs, derive });
  const by = Object.fromEntries(row.steps.map((s) => [s.name, s]));
  assert.deepEqual([by.build.commits, by.build.fixCommits], [2, 0]);
  assert.deepEqual([by.review.commits, by.review.fixCommits], [1, 1]);
});

const mkRow = (id, lane, startedAt, over = {}) => ({ runId: id, closed: true, startedAt, lane, laneSource: 'config', yieldSource: 'file', steps: [], driverSteps: null, ...over });
const widenFixture = () => {
  const day = (n) => `2026-11-${String(n).padStart(2, '0')}T00:00:00.000Z`;
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push(mkRow(`2026-11-${10 + i}T000000-record-s${i}`, 'standard', day(10 + i)));
  rows.push(mkRow('2026-11-12T120000-record-f1', 'fast-lane', '2026-11-12T12:00:00.000Z'));
  rows.push(mkRow('2026-11-02T000000-record-f2', 'fast-lane', day(2)), mkRow('2026-11-01T000000-record-f3', 'fast-lane', day(1)));
  rows.push(mkRow('2026-11-09T000000-record-undated', 'standard', null));
  rows.push(mkRow('2026-11-09T000001-record-open', 'standard', day(9), { closed: false }));
  rows.push(mkRow('2026-11-01T000000-wrap-up-standalone', 'standard', day(14)));
  return rows;
};

test('window widening', () => {
  const sel = T.selectWindow(widenFixture(), { window: 5, laneFloor: 3 });
  assert.equal(sel.runs.length, 5);
  assert.deepEqual(sel.runs.map((r) => r.runId), [
    '2026-11-15T000000-record-s5', '2026-11-14T000000-record-s4', '2026-11-13T000000-record-s3', '2026-11-12T120000-record-f1', '2026-11-12T000000-record-s2',
  ]);
  assert.equal(sel.undated, 1);
  const ff = sel.lanes['fast-lane'];
  assert.deepEqual([ff.inWindow, ff.used, ff.widened, ff.belowFloor, ff.rows.length], [1, 3, true, false, 3]);
  assert.equal(ff.archiveTotal, 3);
  const std = sel.lanes.standard;
  assert.deepEqual([std.inWindow, std.used, std.widened, std.rows.length], [4, 4, false, 4], 'a lane with enough in the window is not widened');
  assert.deepEqual([std.undated, std.archiveTotal, ff.undated], [1, 7, 0], 'a lane counts its undated closed runs in archiveTotal');
  const seven = T.selectWindow(widenFixture(), { window: 5, laneFloor: 7 }).lanes.standard;
  assert.deepEqual([seven.belowFloor, seven.used], [false, 6], 'the undated run counts toward the floor but is not used');
  const tight = T.selectWindow(widenFixture(), { window: 5, laneFloor: 4 });
  assert.deepEqual([tight.lanes['fast-lane'].belowFloor, tight.lanes['fast-lane'].archiveTotal], [true, 3]);
});

const sRow = (name, over = {}) => ({ name, ran: true, minutes: 1, tokens: null, agents: null, commits: 0, fixCommits: 0, verifyFail: 0, raised: 0, confirmed: 0, ...over });

test('stepTable counts outcome-changing runs per lane and step', () => {
  const rows = [
    mkRow('2026-11-10T000000-record-a', 'standard', '2026-11-10T00:00:00.000Z', { steps: [sRow('review', { confirmed: 1, minutes: 4 }), sRow('build', { commits: 1 })] }),
    mkRow('2026-11-11T000000-record-b', 'standard', '2026-11-11T00:00:00.000Z', { steps: [sRow('review', { confirmed: 0, minutes: 2, tokens: 10 }), sRow('build', { commits: 1 })] }),
  ];
  const t = T.stepTable(T.selectWindow(rows, { window: 10, laneFloor: 1 })).standard;
  assert.equal(t.review.runs, 2);
  assert.equal(t.review.outcome.confirmedRuns, 1);
  assert.equal(t.review.outcome.anyRuns, 1);
  assert.deepEqual(t.review.minutes, { median: 3, sum: 6 });
  assert.deepEqual(t.review.tokens, { median: 10, sum: 10, nullRuns: 1 });
  assert.deepEqual(t.build.tokens, { median: null, sum: null, nullRuns: 2 });
  assert.deepEqual(t.build.agents, { median: null, sum: null, nullRuns: 2 });
  assert.equal(t.build.outcome.commitRuns, 2);
  assert.equal(t.build.outcome.anyRuns, 0, 'a build commit is the product, not an outcome change');
  // a failed gate and a fix commit each make a run count
  const more = mkRow('2026-11-12T000000-record-c', 'standard', '2026-11-12T00:00:00.000Z', { steps: [sRow('test', { verifyFail: 1 }), sRow('review', { fixCommits: 1, commits: 1 })] });
  const t2 = T.stepTable(T.selectWindow([...rows, more], { window: 10, laneFloor: 1 })).standard;
  assert.deepEqual([t2.test.outcome.verifyFailRuns, t2.test.outcome.anyRuns], [1, 1]);
  assert.deepEqual([t2.review.outcome.fixCommitRuns, t2.review.outcome.anyRuns], [1, 2]);
});

test("stepTable reads a widened lane's own rows", () => {
  const rows = widenFixture().map((r) => ({ ...r, steps: [sRow('review')] }));
  const sel = T.selectWindow(rows, { window: 5, laneFloor: 3 });
  const t = T.stepTable(sel);
  assert.equal(t['fast-lane'].review.runs, 3, 'the widened set, not the one in-window run');
  assert.equal(t.standard.review.runs, 4);
});

test('the driver lane is keyed by driver steps', () => {
  const driverSteps = [{ name: 'worker', count: 1, minutes: 18, tokens: 100, failed: 0 }, { name: 'test', count: 2, minutes: 2, tokens: null, failed: 1 }];
  const rows = [mkRow('2026-11-12T000000-drive-1', 'driver', '2026-11-12T00:00:00.000Z', { steps: [sRow('build', { tokens: null })], driverSteps })];
  const t = T.stepTable(T.selectWindow(rows, { window: 5, laneFloor: 1 })).driver;
  assert.deepEqual(Object.keys(t), ['worker', 'test']);
  assert.equal(t.worker.agents.nullRuns, 1);
  assert.equal(t.worker.tokens.sum, 100);
  assert.deepEqual([t.test.outcome.verifyFailRuns, t.test.outcome.fixCommitRuns, t.test.outcome.anyRuns], [1, 0, 1]);
});

test('driver nullCost follows driver steps', () => {
  const driverSteps = [{ name: 'worker', count: 1, minutes: 1, tokens: 5, failed: 0 }];
  const nullSteps = [{ name: 'worker', count: 1, minutes: 1, tokens: null, failed: 0 }];
  const yieldNull = [sRow('build', { tokens: null })];
  const withCost = mkRow('2026-11-12T000000-drive-1', 'driver', '2026-11-12T00:00:00.000Z', { steps: yieldNull, driverSteps });
  const noCost = mkRow('2026-11-11T000000-drive-2', 'driver', '2026-11-11T00:00:00.000Z', { steps: [sRow('build', { tokens: 9 })], driverSteps: nullSteps });
  const sel = T.selectWindow([withCost, noCost], { window: 5, laneFloor: 1 });
  assert.equal(sel.lanes.driver.nullCost, 1);
  assert.equal(sel.lanes.driver.rows.length, 2);
  const std = T.selectWindow([mkRow('2026-11-12T000000-record-1', 'standard', '2026-11-12T00:00:00.000Z', { steps: yieldNull })], { window: 5, laneFloor: 1 });
  assert.equal(std.lanes.standard.nullCost, 1, 'a non-driver lane reads the yield steps');
});

test('the CLI without the new flags prints exactly what it printed before', () => {
  const root = setup();
  const plain = JSON.parse(runCli([root, '--json']).out);
  for (const k of ['runs', 'window', 'stepTable']) assert.equal(Object.hasOwn(plain, k), false, k);
  const text = runCli([root]).out;
  assert.doesNotMatch(text, /^lane |^step /m);
  const full = JSON.parse(runCli([root, '--runs', '--window', '2', '--json']).out);
  assert.equal(full.runs.length, 2);
  assert.equal(typeof full.window, 'object');
  assert.equal(typeof full.stepTable, 'object');
  assert.equal(full.runsFailed, 0);
  assert.equal(full.findings.raised, plain.findings.raised, 'the totals do not move');
  const withText = runCli([root, '--window', '2']).out;
  assert.ok(withText.startsWith(text), 'the window lines follow the unchanged report');
});

test('the text report adds one line per lane and per lane step with --window', () => {
  const root = mkTmp();
  const dir = path.join(root, '2026-11-12T090000-record-1');
  buildDerivedRun(dir);
  write(dir, 'run-state.json', '{"status":"clean"}');
  write(dir, 'config.yml', 'ceremony-profile: standard\n');
  const out = runCli([root, '--window', '5', '--lane-floor', '3']).out;
  assert.match(out, /^lane standard: 1 runs \(1 in window, below floor\) \S+ \.\. \S+$/m);
  assert.match(out, /^step standard\/review: runs 1 \| ran 1 /m);
});

test('--window takes a positive integer', () => {
  const root = setup();
  for (const argv of [[root, '--window', '0'], [root, '--window', 'x'], [root, '--lane-floor', '-1'], [root, '--window'], [root, '--window', '2.5']]) {
    const r = runCli(argv);
    assert.equal(r.code, 2, argv.join(' '));
    assert.match(r.errs, /usage: node tools\/step-yield-report\.js/);
    assert.equal(r.out, '');
  }
});

test('AC: the per-lens table is byte-identical', () => {
  const root = setup();
  const { out } = runCli([root]);
  const block = [
    'lens                   raised         both          one tb-confirmed   tb-refuted',
    '3f                         10            4            6            5            2',
    '3b                          2            0            2            1            1',
    '3a                          1            1            0            0            0',
  ].join('\n');
  assert.ok(out.includes(block), out);
});

test('stepRow confirmed is both plus tiebreak confirmed', () => {
  const root = setup();
  const r = runCli([root, '--runs', '--json']);
  const list = JSON.parse(r.out).runs;
  assert.ok(Array.isArray(list), r.out.slice(0, 400));
  const confirmedOf = (id) => {
    const found = list.find((x) => x.runId === id);
    assert.ok(found, id + ' in ' + r.out.slice(0, 400));
    return found.steps.find((s) => s.name === 'review').confirmed;
  };
  assert.equal(confirmedOf('2026-11-10T090000-record-2'), 9);
  assert.equal(confirmedOf('2026-11-12T090000-record-1'), 2);
});
