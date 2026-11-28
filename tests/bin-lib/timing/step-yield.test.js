'use strict';
// tests/bin-lib/timing/step-yield.test.js — #5556: a run's step yield from its run directory.
//
// The fixture is built the way the real writers build a run: events through
// hooks/context.js's appendEvent (under a fixed clock), decision lines through
// log-decision/append.js's formatEntry and tiebreak.js's resolveTiebreak. Decision
// lines carry the writer's LOCAL clock, so the run is generated at setup from one
// fixed UTC base (BASE) — in any timezone the lines and events describe the same
// instants — and the expected file holds instants relative to BASE ("T+600s").
const { test, after } = require('node:test');
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

// Every temp run dir this file makes, removed once the file's tests are done.
const CREATED = [];
after(() => { for (const dir of CREATED) fs.rmSync(dir, { recursive: true, force: true }); });

function tmpRun(label = 'run') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ct-step-yield-${label}-`));
  CREATED.push(dir);
  return dir;
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

test('an asked question with no recorded answer is emitted, placed by its ask time, with waitedMinutes null', () => {
  const dir = buildRun();
  const timing = JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8'));
  timing.questions.push(
    { id: 'toolu_orphan', askTs: at(900).toISOString(), questions: ['Proceed with the plan?', 'Second?'] },
    { id: 'toolu_late', askTs: at(1700).toISOString(), answerTs: at(1750).toISOString(), questions: ['Answered but no event?'] },
  );
  fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify(timing));
  const y = derive(dir);
  assert.deepEqual(step(y, 'test').questions, [
    { question: 'Proceed with the plan? / Second?', askedAt: at(900).toISOString(), answeredAt: null, waitedMinutes: null, askSource: 'transcript' },
  ]);
  assert.deepEqual(step(y, 'review').questions.map((q) => [q.question, q.askSource, q.answeredAt, q.waitedMinutes]), [
    ['Merge now?', 'toolUseId', at(1500).toISOString(), 3.5],
    ['Answered but no event?', 'transcript', at(1750).toISOString(), null],
  ]);
  // every transcript ask is emitted exactly once: two orphans plus the joined one
  assert.equal(y.steps.reduce((n, s) => n + s.questions.length, 0) + y.unattributed.questions.length, 3);
});

test('an unanswered ask whose time no span holds lands in unattributed', () => {
  const dir = buildRun();
  const timing = JSON.parse(fs.readFileSync(path.join(dir, 'timing.json'), 'utf8'));
  timing.questions.push({ id: 'toolu_far', askTs: at(9000).toISOString(), questions: ['Much later?'] });
  fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify(timing));
  assert.deepEqual(derive(dir).unattributed.questions.map((q) => q.question), ['Much later?']);
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

test('a judge: none inside a quoted Evidence is the quote, not the marker: the refuted line counts drop', () => {
  const line = `- AUTO ${hms(at(1250))} — Tiebreak tiebreak:0123456789ab: lens "3b" finding plugin/b.js:30 dropped: refuted by tiebreak. Evidence: plugin/b.js:30 "judge: none". Severity: low. Reversibility: high.`;
  const f = step(derive(buildRun({ lines: [line] })), 'review').findings;
  assert.equal(f.tiebreak.byOutcome.none, 0);
  assert.equal(f.tiebreak.byOutcome.drop, 1);
  assert.equal(f.tiebreak.byVerdict.refuted, 1);
  assert.deepEqual(Object.keys(f.byLens), ['3b']);
});

test('judge: none before the Evidence clause on a line parseTiebreakLine accepts keeps that parse\'s verdict and lens, outcome none', () => {
  const line = `- AUTO ${hms(at(1250))} — Tiebreak tiebreak:0123456789ab: lens "3b" finding plugin/b.js:30 dropped: refuted by tiebreak. Evidence: plugin/b.js:30 "x". Severity: low. Reversibility: high.`;
  const marked = line.replace('finding plugin/b.js:30 dropped', 'finding plugin/b.js:30 judge: none dropped');
  // The marker breaks the accepted shape, so the verdict is unsettled; the lens is then unknown.
  const f = step(derive(buildRun({ lines: [marked] })), 'review').findings;
  assert.equal(f.tiebreak.byOutcome.none, 1);
  assert.equal(f.tiebreak.byVerdict.unsettled, 1);
});

test('interleaved phases: a pair line inside the first review of test, review, test, review counts under review', () => {
  const events = [[0, 'skill_invoked', { skill: 'claude-tweaks:build' }], [600, 'skill_invoked', { skill: 'claude-tweaks:test' }], [1200, 'skill_invoked', { skill: 'claude-tweaks:review' }],
    [2400, 'skill_invoked', { skill: 'claude-tweaks:test' }], [2700, 'skill_invoked', { skill: 'claude-tweaks:review' }], [3600, 'close-run', {}]];
  const lines = [entry(1500, 'AUTO', 'Reproduction', 'lens "3a" finding plugin/a.js:10 reproduced. Confirmed.')];
  const y = derive(buildRun({ events, lines }));
  assert.equal(step(y, 'review').findings.both, 1);
  assert.equal(step(y, 'test').findings, null);
  assert.equal(step(y, 'review').decisions.AUTO, 1);
});

test('a run-state.json or timing.json that parses to a non-object is recorded, never silently absent', () => {
  const dir = buildRun({ timing: false, state: false });
  fs.writeFileSync(path.join(dir, 'run-state.json'), '[1,2]');
  fs.writeFileSync(path.join(dir, 'timing.json'), '7');
  const y = derive(dir);
  assert.equal(y.sources.runState, false);
  assert.equal(y.sources.timing, false);
  assert.deepEqual(y.unparsed.samples.sort(), ['run-state.json: not a JSON object', 'timing.json: not a JSON object']);
  assert.equal(y.unparsed.count, 2);
});

test('placement: within a ## section a clock never lands before the section\'s previous line, so a backwards clock moves to the next day', () => {
  const t = (d, h, m, s = 0) => new Date(2026, 10, d, h, m, s);
  const dir = tmpRun('sections');
  const events = [[t(12, 23, 0), 'skill_invoked', { skill: 'claude-tweaks:build' }], [t(12, 23, 55), 'skill_invoked', { skill: 'claude-tweaks:test' }],
    [t(13, 8, 0), 'skill_invoked', { skill: 'claude-tweaks:review' }], [t(13, 9, 30), 'skill_invoked', { skill: 'claude-tweaks:wrap-up' }], [t(14, 20, 0), 'close-run', {}]];
  for (const [when, type, data] of events) atClock(when, () => appendEvent(dir, type, data));
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ createdAt: t(12, 23, 0).toISOString(), updatedAt: t(14, 20, 0).toISOString() }));
  const line = (when, text) => formatEntry({ status: 'SKIP', now: when, step: 'timing', text, reversibility: 'n/a' });
  fs.writeFileSync(path.join(dir, 'decisions.md'), [
    '## A', line(t(12, 23, 50), 'first'), line(t(12, 0, 10), 'second, after midnight'), line(t(12, 9, 0), 'third, 09:00 next day'), line(t(12, 8, 0), 'fourth, 08:00 the day after that'),
    '## B', line(t(12, 8, 30), 'a new section starts over'),
  ].join('\n') + '\n');
  const y = derive(dir);
  // 23:50 d12 -> build; 00:10 d13 -> test; 09:00 d13 -> review (wrap-up opens 09:30);
  // the later 08:00 goes to d14 08:00 -> wrap-up (open until d14 20:00); section B restarts: 08:30 d13 -> review.
  assert.equal(step(y, 'build').decisions.SKIP, 1);
  assert.equal(step(y, 'test').decisions.SKIP, 1);
  assert.equal(step(y, 'review').decisions.SKIP, 2, 'the 09:00 line and section B\'s 08:30 line (a section restarts at the window start)');
  assert.equal(step(y, 'wrap-up').decisions.SKIP, 1, 'the 08:00 line after 09:00 lands on the next day');
  assert.equal(y.unattributed.decisions.SKIP, 0);
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

// ---- the instant a span ends on ----
const MERGE_EVENTS = [
  [0, 'skill_invoked', { skill: 'claude-tweaks:build' }], [600, 'skill_invoked', { skill: 'claude-tweaks:wrap-up' }],
  [700, 'commit', { action: 'push' }], [900, 'commit', { action: 'merge' }], [1000, 'close-run', {}],
];

test('the merge commit lands in the merge step: an instant that ends a span is that span\'s', () => {
  const y = derive(buildRun({ events: MERGE_EVENTS, lines: [entry(900, 'AUTO', 'merge', 'merged at the span end')] }));
  assert.deepEqual(step(y, 'merge').commits, { merge: 1, push: 1 });
  assert.equal(step(y, 'merge').events.commit, 2, 'the push at its start and the merge commit at its end');
  assert.equal(step(y, 'merge').decisions.AUTO, 1, 'a decision line at the span end takes the span too');
  assert.deepEqual(y.unattributed.commits, {});
});

test('an instant ending two nested spans goes to the innermost; one ending no span stays unattributed', () => {
  const events = [[0, 'skill_invoked', { skill: 'claude-tweaks:flow' }], [60, 'skill_invoked', { skill: 'claude-tweaks:build' }], [600, 'commit', { action: 'at-end' }], [600, 'close-run', {}]];
  const y = derive(buildRun({ events, lines: null }));
  assert.equal(step(y, 'build').commits['at-end'], 1, 'build [60,600] is inside call-1 [0,600]: the innermost wins');
  assert.equal(step(y, 'call-1').commits['at-end'], undefined);
  const after = derive(buildRun({ events: [...events.slice(0, 2), [600, 'close-run', {}], [601, 'commit', { action: 'after' }]], lines: null }));
  assert.equal(after.unattributed.commits.after, 1);
});

test('a verify event at a span end counts in that step\'s events.verify, as derivePhases counted it in verify[]', () => {
  const events = [[0, 'skill_invoked', { skill: 'claude-tweaks:build' }], [200, 'skill_invoked', { skill: 'claude-tweaks:review' }], [400, 'verify', { pass: true }], [400, 'close-run', {}]];
  const y = derive(buildRun({ events, lines: null }));
  assert.equal(step(y, 'review').verify.runs, 1);
  assert.equal(step(y, 'review').events.verify, 1);
  assert.equal(y.unattributed.events.verify, undefined);
  assert.equal(y.unattributed.verify.runs, 0);
});

test('events.verify equals verify.runs in every bucket, including a verify on the instant two spans meet', () => {
  const events = [[0, 'skill_invoked', { skill: 'claude-tweaks:build' }], [200, 'skill_invoked', { skill: 'claude-tweaks:review' }], [400, 'verify', { pass: true }],
    [400, 'skill_invoked', { skill: 'claude-tweaks:wrap-up' }], [1500, 'verify', { pass: false }], [2000, 'close-run', {}], [3000, 'verify', {}]];
  const y = derive(buildRun({ events, lines: null }));
  for (const b of [...y.steps, y.unattributed]) assert.equal(b.events.verify || 0, b.verify.runs, b.phase || 'unattributed');
  assert.equal(step(y, 'review').verify.runs, 1, 'derivePhases\' closed interval: the shorter review span takes it');
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

test('an ISO-clock line resets nothing in the section cursor: a later local clock still places after the last local line', () => {
  const t = (d, h, m, s = 0) => new Date(2026, 10, d, h, m, s);
  const dir = tmpRun('iso-cursor');
  const events = [[t(12, 8, 0), 'skill_invoked', { skill: 'claude-tweaks:build' }], [t(12, 20, 0), 'skill_invoked', { skill: 'claude-tweaks:test' }],
    [t(13, 6, 0), 'skill_invoked', { skill: 'claude-tweaks:review' }], [t(13, 23, 0), 'close-run', {}]];
  for (const [when, type, data] of events) atClock(when, () => appendEvent(dir, type, data));
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ createdAt: t(12, 8, 0).toISOString(), updatedAt: t(13, 23, 30).toISOString() }));
  const local = (when, text) => formatEntry({ status: 'SKIP', now: when, step: 'timing', text, reversibility: 'n/a' });
  const iso = `- SKIP ${t(12, 21, 0).toISOString()} — timing: an ISO-clock line stamped late on day 12. Reversibility: n/a.`;
  // local 09:00 d12 (build); ISO 21:00 d12 (test, placed as stamped); local 10:00: the cursor is
  // still 09:00 d12 (the ISO line moved nothing), so 10:00 lands on d12 (build), not d13 (review).
  fs.writeFileSync(path.join(dir, 'decisions.md'), [local(t(12, 9, 0), 'first'), iso, local(t(12, 10, 0), 'third')].join('\n') + '\n');
  const y = derive(dir);
  assert.equal(step(y, 'build').decisions.SKIP, 2);
  assert.equal(step(y, 'test').decisions.SKIP, 1, 'the ISO line is placed as stamped');
  assert.equal(step(y, 'review').decisions.SKIP, 0);
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

test('a lens or an event key that names an Object.prototype member is stored as its own key: nothing is lost', () => {
  const lines = [
    entry(1210, 'AUTO', 'Reproduction', 'lens "__proto__" finding plugin/a.js:10 reproduced. Confirmed.'),
    entry(1220, 'AUTO', 'Reproduction', 'lens "constructor" finding plugin/a.js:11 reproduced. Confirmed.'),
    entry(1225, 'STAGED', 'Reproduction', 'lens "toString" finding plugin/b.js:20 not reproduced. Staged to Review Console as low-confidence.'),
    verdict(F('constructor', 'plugin/c.js', 40), `Verdict: refuted\n${EVIDENCE('plugin/c.js', 40)}\nSeverity: low\nSTATUS: DONE`, 1230),
  ];
  const dir = buildRun({ lines });
  const ts = at(1300).toISOString();
  fs.appendFileSync(path.join(dir, 'events.jsonl'), [
    { type: 'constructor', ts }, { type: '__proto__', ts }, { type: 'commit', action: '__proto__', ts }, { type: 'commit', action: 'toString', ts },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  const review = step(derive(dir), 'review');
  const own = (obj, k) => Object.getOwnPropertyDescriptor(obj, k) && Object.getOwnPropertyDescriptor(obj, k).value;
  const f = review.findings;
  assert.equal(Object.getPrototypeOf(f.byLens), Object.prototype, 'an ordinary object, its prototype untouched');
  assert.deepEqual(Object.keys(f.byLens), ['__proto__', 'constructor', 'toString']);
  assert.deepEqual({ raised: f.raised, both: f.both, one: f.one }, { raised: 3, both: 2, one: 1 });
  assert.deepEqual({ raised: own(f.byLens, '__proto__').raised, both: own(f.byLens, '__proto__').both }, { raised: 1, both: 1 });
  const ctor = own(f.byLens, 'constructor');
  assert.deepEqual({ raised: ctor.raised, both: ctor.both, refuted: ctor.tiebreak.byVerdict.refuted, drop: ctor.tiebreak.byOutcome.drop }, { raised: 1, both: 1, refuted: 1, drop: 1 });
  assert.deepEqual({ raised: own(f.byLens, 'toString').raised, one: own(f.byLens, 'toString').one }, { raised: 1, one: 1 });
  assert.equal(review.unparsed.count, 0);
  assert.equal(Object.getPrototypeOf(review.events), Object.prototype);
  assert.equal(own(review.events, 'constructor'), 1);
  assert.equal(own(review.events, '__proto__'), 1);
  assert.equal(own(review.commits, '__proto__'), 1);
  assert.equal(own(review.commits, 'toString'), 1);
});

test('unparsed caps: the count keeps counting past 5 samples, which are the first five, and a sample is cut to 200 characters', () => {
  const unrecognised = (i) => `- AUTO ${hms(at(1210 + i))} — Reproduction: lens "3a" unrecognised shape ${i}.`;
  const seven = Array.from({ length: 7 }, (_, i) => unrecognised(i));
  const { unparsed } = step(derive(buildRun({ lines: seven })), 'review');
  assert.equal(unparsed.count, 7);
  assert.deepEqual(unparsed.samples, seven.slice(0, 5));
  const long = `- AUTO ${hms(at(1210))} — Reproduction: lens "3a" ${'x'.repeat(500)}`;
  assert.ok(long.length > 500);
  const cut = step(derive(buildRun({ lines: [long] })), 'review').unparsed;
  assert.equal(cut.count, 1);
  assert.equal(cut.samples.length, 1);
  assert.equal(cut.samples[0].length, 200);
  assert.equal(cut.samples[0], long.slice(0, 200));
});

test('a call-N row is a step; a nested phase wins over its call', () => {
  const events = [[0, 'skill_invoked', { skill: 'claude-tweaks:flow' }], [60, 'skill_invoked', { skill: 'claude-tweaks:build' }], [600, 'close-run', {}]];
  const y = derive(buildRun({ events, lines: [entry(30, 'SKIP', 'timing', 'inside the call only'), entry(120, 'SKIP', 'timing', 'inside build')] }));
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

test('KEY_PATHS: every documented steps[], sources and top-level path is present in the with-timing fixture output', () => {
  // Nullable paths are reachable here too: the fixture's timing.json has token totals, a
  // joined question and a review step with findings. An object-valued path (`steps[].tokens`,
  // `steps[].findings`) is present when it is a null leaf in some step or has leaves beneath it.
  const present = [...leafPaths(derive(buildRun()))];
  const reachable = KEY_PATHS.filter((k) => k.path.startsWith('steps[]') || k.path.startsWith('sources') || /^(schemaVersion|runDir|generatedAt)$/.test(k.path));
  assert.deepEqual(reachable.filter((k) => !present.some((p) => p === k.path || p.startsWith(`${k.path}.`))).map((k) => k.path), []);
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

// ---- legacy console disposition (#5556, Task 7) ----
test('a Review Console disposition line is read, counts no finding and creates no findings object', () => {
  const line = '- AUTO HMS — Review Console: Console item decision:STAGED 09:59:02 — log-decision: Reproduction: lens "3a" fi#46a4cb4a (Low-confidence findings): keep-staged — unconfirmed finding — no Approve-all default; never auto-applied. Reversibility: n/a.';
  const lines = ['# Decisions', '', line.replace('HMS', hms(at(1300)))];
  const review = step(derive(buildRun({ lines })), 'review');
  assert.equal(review.findings, null);
  assert.equal(review.decisions.AUTO, 1);
  assert.deepEqual(review.unparsed, { count: 0, samples: [] });
});

test('writeStepYield never creates the run dir', () => {
  const gone = path.join(os.tmpdir(), `ct-step-yield-gone-${process.pid}`);
  assert.throws(() => writeStepYield(gone, { schemaVersion: 1 }), { code: 'ENOENT' });
  assert.equal(fs.existsSync(gone), false);
});
