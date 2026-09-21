// tests/bundle-fixes-reconciliation-2015.test.js
//
// Pins the two prose sites #2015 changed so a bundle PR's `Fixes` lines are
// reconciled against manifest.yml outcomes before merge, never left as the
// draft-time "every spec assumed to complete" list:
//
// - plugin/skills/_shared/pr-early-run-lifecycle.md — the Step 3 template's
//   fixes-start/fixes-end delimiter markers.
// - plugin/skills/_shared/pr-checklist-refresh.md — the "Pre-merge
//   title/description refresh" section's new Fixes-block rewrite step (#2002
//   split this section out of pr-early-run-lifecycle.md into its own file).
// - plugin/skills/flow/multispec-review-console.md — Shared teardown step 2,
//   which must derive `{issue-list}` from the manifest's `complete` specs
//   only, never the full `specs[].id` list.
// - plugin/skills/_shared/pr-first-merge.md — Step 3's `{issue-list}`
//   definition, same complete-specs-only rule (restated there because the
//   merge commit message is what GitHub actually scans for closing
//   keywords).
//
// Matching is done against whitespace-normalized text (CRLF line endings on
// this checkout, plus ordinary Markdown line-wrapping, both collapse runs of
// whitespace to a single space) so an assertion never depends on exactly
// where a prose line happens to wrap.
//
// This suite reads live production prose ([IL-80] applies) — acceptable
// here because the exact wording asserted IS the contract this record
// exists to fix; a future rewording that keeps the semantics intact should
// update this test alongside it, not work around it.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const PR_EARLY_PATH = path.join(REPO_ROOT, 'plugin', 'skills', '_shared', 'pr-early-run-lifecycle.md');
const PR_CHECKLIST_REFRESH_PATH = path.join(REPO_ROOT, 'plugin', 'skills', '_shared', 'pr-checklist-refresh.md');
const REVIEW_CONSOLE_PATH = path.join(REPO_ROOT, 'plugin', 'skills', 'flow', 'multispec-review-console.md');
const PR_FIRST_MERGE_PATH = path.join(REPO_ROOT, 'plugin', 'skills', '_shared', 'pr-first-merge.md');

function read(p) { return fs.readFileSync(p, 'utf8'); }
function norm(s) { return s.replace(/\s+/g, ' '); }

test('#2015: pr-early-run-lifecycle.md Step 3 template wraps Fixes in fixes-start/fixes-end markers (dual-marker scheme)', () => {
  const text = norm(read(PR_EARLY_PATH));
  assert.match(text, /<!-- fixes-start --> \[claude-tweaks-fixes-start\] Fixes #\{n\} \[claude-tweaks-fixes-end\] <!-- fixes-end -->/,
    'Step 3 template must wrap the initial Fixes #{n} line in both marker forms');
  assert.match(text, /\| Fixes start \| `<!-- fixes-start -->` \| `\[claude-tweaks-fixes-start\]` \|/,
    'the Dual-marker scheme table must list the fixes-block start marker pair');
  assert.match(text, /\| Fixes end \| `<!-- fixes-end -->` \| `\[claude-tweaks-fixes-end\]` \|/,
    'the Dual-marker scheme table must list the fixes-block end marker pair');
});

test('#2015: pr-checklist-refresh.md Pre-merge refresh rewrites the Fixes block from manifest.yml outcomes', () => {
  const text = norm(read(PR_CHECKLIST_REFRESH_PATH));
  const section = text.split('## Pre-merge title/description refresh')[1];
  assert.ok(section, 'the Pre-merge title/description refresh section must exist');
  assert.match(section, /Rewrite the .Fixes. block from .manifest\.yml. outcomes/,
    'the section must document an unconditional Fixes-block rewrite step');
  assert.match(section, /composeFixesBlock/,
    'the rewrite step must name the composeFixesBlock helper it calls');
  assert.match(section, /Refs #\{m\} — not run\/failed: \{reason\}/,
    'the rewrite step must describe emitting a Refs line for a non-complete spec');
});

test('#2015: multispec-review-console.md Shared teardown step 2 derives {issue-list} from complete specs only', () => {
  const text = norm(read(REVIEW_CONSOLE_PATH));
  const step2 = text.split('**Finish the shared branch.**')[1];
  assert.ok(step2, 'Shared teardown step 2 (Finish the shared branch) must exist');
  const window = step2.slice(0, 600);
  assert.match(window, /`issue-list` the manifest's `complete` specs only/,
    'step 2 must define {issue-list} as the manifest\'s complete specs only');
  assert.doesNotMatch(window, /issue-list.{0,40}every record from `manifest\.yml`'s `specs\[\]\.id`/,
    'step 2 must no longer derive {issue-list} from the full specs[].id list');
});

test('#2015: pr-first-merge.md Step 3 defines {issue-list} as complete specs only for a bundle', () => {
  const text = norm(read(PR_FIRST_MERGE_PATH));
  const step3 = text.split('## Step 3: Attempt auto-merge')[1];
  assert.ok(step3, 'Step 3 must exist');
  const window = step3.slice(0, 1500);
  assert.match(window, /the manifest's `complete` specs only/,
    'Step 3 must define {issue-list} as the manifest\'s complete specs only for a bundle');
  assert.match(window, /`never-started:`\/`abandoned:` reason/,
    'Step 3 must note the not-run/failed set is released separately with its own reason');
});
