'use strict';

// The pipeline driver's own settle for stopped runs (#5219). This module's
// SETTLE_ROWS (added with the settle table) is the settle table's source of
// truth; docs/driver.md and the design document copy it by hand.
//
// Pure helpers only here: forge-facing text is built from fixed templates plus
// a reduced worker detail, so a hostile worker string can never reach a comment
// as a mention, link, closing reference, path, token or HTML comment. No model
// module (worker, roles) is required: settle is mechanical.

const path = require('node:path');
const { isTrustedComment } = require('../issues/comment-trust');
const { STEP_NAMES, OUTCOMES, STOP_CLASSES, outcomeFor, neutralize, CLI_TIMEOUT_MS, firstLine, errorText } = require('./events');
const { ESCALATION_REASONS } = require('../express/cli');
const { LABELS } = require('../issues/record-vocabulary');

const BIN_DIR = path.join(__dirname, '..', '..');

const DRIVER_ESCALATION_MARKER = '<!-- express-driver: escalated -->';

const DETAIL_MAX = 200;

// The trailing run of ) , ; . on a matched token, walked back by hand.
function sentenceTail(token) {
  let i = token.length;
  while (i > 0 && ')),;.'.includes(token[i - 1])) i--;
  return token.slice(i);
}

// Reduce free text to a short, inert string. Order is fixed (see the task
// brief): separators, mentions, character allow-list, tokens, paths, cap.
function reduceDetail(text) {
  let s = String(text ?? '').replace(/\\/g, '/');
  s = s.replace(/@/g, 'at ');
  s = s.replace(/[^A-Za-z0-9 .,:;_()/-]/g, ' ');
  s = s.replace(/(?<![A-Za-z0-9])(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g, '<redacted>');
  s = s.replace(/[0-9A-Fa-f]{40,}/g, '<redacted>');
  s = s.replace(/\/{2,}/g, '/');
  // A trailing ), comma, semicolon or full stop belongs to the sentence, not the path. The
  // match stays greedy (linear); the tail is split off by hand, not by a regex that would
  // restart at every character of a long run.
  s = s.replace(/\b[A-Za-z]:\/\S*/g, (m) => '<path>' + sentenceTail(m));
  s = s.replace(/(^|[\s():,;])\/{1,2}[A-Za-z0-9._-]\S*/g, (m, pre) => pre + '<path>' + sentenceTail(m));
  s = s.replace(/\s+/g, ' ').trim().slice(0, DETAIL_MAX);
  s = s.replace(/<[a-z]*$/, '').trim();
  return s === '' ? 'none' : s;
}

// Closed sets for the fields that go into the templates unreduced: anything
// else renders as the literal word unknown, and nothing throws.
const OUTCOME_VALUES = Object.values(OUTCOMES);
const oneOf = (set, v) => (set.includes(v) ? v : 'unknown');

function commentFor(kind, fields) {
  const step = oneOf(STEP_NAMES, fields.step);
  const outcome = oneOf(OUTCOME_VALUES, fields.outcome);
  const reason = oneOf(ESCALATION_REASONS, fields.reason);
  const exitCode = Number.isSafeInteger(fields.exitCode) ? fields.exitCode : undefined;
  const { kept } = fields;
  const detail = reduceDetail(fields.detail);
  switch (kind) {
    case 'escalated':
      return `The pipeline driver (drive.js) stopped this record before pushing, at step ${step}: outcome express-escalated, reason ${reason}. Detail: ${detail}\n\nThe driver releases the claim and removes the worktree and local branch this run created. The driver will not take this record again while this comment stands; the standard path builds it. Delete this comment to let the driver take it again.\n\n${DRIVER_ESCALATION_MARKER}`;
    case 'blocked-record': {
      // The blocked row removes nothing, so the branch and worktree are always kept; the draft
      // PR is named only when one exists (kept: 'pr').
      const keptText = kept === 'pr' ? 'The draft PR, branch and worktree are kept for a human. ' : 'The branch and worktree are kept for a human. ';
      return `The pipeline driver (drive.js) stopped this record at step ${step}: outcome ${outcome}. Detail: ${detail}\n\nThe driver labels this record bot:blocked and releases the claim. ${keptText}Clear bot:blocked to let the record be driven again.`;
    }
    case 'blocked-pr':
      return `The pipeline driver (drive.js) stopped at step ${step}: outcome ${outcome}. Detail: ${detail}\n\nThis draft PR, its branch and its worktree are kept for a human.`;
    case 'claim': {
      const exit = exitCode !== undefined ? ` (claim-targets.js exit ${exitCode})` : '';
      return `The pipeline driver (drive.js) could not claim this record: step ${step} failed${exit}. Detail: ${detail}\n\nLabelled bot:blocked. Clear bot:blocked to let the record be driven again.`;
    }
    default:
      throw new Error(`unknown comment kind: ${kind}`);
  }
}

// The escalate --detail-file content. Callers pass the raw stop detail: it is
// reduced here, exactly once (reduceDetail is not idempotent). `removes` is true when the settle row
// removes the worktree or the branch.
function escalateDetailText({ step, detail, removes }) {
  const base = `drive.js stopped at step ${oneOf(STEP_NAMES, step)}: ${reduceDetail(detail)}`;
  return removes ? `${base}. The driver removed the worktree and local branch this run created.` : base;
}

// true when a trusted comment ends with the marker; false when none does;
// null when `comments` is not an array (unreadable).
function hasDriverEscalationMarker(comments) {
  if (!Array.isArray(comments)) return null;
  return comments.some(
    (c) => isTrustedComment(c) && typeof c.body === 'string' && c.body.trimEnd().endsWith(DRIVER_ESCALATION_MARKER),
  );
}

// ---- the settle table -------------------------------------------------------------

const toEscalationReason = (reason) => (ESCALATION_REASONS.includes(reason) ? reason : 'express-error');

// Which row of SETTLE_ROWS settles a stop. A pre-push stop that nevertheless pushed, or
// whose PR is recorded, holds public work: it is settled by the blocked row, never removed.
function selectRow(stop, { prRecorded }) {
  switch (stop.class) {
    case STOP_CLASSES.REFUSED: return { row: 'refused', unclassified: false };
    case STOP_CLASSES.CLAIM:
      return { row: stop.reason === 'claim-exit-3' ? 'claim-contested' : 'claim', unclassified: false };
    case STOP_CLASSES.PRE_PUSH:
      return { row: stop.pushed || prRecorded ? 'blocked' : 'pre-push', unclassified: false };
    case STOP_CLASSES.BLOCKED: return { row: 'blocked', unclassified: false };
    case STOP_CLASSES.NONE: return { row: 'none', unclassified: false };
    default: return { row: 'blocked', unclassified: true };
  }
}

// The settle step names each row runs, in call order. docs/driver.md copies this by hand.
const SETTLE_ROWS = Object.freeze({
  refused: Object.freeze([]),
  'claim-contested': Object.freeze([]),
  none: Object.freeze([]),
  claim: Object.freeze(['settle-comment-record', 'settle-label']),
  'pre-push': Object.freeze(['settle-escalate', 'settle-comment-record', 'settle-release', 'settle-remove-worktree', 'settle-delete-branch']),
  blocked: Object.freeze(['settle-comment-pr', 'settle-comment-record', 'settle-label', 'settle-release']),
});

const CLASS_BY_ROW = { refused: 'refused', 'claim-contested': 'claim', claim: 'claim', 'pre-push': 'pre-push', blocked: 'blocked', none: 'none' };
const CLAIM_NOTE = 'a claim that may have been written lapses by its TTL';
const UNREADABLE_NOTE = 'run-state.json unreadable; settled by the blocked row to keep the work';

// The PR the run recorded: the caller's, else run-state.json's pr.number. A missing file
// means no PR; any other read or parse failure is `unreadable` (the caller keeps the work).
function prStateOf(input, deps) {
  if (Number.isSafeInteger(input.pr)) return { number: input.pr, unreadable: false };
  if (!input.runDir) return { number: null, unreadable: false };
  let text;
  try {
    text = deps.readFile(path.join(input.runDir, 'run-state.json'));
  } catch (err) {
    return { number: null, unreadable: !(err && err.code === 'ENOENT') };
  }
  let n;
  try {
    const parsed = JSON.parse(text);
    n = parsed && parsed.pr ? parsed.pr.number : undefined;
  } catch {
    return { number: null, unreadable: true };
  }
  return { number: Number.isSafeInteger(n) ? n : null, unreadable: false };
}

const NOT_A_WORKTREE = /is not a working tree/i;

// Performs the fixed calls for a stopped run, iterating SETTLE_ROWS[row]. Every call is made
// at most once and a failure never stops the next; a worker is never launched (settle is
// mechanical).
function settle(input, deps) {
  const { stop, record, runDir, wt, branch, mainRoot, ghRepo } = input;
  const calls = [];
  const failed = [];
  const pr = prStateOf(input, deps);
  const picked = selectRow(stop, { prRecorded: pr.number !== null || pr.unreadable });
  let row = picked.row;
  const created = stop.created || {};
  const stepName = oneOf(STEP_NAMES, stop.step);
  const reason = toEscalationReason(stop.reason);
  const gitIn = (args) => deps.git(['-C', mainRoot, ...args], { cwd: mainRoot });
  const nodeOpts = { cwd: mainRoot, timeout: CLI_TIMEOUT_MS, env: deps.env };
  const bin = (name) => path.join(BIN_DIR, name);

  // fn returns undefined (ok), a string (ok, with detail) or { status, detail }; a throw is a fail.
  function step(name, fn) {
    const t0 = deps.now();
    let status = 'ok';
    let detail = '';
    try {
      const r = fn();
      if (typeof r === 'string') detail = r;
      else if (r) { status = r.status || 'ok'; detail = r.detail || ''; }
    } catch (err) {
      status = 'fail';
      detail = errorText(err);
    }
    detail = neutralize(detail);
    if (status === 'fail') failed.push(name);
    calls.push({ step: name, status, detail });
    input.emit(name, status, deps.now() - t0, detail);
    return status;
  }

  // A CLI result is a failure on a non-zero exit, and on a null exit (killed by the timeout).
  const exited = (r, what) => {
    if (r.code === 0) return undefined;
    if (r.code === null || r.code === undefined) return { status: 'fail', detail: `${what} did not finish (timed out or killed)` };
    return { status: 'fail', detail: `${what} exited ${r.code}${firstLine(r.stderr) ? `: ${firstLine(r.stderr)}` : ''}` };
  };
  const noRun = () => ({ status: 'fail', detail: 'no run directory' });
  const outcome = () => outcomeFor(CLASS_BY_ROW[row]);
  const commentRecord = (body) => { deps.gh(['issue', 'comment', '--repo', ghRepo, '--body', body, '--', String(record)]); };

  const recordBody = () => {
    if (row === 'claim') {
      const m = /^claim-exit-(\d+)$/.exec(String(stop.reason));
      return commentFor('claim', { step: stop.step, outcome: outcome(), exitCode: m ? Number(m[1]) : undefined, detail: stop.detail });
    }
    if (row === 'pre-push') return commentFor('escalated', { step: stop.step, outcome: outcome(), reason, detail: stop.detail });
    return commentFor('blocked-record', { step: stop.step, outcome: outcome(), detail: stop.detail, kept: pr.number !== null ? 'pr' : 'branch' });
  };

  // One handler per settle step. `when` is the step's own precondition: a step whose
  // precondition fails is neither made nor emitted.
  const HANDLERS = {
    'settle-escalate': {
      when: () => !(stop.step === 'check' && stop.checkLogged === true),
      run: () => {
        if (!runDir) return noRun();
        const file = path.join(runDir, 'settle-escalate.txt');
        const removes = created.worktree === true || created.branch === true;
        deps.writeFile(file, escalateDetailText({ step: stop.step, detail: stop.detail, removes }));
        const r = deps.node(bin('express-lane.js'), ['escalate', '--run', runDir, '--issue', String(record),
          '--reason', reason, '--detail-file', file], nodeOpts);
        return exited(r, 'express-lane.js escalate');
      },
    },
    'settle-comment-pr': {
      when: () => pr.number !== null,
      run: () => {
        deps.gh(['pr', 'comment', '--repo', ghRepo, '--body',
          commentFor('blocked-pr', { step: stop.step, outcome: outcome(), detail: stop.detail }), '--', String(pr.number)]);
      },
    },
    'settle-comment-record': { run: () => commentRecord(recordBody()) },
    'settle-label': {
      run: () => { deps.gh(['issue', 'edit', '--repo', ghRepo, '--add-label', LABELS.BOT_BLOCKED, '--', String(record)]); },
    },
    'settle-release': {
      run: () => {
        if (!runDir) return noRun();
        const r = deps.node(bin('release-claim.js'), [String(record), '--run', runDir, '--reason',
          `drive.js settle: ${outcome()} at ${stepName}`], nodeOpts);
        if (r.code === 3) return 'already released';
        if (r.code === 4) return 'held by another run';
        return exited(r, 'release-claim.js');
      },
    },
    'settle-remove-worktree': {
      when: () => created.worktree === true,
      run: () => {
        // Runs even when the directory is gone: a registered worktree whose directory was
        // deleted would otherwise make `branch -D` fail with "used by worktree".
        try {
          gitIn(['worktree', 'remove', '--force', '--force', wt]);
        } catch (err) {
          if (NOT_A_WORKTREE.test(`${(err && err.stderr) || ''}\n${(err && err.message) || ''}`)) return 'already gone';
          throw err;
        }
        return undefined;
      },
    },
    'settle-delete-branch': {
      when: () => created.branch === true,
      run: () => {
        try {
          gitIn(['rev-parse', '--verify', '--quiet', '--end-of-options', `refs/heads/${branch}`]);
        } catch (err) {
          if (err && err.status === 1) return 'already gone';
          throw err;
        }
        gitIn(['branch', '-D', '--end-of-options', branch]);
        return undefined;
      },
    },
  };

  function runRow(names) {
    for (const name of names) {
      const h = HANDLERS[name];
      if (h.when && !h.when()) continue;
      const status = step(name, h.run);
      // A failed escalate means the work cannot be removed safely: keep it, settle as blocked.
      if (name === 'settle-escalate' && status === 'fail') {
        row = 'blocked';
        runRow(SETTLE_ROWS.blocked);
        return;
      }
    }
  }
  runRow(SETTLE_ROWS[row]);

  let note = null;
  if (row === 'claim' && (stop.reason === 'claim-exit-5' || input.claimed === true)) note = CLAIM_NOTE;
  else if (pr.unreadable && stop.class === STOP_CLASSES.PRE_PUSH && !stop.pushed) note = UNREADABLE_NOTE;
  return { row, settledClass: CLASS_BY_ROW[row], calls, failed, unclassified: picked.unclassified, note };
}

module.exports = {
  DRIVER_ESCALATION_MARKER, reduceDetail, commentFor, escalateDetailText, hasDriverEscalationMarker,
  toEscalationReason, selectRow, SETTLE_ROWS, settle,
};
