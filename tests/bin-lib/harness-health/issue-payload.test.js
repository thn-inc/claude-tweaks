const { test } = require('node:test');
const assert = require('node:assert');
const { toIssuePayload } = require('../../../plugin/bin/lib/harness-health/issue-payload');
const { extractFingerprint, extractVerifiedAsOf } = require('../../../plugin/bin/lib/issues/record');

function patchFinding(overrides = {}) {
  return {
    id: 'skillhealth-abc12345',
    kind: 'patch',
    target: 'auth',
    assetType: 'skill',
    category: 'drift',
    section: 'Key Patterns',
    classification: 'restructural',
    confidence: 'high',
    reversibility: 'med',
    description: 'Stale example path',
    oldString: 'See `src/auth/login.js`.',
    newString: 'See `src/auth/session.js`.',
    reason: 'login.js was renamed to session.js.',
    ...overrides,
  };
}

function newSkillFinding(overrides = {}) {
  return {
    id: 'skillhealth-def67890',
    kind: 'new-skill',
    target: 'queue-retry-pattern',
    assetType: 'skill',
    category: 'drift',
    classification: 'additive',
    confidence: 'med',
    reversibility: 'high',
    description: 'Three files implement retry-with-backoff with no skill covering it',
    proposedBody: '---\nname: queue-retry-pattern\n---\n# Queue Retry Pattern',
    reason: 'src/jobs/a.js, b.js, c.js all implement the same pattern independently.',
    ...overrides,
  };
}

// ── classification -> scoring axis fold (spec 15) ───────────────────────────

test('toIssuePayload for a restructural patch finding maps classification to risk:medium/size:high, ready, and appends the diagnostic label last', () => {
  const payload = toIssuePayload(patchFinding()); // classification: 'restructural'
  assert.deepStrictEqual(payload.labels, ['by:harness-health', 'risk:medium', 'size:high', 'ready', 'harness-health:restructural']);
  assert.ok(payload.title.includes('auth'));
  assert.ok(payload.body.includes('src/auth/login.js'));
  assert.ok(payload.body.includes('src/auth/session.js'));
});

test('toIssuePayload for an additive patch finding maps classification to risk:low/size:low', () => {
  const payload = toIssuePayload(patchFinding({ classification: 'additive' }));
  assert.deepStrictEqual(payload.labels, ['by:harness-health', 'risk:low', 'size:low', 'ready', 'harness-health:additive']);
});

test('toIssuePayload for a new-skill finding is unscored (no risk:*/size:* label) and uses the new-skill diagnostic label', () => {
  const payload = toIssuePayload(newSkillFinding());
  assert.deepStrictEqual(payload.labels, ['by:harness-health', 'ready', 'harness-health:new-skill']);
  assert.ok(!payload.labels.some((l) => l.startsWith('risk:') || l.startsWith('size:')), 'new-skill must carry no scoring label');
  assert.ok(payload.title.includes('queue-retry-pattern'));
  assert.ok(payload.body.includes('Queue Retry Pattern'));
});

test('toIssuePayload carries type: task for every kind', () => {
  assert.strictEqual(toIssuePayload(patchFinding()).type, 'task');
  assert.strictEqual(toIssuePayload(newSkillFinding()).type, 'task');
});

// ── fingerprint marker (work-fingerprint, not the legacy marker) ───────────

test('toIssuePayload body embeds the work-fingerprint marker, not the legacy harness-health-fingerprint marker', () => {
  const payload = toIssuePayload(patchFinding());
  assert.ok(payload.body.includes('<!-- work-fingerprint: skillhealth-abc12345 -->'));
  assert.ok(!payload.body.includes('harness-health-fingerprint'), 'legacy marker must not be emitted');
});

test('the fingerprint marker is re-extractable with extractFingerprint', () => {
  const payload = toIssuePayload(patchFinding());
  assert.strictEqual(extractFingerprint(payload.body), 'skillhealth-abc12345');
});

test('toIssuePayload body starts directly with the header line (no leading marker or blank line)', () => {
  const patch = toIssuePayload(patchFinding());
  assert.ok(patch.body.startsWith('**Skill:**'), `expected body to start with the header line, got: ${patch.body.slice(0, 40)}`);
  const newSkill = toIssuePayload(newSkillFinding());
  assert.ok(newSkill.body.startsWith('**New skill candidate**'), `expected body to start with the header line, got: ${newSkill.body.slice(0, 40)}`);
});

// ── body sections ────────────────────────────────────────────────────────

test('toIssuePayload body always includes Current State, Deliverables, Acceptance Criteria, and Release Note sections', () => {
  const payload = toIssuePayload(patchFinding());
  assert.ok(payload.body.includes('## Current State'));
  assert.ok(payload.body.includes('## Deliverables'));
  assert.ok(payload.body.includes('## Acceptance Criteria'));
  assert.ok(payload.body.includes('## Release Note'));
});

test('toIssuePayload body Release Note is a plain "no user-visible change" phrasing, including for new-skill candidates (#2660)', () => {
  const patch = toIssuePayload(patchFinding());
  assert.ok(patch.body.includes('No user-visible change — agent harness reliability fix.'));
  const newSkill = toIssuePayload(newSkillFinding());
  assert.ok(newSkill.body.includes('No user-visible change — agent harness reliability fix.'));
});

// ── preserved structured fields (Step 7 producer/consumer invariant) ───────

test('toIssuePayload for a patch finding carries structured decision fields matching the input finding', () => {
  const finding = patchFinding();
  const payload = toIssuePayload(finding);
  assert.strictEqual(payload.id, finding.id);
  assert.strictEqual(payload.kind, finding.kind);
  assert.strictEqual(payload.target, finding.target);
  assert.strictEqual(payload.assetType, finding.assetType);
  assert.strictEqual(payload.category, finding.category);
  assert.strictEqual(payload.classification, finding.classification);
  assert.strictEqual(payload.confidence, finding.confidence);
  assert.strictEqual(payload.reversibility, finding.reversibility);
});

// The patch text has exactly one carrier: payload.body's fenced Current/Proposed
// blocks (the markdown that actually ships to GitHub). Duplicating it as
// top-level fields made a payload with ~2.6 KB of patch text 38% duplicate
// bytes, uncapped across the findings array. Keep this in step with the
// identical test in tests/bin-lib/docs-health/issue-payload.test.js.
test('toIssuePayload does not duplicate the patch text as top-level fields', () => {
  const f = patchFinding();
  const payload = toIssuePayload(f);
  assert.ok(!('oldString' in payload), 'oldString must not be a top-level payload field — body already carries it');
  assert.ok(!('newString' in payload), 'newString must not be a top-level payload field — body already carries it');
  // body remains the carrier, so the patch text is never actually lost.
  assert.ok(payload.body.includes(f.oldString), 'body must still carry oldString verbatim');
  assert.ok(payload.body.includes(f.newString), 'body must still carry newString verbatim');
  assert.strictEqual(
    JSON.stringify(payload).split(f.newString).length - 1, 1,
    'newString must appear exactly once in the serialized payload',
  );
});

test('toIssuePayload for a new-skill finding carries structured decision fields matching the input finding', () => {
  const finding = newSkillFinding();
  const payload = toIssuePayload(finding);
  assert.strictEqual(payload.id, finding.id);
  assert.strictEqual(payload.kind, finding.kind);
  assert.strictEqual(payload.target, finding.target);
  assert.strictEqual(payload.assetType, finding.assetType);
  assert.strictEqual(payload.category, finding.category);
  assert.strictEqual(payload.classification, finding.classification);
  assert.strictEqual(payload.confidence, finding.confidence);
  assert.strictEqual(payload.reversibility, finding.reversibility);
});

// ── title formatting ─────────────────────────────────────────────────────

test('toIssuePayload title reflects asset type and category', () => {
  const rule = toIssuePayload(patchFinding({ assetType: 'rule', target: 'api-errors', section: 'paths glob' }));
  assert.ok(rule.title.startsWith('Rule drift:'), rule.title);

  const claudeMd = toIssuePayload(patchFinding({ assetType: 'claude-md', target: 'CLAUDE', section: 'Conventions', category: 'best-practice' }));
  assert.ok(claudeMd.title.startsWith('CLAUDE.md best-practice:'), claudeMd.title);
});

test('toIssuePayload title uses the Design Context label for a design-artifact finding', () => {
  const payload = toIssuePayload(patchFinding({
    assetType: 'design-artifact', target: 'PRODUCT', section: 'Freshness',
    oldString: 'Unaudited for 120 days', newString: 'Run /impeccable:impeccable init',
  }));
  assert.ok(payload.title.startsWith('Design Context drift:'), payload.title);
  assert.ok(payload.body.includes('Unaudited for 120 days'));
  assert.ok(payload.body.includes('Run /impeccable:impeccable init'));
});

test('toIssuePayload renders a Memory label for assetType: memory', () => {
  const payload = toIssuePayload({
    ...patchFinding({ assetType: 'memory', target: 'design-feedback-style' }),
    id: 'harnesshealth-abc12345',
  });
  assert.match(payload.title, /^Memory /);
});

// ── relatedSections rendering (bundled findings) ─────────────────────────────

test('toIssuePayload body includes an "Also affects" line when relatedSections is present on a patch finding', () => {
  const payload = toIssuePayload(patchFinding({ relatedSections: ['Key Patterns', 'Overview'] }));
  assert.ok(payload.body.includes('Also affects:'), 'missing Also affects block');
  assert.ok(payload.body.includes('`Key Patterns`'));
  assert.ok(payload.body.includes('`Overview`'));
});

test('toIssuePayload body omits "Also affects" when relatedSections is absent', () => {
  const payload = toIssuePayload(patchFinding());
  assert.ok(!payload.body.includes('Also affects:'));
});

test('toIssuePayload body omits "Also affects" when relatedSections is an empty array', () => {
  const payload = toIssuePayload(patchFinding({ relatedSections: [] }));
  assert.ok(!payload.body.includes('Also affects:'));
});

test('toIssuePayload for a new-skill finding never renders "Also affects" (no section to bundle by)', () => {
  const payload = toIssuePayload(newSkillFinding());
  assert.ok(!payload.body.includes('Also affects:'));
});

// ── fenced Current/Proposed blocks (a nested ``` in oldString/newString must
//    not prematurely close the outer fence) ─────────────────────────────────

test('toIssuePayload widens the Current/Proposed fence when oldString or newString itself contains a ``` fenced block', () => {
  const oldString = 'Example:\n```bash\necho hi\n```\nEnd.';
  const newString = 'Example:\n```bash\necho bye\n```\nEnd.';
  const payload = toIssuePayload(patchFinding({ oldString, newString }));

  // The outer fence must be longer than any backtick run inside the content
  // (here 3), so it opens with 4+ backticks, not exactly 3.
  const currentMatch = payload.body.match(/\*\*Current:\*\*\n(`{4,})\n/);
  assert.ok(currentMatch, `expected a >=4-backtick opening fence around Current, got: ${payload.body.slice(0, 200)}`);
  const proposedMatch = payload.body.match(/\*\*Proposed:\*\*\n(`{4,})\n/);
  assert.ok(proposedMatch, `expected a >=4-backtick opening fence around Proposed, got: ${payload.body}`);

  // The inner ``` sequences must survive intact inside the widened fence,
  // proving the outer fence did not close early.
  assert.ok(payload.body.includes(oldString), 'oldString with its own ``` block must be preserved verbatim');
  assert.ok(payload.body.includes(newString), 'newString with its own ``` block must be preserved verbatim');
});

test('toIssuePayload uses the minimal 3-backtick fence when oldString/newString contain no backticks', () => {
  const payload = toIssuePayload(patchFinding({ oldString: 'plain old text', newString: 'plain new text' }));
  assert.ok(payload.body.includes('**Current:**\n```\nplain old text\n```'));
  assert.ok(payload.body.includes('**Proposed:**\n```\nplain new text\n```'));
});

// --- removal findings (rule expiry) ------------------------------------------

function removalFinding(overrides = {}) {
  return {
    id: 'skillhealth-rm000001',
    kind: 'patch',
    target: 'CLAUDE',
    assetType: 'claude-md',
    category: 'drift',
    section: "Don'ts",
    intent: 'remove',
    classification: 'restructural',
    confidence: 'high',
    reversibility: 'high',
    description: 'Rule guards a hazard that can no longer occur',
    oldString: "- Don't call the legacy exporter directly `[IL-23]`",
    newString: '',
    reason: 'bin/lib/legacy-exporter.js was deleted in a1b2c3d.',
    ...overrides,
  };
}

test('a removal renders as a deletion, not an empty Proposed block', () => {
  const payload = toIssuePayload(removalFinding());
  assert.match(payload.body, /\*\*Remove this content:\*\*/);
  assert.match(payload.body, /delete it — nothing replaces it/);
  assert.ok(
    payload.body.includes("- Don't call the legacy exporter directly `[IL-23]`"),
    'the content being removed must appear verbatim so a reviewer can locate it',
  );
  // The bug this guards: the default branch would emit "**Proposed:**" followed
  // by an empty fence, which reads as a malformed finding rather than a delete.
  assert.ok(!/\*\*Proposed:\*\*\n```\n\n```/.test(payload.body), 'must not render an empty Proposed fence');
});

test('a removal title says it retires content', () => {
  const payload = toIssuePayload(removalFinding());
  assert.match(payload.title, /retire dead content in CLAUDE — Don't/);
});

test('intent survives into the payload for downstream consumers', () => {
  // Regression guard for the producer/consumer field-drop shape: a consumer
  // must be able to tell a deletion from a replacement without inferring it
  // from an empty newString.
  assert.strictEqual(toIssuePayload(removalFinding()).intent, 'remove');
  assert.strictEqual(toIssuePayload(patchFinding()).intent, undefined);
});

test('an ordinary patch still renders Current/Proposed', () => {
  const payload = toIssuePayload(patchFinding());
  assert.match(payload.body, /\*\*Current:\*\*/);
  assert.match(payload.body, /\*\*Proposed:\*\*/);
  assert.ok(!payload.body.includes('Remove this content'));
});

// ── freshness stamp (#117) ──────────────────────────────────────────────────

test('toIssuePayload with no verifiedAsOf argument omits the stamp (existing callers unaffected)', () => {
  const payload = toIssuePayload(patchFinding());
  assert.ok(!payload.body.includes('Verified-as-of:'));
});

test('toIssuePayload threads verifiedAsOf through to the composed body', () => {
  const payload = toIssuePayload(patchFinding(), 'abc1234');
  assert.strictEqual(extractVerifiedAsOf(payload.body), 'abc1234');
});

// ── Premise-check threading (#2621) ─────────────────────────────────────────

const { buildPremiseCheck } = require('../../../plugin/bin/lib/harness-health/issue-payload');
const { extractPremiseCheck } = require('../../../plugin/bin/lib/issues/record');

test('buildPremiseCheck for an additive patch checks for the proposed string\'s absence', () => {
  const finding = patchFinding({ oldString: 'old text', newString: 'new text' });
  const cmd = buildPremiseCheck(finding, '/repo/.claude/skills/auth.md');
  assert.strictEqual(cmd, "! grep -qF -- 'new text' '/repo/.claude/skills/auth.md'");
});

test('buildPremiseCheck for a removal checks for the old string\'s presence', () => {
  const finding = patchFinding({ intent: 'remove', oldString: 'old text', newString: '' });
  const cmd = buildPremiseCheck(finding, '/repo/CLAUDE.md');
  assert.strictEqual(cmd, "grep -qF -- 'old text' '/repo/CLAUDE.md'");
});

test('buildPremiseCheck single-quote-escapes an anchor string containing a literal quote', () => {
  const finding = patchFinding({ oldString: 'old', newString: "it's new" });
  const cmd = buildPremiseCheck(finding, '/repo/CLAUDE.md');
  assert.strictEqual(cmd, "! grep -qF -- 'it'\\''s new' '/repo/CLAUDE.md'");
});

test('buildPremiseCheck single-quote-escapes a target path containing a space', () => {
  const finding = patchFinding({ oldString: 'old', newString: 'new' });
  const cmd = buildPremiseCheck(finding, '/repo/my skills/auth.md');
  assert.strictEqual(cmd, "! grep -qF -- 'new' '/repo/my skills/auth.md'");
});

test('buildPremiseCheck returns undefined for a new-skill finding', () => {
  const finding = newSkillFinding();
  assert.strictEqual(buildPremiseCheck(finding, '/repo/.claude/skills/queue.md'), undefined);
});

test('buildPremiseCheck returns undefined when no target path was resolved', () => {
  const finding = patchFinding();
  assert.strictEqual(buildPremiseCheck(finding, null), undefined);
  assert.strictEqual(buildPremiseCheck(finding, undefined), undefined);
});

test('buildPremiseCheck returns undefined when the anchor string is multi-line', () => {
  const finding = patchFinding({ oldString: 'old', newString: 'line one\nline two' });
  assert.strictEqual(buildPremiseCheck(finding, '/repo/CLAUDE.md'), undefined);
});

test('buildPremiseCheck returns undefined when the anchor string is empty', () => {
  const finding = patchFinding({ oldString: 'old', newString: '' });
  assert.strictEqual(buildPremiseCheck(finding, '/repo/CLAUDE.md'), undefined);
});

test('buildPremiseCheck returns undefined when the anchor string is over the length ceiling', () => {
  const finding = patchFinding({ oldString: 'old', newString: 'x'.repeat(401) });
  assert.strictEqual(buildPremiseCheck(finding, '/repo/CLAUDE.md'), undefined);
});

test('buildPremiseCheck accepts an anchor string exactly at the length ceiling', () => {
  const finding = patchFinding({ oldString: 'old', newString: 'x'.repeat(400) });
  assert.ok(buildPremiseCheck(finding, '/repo/CLAUDE.md'));
});

// ── Wired into toIssuePayload's composed body ───────────────────────────────

test('toIssuePayload includes a Premise-check: line when finding.path resolves', () => {
  const finding = patchFinding({ path: '/repo/.claude/skills/auth.md', oldString: 'old', newString: 'new' });
  const payload = toIssuePayload(finding);
  assert.strictEqual(extractPremiseCheck(payload.body), "! grep -qF -- 'new' '/repo/.claude/skills/auth.md'");
});

test('toIssuePayload omits Premise-check: when finding.path is absent', () => {
  const payload = toIssuePayload(patchFinding());
  assert.strictEqual(extractPremiseCheck(payload.body), null);
});

test('toIssuePayload omits Premise-check: for a new-skill finding even if path were present', () => {
  const payload = toIssuePayload({ ...newSkillFinding(), path: '/repo/.claude/skills/queue.md' });
  assert.strictEqual(extractPremiseCheck(payload.body), null);
});

test('toIssuePayload composes Premise-check: alongside an existing verifiedAsOf stamp', () => {
  const finding = patchFinding({ path: '/repo/CLAUDE.md', oldString: 'old', newString: 'new' });
  const payload = toIssuePayload(finding, 'abc1234');
  assert.strictEqual(extractVerifiedAsOf(payload.body), 'abc1234');
  assert.strictEqual(extractPremiseCheck(payload.body), "! grep -qF -- 'new' '/repo/CLAUDE.md'");
});
