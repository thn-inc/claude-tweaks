'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseFilesField, checkTrackedFreshness, gitLastChangedMap } = require('../../../plugin/bin/lib/docs-health/freshness');

function makeTmpGitRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-health-freshness-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  return root;
}

function commitFile(root, relPath, contents) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  execFileSync('git', ['add', relPath], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', `commit ${relPath}`], { cwd: root });
}

function commitFileAt(root, relPath, contents, isoDate) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  execFileSync('git', ['add', relPath], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', `commit ${relPath}`], {
    cwd: root,
    env: { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate },
  });
}

function commitTimestampMs(root, relPath) {
  const out = execFileSync('git', ['-C', root, 'log', '-1', '--format=%ct', '--', relPath], { encoding: 'utf8' }).trim();
  return parseInt(out, 10) * 1000;
}

test('parseFilesField returns declared paths', () => {
  const content = '---\nfiles:\n  - src/a.ts\n  - src/b.ts\n---\n\n# Doc\n';
  assert.deepStrictEqual(parseFilesField(content), ['src/a.ts', 'src/b.ts']);
});

test('parseFilesField returns [] when no files: key present', () => {
  const content = '---\ndepth-hint: reference\n---\n\n# Doc\n';
  assert.deepStrictEqual(parseFilesField(content), []);
});

test('parseFilesField returns [] when no frontmatter at all', () => {
  assert.deepStrictEqual(parseFilesField('# Doc\n\nNo frontmatter here.\n'), []);
});

test('flags a tracked file that changed after sinceTimestamp', () => {
  const root = makeTmpGitRoot();
  commitFile(root, 'src/tracked.ts', 'export const x = 1;\n');
  const changedAt = commitTimestampMs(root, 'src/tracked.ts');
  const content = '---\nfiles:\n  - src/tracked.ts\n---\n\n# Doc\n';
  const result = checkTrackedFreshness(content, root, changedAt - 1000);
  assert.strictEqual(result.stale.length, 1);
  assert.strictEqual(result.stale[0].path, 'src/tracked.ts');
  assert.deepStrictEqual(result.missing, []);
});

test('does not flag a tracked file that changed before sinceTimestamp', () => {
  const root = makeTmpGitRoot();
  commitFile(root, 'src/tracked.ts', 'export const x = 1;\n');
  const changedAt = commitTimestampMs(root, 'src/tracked.ts');
  const content = '---\nfiles:\n  - src/tracked.ts\n---\n\n# Doc\n';
  const result = checkTrackedFreshness(content, root, changedAt + 1000);
  assert.deepStrictEqual(result.stale, []);
});

test('flags a missing tracked path', () => {
  const root = makeTmpGitRoot();
  const content = '---\nfiles:\n  - src/does-not-exist.ts\n---\n\n# Doc\n';
  const result = checkTrackedFreshness(content, root, Date.now());
  assert.deepStrictEqual(result.missing, ['src/does-not-exist.ts']);
  assert.deepStrictEqual(result.stale, []);
});

test('does not flag anything when sinceTimestamp is null (never audited)', () => {
  const root = makeTmpGitRoot();
  commitFile(root, 'src/tracked.ts', 'export const x = 1;\n');
  const content = '---\nfiles:\n  - src/tracked.ts\n---\n\n# Doc\n';
  const result = checkTrackedFreshness(content, root, null);
  assert.deepStrictEqual(result.stale, []);
});

test('returns empty result when doc has no files: field', () => {
  const root = makeTmpGitRoot();
  const content = '# Doc\n\nNo frontmatter.\n';
  const result = checkTrackedFreshness(content, root, Date.now());
  assert.deepStrictEqual(result, { stale: [], missing: [] });
});

// ── gitLastChangedMap / batched multi-file lookup ────────────────────────────
// Regression: checkTrackedFreshness used to spawn one `git log -1` subprocess
// per tracked file — N sequential process forks for N independent,
// path-disjoint queries. gitLastChangedMap batches every tracked file's
// lookup into a single `git log --name-only` walk instead.

test('gitLastChangedMap returns [] for an empty path list without spawning git', () => {
  const root = makeTmpGitRoot();
  assert.deepStrictEqual(gitLastChangedMap(root, []), {});
});

test('gitLastChangedMap resolves distinct timestamps for multiple files from one batched call', () => {
  const root = makeTmpGitRoot();
  commitFile(root, 'src/a.ts', 'export const a = 1;\n');
  const aChangedAt = commitTimestampMs(root, 'src/a.ts');
  commitFile(root, 'src/b.ts', 'export const b = 1;\n');
  const bChangedAt = commitTimestampMs(root, 'src/b.ts');

  const map = gitLastChangedMap(root, ['src/a.ts', 'src/b.ts']);
  assert.strictEqual(map['src/a.ts'], aChangedAt);
  assert.strictEqual(map['src/b.ts'], bChangedAt);
});

test('gitLastChangedMap picks each path\'s MOST RECENT commit, not its first, when a path is touched more than once', () => {
  const root = makeTmpGitRoot();
  commitFile(root, 'src/a.ts', 'export const a = 1;\n');
  commitFile(root, 'src/a.ts', 'export const a = 2;\n');
  const latestChangedAt = commitTimestampMs(root, 'src/a.ts');

  const map = gitLastChangedMap(root, ['src/a.ts']);
  assert.strictEqual(map['src/a.ts'], latestChangedAt);
});

test('checkTrackedFreshness correctly classifies multiple tracked files with independent staleness from one batched call', () => {
  const root = makeTmpGitRoot();
  // Backdated commits (minutes apart, not relying on real-time delay between
  // two commits in the same test) so the assertion doesn't depend on git's
  // 1-second timestamp granularity happening to separate two commits made
  // back-to-back within the same wall-clock second.
  const oldDate = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  commitFileAt(root, 'src/old.ts', 'export const old = 1;\n', oldDate);
  const oldChangedAt = commitTimestampMs(root, 'src/old.ts');
  const cursor = oldChangedAt + 5 * 60 * 1000; // audited 5 minutes after old.ts's commit
  const newDate = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // safely after cursor
  commitFileAt(root, 'src/new.ts', 'export const fresh = 1;\n', newDate);

  const content = '---\nfiles:\n  - src/old.ts\n  - src/new.ts\n  - src/missing.ts\n---\n\n# Doc\n';
  const result = checkTrackedFreshness(content, root, cursor);
  assert.deepStrictEqual(result.missing, ['src/missing.ts']);
  assert.strictEqual(result.stale.length, 1);
  assert.strictEqual(result.stale[0].path, 'src/new.ts');
});

test('checkTrackedFreshness spawns exactly one git subprocess for multiple tracked files (regression: previously one spawn per file)', () => {
  const root = makeTmpGitRoot();
  commitFile(root, 'src/a.ts', 'export const a = 1;\n');
  commitFile(root, 'src/b.ts', 'export const b = 1;\n');
  commitFile(root, 'src/c.ts', 'export const c = 1;\n');

  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-git-bin-'));
  const countFile = path.join(fakeDir, 'count.txt');
  fs.writeFileSync(countFile, '');
  const fakeGitPath = path.join(fakeDir, 'git');
  fs.writeFileSync(fakeGitPath, `#!/bin/sh\necho x >> "${countFile}"\nexec "${realGit}" "$@"\n`);
  fs.chmodSync(fakeGitPath, 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation

  const content = '---\nfiles:\n  - src/a.ts\n  - src/b.ts\n  - src/c.ts\n---\n\n# Doc\n';
  const originalPath = process.env.PATH;
  let invocations;
  try {
    process.env.PATH = `${fakeDir}${path.delimiter}${originalPath}`;
    checkTrackedFreshness(content, root, Date.now());
    invocations = fs.readFileSync(countFile, 'utf8').split('\n').filter(Boolean).length;
  } finally {
    process.env.PATH = originalPath;
    fs.rmSync(fakeDir, { recursive: true, force: true });
  }

  assert.strictEqual(invocations, 1, `expected exactly one git subprocess spawn for 3 tracked files, got ${invocations}`);
});
