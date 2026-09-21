const { test } = require('node:test');
const assert = require('node:assert');
const { probeSuite } = require('../../../plugin/bin/lib/residue/probes/suite');
const { probeRelease } = require('../../../plugin/bin/lib/residue/probes/release');

const SCOPE = { ran: true, reason: null, base: 'a1b2c3d', headBranch: 'worktree-feat', branches: [], worktrees: [] };

test('a failing suite is reported as blast-radius residue', () => {
  const { findings, ran } = probeSuite({ scope: SCOPE, run: () => ({ code: 1, stdout: '# fail 1\nnot ok 3 - heading unique' }) });
  assert.strictEqual(ran, true);
  assert.strictEqual(findings[0].kind, 'suite');
  assert.strictEqual(findings[0].scope, 'blast-radius', 'a red suite at close time is this run\'s own concern regardless of who caused it');
});

test('a suite with more than 5 failing lines signals the cap instead of silently dropping the rest', () => {
  const stdout = ['# fail 8', ...Array.from({ length: 8 }, (_, i) => `not ok ${i + 1} - case ${i + 1}`)].join('\n');
  const { findings } = probeSuite({ scope: SCOPE, run: () => ({ code: 1, stdout }) });
  assert.match(findings[0].evidence, /\(\+3 more\)$/, `expected a +3 more cap signal, got ${JSON.stringify(findings[0].evidence)}`);
});

test('a suite with 5 or fewer failing lines carries no cap signal', () => {
  const stdout = ['# fail 3', 'not ok 1 - a', 'not ok 2 - b', 'not ok 3 - c'].join('\n');
  const { findings } = probeSuite({ scope: SCOPE, run: () => ({ code: 1, stdout }) });
  assert.ok(!findings[0].evidence.includes('more'), `expected no cap signal, got ${JSON.stringify(findings[0].evidence)}`);
});

test('a passing suite produces no findings', () => {
  assert.deepStrictEqual(probeSuite({ scope: SCOPE, run: () => ({ code: 0, stdout: '# pass 8' }) }).findings, []);
});

test('an unrunnable suite does not run, rather than reporting green', () => {
  const r = probeSuite({ scope: SCOPE, run: () => null });
  assert.strictEqual(r.ran, false);
  assert.deepStrictEqual(r.findings, []);
  assert.match(r.reason, /could not run/);
});

test('a timed-out suite does not run, rather than reporting green', () => {
  const r = probeSuite({ scope: SCOPE, run: () => ({ code: null, stdout: '', timedOut: true }) });
  assert.strictEqual(r.ran, false);
  assert.match(r.reason, /timed out/);
});

test('a buffer-overflowed suite run does not run, rather than reporting a fabricated failure', () => {
  const r = probeSuite({ scope: SCOPE, run: () => ({ code: null, stdout: '', bufferOverflowed: true }) });
  assert.strictEqual(r.ran, false);
  assert.deepStrictEqual(r.findings, []);
  assert.match(r.reason, /capture buffer/);
});

// #2257: generalized past the old manifest.name === 'claude-tweaks' gate and
// the current-manifest-version pointwise check — now a bootstrap-anchored
// sweep over every v* tag and CHANGELOG heading, with no manifest.name
// dependency at all. `mockRun(opts)` composes a fake `run(argv)` answering
// the four git calls the probe makes, in argv order: the bootstrap add-commit
// log, the manifest content at that commit, CHANGELOG.md at HEAD, and the v*
// tag list.
function mockRun({ addLog = 'deadbeef', manifestAtBootstrap = '{".": "1.0.0"}', changelog = '', tags = '' } = {}) {
  return (argv) => {
    const joined = argv.join(' ');
    if (joined.includes('log --diff-filter=A')) return addLog;
    if (/show \S+:\.release-please-manifest\.json/.test(joined)) return manifestAtBootstrap;
    if (joined.includes('CHANGELOG.md')) return changelog;
    if (joined.includes('tag -l')) return tags;
    return null;
  };
}

test('the release probe declines when .release-please-manifest.json was never bootstrapped', () => {
  const r = probeRelease({ scope: SCOPE, run: mockRun({ addLog: '' }) });
  assert.strictEqual(r.ran, false);
  assert.match(r.reason, /not applicable/);
  assert.match(r.reason, /never added/);
});

test('the release probe declines when the bootstrap manifest carries no single package version', () => {
  const r = probeRelease({ scope: SCOPE, run: mockRun({ manifestAtBootstrap: '{"pkg-a": "1.0.0", "pkg-b": "2.0.0"}' }) });
  assert.strictEqual(r.ran, false);
  assert.match(r.reason, /could not read a single package version/);
});

test('#2257 AC5: the probe runs and produces a meaningful (non-no-op) result on a non-claude-tweaks project — proving the manifest.name gate removal actually generalized it', () => {
  // No `manifest` argument at all — the new probe signature never reads one.
  // A fixture whose CHANGELOG is missing the v2.0.0 tag's heading proves the
  // check actually executed its comparison logic on this project, rather
  // than merely no longer refusing to run.
  const run = mockRun({
    manifestAtBootstrap: '{".": "1.0.0"}',
    changelog: '# Changelog\n\n## v1.0.0 — first\n',
    tags: 'v1.0.0\nv2.0.0\n',
  });
  const { ran, findings } = probeRelease({ scope: SCOPE, run });
  assert.strictEqual(ran, true);
  assert.ok(findings.length > 0, 'expected a real finding, not a no-op result');
  assert.ok(findings.some((f) => f.evidence.includes('v2.0.0')), 'the untagged-heading gap must name the specific version');
});

test('a tag missing its CHANGELOG heading is reported', () => {
  const run = mockRun({ changelog: '# Changelog\n\n## v1.0.0 — old\n', tags: 'v1.0.0\nv1.1.0\n' });
  const { findings } = probeRelease({ scope: SCOPE, run });
  assert.ok(findings.some((f) => f.evidence.includes('CHANGELOG.md') && f.evidence.includes('v1.1.0')), 'the missing changelog entry must be named');
});

test('a CHANGELOG heading missing its tag is reported', () => {
  const run = mockRun({ changelog: '# Changelog\n\n## v1.0.0 — old\n\n## v1.1.0 — untagged\n', tags: 'v1.0.0\n' });
  const { findings } = probeRelease({ scope: SCOPE, run });
  assert.ok(findings.some((f) => f.evidence.includes('no matching v1.1.0 tag')), 'the untagged heading must be named');
});

test('a version before the bootstrap anchor is never flagged, in either direction', () => {
  // Bootstrap anchor is 2.0.0 — a v1.x tag/heading pair with no counterpart
  // predates release-please adoption and must not be reported.
  const run = mockRun({
    manifestAtBootstrap: '{".": "2.0.0"}',
    changelog: '# Changelog\n\n## v1.5.0 — pre-bootstrap, untagged\n\n## v2.0.0 — bootstrap\n',
    tags: 'v2.0.0\n',
  });
  const { findings } = probeRelease({ scope: SCOPE, run });
  assert.deepStrictEqual(findings, []);
});

test('a complete tag/CHANGELOG set at or after the anchor produces no findings', () => {
  const run = mockRun({
    manifestAtBootstrap: '{".": "1.0.0"}',
    changelog: '# Changelog\n\n## v1.0.0 — first\n\n## v1.1.0 — second\n',
    tags: 'v1.0.0\nv1.1.0\n',
  });
  const { findings } = probeRelease({ scope: SCOPE, run });
  assert.deepStrictEqual(findings, []);
});

// A bootstrapped repo's CHANGELOG straddles two grammars: the pre-migration
// `## vX.Y.Z — {summary}` entries below the boundary, and release-please's
// `## [X.Y.Z](compare-url) (date)` / `## X.Y.Z (date)` above it. Recognizing only
// the legacy form would report every real release-please release as a tag with no
// CHANGELOG entry, permanently, starting with the first post-migration release.
test('a release-please-generated heading counts as this tag\'s CHANGELOG entry, in both URL and no-URL forms', () => {
  const run = mockRun({
    manifestAtBootstrap: '{".": "1.0.0"}',
    changelog: [
      '# Changelog',
      '',
      '## [1.2.0](https://github.com/acme/widget/compare/v1.1.0...v1.2.0) (2026-09-22)',
      '',
      '### Features',
      '',
      '* something ([abc1234](https://github.com/acme/widget/commit/abc1234))',
      '',
      '## 1.1.0 (2026-09-21)',
      '',
      '### Bug Fixes',
      '',
      '* something else',
      '',
      '## v1.0.0 — legacy grammar, pre-migration',
      '',
    ].join('\n'),
    tags: 'v1.0.0\nv1.1.0\nv1.2.0\n',
  });
  const { ran, findings } = probeRelease({ scope: SCOPE, run });
  assert.strictEqual(ran, true);
  assert.deepStrictEqual(findings, [], 'release-please headings must satisfy their tags, not read as missing entries');
});

test('a release-please-generated heading with no tag is reported, in both URL and no-URL forms', () => {
  const run = mockRun({
    manifestAtBootstrap: '{".": "1.0.0"}',
    changelog: [
      '# Changelog',
      '',
      '## [1.2.0](https://github.com/acme/widget/compare/v1.1.0...v1.2.0) (2026-09-22)',
      '',
      '## 1.1.0 (2026-09-21)',
      '',
      '## v1.0.0 — legacy grammar, pre-migration',
      '',
    ].join('\n'),
    tags: 'v1.0.0\n',
  });
  const { findings } = probeRelease({ scope: SCOPE, run });
  assert.ok(
    findings.some((f) => f.evidence.includes('no matching v1.2.0 tag')),
    `the untagged linked-form heading must be named, got ${JSON.stringify(findings.map((f) => f.evidence))}`,
  );
  assert.ok(
    findings.some((f) => f.evidence.includes('no matching v1.1.0 tag')),
    `the untagged bare-form heading must be named, got ${JSON.stringify(findings.map((f) => f.evidence))}`,
  );
});
