// tests/bin-lib/residue/probes/release-generalized.test.js
//
// #2257 AC5: proves probeRelease's generalization off the
// `manifest.name === 'claude-tweaks'` gate actually took effect — not just
// that the literal gate line was deleted, but that the probe runs and
// produces a meaningful result on a project whose `manifest.name` is not
// `claude-tweaks`. Fixture shape follows the residue-probe suite's existing
// convention (tests/bin-lib/residue/probes-git.test.js's `stubRunner`): a
// responses map keyed by joined argv, standing in for a real checkout —
// never a manifest.name check, since the probe no longer reads one at all.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { probeRelease } = require('../../../../plugin/bin/lib/residue/probes/release');

const SCOPE = { ran: true, reason: null };
const INTRO_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function stubRunner(responses) {
  return (args) => {
    const key = args.join(' ');
    return Object.prototype.hasOwnProperty.call(responses, key) ? responses[key] : null;
  };
}

// A fictional non-claude-tweaks project ("acme-widgets") that bootstrapped
// release-please at 1.0.0 and has since tagged 1.1.0 and 1.2.0.
function acmeResponses({ changelog, tags }) {
  return {
    'git log --diff-filter=A --format=%H -- .release-please-manifest.json': INTRO_SHA,
    [`git show ${INTRO_SHA}:.release-please-manifest.json`]: JSON.stringify({ '.': '1.0.0' }),
    'git show HEAD:CHANGELOG.md': changelog,
    'git tag -l v*': tags.join('\n'),
  };
}

test('AC5: probeRelease runs and reports findings on a non-claude-tweaks project (acme-widgets) missing a CHANGELOG heading', () => {
  const run = stubRunner(acmeResponses({
    changelog: '# Changelog\n\n## v1.1.0\n- feature\n',
    tags: ['v1.0.0', 'v1.1.0', 'v1.2.0'],
  }));
  const result = probeRelease({ scope: SCOPE, run });
  assert.strictEqual(result.ran, true, 'the probe must actually run for a project whose manifest.name is not claude-tweaks');
  assert.ok(
    result.findings.some((f) => f.evidence.includes('v1.2.0') && f.evidence.includes('no "## v1.2.0" heading')),
    `expected a finding naming the missing v1.2.0 heading, got: ${JSON.stringify(result.findings)}`,
  );
});

test('AC5: probeRelease reports a CHANGELOG heading with no matching tag (the reverse gap)', () => {
  const run = stubRunner(acmeResponses({
    changelog: '# Changelog\n\n## v1.0.0\n- initial\n\n## v1.1.0\n- feature\n\n## v1.3.0\n- never tagged\n',
    tags: ['v1.0.0', 'v1.1.0'],
  }));
  const result = probeRelease({ scope: SCOPE, run });
  assert.strictEqual(result.ran, true);
  assert.ok(
    result.findings.some((f) => f.subject.includes('v1.3.0') && f.remedy === 'record'),
    `expected a reverse-gap finding for v1.3.0, got: ${JSON.stringify(result.findings)}`,
  );
});

test('AC5: a fully consistent non-claude-tweaks project produces no findings', () => {
  const run = stubRunner(acmeResponses({
    changelog: '# Changelog\n\n## v1.0.0\n- initial\n\n## v1.1.0\n- feature\n\n## v1.2.0\n- more\n',
    tags: ['v1.0.0', 'v1.1.0', 'v1.2.0'],
  }));
  const result = probeRelease({ scope: SCOPE, run });
  assert.strictEqual(result.ran, true);
  assert.deepStrictEqual(result.findings, []);
});

test('tags older than the bootstrap version are excluded from the check entirely', () => {
  // A pre-existing v0.9.0 tag predates release-please bootstrap (1.0.0) —
  // it must never be flagged even though it has no CHANGELOG heading here.
  const run = stubRunner(acmeResponses({
    changelog: '# Changelog\n\n## v1.0.0\n- initial\n',
    tags: ['v0.9.0', 'v1.0.0'],
  }));
  const result = probeRelease({ scope: SCOPE, run });
  assert.strictEqual(result.ran, true);
  assert.deepStrictEqual(result.findings, []);
});

test('no .release-please-manifest.json in history reports not-applicable, never a false green', () => {
  const run = stubRunner({
    'git log --diff-filter=A --format=%H -- .release-please-manifest.json': null,
  });
  const result = probeRelease({ scope: SCOPE, run });
  assert.strictEqual(result.ran, false);
  assert.match(result.reason, /not applicable/);
  assert.deepStrictEqual(result.findings, []);
});

test('an unresolved scope short-circuits before any git call', () => {
  const result = probeRelease({ scope: { ran: false, reason: 'no base' }, run: () => { throw new Error('must not be called'); } });
  assert.strictEqual(result.ran, false);
  assert.strictEqual(result.reason, 'no base');
});
