// plugin/bin/lib/ci-audit/phases.js — per-job phase split and nearest-rank percentiles for
// /claude-tweaks:ci-health (#5757). Pure: no spawns, no I/O, and no knowledge of which service a
// job came from or how it was fetched. It does read the workflow-file naming syntax: nameMatches
// below treats the `${{ … }}` expression delimiters in a declared name as template holes. It
// consumes the normalized job shape only —
//   { name, createdAt, startedAt, completedAt, conclusion,
//     steps: [{ name, number, conclusion, startedAt, completedAt }] }
// with instants as ISO-8601 strings — plus the steps the workflow file declares, in file order, as
// [{ name, kind: 'command' | 'action', runName? }] or null when no declaration was read. `runName`
// is the name the run data gives the step (the source adapter derives it; null when it cannot be
// known); a step without the key is matched by its `name`.
//
// Phases:
//  - waiting = startedAt − createdAt
//  - setup   = startedAt → the boundary: the startedAt of the first declared `command` step that
//              ran. Declared steps are matched to run steps in order (run steps ordered by
//              `number`; each declared step takes the first run step after the previous match whose
//              name it matches). A matched command step whose conclusion is `skipped` did not run
//              and is passed over. Steps before the boundary, declared or not, are setup.
//  - running = the boundary → completedAt
// Setup is unknown (null), never moved onto a later step, when a declared command step before the
// boundary has no name (runName null) or matches no run step, or when the boundary step's startedAt
// is missing or outside the job's own start and completion. With no declaration or no command step
// setup is null too. When setup is null, running is startedAt → completedAt. A job with a missing or
// unparseable instant, or whose instants run backwards, has no phases: null.
//
// nameMatches(declared, actual): equal after trimming, or, when `declared` holds a `${{ … }}`
// expression, a match of the template — the literal text around the expressions in order, each
// expression standing for at least one character — anchored at both ends. A run-data name the
// forge expanded (`shard 1/4` for `shard ${{ matrix.shard }}/${{ strategy.job-total }}`) matches.
// A template that is only expressions (`${{ matrix.task }}`, every literal part blank) has nothing
// to anchor on and would match every name — the run's first step or any run job — so it matches
// nothing: a boundary step named that way leaves setup null, a job named that way matches no run
// job (they land in the aggregate's unmatchedJobs). The match is a left-to-right scan of literal
// segments (linear in the name; no regex).
//
// percentile is nearest-rank over the finite values only; null for a non-array, for no finite
// values, and for a p that is not a finite number in 0..100.
'use strict';

function percentile(values, p) {
  if (!Array.isArray(values) || !Number.isFinite(p) || p < 0 || p > 100) return null;
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const n = sorted.length;
  const rank = Math.min(n, Math.max(1, Math.ceil((p * n) / 100)));
  return sorted[rank - 1];
}

function instant(value) {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// The literal segments of a name around its `${{ … }}` expressions, or null when it holds none.
function templateOf(name) {
  const parts = [];
  let from = 0;
  for (;;) {
    const open = name.indexOf('${{', from);
    const close = open < 0 ? -1 : name.indexOf('}}', open + 3);
    if (close < 0) break;
    parts.push(name.slice(from, open));
    from = close + 2;
  }
  if (parts.length === 0) return null;
  parts.push(name.slice(from));
  return parts;
}

function nameMatches(declared, actual) {
  if (typeof declared !== 'string' || typeof actual !== 'string') return false;
  const d = declared.trim();
  const a = actual.trim();
  if (d === a) return true;
  const parts = templateOf(d);
  if (parts === null) return false;
  // Only expressions, no literal text: it would match any name — the run data's first step or
  // any run job — so it is unknown, never a match (setup stays null; its run jobs stay unmatched).
  if (parts.every((p) => p.trim() === '')) return false;
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!a.startsWith(first)) return false;
  let pos = first.length;
  for (let i = 1; i < parts.length - 1; i++) {
    const at = a.indexOf(parts[i], pos + 1); // the expression before this segment takes ≥ 1 char
    if (at < 0) return false;
    pos = at + parts[i].length;
  }
  return a.length - last.length >= pos + 1 && a.endsWith(last);
}

const runNameOf = (s) => (Object.prototype.hasOwnProperty.call(s, 'runName') ? s.runName : s.name);

function boundaryMs(job, declaredSteps, startedMs, completedMs) {
  if (!Array.isArray(declaredSteps) || !Array.isArray(job.steps)) return null;
  const declared = declaredSteps.filter((s) => s && (s.kind === 'command' || s.kind === 'action'));
  if (!declared.some((s) => s.kind === 'command')) return null;
  const ran = byNumber(job.steps);
  let cursor = 0;
  for (const d of declared) {
    const name = runNameOf(d);
    let at = -1;
    if (typeof name === 'string') {
      for (let i = cursor; i < ran.length; i++) {
        if (ran[i] && nameMatches(name, ran[i].name)) { at = i; break; }
      }
    }
    if (at < 0) {
      if (d.kind === 'command') return null; // an unmatched command before the boundary: unknown
      continue;
    }
    cursor = at + 1;
    if (d.kind !== 'command' || ran[at].conclusion === 'skipped') continue;
    const ms = instant(ran[at].startedAt);
    return ms !== null && ms >= startedMs && ms <= completedMs ? ms : null;
  }
  return null;
}

// A copy of the steps with the numbered ones stably sorted by `number` into the slots numbered
// steps occupy; a step without a finite number keeps its own array slot.
function byNumber(steps) {
  const hasNumber = (s) => Boolean(s) && Number.isFinite(s.number);
  const sorted = steps.filter(hasNumber).sort((a, b) => a.number - b.number);
  let next = 0;
  return steps.map((s) => (hasNumber(s) ? sorted[next++] : s));
}

function splitJobPhases(job, declaredSteps) {
  if (!job || typeof job !== 'object') return null;
  const createdMs = instant(job.createdAt);
  const startedMs = instant(job.startedAt);
  const completedMs = instant(job.completedAt);
  if (createdMs === null || startedMs === null || completedMs === null) return null;
  if (startedMs < createdMs || completedMs < startedMs) return null;
  const waitingMs = startedMs - createdMs;
  const boundary = boundaryMs(job, declaredSteps, startedMs, completedMs);
  if (boundary === null) return { waitingMs, setupMs: null, runningMs: completedMs - startedMs };
  return { waitingMs, setupMs: boundary - startedMs, runningMs: completedMs - boundary };
}

module.exports = { percentile, splitJobPhases, instant, nameMatches };
