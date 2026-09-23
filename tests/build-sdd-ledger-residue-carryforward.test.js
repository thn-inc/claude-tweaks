'use strict';
// tests/build-sdd-ledger-residue-carryforward.test.js — pins #1135: /build's subagent-strategy
// dispatch procedure (dispatch.md, read by SKILL.md Common Step 2's "subagent" branch) directs
// /superpowers:subagent-driven-development to copy surviving SDD deferred-minor / parked ledger
// lines (`<workspace>/progress.md`) into the run's own open items ledger before its Finish step
// deletes the plan's SDD workspace — otherwise those lines are structurally lost, since
// /claude-tweaks:wrap-up reads only docs/plans/*-ledger.md, never the deleted SDD workspace.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const DISPATCH = read('plugin', 'skills', 'build', 'dispatch.md');
const BUILD_SKILL = read('plugin', 'skills', 'build', 'SKILL.md');

test('dispatch.md: Common Step 2 subagent-strategy invocation directs the ledger-residue carry-forward before Finish deletes the workspace', () => {
  assert.match(
    DISPATCH,
    /Carry forward surviving SDD ledger residue before Finish/,
    'the SDD invocation instruction is missing the ledger-residue carry-forward directive'
  );
});

test('dispatch.md: the directive names the source lines (progress.md minor (deferred)/parked markers)', () => {
  assert.match(DISPATCH, /<workspace>\/progress\.md` line matching `minor \(deferred\):` or `parked —`/);
});

test('dispatch.md: the directive names the destination — the run ledger\'s Add Item operation, phase build, deferred/observation status', () => {
  assert.match(
    DISPATCH,
    /this build's own open items ledger \(`\/claude-tweaks:ledger`'s Add Item operation\) — phase `build`, status `deferred` for a `minor \(deferred\):` line or `observation` for a `parked —` line/
  );
});

test('dispatch.md: the directive fires before workspace deletion, not after', () => {
  assert.match(DISPATCH, /before deleting the plan's workspace \(`rm -rf <workspace>`\), it must copy/);
});

test('SKILL.md Common Step 2 still points the subagent strategy at dispatch.md (the file that composes this directive)', () => {
  assert.match(
    BUILD_SKILL,
    /\*\*subagent\*\* \(default\): read `dispatch\.md` in this skill's directory and follow its full dispatch procedure/
  );
});
