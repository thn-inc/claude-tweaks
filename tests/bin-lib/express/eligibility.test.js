'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const {
  EXPRESS_MAX_KEY_FILES, REASONS, isProtectedPath, evaluateRecordEligibility, evaluateDiffBounds, expressMergeVerification,
} = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'express', 'eligibility.js'));
const { resolveBlastRadiusConfig } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'blast-radius-cli.js'));

const ELIGIBLE_LABELS = ['risk:low', 'size:low', 'ceremony:fast-lane', 'type:task'];
const ELIGIBLE_KEYS = ['plugin/skills/init/claude-md-template.md', 'CLAUDE.md'];
const OPTS = { enabled: true, integrationModel: 'pr-first', sensitivePaths: [] };

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
  });
  assert.strictEqual(protectedPath('a/b'), 'protected path: a/b');
  assert.strictEqual(sensitivePath('a/b'), 'merge-sensitive path: a/b');
});

test('consumer-portability: protected paths are project-agnostic', () => {
  assert.strictEqual(isProtectedPath('.claude/hooks/x.sh'), true);
  assert.strictEqual(isProtectedPath('lib/hooks.js'), true);
  assert.strictEqual(isProtectedPath('skills/_shared/a.md'), true);
  assert.strictEqual(isProtectedPath('.claude-tweaks/policy.yml'), true);
  assert.strictEqual(isProtectedPath('.github/CODEOWNERS'), true);
  assert.strictEqual(isProtectedPath('apps/web/package.json'), true);
  assert.strictEqual(isProtectedPath('docs/my-package.json'), false);
  assert.strictEqual(isProtectedPath('docs/settings.json'), false);
  assert.strictEqual(isProtectedPath('docs/hookshot.md'), false);
  assert.strictEqual(isProtectedPath('src/webhooks/a.js'), false);
  assert.strictEqual(isProtectedPath('src/webhooks.js'), false);
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
