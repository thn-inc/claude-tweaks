'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PHASES, phaseBundles } = require('../../../plugin/bin/lib/compose-context/phases');
const { STEP_RE } = require('../../../plugin/bin/compose-context');
const { readText } = require('../../helpers/read-skill');
const { selectSections, SectionError } = require('../../../plugin/bin/lib/compose-context/sections');

const PLUGIN = path.join(__dirname, '..', '..', '..', 'plugin');

test('PHASES registers exactly the five dispatch phases (#4027, #4359)', () => {
  assert.deepEqual(Object.keys(PHASES).sort(), ['first-call', 'review-lens', 'review-lens-child', 'sdd-child', 'second-call']);
  assert.ok(Object.isFrozen(PHASES), 'the registry is frozen');
});

test('the registry is frozen all the way down — phase, bundle list, bundle and source list', () => {
  for (const [phase, entry] of Object.entries(PHASES)) {
    assert.ok(Object.isFrozen(entry), `${phase} entry`);
    assert.ok(Object.isFrozen(entry.bundles), `${phase} bundles`);
    for (const bundle of entry.bundles) {
      assert.ok(Object.isFrozen(bundle), `${phase}/${bundle.step}`);
      assert.ok(Object.isFrozen(bundle.sources), `${phase}/${bundle.step} sources`);
      if (bundle.sections !== undefined) {
        assert.ok(Object.isFrozen(bundle.sections), `${phase}/${bundle.step} sections`);
        for (const [label, selectors] of Object.entries(bundle.sections)) {
          assert.ok(Object.isFrozen(selectors), `${phase}/${bundle.step} sections[${label}]`);
        }
      }
    }
  }
});

// Every sectioned source of every bundle: each key is one of the bundle's
// sources, each value a non-empty selector list, and selection succeeds on `content(label)`.
// The prompt files that cite each sectioned bundle's rules (lens-depth is whole-file).
const CITERS = {
  'lens-child': 'plugin/skills/review/step3-lens-dispatch.md',
  'sdd-child': 'plugin/skills/build/dispatch.md',
};
function checkSectionedSources(content) {
  for (const [phase, { bundles }] of Object.entries(PHASES)) {
    for (const bundle of bundles) {
      if (bundle.sections === undefined) continue;
      for (const [label, selectors] of Object.entries(bundle.sections)) {
        assert.ok(bundle.sources.includes(label), `${phase}/${bundle.step}: sections key ${label} is one of its sources`);
        assert.ok(Array.isArray(selectors) && selectors.length > 0, `${phase}/${bundle.step}: ${label} has selectors`);
        try {
          selectSections(content(label), selectors, label);
        } catch (err) {
          if (!(err instanceof SectionError)) throw err;
          assert.fail(`${phase}/${bundle.step}: ${label}: ${err.message} — a rule cited by ${CITERS[bundle.step] || '(no citer recorded)'} no longer resolves; update the selector and its citers together`);
        }
      }
    }
  }
}
const realContent = (label) => readText(path.join(PLUGIN, label));

test('every sectioned source names selectors that resolve in the real file', () => {
  assert.ok(Object.values(PHASES).some(({ bundles }) => bundles.some((b) => b.sections)), 'at least one bundle is sectioned');
  checkSectionedSources(realContent);
});

test('a reworded lead is caught (discrimination proof)', () => {
  const reworded = (label) => {
    const text = realContent(label);
    return label === 'skills/_shared/subagent-output-contract.md' ? text.replace('**Scratch rule.**', '**Scratch rules.**') : text;
  };
  assert.throws(
    () => checkSectionedSources(reworded),
    (err) => err instanceof assert.AssertionError && /not found/.test(err.message)
      && /review-lens-child\/lens-child/.test(err.message) && err.message.includes('plugin/skills/review/step3-lens-dispatch.md'),
    'lens-child selects **Scratch rule.**, the lead plugin/skills/review/step3-lens-dispatch.md cites: a reworded lead must fail selection',
  );
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
    (err) => err instanceof TypeError && /unknown phase nope \(known: first-call, second-call, review-lens, review-lens-child, sdd-child\)/.test(err.message),
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

// All-or-none (#5668): composePhase applies every bundle's section selection,
// and validates each slice's markers, before writing the first bundle.
function twoBundlePhase(secondContent, selectors) {
  const root = require('../../helpers/tmp-dir').scratchDir('compose-sections-');
  const runDir = path.join(root, 'run');
  fs.mkdirSync(runDir);
  fs.writeFileSync(path.join(root, 'one.md'), '# One\nwhole file\n');
  fs.writeFileSync(path.join(root, 'two.md'), secondContent);
  const fake = () => [
    { step: 'first', load: 'on-demand', sources: [{ label: 'one.md', file: path.join(root, 'one.md') }] },
    { step: 'second', load: 'on-demand', sources: [{ label: 'two.md', file: path.join(root, 'two.md'), sections: selectors }] },
  ];
  return { root, runDir, deps: { phaseBundles: fake, execFileSync: () => 'gh version 2\n' } };
}

test('a phase whose second bundle fails section selection writes no bundle', () => {
  const { composePhase } = require('../../../plugin/bin/lib/compose-context');
  const f = twoBundlePhase('# Two\n\n**Present.** text\n', ['**Missing.**']);
  assert.throws(
    () => composePhase({ runDir: f.runDir, phase: 'sdd-child', pluginRoot: f.root, repoRoot: f.root }, f.deps),
    (err) => err instanceof SectionError && err.file === 'two.md' && /not found/.test(err.message),
  );
  assert.ok(!fs.existsSync(path.join(f.runDir, 'context')), 'no bundle written');
});

test('a phase whose second slice opens a when: block without closing it writes no bundle', () => {
  const { composePhase, MarkerError } = require('../../../plugin/bin/lib/compose-context');
  const f = twoBundlePhase('# Two\n\n## Sliced\n<!-- when: mode=auto -->\nnever closed\n## Next\n<!-- /when -->\n', ['## Sliced']);
  assert.throws(
    () => composePhase({ runDir: f.runDir, phase: 'sdd-child', pluginRoot: f.root, repoRoot: f.root }, f.deps),
    (err) => err instanceof MarkerError,
  );
  assert.ok(!fs.existsSync(path.join(f.runDir, 'context')), 'no bundle written');
});

test('a CRLF sectioned source composes the same slice as its LF twin', () => {
  const { composePhase } = require('../../../plugin/bin/lib/compose-context');
  const lf = '# Two\n\n## Sliced\nkept body\n\n## Next\ndropped\n';
  const read = (content) => {
    const f = twoBundlePhase(content, ['## Sliced']);
    const { bundles } = composePhase({ runDir: f.runDir, phase: 'sdd-child', pluginRoot: f.root, repoRoot: f.root }, f.deps);
    // Raw read: readText would strip a leaked \r and mask a missing normalization.
    return fs.readFileSync(bundles[1].path, 'utf8');
  };
  const lfText = read(lf);
  assert.ok(lfText.includes('kept body') && !lfText.includes('dropped'));
  assert.equal(read(lf.replace(/\n/g, '\r\n')), lfText);
});
