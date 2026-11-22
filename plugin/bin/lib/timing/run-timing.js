// bin/lib/timing/run-timing.js — a run's timing.json as a function (#5555).
//
// The events -> timing derivation phase-timing.js used to own, so a closing
// path can call it in-process (no spawn) and phase-timing.js can keep calling
// it too. derivePhaseTiming is the synchronous, transcript-free half;
// deriveTiming adds the transcript-backed token keys, optionally bounded by a
// deadline; writeTimingFile is the one place timing.json is written.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { derivePhases, joinTokens, countGuardEvents, aggregateDispatches } = require('./derive');
const { subagentsDirFor, readDispatches } = require('./transcript');
const { readManifest } = require('../flow/manifest');
const { resolveAgainst } = require('../health-core/io');
const { canonicalRealpath } = require('../path-guard');
const { priorWorktree } = require('../run-state-worktree');

function readEvents(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, events: [] };
    return { ok: false, error: err.message };
  }
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* per-row skip, never fatal */ }
  }
  return { ok: true, events };
}

function readJsonOrNull(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

const EXPIRED = Symbol('expired');

// Runs work(signal) bounded by deadlineAt (epoch ms) and/or an outer AbortSignal.
// -> { hit: true } when the bound passed before the work finished (the work's own
// signal is aborted and its late settlement ignored — a lost race never leaves
// the work running unobserved), else { hit: false, value }; a rejection of the
// work itself propagates. With neither bound the work runs unraced.
async function bounded(deadlineAt, outer, work) {
  if (deadlineAt === null && !outer) return { hit: false, value: await work(undefined) };
  const ctl = new AbortController();
  let timer = null;
  const expire = () => ctl.abort();
  const expired = new Promise((resolve) => {
    ctl.signal.addEventListener('abort', () => resolve(EXPIRED), { once: true });
    if (outer) {
      if (outer.aborted) { expire(); return; }
      outer.addEventListener('abort', expire, { once: true });
    }
    if (deadlineAt !== null) {
      const left = deadlineAt - Date.now();
      if (left <= 0) expire(); else timer = setTimeout(expire, left);
    }
  });
  try {
    if (ctl.signal.aborted) return { hit: true };
    const running = (async () => work(ctl.signal))();
    running.catch(() => {}); // a read that loses the race may still reject later
    const v = await Promise.race([running, expired]);
    return v === EXPIRED ? { hit: true } : { hit: false, value: v };
  } finally {
    if (timer) clearTimeout(timer);
    if (outer) outer.removeEventListener('abort', expire);
  }
}

// events -> the run's event window { start, end } (epoch ms, inclusive): the
// earliest..latest event ts, leaving out worktree-reaped — it fires hours after
// the session ends, so its ts would stretch the window over the idle gap
// (derive.js's endOfRun rule, #1928). No event with a ts -> null (no window).
function eventWindow(events) {
  const stamps = events.filter((e) => !(e && e.type === 'worktree-reaped')).map((e) => Date.parse(e && e.ts)).filter(Number.isFinite);
  // reduce, not Math.min(...stamps): a spread of a very large array can throw RangeError.
  return stamps.length
    ? { start: stamps.reduce((a, b) => Math.min(a, b)), end: stamps.reduce((a, b) => Math.max(a, b)) }
    : null;
}

// runDir, events, runState -> the run's own lifetime { start, end } (epoch ms,
// inclusive), or null when nothing bounds it. start: the earliest of the run id's
// timestamp (UTC, run-integrity.js's runStartIso), run-state createdAt and the
// first event ts; end: the later of run-state updatedAt — stamped by every
// writeRunState, so after a close it is the close's own write, never the moment a
// later background pass starts — and the last event ts. A run's events are sparse
// (nothing is written after its wrap-up skill_invoked, and pre-flight turns come
// before the first event), so the event span alone drops most of a run's calls.
function runWindow(runDir, events, runState) {
  const rs = runState && typeof runState === 'object' ? runState : {};
  const ev = eventWindow(events);
  const ms = (v) => (typeof v === 'string' ? Date.parse(v) : NaN);
  // Lazy: only the at-close writer clips, so phase-timing.js never loads run-integrity.js.
  const idIso = require('../hooks/run-integrity').runStartIso(runDir);
  const starts = [ms(idIso), ms(rs.createdAt), ev ? ev.start : NaN].filter(Number.isFinite);
  const ends = [ms(rs.updatedAt), ev ? ev.end : NaN].filter(Number.isFinite);
  if (!starts.length && !ends.length) return null;
  return {
    start: starts.length ? starts.reduce((a, b) => Math.min(a, b)) : -Infinity,
    end: ends.length ? ends.reduce((a, b) => Math.max(a, b)) : Infinity,
  };
}

const MAX_SCOPE_HOPS = 10;
function realPathFrom(resolveFrom, p) {
  const abs = path.resolve(resolveFrom, p);
  return canonicalRealpath(abs) || abs;
}

// One subagents directory's items under scopeDispatchesTo (collectDispatches's comment below
// states the rule): ownSlug true drops only the scoped agents; false keeps only their descendants.
function scopeDirItems(items, scoped, resolveFrom, ownSlug) {
  const flagged = items.map((d) => ({ d, scoped: typeof d.transcriptPath === 'string' && scoped.has(realPathFrom(resolveFrom, d.transcriptPath)) }));
  if (ownSlug) return flagged.filter((f) => !f.scoped).map((f) => f.d);
  const byId = new Map(flagged.filter((f) => typeof f.d.agentId === 'string').map((f) => [f.d.agentId, f]));
  return flagged.filter((f) => {
    if (f.scoped) return false;
    let cur = f;
    for (let hop = 0; hop < MAX_SCOPE_HOPS; hop++) {
      cur = typeof cur.d.parentAgentId === 'string' ? byId.get(cur.d.parentAgentId) : undefined;
      if (!cur) return false;
      if (cur.scoped) return true;
    }
    return false;
  }).map((f) => f.d);
}

// paths: the resolved transcript paths; events: parsed events.jsonl rows. The
// window is eventWindow's (no event with a ts -> the whole session), or the given
// { window } (deriveTiming's run window when it clips). Subagents dirs are deduped by fs.realpathSync (path.resolve when
// the dir does not resolve) so a transcript passed twice, or reached through a
// symlinked alias, is not double-counted. worktree (the run's, or null) reaches
// readUsage, so a subagent's reads key as the main rows do. -> the timing.json
// `dispatches` value, before stripInternalFields.
// { deadlineAt, signal } (both optional): past the deadline, or once the signal
// aborts, reading stops and the result is null (not a dispatches value).
// scopeDispatchesTo (optional, #5647): an array of agent transcript paths (a dispatched run's
// attributed Task calls; their rows are in totals.tokens, so they are never `dispatches` items).
// The scope is chosen per subagents directory by how it was reached: a directory reached through
// a path in `paths` that is not a scoped agent (the run's own-slug transcript) keeps its window
// view minus the scoped agents; a directory reached only through scoped paths keeps only the items
// whose parentAgentId chain (through that directory's items, at most MAX_SCOPE_HOPS hops) reaches
// a scoped agent. Where one directory is both (a dispatcher session in its own worktree slug) the
// own-slug rule wins. Absent or empty: nothing is filtered.
async function collectDispatches(paths, events, cwd, { deadlineAt = null, signal = null, window: given, worktree = null, scopeDispatchesTo } = {}) {
  const window = given === undefined ? eventWindow(events) : given;
  // A symlinked subagents/ leaf keeps its own path, so readDispatches sees the
  // link and refuses it instead of reading wherever it points.
  const canonical = (p) => {
    const dir = path.resolve(cwd, subagentsDirFor(p));
    try { return fs.lstatSync(dir).isSymbolicLink() ? dir : fs.realpathSync(dir); } catch { return dir; }
  };
  const dirs = [...new Set(paths.map(canonical))];
  const scoped = Array.isArray(scopeDispatchesTo) && scopeDispatchesTo.length ? new Set(scopeDispatchesTo.map((p) => realPathFrom(cwd, p))) : null;
  // Own-slug directories: reached through a path that is not a scoped Task call.
  const ownDirs = scoped ? new Set(paths.filter((p) => !scoped.has(realPathFrom(cwd, p))).map(canonical)) : null;
  const items = [];
  const reasons = [];
  let excludedOutsideWindow = 0;
  let found = 0;
  for (const dir of dirs) {
    const r = await bounded(deadlineAt, signal, (sig) => readDispatches(dir, sig ? { window, worktree, signal: sig } : { window, worktree }));
    if (r.hit) return null;
    reasons.push(...r.value.dirNotes);
    if (r.value.notFound) { reasons.push(r.value.notFound); continue; }
    found += 1;
    items.push(...(scoped ? scopeDirItems(r.value.items, scoped, cwd, ownDirs.has(dir)) : r.value.items));
    excludedOutsideWindow += r.value.excludedOutsideWindow;
  }
  if (found === 0) return { notFound: reasons.length ? reasons.join('; ') : 'no transcript resolved' };
  // A direct (non-workflow) item keeps its pre-workflow shape: both keys null -> dropped.
  const agg = aggregateDispatches(items.map((d) => {
    if (d.workflowRunId !== null || d.workflowPhase !== null) return d;
    const { workflowRunId: _run, workflowPhase: _phase, ...direct } = d;
    return direct;
  }));
  const out = { scope: window ? 'run-window' : 'whole-session', items: agg.items, byTier: agg.byTier, byRole: agg.byRole, excludedOutsideWindow };
  // A dir that yielded nothing beside one that did is still named, not dropped.
  if (reasons.length) out.notFoundDirs = reasons;
  return out;
}

// (dispatches, transcript paths, cwd) -> joinTokens' dispatchFileReads (#4359):
// every item's procedureFileRows, in item order. An item whose transcript is
// one of the run's own --transcript paths (realpath on both sides, path.resolve
// when that fails) is skipped: its reads are already main rows.
function dispatchFileReads(dispatches, paths, cwd) {
  if (!dispatches || !Array.isArray(dispatches.items)) return [];
  const real = (p) => { const abs = path.resolve(cwd, p); return canonicalRealpath(abs) || abs; };
  const own = new Set(paths.map(real));
  const reads = [];
  for (const item of dispatches.items) {
    if (!Array.isArray(item.procedureFileRows)) continue;
    if (typeof item.transcriptPath === 'string' && own.has(real(item.transcriptPath))) continue;
    reads.push(...item.procedureFileRows);
  }
  return reads;
}

// The dispatches value as timing.json carries it: each item without
// procedureFileRows and transcriptPath, which only dispatchFileReads reads.
function stripInternalFields(dispatches) {
  if (!dispatches || !Array.isArray(dispatches.items)) return dispatches;
  return { ...dispatches, items: dispatches.items.map(({ procedureFileRows: _rows, transcriptPath: _path, ...item }) => item) };
}

// runDir -> { ok: true, timing, out, events, runState } | { ok: false, error }.
// Sync, no transcript: `timing` is the timing.json phase-timing.js writes
// without a transcript flag, minus `budget`. `out` is derivePhases' result,
// `events` the parsed events.jsonl rows.
function derivePhaseTiming(runDir) {
  const read = readEvents(path.join(runDir, 'events.jsonl'));
  if (!read.ok) return { ok: false, error: `events.jsonl unreadable (${read.error})` };
  const runState = readJsonOrNull(path.join(runDir, 'run-state.json'));
  const out = derivePhases({ events: read.events, manifest: readManifest(runDir), runState });
  const timing = { runDir, generatedAt: new Date().toISOString(), phases: out.phases, totals: { ...out.totals } };
  if (out.ciGate) timing.ciGate = out.ciGate;
  return { ok: true, timing, out, events: read.events, runState };
}

// runDir, opts -> Promise<{ ok: true, timing, out, tokens, guard, notes, deadlineHit } | { ok: false, error }>.
// Without tokens wanted the timing equals derivePhaseTiming's. wantTokens
// (default: transcriptPaths is non-empty) adds the token keys, in the order
// phase-timing.js has always written them; with it true and no transcript the
// zero-row token object still results. `notes` come back with the read
// outcomes appended. deadlineAt (epoch ms) is checked before each transcript
// read and each read races it: past it the in-flight read is aborted through
// its signal, reading stops and the timing comes back with phase rows only
// (no token keys at all) and deadlineHit true. `base` (a derivePhaseTiming
// result the caller already holds, e.g. to resolve transcripts from its
// runState) is used instead of reading the run directory a second time.
// clipToRunWindow (default false; only the at-close writer passes true): the
// transcripts' usage rows, and the dispatches, are kept only inside
// runWindow(runDir, events, runState) — the run's creation through its close —
// so a run counts all of its own calls and none of another run sharing its
// session transcript (#5555); a row with no parseable ts is dropped, and nothing
// bounding the run means no clipping. phase-timing.js never passes it.
// worktree (default: the run-state's, see below) is the root the transcripts'
// procedure reads key against; phase-timing.js's buildTiming passes its caller's.
// scopeDispatchesTo (default: none; the at-close writer passes a dispatched run's
// attributed Task-call paths, #5647): see collectDispatches.
async function deriveTiming(runDir, { transcriptPaths = [], notes = [], cwd, deadlineAt = null, readUsageImpl, wantTokens, base: given, clipToRunWindow = false, worktree: givenWorktree, scopeDispatchesTo } = {}) {
  const base = given || derivePhaseTiming(runDir);
  if (!base.ok) return base;
  const { timing, out, events, runState } = base;
  const withTokens = wantTokens === undefined ? transcriptPaths.length > 0 : wantTokens;
  const outNotes = [...notes];
  if (!withTokens) return { ok: true, timing, out, tokens: null, guard: null, notes: outNotes, deadlineHit: false };

  const read = readUsageImpl || ((p, o) => require('./transcript').readUsage(p, o));
  // A closed run has worktree null; worktreeAtClose keeps the path (#3023).
  const worktree = givenWorktree !== undefined ? givenWorktree : priorWorktree(runState);
  const at = cwd === undefined ? process.cwd() : cwd;
  const hit = () => ({ ok: true, timing, out, tokens: null, guard: null, notes: outNotes, deadlineHit: true });
  const transcripts = [];
  const clip = clipToRunWindow ? runWindow(runDir, events, runState) : null;
  const inClip = (row) => { const ms = Date.parse(row && row.ts); return ms >= clip.start && ms <= clip.end; };
  let rows = [];
  for (const p of transcriptPaths) {
    let r;
    try {
      r = await bounded(deadlineAt, null, (signal) => read(resolveAgainst(at, p), signal ? { worktree, signal } : { worktree }));
    } catch (err) {
      const reason = `${err && err.code ? err.code : 'unreadable'}: ${p}`;
      transcripts.push({ path: p, rows: 0, note: `transcript not found (${reason})` });
      outNotes.push(`tokens: transcript not found (${reason})`);
      continue;
    }
    if (r.hit) return hit();
    const kept = clip ? r.value.filter(inClip) : r.value;
    if (kept.length === 0) {
      const note = r.value.length ? `transcript had no usage rows in the run's lifetime (${p})` : `transcript had no usage rows (${p})`;
      transcripts.push({ path: p, rows: 0, note });
      outNotes.push(`tokens: ${note}`);
    } else {
      transcripts.push({ path: p, rows: kept.length });
    }
    rows = rows.concat(kept);
  }
  // Computed before the join: each workflow agent's start places it in a phase's subagents (#5597).
  const dispatches = await collectDispatches(transcriptPaths, events, at, clip ? { deadlineAt, window: clip, worktree, scopeDispatchesTo } : { deadlineAt, worktree, scopeDispatchesTo });
  if (dispatches === null) return hit();
  const workflowStarts = (dispatches.items || []).filter((d) => d.workflowRunId != null && d.startTs).map((d) => d.startTs);
  const tokens = joinTokens(out.phases, rows, workflowStarts, { dispatchFileReads: dispatchFileReads(dispatches, transcriptPaths, at) });
  tokens.totals.rows = rows.length;
  const guard = countGuardEvents(events);

  timing.phases = tokens.phases;
  timing.unattributed = tokens.unattributed;
  timing.totals.tokens = tokens.totals.tokens;
  timing.totals.procedureBytes = tokens.totals.procedureBytes;
  timing.totals.procedureFiles = tokens.totals.procedureFiles;
  timing.totals.toolRoundTrips = tokens.totals.toolRoundTrips;
  for (const k of ['turnClasses', 'context', 'modelMix', 'subagents', 'ceremonyShare']) timing.totals[k] = tokens.totals[k];
  timing.totals.guard = guard;
  timing.transcripts = transcripts;
  if (outNotes.length) timing.notes = outNotes;
  timing.dispatches = stripInternalFields(dispatches);
  timing.questions = deriveQuestions(rows);
  return { ok: true, timing, out, tokens, guard, notes: outNotes, deadlineHit: false };
}

// kept usage rows -> [{ id, askTs, answerTs, questions }], one per AskUserQuestion
// tool_use id, ordered by ask time (ties by id). answerTs is null when no kept row
// answers it; an answer with no kept ask is ignored; a repeated ask id keeps the
// first (#5556).
function deriveQuestions(rows) {
  const byId = new Map();
  for (const r of rows) {
    for (const a of r.asks || []) if (!byId.has(a.id)) byId.set(a.id, { id: a.id, askTs: a.ts, answerTs: null, questions: a.questions });
  }
  for (const r of rows) {
    for (const a of r.answers || []) {
      const q = byId.get(a.id);
      if (q && q.answerTs === null) q.answerTs = a.ts;
    }
  }
  const askMs = (q) => { const v = Date.parse(q.askTs); return Number.isFinite(v) ? v : Infinity; };
  const byIdOrder = (a, b) => {
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  };
  return [...byId.values()].sort((a, b) => (askMs(a) - askMs(b)) || byIdOrder(a, b));
}

// "Has token totals": totals.tokens is present and input + output + cacheRead +
// cacheCreate > 0.
function hasTokenTotals(timing) {
  const t = timing && timing.totals && timing.totals.tokens;
  if (!t || typeof t !== 'object') return false;
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return n(t.input) + n(t.output) + n(t.cacheRead) + n(t.cacheCreate) > 0;
}

// runDir, timing -> the written path. A timing without its own `budget` key
// takes the budget of an existing parseable timing.json (set on `timing`
// itself, so a caller printing it shows what was written); nothing else is
// carried. Written to a temp file in runDir, then renamed over timing.json, so
// a reader never sees half a file. Never creates runDir: a missing one throws.
function writeTimingFile(runDir, timing) {
  const timingPath = path.join(runDir, 'timing.json');
  if (!Object.hasOwn(timing, 'budget')) {
    const previous = readJsonOrNull(timingPath);
    if (previous && typeof previous === 'object' && Object.hasOwn(previous, 'budget')) timing.budget = previous.budget;
  }
  const tmp = path.join(runDir, `timing.json.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(timing, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(tmp, timingPath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* nothing was written */ }
    throw err;
  }
  return timingPath;
}

module.exports = { readEvents, runWindow, derivePhaseTiming, deriveTiming, collectDispatches, hasTokenTotals, writeTimingFile };
