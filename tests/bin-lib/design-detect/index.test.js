// tests/bin-lib/design-detect/index.test.js — pins every Layer 1/2/3 outcome,
// every row of the track-resolution table (SKILL.md's "Universal
// preconditions" Step 1), and the surface_track_override recording rule
// (#885). Fixture-only — never reads this repo's live CLAUDE.md or a real
// Impeccable install (IL-80's fixture-not-live-corpus rule).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const dd = require('../../../plugin/bin/lib/design-detect');

// --- Layer 1 — kill-switch ---

test('layer1: enabled proceeds', () => {
  assert.deepEqual(dd.layer1('enabled'), { proceed: true });
});
test('layer1: plugin-only proceeds', () => {
  assert.deepEqual(dd.layer1('plugin-only'), { proceed: true });
});
test('layer1: disabled skips with the disabled reason', () => {
  assert.deepEqual(dd.layer1('disabled'), { proceed: false, reason: dd.SKIP_REASONS.DISABLED });
});
test('layer1: missing (null) skips with the missing reason', () => {
  assert.deepEqual(dd.layer1(null), { proceed: false, reason: dd.SKIP_REASONS.MISSING });
});
test('layer1: unrecognized value treated as missing', () => {
  assert.deepEqual(dd.layer1('sideways'), { proceed: false, reason: dd.SKIP_REASONS.MISSING });
});

test('readDesignIntegrationFlag: reads the key from within the Design integration section', () => {
  const md = '# CLAUDE.md\n\n## Design integration\n\ndesign-integration: enabled\n\n## Other\n\ndesign-integration: disabled\n';
  assert.equal(dd.readDesignIntegrationFlag(md), 'enabled');
});
test('readDesignIntegrationFlag: absent section returns null', () => {
  assert.equal(dd.readDesignIntegrationFlag('# CLAUDE.md\n\nno section here\n'), null);
});
test('readDesignIntegrationFlag: section present but key absent returns null', () => {
  const md = '## Design integration\n\ndiagram-suggestions: enabled\n';
  assert.equal(dd.readDesignIntegrationFlag(md), null);
});
test('readDesignIntegrationFlag: empty/non-string input returns null', () => {
  assert.equal(dd.readDesignIntegrationFlag(''), null);
  assert.equal(dd.readDesignIntegrationFlag(undefined), null);
});

// --- Layer 2 — Surface: body-metadata ---

test('layer2: backend skips with the non-frontend-surface reason', () => {
  assert.deepEqual(dd.layer2('backend'), { proceed: false, reason: dd.SKIP_REASONS.NON_FRONTEND_SURFACE });
});
test('layer2: infra skips with the non-frontend-surface reason', () => {
  assert.deepEqual(dd.layer2('infra'), { proceed: false, reason: dd.SKIP_REASONS.NON_FRONTEND_SURFACE });
});
test('layer2: web/mobile/desktop/terminal all proceed and normalize to lowercase', () => {
  for (const s of ['web', 'mobile', 'desktop', 'terminal']) {
    assert.deepEqual(dd.layer2(s), { proceed: true, surface: s });
  }
});
test('layer2: legacy "frontend" reads as web', () => {
  assert.deepEqual(dd.layer2('frontend'), { proceed: true, surface: 'web' });
});
test('layer2: missing surface proceeds with surface null (fall-through)', () => {
  assert.deepEqual(dd.layer2(null), { proceed: true, surface: null });
  assert.deepEqual(dd.layer2(undefined), { proceed: true, surface: null });
  assert.deepEqual(dd.layer2(''), { proceed: true, surface: null });
});
test('layer2: unrecognized value falls through as missing, not a hard skip', () => {
  assert.deepEqual(dd.layer2('mixed'), { proceed: true, surface: null });
});

// --- Track resolution — every row of SKILL.md's table ---

test('track: platform=web, any surface -> web, no override', () => {
  assert.deepEqual(dd.resolveTrack({ platform: 'web', surface: null }), { track: 'web' });
  assert.deepEqual(dd.resolveTrack({ platform: 'web', surface: 'web' }), { track: 'web' });
  assert.deepEqual(dd.resolveTrack({ platform: 'web', surface: 'desktop' }), { track: 'web' });
});
test('track: platform=ios/android/adaptive -> native, platform named', () => {
  for (const p of ['ios', 'android', 'adaptive']) {
    assert.deepEqual(dd.resolveTrack({ platform: p, surface: null }), { track: 'native', platform: p });
  }
});
test('track: platform=null, surface web/desktop/missing -> web', () => {
  assert.deepEqual(dd.resolveTrack({ platform: null, surface: 'web' }), { track: 'web' });
  assert.deepEqual(dd.resolveTrack({ platform: null, surface: 'desktop' }), { track: 'web' });
  assert.deepEqual(dd.resolveTrack({ platform: null, surface: null }), { track: 'web' });
});
test('track: platform=null, surface=mobile -> native, adaptive inferred', () => {
  assert.deepEqual(dd.resolveTrack({ platform: null, surface: 'mobile' }), { track: 'native', platform: 'adaptive', inferred: true });
});
test('track: surface=terminal wins over any platform -> terminal', () => {
  assert.deepEqual(dd.resolveTrack({ platform: null, surface: 'terminal' }), { track: 'terminal' });
  assert.deepEqual(dd.resolveTrack({ platform: 'web', surface: 'terminal' }), {
    track: 'terminal',
    surface_track_override: { platform: 'web', surface: 'terminal', winner: 'surface' },
  });
  assert.deepEqual(dd.resolveTrack({ platform: 'ios', surface: 'terminal' }), {
    track: 'terminal',
    surface_track_override: { platform: 'ios', surface: 'terminal', winner: 'surface' },
  });
});

// --- Disagreement recording (surface_track_override) ---

test('override: platform=web vs Surface=mobile — platform wins, disagreement recorded', () => {
  assert.deepEqual(dd.resolveTrack({ platform: 'web', surface: 'mobile' }), {
    track: 'web',
    surface_track_override: { platform: 'web', surface: 'mobile', winner: 'platform' },
  });
});
test('override: platform=ios vs Surface=web — platform wins, disagreement recorded', () => {
  assert.deepEqual(dd.resolveTrack({ platform: 'ios', surface: 'web' }), {
    track: 'native',
    platform: 'ios',
    surface_track_override: { platform: 'ios', surface: 'web', winner: 'platform' },
  });
});
test('no override: platform=ios, Surface=mobile — they agree', () => {
  assert.deepEqual(dd.resolveTrack({ platform: 'ios', surface: 'mobile' }), { track: 'native', platform: 'ios' });
});
test('no override: platform=null, Surface=mobile — nothing to disagree with (the inferred row)', () => {
  const r = dd.resolveTrack({ platform: null, surface: 'mobile' });
  assert.equal(r.surface_track_override, undefined);
});

// --- Layer 3 — file-extension/path sniff ---

test('layer3: trigger extensions match', () => {
  for (const f of ['a.tsx', 'b.jsx', 'c.vue', 'd.svelte', 'e.html', 'f.css', 'g.scss', 'h.sass', 'i.less', 'j.astro', 'k.mdx']) {
    assert.equal(dd.fileMatchesFrontendPredicate(f), true, f);
  }
});
test('layer3: trigger path segments match regardless of extension', () => {
  for (const f of ['src/components/Button.ts', 'src/pages/index.js', 'app/layout.tsx', 'src/routes/+page.js', 'views/index.erb', 'src/ui/theme.ts']) {
    assert.equal(dd.fileMatchesFrontendPredicate(f), true, f);
  }
});
test('layer3: negative cases do not match', () => {
  for (const f of ['src/utils/cache.ts', 'lib/index.js', 'README.md', 'config.json', 'policy.yaml', 'main.py', 'schema.sql', 'Dockerfile']) {
    assert.equal(dd.fileMatchesFrontendPredicate(f), false, f);
  }
});
test('layer3: .d.ts type-only files do not match', () => {
  assert.equal(dd.fileMatchesFrontendPredicate('types/global.d.ts'), false);
});
test('layer3: Next.js API route handlers do not match the app/pages segment rule (#1786)', () => {
  for (const f of ['app/api/users/route.ts', 'pages/api/health.ts', 'src/app/api/x/route.js']) {
    assert.equal(dd.fileMatchesFrontendPredicate(f), false, f);
  }
});
test('layer3: an extension match under app/api still wins over the API-route exclusion', () => {
  assert.equal(dd.fileMatchesFrontendPredicate('app/api/x/page.tsx'), true);
});
test('layer3: the app/pages segment rule is otherwise intact', () => {
  assert.equal(dd.fileMatchesFrontendPredicate('app/dashboard/page.ts'), true);
});
test('layer3(): zero matches skips with the sniff reason; one match proceeds', () => {
  assert.deepEqual(dd.layer3(['src/utils/cache.ts', 'README.md']), { proceed: false, reason: dd.SKIP_REASONS.NON_FRONTEND_SNIFF });
  assert.deepEqual(dd.layer3(['src/components/Button.tsx']), { proceed: true });
  assert.deepEqual(dd.layer3([]), { proceed: false, reason: dd.SKIP_REASONS.NON_FRONTEND_SNIFF });
});
test('layer3(): observed file list (two app/api route.ts, one .test.ts, four .md) skips with the sniff reason (#1786)', () => {
  const files = [
    'app/api/foo/route.ts',
    'app/api/bar/route.ts',
    'src/utils/cache.test.ts',
    'README.md',
    'docs/one.md',
    'docs/two.md',
    'docs/three.md',
  ];
  assert.deepEqual(dd.layer3(files), { proceed: false, reason: dd.SKIP_REASONS.NON_FRONTEND_SNIFF });
});

// --- layer3Applies — the fallback-only table ---

test('layer3Applies: web track always runs', () => {
  assert.equal(dd.layer3Applies({ track: 'web', surfaceDeclared: false }), true);
  assert.equal(dd.layer3Applies({ track: 'web', surfaceDeclared: true }), true);
});
test('layer3Applies: native track with surface declared skips (web-only sniff cannot rule on native)', () => {
  assert.equal(dd.layer3Applies({ track: 'native', surfaceDeclared: true }), false);
});
test('layer3Applies: native track with surface missing runs', () => {
  assert.equal(dd.layer3Applies({ track: 'native', surfaceDeclared: false }), true);
});
test('layer3Applies: terminal track always skips (declared-only, no trigger table)', () => {
  assert.equal(dd.layer3Applies({ track: 'terminal', surfaceDeclared: true }), false);
});

// --- evaluate() — full per-mode orchestration ---

test('evaluate: Layer 1 disabled short-circuits before any track is resolved', () => {
  const r = dd.evaluate({ mode: 'review', designIntegrationValue: 'disabled', surface: 'web', files: ['a.tsx'] });
  assert.deepEqual(r, { decision: 'skip', reason: dd.SKIP_REASONS.DISABLED });
});

test('evaluate: a backend-only run resolves its skip with no track resolved', () => {
  const r = dd.evaluate({ mode: 'review', designIntegrationValue: 'enabled', surface: 'backend', files: ['src/api/users.ts'] });
  assert.deepEqual(r, { decision: 'skip', reason: dd.SKIP_REASONS.NON_FRONTEND_SURFACE });
  assert.equal('track' in r, false);
});

test('evaluate: web track, matching file -> proceed with track', () => {
  const r = dd.evaluate({ mode: 'review', designIntegrationValue: 'enabled', surface: 'web', files: ['src/components/Button.tsx'] });
  assert.deepEqual(r, { decision: 'proceed', track: 'web' });
});

test('evaluate: web track, no matching file -> sniff skip, track still surfaced', () => {
  const r = dd.evaluate({ mode: 'review', designIntegrationValue: 'enabled', surface: null, files: ['src/utils/cache.ts'] });
  assert.deepEqual(r, { decision: 'skip', reason: dd.SKIP_REASONS.NON_FRONTEND_SNIFF, track: 'web' });
});

test('evaluate: native track with declared surface skips Layer 3 and proceeds regardless of files', () => {
  const r = dd.evaluate({ mode: 'review', designIntegrationValue: 'enabled', surface: 'mobile', platform: 'ios', files: [] });
  assert.deepEqual(r, { decision: 'proceed', track: 'native', platform: 'ios' });
});

test('evaluate: terminal track never runs Layer 3', () => {
  const r = dd.evaluate({ mode: 'review', designIntegrationValue: 'enabled', surface: 'terminal', files: [] });
  assert.deepEqual(r, { decision: 'proceed', track: 'terminal' });
});

test('evaluate: test mode on native track skips with the CLI-detector-web-only reason', () => {
  const r = dd.evaluate({ mode: 'test', designIntegrationValue: 'enabled', surface: 'mobile', platform: 'ios', files: [] });
  assert.deepEqual(r, { decision: 'skip', reason: dd.SKIP_REASONS.TEST_NATIVE, track: 'native', platform: 'ios' });
});

test('evaluate: live mode on native track skips with the live-mode-web-only reason', () => {
  const r = dd.evaluate({ mode: 'live', designIntegrationValue: 'enabled', platform: 'ios', files: [] });
  assert.deepEqual(r, { decision: 'skip', reason: dd.SKIP_REASONS.LIVE_NATIVE, track: 'native', platform: 'ios' });
});

test('evaluate: doctor mode is structurally inapplicable to Layers 2/3 — no outcome depends on track', () => {
  const withSurface = dd.evaluate({ mode: 'doctor', designIntegrationValue: 'enabled', surface: 'backend' });
  const withoutSurface = dd.evaluate({ mode: 'doctor', designIntegrationValue: 'enabled' });
  // doctor never reads Surface: at all — passing one has no effect, and both proceed.
  assert.equal(withSurface.decision, 'proceed');
  assert.equal(withoutSurface.decision, 'proceed');
});

test('evaluate: explore mode is structurally inapplicable to Layers 2/3, same as doctor', () => {
  const r = dd.evaluate({ mode: 'explore', designIntegrationValue: 'enabled' });
  assert.equal(r.decision, 'proceed');
});

test('evaluate: reset-recommendations runs no preconditions at all', () => {
  const r = dd.evaluate({ mode: 'reset-recommendations', designIntegrationValue: 'disabled' });
  assert.deepEqual(r, { decision: 'proceed' });
});

test('evaluate: shape mode skips Layer 2 (no spec yet) but still runs Layer 1 and Layer 3', () => {
  const disabled = dd.evaluate({ mode: 'shape', designIntegrationValue: 'disabled', files: ['a.tsx'] });
  assert.deepEqual(disabled, { decision: 'skip', reason: dd.SKIP_REASONS.DISABLED });
  const sniffed = dd.evaluate({ mode: 'shape', designIntegrationValue: 'enabled', files: ['a.tsx'] });
  assert.deepEqual(sniffed, { decision: 'proceed', track: 'web' });
});

test('evaluate: unknown mode throws', () => {
  assert.throws(() => dd.evaluate({ mode: 'not-a-mode' }), /unknown mode/);
});

test('evaluate: surface_track_override propagates through to a skip outcome too', () => {
  const r = dd.evaluate({ mode: 'test', designIntegrationValue: 'enabled', surface: 'web', platform: 'ios', files: [] });
  assert.equal(r.decision, 'skip');
  assert.equal(r.reason, dd.SKIP_REASONS.TEST_NATIVE);
  assert.deepEqual(r.surface_track_override, { platform: 'ios', surface: 'web', winner: 'platform' });
});
