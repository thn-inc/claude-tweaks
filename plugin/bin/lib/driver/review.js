'use strict';

// The pipeline driver's reviewer step (#5222): one read-only reviewer worker between `check`
// and `push`. A finding counts only when its evidence test file, written into the worktree and
// run by the driver with `node --test`, genuinely fails. This module holds the rules and the step.
//
// Named bounds:
//   MAX_FINDINGS               5       findings read from one reviewer result
//   EVIDENCE_PATH_MAX_CHARS    200     an evidence path's length
//   EVIDENCE_CONTENT_MAX_BYTES 65536   an evidence file's UTF-8 size
//   EVIDENCE_RUN_TIMEOUT_MS    45000   one evidence run's wall clock (below the 1-minute minimum
//                                      of express-driver-wall-clock-minutes)
//   EVENT_TEXT_MAX_CHARS       200     reviewer text in an event line or stop detail
//   DIFF_PROMPT_MAX_BYTES      100000  the diff quoted in the reviewer prompt
//
// Evidence runs (Task 0 capture). Each source in tests/bin-lib/driver/fixtures/review-evidence/
// was written to a temp dir as {name}.test.js and run there as
// `node --test --test-reporter=tap --test-reporter-destination={dir}/{name}.tap {name}.test.js`
// (`hang` killed, with its process group, after 3 s). process.version v22.23.2. The TAP of each
// run is frozen beside its source as {name}.tap, with the temp dir replaced by <DIR>.
//
// Each `not ok` point below lists the keys of its YAML block (at the block's own indent) that
// the rule reads: failureType, exitCode, type, plus the code key for reference.
//
// | fixture       | exit | signal  | test points in the TAP and their block keys                               | # pass | # fail |
// |---------------|------|---------|----------------------------------------------------------------------------|--------|--------|
// | assert-fail   | 1    | null    | `not ok 1 - adds two numbers`: failureType 'testCodeFailure',              | 0      | 1      |
// |               |      |         | code 'ERR_ASSERTION', type 'test', no exitCode                             |        |        |
// | nested-fail   | 1    | null    | child `    not ok 1 - adds two numbers`: 'testCodeFailure', 'ERR_ASSERTION'; | 0    | 1      |
// |               |      |         | parent `not ok 1 - widget`: 'subtestsFailed', 'ERR_TEST_FAILURE', 'suite'  |        |        |
// | throw-in-test | 1    | null    | `not ok 1 - reads a property of null`: 'testCodeFailure',                  | 0      | 1      |
// |               |      |         | code 'ERR_TEST_FAILURE', name 'TypeError', type 'test', no exitCode        |        |        |
// | nested-throw  | 1    | null    | child `    not ok 1 - reads a property of null`: 'testCodeFailure',        | 0      | 1      |
// |               |      |         | 'ERR_TEST_FAILURE', 'TypeError'; parent `not ok 1 - widget`: 'subtestsFailed', 'suite' |  |  |
// | hook-require  | 1    | null    | child `    not ok 1 - runs after setup`: failureType 'hookFailed',         | 0      | 1      |
// |               |      |         | code 'MODULE_NOT_FOUND'; parent `not ok 1 - widget`: 'subtestsFailed', 'suite' |    |        |
// | syntax        | 1    | null    | `not ok 1 - syntax.test.js`: 'testCodeFailure', exitCode 1, signal ~,      | 0      | 1      |
// |               |      |         | 'ERR_TEST_FAILURE'; the child's stderr (SyntaxError) folded into `# ` lines |       |        |
// | load-throw    | 1    | null    | `not ok 1 - load-throw.test.js`: 'testCodeFailure', exitCode 1, signal ~,  | 0      | 1      |
// |               |      |         | 'ERR_TEST_FAILURE'; stderr (Cannot find module) folded into `# ` lines     |        |        |
// | no-test       | 0    | null    | `ok 1 - no-test.test.js`                                                   | 1      | 0      |
// | pass          | 0    | null    | `ok 1 - adds two numbers`                                                  | 1      | 0      |
// | hang          | null | SIGKILL | none; the TAP is `TAP version 13` alone, with no summary                   | -      | -      |
// | exit1         | 1    | null    | `not ok 1 - exit1.test.js`: 'testCodeFailure', exitCode 1, signal ~,       | 0      | 1      |
// |               |      |         | 'ERR_TEST_FAILURE'                                                          |        |        |
// | fake-tap      | 1    | null    | its printed `not ok 1 - fake` and YAML lines folded into `# ` lines;       | 0      | 1      |
// |               |      |         | `not ok 1 - fake-tap.test.js`: 'testCodeFailure', exitCode 1, signal ~     |        |        |
//
// On v20.20.2 (CI) the same capture gives the same exits, points, failureType/exitCode/code keys
// and summaries; the file-level point is named by the absolute path, and only suites carry `type:`.
// Probed on both versions (not frozen): an error's own exitCode, failureType or type property is
// not printed, so those keys come from the runner alone; a failing `before` hook gives fail 0; a
// throwing `describe` body gives a suite point with 'testCodeFailure' and fail 0; a failing
// `test.todo` gives `not ok … # TODO` and fail 0.
//
// The classification rule (classifyEvidenceRun), stated for `node --test` only: `timedOut` →
// timeout. Otherwise parse the TAP: a test point is a line matching /^\s*(not ok|ok) \d+ - /
// outside a YAML block; its block is the `---` line right after it through the `...` line at the
// same indent, and only keys at that indent are read. A file-level point (the runner's own, for a
// file that failed to load or exited on its own) is a `not ok` point whose block has an
// `exitCode:` key. A failed test case is a `not ok` point without a `# TODO` directive whose block
// has `failureType: 'testCodeFailure'` and neither an `exitCode:` key nor `type: 'suite'`. The
// summary is the last `# fail N` / `# pass N` at column 0.
//   reproduced   exit 1, summary fail >= 1, and at least one failed test case
//   load-failure exit 1, a summary, at least one `not ok` point (TODO aside), each a file-level point
//   passed       exit 0, summary fail 0
//   unplaceable  anything else (a point with no block has none of the keys; a block that never
//                closes hides the summary)
// The error class and the `code:` key are not read: a test case that throws a TypeError carries
// 'ERR_TEST_FAILURE' just as a file-level point does. A hook failure ('hookFailed') is not a test
// case. Text the evidence file prints is folded into `# ` comments. The parse is one pass over the
// lines, with anchored per-line regexes only, because the evidence test controls part of the text.
//
// On or off (reviewRequired): policy `off` and `on` decide alone; any other value is the beyond
// rule, on when the size label is not `low` or the Key Files (the eligibility verdict's own
// extraction; a non-array counts as beyond) exceed EXPRESS_MAX_KEY_FILES.
//
// The reviewer's result is untrusted, and an evidence path names a file the driver writes into the
// worktree, so every rule here fails closed and no reason string echoes reviewer text.
//   finding   a plain object with exactly path (string), line (safe integer >= 1), claim (string,
//             non-blank, one line) and evidence (plain object)
//   evidence  a plain object with exactly path and content, both strings: a command, an extra key
//             or a missing content is discarded, never run
//   content   a non-empty string of at most EVIDENCE_CONTENT_MAX_BYTES UTF-8 bytes
//   path      PATH_RULES, in order; the first rule that trips names the discard. Lexical rules come
//             first, then isTestPath and the protected / merge-sensitive check (both through
//             classifyDiffFiles and isProtectedPath, the eligibility gate's own checks), then the
//             file-system rules through deps (lstatType, canonicalRealpath): the leaf must not
//             exist in any form, and the nearest existing ancestor of its parent must be a real
//             directory whose canonical path lies inside the worktree's.

const path = require('path');
const { parseRecordFacets } = require('../issues/record');
const { EXPRESS_MAX_KEY_FILES, isProtectedPath } = require('../express/eligibility');
const { classifyDiffFiles } = require('../issues/blast-radius');
const { isAncestorOrSelf } = require('../path-guard');

const MAX_FINDINGS = 5;
const EVIDENCE_PATH_MAX_CHARS = 200;
const EVIDENCE_CONTENT_MAX_BYTES = 65536;
const EVIDENCE_RUN_TIMEOUT_MS = 45000;
const EVENT_TEXT_MAX_CHARS = 200;
const DIFF_PROMPT_MAX_BYTES = 100000;

// The test-command shapes the classification rule covers, keyed on the driver's testCommand.
// Any other command discards every finding.
const EVIDENCE_COMMANDS = Object.freeze({
  'npm test': (rel, dest) => ['--test', '--test-reporter=tap', `--test-reporter-destination=${dest}`, rel],
});

// The argument list (for deps.execPath, no shell) that runs one evidence file, or null when the
// rule does not cover testCommand.
function evidenceArgs(testCommand, rel, dest) {
  if (typeof testCommand !== 'string' || !Object.hasOwn(EVIDENCE_COMMANDS, testCommand)) return null;
  return EVIDENCE_COMMANDS[testCommand](rel, dest);
}

const POINT_RE = /^\s*(not ok|ok) \d+ - /;
const SUMMARY_RE = /^# (pass|fail) (\d+)$/;

// One pass over the TAP lines: the `not ok` points other than TODO ones (each with which of the
// rule's keys its block holds) and the last column-0 pass/fail counts. A block that never closes
// runs to the end and hides the summary, so such a run is unplaceable whatever its keys.
function parseTap(tap) {
  const failed = [];
  const counts = { pass: null, fail: null };
  let opened = null; // the point whose block may start on the next line
  let block = null; // { point, indent, end }: the open block and its closing line
  for (const raw of String(tap).split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (block) {
      const p = block.point;
      const key = line.startsWith(block.indent) ? line.slice(block.indent.length) : null;
      if (line === block.end) block = null;
      else if (key === "failureType: 'testCodeFailure'") p.testCode = true;
      else if (key === "type: 'suite'") p.suite = true;
      else if (key !== null && key.startsWith('exitCode:')) p.fileLevel = true;
      continue;
    }
    const prev = opened;
    opened = null;
    if (prev && line.endsWith('---') && line.slice(0, -3).trim() === '') {
      const indent = line.slice(0, -3);
      block = { point: prev, indent, end: `${indent}...` };
      continue;
    }
    const point = POINT_RE.exec(line);
    if (point) {
      opened = { testCode: false, suite: false, fileLevel: false };
      // Node escapes a `#` in a test name as `\#`, so ` # TODO` is the directive.
      if (point[1] === 'not ok' && !line.includes(' # TODO')) failed.push(opened);
      continue;
    }
    const count = SUMMARY_RE.exec(line);
    if (count) counts[count[1]] = Number(count[2]);
  }
  return { failed, ...counts };
}

const isFailedTestCase = (p) => p.testCode && !p.fileLevel && !p.suite;
const isFileLevel = (p) => p.fileLevel;

// Classify one evidence run. Callers may pass more fields (the supervised run's outcome); the
// rule reads only `code`, `timedOut` and `tap`.
function classifyEvidenceRun({ code, timedOut, tap }) {
  if (timedOut) return { verdict: 'timeout', fail: null, pass: null };
  const { failed, fail, pass } = parseTap(tap);
  const result = (verdict) => ({ verdict, fail, pass });
  if (fail === null) return result('unplaceable');
  if (code === 1 && fail >= 1 && failed.some(isFailedTestCase)) return result('reproduced');
  if (code === 1 && failed.length > 0 && failed.every(isFileLevel)) return result('load-failure');
  if (code === 0 && fail === 0) return result('passed');
  return result('unplaceable');
}

// Whether the reviewer runs for this record. keyFiles is the eligibility verdict's own
// extractKeyFiles result (ctx.keyFiles).
function reviewRequired({ issue, keyFiles, policyValue } = {}) {
  if (policyValue === 'off') return { on: false, reason: 'express-driver-review is off' };
  if (policyValue === 'on') return { on: true, reason: 'express-driver-review is on' };
  const { size } = parseRecordFacets((issue && issue.labels) || []);
  if (size !== 'low') return { on: true, reason: `size ${size || 'unlabelled'} is beyond size:low` };
  if (!Array.isArray(keyFiles)) return { on: true, reason: 'Key Files unreadable' };
  if (keyFiles.length > EXPRESS_MAX_KEY_FILES) {
    return { on: true, reason: `${keyFiles.length} Key Files is beyond ${EXPRESS_MAX_KEY_FILES}` };
  }
  return { on: false, reason: `size:low and ${keyFiles.length} Key Files are inside the express bounds` };
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

// Exactly the keys named. The reason names only our own key names, never the reviewer's.
function keysViolation(what, v, keys) {
  if (!isPlainObject(v)) return `${what} is not an object`;
  const missing = keys.find((k) => !Object.hasOwn(v, k));
  if (missing) return `${what} has no ${missing}`;
  if (Object.keys(v).length !== keys.length) return `${what} has an unexpected key`;
  return null;
}

function findingShapeViolation(f) {
  const keys = keysViolation('finding', f, ['path', 'line', 'claim', 'evidence']);
  if (keys) return keys;
  if (typeof f.path !== 'string') return 'finding path is not a string';
  if (!Number.isSafeInteger(f.line) || f.line < 1) return 'finding line is not an integer of at least 1';
  if (typeof f.claim !== 'string' || f.claim.trim() === '' || /[\r\n]/.test(f.claim)) {
    return 'finding claim is not one non-blank line';
  }
  if (!isPlainObject(f.evidence)) return 'finding evidence is not an object';
  return null;
}

function evidenceShapeViolation(evidence) {
  const keys = keysViolation('evidence', evidence, ['path', 'content']);
  if (keys) return keys;
  if (typeof evidence.path !== 'string') return 'evidence path is not a string';
  if (typeof evidence.content !== 'string') return 'evidence content is not a string';
  return null;
}

function contentViolation(content) {
  if (typeof content !== 'string') return 'evidence content is not a string';
  if (content === '') return 'evidence content is empty';
  if (Buffer.byteLength(content, 'utf8') > EVIDENCE_CONTENT_MAX_BYTES) {
    return `evidence content is over ${EVIDENCE_CONTENT_MAX_BYTES} bytes`;
  }
  return null;
}

// The eligibility gate's own test-path and merge-sensitive checks, for one path.
const classifyPath = (p, sensitivePaths) => classifyDiffFiles([{ path: p, additions: 0, deletions: 0 }], sensitivePaths)[0];
const absoluteIn = (wt, p) => path.join(path.resolve(wt), ...p.split('/'));

// From the parent up, the first ancestor that exists (stopping at the worktree) must be a real
// directory whose canonical path lies inside the worktree's canonical path.
function parentEscapes(p, { wt, deps }) {
  const root = path.resolve(wt);
  const rootReal = deps.canonicalRealpath(root);
  if (typeof rootReal !== 'string') return true;
  let current = path.dirname(absoluteIn(root, p));
  let type = deps.lstatType(current).type;
  while (type === 'missing' && current !== root) {
    const up = path.dirname(current);
    if (up === current) break;
    current = up;
    type = deps.lstatType(current).type;
  }
  if (type !== 'directory') return true;
  const real = deps.canonicalRealpath(current);
  return typeof real !== 'string' || !isAncestorOrSelf(rootReal, real);
}

// test(p, { wt, sensitivePaths, deps }) is true when p violates the rule.
const PATH_RULES = Object.freeze([
  { name: 'empty-or-too-long', test: (p) => typeof p !== 'string' || p === '' || p.length > EVIDENCE_PATH_MAX_CHARS },
  { name: 'absolute-or-scheme', test: (p) => /^\//.test(p) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(p) },
  { name: 'backslash', test: (p) => p.includes('\\') },
  { name: 'percent-encoded', test: (p) => /%(2e|2f|5c)/i.test(p) },
  { name: 'dot-segment-or-not-normal', test: (p) => p.split('/').some((s) => s === '.' || s === '..') || path.posix.normalize(p) !== p },
  { name: 'trailing-slash', test: (p) => p.endsWith('/') },
  { name: 'flag-shaped', test: (p) => p.startsWith('-') },
  { name: 'git-segment', test: (p) => p.split('/').some((s) => s.toLowerCase() === '.git') },
  { name: 'not-test-path', test: (p) => !classifyPath(p, []).isTest },
  {
    name: 'protected-or-sensitive',
    // A sensitive-path setting that is not a list fails closed.
    test: (p, { sensitivePaths = [] }) => !Array.isArray(sensitivePaths) || isProtectedPath(p) || classifyPath(p, sensitivePaths).isSensitive,
  },
  { name: 'exists', test: (p, { wt, deps }) => deps.lstatType(absoluteIn(wt, p)).type !== 'missing' },
  { name: 'parent-escapes', test: parentEscapes },
].map(Object.freeze));

// The first violated rule's name, or null when the path may be written.
function pathRuleViolation(p, opts) {
  const rule = PATH_RULES.find((r) => r.test(p, opts));
  return rule ? rule.name : null;
}

module.exports = {
  MAX_FINDINGS,
  EVIDENCE_PATH_MAX_CHARS,
  EVIDENCE_CONTENT_MAX_BYTES,
  EVIDENCE_RUN_TIMEOUT_MS,
  EVENT_TEXT_MAX_CHARS,
  DIFF_PROMPT_MAX_BYTES,
  EVIDENCE_COMMANDS,
  evidenceArgs,
  classifyEvidenceRun,
  reviewRequired,
  findingShapeViolation,
  evidenceShapeViolation,
  contentViolation,
  PATH_RULES,
  pathRuleViolation,
};
