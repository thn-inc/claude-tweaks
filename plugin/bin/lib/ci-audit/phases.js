// plugin/bin/lib/ci-audit/phases.js — per-job phase split and nearest-rank percentiles for
// /claude-tweaks:ci-health (#5757). Pure: no spawns, no I/O, and no knowledge of where a job came
// from. It consumes the normalized job shape only —
//   { name, createdAt, startedAt, completedAt, conclusion, steps: [{ name, number, startedAt, completedAt }] }
// with instants as ISO-8601 strings — plus the steps the workflow file declares, as
// [{ name, kind: 'command' | 'action' }] or null when no declaration was read.
//
// Phases:
//  - waiting = startedAt − createdAt
//  - setup   = startedAt → the boundary, the startedAt of the first run step whose name equals a
//              declared `command` step's name. Steps before it, declared or not, are setup.
//  - running = the boundary → completedAt
// With no boundary (no declaration, no matching run step, or a boundary outside the job's own
// start and completion) setup is null and running is startedAt → completedAt. A job with a missing
// or unparseable instant, or whose instants run backwards, has no phases: null.
'use strict';

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
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
  const step = job.steps.find((s) => s && commands.has(s.name));
  if (!step) return null;
  const ms = instant(step.startedAt);
  if (ms === null || ms < startedMs || ms > completedMs) return null;
  return ms;
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
