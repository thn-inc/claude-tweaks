'use strict';
// #5668: the child-facing bundles carry the `_shared` sections their prompts
// cite, not the whole shared files. Composes the real registry bundles.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { scratchDir } = require('./helpers/tmp-dir');
const { readText } = require('./helpers/read-skill');
const { composePhase } = require('../plugin/bin/lib/compose-context');

const PLUGIN = path.join(__dirname, '..', 'plugin');

function composeReal(phase) {
  const runDir = scratchDir('child-bundle-'); // fs.mkdtempSync, removed at exit
  const result = composePhase(
    { runDir, phase, pluginRoot: PLUGIN, repoRoot: runDir },
    { execFileSync: () => 'gh version 2\n' },
  );
  const byStep = {};
  for (const b of result.bundles) byStep[b.step] = { ...b, text: readText(b.path) };
  return byStep;
}

// Each cited rule's anchor line must be in the bundle text, followed by its body.
function assertCitedRulesPresent(text, rules) {
  for (const rule of rules) {
    const at = text.indexOf(rule);
    assert.ok(at !== -1, `cited rule missing from the bundle: ${rule}`);
    const [sameLine, nextLine = ''] = text.slice(at + rule.length).split('\n');
    assert.ok(sameLine.trim() || nextLine.trim() || text.slice(at + rule.length).split('\n')[2], `cited rule has no body: ${rule}`);
  }
}

const SDD_RULES = [
  '**Never run `git stash` in any form.**',
  '**Never kill a process by image or name.**',
  '## Discrimination checks in a scratch checkout',
];

test('AC1.1: the non-3e lens-child bundle is under 12 KB', () => {
  const { 'lens-child': lens } = composeReal('review-lens-child');
  assert.ok(lens.bytes < 12 * 1024, `lens-child is ${lens.bytes} B`);
});

test('AC1.2: lens-child carries every rule a lens prompt cites, and no depth criteria', () => {
  const { 'lens-child': lens } = composeReal('review-lens-child');
  assertCitedRulesPresent(lens.text, ['**Scratch rule.**']);
  assert.ok(lens.text.includes('SCRATCH:'), 'the Scratch rule names the SCRATCH: line');
  const depthHeading = readText(path.join(PLUGIN, 'skills/_shared/criteria-architecture-depth.md')).split('\n')[0];
  assert.ok(!lens.text.includes(depthHeading), 'the depth criteria live in lens-depth, not lens-child');
});

test('AC1.2: lens-depth carries the architecture-depth criteria for lens 3e', () => {
  const { 'lens-depth': depth } = composeReal('review-lens-child');
  assert.ok(depth, 'review-lens-child composes a lens-depth bundle');
  assert.equal(depth.load, 'on-demand');
  const file = readText(path.join(PLUGIN, 'skills/_shared/criteria-architecture-depth.md'));
  const [header] = depth.text.split('\n');
  assert.match(header, /^<!-- resolved: .* -->$/, 'bundle opens with the resolved header');
  assert.equal(depth.text, `${header}\n${file.endsWith('\n') ? file : `${file}\n`}`);
});

test('AC2.1: sdd-child is under 15 KB', () => {
  const { 'sdd-child': sdd } = composeReal('sdd-child');
  assert.ok(sdd.bytes < 15 * 1024, `sdd-child is ${sdd.bytes} B`);
});

test('AC2.1: sdd-child carries the three rules build/dispatch.md names', () => {
  const dispatch = readText(path.join(PLUGIN, 'skills/build/dispatch.md'));
  const line = dispatch.split('\n').find((l) => l.includes('context/sdd-child.md'));
  assert.ok(line, 'build/dispatch.md has an sdd-child line');
  for (const name of ['the no-stash rule', 'the no-name-kill rule', 'Discrimination checks in a scratch checkout']) {
    assert.ok(line.includes(name), `build/dispatch.md's sdd-child line names ${name}`);
  }
  const { 'sdd-child': sdd } = composeReal('sdd-child');
  assertCitedRulesPresent(sdd.text, SDD_RULES);
});

test('control: the cited-rule helper fails when a rule paragraph is removed', () => {
  const { 'sdd-child': sdd } = composeReal('sdd-child');
  const lines = sdd.text.split('\n');
  const stripped = lines.filter((l) => !l.startsWith('**Never kill a process by image or name.**')).join('\n');
  assert.notEqual(stripped, sdd.text, 'the paragraph was there to remove');
  assert.throws(() => assertCitedRulesPresent(stripped, SDD_RULES), /Never kill a process by image or name/);
});
