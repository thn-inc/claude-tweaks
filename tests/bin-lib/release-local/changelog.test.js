'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderSection, prependSection, parseGitHubRemote } = require('../../../plugin/bin/lib/release-local/changelog.js');

const sha = (ch) => ch.repeat(40);
const commit = (type, description, extra = {}) => ({ sha: sha(description[0]), type, scope: null, breaking: false, breakingNote: null, description, unconventional: false, ...extra });

test('parseGitHubRemote: https, ssh, scp-like, .git-suffixed; non-GitHub is null', () => {
  for (const u of ['https://github.com/o/r', 'https://github.com/o/r.git', 'git@github.com:o/r.git', 'ssh://git@github.com/o/r.git']) {
    assert.deepStrictEqual(parseGitHubRemote(u), { owner: 'o', repo: 'r', url: 'https://github.com/o/r' });
  }
  assert.strictEqual(parseGitHubRemote('https://gitlab.com/o/r.git'), null);
  assert.strictEqual(parseGitHubRemote(null), null);
});

test('renderSection without a GitHub origin: unlinked heading, no commit links, hidden types omitted', () => {
  const out = renderSection({ version: '1.3.0', previousTag: 'v1.2.0', date: '2026-09-12', repo: null,
    commits: [commit('fix', 'b'), commit('feat', 'a'), commit('chore', 'c'), commit('fix', 'd')] });
  assert.strictEqual(out, '## 1.3.0 (2026-09-12)\n\n\n### Features\n\n* a\n\n\n### Bug Fixes\n\n* b\n* d\n');
});

test('renderSection with a GitHub origin and no previous tag: unlinked heading, linked commits', () => {
  const repo = { owner: 'o', repo: 'r', url: 'https://github.com/o/r' };
  const out = renderSection({ version: '1.0.0', previousTag: null, date: '2026-09-12', repo, commits: [commit('feat', 'a')] });
  assert.strictEqual(out, `## 1.0.0 (2026-09-12)\n\n\n### Features\n\n* a ([aaaaaaa](https://github.com/o/r/commit/${sha('a')}))\n`);
});

test('renderSection: breaking notes block, and a hidden type renders when breaking', () => {
  const out = renderSection({ version: '2.0.0', previousTag: 'v1.3.0', date: '2026-09-12', repo: null,
    commits: [commit('chore', 'z', { scope: 'deps', breaking: true, breakingNote: 'drop node 16' }), commit('fix', 'b')] });
  assert.strictEqual(out, '## 2.0.0 (2026-09-12)\n\n\n### ⚠ BREAKING CHANGES\n\n* **deps:** drop node 16\n\n### Bug Fixes\n\n* b\n\n\n### Miscellaneous Chores\n\n* **deps:** z\n');
});

test('prependSection: before the first version heading, blank-line separated; a fresh file gets the Changelog title', () => {
  const existing = '# Changelog\n\nintro\n\n## [1.2.0](u) (2026-01-01)\n\n\n### Features\n\n* old\n';
  const section = '## 1.3.0 (2026-09-12)\n\n\n### Bug Fixes\n\n* b\n';
  assert.strictEqual(prependSection(existing, section), '# Changelog\n\nintro\n\n' + section + '\n## [1.2.0](u) (2026-01-01)\n\n\n### Features\n\n* old\n');
  assert.strictEqual(prependSection(null, section), '# Changelog\n\n' + section);
  assert.strictEqual(prependSection('# Changelog\n\n## v6.70.0 — old grammar\n\nBody.\n', section), '# Changelog\n\n' + section + '\n## v6.70.0 — old grammar\n\nBody.\n');
});
