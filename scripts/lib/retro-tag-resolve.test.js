const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveRetroTags } = require('./retro-tag-resolve.js');

function makeDeps({ bumps, allSearchHits }) {
  return {
    iterBumpCommits: () => bumps[Symbol.iterator](),
    findAllVersionCommits: (version) => allSearchHits[version] || [],
  };
}

test('a single bump commit resolves cleanly', () => {
  const deps = makeDeps({ bumps: [{ sha: 'x1', version: '1.0.0' }], allSearchHits: {} });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '1.0.0', date: '2026-01-01', source: 'release' }] });
  assert.deepEqual(out.resolved, [{ version: '1.0.0', sha: 'x1', date: '2026-01-01', source: 'release' }]);
  assert.deepEqual(out.excluded, []);
  assert.deepEqual(out.unresolved, []);
});

test('zero bump commits AND zero exhaustive search hits is excluded as a tombstone', () => {
  const deps = makeDeps({ bumps: [], allSearchHits: {} });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '9.9.9', date: '2026-01-01', source: 'release' }] });
  assert.equal(out.excluded.length, 1);
  assert.equal(out.excluded[0].version, '9.9.9');
  assert.match(out.excluded[0].reason, /no commit.*manifest/i);
});

test('zero bump commits but a hit in the exhaustive search is unresolved, not excluded', () => {
  const deps = makeDeps({ bumps: [], allSearchHits: { '9.9.9': ['z1'] } });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '9.9.9', date: '2026-01-01', source: 'release' }] });
  assert.equal(out.excluded.length, 0);
  assert.equal(out.unresolved.length, 1);
  assert.deepEqual(out.unresolved[0].candidates, ['z1']);
});

test('two or more candidates with NO override is always unresolved — never auto-picked', () => {
  const deps = makeDeps({ bumps: [{ sha: 'a1', version: '1.1.0' }, { sha: 'a2', version: '1.1.0' }], allSearchHits: {} });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '1.1.0', date: '2026-01-01', source: 'release' }] });
  assert.equal(out.unresolved.length, 1);
  assert.deepEqual(out.unresolved[0].candidates.sort(), ['a1', 'a2']);
});

test('an explicit "use" override resolves a multi-candidate version to the cited sha', () => {
  const deps = makeDeps({ bumps: [{ sha: 'a1', version: '1.1.0' }, { sha: 'a2', version: '1.1.0' }], allSearchHits: {} });
  const out = resolveRetroTags(deps, {
    tsvLines: [{ version: '1.1.0', date: '2026-01-01', source: 'release' }],
    overrides: { '1.1.0': { action: 'use', sha: 'a2', reason: 'CHANGELOG heading verbatim-matches a2 subject' } },
  });
  assert.equal(out.unresolved.length, 0);
  assert.deepEqual(out.resolved, [{ version: '1.1.0', sha: 'a2', date: '2026-01-01', source: 'release', reason: 'CHANGELOG heading verbatim-matches a2 subject' }]);
});

test('an explicit "exclude" override excludes regardless of candidate count', () => {
  const deps = makeDeps({ bumps: [{ sha: 'a1', version: '6.64.3' }, { sha: 'a2', version: '6.64.3' }], allSearchHits: {} });
  const out = resolveRetroTags(deps, {
    tsvLines: [{ version: '6.64.3', date: '2026-08-08', source: 'wip-never-shipped' }],
    overrides: { '6.64.3': { action: 'exclude', reason: 'tsv source is wip-never-shipped; CHANGELOG confirms it never reached main' } },
  });
  assert.equal(out.resolved.length, 0);
  assert.equal(out.excluded.length, 1);
  assert.equal(out.excluded[0].version, '6.64.3');
});

test('tsv source wip-never-shipped excludes even with no override supplied', () => {
  const deps = makeDeps({ bumps: [{ sha: 'a1', version: '6.64.3' }], allSearchHits: {} });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '6.64.3', date: '2026-08-08', source: 'wip-never-shipped' }] });
  assert.equal(out.excluded.length, 1);
  assert.match(out.excluded[0].reason, /wip-never-shipped/);
});

test('a non-strict-semver version string is excluded as not independently taggable', () => {
  const deps = makeDeps({ bumps: [{ sha: 'p1', version: '4.5.0-phase1' }], allSearchHits: {} });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '4.5.0-phase1', date: '2026-05-03', source: 'walk' }] });
  assert.equal(out.excluded.length, 1);
  assert.match(out.excluded[0].reason, /non-standard version string/);
});

test('three or more candidates with no override is unresolved', () => {
  const deps = makeDeps({ bumps: [{ sha: 'b1', version: '2.0.0' }, { sha: 'b2', version: '2.0.0' }, { sha: 'b3', version: '2.0.0' }], allSearchHits: {} });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '2.0.0', date: '2026-02-01', source: 'release' }] });
  assert.equal(out.unresolved.length, 1);
});
