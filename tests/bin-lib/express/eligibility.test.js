'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const {
  EXPRESS_MAX_KEY_FILES, REASONS, isProtectedPath, evaluateRecordEligibility, evaluateDiffBounds, expressMergeVerification,
  BOUND_REASONS, SIZE_CEILINGS, isBeyondExpressBounds, isInsideLaneBounds, isReadableSizeCeiling, isReadableKeyFileLimit,
  RISK_CEILINGS, isReadableRiskCeiling, widenings, BUILD_TIME_PROTECTED_GLOBS, isBuildTimeProtectedPath, PROTECTED_FAMILIES,
  SHIPPED_PROTECTED_PATHS, widenedByFor,
} = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'express', 'eligibility.js'));
const { globToRegExp } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'issues', 'blast-radius.js'));
const { resolveBlastRadiusConfig } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'blast-radius-cli.js'));
const { POLICY_KEYS, resolvePolicyKeys } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'policy-schema.js'));
const { eligibilityOptions } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'driver', 'lane-bounds.js'));

const ELIGIBLE_LABELS = ['risk:low', 'size:low', 'ceremony:fast-lane', 'type:task'];
const ELIGIBLE_KEYS = ['plugin/skills/init/claude-md-template.md', 'CLAUDE.md'];
const OPTS = { enabled: true, integrationModel: 'pr-first', sensitivePaths: [] };
// The driver lane bound tests' (#5224) label and Key File builders.
const nonSize = (labels) => labels.filter((l) => !l.startsWith('size:'));
const keyFilesN = (n) => Array.from({ length: n }, (_, i) => `docs/k${i}.md`);

// A spec-shaped body; extraBody is the leading metadata block (e.g. a Surface: line),
// which liftMetadata reads only before the first blank line.
function record(labels = ELIGIBLE_LABELS, keyFiles = ELIGIBLE_KEYS, extraBody = '') {
  const body = [
    ...(extraBody ? [extraBody, ''] : []),
    '## Current State', '', 'The template lacks a line.', '',
    '## Deliverables', '', '- Add the line.', '',
    '## Acceptance Criteria', '', '- The line is present.', '',
    '## Release Note', '', 'Adds a line.', '',
    '## Technical Approach', '',
    '### Key Files', '',
    ...keyFiles.map((p) => `- \`${p}\` (modify)`),
    '',
  ].join('\n');
  return { number: 3968, body, labels };
}

test('AC1.1 (gate half; the timing half waits on #4362) eligibility: a #3968-shaped record (two markdown Key Files, risk:low size:low ceremony:fast-lane type:task) is eligible', () => {
  const out = evaluateRecordEligibility(record(), OPTS);
  assert.deepStrictEqual(out, { number: 3968, eligible: true, reasons: [], keyFiles: ELIGIBLE_KEYS });
});

test('AC2.1: risk:medium is never eligible', () => {
  const medium = evaluateRecordEligibility(record(['risk:medium', 'size:low', 'ceremony:fast-lane', 'type:task']), OPTS);
  assert.strictEqual(medium.eligible, false);
  assert.ok(medium.reasons.includes(REASONS.risk));
  const unscored = evaluateRecordEligibility(record(['size:low', 'ceremony:fast-lane', 'type:task']), OPTS);
  assert.strictEqual(unscored.eligible, false);
  assert.ok(unscored.reasons.includes(REASONS.risk));
});

function onlyReason(issue, opts, reason) {
  const out = evaluateRecordEligibility(issue, opts);
  assert.deepStrictEqual(out.reasons, [reason]);
  assert.strictEqual(out.eligible, false);
}

test('each check alone can go red', async (t) => {
  await t.test('disabled', () => onlyReason(record(), { ...OPTS, enabled: false }, REASONS.disabled));
  await t.test('local-merge', () => onlyReason(record(), { ...OPTS, integrationModel: 'local-merge' }, REASONS.notPrFirst));
  await t.test('size:medium', () => onlyReason(record(['risk:low', 'size:medium', 'ceremony:fast-lane', 'type:task']), OPTS, REASONS.size));
  await t.test('ceremony:standard', () => onlyReason(record(['risk:low', 'size:low', 'ceremony:standard', 'type:task']), OPTS, REASONS.ceremony));
  await t.test('no ceremony label', () => onlyReason(record(['risk:low', 'size:low', 'type:task']), OPTS, REASONS.ceremony));
  await t.test('no type:* label', () => onlyReason(record(['risk:low', 'size:low', 'ceremony:fast-lane', 'enhancement']), OPTS, REASONS.type));
  await t.test('auto:merge-pending', () => onlyReason(record([...ELIGIBLE_LABELS, 'auto:merge-pending']), OPTS, REASONS.mergePending));
  await t.test('zero Key Files', () => onlyReason(record(ELIGIBLE_LABELS, []), OPTS, REASONS.noKeyFiles));
  await t.test('four Key Files', () => onlyReason(record(ELIGIBLE_LABELS, ['docs/a.md', 'docs/b.md', 'docs/c.md', 'docs/d.md']), OPTS, REASONS.tooManyKeyFiles));
  await t.test('a .tsx Key File with no Surface line', () => onlyReason(record(ELIGIBLE_LABELS, ['src/app.tsx']), OPTS, REASONS.frontend));
  await t.test('Surface: web with backend-looking Key Files', () => onlyReason(record(ELIGIBLE_LABELS, ['lib/server.js', 'docs/api.md'], 'Surface: web'), OPTS, REASONS.frontend));
  for (const p of [
    'plugin/bin/lib/hooks/pre-tool-use.js', '.github/workflows/ci.yml', 'plugin/skills/_shared/x.md',
    'package.json', '.claude/settings.json', '.claude/settings.local.json', '.mcp.json', 'CODEOWNERS',
    '.gitlab-ci.yml', '.circleci/config.yml', '.husky/pre-commit', '.githooks/pre-push', '.claude-tweaks/verify-scope.json',
  ]) {
    await t.test(`protected Key File ${p}`, () => onlyReason(record(ELIGIBLE_LABELS, [...ELIGIBLE_KEYS, p]), OPTS, REASONS.protectedPath(p)));
  }
  await t.test('a Key File matching sensitivePaths', () => onlyReason(record(ELIGIBLE_LABELS, [...ELIGIBLE_KEYS, 'docs/guide.md']), { ...OPTS, sensitivePaths: ['docs/**'] }, REASONS.sensitivePath('docs/guide.md')));
  await t.test('body missing ## Release Note', () => {
    const issue = record();
    issue.body = issue.body.replace('## Release Note\n\nAdds a line.\n\n', '');
    assert.ok(!issue.body.includes('Release Note'));
    onlyReason(issue, OPTS, REASONS.notShaped);
  });
  await t.test('escalated', () => onlyReason(record(), { ...OPTS, escalated: true }, REASONS.escalated));
});

test('Key Files are judged as the file they name: dot segments, ./ and backslashes cannot dodge a path rule', () => {
  for (const p of ['plugin/skills/x/../_shared/a.md', './plugin/skills/_shared/a.md', 'plugin\\skills\\_shared\\a.md', 'docs/../.github/workflows/ci.yml']) {
    const out = evaluateRecordEligibility(record(ELIGIBLE_LABELS, [...ELIGIBLE_KEYS, p]), OPTS);
    assert.ok(out.reasons.includes(REASONS.protectedPath(p)), p);
  }
  for (const p of ['./docs/guide.md', 'docs/x/../guide.md', 'docs\\guide.md']) {
    const out = evaluateRecordEligibility(record(ELIGIBLE_LABELS, [...ELIGIBLE_KEYS, p]), { ...OPTS, sensitivePaths: ['docs/**'] });
    assert.ok(out.reasons.includes(REASONS.sensitivePath(p)), p);
  }
  assert.strictEqual(isProtectedPath('docs/x/../hookshot.md'), false);
});

test('every failing reason is collected, never short-circuited', () => {
  const out = evaluateRecordEligibility(record(['size:medium']), { ...OPTS, enabled: false });
  for (const r of [REASONS.disabled, REASONS.risk, REASONS.size, REASONS.ceremony, REASONS.type]) assert.ok(out.reasons.includes(r), r);
});

test('Surface: backend with a .tsx Key File is eligible (a declared non-frontend surface wins over the sniff)', () => {
  const out = evaluateRecordEligibility(record(ELIGIBLE_LABELS, ['src/app.tsx'], 'Surface: backend'), OPTS);
  assert.deepStrictEqual(out.reasons, []);
  assert.strictEqual(out.eligible, true);
});

test('Surface: terminal is a frontend surface, as in design-detect (only backend and infra are not)', () => {
  onlyReason(record(ELIGIBLE_LABELS, ['docs/cli.md'], 'Surface: terminal'), OPTS, REASONS.frontend);
  for (const surface of ['backend', 'infra']) {
    assert.deepStrictEqual(evaluateRecordEligibility(record(ELIGIBLE_LABELS, ['docs/cli.md'], `Surface: ${surface}`), OPTS).reasons, [], surface);
  }
});

test('REASONS is frozen and EXPRESS_MAX_KEY_FILES is 3', () => {
  assert.ok(Object.isFrozen(REASONS));
  assert.strictEqual(EXPRESS_MAX_KEY_FILES, 3);
  const { protectedPath, sensitivePath, ...literals } = REASONS;
  assert.deepStrictEqual(literals, {
    disabled: 'express-lane disabled',
    notPrFirst: 'integration-model is not pr-first',
    risk: 'risk is not low',
    size: 'size is not low',
    ceremony: 'ceremony is not fast-lane',
    type: 'no type:* label',
    mergePending: 'auto:merge-pending grant matures only on the normal path',
    noKeyFiles: 'no Key Files',
    tooManyKeyFiles: 'more than 3 Key Files',
    frontend: 'frontend surface',
    notShaped: 'not spec-shaped',
    escalated: 'already escalated in this run',
    riskFlags: 'record carries a kept risk flag',
  });
  assert.strictEqual(protectedPath('a/b'), 'protected path: a/b');
  assert.strictEqual(sensitivePath('a/b'), 'merge-sensitive path: a/b');
});

// #4618: a record carrying a kept risk flag has no audited proof step on the lane, so it
// takes the normal path. Only a `Risk-flags:` line that reads as flags excludes; `none` and
// no line (an unclassified legacy record) stay eligible.
test('#4618 risk flags: a flagged, unreadable or unknown-slug line is ineligible; none and no line stay eligible', async (t) => {
  await t.test('Risk-flags: auth', () => onlyReason(record(ELIGIBLE_LABELS, ELIGIBLE_KEYS, 'Risk-flags: auth'), OPTS, REASONS.riskFlags));
  await t.test('Risk-flags: migrations, public-contract', () => onlyReason(record(ELIGIBLE_LABELS, ELIGIBLE_KEYS, 'Risk-flags: migrations, public-contract'), OPTS, REASONS.riskFlags));
  await t.test('a malformed line reads as all four categories flagged', () => onlyReason(record(ELIGIBLE_LABELS, ELIGIBLE_KEYS, 'Risk-flags: auth;;'), OPTS, REASONS.riskFlags));
  await t.test('an unknown slug reads as all four categories flagged', () => onlyReason(record(ELIGIBLE_LABELS, ELIGIBLE_KEYS, 'Risk-flags: bogus'), OPTS, REASONS.riskFlags));
  await t.test('Risk-flags: none stays eligible', () => {
    const out = evaluateRecordEligibility(record(ELIGIBLE_LABELS, ELIGIBLE_KEYS, 'Risk-flags: none'), OPTS);
    assert.deepStrictEqual(out, { number: 3968, eligible: true, reasons: [], keyFiles: ELIGIBLE_KEYS });
  });
  await t.test('no Risk-flags line stays eligible', () => {
    assert.deepStrictEqual(evaluateRecordEligibility(record(), OPTS).reasons, []);
  });
  await t.test('the reason is collected beside the others, never short-circuiting', () => {
    const out = evaluateRecordEligibility(record(['size:medium'], ELIGIBLE_KEYS, 'Risk-flags: auth'), { ...OPTS, enabled: false });
    for (const r of [REASONS.disabled, REASONS.risk, REASONS.size, REASONS.riskFlags]) assert.ok(out.reasons.includes(r), r);
  });
});

test('consumer-portability: protected paths are project-agnostic', () => {
  assert.strictEqual(isProtectedPath('.claude/hooks/x.sh'), true);
  assert.strictEqual(isProtectedPath('lib/hooks.js'), true);
  // #5392: every hooks.json registration runs bin/hooks.sh, so it is hook code too.
  assert.strictEqual(isProtectedPath('plugin/bin/hooks.sh'), true);
  assert.strictEqual(isProtectedPath('skills/_shared/a.md'), true);
  assert.strictEqual(isProtectedPath('.claude-tweaks/policy.yml'), true);
  assert.strictEqual(isProtectedPath('.github/CODEOWNERS'), true);
  assert.strictEqual(isProtectedPath('apps/web/package.json'), true);
  assert.strictEqual(isProtectedPath('docs/my-package.json'), false);
  assert.strictEqual(isProtectedPath('docs/settings.json'), false);
  assert.strictEqual(isProtectedPath('docs/hookshot.md'), false);
  assert.strictEqual(isProtectedPath('src/webhooks/a.js'), false);
  assert.strictEqual(isProtectedPath('src/webhooks.js'), false);
  assert.strictEqual(isProtectedPath('src/webhooks.sh'), false);
});

const BOUNDS = { keyFiles: ELIGIBLE_KEYS, sensitivePaths: [], maxLines: 40 };
const f = (p, additions, deletions = 0) => ({ path: p, additions, deletions });

test('evaluateDiffBounds', async (t) => {
  await t.test('Key-File-only change within 40 lines is within bounds', () => {
    const out = evaluateDiffBounds([f('CLAUDE.md', 10, 5), f(ELIGIBLE_KEYS[0], 20)], BOUNDS);
    assert.deepStrictEqual(out, { withinBounds: true, violations: [], implLines: 35, changedFiles: ['CLAUDE.md', ELIGIBLE_KEYS[0]] });
  });
  await t.test('a test file outside Key Files is within bounds', () => {
    const out = evaluateDiffBounds([f('CLAUDE.md', 5), f('tests/x.test.js', 200)], BOUNDS);
    assert.deepStrictEqual(out.violations, []);
    assert.strictEqual(out.implLines, 5);
  });
  // I5: deleting test lines weakens the CI-green net the lane merges on, so deletions in
  // test files count toward the cap; added test lines stay exempt.
  await t.test('deleted test lines count toward maxLines; added ones do not', () => {
    const within = evaluateDiffBounds([f('CLAUDE.md', 20), f('tests/x.test.js', 500, 20)], BOUNDS);
    assert.deepStrictEqual(within.violations, [], '20 + 20 deleted test lines is exactly the cap');
    assert.strictEqual(within.implLines, 20, 'implLines stays implementation lines only');
    const over = evaluateDiffBounds([f('CLAUDE.md', 20), f('tests/x.test.js', 0, 21)], BOUNDS);
    assert.deepStrictEqual(over.violations, ['20 implementation lines + 21 deleted test lines > 40']);
    assert.strictEqual(over.withinBounds, false);
  });
  await t.test('a deleted test file alone exceeds the cap by its line count', () => {
    const out = evaluateDiffBounds([f('CLAUDE.md', 1), f('tests/old.test.js', 0, 120)], BOUNDS);
    assert.deepStrictEqual(out.violations, ['1 implementation lines + 120 deleted test lines > 40']);
  });
  await t.test('a pipeline artifact is within bounds', () => {
    const out = evaluateDiffBounds([f('CLAUDE.md', 5), f('.claude-tweaks/pipelines/r/work/1-spec.md', 300)], BOUNDS);
    assert.deepStrictEqual(out.violations, []);
    assert.strictEqual(out.implLines, 5);
  });
  await t.test('a non-Key-File impl path is outside Key Files', () => {
    const out = evaluateDiffBounds([f('CLAUDE.md', 5), f('src/other.js', 2)], BOUNDS);
    assert.deepStrictEqual(out.violations, ['outside Key Files: src/other.js']);
    assert.strictEqual(out.withinBounds, false);
  });
  await t.test('41 impl lines exceed maxLines 40', () => {
    const out = evaluateDiffBounds([f('CLAUDE.md', 30, 11)], BOUNDS);
    assert.deepStrictEqual(out.violations, ['41 implementation lines > 40']);
  });
  await t.test('exactly 40 impl lines is within bounds', () => {
    const out = evaluateDiffBounds([f('CLAUDE.md', 30, 10)], BOUNDS);
    assert.strictEqual(out.withinBounds, true);
  });
  await t.test('no changes', () => {
    assert.deepStrictEqual(evaluateDiffBounds([], BOUNDS).violations, ['no changes']);
  });
  await t.test('a changed .github/workflows/ci.yml is protected, even as the only change', () => {
    const p = '.github/workflows/ci.yml';
    assert.deepStrictEqual(evaluateDiffBounds([f(p, 1)], { ...BOUNDS, keyFiles: [p] }).violations, [`protected path: ${p}`]);
    assert.ok(evaluateDiffBounds([f(p, 1)], BOUNDS).violations.includes(`protected path: ${p}`));
  });
  await t.test('a missing maxLines fails closed', () => {
    const out = evaluateDiffBounds([f('CLAUDE.md', 1)], { keyFiles: ELIGIBLE_KEYS, sensitivePaths: [] });
    assert.deepStrictEqual(out.violations, ['invalid maxLines: undefined']);
    assert.strictEqual(out.withinBounds, false);
  });
  await t.test('a NaN maxLines fails closed', () => {
    const out = evaluateDiffBounds([f('CLAUDE.md', 1)], { ...BOUNDS, maxLines: NaN });
    assert.deepStrictEqual(out.violations, ['invalid maxLines: NaN']);
    assert.strictEqual(out.withinBounds, false);
  });
  await t.test('a ./-prefixed Key File matches the bare diff path', () => {
    const out = evaluateDiffBounds([f('a.md', 3)], { ...BOUNDS, keyFiles: ['./a.md'] });
    assert.deepStrictEqual(out.violations, []);
    assert.strictEqual(out.withinBounds, true);
  });
  await t.test('a rename checks oldPath against protected and merge-sensitive paths', () => {
    const renamed = { path: 'CLAUDE.md', oldPath: '.github/workflows/ci.yml', additions: 1, deletions: 0 };
    assert.deepStrictEqual(evaluateDiffBounds([renamed], BOUNDS).violations, ['protected path: .github/workflows/ci.yml']);
    const fromDocs = { path: 'CLAUDE.md', oldPath: 'docs/old.md', additions: 1, deletions: 0 };
    assert.deepStrictEqual(evaluateDiffBounds([fromDocs], { ...BOUNDS, sensitivePaths: ['docs/**'] }).violations, ['merge-sensitive path: docs/old.md']);
  });
  await t.test('protected and merge-sensitive checks apply to test files too', () => {
    const out = evaluateDiffBounds([f('CLAUDE.md', 1), f('tests/hooks/a.test.js', 1)], { ...BOUNDS, sensitivePaths: ['tests/**'] });
    assert.deepStrictEqual(out.violations, ['protected path: tests/hooks/a.test.js', 'merge-sensitive path: tests/hooks/a.test.js']);
  });
});

test('AC4.1: express never merges under off', () => {
  assert.strictEqual(expressMergeVerification('off'), 'merge-when-green');
  assert.strictEqual(expressMergeVerification('merge-when-green'), 'merge-when-green');
  assert.strictEqual(expressMergeVerification('wait'), 'wait');
  assert.strictEqual(expressMergeVerification(''), 'merge-when-green');
  assert.strictEqual(expressMergeVerification(undefined), 'merge-when-green');
});

test('resolveBlastRadiusConfig reads merge-sensitive-paths and auto-merge-max-lines from policy', () => {
  const git = () => '/repo\n';
  const readFile = (p) => (p.endsWith('policy.yml') ? 'merge-sensitive-paths: docs/**, bin/**\nauto-merge-max-lines: 12\n' : null);
  const out = resolveBlastRadiusConfig({ git, readFile, runDir: null });
  assert.deepStrictEqual(out.mergeSensitivePaths, ['docs/**', 'bin/**']);
  assert.strictEqual(out.autoMergeMaxLines, 12);
  assert.strictEqual(typeof out.autoMergeMaxFiles, 'number');
});

const DRIVER = { ...OPTS, allowAbsentCeremony: true };

test('AC2.1: with allowAbsentCeremony, an otherwise-eligible record with no ceremony:* label is eligible', () => {
  const out = evaluateRecordEligibility(record(['risk:low', 'size:low', 'type:task']), DRIVER);
  assert.strictEqual(out.eligible, true);
  assert.deepStrictEqual(out.reasons, []);
});

test('AC2.2: with allowAbsentCeremony, ceremony:standard is not eligible and names the ceremony reason', () => {
  const out = evaluateRecordEligibility(record(['risk:low', 'size:low', 'ceremony:standard', 'type:task']), DRIVER);
  assert.deepStrictEqual(out.reasons, [REASONS.ceremony]);
});

test('AC2.3: with allowAbsentCeremony, risk:medium and no ceremony label is not eligible (only ceremony relaxes)', () => {
  const out = evaluateRecordEligibility(record(['risk:medium', 'size:low', 'type:task']), DRIVER);
  assert.deepStrictEqual(out.reasons, [REASONS.risk]);
});

test('AC2.4: with allowAbsentCeremony, an unrecognised ceremony label is not eligible', () => {
  for (const bad of ['ceremony:fastlane', 'ceremony:Standard', 'Ceremony:fast-lane']) {
    const out = evaluateRecordEligibility(record(['risk:low', 'size:low', 'type:task', bad]), DRIVER);
    assert.deepStrictEqual(out.reasons, [REASONS.ceremony], bad);
  }
});

test('allowAbsentCeremony: ceremony:fast-lane passes with the option set or absent', () => {
  assert.strictEqual(evaluateRecordEligibility(record(), DRIVER).eligible, true);
  assert.strictEqual(evaluateRecordEligibility(record(), OPTS).eligible, true);
});

test('allowAbsentCeremony: only a literal true relaxes', () => {
  const out = evaluateRecordEligibility(record(['risk:low', 'size:low', 'type:task']), { ...OPTS, allowAbsentCeremony: 'yes' });
  assert.deepStrictEqual(out.reasons, [REASONS.ceremony]);
});

test('allowAbsentCeremony: gh {name} label objects take the same ceremony rule as strings', () => {
  const objs = (names) => names.map((name) => ({ name }));
  const base = ['risk:low', 'size:low', 'type:task'];
  assert.strictEqual(evaluateRecordEligibility(record(objs(base)), DRIVER).eligible, true);
  for (const bad of ['ceremony:standard', 'ceremony:Standard', 'Ceremony:fast-lane', 'ceremony:fastlane']) {
    const out = evaluateRecordEligibility(record(objs([...base, bad])), DRIVER);
    assert.deepStrictEqual(out.reasons, [REASONS.ceremony], bad);
  }
});

// #4118 (Planning Decisions Q1, Reading A): /capture's Shaped-body branch stamps ceremony:*, and the
// label is the single ceremony authority for every lane. Options are representative driver-lane
// options (hand-set values, not the schema defaults), not a hand-built DRIVER object.
function driverDefaults() {
  const values = {
    'express-driver-max-size': 'medium', 'express-driver-max-key-files': 5, 'express-driver-max-risk': 'low',
    'express-driver-review': 'beyond-express', 'express-driver-protected-paths': 'refuse',
    'integration-model': 'pr-first', 'merge-sensitive-paths': [],
  };
  return eligibilityOptions({
    'protected-paths': resolvePolicyKeys(['protected-paths'], { policyRaw: '' })['protected-paths'],
    ...Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { value, source: 'policy' }])),
  });
}

test('#4118: a capture-stamped ceremony:fast-lane record is express-eligible and driver-eligible', () => {
  const r = record(['risk:low', 'size:low', 'ceremony:fast-lane', 'type:task', 'by:capture']);
  assert.strictEqual(evaluateRecordEligibility(r, OPTS).eligible, true);
  assert.strictEqual(evaluateRecordEligibility(r, driverDefaults()).eligible, true);
});

test('#4118: a capture-stamped ceremony:standard record is refused by representative driver-lane options, naming ceremony', () => {
  const r = record(['risk:low', 'size:low', 'ceremony:standard', 'type:task', 'by:capture']);
  assert.deepStrictEqual(evaluateRecordEligibility(r, driverDefaults()).reasons, [REASONS.ceremony]);
});

// Driver lane bounds (#5224): sizeCeiling / maxKeyFiles options; absent options keep every express verdict.

test('AC3.3: size:high is refused under every ceiling, naming the ceiling', () => {
  for (const ceiling of ['low', 'medium']) {
    const out = evaluateRecordEligibility(record(['size:high', ...nonSize(ELIGIBLE_LABELS)], ['a.js']), { ...OPTS, sizeCeiling: ceiling });
    assert.ok(out.reasons.includes(BOUND_REASONS.size(ceiling)), ceiling);
  }
  assert.strictEqual(BOUND_REASONS.size('medium'), 'size is not low or medium');
  assert.strictEqual(BOUND_REASONS.size('low'), REASONS.size);
  assert.deepStrictEqual(SIZE_CEILINGS.medium, ['low', 'medium']);
});

test('medium ceiling accepts size:medium and size:low', () => {
  for (const s of ['size:low', 'size:medium']) {
    const out = evaluateRecordEligibility(record([s, ...nonSize(ELIGIBLE_LABELS)]), { ...OPTS, sizeCeiling: 'medium' });
    assert.strictEqual(out.eligible, true, s);
  }
});

test('AC3.4: more Key Files than the widened limit names that limit', () => {
  const over = evaluateRecordEligibility(record(ELIGIBLE_LABELS, keyFilesN(6)), { ...OPTS, maxKeyFiles: 5 });
  assert.ok(over.reasons.includes('more than 5 Key Files'));
  assert.strictEqual(BOUND_REASONS.tooManyKeyFiles(3), REASONS.tooManyKeyFiles);
  const at = evaluateRecordEligibility(record(ELIGIBLE_LABELS, keyFilesN(5)), { ...OPTS, maxKeyFiles: 5 });
  assert.ok(!at.reasons.includes('more than 5 Key Files'));
  assert.strictEqual(at.eligible, true);
});

test('AC6.4: absent size label still refused with size is not low under the default', () => {
  const issue = record(nonSize(ELIGIBLE_LABELS));
  assert.ok(evaluateRecordEligibility(issue, { ...OPTS, sizeCeiling: 'low' }).reasons.includes('size is not low'));
  assert.ok(evaluateRecordEligibility(issue, OPTS).reasons.includes('size is not low'));
});

test('AC6.3: an empty Key File list is still refused with no Key Files', () => {
  const out = evaluateRecordEligibility(record(ELIGIBLE_LABELS, []), { ...OPTS, maxKeyFiles: 5 });
  assert.ok(out.reasons.includes(REASONS.noKeyFiles));
});

test('AC6.2: a malformed bound refuses, never accepts', () => {
  for (const v of ['high', null, 'Medium']) {
    const out = evaluateRecordEligibility(record(), { ...OPTS, sizeCeiling: v });
    assert.strictEqual(out.eligible, false, String(v));
    assert.ok(out.reasons.includes(BOUND_REASONS.sizeCeilingUnreadable(v)), String(v));
  }
  for (const v of [0, 2.5, '4', null, -1, Infinity, NaN]) {
    const out = evaluateRecordEligibility(record(), { ...OPTS, maxKeyFiles: v });
    assert.strictEqual(out.eligible, false, String(v));
    assert.ok(out.reasons.includes(BOUND_REASONS.keyFileLimitUnreadable(v)), String(v));
  }
});

test('defaults spelled explicitly give byte-identical verdicts to absent options', () => {
  for (const sizeLabels of [['size:low'], ['size:medium'], ['size:high'], []]) {
    for (let n = 0; n <= 5; n++) {
      const r = record([...sizeLabels, ...nonSize(ELIGIBLE_LABELS)], keyFilesN(n));
      assert.deepStrictEqual(
        evaluateRecordEligibility(r, { ...OPTS, sizeCeiling: 'low', maxKeyFiles: 3 }),
        evaluateRecordEligibility(r, OPTS),
        `${sizeLabels} x ${n}`,
      );
    }
  }
});

test('the widened size and Key File reasons keep their place in the reasons order (#5224)', () => {
  const issue = record(['risk:medium', 'size:high', ...nonSize(ELIGIBLE_LABELS).filter((l) => l !== 'risk:low')], keyFilesN(6));
  assert.deepStrictEqual(evaluateRecordEligibility(issue, { ...OPTS, sizeCeiling: 'medium', maxKeyFiles: 5 }).reasons, [
    REASONS.risk, 'size is not low or medium', 'more than 5 Key Files',
  ]);
});

test('BOUND_REASONS.size names an unreadable ceiling instead of throwing (#5224)', () => {
  for (const v of ['high', 'toString', 'Medium', null, undefined, 3]) {
    assert.strictEqual(BOUND_REASONS.size(v), BOUND_REASONS.sizeCeilingUnreadable(v), String(v));
  }
});

test('isBeyondExpressBounds: a size other than low, more than the express Key File limit, or an unreadable list (#5224)', () => {
  assert.strictEqual(isBeyondExpressBounds({ size: 'low', keyFiles: keyFilesN(EXPRESS_MAX_KEY_FILES) }), false);
  assert.strictEqual(isBeyondExpressBounds({ size: 'low', keyFiles: [] }), false);
  assert.strictEqual(isBeyondExpressBounds({ size: 'low', keyFiles: keyFilesN(EXPRESS_MAX_KEY_FILES + 1) }), true);
  for (const size of ['medium', 'high', null, undefined]) assert.strictEqual(isBeyondExpressBounds({ size, keyFiles: keyFilesN(1) }), true, String(size));
  for (const keyFiles of [null, undefined, 'a.js']) assert.strictEqual(isBeyondExpressBounds({ size: 'low', keyFiles }), true, String(keyFiles));
});

test('isReadableSizeCeiling and isReadableKeyFileLimit are the checks eligibility applies (#5224)', () => {
  for (const v of ['low', 'medium']) assert.strictEqual(isReadableSizeCeiling(v), true, v);
  for (const v of ['high', 'Medium', 'toString', '__proto__', null, undefined, 1]) assert.strictEqual(isReadableSizeCeiling(v), false, String(v));
  for (const v of [1, 3, 99]) assert.strictEqual(isReadableKeyFileLimit(v), true, String(v));
  for (const v of [0, -1, 2.5, '4', null, undefined, Infinity, NaN, 2 ** 53]) assert.strictEqual(isReadableKeyFileLimit(v), false, String(v));
});

test('isInsideLaneBounds: a size the ceiling accepts and at most the Key File limit, the same comparisons eligibility refuses on (#5224)', () => {
  const bounds = { sizeCeiling: 'medium', maxKeyFiles: 5 };
  assert.strictEqual(isInsideLaneBounds({ size: 'medium', keyFiles: keyFilesN(5), bounds }), true);
  assert.strictEqual(isInsideLaneBounds({ size: 'low', keyFiles: keyFilesN(1), bounds }), true);
  assert.strictEqual(isInsideLaneBounds({ size: 'medium', keyFiles: keyFilesN(6), bounds }), false);
  assert.strictEqual(isInsideLaneBounds({ size: 'high', keyFiles: keyFilesN(1), bounds }), false);
  assert.strictEqual(isInsideLaneBounds({ size: 'medium', keyFiles: keyFilesN(1), bounds: { sizeCeiling: 'low', maxKeyFiles: 5 } }), false);
  // Every row agrees with eligibility's own verdict on the two bound reasons.
  for (const [size, n] of [['low', 1], ['medium', 5], ['medium', 6], ['high', 1]]) {
    const labels = ['risk:low', `size:${size}`, 'ceremony:fast-lane', 'type:task'];
    const { reasons } = evaluateRecordEligibility(record(labels, keyFilesN(n)), { ...OPTS, sizeCeiling: 'medium', maxKeyFiles: 5 });
    const refusedOnBounds = reasons.includes(BOUND_REASONS.size('medium')) || reasons.includes(BOUND_REASONS.tooManyKeyFiles(5));
    assert.strictEqual(isInsideLaneBounds({ size, keyFiles: keyFilesN(n), bounds }), !refusedOnBounds, `${size} x ${n}`);
  }
});

test('express-driver-max-size accepts exactly the SIZE_CEILINGS keys, so no accepted value refuses every record (#5224)', () => {
  const row = POLICY_KEYS.find((k) => k.key === 'express-driver-max-size');
  assert.deepStrictEqual([...row.values].sort(), Object.keys(SIZE_CEILINGS).sort());
});

test('express-driver-max-risk accepts exactly the RISK_CEILINGS keys, so no accepted value refuses every record (#6018)', () => {
  const row = POLICY_KEYS.find((k) => k.key === 'express-driver-max-risk');
  assert.deepStrictEqual([...row.values].sort(), Object.keys(RISK_CEILINGS).sort());
});

// ---- #6018: the driver risk ceiling, ceremony relaxation and widenings() ----
const withoutRiskCeremony = ELIGIBLE_LABELS.filter((l) => !l.startsWith('risk:') && !l.startsWith('ceremony:'));
const RISK_X_CEREMONY = [];
for (const risk of ['risk:low', 'risk:medium', 'risk:high', null]) {
  for (const cer of ['ceremony:fast-lane', 'ceremony:standard', null, 'ceremony:fastlane']) {
    RISK_X_CEREMONY.push([risk, cer, record([...withoutRiskCeremony, ...(risk ? [risk] : []), ...(cer ? [cer] : [])])]);
  }
}

test('AC1.1 (#6018): riskCeiling low gives byte-identical verdicts to an absent option over risk x ceremony', () => {
  for (const [risk, cer, r] of RISK_X_CEREMONY) {
    const base = evaluateRecordEligibility(r, DRIVER);
    assert.deepStrictEqual(evaluateRecordEligibility(r, { ...DRIVER, riskCeiling: 'low' }), base, `${risk} ${cer}`);
    assert.deepStrictEqual(evaluateRecordEligibility(r, { ...DRIVER, riskCeiling: 'low', allowAnyCeremony: false }), base, `${risk} ${cer}`);
  }
});

test('AC1.2 (#6018): an express call (no driver options) keeps today\'s reasons over the same matrix', () => {
  assert.strictEqual(REASONS.risk, 'risk is not low');
  assert.strictEqual(REASONS.ceremony, 'ceremony is not fast-lane');
  for (const [risk, cer, r] of RISK_X_CEREMONY) {
    const { reasons } = evaluateRecordEligibility(r, OPTS);
    assert.strictEqual(reasons.includes(REASONS.risk), risk !== 'risk:low', `${risk} ${cer}`);
    assert.strictEqual(reasons.includes(REASONS.ceremony), cer !== 'ceremony:fast-lane', `${risk} ${cer}`);
  }
});

test('RISK_CEILINGS and BOUND_REASONS.risk (#6018)', () => {
  assert.deepStrictEqual(RISK_CEILINGS, { low: ['low'], medium: ['low', 'medium'], high: ['low', 'medium', 'high'] });
  assert.ok(Object.isFrozen(RISK_CEILINGS) && Object.values(RISK_CEILINGS).every(Object.isFrozen));
  assert.strictEqual(BOUND_REASONS.risk('low'), 'risk is not low');
  assert.strictEqual(BOUND_REASONS.risk('medium'), 'risk is not low or medium');
  assert.strictEqual(BOUND_REASONS.risk('high'), 'risk is not low or medium or high');
  assert.strictEqual(BOUND_REASONS.risk('toString'), 'risk ceiling unreadable: toString');
  assert.strictEqual(BOUND_REASONS.riskCeilingUnreadable(null), 'risk ceiling unreadable: null');
  for (const v of ['low', 'medium', 'high']) assert.strictEqual(isReadableRiskCeiling(v), true);
  for (const v of ['Medium', 'toString', null, undefined, 1]) assert.strictEqual(isReadableRiskCeiling(v), false);
});

test('AC2.1, AC2.2 (#6018, eligibility half): riskCeiling medium admits risk:medium, refuses risk:high and an unlabelled risk naming the ceiling', () => {
  const opts = { ...DRIVER, riskCeiling: 'medium' };
  const mk = (...extra) => record([...withoutRiskCeremony, 'ceremony:fast-lane', ...extra]);
  assert.strictEqual(evaluateRecordEligibility(mk('risk:medium'), opts).eligible, true);
  assert.strictEqual(evaluateRecordEligibility(mk('risk:low'), opts).eligible, true);
  for (const extra of [['risk:high'], []]) {
    const { reasons } = evaluateRecordEligibility(mk(...extra), opts);
    assert.ok(reasons.includes('risk is not low or medium'), extra.join());
    assert.ok(!reasons.includes(REASONS.risk), extra.join());
  }
});

test('AC2.3 (#6018): riskCeiling high admits risk:high', () => {
  const r = record([...withoutRiskCeremony, 'risk:high', 'ceremony:fast-lane']);
  assert.strictEqual(evaluateRecordEligibility(r, { ...DRIVER, riskCeiling: 'high' }).eligible, true);
});

test('riskCeiling unreadable refuses with its own reason, never a fallback (#6018)', () => {
  for (const v of ['Medium', 'critical', null, 'toString']) {
    const { reasons, eligible } = evaluateRecordEligibility(record(), { ...DRIVER, riskCeiling: v });
    assert.strictEqual(eligible, false);
    assert.ok(reasons.includes(`risk ceiling unreadable: ${String(v)}`), String(v));
  }
});

test('AC5.1, AC5.3 (#6018, eligibility half): allowAnyCeremony passes a recognised ceremony label; an unrecognised spelling still refuses', () => {
  const opts = { ...DRIVER, allowAnyCeremony: true };
  const mk = (...cer) => record([...withoutRiskCeremony, 'risk:low', ...cer]);
  assert.strictEqual(evaluateRecordEligibility(mk('ceremony:standard'), opts).eligible, true);
  assert.strictEqual(evaluateRecordEligibility(mk('ceremony:fast-lane'), opts).eligible, true);
  for (const cer of [['ceremony:fastlane'], ['Ceremony:standard'], ['ceremony:standard', 'ceremony:fastlane']]) {
    assert.ok(evaluateRecordEligibility(mk(...cer), opts).reasons.includes(REASONS.ceremony), cer.join());
  }
  // No ceremony label at all: allowAnyCeremony alone does not relax it (no allowAbsentCeremony here).
  assert.ok(evaluateRecordEligibility(mk(), { ...OPTS, allowAnyCeremony: true }).reasons.includes(REASONS.ceremony));
  for (const v of ['true', 1]) {
    assert.ok(evaluateRecordEligibility(mk('ceremony:standard'), { ...DRIVER, allowAnyCeremony: v }).reasons.includes(REASONS.ceremony), String(v));
  }
});

test('a dual-risk-labelled record clears the ceiling on its last risk label but widens in either order (#6018)', () => {
  // Eligibility reads the parsed facet (last match), so the label order decides the ceiling verdict;
  // widenings() scans every label, so the record always carries the risk widening and takes the
  // reviewer plus the pending-review merge stop whichever order the labels came in.
  for (const labels of [['risk:high', 'risk:low'], ['risk:low', 'risk:high'], ['risk:medium', 'risk:low'], ['risk:low', 'risk:medium']]) {
    const r = record([...withoutRiskCeremony, ...labels, 'ceremony:fast-lane']);
    for (const riskCeiling of ['low', 'medium']) {
      const { reasons } = evaluateRecordEligibility(r, { ...DRIVER, riskCeiling });
      const lastRisk = labels[labels.length - 1].slice('risk:'.length);
      assert.strictEqual(reasons.includes(BOUND_REASONS.risk(riskCeiling)), !RISK_CEILINGS[riskCeiling].includes(lastRisk), `${labels} ${riskCeiling}`);
      assert.ok(widenings({ labels: r.labels, riskCeiling }).includes('risk'), `${labels} ${riskCeiling}`);
    }
  }
});

test('widenings (#6018)', () => {
  const w = (labels, extra) => widenings({ labels, ...extra });
  assert.deepStrictEqual(w(['risk:medium'], { riskCeiling: 'medium' }), ['risk']);
  assert.deepStrictEqual(w(['risk:low'], { riskCeiling: 'medium' }), []);
  assert.deepStrictEqual(w(['risk:high'], { riskCeiling: 'high' }), ['risk']);
  for (const labels of [['risk:low', 'risk:medium'], ['risk:medium', 'risk:low']]) {
    for (const riskCeiling of ['medium', 'low']) assert.deepStrictEqual(w(labels, { riskCeiling }), ['risk'], `${labels} ${riskCeiling}`);
  }
  assert.deepStrictEqual(w(['risk:low', 'ceremony:standard'], { anyCeremony: true }), ['ceremony']);
  assert.deepStrictEqual(w(['risk:low', 'ceremony:standard'], { anyCeremony: false }), []);
  assert.deepStrictEqual(w(['risk:low', 'ceremony:standard'], {}), []);
  assert.deepStrictEqual(w(['ceremony:fast-lane'], { anyCeremony: true }), []);
  assert.deepStrictEqual(w(['ceremony:standard', 'ceremony:fast-lane'], { anyCeremony: true }), ['ceremony']);
  assert.deepStrictEqual(w(['ceremony:fast-lane', 'ceremony:standard'], { anyCeremony: true }), ['ceremony']);
  assert.deepStrictEqual(w(['risk:low'], { anyCeremony: true }), []);
  assert.deepStrictEqual(w(['risk:medium', 'ceremony:standard'], { riskCeiling: 'medium', anyCeremony: true }), ['risk', 'ceremony']);
  assert.deepStrictEqual(w([{ name: 'risk:medium' }, { name: 'ceremony:standard' }], { riskCeiling: 'medium', anyCeremony: true }), ['risk', 'ceremony']);
  assert.deepStrictEqual(w([{ name: 'risk:low' }, { name: 'risk:medium' }], { riskCeiling: 'low' }), ['risk']);
  for (const riskCeiling of ['Medium', null, 'toString', undefined]) assert.deepStrictEqual(w(['risk:high'], { riskCeiling }), [], String(riskCeiling));
});

// #6019: the pipeline driver may take a merge-time protected path behind its reviewer; build-time families still refuse.
const REVIEWER = { ...DRIVER, protectedPathsNeedReviewer: true };
const MERGE_TIME = ['plugin/hooks/x.js', 'hooks.js', 'a/hooks.sh', 'plugin/skills/_shared/a.md', 'CODEOWNERS'];
const BUILD_TIME = ['.github/workflows/ci.yml', '.gitlab-ci.yml', '.circleci/config.yml', '.githooks/pre-commit', '.husky/pre-commit', 'package.json', '.claude/settings.json', '.mcp.json', '.claude-tweaks/policy.yml', '.claude-tweaks/verify-scope.json'];
const withKey = (p) => record(ELIGIBLE_LABELS, [p]);

test("AC1.1 (#6019, eligibility half): without the option, or with it false, a hooks/, .github/ or package.json Key File gives today's verdict", () => {
  for (const p of ['plugin/hooks/x.js', '.github/workflows/ci.yml', 'package.json']) {
    const r = withKey(p);
    const today = evaluateRecordEligibility(r, DRIVER);
    assert.ok(today.reasons.includes(`protected path: ${p}`), p);
    assert.deepStrictEqual(evaluateRecordEligibility(r, { ...DRIVER, protectedPathsNeedReviewer: false }), today);
    assert.deepStrictEqual(evaluateRecordEligibility(r, { ...DRIVER, protectedPathsNeedReviewer: 'true' }), today);
    assert.ok(evaluateRecordEligibility(r, OPTS).reasons.includes(`protected path: ${p}`), p);
  }
});

test('AC10.1 (#6019, eligibility half): under the option each merge-time Key File is eligible and widens by protected-path', () => {
  for (const p of MERGE_TIME) {
    const r = withKey(p);
    assert.strictEqual(evaluateRecordEligibility(r, REVIEWER).eligible, true, p);
    assert.deepStrictEqual(widenings({ labels: r.labels, keyFiles: [p], protectedPathsNeedReviewer: true }), ['protected-path'], p);
  }
});

test('AC9.1 (#6019, eligibility half): under the option each build-time Key File still refuses with protected path', () => {
  for (const p of [...BUILD_TIME, './.github/workflows/ci.yml', 'plugin/x/../../.github/ci.yml', '.github\\ci.yml']) {
    assert.ok(evaluateRecordEligibility(withKey(p), REVIEWER).reasons.includes(`protected path: ${p}`), p);
  }
  for (const p of BUILD_TIME) assert.strictEqual(isBuildTimeProtectedPath(p), true, p);
  for (const p of [...MERGE_TIME, 'src/a.js']) assert.strictEqual(isBuildTimeProtectedPath(p), false, p);
});

test('BUILD_TIME_PROTECTED_GLOBS is frozen and inside the protected list (#6019)', () => {
  assert.ok(Object.isFrozen(BUILD_TIME_PROTECTED_GLOBS));
  assert.strictEqual(BUILD_TIME_PROTECTED_GLOBS.length, 10);
  for (const p of [...BUILD_TIME, ...MERGE_TIME]) assert.strictEqual(isProtectedPath(p), true, p);
  for (const p of MERGE_TIME) assert.strictEqual(isBuildTimeProtectedPath(p), false, p);
  for (const p of BUILD_TIME) assert.strictEqual(isBuildTimeProtectedPath(p), true, p);
  // Partition: every protected family is matched by at least one probe, and its kind agrees with the
  // probes that match it; a new family with no probe (or a wrong kind) goes red here.
  for (const fam of PROTECTED_FAMILIES) {
    const hitsBuild = BUILD_TIME.filter((q) => globToRegExp(fam.glob).test(q));
    const hitsMerge = MERGE_TIME.filter((q) => globToRegExp(fam.glob).test(q));
    assert.ok(hitsBuild.length + hitsMerge.length > 0, `no probe for ${fam.glob}`);
    assert.strictEqual(hitsBuild.length > 0, fam.buildTime, `kind of ${fam.glob}`);
    assert.strictEqual(hitsMerge.length > 0, !fam.buildTime, `kind of ${fam.glob}`);
  }
  assert.strictEqual(PROTECTED_FAMILIES.length, 15);
  assert.deepStrictEqual(BUILD_TIME_PROTECTED_GLOBS, PROTECTED_FAMILIES.filter((fam) => fam.buildTime).map((fam) => fam.glob));
});

test('AC6.1 (#6019): a merge-sensitive Key File refuses under the option exactly as without it', () => {
  const r = withKey('src/a.js');
  const a = evaluateRecordEligibility(r, { ...REVIEWER, sensitivePaths: ['src/**'] });
  const b = evaluateRecordEligibility(r, { ...DRIVER, sensitivePaths: ['src/**'] });
  assert.deepStrictEqual(a.reasons, b.reasons);
  assert.ok(a.reasons.includes('merge-sensitive path: src/a.js'));
});

test('AC6.1 (#6019): a protected and merge-sensitive Key File keeps both reasons under the option', () => {
  const r = withKey('plugin/hooks/x.js');
  const a = evaluateRecordEligibility(r, { ...REVIEWER, sensitivePaths: ['plugin/hooks/**'] });
  const b = evaluateRecordEligibility(r, { ...DRIVER, sensitivePaths: ['plugin/hooks/**'] });
  assert.deepStrictEqual(a.reasons, b.reasons);
  assert.ok(a.reasons.includes('protected path: plugin/hooks/x.js'));
  assert.ok(a.reasons.includes('merge-sensitive path: plugin/hooks/x.js'));
});

test('widenings protected-path (#6019)', () => {
  const k = ['plugin/hooks/x.js'];
  assert.deepStrictEqual(widenings({ labels: ELIGIBLE_LABELS, keyFiles: k }), []);
  assert.deepStrictEqual(widenings({ labels: ELIGIBLE_LABELS, keyFiles: k, protectedPathsNeedReviewer: false }), []);
  assert.deepStrictEqual(widenings({ labels: ELIGIBLE_LABELS, keyFiles: ['src/a.js'], protectedPathsNeedReviewer: true }), []);
  assert.deepStrictEqual(widenings({ labels: ELIGIBLE_LABELS, keyFiles: 'plugin/hooks/x.js', protectedPathsNeedReviewer: true }), []);
  assert.deepStrictEqual(widenings({ labels: ELIGIBLE_LABELS, protectedPathsNeedReviewer: true }), []);
  assert.deepStrictEqual(widenings({ labels: ['risk:medium'], riskCeiling: 'medium', keyFiles: k, protectedPathsNeedReviewer: true }), ['risk', 'protected-path']);
});

test('AC3.1 (#6019, bounds half): reportProtectedPaths moves a merge-time Key File into protectedPaths', () => {
  const p = 'plugin/skills/_shared/a.md';
  const o = { ...BOUNDS, keyFiles: [p] };
  const on = evaluateDiffBounds([f(p, 10)], { ...o, reportProtectedPaths: true });
  assert.strictEqual(on.withinBounds, true);
  assert.deepStrictEqual(on.protectedPaths, [p]);
  assert.deepStrictEqual(on.violations, []);
  const off = evaluateDiffBounds([f(p, 10)], o);
  assert.deepStrictEqual(off.violations, [`protected path: ${p}`]);
  assert.strictEqual('protectedPaths' in off, false);
  assert.strictEqual('protectedPaths' in evaluateDiffBounds([f(p, 10)], { ...o, reportProtectedPaths: 'true' }), false);
});

test('AC4.1 (#6019, bounds half): a protected test file no Key File named is reported under the option', () => {
  const out = evaluateDiffBounds([f('src/a.js', 5), f('plugin/hooks/x.test.js', 30)], { ...BOUNDS, keyFiles: ['src/a.js'], reportProtectedPaths: true });
  assert.strictEqual(out.withinBounds, true);
  assert.deepStrictEqual(out.protectedPaths, ['plugin/hooks/x.test.js']);
});

test('AC5.1 (#6019): a rename whose oldPath is protected is reported under the option and refused without it', () => {
  const renamed = { ...f('src/new.js', 3), oldPath: 'plugin/hooks/old.js' };
  const o = { ...BOUNDS, keyFiles: ['src/new.js'] };
  const on = evaluateDiffBounds([renamed], { ...o, reportProtectedPaths: true });
  assert.strictEqual(on.withinBounds, true);
  assert.deepStrictEqual(on.protectedPaths, ['plugin/hooks/old.js']);
  assert.ok(evaluateDiffBounds([renamed], o).violations.includes('protected path: plugin/hooks/old.js'));
  const ci = { ...f('src/new.js', 3), oldPath: '.github/workflows/ci.yml' };
  const out = evaluateDiffBounds([ci], { ...o, reportProtectedPaths: true });
  assert.ok(out.violations.includes('protected path: .github/workflows/ci.yml'));
  assert.deepStrictEqual(out.protectedPaths, []);
});

test('protectedPaths lists each path once, in encounter order (#6019)', () => {
  const a = { ...f('plugin/hooks/a.js', 3), oldPath: 'plugin/hooks/b.js' };
  const b = { ...f('plugin/hooks/b.js', 3), oldPath: 'plugin/hooks/a.js' };
  const out = evaluateDiffBounds([a, b], { ...BOUNDS, keyFiles: ['plugin/hooks/a.js', 'plugin/hooks/b.js'], reportProtectedPaths: true });
  assert.deepStrictEqual(out.protectedPaths, ['plugin/hooks/a.js', 'plugin/hooks/b.js']);
});

test('AC7.1 (#6019): a path both protected and merge-sensitive stays a violation under the option', () => {
  const p = 'plugin/hooks/x.js';
  const out = evaluateDiffBounds([f(p, 3)], { ...BOUNDS, keyFiles: [p], sensitivePaths: ['plugin/hooks/**'], reportProtectedPaths: true });
  assert.ok(out.violations.includes(`protected path: ${p}`));
  assert.ok(out.violations.includes(`merge-sensitive path: ${p}`));
  assert.deepStrictEqual(out.protectedPaths, []);
});

test('AC9.2 (#6019, bounds half): build-time paths stay violations under the option', () => {
  for (const p of BUILD_TIME) {
    const out = evaluateDiffBounds([f(p, 1)], { ...BOUNDS, keyFiles: [p], reportProtectedPaths: true });
    assert.ok(out.violations.includes(`protected path: ${p}`), p);
    assert.deepStrictEqual(out.protectedPaths, [], p);
  }
});

// #6020: the protected list is a glob parameter; the shipped globs answer as the pre-#6020 regexes did.
const INFRA = ['infra/**'];
const TODAY_PROTECTED_RES = [
  /(^|\/)hooks\//,
  /(^|\/)hooks\.js$/,
  /(^|\/)hooks\.sh$/,
  /(^|\/)skills\/_shared\//,
  /(^|\/)\.github\//,
  /(^|\/)\.gitlab-ci\.yml$/,
  /(^|\/)\.circleci\//,
  /(^|\/)\.githooks\//,
  /(^|\/)\.husky\//,
  /(^|\/)CODEOWNERS$/,
  /(^|\/)package\.json$/,
  /(^|\/)\.claude\/settings[^/]*\.json$/,
  /(^|\/)\.mcp\.json$/,
  /(^|\/)\.claude-tweaks\/policy\.yml$/,
  /(^|\/)\.claude-tweaks\/verify-scope\.json$/,
];
function familyCorpus(glob) {
  const a = glob.replace(/^\*\*\//, '');
  if (a.endsWith('/**/*')) {
    const d = a.slice(0, -5);
    return [`${d}/x.js`, `a/b/${d}/x.js`, `${d}/a/b/c.js`, d, `${d}/`, `${d}x/x.js`, `x${d}/y.js`];
  }
  const fl = a.replace('*', '.local');
  return [fl, `a/b/${fl}`, `${fl}.bak`, `my-${fl}`];
}

test('AC1.1: the shipped glob list answers every corpus path as the pre-#6020 regexes do', () => {
  const named = ['hooks/x.js', 'a/hooks/x.js', 'hooks.js', 'a/b/hooks.sh', '.github/workflows/ci.yml', 'CODEOWNERS', 'docs/CODEOWNERS', 'package.json', 'a/package.json', '.claude/settings.local.json', '.claude-tweaks/policy.yml', '.claude-tweaks/verify-scope.json', 'hooksmith/x.js', 'package.json.bak', 'my-hooks.js', 'hooks', '.github', 'skills/_shared', 'a\n/hooks/x.js', '.github/a\nb/c.yml', '.github/a\u2028b/c.yml', 'x\r/hooks/y.js', 'a\n/package.json', 'a\u2029/skills/_shared/z.md', './hooks/x.js', 'hooks\\x.js', 'a/../package.json', '.github/./ci.yml'];
  const oldCanonical = (q) => { const n = path.posix.normalize(q.replace(/\\/g, '/')); return n.startsWith('./') ? n.slice(2) : n; };
  const corpus = [...PROTECTED_FAMILIES.flatMap((fam) => familyCorpus(fam.glob)), ...named];
  assert.strictEqual(TODAY_PROTECTED_RES.length, 15);
  assert.strictEqual(PROTECTED_FAMILIES.length, 15);
  assert.ok(PROTECTED_FAMILIES.every((fam) => fam.glob.startsWith('**/')));
  assert.deepStrictEqual(SHIPPED_PROTECTED_PATHS, PROTECTED_FAMILIES.map((fam) => fam.glob));
  assert.ok(Object.isFrozen(SHIPPED_PROTECTED_PATHS));
  assert.deepStrictEqual(corpus.filter((q) => isProtectedPath(q) !== TODAY_PROTECTED_RES.some((re) => re.test(oldCanonical(q)))), []);
});

test('AC2.1 (eligibility half): under [infra/**] package.json is not protected and infra/main.tf is', () => {
  for (const base of [OPTS, DRIVER]) {
    const o = { ...base, protectedPathGlobs: INFRA };
    assert.ok(!evaluateRecordEligibility(withKey('package.json'), o).reasons.includes('protected path: package.json'));
    assert.ok(evaluateRecordEligibility(withKey('infra/main.tf'), o).reasons.includes('protected path: infra/main.tf'));
    assert.ok(evaluateRecordEligibility(withKey('package.json'), base).reasons.includes('protected path: package.json'));
  }
});

test('AC3.1 (eligibility and bounds halves): [] protects nothing', () => {
  const r = evaluateRecordEligibility(withKey('plugin/hooks/x.js'), { ...OPTS, protectedPathGlobs: [] });
  assert.ok(!r.reasons.some((x) => x.startsWith('protected path:')));
  assert.deepStrictEqual(evaluateDiffBounds([f('plugin/hooks/x.js', 3)], { ...BOUNDS, keyFiles: ['plugin/hooks/x.js'], protectedPathGlobs: [] }).violations, []);
});

test('AC6.1, AC6.2: project globs are root-anchored', () => {
  assert.strictEqual(isProtectedPath('package.json', ['package.json']), true);
  assert.strictEqual(isProtectedPath('a/package.json', ['package.json']), false);
  assert.strictEqual(isProtectedPath('package.json', ['**/package.json']), true);
  assert.strictEqual(isProtectedPath('a/package.json', ['**/package.json']), true);
});

test('AC7.1: isProtectedPath refuses a non-array list', () => {
  const refusal = { name: 'TypeError', message: 'isProtectedPath: list must be an array of globs' };
  for (const bad of ['infra/**', null, 0]) assert.throws(() => isProtectedPath('a', bad), refusal, String(bad));
  assert.throws(() => ['hooks/x.js'].some(isProtectedPath), refusal);
});

test('AC9.1: adversarial spellings answer as their canonical path', () => {
  for (const q of ['hooks/./x.js', 'a/../hooks/x.js', 'hooks\\x.js', './hooks/x.js', 'hooks/']) {
    assert.strictEqual(isProtectedPath(q), true, q);
    assert.ok(evaluateRecordEligibility(withKey(q), OPTS).reasons.includes(`protected path: ${q}`), q);
  }
  for (const q of ['infra/./main.tf', 'x/../infra/main.tf', 'infra\\main.tf', './infra/main.tf', 'infra/']) {
    assert.strictEqual(isProtectedPath(q, INFRA), true, q);
    assert.ok(evaluateRecordEligibility(withKey(q), { ...OPTS, protectedPathGlobs: INFRA }).reasons.includes(`protected path: ${q}`), q);
  }
});

test('AC9.2: eligibility is case-sensitive', () => {
  assert.strictEqual(isProtectedPath('HOOKS/x.js'), false);
  assert.strictEqual(isProtectedPath('INFRA/main.tf', INFRA), false);
});

test('AC9.3: percent-encoding is a literal path, never decoded', () => {
  assert.strictEqual(isProtectedPath('infra%2fmain.tf', INFRA), false);
  assert.strictEqual(isProtectedPath('hooks%2fx.js'), false);
  assert.strictEqual(isProtectedPath('%2e%2e/hooks/x.js'), true);
});

test('AC10.2 (eligibility half): a never-matching glob protects nothing else', () => {
  assert.strictEqual(isProtectedPath('hooks/x.js', ['no/such/**']), false);
  assert.strictEqual(isProtectedPath('package.json', ['no/such/**']), false);
});

test('Review Focus 3: reviewer mode leaves a project-added path for the reviewer and keeps a build-time family refused', () => {
  const o = { ...REVIEWER, protectedPathGlobs: ['infra/**', '**/package.json'] };
  const r = withKey('infra/main.tf');
  assert.strictEqual(evaluateRecordEligibility(r, o).eligible, true);
  assert.deepStrictEqual(widenedByFor(r.labels, ['infra/main.tf'], o), ['protected-path']);
  assert.ok(evaluateRecordEligibility(withKey('package.json'), o).reasons.includes('protected path: package.json'));
});

test('Review Focus 5: a rename from a project-protected oldPath is a violation', () => {
  const out = evaluateDiffBounds([{ ...f('src/new.js', 2), oldPath: 'infra/old.tf' }], { ...BOUNDS, keyFiles: ['src/new.js'], protectedPathGlobs: INFRA });
  assert.ok(out.violations.includes('protected path: infra/old.tf'));
});
