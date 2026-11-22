'use strict';
// The I/O the two judgment workers share (judgments.js's merge-check, acceptance.js's acceptance):
// the plugin/bin path, the clock and event wrapper, the record and diff reads, and the worker launch
// with the run's ceilings. None of it decides anything; each caller keeps its own verdict rules.

const path = require('node:path');
const { neutralize } = require('./events');
const { MODEL_REFUSED_CODE, readCeilings, launchTracked } = require('./launch');
const { splitNul } = require('../git-z');

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

// True once run.js's signal handler has set the run's interrupt (merge deps carry `interrupted`). A judgment
// that finds it set after a worker launch makes no further call and emits nothing: the handler already
// reported the interrupt, and the final line stays last.
function isInterrupted(deps) {
  try {
    return !!deps && typeof deps.interrupted === 'function' && !!deps.interrupted();
  } catch {
    return false;
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
  const range = `origin/${ctx.base}...HEAD`;
  try {
    const diff = String(deps.git(['-C', ctx.worktree, '--no-optional-locks', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--end-of-options', range, '--'], { cwd: ctx.worktree }));
    if (!files) return { title, body, diff };
    // -z: git prints a non-ASCII path raw, NUL-delimited, instead of C-quoted (_shared/git-path-read.md).
    const names = String(deps.git(['-C', ctx.worktree, '--no-optional-locks', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--name-only', '-z', '--end-of-options', range, '--'], { cwd: ctx.worktree }));
    return { title, body, diff, changedFiles: splitNul(names) };
  } catch {
    return { stop: 'diff read failed' };
  }
}

// Launches one read-only worker with the run's ceilings and its own settings dir under the run dir.
// { envelope, model, effort } or { stop, model?, effort? }; `label` names the worker in the stop.
async function launchJudge({ deps, shared }, ctx, { role, dir, label, prompt, schema }) {
  const ceilings = readCeilings(shared.policy);
  if (ceilings.bad) return { stop: `${label} ceiling is not a positive number` };
  const settingsDir = path.join(ctx.runDir, dir);
  try {
    deps.mkdirSync(settingsDir, { recursive: true });
    const { envelope, model, effort } = await launchTracked(shared, deps, { minutes: ceilings.minutes, dollars: ceilings.dollars }, {
      role, cwd: ctx.worktree, prompt, schema, settingsDir,
    });
    return { envelope, model, effort: effort ?? null };
  } catch (err) {
    // A model refusal names its code (#5917); any other error stays fixed text, never the error's words.
    // A throw after the model resolved carries it (launchTracked), so the stop's line can still name it.
    return { stop: `${label} launch failed${err && err.code === MODEL_REFUSED_CODE ? ` (${err.code})` : ''}`, ...(typeof err?.model === 'string' ? { model: err.model, effort: err.effort ?? null } : {}) };
  }
}

module.exports = { bin, isPlainObject, isInterrupted, clock, cleanDetail, emitStep, readRecordAndDiff, launchJudge };
