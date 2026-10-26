'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PHASES, phaseBundles } = require('../../../plugin/bin/lib/compose-context/phases');
const { STEP_RE } = require('../../../plugin/bin/compose-context');
const { readText } = require('../../helpers/read-skill');

const PLUGIN = path.join(__dirname, '..', '..', '..', 'plugin');

test('PHASES registers exactly the three dispatch phases (#4027)', () => {
  assert.deepEqual(Object.keys(PHASES).sort(), ['first-call', 'review-lens', 'second-call']);
  assert.ok(Object.isFrozen(PHASES), 'the registry is frozen');
});

test('the registry is frozen all the way down — phase, bundle list, bundle and source list', () => {
  for (const [phase, entry] of Object.entries(PHASES)) {
    assert.ok(Object.isFrozen(entry), `${phase} entry`);
    assert.ok(Object.isFrozen(entry.bundles), `${phase} bundles`);
    for (const bundle of entry.bundles) {
      assert.ok(Object.isFrozen(bundle), `${phase}/${bundle.step}`);
      assert.ok(Object.isFrozen(bundle.sources), `${phase}/${bundle.step} sources`);
    }
  }
});

test('every bundle has a CLI-legal step, an existing plugin-relative source list, and a known load', () => {
  for (const [phase, { bundles }] of Object.entries(PHASES)) {
    assert.ok(bundles.length > 0, `${phase} has at least one bundle`);
    for (const bundle of bundles) {
      assert.match(bundle.step, STEP_RE, `${phase}: step ${bundle.step}`);
      assert.ok(['always', 'on-demand'].includes(bundle.load), `${phase}/${bundle.step}: load ${bundle.load}`);
      assert.ok(bundle.sources.length > 0, `${phase}/${bundle.step} has sources`);
      for (const src of bundle.sources) {
        assert.ok(fs.existsSync(path.join(PLUGIN, src)), `${phase}/${bundle.step}: ${src} exists under plugin/`);
      }
    }
  }
});

test('phaseBundles resolves each source to an absolute file under the plugin root, labelled by its registry path', () => {
  const bundles = phaseBundles('second-call', PLUGIN);
  assert.deepEqual(bundles.map((b) => [b.step, b.load]), [['claims', 'on-demand'], ['merge', 'always']]);
  assert.deepEqual(bundles[1].sources, [
    { label: 'skills/_shared/pr-first-merge.md', file: path.resolve(PLUGIN, 'skills/_shared/pr-first-merge.md') },
    { label: 'skills/_shared/pr-checklist-refresh.md', file: path.resolve(PLUGIN, 'skills/_shared/pr-checklist-refresh.md') },
  ]);
});

test('phaseBundles returns null for an unknown phase, including an inherited Object key', () => {
  assert.equal(phaseBundles('nope', PLUGIN), null);
  assert.equal(phaseBundles('constructor', PLUGIN), null);
});

test('composePhase throws a TypeError naming the known phases for an unknown one (the CLI refuses first, so only a direct caller reaches it)', () => {
  const { composePhase } = require('../../../plugin/bin/lib/compose-context');
  assert.throws(
    () => composePhase({ runDir: '/nowhere', phase: 'nope', pluginRoot: PLUGIN, repoRoot: '/nowhere' }),
    (err) => err instanceof TypeError && /unknown phase nope \(known: first-call, second-call, review-lens\)/.test(err.message),
  );
});

// Hand-written `compose-context.js --step merge|claims` call lines in skill prose write the same
// {run}/context/{step}.md files a phase composes, so a source list that drifts from the registry
// makes whichever composer ran last overwrite the other's bundle.
function skillMarkdown(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return skillMarkdown(full);
    return e.name.endsWith('.md') ? [full] : [];
  });
}

const STEP_CALL_RE = /compose-context\.js"\s+--run\s+"\$PIPELINE_RUN_DIR"\s+--step\s+(merge|claims)((?:\s+"\$\{CLAUDE_PLUGIN_ROOT\}\/[^"\s]+")+)/g;

test('hand-written --step merge|claims call lines compose the registry\'s own source lists (#4027)', () => {
  const registry = {};
  for (const { bundles } of Object.values(PHASES)) {
    for (const b of bundles) {
      if (b.step !== 'merge' && b.step !== 'claims') continue;
      assert.deepEqual(registry[b.step] || b.sources, b.sources, `${b.step} has one source list across the phases`);
      registry[b.step] = b.sources;
    }
  }
  assert.deepEqual(Object.keys(registry).sort(), ['claims', 'merge']);
  let sites = 0;
  for (const file of skillMarkdown(path.join(PLUGIN, 'skills'))) {
    for (const m of readText(file).matchAll(STEP_CALL_RE)) {
      const listed = [...m[2].matchAll(/"\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)"/g)].map((x) => x[1]);
      assert.deepEqual(listed, [...registry[m[1]]], `${path.relative(PLUGIN, file)}: --step ${m[1]} sources match the phase registry`);
      sites += 1;
    }
  }
  assert.ok(sites >= 5, `found ${sites} hand-written merge/claims call lines, expected at least 5 — the matcher may have stopped seeing them`);
});
