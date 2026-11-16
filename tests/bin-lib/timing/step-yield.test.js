'use strict';
// tests/bin-lib/timing/step-yield.test.js — #5556: a run's step yield from its run directory.
//
// The fixture is built the way the real writers build a run: events through
// hooks/context.js's appendEvent (under a fixed clock), decision lines through
// log-decision/append.js's formatEntry and tiebreak.js's resolveTiebreak. Decision
// lines carry the writer's LOCAL clock, so the run is generated at setup from one
// fixed UTC base (BASE) — in any timezone the lines and events describe the same
// instants — and the expected file holds instants relative to BASE ("T+600s").
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { deriveStepYield, writeStepYield, STEP_YIELD_FILE, SCHEMA_VERSION, KEY_PATHS } = require('../../../plugin/bin/lib/timing/step-yield');
const { derivePhases, phaseAt } = require('../../../plugin/bin/lib/timing/derive');
const { formatEntry, hms } = require('../../../plugin/bin/lib/log-decision/append');
const { resolveTiebreak } = require('../../../plugin/bin/lib/tiebreak');
const { appendEvent } = require('../../../plugin/bin/lib/hooks/context');

const FIX = path.join(__dirname, '..', '..', 'fixtures', 'step-yield');
const BASE = Date.UTC(2026, 10, 12, 9, 0, 0);
const at = (sec) => new Date(BASE + sec * 1000);
const NOW = at(3000);

function tmpRun(label = 'run') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ct-step-yield-${label}-`));
}

// Runs fn with `new Date()` frozen at `when`, so appendEvent (which stamps `new Date()`) writes it.
function atClock(when, fn) {
  const Real = Date;
  class Frozen extends Real {
    constructor(...args) { if (args.length === 0) super(when.getTime()); else super(...args); }
    static now() { return when.getTime(); }
  }
  global.Date = Frozen;
  try { return fn(); } finally { global.Date = Real; }
}

function writeEvents(dir, list) {
  for (const [sec, type, data] of list) atClock(at(sec), () => appendEvent(dir, type, data || {}));
}

const entry = (sec, status, step, text) => formatEntry({ status, now: at(sec), step, text, reversibility: 'high' });
const MYSTERY_SEC = 1280;
const MYSTERY = `- AUTO ${hms(at(MYSTERY_SEC))} — Reproduction: lens "3a" mystery shape.`;

const QUOTE_FILE = 'line one\nconst quoteTextHere = 1;\nline three\n';
function verdict(finding, reply, sec) {
  const r = resolveTiebreak(finding, reply, { readFile: () => QUOTE_FILE.repeat(30), now: at(sec) });
  return `- ${r.logLine}`;
}
const F = (lens, file, line) => ({ lens, path: file, line, claim: `claim ${lens} ${file}`, kind: 'unconfirmed', reporterSeverity: 'medium' });
const EVIDENCE = (file, line) => `Evidence: ${file}:${line} \`quoteTextHere\``;

function reviewDecisionLines() {
  return [
    '# Decisions',
    '',
    'Pipeline config snapshot:',
    '- mode: auto',
    '- budget: 5',
    '',
    entry(90, 'SKIP', 'timing', 'no transcript to read'),
    entry(1210, 'AUTO', 'Reproduction', 'lens "3a" finding plugin/a.js:10 reproduced. Confirmed.'),
    entry(1220, 'STAGED', 'Reproduction', 'lens "3b" finding plugin/b.js:20 not reproduced. Staged to Review Console as low-confidence.'),
    verdict(F('3b', 'plugin/b.js', 20), `Verdict: confirmed\n${EVIDENCE('plugin/b.js', 20)}\nSeverity: medium\nSTATUS: DONE`, 1230),
    entry(1240, 'STAGED', 'Reproduction', 'lens "3b" finding plugin/b.js:30 not reproduced. Staged to Review Console as low-confidence.'),
    verdict(F('3b', 'plugin/b.js', 30), `Verdict: refuted\n${EVIDENCE('plugin/b.js', 30)}\nSeverity: low\nSTATUS: DONE`, 1250),
    entry(1260, 'STAGED', 'Reproduction', 'lens "3c" finding plugin/c.js:40 not reproduced. Staged to Review Console as low-confidence.'),
    verdict(F('3c', 'plugin/c.js', 40), 'Verdict: cant-tell\nSeverity: medium\nRecommendation: drop\nSTATUS: DONE', 1270),
    MYSTERY,
  ];
}

const EVENT_LIST = [
  [0, 'skill_invoked', { skill: 'claude-tweaks:build' }],
  [60, 'commit', { action: 'push' }],
  [600, 'skill_invoked', { skill: 'claude-tweaks:test' }],
  [660, 'verify', { mode: 'full', pass: true, durationMs: 1000, suitesRun: [] }],
  [1200, 'skill_invoked', { skill: 'claude-tweaks:review' }],
  [1500, 'ask-user-question', { toolUseId: 'toolu_q1', questions: [{ header: 'Merge', question: 'Merge now?', options: [] }], response: 'yes' }],
  [2400, 'skill_invoked', { skill: 'claude-tweaks:wrap-up' }],
  [2700, 'close-run', {}],
];

// A fixture run in a fresh temp dir. `timing`/`state` false leaves the file out.
function buildRun({ events = EVENT_LIST, lines = reviewDecisionLines(), timing = true, state = true, label } = {}) {
  const dir = tmpRun(label);
  if (events) writeEvents(dir, events);
  if (lines) fs.writeFileSync(path.join(dir, 'decisions.md'), lines.join('\n') + '\n');
  if (timing) fs.copyFileSync(path.join(FIX, 'review-run', 'timing.json'), path.join(dir, 'timing.json'));
  if (state) fs.copyFileSync(path.join(FIX, 'review-run', 'run-state.json'), path.join(dir, 'run-state.json'));
  return dir;
}

const rel = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(iso) ? `T+${(Date.parse(iso) - BASE) / 1000}s` : iso);
function normalise(y) {
  const walk = (v, k) => {
    if (Array.isArray(v)) return v.map((x) => walk(x, k));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, walk(x, kk)]));
    return ['start', 'end', 'askedAt', 'answeredAt'].includes(k) ? rel(v) : v;
  };
  return { ...walk(y, ''), runDir: 'RUN', generatedAt: 'NOW' };
}
const step = (y, phase) => y.steps.find((s) => s.phase === phase);
const derive = (dir) => deriveStepYield(dir, { now: NOW });

test('AC1.1: fixture run yields the expected object', () => {
  const dir = buildRun();
  const expected = JSON.parse(fs.readFileSync(path.join(FIX, 'review-run.expected.json'), 'utf8'));
  // The mystery line carries the writer's local clock, so the expected file holds a placeholder.
  const sample = expected.steps.find((s) => s.phase === 'review').unparsed.samples;
  assert.deepEqual(sample, ['{{MYSTERY_LINE}}']);
  sample[0] = MYSTERY;
  assert.deepEqual(normalise(derive(dir)), expected);
});

test('AC1.2: fixture covers every required case', () => {
  const y = derive(buildRun());
  const review = step(y, 'review');
  assert.equal(review.findings.both, 1);
  assert.equal(review.findings.one, 3);
  assert.deepEqual(review.findings.tiebreak.byVerdict, { confirmed: 1, refuted: 1, 'cant-tell': 1, unsettled: 0 });
  assert.deepEqual(review.findings.tiebreak.byOutcome, { confirmed: 1, drop: 1, digest: 0, console: 1, none: 0 });
  assert.equal(review.questions.length, 1);
  assert.equal(step(y, 'test').verify.runs, 1);
  assert.equal(review.unparsed.count, 1);
  assert.equal(y.schemaVersion, SCHEMA_VERSION);
  assert.equal(STEP_YIELD_FILE, 'step-yield.json');
});

test('AC2.1: the unknown line is listed under unparsed with its text', () => {
  const lines = reviewDecisionLines();
  const y = derive(buildRun({ lines }));
  assert.deepEqual(step(y, 'review').unparsed, { count: 1, samples: [MYSTERY] });
  const without = derive(buildRun({ lines: lines.filter((l) => l !== MYSTERY) }));
  assert.equal(step(without, 'review').unparsed.count, 0, 'dropping the line turns the count red');
});

test('AC2.2: no count includes it', () => {
  const lines = reviewDecisionLines();
  const withLine = step(derive(buildRun({ lines })), 'review');
  const without = step(derive(buildRun({ lines: lines.filter((l) => l !== MYSTERY) })), 'review');
  assert.deepEqual(withLine.findings, without.findings);
  assert.deepEqual({ ...withLine.decisions, AUTO: 0 }, { ...without.decisions, AUTO: 0 });
  assert.equal(withLine.decisions.AUTO, without.decisions.AUTO + 1, 'it is a status line, counted only as an AUTO decision');
});

test('AC4.1: no timing.json gives null cost fields', () => {
  const y = derive(buildRun({ timing: false }));
  assert.equal(y.sources.timing, false);
  assert.equal(y.sources.questions, null);
  for (const s of y.steps) {
    assert.equal(s.tokens, null);
    assert.equal(s.agents, null);
  }
});

test('AC4.2: no timing.json leaves the produced counts equal', () => {
  const withT = derive(buildRun());
  const without = derive(buildRun({ timing: false }));
  const produced = (y) => y.steps.map((s) => ({ phase: s.phase, commits: s.commits, verify: s.verify, decisions: s.decisions, findings: s.findings }));
  assert.deepEqual(produced(without), produced(withT));
});

test('a timing.json without token totals gives null cost fields even when its rows carry tokens', () => {
  const dir = buildRun();
  const timing = JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8'));
  delete timing.totals.tokens;
  fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify(timing));
  const y = derive(dir);
  assert.equal(y.sources.timing, true);
  for (const s of y.steps) { assert.equal(s.tokens, null); assert.equal(s.agents, null); }
});

test('AC5.1: known ask time gives the gap', () => {
  const dir = buildRun();
  const timing = JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8'));
  timing.questions[0].askTs = at(1500 - 210).toISOString();
  fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify(timing));
  const q = step(derive(dir), 'review').questions[0];
  assert.equal(q.waitedMinutes, 3.5);
  assert.equal(q.askSource, 'toolUseId');
});

test('AC5.2: unknown ask time gives null', () => {
  const dir = buildRun();
  const timing = JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8'));
  delete timing.questions;
  fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify(timing));
  const y = derive(dir);
  const q = step(y, 'review').questions[0];
  assert.equal(y.sources.questions, null);
  assert.equal(q.waitedMinutes, null);
  assert.equal(q.askedAt, null);
  assert.equal(q.askSource, null);
  assert.equal(q.answeredAt, at(1500).toISOString(), 'attributed by the answer time');
});

test('an ask-user-question event without toolUseId joins by question text; a text mismatch stays unjoined', () => {
  const events = EVENT_LIST.map(([s, t, d]) => (t === 'ask-user-question' ? [s, t, { ...d, toolUseId: undefined }] : [s, t, d]));
  const q = step(derive(buildRun({ events })), 'review').questions[0];
  assert.equal(q.askSource, 'questionText');
  assert.equal(q.waitedMinutes, 3.5);
  const other = EVENT_LIST.map(([s, t, d]) => (t === 'ask-user-question' ? [s, t, { ...d, toolUseId: undefined, questions: [{ question: 'Something else?' }] }] : [s, t, d]));
  assert.equal(step(derive(buildRun({ events: other })), 'review').questions[0].askSource, null);
});

test('duplicateQuestionText: two events with the same text join two different asks', () => {
  const ask = (sec) => ({ toolUseId: undefined, questions: [{ question: 'Same?' }], response: String(sec) });
  const events = [[0, 'skill_invoked', { skill: 'claude-tweaks:build' }], [300, 'ask-user-question', ask(300)], [900, 'ask-user-question', ask(900)], [1800, 'close-run', {}]];
  const dir = buildRun({ events, lines: null, timing: false });
  fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify({
    totals: { tokens: { input: 1, output: 1, cacheRead: 0, cacheCreate: 0 } }, phases: [],
    questions: [
      { id: 'a1', askTs: at(200).toISOString(), answerTs: at(300).toISOString(), questions: ['Same?'] },
      { id: 'a2', askTs: at(700).toISOString(), answerTs: at(900).toISOString(), questions: ['Same?'] },
    ],
  }));
  const qs = step(derive(dir), 'build').questions;
  assert.deepEqual(qs.map((q) => q.waitedMinutes), [Math.round(100 / 6) / 10, Math.round(200 / 6) / 10]);
  assert.deepEqual(qs.map((q) => q.askedAt), [at(200).toISOString(), at(700).toISOString()]);
});

test('judgeNoneUnparseable: a judge: none line parseTiebreakLine rejects counts outcome none and verdict unsettled, not unparsed', () => {
  const line = `- STAGED ${hms(at(1250))} — Tiebreak tiebreak:0123456789ab: lens "3b" finding plugin/b.js:20 dropped: judge: none. Severity: medium.`;
  const y = derive(buildRun({ lines: [line] }));
  const review = step(y, 'review');
  assert.equal(review.findings.tiebreak.byOutcome.none, 1);
  assert.equal(review.findings.tiebreak.byVerdict.unsettled, 1);
  assert.equal(review.unparsed.count, 0);
  assert.equal(review.decisions.STAGED, 1);
});

test('judge: none on a line parseTiebreakLine accepts keeps that parse\'s verdict and lens, outcome none', () => {
  const line = `- AUTO ${hms(at(1250))} — Tiebreak tiebreak:0123456789ab: lens "3b" finding plugin/b.js:30 dropped: refuted by tiebreak. Evidence: plugin/b.js:30 "judge: none". Severity: low. Reversibility: high.`;
  const f = step(derive(buildRun({ lines: [line] })), 'review').findings;
  assert.equal(f.tiebreak.byOutcome.none, 1);
  assert.equal(f.tiebreak.byOutcome.drop, 0);
  assert.equal(f.tiebreak.byVerdict.refuted, 1);
  assert.deepEqual(Object.keys(f.byLens), ['3b']);
});

test('openWindow: no events and no updatedAt leaves clock lines unattributed, no throw', () => {
  const dir = buildRun({ events: null, state: false, lines: [entry(1210, 'AUTO', 'Reproduction', 'lens "3a" finding plugin/a.js:10 reproduced. Confirmed.')] });
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ status: 'closed' }));
  const y = derive(dir);
  assert.deepEqual(y.steps, []);
  assert.equal(y.sources.events, false);
  assert.equal(y.unattributed.decisions.AUTO, 1);
  assert.equal(y.unattributed.findings.both, 1);
});

test('a window open on one side (no updatedAt, events present) leaves clock lines unattributed', () => {
  const dir = buildRun({ state: false, lines: [entry(1210, 'AUTO', 'Reproduction', 'lens "3a" finding plugin/a.js:10 reproduced. Confirmed.')] });
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ status: 'open' }));
  // events give an end, so this window is closed: the line places.
  assert.equal(step(derive(dir), 'review').decisions.AUTO, 1);
  fs.rmSync(path.join(dir, 'events.jsonl'));
  assert.equal(derive(dir).unattributed.decisions.AUTO, 1);
});

test('a clock line no local day places inside the widened window is unattributed; an ISO clock is placed as is', () => {
  const far = `- AUTO ${hms(at(1210 + 3 * 3600))} — Reproduction: lens "3a" finding plugin/a.js:10 reproduced. Confirmed. Reversibility: high.`;
  const iso = `- SKIP ${at(1210).toISOString()} — timing: iso clock line. Reversibility: n/a.`;
  const y = derive(buildRun({ lines: [far, iso] }));
  assert.equal(y.unattributed.decisions.AUTO, 1);
  assert.equal(y.unattributed.findings.both, 1);
  assert.equal(step(y, 'review').decisions.SKIP, 1);
});

test('AC9.1: lines and events either side of a boundary attribute to the phase whose span holds them', () => {
  const events = [...EVENT_LIST, [1199, 'commit', { action: 'before' }], [1200, 'commit', { action: 'at' }]];
  const lines = [entry(1199, 'SKIP', 'timing', 'one second before review'), entry(1200, 'SKIP', 'timing', 'at the review start')];
  const y = derive(buildRun({ events, lines }));
  assert.equal(step(y, 'test').decisions.SKIP, 1);
  assert.equal(step(y, 'review').decisions.SKIP, 1);
  assert.deepEqual(step(y, 'test').commits, { before: 1 });
  assert.deepEqual(step(y, 'review').commits, { at: 1 });
});

test('AC9.2: every attribution equals phaseAt over the derivePhases rows', () => {
  const events = [...EVENT_LIST, [1199, 'commit', { action: 'before' }], [1200, 'commit', { action: 'at' }], [2399, 'commit', { action: 'late' }], [2400, 'commit', { action: 'wrap' }]];
  const lines = [1199, 1200, 2399, 2400].map((s) => entry(s, 'SKIP', 'timing', `at ${s}`));
  const dir = buildRun({ events, lines });
  const y = derive(dir);
  const phases = derivePhases({ events: fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)), now: NOW }).phases;
  for (const [sec, action] of [[1199, 'before'], [1200, 'at'], [2399, 'late'], [2400, 'wrap']]) {
    const want = phaseAt(phases, at(sec).getTime());
    assert.equal(step(y, want).commits[action], 1, `commit at ${sec}`);
    assert.equal(step(y, want).decisions.SKIP >= 1, true, `decision at ${sec}`);
  }
  // The literal boundary rule, so a changed rule cannot rewrite both sides: [start, end).
  assert.equal(phaseAt(phases, at(1200).getTime()), 'review');
  assert.equal(phaseAt(phases, at(1199).getTime()), 'test');
});

test('crossesMidnight: lines either side of local midnight land on the right days', () => {
  const t = (h, m, s, day = 12) => new Date(2026, 10, day, h, m, s);
  const events = [
    [t(23, 50, 0), 'skill_invoked', { skill: 'claude-tweaks:build' }],
    [t(0, 0, 0, 13), 'skill_invoked', { skill: 'claude-tweaks:test' }],
    [t(0, 20, 0, 13), 'close-run', {}],
  ];
  const dir = tmpRun('midnight');
  for (const [when, type, data] of events) atClock(when, () => appendEvent(dir, type, data));
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ createdAt: t(23, 50, 0).toISOString(), updatedAt: t(0, 25, 0, 13).toISOString() }));
  const line = (when, text) => formatEntry({ status: 'SKIP', now: when, step: 'timing', text, reversibility: 'n/a' });
  fs.writeFileSync(path.join(dir, 'decisions.md'), [line(t(23, 59, 59), 'before midnight'), line(t(0, 0, 5, 13), 'after midnight')].join('\n') + '\n');
  const y = derive(dir);
  assert.equal(step(y, 'build').decisions.SKIP, 1);
  assert.equal(step(y, 'test').decisions.SKIP, 1);
  assert.equal(y.unattributed.decisions.SKIP, 0);
});

test('noEvents: no events.jsonl gives no steps and every decision line unattributed, no throw', () => {
  const y = derive(buildRun({ events: null }));
  assert.deepEqual(y.steps, []);
  assert.equal(y.sources.events, false);
  assert.equal(y.unattributed.decisions.AUTO, 4);
  assert.equal(y.unattributed.decisions.STAGED, 4);
  assert.equal(y.unattributed.findings.both, 1);
  assert.equal(y.unattributed.unparsed.count, 1);
  const empty = buildRun({ events: null });
  fs.writeFileSync(path.join(empty, 'events.jsonl'), '');
  assert.deepEqual(derive(empty).steps, []);
});

test('a missing run directory gives an empty yield, every source absent, no throw', () => {
  const y = derive(path.join(os.tmpdir(), 'ct-step-yield-does-not-exist'));
  assert.deepEqual(y.sources, { timing: false, decisions: false, events: false, runState: false, questions: null });
  assert.deepEqual(y.steps, []);
  assert.equal(y.unparsed.count, 0);
});

test('a source read failing for a reason other than ENOENT is counted, never read as absent', () => {
  const dir = buildRun({ timing: false });
  fs.mkdirSync(path.join(dir, 'timing.json'));
  const y = derive(dir);
  assert.equal(y.sources.timing, false);
  assert.equal(y.unparsed.count, 1);
  assert.match(y.unparsed.samples[0], /timing\.json: unreadable \(EISDIR\)/);
  const bad = buildRun({ timing: false });
  fs.writeFileSync(path.join(bad, 'timing.json'), '{not json');
  assert.match(derive(bad).unparsed.samples[0], /timing\.json: unparseable/);
});

test('a malformed event line and an event without a parseable ts count in the top-level unparsed', () => {
  const dir = buildRun();
  fs.appendFileSync(path.join(dir, 'events.jsonl'), '{broken\n{"type":"x","ts":"nope"}\n{"ts":"2026-11-12T09:30:00.000Z"}\n');
  const y = derive(dir);
  assert.equal(y.unparsed.count, 3);
  assert.equal(y.unparsed.samples[0], '{broken');
  assert.equal(step(y, 'review').events.x, undefined);
});

test('spec-N children are read into the parent yield; FAILED and dash-less status lines count', () => {
  const dir = buildRun();
  fs.mkdirSync(path.join(dir, 'spec-2'));
  fs.writeFileSync(path.join(dir, 'spec-2', 'decisions.md'), [
    `FAILED ${hms(at(1300))} — wrap-up: could not push.`,
    entry(1310, 'AUTO', 'Reproduction', 'lens "3a" finding plugin/z.js:1 reproduced. Confirmed.'),
  ].join('\n') + '\n');
  const review = step(derive(dir), 'review');
  assert.equal(review.decisions.FAILED, 1);
  assert.equal(review.decisions.AUTO, 5);
  assert.equal(review.findings.byLens['3a'].both, 2);
});

test('single-read-coverage and relabel lines count in no finding total; a relabel adds none', () => {
  const lines = [
    entry(1210, 'AUTO', 'Reproduction', 'lens "3a" unavailable; single-read coverage.'),
    entry(1220, 'STAGED', 'Reproduction', 'lens "3f" vacuity finding plugin/t.js:5 downgraded to unconfirmed — reproduction agreement overridden, no execution evidence. Staged to Review Console as low-confidence.'),
    entry(1230, 'AUTO', 'Reproduction', 'lens "3a" findings plugin/x.js:12 / plugin/x.js:14 share a location but not substance; both staged unconfirmed.'),
  ];
  const f = step(derive(buildRun({ lines })), 'review').findings;
  assert.deepEqual({ raised: f.raised, both: f.both, one: f.one, relabeled: f.relabeled }, { raised: 2, both: 0, one: 2, relabeled: 1 });
  assert.deepEqual(f.byLens['3f'], { raised: 0, both: 0, one: 0, relabeled: 1, tiebreak: f.byLens['3f'].tiebreak });
});

test('a call-N row is a step; a nested phase wins over its call', () => {
  const events = [[0, 'skill_invoked', { skill: 'claude-tweaks:flow' }], [60, 'skill_invoked', { skill: 'claude-tweaks:build' }], [600, 'close-run', {}]];
  const y = derive(buildRun({ events, lines: [entry(120, 'SKIP', 'timing', 'inside build'), entry(30, 'SKIP', 'timing', 'inside the call only')] }));
  assert.deepEqual(y.steps.map((s) => s.phase), ['call-1', 'build']);
  assert.equal(step(y, 'build').decisions.SKIP, 1);
  assert.equal(step(y, 'call-1').decisions.SKIP, 1);
});

test('a verify event no row took is counted under unattributed.verify', () => {
  const events = [...EVENT_LIST, [2650, 'verify', { pass: false }]];
  const y = derive(buildRun({ events }));
  assert.equal(step(y, 'test').verify.runs, 1);
  assert.deepEqual(y.unattributed.verify, { runs: 0, pass: 0, fail: 0, unknown: 0 });
  const beforeAny = derive(buildRun({ events: [[100, 'verify', { pass: false }], ...EVENT_LIST.map(([s, t, d]) => [s + 200, t, d])] }));
  assert.deepEqual(beforeAny.unattributed.verify, { runs: 1, pass: 0, fail: 1, unknown: 0 });
});

// ---- the documented keys ----
function leafPaths(y) {
  const names = { commits: '<action>', events: '<type>', decisions: '<status>', byVerdict: '<verdict>', byOutcome: '<outcome>', byLens: '<lens>' };
  const out = new Set();
  const walk = (v, p, parent) => {
    if (Array.isArray(v)) { for (const x of v) walk(x, `${p}[]`, parent); return; }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, `${p}${p ? '.' : ''}${names[parent] ? names[parent] : k}`, k);
      return;
    }
    out.add(p);
  };
  walk(y, '', '');
  return out;
}

test('KEY_PATHS names every key the yield carries', () => {
  const y = derive(buildRun());
  const documented = new Set(KEY_PATHS.map((k) => k.path));
  const undocumented = [...leafPaths(y)].filter((p) => !documented.has(p));
  assert.deepEqual(undocumented, []);
  assert.equal(Object.isFrozen(KEY_PATHS), true);
  for (const k of KEY_PATHS) assert.deepEqual(Object.keys(k).sort(), ['nullable', 'path', 'type']);
});

test('KEY_PATHS: every documented non-unattributed path the fixture can reach is present in the output', () => {
  const present = leafPaths(derive(buildRun()));
  const reachable = KEY_PATHS.filter((k) => k.path.startsWith('steps[]') || k.path.startsWith('sources') || /^(schemaVersion|runDir|generatedAt)$/.test(k.path));
  const missing = reachable.filter((k) => !present.has(k.path) && !['steps[].findings.byLens.<lens>.tiebreak.byVerdict.<verdict>'].includes(k.path) && !k.path.endsWith('findings') && !k.nullable).map((k) => k.path);
  assert.deepEqual(missing, []);
});

// ---- writeStepYield ----
test('writeStepYield writes the object whole into the run dir and leaves no temp file', () => {
  const dir = buildRun();
  const y = derive(dir);
  const file = writeStepYield(dir, y);
  assert.equal(file, path.join(dir, STEP_YIELD_FILE));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), y);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.tmp-')), []);
});

test('writeStepYield never creates the run dir', () => {
  const gone = path.join(os.tmpdir(), `ct-step-yield-gone-${process.pid}`);
  assert.throws(() => writeStepYield(gone, { schemaVersion: 1 }), { code: 'ENOENT' });
  assert.equal(fs.existsSync(gone), false);
});
