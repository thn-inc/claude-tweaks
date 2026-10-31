// bin/lib/issues/below-floor-parent-close.js
// Node mirror of the Parent-Gate Procedure's post-merge sub-issue-side entry:
// _shared/pr-first-merge-post-merge.md Step 4.0b running
// wrap-up/verification-brief-parent-gate.md's Resolve the parent, Enumerate the
// parent's sub-issues, Self-inclusion rule, Evaluate the gate and Close the
// parent below the floor sections, under work-backend: github-issues (#4599 —
// the reconciler runs it for a PR GitHub merged after its session ended). The
// prose is the source of truth; this file follows its order and skip rules, and
// composeCloseComment's template is pinned to the prose's text by
// tests/bin-lib/issues/below-floor-parent-close.test.js (a prose-code twin).
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
// Every gh call goes through the injected `gh(args, input?)`, which returns
// stdout and throws on failure. A failing call skips that one parent (named in
// `skipped`, reason `gh-failed`) and the next closing record is still
// processed; a failing default-branch read skips the whole step, and so does a
// `riskFloor` outside the policy schema's risk-floor enum (`invalid-risk-floor`, no gh call).
// Never throws.
'use strict';

const { fetchNativeParent } = require('./native-dependencies');
const { parseSubIssues } = require('./record');
const { parseRecordFacets, normalizeLabelNames, LABELS } = require('./record-vocabulary');
const { parentGateState } = require('./acceptance');
const { maxRiskTier, exceedsOversightFloor } = require('./oversight-floor');
const { isTrustedComment, untrustedSkipNote } = require('./comment-trust');
const { POLICY_KEYS } = require('../policy-schema');

const CLOSE_HEADING = '## Closed below the oversight floor';
const NOT_PLANNED_LINE = 'No sub-issue closed as completed, so this parent closes as not planned.';
// The floor values `exceedsOversightFloor` evaluates, read from the policy schema's
// `risk-floor` enum so a new value there is never rejected here. `null` (and undefined) must not
// reach it: a null floor switches the unscored check off too, which would close a
// parent whose sub-issues carry no risk label.
const VALID_RISK_FLOORS = POLICY_KEYS.find((k) => k.key === 'risk-floor').values;
const HEADING_LINE_RE = /^## Closed below the oversight floor\s*$/m;
const PARENT_LINE_RE = /^Parent: #(\d+)/m;

// Thrown for a failing or unreadable gh call, so a parent skipped as
// `gh-failed` is distinguishable from a bug in this file.
class GhFailure extends Error {}

// { maxTier, riskFloor, notPlanned, lines } -> the closing comment text.
// `lines` are already-rendered `- #{n} {title}[ — closed by PR #{pr}]` strings.
function composeCloseComment({ maxTier, riskFloor, notPlanned, lines } = {}) {
  const intro = `Every sub-issue of this decomposition is closed, and the highest sub-issue risk, \`risk:${maxTier}\`, does not exceed the resolved \`risk-floor\` (\`${riskFloor}\`), so no Verification Brief or \`demo:pending\` sign-off is owed.`;
  const parts = [CLOSE_HEADING, intro];
  if (notPlanned) parts.push(NOT_PLANNED_LINE);
  if (lines && lines.length) parts.push(lines.join('\n'));
  return `${parts.join('\n\n')}\n`;
}

function normalizeSet(values) {
  const numbers = Array.from(values || []).map(Number).filter(Number.isInteger);
  return new Set(numbers);
}

function closeBelowFloorParents({
  closingSet, unsettled, mergingPr, owner, repo, workLinks, riskFloor, integrationBranch, gh, selfInclude = true,
} = {}) {
  const closed = [];
  const skipped = [];
  if (!VALID_RISK_FLOORS.includes(riskFloor)) {
    skipped.push({ reason: 'invalid-risk-floor' });
    return { closed, skipped };
  }
  try {
    const call = (args, input) => {
      try {
        return gh(args, input);
      } catch (err) {
        throw new GhFailure(`gh ${args.slice(0, 3).join(' ')}: ${err && err.message}`);
      }
    };
    const callJson = (args) => {
      const out = call(args);
      try {
        return JSON.parse(out);
      } catch (err) {
        throw new GhFailure(`gh ${args.slice(0, 3).join(' ')}: unparseable output (${err.message})`);
      }
    };
    const slug = `${owner}/${repo}`;
    const closing = normalizeSet(closingSet);
    const unsettledSet = normalizeSet(unsettled);

    // Default-branch check, once: GitHub closes `Fixes #N` records only on the
    // default branch, so a merge into any other branch leaves its sub-issues
    // open and counting them CLOSED would close the parent early.
    let defaultBranch;
    try {
      defaultBranch = String(call(['repo', 'view', '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'])).trim();
    } catch (err) {
      skipped.push({ reason: 'gh-failed', detail: err.message });
      return { closed, skipped };
    }
    if (!defaultBranch) {
      skipped.push({ reason: 'gh-failed', detail: 'empty default branch' });
      return { closed, skipped };
    }
    if (defaultBranch !== integrationBranch) {
      skipped.push({ reason: 'non-default-branch' });
      return { closed, skipped };
    }

    const resolveParent = (n) => {
      if (workLinks === 'body-text') {
        const match = PARENT_LINE_RE.exec(String(call(['issue', 'view', String(n), '--json', 'body', '-q', '.body'])));
        return match ? Number(match[1]) : null;
      }
      // fetchNativeParent throws only for a failed or malformed GraphQL read.
      try {
        return fetchNativeParent({ number: n, owner, repo, runner: (args) => call(args) });
      } catch (err) {
        throw err instanceof GhFailure ? err : new GhFailure(`gh api graphql (parent): ${err.message}`);
      }
    };

    const enumerateSubIssues = (parent) => {
      if (workLinks === 'body-text') {
        return parseSubIssues(String(call(['issue', 'view', String(parent), '--json', 'body', '-q', '.body'])));
      }
      const out = String(call(['api', '--paginate', `repos/${owner}/${repo}/issues/${parent}/sub_issues`, '--jq', '.[].number']));
      return out.split('\n').map((line) => Number(line.trim())).filter((v, i, all) => Number.isInteger(v) && v > 0 && all.indexOf(v) === i);
    };

    const handled = new Set();
    for (const n of [...closing].sort((a, b) => a - b)) {
      let parent = null;
      try {
        parent = resolveParent(n);
        if (parent === null || parent === undefined) continue; // no resolvable parent: a silent no-op
        if (handled.has(parent)) continue; // each parent is evaluated once
        handled.add(parent);

        const subNumbers = enumerateSubIssues(parent).sort((a, b) => a - b);
        const subIssues = subNumbers.map((num) => {
          const live = callJson(['issue', 'view', String(num), '--repo', slug, '--json', 'state,stateReason,labels,title,closedByPullRequestsReferences']);
          const inClosingSet = closing.has(num);
          const selfIncluded = selfInclude && inClosingSet;
          const refs = Array.isArray(live.closedByPullRequestsReferences) ? live.closedByPullRequestsReferences : [];
          const lastRef = refs.length ? refs[refs.length - 1] : null;
          return {
            number: num,
            // Self-inclusion: the merge closing these records may not show on
            // GitHub yet, so each closing-set member counts CLOSED/COMPLETED
            // (unless the caller opted out with selfInclude: false; see the header).
            state: selfIncluded ? 'CLOSED' : String(live.state || '').toUpperCase(),
            stateReason: selfIncluded ? 'COMPLETED' : String(live.stateReason || '').toUpperCase(),
            title: String(live.title || '').trim(),
            facets: parseRecordFacets(live.labels),
            pr: inClosingSet && mergingPr ? mergingPr : (lastRef && lastRef.number) || null,
          };
        });

        const parentLabels = normalizeLabelNames(callJson(['issue', 'view', String(parent), '--json', 'labels', '-q', '[.labels[].name]']));
        if (!parentLabels.includes(LABELS.PARENT_ISSUE)) {
          skipped.push({ parent, reason: 'not-parent-issue-labeled' });
          continue;
        }
        if (parentLabels.some((name) => name.startsWith('needs:'))) {
          skipped.push({ parent, reason: 'needs-label' });
          continue;
        }
        if (subIssues.some((s) => unsettledSet.has(s.number))) {
          skipped.push({ parent, reason: 'sibling-unsettled' });
          continue;
        }

        const gate = parentGateState({ subIssues, parentLabels });
        if (gate !== 'due') {
          skipped.push({ parent, reason: gate });
          continue;
        }
        const maxTier = maxRiskTier(subIssues.map((s) => s.facets));
        // sizeFloor is the literal null: parents carry no size scoring of their own.
        if (exceedsOversightFloor({ risk: maxTier }, { riskFloor, sizeFloor: null }).exceeds) {
          skipped.push({ parent, reason: 'above-floor' });
          continue;
        }

        // Idempotence: read before writing anything.
        const live = callJson(['issue', 'view', String(parent), '--json', 'state,stateReason,comments']);
        if (String(live.state).toUpperCase() === 'CLOSED') {
          skipped.push({ parent, reason: 'already-closed' });
          continue;
        }
        if (String(live.stateReason).toUpperCase() === 'REOPENED') {
          skipped.push({ parent, reason: 'reopened-by-human' });
          continue;
        }
        const login = String(call(['api', 'user', '--jq', '.login'])).trim();
        let alreadyCommented = false;
        const notes = [];
        for (const comment of Array.isArray(live.comments) ? live.comments : []) {
          if (!comment || !HEADING_LINE_RE.test(String(comment.body || ''))) continue;
          const author = comment.author && comment.author.login;
          if (isTrustedComment(comment) || (login && author === login)) alreadyCommented = true;
          else notes.push(untrustedSkipNote(comment));
        }

        const notPlanned = !subIssues.some((s) => s.stateReason === 'COMPLETED');
        if (!alreadyCommented) {
          const lines = subIssues.map((s) => `- #${s.number}${s.title ? ` ${s.title}` : ''}${s.pr ? ` — closed by PR #${s.pr}` : ''}`);
          call(['issue', 'comment', String(parent), '--body-file', '-'], composeCloseComment({ maxTier, riskFloor, notPlanned, lines }));
        }
        call(['issue', 'close', String(parent), '--reason', notPlanned ? 'not planned' : 'completed']);
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

module.exports = { CLOSE_HEADING, composeCloseComment, closeBelowFloorParents };
