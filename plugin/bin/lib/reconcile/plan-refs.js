// bin/lib/reconcile/plan-refs.js — convergence check: delete the plan ref
// `refs/claude-tweaks/plans/{n}` on origin once record {n} is CLOSED (#6055).
// A plan ref is shared state on origin, and a pushed deletion is unrecoverable
// from this checkout, so the evidence bar is strict: the ref name must parse as
// an exact positive integer (parsePlanRefName), the record's state comes from a
// fresh aliased GraphQL batch made in this same call immediately before the
// pushes, and only a PROVEN `CLOSED` deletes — an open record, a PR number, a
// missing issue, a truncated or errored chunk all keep the ref. Each delete
// leases on the sha `ls-remote` observed (`--force-with-lease=<ref>:<sha>`), so
// a plan re-written between the listing and the push survives (the push is
// rejected as stale and reported `delete-failed`).
//
// Never throws: every outcome is an entry, or a `failure` string when the whole
// check could not run. Under `work-backend: local-files` there are no GitHub
// records to be closed, so the check ends `local-files-backend`. gh may be
// absent (local-merge runs no gh preflight): `gh-absent`, no push.
'use strict';
const { execFileSyncTimed } = require('./timing');
const shared = require('../shared-primitives');
const { readWorkBackend } = require('../work-backend');
const { gateOriginRepo, ghOptions } = require('../repo-resolve');
const { repoPinnedEnv } = require('../hooks/git-exec');
const { PLAN_REF_PREFIX, DEFAULT_REMOTE, parsePlanRefName } = require('../plan-store/ref');

const PLAN_REFS_BATCH_CHUNK = 50; // aliases per query — one rate-limit point

const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/; // a non-hex sha is never leased on or pushed
const POSITIVE_INTEGER_RE = /^[1-9]\d*$/;
const toRecord = (n) => (typeof n === 'number' && Number.isSafeInteger(n) && POSITIVE_INTEGER_RE.test(String(n)) ? n : null);

// Pure. ls-remote stdout -> one entry per distinct exact-integer plan ref, sorted by record.
function listPlanRefs(lsRemoteStdout) {
  const byRecord = new Map();
  for (const raw of String(lsRemoteStdout || '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const sha = line.slice(0, tab).trim();
    const ref = line.slice(tab + 1).trim();
    const record = parsePlanRefName(ref);
    if (record === null || !SHA_RE.test(sha) || byRecord.has(record)) continue;
    byRecord.set(record, { ref, record, sha });
  }
  return [...byRecord.values()].sort((a, b) => a.record - b.record);
}

// Pure. `records` become `i{index}` issue aliases; a non-positive-integer record is omitted.
function buildIssueStateQuery(records) {
  const fields = [];
  (records || []).forEach((r, i) => {
    const n = toRecord(r);
    if (n !== null) fields.push(`i${i}: issue(number:${n}){ number state }`);
  });
  return `query($owner:String!,$name:String!){\n  repository(owner:$owner,name:$name){\n    ${fields.join('\n    ')}\n  }\n}`;
}

// Pure. -> Map<number, 'OPEN'|'CLOSED'>, only proven answers. An error that is not a
// NOT_FOUND on one of this query's own aliases poisons the whole chunk (empty Map).
function parseIssueStateResponse(stdout, records) {
  const out = new Map();
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return out;
  }
  const repo = parsed && parsed.data && parsed.data.repository;
  if (!repo || typeof repo !== 'object') return out;
  const aliases = new Set((records || []).map((_, i) => `i${i}`));
  if (parsed.errors !== undefined) {
    if (!Array.isArray(parsed.errors)) return out;
    for (const e of parsed.errors) {
      const own = e && e.type === 'NOT_FOUND' && Array.isArray(e.path) && e.path.length === 2
        && e.path[0] === 'repository' && aliases.has(e.path[1]);
      if (!own) return out;
    }
  }
  (records || []).forEach((r, i) => {
    const n = toRecord(r);
    const node = repo[`i${i}`];
    if (n === null || !node || typeof node !== 'object' || node.number !== n) return;
    if (node.state === 'OPEN' || node.state === 'CLOSED') out.set(n, node.state);
  });
  return out;
}

// Pure. Only a proven CLOSED deletes.
function decidePlanRef({ state } = {}) {
  if (state === 'CLOSED') return { action: 'delete', reason: 'record-closed' };
  if (state === 'OPEN') return { action: 'skip', reason: 'record-open' };
  return { action: 'skip', reason: 'state-unreadable' };
}

function defaultGit(root) {
  return (args) => execFileSyncTimed('git', ['-C', root, ...args], {
    cwd: root, env: repoPinnedEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: shared.GIT_TIMEOUT_MS, windowsHide: true,
  });
}

function defaultGh(root) {
  return (args) => execFileSyncTimed('gh', args, ghOptions(args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: shared.GH_TIMEOUT_MS, windowsHide: true,
  }));
}

// The rejection reason from git push stderr: its first `!`/`error:`/`fatal:` line (the leading
// `To <remote-url>` line is not the reason), else the first non-empty line.
function firstLine(err) {
  const text = (err && err.stderr != null ? String(err.stderr) : '') || (err && err.message) || 'push failed';
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => /^(?:!|error:|fatal:)/.test(l)) || lines[0] || 'push failed';
}

function planRefs({ cwd, dryRun, git, gh, readBackend } = {}) {
  try {
    const root = cwd || process.cwd();
    const runGit = git || defaultGit(root);
    const runGh = gh || defaultGh(root);
    const backend = (readBackend || readWorkBackend)(root);
    if (backend === 'local-files') return { entries: [], failure: 'local-files-backend' };

    let listing;
    try {
      listing = runGit(['ls-remote', DEFAULT_REMOTE, `${PLAN_REF_PREFIX}*`]); // git-path-read: not a path list (ref names)
    } catch {
      return { entries: [], failure: 'ls-remote-failed' };
    }
    const refs = listPlanRefs(listing);
    if (refs.length === 0) return { entries: [], failure: null };

    let origin = null;
    try {
      origin = gateOriginRepo(String(runGit(['remote', 'get-url', DEFAULT_REMOTE])).trim()).spec; // a refused or unparsed host: no spec
    } catch {
      origin = null;
    }
    if (!origin) return { entries: [], failure: 'origin-unresolvable' };

    const states = new Map();
    for (let at = 0; at < refs.length; at += PLAN_REFS_BATCH_CHUNK) {
      const records = refs.slice(at, at + PLAN_REFS_BATCH_CHUNK).map((r) => r.record);
      let stdout;
      try {
        // -f, never -F: String! variables must not be type-coerced
        stdout = runGh(['api', 'graphql', '--hostname', origin.host, '-f', `owner=${origin.owner}`, '-f', `name=${origin.repo}`, '-f', `query=${buildIssueStateQuery(records)}`]);
      } catch (e) {
        if (e && e.code === 'ENOENT') return { entries: [], failure: 'gh-absent' };
        stdout = e && typeof e.stdout === 'string' ? e.stdout : '';
      }
      for (const [k, v] of parseIssueStateResponse(stdout, records)) states.set(k, v);
    }

    const entries = [];
    for (const { ref, record, sha } of refs) {
      const verdict = decidePlanRef({ record, state: states.get(record) });
      if (verdict.action !== 'delete') {
        entries.push({ ref, record, action: 'skip', reason: verdict.reason });
      } else if (dryRun) {
        entries.push({ ref, record, action: 'would-delete', reason: verdict.reason });
      } else {
        try {
          runGit(['push', `--force-with-lease=${ref}:${sha}`, DEFAULT_REMOTE, `:${ref}`]);
          entries.push({ ref, record, action: 'delete', reason: verdict.reason });
        } catch (e) {
          entries.push({ ref, record, action: 'skip', reason: 'delete-failed', detail: firstLine(e) });
        }
      }
    }
    return { entries, failure: null };
  } catch {
    return { entries: [], failure: 'unexpected-error' };
  }
}

module.exports = {
  PLAN_REFS_BATCH_CHUNK, listPlanRefs, buildIssueStateQuery, parseIssueStateResponse, decidePlanRef, planRefs,
};
