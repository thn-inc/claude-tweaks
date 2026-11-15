'use strict';
// The I/O the two judgment workers share (judgments.js's merge-check, acceptance.js's acceptance):
// the plugin/bin path, the clock and event wrapper, the record and diff reads, and the worker launch
// with the run's ceilings. None of it decides anything; each caller keeps its own verdict rules.

const path = require('node:path');
const { neutralize } = require('./events');
const { readCeilings, launchTracked } = require('./launch');

const BIN_DIR = path.join(__dirname, '..', '..');
const EVENT_DETAIL_MAX = 200;

function bin(name) {
  return path.join(BIN_DIR, name);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function clock(deps) {
  try {
    return deps && typeof deps.now === 'function' ? deps.now() : 0;
  } catch {
    return 0;
  }
}

// Detail text as it is reported and returned: neutralized and bounded.
function cleanDetail(detail) {
  return neutralize(String(detail || '')).slice(0, EVENT_DETAIL_MAX);
}

// One step event. An emit that throws never changes the verdict it reports.
function emitStep(deps, step, status, startedAt, detail, extra) {
  try {
    if (!deps || typeof deps.emit !== 'function') return;
    deps.emit(step, status, clock(deps) - startedAt, cleanDetail(detail), extra);
  } catch {
    // an event is a report about the step, never part of it
  }
}

// The record's title and body and the branch's diff against the base. `files` adds the changed file
// names. { stop } on a failed read.
function readRecordAndDiff(deps, ctx, { files = false } = {}) {
  let title;
  let body;
  try {
    const rec = JSON.parse(deps.gh(['issue', 'view', String(ctx.record), '--repo', ctx.repo, '--json', 'title,body']));
    if (!isPlainObject(rec)) throw new Error('shape');
    title = String(rec.title ?? '');
    body = String(rec.body ?? '');
  } catch {
    return { stop: 'record read failed' };
  }
  const diffArgs = (flags) => ['-C', ctx.worktree, '--no-optional-locks', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', ...flags,
    '--end-of-options', `origin/${ctx.base}...HEAD`, '--'];
  try {
    const diff = String(deps.git(diffArgs([]), { cwd: ctx.worktree }));
    if (!files) return { title, body, diff };
    return { title, body, diff, changedFiles: String(deps.git(diffArgs(['--name-only']), { cwd: ctx.worktree })).split('\n').filter(Boolean) };
  } catch {
    return { stop: 'diff read failed' };
  }
}

// Launches one read-only worker with the run's ceilings and its own settings dir under the run dir.
// { envelope } or { stop }; `label` names the worker in the stop.
async function launchJudge({ deps, shared }, ctx, { role, dir, label, prompt, schema }) {
  const ceilings = readCeilings(shared.policy);
  if (ceilings.bad) return { stop: `${label} ceiling is not a positive number` };
  const settingsDir = path.join(ctx.runDir, dir);
  try {
    deps.mkdirSync(settingsDir, { recursive: true });
    const envelope = await launchTracked(shared, deps, { minutes: ceilings.minutes, dollars: ceilings.dollars }, {
      role, cwd: ctx.worktree, prompt, schema, settingsDir,
    });
    return { envelope };
  } catch {
    return { stop: `${label} launch failed` };
  }
}

module.exports = { EVENT_DETAIL_MAX, bin, isPlainObject, clock, cleanDetail, emitStep, readRecordAndDiff, launchJudge };
