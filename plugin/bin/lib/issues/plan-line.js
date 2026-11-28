// plugin/bin/lib/issues/plan-line.js — the `Plan:` record-body line and the spec hash (#6052).
//
// Grammar, one line, single-space separated:
//   Plan: refs/claude-tweaks/plans/{n} {plan-commit-sha} spec-sha256:{hash}
// composePlanLine is the one composer; parsePlanLine is the one reader of a `--line`
// value (the line rides in the record body, not in facets). The commit is 40 or 64
// lowercase hex (sha1 or sha256 repos), the hash 64 lowercase hex. parsePlanLine
// strips trailing space/tab/CR, then names the first failing part: 'not-plan-line'
// (any spelling other than a leading `Plan: `), 'shape' (not exactly three
// single-space tokens), 'bad-ref', 'bad-commit', 'bad-hash'.
//
// specHash(text): sha256 over the `##` sections from `## Overview` through
// `## Planning Decisions` (with none, through the last `##` section), in body
// order; sections after Planning Decisions (e.g. `## Original request`) are not
// covered. Headings inside a fence do not count. Metadata lines are excluded by
// exact prefix (SPEC_HASH_EXCLUDED_PREFIXES), `Blocked by` dependency lines, the
// `Plan:` line itself and the work-fingerprint markers, so an edited content line
// is always hashed: the direction that fails toward a re-plan. Normalization:
// CRLF to LF, trailing whitespace stripped per line, one final newline. A spec
// with no unfenced `## Overview` throws code SPEC_NO_OVERVIEW rather than hash
// empty text.
'use strict';

const crypto = require('node:crypto');
const { PLAN_REF_PREFIX, planRefName, parsePlanRefName } = require('../plan-store/ref');
const { fencedLineMask } = require('../markdown-blocks');
const { FP_RE_WORK, FP_RE_WORK_PLAIN } = require('./record-fingerprint');
const { RISK_FLAG_LINE_KEYS } = require('./record-risk-flags');
const { isBlockerLine } = require('./blocker-lines');

// The ten prefixes, the preamble metadata lines spec #6052 Deliverable 3 enumerates: lines other
// pipeline steps write or rewrite on the record (facets, cross-links, risk flags, acceptance target)
// without changing what the spec asks to build, so editing one alone does not invalidate a reviewed
// plan. A line not listed here is hashed; a new metadata line joins this list only when the spec
// says so, since adding a prefix is the change that could hide a real content edit. The three Risk-flags keys come from record-risk-flags.js's
// RISK_FLAG_LINE_KEYS; record-risk-flags.test.js feeds each key through that module's own
// readers, so a key the readers stop recognizing fails there rather than drifting here.
const SPEC_HASH_EXCLUDED_PREFIXES = [
  'Surface:', 'Design-intent:', 'Ui-stack:', 'Visual-reference:', 'Parent:',
  ...RISK_FLAG_LINE_KEYS,
  'Acceptance-target:', '**Related:**',
];

const COMMIT_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const HASH_TOKEN_PREFIX = 'spec-sha256:';

function composePlanLine({ record, commit, specHash: hash } = {}) {
  const ref = planRefName(record); // TypeError on a bad record
  if (typeof commit !== 'string' || !COMMIT_RE.test(commit)) {
    throw new TypeError(`composePlanLine: commit must be 40 or 64 lowercase hex, got ${String(commit)}`);
  }
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) {
    throw new TypeError(`composePlanLine: specHash must be 64 lowercase hex, got ${String(hash)}`);
  }
  return `Plan: ${ref} ${commit} ${HASH_TOKEN_PREFIX}${hash}`;
}

function parsePlanLine(line) {
  if (typeof line !== 'string') return { ok: false, reason: 'not-plan-line' };
  const text = line.replace(/[ \t\r]+$/, '');
  if (text.startsWith('Plan:') && !text.startsWith('Plan: ')) return { ok: false, reason: 'shape' };
  if (!text.startsWith('Plan: ')) return { ok: false, reason: 'not-plan-line' };
  const tokens = text.slice('Plan: '.length).split(' ');
  if (tokens.length !== 3 || tokens.some((t) => t === '')) return { ok: false, reason: 'shape' };
  const [ref, commit, hashTok] = tokens;
  const record = parsePlanRefName(ref);
  if (record === null) return { ok: false, reason: 'bad-ref' };
  if (!COMMIT_RE.test(commit)) return { ok: false, reason: 'bad-commit' };
  if (!hashTok.startsWith(HASH_TOKEN_PREFIX) || !HASH_RE.test(hashTok.slice(HASH_TOKEN_PREFIX.length))) {
    return { ok: false, reason: 'bad-hash' };
  }
  return { ok: true, record, ref: `${PLAN_REF_PREFIX}${record}`, commit, specHash: hashTok.slice(HASH_TOKEN_PREFIX.length) };
}

function excluded(line) {
  return SPEC_HASH_EXCLUDED_PREFIXES.some((p) => line.startsWith(p))
    || isBlockerLine(line)
    || parsePlanLine(line).ok
    || FP_RE_WORK.test(line)
    || FP_RE_WORK_PLAIN.test(line);
}

function specHash(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const mask = fencedLineMask(lines);
  const heads = [];
  for (let i = 0; i < lines.length; i += 1) if (!mask[i] && /^## /.test(lines[i])) heads.push(i);
  const start = heads.find((i) => lines[i].trimEnd() === '## Overview');
  if (start === undefined) {
    const err = new Error('specHash: the spec has no `## Overview` section');
    err.code = 'SPEC_NO_OVERVIEW';
    throw err;
  }
  const pd = heads.find((i) => i > start && lines[i].trimEnd() === '## Planning Decisions');
  let end = lines.length;
  if (pd !== undefined) {
    const next = heads.find((i) => i > pd);
    if (next !== undefined) end = next;
  }
  const kept = [];
  for (let i = start; i < end; i += 1) {
    if (!mask[i] && excluded(lines[i])) continue;
    kept.push(lines[i].replace(/[ \t]+$/, ''));
  }
  const body = `${kept.join('\n').replace(/\n+$/, '')}\n`;
  return crypto.createHash('sha256').update(body, 'utf8').digest('hex');
}

module.exports = { composePlanLine, parsePlanLine, specHash, SPEC_HASH_EXCLUDED_PREFIXES, COMMIT_RE };
