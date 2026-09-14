// bin/lib/timing/derive.js — pure derivation of per-phase timing (#1928).
//
// Input: a run's events (as appendEvent wrote them), its manifest (optional,
// phases[] is the manifest-side boundary source), and run-state (optional,
// pr.mergedAt ends the merge phase under pr-first). Output: the canonical
// ten-phase list, each with a span, an exclusive duration, and the source
// that bounded it. No I/O, no clock reads beyond the injectable `now`.
//
// Nested skills attribute to the enclosing phase via NESTED_PARENT. The map
// is NOT exhaustive by design: an un-mapped `claude-tweaks:*` skill_invoked
// event opens a new top-level phase named after the skill — the safe default
// (an unrecognized skill gets its own attributed span rather than silently
// nesting into an unrelated phase). A maintainer adding a new nested-skill
// call site inside review/wrap-up/build must add its name here, or every
// run will grow a spurious top-level phase — tests/timing-nested-parent-roster.test.js
// pins this against the corpus.
'use strict';

const PHASES = ['call-1', 'call-2', 'build', 'plan', 'tasks', 'test', 'review', 'polish', 'wrap-up', 'merge'];

const NESTED_PARENT = Object.freeze({
  simplify: 'enclosing', reflect: 'enclosing', 'visual-review': 'enclosing', capture: 'enclosing',
  'design-wrapper': 'enclosing', challenge: 'enclosing', 'assess-agent-autonomy': 'enclosing',
  ledger: 'enclosing', journeys: 'enclosing',
});

const TERMINAL_TYPES = new Set(['session-end', 'close-run', 'worktree-reaped']);
const NS = 'claude-tweaks:';

function ms(iso) { const t = Date.parse(iso); return Number.isFinite(t) ? t : null; }
function minutesBetween(a, b) { return a === null || b === null || b < a ? 0 : Math.round((b - a) / 60000); }
function iso(t) { return t === null ? null : new Date(t).toISOString(); }
// Sum of the wall-clock minutes covered by a set of {start,end} spans,
// counting overlapping or adjacent time only once — the merge-safe
// alternative to summing each span's own minutes independently (#1928
// fix round 3).
function unionMinutes(spans) {
  const list = spans
    .filter((s) => s && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .slice()
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = null;
  let curEnd = null;
  for (const s of list) {
    if (curStart === null) { curStart = s.start; curEnd = s.end; continue; }
    if (s.start <= curEnd) { curEnd = Math.max(curEnd, s.end); continue; }
    total += minutesBetween(curStart, curEnd);
    curStart = s.start; curEnd = s.end;
  }
  if (curStart !== null) total += minutesBetween(curStart, curEnd);
  return total;
}
function skillName(ev) { return typeof ev.skill === 'string' && ev.skill.startsWith(NS) ? ev.skill.slice(NS.length) : null; }
function isTopLevel(ev) { const n = skillName(ev); return n !== null && !(n in NESTED_PARENT); }

// { events, manifest?, runState?, now? } -> { phases, totals }
function derivePhases({ events, manifest = null, runState = null, now = new Date() } = {}) {
  const evs = (Array.isArray(events) ? events : [])
    .filter((e) => e && typeof e === 'object' && ms(e.ts) !== null)
    .map((e) => ({ ...e, t: ms(e.ts) }))
    .sort((a, b) => a.t - b.t);
  const nowT = now instanceof Date ? now.getTime() : (ms(now) ?? Date.now());
  const terminal = evs.find((e) => TERMINAL_TYPES.has(e.type));
  // worktree-reaped fires hours after the session ends — its own ts would
  // let the idle gap get absorbed into whatever phase was still open, so
  // fall back to the last real (non-terminal) event's ts instead (#1928
  // fix round 2).
  const endOfRun = terminal
    ? (terminal.type === 'worktree-reaped'
      ? (evs.filter((e) => !TERMINAL_TYPES.has(e.type)).slice(-1)[0]?.t ?? terminal.t)
      : terminal.t)
    : nowT;

  const skillEvents = evs.filter((e) => e.type === 'skill_invoked');
  const flows = skillEvents.filter((e) => e.skill === `${NS}flow`);
  const topLevel = skillEvents.filter(isTopLevel);
  const verifies = evs.filter((e) => e.type === 'verify');
  const pushes = evs.filter((e) => e.type === 'commit' && e.action === 'push');
  const merges = evs.filter((e) => e.type === 'commit' && e.action === 'merge');

  const wrapUpStart = topLevel.find((e) => e.skill === `${NS}wrap-up`)?.t ?? null;
  const mergeStart = wrapUpStart === null ? null : pushes.find((e) => e.t > wrapUpStart)?.t ?? null;

  // A top-level span ends at the earliest of: the next top-level event, the
  // merge phase's start, the terminal event (decision 3 in the plan).
  function spanEnd(startT, startIndexInTopLevel) {
    const next = topLevel[startIndexInTopLevel + 1];
    const candidates = [endOfRun];
    if (next) candidates.push(next.t);
    if (mergeStart !== null && mergeStart > startT) candidates.push(mergeStart);
    return Math.min(...candidates);
  }

  const spans = new Map(); // name -> [{start, end, source}]
  const add = (name, start, end, source) => {
    if (!spans.has(name)) spans.set(name, []);
    spans.get(name).push({ start, end: end < start ? start : end, source });
  };

  topLevel.forEach((e, i) => {
    const name = skillName(e);
    if (name === 'flow') return; // calls are handled below
    add(name, e.t, spanEnd(e.t, i), 'skill_invoked');
  });

  flows.forEach((f, i) => {
    const next = flows[i + 1];
    add(`call-${i + 1}`, f.t, next ? next.t : endOfRun, 'skill_invoked');
  });

  // plan / tasks nest in build. A restarted plan/tasks span (a second
  // writing-plans or subagent-driven-development entry before the first
  // one's natural close) must end at the restart, not at whatever bound the
  // first entry would otherwise reach past it — else two overlapping spans
  // double-count the same wall-clock minutes (#1928 fix round 1).
  const plans = skillEvents.filter((e) => e.skill === 'superpowers:writing-plans');
  const sdds = skillEvents.filter((e) => e.skill === 'superpowers:subagent-driven-development');
  plans.forEach((p, i) => {
    const sdd = sdds.find((s) => s.t >= p.t);
    if (!sdd) return;
    const nextPlan = plans[i + 1];
    const end = nextPlan ? Math.min(sdd.t, nextPlan.t) : sdd.t;
    add('plan', p.t, end, 'skill_invoked');
  });
  sdds.forEach((s, i) => {
    const v = verifies.find((e) => e.t >= s.t);
    if (!v) return;
    const nextSdd = sdds[i + 1];
    const end = nextSdd ? Math.min(v.t, nextSdd.t) : v.t;
    add('tasks', s.t, end, 'verify');
  });

  // polish: the LAST design-wrapper strictly after review's own first one
  // and before wrap-up's start (review's Step 6.5 always precedes polish's).
  const reviewStart = topLevel.find((e) => e.skill === `${NS}review`)?.t ?? null;
  if (reviewStart !== null && wrapUpStart !== null) {
    const dws = skillEvents.filter((e) => e.skill === `${NS}design-wrapper` && e.t > reviewStart && e.t < wrapUpStart);
    if (dws.length >= 2) add('polish', dws[dws.length - 1].t, wrapUpStart, 'skill_invoked');
  }

  // merge: first push after wrap-up start → pr.mergedAt | merge commit | terminal.
  if (mergeStart !== null) {
    const mergedAt = runState && runState.pr && runState.pr.mergedAt ? ms(runState.pr.mergedAt) : null;
    const mergeCommit = merges.find((e) => e.t >= mergeStart);
    const end = mergedAt !== null ? mergedAt : (mergeCommit ? mergeCommit.t : endOfRun);
    add('merge', mergeStart, end, 'commit');
  }

  // Manifest phases[] fill gaps the events could not: a phase with no
  // skill_invoked span but a manifest transition gets its manifest span.
  const specs = manifest && manifest.multispec && Array.isArray(manifest.multispec.specs) ? manifest.multispec.specs : [];
  for (const spec of specs) {
    const log = Array.isArray(spec.phases) ? spec.phases : [];
    log.forEach((entry, i) => {
      if (spans.has(entry.phase)) return;
      const start = ms(entry.at);
      const next = log[i + 1];
      if (start === null) return;
      add(entry.phase, start, next && ms(next.at) !== null ? ms(next.at) : endOfRun, 'manifest');
    });
  }

  const names = [...PHASES, ...[...spans.keys()].filter((n) => !PHASES.includes(n))];
  const rows = names.map((name) => {
    const list = spans.get(name) || [];
    if (!list.length) {
      const unattributedStart = name === 'polish' && wrapUpStart !== null ? wrapUpStart : null;
      return { phase: name, start: iso(unattributedStart), end: iso(unattributedStart), minutes: 0, ownMinutes: 0, source: 'unattributed', verify: [] };
    }
    const start = Math.min(...list.map((s) => s.start));
    const end = Math.max(...list.map((s) => s.end));
    const minutes = list.reduce((sum, s) => sum + minutesBetween(s.start, s.end), 0);
    return { phase: name, start: iso(start), end: iso(end), minutes, ownMinutes: minutes, source: list[0].source, verify: [], _list: list };
  });

  // Attribute each verify event to exactly one row: the containing row
  // (excluding call-N — a call's span always wraps every nested phase
  // within it, so it never wins) whose containing span is smallest; ties
  // broken by the later start. A verify event can fall inside more than one
  // open phase's window at once (e.g. a scoped run during `plan`, before
  // `tasks` opens) — the innermost, most specific row wins so no event is
  // ever double-listed (#1928 fix round 1).
  for (const v of verifies) {
    let best = null;
    for (const row of rows) {
      if (/^call-\d+$/.test(row.phase) || !row._list) continue;
      const containing = row._list.filter((s) => v.t >= s.start && v.t <= s.end);
      if (!containing.length) continue;
      const span = Math.min(...containing.map((s) => s.end - s.start));
      const start = Math.max(...containing.map((s) => s.start));
      if (!best || span < best.span || (span === best.span && start > best.start)) {
        best = { row, span, start };
      }
    }
    if (best) {
      best.row.verify.push({ mode: v.mode ?? null, suitesRun: Array.isArray(v.suitesRun) ? v.suitesRun : [], durationMs: v.durationMs ?? null, pass: v.pass ?? null, at: v.ts });
    }
  }

  // Exclusive minutes: build minus plan/tasks; each call minus the union of
  // every nested row's spans (a union, not a sum of minutes, so two
  // overlapping nested rows — e.g. a call whose merge phase and a
  // post-merge build both fall inside it — are not double-subtracted).
  // Nothing is counted twice in totals.
  const byName = Object.fromEntries(rows.map((r) => [r.phase, r]));
  const nestedIn = (inner, outer) => inner._list && outer._list && inner._list.every((s) => outer._list.some((o) => s.start >= o.start && s.end <= o.end));
  if (byName.build._list) {
    byName.build.ownMinutes = Math.max(0, byName.build.minutes - byName.plan.minutes - byName.tasks.minutes);
  }
  for (const call of rows.filter((r) => /^call-\d+$/.test(r.phase) && r._list)) {
    const innerSpans = [];
    for (const r of rows) {
      if (r === call || /^call-\d+$/.test(r.phase) || r.phase === 'plan' || r.phase === 'tasks') continue;
      if (nestedIn(r, call)) innerSpans.push(...r._list);
    }
    call.ownMinutes = Math.max(0, call.minutes - unionMinutes(innerSpans));
  }

  // merge's span is never excluded from other rows above, so a phase that
  // is still open when the merge push happens (build) overlaps merge's own
  // minutes — subtract that overlap (as a union, per span) from ownMinutes
  // so totals.minutes never double-counts it (#1928 fix round 3). call-N
  // rows are handled above already (merge, when nested in a call, is
  // already excluded via that call's own unionMinutes) — subtracting the
  // overlap again here would double-subtract it.
  if (byName.merge && byName.merge._list && byName.merge._list.length) {
    const mergeSpan = byName.merge._list[0];
    for (const r of rows) {
      if (r.phase === 'merge' || /^call-\d+$/.test(r.phase) || !r._list) continue;
      const overlaps = r._list.map((s) => ({
        start: Math.max(s.start, mergeSpan.start),
        end: Math.min(s.end, mergeSpan.end),
      }));
      r.ownMinutes = Math.max(0, r.ownMinutes - unionMinutes(overlaps));
    }
  }

  const phases = rows.map(({ _list, ...r }) => r);
  const totals = {
    // Wall-clock minutes covered by any phase — a union across every row's
    // spans (calls included), never a sum of ownMinutes, so it can never
    // exceed endOfRun minus the first event (#1928 fix round 3).
    minutes: unionMinutes(rows.flatMap((r) => r._list || [])),
    verifyRuns: verifies.length,
    verifyModes: [...new Set(verifies.map((v) => v.mode).filter((m) => typeof m === 'string'))],
  };
  return { phases, totals };
}

const ZERO_TOKENS = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });

// (phases, usageRows) -> { phases, unattributed, totals } (#1929). Each row
// joins the innermost phase whose [start, end) contains its ts — the same
// rule verify events use — so a container's tokens are its exclusive-gap
// tokens. Rows outside every phase land in `unattributed`. Token fields
// come from assistant rows, round-trips/procedure bytes from user rows;
// the reader keeps the groups exclusive per row, so sums never double.
function joinTokens(phases, usageRows) {
  const rows = Array.isArray(usageRows) ? usageRows : [];
  const phaseList = Array.isArray(phases) ? phases : [];
  const spans = phaseList.map((p) => ({
    phase: p.phase, start: ms(p.start), end: ms(p.end), source: p.source,
  }));
  const acc = new Map();
  const bucket = () => ({ tokens: ZERO_TOKENS(), procedureBytes: 0, toolRoundTrips: 0, rows: 0 });
  for (const s of spans) acc.set(s.phase, bucket());
  const unattributed = bucket();
  const add = (b, r) => {
    b.tokens.input += Number(r.inputTokens) || 0;
    b.tokens.output += Number(r.outputTokens) || 0;
    b.tokens.cacheRead += Number(r.cacheRead) || 0;
    b.tokens.cacheCreate += Number(r.cacheCreate) || 0;
    b.procedureBytes += Number(r.procedureBytes) || 0;
    if (r.toolRoundTrip) b.toolRoundTrips += 1;
    b.rows += 1;
  };
  for (const r of rows) {
    const t = ms(r && r.ts);
    if (t === null) continue;
    let best = null;
    for (const s of spans) {
      if (s.start === null || s.end === null || s.source === 'unattributed') continue;
      if (!(t >= s.start && t < s.end)) continue;
      if (!best || (s.end - s.start) < (best.end - best.start) || ((s.end - s.start) === (best.end - best.start) && s.start > best.start)) best = s;
    }
    add(best ? acc.get(best.phase) : unattributed, r);
  }
  const outPhases = phaseList.map((p) => {
    const b = acc.get(p.phase);
    return { ...p, tokens: b.tokens, procedureBytes: b.procedureBytes, toolRoundTrips: b.toolRoundTrips };
  });
  const totals = bucket();
  for (const r of rows) if (ms(r && r.ts) !== null) add(totals, r);
  delete totals.rows;
  return { phases: outPhases, unattributed, totals };
}

const GUARD_TYPES = { 'gate-denial': 'gateDenial', 'wd-ambiguous': 'wdAmbiguous', 'wd-deny': 'wdDeny' };

// (events) -> { gateDenial, wdAmbiguous, wdDeny } (#1929): the per-run cost
// of the worktree/gate guards, so filed false-positive records can be
// prioritized by measurement.
function countGuardEvents(events) {
  const out = { gateDenial: 0, wdAmbiguous: 0, wdDeny: 0 };
  for (const e of Array.isArray(events) ? events : []) {
    const key = e && GUARD_TYPES[e.type];
    if (key) out[key] += 1;
  }
  return out;
}

module.exports = { derivePhases, PHASES, NESTED_PARENT, joinTokens, countGuardEvents };
