'use strict';

// #6119: the `driver-lane` queue-pull pass core. Under `express-driver-runner: script`, a script job
// (drive.js --budget) drains driver-routable records, so the session drain leaves them alone: this
// module returns the `driver-lane` exclusion entries for them. It is pure over its inputs (policy,
// runner, comment reader, stderr); queue-pull.js wires it as a PASSES row and the retained fence
// (queue-pull-script.md) mirrors it through runFromFiles.
//
// Starvation risk: a record `driverRoutable` accepts from pulled data but the driver refuses on its
// live fetch would sit excluded from the session drain while the driver keeps refusing it. The
// live-fetch audit below is the deliverable that closes that. The driver's eligibility step reads
// only `number,title,body,labels,state` and the policy, all of which the pulled data carries; the
// admission step's live-only facts are blockers, linked PRs, state and comments, and only comments
// are not covered by another queue-pull pass. So one live check exists here: the trusted driver
// escalation marker, read in one batched call. Two refusals sit outside the three registries:
// eligibility's `['not eligible']` fallback (steps.js; reachable only for a verdict with no
// reasons, which evaluateRecordEligibility never returns when `eligible` is false), admission's
// `['not admitted']` fallback (steps.js; unreachable, since evaluateAdmission sets
// `admitted = reasons.length === 0`), and the reviewer reason eligibility appends
// (`reviewerGateReason`, decided by the predicate from pulled data).
// `REASONS.escalated` is classed `driverRoutable` because `eligibilityOptions` never sets
// `escalated`, so the same options refuse it identically on both sides.
//
// Classes: 'driverRoutable' = decided from pulled data by the predicate; 'pull' = another
// queue-pull filter or pass genuinely removes the record first (the eligibility filter for grants,
// `bot:*` labels and open state; the `open-pr` pass for a linked PR it read); 'self-clearing' = a
// refusal only the live fetch can raise that ends without anyone acting (an unreadable fact reads
// fine on a later fetch, or the open blocker closes and releases the hold), so an excluded record
// is never starved by it: blocker and linked-PR facts are not reliably filtered by the pull (a
// failed linked-PR query keeps the record; native blockers are read only under work-links: native,
// while the driver always reads native dependencies); 'live-check' = this pass's marker read.
//
// Do not require ../dispatch/queue-pull at top level: express/queue.js documents a require cycle
// (budget.js requires queue-pull), and the driver modules are required lazily below.

const path = require('path');
const { spawnSync } = require('child_process');
const { hasDriverEscalationMarker } = require('../driver/settle');

const BIN_DIR = path.join(__dirname, '..', '..');
// The same bound as queue-pull.js's CLI_TIMEOUT_MS (not imported: a require cycle, see above).
const CLI_TIMEOUT_MS = 300000 + 5000;
const MAX_BUFFER = 64 * 1024 * 1024;

// Explicit, not derived from the registries: a refusal added later is unclassified here until someone
// audits it, and tests/bin-lib/dispatch/driver-lane.test.js (AC8.1) goes red until they do.
const LIVE_FETCH_AUDIT = Object.freeze({
  noBuildGrant: 'pull',
  parked: 'pull',
  blocked: 'pull',
  openBlocker: 'self-clearing',
  openPR: 'pull',
  notOpen: 'pull',
  blockerFactsUnreadable: 'self-clearing',
  prFactsUnreadable: 'self-clearing',
  stateUnreadable: 'self-clearing',
  labelsUnreadable: 'self-clearing',
  routingOff: 'driverRoutable',
  splitOdd: 'driverRoutable',
  splitUnreadable: 'driverRoutable',
  escalatedByDriver: 'live-check',
  commentsUnreadable: 'live-check',
  routingUnknown: 'driverRoutable',
  reviewerOff: 'driverRoutable',
  reviewerOffWidened: 'driverRoutable',
  reviewerUnreadable: 'driverRoutable',
  widenedUnreadable: 'driverRoutable',
  boundsUnreadable: 'driverRoutable',
  keyFilesUnreadable: 'driverRoutable',
  disabled: 'driverRoutable',
  invalidValue: 'driverRoutable',
  notPrFirst: 'driverRoutable',
  risk: 'driverRoutable',
  size: 'driverRoutable',
  ceremony: 'driverRoutable',
  type: 'driverRoutable',
  mergePending: 'driverRoutable',
  noKeyFiles: 'driverRoutable',
  tooManyKeyFiles: 'driverRoutable',
  frontend: 'driverRoutable',
  notShaped: 'driverRoutable',
  escalated: 'driverRoutable',
  riskFlags: 'driverRoutable',
  protectedPath: 'driverRoutable',
  sensitivePath: 'driverRoutable',
  riskCeilingUnreadable: 'driverRoutable',
  sizeCeilingUnreadable: 'driverRoutable',
  keyFileLimitUnreadable: 'driverRoutable',
});

const errText = (err) => (err && err.message) || String(err);

function readDriverRunner({ resolvePolicy, stderr = process.stderr } = {}) {
  try {
    const resolve = resolvePolicy || require('../express/policy').defaultResolvePolicy;
    const entry = resolve(['express-driver-runner'], { runDir: null })['express-driver-runner'];
    return entry && entry.value === 'script' && entry.invalid !== true ? 'script' : 'session';
  } catch (err) {
    stderr.write(`Warning: express-driver-runner unreadable — treated as session this pull: ${errText(err)}\n`);
    return 'session';
  }
}

function driverLaneExclusions({ groups, policy, runner, readComments, stderr = process.stderr }) {
  if (runner !== 'script') return [];
  if (policy.routing === 'off') {
    stderr.write('express-driver-runner: script ignored while express-driver is off; driver-routable records stay with the session drain\n');
    return [];
  }
  if (!policy.driverOn) {
    stderr.write('Warning: driver-lane: the driver predicate is unavailable this pull — no driver-lane exclusions\n');
    return [];
  }
  const candidates = [];
  for (const g of groups) {
    if (Array.isArray(g) && g.length === 1 && policy.driverRoutable(g[0])) candidates.push(g[0].number);
  }
  if (candidates.length === 0) return [];
  let read;
  try { read = readComments(candidates); } catch (err) { read = { ok: false, cause: errText(err) }; }
  if (!read || read.ok !== true) {
    const cause = (read && read.cause) || 'no result';
    stderr.write(`Warning: driver-lane comment read failed — no driver-lane exclusions this pull: ${cause}\n`);
    return [];
  }
  const entries = [];
  for (const n of candidates) {
    const rec = read.byNumber && read.byNumber[n];
    if (!rec || rec.complete !== true || !Array.isArray(rec.comments)) continue;
    if (hasDriverEscalationMarker(rec.comments) !== false) continue;
    entries.push({ reason: 'driver-lane', records: [n], detail: { runner: 'script' } });
  }
  if (entries.length > 0) stderr.write(`driver-lane: left to the script job: ${entries.map((e) => `#${e.records[0]}`).join(', ')}\n`);
  return entries;
}

function spawnCommentReader({ spawnCli, cwd, env }) {
  return (numbers) => {
    let r;
    try {
      r = spawnCli('resolve-record-comments.js', [numbers.join(',')], { cwd, env });
    } catch (err) {
      return { ok: false, cause: errText(err) };
    }
    if (!r || r.status !== 0) {
      const detail = String((r && r.stderr) || '').trim().split('\n')[0];
      return { ok: false, cause: detail || `resolve-record-comments.js exited ${r && r.status}` };
    }
    try {
      const parsed = JSON.parse(r.stdout);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, cause: 'unparseable comment read output' };
      return { ok: true, byNumber: parsed };
    } catch (err) {
      return { ok: false, cause: `unparseable comment read output: ${errText(err)}` };
    }
  };
}

function realSpawnCli(name, args, { cwd, env } = {}) {
  const r = spawnSync(process.execPath, [path.join(BIN_DIR, name), ...args], { encoding: 'utf8', cwd, env, timeout: CLI_TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true });
  if (r.error) return { status: null, stdout: '', stderr: errText(r.error) };
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// The retained fence's entry: real policy, real spawn, one appendExclusion per entry.
function runFromFiles({ groupsPath, exclusionsPath, transport, stderr = process.stderr, deps = {} }) {
  const fs = require('fs');
  const { appendExclusion } = require('./exclusions');
  const { expressQueuePolicy } = require('../express/queue');
  const runner = readDriverRunner({ resolvePolicy: deps.resolvePolicy, stderr });
  if (runner !== 'script') return [];
  const groups = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
  const policy = expressQueuePolicy({ resolvePolicy: deps.resolvePolicy, stderr: (s) => stderr.write(s) });
  const readComments = transport === 'files'
    ? () => ({ ok: false, cause: 'comment read unavailable on the files transport' })
    : spawnCommentReader({ spawnCli: deps.spawnCli || realSpawnCli, cwd: process.cwd(), env: process.env });
  const entries = driverLaneExclusions({ groups, policy, runner, readComments, stderr });
  for (const e of entries) appendExclusion(exclusionsPath, e);
  return entries;
}

module.exports = { readDriverRunner, driverLaneExclusions, spawnCommentReader, runFromFiles, LIVE_FETCH_AUDIT };
