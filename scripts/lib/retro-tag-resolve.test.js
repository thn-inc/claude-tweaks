const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveRetroTags } = require('./retro-tag-resolve.js');

function makeDeps({ bumps, allSearchHits }) {
  return {
    iterBumpCommits: () => bumps[Symbol.iterator](),
    // Mirrors `git log --all -S'"version": "X"' ...` — returns commit shas or [].
    findAllVersionCommits: (version) => allSearchHits[version] || [],
    authorDate: (sha) => ({
      a1: '2026-01-01T10:00:00Z', a2: '2026-01-01T09:00:00Z',
      b1: '2026-02-01T10:00:00Z', b2: '2026-02-01T09:00:00Z', b3: '2026-02-01T11:00:00Z',
    }[sha]),
    parentVersion: (sha) => ({ a1: '0.9.0', a2: '0.9.0' }[sha] || null),
  };
}

test('a single bump commit resolves cleanly', () => {
  const deps = makeDeps({ bumps: [{ sha: 'x1', version: '1.0.0' }], allSearchHits: {} });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '1.0.0', date: '2026-01-01', source: 'release' }] });
  assert.deepEqual(out.resolved, [{ version: '1.0.0', sha: 'x1', date: '2026-01-01', source: 'release' }]);
  assert.deepEqual(out.tombstones, []);
  assert.deepEqual(out.collisions, []);
});

test('zero bump commits AND zero exhaustive search hits is a tombstone', () => {
  const deps = makeDeps({ bumps: [], allSearchHits: {} });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '9.9.9', date: '2026-01-01', source: 'release' }] });
  assert.equal(out.tombstones.length, 1);
  assert.equal(out.tombstones[0].version, '9.9.9');
  assert.match(out.tombstones[0].reason, /no commit.*manifest/i);
});

test('zero bump commits but a hit in the exhaustive search is NOT a tombstone — it is unresolved', () => {
  const deps = makeDeps({ bumps: [], allSearchHits: { '9.9.9': ['z1'] } });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '9.9.9', date: '2026-01-01', source: 'release' }] });
  assert.equal(out.tombstones.length, 0);
  assert.equal(out.unresolved.length, 1);
  assert.deepEqual(out.unresolved[0].candidates, ['z1']);
});

test('two candidates with the same parent version: the later-dated one is chosen, with a cited reason', () => {
  const deps = makeDeps({ bumps: [{ sha: 'a1', version: '1.1.0' }, { sha: 'a2', version: '1.1.0' }], allSearchHits: {} });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '1.1.0', date: '2026-01-01', source: 'release' }] });
  assert.equal(out.collisions.length, 1);
  assert.equal(out.collisions[0].chosen, 'a1'); // a1 = 10:00, a2 = 09:00
  assert.deepEqual(out.collisions[0].candidates.sort(), ['a1', 'a2']);
  assert.match(out.collisions[0].reason, /later of two candidates/);
});

test('three or more candidates never auto-resolve', () => {
  const deps = makeDeps({ bumps: [{ sha: 'b1', version: '2.0.0' }, { sha: 'b2', version: '2.0.0' }, { sha: 'b3', version: '2.0.0' }], allSearchHits: {} });
  const out = resolveRetroTags(deps, { tsvLines: [{ version: '2.0.0', date: '2026-02-01', source: 'release' }] });
  assert.equal(out.unresolved.length, 1);
  assert.equal(out.collisions.length, 0);
});
