'use strict';
// The grammar pin behind design stance 4: the local engine must reproduce a
// real release-please section byte-for-byte (minus PR links, which do not
// exist under local-merge). A failure here means release-please's grammar
// moved — re-capture the fixture; never loosen this assertion.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { renderSection } = require('../../../plugin/bin/lib/release-local/changelog.js');

const FIXTURES = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const stripPrLinks = (text) => text.replace(/ \(\[#\d+\]\(https:\/\/github\.com\/[^)]*\/issues\/\d+\)\)/g, '');
const repo = { owner: 'googleapis', repo: 'release-please', url: 'https://github.com/googleapis/release-please' };
const commit = (type, scope, description, sha, extra = {}) => ({ sha, type, scope, description, subject: `${type}${scope ? `(${scope})` : ''}: ${description}`, breaking: false, breakingNote: null, unconventional: false, ...extra });

test('17.11.0: two features and a scoped fix reproduce the captured section byte-for-byte', () => {
  const out = renderSection({
    version: '17.11.0', previousTag: 'v17.10.4', date: '2026-07-28', repo,
    commits: [
      commit('fix', 'deps', 'update brace-expansion to address Dependabot alerts [#99](https://github.com/googleapis/release-please/issues/99) and [#100](https://github.com/googleapis/release-please/issues/100)', 'e9e921a89fc7ae36dbd10184ffc1dfbfb33c29b2'),
      commit('feat', null, 'add ruby-librarian strategy', 'cb1b17992ca4b9f97b838c6e3466cc8f654bcc04'),
      commit('feat', null, 'add PHPLibrarian strategy', '9aa4fc069f502094b3e79c323677af860c9d64d8'),
    ].reverse(),
  });
  assert.strictEqual(out, stripPrLinks(read('release-please-17.11.0.md')));
});

test('17.0.0: a breaking scoped feat renders the notes block and the Features bullet', () => {
  const out = renderSection({
    version: '17.0.0', previousTag: 'v16.18.0', date: '2025-03-11', repo,
    commits: [commit('feat', 'deps', 'update octokit to v20', '9f3b6699474b0ff1987ef3ad4ca5a96ce69d9a6a', { breaking: true, breakingNote: 'update octokit to v20' })],
  });
  assert.strictEqual(out, stripPrLinks(read('release-please-17.0.0.md')));
});

// Ruling 2 pinned by real bytes: the breaking-notes block lists notes in COMMIT
// order, and the hidden `refactor` type renders its own `### Code Refactoring`
// group only because that commit is breaking.
test('15.0.0: a breaking feat and a breaking hidden-type refactor render notes in commit order and both groups', () => {
  const out = renderSection({
    version: '15.0.0', previousTag: 'v14.17.5', date: '2022-12-12', repo,
    commits: [
      commit('feat', null, 'Strategies can parse multiple releases from single release PR', 'b565f85b64a431be1d62f8e682c183c4c1f1c631',
        { breaking: true, breakingNote: 'Strategies can parse multiple releases from single release PR' }),
      commit('refactor', null, 'Parse conventional commits in manifest', '3391d3bc916ad07102bbb3873b93aeac6e13977c',
        { breaking: true, breakingNote: 'Parse conventional commits in manifest' }),
    ],
  });
  assert.strictEqual(out, stripPrLinks(read('release-please-15.0.0.md')));
});

test('the fixtures are the captured bytes (re-capture, never edit)', () => {
  const crypto = require('crypto');
  const sha256 = (name) => crypto.createHash('sha256').update(fs.readFileSync(path.join(FIXTURES, name))).digest('hex');
  assert.strictEqual(sha256('release-please-17.11.0.md'), '4e4609632595afb3692dbd057e51d936de0c9b408d2271b4253d559d8e975e03');
  assert.strictEqual(sha256('release-please-17.0.0.md'), 'e1dccde9de592640a41cce2ab39162844f740ba601e53f9fcd377806e814a49a');
  assert.strictEqual(sha256('release-please-15.0.0.md'), 'f52bd3d60fec209a0189e50b2bffa18b30c79377c0b7aeca909703aa781cec0c');
});
