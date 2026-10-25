#!/usr/bin/env node
// bin/closing-links.js -- keep a pr-first merge from closing a record the run
// deliberately left open (#4199). GitHub links every closing-keyword phrase
// anywhere in a PR body ("closes #N" inside a deferred reason included) and
// re-derives those links on every edit, so PR #4144 closed #2724 it had logged
// as deferred. The pure matcher/neutralizer is lib/flow/closing-links.js; the
// calling procedure is skills/_shared/pr-first-merge.md.
//
//   node bin/closing-links.js --run <run-dir> --mode <pre-merge|post-merge>
//     [--settle-ms <n>] [--help]
//
// pre-merge: reads the PR, takes the same-repo closingIssuesReferences minus
// the body's `Fixes #N` span (the unwanted links), inserts `issue ` into every
// closing phrase naming one (`closes #5` -> `closes issue #5`), writes the
// body when it changed, re-reads closingIssuesReferences (always, even with no
// write -- a Development-sidebar link has no phrase to rewrite), and logs per
// issue `unlinked` or `still linked` to decisions.md. Prints {action: clean |
// unlinked | still-linked | no-fixes-span | no-pr | gh-absent, pr, expected,
// keepOpen, linked, unwanted, unlinked, stillLinked, neutralized}.
//
// post-merge: for every keep-open candidate (a linked record outside the Fixes
// span, or a `Refs #N` record) that the PR link or the squash message's
// closing keyword will close, polls the issue (one 3 s re-read per step, at
// most floor(--settle-ms / 3000) of them -- GitHub closes about 2 s after the
// merge), and reopens it when it closed at or after mergedAt. Prints {action:
// reopened | reopen-failed | close-pending | nothing-closed | not-merged
// (carries state) | no-fixes-span | no-pr | gh-absent, pr, candidates,
// willClose, reopened, failed, stillOpen, pendingClose, closedBefore} (plus messageUnread: true when the merge message could not be
// read). A `logFailed: true` key means a decisions.md line could not be
// appended; the PR/issue work still landed.
//
// Status is data: exit 0 for every action above, a failed reopen included.
// 2 malformed invocation.
// 3 run dir missing or not anchored under the main checkout (a worktree-local
//   shadow -- _shared/pipeline-run-dir.md, [IL-127]).
// 4 run-marker mismatch (pre-merge only): the PR body's first line names a
//   different run (or none) -- refused, nothing written.
// 5 `gh pr view` / `gh pr edit` failed, or a required read came back
//   malformed (non-string body, non-array links, links with no repository,
//   missing/unparseable url or mergedAt).
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const {
  findClosingRefs, neutralizeClosingPhrases, parseFixesSpan, prRepoFromUrl, sameRepoNumbers,
} = require('./lib/flow/closing-links');
const { firstLineRunId } = require('./lib/flow/pr-checklist');
const { resolveTarget, appendEntry, formatEntry } = require('./lib/log-decision/append');
const { readRunStateWithParent } = require('./lib/hooks/context');
const { ghAvailable } = require('./lib/repo-resolve');
const { GH_TIMEOUT_MS } = require('./lib/shared-primitives');

const USAGE = 'usage: closing-links.js --run <run-dir> --mode <pre-merge|post-merge> [--settle-ms <n>] [--help]\n'
  + '  pre-merge: unlinks closing references to records the PR\'s Fixes block does not name\n'
  + '  post-merge: reopens a keep-open record the merge closed anyway (--settle-ms: poll budget, default 15000, max 60000, 0 = no re-read)\n'
  + '  prints one JSON line; action: unlinked | still-linked | clean | reopened | reopen-failed | nothing-closed | not-merged | no-fixes-span | no-pr | gh-absent\n'
  + '  exit 0 done or status-as-data\n'
  + '       2 malformed invocation\n'
  + '       3 run dir missing or not anchored under the main checkout\n'
  + '       4 run marker mismatch (pre-merge) -- refused, nothing written\n'
  + '       5 gh pr view / gh pr edit failed\n';

const MODES = ['pre-merge', 'post-merge'];
const VALUE_FLAGS = { '--run': 'run', '--mode': 'mode', '--settle-ms': 'settleMs' };
const DEFAULT_SETTLE_MS = 15000;
const MAX_SETTLE_MS = 60000;
const POLL_STEP_MS = 3000;

function parseArgs(argv) {
  const o = { run: null, mode: null, settleMs: DEFAULT_SETTLE_MS, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (!Object.hasOwn(VALUE_FLAGS, a)) return { error: `unknown argument: ${a}` };
    const v = argv[i + 1];
    if (v === undefined || v === '' || v.startsWith('--')) return { error: `${a} needs a value` };
    i++;
    if (a === '--settle-ms') {
      if (!/^\d+$/.test(v)) return { error: `--settle-ms takes a non-negative integer: ${v}` };
      o.settleMs = Number(v);
      if (o.settleMs > MAX_SETTLE_MS) return { error: `--settle-ms is capped at ${MAX_SETTLE_MS}: ${v}` };
    } else {
      o[VALUE_FLAGS[a]] = v;
    }
  }
  if (o.mode !== null && !MODES.includes(o.mode)) return { error: `--mode must be one of ${MODES.join(', ')}: ${o.mode}` };
  return o;
}

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined,
  ghAvailable: () => ghAvailable(),
  gh: (args, input) => execFileSync('gh', args, {
    encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, windowsHide: true,
  }),
  readRunState: (runDir) => readRunStateWithParent(runDir, { requireRunIdParent: true }),
  appendDecision: ({ runDir, entry }) => appendEntry({ runDir, entry }),
  now: () => new Date(),
  sleep: (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); },
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

function errText(e) {
  return [e && e.message, e && e.stderr, e && e.stdout].filter(Boolean).join(' ').trim() || String(e);
}

// An array whose non-empty content carries repository objects. Without them
// sameRepoNumbers would read every link as cross-repo and the guard would
// silently do nothing, so that shape is a malformed response.
const refsWellFormed = (refs) => Array.isArray(refs)
  && (refs.length === 0 || refs.some((r) => r && typeof r.repository === 'object' && r.repository !== null));

const uniqueSorted =(numbers) => [...new Set(numbers)].sort((a, b) => a - b);

function run(argv, overrides = {}) {
  // Tests pass only the seams they fake; the rest stay real.
  const deps = { ...realDeps, ...overrides };
  const usageError = (message) => { deps.stderr(`closing-links.js: ${message}\n${USAGE}`); return 2; };
  const print = (body) => { deps.stdout(`${JSON.stringify(body)}\n`); return 0; };

  // 1. Parse / validate. --help answers before any probe.
  const o = parseArgs(argv);
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  if (!o.run) return usageError('--run <run-dir> is required');
  if (!o.mode) return usageError('--mode <pre-merge|post-merge> is required');

  // 2. The run dir must be the main checkout's, never a worktree-local shadow.
  const target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot });
  if (!target.ok) {
    if (target.reason === 'missing') deps.stderr(`closing-links.js: run dir does not exist: ${o.run}\n`);
    else deps.stderr(`closing-links.js: run dir is not anchored under the main checkout (a worktree-local shadow): ${o.run} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md's Anchoring section and pass the main-checkout path\n`);
    return 3;
  }

  // 3. The PR number and run id; a per-spec dir answers for its parent run.
  let resolved = { state: null, parentRunDir: null };
  try { resolved = deps.readRunState(o.run) || resolved; } catch { /* no readable run-state: no-pr */ }
  const n = resolved.state && resolved.state.pr && resolved.state.pr.number;
  if (!Number.isInteger(n) || n <= 0) return print({ action: 'no-pr' });
  const runId = path.basename(resolved.parentRunDir || o.run);

  // 4. No gh: status as data, never a failure.
  if (!deps.ghAvailable()) return print({ action: 'gh-absent', pr: n });

  let logFailed = false;
  const log = (text, reversibility) => {
    try {
      deps.appendDecision({
        runDir: o.run,
        entry: formatEntry({
          status: 'AUTO', now: deps.now(), step: 'Closing links', text: text.replace(/\s+/g, ' '), reversibility,
        }),
      });
    } catch { logFailed = true; }
  };
  const done = (envelope) => print({ ...envelope, ...(logFailed ? { logFailed: true } : {}) });

  // 5. Read the live PR. A body that is not a string, or links that are not an
  // array, is a read failure -- never an empty answer that licenses a write.
  const fields = o.mode === 'pre-merge'
    ? 'body,closingIssuesReferences,url'
    : 'state,mergedAt,body,closingIssuesReferences,url,mergeCommit';
  let pr;
  try {
    pr = JSON.parse(deps.gh(['pr', 'view', String(n), '--json', fields]));
  } catch (e) {
    deps.stderr(`closing-links.js: gh pr view failed on PR #${n}: ${errText(e)}\n`);
    return 5;
  }
  const repo = pr && prRepoFromUrl(pr.url);
  if (!pr || typeof pr.body !== 'string' || !refsWellFormed(pr.closingIssuesReferences) || !repo) {
    deps.stderr(`closing-links.js: gh pr view on PR #${n} returned no string body, usable closingIssuesReferences (an array whose entries carry a repository), or PR url\n`);
    return 5;
  }
  // A MERGED PR with no readable mergedAt cannot tell a post-merge close from an earlier one.
  if (o.mode === 'post-merge' && pr.state === 'MERGED' && Number.isNaN(Date.parse(pr.mergedAt))) {
    deps.stderr(`closing-links.js: gh pr view on PR #${n} returned a MERGED PR with no parseable mergedAt\n`);
    return 5;
  }
  const scope = { owner: repo.owner, repo: repo.repo };
  const span = parseFixesSpan(pr.body);
  const linked = sameRepoNumbers(pr.closingIssuesReferences, scope);

  if (o.mode === 'pre-merge') {
    // 6a. No fixes span means no statement of what the run keeps open.
    if (!span.found) return print({ action: 'no-fixes-span', pr: n });
    const expected = span.fixes;
    const keepOpen = span.refs;
    const unwanted = linked.filter((x) => !expected.includes(x));
    const base = { pr: n, expected, keepOpen, linked, unwanted };
    if (unwanted.length === 0) return print({ action: 'clean', ...base, unlinked: [], stillLinked: [], neutralized: 0 });

    // 7a. Prove the PR is this run's before anything is written or logged (a
    // no-write path still logs into this run), then rewrite the unwanted
    // phrases and write only what changed.
    const { text: newBody, neutralized } = neutralizeClosingPhrases(pr.body, { targets: unwanted, ...scope });
    const found = firstLineRunId(newBody);
    if (found !== runId) {
      deps.stderr(`closing-links.js: run marker mismatch on PR #${n}: body names run ${found || 'none'}, expected ${runId} — nothing written\n`);
      return 4;
    }
    if (newBody !== pr.body) {
      try {
        deps.gh(['pr', 'edit', String(n), '--body-file', '-'], newBody);
      } catch (e) {
        deps.stderr(`closing-links.js: gh pr edit failed on PR #${n}: ${errText(e)}\n`);
        return 5;
      }
    }

    // 8a. Always re-read: the forge's own links are the evidence, not the text.
    let relinked;
    try {
      const reread = JSON.parse(deps.gh(['pr', 'view', String(n), '--json', 'closingIssuesReferences']));
      if (!reread || !refsWellFormed(reread.closingIssuesReferences)) throw new Error('no usable closingIssuesReferences');
      relinked = sameRepoNumbers(reread.closingIssuesReferences, scope);
    } catch (e) {
      deps.stderr(`closing-links.js: gh pr view failed on PR #${n}: ${errText(e)}\n`);
      return 5;
    }
    const unlinked = unwanted.filter((x) => !relinked.includes(x));
    const stillLinked = unwanted.filter((x) => relinked.includes(x));
    for (const issue of unlinked) {
      const k = neutralized.filter((x) => x.number === issue).length;
      log(`unlinked #${issue} from PR #${n} before merge (neutralized ${k} closing-keyword phrase(s))`, 'high');
    }
    for (const issue of stillLinked) {
      log(`#${issue} still linked to PR #${n} after neutralizing — post-merge step reopens it if the merge closes it`, 'high');
    }
    return done({
      action: stillLinked.length ? 'still-linked' : 'unlinked', ...base, unlinked, stillLinked, neutralized: neutralized.length,
    });
  }

  // 6b. post-merge: nothing to reopen until the PR merged.
  if (pr.state !== 'MERGED') return print({ action: 'not-merged', pr: n, state: pr.state });
  if (!span.found) return print({ action: 'no-fixes-span', pr: n });
  const expected = span.fixes;
  const keepOpen = span.refs;

  // 7b. The squash message is the second closing channel. A failed read
  // degrades to "no message" and says so; it never blocks the reopen.
  let message = '';
  let messageUnread = false;
  try {
    const oid = pr.mergeCommit && pr.mergeCommit.oid;
    if (typeof oid !== 'string' || !oid) throw new Error('no merge commit oid');
    message = String(deps.gh(['api', `repos/{owner}/{repo}/commits/${oid}`, '--jq', '.commit.message']));
  } catch { messageUnread = true; }
  const messageCloses = findClosingRefs(message, scope).map((r) => r.number);
  const candidates = uniqueSorted([...linked.filter((x) => !expected.includes(x)), ...keepOpen].filter((x) => !expected.includes(x)));
  const closers = new Set([...linked, ...messageCloses]);
  const willClose = candidates.filter((x) => closers.has(x));

  // 8b. Per candidate: read, re-read while a will-close one still reads OPEN
  // (bounded by re-read count, never by the clock), reopen what closed at or
  // after the merge.
  const maxRereads = Math.floor(o.settleMs / POLL_STEP_MS);
  const mergedAt = Date.parse(pr.mergedAt);
  const reopened = []; const failed = []; const stillOpen = []; const closedBefore = [];
  for (const issue of candidates) {
    let state;
    try {
      const read = () => {
        const j = JSON.parse(deps.gh(['issue', 'view', String(issue), '--json', 'state,closedAt']));
        if (!j || typeof j.state !== 'string') throw new Error('no state field');
        return j;
      };
      state = read();
      for (let i = 0; i < maxRereads && state.state === 'OPEN' && willClose.includes(issue); i++) {
        deps.sleep(POLL_STEP_MS);
        state = read();
      }
    } catch (e) {
      failed.push({ issue, error: errText(e) });
      continue;
    }
    if (state.state === 'OPEN') { stillOpen.push(issue); continue; }
    // closedAt unparseable compares false: an undatable close is never reopened.
    if (!(Date.parse(state.closedAt) >= mergedAt)) { closedBefore.push(issue); continue; }
    try {
      deps.gh(['issue', 'reopen', String(issue), '--comment',
        `Reopened by claude-tweaks: this record was closed after PR #${n} merged, but the run left it open (not in the PR's Fixes block).`]);
      reopened.push(issue);
    } catch (e) {
      failed.push({ issue, error: errText(e) });
    }
  }
  for (const issue of reopened) log(`reopened #${issue} after PR #${n}'s merge closed it (closing link or merge-commit keyword)`, 'high');
  for (const f of failed) log(`could not reopen #${f.issue} after PR #${n}'s merge (${f.error}) — reopen it by hand`, 'n/a');

  // A will-close record still OPEN after the poll window may yet close: that
  // is pending, not clean.
  const pendingClose = willClose.filter((x) => stillOpen.includes(x));
  for (const issue of pendingClose) {
    log(`#${issue} still open ${o.settleMs / 1000}s after PR #${n} merged though the merge will close it — re-run --mode post-merge or reopen it by hand if it closes`, 'n/a');
  }
  let action = 'nothing-closed';
  if (reopened.length) action = 'reopened';
  else if (failed.length) action = 'reopen-failed';
  else if (pendingClose.length) action = 'close-pending';

  return done({
    action, pr: n, candidates, willClose, reopened, failed, stillOpen, pendingClose, closedBefore,
    ...(messageUnread ? { messageUnread: true } : {}),
  });
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2));
