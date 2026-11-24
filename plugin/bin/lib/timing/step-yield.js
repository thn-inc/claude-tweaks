// bin/lib/timing/step-yield.js — a run's step-yield.json as a function (#5556).
//
// What each step of a pipeline run produced, read from the run directory alone:
// decisions.md (and each spec-*/decisions.md under it), events.jsonl,
// run-state.json, and timing.json when present (its tokens/agents per phase and
// its `questions` ask times). No model turn, no transcript read — the transcript
// facts the yield needs were persisted into timing.json by the timing writer.
//
// This module holds no regex for a log line: patterns live in log-decision/append.js
// (parseEntry), console/resolve.js (parseTiebreakLine), timing/pair-lines.js and
// calibration/decisions-classifier.js. It only decides which counter a recognised
// line feeds, and which step it belongs to (derive.js's phaseAt).
//
// Nothing is dropped silently: a line or event no reader recognises counts under its
// step's `unparsed`; one whose instant cannot be placed lands in `unattributed`;
// a source that cannot be read (anything but ENOENT) counts in the top-level
// `unparsed` and is never read as absent.
//
// Since #6143 every phase exit writes one AUTO `Phase exit` record (lib/phase-exit/exit-record.js),
// so a step's `decisions.AUTO` is one higher than on earlier releases: compare across that boundary with this in mind.
'use strict';
const fs = require('fs');
const path = require('path');
const { derivePhases, phaseAt } = require('./derive');
const { runWindow, hasTokenTotals } = require('./run-timing');
const { readManifest } = require('../flow/manifest');
const { parseEntry, DECISION_STATUSES } = require('../log-decision/append');
// The lenient reading of a status line is this module's opt-in; calibration keeps classifyDecisionLine.
const { classifyDecisionLineLenient, entryClock, isStructuralLine } = require('../calibration/decisions-classifier');
const { parseTiebreakLine } = require('../console/resolve');
const { ALL_FORMS, classifyPairLine, isReviewMarkedLine, entryLine, isJudgeNone } = require('./pair-lines');
const { writeFileAtomic } = require('../atomic-write');

const STEP_YIELD_FILE = 'step-yield.json';
const SCHEMA_VERSION = 1;
const SAMPLE_MAX = 5;
const SAMPLE_CHARS = 200;
// A local-clock decision line may sit slightly outside the run's recorded window
// (a line written just after the last event); the window is widened by this much.
const WINDOW_PAD_MS = 10 * 60000;
const DAY_SCAN_MAX = 400;
const VERDICTS = ['confirmed', 'refuted', 'cant-tell', 'unsettled'];
const OUTCOMES = ['confirmed', 'drop', 'digest', 'console', 'none'];
const UNKNOWN_LENS = 'unknown';

const key = (p, type, nullable = false) => Object.freeze({ path: p, type, nullable });
const bucketKeys = (prefix) => [
  key(`${prefix}.commits.<action>`, 'number'),
  key(`${prefix}.verify.runs`, 'number'), key(`${prefix}.verify.pass`, 'number'),
  key(`${prefix}.verify.fail`, 'number'), key(`${prefix}.verify.unknown`, 'number'),
  key(`${prefix}.decisions.<status>`, 'number'),
  key(`${prefix}.events.<type>`, 'number'),
  key(`${prefix}.questions[].question`, 'string'), key(`${prefix}.questions[].askedAt`, 'string', true),
  key(`${prefix}.questions[].answeredAt`, 'string', true), key(`${prefix}.questions[].waitedMinutes`, 'number', true),
  key(`${prefix}.questions[].askSource`, 'string', true),
  key(`${prefix}.findings`, 'object', true),
  key(`${prefix}.findings.raised`, 'number'), key(`${prefix}.findings.both`, 'number'),
  key(`${prefix}.findings.one`, 'number'), key(`${prefix}.findings.relabeled`, 'number'),
  key(`${prefix}.findings.tiebreak.byVerdict.<verdict>`, 'number'),
  key(`${prefix}.findings.tiebreak.byOutcome.<outcome>`, 'number'),
  key(`${prefix}.findings.byLens.<lens>.raised`, 'number'), key(`${prefix}.findings.byLens.<lens>.both`, 'number'),
  key(`${prefix}.findings.byLens.<lens>.one`, 'number'), key(`${prefix}.findings.byLens.<lens>.relabeled`, 'number'),
  key(`${prefix}.findings.byLens.<lens>.tiebreak.byVerdict.<verdict>`, 'number'),
  key(`${prefix}.findings.byLens.<lens>.tiebreak.byOutcome.<outcome>`, 'number'),
  key(`${prefix}.unparsed.count`, 'number'), key(`${prefix}.unparsed.samples[]`, 'string'),
];
// The documented shape (docs/reference/step-yield.md lists the same keys). `<status>`,
// `<action>`, `<type>`, `<verdict>`, `<outcome>` and `<lens>` are key patterns, not literal keys.
const KEY_PATHS = Object.freeze([
  key('schemaVersion', 'number'), key('runDir', 'string'), key('generatedAt', 'string'),
  key('sources.timing', 'boolean'), key('sources.decisions', 'boolean'), key('sources.events', 'boolean'),
  key('sources.runState', 'boolean'), key('sources.questions', 'string', true),
  key('steps[].phase', 'string'), key('steps[].start', 'string', true), key('steps[].end', 'string', true),
  key('steps[].minutes', 'number'), key('steps[].ownMinutes', 'number'),
  key('steps[].tokens', 'object', true),
  key('steps[].tokens.input', 'number', true), key('steps[].tokens.output', 'number', true),
  key('steps[].tokens.cacheRead', 'number', true), key('steps[].tokens.cacheCreate', 'number', true),
  key('steps[].agents', 'number', true),
  ...bucketKeys('steps[]'),
  ...bucketKeys('unattributed'),
  key('unparsed.count', 'number'), key('unparsed.samples[]', 'string'),
]);

function newUnparsed() { return { count: 0, samples: [] }; }
function addUnparsed(u, text) {
  u.count += 1;
  if (u.samples.length < SAMPLE_MAX) u.samples.push(String(text).slice(0, SAMPLE_CHARS));
}

function zeroed(names) { return Object.fromEntries(names.map((n) => [n, 0])); }
function newTiebreak() { return { byVerdict: zeroed(VERDICTS), byOutcome: zeroed(OUTCOMES) }; }
function newFindings() { return { raised: 0, both: 0, one: 0, relabeled: 0, tiebreak: newTiebreak(), byLens: {} }; }
function newBucket() {
  return {
    commits: {}, verify: { runs: 0, pass: 0, fail: 0, unknown: 0 }, decisions: zeroed(DECISION_STATUSES),
    events: {}, questions: [], findings: null, unparsed: newUnparsed(),
  };
}
// A map keyed by text read from a log line or an event (a lens, an event type, a commit action)
// stores and reads every key as an OWN property of an ordinary object: `__proto__` would otherwise
// set the prototype and `constructor` / `toString` would read an inherited value.
function ownGet(obj, k, fallback) { return Object.hasOwn(obj, k) ? obj[k] : fallback; }
function ownSet(obj, k, value) { Object.defineProperty(obj, k, { value, enumerable: true, writable: true, configurable: true }); }
function bump(map, k) { ownSet(map, k, ownGet(map, k, 0) + 1); }
function sortedKeys(obj) { return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, ownGet(obj, k)])); }

// bucket, lens, fn(findingsLikeObject): applies fn to the step-level counters and the lens's.
function eachFindingScope(bucket, lens, fn) {
  if (!bucket.findings) bucket.findings = newFindings();
  const f = bucket.findings;
  if (!Object.hasOwn(f.byLens, lens)) {
    ownSet(f.byLens, lens, { raised: 0, both: 0, one: 0, relabeled: 0, tiebreak: newTiebreak() });
  }
  fn(f);
  fn(ownGet(f.byLens, lens));
}

function countPair(bucket, pair) {
  const counts = ALL_FORMS.find((f) => f.id === pair.form).counts;
  // A notice that counts nothing and names no lens (a console disposition) leaves the counters alone.
  if (pair.lens == null && !counts.both && !counts.one && !counts.relabel) return;
  eachFindingScope(bucket, pair.lens == null ? UNKNOWN_LENS : pair.lens, (s) => {
    s.both += counts.both; s.one += counts.one; s.relabeled += counts.relabel;
    s.raised += counts.both + counts.one;
  });
}

function countTiebreak(bucket, lens, verdict, outcome) {
  eachFindingScope(bucket, lens, (s) => {
    s.tiebreak.byVerdict[verdict] += 1;
    s.tiebreak.byOutcome[outcome] += 1;
  });
}

// parseTiebreakLine's result -> { verdict, outcome } (docs/reference/step-yield.md, "Tiebreak lines").
function tiebreakMeaning(t) {
  if (t.kind === 'confirmed') return { verdict: 'confirmed', outcome: 'confirmed' };
  if (t.kind === 'dropped') return { verdict: 'refuted', outcome: 'drop' };
  return { verdict: t.reason === 'verdict:cant-tell' ? 'cant-tell' : 'unsettled', outcome: t.kind === 'console' ? 'console' : 'digest' };
}

// One decisions.md entry line -> the counters it feeds, in the brief's classification order.
function classifyLine(rawLine, bucket) {
  const status = classifyDecisionLineLenient(rawLine);
  if (status.kind === 'other') { addUnparsed(bucket.unparsed, rawLine); return; }
  bucket.decisions[status.kind] += 1;
  if (!isReviewMarkedLine(rawLine)) return;
  const line = entryLine(rawLine);
  const tiebreak = parseTiebreakLine(line);
  const pair = classifyPairLine(line);
  if (isJudgeNone(rawLine)) {
    const lens = (tiebreak && tiebreak.lens) || (pair && pair.lens) || UNKNOWN_LENS;
    countTiebreak(bucket, lens, tiebreak ? tiebreakMeaning(tiebreak).verdict : 'unsettled', 'none');
    return;
  }
  if (tiebreak) {
    const { verdict, outcome } = tiebreakMeaning(tiebreak);
    countTiebreak(bucket, tiebreak.lens, verdict, outcome);
    return;
  }
  if (pair) { countPair(bucket, pair); return; }
  addUnparsed(bucket.unparsed, rawLine);
}

// A line's clock -> epoch ms, or null when it cannot be placed. An ISO clock is used as
// is. A local HH:MM:SS goes on the earliest local calendar day that puts it inside the
// run window widened by WINDOW_PAD_MS each side and not before `notBefore` (the previous
// placed line of its section; entries are appended to a section in write order); a window
// open on either side, or no day that fits, gives null (the writer's clock is local, so
// only the window can say which day).
function placeClock(clock, window, notBefore = -Infinity) {
  if (!clock) return null;
  if (clock.iso) { const t = Date.parse(clock.iso); return Number.isFinite(t) ? t : null; }
  if (!(clock.h < 24 && clock.m < 60 && clock.s < 60)) return null;
  if (!window || !Number.isFinite(window.start) || !Number.isFinite(window.end)) return null;
  const winLo = window.start - WINDOW_PAD_MS;
  const lo = Math.max(winLo, notBefore);
  const hi = window.end + WINDOW_PAD_MS;
  const first = new Date(lo);
  for (let i = 0; i <= DAY_SCAN_MAX; i++) {
    const t = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i, clock.h, clock.m, clock.s).getTime();
    if (t > hi) return null;
    if (t >= lo) return t;
  }
  return null;
}

function lineClock(line) {
  const entry = parseEntry(line);
  if (entry) {
    const [h, m, s] = entry.time.split(':').map(Number);
    return { h, m, s };
  }
  return entryClock(line);
}

// Reads a source file. -> { text } | { absent: true } | { error: code }. ENOENT is absence;
// every other failure is an error, never absence.
function readSource(file) {
  try { return { text: fs.readFileSync(file, 'utf8') }; } catch (err) {
    if (err && err.code === 'ENOENT') return { absent: true };
    return { error: (err && err.code) || 'unreadable' };
  }
}

function readJsonSource(file, label, top) {
  const r = readSource(file);
  if (r.absent) return { present: false, value: null };
  if (r.error) { addUnparsed(top, `${label}: unreadable (${r.error})`); return { present: false, value: null }; }
  let value;
  try { value = JSON.parse(r.text); } catch (err) {
    addUnparsed(top, `${label}: unparseable (${err && err.name})`);
    return { present: false, value: null };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    addUnparsed(top, `${label}: not a JSON object`);
    return { present: false, value: null };
  }
  return { present: true, value };
}

function decisionFiles(runDir, top) {
  const files = [path.join(runDir, 'decisions.md')];
  let entries = [];
  try { entries = fs.readdirSync(runDir, { withFileTypes: true }); } catch (err) {
    if (!err || (err.code !== 'ENOENT' && err.code !== 'ENOTDIR')) addUnparsed(top, `${runDir}: unreadable (${(err && err.code) || 'unreadable'})`);
  }
  const specs = entries.filter((e) => e.isDirectory() && /^spec-\d+$/.test(e.name))
    .map((e) => e.name).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  for (const name of specs) files.push(path.join(runDir, name, 'decisions.md'));
  return files;
}

function sourceStrings(v) { return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; }

// runDir, { now } -> the step-yield object. Synchronous; reads only runDir.
function deriveStepYield(runDir, { now = new Date() } = {}) {
  const top = newUnparsed();
  const sources = { timing: false, decisions: false, events: false, runState: false, questions: null };

  // events.jsonl
  const objs = [];
  const events = [];
  const evRead = readSource(path.join(runDir, 'events.jsonl'));
  if (evRead.error) addUnparsed(top, `events.jsonl: unreadable (${evRead.error})`);
  if (evRead.text !== undefined) {
    sources.events = true;
    for (const line of evRead.text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { addUnparsed(top, line); continue; }
      if (!ev || typeof ev !== 'object' || Array.isArray(ev)) { addUnparsed(top, line); continue; }
      objs.push(ev);
      const t = typeof ev.ts === 'string' ? Date.parse(ev.ts) : NaN;
      if (typeof ev.type !== 'string' || !Number.isFinite(t)) { addUnparsed(top, line); continue; }
      events.push({ ev, t });
    }
  }

  const stateRead = readJsonSource(path.join(runDir, 'run-state.json'), 'run-state.json', top);
  sources.runState = stateRead.present;
  const runState = stateRead.value && typeof stateRead.value === 'object' ? stateRead.value : null;
  const timingRead = readJsonSource(path.join(runDir, 'timing.json'), 'timing.json', top);
  const timing = timingRead.value && typeof timingRead.value === 'object' ? timingRead.value : null;
  sources.timing = timing !== null;
  if (timing && Array.isArray(timing.questions)) sources.questions = 'timing.json';

  const out = derivePhases({ events: objs, manifest: readManifest(runDir), runState, now });
  const rows = out.phases.filter((p) => p.source !== 'unattributed');
  const costRows = new Map(((timing && Array.isArray(timing.phases)) ? timing.phases : []).filter((p) => p && typeof p.phase === 'string').map((p) => [p.phase, p]));
  const withCost = timing !== null && hasTokenTotals(timing);

  const buckets = new Map(rows.map((r) => [r.phase, newBucket()]));
  const unattributed = newBucket();
  // The step an instant belongs to: phaseAt's half-open [start, end) rule, and when no span holds
  // the instant but it is exactly where a span ends (the merge commit ends the merge span),
  // the innermost span ending there (shortest, ties to the later start).
  const placeAt = (t) => {
    const name = phaseAt(rows, t);
    if (name !== null) return name;
    let best = null;
    for (const r of rows) {
      for (const s of Array.isArray(r.spans) ? r.spans : [r]) {
        const start = Date.parse(s.start);
        if (Date.parse(s.end) !== t || !Number.isFinite(start)) continue;
        if (!best || (t - start) < (t - best.start) || ((t - start) === (t - best.start) && start > best.start)) best = { phase: r.phase, start };
      }
    }
    return best ? best.phase : null;
  };
  const bucketFor = (t) => {
    const name = t === null ? null : placeAt(t);
    return name === null ? unattributed : buckets.get(name);
  };

  // verify: each row's own verify[] (derive.js's attribution); a verify event no row took is
  // unattributed. `verifyOwner` queues each event's owning step by its ts, so a verify event's
  // `events` count follows the same attribution as its `verify` count and the two never disagree.
  const verifyOwner = new Map();
  for (const r of rows) {
    const b = buckets.get(r.phase);
    for (const v of r.verify) {
      b.verify.runs += 1;
      b.verify[v.pass === true ? 'pass' : v.pass === false ? 'fail' : 'unknown'] += 1;
      if (!verifyOwner.has(v.at)) verifyOwner.set(v.at, []);
      verifyOwner.get(v.at).push(b);
    }
  }
  const ownerOf = new Map();
  for (const { ev } of events) {
    if (ev.type !== 'verify') continue;
    const queue = verifyOwner.get(ev.ts);
    if (queue && queue.length) { ownerOf.set(ev, queue.shift()); continue; }
    unattributed.verify.runs += 1;
    unattributed.verify[ev.pass === true ? 'pass' : ev.pass === false ? 'fail' : 'unknown'] += 1;
    ownerOf.set(ev, unattributed);
  }

  // events and commits
  const asks = [];
  for (const { ev, t } of events) {
    const b = ev.type === 'verify' ? ownerOf.get(ev) : bucketFor(t);
    bump(b.events, ev.type);
    if (ev.type === 'commit') bump(b.commits, typeof ev.action === 'string' ? ev.action : 'unknown');
    if (ev.type === 'ask-user-question') asks.push({ ev, t });
  }

  // questions: ask time from timing.json's persisted transcript asks. An exact toolUseId
  // join first for every event, then the question-text join over what is left.
  const transcriptAsks = (timing && Array.isArray(timing.questions) ? timing.questions : [])
    .filter((q) => q && typeof q === 'object' && Number.isFinite(Date.parse(q.askTs)))
    .map((q) => ({
      id: q.id, askMs: Date.parse(q.askTs), askTs: q.askTs, first: sourceStrings(q.questions)[0],
      text: sourceStrings(q.questions).join(' / '), answerTs: typeof q.answerTs === 'string' && Number.isFinite(Date.parse(q.answerTs)) ? q.answerTs : null,
    }));
  const used = new Set();
  const joined = new Map();
  const texts = new Map(asks.map(({ ev }) => [ev, (Array.isArray(ev.questions) ? ev.questions : []).map((q) => (q && typeof q.question === 'string' ? q.question : null)).filter((q) => q !== null)]));
  for (const { ev } of asks) {
    if (typeof ev.toolUseId !== 'string') continue;
    const hit = transcriptAsks.find((q) => q.id === ev.toolUseId && !used.has(q));
    if (hit) { used.add(hit); joined.set(ev, { ask: hit, source: 'toolUseId' }); }
  }
  for (const { ev, t } of [...asks].sort((a, b) => a.t - b.t)) {
    if (joined.has(ev)) continue;
    const first = texts.get(ev)[0];
    if (first === undefined) continue;
    let best = null;
    for (const q of transcriptAsks) {
      if (used.has(q) || q.askMs > t || q.first !== first) continue;
      if (!best || q.askMs > best.askMs) best = q;
    }
    if (best) { used.add(best); joined.set(ev, { ask: best, source: 'questionText' }); }
  }
  for (const { ev, t } of asks) {
    const j = joined.get(ev) || null;
    const waited = j && t >= j.ask.askMs ? Math.round((t - j.ask.askMs) / 6000) / 10 : null;
    // A known ask time that no span holds falls back to the answer time's step.
    const b = (j && bucketFor(j.ask.askMs) !== unattributed) ? bucketFor(j.ask.askMs) : bucketFor(t);
    b.questions.push({
      question: texts.get(ev).join(' / '), askedAt: j ? j.ask.askTs : null, answeredAt: ev.ts,
      waitedMinutes: waited, askSource: j ? j.source : null,
    });
  }
  // A transcript ask no event answered is still an asked question: placed by its ask time, with
  // the transcript's own answer time when it has one, and no wait (the event that times the
  // answer is missing).
  for (const q of transcriptAsks) {
    if (used.has(q)) continue;
    bucketFor(q.askMs).questions.push({
      question: q.text, askedAt: q.askTs, answeredAt: q.answerTs, waitedMinutes: null, askSource: 'transcript',
    });
  }

  // decisions.md, parent then each spec-N child
  const window = runWindow(runDir, objs, runState);
  for (const file of decisionFiles(runDir, top)) {
    const r = readSource(file);
    if (r.absent) continue;
    if (r.error) { addUnparsed(top, `${path.relative(runDir, file) || file}: unreadable (${r.error})`); continue; }
    sources.decisions = true;
    // placeEntry appends each entry at the end of its `## ` section, so within a section
    // lines are in write order: a local clock never lands before the section's previous
    // placed line. A section's first line takes the earliest instant in the window.
    let previous = -Infinity;
    for (const line of r.text.split(/\r?\n/)) {
      if (line.startsWith('## ')) previous = -Infinity;
      if (isStructuralLine(line)) continue;
      const clock = lineClock(line);
      const t = placeClock(clock, window, previous);
      if (t !== null && clock && !clock.iso) previous = t;
      classifyLine(line, bucketFor(t));
    }
  }

  const finish = (b) => {
    const { findings } = b;
    if (findings) {
      findings.byLens = sortedKeys(findings.byLens);
    }
    return { ...b, commits: sortedKeys(b.commits), events: sortedKeys(b.events) };
  };

  const steps = rows.map((r) => {
    const cost = costRows.get(r.phase);
    const tk = withCost && cost && cost.tokens && typeof cost.tokens === 'object' ? cost.tokens : null;
    return {
      phase: r.phase, start: r.start, end: r.end, minutes: r.minutes, ownMinutes: r.ownMinutes,
      tokens: tk ? { input: tk.input ?? null, output: tk.output ?? null, cacheRead: tk.cacheRead ?? null, cacheCreate: tk.cacheCreate ?? null } : null,
      agents: withCost && cost && Number.isFinite(cost.subagents) ? cost.subagents : null,
      ...finish(buckets.get(r.phase)),
    };
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    runDir,
    generatedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    sources,
    steps,
    unattributed: finish(unattributed),
    unparsed: top,
  };
}

// runDir, yield -> the written path. Temp file in runDir, then rename; never creates
// runDir (a missing one throws), so a write racing an archive that moved the dir fails
// rather than resurrecting it.
function writeStepYield(runDir, yieldObj) {
  const file = path.join(runDir, STEP_YIELD_FILE);
  writeFileAtomic(file, JSON.stringify(yieldObj, null, 2) + '\n');
  return file;
}

module.exports = { STEP_YIELD_FILE, SCHEMA_VERSION, KEY_PATHS, deriveStepYield, writeStepYield, ownGet, ownSet };
