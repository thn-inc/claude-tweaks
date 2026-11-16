// plugin/bin/lib/ci-audit/phases.js — per-job phase split and nearest-rank percentiles for
// /claude-tweaks:ci-health (#5757). Pure: no spawns, no I/O, and no knowledge of where a job came
// from. It consumes the normalized job shape only —
//   { name, createdAt, startedAt, completedAt, conclusion, steps: [{ name, number, startedAt, completedAt }] }
// with instants as ISO-8601 strings — plus the steps the workflow file declares, as
// [{ name, kind: 'command' | 'action' }] or null when no declaration was read.
//
// Phases:
//  - waiting = startedAt − createdAt
//  - setup   = startedAt → the boundary: run steps ordered by `number`, the startedAt of the first
//              one whose name equals a declared `command` step's name and whose startedAt is valid
//              and inside the job's own start and completion (a skipped matching step is passed
//              over). Steps before it, declared or not, are setup.
//  - running = the boundary → completedAt
// With no boundary (no declaration, or no matching run step that qualifies) setup is null and
// running is startedAt → completedAt. A job with a missing or unparseable instant, or whose
// instants run backwards, has no phases: null.
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

function boundaryMs(job, declaredSteps, startedMs, completedMs) {
  if (!Array.isArray(declaredSteps) || !Array.isArray(job.steps)) return null;
  const commands = new Set(
    declaredSteps.filter((s) => s && s.kind === 'command' && typeof s.name === 'string').map((s) => s.name),
  );
  if (commands.size === 0) return null;
  for (const step of byNumber(job.steps)) {
    if (!step || !commands.has(step.name)) continue;
    const ms = instant(step.startedAt);
    if (ms !== null && ms >= startedMs && ms <= completedMs) return ms;
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

module.exports = { percentile, splitJobPhases };
