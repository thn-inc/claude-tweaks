// tests/bin-lib/run-dir-guard.test.js
//
// #1177: the anchored-or-outside guard branching was duplicated verbatim in
// resolve-profile.js and resolve-policy.js, differing only in which flag
// name (--run-dir vs --run) each renders in its error text. Consolidated
// into bin/lib/run-dir-guard.js; these tests pin the flag-threading and the
// two rejection-message branches directly against the shared helper,
// independent of either CLI's own test suite.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { anchoredOrOutsideMessage } = require('../../plugin/bin/lib/run-dir-guard');
const { gitRepo, linkedWorktreeOf } = require('../helpers/git-fixtures');

test('anchoredOrOutsideMessage: returns null for a --run-dir anchored under the main checkout', () => {
  const main = gitRepo();
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', 'r1');
  fs.mkdirSync(runDir, { recursive: true });
  assert.strictEqual(anchoredOrOutsideMessage(runDir, main, '--run-dir'), null);
});

test('anchoredOrOutsideMessage: returns null for a path outside any git checkout', () => {
  const main = gitRepo();
  const outside = scratchDir('rdg-outside-');
  assert.strictEqual(anchoredOrOutsideMessage(outside, main, '--run-dir'), null);
});

test('anchoredOrOutsideMessage: renders the caller-supplied flag name in the foreign-checkout message', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const shadow = path.join(wt, '.claude-tweaks', 'pipelines', 'r1');
  fs.mkdirSync(shadow, { recursive: true });
  const withRunDir = anchoredOrOutsideMessage(shadow, wt, '--run-dir');
  const withRun = anchoredOrOutsideMessage(shadow, wt, '--run');
  assert.match(withRunDir, /^--run-dir /);
  assert.match(withRun, /^--run /);
  assert.match(withRunDir, /resolves outside the main checkout/);
  assert.match(withRun, /resolves outside the main checkout/);
});

test('anchoredOrOutsideMessage: a target inside a git repo other than the caller\'s own resolves to the distinct no-repo-root wording, flag-independent', () => {
  // cwd has no git ancestor of its own (mainRoot null) while the target path
  // resolves inside a DIFFERENT, unrelated repo — checkRunDirAnchoredOrOutside's
  // scanForGitAncestor finds one, but with no mainRoot to compare against it
  // falls to the 'no-repo-root' branch rather than 'foreign-checkout'.
  const bare = scratchDir('rdg-bare-');
  const repo = gitRepo();
  const target = path.join(repo, 'run');
  fs.mkdirSync(target);
  const withRunDir = anchoredOrOutsideMessage(target, bare, '--run-dir');
  const withRun = anchoredOrOutsideMessage(target, bare, '--run');
  assert.match(withRunDir, /could not determine the git repository root/);
  assert.strictEqual(withRunDir, withRun, 'the no-repo-root message never names a flag, so it is identical regardless of the flag argument');
});

test('anchoredOrOutsideMessage: a target with no git ancestor anywhere is accepted (documented sandbox-use case), not rejected', () => {
  const bare = scratchDir('rdg-norepo-');
  const target = path.join(bare, 'r1');
  assert.strictEqual(anchoredOrOutsideMessage(target, bare, '--run-dir'), null);
});
