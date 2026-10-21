// bin/lib/reconcile/ledger-residue.js — convergence check: a run's open-items
// ledger (`docs/plans/{name}-ledger.md`) that has reached the INTEGRATION
// BRANCH. The ledger is pipeline bookkeeping the run's own teardown deletes
// (single-spec cleanup item 2, multi-spec Shared teardown step 0); it is
// supposed to land nowhere. It still reaches the integration branch whenever
// the run's PR is merged before that teardown runs — by a human, by the fleet,
// by a later session — because a delete step inside the run cannot cover a
// merge made outside it (#3812; the teardown reorderings #3420 and #3595 closed
// the in-run window only). This check converges the leftover: it opens a PR
// that removes the residue.
//
// Residue is defined on the integration branch alone: a direct
// `docs/plans/*-ledger.md` entry at origin/{integration}'s tip. An in-flight
// run's branch legitimately carries its ledger until teardown, so nothing but
// the integration tip is ever read.
//
// Write posture: a NEW ref plus a PR — never a push to the integration branch,
// never a force or lease (the family never pushes there). The removal commit is
// built with plumbing on a scratch index, so the checkout's index, HEAD and
// working tree are untouched. The branch name is derived from the residue set
// (removalBranchName), so a rerun finds its own earlier PR: open -> skip,
// closed unmerged -> declined and never re-proposed, a changed set -> a new
// branch. FETCHES FIRST (unless `skipFetch`, reconcile()'s shared fetch): a
// stale origin/{integration} would flag a ledger a merged removal PR already
// deleted. A fetch failure skips the WHOLE check (`fetch-failed`) — fail
// closed. Pure decision function with I/O at the edges, matching the family;
// see docs/reconcile-checks.md's Ledger residue section.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { DEFAULT_TIMEOUT_MS } = require('../hooks/git-exec');
const { classifyGhApiError } = require('../issues/claim-store');
const { resolvePrState } = require('./pr-state');
const { defaultRefExists } = require('./prune-remote');

// Carried in the PR body so a human or later tooling can recognise the PR.
const LEDGER_RESIDUE_MARKER = '<!-- ledger-residue-pr -->';

const LEDGER_PATH_RE = /^docs\/plans\/[^/]+-ledger\.md$/;
const PR_CREATE_TIMEOUT_MS = 30000;

// NUL-separated `git ls-tree --name-only -z` output -> the sorted residue paths.
// Pure. Only direct children of docs/plans/ whose name ends `-ledger.md`.
function residueLedgerPaths(lsTreeZ) {
  return String(lsTreeZ || '')
    .split('\0')
    .filter((p) => LEDGER_PATH_RE.test(p))
    .sort();
}

// The deterministic branch for one residue set — order-independent, so the same
// set always maps to the same branch (and so the same PR).
function removalBranchName(paths) {
  const key = paths.slice().sort().join('\n');
  return `build/ledger-residue-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 8)}`;
}

// Evidence -> what to do. Pure — no I/O.
//   { action: 'none' | 'skip' | 'open', reason, push }
// prState is the governing PR for the removal branch (an object), null, or the
// strings 'gh-absent' / 'network-failure'; refExists is whether the removal
// branch is already on origin (true / false / null = indeterminate).
function decideLedgerResidue({ paths, prState, refExists, dryRun }) {
  if (!paths || paths.length === 0) return { action: 'none', reason: null, push: false };
  if (prState === 'gh-absent' || prState === 'network-failure') {
    return { action: 'skip', reason: prState, push: false }; // evidence unknown — fail closed
  }
  if (prState && typeof prState === 'object') {
    if (prState.state === 'OPEN') return { action: 'skip', reason: 'removal-pr-open', push: false };
    if (prState.state === 'MERGED') return { action: 'skip', reason: 'removal-pr-merged', push: false };
    return { action: 'skip', reason: 'removal-pr-declined', push: false }; // closed unmerged — never re-proposed
  }
  if (refExists === null) return { action: 'skip', reason: 'ref-check-failed', push: false };
  if (dryRun) return { action: 'skip', reason: 'dry-run', push: false };
  return { action: 'open', reason: null, push: !refExists };
}

function makeDefaultGit(root) {
  return (args, opts = {}) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: DEFAULT_TIMEOUT_MS, windowsHide: true, ...opts,
  });
}

// -> { number, url }, or 'gh-absent' / 'network-failure'.
function defaultCreatePr({ root, base, head, title, body }) {
  try {
    const stdout = execFileSync(
      'gh',
      ['pr', 'create', '--base', base, '--head', head, '--title', title, '--body', body],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: PR_CREATE_TIMEOUT_MS, windowsHide: true },
    );
    const url = stdout.split('\n').map((l) => l.trim()).filter(Boolean).pop() || '';
    const number = Number(url.split('/').pop());
    if (!Number.isInteger(number) || number <= 0) return 'network-failure';
    return { number, url };
  } catch (e) {
    return classifyGhApiError(e).failure === 'gh-absent' ? 'gh-absent' : 'network-failure';
  }
}

function prTitle(paths) {
  const n = paths.length;
  return `Remove ${n} residue ledger${n === 1 ? '' : 's'} from docs/plans`;
}

function prBody(paths) {
  return [
    LEDGER_RESIDUE_MARKER,
    '',
    'These pipeline ledgers reached the integration branch through PRs merged before their run\'s teardown deleted them.',
    '',
    ...paths.map((p) => `- \`${p}\``),
    '',
    'Opened by the reconcile `ledger-residue` check; see `docs/reconcile-checks.md`.',
  ].join('\n');
}

// Builds and pushes the removal commit (parent = the integration tip) to
// refs/heads/{branch}. -> null on success, else 'commit-failed' / 'push-failed'.
function pushRemovalCommit({ git, tip, paths, branch }) {
  const scratchIndex = path.join(os.tmpdir(), `ledger-residue-index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const env = { ...process.env, GIT_INDEX_FILE: scratchIndex };
  let commit;
  try {
    git(['read-tree', tip], { env });
    git(['update-index', '--force-remove', '--', ...paths], { env });
    const tree = git(['write-tree'], { env }).trim();
    commit = git(['commit-tree', tree, '-p', tip, '-m', 'Remove residue pipeline ledgers from docs/plans — reconcile ledger-residue check'], { env }).trim();
  } catch {
    return 'commit-failed';
  } finally {
    try {
      fs.rmSync(scratchIndex, { force: true });
    } catch {
      /* best-effort cleanup — never mask the write's own outcome */
    }
  }
  try {
    git(['push', 'origin', `${commit}:refs/heads/${branch}`]);
  } catch {
    return 'push-failed';
  }
  return null;
}

function ledgerResidue({
  cwd, integration, dryRun, skipFetch, resolvePr, refExists, createPr, git,
} = {}) {
  const root = cwd || process.cwd();
  const run = git || makeDefaultGit(root);
  const resolve = resolvePr || resolvePrState;
  const checkRefExists = refExists || ((r, b) => defaultRefExists(r, b, DEFAULT_TIMEOUT_MS));
  const open = createPr || defaultCreatePr;

  if (!skipFetch) {
    try {
      run(['fetch', 'origin', integration]);
    } catch {
      return { entries: [], failure: 'fetch-failed' };
    }
  }

  let tip;
  let paths;
  try {
    tip = run(['rev-parse', '--verify', `origin/${integration}^{commit}`]).trim();
    paths = residueLedgerPaths(run(['ls-tree', '--name-only', '-z', tip, '--', 'docs/plans/']));
  } catch {
    return { entries: [], failure: 'git-failure' };
  }
  if (paths.length === 0) return { entries: [], failure: null };

  const branch = removalBranchName(paths);
  const prState = resolve(root, branch, { preferOpen: true });
  const exists = prState === null ? checkRefExists(root, branch) : null;
  const decision = decideLedgerResidue({ paths, prState, refExists: exists, dryRun });

  const prNumber = prState && typeof prState === 'object' ? prState.number : undefined;
  const skipEntries = (reason) => paths.map((p) => {
    const entry = { path: p, kind: 'ledger', action: 'skip', reason, branch };
    if (prNumber !== undefined) entry.prNumber = prNumber;
    return entry;
  });

  if (decision.action === 'skip') return { entries: skipEntries(decision.reason), failure: null };
  if (decision.action === 'none') return { entries: [], failure: null };

  if (decision.push) {
    const failed = pushRemovalCommit({ git: run, tip, paths, branch });
    if (failed) return { entries: skipEntries(failed), failure: null };
  }

  const created = open({
    root, base: integration, head: branch, title: prTitle(paths), body: prBody(paths),
  });
  if (!created || typeof created !== 'object') return { entries: skipEntries('pr-create-failed'), failure: null };
  return {
    entries: paths.map((p) => ({
      path: p, kind: 'ledger', action: 'pr-opened', reason: 'removal-pr-opened', branch, prNumber: created.number, prUrl: created.url,
    })),
    failure: null,
  };
}

module.exports = {
  LEDGER_RESIDUE_MARKER, residueLedgerPaths, removalBranchName, decideLedgerResidue, ledgerResidue,
};
