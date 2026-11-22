// plugin/bin/lib/plan-store/ref.js — the one source of the plan ref's name (#6052).
// Pure: requires nothing. A plan lives on `refs/claude-tweaks/plans/{n}`; every
// other module composes or parses that name through here.
'use strict';

const PLAN_REF_PREFIX = 'refs/claude-tweaks/plans/';
const PLAN_DIR = 'docs/superpowers/plans';
const DEFAULT_REMOTE = 'origin';

const PLAN_REF_RE = /^refs\/claude-tweaks\/plans\/([1-9]\d*)$/;

// planRefName(record): the ref for record `record`. TypeError unless a positive safe integer.
function planRefName(record) {
  if (!Number.isSafeInteger(record) || record < 1) {
    throw new TypeError(`planRefName: record must be a positive safe integer, got ${String(record)}`);
  }
  return `${PLAN_REF_PREFIX}${record}`;
}

// parsePlanRefName(ref): the record number a plan ref names, or null for anything else.
function parsePlanRefName(ref) {
  if (typeof ref !== 'string') return null;
  const m = PLAN_REF_RE.exec(ref);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : null;
}

// isPlanBasename(name): true for a plain file name a plan may carry directly under PLAN_DIR. The one
// rule for write and read: no `/` or `\` (a win32 path separator), no NUL, no leading `-`, not `.` or `..`.
function isPlanBasename(name) {
  return typeof name === 'string' && name !== '' && name !== '.' && name !== '..'
    && !/[/\\\0]/.test(name) && !name.startsWith('-');
}

module.exports = { PLAN_REF_PREFIX, PLAN_DIR, DEFAULT_REMOTE, planRefName, parsePlanRefName, isPlanBasename };
