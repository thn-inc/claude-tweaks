'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  materializedRecordsSince, unnamedRecordsGate, EMPTY_TREE,
} = require('../../../plugin/bin/lib/release/unnamed-records.js');

const manifest = (v) => JSON.stringify({ name: 'claude-tweaks', version: v });

// Lazily-evaluated canned git — a function per invocation, never an IIFE [IL-30].
function fakeGit(table) {
  const calls = [];
  const git = (args) => {
    const key = args.join(' ');
    calls.push(key);
    for (const [match, respond] of table) {
      const hit = typeof match === 'string' ? key.startsWith(match) : match.test(key);
      if (hit) return respond(key);
    }
    throw new Error(`unexpected git call: ${key}`);
  };
  git.calls = calls;
  return git;
}

const notFound = (ref, p) => { throw new Error(`fatal: path '${p}' does not exist in '${ref}'`); };

// One root-commit bump "bump1" (v6.70.0) reachable from `main` by default — the
// simplest possible bump history a caller can override via `bumps`.
function baseDeps({ diffOutput = '', changelog = '# Changelog\n', bumps = [{ sha: 'bump1', version: '6.70.0' }] } = {}) {
  const table = [
    ['cat-file -e main:plugin/.claude-plugin/plugin.json', () => ''],
    ['log --format=%H --topo-order main --', () => bumps.map((b) => b.sha).join('\n')],
  ];
  for (const b of bumps) {
    table.push([`show ${b.sha}:plugin/.claude-plugin/plugin.json`, () => manifest(b.version)]);
    table.push([`show ${b.sha}^:plugin/.claude-plugin/plugin.json`, () => notFound(`${b.sha}^`, 'plugin/.claude-plugin/plugin.json')]);
    table.push([`show ${b.sha}^:.claude-plugin/plugin.json`, () => notFound(`${b.sha}^`, '.claude-plugin/plugin.json')]);
  }
  table.push([/^diff --name-status /, () => diffOutput]);
  return { git: fakeGit(table), readFile: () => changelog };
}

const ADDED_700 = 'A\t.claude-tweaks/pipelines/2026-08-01T000000-record-700/work/700-spec.md\n';

test('materializedRecordsSince: only ADDED spec files count — an edit or rename is not a new arrival', () => {
  const deps = baseDeps();
  assert.deepStrictEqual(materializedRecordsSince(deps, 'bump1'), []); // no diff configured yet by default (empty)

  const added = baseDeps({ diffOutput: ADDED_700 }).git;
  assert.deepStrictEqual(materializedRecordsSince({ git: added }, 'bump1'), [700]);

  const modified = baseDeps({ diffOutput: 'M\t.claude-tweaks/pipelines/x/work/700-spec.md\n' }).git;
  assert.deepStrictEqual(materializedRecordsSince({ git: modified }, 'bump1'), [], 'a modified (not added) spec file must not count');

  const renamed = baseDeps({ diffOutput: 'R100\t.claude-tweaks/pipelines/x/work/700-spec.md\t.claude-tweaks/pipelines/y/work/700-spec.md\n' }).git;
  assert.deepStrictEqual(materializedRecordsSince({ git: renamed }, 'bump1'), [], 'a rename must not count as a new arrival');
});

test('materializedRecordsSince: the multi-record spec-{n}/work/{n}-spec.md shape also matches', () => {
  const deps = baseDeps({ diffOutput: 'A\t.claude-tweaks/pipelines/2026-08-01T000000-spec-701-702/spec-701/work/701-spec.md\n' }).git;
  assert.deepStrictEqual(materializedRecordsSince({ git: deps }, 'bump1'), [701]);
});

test('materializedRecordsSince: no prior bump diffs against the empty tree, not "HEAD" alone', () => {
  const deps = baseDeps({ diffOutput: '' }).git;
  materializedRecordsSince({ git: deps }, null);
  assert.ok(deps.calls.some((c) => c.startsWith(`diff --name-status ${EMPTY_TREE}..HEAD`)), deps.calls.join(' | '));
});

test('unnamedRecordsGate: a materialized record named nowhere is reported unnamed [AC1]', () => {
  const deps = baseDeps({ diffOutput: ADDED_700 });
  const gate = unnamedRecordsGate(deps, { summary: '' });
  assert.deepStrictEqual(gate.records, [700]);
  assert.deepStrictEqual(gate.unnamed, [700]);
  assert.deepStrictEqual(gate.allowed, []);
  assert.strictEqual(gate.lastBump.version, '6.70.0');
});

test('unnamedRecordsGate: naming the record in the summary clears it [AC2]', () => {
  const deps = baseDeps({ diffOutput: ADDED_700 });
  const gate = unnamedRecordsGate(deps, { summary: 'Fix release gate off-by-one (#700)' });
  assert.deepStrictEqual(gate.unnamed, []);
});

test('unnamedRecordsGate: a range in the newest CHANGELOG entry also clears it [AC2, range-aware]', () => {
  const deps = baseDeps({
    diffOutput: ADDED_700,
    changelog: '# Changelog\n\n## v6.71.0 — Batch\n\nCovers #699-#701 in one release.\n',
  });
  const gate = unnamedRecordsGate(deps, { summary: '' });
  assert.deepStrictEqual(gate.unnamed, [], 'a #699-#701 range in the newest entry must cover #700');
});

test('unnamedRecordsGate: an exact single-record CHANGELOG mention (no range) also clears it', () => {
  const deps = baseDeps({
    diffOutput: ADDED_700,
    changelog: '# Changelog\n\n## v6.71.0 — Batch\n\nAlready documents #700 directly.\n',
  });
  const gate = unnamedRecordsGate(deps, { summary: '' });
  assert.deepStrictEqual(gate.unnamed, []);
});

// #1181: a record can re-enter materializedRecordsSince's added set many
// releases after it actually shipped (e.g. a reconcile archive-move commit
// re-adding its spec file at a new path) — the CHANGELOG lookback must scan
// every past entry, not only the newest one.
test('unnamedRecordsGate: a record named only in an OLDER (non-newest) CHANGELOG entry still clears it [AC1, historical lookback]', () => {
  const deps = baseDeps({
    diffOutput: ADDED_700,
    changelog: '# Changelog\n\n## v6.75.0 — Recent\n\nUnrelated work, #710.\n\n## v6.71.0 — Older\n\nShipped #700 five releases ago.\n',
  });
  const gate = unnamedRecordsGate(deps, { summary: '' });
  assert.deepStrictEqual(gate.unnamed, [], 'a mention several entries back must still clear #700, not only the newest entry');
});

test('unnamedRecordsGate: a record named nowhere in ANY past CHANGELOG entry stays unnamed [AC2, negative control]', () => {
  const deps = baseDeps({
    diffOutput: ADDED_700,
    changelog: '# Changelog\n\n## v6.75.0 — Recent\n\nUnrelated work, #710.\n\n## v6.71.0 — Older\n\nUnrelated work, #650.\n',
  });
  const gate = unnamedRecordsGate(deps, { summary: '' });
  assert.deepStrictEqual(gate.unnamed, [700], 'no entry mentions #700 — it must still be flagged');
});

test('unnamedRecordsGate: --allow-unnamed excludes the record from `unnamed` and reports it in `allowed`', () => {
  const deps = baseDeps({ diffOutput: ADDED_700 });
  const gate = unnamedRecordsGate(deps, { summary: '', allow: [700] });
  assert.deepStrictEqual(gate.unnamed, []);
  assert.deepStrictEqual(gate.allowed, [700]);
});

test('unnamedRecordsGate: a digit-boundary near-miss (#7000) does not falsely clear #700', () => {
  const deps = baseDeps({ diffOutput: ADDED_700 });
  const gate = unnamedRecordsGate(deps, { summary: 'unrelated to #7000' });
  assert.deepStrictEqual(gate.unnamed, [700]);
});

test('unnamedRecordsGate: nothing materialized since the last bump passes trivially, no CHANGELOG read needed', () => {
  const deps = baseDeps({ diffOutput: '' });
  const gate = unnamedRecordsGate(deps, { summary: '' });
  assert.deepStrictEqual(gate.records, []);
  assert.deepStrictEqual(gate.unnamed, []);
});

test('unnamedRecordsGate: never calls gh and never reads commit subjects [AC4]', () => {
  const deps = baseDeps({ diffOutput: ADDED_700 });
  unnamedRecordsGate(deps, { summary: '#700' });
  assert.ok(!deps.git.calls.some((c) => c.includes('log --format=%s') || c.includes('gh ')), deps.git.calls.join(' | '));
});

// #2363: unnamedRecordsGate only ever needs the NEWEST bump (`sinceSha` for the
// materialized-records diff) — draining iterBumpCommits' generator fully used to
// walk every commit that ever touched the manifest, all the way to the repo root,
// paying an expected-to-fail probe per pre-move commit along the way (~490 lines
// of git stderr noise on a real repo). Two bumps here, older ("root1") reachable
// only past the newer one ("bump2") — asserting root1's manifest is never read
// proves the walk stops at the first (newest) bump instead of draining to the end.
test('unnamedRecordsGate: stops the bump walk at the newest bump — never reads an older bump\'s manifest [#2363]', () => {
  const deps = baseDeps({ diffOutput: ADDED_700, bumps: [{ sha: 'bump2', version: '6.71.0' }, { sha: 'root1', version: '6.70.0' }] });
  const gate = unnamedRecordsGate(deps, { summary: '' });
  assert.strictEqual(gate.lastBump.sha, 'bump2');
  assert.ok(
    !deps.git.calls.some((c) => c.includes('root1')),
    `must never read root1's manifest once bump2 (the newest bump) is found: ${deps.git.calls.join(' | ')}`,
  );
});
