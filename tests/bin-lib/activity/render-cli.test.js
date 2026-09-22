'use strict';
// tests/bin-lib/activity/render-cli.test.js — #2757: activity-render.js exit contract.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../../plugin/bin/activity-render');

const FACTS = JSON.stringify({ schemaVersion: 1, generatedAt: 'x', actor: 'octocat', period: { from: '2026-09-15', to: '2026-09-22', preset: '7d' }, repos: ['acme/widgets'],
  merged_prs: [{ repo: 'acme/widgets', number: 10, title: 't', url: 'https://x/pull/10', mergedAt: '', additions: 0, deletions: 0, labels: [] }],
  closed_issues: [], issues_raised: [], reviews_given: [], in_flight: [], commits: [], failures: [] });
const NARR = JSON.stringify({ schemaVersion: 1, register: 'retro', sections: [{ heading: 'Shipped', items: [{ text: 'Did it', refs: ['acme/widgets#10', 'acme/widgets#11'] }] }] });

function deps(files, overrides = {}) {
  const out = { stdout: [], stderr: [], written: {} };
  const d = {
    readFile: (p) => { if (!(p in files)) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e; } return files[p]; },
    writeFile: (p, t) => { out.written[p] = t; },
    stdout: (s) => out.stdout.push(s), stderr: (s) => out.stderr.push(s), ...overrides,
  };
  return { d, out };
}
const ARGS = ['--facts', 'f.json', '--narratives', 'n.json', '--out', 'r.md'];

test('--help exits 0; missing flags and unknown flags exit 1', () => {
  assert.equal(run(['--help'], deps({}).d), 0);
  for (const argv of [['--facts', 'f.json'], ['--facts', 'f.json', '--narratives', 'n.json'], [...ARGS, '--bogus']]) {
    const { d } = deps({});
    assert.equal(run(argv, d), 1, argv.join(' '));
  }
});

test('renders, writes the report, exits 0, and prints one warning line per dropped ref', () => {
  const { d, out } = deps({ 'f.json': FACTS, 'n.json': NARR });
  assert.equal(run(ARGS, d), 0);
  assert.ok(out.written['r.md'].includes('[acme/widgets#10](https://x/pull/10)'));
  assert.deepEqual(out.stderr, ['warning: dropped citation acme/widgets#11 — not present in facts.json\n']);
});

test('AC7: exit 2 on an unreadable file, on schemaVersion != 1 in either file, and on a non-string ref, naming the path', () => {
  assert.equal(run(ARGS, deps({ 'n.json': NARR }).d), 2);
  const badFacts = deps({ 'f.json': FACTS.replace('"schemaVersion":1', '"schemaVersion":2'), 'n.json': NARR });
  assert.equal(run(ARGS, badFacts.d), 2);
  assert.match(badFacts.out.stderr.join(''), /facts\.schemaVersion/);
  const badNarr = deps({ 'f.json': FACTS, 'n.json': NARR.replace('"schemaVersion":1', '"schemaVersion":"1"') });
  assert.equal(run(ARGS, badNarr.d), 2);
  assert.match(badNarr.out.stderr.join(''), /narratives\.schemaVersion/);
  const nonString = deps({ 'f.json': FACTS, 'n.json': NARR.replace('"acme/widgets#11"', '11') });
  assert.equal(run(ARGS, nonString.d), 2);
  assert.match(nonString.out.stderr.join(''), /sections\[0\]\.items\[0\]\.refs\[1\]/);
  const notJson = deps({ 'f.json': '{', 'n.json': NARR });
  assert.equal(run(ARGS, notJson.d), 2);
});
