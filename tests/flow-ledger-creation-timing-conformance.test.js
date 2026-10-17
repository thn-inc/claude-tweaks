'use strict';
// #3036: flow's Step 1.8 created the open-items ledger before the run's
// worktree existed, so under worktree-always a run about to get a NEW
// worktree had no writable location. Creation now happens right after the
// worktree exists; the No-worktree run exception is keyed on strategy/shape.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (rel) => fs.readFileSync(path.join(SKILLS, rel), 'utf8').replace(/\s+/g, ' ');
const OLD_CONDITION = /A run with no worktree at all — `run-state\.json` carries no `worktree` field/;

test('AC1.1: flow Step 1.8 creates the ledger only when no new worktree is coming', () => {
  const text = read('flow/SKILL.md');
  assert.match(text, /Create the open items ledger — here only when no new worktree is coming/);
  assert.match(text, /Step 1\.3 resolved `current-branch`, or this session is already inside an isolated worktree/);
  assert.match(text, /`build\/worktree-setup\.md` Step 4\.6 \(single-spec\) or `multi-spec\.md`'s "Shared worktree" step 1 \(multi-spec\)/);
});

test('AC1.1: build/worktree-setup.md Step 4.6 creates the ledger after the worktree exists, flow-parented single-spec only', () => {
  const text = read('build/worktree-setup.md');
  assert.match(text, /4\.6\. \*\*Create the open-items ledger \(`\/flow` single-spec runs, #3036\)\*\*/);
  assert.match(text, /only when `\$PIPELINE_RUN_DIR` is already set/);
  assert.match(text, /`MULTISPEC_SHARED_WORKTREE` is not set/);
  assert.match(text, /AUTO \{time\} — flow: created open-items ledger \{path\}\. Reversibility: n\/a\./);
  assert.match(text, /If the file already exists/);
  assert.ok(text.indexOf('4.5. **Record the assignment**') < text.indexOf('4.6. **Create the open-items ledger'));
});

test('AC2.1: the No-worktree run exception is keyed on strategy/shape, not the momentary worktree field', () => {
  const text = read('_shared/ledger-format.md');
  assert.match(text, /A run that will \*\*never\*\* have a worktree/);
  assert.match(text, /Keyed on the resolved strategy or run shape, never on `run-state\.json`'s momentary lack of a `worktree` field/);
  assert.doesNotMatch(text, OLD_CONDITION);
});

test('AC3.1: a wrap-up-only run with no worktree still gets its run-dir ledger', () => {
  const text = read('_shared/ledger-format.md');
  assert.match(text, /a wrap-up-only invocation with no build\/test\/review step left to create one/);
  assert.match(text, /\{run-dir\}\/ledger\.md/);
});

test('Gotcha 3: an adopted run dir already holding a pre-#3036 run-dir ledger keeps using it', () => {
  const text = read('_shared/ledger-format.md');
  assert.match(text, /already holding a `\{run-dir\}\/ledger\.md` written under the pre-#3036 rule keeps that file as its ledger/);
});

test('ledger/SKILL.md Create names every creation site and the re-keyed location rule', () => {
  const text = read('ledger/SKILL.md');
  assert.match(text, /`build\/worktree-setup\.md` Step 4\.6/);
  assert.match(text, /"Shared worktree" step 1/);
  assert.match(text, /for a run that will never have a worktree \(#3036/);
  assert.doesNotMatch(text, /when this run has no worktree \(`run-state\.json` carries no `worktree` field/);
});

test('go-red proof: the pre-#3036 exception sentence fails the AC2.1 negative assertion', () => {
  const old = 'A run with no worktree at all — `run-state.json` carries no `worktree` field, or no `run-state.json` exists yet';
  assert.throws(() => assert.doesNotMatch(old, OLD_CONDITION));
});
