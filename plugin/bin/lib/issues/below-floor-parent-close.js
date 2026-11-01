// bin/lib/issues/below-floor-parent-close.js
// The reconciler's Step 4.0b driver: _shared/pr-first-merge-post-merge.md Step
// 4.0b's post-merge sub-issue-side entry into the Parent-Gate Procedure
// (wrap-up/verification-brief-parent-gate.md), under work-backend: github-issues
// (#4599 — the reconciler runs it for a PR GitHub merged after its session
// ended). It runs over parent-gate.js's shared core, the code bin/parent-gate.js
// runs for the prose: Resolve the parent, Enumerate the parent's sub-issues, the
// Self-inclusion rule, Evaluate the gate and the idempotence check all come from
// there (#4603). This file maps the verdict to its skip reasons and makes Close
// the parent below the floor's writes. composeCloseComment's template is pinned
// to the prose's text by tests/bin-lib/issues/below-floor-parent-close.test.js
// (a prose-code twin).
//
// Not mirrored: the `#205` default-set rule (a caller arriving without
// $CLOSING_SUB_ISSUES defaults to the one-element set, never to {}). Here the
// set is always an explicit `closingSet` argument, so there is no default to
// apply. The Self-inclusion rule is not applied when the caller passes
// `selfInclude: false`: its premise is a caller running seconds after the merge,
// while GitHub may still report a just-merged sub-issue OPEN. The reconciler runs
// at least 10 minutes later (weeks later on a catch-up), when the live state is
// the truth, so a sub-issue a human reopened since must keep its parent open.
// `mergingPr` still names the merge on the listing lines. The default (`true`)
// is the in-session mirror. The pre-merge entries, the Try it post, the
// no-parent fallback and work-backend: local-files are out of scope too — this
// entry runs after the merge has landed and never falls back to the no-parent path.
//
// It mirrors the entry after a PR merge, the only merge its caller sees, so it
// has no default-branch check: that gate is the no-PR local merge's (#4549). On
// a non-default base Step 4.0 closes the `Fixes` records itself and its
// `closingSet` holds only the ones it confirmed closed, so the set is already
// safe to count. `unsettled` is every record Step 4.0 handled or could not
// settle — `reopened[]`, `pendingClose[]`, and each `failed[]` and
// `closeFailed[]` entry's issue — and any parent whose sub-issues include one
// is skipped (`sibling-unsettled`).
//
// Every gh call goes through the injected `gh(args, input?)`, which returns
// stdout and throws on failure. Both writes carry `--repo`, as the gate's reads
// do, so a parent is written in the repository it was read from. `host` is the
// origin's host: off github.com that `--repo` is `host/owner/repo` and the
// gate's `gh api` reads carry `--hostname host`; absent or github.com, every
// argv is the bare `owner/repo` one. A failing call skips that one parent
// (named in `skipped`, reason `gh-failed`) and the next closing record is still
// processed; a `riskFloor` outside the policy schema's risk-floor enum skips the
// whole step (`invalid-risk-floor`, no gh call). Never throws.
//
// The gh identity read (`api user`, only when the idempotence check needs it) does
// not gate the close: a failed or blank read closes with trusted-only marker
// matching and puts parent-gate.js's IDENTITY_PROBE_FAILED_NOTE in the closed
// entry's `notes` (#4770). It is read once per call, success or failure, and
// replayed to every later parent.
'use strict';

const {
  CLOSE_HEADING, VALID_RISK_FLOORS, isCloseMarkerComment, GhFailure, ghCaller, numberSet, resolveParent,
  gatherGateFacts, gatherIdempotenceFacts, evaluateParentGate, evaluateIdempotence, readLogin,
} = require('./parent-gate');
const { repoSlug } = require('../repo-resolve');

const NOT_PLANNED_LINE = 'No sub-issue closed as completed, so this parent closes as not planned.';

// { maxTier, riskFloor, notPlanned, lines } -> the closing comment text.
// `lines` are already-rendered `- #{n} {title}[ — closed by PR #{pr}]` strings.
function composeCloseComment({ maxTier, riskFloor, notPlanned, lines } = {}) {
  const intro = `Every sub-issue of this decomposition is closed, and the highest sub-issue risk, \`risk:${maxTier}\`, does not exceed the resolved \`risk-floor\` (\`${riskFloor}\`), so no Verification Brief or \`demo:pending\` sign-off is owed.`;
  const parts = [CLOSE_HEADING, intro];
  if (notPlanned) parts.push(NOT_PLANNED_LINE);
  if (lines && lines.length) parts.push(lines.join('\n'));
  return `${parts.join('\n\n')}\n`;
}

// A gate verdict -> the reason this parent is skipped, or null when it is due
// below the floor. The checks run in the order the prose routes them.
function skipReason(verdict) {
  if (!verdict.parentIssue) return 'not-parent-issue-labeled';
  if (verdict.needs.length) return 'needs-label';
  if (verdict.held.length) return 'sibling-unsettled';
  if (verdict.state !== 'due') return verdict.state;
  if (verdict.exceeds) return 'above-floor';
  return null;
}

// A read taken at most once per closeBelowFloorParents call: the first invocation's
// result, or its thrown error, is replayed to every later parent (the gh identity is
// the same for the whole run, so a failed probe is not retried per parent).
function memoizeRead(read) {
  let done = false;
  let failed = false;
  let value;
  let error;
  return () => {
    if (!done) {
      try {
        value = read();
      } catch (err) {
        failed = true;
        error = err;
      }
      done = true;
    }
    if (failed) throw error;
    return value;
  };
}

function closeBelowFloorParents({
  closingSet, unsettled, mergingPr, owner, repo, host, workLinks, riskFloor, gh, selfInclude = true,
} = {}) {
  const closed = [];
  const skipped = [];
  if (!VALID_RISK_FLOORS.includes(riskFloor)) {
    skipped.push({ reason: 'invalid-risk-floor' });
    return { closed, skipped };
  }
  try {
    const caller = ghCaller(gh);
    const closing = numberSet(closingSet);
    const unsettledSet = numberSet(unsettled);
    const slug = repoSlug({ host, owner, repo });
    const readLoginOnce = memoizeRead(() => readLogin({ caller, host }));

    const handled = new Set();
    for (const n of [...closing].sort((a, b) => a - b)) {
      let parent = null;
      try {
        parent = resolveParent({ subIssue: n, owner, repo, host, workLinks, caller });
        if (parent === null || parent === undefined) continue; // no resolvable parent: a silent no-op
        if (handled.has(parent)) continue; // each parent is evaluated once
        handled.add(parent);

        const facts = gatherGateFacts({ parent, owner, repo, host, workLinks, caller });
        const verdict = evaluateParentGate({
          ...facts, closingSet: [...closing], selfInclude, held: [...unsettledSet], mergingPr, riskFloor,
        });
        const reason = skipReason(verdict);
        if (reason) {
          skipped.push({ parent, reason });
          continue;
        }

        // Idempotence: read before writing anything.
        const { idempotence, skipped: notes } = evaluateIdempotence(gatherIdempotenceFacts({ parent, owner, repo, host, caller, readLogin: readLoginOnce }));
        if (idempotence === 'already-closed') {
          skipped.push({ parent, reason: 'already-closed' });
          continue;
        }
        if (idempotence === 'reopened') {
          skipped.push({ parent, reason: 'reopened-by-human' });
          continue;
        }

        const { maxTier, closeReason } = verdict;
        if (idempotence !== 'close-only') {
          const lines = verdict.subIssues.map((s) => `- #${s.number}${s.title ? ` ${s.title}` : ''}${s.pr ? ` — closed by PR #${s.pr}` : ''}`);
          caller.call(['issue', 'comment', String(parent), '--repo', slug, '--body-file', '-'], composeCloseComment({ maxTier, riskFloor, notPlanned: closeReason === 'not planned', lines }));
        }
        caller.call(['issue', 'close', String(parent), '--repo', slug, '--reason', closeReason]);
        closed.push(notes.length ? { parent, maxTier, notes } : { parent, maxTier });
      } catch (err) {
        const target = parent === null || parent === undefined ? { issue: n } : { parent };
        skipped.push({
          ...target,
          reason: err instanceof GhFailure ? 'gh-failed' : 'internal-error',
          detail: err && err.message,
        });
      }
    }
  } catch (err) {
    skipped.push({ reason: 'internal-error', detail: err && err.message });
  }
  return { closed, skipped };
}

module.exports = { CLOSE_HEADING, composeCloseComment, closeBelowFloorParents, isCloseMarkerComment };
