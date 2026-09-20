'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #412: Console-on-PR — render the Wrap-Up Review Console as a PR comment
// with a checkbox answer protocol, under integration-model: pr-first.
// Prose-as-implementation, same convention as the other pr-first sub-issues'
// test files — pin the key claims against the actual file text.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const CONSOLE_ON_PR = read('plugin', 'skills', '_shared', 'console-on-pr.md');
const REVIEW_CONSOLE_INTERACTIVE = read('plugin', 'skills', 'wrap-up', 'review-console-interactive.md');
const MULTISPEC_CONSOLE = read('plugin', 'skills', 'flow', 'multispec-review-console.md');

test('the gate is integration-model: pr-first AND a pr object on run-state.json', () => {
  assert.match(CONSOLE_ON_PR, /Canonical for `integration-model: pr-first`/);
  assert.match(CONSOLE_ON_PR, /`run-state\.json` carries a `pr` object/);
});

test('item ids follow the {kind}-{n} scheme with a bundle spec-slug qualifier', () => {
  assert.match(CONSOLE_ON_PR, /`\{kind\}-\{n\}`/);
  assert.match(CONSOLE_ON_PR, /`\{spec-slug\}-\{kind\}-\{n\}`/);
  assert.match(CONSOLE_ON_PR, /One further id, always present, always last: `resolve`/);
});

test('auto-applied rows are never checkboxes', () => {
  assert.match(CONSOLE_ON_PR, /Auto-applied rows are never checkboxes/);
});

test('the row marker sits above the checkbox line, never inside the label text', () => {
  assert.match(CONSOLE_ON_PR, /never inside the checkbox label text/);
  assert.match(CONSOLE_ON_PR, /<!-- console-item: \{id\} -->/);
});

test('the legend states all three PR-level meanings and the unticked-at-resolve rule verbatim (AC4)', () => {
  assert.match(CONSOLE_ON_PR, /\*\*Ticked\*\* = approved/);
  assert.match(CONSOLE_ON_PR, /\*\*Unticked when Resolve console is ticked\*\* = declined/);
  assert.match(CONSOLE_ON_PR, /mark it ready and merge it = "merge"/);
  assert.match(CONSOLE_ON_PR, /close it =\s*\n?\s*"discard"/);
  assert.match(CONSOLE_ON_PR, /leave it as-is = "keep parked"/);
});

test('the resolve checkbox marker and row are stated exactly', () => {
  assert.match(CONSOLE_ON_PR, /<!-- console-item: resolve -->/);
  assert.match(CONSOLE_ON_PR, /\*\*Resolve console\*\*/);
});

test('a resolved console is never re-rendered', () => {
  assert.match(CONSOLE_ON_PR, /\*\*Resolved\*\*.*never re-render/s);
});

test('an item-set change un-ticks Resolve and appends a visible note', () => {
  assert.match(CONSOLE_ON_PR, /\*\*un-tick Resolve\*\* even if it was ticked/);
  assert.match(CONSOLE_ON_PR, /items changed since your Resolve tick — re-tick to confirm/);
});

test('the comment-edit permission surface states the verified vs. unverified claims distinctly', () => {
  assert.match(CONSOLE_ON_PR, /Verified against GitHub's documented behavior/);
  assert.match(CONSOLE_ON_PR, /not live-tested against a second collaborator/);
  assert.match(CONSOLE_ON_PR, /is not gated on repo write access/);
  assert.match(CONSOLE_ON_PR, /requires either being the comment's original author or\s*\n?\s*holding repo write access/);
});

test('console.json schema fields are all documented (placeholder consumer per the Gotchas note)', () => {
  const REQUIRED_FIELDS = ['commentIds', 'prNumber', 'items', 'renderedAt'];
  for (const field of REQUIRED_FIELDS) {
    assert.ok(CONSOLE_ON_PR.includes(field), `console.json schema missing documented field: ${field}`);
  }
  const ITEM_FIELDS = ['id', 'kind', 'summary', 'stagedHash'];
  for (const field of ITEM_FIELDS) {
    assert.ok(CONSOLE_ON_PR.includes(field), `console.json item schema missing documented field: ${field}`);
  }
});

test('console.json fixture parses and matches the documented shape', () => {
  const fixture = {
    commentIds: ['IC_kwDOexample1'],
    prNumber: 42,
    items: [
      { id: 'staged-5', kind: 'staged', summary: '2 severity:medium findings', stagedHash: 'a1b2c3' },
    ],
    renderedAt: '2026-08-14T15:00:00Z',
  };
  assert.ok(Array.isArray(fixture.commentIds));
  assert.strictEqual(typeof fixture.prNumber, 'number');
  assert.ok(Array.isArray(fixture.items));
  for (const item of fixture.items) {
    assert.strictEqual(typeof item.id, 'string');
    assert.strictEqual(typeof item.kind, 'string');
    assert.strictEqual(typeof item.summary, 'string');
    assert.strictEqual(typeof item.stagedHash, 'string');
  }
  assert.strictEqual(typeof fixture.renderedAt, 'string');
});

test('overflow splits at a section boundary, never mid-row', () => {
  assert.match(CONSOLE_ON_PR, /split at a section boundary —\s*\n?\s*never mid-row/);
  assert.match(CONSOLE_ON_PR, /65,536 characters/);
});

test('a stale or deleted comment id recreates the comment rather than being read as resolved', () => {
  assert.match(CONSOLE_ON_PR, /recreate the comment\s*\n?\s*fresh and update `console\.json`/);
});

test('headless conclusion reports pending-review with no blocking wait and no AskUserQuestion', () => {
  assert.match(CONSOLE_ON_PR, /report outcome `pending-review` with the PR URL/);
  assert.match(CONSOLE_ON_PR, /No blocking wait, no `AskUserQuestion`/);
});

test('review-console.md routes pr-first through Console-on-PR before "Present the console", local-merge unchanged', () => {
  assert.match(REVIEW_CONSOLE_INTERACTIVE, /## Console-on-PR \(`integration-model: pr-first` only\)/);
  const idx = REVIEW_CONSOLE_INTERACTIVE.indexOf('## Console-on-PR');
  const presentIdx = REVIEW_CONSOLE_INTERACTIVE.indexOf('## Present the console');
  assert.ok(idx > 0 && presentIdx > 0 && idx < presentIdx, 'Console-on-PR must be checked before Present the console');
  assert.match(REVIEW_CONSOLE_INTERACTIVE, /local-merge.*→ skip to "Present the console" below, unchanged/s);
});

test('review-console.md never renders both consoles on the pr-first path', () => {
  const section = REVIEW_CONSOLE_INTERACTIVE.slice(
    REVIEW_CONSOLE_INTERACTIVE.indexOf('## Console-on-PR'),
    REVIEW_CONSOLE_INTERACTIVE.indexOf('## Present the console'),
  );
  assert.match(section, /Never also render "Present the console"/);
});

test('multispec-review-console.md wires the same Console-on-PR split for bundles', () => {
  assert.match(MULTISPEC_CONSOLE, /## Console-on-PR \(`integration-model: pr-first` only\)/);
  const idx = MULTISPEC_CONSOLE.indexOf('## Console-on-PR');
  const presentIdx = MULTISPEC_CONSOLE.indexOf('## Present the consolidated console');
  assert.ok(idx > 0 && presentIdx > 0 && idx < presentIdx, 'Console-on-PR must be checked before Present the consolidated console');
  assert.match(MULTISPEC_CONSOLE, /one bundle PR — `_shared\/pr-early-run-lifecycle\.md`/);
});

test('multispec-review-console.md delegates its item-id scheme to console-on-pr.md, rather than restating it', () => {
  // The per-spec-qualified id scheme itself ({spec-slug}-{kind}-{n}) is
  // pinned once, on console-on-pr.md, by this same file's "item ids follow
  // the {kind}-{n} scheme with a bundle spec-slug qualifier" test above —
  // this test only confirms the bundle console still delegates to it.
  const section = MULTISPEC_CONSOLE.slice(
    MULTISPEC_CONSOLE.indexOf('## Console-on-PR'),
    MULTISPEC_CONSOLE.indexOf('## Present the consolidated console'),
  );
  assert.match(section, /_shared\/console-on-pr\.md/);
});

test('both review-console.md and multispec-review-console.md cite the shared integration-model fragment from their new sections', () => {
  const rcSection = REVIEW_CONSOLE_INTERACTIVE.slice(
    REVIEW_CONSOLE_INTERACTIVE.indexOf('## Console-on-PR'),
    REVIEW_CONSOLE_INTERACTIVE.indexOf('## Present the console'),
  );
  const mcSection = MULTISPEC_CONSOLE.slice(
    MULTISPEC_CONSOLE.indexOf('## Console-on-PR'),
    MULTISPEC_CONSOLE.indexOf('## Present the consolidated console'),
  );
  assert.match(rcSection, /_shared\/integration-model\.md/);
  assert.match(mcSection, /_shared\/integration-model\.md/);
});

// Per-file 40 KB pins on review-console.md and multispec-review-console.md
// retired by #1997 — the per-file tier is a warning since #1990 and these
// files have no compose call site; removal condition in
// docs/incident-log.md [IL-153].
