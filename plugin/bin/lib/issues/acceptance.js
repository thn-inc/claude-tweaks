'use strict';

const { acceptanceOf } = require('./record-vocabulary');
const { exceedsOversightFloor, maxRiskTier } = require('./oversight-floor');

// Paths with no interactive verification surface. This module is the source of that
// classification — skills/demo/SKILL.md Step 1's closing-commit reconstruction fallback,
// and the acceptance-gap sweep on both work-record drivers (_shared/github-pr-scan.md's scope
// under github-issues, skills/tidy/step-1-records.md's Shape 8 under local-files) all call in
// rather than restate it.
//
// Deliberately absent: "backend code with no route/component/page touched." That category is
// not decidable from a path list. In the layouts this runs against, UI and backend share a
// root (`src/`, `lib/`, `app/`), so any prefix broad enough to catch `src/services/pay.ts`
// also catches `src/components/Button.tsx`. Anything unmatched below falls through to
// `interactive` — that costs a browser walk which finds nothing, whereas a wrong
// non-interactive match skips acceptance verification silently. That asymmetry is why the
// category stays out rather than being half-covered by prefixes.
//
// Payload paths are spelled two ways across this plugin's own `plugin/` payload cutover
// (#418): a record or diff predating it cites `skills/…`/`bin/…`/`.claude-plugin/…`, one
// after it cites `plugin/skills/…`/`plugin/bin/…`/`plugin/.claude-plugin/…`. Both spellings
// are listed explicitly rather than folded into an optional-prefix regex, because the
// prefix is NOT generic: only the payload directories moved. `docs/`, `tests/` and `perf/`
// stayed at the repo root, and a consumer project's own `plugin/src/...` must keep falling
// through to `interactive`.
const NON_INTERACTIVE = [
  /^docs\//,
  /^\.claude/,
  /^plugin\/\.claude/,
  /^skills\/.*\.md$/,
  /^plugin\/skills\/.*\.md$/,
  /^bin\//,
  /^plugin\/bin\//,
  /^tests\//,
  /^perf\//,
  /\.(ya?ml|json|toml|tsv)$/,
  /\.md$/,
];

// Markdown that IS a user-facing surface, checked before NON_INTERACTIVE so the
// broad `^docs/` and `\.md$` patterns cannot claim it first.
const INTERACTIVE_PATHS = [/^stories\//, /^docs\/journeys\//];

function dispositionState(labels) {
  const names = Array.isArray(labels) ? labels : [];
  return acceptanceOf(names) ?? 'none';
}

// Provenance modifier for an 'approved' disposition — always stacked alongside
// demo:approved or accept:approved, never its own disposition state (acceptanceOf
// never matches it). /claude-tweaks:demo's Step 3 Approve action applies
// this label only for a #N,#M batch-invocation verdict; a single-record verdict
// (bare #N, or no-argument session-recall) leaves it off — both run the same
// per-item walkthrough, so this marks which invocation shape produced the
// verdict, not whether a walkthrough happened. A record whose demo:approved
// predates this signal (or was applied by any other path) carries no marker
// and reads as 'walkthrough' (single-record-backed) — the safer default, since
// promoting an unlabeled historical approval to 'batch' would understate
// coverage rather than overstate it (bin/lib/issues/trust.js's sole consumer).
const APPROVAL_PROVENANCE_LABEL = 'demo:approved-batch';
// Both spellings of the batch marker are read until the contract step (#4625)
// retires demo:*, on the condition #4613 records.
const APPROVAL_PROVENANCE_LABELS = [APPROVAL_PROVENANCE_LABEL, 'accept:approved-batch'];

function approvalProvenance(labels) {
  if (dispositionState(labels) !== 'approved') return null;
  const names = Array.isArray(labels) ? labels : [];
  return APPROVAL_PROVENANCE_LABELS.some((label) => names.includes(label)) ? 'batch' : 'walkthrough';
}

function verificationSurface(changedPaths) {
  const paths = (Array.isArray(changedPaths) ? changedPaths : []).filter(Boolean);
  const anyInteractive = paths.some((path) => {
    if (INTERACTIVE_PATHS.some((re) => re.test(path))) return true;
    return !NON_INTERACTIVE.some((re) => re.test(path));
  });
  return anyInteractive ? 'interactive' : 'non-interactive';
}

function needsBackstop(record) {
  if (!record || record.state !== 'CLOSED') return false;
  // A not-planned or duplicate closure has nothing to accept — it is not a gap at all.
  if (record.stateReason === 'NOT_PLANNED' || record.stateReason === 'DUPLICATE') return false;
  // A decomposed sub-issue's acceptance lives on its parent issue, not on itself.
  if (record.hasParent === true) return false;
  // A decomposition parent's acceptance is the parent gate's, never an acceptance-gap row —
  // unless the caller shows it above the oversight floor (closedParentGap), where a hand-close
  // left no disposition. The flag is literal `true` only; absent keeps every parent excluded.
  if (record.isParent === true && record.parentExceedsFloor !== true) return false;
  return dispositionState(record.labels) === 'none';
}

// A parent issue's acceptance state across its sub-issues. Reads the parent's own label first:
// the label is the authoritative record of what has already been applied, so a
// sub-issue reopening after the gate went on never re-opens the gating decision.
function parentGateState({ subIssues, parentLabels } = {}) {
  const disposition = dispositionState(parentLabels);
  if (disposition === 'approved' || disposition === 'changes-requested') return 'resolved';
  if (disposition === 'pending') return 'gated';

  const all = Array.isArray(subIssues) ? subIssues : [];
  if (all.length === 0) return 'incomplete';
  return all.every((subIssue) => subIssue && subIssue.state === 'CLOSED') ? 'due' : 'incomplete';
}

// Whether a closed decomposition parent is an acceptance gap (#4600). A parent's acceptance is
// the parent gate's: below the floor, #4466 closes it with a durable `## Closed below the
// oversight floor` marker and owes no sign-off, and that marker (belowFloorClose), not a
// scan-time recomputation, is what excludes it. Above the floor the disposition is
// /claude-tweaks:demo's. A parent whose sub-issues cannot be read is reported to the caller,
// not guessed. `subIssues` is [{ risk, unread }]; `unread: true` marks an unreadable risk.
function closedParentGap({ parentLabels, stateReason, belowFloorClose, subIssues, riskFloor } = {}) {
  if (belowFloorClose === true) return 'none';
  const admitted = needsBackstop({
    state: 'CLOSED', labels: parentLabels, isParent: true, parentExceedsFloor: true, stateReason,
  });
  if (!admitted) return 'none';
  const all = Array.isArray(subIssues) ? subIssues : [];
  if (all.length === 0) return 'no-sub-issues';
  // An entry the caller could not build (null, non-object) is unknown, not unscored: unread.
  const readable = all.filter((subIssue) => (
    subIssue !== null && typeof subIssue === 'object' && subIssue.unread !== true
  ));
  const exceeds = exceedsOversightFloor(
    { risk: maxRiskTier(readable) }, { riskFloor, sizeFloor: null },
  ).exceeds;
  if (readable.length === all.length) return exceeds ? 'gap' : 'none';
  // An unread sub-issue can only raise the maximum, so a readable one above the floor proves the gap.
  return readable.length > 0 && exceeds ? 'gap' : 'unread-sub-issue';
}

module.exports = {
  dispositionState, verificationSurface, needsBackstop, parentGateState, closedParentGap,
  approvalProvenance, APPROVAL_PROVENANCE_LABEL, APPROVAL_PROVENANCE_LABELS,
};
