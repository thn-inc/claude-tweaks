'use strict';
// tests/superpowers-overrides-validate-precondition.test.js — pins #808: both
// CLAUDE.md and its shipped template (plugin/skills/init/claude-md-template.md)
// must state a Validate/visual-review precondition before ANY merge decision —
// /superpowers:finishing-a-development-branch's prompt AND the pr-first
// gh pr merge path (_shared/pr-first-merge.md) — for UI-dependent work, must
// treat a silently self-skipped check as not satisfying the precondition, must
// exempt backend/infra work with no UI surface, and must exempt a non-web
// frontend surface with no automated rendered-check channel via an explicit
// decline. The Superpowers overrides line is a live, incrementally-growing
// convention statement (not content a future migration will delete), so this
// follows the same declared-contract read-live pattern as
// tests/specify-auto-continue-conformance.test.js rather than freezing a fixture.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function overridesLine(...segments) {
  const text = fs.readFileSync(path.join(ROOT, ...segments), 'utf8');
  return text.split('\n').find((line) => line.includes('Superpowers overrides'));
}

const TARGETS = [['CLAUDE.md'], ['plugin', 'skills', 'init', 'claude-md-template.md']];

for (const segments of TARGETS) {
  const file = segments.join('/');

  test(`${file}: Superpowers overrides line requires a Validate precondition before ANY merge decision`, () => {
    const line = overridesLine(...segments);
    assert.ok(line, `${file} must still carry a Superpowers overrides line`);
    assert.match(line, /Before any merge decision — `\/superpowers:finishing-a-development-branch`'s prompt, or `_shared\/pr-first-merge\.md`'s `gh pr merge` path/, 'must bind both the local-merge and pr-first merge paths, not just finishing-a-development-branch');
    assert.match(line, /run a real browser-based visual check first/);
    assert.match(line, /raw HTML inspection does not satisfy this/, 'must rule out the known false-positive mode named in the record\'s Gotchas');
    assert.match(line, /a check that silently self-skipped \(no browser backend, no dev server\) is not a satisfied precondition/, 'a self-degraded check must not count as run or declined');
    assert.match(line, /Backend\/infra work with no UI surface is not blocked/, 'must state the AC3 exemption explicitly');
    assert.match(line, /a non-web frontend surface \(mobile\/desktop\) with no automated rendered-check channel is satisfied by an explicit decline/, 'must not trigger a precondition no available channel can satisfy');
    assert.match(line, /`\/claude-tweaks:review \{N\} full`|`\/claude-tweaks:demo`/, 'must name at least one real channel for the check');
  });

  test(`${file}: Validate-precondition clause reuses the existing surface-detection signal, not a new one`, () => {
    const line = overridesLine(...segments);
    assert.match(line, /`Surface:`\/`surface:` web\/mobile\/desktop/);
    assert.match(line, /frontend-detection\.md`'s Layer 2\/3, in the `\/claude-tweaks:design-wrapper` skill's directory, defines/, 'must cite the canonical detection machinery directly rather than pointing at another file\'s pointer');
  });

  test(`${file}: Superpowers overrides line carries the specify-auto-continue clause (#3859)`, () => {
    const line = overridesLine(...segments);
    assert.match(line, /specify-auto-continue/, `${file}'s Superpowers overrides line must state the specify-auto-continue clause, so the shipped template and CLAUDE.md stay in sync`);
  });
}
