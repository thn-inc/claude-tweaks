'use strict';

// The pipeline driver's own settle for stopped runs (#5219). This module's
// SETTLE_ROWS (added with the settle table) is the settle table's source of
// truth; docs/driver.md and the design document copy it by hand.
//
// Pure helpers only here: forge-facing text is built from fixed templates plus
// a reduced worker detail, so a hostile worker string can never reach a comment
// as a mention, link, closing reference, path, token or HTML comment. No model
// module (worker, roles) is required: settle is mechanical.

const { isTrustedComment } = require('../issues/comment-trust');
const { STEP_NAMES, OUTCOMES } = require('./events');
const { ESCALATION_REASONS } = require('../express/cli');

const DRIVER_ESCALATION_MARKER = '<!-- express-driver: escalated -->';

const DETAIL_MAX = 200;

// Reduce free text to a short, inert string. Order is fixed (see the task
// brief): separators, mentions, character allow-list, tokens, paths, cap.
function reduceDetail(text) {
  let s = String(text ?? '').replace(/\\/g, '/');
  s = s.replace(/@/g, 'at ');
  s = s.replace(/[^A-Za-z0-9 .,:;_()/-]/g, ' ');
  s = s.replace(/(?<![A-Za-z0-9])(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g, '<redacted>');
  s = s.replace(/[0-9A-Fa-f]{40,}/g, '<redacted>');
  s = s.replace(/\/{2,}/g, '/');
  s = s.replace(/\b[A-Za-z]:\/\S*/g, '<path>');
  s = s.replace(/(^|[\s():,;])\/{1,2}[A-Za-z0-9._-]\S*/g, '$1<path>');
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
      return `The pipeline driver (drive.js) stopped this record before pushing, at step ${step}: outcome express-escalated, reason ${reason}. Detail: ${detail}\n\nThe claim was released and the worktree and local branch this run created were removed. The driver will not take this record again while this comment stands; the standard path builds it. Delete this comment to let the driver take it again.\n\n${DRIVER_ESCALATION_MARKER}`;
    case 'blocked-record': {
      const keptText = kept ? 'The draft PR, branch and worktree were kept for a human. ' : '';
      return `The pipeline driver (drive.js) stopped this record at step ${step}: outcome ${outcome}. Detail: ${detail}\n\nLabelled bot:blocked and the claim released. ${keptText}Clear bot:blocked to let the record be driven again.`;
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

// The escalate --detail-file content. `removes` is true when the settle row
// removes the worktree or the branch.
function escalateDetailText({ step, detail, removes }) {
  const base = `drive.js stopped at step ${oneOf(STEP_NAMES, step)}: ${detail}`;
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

module.exports = { DRIVER_ESCALATION_MARKER, reduceDetail, commentFor, escalateDetailText, hasDriverEscalationMarker };
