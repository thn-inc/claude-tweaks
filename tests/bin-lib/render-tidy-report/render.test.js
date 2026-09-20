'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  collectStagedItems,
  renderApproveSection,
  renderItem,
  truncateTitle,
  formatRecord,
} = require('../../../plugin/bin/lib/render-tidy-report/render');

function tmpRunDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rtr-'));
}

function writeSidecar(runDir, name, items) {
  const stagedDir = path.join(runDir, 'staged');
  fs.mkdirSync(stagedDir, { recursive: true });
  fs.writeFileSync(path.join(stagedDir, name), JSON.stringify(items));
}

test('collectStagedItems: no staged/ directory returns empty (not an error)', () => {
  const runDir = tmpRunDir();
  assert.deepEqual(collectStagedItems(runDir), []);
});

test('collectStagedItems: staged/ with no .json files returns empty', () => {
  const runDir = tmpRunDir();
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'staged', 'notes.md'), '# not a sidecar\n');
  assert.deepEqual(collectStagedItems(runDir), []);
});

test('collectStagedItems: flattens multiple sidecars in filename-sorted, file-then-item order', () => {
  const runDir = tmpRunDir();
  writeSidecar(runDir, 'b-second.json', [{ tag: 'git', record: null, title: 'second file item', action: 'a2', command: 'c2' }]);
  writeSidecar(runDir, 'a-first.json', [
    { tag: 'claim', record: 1135, title: 'first item', action: 'a1', command: 'c1' },
    { tag: 'claim', record: 1350, title: 'second item same file', action: 'a1b', command: 'c1b' },
  ]);
  const items = collectStagedItems(runDir);
  assert.equal(items.length, 3);
  assert.equal(items[0].record, 1135);
  assert.equal(items[1].record, 1350);
  assert.equal(items[2].tag, 'git');
});

test('collectStagedItems: a staged item added after an initial read is present on the next read', () => {
  const runDir = tmpRunDir();
  writeSidecar(runDir, 'a.json', [{ tag: 'claim', record: 1, title: 'one', action: 'a', command: 'c' }]);
  assert.equal(collectStagedItems(runDir).length, 1);
  writeSidecar(runDir, 'b.json', [{ tag: 'git', record: 2, title: 'two', action: 'a', command: 'c' }]);
  const after = collectStagedItems(runDir);
  assert.equal(after.length, 2);
  assert.deepEqual(after.map((i) => i.record), [1, 2]);
});

test('collectStagedItems: a sidecar with invalid JSON throws rather than silently dropping items', () => {
  const runDir = tmpRunDir();
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'staged', 'bad.json'), '{ not valid json');
  assert.throws(() => collectStagedItems(runDir), /not valid JSON/);
});

test('collectStagedItems: a sidecar whose top level is not an array throws', () => {
  const runDir = tmpRunDir();
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'staged', 'bad.json'), JSON.stringify({ tag: 'x' }));
  assert.throws(() => collectStagedItems(runDir), /must contain a JSON array/);
});

test('truncateTitle: passes through short titles; truncates long ones to 50 chars including the ellipsis', () => {
  assert.equal(truncateTitle('short'), 'short');
  const long = 'x'.repeat(60);
  const truncated = truncateTitle(long);
  assert.equal(truncated.length, 50);
  assert.ok(truncated.endsWith('…'));
});

test('formatRecord: numeric/string records get a leading #; null/undefined/empty render #—', () => {
  assert.equal(formatRecord(1135), '#1135');
  assert.equal(formatRecord('1135'), '#1135');
  assert.equal(formatRecord('#1135'), '#1135');
  assert.equal(formatRecord(null), '#—');
  assert.equal(formatRecord(undefined), '#—');
  assert.equal(formatRecord(''), '#—');
});

test('renderItem: three-line shape — number + tag + record + title, then action, then command', () => {
  const rendered = renderItem(1, {
    tag: 'claim',
    record: 1135,
    title: 'stale issue claim',
    action: 'Release — reconcile flagged it',
    command: 'node bin/release-claim.js 1135 --sweep',
  });
  assert.equal(
    rendered,
    '1  [claim]  #1135  stale issue claim\n   Release — reconcile flagged it\n   node bin/release-claim.js 1135 --sweep',
  );
});

test('renderApproveSection: empty items list renders empty string (block must be omitted, never a zero-count header)', () => {
  assert.equal(renderApproveSection([]), '');
  assert.equal(renderApproveSection(null), '');
});

test('renderApproveSection: produces the exact expected Approve-section text from a fixture staged/ directory', () => {
  const runDir = tmpRunDir();
  writeSidecar(runDir, 'tidy-claim-releases-1.json', [
    { tag: 'claim', record: 1135, title: 'stale issue claim', action: 'Release — reconcile flagged it but skipped for lack of a matching run-state.json', command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/release-claim.js" 1135 --run "$RUN_DIR" --sweep --reason "swept: stale claim"' },
    { tag: 'claim', record: 1350, title: 'stale issue claim', action: 'Release — reconcile flagged it but skipped for lack of a matching run-state.json', command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/release-claim.js" 1350 --run "$RUN_DIR" --sweep --reason "swept: stale claim"' },
  ]);
  writeSidecar(runDir, 'tidy-git-branch-prune-1.json', [
    { tag: 'git', record: null, title: 'Merged remote branch not yet pruned', action: 'Delete the merged, un-pruned remote branch', command: 'git push origin --delete worktree-record-1936-2008-2265-subagentstop' },
  ]);

  const section = renderApproveSection(collectStagedItems(runDir));
  const expected = [
    '**Approve (3)**',
    '```text',
    '1  [claim]  #1135  stale issue claim',
    '   Release — reconcile flagged it but skipped for lack of a matching run-state.json',
    '   node "${CLAUDE_PLUGIN_ROOT}/bin/release-claim.js" 1135 --run "$RUN_DIR" --sweep --reason "swept: stale claim"',
    '2  [claim]  #1350  stale issue claim',
    '   Release — reconcile flagged it but skipped for lack of a matching run-state.json',
    '   node "${CLAUDE_PLUGIN_ROOT}/bin/release-claim.js" 1350 --run "$RUN_DIR" --sweep --reason "swept: stale claim"',
    '3  [git]  #—  Merged remote branch not yet pruned',
    '   Delete the merged, un-pruned remote branch',
    '   git push origin --delete worktree-record-1936-2008-2265-subagentstop',
    '```',
  ].join('\n');
  assert.equal(section, expected);
});
