#!/usr/bin/env node
// bin/closing-links.js -- keep a pr-first merge from closing a record the run
// deliberately left open (#4199). GitHub links every closing-keyword phrase
// anywhere in a PR body ("closes #N" inside a deferred reason included) and
// re-derives those links on every edit, so PR #4144 closed #2724 it had logged
// as deferred. The pure matcher/neutralizer is lib/flow/closing-links.js; the
// callers are skills/_shared/pr-checklist-refresh.md (pre-merge) and
// pr-first-merge-post-merge.md Step 4.0 (post-merge), and pr-first-merge.md
// Step 3 passes the pre-merge `keepOpen` on to compose-subject.js --keep-open.
//
//   node bin/closing-links.js --run <run-dir> --mode <pre-merge|post-merge>
//     [--settle-ms <n>] [--close-window-ms <n>] [--help]
//
// pre-merge: reads the PR, takes the same-repo closingIssuesReferences minus
// the body's `Fixes #N` span (the unwanted links), inserts `issue ` into every
// closing phrase naming one (`closes #5` -> `closes issue #5`), writes the
// body when it changed, re-reads closingIssuesReferences (always, even with no
// write -- a Development-sidebar link has no phrase to rewrite), and logs per
// issue `unlinked` (AUTO) or `still linked` (SKIP, degraded) to decisions.md.
// Prints {action: clean | unlinked | still-linked | no-fixes-span | no-pr |
// gh-absent, pr, expected, keepOpen, linked, unwanted, unlinked, stillLinked,
// neutralized}.
//
// post-merge: for every keep-open candidate (a linked record outside the Fixes
// span, or a `Refs #N` record) that the PR link or the squash message's
// closing keyword will close, polls the issue (one 3 s re-read per step, at
// most floor(--settle-ms / 3000) of them -- GitHub closes about 2 s after the
// merge), and reopens it when it closed at or after mergedAt. An unread merge
// message (or a merge-commit oid that is not a hex sha) makes every candidate
// will-close. Logs `reopened` (AUTO), `could not read`, `could not reopen` and `still open`
// (SKIP, degraded). With --close-window-ms <n> (post-merge only; a late run,
// e.g. the reconciler's, passes it so a human close hours after the merge is not
// undone), a record closed later than mergedAt + n is not reopened: it is listed
// in closedAfterWindow and stays in closingSet (it is closed), with no decisions
// line; and once the clock is past mergedAt + n, a will-close record still OPEN
// is settled open, not pending: listed in settledOpen, never in pendingClose,
// with no re-run SKIP line. Prints {action, pr, candidates, willClose, reopened,
// failed, stillOpen, pendingClose, closedBefore, closingSet} (plus
// closedAfterWindow: [...] and settledOpen: [...] when --close-window-ms was given, and
// messageUnread: true when the merge message could not be read; closingSet is
// the same-repo closing records minus reopened, failed, pendingClose and settledOpen --
// Step 4.0b's $CLOSING_SUB_ISSUES, skills/_shared/pr-first-merge-post-merge.md),
// with the worst outcome as the action: reopen-failed > close-failed >
// base-unchecked > close-pending > reopened > closed > nothing-closed; or
// not-merged (carries state) | no-fixes-span | no-pr | gh-absent. Callers
// report failed[], closeFailed[] and pendingClose[] whatever the action. A
// `logFailed: true` key means a decisions.md line could not be appended; the
// PR/issue work still landed.
//
// GitHub acts on closing keywords only for a merge into the repo's default
// branch (#4549). The PR's baseRefName is compared with the default branch
// (`gh repo view {host}/{owner}/{repo}`, the PR's own host). On a different
// base nothing the merge carries can close, so there is no will-close polling
// and no pendingClose, and the CLI closes each still-open `Fixes` record itself
// (`issue close --reason completed`, logged AUTO): the envelope adds
// nonDefaultBase: true, closed[] and closeFailed[] ({issue, error, stage?};
// stage 'read' for a failed state read), and closingSet is closed[] plus the
// Fixes records read already CLOSED, never a closeFailed one. A base or default
// branch that cannot be read closes nothing: the envelope adds
// baseUnchecked: true and unchecked[] (the Fixes records it did not check,
// sorted -- the numbers a caller names for a hand close) and omits closingSet.
// The default base keeps the envelope above unchanged.
//
// Status is data: exit 0 for every action above, a failed reopen included.
// 2 malformed invocation.
// 3 run dir missing or not anchored under the main checkout (a worktree-local
//   shadow -- _shared/pipeline-run-dir.md, [IL-127]).
// 4 run-marker mismatch (pre-merge only): the PR body's first line names a
//   different run (or none) -- refused, nothing written to the PR.
// 5 `gh pr view` / `gh pr edit` failed, or a required read came back
//   malformed (non-string body, non-array links, links with no repository,
//   missing/unparseable url or mergedAt).
// gh-absent, 4 and 5 leave this merge's closing links unchecked, and the CLI
// logs that itself (#4026): one SKIP under `## /wrap-up`, step `Closing links
// ({mode}) (degraded)`, text `condition: closing-links.js {gh-absent | exit 4
// run marker mismatch | exit 5 gh failure: {first stderr line, unprefixed}} →
// fallback: closing links not checked this merge`, reversibility n/a. A failed
// append adds one stderr line (and logFailed on the gh-absent envelope), never
// an exit change. Exit 3 cannot log: the run dir is not trusted.
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const {
  findClosingRefs, neutralizeClosingPhrases, parseFixesSpan, prRepoFromUrl, sameRepoNumbers,
} = require('./lib/flow/closing-links');
const { firstLineRunId } = require('./lib/flow/pr-checklist');
const { resolveTarget, appendEntry, formatEntry } = require('./lib/log-decision/append');
const { readRunStateWithParent } = require('./lib/hooks/context');
const { ghAvailable, ghOptions } = require('./lib/repo-resolve');
const { GH_TIMEOUT_MS } = require('./lib/shared-primitives');

const USAGE = 'usage: closing-links.js --run <run-dir> --mode <pre-merge|post-merge> [--settle-ms <n>] [--close-window-ms <n>] [--help]\n'
  + '  pre-merge: unlinks closing references to records the PR\'s Fixes block does not name\n'
  + '  post-merge: reopens a keep-open record the merge closed anyway (--settle-ms: poll budget, default 15000, max 60000, 0 = no re-read); on a base other than the default branch, closes each still-open Fixes record itself\n'
  + '    --close-window-ms: post-merge only; a record closed later than mergedAt + n is a human close, not reopened and listed in closedAfterWindow (default: no bound);\n'
  + '      past mergedAt + n, a will-close record still open is settled open, listed in settledOpen, never pendingClose\n'
  + '  prints one JSON line; action:\n'
  + '    pre-merge: unlinked | still-linked | clean | no-fixes-span | no-pr | gh-absent\n'
  + '    post-merge (worst wins): reopen-failed > close-failed > base-unchecked > close-pending > reopened > closed > nothing-closed; or not-merged | no-fixes-span | no-pr | gh-absent\n'
  + '  exit 0 done or status-as-data\n'
  + '       2 malformed invocation\n'
  + '       3 run dir missing or not anchored under the main checkout\n'
  + '       4 run marker mismatch (pre-merge) -- refused, nothing written\n'
  + '       5 gh pr view / gh pr edit failed, or a required read came back malformed\n'
  + '  gh-absent, 4 and 5 append their own SKIP line to decisions.md (## /wrap-up)\n';

const MODES = ['pre-merge', 'post-merge'];
const VALUE_FLAGS = {
  '--run': 'run', '--mode': 'mode', '--settle-ms': 'settleMs', '--close-window-ms': 'closeWindowMs',
};
const DEFAULT_SETTLE_MS = 15000;
const MAX_SETTLE_MS = 60000;
const POLL_STEP_MS = 3000;

function parseArgs(argv) {
  const o = { run: null, mode: null, settleMs: DEFAULT_SETTLE_MS, closeWindowMs: null, help: false };
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
    } else if (a === '--close-window-ms') {
      if (!/^\d+$/.test(v)) return { error: `--close-window-ms takes a non-negative integer: ${v}` };
      o.closeWindowMs = Number(v);
    } else {
      o[VALUE_FLAGS[a]] = v;
    }
  }
  if (o.mode !== null && !MODES.includes(o.mode)) return { error: `--mode must be one of ${MODES.join(', ')}: ${o.mode}` };
  if (o.mode === 'pre-merge' && o.closeWindowMs !== null) return { error: '--close-window-ms applies to --mode post-merge only' };
  return o;
}

const realDeps = {
  cwd: () => process.cwd(),
  mainRoot: undefined,
  ghAvailable: () => ghAvailable(),
  gh: (args, input) => execFileSync('gh', args, ghOptions(args, {
    encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, windowsHide: true,
  })),
  readRunState: (runDir) => readRunStateWithParent(runDir, { requireRunIdParent: true }),
  appendDecision: ({ runDir, section, entry }) => appendEntry({ runDir, section, entry }),
  now: () => new Date(),
  sleep: (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); },
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

const ERR_TEXT_MAX = 300;
// The one exit a caller may retry: `gh` (or its transport) failed. lib/reconcile/post-merge.js keys its bounded retry on it.
const EXIT_GH_FAILURE = 5;

// Bounded: errText lands in decisions.md, which the Review Console reads line by line.
function errText(e) {
  const text = [e && e.message, e && e.stderr, e && e.stdout].filter(Boolean).join(' ').trim() || String(e);
  return text.length > ERR_TEXT_MAX ? `${text.slice(0, ERR_TEXT_MAX)}…` : text;
}

// An array whose non-empty content carries repository objects. Without them
// sameRepoNumbers would read every link as cross-repo and the guard would
// silently do nothing, so that shape is a malformed response.
function refsWellFormed(refs) {
  return Array.isArray(refs)
    && (refs.length === 0 || refs.some((r) => r && typeof r.repository === 'object' && r.repository !== null));
}

function uniqueSorted(numbers) {
  return [...new Set(numbers)].sort((a, b) => a - b);
}

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

  let logFailed = false;
  // gh-absent, exit 4 and exit 5 leave this merge's closing links unchecked:
  // one SKIP under /wrap-up (#4026). A failed append adds one stderr line; the
  // exit code (or the gh-absent envelope's logFailed) is unchanged.
  const unchecked = (condition) => {
    try {
      deps.appendDecision({
        runDir: o.run,
        section: '/wrap-up',
        entry: formatEntry({
          status: 'SKIP',
          now: deps.now(),
          step: `Closing links (${o.mode}) (degraded)`,
          text: `condition: closing-links.js ${condition} → fallback: closing links not checked this merge`.replace(/\s+/g, ' '),
          reversibility: 'n/a',
        }),
      });
    } catch (e) {
      logFailed = true;
      deps.stderr(`closing-links.js: could not append the decisions.md entry: ${(e && e.message) || e}\n`);
    }
  };
  // Exit 5: the stderr line, then a SKIP carrying its first line.
  const ghFailed = (message) => {
    deps.stderr(`closing-links.js: ${message}\n`);
    unchecked(`exit ${EXIT_GH_FAILURE} gh failure: ${message.split('\n')[0]}`);
    return EXIT_GH_FAILURE;
  };

  // 4. No gh: status as data, never a failure.
  if (!deps.ghAvailable()) {
    unchecked('gh-absent');
    return print({ action: 'gh-absent', pr: n, ...(logFailed ? { logFailed: true } : {}) });
  }

  const log = (text, reversibility, status = 'AUTO', step = 'Closing links') => {
    try {
      deps.appendDecision({
        runDir: o.run,
        entry: formatEntry({
          status, now: deps.now(), step, text: text.replace(/\s+/g, ' '), reversibility,
        }),
      });
    } catch { logFailed = true; }
  };
  // A guard that did not land (still linked, could not reopen, still open) is
  // not an auto-applied decision: _shared/auto-decision-log.md's Degrade-trace
  // rule makes "the step ran, but to a lesser fallback, no staged artifact" a
  // SKIP line tagged (degraded), Reversibility n/a. KEPT-PROMPT would claim a
  // user was asked inline, and STAGED needs a staged/ file; neither happened.
  const degraded = (condition, fallback) => log(`condition: ${condition} → fallback: ${fallback}`, 'n/a', 'SKIP', 'Closing links (degraded)');
  const done = (envelope) => print({ ...envelope, ...(logFailed ? { logFailed: true } : {}) });

  // 5. Read the live PR. A body that is not a string, or links that are not an
  // array, is a read failure -- never an empty answer that licenses a write.
  const fields = o.mode === 'pre-merge'
    ? 'body,closingIssuesReferences,url'
    : 'state,mergedAt,body,closingIssuesReferences,url,mergeCommit,baseRefName';
  let pr;
  try {
    pr = JSON.parse(deps.gh(['pr', 'view', String(n), '--json', fields]));
  } catch (e) {
    return ghFailed(`gh pr view failed on PR #${n}: ${errText(e)}`);
  }
  const repo = pr && prRepoFromUrl(pr.url);
  if (!pr || typeof pr.body !== 'string' || !refsWellFormed(pr.closingIssuesReferences) || !repo) {
    return ghFailed(`gh pr view on PR #${n} returned no string body, usable closingIssuesReferences (an array whose entries carry a repository), or PR url`);
  }
  // A MERGED PR with no readable mergedAt cannot tell a post-merge close from an earlier one.
  if (o.mode === 'post-merge' && pr.state === 'MERGED' && Number.isNaN(Date.parse(pr.mergedAt))) {
    return ghFailed(`gh pr view on PR #${n} returned a MERGED PR with no parseable mergedAt`);
  }
  const scope = { owner: repo.owner, repo: repo.repo };
  const span = parseFixesSpan(pr.body);
  const expected = span.fixes;
  const keepOpen = span.refs;
  const linked = sameRepoNumbers(pr.closingIssuesReferences, scope);

  if (o.mode === 'pre-merge') {
    // 6a. No fixes span means no statement of what the run keeps open.
    if (!span.found) return print({ action: 'no-fixes-span', pr: n });
    const unwanted = linked.filter((x) => !expected.includes(x));
    const base = { pr: n, expected, keepOpen, linked, unwanted };
    if (unwanted.length === 0) return print({ action: 'clean', ...base, unlinked: [], stillLinked: [], neutralized: 0 });

    // 7a. Prove the PR is this run's before anything is written to it or any
    // outcome is logged (a no-write path still logs into this run) -- only the
    // refusal's own SKIP is -- then rewrite the unwanted phrases and write only
    // what changed.
    const { text: newBody, neutralized } = neutralizeClosingPhrases(pr.body, { targets: unwanted, ...scope });
    const found = firstLineRunId(newBody);
    if (found !== runId) {
      deps.stderr(`closing-links.js: run marker mismatch on PR #${n}: body names run ${found || 'none'}, expected ${runId} — nothing written\n`);
      unchecked('exit 4 run marker mismatch');
      return 4;
    }
    if (newBody !== pr.body) {
      try {
        deps.gh(['pr', 'edit', String(n), '--body-file', '-'], newBody);
      } catch (e) {
        return ghFailed(`gh pr edit failed on PR #${n}: ${errText(e)}`);
      }
    }

    // 8a. Always re-read: the forge's own links are the evidence, not the text.
    let relinked;
    try {
      const reread = JSON.parse(deps.gh(['pr', 'view', String(n), '--json', 'closingIssuesReferences']));
      if (!reread || !refsWellFormed(reread.closingIssuesReferences)) throw new Error('no usable closingIssuesReferences');
      relinked = sameRepoNumbers(reread.closingIssuesReferences, scope);
    } catch (e) {
      // A body write already landed: leave a trace so the unlink is not unaudited.
      if (newBody !== pr.body) degraded(`PR #${n} body rewritten (${neutralized.length} closing phrase(s) neutralized) but the re-read of its links failed`, 're-run --mode pre-merge to confirm #' + unwanted.join(', #') + ' unlinked');
      return ghFailed(`gh pr view failed on PR #${n}: ${errText(e)}`);
    }
    const unlinked = unwanted.filter((x) => !relinked.includes(x));
    const stillLinked = unwanted.filter((x) => relinked.includes(x));
    for (const issue of unlinked) {
      const k = neutralized.filter((x) => x.number === issue).length;
      log(`unlinked #${issue} from PR #${n} before merge (neutralized ${k} closing-keyword phrase(s))`, 'high');
    }
    for (const issue of stillLinked) {
      degraded(`#${issue} still linked to PR #${n} after neutralizing`, 'the post-merge step reopens it if the merge closes it');
    }
    return done({
      action: stillLinked.length ? 'still-linked' : 'unlinked', ...base, unlinked, stillLinked, neutralized: neutralized.length,
    });
  }

  // 6b. post-merge: nothing to reopen until the PR merged.
  if (pr.state !== 'MERGED') return print({ action: 'not-merged', pr: n, state: pr.state });
  if (!span.found) return print({ action: 'no-fixes-span', pr: n });

  // 7b. The squash message is the second closing channel. A failed read (or
  // an oid that is not a commit sha, never put into the API path) degrades to
  // "unread" and says so; it never blocks the reopen. Unread, any candidate
  // may be named by a closing keyword, so every one counts as will-close and
  // is polled -- otherwise a record the message closes ~2 s later reads OPEN
  // once and is missed.
  let message = '';
  let messageUnread = false;
  try {
    const oid = pr.mergeCommit && pr.mergeCommit.oid;
    if (typeof oid !== 'string' || !/^[0-9a-f]{7,40}$/.test(oid)) throw new Error('no usable merge commit oid');
    message = String(deps.gh(['api', `repos/{owner}/{repo}/commits/${oid}`, '--jq', '.commit.message']));
  } catch { messageUnread = true; }
  const messageCloses = findClosingRefs(message, scope).map((r) => r.number);
  const candidates = uniqueSorted([...linked, ...keepOpen].filter((x) => !expected.includes(x)));
  const closers = new Set([...linked, ...messageCloses]);

  // 7b'. GitHub acts on closing keywords only for a merge into the repo's
  // default branch (#4549). Which branch this one landed on is read before the
  // reopen loop, because a merge elsewhere closes nothing: no will-close
  // polling, no pendingClose. The default branch comes from `gh repo view` for
  // the PR's own host (a GitHub Enterprise Cloud PR must not resolve against
  // github.com). A base or default branch that cannot be read is unchecked,
  // never assumed non-default.
  const base = typeof pr.baseRefName === 'string' && pr.baseRefName.trim() ? pr.baseRefName.trim() : null;
  let defaultBranch = null;
  let uncheckedReason = 'the PR view carried no base branch';
  if (base) {
    try {
      // Not the integration-branch ladder (`_shared/integration-branch.md`): this
      // check needs GitHub's own default branch -- where closing keywords fire --
      // read on the PR's own host, not the project's integration branch.
      defaultBranch = String(deps.gh(['repo', 'view', `${repo.host}/${repo.owner}/${repo.repo}`, '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'])).trim() || null;
      if (!defaultBranch) uncheckedReason = 'the repository returned no default branch';
    } catch (e) {
      uncheckedReason = `the default branch could not be read: ${errText(e)}`;
    }
  }
  const baseUnchecked = !base || !defaultBranch;
  const nonDefaultBase = !baseUnchecked && base !== defaultBranch;
  const willClose = nonDefaultBase ? [] : (messageUnread ? candidates : candidates.filter((x) => closers.has(x)));

  // 8b. Per candidate: read, re-read while a will-close one still reads OPEN
  // (bounded by re-read count, never by the clock), reopen what closed at or
  // after the merge -- and, with --close-window-ms, no later than mergedAt + n.
  const maxRereads = Math.floor(o.settleMs / POLL_STEP_MS);
  const mergedAt = Date.parse(pr.mergedAt);
  // One issue-state read for both passes: the parsed {state, closedAt}, or a throw.
  const readIssueState = (issue) => {
    const j = JSON.parse(deps.gh(['issue', 'view', String(issue), '--json', 'state,closedAt']));
    if (!j || typeof j.state !== 'string') throw new Error('no state field');
    return j;
  };
  const reopened = []; const failed = []; const stillOpen = []; const closedBefore = []; const closedAfterWindow = [];
  for (const issue of candidates) {
    let state;
    try {
      state = readIssueState(issue);
      for (let i = 0; i < maxRereads && state.state === 'OPEN' && willClose.includes(issue); i++) {
        deps.sleep(POLL_STEP_MS);
        state = readIssueState(issue);
      }
    } catch (e) {
      failed.push({ issue, error: errText(e), stage: 'read' });
      continue;
    }
    if (state.state === 'OPEN') { stillOpen.push(issue); continue; }
    // closedAt unparseable compares false: an undatable close is never reopened.
    if (!(Date.parse(state.closedAt) >= mergedAt)) { closedBefore.push(issue); continue; }
    // --close-window-ms: a close later than the window is a human's, not the merge's;
    // it stays closed (and in closingSet) and is reported, never reopened.
    if (o.closeWindowMs !== null && Date.parse(state.closedAt) > mergedAt + o.closeWindowMs) { closedAfterWindow.push(issue); continue; }
    try {
      deps.gh(['issue', 'reopen', String(issue), '--comment',
        `Reopened by claude-tweaks: this record was closed after PR #${n} merged, but the run left it open (not in the PR's Fixes block).`]);
      reopened.push(issue);
    } catch (e) {
      failed.push({ issue, error: errText(e) });
    }
  }
  for (const issue of reopened) log(`reopened #${issue} after PR #${n}'s merge closed it (closing link or merge-commit keyword)`, 'high');
  for (const f of failed) {
    if (f.stage === 'read') degraded(`could not read #${f.issue} after PR #${n}'s merge (${f.error})`, `check whether it closed, and reopen it by hand if it did`);
    else degraded(`could not reopen #${f.issue} after PR #${n}'s merge (${f.error})`, 'reopen it by hand');
  }

  // A will-close record still OPEN after the poll window may yet close: that
  // is pending, not clean -- until the clock is past mergedAt + --close-window-ms
  // (a late run's own bound): GitHub closes about 2 s after the merge, so a record
  // still OPEN that late was never closed by it. That is settled open, not pending.
  const openWillClose = willClose.filter((x) => stillOpen.includes(x));
  const windowPassed = o.closeWindowMs !== null && Number(deps.now()) > mergedAt + o.closeWindowMs;
  const settledOpen = windowPassed ? openWillClose : [];
  const pendingClose = windowPassed ? [] : openWillClose;
  const windowSeconds = maxRereads * (POLL_STEP_MS / 1000);
  for (const issue of pendingClose) {
    degraded(`#${issue} still open ${windowSeconds}s after PR #${n} merged though the merge may close it`, 're-run --mode post-merge, or reopen it by hand if it closes');
  }
  // 9b. The merge landed outside the default branch: its Fixes records stay
  // open, so close each one still open (#4549). Records already CLOSED are left
  // alone and count as closed; a failed read or close is reported, never
  // counted. An unchecked base closes nothing.
  const fixesRecords = uniqueSorted(expected);
  const closed = []; const closeFailed = []; const alreadyClosed = [];
  if (nonDefaultBase) {
    for (const issue of fixesRecords) {
      let state;
      try {
        state = readIssueState(issue);
      } catch (e) {
        closeFailed.push({ issue, error: errText(e), stage: 'read' });
        continue;
      }
      if (state.state !== 'OPEN') { alreadyClosed.push(issue); continue; }
      try {
        deps.gh(['issue', 'close', String(issue), '--reason', 'completed', '--comment',
          `Closed by claude-tweaks: PR #${n} merged into ${base}, which is not the default branch, so GitHub does not act on its closing keywords.`]);
        closed.push(issue);
      } catch (e) {
        closeFailed.push({ issue, error: errText(e) });
      }
    }
    for (const issue of closed) {
      log(`closed #${issue} after PR #${n} merged into ${base} (not the default branch ${defaultBranch}; GitHub does not act on closing keywords there)`, 'high (gh issue reopen)');
    }
    for (const f of closeFailed) {
      if (f.stage === 'read') degraded(`could not read #${f.issue} after PR #${n} merged into ${base} (${f.error})`, 'check it and close it by hand if it is still open');
      else degraded(`could not close #${f.issue} after PR #${n} merged into ${base} (${f.error})`, 'close it by hand');
    }
  } else if (baseUnchecked) {
    degraded(`could not tell whether PR #${n} merged into the default branch (${uncheckedReason})`,
      expected.length
        ? `Fixes records #${fixesRecords.join(', #')} not checked — close any still open by hand if the base is not the default branch`
        : 'the PR names no Fixes records, so there is nothing to close by hand');
  }

  // Worst outcome wins: a reopen never hides a failure or a pending close. An
  // unchecked base outranks a pending close or a reopen because the Fixes set's
  // state is unknown and `closingSet` is omitted, whereas those two concern a
  // known set; it stays below `close-failed`, which names records that
  // definitely need a hand close.
  let action = 'nothing-closed';
  if (failed.length) action = 'reopen-failed';
  else if (closeFailed.length) action = 'close-failed';
  else if (baseUnchecked) action = 'base-unchecked';
  else if (pendingClose.length) action = 'close-pending';
  else if (reopened.length) action = 'reopened';
  else if (closed.length) action = 'closed';

  // The same-repo records the merge closing links name: `linked` minus whatever the
  // guard reopened, could not settle, has yet to see close, or saw stay open. A Fixes-block record
  // is never read, and a record closed before the merge stays in -- both count as closed.
  // On a non-default base the merge closes nothing itself: the set is what this pass
  // closed plus the Fixes records it found already closed (settledOpen is empty there:
  // no will-close record). Unchecked, there is no set.
  const unsettled = new Set([...reopened, ...pendingClose, ...settledOpen, ...failed.map((f) => f.issue)]);
  const closingSet = nonDefaultBase ? uniqueSorted([...closed, ...alreadyClosed]) : linked.filter((x) => !unsettled.has(x));

  return done({
    action, pr: n, candidates, willClose, reopened, failed, stillOpen, pendingClose, closedBefore,
    ...(baseUnchecked ? {} : { closingSet }),
    ...(o.closeWindowMs !== null ? { closedAfterWindow, settledOpen } : {}),
    ...(messageUnread ? { messageUnread: true } : {}),
    ...(nonDefaultBase ? { nonDefaultBase: true, closed, closeFailed } : {}),
    ...(baseUnchecked ? { baseUnchecked: true, unchecked: fixesRecords } : {}),
  });
}

module.exports = { run, parseArgs, EXIT_GH_FAILURE, ERR_TEXT_MAX };

if (require.main === module) process.exitCode = run(process.argv.slice(2));
