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
// Removable residue follows tidy's orphan-ledger rule
// (skills/tidy/scan-procedures.md): each candidate's blob is read at the tip
// and kept (a per-path skip) unless it carries the ledger signature
// (`not-a-ledger`), has no `open` row (`ledger-has-open-rows`) and no
// unrecognized status (`ledger-status-unrecognized`) — parsed by
// wrap-up/pack.js's parseLedger — and no non-archived run directory under
// {root}/.claude-tweaks/pipelines/ is attributed to it (`run-live`):
// attribution reads every `#{N}` token on the ledger's first line, matched as
// a whole dash-separated token of a run-dir name after its leading timestamp,
// else the filename's `{feature}` slug as a substring of the name. An open work
// record that references it keeps it (`referenced-by-open-record`, carrying the
// record numbers): its namedTarget path equals the ledger's path, or its body
// contains the ledger's filename or `{feature}` slug, as in tidy. The open-record
// list is read once per pass, and only when a ledger clears every earlier check.
// It comes from `gh issue list --state open`, or from `specs/` under
// `work-backend: local-files`. A failed read keeps every such ledger
// (`record-scan-failed`, or the classified `gh-absent` / `network-failure`).
// One deliberate difference from tidy: tidy deletes the ledger and closes the
// referencing records in one approved action, while this unattended check never
// closes a record, so it keeps the ledger and leaves it to `/claude-tweaks:tidy`.
// A ledger with unresolved items is reported but never deleted.
//
// Write posture: a NEW ref plus a PR — never a push to the integration branch,
// never a force or lease (the family never pushes there). The removal commit is
// built with plumbing on a scratch index, so the checkout's index, HEAD and
// working tree are untouched. PR state comes from ONE list of every PR whose
// head starts `build/ledger-residue-` (any state, heads enumerated by ref prefix
// with no recency window), not a lookup of the current branch only, so earlier
// PRs stay visible after the residue set changes: any OPEN one skips
// every path (`removal-pr-open`); a path a CLOSED-unmerged PR's body names is
// `removal-pr-declined` and never re-proposed; a path a MERGED PR's body names
// that is still present is `removal-merged-but-present`. The branch name hashes
// only the remaining removable set (removalBranchName). FETCHES FIRST (unless
// `skipFetch`, reconcile()'s shared fetch): a stale origin/{integration} would
// flag a ledger a merged removal PR already deleted. A fetch failure skips the
// WHOLE check (`fetch-failed`) — fail closed. Pure decision functions with I/O
// at the edges, matching the family; see docs/reconcile-checks.md's Ledger
// residue section.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { DEFAULT_TIMEOUT_MS } = require('../hooks/git-exec');
const { splitNul } = require('../git-z');
const sharedPrimitives = require('../shared-primitives');
const { classifyExecError } = require('./pr-state');
const { defaultRefExists } = require('./prune-remote');
const { namedTarget } = require('../issues/named-target');
const { queryRecords } = require('../issues/local-store');
const { readWorkBackend } = require('../work-backend');

// Carried in the PR body so a human or later tooling can recognise the PR.
const LEDGER_RESIDUE_MARKER = '<!-- ledger-residue-pr -->';

const BRANCH_PREFIX = 'build/ledger-residue-';
const LEDGER_PATH_RE = /^docs\/plans\/[^/]+-ledger\.md$/;
const LEDGER_HEADING_RE = /^# Open Items(?:\s|$)/;
const LEDGER_TABLE_HEADER_RE = /^\|\s*#\s*\|\s*Phase\s*\|\s*Item\s*\|\s*Status\s*\|\s*Resolution\s*\|\s*$/;
const RUN_DIR_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d+/;
const BODY_LEDGER_PATH_RE = /`(docs\/plans\/[^`/]+-ledger\.md)`/g;
const IDENTITY_UNSET_RE = /(?:Author|Committer) identity unknown/;

// Skip reasons the reconcile-background summary keeps quiet: expected states
// (a live run, a human's decline, a file that is not a ledger, a dry run) and
// transport failures the next pass retries. Every other reason — including any
// added later — surfaces at SessionStart.
const QUIET_SKIP_REASONS = new Set([
  'dry-run', 'run-live', 'not-a-ledger', 'removal-pr-declined', 'gh-absent', 'network-failure', 'ref-check-failed',
]);

// NUL-separated `git ls-tree --name-only -z` output -> the sorted residue paths.
// Pure. Only direct children of docs/plans/ whose name ends `-ledger.md`.
function residueLedgerPaths(lsTreeZ) {
  return splitNul(lsTreeZ)
    .filter((p) => LEDGER_PATH_RE.test(p))
    .sort();
}

// The deterministic branch for one removable set — order-independent, so the
// same set always maps to the same branch.
function removalBranchName(paths) {
  const key = paths.slice().sort().join('\n');
  return `${BRANCH_PREFIX}${crypto.createHash('sha1').update(key).digest('hex').slice(0, 8)}`;
}

// A filename's `{feature}` slug: `YYYY-MM-DD-{feature}-ledger.md` -> `{feature}`;
// a name without the date prefix keeps its whole stem.
function ledgerFeatureSlug(ledgerPath) {
  const stem = path.posix.basename(ledgerPath).replace(/-ledger\.md$/, '');
  const m = /^\d{4}-\d{2}-\d{2}-(.+)$/.exec(stem);
  return m ? m[1] : stem;
}

// Whether run-dir `name` names record `n`: a whole dash-separated token after
// the leading `YYYY-MM-DDT{time}` segment, so `21` never matches `2026-10-21T…`.
function runDirNamesNumber(name, n) {
  return name.replace(RUN_DIR_TIMESTAMP_RE, '').split('-').includes(String(n));
}

// tidy's live-run attribution. Pure. -> the matching run-dir name, or null.
function attributedRunDir(ledgerPath, text, runDirNames) {
  const firstLine = String(text).split(/\r?\n/)[0] || '';
  const numbers = [...firstLine.matchAll(/#(\d+)/g)].map((m) => m[1]);
  if (numbers.length > 0) {
    return runDirNames.find((name) => numbers.some((n) => runDirNamesNumber(name, n))) || null;
  }
  const slug = ledgerFeatureSlug(ledgerPath);
  return runDirNames.find((name) => name.includes(slug)) || null;
}

// The open records that reference a ledger, as ascending numbers. Pure. A record
// references it when namedTarget resolves its path to the ledger's, or when its
// body contains the ledger's filename (which covers the full path) or feature
// slug: tidy's referencing-record pass (skills/tidy/scan-procedures.md).
function referencingRecords(ledgerPath, records) {
  const basename = path.posix.basename(ledgerPath);
  const slug = ledgerFeatureSlug(ledgerPath);
  return records
    .filter((r) => {
      const target = namedTarget(r);
      if (target && target.path === ledgerPath) return true;
      return typeof r.body === 'string' && (r.body.includes(basename) || r.body.includes(slug));
    })
    .map((r) => r.number)
    .sort((a, b) => a - b);
}

// One candidate's blob -> the reason it is kept, or null when removable. Pure
// given its injected loader. text is the blob (null when it could not be read);
// runDirNames lists the non-archived run directories (null when the scan failed);
// loadOpenRecords is a zero-arg loader returning the open-record array,
// 'gh-absent' / 'network-failure', or null on any other failure. An omitted
// loader fails closed. The loader runs only after every earlier check has passed.
function classifyLedgerCandidate({ path: ledgerPath, text, runDirNames, loadOpenRecords }) {
  if (typeof text !== 'string') return 'ledger-read-failed';
  const lines = text.split(/\r?\n/);
  if (!LEDGER_HEADING_RE.test(lines[0] || '') || !lines.some((l) => LEDGER_TABLE_HEADER_RE.test(l))) return 'not-a-ledger';
  const { parseLedger } = require('../wrap-up/pack');
  const parsed = parseLedger(text);
  if (parsed.open > 0) return 'ledger-has-open-rows';
  if (parsed.unrecognized > 0) return 'ledger-status-unrecognized';
  if (!Array.isArray(runDirNames)) return 'run-dir-scan-failed';
  if (attributedRunDir(ledgerPath, text, runDirNames)) return 'run-live';
  const records = typeof loadOpenRecords === 'function' ? loadOpenRecords() : null;
  if (records === 'gh-absent' || records === 'network-failure') return records;
  if (!Array.isArray(records)) return 'record-scan-failed';
  if (referencingRecords(ledgerPath, records).length > 0) return 'referenced-by-open-record';
  return null;
}

function bodyLedgerPaths(body) {
  return new Set([...String(body || '').matchAll(BODY_LEDGER_PATH_RE)].map((m) => m[1]));
}

// Removable candidates x the removal-PR list -> { skips, removable }. Pure.
// removalPrs is an array of { number, state, headRefName, body }, or the
// strings 'gh-absent' / 'network-failure'.
function partitionByRemovalPrs(paths, removalPrs) {
  if (!Array.isArray(removalPrs)) {
    return { skips: paths.map((p) => ({ path: p, reason: removalPrs })), removable: [] };
  }
  const open = removalPrs.filter((pr) => pr.state === 'OPEN').sort((a, b) => b.number - a.number)[0];
  if (open) {
    return { skips: paths.map((p) => ({ path: p, reason: 'removal-pr-open', prNumber: open.number })), removable: [] };
  }
  const named = (state) => removalPrs.filter((pr) => pr.state === state).map((pr) => ({ pr, paths: bodyLedgerPaths(pr.body) }));
  const merged = named('MERGED');
  const closed = named('CLOSED');
  const skips = [];
  const removable = [];
  for (const p of paths) {
    const m = merged.find((x) => x.paths.has(p));
    const c = closed.find((x) => x.paths.has(p));
    if (m) skips.push({ path: p, reason: 'removal-merged-but-present', prNumber: m.pr.number });
    else if (c) skips.push({ path: p, reason: 'removal-pr-declined', prNumber: c.pr.number });
    else removable.push(p);
  }
  return { skips, removable };
}

// Evidence -> what to do. Pure — no I/O.
//   { action: 'none' | 'skip' | 'open', reason, push, skips, removable, branch }
// skips are the per-path PR-state skips; reason applies to the removable set.
// refExists is whether removalBranchName(removable) is already on origin
// (true / false / null = indeterminate).
function decideLedgerResidue({ paths, removalPrs, refExists, dryRun }) {
  const { skips, removable } = partitionByRemovalPrs(paths || [], removalPrs);
  const branch = removable.length > 0 ? removalBranchName(removable) : null;
  const base = { skips, removable, branch, push: false };
  if (removable.length === 0) return { ...base, action: 'none', reason: null };
  if (refExists === null) return { ...base, action: 'skip', reason: 'ref-check-failed' };
  if (dryRun) return { ...base, action: 'skip', reason: 'dry-run' };
  return { ...base, action: 'open', reason: null, push: !refExists };
}

function makeDefaultGit(root) {
  return (args, opts = {}) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: DEFAULT_TIMEOUT_MS, windowsHide: true, ...opts,
  });
}

// Non-archived run directories directly under {root}/.claude-tweaks/pipelines/.
// An absent pipelines directory is no runs; any other read failure is null.
function defaultListRunDirs(root) {
  try {
    return fs.readdirSync(path.join(root, '.claude-tweaks', 'pipelines'), { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== 'archive')
      .map((d) => d.name);
  } catch (e) {
    return e && e.code === 'ENOENT' ? [] : null;
  }
}

// The open work records the reference scan reads, as { number, body, labels }:
// `specs/` under work-backend: local-files, else `gh issue list --state open`.
// -> the array, 'gh-absent' / 'network-failure' (github-issues), or null when a
// local read fails. `exec` is injectable for tests.
function defaultListOpenRecords(root, exec = execFileSync) {
  if (readWorkBackend(root) === 'local-files') {
    const specsDir = path.join(root, 'specs');
    try {
      // queryRecords reads a failed readdir as "no records"; only a missing specs/ may mean that.
      fs.readdirSync(specsDir);
    } catch (e) {
      return e && e.code === 'ENOENT' ? [] : null;
    }
    try {
      return queryRecords(specsDir).map((r) => ({
        number: r.id, body: r.body, labels: r.facets.origin ? [`by:${r.facets.origin}`] : [],
      }));
    } catch {
      return null;
    }
  }
  return sharedPrimitives.runClassified(
    () => {
      const issues = JSON.parse(exec('gh', ['issue', 'list', '--state', 'open', '--limit', '10000', '--json', 'number,body,labels'], {
        cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: sharedPrimitives.GH_TIMEOUT_MS, maxBuffer: sharedPrimitives.LARGE_MAX_BUFFER_BYTES, windowsHide: true,
      }));
      if (!Array.isArray(issues)) throw new Error('gh issue list returned a non-array');
      return issues;
    },
    classifyExecError,
    { retryOnTimeout: true },
  );
}

// Every PR whose head starts BRANCH_PREFIX, any state, with its body — or
// 'gh-absent' / 'network-failure'. Enumerates the removal heads by ref prefix
// (matching-refs), then lists each head's PRs, so a PR is found however old it
// is — no recency window. A merged removal PR's branch is deleted after merge,
// so only a surviving head is found. Any failing call fails the whole list.
// `exec` is injectable for tests.
function defaultListRemovalPrs(root, exec = execFileSync) {
  const opts = { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: sharedPrimitives.GH_TIMEOUT_MS, windowsHide: true };
  return sharedPrimitives.runClassified(
    () => {
      const refsOut = exec('gh', ['api', '--paginate', `repos/{owner}/{repo}/git/matching-refs/heads/${BRANCH_PREFIX}`, '--jq', '.[].ref'], opts);
      const heads = [...new Set(String(refsOut).split(/\r?\n/)
        .filter((ref) => ref.startsWith('refs/heads/'))
        .map((ref) => ref.slice('refs/heads/'.length))
        .filter((head) => head.startsWith(BRANCH_PREFIX)))];
      const byNumber = new Map();
      for (const head of heads) {
        const prs = JSON.parse(exec('gh', ['pr', 'list', '--head', head, '--state', 'all', '--json', 'number,state,headRefName,body,isCrossRepository'], opts));
        if (!Array.isArray(prs)) throw new Error('gh pr list returned a non-array');
        for (const pr of prs) {
          // `--head` matches the branch name alone, so a fork PR that reuses it is not ours: its body is not ours to trust.
          if (pr && pr.isCrossRepository !== true && typeof pr.headRefName === 'string' && pr.headRefName.startsWith(BRANCH_PREFIX)) byNumber.set(pr.number, pr);
        }
      }
      return [...byNumber.values()];
    },
    classifyExecError,
    { retryOnTimeout: true },
  );
}

// -> { number, url }, or 'gh-absent' / 'network-failure'. Never retried: a
// timed-out create may still have opened the PR. `exec` is injectable for tests.
function defaultCreatePr({ root, base, head, title, body }, exec = execFileSync) {
  try {
    const stdout = exec(
      'gh',
      ['pr', 'create', '--base', base, '--head', head, '--title', title, '--body', body],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: sharedPrimitives.GH_TIMEOUT_MS, windowsHide: true },
    );
    const url = String(stdout).split('\n').map((l) => l.trim()).filter(Boolean).pop() || '';
    const number = Number(url.split('/').pop());
    if (!Number.isInteger(number) || number <= 0) return 'network-failure';
    return { number, url };
  } catch (e) {
    return classifyExecError(e);
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
    'Each has no open row, no live run directory, and no open work record referencing it.',
    '',
    ...paths.map((p) => `- \`${p}\``),
    '',
    'Opened by the reconcile `ledger-residue` check; see `docs/reconcile-checks.md`.',
    'Closing this PR unmerged declines these paths: the check never proposes them again.',
  ].join('\n');
}

function isIdentityError(e) {
  const text = [e && e.message, e && e.stderr].filter(Boolean).map(String).join(' ');
  return IDENTITY_UNSET_RE.test(text);
}

// Builds and pushes the removal commit (parent = the integration tip) to
// refs/heads/{branch}. -> null on success, else 'committer-identity-unset' /
// 'commit-failed' / 'push-failed'.
function pushRemovalCommit({ git, tip, paths, branch }) {
  const scratchIndex = path.join(os.tmpdir(), `ledger-residue-index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const env = { ...process.env, GIT_INDEX_FILE: scratchIndex };
  let commit;
  try {
    git(['read-tree', tip], { env });
    git(['update-index', '--force-remove', '--', ...paths], { env });
    const tree = git(['write-tree'], { env }).trim();
    commit = git(['commit-tree', tree, '-p', tip, '-m', 'Remove residue pipeline ledgers from docs/plans — reconcile ledger-residue check'], { env }).trim();
  } catch (e) {
    return isIdentityError(e) ? 'committer-identity-unset' : 'commit-failed';
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
  cwd, integration, dryRun, skipFetch, listRemovalPrs, listRunDirs, listOpenRecords, refExists, createPr, git,
} = {}) {
  const root = cwd || process.cwd();
  const run = git || makeDefaultGit(root);
  const listPrs = listRemovalPrs || defaultListRemovalPrs;
  const listRuns = listRunDirs || defaultListRunDirs;
  const listOpen = listOpenRecords || defaultListOpenRecords;
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
    paths = residueLedgerPaths(run(['ls-tree', '--name-only', '-z', '--end-of-options', tip, '--', 'docs/plans/']));
  } catch {
    return { entries: [], failure: 'git-failure' };
  }
  if (paths.length === 0) return { entries: [], failure: null };

  const entries = [];
  const done = () => ({ entries: entries.sort((a, b) => (a.path < b.path ? -1 : 1)), failure: null });
  const skip = (p, reason, extra = {}) => entries.push({ path: p, kind: 'ledger', action: 'skip', reason, ...extra });

  const runDirNames = listRuns(root);
  // Memoized: at most one open-record read per pass, and none unless a ledger clears every local check.
  let openRecords;
  const loadOpenRecords = () => {
    if (openRecords === undefined) openRecords = listOpen(root);
    return openRecords;
  };
  const candidates = [];
  for (const p of paths) {
    let text = null;
    try {
      text = run(['cat-file', '-p', `${tip}:${p}`]);
    } catch {
      /* unreadable blob: stays null, classified as ledger-read-failed */
    }
    const reason = classifyLedgerCandidate({ path: p, text, runDirNames, loadOpenRecords });
    if (reason === 'referenced-by-open-record') skip(p, reason, { records: referencingRecords(p, openRecords) });
    else if (reason) skip(p, reason);
    else candidates.push(p);
  }
  if (candidates.length === 0) return done();

  const removalPrs = listPrs(root);
  const { removable } = partitionByRemovalPrs(candidates, removalPrs);
  const exists = removable.length > 0 ? checkRefExists(root, removalBranchName(removable)) : null;
  const decision = decideLedgerResidue({ paths: candidates, removalPrs, refExists: exists, dryRun });
  for (const s of decision.skips) skip(s.path, s.reason, s.prNumber !== undefined ? { prNumber: s.prNumber } : {});
  const { branch } = decision;
  const skipRemovable = (reason) => decision.removable.forEach((p) => skip(p, reason, { branch }));

  if (decision.action === 'none') return done();
  if (decision.action === 'skip') {
    skipRemovable(decision.reason);
    return done();
  }

  if (decision.push) {
    const failed = pushRemovalCommit({ git: run, tip, paths: decision.removable, branch });
    if (failed) {
      skipRemovable(failed);
      return done();
    }
  }

  const created = open({
    root, base: integration, head: branch, title: prTitle(decision.removable), body: prBody(decision.removable),
  });
  if (!created || typeof created !== 'object') {
    skipRemovable('pr-create-failed');
    return done();
  }
  for (const p of decision.removable) {
    entries.push({
      path: p, kind: 'ledger', action: 'pr-opened', reason: 'removal-pr-opened', branch, prNumber: created.number, prUrl: created.url,
    });
  }
  return done();
}

module.exports = {
  LEDGER_RESIDUE_MARKER,
  BRANCH_PREFIX,
  QUIET_SKIP_REASONS,
  residueLedgerPaths,
  removalBranchName,
  ledgerFeatureSlug,
  runDirNamesNumber,
  attributedRunDir,
  classifyLedgerCandidate,
  partitionByRemovalPrs,
  decideLedgerResidue,
  referencingRecords,
  defaultListRunDirs,
  defaultListOpenRecords,
  defaultListRemovalPrs,
  defaultCreatePr,
  ledgerResidue,
};
