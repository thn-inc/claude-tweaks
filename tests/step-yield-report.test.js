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
