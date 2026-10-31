'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  dispositionState,
  verificationSurface,
  needsBackstop,
  parentGateState,
  closedParentGap,
  approvalProvenance,
  APPROVAL_PROVENANCE_LABEL,
  APPROVAL_PROVENANCE_LABELS,
} = require('../../../plugin/bin/lib/issues/acceptance.js');
const { parseRecordFacets } = require('../../../plugin/bin/lib/issues/record-vocabulary.js');

test('dispositionState reads each acceptance label', () => {
  assert.equal(dispositionState(['demo:pending']), 'pending');
  assert.equal(dispositionState(['demo:approved']), 'approved');
  assert.equal(dispositionState(['demo:changes-requested']), 'changes-requested');
});

test('dispositionState returns none when no acceptance label is present', () => {
  assert.equal(dispositionState(['ready', 'type:bug']), 'none');
  assert.equal(dispositionState([]), 'none');
  assert.equal(dispositionState(undefined), 'none');
});

test('changes-requested wins over a stale demo:pending; pending now wins over approved', () => {
  // /demo removes demo:pending as it adds the verdict, but a partial write or a
  // concurrent edit can leave both. changes-requested must never be re-swept.
  // Human ruling at plan time (#4610): one precedence rule across both
  // vocabularies — changes-requested > pending > approved > none. These are the
  // deliberate exceptions to AC7 ("no demo:* behaviour changes"). For
  // dispositionState, which used a first-match table (approved, changes-requested,
  // pending), two demo:*-only pairs change: demo:pending + demo:approved now
  // resolves 'pending' (previously 'approved'), and demo:approved +
  // demo:changes-requested now resolves 'changes-requested' (previously 'approved';
  // pinned in AC3.1 below). For parseRecordFacets, which was last-match-wins, every
  // demo:* pair that used to depend on array order now resolves by precedence, e.g.
  // ['demo:changes-requested', 'demo:pending'] was 'pending' and is now
  // 'changes-requested'.
  assert.equal(dispositionState(['demo:pending', 'demo:approved']), 'pending');
  assert.equal(dispositionState(['demo:pending', 'demo:changes-requested']), 'changes-requested');
});

for (const x of ['pending', 'approved', 'changes-requested']) {
  test(`AC1.1: accept:${x} resolves the same disposition and facet as demo:${x}`, () => {
    assert.equal(dispositionState([`accept:${x}`]), x);
    assert.equal(dispositionState([`demo:${x}`]), x);
    assert.equal(parseRecordFacets([`accept:${x}`]).acceptance, x);
    assert.equal(parseRecordFacets([`demo:${x}`]).acceptance, x);
  });
}

test('AC3.1: mixed labels resolve to one disposition, most conservative first', () => {
  for (const [labels, want] of [
    [['accept:pending', 'demo:changes-requested'], 'changes-requested'],
    [['accept:approved', 'demo:changes-requested'], 'changes-requested'],
    [['accept:approved', 'demo:pending'], 'pending'],
    [['accept:approved', 'demo:approved'], 'approved'],
    [['accept:pending', 'accept:approved'], 'pending'],
    [['demo:pending', 'demo:approved'], 'pending'],
    [['demo:approved', 'demo:changes-requested'], 'changes-requested'],
    [['accept:approved', 'accept:changes-requested'], 'changes-requested'],
  ]) {
    assert.equal(dispositionState(labels), want, labels.join('+'));
    assert.equal(dispositionState([...labels].reverse()), want, `reversed ${labels.join('+')}`);
    assert.equal(parseRecordFacets(labels).acceptance, want, labels.join('+'));
    assert.equal(parseRecordFacets([...labels].reverse()).acceptance, want, `reversed ${labels.join('+')}`);
  }
});

test('AC3.2: accept:approved-batch is batch provenance, like demo:approved-batch', () => {
  assert.equal(approvalProvenance(['accept:approved', 'accept:approved-batch']), 'batch');
  assert.equal(approvalProvenance(['demo:approved', 'accept:approved-batch']), 'batch');
  assert.equal(approvalProvenance(['accept:approved']), 'walkthrough');
  assert.equal(approvalProvenance(['accept:pending', 'accept:approved-batch']), null);
  assert.deepEqual(APPROVAL_PROVENANCE_LABELS, ['demo:approved-batch', 'accept:approved-batch']);
});

test('verificationSurface treats docs, skills, bin and config as non-interactive', () => {
  assert.equal(verificationSurface(['docs/plugin-structure.md']), 'non-interactive');
  assert.equal(verificationSurface(['skills/tidy/SKILL.md']), 'non-interactive');
  assert.equal(verificationSurface(['bin/lib/issues/acceptance.js']), 'non-interactive');
  assert.equal(verificationSurface(['.claude-plugin/plugin.json']), 'non-interactive');
});

// #418 — the plugin payload moved under `plugin/`. A work record or diff predating that
// cutover cites `skills/…`/`bin/…`; one after it cites `plugin/skills/…`/`plugin/bin/…`.
// Both spellings must classify identically: the test above pins the pre-cutover spelling,
// this one the post-cutover spelling, so an old record stays classifiable and a new
// payload-only diff does not read as an interactive UI surface (which would send /demo
// off on a browser walk with nothing to walk).
test('verificationSurface classifies the post-cutover plugin/ payload spelling the same way', () => {
  assert.equal(verificationSurface(['plugin/skills/tidy/SKILL.md']), 'non-interactive');
  assert.equal(verificationSurface(['plugin/bin/lib/issues/acceptance.js']), 'non-interactive');
  assert.equal(verificationSurface(['plugin/.claude-plugin/plugin.json']), 'non-interactive');
  assert.equal(verificationSurface(['plugin/bin/hooks.js', 'plugin/hooks/hooks.json']), 'non-interactive');
});

// Negative control for the test above: only the payload directories gain the `plugin/`
// spelling. A consumer project that happens to keep UI code under its own `plugin/`
// directory must still read as interactive — a blanket `^plugin/` rule would silently
// skip acceptance verification for it.
test('a non-payload plugin/ path in a consumer project is still interactive', () => {
  assert.equal(verificationSurface(['plugin/src/components/Button.tsx']), 'interactive');
  assert.equal(verificationSurface(['plugin/app/dashboard/page.tsx']), 'interactive');
});

test('verificationSurface treats stories and journeys as interactive despite being markdown', () => {
  assert.equal(verificationSurface(['docs/journeys/checkout.md']), 'interactive');
  assert.equal(verificationSurface(['stories/login.md']), 'interactive');
});

test('verificationSurface is interactive when any path is a UI surface', () => {
  assert.equal(verificationSurface(['docs/a.md', 'src/components/Button.tsx']), 'interactive');
});

// The classifier deliberately carries no "backend code with no route/component/page"
// category — see the NON_INTERACTIVE comment in acceptance.js. These pin the boundary so a
// later prefix (`^src/`, `^lib/`, `^app/`) cannot be added without confronting the UI cases
// it would silently reclassify.
test('backend-looking project paths still classify as interactive', () => {
  assert.equal(verificationSurface(['docs/a.md', 'src/services/payments.ts']), 'interactive');
  assert.equal(verificationSurface(['app/api/orders/route.ts']), 'interactive');
  assert.equal(verificationSurface(['lib/db/client.ts']), 'interactive');
  assert.equal(verificationSurface(['internal/billing/charge.go']), 'interactive');
});

test('a backend prefix would have to reclassify these UI paths to work', () => {
  assert.equal(verificationSurface(['src/components/Button.tsx']), 'interactive');
  assert.equal(verificationSurface(['lib/ui/Modal.svelte']), 'interactive');
  assert.equal(verificationSurface(['app/dashboard/page.tsx']), 'interactive');
});

test('verificationSurface defaults to non-interactive for an empty path list', () => {
  assert.equal(verificationSurface([]), 'non-interactive');
  assert.equal(verificationSurface(undefined), 'non-interactive');
});

test('needsBackstop fires only for a closed record with no disposition', () => {
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [] }), true);
  assert.equal(needsBackstop({ state: 'CLOSED', labels: ['demo:approved'] }), false);
  assert.equal(needsBackstop({ state: 'OPEN', labels: [] }), false);
  assert.equal(needsBackstop(undefined), false);
});

test('needsBackstop suppresses a closed leaf that belongs to a family', () => {
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], hasParent: true }), false);
});

test('needsBackstop is unchanged when hasParent is absent or not literally true', () => {
  // Explicit-boolean check, not truthiness of a default object — an absent field
  // must preserve today's behavior for human-filed and /capture'd records.
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [] }), true);
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], hasParent: false }), true);
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], hasParent: undefined }), true);
});

test('needsBackstop excludes a NOT_PLANNED closure even with no disposition', () => {
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], stateReason: 'NOT_PLANNED' }), false);
});

test('needsBackstop excludes a DUPLICATE closure even with no disposition', () => {
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], stateReason: 'DUPLICATE' }), false);
});

test('needsBackstop still fires for a COMPLETED closure with no disposition', () => {
  // A normal completed-merge closure must not be swept up by the new branch.
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], stateReason: 'COMPLETED' }), true);
});

test('needsBackstop returns false for NOT_PLANNED even when already dispositioned', () => {
  // The two suppression paths (stateReason and disposition) must agree, not conflict.
  assert.equal(
    needsBackstop({ state: 'CLOSED', labels: ['demo:approved'], stateReason: 'NOT_PLANNED' }),
    false,
  );
});

test('needsBackstop suppresses a NOT_PLANNED sub-issue too (both reasons compose)', () => {
  assert.equal(
    needsBackstop({ state: 'CLOSED', labels: [], stateReason: 'NOT_PLANNED', hasParent: true }),
    false,
  );
});

const CLOSED = (n) => ({ number: n, state: 'CLOSED' });
const OPEN = (n) => ({ number: n, state: 'OPEN' });

test('parentGateState is incomplete while any sub-issue is open', () => {
  assert.equal(parentGateState({ subIssues: [CLOSED(1), OPEN(2)], parentLabels: [] }), 'incomplete');
});

test('parentGateState is due when every sub-issue is closed and the parent is unlabelled', () => {
  assert.equal(parentGateState({ subIssues: [CLOSED(1), CLOSED(2)], parentLabels: [] }), 'due');
});

test('parentGateState is gated once the parent carries demo:pending', () => {
  assert.equal(parentGateState({ subIssues: [CLOSED(1)], parentLabels: ['demo:pending'] }), 'gated');
});

test('parentGateState is resolved once a verdict is recorded', () => {
  assert.equal(parentGateState({ subIssues: [CLOSED(1)], parentLabels: ['demo:approved'] }), 'resolved');
  assert.equal(
    parentGateState({ subIssues: [CLOSED(1)], parentLabels: ['demo:changes-requested'] }),
    'resolved',
  );
});

test('parentGateState reads a parent carrying demo:pending + demo:approved as gated (#4610 ruling)', () => {
  // Consumer-level effect of the plan-time human ruling (#4610): the parent's
  // label is the authoritative record, and pending now beats approved, so a
  // parent left with both labels is gated again where it used to read
  // 'resolved'. changes-requested still wins over pending, so that pair stays
  // resolved.
  assert.equal(
    parentGateState({ subIssues: [CLOSED(1)], parentLabels: ['demo:pending', 'demo:approved'] }),
    'gated',
  );
  assert.equal(
    parentGateState({ subIssues: [CLOSED(1)], parentLabels: ['demo:approved', 'demo:pending'] }),
    'gated',
  );
  assert.equal(
    parentGateState({ subIssues: [CLOSED(1)], parentLabels: ['demo:pending', 'demo:changes-requested'] }),
    'resolved',
  );
});

test('parentGateState reports gated even if a sub-issue reopens after gating', () => {
  // The label is the authoritative record of what was applied; a reopened sub-issue
  // must not cause the sweep to re-gate an already-gated parent.
  assert.equal(parentGateState({ subIssues: [OPEN(1)], parentLabels: ['demo:pending'] }), 'gated');
});

test('parentGateState never reports due for a parent with no discoverable sub-issues', () => {
  // A parent whose sub-issues cannot be resolved is a resolution failure, not a
  // complete parent — gating it would demand a verdict on work nobody built.
  assert.equal(parentGateState({ subIssues: [], parentLabels: [] }), 'incomplete');
  assert.equal(parentGateState({}), 'incomplete');
  assert.equal(parentGateState(), 'incomplete');
});

test('approvalProvenance is null for a record with no approved disposition', () => {
  assert.equal(approvalProvenance(['demo:pending']), null);
  assert.equal(approvalProvenance(['demo:changes-requested']), null);
  assert.equal(approvalProvenance([]), null);
  assert.equal(approvalProvenance(undefined), null);
});

test('approvalProvenance reads walkthrough by default on an approved record', () => {
  // Orthogonal-category check: a demo:approved record carrying an unrelated
  // label (ready) still reads walkthrough-backed absent the batch marker —
  // this is the backward-compatible default for every demo:approved label
  // applied before the provenance signal existed.
  assert.equal(approvalProvenance(['demo:approved']), 'walkthrough');
  assert.equal(approvalProvenance(['demo:approved', 'ready']), 'walkthrough');
});

test('approvalProvenance reads batch when the marker label is present', () => {
  assert.equal(APPROVAL_PROVENANCE_LABEL, 'demo:approved-batch');
  assert.equal(approvalProvenance(['demo:approved', 'demo:approved-batch']), 'batch');
});

test('approvalProvenance ignores the batch marker on a non-approved record', () => {
  // The marker only ever means something stacked alongside demo:approved — a
  // stray demo:approved-batch label with no demo:approved is not itself an
  // approval, so this must not be misread as one.
  assert.equal(approvalProvenance(['demo:approved-batch']), null);
  assert.equal(approvalProvenance(['demo:pending', 'demo:approved-batch']), null);
});

test('AC4.1: needsBackstop excludes a decomposition parent', () => {
  // A parent closed below the oversight floor (#4466) is closed by the pipeline with its own
  // closing comment — its acceptance is the parent gate's, never an acceptance-gap row.
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], isParent: true }), false);
  // Controls: the same record without the flag (false or absent) is still a gap.
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], isParent: false }), true);
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [] }), true);
});

test('AC1.1: needsBackstop admits a closed parent the caller shows above the floor', () => {
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], isParent: true, parentExceedsFloor: true }), true);
  assert.equal(needsBackstop({ state: 'CLOSED', labels: ['demo:approved'], isParent: true, parentExceedsFloor: true }), false);
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], isParent: true, parentExceedsFloor: true, stateReason: 'NOT_PLANNED' }), false);
  assert.equal(needsBackstop({ state: 'OPEN', labels: [], isParent: true, parentExceedsFloor: true }), false);
});

test('AC2.1: needsBackstop keeps a parent at or below the floor excluded', () => {
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], isParent: true, parentExceedsFloor: false }), false);
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], isParent: true, parentExceedsFloor: 'true' }), false);
  assert.equal(needsBackstop({ state: 'CLOSED', labels: [], isParent: true }), false);
});

test('AC1.1: closedParentGap reports a hand-closed parent above the floor', () => {
  const high = [{ risk: 'high' }, { risk: 'low' }];
  assert.equal(closedParentGap({ parentLabels: [], stateReason: 'COMPLETED', subIssues: high, riskFloor: 'high' }), 'gap');
  // Unscored fails closed.
  assert.equal(closedParentGap({ parentLabels: [], subIssues: [{ risk: null }], riskFloor: 'high' }), 'gap');
  // Disposition, not planned and duplicate are never a gap.
  assert.equal(closedParentGap({ parentLabels: ['demo:approved'], subIssues: high, riskFloor: 'high' }), 'none');
  assert.equal(closedParentGap({ parentLabels: ['accept:pending'], subIssues: high, riskFloor: 'high' }), 'none');
  assert.equal(closedParentGap({ parentLabels: [], stateReason: 'NOT_PLANNED', subIssues: high, riskFloor: 'high' }), 'none');
  assert.equal(closedParentGap({ parentLabels: [], stateReason: 'DUPLICATE', subIssues: high, riskFloor: 'high' }), 'none');
});

test('AC2.1: closedParentGap excludes a #4466-closed parent before the floor', () => {
  // Relabelled to risk:high after the close: the marker still excludes it (Decision Q1).
  assert.equal(closedParentGap({ parentLabels: [], belowFloorClose: true, subIssues: [{ risk: 'high' }], riskFloor: 'high' }), 'none');
  // Control: the same parent without the marker is a gap.
  assert.equal(closedParentGap({ parentLabels: [], belowFloorClose: false, subIssues: [{ risk: 'high' }], riskFloor: 'high' }), 'gap');
  // Below the floor with no marker (hand-closed below the floor): no sign-off owed.
  assert.equal(closedParentGap({ parentLabels: [], subIssues: [{ risk: 'medium' }], riskFloor: 'high' }), 'none');
});

test('AC1.1: closedParentGap applies the caller\'s risk floor, not a fixed one', () => {
  const medium = [{ risk: 'medium' }];
  assert.equal(closedParentGap({ parentLabels: [], subIssues: medium, riskFloor: 'high' }), 'none');
  assert.equal(closedParentGap({ parentLabels: [], subIssues: medium, riskFloor: 'medium' }), 'gap');
  assert.equal(closedParentGap({ parentLabels: [], subIssues: [{ risk: 'low' }], riskFloor: 'always' }), 'gap');
  // The marker still wins over every floor.
  assert.equal(closedParentGap({ parentLabels: [], belowFloorClose: true, subIssues: medium, riskFloor: 'always' }), 'none');
});

test('closedParentGap reports an unreadable parent instead of guessing', () => {
  assert.equal(closedParentGap({ parentLabels: [], subIssues: [], riskFloor: 'high' }), 'no-sub-issues');
  assert.equal(closedParentGap({ parentLabels: [], riskFloor: 'high' }), 'no-sub-issues');
  // A readable sub-issue already above the floor proves the gap: an unread one can only raise the max.
  assert.equal(closedParentGap({ parentLabels: [], subIssues: [{ risk: 'high' }, { risk: null, unread: true }], riskFloor: 'high' }), 'gap');
  // Readable ones below the floor: indeterminate, never a guessed row.
  assert.equal(closedParentGap({ parentLabels: [], subIssues: [{ risk: 'low' }, { risk: null, unread: true }], riskFloor: 'high' }), 'unread-sub-issue');
  assert.equal(closedParentGap({ parentLabels: [], subIssues: [{ risk: null, unread: true }], riskFloor: 'high' }), 'unread-sub-issue');
  // The disposition and marker checks run first: an approved or #4466-closed parent is never counted.
  assert.equal(closedParentGap({ parentLabels: ['demo:approved'], subIssues: [], riskFloor: 'high' }), 'none');
  assert.equal(closedParentGap({ parentLabels: [], belowFloorClose: true, subIssues: [], riskFloor: 'high' }), 'none');
});

test('closedParentGap treats an unbuildable sub-issue entry as unread, not unscored', () => {
  assert.equal(closedParentGap({ parentLabels: [], subIssues: [null, { risk: 'low' }], riskFloor: 'high' }), 'unread-sub-issue');
  assert.equal(closedParentGap({ parentLabels: [], subIssues: [null, { risk: 'high' }], riskFloor: 'high' }), 'gap');
  assert.equal(closedParentGap({ parentLabels: [], subIssues: ['high', { risk: 'low' }], riskFloor: 'high' }), 'unread-sub-issue');
});

test('closedParentGap excludes on the marker only for literal true', () => {
  assert.equal(closedParentGap({ parentLabels: [], belowFloorClose: 'true', subIssues: [{ risk: 'high' }], riskFloor: 'high' }), 'gap');
});
